import type { Migration } from '../runner';

/**
 * v1.2 dashboard: per-family settings for the quick bar and the richer detail
 * panels (weather options, Formula 1 standings, guest Wi-Fi, countdown, markets,
 * photo slideshow), and the photos uploaded for the frame's slideshow.
 *
 * Secrets (the guest Wi-Fi password, market data API keys) are stored encrypted
 * in encrypted_secrets and never returned by any read endpoint except the Wi-Fi
 * password, which the display shows by design when the Wi-Fi card is on.
 * New tables only: the previous release ignores them (rollback safe).
 */
export const dashboardExtrasMigrations: readonly Migration[] = [{
    id: 'familyhub/0012-dashboard-extras',
    statements: [
        `CREATE TABLE familyhub_dashboard_extras (
            family_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            settings JSONB NOT NULL DEFAULT '{}'::jsonb,
            encrypted_secrets TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE familyhub_photos (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            family_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            bytes INTEGER NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        'CREATE INDEX idx_familyhub_photos_family ON familyhub_photos(family_id, created_at)',
    ],
}];
