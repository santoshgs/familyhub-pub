import type { Migration } from '../runner';

/**
 * v1.4.2: single sign-on (OpenID Connect) is removed; Family Hub signs in with
 * email and password only. The links between accounts and identity-provider
 * subjects, and any sign-in still in progress, are deleted. The tables stay, so
 * an app rollback to v1.4.0 still starts (its accounts are simply unlinked).
 * Accounts are untouched: one without a password gets one with
 * `authAdmin set-password`.
 */
export const removeSsoMigrations: readonly Migration[] = [{
    id: 'familyhub/0013-remove-sso-links',
    statements: [
        'DELETE FROM user_identities',
        'DELETE FROM oidc_flows',
    ],
}];
