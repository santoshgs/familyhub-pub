import type { Migration } from '../runner';

export const ambientMigrations: readonly Migration[] = [{
    id: 'familyhub/0006-ambient-display',
    statements: [`CREATE TABLE familyhub_ambient_settings (
        family_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        weather_city TEXT,
        weather_country TEXT,
        weather_latitude DOUBLE PRECISION,
        weather_longitude DOUBLE PRECISION,
        enabled_widgets JSONB NOT NULL DEFAULT '["calendar","weather","tasks","chores","daycare","f1"]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK ((weather_latitude IS NULL AND weather_longitude IS NULL)
            OR (weather_latitude BETWEEN -90 AND 90 AND weather_longitude BETWEEN -180 AND 180))
    )`],
}];

/** v1.6: which modules are cards (ordered, at most six) and which are quick pills. NULL keeps the pre-v1.6 layout. */
export const ambientLayoutMigrations: readonly Migration[] = [{
    id: 'familyhub/0016-display-layout',
    statements: ['ALTER TABLE familyhub_ambient_settings ADD COLUMN IF NOT EXISTS layout JSONB'],
}];

/** v1.5.4: turn the display off (black, double tap to wake) at night, and a photo screensaver after the frame is left alone. */
export const ambientScreensaverMigrations: readonly Migration[] = [{
    id: 'familyhub/0018-screensaver-night-off',
    statements: [
        "ALTER TABLE familyhub_ambient_settings ADD COLUMN IF NOT EXISTS night_mode TEXT NOT NULL DEFAULT 'dim'",
        'ALTER TABLE familyhub_ambient_settings ADD COLUMN IF NOT EXISTS screensaver_enabled BOOLEAN NOT NULL DEFAULT false',
        'ALTER TABLE familyhub_ambient_settings ADD COLUMN IF NOT EXISTS screensaver_minutes INTEGER NOT NULL DEFAULT 10',
    ],
}];
