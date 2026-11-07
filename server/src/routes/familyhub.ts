import express, { Router, type Response } from 'express';
import { createHash, randomInt, randomUUID } from 'crypto';
import rateLimit from 'express-rate-limit';
import { query, withTransaction } from '../db';
import logger from '../lib/logger';
import { listFamilyNotes } from './notes';
import { authMiddleware, requireParent, type AuthRequest } from '../middleware/auth';
import { issueAccessToken } from '../lib/authTokens';
import { googleStatus, startGoogleConnection, finishGoogleConnection, disconnectGoogle, GoogleConnectionError } from '../services/familyhub/google/connection';
import { googleApi, selection, configureSources, syncGoogle, invalidate } from '../services/familyhub/google/runtime';
import { GoogleApiError } from '../services/familyhub/google/adapters';
import { loadAmbientSnapshot, readAmbientSettings, saveAmbientSettings, searchWeatherLocations } from '../services/familyhub/ambient';
import { getNewsArticle, previewFeed } from '../services/familyhub/news';
import { ExtrasValidationError, feedUrl, publicView, readExtras, saveExtras } from '../services/familyhub/extras/settings';
import { clearMarketCache } from '../services/familyhub/extras/markets';
import { addPhoto, deletePhoto, listPhotos, MAX_PHOTOS, MAX_UPLOAD_BYTES, PhotoError, readPhoto } from '../services/familyhub/extras/photos';
import { credentialStatus, requestCheck, submitCredential } from '../services/familyhub/adminCredentials';
import { requestUpdate, updateStatus, type UpdateRequest } from '../services/familyhub/adminUpdates';
import { cleanModuleList, getDisabledModules, isModuleKey, requireModule, saveDisabledModules } from '../lib/modules';
const router = Router();
const CARDS = ['calendar', 'tasks', 'notes', 'daycare', 'classroom'];
const fail = (res: Response, error: unknown) => {
    // A lapsed Google grant is not a lapsed Family Hub session: answering 401 made
    // the app sign the person out. It is a 409 the Home page offers to reconnect.
    if (error instanceof GoogleConnectionError) return res.status(error.status === 401 ? 409 : error.status).json({ success: false, error: error.message, ...(error.status === 401 ? { code: 'GOOGLE_RECONNECT' } : {}) });
    if (error instanceof GoogleApiError) return res.status(error.status === 401 ? 409 : 502).json({ success: false, error: error.message, ...(error.status === 401 ? { code: 'GOOGLE_RECONNECT' } : {}) });
    return res.status(400).json({ success: false, error: 'This change could not be completed. Check the fields and Google connection.' });
};

const hashPairingCode = (code: string) => createHash('sha256').update(code).digest('hex');
// Every LAN request reaches Express through the host Caddy and the client
// container, so the caller address is the same for all of them. Count only
// failed redemptions, household-wide: typos cannot lock pairing quickly, and
// 20 guesses per 15 minutes against a 5-minute, 8-digit code is negligible.
const displayPairingLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 20, skipSuccessfulRequests: true,
    keyGenerator: () => 'familyhub-display-pairing', standardHeaders: true, legacyHeaders: false,
    message: { success: false, error: 'Too many incorrect pairing codes. Wait 15 minutes and try again.' },
});
const displayName = (value: unknown, fallback: string) => {
    const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    return name || fallback;
};
const createDisplaySession = async (familyId: string, userId: string, name: string, createdBy: string | null) => {
    const id = randomUUID();
    await query(`INSERT INTO familyhub_display_sessions (id,family_id,user_id,name,created_by) VALUES ($1,$2,$3,$4,$5)`,
        [id, familyId, userId, name, createdBy]);
    return id;
};

