// Prompt building + server-side validation for the AI assistant features.
//
// The JSON schemas below are shared by all providers. Constraints:
//  - every object carries additionalProperties:false (Anthropic structured outputs),
//  - no minLength/maxLength/minimum/maximum (unsupported there) — all bounds are
//    enforced by the validators in this file, which NEVER trust the model output.
//  - every property is required; "not applicable" is conveyed with '' / [] / 0 so
//    the same schema behaves identically on Ollama, OpenAI-compatible and Anthropic.

export const TASK_PRIORITIES = ['Haute', 'Moyenne', 'Basse'] as const;
export const TASK_FREQUENCIES = ['Une fois', 'Quotidien', 'Hebdomadaire', 'Mensuel', 'Trimestriel', 'Quadrimestriel', 'Annuel'] as const;
export const SHOPPING_CATEGORIES = ['Alimentation', 'Bebe', 'Menage', 'Sante', 'Autre'] as const;
import { BUDGET_CATEGORIES } from '../../lib/budgetCategories';
import { addDays, addMinutes } from '../familyhub/google/eventDefaults';
import { contextPrompt, wallTime, type HouseholdContext } from './householdContext';
export { BUDGET_CATEGORIES };

export interface FamilyMemberRef {
    id: string;
    name: string;
}

// ─── /api/ai/parse ────────────────────────────────────────────────────────────

/** Changes to existing Google items; proposed only when a household context is given. */
export const EDIT_TYPES = ['appointment_update', 'appointment_delete', 'task_update', 'task_complete', 'task_delete', 'shopping_check', 'shopping_delete'] as const;

export const PARSE_SCHEMA: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'type', 'title', 'description', 'date', 'start_time', 'end_time',
                    'location', 'member_names', 'priority', 'frequency',
                    'quantity', 'unit', 'category', 'amount', 'is_expense',
                    'ref', 'people', 'list', 'repeat', 'repeat_days', 'repeat_until', 'repeat_count',
                ],
                properties: {
                    type: { type: 'string', enum: ['task', 'appointment', 'shopping_item', 'budget_entry', ...EDIT_TYPES] },
                    title: { type: 'string' },
                    description: { type: 'string' },
                    date: { type: 'string' },
                    start_time: { type: 'string' },
                    end_time: { type: 'string' },
                    location: { type: 'string' },
                    member_names: { type: 'array', items: { type: 'string' } },
                    priority: { type: 'string', enum: ['', ...TASK_PRIORITIES] },
                    frequency: { type: 'string', enum: ['', ...TASK_FREQUENCIES] },
                    quantity: { type: 'number' },
                    unit: { type: 'string' },
                    category: { type: 'string' },
                    amount: { type: 'number' },
                    is_expense: { type: 'boolean' },
                    // Family Hub (v2.1): an existing item's reference, the people an event is
                    // for, the shopping list, and how a new event repeats.
                    ref: { type: 'string' },
                    people: { type: 'array', items: { type: 'string' } },
                    list: { type: 'string' },
                    repeat: { type: 'string', enum: ['', 'daily', 'weekly', 'monthly', 'yearly'] },
                    repeat_days: { type: 'array', items: { type: 'string' } },
                    repeat_until: { type: 'string' },
                    repeat_count: { type: 'number' },
                },
            },
        },
    },
};

const WEEKDAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * "Today", as YYYY-MM-DD + French weekday name: in the household's time zone
 * when known (the Pi's clock runs in UTC, so evenings were already "tomorrow"),
 * otherwise the server's.
 */
export function localToday(timeZone?: string, now = new Date()): { iso: string; weekday: string } {
    if (timeZone) {
        const iso = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
        return { iso, weekday: WEEKDAYS_FR[new Date(`${iso}T12:00:00Z`).getUTCDay()] };
    }
    return {
        iso: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
        weekday: WEEKDAYS_FR[now.getDay()],
    };
}

export function buildParsePrompt(
    members: FamilyMemberRef[],
    // Families can customize their category lists (issue #68) — the AI must offer
    // THEIR categories, not the defaults.
    shoppingCategories: readonly string[] = SHOPPING_CATEGORIES,
    budgetCategories: readonly string[] = BUDGET_CATEGORIES,
    context: HouseholdContext | null = null,
): string {
    const { iso, weekday } = localToday(context?.timeZone);
    const memberList = members.length > 0
        ? members.map((m) => `- ${m.name}`).join('\n')
        : '(aucun membre enregistré)';

    return [
        `Tu es l'assistant d'une application d'organisation familiale. L'utilisateur écrit une note en langage naturel (français ou anglais). Extrais-en un ou plusieurs éléments actionnables.`,
        ``,
        `Date du jour : ${iso} (${weekday}). Résous toutes les dates relatives ("demain", "jeudi soir", "next week"…) par rapport à cette date, vers le futur le plus proche.`,
        ``,
        `Membres de la famille (utilise exactement ces prénoms dans member_names) :`,
        memberList,
        ``,
        `Types d'éléments :`,
        `- "task" : tâche/corvée/rappel. title = intitulé. date = échéance "YYYY-MM-DD" ou "". priority parmi ${TASK_PRIORITIES.join('/')} ou "". frequency parmi ${TASK_FREQUENCIES.join('/')} ou "". member_names = personnes assignées.`,
        `- "appointment" : rendez-vous/événement à une heure précise. start_time = "YYYY-MM-DDTHH:mm:ss" (heure locale, obligatoire), end_time pareil ou "". location = lieu ou "". member_names = personnes concernées.`,
        `- "shopping_item" : article à acheter. title = nom de l'article. category parmi ${shoppingCategories.join('/')}. quantity = nombre (0 si inconnu), unit = unité ("kg", "L"…) ou "".`,
        `- "budget_entry" : dépense ou revenu. title = libellé. amount = montant (nombre > 0). is_expense = true pour une dépense, false pour un revenu. category parmi ${budgetCategories.join('/')}. date = "YYYY-MM-DD" ("" = aujourd'hui).`,
        ``,
        `Règles :`,
        `- Chaque champ non pertinent vaut "" (chaîne vide), 0 (nombre) ou [] (liste). is_expense vaut true par défaut.`,
        `- "lasagnes jeudi soir" dans un contexte de repas/courses = shopping_item ou task de cuisine, pas un rendez-vous, sauf mention d'un horaire précis.`,
        `- Un dîner/repas planifié avec un horaire = appointment.`,
        `- N'invente rien : pas de date si la note n'en donne pas, pas de membre non listé.`,
        `- Une note peut contenir plusieurs demandes de types différents : propose un élément pour chacune.`,
        `- Les champs ref, people, list, repeat, repeat_days, repeat_until et repeat_count valent "", [] ou 0 sauf indication contraire.`,
        ...(context ? [contextPrompt(context)] : [`- N'utilise jamais les types ${EDIT_TYPES.join(', ')}.`]),
        ``,
        `- Réponds UNIQUEMENT avec un objet JSON de la forme {"items":[...]} respectant exactement les champs ci-dessus, sans texte autour.`,
    ].join('\n');
}

interface RawParsedItem {
    type?: unknown;
    title?: unknown;
    description?: unknown;
    date?: unknown;
    start_time?: unknown;
    end_time?: unknown;
    location?: unknown;
    member_names?: unknown;
    priority?: unknown;
    frequency?: unknown;
    quantity?: unknown;
    unit?: unknown;
    category?: unknown;
    amount?: unknown;
    is_expense?: unknown;
    ref?: unknown;
    people?: unknown;
    list?: unknown;
    repeat?: unknown;
    repeat_days?: unknown;
    repeat_until?: unknown;
    repeat_count?: unknown;
}

type EventPoint = { date?: string; dateTime?: string; timeZone?: string };

export type ParsedProposal =
    | {
        type: 'task';
        title: string;
        description: string | null;
        due_date: string | null;
        priority: string | null;
        frequency: string | null;
        assigned_to: string[];
        member_names: string[];
    }
    | {
        type: 'appointment';
        title: string;
        description: string | null;
        start_time: string;
        end_time: string | null;
        location: string | null;
        family_member_ids: string[];
        member_names: string[];
        /** Family Hub: Google event colour of the person it is for ('' = the calendar's colour). */
        color_id?: string | null;
        people?: string[];
        /** Family Hub: one RRULE line for a repeating event. */
        recurrence?: string | null;
    }
    | {
        type: 'shopping_item';
        name: string;
        category: string;
        quantity: number | null;
        unit: string | null;
        /** Family Hub: the Google Tasks shopping list it goes on. */
        list_id?: string | null;
        list_title?: string | null;
    }
    | {
        type: 'appointment_update';
        event_id: string;
        title: string;
        location: string;
        color_id: string | null;
        people: string[];
        all_day: boolean;
        start: EventPoint;
        end: EventPoint;
        before: { title: string; start: EventPoint; end: EventPoint; location: string };
    }
    | { type: 'appointment_delete'; event_id: string; title: string; all_day: boolean; start: EventPoint }
    | { type: 'task_update'; task_id: string; title: string; due_date: string | null; before: { title: string; due_date: string | null } }
    | { type: 'task_complete' | 'task_delete'; task_id: string; title: string }
    | { type: 'shopping_check' | 'shopping_delete'; list_id: string; item_id: string; name: string; list_title: string }
    | {
        type: 'budget_entry';
        category: string;
        amount: number;
        description: string | null;
        date: string;
        is_expense: boolean;
    };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

const cleanString = (value: unknown, maxLength: number): string => {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
};

const cleanDate = (value: unknown): string | null => {
    const s = cleanString(value, 10);
    return DATE_RE.test(s) ? s : null;
};

/** Normalize to naive local "YYYY-MM-DDTHH:mm:ss". */
const cleanDateTime = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const match = value.trim().match(DATETIME_RE);
    if (!match) return null;
    return `${match[1]}T${match[2]}:${match[3]}:${match[4] ?? '00'}`;
};

