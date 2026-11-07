import { isIP } from 'node:net';
import dns from 'node:dns/promises';

/**
 * SSRF guard for user-supplied integration URLs (Home Assistant, Nextcloud, Immich…).
 *
 * OpenFamily is self-hosted: private LAN targets (Home Assistant on 192.168.x.x,
 * a NAS on 10.x…) are LEGITIMATE, so RFC1918 addresses are allowed by default.
 * What is ALWAYS blocked:
 *   - non-http(s) schemes
 *   - cloud metadata endpoints (AWS/Azure/GCP link-local 169.254.169.254,
 *     AWS IPv6 fd00:ec2::254, GCP metadata.google.internal, Alibaba 100.100.100.200)
 *     — checked on the literal host AND on the DNS-resolved addresses, so a
 *     domain pointing at the metadata service is rejected too.
 *
 * For hardened deployments, set INTEGRATIONS_BLOCK_PRIVATE_IPS=true to also block
 * loopback, RFC1918, link-local and unique-local targets.
 */

const METADATA_HOSTNAMES = new Set([
    'metadata.google.internal',
    'metadata.goog',
]);

// Always-blocked literal addresses (cloud metadata services)
const METADATA_IPV4 = new Set(['169.254.169.254', '100.100.100.200']);

/** Parses an IPv4 literal into a 32-bit number, or null. */
const parseIpv4 = (ip: string): number | null => {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let value = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const n = Number(part);
        if (n > 255) return null;
        value = value * 256 + n;
    }
    return value >>> 0;
};

/** Parses an IPv6 literal (zone index allowed, embedded IPv4 allowed) into 16 bytes, or null. */
const parseIpv6 = (input: string): number[] | null => {
    const ip = input.toLowerCase().split('%')[0];
    if (isIP(ip) !== 6) return null;
    let head = ip;
    const tailV4: number[] = [];
    const lastColon = head.lastIndexOf(':');
    if (head.slice(lastColon + 1).includes('.')) {
        const v4 = parseIpv4(head.slice(lastColon + 1));
        if (v4 === null) return null;
        tailV4.push((v4 >>> 24) & 255, (v4 >>> 16) & 255, (v4 >>> 8) & 255, v4 & 255);
        head = head.slice(0, lastColon + 1) + '0:0';
    }
    const [left, right] = head.includes('::') ? head.split('::') : [head, null];
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const missing = 8 - leftGroups.length - rightGroups.length;
    if (right === null ? leftGroups.length !== 8 : missing < 0) return null;
    const groups = [...leftGroups, ...Array(right === null ? 0 : missing).fill('0'), ...rightGroups];
    const bytes: number[] = [];
    for (const group of groups) {
        const n = parseInt(group || '0', 16);
        bytes.push((n >> 8) & 255, n & 255);
    }
    if (tailV4.length) bytes.splice(12, 4, ...tailV4);
    return bytes;
};

const inCidr4 = (ip: number, base: string, maskBits: number): boolean => {
    const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
    return ((ip & mask) >>> 0) === ((parseIpv4(base)! & mask) >>> 0);
};

const METADATA_IPV4_NUM = new Set([...METADATA_IPV4].map((ip) => parseIpv4(ip)!));

/** Why an IPv4 address (as a number) must not be fetched, or null. */
const blockedIpv4 = (ip: number, blockPrivate: boolean): string | null => {
    if (METADATA_IPV4_NUM.has(ip)) return 'cloud metadata address';
    // The AWS/GCP metadata service lives in 169.254.0.0/16: always block link-local v4.
    if (inCidr4(ip, '169.254.0.0', 16)) return 'link-local (metadata) address';
    if (inCidr4(ip, '0.0.0.0', 8)) return 'unspecified address';
    if (inCidr4(ip, '224.0.0.0', 4) || inCidr4(ip, '240.0.0.0', 4)) return 'multicast or reserved address';
    if (blockPrivate && (
        inCidr4(ip, '127.0.0.0', 8) || inCidr4(ip, '10.0.0.0', 8) || inCidr4(ip, '172.16.0.0', 12)
        || inCidr4(ip, '192.168.0.0', 16) || inCidr4(ip, '100.64.0.0', 10) || inCidr4(ip, '192.0.0.0', 24)
        || inCidr4(ip, '198.18.0.0', 15))) return 'private address';
    return null;
};

const startsWith = (bytes: number[], prefix: number[]): boolean => prefix.every((b, i) => bytes[i] === b);

/**
 * Why an address must not be fetched, or null. IPv6 forms that carry an IPv4
 * address (mapped ::ffff:0:0/96, compatible ::/96, NAT64 64:ff9b::/96) are judged
 * by that IPv4 address, whatever notation the literal used.
 */
