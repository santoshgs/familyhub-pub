/**
 * Splitwise CSV export → Family Hub expenses and settle-up payments (v1.5).
 *
 * A Splitwise export has Date, Description, Category, Cost, Currency and then
 * one column per person holding that person's net for the row: positive means
 * they paid more than their share. Family Hub records a payer and an equal
 * split, so each row becomes:
 *   - net zero for everyone → an expense with no payer (personal, or paid evenly);
 *   - payer + others owing an equal share → paid by them, split with all of those;
 *   - payer + others owing everything → paid by them, split with the others only;
 *   - anything else (unequal splits) → the closest of those two, and one
 *     "balance adjustment" payment at the end makes the outstanding balance
 *     match Splitwise to the cent.
 * "Payment" rows become settle-up payments. Other currencies are converted at
 * a rate the household chooses, with the original amount kept in the text.
 */
export interface SplitwiseRow { line: number; date: string; description: string; category: string; cost: number; currency: string; nets: number[] }
export interface SplitwiseFile { people: string[]; rows: SplitwiseRow[]; currencies: string[]; first: string; last: string }

/** Splitwise category names → Family Hub's fixed keys. Unknown names become "general". */
export const SPLITWISE_CATEGORIES: Record<string, string> = {
    'groceries': 'groceries', 'dining out': 'restaurants', 'liquor': 'drinks', 'food and drink - other': 'restaurants',
    'movies': 'movies', 'music': 'music', 'sports': 'sports', 'games': 'games', 'entertainment - other': 'active-arts',
    'rent': 'rent', 'mortgage': 'mortgage', 'electricity': 'electricity', 'heat/gas': 'home-gas', 'water': 'water',
    'tv/phone/internet': 'internet', 'services': 'maintenance', 'maintenance': 'maintenance', 'household supplies': 'housekeeping',
    'cleaning': 'housekeeping', 'furniture': 'furniture', 'pets': 'pets', 'home - other': 'general', 'utilities - other': 'general',
    'car': 'car', 'gas/fuel': 'fuel', 'parking': 'parking', 'taxi': 'rideshare', 'bus/train': 'transit', 'plane': 'flight',
    'bicycle': 'bicycle', 'hotel': 'general', 'transportation - other': 'general',
    'medical expenses': 'medical', 'insurance': 'insurance', 'taxes': 'taxes', 'childcare': 'childcare', 'clothing': 'clothing',
    'gifts': 'gifts', 'electronics': 'electronics', 'education': 'general', 'life - other': 'general', 'general': 'general',
};
export const mapCategory = (name: string) => SPLITWISE_CATEGORIES[name.trim().toLowerCase()] ?? 'general';

/** RFC 4180-style CSV (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i += 1) {
        const c = text[i];
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i += 1;
            row.push(field); rows.push(row); row = []; field = '';
        } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
}

const HEADER = ['date', 'description', 'category', 'cost', 'currency'];
const num = (value: string) => { const n = Number(String(value).trim()); return Number.isFinite(n) ? n : null; };

export function parseSplitwise(text: string): SplitwiseFile {
    const table = parseCsv(text.replace(/^﻿/, ''));
    const header = (table[0] ?? []).map((cell) => cell.trim());
    if (HEADER.some((name, index) => header[index]?.toLowerCase() !== name) || header.length < 7) {
        throw new Error('This does not look like a Splitwise export (Date, Description, Category, Cost, Currency, then one column per person).');
    }
    const people = header.slice(5);
    const rows: SplitwiseRow[] = [];
    table.slice(1).forEach((cells, index) => {
        const [date = '', description = '', category = '', cost = '', currency = ''] = cells;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) || description.trim() === 'Total balance') return;
        const amount = num(cost), nets = people.map((_, p) => num(cells[5 + p] ?? ''));
        if (amount === null || amount <= 0 || nets.some((n) => n === null)) return;
        rows.push({ line: index + 2, date: date.trim(), description: description.trim(), category: category.trim(), cost: amount, currency: currency.trim().toUpperCase(), nets: nets as number[] });
    });
    if (!rows.length) throw new Error('No expenses found in this file.');
    const dates = rows.map((row) => row.date).sort();
    return { people, rows, currencies: [...new Set(rows.map((row) => row.currency))].sort(), first: dates[0], last: dates[dates.length - 1] };
}

/** Each participant's share in cents, exactly as the server splits (leftover cents to non-payers first). */
export function shares(amountCents: number, paidBy: string, participants: string[]) {
    const people = [...new Set(participants)];
    if (!people.length) people.push(paidBy);
    const ordered = [...people.filter((id) => id !== paidBy), ...people.filter((id) => id === paidBy)];
    const base = Math.floor(amountCents / ordered.length);
    let left = amountCents - base * ordered.length;
    return new Map(ordered.map((id) => { const part = base + (left > 0 ? 1 : 0); if (left > 0) left -= 1; return [id, part] as const; }));
}

export interface ImportExpense { date: string; description: string; category: string; amount: number; paid_by: string | null; split_with: string[] }
export interface ImportSettlement { date: string; from: string; to: string; amount: number; note: string }
export interface ImportPlan {
    expenses: ImportExpense[]; settlements: ImportSettlement[];
    counts: { shared: number; full: number; personal: number; approximate: number; payments: number; converted: number };
    total: number; adjustment: number;
    /** Outstanding balance after import, per member id (positive = is owed), in dollars. */
    balance: Record<string, number>;
}

