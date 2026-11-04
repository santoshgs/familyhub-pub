// Local-only runner. Generated passwords remain in an ignored, private file.
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
// Optional Google configuration stays local and is never printed.
dotenv.config({ path: new URL('../.familyhub-local/google.env', import.meta.url), quiet: true });
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mode = process.argv[2] || 'dev';
if (!['dev', 'test', 'test-all'].includes(mode)) { console.error('Use dev, test, or test-all.'); process.exit(1); }
if (mode === 'dev') {
    for (const port of [53001, 5174]) {
        try {
            await new Promise((resolve, reject) => {
                const probe = net.createServer();
                probe.once('error', reject);
                probe.listen(port, '127.0.0.1', () => probe.close(resolve));
            });
        } catch {
            console.error(`Family Hub cannot start: port ${port} is already in use. Stop the earlier local run with Ctrl+C before restarting. No new servers were started.`);
            process.exit(1);
        }
    }
}
let config;
try { config = JSON.parse(readFileSync(path.join(root, '.familyhub-local/config.json'), 'utf8')); }
catch { console.error('Local database configuration is missing. See docs/familyhub/LOCAL_DEVELOPMENT.md.'); process.exit(1); }
const pgCtl = process.env.FAMILYHUB_PG_CTL || '/opt/homebrew/opt/postgresql@16/bin/pg_ctl';
const dbDir = path.join(root, '.familyhub-local/postgres');
if (spawnSync(pgCtl, ['-D', dbDir, 'status'], { stdio: 'ignore' }).status !== 0) {
    const started = spawnSync(pgCtl, ['-D', dbDir, '-l', path.join(root, '.familyhub-local/postgres.log'), '-o', '-h 127.0.0.1 -p 55432 -k /private/tmp', 'start'], { stdio: 'inherit' });
    if (started.status !== 0) process.exit(1);
}
const env = { ...process.env, ...config, VITE_DEMO: '', VITE_FAMILYHUB: '', VITE_FAMILYHUB_LOCAL: 'true', SERVER_HOST: '127.0.0.1', SERVER_PORT: '53001',
    VITE_API_URL: 'http://127.0.0.1:53001', VITE_WS_URL: 'ws://127.0.0.1:53001', FAMILYHUB_APP_URL: `http://127.0.0.1:5174${process.env.VITE_FAMILYHUB_BASE || '/'}`, CORS_ORIGINS: 'http://127.0.0.1:5174,http://localhost:5174' };
if (mode === 'test' || mode === 'test-all') env.POSTGRES_DB = 'familyhub_test';
else if (mode !== 'dev') { console.error('Use dev, test, or test-all.'); process.exit(1); }
const args = mode === 'test' ? ['exec', '--workspace=@openfamily/server', '--', 'vitest', 'run', '--config', 'vitest.local.config.ts']
    : mode === 'test-all' ? ['test', '--workspace=@openfamily/server'] : ['run', 'dev'];
// Give this launch its own process group so Ctrl+C also stops npm's grandchildren
// (concurrently, Vite and tsx), including launches without an interactive terminal.
const grouped = process.platform !== 'win32';
const child = spawn('npm', args, { cwd: root, env, stdio: 'inherit', detached: grouped });
let stopping = false;
const signalGroup = (signal) => {
    try { if (grouped) process.kill(-child.pid, signal); else child.kill(signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    if (stopping) return; stopping = true;
    signalGroup('SIGTERM');
    setTimeout(() => signalGroup('SIGKILL'), 5000).unref();
});
child.on('error', () => { console.error('Could not launch npm.'); process.exitCode = 1; });
child.on('exit', (code) => {
    // npm can exit before its descendants. Do not leave those servers behind.
    if (grouped) signalGroup('SIGKILL');
    process.exitCode = stopping ? 0 : code ?? 1;
});