const isBlockedAddress = (address: string, blockPrivate: boolean): string | null => {
    const v4 = parseIpv4(address);
    if (v4 !== null) return blockedIpv4(v4, blockPrivate);
    const bytes = parseIpv6(address);
    if (!bytes) return 'unrecognised address';
    const embedded = (from: number) => ((bytes[from] << 24) | (bytes[from + 1] << 16) | (bytes[from + 2] << 8) | bytes[from + 3]) >>> 0;
    const zero10 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    if (startsWith(bytes, [...zero10, 0xff, 0xff])) return blockedIpv4(embedded(12), blockPrivate);
    if (startsWith(bytes, [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0])) return blockedIpv4(embedded(12), blockPrivate);
    const allZeroPrefix = startsWith(bytes, [...zero10, 0, 0]);
    if (allZeroPrefix) {
        const last = embedded(12);
        if (last === 0) return 'unspecified address';
        if (last === 1) return blockPrivate ? 'private address' : null; // ::1 loopback
        return blockedIpv4(last, blockPrivate); // deprecated IPv4-compatible form
    }
    if (bytes.join(',') === parseIpv6('fd00:ec2::254')!.join(',')) return 'cloud metadata address';
    if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return 'link-local (metadata) address';
    if (bytes[0] === 0xff) return 'multicast address';
    if (blockPrivate && ((bytes[0] & 0xfe) === 0xfc || (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0))) return 'private address';
    return null;
};

/** Exported for tests. */
export const blockedReasonForTests = isBlockedAddress;

export class UnsafeUrlError extends Error {}

export interface SafeUrlOptions {
    /**
     * Force-block loopback/RFC1918/link-local/unique-local targets regardless of
     * INTEGRATIONS_BLOCK_PRIVATE_IPS. Use this for routes that fetch the PUBLIC
     * internet (e.g. AI providers), where a private target is never legitimate.
     * When omitted, the env flag keeps deciding (integrations on a LAN).
     */
    blockPrivate?: boolean;
}

/**
 * Validates a user-supplied integration base URL. Throws UnsafeUrlError when the
 * URL must not be fetched. Call this both when an integration is saved AND right
 * before every test/sync request (the DNS answer can change between the two).
 */
export async function assertSafeIntegrationUrl(baseUrl: string, options: SafeUrlOptions = {}): Promise<void> {
    let url: URL;
    try {
        url = new URL(baseUrl);
    } catch {
        throw new UnsafeUrlError('URL invalide');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new UnsafeUrlError('Seuls les protocoles http et https sont autorisés');
    }

    const blockPrivate = options.blockPrivate ?? (process.env.INTEGRATIONS_BLOCK_PRIVATE_IPS === 'true');
    // URL.hostname keeps brackets around IPv6 literals — strip them.
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();

    if (METADATA_HOSTNAMES.has(hostname)) {
        throw new UnsafeUrlError('Cette adresse est bloquée (service de métadonnées cloud)');
    }

    if (isIP(hostname)) {
        const reason = isBlockedAddress(hostname, blockPrivate);
        if (reason) throw new UnsafeUrlError(`Cette adresse est bloquée (${reason})`);
        return;
    }

    if (blockPrivate && hostname === 'localhost') {
        throw new UnsafeUrlError('Cette adresse est bloquée (private address)');
    }

    // Resolve the hostname and check every returned address, so a DNS name pointing
    // at a metadata endpoint is rejected too. If resolution fails we let the request
    // proceed — the subsequent fetch will fail with a clearer network error.
    let addresses: { address: string }[] = [];
    try {
        addresses = await dns.lookup(hostname, { all: true });
    } catch {
        // Fail closed: an address that cannot be checked is not fetched.
        throw new UnsafeUrlError('Adresse introuvable');
    }

    for (const { address } of addresses) {
        const reason = isBlockedAddress(address, blockPrivate);
        if (reason) {
            throw new UnsafeUrlError(`Cette adresse est bloquée (${reason})`);
        }
    }
}

/**
 * A net/tls `lookup` that resolves once, rejects any blocked address and hands
 * the vetted address to the socket, so DNS cannot answer differently between the
 * check and the connection (rebinding).
 */
export const guardedLookup = (blockPrivate: boolean) => (
    hostname: string,
    options: { all?: boolean; family?: number } | number | undefined,
    callback: (err: NodeJS.ErrnoException | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void,
): void => {
    const opts = typeof options === 'object' && options ? options : {};
    dns.lookup(hostname, { all: true, ...(opts.family ? { family: opts.family } : {}) })
        .then((addresses) => {
            if (addresses.length === 0) throw new UnsafeUrlError('Adresse introuvable');
            for (const { address } of addresses) {
                const reason = isBlockedAddress(address, blockPrivate);
                if (reason) throw new UnsafeUrlError(`Cette adresse est bloquée (${reason})`);
            }
            if (opts.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
        })
        .catch((error: NodeJS.ErrnoException) => callback(error));
};

/** The effective private-address policy for a request. */
export const blockPrivateFor = (options: SafeUrlOptions = {}): boolean =>
    options.blockPrivate ?? (process.env.INTEGRATIONS_BLOCK_PRIVATE_IPS === 'true');
