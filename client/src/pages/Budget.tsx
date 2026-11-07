import React, { useEffect, useState, useCallback } from 'react';
import { useWebSocketUpdates } from '../hooks/useWebSocketUpdates';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../lib/utils';
import {
    Plus, ChevronLeft, ChevronRight, Check, RefreshCw,
    Trash2, TrendingUp, TrendingDown, Wallet, Eye,
    AlertTriangle, Lock
} from 'lucide-react';
import KakeiboView from './budget/KakeiboView';
import { Sheet } from './budget/Sheet';
import { SplitwiseImportSheet } from './budget/SplitwiseImport';
import {
    CategoryPicker, GroupChips, GroupsSheet, PaidInline, SettleUpSheet, SharingAnalytics, SharingFields, SharingSummary,
    useSharing, type Sharing, type SharingValue,
} from './budget/SharedExpenses';
import { CategoryTile, DEFAULT_CATEGORY } from '../familyhub/budgetCategories';
import {
    PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
    ResponsiveContainer, Legend,
} from 'recharts';
import ChartCard from '../components/app/ChartCard';
import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { dateLocale, intlLocale } from '../i18n/format';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecurringTransaction {
    id: string;
    series_id?: string;
    occurrence_id?: string;
    occurrence_date?: string;
    label: string;
    amount: number;
    category: string;
    debit_day: number;
    start_date: string;
    recurrence_frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
    recurrence_interval: number;
    recurrence_until?: string | null;
    is_active: boolean;
    is_expense: boolean;
    is_pointed: boolean;
    pointed_at?: string | null;
    linked_calendar_event_id?: string | null;
    paid_by?: string | null;
    split_with?: string[];
    group_id?: string | null;
}

interface BudgetEntry {
    id: string;
    category: string;
    amount: number;
    description?: string;
    date: string;
    is_expense: boolean;
    linked_calendar_event_id?: string | null;
    paid_by?: string | null;
    split_with?: string[];
    group_id?: string | null;
}

interface Forecast {
    openingBalance: number;
    oneTimeIncome: number;
    oneTimeExpenses: number;
    dueRecurringIncome: number;
    dueRecurringExpenses: number;
    upcomingRecurringIncome: number;
    upcomingRecurringExpenses: number;
    currentBalance: number;
    forecastBalance: number;
}

interface CategoryStat {
    category: string;
    category_total: number;
}

interface BudgetStatistics {
    totalExpenses: number;
    totalIncome: number;
    balance: number;
    byCategory: CategoryStat[];
}

interface MonthlyStat {
    month: number;
    totalExpenses: number;
    totalIncome: number;
    recurringExpenses?: number;
    recurringIncome?: number;
    balance: number;
}

