import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileUp } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { dateLocale } from '../../i18n/format';
import { Sheet } from './Sheet';
import type { Sharing } from './SharedExpenses';
import { guessMembers, parseSplitwise, planImport, type ImportPlan, type SplitwiseFile } from './splitwise';

/**
 * Budget → Import from Splitwise (v1.5). The file is read in this browser; only
 * the mapped expenses and payments are sent to the Family Hub server, in
 * batches that the server de-duplicates, so importing twice adds nothing.
 */
const input = 'w-full px-3 py-2 rounded-xl border border-border bg-surface-1 text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary/40';
// Starting points only (to the Canadian dollar); the household can edit them.
const SUGGESTED_RATES: Record<string, Record<string, number>> = {
    CAD: { USD: 1.36, INR: 0.0164, EUR: 1.47, GBP: 1.72 },
    EUR: { USD: 0.92, INR: 0.011, CAD: 0.68, GBP: 1.17 },
    USD: { CAD: 0.74, INR: 0.012, EUR: 1.08, GBP: 1.27 },
};
const BATCH = 900;

export function SplitwiseImportSheet({ open, onClose, data, currency, onImported }: {
    open: boolean; onClose: () => void; data: Sharing; currency: string; onImported: () => void;
}) {
    const { t } = useTranslation('budget');
    const [file, setFile] = useState<SplitwiseFile | null>(null);
    const [people, setPeople] = useState<string[]>([]);
    const [rates, setRates] = useState<Record<string, string>>({});
    const [error, setError] = useState('');
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [result, setResult] = useState<{ expenses: number; settlements: number; skipped: number } | null>(null);
    const home = currency.toUpperCase();

    const reset = () => { setFile(null); setPeople([]); setRates({}); setError(''); setProgress(null); setResult(null); };
    const read = async (picked: File | undefined) => {
        reset();
        if (!picked) return;
        try {
            const parsed = parseSplitwise(await picked.text());
            setFile(parsed);
            setPeople(guessMembers(parsed.people, data.members));
            setRates(Object.fromEntries(parsed.currencies.filter((c) => c !== home).map((c) => [c, String(SUGGESTED_RATES[home]?.[c] ?? '')])));
        } catch (cause) { setError(cause instanceof Error ? cause.message : t('import.unreadable')); }
    };
    const plan = useMemo<ImportPlan | string | null>(() => {
        if (!file) return null;
        try {
            const numeric = Object.fromEntries(file.currencies.map((c) => [c, c === home ? 1 : Number(String(rates[c] ?? '').replace(',', '.'))]));
            return planImport(file, people, numeric, t('import.adjustmentNote'));
        } catch (cause) { return cause instanceof Error ? cause.message : String(cause); }
    }, [file, people, rates, home, t]);

    const run = async () => {
        if (!plan || typeof plan === 'string') return;
        setError('');
        const batches: Array<{ expenses?: unknown[]; settlements?: unknown[] }> = [];
        for (let i = 0; i < plan.expenses.length; i += BATCH) batches.push({ expenses: plan.expenses.slice(i, i + BATCH) });
        for (let i = 0; i < plan.settlements.length; i += BATCH) batches.push({ settlements: plan.settlements.slice(i, i + BATCH) });
        const total = plan.expenses.length + plan.settlements.length;
        const sum = { expenses: 0, settlements: 0, skipped: 0 };
        setProgress({ done: 0, total });
        try {
            for (const batch of batches) {
                const response = await api.post<{ data: { expenses: number; settlements: number; skippedExpenses: number; skippedSettlements: number } }>('/api/budget/import', batch);
                sum.expenses += response.data.expenses; sum.settlements += response.data.settlements;
                sum.skipped += response.data.skippedExpenses + response.data.skippedSettlements;
                setProgress((p) => ({ done: (p?.done ?? 0) + (batch.expenses?.length ?? 0) + (batch.settlements?.length ?? 0), total }));
            }
            setResult(sum);
            onImported();
        } catch (cause) {
            // Batches already sent are kept; running the import again skips them.
            setError(`${cause instanceof Error ? cause.message : t('import.failed')} ${t('import.retryHint')}`);
        } finally { setProgress(null); }
    };

    const name = (id: string) => data.members.find((m) => m.id === id)?.name ?? '?';
    const day = (value: string) => format(parseISO(value), 'PP', { locale: dateLocale() });
    const ready = plan && typeof plan !== 'string';
    const owes = ready ? (() => {
        const creditor = Object.entries(plan.balance).sort((a, b) => b[1] - a[1])[0];
        const debtor = Object.entries(plan.balance).sort((a, b) => a[1] - b[1])[0];
        return creditor && debtor && creditor[1] > 0.004 ? { from: debtor[0], to: creditor[0], amount: creditor[1] } : null;
    })() : null;

    return <Sheet open={open} onClose={() => { if (!progress) { reset(); onClose(); } }} title={t('import.title')}>
        <p className="mb-4 text-sm text-muted-foreground">{t('import.hint')}</p>
        {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
        {result ? <div className="space-y-3">
            <p className="text-sm">{t('import.done', { expenses: result.expenses, payments: result.settlements })}</p>
            {result.skipped > 0 && <p className="text-sm text-muted-foreground">{t('import.skipped', { count: result.skipped })}</p>}
            <button type="button" onClick={() => { reset(); onClose(); }} className="w-full rounded-xl bg-primary py-3 font-semibold text-white">{t('import.close')}</button>
        </div> : <div className="space-y-4">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border p-4 text-sm font-medium">
                <FileUp className="h-4 w-4" />{file ? t('import.another') : t('import.choose')}
                <input type="file" accept=".csv,text/csv" className="sr-only" disabled={Boolean(progress)} onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {file && <>
                <p className="text-sm">{t('import.found', { count: file.rows.length, from: day(file.first), to: day(file.last) })}</p>
                <div className="space-y-2">
                    <p className="text-sm font-medium">{t('import.people')}</p>
                    {file.people.map((person, index) => <label key={person} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-2 text-sm">
                        <span className="truncate">{person}</span>
                        <select className={input} value={people[index] ?? ''} onChange={(e) => setPeople(people.map((id, i) => i === index ? e.target.value : id))}>
                            <option value="">{t('import.choosePerson')}</option>
                            {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                    </label>)}
                </div>
                {Object.keys(rates).length > 0 && <div className="space-y-2">
                    <p className="text-sm font-medium">{t('import.rates', { currency: home })}</p>
                    {Object.keys(rates).map((code) => <label key={code} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-2 text-sm">
                        <span>1 {code} =</span>
                        <input className={input} inputMode="decimal" value={rates[code]} onChange={(e) => setRates({ ...rates, [code]: e.target.value })} aria-label={`${code} → ${home}`} />
                    </label>)}
                    <p className="text-xs text-muted-foreground">{t('import.ratesHint')}</p>
                </div>}
                {typeof plan === 'string' && <p className="text-sm text-danger">{plan}</p>}
                {ready && <div className="space-y-1.5 rounded-xl bg-surface-2 p-3 text-sm">
                    <p><strong>{t('import.expenses', { count: plan.expenses.length })}</strong> · {formatCurrency(plan.total, currency)}</p>
                    <p className="text-muted-foreground">{t('import.breakdown', { shared: plan.counts.shared, full: plan.counts.full, personal: plan.counts.personal })}</p>
                    <p><strong>{t('import.payments', { count: plan.counts.payments })}</strong></p>
                    {plan.counts.converted > 0 && <p className="text-muted-foreground">{t('import.converted', { count: plan.counts.converted })}</p>}
                    {plan.counts.approximate > 0 && <p className="text-muted-foreground">{t('import.approximate', { count: plan.counts.approximate, amount: formatCurrency(plan.adjustment, currency) })}</p>}
                    <p className="pt-1 font-medium">{owes ? t('import.after', { from: name(owes.from), to: name(owes.to), amount: formatCurrency(owes.amount, currency) }) : t('import.even')}</p>
                </div>}
                {progress && <div aria-live="polite" className="text-sm">
                    {t('import.progress', { done: progress.done, total: progress.total })}
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-primary transition-all" style={{ width: `${Math.round(progress.done / Math.max(1, progress.total) * 100)}%` }} /></div>
                </div>}
                <button type="button" disabled={!ready || Boolean(progress)} onClick={() => void run()} className="w-full rounded-xl bg-primary py-3 font-semibold text-white disabled:opacity-50">
                    {ready ? t('import.run', { count: plan.expenses.length + plan.settlements.length }) : t('import.title')}
                </button>
                <p className="text-xs text-muted-foreground">{t('import.dedupe')}</p>
            </>}
        </div>}
    </Sheet>;
}
