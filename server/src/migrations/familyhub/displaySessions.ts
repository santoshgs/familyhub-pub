import type { Migration } from '../runner';

// Each paired frame (or browser started in protected display mode) gets its own
// revocable session. Night dimming is a household display setting chosen by a
// parent in Management and applied by the read-only display.
export const displaySessionMigrations: readonly Migration[] = [{
    id: 'familyhub/0008-display-sessions-and-night-dimming',
    statements: [
        `CREATE TABLE familyhub_display_sessions (
            id UUID PRIMARY KEY,
            family_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            revoked_at TIMESTAMPTZ
        )`,
        'CREATE INDEX familyhub_display_sessions_family_idx ON familyhub_display_sessions (family_id) WHERE revoked_at IS NULL',
        `ALTER TABLE familyhub_display_pairing_codes ADD COLUMN display_name TEXT NOT NULL DEFAULT 'Photo frame'
            CHECK (char_length(display_name) BETWEEN 1 AND 40)`,
        'ALTER TABLE familyhub_ambient_settings ADD COLUMN night_enabled BOOLEAN NOT NULL DEFAULT false',
        `ALTER TABLE familyhub_ambient_settings ADD COLUMN night_start TEXT NOT NULL DEFAULT '22:00' CHECK (night_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')`,
        `ALTER TABLE familyhub_ambient_settings ADD COLUMN night_end TEXT NOT NULL DEFAULT '07:00' CHECK (night_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')`,
        'ALTER TABLE familyhub_ambient_settings ADD COLUMN night_brightness SMALLINT NOT NULL DEFAULT 15 CHECK (night_brightness BETWEEN 0 AND 80)',
    ],
}];
