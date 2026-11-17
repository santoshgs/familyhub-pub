import type { Migration } from '../runner';

/**
 * v2.2: Family Updates sources. Whether the Lillio sender is read and which
 * Gmail labels are shown, with their names and display choices. One row per
 * family; no row means the v2.1 behaviour (Lillio only). Additive only: an app
 * rollback to v2.1 ignores the table.
 */
export const familyUpdatesMigrations: readonly Migration[] = [{
    id: 'familyhub/0022-family-updates',
    statements: [
        `CREATE TABLE IF NOT EXISTS familyhub_family_update_settings (
            family_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            settings JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
    ],
}, {
    // v2.3: AI summaries and suggestions. One row per email the AI read (or
    // tried to), and the suggestions it made. The email text itself is never
    // stored here. Additive only: a rollback to v2.2 ignores both tables.
    id: 'familyhub/0023-family-updates-ai',
    statements: [
        `CREATE TABLE IF NOT EXISTS familyhub_mail_ai (
            family_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            message_id TEXT NOT NULL,
            source_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('done','failed')),
            summary TEXT CHECK (summary IS NULL OR length(summary) <= 400),
            model TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            error TEXT,
            next_attempt_at TIMESTAMPTZ,
            processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (family_id, message_id)
        )`,
        `CREATE TABLE IF NOT EXISTS familyhub_mail_suggestions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            family_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            message_id TEXT NOT NULL,
            source_id TEXT NOT NULL,
            source_name TEXT NOT NULL,
            email_title TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('event','task')),
            title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
            date DATE NOT NULL,
            start_time TIME,
            end_time TIME,
            location TEXT,
            notes TEXT,
            evidence TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepting','accepted','dismissed','expired')),
            google_id TEXT,
            decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
            decided_via TEXT CHECK (decided_via IS NULL OR decided_via IN ('app','agent')),
            decided_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (family_id, fingerprint)
        )`,
        `CREATE INDEX IF NOT EXISTS familyhub_mail_suggestions_pending ON familyhub_mail_suggestions (family_id, date) WHERE status = 'pending'`,
    ],
}];
