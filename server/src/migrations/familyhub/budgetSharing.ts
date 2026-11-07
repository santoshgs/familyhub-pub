import type { Migration } from '../runner';

/**
 * v1.5: shared expenses and fixed budget categories.
 * - Who paid for an expense (paid_by), who it is split between (split_with,
 *   empty = the group's members or the family's default sharers) and which
 *   expense group it belongs to, on one-time and recurring transactions.
 * - Expense groups (a holiday, say), payments that settle up between members,
 *   and the family's default "split between" members.
 * - OpenFamily's default budget categories move to the new keys
 *   (lib/budgetCategories); budget is removed from the customisable lists.
 * Only additions and category renames: an app rollback to v1.4.x still starts
 * (it shows the new category keys as plain text).
 */
const LEGACY = `(VALUES ('Logement', 'rent'), ('Alimentation', 'groceries'), ('Transport', 'car'), ('Santé', 'medical'), ('Loisirs', 'active-arts'), ('Abonnements', 'television'), ('Assurance', 'insurance'), ('Enfants', 'childcare'), ('Maison', 'maintenance'), ('Autre', 'general')) AS legacy(old, new)`;

export const budgetSharingMigrations: readonly Migration[] = [{
    id: 'familyhub/0014-budget-sharing',
    statements: [
        `CREATE TABLE IF NOT EXISTS budget_groups (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(60) NOT NULL,
            members JSONB NOT NULL DEFAULT '[]'::jsonb,
            archived BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        'CREATE INDEX IF NOT EXISTS idx_budget_groups_user ON budget_groups(user_id)',
        `CREATE TABLE IF NOT EXISTS budget_settlements (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            group_id UUID REFERENCES budget_groups(id) ON DELETE CASCADE,
            from_member UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
            to_member UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
            amount DECIMAL(10, 2) NOT NULL CHECK (amount > 0),
            date DATE NOT NULL,
            note VARCHAR(200),
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CHECK (from_member <> to_member)
        )`,
        'CREATE INDEX IF NOT EXISTS idx_budget_settlements_user ON budget_settlements(user_id, date)',
        `CREATE TABLE IF NOT EXISTS budget_sharing_settings (
            user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            members JSONB NOT NULL DEFAULT '[]'::jsonb,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        'ALTER TABLE budget_entries ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES family_members(id) ON DELETE SET NULL',
        "ALTER TABLE budget_entries ADD COLUMN IF NOT EXISTS split_with JSONB NOT NULL DEFAULT '[]'::jsonb",
        'ALTER TABLE budget_entries ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES budget_groups(id) ON DELETE SET NULL',
        'ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES family_members(id) ON DELETE SET NULL',
        "ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS split_with JSONB NOT NULL DEFAULT '[]'::jsonb",
        'ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES budget_groups(id) ON DELETE SET NULL',
        'CREATE INDEX IF NOT EXISTS idx_budget_entries_group ON budget_entries(user_id, group_id)',
        `UPDATE budget_entries e SET category = legacy.new FROM ${LEGACY} WHERE e.category = legacy.old`,
        `UPDATE recurring_expenses r SET category = legacy.new FROM ${LEGACY} WHERE r.category = legacy.old`,
        // Each old key maps to a different new one, so limits cannot collide; the
        // NOT EXISTS keeps the statement safe if a limit already uses the new key.
        `UPDATE budget_limits l SET category = legacy.new FROM ${LEGACY}
            WHERE l.category = legacy.old AND NOT EXISTS (
                SELECT 1 FROM budget_limits b2 WHERE b2.user_id = l.user_id AND b2.category = legacy.new AND b2.month = l.month AND b2.year = l.year)`,
        // Budget is no longer a customisable list; a corrupt value is left alone.
        `DO $$
        DECLARE row RECORD;
        BEGIN
            FOR row IN SELECT id, custom_categories FROM users WHERE custom_categories IS NOT NULL AND custom_categories <> '' LOOP
                BEGIN
                    UPDATE users SET custom_categories = (row.custom_categories::jsonb - 'budget')::text WHERE id = row.id;
                EXCEPTION WHEN others THEN NULL;
                END;
            END LOOP;
        END $$`,
    ],
}, {
    // 0014 kept a legacy limit (for example "Logement") when the household had
    // already set the new key ("rent") for the same month. The new key wins;
    // the leftover would only show as an unknown category, so remove it.
    id: 'familyhub/0015-budget-limit-leftovers',
    statements: [
        `DELETE FROM budget_limits l USING ${LEGACY}
            WHERE l.category = legacy.old AND EXISTS (
                SELECT 1 FROM budget_limits b2 WHERE b2.user_id = l.user_id AND b2.category = legacy.new AND b2.month = l.month AND b2.year = l.year)`,
    ],
}];
