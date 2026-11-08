import type { ShopItem, ShopList } from './logic';

/**
 * Demo-only stand-in for /api/familyhub/shopping (fictional lists and items),
 * so the prototype shows the Google Tasks shopping lists without Google.
 * State resets on reload like the rest of the demo.
 */
export function createShoppingMock() {
    let seq = 0;
    const item = (name: string, aisle: string | null, quantity: number | null = null, unit: string | null = null, checked = false): ShopItem =>
        ({ id: `demo-item-${++seq}`, name, quantity, unit, aisle, notes: '', checked, position: String(seq).padStart(6, '0') });
    const available = [{ id: 'demo-todo', title: 'Family to-dos' }, { id: 'demo-bulk', title: 'Bulk store' }, { id: 'demo-grocer', title: 'Grocer' }, { id: 'demo-pharmacy', title: 'Pharmacy' }];
    let selected = ['demo-grocer', 'demo-bulk'];
    const items: Record<string, ShopItem[]> = {
        'demo-grocer': [item('Milk', 'Groceries', 2, 'L'), item('Bananas', 'Groceries', 6), item('Dish soap', 'Household'), item('Bread', 'Groceries', 1, null, true)],
        'demo-bulk': [item('Paper towels', 'Household', 1, 'pack'), item('Rice', 'Groceries', 10, 'kg'), item('Diapers', 'Baby', 2, 'boxes')],
        'demo-pharmacy': [],
    };
    const lists = (): ShopList[] => selected.map((id) => ({ id, title: available.find((l) => l.id === id)!.title, items: [...(items[id] ?? [])] }));
    const num = (v: unknown) => (v === null || v === '' || v === undefined ? null : Number(String(v).replace(',', '.')) || null);

    return (method: string, path: string, raw: unknown): unknown | undefined => {
        if (!path.startsWith('/shopping')) return undefined;
        const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const rest = path.slice('/shopping'.length);
        if (method === 'GET' && rest === '') return { mode: 'google', connected: true, lists: lists(), missing: 0, migration: { localItems: 0, migratedAt: null, migratedCount: null } };
        if (method === 'GET' && rest === '/settings') return { connected: true, available, selected };
        if (method === 'PUT' && rest === '/settings') { selected = (body.lists as string[]).filter((id) => available.some((l) => l.id === id)); return { selected }; }
        const m = /^\/lists\/([^/]+)(?:\/items(?:\/([^/]+))?|\/clear)?$/.exec(rest);
        if (method === 'POST' && rest === '/lists') { const id = `demo-new-${++seq}`; available.push({ id, title: String(body.title) }); selected.push(id); items[id] = []; return { id, title: body.title }; }
        if (!m || !selected.includes(decodeURIComponent(m[1]))) throw new Error('Shopping list not found.');
        const listId = decodeURIComponent(m[1]), list = items[listId] ?? (items[listId] = []);
        if (rest.endsWith('/clear')) { items[listId] = list.filter((i) => !i.checked); return {}; }
        if (method === 'POST') { const created = item(String(body.name ?? '').trim(), (body.aisle as string) || null, num(body.quantity), (body.unit as string) || null); list.unshift(created); return created; }
        const found = list.find((i) => i.id === m[2]);
        if (!found) throw new Error('Item not found.');
        if (method === 'DELETE') { items[listId] = list.filter((i) => i !== found); return {}; }
        if ('name' in body) found.name = String(body.name);
        if ('quantity' in body) found.quantity = num(body.quantity);
        if ('unit' in body) found.unit = (body.unit as string) || null;
        if ('aisle' in body) found.aisle = (body.aisle as string) || null;
        if ('notes' in body) found.notes = String(body.notes ?? '');
        if (typeof body.checked === 'boolean') found.checked = body.checked;
        if (typeof body.moveTo === 'string' && body.moveTo !== listId) { items[listId] = list.filter((i) => i !== found); (items[body.moveTo] ??= []).unshift(found); }
        return found;
    };
}
