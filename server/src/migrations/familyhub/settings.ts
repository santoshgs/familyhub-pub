import type { Migration } from '../runner';
export const googleSettingsMigrations: readonly Migration[] = [{
    id: 'familyhub/0003-google-snapshots', statements: [
        `CREATE TABLE familyhub_google_settings (
            family_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            calendar_id TEXT NOT NULL, task_list_id TEXT NOT NULL, time_zone TEXT NOT NULL)`,
        `CREATE TABLE familyhub_google_snapshots (
            family_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK(kind IN ('calendar','tasks','daycare')),
            payload JSONB NOT NULL DEFAULT '[]', fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(family_id,kind))`,
    ],
}, {
    id: 'familyhub/0004-google-cache-revision', statements: [
        'ALTER TABLE familyhub_google_connections ADD COLUMN cache_revision BIGINT NOT NULL DEFAULT 0',
    ],
}];
