import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, ArrowRight, Check, FileUp, HandCoins, Plus, Search, Settings2, Trash2, Users } from 'lucide-react';
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { format, parseISO } from 'date-fns';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { dateLocale } from '../../i18n/format';
import ChartCard from '../../components/app/ChartCard';
import { CATEGORY_GROUPS, CategoryTile, isKnownCategory, useCategoryLabel } from '../../familyhub/budgetCategories';
import { Sheet } from './Sheet';

/**
 * Shared expenses for the Budget page (Family Hub v1.5): who paid, how each
 * expense is split, expense groups, monthly totals per member and settling up.
 * The server does the arithmetic (/api/budget/sharing); these components show it.
 */
export type Member = { id: string; name: string; color: string };
export type Debt = { from: string; to: string; amount: number };
export type Group = { id: string; name: string; members: string[]; archived: boolean; owes: Debt[] };
type Totals = { total: number; members: Array<{ id: string; paid: number; share: number; net: number }>; owes: Debt[] };
export type Sharing = {
    members: Member[]; defaultSharers: string[]; groups: Group[]; ungrouped: { owes: Debt[] };
    month: Totals & { month: string }; balance: Totals;
    settlements: Array<{ id: string; groupId: string | null; from: string; to: string; amount: number; date: string; note: string }>;
    history: Array<{ month: string; total: number; members: Array<{ id: string; paid: number }> }>;
};
export type GroupFilter = 'all' | 'none' | string;
export type SharingValue = { paid_by: string; split_with: string[]; group_id: string };

const input = 'w-full px-3 py-2.5 rounded-xl border border-border bg-surface-1 text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition';
const FILTER_KEY = 'familyhub.budget.group';

