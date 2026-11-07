import { query } from '../db';
import { expandRecurringTransactions, formatDateOnly } from '../lib/budgetRecurrence';
import { computeSharing, type Settlement, type SplitExpense } from '../lib/budgetSplit';

/**
 * Shared expenses (v1.5). Loads a family's members, groups, expenses with a
 * payer, recurring occurrences due so far and settle-up payments, and turns them
 * into monthly and outstanding balances (lib/budgetSplit).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class SharingError extends Error {}

export interface SharingFields { paid_by: string | null; split_with: string[]; group_id: string | null }

const memberIds = async (familyId: string) =>
    new Set((await query('SELECT id FROM family_members WHERE user_id = $1', [familyId])).rows.map((row) => String(row.id)));

/**
 * Validates paid_by / split_with / group_id from a request body against this
 * family's members and groups. Fields that are absent keep `current`.
 */
export async function readSharingFields(body: any, familyId: string, current?: Partial<SharingFields>): Promise<SharingFields> {
    const out: SharingFields = { paid_by: current?.paid_by ?? null, split_with: current?.split_with ?? [], group_id: current?.group_id ?? null };
    const touched = ['paid_by', 'split_with', 'group_id'].some((key) => body?.[key] !== undefined);
    if (!touched) return out;
    const members = await memberIds(familyId);
    if (body.paid_by !== undefined) {
        const value = body.paid_by === '' || body.paid_by === null ? null : body.paid_by;
        if (value !== null && (typeof value !== 'string' || !members.has(value))) throw new SharingError('Choose who paid from your family members.');
        out.paid_by = value;
    }
    if (body.split_with !== undefined) {
        if (!Array.isArray(body.split_with) || body.split_with.length > 20) throw new SharingError('Choose who the expense is split between.');
        const ids = [...new Set(body.split_with as unknown[])];
        if (ids.some((id) => typeof id !== 'string' || !members.has(id))) throw new SharingError('Split only between your family members.');
        out.split_with = ids as string[];
    }
    if (body.group_id !== undefined) {
        const value = body.group_id === '' || body.group_id === null ? null : body.group_id;
        if (value !== null) {
            if (typeof value !== 'string' || !UUID.test(value)) throw new SharingError('Unknown expense group.');
            const group = await query('SELECT id FROM budget_groups WHERE id = $1 AND user_id = $2', [value, familyId]);
            if (!group.rows.length) throw new SharingError('Unknown expense group.');
        }
        out.group_id = value;
    }
    return out;
}

const asIds = (value: unknown): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
const monthRange = (month: string) => {
    const [year, mon] = month.split('-').map(Number);
    const start = new Date(Date.UTC(year, mon - 1, 1));
    const end = new Date(Date.UTC(year, mon, 0));
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};
const shiftMonth = (month: string, delta: number) => {
    const [year, mon] = month.split('-').map(Number);
    const date = new Date(Date.UTC(year, mon - 1 + delta, 1));
    return date.toISOString().slice(0, 7);
};

export type GroupFilter = 'all' | 'none' | string;

interface Row { amount: number; date: string; paidBy: string; participants: string[]; groupId: string | null }