const cleanPositiveNumber = (value: unknown, max: number): number | null => {
    const n = typeof value === 'string' ? parseFloat(value) : (value as number);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(Math.round(n * 100) / 100, max);
};

const resolveMembers = (
    names: unknown,
    members: FamilyMemberRef[]
): { ids: string[]; names: string[] } => {
    if (!Array.isArray(names)) return { ids: [], names: [] };
    const byName = new Map(members.map((m) => [m.name.trim().toLowerCase(), m]));
    const ids: string[] = [];
    const resolved: string[] = [];
    for (const raw of names) {
        if (typeof raw !== 'string') continue;
        const member = byName.get(raw.trim().toLowerCase());
        if (member && !ids.includes(member.id)) {
            ids.push(member.id);
            resolved.push(member.name);
        }
    }
    return { ids, names: resolved };
};

const norm = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const words = (value: string) => norm(value).split(/[^a-z0-9]+/).filter(Boolean);
const names = (value: unknown): string[] => Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string' && Boolean(name.trim())).map((name) => name.trim().slice(0, 60)).slice(0, 10) : [];

/** The colour of the first named person with a colour label ("Sam", "Blue: Sam"). */
function personColour(people: string[], context: HouseholdContext): { colorId: string | null; labels: string[] } | null {
    const labels: string[] = [];
    let colorId: string | null | undefined;
    for (const name of people) {
        const wanted = norm(name);
        const match = context.people.find((person) => norm(person.label) === wanted)
            // "Sam" or "Fictional Sam" also matches a label such as "Blue: Fictional Sam", as whole words.
            ?? context.people.find((person) => wanted.length > 1 && ` ${words(person.label).join(' ')} `.includes(` ${words(name).join(' ')} `));
        if (!match || labels.includes(match.label)) continue;
        labels.push(match.label);
        if (colorId === undefined) colorId = match.colorId;
    }
    return colorId === undefined ? null : { colorId, labels };
}

/** The named shopping list, else one whose name contains the store, else the first list. */
function shoppingList(name: unknown, context: HouseholdContext): { id: string; title: string } | null {
    if (!context.lists.length) return null;
    const wanted = typeof name === 'string' ? norm(name) : '';
    if (wanted) {
        const match = context.lists.find((list) => norm(list.title) === wanted)
            ?? context.lists.find((list) => norm(list.title).includes(wanted) || wanted.includes(norm(list.title)));
        if (match) return match;
    }
    return context.lists[0];
}

