import { Request } from 'express';
import { stripTrailingSlashes } from './asyncRoutes';

/**
 * Public base URL of this OpenFamily instance, used to build links sent OUTSIDE
 * the application (family invitations, password-reset emails).
 *
 * Resolution order:
 *  - APP_PUBLIC_URL when set. Needed only when the server cannot see its own
 *    public name, e.g. behind a reverse proxy that rewrites the Host header;
 *  - otherwise the origin the current request was addressed to. For the web
 *    client that is the app's own origin, and for the mobile app it is the
 *    server URL the device was pointed at, which is exactly the address a
 *    recipient has to open.
 *
 * Returns '' when neither is available (no request context and no configuration).
 * Callers must treat an empty value as "cannot build a link" rather than falling
 * back to some other host: a wrong origin would send your family's invitees to
 * somebody else's server.
 */
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

const isTrustedHost = (host: string): boolean => {
    if (LOOPBACK_HOST.test(host)) return true;
    const origins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? [];
    return origins.some((origin) => {
        try {
            return new URL(origin).host.toLowerCase() === host.toLowerCase();
        } catch {
            return false;
        }
    });
};

export const resolveAppBaseUrl = (req?: Request): string => {
    const strip = (u: string) => stripTrailingSlashes(u.trim());

    const configured = process.env.APP_PUBLIC_URL?.trim();
    if (configured) {
        return strip(configured);
    }

    if (req) {
        // Without APP_PUBLIC_URL, the Host header is only trusted when it names
        // an origin this server is configured to serve (CORS_ORIGINS) or a
        // loopback development address. Any other value is chosen by the client
        // and would send reset or invite links, and their tokens, elsewhere.
        const host = req.get('host');
        if (host && isTrustedHost(host)) {
            return `${req.protocol}://${host}`;
        }
    }

    return '';
};
