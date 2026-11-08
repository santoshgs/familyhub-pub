import type { Migration } from '../runner';

/**
 * v1.6: shopping on Google Tasks. The household picks which of the connected
 * account's task lists are shopping lists (Costco, groceries…), in order. The
 * items themselves live in Google; this row only records the choice and when
 * the old local list was copied across (the local rows are kept).
 * Additive only: an app rollback to v1.5.x ignores the table.
 */
export const shoppingListMigrations: readonly Migration[] = [{
    id: 'familyhub/0019-shopping-lists',
    statements: [
        `CREATE TABLE IF NOT EXISTS familyhub_shopping_settings (
            family_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            list_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            migrated_at TIMESTAMPTZ,
            migrated_count INTEGER,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
    ],
}];
