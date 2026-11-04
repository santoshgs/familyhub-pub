// Read-only checks. Never accepts credentials, sends tokens, or prints API bodies.
const origin = new URL(process.argv[2] || 'http://127.0.0.1:53001');
if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Supply an origin only, without credentials, paths, or queries.');
}
if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) {
    throw new Error('HTTPS is required outside loopback development.');
}
let failed = false;
for (const [route, status, privateResponse] of [
    ['/health', 200, false], ['/ready', 200, true],
    ['/api/familyhub', 401, true], ['/api/notes', 401, true], ['/api/ai/settings', 401, true],
]) {
    try {
        const response = await fetch(new URL(route, origin), { redirect: 'manual', signal: AbortSignal.timeout(8000) });
        const body = await response.json().catch(() => null);
        const validBody = route === '/ready' ? body?.status === 'ready' : route === '/health' ? body?.status === 'ok' : body?.success === false;
        const ok = response.status === status && validBody && (!privateResponse || response.headers.get('cache-control')?.includes('no-store'));
        console.log(`${ok ? 'PASS' : 'FAIL'} ${route}: HTTP ${response.status}${privateResponse ? ', no-store=' + Boolean(response.headers.get('cache-control')?.includes('no-store')) : ''}`);
        if (!ok) failed = true;
    } catch { console.error(`FAIL ${route}: request failed or timed out`); failed = true; }
}
if (origin.protocol === 'http:') console.log('Loopback development checks only; HTTPS and device access were not tested.');
process.exitCode = failed ? 1 : 0;
