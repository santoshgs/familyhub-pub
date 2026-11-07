import { getClient, query } from '../db';
import { isBudgetCategory } from '../lib/budgetCategories';
import { SharingError } from './budgetSharing';

/**
 * Bulk import of expenses and settle-up payments (v1.5), used by the Budget
 * page's "Import from Splitwise". The browser parses the file and maps people,
 * categories and currencies; this validates every item against the family and
 * inserts a batch in one transaction. Items already present (same date, amount
 * and description, or the same payment) are skipped, counting duplicates: two
 * identical rows in a file are both kept, and retrying a batch adds nothing.
 */
export const IMPORT_BATCH_LIMIT = 1000;

interface ImportExpense { date: string; description: string; category: string; amount: number; paid_by: string | null; split_with: string[] }
interface ImportSettlement { date: string; from: string; to: string; amount: number; note: string | null }

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const money = (value: unknown) => {
    const amount = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return null;
    return Math.round(amount * 100) / 100;
};
const validDate = (value: unknown): value is string => {
    if (typeof value !== 'string' || !DATE.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const expenseKey = (date: string, amount: number, description: string) => `${date}|${amount.toFixed(2)}|${description.toLowerCase()}`;
const settlementKey = (date: string, from: string, to: string, amount: number) => `${date}|${from}|${to}|${amount.toFixed(2)}`;

export function readImportBody(body: any, members: Set<string>) {
    const rawExpenses = body?.expenses ?? [], rawSettlements = body?.settlements ?? [];
    if (!Array.isArray(rawExpenses) || !Array.isArray(rawSettlements) || rawExpenses.length + rawSettlements.length > IMPORT_BATCH_LIMIT) {
        throw new SharingError(`Send at most ${IMPORT_BATCH_LIMIT} items at a time.`);
    }
    const expenses: ImportExpense[] = rawExpenses.map((item: any, index: number) => {
        const amount = money(item?.amount);
        const description = clean(item?.description, 500);
        if (!validDate(item?.date) || amount === null || !isBudgetCategory(item?.category)) throw new SharingError(`Expense ${index + 1} needs a valid date, amount and category.`);
        const paidBy = item?.paid_by ?? null;
        if (paidBy !== null && (typeof paidBy !== 'string' || !members.has(paidBy))) throw new SharingError(`Expense ${index + 1}: choose who paid from your family members.`);
        const split = item?.split_with ?? [];
        if (!Array.isArray(split) || split.length > 20 || split.some((id: unknown) => typeof id !== 'string' || !members.has(id))) throw new SharingError(`Expense ${index + 1}: split only between your family members.`);
        return { date: item.date, description, category: item.category, amount, paid_by: paidBy, split_with: paidBy ? [...new Set(split as string[])] : [] };
    });
    const settlements: ImportSettlement[] = rawSettlements.map((item: any, index: number) => {
        const amount = money(item?.amount);
        if (!validDate(item?.date) || amount === null || typeof item?.from !== 'string' || typeof item?.to !== 'string'
            || !members.has(item.from) || !members.has(item.to) || item.from === item.to) throw new SharingError(`Payment ${index + 1} needs a date, an amount and two different family members.`);
        return { date: item.date, from: item.from, to: item.to, amount, note: clean(item?.note, 200) || null };
    });
    return { expenses, settlements };
}

export async function importBudgetItems(familyId: string, body: any) {
    const members = new Set((await query('SELECT id FROM family_members WHERE user_id = $1', [familyId])).rows.map((row) => String(row.id)));
    const { expenses, settlements } = readImportBody(body, members);
    const client = await getClient();
    const result = { expenses: 0, settlements: 0, skippedExpenses: 0, skippedSettlements: 0 };
    try {
        await client.query('BEGIN');
        // One import at a time per family, so two tabs cannot both insert a batch.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`budget-import:${familyId}`]);
        const dates = [...expenses.map((item) => item.date), ...settlements.map((item) => item.date)].sort();
        const seenExpenses = new Map<string, number>(), seenSettlements = new Map<string, number>();
        const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
        const take = (map: Map<string, number>, key: string) => { const left = map.get(key) ?? 0; if (left > 0) map.set(key, left - 1); return left > 0; };
        if (dates.length) {
            const [first, last] = [dates[0], dates[dates.length - 1]];
            for (const row of (await client.query(`SELECT date::text AS date, amount, COALESCE(description, '') AS description FROM budget_entries
                WHERE user_id = $1 AND is_expense = true AND date BETWEEN $2 AND $3`, [familyId, first, last])).rows) {
                bump(seenExpenses, expenseKey(row.date, Number(row.amount), String(row.description).replace(/\s+/g, ' ').trim()));
            }
            for (const row of (await client.query(`SELECT date::text AS date, from_member, to_member, amount FROM budget_settlements
                WHERE user_id = $1 AND date BETWEEN $2 AND $3`, [familyId, first, last])).rows) {
                bump(seenSettlements, settlementKey(row.date, String(row.from_member), String(row.to_member), Number(row.amount)));
            }
        }
        for (const item of expenses) {
            const key = expenseKey(item.date, item.amount, item.description);
            if (take(seenExpenses, key)) { result.skippedExpenses += 1; continue; }
            await client.query(`INSERT INTO budget_entries (user_id, category, amount, description, date, is_expense, paid_by, split_with)
                VALUES ($1, $2, $3, $4, $5, true, $6, $7::jsonb)`,
            [familyId, item.category, item.amount, item.description || null, item.date, item.paid_by, JSON.stringify(item.split_with)]);
            result.expenses += 1;
        }
        for (const item of settlements) {
            const key = settlementKey(item.date, item.from, item.to, item.amount);
            if (take(seenSettlements, key)) { result.skippedSettlements += 1; continue; }
            await client.query(`INSERT INTO budget_settlements (user_id, from_member, to_member, amount, date, note) VALUES ($1, $2, $3, $4, $5, $6)`,
                [familyId, item.from, item.to, item.amount, item.date, item.note]);
            result.settlements += 1;
        }
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}
