import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, requireParent, AuthRequest } from '../middleware/auth';
import { encryptCredentials, decryptCredentials } from '../utils/crypto';
import { assertSafeIntegrationUrl, UnsafeUrlError } from '../utils/urlGuard';
import { testHomeAssistantConnection, syncHomeAssistant } from '../services/integrations/homeassistant';
import { testNextcloudConnection, syncNextcloud } from '../services/integrations/nextcloud';
import { testImmichConnection, syncImmich, fetchImmichRandomPhoto } from '../services/integrations/immich';
import { broadcast } from '../lib/broadcaster';
import { requireModule } from '../lib/modules';

const router = Router();
router.use(authMiddleware);
router.use(requireModule('integrations'));

// Family Hub keeps the integrations it may build on; the recipe and pantry
// services (Mealie, Tandoor, Grocy) were removed in v1.0.
export const SUPPORTED_INTEGRATIONS = ['homeassistant', 'nextcloud', 'immich'] as const;
const isSupportedIntegration = (type: unknown): boolean =>
    typeof type === 'string' && (SUPPORTED_INTEGRATIONS as readonly string[]).includes(type);

// GET /api/integrations
router.get('/', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            `SELECT id, type, display_name, base_url, config, status, last_synced_at, last_error, created_at
             FROM integrations WHERE family_id = $1 ORDER BY type`,
            [req.userId]
        );
        res.json({ success: true, data: result.rows });
    } catch {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/integrations/immich/photo - proxy a random photo from the family's
// Immich instance (the Immich API key never reaches the browser).
router.get('/immich/photo', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            `SELECT base_url, encrypted_credentials FROM integrations
             WHERE family_id = $1 AND type = 'immich'`,
            [req.userId]
        );
        const integ = result.rows[0] as { base_url: string; encrypted_credentials: string | null } | undefined;
        if (!integ || !integ.encrypted_credentials) {
            return res.status(404).json({ success: false, error: 'Aucune integration Immich configuree' });
        }

        // Re-validate the stored URL at use time (DNS answers can change).
        await assertSafeIntegrationUrl(integ.base_url);

        const photo = await fetchImmichRandomPhoto(integ.base_url, integ.encrypted_credentials);
        res.set('Content-Type', photo.contentType);
        res.set('Cache-Control', 'no-store');
        res.send(photo.buffer);
    } catch (e) {
        if (e instanceof UnsafeUrlError) {
            return res.status(400).json({ success: false, error: e.message });
        }
        res.status(502).json({ success: false, error: 'Immich indisponible' });
    }
});

// Request fields used as text. A non-string value (array, object, number) would
// otherwise throw outside the handlers' try blocks and, under Express 4, surface
// as an unhandled rejection that can take the server down.
const INTEGRATION_TEXT_FIELDS = ['type', 'base_url', 'display_name', 'apiKey', 'token', 'username', 'password', 'ha_entity_id'] as const;
type IntegrationTextFields = Partial<Record<typeof INTEGRATION_TEXT_FIELDS[number], string>>;

export const readIntegrationTextFields = (body: unknown): IntegrationTextFields | null => {
    const source = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
    const fields: IntegrationTextFields = {};
    for (const key of INTEGRATION_TEXT_FIELDS) {
        const value = source[key];
        if (value === undefined || value === null) continue;
        if (typeof value !== 'string') return null;
        fields[key] = value;
    }
    return fields;
};

// POST /api/integrations/test - test without saving
router.post('/test', requireParent, async (req: AuthRequest, res) => {
    const fields = readIntegrationTextFields(req.body);
    if (!fields) return res.status(400).json({ success: false, message: 'Invalid request' });
    const { type, base_url, ha_entity_id } = fields;
    const apiKey = fields.apiKey ?? '', token = fields.token ?? '', username = fields.username ?? '', password = fields.password ?? '';
    const cleanUrl = (base_url || '').replace(/\/$/, '');

    try {
        await assertSafeIntegrationUrl(cleanUrl);

        let result: { success: boolean; message: string };
        switch (type) {
            case 'homeassistant': result = await testHomeAssistantConnection(cleanUrl, token, ha_entity_id); break;
            case 'nextcloud':     result = await testNextcloudConnection(cleanUrl, username, password); break;
            case 'immich':        result = await testImmichConnection(cleanUrl, apiKey); break;
            default:              result = { success: false, message: "Type d'integration inconnu" };
        }
        res.json(result);
    } catch (e) {
        res.json({ success: false, message: e instanceof Error ? e.message : 'Erreur inconnue' });
    }
});

// POST /api/integrations - connect
const originOf = (value: string): string => {
    try { return new URL(value).origin; } catch { return ''; }
};

