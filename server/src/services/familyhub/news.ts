import { createHash } from 'crypto';
import { Readability } from '@mozilla/readability';
import { DOMParser, parseHTML } from 'linkedom';
import { readCappedText, safeFetch } from '../../lib/safeFetch';

/**
 * Headlines for the family display: BBC News World and Technology RSS, merged
 * newest first, at most 10. Articles open in a reader view built on the server
 * with Mozilla Readability, so the frame downloads a few kilobytes of text
 * instead of a full news page. Only URLs that arrived in these feeds, on BBC
 * hosts, are ever fetched for the reader view.
 */
export const NEWS_FEEDS = [
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://feeds.bbci.co.uk/news/technology/rss.xml',
] as const;
export const NEWS_SOURCE = 'BBC News';
const MAX_ITEMS = 10;
const FEED_TTL_MS = 15 * 60_000;
const ARTICLE_TTL_MS = 6 * 60 * 60_000;
const ARTICLE_HOSTS = /(^|\.)bbc\.(co\.uk|com)$/i;
const USER_AGENT = 'FamilyHub/0.3 (self-hosted family display)';

export interface NewsItem { id: string; title: string; snippet: string; source: string; publishedAt: string | null }
export interface NewsBlock { kind: 'p' | 'h' | 'li' | 'quote'; text: string }
export interface NewsArticle { id: string; title: string; byline: string | null; source: string; publishedAt: string | null; blocks: NewsBlock[]; complete: boolean }

interface FeedEntry extends NewsItem { url: string }
let feedCache: { expiresAt: number; items: FeedEntry[] } | null = null;
let pendingFeed: Promise<FeedEntry[]> | null = null;
/** Every item seen recently, so a reader-view request can only name a feed URL. */
const knownItems = new Map<string, FeedEntry>();
const articleCache = new Map<string, { expiresAt: number; value: NewsArticle }>();

const clean = (value: string | null | undefined, max: number) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const idFor = (url: string) => createHash('sha256').update(url).digest('hex').slice(0, 20);

export function parseFeed(xml: string): FeedEntry[] {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    return Array.from(doc.querySelectorAll('item')).flatMap((item) => {
        const text = (tag: string) => item.querySelector(tag)?.textContent ?? '';
        const title = clean(text('title'), 200);
        const url = clean(text('link'), 500);
        let host = '';
        try { const parsed = new URL(url); if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return []; host = parsed.hostname; } catch { return []; }
        // Video, audio and live pages have little readable text.
        if (!title || !ARTICLE_HOSTS.test(host) || /\/(videos|av|live|sounds|iplayer)\//.test(url)) return [];
        const published = Date.parse(text('pubDate'));
        return [{ id: idFor(url), url, title, snippet: clean(text('description'), 220), source: NEWS_SOURCE,
            publishedAt: Number.isFinite(published) ? new Date(published).toISOString() : null }];
    });
}

export function mergeFeeds(lists: FeedEntry[][]): FeedEntry[] {
    const seen = new Set<string>();
    return lists.flat()
        .sort((a, b) => Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? '') || 0)
        .filter((item) => {
            const key = item.url.split('?')[0];
            if (seen.has(key) || seen.has(item.title)) return false;
            seen.add(key); seen.add(item.title); return true;
        })
        .slice(0, MAX_ITEMS);
}

async function loadFeeds(): Promise<FeedEntry[]> {
    const lists = await Promise.all(NEWS_FEEDS.map(async (feed) => {
        try {
            const response = await safeFetch(feed, { blockPrivate: true, timeoutMs: 8_000, maxBytes: 1024 * 1024, headers: { 'User-Agent': USER_AGENT } });
            if (!response.ok) return [];
            return parseFeed(await readCappedText(response, 1024 * 1024));
        } catch { return []; }
    }));
    return mergeFeeds(lists);
}

export async function getNews(): Promise<{ items: NewsItem[]; state: 'fresh' | 'unavailable' }> {
    if (!feedCache || feedCache.expiresAt <= Date.now()) {
        pendingFeed ??= loadFeeds().finally(() => { pendingFeed = null; });
        const items = await pendingFeed;
        if (items.length || !feedCache) feedCache = { items, expiresAt: Date.now() + (items.length ? FEED_TTL_MS : 2 * 60_000) };
        for (const item of items) knownItems.set(item.id, item);
        while (knownItems.size > 200) knownItems.delete(knownItems.keys().next().value as string);
    }
    const items = feedCache.items.map(({ url: _url, ...item }) => item);
    return { items, state: items.length ? 'fresh' : 'unavailable' };
}

/** Readable text blocks from Readability's article HTML. Plain text only. */
export function extractBlocks(html: string): NewsBlock[] {
    const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
    const blocks: NewsBlock[] = [];
    let total = 0;
    // The server has no DOM type library; describe the few linkedom fields used.
    type TextElement = { tagName: string; textContent: string | null; parentElement: { closest(selector: string): unknown } | null };
    for (const element of Array.from(document.querySelectorAll('p, h2, h3, h4, li, blockquote')) as unknown as TextElement[]) {
        // Nested matches (a paragraph inside a quote or list item) are taken once, at the outer element.
        if (element.parentElement?.closest('li, blockquote')) continue;
        const text = clean(element.textContent, 2000);
        if (text.length < 2) continue;
        const tag = element.tagName.toLowerCase();
        blocks.push({ kind: tag === 'li' ? 'li' : tag === 'blockquote' ? 'quote' : tag.startsWith('h') ? 'h' : 'p', text });
        total += text.length;
        if (blocks.length >= 120 || total > 30_000) break;
    }
    return blocks;
}

export function readableArticle(html: string, item: Pick<FeedEntry, 'id' | 'title' | 'snippet' | 'publishedAt'>): NewsArticle {
    let parsed: ReturnType<Readability['parse']> = null;
    try {
        const { document } = parseHTML(html);
        parsed = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], { charThreshold: 300 }).parse();
    } catch { parsed = null; }
    const blocks = parsed?.content ? extractBlocks(parsed.content) : [];
    const complete = blocks.filter((block) => block.kind === 'p').length >= 2;
    return {
        id: item.id, title: clean(parsed?.title, 200) || item.title, byline: clean(parsed?.byline, 160) || null, source: NEWS_SOURCE,
        publishedAt: item.publishedAt, complete,
        blocks: complete ? blocks : [{ kind: 'p', text: item.snippet || 'This story could not be shown in reader view.' }],
    };
}

export async function getNewsArticle(id: string): Promise<NewsArticle | null> {
    if (!/^[0-9a-f]{20}$/.test(id)) return null;
    const cached = articleCache.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (!knownItems.has(id)) await getNews();
    const item = knownItems.get(id);
    if (!item) return null;
    let html = '';
    try {
        const response = await safeFetch(item.url, { blockPrivate: true, timeoutMs: 10_000, maxBytes: 3 * 1024 * 1024, headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
        if (response.ok && ARTICLE_HOSTS.test(new URL(response.url || item.url).hostname)) html = await readCappedText(response, 3 * 1024 * 1024);
    } catch { html = ''; }
    const value = readableArticle(html, item);
    articleCache.set(id, { value, expiresAt: Date.now() + (value.complete ? ARTICLE_TTL_MS : 5 * 60_000) });
    while (articleCache.size > 40) articleCache.delete(articleCache.keys().next().value as string);
    return value;
}
