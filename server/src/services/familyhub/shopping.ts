import { query } from '../../db';
import { googleApi } from './google/runtime';
import { googleStatus } from './google/connection';
import type { RawListItem, TaskList } from './google/adapters';

/**
 * Shopping on Google Tasks (v1.6). Each shopping list is one of the connected
 * account's task lists, chosen in Settings; Google holds the items, so they
 * also show in the Google Tasks app and survive the Pi.
 *
 * An item is a task. Its title is the item name; quantity and aisle sit on
 * their own lines at the top of the task's notes, readable in Google's app:
 *
 *     Qty: 2 L
 *     Aisle: Dairy
 *     anything else typed as a note
 *
 * Items added in Google's own app have neither line and simply show no
 * quantity and the "other" aisle.
 */
export const MAX_SHOPPING_LISTS = 12;
const MAX_ITEMS_PER_MIGRATION = 300;

export class ShoppingError extends Error {
    constructor(public readonly status: number, message: string) { super(message); }
}

export interface ShoppingItem {
    id: string; name: string; quantity: number | null; unit: string | null;
    aisle: string | null; notes: string; checked: boolean; position: string;
}
export interface ItemInput { name?: unknown; quantity?: unknown; unit?: unknown; aisle?: unknown; notes?: unknown }

const QTY = /^\s*(?:qty|quantity|qté|quantité)\s*:\s*(.*)$/i;
const AISLE = /^\s*(?:aisle|rayon)\s*:\s*(.*)$/i;
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

