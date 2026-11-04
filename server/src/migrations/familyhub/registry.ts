import type { Migration } from '../runner';
import { googleMigrations } from './google';
import { googleSettingsMigrations } from './settings';
import { moduleMigrations } from './modules';
import { appearanceMigrations } from './appearance';
import { ambientMigrations } from './ambient';
import { displayPairingMigrations } from './displayPairing';
import { displaySessionMigrations } from './displaySessions';
import { v1CleanupMigrations } from './v1Cleanup';
import { moduleVisibilityMigrations } from './moduleVisibility';
export const familyHubMigrations: readonly Migration[] = [{
    id: 'familyhub/0001-notes',
    statements: [
        'ALTER TABLE family_notes ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false',
        'ALTER TABLE family_notes ADD COLUMN author_id UUID REFERENCES users(id) ON DELETE SET NULL',
    ],
}, ...googleMigrations, ...googleSettingsMigrations, ...moduleMigrations, ...appearanceMigrations, ...ambientMigrations, ...displayPairingMigrations, ...displaySessionMigrations, ...v1CleanupMigrations, ...moduleVisibilityMigrations];
