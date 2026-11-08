import { promises as fs } from 'fs';
import path from 'path';

/**
 * Bridge between Settings → Advanced → Server credentials and the Pi's
 * root-only credential applier (deploy/familyhub/admin). The app never stores,
 * logs or returns a token: it writes a submission file that the host applies
 * (after testing it) and deletes, and it reads back non-secret status files.
 */
export const CREDENTIAL_KINDS = ['github-release', 'ghcr', 'cloudflare'] as const;
export type CredentialKind = typeof CREDENTIAL_KINDS[number];
const TOKEN = /^[A-Za-z0-9_-]{20,255}$/;

export const exchangeDir = () => process.env.FAMILYHUB_ADMIN_EXCHANGE || '';

async function readJson(file: string): Promise<any> {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

/** Last nightly off-site backup, written by deploy/familyhub/admin/offsite-backup.sh (no secrets). */
export function parseBackupStatus(raw: any) {
    if (!raw || typeof raw !== 'object') return null;
    const iso = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null;
    const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
    return {
        destination: String(raw.destination ?? 'Off-site').slice(0, 60),
        state: raw.state === 'ok' ? 'ok' as const : 'failed' as const,
        message: String(raw.message ?? '').slice(0, 300),
        attemptedAt: iso(raw.attemptedAt), lastSuccessAt: iso(raw.lastSuccessAt),
        sizeBytes: num(raw.sizeBytes), snapshots: num(raw.snapshots),
    };
}

export async function credentialStatus() {
    const dir = exchangeDir();
    if (!dir) return { available: false as const };
    try { await fs.access(path.join(dir, 'inbox')); } catch { return { available: false as const }; }
    const [status, results, pending] = await Promise.all([
        readJson(path.join(dir, 'status.json')),
        readJson(path.join(dir, 'results.json')),
        fs.readdir(path.join(dir, 'inbox')).then((files) => files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))).catch(() => []),
    ]);
    const items = Array.isArray(status?.items) ? status.items.map((item: any) => ({
        kind: String(item.kind ?? ''), name: String(item.name ?? ''), expiresAt: typeof item.expiresAt === 'string' ? item.expiresAt : null,
        state: ['ok', 'warn', 'unknown'].includes(item.state) ? item.state : 'unknown', note: String(item.note ?? '').slice(0, 200),
        updatable: (CREDENTIAL_KINDS as readonly string[]).includes(item.kind),
    })) : [];
    const lastResults: Record<string, { ok: boolean; message: string; at: string }> = {};
    for (const [kind, value] of Object.entries(results ?? {})) {
        const r = value as any;
        if (r && typeof r === 'object') lastResults[kind] = { ok: Boolean(r.ok), message: String(r.message ?? '').slice(0, 300), at: String(r.at ?? '') };
    }
    const backup = parseBackupStatus(await readJson(path.join(dir, 'backup-status.json')));
    return { available: true as const, backup, checkedAt: typeof status?.checkedAt === 'string' ? status.checkedAt : null, warnDays: Number(status?.warnDays) || 30, items, results: lastResults, pending };
}

async function writeSubmission(name: string, body: object) {
    const dir = path.join(exchangeDir(), 'inbox');
    const tmp = path.join(dir, `.${name}.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(body), { mode: 0o600 });
    await fs.rename(tmp, path.join(dir, `${name}.json`));
}

export async function submitCredential(kind: string, token: unknown): Promise<'ok' | 'invalid-kind' | 'invalid-token' | 'unavailable'> {
    if (!(CREDENTIAL_KINDS as readonly string[]).includes(kind)) return 'invalid-kind';
    const value = typeof token === 'string' ? token.trim() : '';
    if (!TOKEN.test(value)) return 'invalid-token';
    if (!(await credentialStatus()).available) return 'unavailable';
    await writeSubmission(kind, { kind, token: value, submittedAt: new Date().toISOString() });
    return 'ok';
}

export async function requestCheck(): Promise<boolean> {
    if (!(await credentialStatus()).available) return false;
    await writeSubmission('check', { kind: 'check' });
    return true;
}
