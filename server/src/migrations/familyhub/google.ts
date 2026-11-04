import type { Migration } from '../runner';

export const googleMigrations: readonly Migration[] = [{
    id: 'familyhub/0002-google-connections',
    statements: [
        `CREATE TABLE familyhub_google_connections (
            family_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            subject TEXT NOT NULL,
            email TEXT NOT NULL,
            encrypted_tokens TEXT NOT NULL,
            scopes TEXT[] NOT NULL DEFAULT '{}',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE familyhub_google_flows (
            state_hash CHAR(64) PRIMARY KEY,
            family_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_version INTEGER NOT NULL,
            encrypted_flow TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL
        )`,
        'CREATE INDEX familyhub_google_flows_expiry ON familyhub_google_flows(expires_at)',
        'CREATE INDEX familyhub_google_flows_family ON familyhub_google_flows(family_id)',
    ],
}];
