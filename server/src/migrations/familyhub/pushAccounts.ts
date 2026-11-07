import type { Migration } from '../runner';

/**
 * v1.1 (security): a push subscription records the account that registered it,
 * not only the family it belongs to, so it can be removed when that account
 * leaves or is removed, and personal notifications reach only their addressee.
 * Rows from older releases keep a NULL account and are cleared on the next
 * membership change in their family (devices re-register on their next visit).
 * Additive and nullable: the previous release ignores the column (rollback safe).
 */
export const pushAccountMigrations: readonly Migration[] = [{
    id: 'familyhub/0011-push-subscription-account',
    statements: [
        'ALTER TABLE push_subscriptions ADD COLUMN account_id UUID REFERENCES users(id) ON DELETE CASCADE',
        'CREATE INDEX idx_push_subscriptions_account ON push_subscriptions(account_id)',
    ],
}];
