import type { Migration } from '../runner';

/**
 * v2.0.1: how new Google Calendar events are made. `event_minutes` is the
 * length given to an event created without an end (the AI assistant, outside
 * apps); `reminder_mode` is 'google' (the calendar's own default notification,
 * falling back to the account's main calendar), 'custom' (one notification
 * `reminder_minutes` before) or 'none'. Additive only: an app rollback to
 * v2.0.0 ignores the columns.
 */
export const calendarDefaultsMigrations: readonly Migration[] = [{
    id: 'familyhub/0021-calendar-event-defaults',
    statements: [
        'ALTER TABLE familyhub_google_settings ADD COLUMN IF NOT EXISTS event_minutes INTEGER NOT NULL DEFAULT 60 CHECK (event_minutes BETWEEN 5 AND 1440)',
        "ALTER TABLE familyhub_google_settings ADD COLUMN IF NOT EXISTS reminder_mode TEXT NOT NULL DEFAULT 'google' CHECK (reminder_mode IN ('google','custom','none'))",
        'ALTER TABLE familyhub_google_settings ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER NOT NULL DEFAULT 15 CHECK (reminder_minutes BETWEEN 0 AND 40320)',
    ],
}];
