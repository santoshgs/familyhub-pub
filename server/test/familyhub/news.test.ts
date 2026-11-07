import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const fetches = vi.hoisted(() => ({ calls: [] as string[], responses: new Map<string, string>() }));
vi.mock('../../src/lib/safeFetch', async (original) => {
    const real = await original<typeof import('../../src/lib/safeFetch')>();
    return {
        ...real,
        safeFetch: vi.fn(async (url: string) => {
            fetches.calls.push(url);
            const body = fetches.responses.get(url);
            return new Response(body ?? 'missing', { status: body ? 200 : 404 });
        }),
    };
});

import { app, registerWithPassword, query } from '../helpers';
import pool, { runMigrations } from '../../src/db';
import { DEFAULT_NEWS_FEEDS, extractBlocks, feedTitle, mergeFeeds, parseFeed, readableArticle } from '../../src/services/familyhub/news';
import { feedUrl, parseExtrasSettings } from '../../src/services/familyhub/extras/settings';
const NEWS_FEEDS = DEFAULT_NEWS_FEEDS.map((feed) => feed.url);

const feed = (items: Array<{ title: string; link: string; date: string; description?: string }>) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>BBC News</title>${items.map((item) => `<item><title><![CDATA[${item.title}]]></title><description><![CDATA[${item.description ?? 'A fictional summary line.'}]]></description><link>${item.link}</link><pubDate>${item.date}</pubDate></item>`).join('')}</channel></rss>`;
const story = (title: string) => `<!doctype html><html><head><title>${title} - BBC News</title></head><body>
<header><nav><a href="/">Home</a><a href="/news">News</a></nav></header>
<main><article><h1>${title}</h1><p class="byline">By A Fictional Reporter</p>
${Array.from({ length: 6 }, (_, i) => `<p>Paragraph ${i + 1} of a fictional story about ${title.toLowerCase()}. It has enough words in it to look like real article text for the readability scorer, with commas, clauses, and detail.</p>`).join('\n')}
<h2>What happens next</h2><p>The fictional council meets again on Thursday, officials said, and a decision is expected after that.</p>
<ul><li>First fictional point</li><li>Second fictional point</li></ul></article>
<aside><h2>More stories</h2><a href="/x">Unrelated link</a></aside></main><footer>Copyright fictional</footer></body></html>`;

let token = '';
beforeAll(async () => {
    const database = await query('SELECT current_database() AS name');
    if (!String(database.rows[0]?.name).endsWith('_test')) throw new Error('News tests require a disposable _test database.');
    await runMigrations();
});
beforeEach(async () => {
    await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
    token = (await registerWithPassword('news-owner@example.test', 'fictional-password-1', 'Fictional Owner')).token;
});
afterAll(async () => { await pool.end(); });

it('parses RSS, drops video/live pages and non-web links, and strips HTML from summaries', () => {
    const items = parseFeed(feed([
        { title: 'Story one', link: 'https://www.bbc.com/news/articles/c111?at_medium=RSS', date: 'Mon, 02 Nov 2026 20:00:00 GMT', description: '<p>A <b>fictional</b> summary&nbsp;line.</p>' },
        { title: 'A video', link: 'https://www.bbc.com/news/videos/c222', date: 'Mon, 02 Nov 2026 21:00:00 GMT' },
        { title: 'Live page', link: 'https://www.bbc.co.uk/news/live/c333', date: 'Mon, 02 Nov 2026 21:00:00 GMT' },
        { title: 'Script link', link: 'javascript:alert(1)', date: 'Mon, 02 Nov 2026 21:00:00 GMT' },
        { title: 'Elsewhere', link: 'https://example.com/story', date: 'Mon, 02 Nov 2026 21:00:00 GMT' },
    ]), 'BBC World');
    expect(items.map((item) => item.title)).toEqual(['Story one', 'Elsewhere']);
    expect(items[0]).toMatchObject({ snippet: 'A fictional summary line.', source: 'BBC World', publishedAt: '2026-11-02T20:00:00.000Z' });
    expect(items[0].id).toMatch(/^[0-9a-f]{20}$/);
});

it('parses Atom feeds and reads feed titles', () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Fictional Tech Blog</title>
        <entry><title>Atom story</title><link rel="alternate" href="https://blog.example.com/atom-story"/><link rel="self" href="https://blog.example.com/x.xml"/><updated>2026-11-03T10:00:00Z</updated><summary>Short fictional summary.</summary></entry></feed>`;
    expect(parseFeed(atom, 'Blog')).toMatchObject([{ title: 'Atom story', source: 'Blog', snippet: 'Short fictional summary.', publishedAt: '2026-11-03T10:00:00.000Z' }]);
    expect(feedTitle(atom)).toBe('Fictional Tech Blog');
    expect(feedTitle(feed([]))).toBe('BBC News');
});

