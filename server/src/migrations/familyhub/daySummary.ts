import type { Migration } from '../runner';

/**
 * v2.5: the day summary. One row per family and day, written by the
 * household's AI from today's events, to-dos and chores; and each member's
 * choice to start their home page with it. Additive only: a rollback to v2.4
 * ignores the table and the column.
 */
export const daySummaryMigrations: readonly Migration[] = [{
    id: 'familyhub/0024-day-summary',
    statements: [
        `CREATE TABLE IF NOT EXISTS familyhub_day_summary (
            family_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            day DATE NOT NULL,
            headline TEXT NOT NULL CHECK (length(headline) <= 80),
            body TEXT NOT NULL CHECK (length(body) <= 300),
            model TEXT NOT NULL,
            source_hash TEXT NOT NULL,
            generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (family_id, day)
        )`,
        'ALTER TABLE familyhub_dashboard_preferences ADD COLUMN IF NOT EXISTS show_day_summary BOOLEAN NOT NULL DEFAULT true',
    ],
}];
