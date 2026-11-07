import type { Migration } from '../runner';

/** v1.5.2: each account's own order for the management menu (NULL = default order). */
export const navOrderMigrations: readonly Migration[] = [{
    id: 'familyhub/0017-nav-order',
    statements: ['ALTER TABLE users ADD COLUMN IF NOT EXISTS familyhub_nav_order JSONB'],
}];
