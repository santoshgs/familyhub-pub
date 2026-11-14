import { useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, ChevronLeft, Eraser, GripVertical, Pencil, Plus, ShoppingBag, Store, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Dialog } from '../../components/ui';
import { intlLocale } from '../../i18n/format';
import { formatQuantity, groupByAisle, readCollapsed, reorderItems, shoppingApi, writeCollapsed, type ItemDraft, type ShopItem, type ShopList } from './model';

const EMPTY: ItemDraft = { name: '', quantity: '', unit: '', aisle: '', notes: '' };
const LIST_KEY = 'familyhub.shopping.collapsed';
const STORE_KEY = 'familyhub.shopping.store.collapsed';

interface Props {
    lists: ShopList[];
    missing: number;
    /** The family's aisles: category key and the name shown for it. */
    aisles: Array<{ key: string; label: string }>;
    isParent: boolean;
    /** Replace one list in place after a change (optimistic refresh). */
    onListChange: (list: ShopList) => void;
    reload: () => Promise<void>;
    banner?: React.ReactNode;
}

/** Shopping on Google Tasks: one collapsible card per chosen list, plus store mode. */
export function GoogleShopping({ lists, missing, aisles, isParent, onListChange, reload, banner }: Props) {
    const { t } = useTranslation(['shopping', 'common']);
    const locale = intlLocale();
    const other = t('shopping:google.otherAisle', { defaultValue: 'Other' });
    const [collapsed, setCollapsed] = useState(() => readCollapsed(LIST_KEY));
    const [storeCollapsed, setStoreCollapsed] = useState(() => readCollapsed(STORE_KEY));
    const [storeMode, setStoreMode] = useState(false);
    const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({});
    const [editing, setEditing] = useState<{ listId: string; item: ShopItem; draft: ItemDraft; moveTo: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    // Reorder mode (v2.0.1): the list whose items show move buttons, and the item being dragged.
    const [arranging, setArranging] = useState<string | null>(null);
    const [dragging, setDragging] = useState<{ listId: string; id: string } | null>(null);

    const toggle = (set: Set<string>, id: string, key: string, apply: (next: Set<string>) => void) => {
        const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id);
        writeCollapsed(key, next); apply(next);
    };
    const run = async (work: () => Promise<void>) => {
        setBusy(true); setError('');
        try { await work(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : t('shopping:google.failed', { defaultValue: 'Google Tasks did not accept the change. Try again.' })); await reload().catch(() => undefined); }
        finally { setBusy(false); }
    };
    const replaceItem = (list: ShopList, item: ShopItem) => onListChange({ ...list, items: list.items.map((i) => (i.id === item.id ? item : i)) });

    const add = (event: FormEvent, list: ShopList) => {
        event.preventDefault();
        const draft = drafts[list.id] ?? EMPTY;
        if (!draft.name.trim()) return;
        void run(async () => {
            const item = await shoppingApi.add(list.id, draft);
            onListChange({ ...list, items: [item, ...list.items] });
            setDrafts((all) => ({ ...all, [list.id]: { ...EMPTY, aisle: draft.aisle } }));
        });
    };
    const check = (list: ShopList, item: ShopItem) => {
        // Ticking is instant on screen; a refused change reloads the list.
        replaceItem(list, { ...item, checked: !item.checked });
        void run(async () => { await shoppingApi.edit(list.id, item.id, { checked: !item.checked }); });
    };
    const saveEdit = (event: FormEvent) => {
        event.preventDefault();
        if (!editing) return;
        const { listId, item, draft, moveTo } = editing;
        void run(async () => {
            await shoppingApi.edit(listId, item.id, { ...draft, ...(moveTo !== listId ? { moveTo } : {}) });
            setEditing(null);
            await reload();
        });
    };
    const remove = () => {
        if (!editing) return;
        const { listId, item } = editing;
        void run(async () => { await shoppingApi.remove(listId, item.id); setEditing(null); await reload(); });
    };
    const openEditor = (list: ShopList, item: ShopItem) => setEditing({ listId: list.id, item, moveTo: list.id,
        draft: { name: item.name, quantity: item.quantity === null ? '' : String(item.quantity), unit: item.unit ?? '', aisle: item.aisle ?? '', notes: item.notes } });
    /** Shows the new order at once and saves it in Google; a refusal reloads the list. */
    const moveTo = (list: ShopList, id: string, to: number) => {
        const result = reorderItems(list.items, id, to);
        if (!result) return;
        onListChange({ ...list, items: result.items });
        void run(async () => { await shoppingApi.move(list.id, id, result.previous); });
    };
    const drop = (event: DragEvent, list: ShopList, target: ShopItem) => {
        event.preventDefault();
        if (!dragging || dragging.listId !== list.id || target.checked) { setDragging(null); return; }
        moveTo(list, dragging.id, list.items.filter((i) => !i.checked).findIndex((i) => i.id === target.id));
        setDragging(null);
    };
    const clear = (list: ShopList) => void run(async () => {
        await shoppingApi.clearChecked(list.id);
        onListChange({ ...list, items: list.items.filter((i) => !i.checked) });
    });

    const remaining = lists.reduce((sum, list) => sum + list.items.filter((i) => !i.checked).length, 0);
    const total = lists.reduce((sum, list) => sum + list.items.length, 0);
    const aisleOptions = useMemo(() => aisles.map((a) => a.label), [aisles]);

    const quantityText = (item: ShopItem) => formatQuantity(item, locale);
    const errorBox = error ? <div role="alert" className="rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-caption text-danger">{error}</div> : null;

    // ─── Store mode: every list collapsible, items grouped by aisle, big targets ───
    if (storeMode) {
        return (
            <div className="mx-auto max-w-2xl space-y-4 pb-28">
                <div className="sticky top-0 z-20 -mx-4 flex items-center gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur-md">
                    <Button variant="ghost" size="sm" onClick={() => setStoreMode(false)} aria-label={t('common:actions.back', { defaultValue: 'Back' })}>
                        <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <div className="flex-1">
                        <h1 className="flex items-center gap-2 text-h2 font-semibold text-foreground"><Store className="h-5 w-5 text-primary" /> {t('shopping:storeMode.title')}</h1>
                        <p className="text-caption text-muted-foreground">{t('shopping:storeMode.cart', { done: total - remaining, total })} · {t('shopping:storeMode.remaining', { count: remaining })}</p>
                    </div>
                </div>
                {errorBox}
                {lists.map((list) => {
                    const open = !storeCollapsed.has(list.id);
                    const left = list.items.filter((i) => !i.checked).length;
                    return (
                        <section key={list.id} className="rounded-card border border-border bg-card shadow-surface">
                            <button type="button" aria-expanded={open} onClick={() => toggle(storeCollapsed, list.id, STORE_KEY, setStoreCollapsed)}
                                className="flex w-full items-center gap-3 px-4 py-3 text-left">
                                <ChevronDown className={`h-5 w-5 flex-shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`} />
                                <span className="flex-1 truncate text-h3 font-semibold text-foreground">{list.title}</span>
                                <span className="rounded-pill bg-primary-soft px-2.5 py-0.5 text-caption font-semibold text-primary">{t('shopping:storeMode.remaining', { count: left })}</span>
                            </button>
                            {open && <div className="space-y-4 border-t border-border px-3 pb-4 pt-3">
                                {list.items.length === 0 ? <p className="px-1 text-caption text-muted-foreground">{t('shopping:storeMode.emptyList')}</p>
                                    : groupByAisle(list.items, aisles, other).map((group) => (
                                        <div key={group.id}>
                                            <h2 className="mb-2 px-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h2>
                                            <div className="space-y-2">{group.items.map((item) => (
                                                <button key={item.id} type="button" onClick={() => check(list, item)} aria-pressed={item.checked}
                                                    className={`flex w-full items-center gap-4 rounded-card border p-4 text-left transition-all active:scale-[0.99] ${item.checked ? 'border-border bg-muted/30 opacity-60' : 'border-border bg-card'}`}>
                                                    <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border-2 ${item.checked ? 'border-primary bg-primary' : 'border-input'}`}>
                                                        {item.checked && <Check className="h-5 w-5 text-white" strokeWidth={3} />}
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className={`block truncate text-body font-medium ${item.checked ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{item.name}</span>
                                                        {(quantityText(item) || item.notes) && <span className="mt-0.5 block truncate text-micro text-muted-foreground">{[quantityText(item), item.notes].filter(Boolean).join(' · ')}</span>}
                                                    </span>
                                                </button>
                                            ))}</div>
                                        </div>
                                    ))}
                            </div>}
                        </section>
                    );
                })}
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-4xl space-y-5">
            {errorBox}
            <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-card bg-primary-soft p-3 text-primary"><ShoppingBag className="h-7 w-7" /></div>
                <div className="min-w-0 flex-1">
                    <h1 className="text-h1 text-foreground">{t('shopping:header.title')}</h1>
                    <p className="text-body text-muted-foreground">{t('shopping:header.remaining', { count: remaining })}</p>
                    <p className="text-micro text-muted-foreground">{t('shopping:google.synced', { defaultValue: 'Synced with Google Tasks' })}</p>
                </div>
                {total > 0 && <Button className="w-full sm:w-auto" onClick={() => setStoreMode(true)}><Store className="mr-1 h-4 w-4" />{t('shopping:storeMode.enter')}</Button>}
            </div>
            {banner}
            {missing > 0 && <p className="rounded-input border border-border bg-muted/40 px-4 py-3 text-caption text-muted-foreground">
                {t('shopping:google.missing', { count: missing, defaultValue: '{{count}} chosen list no longer exists in Google.' })}{isParent ? ` ${t('shopping:google.missingFix', { defaultValue: 'Update the lists in Settings → Household.' })}` : ''}
            </p>}

            {lists.map((list) => {
                const open = !collapsed.has(list.id);
                const left = list.items.filter((i) => !i.checked).length;
                const checked = list.items.length - left;
                const draft = drafts[list.id] ?? EMPTY;
                const setDraft = (patch: Partial<ItemDraft>) => setDrafts((all) => ({ ...all, [list.id]: { ...(all[list.id] ?? EMPTY), ...patch } }));
                return (
                    <section key={list.id} className="rounded-card border border-border bg-card shadow-surface">
                        {/* On a phone the list name has its own row and the actions sit below it (v2.0.2). */}
                        <div className="flex flex-wrap items-center gap-x-2 sm:flex-nowrap sm:pr-2">
                            <button type="button" aria-expanded={open} aria-controls={`shop-${list.id}`} onClick={() => toggle(collapsed, list.id, LIST_KEY, setCollapsed)}
                                className="flex min-w-0 flex-1 basis-full items-center gap-3 px-4 py-3 text-left sm:basis-0">
                                <ChevronDown className={`h-5 w-5 flex-shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`} />
                                <span className="min-w-0 flex-1 truncate text-h3 font-semibold text-foreground">{list.title}</span>
                                <span className="flex-shrink-0 rounded-pill bg-primary-soft px-2.5 py-0.5 text-caption font-semibold text-primary">{left}</span>
                            </button>
                            {open && (left > 1 || checked > 0) && <div className="flex w-full flex-wrap justify-end gap-1 px-2 pb-2 sm:w-auto sm:flex-nowrap sm:p-0">
                                {left > 1 && <Button variant="ghost" size="sm" aria-pressed={arranging === list.id} onClick={() => setArranging(arranging === list.id ? null : list.id)}
                                    title={t('shopping:google.reorderHelp', { defaultValue: 'Move items up or down, or drag them. The order is saved in Google Tasks.' })}>
                                    <ArrowUpDown className="mr-1 h-4 w-4" />{arranging === list.id ? t('shopping:google.reorderDone', { defaultValue: 'Done' }) : t('shopping:google.reorder', { defaultValue: 'Reorder' })}
                                </Button>}
                                {checked > 0 && <Button variant="ghost" size="sm" disabled={busy} onClick={() => clear(list)} title={t('shopping:google.clearHelp', { defaultValue: 'Removes ticked items from the list (Google keeps them in its history).' })}>
                                    <Eraser className="mr-1 h-4 w-4" />{t('shopping:google.clear', { count: checked, defaultValue: 'Clear {{count}} ticked' })}
                                </Button>}
                            </div>}
                        </div>
                        {open && <div id={`shop-${list.id}`} className="space-y-3 border-t border-border px-4 pb-4 pt-3">
                            <form onSubmit={(event) => add(event, list)} className="grid grid-cols-6 gap-2">
                                <input className="col-span-6 min-h-11 rounded-input border border-input bg-background px-3 text-body sm:col-span-3" value={draft.name}
                                    onChange={(e) => setDraft({ name: e.target.value })} placeholder={t('shopping:add.namePlaceholder')} aria-label={t('common:labels.name')} maxLength={200} />
                                <input className="col-span-2 min-h-11 rounded-input border border-input bg-background px-3 text-body sm:col-span-1" value={draft.quantity} inputMode="decimal"
                                    onChange={(e) => setDraft({ quantity: e.target.value })} placeholder={t('shopping:qty')} aria-label={t('shopping:qty')} />
                                <select className="col-span-3 min-h-11 rounded-input border border-input bg-background px-2 text-body sm:col-span-1" value={draft.aisle}
                                    onChange={(e) => setDraft({ aisle: e.target.value })} aria-label={t('shopping:google.aisle', { defaultValue: 'Aisle' })}>
                                    <option value="">{t('shopping:google.aisle', { defaultValue: 'Aisle' })}</option>
                                    {aisleOptions.map((label) => <option key={label} value={label}>{label}</option>)}
                                </select>
                                <Button type="submit" size="icon" className="col-span-1 h-11 w-full px-0" disabled={busy || !draft.name.trim()} aria-label={t('shopping:google.add', { defaultValue: 'Add' })}><Plus className="h-6 w-6 flex-shrink-0" strokeWidth={2.5} /></Button>
                            </form>
                            {list.items.length === 0 ? <p className="py-2 text-center text-caption text-muted-foreground">{t('shopping:storeMode.emptyList')}</p>
                                : <ul className="divide-y divide-border">{list.items.map((item) => {
                                    const openItems = list.items.filter((i) => !i.checked);
                                    const index = openItems.findIndex((i) => i.id === item.id);
                                    const movable = !item.checked && openItems.length > 1;
                                    return (
                                    <li key={item.id} className={`flex items-center gap-3 py-2 ${dragging?.id === item.id ? 'opacity-50' : ''}`}
                                        draggable={movable && !busy}
                                        onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); setDragging({ listId: list.id, id: item.id }); }}
                                        onDragEnd={() => setDragging(null)}
                                        onDragOver={(event) => { if (dragging?.listId === list.id && !item.checked) event.preventDefault(); }}
                                        onDrop={(event) => drop(event, list, item)}>
                                        {movable && <GripVertical className="hidden h-4 w-4 flex-shrink-0 cursor-grab text-muted-foreground/50 sm:block" aria-hidden="true" />}
                                        <button type="button" onClick={() => check(list, item)} aria-pressed={item.checked}
                                            aria-label={item.checked ? t('shopping:google.untick', { name: item.name, defaultValue: 'Untick {{name}}' }) : t('shopping:google.tick', { name: item.name, defaultValue: 'Tick {{name}}' })}
                                            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 ${item.checked ? 'border-primary bg-primary' : 'border-input'}`}>
                                            {item.checked && <Check className="h-4 w-4 text-white" strokeWidth={3} />}
                                        </button>
                                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openEditor(list, item)}>
                                            <span className={`block truncate text-body font-medium ${item.checked ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{item.name}</span>
                                            {(quantityText(item) || item.aisle || item.notes) && <span className="block truncate text-micro text-muted-foreground">{[quantityText(item), item.aisle, item.notes].filter(Boolean).join(' · ')}</span>}
                                        </button>
                                        {arranging === list.id && movable ? <span className="flex flex-shrink-0 gap-1">
                                            <button type="button" className="flex h-9 w-9 items-center justify-center rounded-input border border-border text-muted-foreground hover:text-primary disabled:opacity-40" disabled={busy || index === 0}
                                                aria-label={t('shopping:google.up', { name: item.name, defaultValue: 'Move {{name}} up' })} onClick={() => moveTo(list, item.id, index - 1)}><ArrowUp className="h-4 w-4" /></button>
                                            <button type="button" className="flex h-9 w-9 items-center justify-center rounded-input border border-border text-muted-foreground hover:text-primary disabled:opacity-40" disabled={busy || index === openItems.length - 1}
                                                aria-label={t('shopping:google.down', { name: item.name, defaultValue: 'Move {{name}} down' })} onClick={() => moveTo(list, item.id, index + 1)}><ArrowDown className="h-4 w-4" /></button>
                                        </span>
                                        : <button type="button" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-input text-muted-foreground/70 hover:bg-muted hover:text-primary"
                                            aria-label={t('shopping:google.edit', { name: item.name, defaultValue: 'Edit {{name}}' })} onClick={() => openEditor(list, item)}><Pencil className="h-4 w-4" /></button>}
                                    </li>
                                ); })}</ul>}
                        </div>}
                    </section>
                );
            })}

            <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }} title={t('shopping:google.editTitle', { defaultValue: 'Edit item' })} viewportAware>
                {editing && <form onSubmit={saveEdit} className="space-y-3">
                    <Input label={t('common:labels.name')} value={editing.draft.name} maxLength={200} required
                        onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })} />
                    <div className="grid grid-cols-2 gap-3">
                        <Input label={t('shopping:qty')} value={editing.draft.quantity} inputMode="decimal"
                            onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, quantity: e.target.value } })} />
                        <Input label={t('shopping:google.unit', { defaultValue: 'Unit' })} value={editing.draft.unit} maxLength={20}
                            onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, unit: e.target.value } })} />
                    </div>
                    <label className="block text-label font-medium text-foreground">{t('shopping:google.aisle', { defaultValue: 'Aisle' })}
                        <select className="mt-1 min-h-11 w-full rounded-input border border-input bg-background px-2 text-body" value={editing.draft.aisle}
                            onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, aisle: e.target.value } })}>
                            <option value="">{other}</option>
                            {[...new Set([...aisleOptions, ...(editing.draft.aisle && !aisleOptions.includes(editing.draft.aisle) ? [editing.draft.aisle] : [])])].map((label) => <option key={label} value={label}>{label}</option>)}
                        </select>
                    </label>
                    {lists.length > 1 && <label className="block text-label font-medium text-foreground">{t('shopping:google.list', { defaultValue: 'List' })}
                        <select className="mt-1 min-h-11 w-full rounded-input border border-input bg-background px-2 text-body" value={editing.moveTo}
                            onChange={(e) => setEditing({ ...editing, moveTo: e.target.value })}>
                            {lists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}
                        </select>
                    </label>}
                    <label className="block text-label font-medium text-foreground">{t('shopping:google.notes', { defaultValue: 'Notes' })}
                        <textarea className="mt-1 min-h-20 w-full rounded-input border border-input bg-background px-3 py-2 text-body" value={editing.draft.notes} maxLength={2000}
                            onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, notes: e.target.value } })} />
                    </label>
                    <div className="flex items-center justify-between gap-2 pt-1">
                        <Button type="button" variant="destructive" disabled={busy} onClick={remove}><Trash2 className="mr-1 h-4 w-4" />{t('common:actions.delete', { defaultValue: 'Delete' })}</Button>
                        <div className="flex gap-2">
                            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{t('common:actions.cancel', { defaultValue: 'Cancel' })}</Button>
                            <Button type="submit" disabled={busy || !editing.draft.name.trim()}>{t('common:actions.save', { defaultValue: 'Save' })}</Button>
                        </div>
                    </div>
                </form>}
            </Dialog>
        </div>
    );
}