export function useSharing(month: string, reloadKey: number) {
    const [group, setGroupState] = useState<GroupFilter>(() => { try { return localStorage.getItem(FILTER_KEY) || 'all'; } catch { return 'all'; } });
    const [data, setData] = useState<Sharing | null>(null);
    const [error, setError] = useState('');
    const setGroup = (next: GroupFilter) => { setGroupState(next); try { localStorage.setItem(FILTER_KEY, next); } catch { /* per session */ } };
    const load = useCallback(async () => {
        try {
            const response = await api.get<{ success: boolean; data: Sharing }>(`/api/budget/sharing?month=${month}&group=${encodeURIComponent(group)}`);
            setData(response.data); setError('');
            // A deleted group falls back to everything.
            if (group !== 'all' && group !== 'none' && !response.data.groups.some((g) => g.id === group)) setGroup('all');
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Shared expenses could not be loaded.'); }
    }, [month, group]);
    useEffect(() => { void load(); }, [load, reloadKey]);
    return { data, error, group, setGroup, reload: load };
}

const nameOf = (data: Sharing | null, id: string) => data?.members.find((m) => m.id === id)?.name ?? '—';
const colorOf = (data: Sharing | null, id: string) => data?.members.find((m) => m.id === id)?.color ?? '#94a3b8';

function Dot({ color }: { color: string }) {
    return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />;
}

function OwesList({ data, owes, currency }: { data: Sharing; owes: Debt[]; currency: string }) {
    const { t } = useTranslation('budget');
    if (!owes.length) return <p className="text-sm text-muted-foreground">{t('sharing.allSettled')}</p>;
    // The amount sits where each language puts it ("Sam owes Alex €5", "Sam doit 5 € à Alex").
    const MARK = '\u0001';
    return <ul className="space-y-1">{owes.map((debt) => {
        const [before, after = ''] = t('sharing.owes', { from: nameOf(data, debt.from), to: nameOf(data, debt.to), amount: MARK }).split(MARK);
        return <li key={`${debt.from}-${debt.to}`} className="flex items-start gap-2 text-base">
            <span className="mt-2"><Dot color={colorOf(data, debt.from)} /></span>
            <span>{before}<strong className="whitespace-nowrap text-success">{formatCurrency(debt.amount, currency)}</strong>{after}</span>
        </li>;
    })}</ul>;
}

/** Group chips: everything, non-group expenses, then each group. */
export function GroupChips({ data, group, onChange, onManage, canEdit }: { data: Sharing; group: GroupFilter; onChange: (g: GroupFilter) => void; onManage: () => void; canEdit: boolean }) {
    const { t } = useTranslation('budget');
    const chip = (key: GroupFilter, label: string) => <button key={key} type="button" onClick={() => onChange(key)}
        className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${group === key ? 'border-primary bg-primary text-white' : 'border-border bg-surface-1 text-foreground'}`}>{label}</button>;
    return <div className="flex gap-2 overflow-x-auto pb-1">
        {chip('all', t('sharing.allGroups'))}
        {chip('none', t('sharing.ungrouped'))}
        {data.groups.filter((g) => !g.archived || g.id === group).map((g) => chip(g.id, g.name))}
        {canEdit && <button type="button" onClick={onManage} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground"><Settings2 className="h-3.5 w-3.5" />{t('sharing.manageGroups')}</button>}
    </div>;
}

/** Classic view: what is still owed (with Settle up) and this month's totals. */
export function SharingSummary({ data, currency, canEdit, onSettle, monthLabel }: { data: Sharing; currency: string; canEdit: boolean; onSettle: () => void; monthLabel: string }) {
    const { t } = useTranslation('budget');
    if (!data.members.length) return <p className="rounded-card border border-border bg-surface-1 p-4 text-sm text-muted-foreground">{t('sharing.needMembers')}</p>;
    const active = data.month.members.filter((m) => m.paid || m.share);
    return <section className="space-y-3 rounded-card border border-border bg-surface-1 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
                <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Users className="h-4 w-4 text-primary" />{t('sharing.outstanding')}</h2>
                <OwesList data={data} owes={data.balance.owes} currency={currency} />
            </div>
            {canEdit && data.members.length > 1 && <button type="button" onClick={onSettle} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold"><HandCoins className="h-4 w-4" />{t('sharing.settleUp')}</button>}
        </div>
        <div className="border-t border-border pt-3">
            <div className="mb-2 flex items-baseline justify-between"><span className="text-sm font-medium capitalize">{monthLabel}</span><span className="text-sm text-muted-foreground">{t('sharing.total')} <strong className="text-foreground">{formatCurrency(data.month.total, currency)}</strong></span></div>
            {active.length ? <ul className="space-y-1.5">{active.map((m) => <li key={m.id} className="flex items-center gap-2 text-sm">
                <Dot color={colorOf(data, m.id)} /><span className="flex-1 truncate">{nameOf(data, m.id)}</span>
                <span className="text-muted-foreground">{t('sharing.paid')} <strong className="text-foreground">{formatCurrency(m.paid, currency)}</strong></span>
                <span className="w-28 text-right text-muted-foreground">{t('sharing.share')} {formatCurrency(m.share, currency)}</span>
            </li>)}</ul> : <p className="text-sm text-muted-foreground">{t('sharing.noShared')}</p>}
        </div>
    </section>;
}

/** Analytics view: who paid this month, what that month alone means, and six months of payers. */
export function SharingAnalytics({ data, currency, monthLabel }: { data: Sharing; currency: string; monthLabel: string }) {
    const { t } = useTranslation('budget');
    const people = data.members.filter((m) => data.history.some((h) => h.members.some((x) => x.id === m.id && x.paid)) || data.month.members.some((x) => x.id === m.id && (x.paid || x.share)));
    const chart = data.history.map((h) => ({ label: format(parseISO(`${h.month}-01`), 'MMM', { locale: dateLocale() }), ...Object.fromEntries(h.members.map((m) => [m.id, m.paid])) }));
    return <>
        <ChartCard title={`${t('sharing.whoPaid')} · ${monthLabel}`} subtitle={`${t('sharing.total')} ${formatCurrency(data.month.total, currency)}`}>
            {data.month.total ? <div className="space-y-2.5">
                {data.month.members.filter((m) => m.paid || m.share).map((m) => {
                    const width = data.month.total ? Math.max(2, Math.round((m.paid / data.month.total) * 100)) : 0;
                    return <div key={m.id}>
                        <div className="mb-1 flex justify-between text-sm"><span className="flex items-center gap-2"><Dot color={colorOf(data, m.id)} />{nameOf(data, m.id)}</span><span><strong>{formatCurrency(m.paid, currency)}</strong> <span className="text-muted-foreground">· {t('sharing.share')} {formatCurrency(m.share, currency)}</span></span></div>
                        <div className="h-2.5 rounded-full bg-surface-2"><div className="h-2.5 rounded-full" style={{ width: `${width}%`, background: colorOf(data, m.id) }} /></div>
                    </div>;
                })}
                <div className="border-t border-border pt-2">
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('sharing.monthOwes', { month: monthLabel })}</p>
                    <OwesList data={data} owes={data.month.owes} currency={currency} />
                </div>
                <div className="border-t border-border pt-2">
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('sharing.outstanding')}</p>
                    <OwesList data={data} owes={data.balance.owes} currency={currency} />
                </div>
            </div> : <p className="text-sm text-muted-foreground">{t('sharing.noShared')}</p>}
        </ChartCard>
        {people.length > 0 && <ChartCard title={t('sharing.lastSixMonths')}>
            <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} width={48} />
                    <Tooltip formatter={(value: number) => formatCurrency(value, currency)} />
                    <Legend />
                    {people.map((m) => <Bar key={m.id} dataKey={m.id} name={m.name} stackId="paid" fill={m.color} />)}
                </BarChart>
            </ResponsiveContainer>
        </ChartCard>}
    </>;
}

/** Records a payment between two members, prefilled with the first debt. */
export function SettleUpSheet({ open, onClose, data, group, currency, onSaved }: { open: boolean; onClose: () => void; data: Sharing; group: GroupFilter; currency: string; onSaved: () => void }) {
    const { t } = useTranslation('budget');
    const first = data.balance.owes[0];
    const [form, setForm] = useState({ from: '', to: '', amount: '', date: format(new Date(), 'yyyy-MM-dd'), note: '' });
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!open) return;
        setError('');
        setForm({ from: first?.from ?? data.members[0]?.id ?? '', to: first?.to ?? data.members[1]?.id ?? '', amount: first ? first.amount.toFixed(2) : '', date: format(new Date(), 'yyyy-MM-dd'), note: '' });
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
    const save = async (event: React.FormEvent) => {
        event.preventDefault(); setBusy(true); setError('');
        try {
            await api.post('/api/budget/settlements', { ...form, group_id: group !== 'all' && group !== 'none' ? group : null });
            onSaved(); onClose();
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'The payment could not be saved.'); }
        finally { setBusy(false); }
    };
    const remove = async (id: string) => {
        if (!confirm(t('sharing.confirmDeletePayment'))) return;
        try { await api.delete(`/api/budget/settlements/${id}`); onSaved(); } catch { /* list stays */ }
    };
    return <Sheet open={open} onClose={onClose} title={t('sharing.settleUp')}>
        <form onSubmit={save} className="space-y-4">
            <div className="rounded-xl bg-surface-2 p-3"><OwesList data={data} owes={data.balance.owes} currency={currency} /></div>
            <p className="text-sm font-medium">{t('sharing.recordPayment')}</p>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                <label className="text-sm">{t('sharing.paymentFrom')}<select className={input} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })}>{data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
                <ArrowRight className="mb-3 h-4 w-4 text-muted-foreground" />
                <label className="text-sm">{t('sharing.paymentTo')}<select className={input} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}>{data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <label className="text-sm">{t('fields.amount', { currency })}<input className={input} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></label>
                <label className="text-sm">{t('fields.date')}<input className={input} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></label>
            </div>
            <label className="block text-sm">{t('sharing.note')}<input className={input} maxLength={200} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <button type="submit" disabled={busy} className="w-full rounded-xl bg-primary py-3 font-semibold text-white disabled:opacity-60"><Check className="mr-1 inline h-4 w-4" />{t('sharing.recordPayment')}</button>
        </form>
        {data.settlements.length > 0 && <div className="mt-6 space-y-2">
            <h3 className="text-sm font-semibold">{t('sharing.payments')}</h3>
            {data.settlements.map((p) => <div key={p.id} className="flex items-center gap-2 rounded-xl border border-border p-2.5 text-sm">
                <span className="w-14 shrink-0 text-muted-foreground">{format(parseISO(p.date), 'dd MMM', { locale: dateLocale() })}</span>
                <span className="flex-1">{nameOf(data, p.from)} → {nameOf(data, p.to)}{p.note ? <span className="text-muted-foreground"> · {p.note}</span> : null}</span>
                <strong>{formatCurrency(p.amount, currency)}</strong>
                <button type="button" onClick={() => void remove(p.id)} aria-label={t('sharing.deletePayment')} className="rounded-lg p-1.5 hover:bg-danger/10"><Trash2 className="h-3.5 w-3.5 text-danger/70" /></button>
            </div>)}
        </div>}
    </Sheet>;
}

function MemberChips({ members, value, onChange }: { members: Member[]; value: string[]; onChange: (v: string[]) => void }) {
    return <div className="flex flex-wrap gap-2">{members.map((m) => {
        const on = value.includes(m.id);
        return <button key={m.id} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((id) => id !== m.id) : [...value, m.id])}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${on ? 'border-primary bg-primary/10 font-medium text-foreground' : 'border-border text-muted-foreground'}`}>
            <Dot color={m.color} />{m.name}{on && <Check className="h-3.5 w-3.5" />}</button>;
    })}</div>;
}