export function parseQuantity(text: string): { quantity: number | null; unit: string | null } {
    const match = /^(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(text.trim());
    if (!match) return { quantity: null, unit: clean(text, 20) || null };
    const quantity = Number(match[1].replace(',', '.'));
    return { quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null, unit: clean(match[2], 20) || null };
}

export function decodeItem(raw: RawListItem): ShoppingItem {
    let quantity: number | null = null, unit: string | null = null, aisle: string | null = null;
    const rest: string[] = [];
    let header = true;
    for (const line of raw.notes.split(/\r?\n/)) {
        const qty = header ? QTY.exec(line) : null;
        const ais = header ? AISLE.exec(line) : null;
        if (qty) ({ quantity, unit } = parseQuantity(qty[1]));
        else if (ais) aisle = clean(ais[1], 40) || null;
        else { header = false; rest.push(line); }
    }
    return { id: raw.id, name: raw.title, quantity, unit, aisle, notes: rest.join('\n').trim(), checked: raw.completed, position: raw.position };
}

/** Validates an add or edit; `partial` allows any subset of fields. */
export function readItemInput(input: ItemInput, partial: boolean) {
    const out: { name?: string; quantity?: number | null; unit?: string | null; aisle?: string | null; notes?: string } = {};
    if (input.name !== undefined || !partial) {
        const name = clean(input.name, 200);
        if (!name) throw new ShoppingError(400, 'Enter an item name.');
        out.name = name;
    }
    if (input.quantity !== undefined) {
        if (input.quantity === null || input.quantity === '') out.quantity = null;
        else {
            const n = typeof input.quantity === 'number' ? input.quantity : Number(String(input.quantity).replace(',', '.'));
            if (!Number.isFinite(n) || n <= 0 || n > 100_000) throw new ShoppingError(400, 'Enter a quantity above zero.');
            out.quantity = Math.round(n * 1000) / 1000;
        }
    }
    if (input.unit !== undefined) out.unit = clean(input.unit, 20) || null;
    if (input.aisle !== undefined) out.aisle = clean(input.aisle, 40) || null;
    if (input.notes !== undefined) {
        if (input.notes !== null && typeof input.notes !== 'string') throw new ShoppingError(400, 'Notes must be text.');
        out.notes = typeof input.notes === 'string' ? input.notes.replace(/\r/g, '').trim().slice(0, 2000) : '';
    }
    return out;
}

export function encodeNotes(item: { quantity: number | null; unit: string | null; aisle: string | null; notes: string }): string {
    const lines: string[] = [];
    if (item.quantity !== null || item.unit) lines.push(`Qty: ${[item.quantity ?? '', item.unit ?? ''].join(' ').trim()}`);
    if (item.aisle) lines.push(`Aisle: ${item.aisle}`);
    // A note that itself starts like a header line would be read back as one.
    const notes = item.notes && (QTY.test(item.notes.split('\n')[0]) || AISLE.test(item.notes.split('\n')[0])) ? `— ${item.notes}` : item.notes;
    if (notes) lines.push(notes);
    return lines.join('\n');
}

export async function selectedListIds(familyId: string): Promise<string[]> {
    const row = (await query('SELECT list_ids FROM familyhub_shopping_settings WHERE family_id = $1', [familyId])).rows[0];
    return Array.isArray(row?.list_ids) ? row.list_ids.filter((id: unknown): id is string => typeof id === 'string') : [];
}

async function migrationState(familyId: string) {
    const [row, local] = await Promise.all([
        query('SELECT migrated_at, migrated_count FROM familyhub_shopping_settings WHERE family_id = $1', [familyId]),
        query('SELECT count(*)::int AS n FROM shopping_items WHERE user_id = $1 AND NOT is_checked', [familyId]),
    ]);
    return { localItems: local.rows[0].n as number, migratedAt: row.rows[0]?.migrated_at ?? null, migratedCount: row.rows[0]?.migrated_count ?? null };
}

/** Throws unless listId is one of the household's chosen shopping lists. */
export async function assertShoppingList(familyId: string, listId: string): Promise<void> {
    if (typeof listId !== 'string' || !listId || listId.length > 200) throw new ShoppingError(404, 'Shopping list not found.');
    if (!(await selectedListIds(familyId)).includes(listId)) throw new ShoppingError(404, 'Shopping list not found.');
}

/**
 * The page's data. `mode: 'local'` when Google is not connected or no list is
 * chosen yet, so the original single local list keeps working.
 */
export async function loadShopping(familyId: string) {
    const status = await googleStatus(familyId);
    const ids = await selectedListIds(familyId);
    const migration = await migrationState(familyId);
    if (!status.connected) return { mode: 'local' as const, connected: false, lists: [], migration };
    if (!ids.length) return { mode: 'local' as const, connected: true, lists: [], migration };
    const api = googleApi(familyId);
    const available = new Map((await api.taskLists()).map((list) => [list.id, list.title]));
    const present = ids.filter((id) => available.has(id));
    const lists = await Promise.all(present.map(async (id) => {
        const items = (await api.listItems(id)).map(decodeItem)
            .sort((a, b) => Number(a.checked) - Number(b.checked) || a.position.localeCompare(b.position));
        return { id, title: available.get(id)!, items };
    }));
    return { mode: 'google' as const, connected: true, lists, missing: ids.length - present.length, migration };
}

export async function shoppingSettings(familyId: string) {
    const status = await googleStatus(familyId);
    if (!status.connected) return { connected: false, available: [] as TaskList[], selected: [] as string[] };
    const [available, selected] = await Promise.all([googleApi(familyId).taskLists(), selectedListIds(familyId)]);
    return { connected: true, available, selected: selected.filter((id) => available.some((list) => list.id === id)) };
}

export async function saveShoppingLists(familyId: string, value: unknown): Promise<string[]> {
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) throw new ShoppingError(400, 'Choose your shopping lists.');
    const ids = [...new Set(value as string[])];
    if (ids.length > MAX_SHOPPING_LISTS) throw new ShoppingError(400, `Choose at most ${MAX_SHOPPING_LISTS} shopping lists.`);
    if (ids.length) {
        const available = new Set((await googleApi(familyId).taskLists()).map((list) => list.id));
        if (ids.some((id) => !available.has(id))) throw new ShoppingError(400, 'Choose task lists belonging to the connected Google account.');
    }
    await query(`INSERT INTO familyhub_shopping_settings (family_id, list_ids, updated_at) VALUES ($1, $2::jsonb, now())
        ON CONFLICT (family_id) DO UPDATE SET list_ids = EXCLUDED.list_ids, updated_at = now()`, [familyId, JSON.stringify(ids)]);
    return ids;
}

/** Creates a Google task list and adds it to the end of the shopping lists. */
export async function createShoppingList(familyId: string, title: unknown): Promise<TaskList> {
    const ids = await selectedListIds(familyId);
    if (ids.length >= MAX_SHOPPING_LISTS) throw new ShoppingError(400, `At most ${MAX_SHOPPING_LISTS} shopping lists.`);
    const name = clean(title, 100);
    if (!name) throw new ShoppingError(400, 'Enter a list name.');
    const list = await googleApi(familyId).createTaskList(name);
    await query(`INSERT INTO familyhub_shopping_settings (family_id, list_ids, updated_at) VALUES ($1, $2::jsonb, now())
        ON CONFLICT (family_id) DO UPDATE SET list_ids = familyhub_shopping_settings.list_ids || EXCLUDED.list_ids, updated_at = now()`,
        [familyId, JSON.stringify([list.id])]);
    return list;
}

export async function addItem(familyId: string, listId: string, input: ItemInput): Promise<ShoppingItem> {
    await assertShoppingList(familyId, listId);
    const item = readItemInput(input, false);
    const raw = await googleApi(familyId).createListItem(listId, {
        title: item.name!, notes: encodeNotes({ quantity: item.quantity ?? null, unit: item.unit ?? null, aisle: item.aisle ?? null, notes: item.notes ?? '' }),
    });
    return decodeItem(raw);
}

