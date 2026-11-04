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