// LAN-exposed pairing redemption: a short-lived, one-use code grants only an
// ambient read-only session. Parent authentication is required to create codes.
router.post('/display/pair', displayPairingLimiter, async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\s/g, '') : '';
    if (!/^\d{8}$/.test(code)) return res.status(400).json({ success: false, error: 'Enter the 8-digit pairing code.' });
    try {
        const token = await withTransaction(async ({ query: q }) => {
            const consumed = await q(`UPDATE familyhub_display_pairing_codes SET consumed_at=now()
                WHERE code_hash=$1 AND consumed_at IS NULL AND expires_at>now()
                RETURNING family_id, created_by, display_name`, [hashPairingCode(code)]);
            const row = consumed.rows[0] as { family_id: string; created_by: string; display_name: string } | undefined;
            if (!row) return null;
            const user = await q('SELECT id,family_owner_id,token_version FROM users WHERE id=$1', [row.family_id]);
            if (!user.rows[0]) return null;
            const id = randomUUID();
            await q(`INSERT INTO familyhub_display_sessions (id,family_id,user_id,name,created_by) VALUES ($1,$2,$2,$3,$4)`,
                [id, row.family_id, row.display_name, row.created_by]);
            return issueAccessToken(user.rows[0], 'ambient', id);
        });
        if (!token) return res.status(401).json({ success: false, error: 'That pairing code is invalid or expired.' });
        res.json({ success: true, data: { token } });
    } catch { res.status(503).json({ success: false, error: 'Pairing is temporarily unavailable.' }); }
});

