import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL(process.env.FAMILYHUB_TEST_BUILT_SW === 'true'
    ? '../client/dist/sw.js' : '../client/src/sw.js', import.meta.url), 'utf8');
function worker(fetchImpl) {
    const handlers = new Map();
    const removed = [];
    const caches = {
        keys: async () => ['openfamily-v3', 'openfamily-api-v3', 'openfamily-v4'],
        delete: async (key) => { removed.push(key); },
        match: () => { throw new Error('Private response accessed shared cache'); },
        open: () => { throw new Error('Private response written to shared cache'); },
    };
    const self = { __WB_MANIFEST: [], location: { origin: 'https://family.test' },
        clients: { claim: async () => {} }, addEventListener: (name, handler) => handlers.set(name, handler) };
    vm.runInNewContext(source, { self, caches, fetch: fetchImpl, URL, Response, console });
    return { removed, handlers, request: async (url, headers) => {
        let response;
        handlers.get('fetch')({ request: new Request(url, { headers }), respondWith: (value) => { response = value; } });
        return response === undefined ? undefined : await response;
    } };
}
test('activation removes legacy household caches while retaining the new static cache', async () => {
    const w = worker(); let completion;
    w.handlers.get('activate')({ waitUntil: (value) => { completion = value; } });
    await completion;
    assert.deepEqual(w.removed, ['openfamily-v3', 'openfamily-api-v3']);
});
test('authenticated API reads bypass caches and force no-store', async () => {
    const w = worker(async (_req, options) => {
        assert.equal(options.cache, 'no-store'); return Response.json({ user: 'fictional' });
    });
    assert.deepEqual(await (await w.request('https://family.test/api/auth/me', { Authorization: 'Bearer fictional' })).json(), { user: 'fictional' });
});
test('offline API reads fail safely rather than returning another account’s cached data', async () => {
    const w = worker(async () => { throw new Error('offline'); });
    const response = await w.request('https://family.test/api/notes');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.json()).offline, true);
});
test('non-API authenticated and third-party requests never use shared asset caches', async () => {
    const w = worker();
    assert.equal(await w.request('https://family.test/private.jpg', { Authorization: 'Bearer fictional' }), undefined);
    assert.equal(await w.request('https://elsewhere.test/picture.jpg'), undefined);
});
