import { loadEnv } from './loadEnv';
import { isMailEnabled } from '../lib/mailer';
import logger from '../lib/logger';

/**
 * How people may sign in and create accounts on this server, decided once from
 * the environment and read through getAuthConfig() everywhere else.
 *
 * Family Hub signs in with email and password only: single sign-on (OpenID
 * Connect) was removed in v1.4.2, so PASSWORD_LOGIN_ENABLED=false and the
 * OIDC_* settings are ignored and password sign-in can never be switched off.
 *
 *   REGISTRATION_ENABLED   creating an account with a password, without an invite
 *
 * Invitations bypass the sign-up switch, as they always have.
 */
export interface AuthConfig {
    passwordLogin: true;
    passwordSignup: boolean;
}

const flag = (value: string | undefined, fallback: boolean): boolean => {
    const normalized = value?.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return fallback;
};

const computeAuthConfig = (): AuthConfig => {
    loadEnv();
    if (flag(process.env.PASSWORD_LOGIN_ENABLED, true) === false) {
        logger.warn('auth.password_login_forced_on', { reason: 'PASSWORD_LOGIN_ENABLED=false ignored: Family Hub signs in with passwords only' });
    }
    if (['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'].some((name) => process.env[name]?.trim())) {
        logger.info('auth.oidc_ignored', { reason: 'single sign-on was removed in v1.4.2; the OIDC_* settings can be deleted' });
    }
    const config: AuthConfig = { passwordLogin: true, passwordSignup: flag(process.env.REGISTRATION_ENABLED, true) };
    // The logger masks any field whose name mentions a password, hence these names.
    logger.info('auth.config', { localLogin: true, localSignup: config.passwordSignup });
    return config;
};

let cached: AuthConfig | null = null;

export const getAuthConfig = (): AuthConfig => {
    if (!cached) cached = computeAuthConfig();
    return cached;
};

/** Password reset also needs outgoing mail; checked live like the mailer does. */
export const passwordResetEnabled = (): boolean => getAuthConfig().passwordLogin && isMailEnabled();

/** For tests that change the environment between cases. */
export const resetAuthConfigForTests = (): void => {
    cached = null;
};
