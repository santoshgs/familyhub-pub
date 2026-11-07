import { promises as fs } from 'fs';
import path from 'path';
import { exchangeDir } from './adminCredentials';

/**
 * Settings → Advanced → Software updates. The Pi's updater (deploy/familyhub/release.py)
 * publishes a secret-free update-status.json into the admin exchange folder; the
 * app reads it and can only *ask* the host's root-only applier to check GitHub now
 * or to start the updater now. Which release is installed, the backup, the health
 * check and the rollback all stay with the updater.
 */
export const UPDATE_REQUESTS = { check: 'update-check', install: 'update-install' } as const;
export type UpdateRequest = keyof typeof UPDATE_REQUESTS;
const VERSION = /^familyhub-v\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const STATES = ['checked', 'up-to-date', 'installing', 'updated', 'failed', 'check-failed'] as const;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const version = (value: unknown) => typeof value === 'string' && VERSION.test(value) ? value : null;
const when = (value: unknown) => typeof value === 'string' && ISO.test(value) ? value : null;
const text = (value: unknown) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300) : '';
const versionKey = (value: string) => value.slice('familyhub-v'.length).split('.').map(Number);
const newer = (a: string, b: string) => {
    const [x, y] = [versionKey(a), versionKey(b)];
    for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
};

export async function updateStatus() {
    const dir = exchangeDir();
    if (!dir) return { available: false as const };
    const inbox = path.join(dir, 'inbox');
    let pendingFiles: string[];
    try { pendingFiles = await fs.readdir(inbox); } catch { return { available: false as const }; }
    let raw: any = null;
    try { raw = JSON.parse(await fs.readFile(path.join(dir, 'update-status.json'), 'utf8')); } catch { /* not written yet */ }
    const current = version(raw?.current), latest = version(raw?.latest);
    return {
        available: true as const,
        current, previous: version(raw?.previous), latest,
        // Recomputed here: the file is in a folder the container can write.
        updateAvailable: Boolean(latest && (!current || newer(latest, current))),
        state: (STATES as readonly string[]).includes(raw?.state) ? raw.state as typeof STATES[number] : null,
        message: text(raw?.message),
        checkedAt: when(raw?.checkedAt), requestedAt: when(raw?.requestedAt), finishedAt: when(raw?.finishedAt), updatedAt: when(raw?.updatedAt),
        autoUpdates: typeof raw?.autoUpdates === 'boolean' ? raw.autoUpdates : null,
        pending: (Object.keys(UPDATE_REQUESTS) as UpdateRequest[]).filter((key) => pendingFiles.includes(`${UPDATE_REQUESTS[key]}.json`)),
    };
}

export async function requestUpdate(kind: UpdateRequest): Promise<'ok' | 'unavailable' | 'nothing-to-install'> {
    const status = await updateStatus();
    if (!status.available) return 'unavailable';
    if (kind === 'install' && !status.updateAvailable) return 'nothing-to-install';
    const name = UPDATE_REQUESTS[kind];
    const dir = path.join(exchangeDir(), 'inbox');
    const tmp = path.join(dir, `.${name}.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(tmp, JSON.stringify({ kind: name, requestedAt: new Date().toISOString() }), { mode: 0o600 });
    await fs.rename(tmp, path.join(dir, `${name}.json`));
    return 'ok';
}