it('accepts only public https feed addresses', () => {
    expect(feedUrl('https://feeds.example.com/rss.xml#top')).toBe('https://feeds.example.com/rss.xml');
    for (const bad of ['http://feeds.example.com/rss', 'https://localhost/rss', 'https://10.0.0.5/rss', 'https://[::1]/rss', 'https://user:pw@example.com/rss',
        'https://example.com:8443/rss', 'https://printer.local/rss', 'ftp://example.com/rss', 'not a url', 'https://intranet/rss']) {
        expect(() => feedUrl(bad), bad).toThrow();
    }
    const parsed = parseExtrasSettings({ news: { feeds: [{ url: 'https://www.example.com/feed', name: '' }, { url: 'https://www.example.com/feed', name: 'Duplicate' }, 'https://rss.example.org/top.xml'] } });
    expect(parsed.news.feeds).toEqual([{ url: 'https://www.example.com/feed', name: 'example.com' }, { url: 'https://rss.example.org/top.xml', name: 'example.org' }]);
    expect(() => parseExtrasSettings({ news: { feeds: Array.from({ length: 9 }, (_, i) => `https://f${i}.example.com/rss`) } })).toThrow(/at most 8/);
    expect(parseExtrasSettings({ news: { feeds: [] } }).news.feeds).toEqual([]);
});

it('merges feeds newest first, removes duplicates and keeps at most twelve', () => {
    const make = (n: number, prefix: string) => parseFeed(feed(Array.from({ length: n }, (_, i) => ({
        title: `${prefix} ${i}`, link: `https://www.bbc.com/news/articles/${prefix}${i}`, date: new Date(Date.UTC(2026, 10, 2, i)).toUTCString() }))));
    const world = make(8, 'w'), tech = make(8, 't');
    const merged = mergeFeeds([world, tech, [world[0]]]);
    expect(merged).toHaveLength(12);
    expect(new Set(merged.map((item) => item.id)).size).toBe(12);
    expect(Date.parse(merged[0].publishedAt!)).toBeGreaterThanOrEqual(Date.parse(merged[11].publishedAt!));
});

it('builds a plain-text reader view and falls back to the snippet', () => {
    const view = readableArticle(story('Fictional bridge reopens'), { id: 'a'.repeat(20), title: 'Feed title', snippet: 'Feed snippet', publishedAt: null });
    expect(view.complete).toBe(true);
    expect(view.title).toContain('Fictional bridge reopens');
    expect(view.blocks.filter((block) => block.kind === 'p').length).toBeGreaterThanOrEqual(6);
    expect(view.blocks).toContainEqual({ kind: 'h', text: 'What happens next' });
    expect(view.blocks).toContainEqual({ kind: 'li', text: 'First fictional point' });
    expect(JSON.stringify(view)).not.toMatch(/Unrelated link|Copyright fictional|<p|<a /);
    const fallback = readableArticle('<html><body><p>Too short.</p></body></html>', { id: 'b'.repeat(20), title: 'Feed title', snippet: 'Feed snippet', publishedAt: null });
    expect(fallback).toMatchObject({ complete: false, title: 'Feed title', blocks: [{ kind: 'p', text: 'Feed snippet' }] });
    expect(extractBlocks('<blockquote><p>Quoted words here</p></blockquote>')).toEqual([{ kind: 'quote', text: 'Quoted words here' }]);
});