router.post('/', requireParent, async (req: AuthRequest, res) => {
    const fields = readIntegrationTextFields(req.body);
    const configFromBody = (req.body as { config?: unknown } | undefined)?.config;
    if (!fields || (configFromBody != null && (typeof configFromBody !== 'object' || Array.isArray(configFromBody)))) {
        return res.status(400).json({ success: false, error: 'Invalid request' });
    }
    const { type, base_url, display_name, apiKey, token, username, password, ha_entity_id } = fields;

    if (!type || !base_url) {
        return res.status(400).json({ success: false, error: 'type et base_url sont requis' });
    }
    if (!isSupportedIntegration(type)) {
        return res.status(400).json({ success: false, error: 'Unsupported integration type' });
    }

    const credentials: Record<string, string> = {};
    if (apiKey) credentials.apiKey = apiKey;
    if (token) credentials.token = token;
    if (username) credentials.username = username;
    if (password) credentials.password = password;

    // Merge any integration-specific config fields
    const extraConfig: Record<string, string> = {};
    if (ha_entity_id) extraConfig.ha_entity_id = ha_entity_id;
    const config = Object.keys(extraConfig).length > 0 ? { ...(configFromBody || {}), ...extraConfig } : (configFromBody || {});

    const cleanUrl = base_url.replace(/\/$/, '');

    // Validate the URL at save time (it is validated again at every use).
    try {
        await assertSafeIntegrationUrl(cleanUrl);
    } catch (e) {
        return res.status(400).json({ success: false, error: e instanceof UnsafeUrlError ? e.message : 'URL invalide' });
    }

    const encrypted = Object.keys(credentials).length > 0 ? encryptCredentials(credentials) : null;

    // Saved credentials stay with the address they were entered for: a new
    // server address needs them entered again, so they are never sent elsewhere.
    if (!encrypted) {
        const existing = await query('SELECT base_url, encrypted_credentials FROM integrations WHERE family_id = $1 AND type = $2', [req.userId, type]);
        const saved = existing.rows[0] as { base_url: string; encrypted_credentials: string | null } | undefined;
        if (saved?.encrypted_credentials && originOf(saved.base_url) !== originOf(cleanUrl)) {
            return res.status(400).json({ success: false, error: 'CREDENTIALS_REQUIRED' });
        }
    }

    try {
        const result = await query(
            `INSERT INTO integrations (family_id, type, display_name, base_url, encrypted_credentials, config, status)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'connected')
             ON CONFLICT (family_id, type) DO UPDATE SET
               display_name = EXCLUDED.display_name,
               base_url = EXCLUDED.base_url,
               encrypted_credentials = COALESCE(EXCLUDED.encrypted_credentials, integrations.encrypted_credentials),
               config = EXCLUDED.config,
               status = 'connected',
               last_error = NULL,
               updated_at = NOW()
             RETURNING id, type, display_name, base_url, config, status, last_synced_at, created_at`,
            [req.userId, type, display_name || type, cleanUrl, encrypted, JSON.stringify(config || {})]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/integrations/:id/sync
router.post('/:id/sync', requireParent, async (req: AuthRequest, res) => {
    try {
        const integResult = await query(
            'SELECT * FROM integrations WHERE id = $1 AND family_id = $2',
            [req.params.id, req.userId]
        );
        if (integResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Integration introuvable' });
        }

        const integ = integResult.rows[0] as {
            id: string; type: string; base_url: string;
            encrypted_credentials: string; config: Record<string, unknown>;
        };

        await query("UPDATE integrations SET status = 'syncing', updated_at = NOW() WHERE id = $1", [integ.id]);

        try {
            // Re-validate the stored URL at use time (DNS answers can change).
            await assertSafeIntegrationUrl(integ.base_url);

            let syncResult: { imported: number; errors: number };

            switch (integ.type) {
                case 'homeassistant': syncResult = await syncHomeAssistant(integ.id, req.userId!, integ.base_url, integ.encrypted_credentials, integ.config || {}); break;
                case 'nextcloud':     syncResult = await syncNextcloud(integ.id, req.userId!, integ.base_url, integ.encrypted_credentials, integ.config || {}); break;
                case 'immich':        syncResult = await syncImmich(integ.id, req.userId!, integ.base_url, integ.encrypted_credentials); break;
                default: throw new Error('Type inconnu');
            }

            await query(
                "UPDATE integrations SET status = 'connected', last_synced_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $1",
                [integ.id]
            );

            broadcast(req.userId!, { type: 'update', entity: 'integrations', action: 'synced' });
            res.json({ success: true, data: syncResult });
        } catch (syncError) {
            const msg = syncError instanceof Error ? syncError.message : 'Sync error';
            await query("UPDATE integrations SET status = 'error', last_error = $2, updated_at = NOW() WHERE id = $1", [integ.id, msg]);
            res.status(500).json({ success: false, error: msg });
        }
    } catch {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /api/integrations/:id
router.delete('/:id', requireParent, async (req: AuthRequest, res) => {
    try {
        const result = await query(
            'DELETE FROM integrations WHERE id = $1 AND family_id = $2 RETURNING id',
            [req.params.id, req.userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Integration introuvable' });
        }
        res.json({ success: true });
    } catch {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