router.get('/google/callback', async (req, res) => {
    try {
        const callback = new URL(process.env.GOOGLE_REDIRECT_URI || 'http://127.0.0.1:53001/api/familyhub/google/callback');
        callback.search = new URL(req.originalUrl, 'http://localhost').search;
        await finishGoogleConnection(callback.href);
        res.redirect(`${process.env.FAMILYHUB_APP_URL || '/'}?google=connected`);
    } catch { res.redirect(`${process.env.FAMILYHUB_APP_URL || '/'}?google=connection-failed`); }
});
router.use(authMiddleware);
router.post('/display/pairing-code', requireParent, async (req: AuthRequest, res) => {
    try {
        const code = String(randomInt(10_000_000, 100_000_000));
        const name = displayName(req.body?.name, 'Photo frame');
        await query("DELETE FROM familyhub_display_pairing_codes WHERE (family_id=$1 AND consumed_at IS NULL) OR expires_at < now() - interval '1 day'", [req.userId]);
        await query(`INSERT INTO familyhub_display_pairing_codes (code_hash,family_id,created_by,expires_at,display_name)
            VALUES ($1,$2,$3,now()+interval '5 minutes',$4)`, [hashPairingCode(code), req.userId, req.actualUserId, name]);
        res.json({ success: true, data: { code, name, expiresInSeconds: 300 } });
    } catch { res.status(503).json({ success: false, error: 'A pairing code could not be created.' }); }
});
// Server credentials (Settings → Advanced). Owner only; tokens are handed to the
// host's root-only applier and are never stored, logged or returned.
// Server credentials are host-wide, so they belong to the server's administrator,
// not to whoever owns *a* family (any member can become a standalone owner by
// leaving). The administrator is FAMILYHUB_ADMIN_EMAIL when set, otherwise the
// first account created on this server; both are checked in the database.
export const isHostAdmin = async (actualUserId: string | undefined): Promise<boolean> => {
    if (!actualUserId) return false;
    const email = process.env.FAMILYHUB_ADMIN_EMAIL?.trim().toLowerCase();
    const result = email
        ? await query('SELECT id FROM users WHERE lower(email) = $1 AND family_owner_id IS NULL LIMIT 1', [email])
        : await query('SELECT id FROM users WHERE family_owner_id IS NULL ORDER BY created_at ASC, id ASC LIMIT 1');
    return result.rows[0]?.id === actualUserId;
};
const requireOwner = async (req: AuthRequest, res: Response, next: () => void) => {
    if (req.isOwner && await isHostAdmin(req.actualUserId)) return next();
    return res.status(403).json({ success: false, error: 'Only the server administrator can manage server credentials.' });
};
const credentialLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
router.get('/admin/credentials', requireParent, requireOwner, async (_req: AuthRequest, res) => {
    try { res.set('Cache-Control', 'no-store').json({ success: true, data: await credentialStatus() }); }
    catch { res.status(503).json({ success: false, error: 'Credential status is unavailable.' }); }
});
router.put('/admin/credentials/:kind', credentialLimiter, requireParent, requireOwner, async (req: AuthRequest, res) => {
    try {
        const outcome = await submitCredential(req.params.kind, req.body?.token);
        if (outcome === 'invalid-kind') return res.status(404).json({ success: false, error: 'Unknown credential.' });
        if (outcome === 'invalid-token') return res.status(400).json({ success: false, error: 'Paste the whole token (letters, numbers, - and _ only).' });
        if (outcome === 'unavailable') return res.status(409).json({ success: false, error: 'The server helper is not installed on this host.' });
        res.status(202).json({ success: true });
    } catch { res.status(503).json({ success: false, error: 'The token could not be handed to the server.' }); }
});
router.post('/admin/credentials/check', credentialLimiter, requireParent, requireOwner, async (_req: AuthRequest, res) => {
    try { res.status((await requestCheck()) ? 202 : 409).json({ success: true }); }
    catch { res.status(503).json({ success: false, error: 'The check could not be requested.' }); }
});
// Software updates (Settings → Advanced), server administrator only. The app can
// ask the Pi to check GitHub or to start its updater now; it cannot choose a
// version, and the updater keeps its backup, health check and rollback.
// v1.5.3: restart the Family Hub server from Settings → Advanced (server administrator).
// The process exits cleanly and Docker's restart policy (unless-stopped) starts it
// again in a few seconds; the database, web and gateway containers keep running.
router.post('/admin/restart', credentialLimiter, requireParent, requireOwner, (req: AuthRequest, res) => {
    logger.warn('familyhub.restart_requested', { by: req.actualUserId });
    res.json({ success: true });
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 750).unref();
});
router.get('/admin/updates', requireParent, requireOwner, async (_req: AuthRequest, res) => {
    try { res.set('Cache-Control', 'no-store').json({ success: true, data: await updateStatus() }); }
    catch { res.status(503).json({ success: false, error: 'Update status is unavailable.' }); }
});
router.post('/admin/updates/:kind(check|install)', credentialLimiter, requireParent, requireOwner, async (req: AuthRequest, res) => {
    try {
        const outcome = await requestUpdate(req.params.kind as UpdateRequest);
        if (outcome === 'unavailable') return res.status(409).json({ success: false, error: 'The server helper is not installed on this host.' });
        if (outcome === 'nothing-to-install') return res.status(409).json({ success: false, error: 'No newer release is known yet. Check for updates first.' });
        res.status(202).json({ success: true });
    } catch { res.status(503).json({ success: false, error: 'The request could not be handed to the server.' }); }
});
router.get('/display/sessions', requireParent, async (req: AuthRequest, res) => {
    try {
        const result = await query(`SELECT id, name, created_at, last_seen_at FROM familyhub_display_sessions
            WHERE family_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 50`, [req.userId]);
        res.json({ success: true, data: result.rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at, lastSeenAt: row.last_seen_at })) });
    } catch { res.status(503).json({ success: false, error: 'Paired displays are unavailable.' }); }
});
router.delete('/display/sessions/:id', requireParent, async (req: AuthRequest, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ success: false, error: 'Display not found.' });
    try {
        const result = await query('UPDATE familyhub_display_sessions SET revoked_at=now() WHERE id=$1 AND family_id=$2 AND revoked_at IS NULL', [req.params.id, req.userId]);
        if (!result.rowCount) return res.status(404).json({ success: false, error: 'Display not found.' });
        res.json({ success: true });
    } catch { res.status(503).json({ success: false, error: 'The display could not be removed.' }); }
});
router.get('/preferences', async (req: AuthRequest, res) => {
    try {
        const [order, legend] = await Promise.all([
            query('SELECT card_order, hidden_modules FROM familyhub_dashboard_preferences WHERE user_id=$1', [req.actualUserId]),
            query('SELECT labels FROM familyhub_calendar_legend WHERE family_id=$1', [req.userId]),
        ]);
        res.json({ success: true, data: {
            cardOrder: order.rows[0]?.card_order ?? CARDS,
            hiddenModules: cleanModuleList(order.rows[0]?.hidden_modules ?? []),
            legend: legend.rows[0]?.labels ?? {},
        } });
    } catch { res.status(503).json({ success: false, error: 'Dashboard preferences unavailable.' }); }
});
// Reader view for a headline currently in the display's news feed.
router.get('/ambient/article', async (req: AuthRequest, res) => {
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    try {
        if (!(await readAmbientSettings(req.userId!)).widgets.includes('news')) return res.status(404).json({ success: false, error: 'News is not enabled for this display.' });
        const article = await getNewsArticle(id, (await readExtras(req.userId!)).settings.news.feeds);
        if (!article) return res.status(404).json({ success: false, error: 'That story is no longer in the headlines.' });
        res.json({ success: true, data: article });
    } catch { res.status(503).json({ success: false, error: 'The story could not be loaded.' }); }
});
// v1.5.2: the order of the management menu, per account (paths such as "/calendar").
const NAV_PATH = /^\/[a-z0-9-]{0,40}$/;
router.get('/nav', async (req: AuthRequest, res) => {
    try {
        const row = (await query('SELECT familyhub_nav_order FROM users WHERE id = $1', [req.actualUserId ?? req.userId])).rows[0];
        const order = Array.isArray(row?.familyhub_nav_order) ? row.familyhub_nav_order.filter((item: unknown) => typeof item === 'string' && NAV_PATH.test(item)) : [];
        res.json({ success: true, data: { order } });
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.put('/nav', async (req: AuthRequest, res) => {
    const order = req.body?.order;
    if (!Array.isArray(order) || order.length > 30 || order.some((item: unknown) => typeof item !== 'string' || !NAV_PATH.test(item)) || new Set(order).size !== order.length) {
        return res.status(400).json({ success: false, error: 'Invalid menu order.' });
    }
    try {
        await query('UPDATE users SET familyhub_nav_order = $1::jsonb WHERE id = $2', [order.length ? JSON.stringify(order) : null, req.actualUserId ?? req.userId]);
        res.json({ success: true, data: { order } });
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.get('/ambient/settings', async (req: AuthRequest, res) => {
    try { res.json({ success: true, data: await readAmbientSettings(req.userId!) }); }
    catch { res.status(503).json({ success: false, error: 'Display settings are unavailable.' }); }
});
router.put('/ambient/settings', requireParent, async (req: AuthRequest, res) => {
    try { res.json({ success: true, data: await saveAmbientSettings(req.userId!, req.body) }); }
    catch (error) { res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Display settings could not be saved.' }); }
});
router.get('/ambient/locations', requireParent, async (req: AuthRequest, res) => {
    const search = req.query.q;
    if (typeof search !== 'string' || search.trim().length < 2 || search.length > 80) {
        return res.status(400).json({ success: false, error: 'Enter at least two characters for a location search.' });
    }
    try { res.json({ success: true, data: await searchWeatherLocations(search) }); }
    catch { res.status(502).json({ success: false, error: 'Weather location search is unavailable. Try again later.' }); }
});
// ── v1.2 dashboard: quick bar, detail panels, slideshow photos ────────────
router.get('/dashboard/settings', requireParent, async (req: AuthRequest, res) => {
    try {
        const { settings, secrets } = await readExtras(req.userId!);
        res.json({ success: true, data: publicView(settings, secrets) });
    } catch { res.status(503).json({ success: false, error: 'Dashboard settings are unavailable.' }); }
});
router.put('/dashboard/settings', requireParent, async (req: AuthRequest, res) => {
    try {
        const { settings, secrets } = await saveExtras(req.userId!, req.body);
        clearMarketCache(req.userId!);
        res.json({ success: true, data: publicView(settings, secrets) });
    } catch (error) {
        if (error instanceof ExtrasValidationError) return res.status(400).json({ success: false, error: error.message });
        res.status(503).json({ success: false, error: 'Dashboard settings could not be saved.' });
    }
});
// Settings → Display → News: checks a feed address before it is saved.
const feedPreviewLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
router.post('/dashboard/news/preview', feedPreviewLimiter, requireParent, async (req: AuthRequest, res) => {
    try {
        const url = feedUrl(req.body?.url);
        const preview = await previewFeed(url);
        if (!preview.ok) return res.status(422).json({ success: false, error: 'No headlines could be read from that address. Check that it is an RSS or Atom feed.' });
        res.json({ success: true, data: { url, ...preview } });
    } catch (error) {
        if (error instanceof ExtrasValidationError) return res.status(400).json({ success: false, error: error.message });
        res.status(503).json({ success: false, error: 'The feed could not be checked.' });
    }
});
const photoFailure = (res: Response, error: unknown) => error instanceof PhotoError
    ? res.status(error.status).json({ success: false, error: error.message })
    : res.status(503).json({ success: false, error: 'The photo could not be processed.' });
const photoUploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });
router.get('/photos', requireParent, async (req: AuthRequest, res) => {
    try { res.json({ success: true, data: { photos: await listPhotos(req.userId!), max: MAX_PHOTOS } }); }
    catch (error) { photoFailure(res, error); }
});
// One photo per request, sent as the raw file body (Content-Type image/*).
router.post('/photos', requireParent, photoUploadLimiter,
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/octet-stream'], limit: MAX_UPLOAD_BYTES }),
    async (req: AuthRequest, res) => {
        try {
            if (!Buffer.isBuffer(req.body)) throw new PhotoError('Send the photo as an image file.', 415);
            res.status(201).json({ success: true, data: await addPhoto(req.userId!, req.actualUserId, req.body) });
        } catch (error) { photoFailure(res, error); }
    });
router.delete('/photos/:id', requireParent, async (req: AuthRequest, res) => {
    try {
        if (!(await deletePhoto(req.userId!, req.params.id))) return res.status(404).json({ success: false, error: 'That photo was not found.' });
        res.json({ success: true });
    } catch (error) { photoFailure(res, error); }
});
const sendPhoto = (variant: 'full' | 'thumb') => async (req: AuthRequest, res: Response) => {
    try {
        const bytes = await readPhoto(req.userId!, req.params.id, variant);
        if (!bytes) return res.status(404).json({ success: false, error: 'That photo was not found.' });
        // Photos never change under an id: let the browser keep them (privately).
        res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).send(bytes);
    } catch (error) { photoFailure(res, error); }
};
router.get('/photos/:id/thumb', requireParent, sendPhoto('thumb'));
// The frame's slideshow (ambient tokens may read this path; see middleware/auth.ts).
router.get('/ambient/photos/:id', sendPhoto('full'));

router.put('/preferences/order', async (req: AuthRequest, res) => {
    const order = req.body?.cardOrder;
    if (!Array.isArray(order) || order.length !== CARDS.length || new Set(order).size !== CARDS.length || order.some((card) => !CARDS.includes(card))) {
        return res.status(400).json({ success: false, error: 'Choose each dashboard card exactly once.' });
    }
    try {
        await query(`INSERT INTO familyhub_dashboard_preferences (user_id,card_order) VALUES ($1,$2)
            ON CONFLICT (user_id) DO UPDATE SET card_order=$2`, [req.actualUserId, JSON.stringify(order)]);
        res.json({ success: true });
    } catch { res.status(503).json({ success: false, error: 'Card order could not be saved.' }); }
});
// This member's own view: modules to leave out of their menu and overview. A view
// preference only; switching a module off for the household is PUT /modules.
router.put('/preferences/hidden', async (req: AuthRequest, res) => {
    const hidden = req.body?.hiddenModules;
    if (!Array.isArray(hidden) || hidden.some((key) => !isModuleKey(key))) {
        return res.status(400).json({ success: false, error: 'Invalid module list.' });
    }
    const values = cleanModuleList(hidden);
    try {
        await query(`INSERT INTO familyhub_dashboard_preferences (user_id, card_order, hidden_modules) VALUES ($1, $2, $3)
            ON CONFLICT (user_id) DO UPDATE SET hidden_modules = $3`, [req.actualUserId, JSON.stringify(CARDS), JSON.stringify(values)]);
        res.json({ success: true, data: { hiddenModules: values } });
    } catch { res.status(503).json({ success: false, error: 'Your menu could not be saved.' }); }
});
router.put('/preferences/legend', requireParent, async (req: AuthRequest, res) => {
    const labels = req.body?.legend;
    if (!labels || typeof labels !== 'object' || Array.isArray(labels) || Object.keys(labels).length > 32
        || Object.entries(labels).some(([color, label]) => !/^#[a-f0-9]{6}$/i.test(color) || typeof label !== 'string' || !label.trim() || label.length > 60)) {
        return res.status(400).json({ success: false, error: 'Use up to 32 hex colours with labels of 1–60 characters.' });
    }
    try {
        const normalized = Object.fromEntries(Object.entries(labels).map(([key, value]) => [key.toLowerCase(), (value as string).trim()]));
        await query(`INSERT INTO familyhub_calendar_legend (family_id,labels) VALUES ($1,$2)
            ON CONFLICT (family_id) DO UPDATE SET labels=$2`, [req.userId, JSON.stringify(normalized)]);
        res.json({ success: true });
    } catch { res.status(503).json({ success: false, error: 'Colour labels could not be saved.' }); }
});
router.get('/modules', async (req: AuthRequest, res) => {
    try {
        res.json({ success: true, data: { disabled_modules: await getDisabledModules(req.userId!) } });
    } catch { res.status(503).json({ success: false, error: 'Module settings unavailable.' }); }
});
router.put('/modules', requireParent, async (req: AuthRequest, res) => {
    const disabled = req.body?.disabled_modules;
    if (!Array.isArray(disabled) || disabled.some((key) => !isModuleKey(key))) {
        return res.status(400).json({ success: false, error: 'Invalid module settings.' });
    }
    try {
        const values = cleanModuleList(disabled);
        await saveDisabledModules(req.userId!, values);
        res.json({ success: true, data: { disabled_modules: values } });
    } catch { res.status(503).json({ success: false, error: 'Module settings could not be saved.' }); }
});
router.get('/', async (req: AuthRequest, res) => {
    try {
        const [notes, google] = await Promise.all([listFamilyNotes(req.userId!), syncGoogle(req.userId!)]);
        res.json({ success: true, data: { notes, readOnly: Boolean(req.readOnly), ...google } });
    } catch { res.status(503).json({ success: false, error: 'Family Hub is unavailable.' }); }
});
router.get('/ambient', async (req: AuthRequest, res) => {
    if (req.displaySessionId) {
        // Throttled "last seen" so Management can show which frames are alive.
        void query("UPDATE familyhub_display_sessions SET last_seen_at=now() WHERE id=$1 AND last_seen_at < now() - interval '5 minutes'", [req.displaySessionId]).catch(() => undefined);
    }
    try { res.json({ success: true, data: await loadAmbientSnapshot(req.userId!) }); }
    catch { res.status(503).json({ success: false, error: 'The display could not be refreshed. Check the connection and try again.' }); }
});
router.get('/google/status', requireParent, async (req: AuthRequest, res) => {
    try { res.json({ success: true, data: { ...await googleStatus(req.userId!), selection: await selection(req.userId!) } }); }
    catch (error) { fail(res, error); }
});
router.post('/google/connect', requireParent, async (req: AuthRequest, res) => {
    try { res.json({ success: true, data: await startGoogleConnection(req.userId!, req.actualUserId!, req.body?.includeGmail === true) }); }
    catch (error) { fail(res, error); }
});
router.delete('/google/connection', requireParent, async (req: AuthRequest, res) => {
    try { await disconnectGoogle(req.userId!); await invalidate(req.userId!); res.json({ success: true }); }
    catch (error) { fail(res, error); }
});
router.get('/google/sources', requireParent, async (req: AuthRequest, res) => {
    try {
        const api = googleApi(req.userId!);
        const [calendars, taskLists] = await Promise.all([api.calendarLists(), api.taskLists()]);
        res.json({ success: true, data: { calendars, taskLists } });
    } catch (error) { fail(res, error); }
});
router.put('/google/sources', requireParent, async (req: AuthRequest, res) => {
    try { await configureSources(req.userId!, req.body); res.json({ success: true }); }
    catch (error) { fail(res, error); }
});
const configured = async (familyId: string) => {
    const config = await selection(familyId);
    if (!config) throw new GoogleConnectionError(409, 'Choose your shared calendar and task list first.');
    return config;
};
router.get('/google/calendar', async (req: AuthRequest, res) => {
    const { start, end } = req.query;
    if (typeof start !== 'string' || typeof end !== 'string'
        || !/^\d{4}-\d\d-\d\dT/.test(start) || !/^\d{4}-\d\d-\d\dT/.test(end)
        || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))
        || Date.parse(end) <= Date.parse(start) || Date.parse(end) - Date.parse(start) > 62 * 86400000) {
        return res.status(400).json({ success: false, error: 'Choose a calendar range of up to 62 days.' });
    }
    try {
        const config = await configured(req.userId!);
        const before = (await query('SELECT cache_revision FROM familyhub_google_connections WHERE family_id=$1', [req.userId])).rows[0]?.cache_revision;
        const events = await googleApi(req.userId!).calendar(config.calendarId, start, end, config.timeZone);
        const after = (await query('SELECT cache_revision FROM familyhub_google_connections WHERE family_id=$1', [req.userId])).rows[0]?.cache_revision;
        if (before === undefined || after === undefined || String(before) !== String(after)) {
            return res.status(409).json({ success: false, error: 'Google connection changed. Refresh the calendar.' });
        }
        res.json({ success: true, data: { events, timeZone: config.timeZone } });
    } catch (error) { fail(res, error); }
});
router.post('/google/events', requireParent, async (req: AuthRequest, res) => {
    try {
        const config = await configured(req.userId!);
        const input = req.body ?? {};
        const data = await googleApi(req.userId!).createEvent(config.calendarId, input);
        await invalidate(req.userId!, 'calendar');
        res.json({ success: true, data });
    } catch (error) { fail(res, error); }
});
// Edit or delete one Google Calendar event from Family Hub (v1.5).
router.patch('/google/events/:id', requireParent, async (req: AuthRequest, res) => {
    try {
        const config = await configured(req.userId!);
        const data = await googleApi(req.userId!).updateEvent(config.calendarId, req.params.id, req.body ?? {});
        await invalidate(req.userId!, 'calendar');
        res.json({ success: true, data });
    } catch (error) { fail(res, error); }
});
router.delete('/google/events/:id', requireParent, async (req: AuthRequest, res) => {
    try {
        const config = await configured(req.userId!);
        await googleApi(req.userId!).deleteEvent(config.calendarId, req.params.id);
        await invalidate(req.userId!, 'calendar');
        res.json({ success: true });
    } catch (error) { fail(res, error); }
});
router.get('/google/colors', requireParent, async (req: AuthRequest, res) => {
    try {
        const config = await configured(req.userId!);
        res.json({ success: true, data: await googleApi(req.userId!).eventColors(config.calendarId) });
    } catch (error) { fail(res, error); }
});
router.post('/google/tasks', requireParent, requireModule('todos'), async (req: AuthRequest, res) => {
    try {
        if (typeof req.body?.title !== 'string') throw new Error('Invalid title');
        const config = await configured(req.userId!);
        const data = await googleApi(req.userId!).createTask(config.taskListId, req.body);
        await invalidate(req.userId!, 'tasks'); res.json({ success: true, data });
    } catch (error) { fail(res, error); }
});
router.patch('/google/tasks/:id', requireParent, requireModule('todos'), async (req: AuthRequest, res) => {
    try {
        const input = req.body ?? {};
        if ((input.title !== undefined && typeof input.title !== 'string') || (input.completed !== undefined && typeof input.completed !== 'boolean')
            || (input.dueDate !== undefined && input.dueDate !== null && typeof input.dueDate !== 'string')) throw new Error('Invalid task');
        const config = await configured(req.userId!);
        const data = await googleApi(req.userId!).updateTask(config.taskListId, req.params.id, input);
        await invalidate(req.userId!, 'tasks'); res.json({ success: true, data });
    } catch (error) { fail(res, error); }
});
router.delete('/google/tasks/:id', requireParent, requireModule('todos'), async (req: AuthRequest, res) => {
    try {
        const config = await configured(req.userId!);
        await googleApi(req.userId!).deleteTask(config.taskListId, req.params.id);
        await invalidate(req.userId!, 'tasks'); res.json({ success: true });
    } catch (error) { fail(res, error); }
});
router.post('/display-session', requireParent, async (req: AuthRequest, res) => {
    try {
        const result = await query('SELECT id, family_owner_id, token_version FROM users WHERE id = $1', [req.actualUserId]);
        if (!result.rows[0]) return res.status(401).json({ success: false, error: 'Account unavailable.' });
        res.json({ success: true, data: { token: issueAccessToken(result.rows[0], 'display') } });
    } catch { res.status(503).json({ success: false, error: 'Display session unavailable.' }); }
});
router.post('/ambient/display-session', requireParent, async (req: AuthRequest, res) => {
    try {
        const result = await query('SELECT id, family_owner_id, token_version FROM users WHERE id = $1', [req.actualUserId]);
        if (!result.rows[0]) return res.status(401).json({ success: false, error: 'Account unavailable.' });
        const sessionId = await createDisplaySession(req.userId!, req.actualUserId!, displayName(req.body?.name, 'Browser display'), req.actualUserId!);
        res.json({ success: true, data: { token: issueAccessToken(result.rows[0], 'ambient', sessionId) } });
    } catch { res.status(503).json({ success: false, error: 'Ambient display session unavailable.' }); }
});
router.post('/display/refresh', async (req: AuthRequest, res) => {
    if (!req.ambientOnly) return res.status(403).json({ success: false, error: 'Only an ambient display session can be renewed here.' });
    try {
        const result = await query('SELECT id, family_owner_id, token_version FROM users WHERE id = $1', [req.actualUserId]);
        if (!result.rows[0]) return res.status(401).json({ success: false, error: 'Account unavailable.' });
        // Older ambient tokens predate display sessions: give them one on renewal
        // so every frame becomes visible and revocable in Management.
        const sessionId = req.displaySessionId ?? await createDisplaySession(req.userId!, req.actualUserId!, 'Photo frame', null);
        await query('UPDATE familyhub_display_sessions SET last_seen_at=now() WHERE id=$1', [sessionId]);
        res.json({ success: true, data: { token: issueAccessToken(result.rows[0], 'ambient', sessionId) } });
    } catch { res.status(503).json({ success: false, error: 'Display session could not be renewed.' }); }
});
export default router;