interface BudgetLimit {
    id: string;
    category: string;
    monthly_limit: number;
    month: number;
    year: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CHART_COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

const toNumber = (v: unknown): number => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const n = parseFloat(v); return isFinite(n) ? n : 0; }
    return 0;
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const Field: React.FC<{
    label: string;
    type?: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    required?: boolean;
    min?: string;
    max?: string;
    step?: string;
}> = ({ label, type = 'text', value, onChange, placeholder, required, min, max, step }) => (
    <div>
        <label className="block text-sm font-medium text-foreground mb-1">{label}</label>
        <input
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            required={required}
            min={min}
            max={max}
            step={step}
            className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface-1 text-foreground text-base
                       focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
        />
    </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

const Budget: React.FC = () => {
    const { t } = useTranslation(['budget', 'kakeibo', 'common']);
    const categoryLabel = (v: string) => t(`budget:categories.${v}`, { defaultValue: v });
    const { user } = useAuth();
    const currency = user?.currency || 'EUR';
    const canEdit = Boolean(user?.is_owner) || (user?.role ?? '').toLowerCase() !== 'enfant';

    // Classic budget, analytics, or kakeibo. Persisted per browser so the choice sticks.
    type BudgetMode = 'classic' | 'analytics' | 'kakeibo';
    const [mode, setMode] = useState<BudgetMode>(() => {
        const saved = localStorage.getItem('openfamily.budgetMode');
        return saved === 'analytics' || saved === 'kakeibo' ? saved : 'classic';
    });
    const switchMode = (next: BudgetMode) => {
        setMode(next);
        localStorage.setItem('openfamily.budgetMode', next);
    };

    const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
    const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

    const [forecast, setForecast] = useState<Forecast | null>(null);
    const [recurring, setRecurring] = useState<RecurringTransaction[]>([]);
    const [entries, setEntries] = useState<BudgetEntry[]>([]);
    const [loading, setLoading] = useState(true);

    const [stats, setStats] = useState<BudgetStatistics | null>(null);
    const [monthly, setMonthly] = useState<MonthlyStat[]>([]);
    const [limits, setLimits] = useState<BudgetLimit[]>([]);

    const [sheetTransaction, setSheetTransaction] = useState(false);
    const [sheetLimit, setSheetLimit] = useState(false);
    const [editingRecurring, setEditingRecurring] = useState<RecurringTransaction | null>(null);
    const [editingEntry, setEditingEntry] = useState<BudgetEntry | null>(null);

    const [transactionForm, setTransactionForm] = useState({
        description: '',
        amount: '',
        category: DEFAULT_CATEGORY,
        date: format(new Date(), 'yyyy-MM-dd'),
        is_expense: true,
        recurrence_frequency: 'none' as 'none' | RecurringTransaction['recurrence_frequency'],
        recurrence_interval: '1',
        recurrence_until: '',
    });
    const [limitForm, setLimitForm] = useState({ category: 'groceries', monthly_limit: '' });
    const [formError, setFormError] = useState('');
    const [transactionAddToCalendar, setTransactionAddToCalendar] = useState(false);

    // Shared expenses (Family Hub v1.5): who paid, the split and the group.
    const monthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    const [sharingTick, setSharingTick] = useState(0);
    const sharing = useSharing(monthKey, sharingTick);
    const [shareForm, setShareForm] = useState<SharingValue>({ paid_by: '', split_with: [], group_id: '' });
    const [sheetSettle, setSheetSettle] = useState(false);
    const [sheetGroups, setSheetGroups] = useState(false);
    const [sheetImport, setSheetImport] = useState(false);
    const monthLabel = format(new Date(currentYear, currentMonth - 1), 'MMMM yyyy', { locale: dateLocale() });
    const inGroup = (item: { group_id?: string | null }) => sharing.group === 'all' || (sharing.group === 'none' ? !item.group_id : item.group_id === sharing.group);
    const sharingOf = (item: { paid_by?: string | null; split_with?: string[]; group_id?: string | null }): SharingValue =>
        ({ paid_by: item.paid_by ?? '', split_with: item.split_with ?? [], group_id: item.group_id ?? '' });
    const sharingPayload = () => ({ paid_by: shareForm.paid_by || null, split_with: shareForm.paid_by ? shareForm.split_with : [], group_id: shareForm.group_id || null });

    // Local-date formatting: toISOString() shifts to UTC and can drop the first
    // or last day of the month depending on the user's timezone.
    const startOfMonth = useCallback(() =>
        format(new Date(currentYear, currentMonth - 1, 1), 'yyyy-MM-dd'),
        [currentYear, currentMonth]
    );
    const endOfMonth = useCallback(() =>
        format(new Date(currentYear, currentMonth, 0), 'yyyy-MM-dd'),
        [currentYear, currentMonth]
    );

    const loadAll = useCallback(async () => {
        try {
            const [forecastRes, recurringRes, entriesRes, statsRes, monthlyRes, limitsRes] = await Promise.all([
                api.get<{ success: boolean; data: Forecast }>(
                    `/api/budget/forecast?month=${currentMonth}&year=${currentYear}&as_of=${format(new Date(), 'yyyy-MM-dd')}`
                ),
                api.get<{ success: boolean; data: RecurringTransaction[] }>(
                    `/api/budget/recurring?month=${currentMonth}&year=${currentYear}`
                ),
                api.get<{ success: boolean; data: BudgetEntry[] }>(
                    `/api/budget/entries?start_date=${startOfMonth()}&end_date=${endOfMonth()}`
                ),
                api.get<{ success: boolean; data: BudgetStatistics }>(
                    `/api/budget/statistics?month=${currentMonth}&year=${currentYear}`
                ),
                api.get<{ success: boolean; data: MonthlyStat[] }>(
                    `/api/budget/statistics/monthly?year=${currentYear}`
                ),
                api.get<{ success: boolean; data: BudgetLimit[] }>(
                    `/api/budget/limits?month=${currentMonth}&year=${currentYear}`
                ),
            ]);
            if (forecastRes.success) setForecast(forecastRes.data);
            if (recurringRes.success) setRecurring(recurringRes.data.map((r) => ({
                ...r,
                amount: toNumber(r.amount),
                debit_day: toNumber(r.debit_day),
                recurrence_interval: toNumber(r.recurrence_interval) || 1,
            })));
            if (entriesRes.success) setEntries(entriesRes.data.map((e) => ({
                ...e,
                amount: toNumber(e.amount),
            })));
            if (statsRes.success) setStats(statsRes.data);
            if (monthlyRes.success) setMonthly(monthlyRes.data);
            if (limitsRes.success) setLimits(limitsRes.data.map((l) => ({ ...l, monthly_limit: toNumber(l.monthly_limit) })));
        } catch (err) {
            console.error('Budget load error', err);
        } finally {
            setLoading(false);
        }
    }, [currentMonth, currentYear, startOfMonth, endOfMonth]);

    useEffect(() => { void loadAll(); }, [loadAll]);
    useWebSocketUpdates('budget', () => { void loadAll(); setSharingTick((n) => n + 1); });

    const navigateMonth = (dir: -1 | 1) => {
        let m = currentMonth + dir;
        let y = currentYear;
        if (m < 1) { m = 12; y -= 1; }
        if (m > 12) { m = 1; y += 1; }
        setCurrentMonth(m);
        setCurrentYear(y);
    };

    const handleTogglePoint = async (r: RecurringTransaction) => {
        if (!r.occurrence_date) return;

        const newValue = !r.is_pointed;
        setRecurring((prev) => prev.map((x) => {
            const sameOccurrence = x.occurrence_id && r.occurrence_id
                ? x.occurrence_id === r.occurrence_id
                : x.id === r.id && x.occurrence_date === r.occurrence_date;

            return sameOccurrence ? { ...x, is_pointed: newValue } : x;
        }));

        try {
            await api.post(`/api/budget/recurring/${r.series_id ?? r.id}/point`, {
                occurrence_date: r.occurrence_date,
                is_pointed: newValue,
            });
        } catch {
            void loadAll();
        }
    };

    const openNewTransaction = () => {
        setEditingRecurring(null);
        setEditingEntry(null);
        setTransactionAddToCalendar(false);
        setTransactionForm({
            description: '',
            amount: '',
            category: DEFAULT_CATEGORY,
            date: format(new Date(), 'yyyy-MM-dd'),
            is_expense: true,
            recurrence_frequency: 'none',
            recurrence_interval: '1',
            recurrence_until: '',
        });
        // New expenses join the group being viewed; the payer is chosen each time.
        setShareForm({ paid_by: '', split_with: [], group_id: sharing.group !== 'all' && sharing.group !== 'none' ? sharing.group : '' });
        setFormError('');
        setSheetTransaction(true);
    };

    const openEditRecurring = (r: RecurringTransaction) => {
        setEditingRecurring(r);
        setEditingEntry(null);
        setTransactionAddToCalendar(Boolean(r.linked_calendar_event_id));
        setTransactionForm({
            description: r.label,
            amount: r.amount.toString(),
            category: r.category,
            date: r.start_date,
            is_expense: r.is_expense,
            recurrence_frequency: r.recurrence_frequency,
            recurrence_interval: r.recurrence_interval.toString(),
            recurrence_until: r.recurrence_until ?? '',
        });
        setShareForm(sharingOf(r));
        setFormError('');
        setSheetTransaction(true);
    };

    const openEditEntry = (entry: BudgetEntry) => {
        setEditingRecurring(null);
        setEditingEntry(entry);
        setTransactionAddToCalendar(Boolean(entry.linked_calendar_event_id));
        setTransactionForm({
            description: entry.description || '',
            amount: entry.amount.toString(),
            category: entry.category,
            date: entry.date.split('T')[0],
            is_expense: entry.is_expense,
            recurrence_frequency: 'none',
            recurrence_interval: '1',
            recurrence_until: '',
        });
        setShareForm(sharingOf(entry));
        setFormError('');
        setSheetTransaction(true);
    };

    const handleSaveTransaction = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');

        const amount = parseFloat(transactionForm.amount.replace(',', '.'));
        if (!isFinite(amount) || amount <= 0) {
            setFormError(t('budget:errors.amountInvalid'));
            return;
        }

        if (!transactionForm.date) {
            setFormError(t('budget:errors.startDateRequired'));
            return;
        }

        const isRecurring = transactionForm.recurrence_frequency !== 'none';
        const interval = parseInt(transactionForm.recurrence_interval, 10);

        if (isRecurring && (!Number.isInteger(interval) || interval < 1 || interval > 365)) {
            setFormError(t('budget:errors.intervalInvalid'));
            return;
        }

        if (
            isRecurring &&
            transactionForm.recurrence_until &&
            transactionForm.recurrence_until < transactionForm.date
        ) {
            setFormError(t('budget:errors.repeatUntilInvalid'));
            return;
        }

        // Existing one-time and recurring rows stay in their current storage model.
        // New entries can choose either model from the same form.
        if (editingEntry && isRecurring) {
            setFormError(t('budget:errors.editRecurrenceType'));
            return;
        }
        if (editingRecurring && !isRecurring) {
            setFormError(t('budget:errors.editRecurrenceType'));
            return;
        }

        try {
            if (isRecurring) {
                const payload = {
                    label: transactionForm.description.trim() || transactionForm.category,
                    amount,
                    category: transactionForm.category,
                    start_date: transactionForm.date,
                    recurrence_frequency: transactionForm.recurrence_frequency,
                    recurrence_interval: interval,
                    recurrence_until: transactionForm.recurrence_until || null,
                    is_expense: transactionForm.is_expense,
                    add_to_calendar: transactionAddToCalendar,
                    ...(transactionForm.is_expense ? sharingPayload() : { paid_by: null, split_with: [], group_id: null }),
                };

                if (editingRecurring) {
                    await api.put(
                        `/api/budget/recurring/${editingRecurring.series_id ?? editingRecurring.id}`,
                        payload
                    );
                } else {
                    await api.post('/api/budget/recurring', payload);
                }
            } else {
                const payload = {
                    category: transactionForm.category,
                    amount,
                    description: transactionForm.description,
                    date: transactionForm.date,
                    is_expense: transactionForm.is_expense,
                    add_to_calendar: transactionAddToCalendar,
                    ...(transactionForm.is_expense ? sharingPayload() : { paid_by: null, split_with: [], group_id: null }),
                };

                if (editingEntry) {
                    await api.put(`/api/budget/entries/${editingEntry.id}`, payload);
                } else {
                    await api.post('/api/budget/entries', payload);
                }
            }

            setSheetTransaction(false);
            void loadAll();
            setSharingTick((n) => n + 1);
        } catch (err) {
            setFormError(err instanceof Error ? err.message : t('budget:errors.save'));
        }
    };

    const handleDeleteRecurring = async (id: string) => {
        if (!confirm(t('budget:confirm.deleteRecurring'))) return;
        try { await api.delete(`/api/budget/recurring/${id}`); setSheetTransaction(false); void loadAll(); } catch { /* ignore */ }
    };

    const handleDeleteEntry = async (id: string) => {
        if (!confirm(t('budget:confirm.deleteEntry'))) return;
        try { await api.delete(`/api/budget/entries/${id}`); setSheetTransaction(false); void loadAll(); } catch { /* ignore */ }
    };

    const openLimitSheet = (category?: string) => {
        const existing = category ? limits.find((l) => l.category === category) : undefined;
        setLimitForm({
            category: category || 'groceries',
            monthly_limit: existing ? existing.monthly_limit.toString() : '',
        });
        setFormError('');
        setSheetLimit(true);
    };

    const handleSaveLimit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');
        const limit = parseFloat(limitForm.monthly_limit.replace(',', '.'));
        if (!isFinite(limit) || limit < 0) { setFormError(t('budget:errors.limitInvalid')); return; }
        try {
            await api.post('/api/budget/limits', {
                category: limitForm.category,
                monthly_limit: limit,
                month: currentMonth,
                year: currentYear,
            });
            setSheetLimit(false);
            void loadAll();
        } catch (err) {
            setFormError(err instanceof Error ? err.message : t('budget:errors.save'));
        }
    };

    // Spending per category this month, including recurring expense occurrences.
    const spentByCategory = React.useMemo(() => {
        const map: Record<string, number> = {};
        for (const e of entries) {
            if (e.is_expense) map[e.category] = (map[e.category] || 0) + e.amount;
        }
        for (const r of recurring) {
            if (r.is_expense) map[r.category] = (map[r.category] || 0) + r.amount;
        }
        return map;
    }, [entries, recurring]);

    const limitAlerts = limits
        .map((l) => ({ ...l, spent: spentByCategory[l.category] || 0 }))
        .filter((l) => l.monthly_limit > 0 && l.spent >= l.monthly_limit * 0.8);

    const expenses = entries.filter((e) => e.is_expense && inGroup(e));
    const incomes = entries.filter((e) => !e.is_expense);
    const shownRecurring = recurring.filter((r) => !r.is_expense || inGroup(r));
    const pointedCount = recurring.filter((r) => r.is_pointed).length;

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center min-h-[50vh]">
                <div className="flex flex-col items-center gap-4">
                    <div className="spinner-brand" />
                    <p className="text-muted-foreground font-medium animate-pulse">{t('budget:loading')}</p>
                </div>
            </div>
        );
    }

    const balancePositive = (forecast?.currentBalance ?? 0) >= 0;
    const forecastPositive = (forecast?.forecastBalance ?? 0) >= 0;

    return (
        <div className="max-w-2xl mx-auto pb-24">

            {/* Navigation mois */}
            <div className="flex items-center justify-between px-4 py-3 sticky top-0 bg-background/80 backdrop-blur-md z-10 border-b border-border">
                <button
                    onClick={() => navigateMonth(-1)}
                    className="p-2 rounded-full hover:bg-surface-2 active:scale-95 transition-all"
                >
                    <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="text-lg font-semibold capitalize">
                    {format(new Date(currentYear, currentMonth - 1), 'MMMM yyyy', { locale: dateLocale() })}
                </span>
                <button
                    onClick={() => navigateMonth(1)}
                    className="p-2 rounded-full hover:bg-surface-2 active:scale-95 transition-all"
                >
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>

            {/* Budget view switch: classic, analytics, kakeibo */}
            <div className="px-4 pt-4">
                <div className="flex gap-1 rounded-input border border-border bg-surface-2 p-1">
                    <button
                        type="button"
                        onClick={() => switchMode('classic')}
                        className={`flex-1 rounded-input px-3 py-1.5 text-sm font-medium transition ${
                            mode === 'classic' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {t('budget:classic')}
                    </button>
                    <button
                        type="button"
                        onClick={() => switchMode('analytics')}
                        className={`flex-1 rounded-input px-3 py-1.5 text-sm font-medium transition ${
                            mode === 'analytics' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {t('budget:analytics')}
                    </button>
                    <button
                        type="button"
                        onClick={() => switchMode('kakeibo')}
                        className={`flex-1 rounded-input px-3 py-1.5 text-sm font-medium transition ${
                            mode === 'kakeibo' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {t('kakeibo:mode.kakeibo')}
                    </button>
                </div>
            </div>

            {mode === 'kakeibo' && (
                <div className="px-4 pt-3">
                    <KakeiboView
                        month={currentMonth}
                        year={currentYear}
                        canEdit={canEdit}
                        currency={currency}
                        categoryLabel={categoryLabel}
                        reloadKey={entries.length + recurring.length}
                    />
                </div>
            )}

            {mode === 'classic' && canEdit && (
                <div className="px-4 pt-4 flex justify-end">
                    <button
                        type="button"
                        onClick={openNewTransaction}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white active:scale-95 transition-transform"
                    >
                        <Plus className="w-4 h-4" />
                        {t('common:actions.add')}
                    </button>
                </div>
            )}

            {mode === 'analytics' && (
                <div className="px-4 pt-4 space-y-3">
                    {sharing.data && <GroupChips data={sharing.data} group={sharing.group} onChange={sharing.setGroup} onManage={() => setSheetGroups(true)} canEdit={canEdit} />}
                    {sharing.data && <SharingAnalytics data={sharing.data} currency={currency} monthLabel={monthLabel} />}
                            {/* Répartition par catégorie */}
                            <ChartCard
                                title={t('budget:charts.expensesByCategory')}
                                subtitle={format(new Date(currentYear, currentMonth - 1), 'MMMM yyyy', { locale: dateLocale() })}
                            >
                                {stats && stats.byCategory.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={240}>
                                        <PieChart>
                                            <Pie
                                                data={stats.byCategory}
                                                dataKey="category_total"
                                                nameKey="category"
                                                cx="50%"
                                                cy="50%"
                                                outerRadius={80}
                                                label={(e: any) => categoryLabel(e.category)}
                                            >
                                                {stats.byCategory.map((_, i) => (
                                                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip formatter={(v: number) => formatCurrency(v, currency)} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <p className="text-sm text-muted-foreground text-center py-8">{t('budget:charts.noExpenses')}</p>
                                )}
                            </ChartCard>

                            {/* Évolution mensuelle */}
                            <ChartCard title={t('budget:charts.yearEvolution')} subtitle={`${currentYear}`}>
                                <ResponsiveContainer width="100%" height={240}>
                                    <BarChart data={monthly.map((m) => ({
                                        month: format(new Date(currentYear, m.month - 1), 'MMM', { locale: dateLocale() }),
                                        expenses: m.totalExpenses,
                                        income: m.totalIncome,
                                    }))}>
                                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                                        <YAxis tick={{ fontSize: 11 }} width={40} />
                                        <Tooltip formatter={(v: number) => formatCurrency(v, currency)} />
                                        <Legend wrapperStyle={{ fontSize: 12 }} />
                                        <Bar dataKey="income" name={t('budget:charts.income')} fill="#10b981" radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="expenses" name={t('budget:charts.expenses')} fill="#ef4444" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </ChartCard>

                            {/* Plafonds par catégorie */}
                            <ChartCard
                                title={t('budget:limits.title')}
                                subtitle={t('budget:limits.subtitle')}
                                action={canEdit ? (
                                    <button
                                        onClick={() => openLimitSheet()}
                                        className="flex items-center gap-1 text-sm font-medium text-primary active:scale-95 transition-transform"
                                    >
                                        <Plus className="w-4 h-4" /> {t('budget:limits.define')}
                                    </button>
                                ) : undefined}
                            >
                                {limits.length === 0 ? (
                                    <p className="text-sm text-muted-foreground text-center py-6">
                                        {t('budget:limits.none')}
                                    </p>
                                ) : (
                                    <div className="space-y-3">
                                        {limits.map((l) => {
                                            const spent = spentByCategory[l.category] || 0;
                                            const ratio = l.monthly_limit > 0 ? Math.min(spent / l.monthly_limit, 1) : 0;
                                            const over = spent >= l.monthly_limit && l.monthly_limit > 0;
                                            const warn = ratio >= 0.8 && !over;
                                            return (
                                                <button
                                                    key={l.id}
                                                    onClick={() => canEdit && openLimitSheet(l.category)}
                                                    className="w-full text-left"
                                                    disabled={!canEdit}
                                                >
                                                    <div className="flex items-center justify-between text-sm mb-1">
                                                        <span className="font-medium">{categoryLabel(l.category)}</span>
                                                        <span className={over ? 'text-danger font-semibold' : warn ? 'text-warning' : 'text-muted-foreground'}>
                                                            {formatCurrency(spent, currency)} / {formatCurrency(l.monthly_limit, currency)}
                                                        </span>
                                                    </div>
                                                    <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                                                        <div
                                                            className={`h-full rounded-full transition-all ${over ? 'bg-danger/100' : warn ? 'bg-warning/100' : 'bg-success/100'}`}
                                                            style={{ width: `${ratio * 100}%` }}
                                                        />
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </ChartCard>
                </div>
            )}

            <div className="px-4 pt-4 space-y-3" style={{ display: mode === 'classic' ? undefined : 'none' }}>

                {/* Bannière lecture seule (enfant) */}
                {!canEdit && (
                    <div className="rounded-card bg-warning/10 border border-warning/30 p-3 flex items-center gap-2">
                        <Lock className="w-4 h-4 text-warning flex-shrink-0" />
                        <p className="text-sm text-warning">
                            {t('budget:readOnly')}
                        </p>
                    </div>
                )}

                {/* Shared expenses: group filter, what is owed, this month's payers */}
                {sharing.data && <GroupChips data={sharing.data} group={sharing.group} onChange={sharing.setGroup} onManage={() => setSheetGroups(true)} canEdit={canEdit} />}
                {sharing.data && <SharingSummary data={sharing.data} currency={currency} canEdit={canEdit} onSettle={() => setSheetSettle(true)} monthLabel={monthLabel} />}
                {sharing.error && <p className="text-sm text-danger">{sharing.error}</p>}

                {/* Alertes de plafond */}
                {limitAlerts.length > 0 && (
                    <div className="rounded-card bg-danger/10 border border-danger/20 p-3 space-y-1.5">
                        <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-danger flex-shrink-0" />
                            <p className="text-sm font-medium text-danger">{t('budget:alerts.title')}</p>
                        </div>
                        {limitAlerts.map((l) => (
                            <p key={l.id} className="text-xs text-danger/80 pl-6">
                                {categoryLabel(l.category)} : {formatCurrency(l.spent, currency)} / {formatCurrency(l.monthly_limit, currency)}
                                {l.spent >= l.monthly_limit ? t('budget:alerts.over') : t('budget:alerts.warn')}
                            </p>
                        ))}
                    </div>
                )}


                {/* Prélèvements récurrents */}
                <section>
                    <div className="flex items-center justify-between mb-2 mt-4">
                        <div className="flex items-center gap-2">
                            <RefreshCw className="w-4 h-4 text-muted-foreground" />
                            <h2 className="font-semibold text-base">{t('budget:sections.recurring')}</h2>
                            {recurring.length > 0 && (
                                <span className="text-xs bg-surface-2 text-muted-foreground px-2 py-0.5 rounded-full">
                                    {pointedCount}/{recurring.length}
                                </span>
                            )}
                        </div>
                    </div>

                    {shownRecurring.length === 0 ? (
                        <div className="rounded-card border border-dashed border-border p-6 text-center">
                            <RefreshCw className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
                            <p className="text-sm text-muted-foreground">{t('budget:recurring.empty')}</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1">
                            {shownRecurring.map((r) => {
                                const when = r.occurrence_date
                                    ? new Date(`${r.occurrence_date}T00:00:00`).toLocaleDateString(intlLocale(), { month: 'short', day: 'numeric' })
                                    : `${t('budget:recurring.dayPrefix')} ${r.debit_day}`;
                                const body = <>
                                    <CategoryTile category={r.category} size={30} />
                                    <span className="min-w-0 flex-1">
                                        <span className={`block truncate text-sm font-medium ${r.is_pointed ? 'line-through text-muted-foreground' : ''}`}>{r.label}</span>
                                        {r.is_expense && r.paid_by && sharing.data
                                            ? <PaidInline data={sharing.data} entry={r} currency={currency} />
                                            : <span className="block truncate text-xs text-muted-foreground">{categoryLabel(r.category)}</span>}
                                    </span>
                                    <span className="flex shrink-0 flex-col items-end">
                                        <span className={`whitespace-nowrap text-sm font-semibold ${r.is_pointed ? 'text-muted-foreground' : r.is_expense ? 'text-danger' : 'text-success'}`}>
                                            {r.is_expense ? '-' : '+'}{formatCurrency(r.amount, currency)}
                                        </span>
                                        <span className="whitespace-nowrap text-[11px] text-muted-foreground">{when} · {t(`budget:recurring.frequency.${r.recurrence_frequency}`)}</span>
                                    </span>
                                </>;
                                return (
                                    <div key={r.occurrence_id ?? `${r.id}:${r.occurrence_date ?? r.debit_day}`}
                                        className={`flex items-center gap-2 pl-2.5 ${r.is_pointed ? 'opacity-60' : ''}`}>
                                        <button
                                            onClick={() => handleTogglePoint(r)}
                                            disabled={!canEdit}
                                            className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all active:scale-90 disabled:opacity-50
                                                ${r.is_pointed ? 'bg-success/100 border-success' : 'border-border hover:border-success/50'}`}
                                            title={r.is_pointed ? t('budget:recurring.markOff') : t('budget:recurring.markOn')}
                                            aria-label={r.is_pointed ? t('budget:recurring.markOff') : t('budget:recurring.markOn')}
                                        >
                                            {r.is_pointed && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                                        </button>
                                        {canEdit
                                            ? <button type="button" onClick={() => openEditRecurring(r)} aria-label={`${t('common:actions.edit')}: ${r.label}`}
                                                className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-3 text-left hover:bg-surface-2 active:bg-surface-2 transition-colors">{body}</button>
                                            : <div className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-3">{body}</div>}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>

                {/* Dépenses ponctuelles */}
                <section>
                    <div className="flex items-center justify-between mb-2 mt-4">
                        <div className="flex items-center gap-2">
                            <TrendingDown className="w-4 h-4 text-danger" />
                            <h2 className="font-semibold text-base">{t('budget:sections.expenses')}</h2>
                            {expenses.length > 0 && (
                                <span className="text-xs bg-danger/10 text-danger px-2 py-0.5 rounded-full font-medium">
                                    -{formatCurrency(expenses.reduce((s, e) => s + e.amount, 0), currency)}
                                </span>
                            )}
                        </div>
                    </div>

                    {expenses.length === 0 ? (
                        <div className="rounded-card border border-dashed border-border p-5 text-center">
                            <p className="text-sm text-muted-foreground">{t('budget:empty.expenses')}</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1">
                            {expenses.map((entry) => (
                                <EntryRow
                                    key={entry.id}
                                    entry={entry}
                                    sharing={sharing.data}
                                    currency={currency}
                                    canEdit={canEdit}
                                    onEdit={openEditEntry}
                                />
                            ))}
                        </div>
                    )}
                </section>

                {/* Revenus */}
                <section>
                    <div className="flex items-center justify-between mb-2 mt-4">
                        <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-success" />
                            <h2 className="font-semibold text-base">{t('budget:sections.income')}</h2>
                            {incomes.length > 0 && (
                                <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full font-medium">
                                    +{formatCurrency(incomes.reduce((s, e) => s + e.amount, 0), currency)}
                                </span>
                            )}
                        </div>
                    </div>

                    {incomes.length === 0 ? (
                        <div className="rounded-card border border-dashed border-border p-5 text-center">
                            <p className="text-sm text-muted-foreground">{t('budget:empty.income')}</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1">
                            {incomes.map((entry) => (
                                <EntryRow
                                    key={entry.id}
                                    entry={entry}
                                    sharing={sharing.data}
                                    currency={currency}
                                    canEdit={canEdit}
                                    onEdit={openEditEntry}
                                />
                            ))}
                        </div>
                    )}
                </section>

                {/* Current balance and forecast (v1.5.2: compact, at the bottom) */}
                <section className="mt-4 divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1 text-sm">
                    <div className="flex items-center gap-2.5 px-3 py-2.5">
                        <Wallet className={`w-4 h-4 shrink-0 ${balancePositive ? 'text-success' : 'text-danger'}`} />
                        <span className="min-w-0 flex-1">
                            <span className="block font-medium">{t('budget:balance.current')}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                                {t('budget:balance.opening', { amount: formatCurrency(forecast?.openingBalance ?? 0, currency) })}
                                {' '}· {t('budget:balance.pointed', { count: pointedCount })}
                            </span>
                        </span>
                        <span className={`shrink-0 whitespace-nowrap text-base font-semibold ${balancePositive ? 'text-success' : 'text-danger'}`}>{formatCurrency(forecast?.currentBalance ?? 0, currency)}</span>
                    </div>
                    {forecast && (forecast.upcomingRecurringExpenses > 0 || forecast.upcomingRecurringIncome > 0) && (
                        <div className="flex items-center gap-2.5 px-3 py-2.5">
                            <Eye className={`w-4 h-4 shrink-0 ${forecastPositive ? 'text-info' : 'text-peach'}`} />
                            <span className="min-w-0 flex-1">
                                <span className="block font-medium">{t('budget:forecast.title')}</span>
                                <span className="block truncate text-xs text-muted-foreground">{t('budget:forecast.subtitle', {
                                    income: formatCurrency(forecast.upcomingRecurringIncome, currency),
                                    expenses: formatCurrency(forecast.upcomingRecurringExpenses, currency),
                                })}</span>
                            </span>
                            <span className={`shrink-0 whitespace-nowrap text-base font-semibold ${forecastPositive ? 'text-info' : 'text-peach'}`}>{formatCurrency(forecast.forecastBalance, currency)}</span>
                        </div>
                    )}
                </section>

            </div>

            {/* Unified Budget entry sheet */}
            <Sheet
                open={sheetTransaction}
                onClose={() => setSheetTransaction(false)}
                title={
                    editingRecurring || editingEntry
                        ? t('budget:sheets.edit')
                        : t('budget:sheets.new')
                }
            >
                <form onSubmit={handleSaveTransaction} className="space-y-4">
                    {formError && (
                        <div className="rounded-xl bg-danger/10 border border-danger/20 px-3 py-2 text-sm text-danger">
                            {formError}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-foreground mb-1">
                            {t('budget:fields.type')}
                        </label>
                        <div className="flex rounded-xl overflow-hidden border border-border">
                            <button
                                type="button"
                                onClick={() => setTransactionForm((f) => ({ ...f, is_expense: true }))}
                                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                                    transactionForm.is_expense
                                        ? 'bg-danger/100 text-white'
                                        : 'bg-surface-1 text-muted-foreground'
                                }`}
                            >
                                {t('budget:toggle.expense')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setTransactionForm((f) => ({ ...f, is_expense: false }))}
                                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                                    !transactionForm.is_expense
                                        ? 'bg-success/100 text-white'
                                        : 'bg-surface-1 text-muted-foreground'
                                }`}
                            >
                                {t('budget:toggle.income')}
                            </button>
                        </div>
                    </div>

                    <Field
                        label={t('budget:fields.description')}
                        value={transactionForm.description}
                        onChange={(v) => setTransactionForm((f) => ({ ...f, description: v }))}
                        placeholder={t('budget:fields.descriptionPlaceholder')}
                    />

                    <Field
                        label={t('budget:fields.amount', { currency })}
                        type="number"
                        value={transactionForm.amount}
                        onChange={(v) => setTransactionForm((f) => ({ ...f, amount: v }))}
                        placeholder="0.00"
                        step="0.01"
                        min="0.01"
                        required
                    />

                    <CategoryPicker
                        value={transactionForm.category}
                        onChange={(v) => setTransactionForm((f) => ({ ...f, category: v }))}
                    />

                    {transactionForm.is_expense && <SharingFields data={sharing.data} value={shareForm} onChange={setShareForm} />}

                    <Field
                        label={
                            transactionForm.recurrence_frequency === 'none'
                                ? t('budget:fields.date')
                                : t('budget:fields.startDate')
                        }
                        type="date"
                        value={transactionForm.date}
                        onChange={(v) => setTransactionForm((f) => ({ ...f, date: v }))}
                        required
                    />

                    <div>
                        <label className="block text-sm font-medium text-foreground mb-1">
                            {t('budget:fields.repeat')}
                        </label>
                        <select
                            value={transactionForm.recurrence_frequency}
                            onChange={(e) => setTransactionForm((f) => ({
                                ...f,
                                recurrence_frequency: e.target.value as typeof f.recurrence_frequency,
                            }))}
                            className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface-1 text-foreground text-base
                                       focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
                        >
                            {!editingRecurring && (
                                <option value="none">{t('budget:recurring.frequency.none')}</option>
                            )}
                            {!editingEntry && (
                                <>
                                    <option value="daily">{t('budget:recurring.frequency.daily')}</option>
                                    <option value="weekly">{t('budget:recurring.frequency.weekly')}</option>
                                    <option value="monthly">{t('budget:recurring.frequency.monthly')}</option>
                                    <option value="yearly">{t('budget:recurring.frequency.yearly')}</option>
                                </>
                            )}
                        </select>
                    </div>

                    {transactionForm.recurrence_frequency !== 'none' && (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-foreground mb-1">
                                    {t('budget:fields.every')}
                                </label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="number"
                                        value={transactionForm.recurrence_interval}
                                        onChange={(e) => setTransactionForm((f) => ({
                                            ...f,
                                            recurrence_interval: e.target.value,
                                        }))}
                                        min="1"
                                        max="365"
                                        step="1"
                                        required
                                        className="w-24 px-3 py-2.5 rounded-xl border border-border bg-surface-1 text-foreground text-base
                                                   focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
                                    />
                                    <span className="text-sm text-muted-foreground">
                                        {t(`budget:recurring.units.${transactionForm.recurrence_frequency}`, {
                                            count: parseInt(transactionForm.recurrence_interval, 10) || 1,
                                        })}
                                    </span>
                                </div>
                            </div>

                            <Field
                                label={t('budget:fields.repeatUntil')}
                                type="date"
                                value={transactionForm.recurrence_until}
                                onChange={(v) => setTransactionForm((f) => ({
                                    ...f,
                                    recurrence_until: v,
                                }))}
                                min={transactionForm.date}
                            />
                        </>
                    )}

                    <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-border bg-surface-2/40 p-3">
                        <input
                            type="checkbox"
                            checked={transactionAddToCalendar}
                            onChange={(e) => setTransactionAddToCalendar(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        />
                        <span>
                            <span className="block text-sm font-medium">
                                {t('budget:fields.addToCalendar')}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                                {t('budget:fields.addToCalendarHint')}
                            </span>
                        </span>
                    </label>

                    <div className="flex gap-3 pt-2">
                        {(editingRecurring || editingEntry) && (
                            <button
                                type="button"
                                onClick={() => editingRecurring
                                    ? void handleDeleteRecurring(editingRecurring.series_id ?? editingRecurring.id)
                                    : editingEntry && void handleDeleteEntry(editingEntry.id)}
                                title={t('common:actions.delete')}
                                aria-label={t('common:actions.delete')}
                                className="flex w-12 flex-shrink-0 items-center justify-center rounded-xl border border-danger/30 text-danger active:scale-95 transition-transform"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setSheetTransaction(false)}
                            className="flex-1 py-3 rounded-xl border border-border text-foreground font-medium active:scale-95 transition-transform"
                        >
                            {t('common:actions.cancel')}
                        </button>
                        <button
                            type="submit"
                            className="flex-1 py-3 rounded-xl bg-primary text-white font-medium active:scale-95 transition-transform"
                        >
                            {editingRecurring || editingEntry
                                ? t('common:actions.save')
                                : t('common:actions.add')}
                        </button>
                    </div>
                </form>
            </Sheet>

            {/* Sheet : plafond de catégorie */}
            <Sheet
                open={sheetLimit}
                onClose={() => setSheetLimit(false)}
                title={t('budget:sheets.limit')}
            >
                <form onSubmit={handleSaveLimit} className="space-y-4">
                    {formError && (
                        <div className="rounded-xl bg-danger/10 border border-danger/20 px-3 py-2 text-sm text-danger">
                            {formError}
                        </div>
                    )}
                    <CategoryPicker
                        value={limitForm.category}
                        onChange={(v) => setLimitForm((f) => ({ ...f, category: v }))}
                    />
                    <Field
                        label={t('budget:fields.limit', { currency })}
                        type="number"
                        value={limitForm.monthly_limit}
                        onChange={(v) => setLimitForm((f) => ({ ...f, monthly_limit: v }))}
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                        required
                    />
                    <p className="text-xs text-muted-foreground">
                        {t('budget:fields.limitHint')}
                    </p>
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={() => setSheetLimit(false)}
                            className="flex-1 py-3 rounded-xl border border-border text-foreground font-medium active:scale-95 transition-transform"
                        >
                            {t('common:actions.cancel')}
                        </button>
                        <button
                            type="submit"
                            className="flex-1 py-3 rounded-xl bg-primary text-white font-medium active:scale-95 transition-transform"
                        >
                            {t('common:actions.save')}
                        </button>
                    </div>
                </form>
            </Sheet>

            {sharing.data && <SettleUpSheet open={sheetSettle} onClose={() => setSheetSettle(false)} data={sharing.data} group={sharing.group} currency={currency} onSaved={() => setSharingTick((n) => n + 1)} />}
            {sharing.data && <GroupsSheet open={sheetGroups} onClose={() => setSheetGroups(false)} data={sharing.data} onSaved={() => { setSharingTick((n) => n + 1); void loadAll(); }}
                onImport={canEdit ? () => { setSheetGroups(false); setSheetImport(true); } : undefined} />}
            {sharing.data && canEdit && <SplitwiseImportSheet open={sheetImport} onClose={() => setSheetImport(false)} data={sharing.data} currency={currency}
                onImported={() => { setSharingTick((n) => n + 1); void loadAll(); }} />}
        </div>
    );
};

// ─── Entry Row ────────────────────────────────────────────────────────────────

const EntryRow: React.FC<{
    entry: BudgetEntry;
    sharing?: Sharing | null;
    currency: string;
    canEdit?: boolean;
    onEdit: (e: BudgetEntry) => void;
}> = ({ entry, sharing = null, currency, canEdit = true, onEdit }) => {
    const { t } = useTranslation('budget');
    const categoryLabel = (v: string) => t(`categories.${v}`, { defaultValue: v });
    // parseISO treats date-only strings ("yyyy-MM-dd") as local midnight,
    // avoiding the previous-day shift that new Date() (UTC midnight) causes.
    const date = parseISO(entry.date);
    const title = entry.description || categoryLabel(entry.category);
    // One compact line per expense, like an expense-sharing app: date, tile,
    // what and who paid, amount. Tap the row to edit (delete is in the sheet).
    const body = <>
        <span className="flex w-7 shrink-0 flex-col items-center leading-none text-muted-foreground">
            <span className="text-[10px] uppercase tracking-wide">{format(date, 'MMM', { locale: dateLocale() }).replace('.', '')}</span>
            <span className="mt-0.5 text-base font-medium text-foreground">{format(date, 'd')}</span>
        </span>
        <CategoryTile category={entry.category} size={30} />
        <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{title}</span>
            {entry.is_expense && entry.paid_by && sharing
                ? <PaidInline data={sharing} entry={entry} currency={currency} />
                : entry.description ? <span className="block truncate text-xs text-muted-foreground">{categoryLabel(entry.category)}</span> : null}
        </span>
        <span className={`shrink-0 whitespace-nowrap text-sm font-semibold ${entry.is_expense ? 'text-danger' : 'text-success'}`}>
            {entry.is_expense ? '-' : '+'}{formatCurrency(entry.amount, currency)}
        </span>
    </>;
    const layout = 'flex w-full items-center gap-2.5 px-2.5 py-2 text-left';
    return canEdit
        ? <button type="button" onClick={() => onEdit(entry)} aria-label={`${t('common:actions.edit', { defaultValue: 'Edit' })}: ${title}`}
            className={`${layout} hover:bg-surface-2 active:bg-surface-2 transition-colors`}>{body}</button>
        : <div className={layout}>{body}</div>;
};

export default Budget;
