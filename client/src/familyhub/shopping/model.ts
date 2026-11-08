import { api } from '../../lib/api';
import { splitQuantity, type ItemDraft, type ShopItem, type ShoppingData, type ShoppingSettings } from './logic';

export * from './logic';

const BASE = '/api/familyhub/shopping';
const listPath = (listId: string) => `${BASE}/lists/${encodeURIComponent(listId)}`;
const body = (input: Partial<ItemDraft>) => { const draft = splitQuantity(input); return ({
    ...(draft.name !== undefined ? { name: draft.name } : {}),
    ...(draft.quantity !== undefined ? { quantity: draft.quantity.trim() === '' ? null : draft.quantity.trim() } : {}),
    ...(draft.unit !== undefined ? { unit: draft.unit } : {}),
    ...(draft.aisle !== undefined ? { aisle: draft.aisle } : {}),
    ...(draft.notes !== undefined ? { notes: draft.notes } : {}),
}); };

export const shoppingApi = {
    load: async () => (await api.get<{ data: ShoppingData }>(BASE)).data,
    settings: async () => (await api.get<{ data: ShoppingSettings }>(`${BASE}/settings`)).data,
    saveLists: (lists: string[]) => api.put(`${BASE}/settings`, { lists }),
    createList: async (title: string) => (await api.post<{ data: { id: string; title: string } }>(`${BASE}/lists`, { title })).data,
    add: async (listId: string, draft: ItemDraft) => (await api.post<{ data: ShopItem }>(`${listPath(listId)}/items`, body(draft))).data,
    edit: async (listId: string, id: string, draft: Partial<ItemDraft> & { checked?: boolean; moveTo?: string }) =>
        (await api.patch<{ data: ShopItem }>(`${listPath(listId)}/items/${encodeURIComponent(id)}`, {
            ...body(draft), ...(draft.checked !== undefined ? { checked: draft.checked } : {}), ...(draft.moveTo ? { moveTo: draft.moveTo } : {}),
        })).data,
    remove: (listId: string, id: string) => api.delete(`${listPath(listId)}/items/${encodeURIComponent(id)}`),
    clearChecked: (listId: string) => api.post(`${listPath(listId)}/clear`, {}),
    migrate: async (listId: string, aisleLabels: Record<string, string>) =>
        (await api.post<{ data: { copied: number } }>(`${BASE}/migrate`, { listId, aisleLabels })).data,
};
