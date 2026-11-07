/**
 * Shared expenses (v1.5): who paid, each member's share, and who owes whom.
 *
 * Money is handled in whole cents. An expense is split equally between its
 * participants; leftover cents go to the participants other than the payer
 * first (CA$44.11 between two: the payer's share is 22.05, the other 22.06),
 * so the payer is never short-changed by rounding. A settlement is a payment
 * from one member to another that reduces what the first owes.
 */
export interface SplitExpense { amount: number; paidBy: string; participants: string[] }
export interface Settlement { from: string; to: string; amount: number }
export interface MemberTotals { id: string; paid: number; share: number; net: number }
export interface Debt { from: string; to: string; amount: number }

const cents = (value: number) => Math.round(value * 100);
const dollars = (value: number) => Math.round(value) / 100;

/** Each participant's share of one expense, in cents (sums exactly to the amount). */
export function shares(amountCents: number, paidBy: string, participants: string[]): Map<string, number> {
    const people = [...new Set(participants)];
    if (!people.length) people.push(paidBy);
    // Others first, payer last, so the remainder lands on the others.
    const ordered = [...people.filter((id) => id !== paidBy), ...people.filter((id) => id === paidBy)];
    const base = Math.floor(amountCents / ordered.length);
    let left = amountCents - base * ordered.length;
    const out = new Map<string, number>();
    for (const id of ordered) {
        out.set(id, base + (left > 0 ? 1 : 0));
        if (left > 0) left -= 1;
    }
    return out;
}

/**
 * Totals per member and the fewest payments that settle everything. `members`
 * limits the result to known people (removed members' rows are ignored).
 */
export function computeSharing(members: string[], expenses: SplitExpense[], settlements: Settlement[] = []) {
    const known = new Set(members);
    const paid = new Map<string, number>(members.map((id) => [id, 0]));
    const share = new Map<string, number>(members.map((id) => [id, 0]));
    const transfers = new Map<string, number>(members.map((id) => [id, 0]));
    let total = 0;
    for (const expense of expenses) {
        if (!known.has(expense.paidBy) || !(expense.amount > 0)) continue;
        const amount = cents(expense.amount);
        const participants = expense.participants.filter((id) => known.has(id));
        total += amount;
        paid.set(expense.paidBy, (paid.get(expense.paidBy) ?? 0) + amount);
        for (const [id, part] of shares(amount, expense.paidBy, participants)) share.set(id, (share.get(id) ?? 0) + part);
    }
    for (const payment of settlements) {
        if (!known.has(payment.from) || !known.has(payment.to) || payment.from === payment.to || !(payment.amount > 0)) continue;
        const amount = cents(payment.amount);
        // Paying someone back raises the payer's balance and lowers the receiver's.
        transfers.set(payment.from, (transfers.get(payment.from) ?? 0) + amount);
        transfers.set(payment.to, (transfers.get(payment.to) ?? 0) - amount);
    }
    const netCents = new Map(members.map((id) => [id, (paid.get(id) ?? 0) - (share.get(id) ?? 0) + (transfers.get(id) ?? 0)]));
    return {
        total: dollars(total),
        members: members.map((id): MemberTotals => ({ id, paid: dollars(paid.get(id) ?? 0), share: dollars(share.get(id) ?? 0), net: dollars(netCents.get(id) ?? 0) })),
        owes: settle(netCents),
    };
}

/** Greedy: the largest debtor pays the largest creditor until everyone is even. */
export function settle(net: Map<string, number>): Debt[] {
    const debtors = [...net].filter(([, value]) => value < 0).map(([id, value]) => ({ id, value: -value })).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
    const creditors = [...net].filter(([, value]) => value > 0).map(([id, value]) => ({ id, value })).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
    const debts: Debt[] = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
        const amount = Math.min(debtors[i].value, creditors[j].value);
        if (amount > 0) debts.push({ from: debtors[i].id, to: creditors[j].id, amount: dollars(amount) });
        debtors[i].value -= amount; creditors[j].value -= amount;
        if (debtors[i].value === 0) i += 1;
        if (creditors[j].value === 0) j += 1;
    }
    return debts;
}
