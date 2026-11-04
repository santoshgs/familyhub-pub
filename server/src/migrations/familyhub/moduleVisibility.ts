import type { Migration } from '../runner';

/**
 * Each member can hide modules from their own menu and overview without
 * switching them off for the household. Hiding is a view preference only: the
 * module's page and API keep working. Switching a module off for everyone stays
 * in familyhub_module_preferences (server-enforced).
 */
export const moduleVisibilityMigrations: readonly Migration[] = [{
    id: 'familyhub/0010-module-visibility',
    statements: [
        "ALTER TABLE familyhub_dashboard_preferences ADD COLUMN hidden_modules JSONB NOT NULL DEFAULT '[]'::jsonb",
    ],
}];