it('serves headlines and reader views to a paired display only for stories in the feed', async () => {
    const link = 'https://www.bbc.com/news/articles/c444';
    fetches.responses.set(NEWS_FEEDS[0], feed([{ title: 'Fictional bridge reopens', link, date: 'Mon, 02 Nov 2026 20:00:00 GMT' }]));
    fetches.responses.set(NEWS_FEEDS[1], feed([]));
    fetches.responses.set(link, story('Fictional bridge reopens'));
    const auth = (path: string, bearer = token) => request(app).get(path).set('Authorization', `Bearer ${bearer}`);

    // News is opt-in: articles are refused until the card is enabled.
    expect((await auth('/api/familyhub/ambient/article?id=' + 'c'.repeat(20))).status).toBe(404);
    expect((await request(app).put('/api/familyhub/ambient/settings').set('Authorization', `Bearer ${token}`)
        .send({ location: null, widgets: ['calendar', 'news'] })).status).toBe(200);

    const display = (await request(app).post('/api/familyhub/ambient/display-session').set('Authorization', `Bearer ${token}`).send({})).body.data.token as string;
    const snapshot = await auth('/api/familyhub/ambient', display);
    expect(snapshot.status).toBe(200);
    const [headline] = snapshot.body.data.news.items;
    expect(headline).toMatchObject({ title: 'Fictional bridge reopens', source: 'BBC World' });
    expect(snapshot.body.data.news.label).toBe('BBC World · BBC Technology');
    expect(headline.url).toBeUndefined();

    const article = await auth(`/api/familyhub/ambient/article?id=${headline.id}`, display);
    expect(article.status).toBe(200);
    expect(article.body.data.complete).toBe(true);
    expect(fetches.calls).toContain(link);

    // Anything not in the feed is refused without a fetch.
    const before = fetches.calls.length;
    expect((await auth('/api/familyhub/ambient/article?id=' + 'd'.repeat(20), display)).status).toBe(404);
    expect((await auth('/api/familyhub/ambient/article?id=../../etc', display)).status).toBe(404);
    expect(fetches.calls.length).toBe(before);
});

it('uses the feeds chosen in Settings, and checks a feed before it is saved', async () => {
    const custom = 'https://news.example.com/top.xml';
    const link = 'https://news.example.com/stories/fictional-park';
    fetches.responses.set(custom, feed([{ title: 'Fictional park opens', link, date: 'Tue, 03 Nov 2026 08:00:00 GMT' }]));
    const auth = (method: 'get' | 'put' | 'post', path: string, bearer = token) => request(app)[method](path).set('Authorization', `Bearer ${bearer}`);
    expect((await auth('put', '/api/familyhub/ambient/settings').send({ location: null, widgets: ['news'] })).status).toBe(200);

    const preview = await auth('post', '/api/familyhub/dashboard/news/preview').send({ url: custom });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ url: custom, title: 'BBC News', count: 1, latest: ['Fictional park opens'] });
    expect((await auth('post', '/api/familyhub/dashboard/news/preview').send({ url: 'https://news.example.com/missing.xml' })).status).toBe(422);
    expect((await auth('post', '/api/familyhub/dashboard/news/preview').send({ url: 'http://news.example.com/top.xml' })).status).toBe(400);

    const saved = await auth('put', '/api/familyhub/dashboard/settings').send({ news: { feeds: [{ url: custom, name: 'Fictional Daily' }] } });
    expect(saved.status).toBe(200);
    expect(saved.body.data.news.feeds).toEqual([{ url: custom, name: 'Fictional Daily' }]);
    expect((await auth('put', '/api/familyhub/dashboard/settings').send({ news: { feeds: ['https://127.0.0.1/rss'] } })).status).toBe(400);

    const display = (await auth('post', '/api/familyhub/ambient/display-session').send({})).body.data.token as string;
    expect((await auth('post', '/api/familyhub/dashboard/news/preview', display).send({ url: custom })).status).toBe(403);
    const snapshot = await auth('get', '/api/familyhub/ambient', display);
    expect(snapshot.body.data.news).toMatchObject({ state: 'fresh', label: 'Fictional Daily', items: [{ title: 'Fictional park opens', source: 'Fictional Daily' }] });
    fetches.responses.set(link, story('Fictional park opens'));
    const article = await auth('get', `/api/familyhub/ambient/article?id=${snapshot.body.data.news.items[0].id}`, display);
    expect(article.body.data).toMatchObject({ complete: true, source: 'Fictional Daily' });

    expect((await auth('put', '/api/familyhub/dashboard/settings').send({ news: { feeds: [] } })).status).toBe(200);
    expect((await auth('get', '/api/familyhub/ambient', display)).body.data.news).toMatchObject({ state: 'no-feeds', items: [] });
});