/** Expense groups: create, rename, choose members, archive, delete; plus the family default. */
export function GroupsSheet({ open, onClose, data, onSaved, onImport }: { open: boolean; onClose: () => void; data: Sharing; onSaved: () => void; onImport?: () => void }) {
    const { t } = useTranslation('budget');
    const [editing, setEditing] = useState<{ id?: string; name: string; members: string[]; archived: boolean } | null>(null);
    const [sharers, setSharers] = useState<string[]>(data.defaultSharers);
    const [error, setError] = useState('');
    useEffect(() => { if (open) { setEditing(null); setError(''); setSharers(data.defaultSharers); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
    const run = async (action: () => Promise<unknown>) => {
        setError('');
        try { await action(); onSaved(); setEditing(null); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save.'); }
    };
    const save = () => editing && run(() => editing.id ? api.put(`/api/budget/groups/${editing.id}`, editing) : api.post('/api/budget/groups', editing));
    return <Sheet open={open} onClose={onClose} title={t('sharing.groupsTitle')}>
        <p className="mb-4 text-sm text-muted-foreground">{t('sharing.groupsHint')}</p>
        {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
        {editing ? <div className="space-y-4">
            <label className="block text-sm">{t('sharing.groupName')}<input className={input} maxLength={60} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus /></label>
            <div><p className="mb-2 text-sm">{t('sharing.groupMembers')}</p><MemberChips members={data.members} value={editing.members} onChange={(members) => setEditing({ ...editing, members })} /></div>
            <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void save()} className="rounded-xl bg-primary px-4 py-2.5 font-semibold text-white">{t('sharing.save')}</button>
                <button type="button" onClick={() => setEditing(null)} className="rounded-xl border border-border px-4 py-2.5">{t('sharing.cancel')}</button>
                {editing.id && <button type="button" onClick={() => void run(() => api.put(`/api/budget/groups/${editing.id}`, { ...editing, archived: !editing.archived }))} className="inline-flex items-center gap-1 rounded-xl border border-border px-4 py-2.5"><Archive className="h-4 w-4" />{editing.archived ? t('sharing.unarchive') : t('sharing.archive')}</button>}
                {editing.id && <button type="button" onClick={() => { if (confirm(t('sharing.confirmDeleteGroup'))) void run(() => api.delete(`/api/budget/groups/${editing.id}`)); }} className="inline-flex items-center gap-1 rounded-xl px-4 py-2.5 text-danger"><Trash2 className="h-4 w-4" />{t('sharing.deleteGroup')}</button>}
            </div>
        </div> : <div className="space-y-2">
            {data.groups.map((g) => <button key={g.id} type="button" onClick={() => setEditing({ id: g.id, name: g.name, members: g.members, archived: g.archived })}
                className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Users className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><strong className="block truncate">{g.name}</strong><small className="text-muted-foreground">{g.members.map((id) => nameOf(data, id)).join(', ') || '—'}{g.archived ? ` · ${t('sharing.archived')}` : ''}</small></span>
            </button>)}
            <button type="button" onClick={() => setEditing({ name: '', members: data.defaultSharers, archived: false })} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border p-3 text-sm font-medium"><Plus className="h-4 w-4" />{t('sharing.newGroup')}</button>
            <div className="mt-6 border-t border-border pt-4">
                <p className="mb-2 text-sm font-medium">{t('sharing.defaultSharers')}</p>
                <MemberChips members={data.members} value={sharers} onChange={setSharers} />
                <button type="button" disabled={!sharers.length} onClick={() => void run(() => api.put('/api/budget/sharing/settings', { defaultSharers: sharers }))} className="mt-3 rounded-xl border border-border px-4 py-2 text-sm font-medium disabled:opacity-50">{t('sharing.saveDefault')}</button>
            </div>
            {onImport && <div className="mt-6 border-t border-border pt-4">
                <button type="button" onClick={onImport} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium"><FileUp className="h-4 w-4" />{t('import.open')}</button>
            </div>}
        </div>}
    </Sheet>;
}

/** Transaction form: who paid, who it is split between, and its group. */
export function SharingFields({ data, value, onChange }: { data: Sharing | null; value: SharingValue; onChange: (v: SharingValue) => void }) {
    const { t } = useTranslation('budget');
    if (!data || !data.members.length) return null;
    const group = data.groups.find((g) => g.id === value.group_id);
    const fallback = group?.members.length ? group.members : data.defaultSharers;
    return <div className="space-y-3 rounded-xl border border-border p-3">
        <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">{t('sharing.paidBy')}<select className={input} value={value.paid_by} onChange={(e) => onChange({ ...value, paid_by: e.target.value })}>
                <option value="">{t('sharing.notShared')}</option>{data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            <label className="text-sm">{t('sharing.group')}<select className={input} value={value.group_id} onChange={(e) => onChange({ ...value, group_id: e.target.value })}>
                <option value="">{t('sharing.noGroup')}</option>{data.groups.filter((g) => !g.archived || g.id === value.group_id).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
        </div>
        {value.paid_by && <div>
            <p className="mb-2 text-sm">{t('sharing.splitBetween')}</p>
            <MemberChips members={data.members} value={value.split_with.length ? value.split_with : fallback} onChange={(next) => onChange({ ...value, split_with: next })} />
            <p className="mt-1.5 text-xs text-muted-foreground">{t('sharing.splitHint')}</p>
        </div>}
    </div>;
}

/** "Alex paid CA$44.11 · split 2 ways" under an expense. */
export function PaidInline({ data, entry }: { data: Sharing | null; entry: { amount: number; paid_by?: string | null; split_with?: string[]; group_id?: string | null }; currency: string }) {
    const { t } = useTranslation('budget');
    if (!data || !entry.paid_by) return null;
    const group = data.groups.find((g) => g.id === entry.group_id);
    const people = entry.split_with?.length ? entry.split_with : group?.members.length ? group.members : data.defaultSharers;
    const split = people.length === 1 && people[0] !== entry.paid_by ? t('sharing.forOne', { name: nameOf(data, people[0]) }) : people.length > 1 ? t('sharing.splitWays', { count: people.length }) : '';
    // One line that truncates, so expense rows stay short on a phone.
    return <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"><span className="flex shrink-0"><Dot color={colorOf(data, entry.paid_by)} /></span><span className="truncate">
        {t('sharing.paidInline', { name: nameOf(data, entry.paid_by) })}{split ? ` · ${split}` : ''}{group ? ` · ${group.name}` : ''}</span></span>;
}

/** Category field: the tile and name, opening a searchable, grouped list. */
export function CategoryPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const { t } = useTranslation('budget');
    const label = useCategoryLabel();
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const groups = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return CATEGORY_GROUPS.map((group) => ({ ...group, keys: group.items.map(([key]) => key as string).filter((key) => !needle || label(key).toLowerCase().includes(needle)) }))
            .filter((group) => group.keys.length);
    }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
    return <div>
        <span className="mb-1 block text-sm font-medium text-foreground">{t('fields.category')}</span>
        <button type="button" onClick={() => { setSearch(''); setOpen(true); }} className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface-1 px-3 py-2 text-left">
            <CategoryTile category={value} size={32} /><span className="flex-1">{label(value)}{!isKnownCategory(value) && ' *'}</span>
        </button>
        <Sheet open={open} onClose={() => setOpen(false)} title={t('sharing.category')}>
            <label className="relative mb-4 block"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input className={`${input} pl-9`} value={search} placeholder={t('sharing.search')} onChange={(e) => setSearch(e.target.value)} aria-label={t('sharing.search')} /></label>
            {groups.map((group) => <section key={group.key} className="mb-4">
                <h3 className="mb-1 text-sm font-semibold">{t(`categoryGroups.${group.key}`)}</h3>
                <ul>{group.keys.map((key) => <li key={key}><button type="button" onClick={() => { onChange(key); setOpen(false); }}
                    className={`flex w-full items-center gap-4 border-b border-border py-2 text-left ${key === value ? 'font-semibold' : ''}`}>
                    <CategoryTile category={key} size={44} /><span className="flex-1 text-base">{label(key)}</span>{key === value && <Check className="h-4 w-4 text-primary" />}</button></li>)}</ul>
            </section>)}
        </Sheet>
    </div>;
}