const cents = (value: number) => Math.round(value * 100);
const near = (a: number, b: number) => Math.abs(a - b) <= 1; // within a cent

/**
 * `members[i]` is the family member for person column i; `rates` converts each
 * currency to the household's (1 for the household currency).
 */
export function planImport(file: SplitwiseFile, members: string[], rates: Record<string, number>, adjustmentNote = 'Balance adjustment (Splitwise import)'): ImportPlan {
    if (members.length !== file.people.length || members.some((id) => !id) || new Set(members).size !== members.length) throw new Error('Choose a different family member for each person.');
    const plan: ImportPlan = { expenses: [], settlements: [], counts: { shared: 0, full: 0, personal: 0, approximate: 0, payments: 0, converted: 0 }, total: 0, adjustment: 0, balance: {} };
    const target = new Map(members.map((id) => [id, 0])), ours = new Map(members.map((id) => [id, 0]));
    const add = (map: Map<string, number>, id: string, value: number) => map.set(id, (map.get(id) ?? 0) + value);
    for (const row of file.rows) {
        const rate = rates[row.currency];
        if (!(rate > 0)) throw new Error(`Enter a rate for ${row.currency}.`);
        const amount = cents(row.cost * rate);
        if (amount <= 0) continue;
        const nets = row.nets.map((net) => cents(net * rate));
        nets.forEach((net, p) => add(target, members[p], net));
        const converted = rate !== 1;
        if (converted) plan.counts.converted += 1;
        const label = row.description || row.category || 'Expense';
        const description = converted ? `${label} (${row.cost.toFixed(2)} ${row.currency})` : label;
        const payers = nets.map((net, p) => ({ net, p })).filter(({ net }) => net > 1);
        const owing = nets.map((net, p) => ({ net, p })).filter(({ net }) => net < -1);

        if (row.category.toLowerCase() === 'payment') {
            // "A paid B": A's column is positive.
            if (payers.length === 1 && owing.length === 1) {
                const settlement = { date: row.date, from: members[payers[0].p], to: members[owing[0].p], amount: amount / 100, note: label };
                plan.settlements.push(settlement); plan.counts.payments += 1;
                add(ours, settlement.from, amount); add(ours, settlement.to, -amount);
            }
            continue;
        }
        plan.total += amount;
        let paidBy: string | null = null, split: string[] = [];
        if (payers.length === 1 && owing.length) {
            const payer = payers[0].p;
            const everyone = [payer, ...owing.map(({ p }) => p)];
            const equal = owing.every(({ net }) => near(-net, amount / everyone.length));
            const full = owing.every(({ net }) => near(-net, amount / owing.length));
            paidBy = members[payer];
            if (equal && !full) { split = everyone.map((p) => members[p]); plan.counts.shared += 1; }
            else if (full) { split = owing.map(({ p }) => members[p]); plan.counts.full += 1; }
            else {
                // Unequal split: keep whichever equal split is closer; the adjustment fixes the balance.
                const owed = -owing.reduce((sum, { net }) => sum + net, 0);
                const equalOwed = amount * owing.length / everyone.length;
                split = Math.abs(owed - amount) < Math.abs(owed - equalOwed) ? owing.map(({ p }) => members[p]) : everyone.map((p) => members[p]);
                plan.counts.approximate += 1;
            }
        } else if (payers.length || owing.length) {
            // Several payers: record it unshared and let the adjustment carry the balance.
            plan.counts.approximate += 1;
        } else plan.counts.personal += 1;
        if (paidBy) {
            add(ours, paidBy, amount);
            for (const [id, part] of shares(amount, paidBy, split)) add(ours, id, -part);
        }
        plan.expenses.push({ date: row.date, description: description.slice(0, 500), category: mapCategory(row.category), amount: amount / 100, paid_by: paidBy, split_with: split });
    }
    // Make the outstanding balance match Splitwise exactly.
    const diff = members.map((id) => ({ id, value: (target.get(id) ?? 0) - (ours.get(id) ?? 0) }));
    const raise = diff.filter(({ value }) => value > 0).sort((a, b) => b.value - a.value);
    const lower = diff.filter(({ value }) => value < 0).map((d) => ({ ...d, value: -d.value })).sort((a, b) => b.value - a.value);
    for (let i = 0, j = 0; i < raise.length && j < lower.length;) {
        const amount = Math.min(raise[i].value, lower[j].value);
        if (amount > 0) {
            plan.settlements.push({ date: file.last, from: raise[i].id, to: lower[j].id, amount: amount / 100, note: adjustmentNote });
            plan.adjustment += amount;
        }
        raise[i].value -= amount; lower[j].value -= amount;
        if (!raise[i].value) i += 1;
        if (!lower[j].value) j += 1;
    }
    plan.total /= 100; plan.adjustment /= 100;
    plan.balance = Object.fromEntries(members.map((id) => [id, (target.get(id) ?? 0) / 100]));
    return plan;
}

/** Suggested member for each person column: same name, else same first name. */
export function guessMembers(people: string[], members: Array<{ id: string; name: string }>) {
    const used = new Set<string>();
    return people.map((person) => {
        const name = person.trim().toLowerCase();
        const match = members.find((m) => !used.has(m.id) && m.name.trim().toLowerCase() === name)
            ?? members.find((m) => !used.has(m.id) && m.name.trim().toLowerCase().split(/\s+/)[0] === name.split(/\s+/)[0]);
        if (match) used.add(match.id);
        return match?.id ?? '';
    });
}
