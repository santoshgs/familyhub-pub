import { createHash } from 'crypto';
import { Readability } from '@mozilla/readability';
import { DOMParser, parseHTML } from 'linkedom';
import { readCappedText, safeFetch } from '../../lib/safeFetch';

/**
 * Headlines for the family display from the RSS or Atom feeds the family picks
 * in Settings → Display (BBC News World and Technology by default), merged
 * newest first, at most 12. Articles open in a reader view built on the server
 * with Mozilla Readability, so the frame downloads a few kilobytes of text
 * instead of a full news page. Only links that arrived in a configured feed are
 * ever fetched for the reader view, through the private-address guard.
 */
export interface NewsFeed { url: string; name: string }
export const DEFAULT_NEWS_FEEDS: NewsFeed[] = [
    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC World' },
    { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', name: 'BBC Technology' },
];
export const MAX_NEWS_FEEDS = 8;
const MAX_ITEMS = 12;
const FEED_TTL_MS = 15 * 60_000;
const FAILED_FEED_TTL_MS = 2 * 60_000;
const ARTICLE_TTL_MS = 6 * 60 * 60_000;
const FEED_BYTES = 2 * 1024 * 1024;
const USER_AGENT = 'FamilyHub/1.3 (self-hosted family display)';

export interface NewsItem { id: string; title: string; snippet: string; source: string; publishedAt: string | null }
export interface NewsBlock { kind: 'p' | 'h' | 'li' | 'quote'; text: string }
export interface NewsArticle { id: string; title: string; byline: string | null; source: string; publishedAt: string | null; blocks: NewsBlock[]; complete: boolean }

interface FeedEntry extends NewsItem { url: string }
interface FeedResult { ok: boolean; title: string; items: FeedEntry[] }
/** Per feed URL, shared by every family that picked the same feed. */
const feedCache = new Map<string, { expiresAt: number; result: FeedResult }>();
const pendingFeeds = new Map<string, Promise<FeedResult>>();
/** Every item seen recently, so a reader-view request can only name a feed link. */
const knownItems = new Map<string, FeedEntry>();
const articleCache = new Map<string, { expiresAt: number; value: NewsArticle }>();

const clean = (value: string | null | undefined, max: number) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
/** Feed descriptions often carry escaped HTML; keep only its text. */
const plain = (value: string | null | undefined, max: number) => clean((value ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'"), max);
const idFor = (url: string) => createHash('sha256').update(url).digest('hex').slice(0, 20);
const webLink = (value: string) => {
    try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null; } catch { return null; }
};

/** RSS 2.0 items or Atom entries, as headline entries attributed to `source`. */
export function parseFeed(xml: string, source = 'News'): FeedEntry[] {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const nodes = Array.from(doc.querySelectorAll('item')).length ? Array.from(doc.querySelectorAll('item')) : Array.from(doc.querySelectorAll('entry'));
    return nodes.flatMap((item) => {
        const text = (...tags: string[]) => { for (const tag of tags) { const found = item.querySelector(tag)?.textContent; if (found) return found; } return ''; };
        const title = plain(text('title'), 200);
        // Atom: the alternate link's href; RSS: the <link> text.
        type LinkElement = { getAttribute(name: string): string | null };
        const atomLink = (Array.from(item.querySelectorAll('link')) as unknown as LinkElement[]).find((link) => link.getAttribute('href') && (!link.getAttribute('rel') || link.getAttribute('rel') === 'alternate'));
        const url = webLink(clean(atomLink?.getAttribute('href') ?? text('link'), 500));
        // Video, audio and live pages have little readable text.
        if (!title || !url || /\/(videos?|av|live|sounds|iplayer|podcasts?)\//.test(url)) return [];
        const published = Date.parse(text('pubDate', 'published', 'updated'));
        return [{ id: idFor(url), url, title, snippet: plain(text('description', 'summary', 'content'), 220), source,
            publishedAt: Number.isFinite(published) ? new Date(published).toISOString() : null }];
    });
}

/** The feed's own title (channel or Atom feed), for naming a feed in Settings. */
export function feedTitle(xml: string): string {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    return plain(doc.querySelector('channel > title')?.textContent ?? doc.querySelector('feed > title')?.textContent ?? '', 60);
}

export function mergeFeeds(lists: FeedEntry[][]): FeedEntry[] {
    const seen = new Set<string>();
    return lists.flat()
        .sort((a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0))
        .filter((item) => {
            const key = item.url.split('?')[0];
            if (seen.has(key) || seen.has(item.title)) return false;
            seen.add(key); seen.add(item.title); return true;
        })
        .slice(0, MAX_ITEMS);
}

async function fetchFeed(feed: NewsFeed): Promise<FeedResult> {
    try {
        const response = await safeFetch(feed.url, { blockPrivate: true, timeoutMs: 8_000, maxBytes: FEED_BYTES, headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' } });
        if (!response.ok) return { ok: false, title: '', items: [] };
        const xml = await readCappedText(response, FEED_BYTES);
        return { ok: true, title: feedTitle(xml), items: parseFeed(xml, feed.name) };
    } catch { return { ok: false, title: '', items: [] }; }
}

async function loadFeed(feed: NewsFeed): Promise<FeedResult> {
    const key = `${feed.url}\n${feed.name}`;
    const cached = feedCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    let pending = pendingFeeds.get(key);
    if (!pending) {
        pending = fetchFeed(feed).finally(() => pendingFeeds.delete(key));
        pendingFeeds.set(key, pending);
    }
    const result = await pending;
    // A failed refresh keeps the last good headlines for a while.
    if (result.ok || !cached) feedCache.set(key, { result, expiresAt: Date.now() + (result.ok ? FEED_TTL_MS : FAILED_FEED_TTL_MS) });
    while (feedCache.size > 64) feedCache.delete(feedCache.keys().next().value as string);
    for (const item of result.items) knownItems.set(item.id, item);
    while (knownItems.size > 400) knownItems.delete(knownItems.keys().next().value as string);
    return result.ok ? result : cached?.result ?? result;
}

export async function getNews(feeds: NewsFeed[] = DEFAULT_NEWS_FEEDS): Promise<{ items: NewsItem[]; state: 'fresh' | 'unavailable' | 'no-feeds'; label: string }> {
    const label = feeds.length === 0 ? '' : feeds.length <= 2 ? feeds.map((feed) => feed.name).join(' · ') : `${feeds.length} sources`;
    if (!feeds.length) return { items: [], state: 'no-feeds', label };
    const results = await Promise.all(feeds.slice(0, MAX_NEWS_FEEDS).map(loadFeed));
    const items = mergeFeeds(results.map((result) => result.items)).map(({ url: _url, ...item }) => item);
    return { items, state: items.length ? 'fresh' : 'unavailable', label };
}

/** Settings → Display: checks that a URL is a readable feed before it is saved. */
export async function previewFeed(url: string): Promise<{ ok: boolean; title: string; count: number; latest: string[] }> {
    const result = await fetchFeed({ url, name: 'preview' });
    return { ok: result.ok && result.items.length > 0, title: result.title, count: result.items.length, latest: result.items.slice(0, 3).map((item) => item.title) };
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

export function readableArticle(html: string, item: Pick<FeedEntry, 'id' | 'title' | 'snippet' | 'publishedAt'> & { source?: string }): NewsArticle {
    let parsed: ReturnType<Readability['parse']> = null;
    try {
        const { document } = parseHTML(html);
        parsed = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], { charThreshold: 300 }).parse();
    } catch { parsed = null; }
    const blocks = parsed?.content ? extractBlocks(parsed.content) : [];
    const complete = blocks.filter((block) => block.kind === 'p').length >= 2;
    return {
        id: item.id, title: clean(parsed?.title, 200) || item.title, byline: clean(parsed?.byline, 160) || null, source: item.source ?? 'News',
        publishedAt: item.publishedAt, complete,
        blocks: complete ? blocks : [{ kind: 'p', text: item.snippet || 'This story could not be shown in reader view.' }],
    };
}

export async function getNewsArticle(id: string, feeds: NewsFeed[] = DEFAULT_NEWS_FEEDS): Promise<NewsArticle | null> {
    if (!/^[0-9a-f]{20}$/.test(id)) return null;
    const cached = articleCache.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (!knownItems.has(id)) await getNews(feeds);
    const item = knownItems.get(id);
    if (!item) return null;
    let html = '';
    try {
        const response = await safeFetch(item.url, { blockPrivate: true, timeoutMs: 10_000, maxBytes: 3 * 1024 * 1024, headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
        const type = response.headers.get('content-type') ?? '';
        // Media and downloads have no article text; anything else is tried.
        if (response.ok && !/^(image|audio|video)\/|^application\/(pdf|octet-stream|zip)/i.test(type)) html = await readCappedText(response, 3 * 1024 * 1024);
    } catch { html = ''; }
    const value = readableArticle(html, item);
    articleCache.set(id, { value, expiresAt: Date.now() + (value.complete ? ARTICLE_TTL_MS : 5 * 60_000) });
    while (articleCache.size > 40) articleCache.delete(articleCache.keys().next().value as string);
    return value;
}
