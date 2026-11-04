import type { Migration } from '../runner';

export const displayPairingMigrations: readonly Migration[] = [{
    id: 'familyhub/0007-display-pairing',
    statements: [`CREATE TABLE familyhub_display_pairing_codes (
        code_hash CHAR(64) PRIMARY KEY,
        family_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`, 'CREATE INDEX familyhub_display_pairing_expiry_idx ON familyhub_display_pairing_codes (expires_at)'],
}];