/** Everything the Budget page shows about shared expenses for one month and group filter. */
export async function sharingSummary(familyId: string, month: string, filter: GroupFilter, today = formatDateOnly(new Date())) {
    const [members, groups, settings, entries, recurring, payments] = await Promise.all([
        query('SELECT id, name, color, role FROM family_members WHERE user_id = $1 ORDER BY created_at, name', [familyId]),
        query('SELECT id, name, members, archived FROM budget_groups WHERE user_id = $1 ORDER BY archived, created_at', [familyId]),
        query('SELECT members FROM budget_sharing_settings WHERE user_id = $1', [familyId]),
        query(`SELECT amount, date, paid_by, split_with, group_id FROM budget_entries
               WHERE user_id = $1 AND is_expense = true AND paid_by IS NOT NULL AND date <= $2`, [familyId, today]),
        query(`SELECT * FROM recurring_expenses WHERE user_id = $1 AND is_expense = true AND paid_by IS NOT NULL AND is_active = true`, [familyId]),
        query(`SELECT id, group_id, from_member, to_member, amount, date, note FROM budget_settlements
               WHERE user_id = $1 ORDER BY date DESC, created_at DESC`, [familyId]),
    ]);
    const ids = members.rows.map((row) => String(row.id));
    const known = new Set(ids);
    // Default "split between": the saved choice, else the members whose role is
    // Parent, else everyone.
    const saved = asIds(settings.rows[0]?.members).filter((id) => known.has(id));
    const parents = members.rows.filter((row) => row.role === 'Parent').map((row) => String(row.id));
    const defaultSharers = saved.length ? saved : parents.length ? parents : ids;
    const groupMembers = new Map(groups.rows.map((row) => [String(row.id), asIds(row.members).filter((id) => known.has(id))]));
    const participantsFor = (split: unknown, groupId: string | null) => {
        const chosen = asIds(split).filter((id) => known.has(id));
        if (chosen.length) return chosen;
        if (groupId && groupMembers.get(groupId)?.length) return groupMembers.get(groupId)!;
        return defaultSharers;
    };

    const rows: Row[] = entries.rows.map((row) => ({
        amount: Number(row.amount), date: String(row.date instanceof Date ? formatDateOnly(row.date) : row.date).slice(0, 10),
        paidBy: String(row.paid_by), groupId: row.group_id ? String(row.group_id) : null,
        participants: participantsFor(row.split_with, row.group_id ? String(row.group_id) : null),
    }));
    // Recurring transactions count once each occurrence is due (up to today).
    const earliest = recurring.rows.reduce((min, row) => {
        const start = String(row.start_date instanceof Date ? formatDateOnly(row.start_date) : row.start_date ?? '').slice(0, 10);
        return start && start < min ? start : min;
    }, today);
    for (const occurrence of expandRecurringTransactions(recurring.rows, earliest, today)) {
        const groupId = occurrence.group_id ? String(occurrence.group_id) : null;
        rows.push({ amount: Number(occurrence.amount), date: String(occurrence.occurrence_date ?? occurrence.date ?? '').slice(0, 10), paidBy: String(occurrence.paid_by),
            groupId, participants: participantsFor(occurrence.split_with, groupId) });
    }
    const inFilter = (groupId: string | null) => filter === 'all' || (filter === 'none' ? groupId === null : groupId === filter);
    const settlements = payments.rows.map((row) => ({
        id: String(row.id), groupId: row.group_id ? String(row.group_id) : null, from: String(row.from_member), to: String(row.to_member),
        amount: Number(row.amount), date: String(row.date instanceof Date ? formatDateOnly(row.date) : row.date).slice(0, 10), note: row.note ?? '',
    }));
    const toSplit = (list: Row[]): SplitExpense[] => list.map(({ amount, paidBy, participants }) => ({ amount, paidBy, participants }));
    const toPayments = (list: typeof settlements): Settlement[] => list.map(({ from, to, amount }) => ({ from, to, amount }));

    const { start, end } = monthRange(month);
    const filtered = rows.filter((row) => inFilter(row.groupId));
    const filteredPayments = settlements.filter((row) => inFilter(row.groupId));
    const monthRows = filtered.filter((row) => row.date >= start && row.date <= end);
    const history = Array.from({ length: 6 }, (_, index) => shiftMonth(month, index - 5)).map((key) => {
        const range = monthRange(key);
        const result = computeSharing(ids, toSplit(filtered.filter((row) => row.date >= range.start && row.date <= range.end)));
        return { month: key, total: result.total, members: result.members.map(({ id, paid }) => ({ id, paid })) };
    });
    const groupBalance = (groupId: string | null) => computeSharing(ids,
        toSplit(rows.filter((row) => row.groupId === groupId)), toPayments(settlements.filter((row) => row.groupId === groupId))).owes;

    return {
        members: members.rows.map((row) => ({ id: String(row.id), name: String(row.name), color: String(row.color) })),
        defaultSharers,
        groups: groups.rows.map((row) => ({ id: String(row.id), name: String(row.name), members: groupMembers.get(String(row.id)) ?? [], archived: Boolean(row.archived), owes: groupBalance(String(row.id)) })),
        ungrouped: { owes: groupBalance(null) },
        month: { month, ...computeSharing(ids, toSplit(monthRows)) },
        // What is still owed, all time, after settle-up payments (for this filter).
        balance: computeSharing(ids, toSplit(filtered), toPayments(filteredPayments)),
        settlements: filteredPayments.slice(0, 30),
        history,
    };
}

export async function saveDefaultSharers(familyId: string, value: unknown) {
    const members = await memberIds(familyId);
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !members.has(id))) throw new SharingError('Choose family members to split with.');
    const ids = [...new Set(value as string[])];
    await query(`INSERT INTO budget_sharing_settings (user_id, members, updated_at) VALUES ($1, $2::jsonb, now())
        ON CONFLICT (user_id) DO UPDATE SET members = EXCLUDED.members, updated_at = now()`, [familyId, JSON.stringify(ids)]);
    return ids;
}

export async function readGroupBody(familyId: string, body: any) {
    const name = typeof body?.name === 'string' ? body.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60) : '';
    if (!name) throw new SharingError('Give the group a name.');
    const members = await memberIds(familyId);
    const list = body?.members === undefined ? [] : body.members;
    if (!Array.isArray(list) || list.some((id: unknown) => typeof id !== 'string' || !members.has(id))) throw new SharingError('Choose group members from your family.');
    return { name, members: [...new Set(list as string[])], archived: Boolean(body?.archived) };
}

export async function readSettlementBody(familyId: string, body: any) {
    const members = await memberIds(familyId);
    const from = body?.from, to = body?.to;
    if (typeof from !== 'string' || typeof to !== 'string' || !members.has(from) || !members.has(to)) throw new SharingError('Choose who paid and who received the money.');
    if (from === to) throw new SharingError('Choose two different people.');
    const amount = typeof body?.amount === 'number' ? body.amount : Number(String(body?.amount ?? '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) throw new SharingError('Enter an amount above zero.');
    const date = typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : formatDateOnly(new Date());
    let groupId: string | null = null;
    if (body?.group_id) {
        if (typeof body.group_id !== 'string' || !UUID.test(body.group_id)) throw new SharingError('Unknown expense group.');
        if (!(await query('SELECT id FROM budget_groups WHERE id = $1 AND user_id = $2', [body.group_id, familyId])).rows.length) throw new SharingError('Unknown expense group.');
        groupId = body.group_id;
    }
    const note = typeof body?.note === 'string' ? body.note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) : '';
    return { from, to, amount: Math.round(amount * 100) / 100, date, groupId, note: note || null };
}
