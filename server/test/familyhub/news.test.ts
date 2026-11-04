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
import { extractBlocks, mergeFeeds, NEWS_FEEDS, parseFeed, readableArticle } from '../../src/services/familyhub/news';

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

it('parses BBC-style RSS, drops video/live pages and foreign hosts', () => {
    const items = parseFeed(feed([
        { title: 'Story one', link: 'https://www.bbc.com/news/articles/c111?at_medium=RSS', date: 'Mon, 02 Nov 2026 20:00:00 GMT' },
        { title: 'A video', link: 'https://www.bbc.com/news/videos/c222', date: 'Mon, 02 Nov 2026 21:00:00 GMT' },
        { title: 'Live page', link: 'https://www.bbc.co.uk/news/live/c333', date: 'Mon, 02 Nov 2026 21:00:00 GMT' },
        { title: 'Elsewhere', link: 'https://example.com/story', date: 'Mon, 02 Nov 2026 21:00:00 GMT' },
    ]));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Story one', snippet: 'A fictional summary line.', source: 'BBC News', publishedAt: '2026-11-02T20:00:00.000Z' });
    expect(items[0].id).toMatch(/^[0-9a-f]{20}$/);
});

it('merges feeds newest first, removes duplicates and keeps at most ten', () => {
    const make = (n: number, prefix: string) => parseFeed(feed(Array.from({ length: n }, (_, i) => ({
        title: `${prefix} ${i}`, link: `https://www.bbc.com/news/articles/${prefix}${i}`, date: new Date(Date.UTC(2026, 10, 2, i)).toUTCString() }))));
    const world = make(8, 'w'), tech = make(8, 't');
    const merged = mergeFeeds([world, tech, [world[0]]]);
    expect(merged).toHaveLength(10);
    expect(new Set(merged.map((item) => item.id)).size).toBe(10);
    expect(Date.parse(merged[0].publishedAt!)).toBeGreaterThanOrEqual(Date.parse(merged[9].publishedAt!));
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
    expect(headline).toMatchObject({ title: 'Fictional bridge reopens', source: 'BBC News' });
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