const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
/** The UTC instant of 23:59:59 on a date in a time zone, as RRULE's UNTIL wants it. */
function endOfDayUtc(date: string, timeZone: string): string {
    const guess = Date.parse(`${date}T23:59:59Z`);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const offset = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`) - guess;
    return new Date(guess - offset).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** "RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=10" from the model's repeat fields, or null. */
export function repeatRule(item: { repeat?: unknown; repeat_days?: unknown; repeat_until?: unknown; repeat_count?: unknown }, startDate: string, timeZone: string): string | null {
    const frequency = typeof item.repeat === 'string' ? item.repeat.trim().toLowerCase() : '';
    if (!['daily', 'weekly', 'monthly', 'yearly'].includes(frequency)) return null;
    const parts = [`FREQ=${frequency.toUpperCase()}`];
    if (frequency === 'weekly' && Array.isArray(item.repeat_days)) {
        const days = [...new Set(item.repeat_days.filter((day): day is string => typeof day === 'string').map((day) => day.trim().toUpperCase().slice(0, 2)).filter((day) => WEEKDAY_CODES.includes(day)))];
        if (days.length) parts.push(`BYDAY=${WEEKDAY_CODES.filter((day) => days.includes(day)).join(',')}`);
    }
    const count = Math.floor(Number(item.repeat_count));
    const until = cleanDate(item.repeat_until);
    if (Number.isFinite(count) && count >= 1) parts.push(`COUNT=${Math.min(count, 500)}`);
    else if (until && until >= startDate) parts.push(`UNTIL=${endOfDayUtc(until, timeZone)}`);
    return `RRULE:${parts.join(';')}`;
}

const daysBetween = (from: string, to: string) => Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));

/** A change to an existing event: only what the note changes, with the rest kept (and the length kept when only the start moves). */
function eventUpdate(item: RawParsedItem, event: HouseholdContext['events'][number], context: HouseholdContext): ParsedProposal | null {
    let start: EventPoint, end: EventPoint;
    if (event.allDay) {
        const date = cleanDate(item.date) ?? cleanDateTime(item.start_time)?.slice(0, 10) ?? null;
        start = date ? { date } : { date: event.start.date };
        end = date ? { date: addDays(date, daysBetween(event.start.date!, event.end.date!)) } : { date: event.end.date };
    } else {
        const oldStart = `${wallTime(event.start, context.timeZone)}:00`, oldEnd = `${wallTime(event.end, context.timeZone)}:00`;
        const minutes = Math.max(1, Math.round((Date.parse(event.end.dateTime!) - Date.parse(event.start.dateTime!)) / 60_000));
        const date = cleanDate(item.date);
        const movedStart = cleanDateTime(item.start_time) ?? (date ? `${date}T${oldStart.slice(11)}` : null);
        const startLocal = movedStart ?? oldStart;
        let endLocal = cleanDateTime(item.end_time) ?? (movedStart ? addMinutes(startLocal, minutes)! : oldEnd);
        if (endLocal <= startLocal) endLocal = addMinutes(startLocal, minutes)!;
        start = { dateTime: startLocal, timeZone: context.timeZone };
        end = { dateTime: endLocal, timeZone: context.timeZone };
    }
    const person = personColour(names(item.people), context);
    const title = cleanString(item.title, 255) || event.title;
    const location = cleanString(item.location, 255) || event.location;
    const colorId = person ? person.colorId : event.colorId;
    const timeChanged = event.allDay ? start.date !== event.start.date || end.date !== event.end.date
        : start.dateTime !== `${wallTime(event.start, context.timeZone)}:00` || end.dateTime !== `${wallTime(event.end, context.timeZone)}:00`;
    if (!timeChanged && title === event.title && location === event.location && (colorId ?? null) === (event.colorId ?? null)) return null;
    return { type: 'appointment_update', event_id: event.id, title, location, color_id: colorId ?? null, people: person?.labels ?? [], all_day: event.allDay, start, end,
        before: { title: event.title, start: event.start, end: event.end, location: event.location } };
}

/** Changes to what already exists, by reference (E1, T1, S1) only. */
function editProposal(item: RawParsedItem, context: HouseholdContext): ParsedProposal | null {
    const ref = typeof item.ref === 'string' ? item.ref.trim().toUpperCase() : '';
    switch (item.type) {
        case 'appointment_update': { const event = context.events.find((e) => e.ref === ref); return event ? eventUpdate(item, event, context) : null; }
        case 'appointment_delete': {
            const event = context.events.find((e) => e.ref === ref);
            return event ? { type: 'appointment_delete', event_id: event.id, title: event.title, all_day: event.allDay, start: event.start } : null;
        }
        case 'task_update': {
            const task = context.tasks.find((t) => t.ref === ref);
            if (!task) return null;
            const title = cleanString(item.title, 255) || task.title;
            const due = cleanDate(item.date) ?? task.dueDate;
            return title === task.title && due === task.dueDate ? null
                : { type: 'task_update', task_id: task.id, title, due_date: due, before: { title: task.title, due_date: task.dueDate } };
        }
        case 'task_complete': case 'task_delete': {
            const task = context.tasks.find((t) => t.ref === ref);
            return task ? { type: item.type, task_id: task.id, title: task.title } : null;
        }
        case 'shopping_check': case 'shopping_delete': {
            const entry = context.items.find((i) => i.ref === ref);
            return entry ? { type: item.type, list_id: entry.listId, item_id: entry.id, name: entry.name, list_title: entry.listTitle } : null;
        }
        default: return null;
    }
}

/**
 * Structural validation of the model output: drop invalid items, clamp values,
 * resolve member names → ids (case-insensitively). Returns at most 20 proposals.
 * With a household context (Family Hub), also people → event colour, the
 * shopping list, repeat rules, and changes to existing items by reference.
 */
export function validateParsedItems(
    raw: Record<string, unknown>,
    members: FamilyMemberRef[],
    shoppingCategories: readonly string[] = SHOPPING_CATEGORIES,
    budgetCategories: readonly string[] = BUDGET_CATEGORIES,
    context: HouseholdContext | null = null,
): ParsedProposal[] {
    const items = Array.isArray(raw.items) ? (raw.items as RawParsedItem[]) : [];
    const proposals: ParsedProposal[] = [];
    const seen = new Set<string>();

    for (const item of items.slice(0, 20)) {
        if (!item || typeof item !== 'object') continue;
        if ((EDIT_TYPES as readonly unknown[]).includes(item.type)) {
            const edit = context ? editProposal(item, context) : null;
            // One change per item: the first proposal for a reference wins.
            const key = edit && ('event_id' in edit ? edit.event_id : 'task_id' in edit ? edit.task_id : 'item_id' in edit ? edit.item_id : '');
            if (edit && key && !seen.has(key)) { seen.add(key); proposals.push(edit); }
            continue;
        }
        const title = cleanString(item.title, 255);
        if (!title) continue;
        const description = cleanString(item.description, 1000) || null;

        switch (item.type) {
            case 'task': {
                const priority = cleanString(item.priority, 20);
                const frequency = cleanString(item.frequency, 30);
                const { ids, names } = resolveMembers(item.member_names, members);
                proposals.push({
                    type: 'task',
                    title,
                    description,
                    due_date: cleanDate(item.date),
                    priority: (TASK_PRIORITIES as readonly string[]).includes(priority) ? priority : null,
                    frequency: (TASK_FREQUENCIES as readonly string[]).includes(frequency) ? frequency : null,
                    assigned_to: ids,
                    member_names: names,
                });
                break;
            }
            case 'appointment': {
                const startTime = cleanDateTime(item.start_time);
                if (!startTime) continue; // start_time is mandatory for appointments
                let endTime = cleanDateTime(item.end_time);
                if (endTime && endTime <= startTime) endTime = null;
                const { ids, names: memberNames } = resolveMembers(item.member_names, members);
                const person = context ? personColour([...names(item.people), ...names(item.member_names)], context) : null;
                const recurrence = context ? repeatRule(item, startTime.slice(0, 10), context.timeZone) : null;
                proposals.push({
                    type: 'appointment',
                    title,
                    description,
                    start_time: startTime,
                    end_time: endTime,
                    location: cleanString(item.location, 255) || null,
                    family_member_ids: ids,
                    member_names: memberNames,
                    ...(person ? { color_id: person.colorId, people: person.labels } : {}),
                    ...(recurrence ? { recurrence } : {}),
                });
                break;
            }
            case 'shopping_item': {
                const category = cleanString(item.category, 30);
                proposals.push({
                    type: 'shopping_item',
                    name: title,
                    category: shoppingCategories.includes(category)
                        ? category
                        : (shoppingCategories.includes('Autre') ? 'Autre' : shoppingCategories[0]),
                    quantity: cleanPositiveNumber(item.quantity, 9999),
                    unit: cleanString(item.unit, 20) || null,
                    ...(context?.lists.length ? (() => { const list = shoppingList(item.list, context)!; return { list_id: list.id, list_title: list.title }; })() : {}),
                });
                break;
            }
            case 'budget_entry': {
                const amount = cleanPositiveNumber(item.amount, 1_000_000);
                if (amount === null) continue; // amount is mandatory for budget entries
                const category = cleanString(item.category, 50);
                proposals.push({
                    type: 'budget_entry',
                    category: budgetCategories.includes(category)
                        ? category
                        : (budgetCategories.includes('general') ? 'general' : budgetCategories[0]),
                    amount,
                    description: description ?? title,
                    date: cleanDate(item.date) ?? localToday(context?.timeZone).iso,
                    is_expense: item.is_expense === false ? false : true,
                });
                break;
            }
            default:
                break;
        }
    }

    return proposals;
}
