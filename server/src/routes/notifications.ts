import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { vapidPublicKey } from '../lib/pushService';
import { hasControlChars, isUuid } from '../lib/asyncRoutes';

const router = Router();

// Public: no auth needed — client fetches this before registering SW
router.get('/vapid-public-key', (_req, res) => {
    res.json({ success: true, data: vapidPublicKey });
});

// Browsers hand out endpoints on these push services only. Anything else would
// make the server POST to an address the subscriber chose (blind SSRF).
const PUSH_SERVICE_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/,
    /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /^web\.push\.apple\.com$/];
const isValidPushEndpoint = (value: unknown): value is string => {
    if (typeof value !== 'string' || value.length > 2048 || hasControlChars(value)) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.port && PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname));
    } catch {
        return false;
    }
};
const isPushKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{4,200}={0,2}$/.test(value);

// What an account may see: notifications addressed to it, plus the family's
// shared appointment reminders. Personal ones (join requests, with the
// requester's name and email) stay with their addressee. $1 = account, $2 = family.
const VISIBLE = `(user_id = $1 OR (user_id = $2 AND type = 'appointment_reminder'))`;

// All other routes require authentication
router.use(authMiddleware);

router.param('id', (_req, res, next, value) => (isUuid(value) ? next() : res.status(400).json({ success: false, error: 'Invalid id' })));

// POST /subscribe — register a push subscription from the browser
router.post('/subscribe', async (req: AuthRequest, res) => {
    const { endpoint, keys } = req.body as {
        endpoint?: string;
        keys?: { auth?: string; p256dh?: string };
    };

    if (!isValidPushEndpoint(endpoint) || !isPushKey(keys?.auth) || !isPushKey(keys?.p256dh)) {
        return res.status(400).json({ success: false, error: 'Invalid subscription data' });
    }

    // user_id is the family (family-wide reminders); account_id is the device's owner.
    await query(
        `INSERT INTO push_subscriptions (user_id, account_id, endpoint, keys)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, endpoint) DO UPDATE SET keys = EXCLUDED.keys, account_id = EXCLUDED.account_id`,
        [req.userId, req.actualUserId, endpoint, JSON.stringify({ auth: keys!.auth, p256dh: keys!.p256dh })]
    );

    return res.json({ success: true });
});

// DELETE /subscribe?endpoint=... — remove one of the caller's own subscriptions;
// without an endpoint, all of the caller's own devices. Rows from older releases
// (no recorded account) can be removed by the family owner only.
router.delete('/subscribe', async (req: AuthRequest, res) => {
    const endpoint = typeof req.query.endpoint === 'string' ? req.query.endpoint : undefined;
    if (endpoint !== undefined && (endpoint.length > 2048 || hasControlChars(endpoint))) {
        return res.status(400).json({ success: false, error: 'Invalid endpoint' });
    }

    const owned = `(account_id = $2 OR (account_id IS NULL AND $3::boolean))`;
    if (endpoint) {
        await query(`DELETE FROM push_subscriptions WHERE user_id = $1 AND ${owned} AND endpoint = $4`,
            [req.userId, req.actualUserId, Boolean(req.isOwner), endpoint]);
    } else {
        await query(`DELETE FROM push_subscriptions WHERE user_id = $1 AND ${owned}`,
            [req.userId, req.actualUserId, Boolean(req.isOwner)]);
    }

    return res.json({ success: true });
});

// GET / — list last 50 notifications for the user
router.get('/', async (req: AuthRequest, res) => {
    const { rows } = await query(
        `SELECT * FROM notifications WHERE ${VISIBLE} ORDER BY created_at DESC LIMIT 50`,
        [req.actualUserId, req.userId]
    );
    return res.json({ success: true, data: rows });
});

// GET /unread-count
router.get('/unread-count', async (req: AuthRequest, res) => {
    const { rows } = await query(
        `SELECT COUNT(*)::int AS count FROM notifications WHERE ${VISIBLE} AND is_read = false`,
        [req.actualUserId, req.userId]
    );
    return res.json({ success: true, data: { count: rows[0]?.count ?? 0 } });
});

// PUT /read-all — mark all notifications as read
router.put('/read-all', async (req: AuthRequest, res) => {
    await query(
        `UPDATE notifications SET is_read = true WHERE ${VISIBLE} AND is_read = false`,
        [req.actualUserId, req.userId]
    );
    return res.json({ success: true });
});

// PUT /:id/read — mark one notification as read
router.put('/:id/read', async (req: AuthRequest, res) => {
    await query(
        `UPDATE notifications SET is_read = true WHERE id = $3 AND ${VISIBLE}`,
        [req.actualUserId, req.userId, req.params.id]
    );
    return res.json({ success: true });
});

export default router;
