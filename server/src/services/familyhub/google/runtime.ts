import { query, withTransaction, type QueryFn } from '../../../db';
import cron from 'node-cron';
import { GoogleAdapters, GoogleApiError } from './adapters';
import { googleStatus, getGoogleAccessToken } from './connection';

export interface Selection { calendarId: string; taskListId: string; timeZone: string }
export type SourceState = { state: 'fresh' | 'stale' | 'error' | 'unconfigured' | 'disconnected'; lastSuccess?: string; message?: string };
export const googleApi = (familyId: string) => new GoogleAdapters(() => getGoogleAccessToken(familyId));
export const selection = async (familyId: string): Promise<Selection | null> => {
    const result = await query('SELECT calendar_id, task_list_id, time_zone FROM familyhub_google_settings WHERE family_id = $1', [familyId]);
    const row = result.rows[0];
    return row ? { calendarId: row.calendar_id, taskListId: row.task_list_id, timeZone: row.time_zone } : null;
};
async function invalidateWith(q: QueryFn, familyId: string, kind?: string): Promise<void> {
    // The row lock also orders invalidation against an in-flight cache commit.
    await q('UPDATE familyhub_google_connections SET cache_revision = cache_revision + 1 WHERE family_id = $1', [familyId]);
    await q('DELETE FROM familyhub_google_snapshots WHERE family_id = $1 AND ($2::text IS NULL OR kind = $2)', [familyId, kind ?? null]);
}
export const invalidate = (familyId: string, kind?: string): Promise<void> => withTransaction(({ query: q }) => invalidateWith(q, familyId, kind));
export async function configureSources(familyId: string, input: Selection): Promise<void> {
    if (!input || typeof input.calendarId !== 'string' || typeof input.taskListId !== 'string' || typeof input.timeZone !== 'string') throw new Error('Choose a calendar, task list, and timezone.');
    new Intl.DateTimeFormat('en', { timeZone: input.timeZone });
    const api = googleApi(familyId);
    const [calendars, lists] = await Promise.all([api.calendarLists(), api.taskLists()]);
    if (!calendars.some((calendar) => calendar.id === input.calendarId && ['owner', 'writer'].includes(calendar.accessRole))) throw new Error('Choose a calendar this account can edit.');
    if (!lists.some((list) => list.id === input.taskListId)) throw new Error('Choose a task list belonging to the connected account.');
    await withTransaction(async ({ query: q }) => {
        await q('SELECT id FROM users WHERE id=$1 FOR UPDATE', [familyId]);
        await invalidateWith(q, familyId);
        await q(`INSERT INTO familyhub_google_settings (family_id, calendar_id, task_list_id, time_zone)
        VALUES ($1,$2,$3,$4) ON CONFLICT (family_id) DO UPDATE SET calendar_id=$2, task_list_id=$3, time_zone=$4`,
        [familyId, input.calendarId, input.taskListId, input.timeZone]);
    });
}
const pending = new Map<string, Promise<GoogleSnapshot>>();
export interface GoogleSnapshot { events: unknown[]; tasks: unknown[]; daycare: unknown[]; sources: Record<string, SourceState>; connected: boolean; timeZone: string }
export function syncGoogle(familyId: string): Promise<GoogleSnapshot> {
    const current = pending.get(familyId);
    if (current) return current;
    const work = readSources(familyId).finally(() => { pending.delete(familyId); });
    pending.set(familyId, work); return work;
}
const revision = async (familyId: string) => (await query('SELECT cache_revision FROM familyhub_google_connections WHERE family_id=$1', [familyId])).rows[0]?.cache_revision;
async function readSources(familyId: string, attempt = 0): Promise<GoogleSnapshot> {
    const version = await revision(familyId);
    const status = await googleStatus(familyId);
    const config = await selection(familyId);
    const sources: Record<string, SourceState> = {};
    const result: GoogleSnapshot = { events: [], tasks: [], daycare: [], sources, connected: status.connected, timeZone: config?.timeZone ?? 'America/New_York' };
    if (!status.connected) {
        for (const kind of ['calendar', 'tasks', 'daycare']) sources[kind] = { state: 'disconnected', message: 'Connect the family Google account.' };
        return result;
    }
    const api = googleApi(familyId);
    const loaders: Record<string, () => Promise<unknown[]>> = {
        calendar: () => { const now = new Date(); return api.calendar(config!.calendarId, now.toISOString(), new Date(now.getTime() + 7 * 86400000).toISOString(), config!.timeZone); },
        tasks: () => api.tasks(config!.taskListId), daycare: () => api.daycare(),
    };
    await Promise.all(Object.keys(loaders).map(async (kind) => {
        if ((kind !== 'daycare' && !config) || (kind === 'daycare' && !status.gmail)) {
            sources[kind] = { state: 'unconfigured', message: kind === 'daycare' ? 'Authorize Gmail to read daycare notifications.' : 'Choose your shared calendar and task list.' }; return;
        }
        const cached = (await query('SELECT payload, fetched_at FROM familyhub_google_snapshots WHERE family_id=$1 AND kind=$2', [familyId, kind])).rows[0];
        const ttl = kind === 'daycare' ? 300000 : 60000;
        let items: unknown[] = cached?.payload ?? [];
        if (cached && Date.now() - new Date(cached.fetched_at).getTime() < ttl) sources[kind] = { state: 'fresh', lastSuccess: new Date(cached.fetched_at).toISOString() };
        else try {
            items = await loaders[kind]();
            await withTransaction(async ({ query: q }) => {
                // Keep the same user → connection lock order as OAuth and
                // source changes, including the snapshot's user foreign key.
                await q('SELECT id FROM users WHERE id=$1 FOR KEY SHARE', [familyId]);
                const current = (await q('SELECT cache_revision FROM familyhub_google_connections WHERE family_id=$1 FOR SHARE', [familyId])).rows[0];
                if (!current || String(current.cache_revision) !== String(version)) return;
                await q(`INSERT INTO familyhub_google_snapshots (family_id,kind,payload,fetched_at) VALUES ($1,$2,$3,now())
                    ON CONFLICT (family_id,kind) DO UPDATE SET payload=$3,fetched_at=now()`, [familyId, kind, JSON.stringify(items)]);
            });
            sources[kind] = { state: 'fresh', lastSuccess: new Date().toISOString() };
        } catch (error) {
            sources[kind] = { state: cached ? 'stale' : 'error', ...(cached ? { lastSuccess: new Date(cached.fetched_at).toISOString() } : {}),
                message: error instanceof GoogleApiError && error.status === 429 ? 'Google rate limit reached. Retrying later.' : 'Google data is unavailable. Check the connection or reconnect.' };
        }
        if (kind === 'calendar') result.events = items;
        else if (kind === 'tasks') result.tasks = items;
        else result.daycare = items;
    }));
    if (String(await revision(familyId)) !== String(version)) {
        if (attempt < 2) return readSources(familyId, attempt + 1);
        // A rapidly changing connection never returns a misleading fresh view.
        for (const kind of Object.keys(loaders)) sources[kind] = { state: 'error', message: 'The connection changed during refresh. Refresh again.' };
        return { ...result, events: [], tasks: [], daycare: [] };
    }
    return result;
}
let started = false;
export function startFamilyHubSyncScheduler(): void {
    if (started) return; started = true;
    cron.schedule('* * * * *', () => {
        void query('SELECT family_id FROM familyhub_google_connections').then(async ({ rows }) => {
            for (const row of rows) await syncGoogle(row.family_id).catch(() => undefined);
        }).catch(() => undefined);
    });
}
