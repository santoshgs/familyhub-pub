import { afterEach, expect, it, vi } from 'vitest';
import { geminiComplete } from '../src/services/ai/gemini';
const settings = { provider: 'gemini' as const, model: 'fictional-model', api_key: 'fictional-private-key', base_url: null };
const request = { system: 'Connection test', user: 'Return ok', jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } } };
afterEach(() => vi.restoreAllMocks());
it('preserves the Google permission diagnostic while redacting the submitted key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: { status: 'PERMISSION_DENIED', message: 'Generative Language API is disabled. Key: fictional-private-key' } }, { status: 403 }));
    await expect(geminiComplete(settings, request)).rejects.toMatchObject({ code: 'AI_UNAUTHORIZED', message: 'Generative Language API is disabled. Key: [redacted]' });
});
it('recognizes an invalid key from Google’s 400 error envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: { status: 'INVALID_ARGUMENT', message: 'API key not valid', details: [{ reason: 'API_KEY_INVALID' }] } }, { status: 400 }));
    await expect(geminiComplete(settings, request)).rejects.toMatchObject({ code: 'AI_UNAUTHORIZED' });
});
it('keeps quota failures distinct from key failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }, { status: 429 }));
    await expect(geminiComplete(settings, request)).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR', message: 'Quota exceeded' });
});
it('uses low thinking and a bounded output for structured Family Hub requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
    }));

    await expect(geminiComplete(settings, request)).resolves.toMatchObject({ data: { ok: true } });
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
        generationConfig?: { thinkingConfig?: { thinkingLevel?: string }; maxOutputTokens?: number };
    };
    expect(body.generationConfig).toMatchObject({
        thinkingConfig: { thinkingLevel: 'LOW' },
        maxOutputTokens: 2048,
    });
});
