import { Router, type Response } from 'express';
import { authMiddleware, requireParent, type AuthRequest } from '../middleware/auth';
import { requireModule } from '../lib/modules';
import { broadcast } from '../lib/broadcaster';
import { GoogleConnectionError } from '../services/familyhub/google/connection';
import { GoogleApiError } from '../services/familyhub/google/adapters';
import {
    addItem, clearChecked, createShoppingList, editItem, loadShopping, migrateLocalItems,
    removeItem, saveShoppingLists, shoppingSettings, ShoppingError,
} from '../services/familyhub/shopping';
import logger from '../lib/logger';

/**
 * /api/familyhub/shopping: shopping lists kept in Google Tasks (v1.6).
 * Every family account may read and edit items; choosing, creating and
 * migrating lists is for parents. Display tokens never reach these routes
 * (they are outside the ambient allowlist).
 */
const router = Router();
router.use(authMiddleware);
router.use(requireModule('shopping'));

const fail = (res: Response, error: unknown) => {
    if (error instanceof ShoppingError) return res.status(error.status).json({ success: false, error: error.message });
    if (error instanceof GoogleConnectionError || (error instanceof GoogleApiError && error.status === 401)) {
        return res.status(409).json({ success: false, error: 'Reconnect Google in Settings to use the shopping lists.', code: 'GOOGLE_RECONNECT' });
    }
    if (error instanceof GoogleApiError) {
        return res.status(error.status === 404 ? 404 : 502).json({ success: false, error: error.status === 404 ? 'That item or list no longer exists in Google.' : 'Google Tasks did not respond. Try again.' });
    }
    if (error instanceof Error && /characters|required|Invalid|too long/.test(error.message)) return res.status(400).json({ success: false, error: error.message });
    logger.error('familyhub.shopping_error', { error: error instanceof Error ? error.message : String(error) });
    return res.status(500).json({ success: false, error: 'Internal server error' });
};
const changed = (req: AuthRequest, action: 'created' | 'updated' | 'deleted') => broadcast(req.userId!, { type: 'update', entity: 'shopping', action });

router.get('/', async (req: AuthRequest, res) => {
    try { res.set('Cache-Control', 'no-store').json({ success: true, data: await loadShopping(req.userId!) }); }
    catch (error) { fail(res, error); }
});
router.get('/settings', requireParent, async (req: AuthRequest, res) => {
    try { res.set('Cache-Control', 'no-store').json({ success: true, data: await shoppingSettings(req.userId!) }); }
    catch (error) { fail(res, error); }
});
router.put('/settings', requireParent, async (req: AuthRequest, res) => {
    try { const selected = await saveShoppingLists(req.userId!, req.body?.lists); changed(req, 'updated'); res.json({ success: true, data: { selected } }); }
    catch (error) { fail(res, error); }
});
router.post('/lists', requireParent, async (req: AuthRequest, res) => {
    try { const list = await createShoppingList(req.userId!, req.body?.title); changed(req, 'created'); res.json({ success: true, data: list }); }
    catch (error) { fail(res, error); }
});
router.post('/migrate', requireParent, async (req: AuthRequest, res) => {
    try {
        const data = await migrateLocalItems(req.userId!, req.body?.listId, req.body?.again === true, req.body?.aisleLabels);
        changed(req, 'created'); res.json({ success: true, data });
    } catch (error) { fail(res, error); }
});
router.post('/lists/:listId/items', async (req: AuthRequest, res) => {
    try { const item = await addItem(req.userId!, req.params.listId, req.body ?? {}); changed(req, 'created'); res.json({ success: true, data: item }); }
    catch (error) { fail(res, error); }
});
router.patch('/lists/:listId/items/:id', async (req: AuthRequest, res) => {
    try { const item = await editItem(req.userId!, req.params.listId, req.params.id, req.body ?? {}); changed(req, 'updated'); res.json({ success: true, data: item }); }
    catch (error) { fail(res, error); }
});
router.delete('/lists/:listId/items/:id', async (req: AuthRequest, res) => {
    try { await removeItem(req.userId!, req.params.listId, req.params.id); changed(req, 'deleted'); res.json({ success: true }); }
    catch (error) { fail(res, error); }
});
router.post('/lists/:listId/clear', async (req: AuthRequest, res) => {
    try { await clearChecked(req.userId!, req.params.listId); changed(req, 'deleted'); res.json({ success: true }); }
    catch (error) { fail(res, error); }
});

export default router;