/**
 * Edits an item; `checked` ticks it off, `listId` moves it to another shopping
 * list (Google has no cross-list move, so it is recreated there first and only
 * then removed from the original).
 */
export async function editItem(familyId: string, listId: string, id: string, input: ItemInput & { checked?: unknown; moveTo?: unknown }): Promise<ShoppingItem> {
    await assertShoppingList(familyId, listId);
    if (typeof id !== 'string' || !id || id.length > 200) throw new ShoppingError(404, 'Item not found.');
    if (input.checked !== undefined && typeof input.checked !== 'boolean') throw new ShoppingError(400, 'Invalid item.');
    const api = googleApi(familyId);
    const changes = readItemInput(input, true);
    const current = (await api.listItems(listId)).find((raw) => raw.id === id);
    if (!current) throw new ShoppingError(404, 'Item not found.');
    const before = decodeItem(current);
    const next = { quantity: before.quantity, unit: before.unit, aisle: before.aisle, notes: before.notes, ...changes };
    const notes = encodeNotes({ quantity: next.quantity ?? null, unit: next.unit ?? null, aisle: next.aisle ?? null, notes: next.notes ?? '' });
    const title = changes.name ?? before.name;
    const checked = typeof input.checked === 'boolean' ? input.checked : before.checked;

    if (input.moveTo !== undefined && input.moveTo !== listId) {
        if (typeof input.moveTo !== 'string') throw new ShoppingError(400, 'Choose a shopping list.');
        await assertShoppingList(familyId, input.moveTo);
        let moved = await api.createListItem(input.moveTo, { title, notes });
        if (checked) moved = await api.updateListItem(input.moveTo, moved.id, { completed: true });
        await api.deleteTask(listId, id);
        return decodeItem(moved);
    }
    const patch: { title?: string; notes?: string; completed?: boolean } = {};
    if (title !== current.title) patch.title = title;
    if (notes !== current.notes) patch.notes = notes;
    if (checked !== current.completed) patch.completed = checked;
    if (!Object.keys(patch).length) return before;
    return decodeItem(await api.updateListItem(listId, id, patch));
}

export async function removeItem(familyId: string, listId: string, id: string): Promise<void> {
    await assertShoppingList(familyId, listId);
    if (typeof id !== 'string' || !id || id.length > 200) throw new ShoppingError(404, 'Item not found.');
    await googleApi(familyId).deleteTask(listId, id);
}

export async function clearChecked(familyId: string, listId: string): Promise<void> {
    await assertShoppingList(familyId, listId);
    await googleApi(familyId).clearCompleted(listId);
}

/**
 * One-time copy of the old local list (items not yet ticked) into a Google
 * shopping list. The local rows stay, so nothing is lost if a copy fails part
 * way; a second run is refused unless `again` is set.
 */
export async function migrateLocalItems(familyId: string, listId: string, again = false, aisleLabels: unknown = {}) {
    // The old list stores category keys ("Alimentation"); the page sends the
    // names the household sees, so Google's app shows "Aisle: Food".
    const labels = aisleLabels && typeof aisleLabels === 'object' && !Array.isArray(aisleLabels) ? aisleLabels as Record<string, unknown> : {};
    const aisleFor = (key: unknown) => {
        const k = typeof key === 'string' ? key : '';
        return clean(Object.prototype.hasOwnProperty.call(labels, k) ? labels[k] : k, 40) || null;
    };
    await assertShoppingList(familyId, listId);
    const state = await migrationState(familyId);
    if (state.migratedAt && !again) throw new ShoppingError(409, 'The local list was already copied to Google.');
    const rows = (await query(`SELECT name, category, quantity, unit, notes FROM shopping_items
        WHERE user_id = $1 AND NOT is_checked ORDER BY created_at LIMIT ${MAX_ITEMS_PER_MIGRATION}`, [familyId])).rows;
    const api = googleApi(familyId);
    let copied = 0;
    for (const row of rows) {
        const input = readItemInput({ name: row.name, quantity: row.quantity === null ? undefined : Number(row.quantity), unit: row.unit ?? undefined, notes: row.notes ?? undefined }, false);
        await api.createListItem(listId, { title: input.name!, notes: encodeNotes({ quantity: input.quantity ?? null, unit: input.unit ?? null,
            aisle: aisleFor(row.category), notes: input.notes ?? '' }) });
        copied++;
        // Recorded as it goes: a failure part way through still shows what was copied.
        await query(`INSERT INTO familyhub_shopping_settings (family_id, migrated_at, migrated_count, updated_at) VALUES ($1, now(), $2, now())
            ON CONFLICT (family_id) DO UPDATE SET migrated_at = now(), migrated_count = EXCLUDED.migrated_count, updated_at = now()`, [familyId, copied]);
    }
    return { copied };
}
