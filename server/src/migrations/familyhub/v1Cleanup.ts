import type { Migration } from '../runner';

/**
 * Family Hub v1.0 removes OpenFamily modules the household never used: recipes,
 * meal planning, family posts, the kiosk and the Mealie, Tandoor and Grocy
 * integrations. Their data is deleted here, once. The Pi's updater takes a full
 * database dump before every upgrade, so this stays recoverable from that dump.
 *
 * db.ts stops recreating these tables once this id is recorded (see
 * REMOVED_TABLES there). On a brand-new database they are still created first,
 * because the shipped migration core/0006 updates recipes, then dropped here.
 */
export const REMOVED_TABLES_MIGRATION_ID = 'familyhub/0009-v1-remove-openfamily-modules';

export const v1CleanupMigrations: readonly Migration[] = [{
    id: REMOVED_TABLES_MIGRATION_ID,
    statements: [
        'DROP TABLE IF EXISTS family_post_seen',
        'DROP TABLE IF EXISTS family_posts',
        'DROP TABLE IF EXISTS meal_plans',
        'DROP TABLE IF EXISTS recipes',
        "DELETE FROM integrations WHERE type IN ('mealie', 'tandoor', 'grocy')",
        // Interface languages are now English and French; new accounts start in English.
        "UPDATE users SET language = 'en' WHERE language NOT IN ('en', 'fr')",
        "ALTER TABLE users ALTER COLUMN language SET DEFAULT 'en'",
        // Removed module keys no longer mean anything in the saved choices.
        `UPDATE familyhub_module_preferences
         SET disabled_modules = COALESCE((
             SELECT jsonb_agg(key) FROM jsonb_array_elements_text(disabled_modules) AS key
             WHERE key NOT IN ('posts', 'meals', 'recipes', 'kiosk')
         ), '[]'::jsonb)`,
    ],
}];
