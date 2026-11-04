import type { NextFunction, Response } from 'express';
import { query } from '../db';
import type { AuthRequest } from '../middleware/auth';

/**
 * Family Hub's optional modules: the single source of truth for which parts of
 * the app a family can switch on and off (Settings → Modules), and for the
 * server-side check that keeps a switched-off module's API closed.
 *
 * The choice is family-wide, stored on the owner's row in
 * familyhub_module_preferences. Home, Calendar, the family display and
 * Settings are always on and are deliberately not listed here.
 *
 * Keep this list in step with client/src/familyhub/modules.ts.
 */
export const MODULE_KEYS = [
    'todos',        // Google Tasks
    'chores',       // local chores (tasks table)
    'rewards',      // pocket money; uses chores for its reward chores
    'notes',
    'budget',
    'shopping',
    'planning',     // weekly routines
    'daycare',
    'classroom',
    'ai',
    'integrations', // Home Assistant, Nextcloud, Immich
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Used until a family saves its own choice. */
export const DEFAULT_DISABLED_MODULES: readonly ModuleKey[] = ['shopping', 'planning', 'integrations'];

export const isModuleKey = (value: unknown): value is ModuleKey =>
    typeof value === 'string' && (MODULE_KEYS as readonly string[]).includes(value);

/** Drops unknown and removed keys (e.g. 'recipes' from an older release). */
export const cleanModuleList = (value: unknown): ModuleKey[] =>
    Array.isArray(value) ? [...new Set(value.filter(isModuleKey))] : [...DEFAULT_DISABLED_MODULES];

// The guard runs on every request to a module's API. A short cache keeps that
// to one small query per family every few seconds; saving clears it at once.
const CACHE_MS = 5_000;
const cache = new Map<string, { at: number; disabled: ModuleKey[] }>();

export const clearModuleCache = (familyId?: string): void => {
    if (familyId) cache.delete(familyId);
    else cache.clear();
};

export const getDisabledModules = async (familyId: string): Promise<ModuleKey[]> => {
    const hit = cache.get(familyId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.disabled;
    const result = await query('SELECT disabled_modules FROM familyhub_module_preferences WHERE family_id = $1', [familyId]);
    const disabled = result.rows[0] ? cleanModuleList(result.rows[0].disabled_modules) : [...DEFAULT_DISABLED_MODULES];
    cache.set(familyId, { at: Date.now(), disabled });
    return disabled;
};

export const saveDisabledModules = async (familyId: string, disabled: ModuleKey[]): Promise<void> => {
    await query(
        `INSERT INTO familyhub_module_preferences (family_id, disabled_modules) VALUES ($1, $2)
         ON CONFLICT (family_id) DO UPDATE SET disabled_modules = $2`,
        [familyId, JSON.stringify(disabled)],
    );
    clearModuleCache(familyId);
};

/**
 * Rejects the request with 403 unless at least one of the given modules is on
 * for the caller's family. Mount it after authMiddleware (it needs req.userId,
 * which is always the family owner's id).
 */
export const requireModule = (...keys: ModuleKey[]) =>
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
        try {
            const disabled = await getDisabledModules(req.userId);
            if (keys.some((key) => !disabled.includes(key))) return next();
            return res.status(403).json({ success: false, error: 'MODULE_DISABLED', module: keys[0] });
        } catch {
            return res.status(503).json({ success: false, error: 'Module settings unavailable.' });
        }
    };
