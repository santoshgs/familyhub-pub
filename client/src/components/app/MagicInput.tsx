import { postProposal } from '../../familyhub/saveProposal';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Sparkles,
    CheckSquare,
    Calendar as CalendarIcon,
    ShoppingCart,
    Euro,
    Loader2,
    AlertCircle,
    MapPin,
    Users,
    Pencil,
    Trash2,
    Check,
} from 'lucide-react';
import { format } from 'date-fns';
import { api } from '../../lib/api';
import { useAiEnabled } from '../../lib/aiStatus';
import { useAuth } from '../../contexts/AuthContext';
import { dateLocale, formatTime } from '../../i18n/format';
import { Button, Dialog, Textarea, useToast } from '../ui';

// Proposal shapes mirror server/src/services/ai/assistant.ts (already validated
// server-side); the client only maps each one onto the existing POST endpoints.
interface TaskProposal {
    type: 'task';
    title: string;
    description: string | null;
    due_date: string | null;
    priority: string | null;
    frequency: string | null;
    assigned_to: string[];
    member_names: string[];
}
interface AppointmentProposal {
    type: 'appointment';
    title: string;
    description: string | null;
    start_time: string;
    end_time: string | null;
    location: string | null;
    family_member_ids: string[];
    member_names: string[];
    /** Family Hub: Google event colour for the people it is for ('' or null = the calendar's colour). */
    color_id?: string | null;
    people?: string[];
    /** Family Hub: one RRULE line. */
    recurrence?: string | null;
}
interface ShoppingProposal {
    type: 'shopping_item';
    name: string;
    category: string;
    quantity: number | null;
    unit: string | null;
    /** Family Hub: the Google Tasks shopping list it goes on. */
    list_id?: string | null;
    list_title?: string | null;
}
type EventPoint = { date?: string; dateTime?: string; timeZone?: string };
// Changes to existing Google items (Family Hub, v2.1), by the ids the server resolved.
export interface EventUpdateProposal {
    type: 'appointment_update'; event_id: string; title: string; location: string; color_id: string | null; people: string[];
    all_day: boolean; start: EventPoint; end: EventPoint; before: { title: string; start: EventPoint; end: EventPoint; location: string };
}
export interface EventDeleteProposal { type: 'appointment_delete'; event_id: string; title: string; all_day: boolean; start: EventPoint }
export interface TaskUpdateProposal { type: 'task_update'; task_id: string; title: string; due_date: string | null; before: { title: string; due_date: string | null } }
export interface TaskChangeProposal { type: 'task_complete' | 'task_delete'; task_id: string; title: string }
export interface ShoppingChangeProposal { type: 'shopping_check' | 'shopping_delete'; list_id: string; item_id: string; name: string; list_title: string }
interface BudgetProposal {
    type: 'budget_entry';
    category: string;
    amount: number;
    description: string | null;
    date: string;
    is_expense: boolean;
}
export type EditProposal = EventUpdateProposal | EventDeleteProposal | TaskUpdateProposal | TaskChangeProposal | ShoppingChangeProposal;
export type AiProposal = TaskProposal | AppointmentProposal | ShoppingProposal | BudgetProposal | EditProposal;
export const isEdit = (proposal: AiProposal): proposal is EditProposal =>
    ['appointment_update', 'appointment_delete', 'task_update', 'task_complete', 'task_delete', 'shopping_check', 'shopping_delete'].includes(proposal.type);

const AI_ERROR_CODES = [
    'AI_NOT_CONFIGURED',
    'AI_DISABLED',
    'AI_UNREACHABLE',
    'AI_UNAUTHORIZED',
    'AI_MODEL_NOT_FOUND',
    'AI_INVALID_RESPONSE',
    'AI_PROVIDER_ERROR',
];

/** Maps a server error to its `ai:errors.*` i18n key, or null for raw display. */
export const aiErrorKey = (error: unknown): string | null => {
    const message = error instanceof Error ? error.message : String(error);
    return AI_ERROR_CODES.includes(message) ? message : null;
};

const TYPE_META = {
    task: { icon: CheckSquare, color: 'text-primary' },
    appointment: { icon: CalendarIcon, color: 'text-blue-600 dark:text-blue-400' },
    shopping_item: { icon: ShoppingCart, color: 'text-emerald-600 dark:text-emerald-400' },
    budget_entry: { icon: Euro, color: 'text-amber-600 dark:text-amber-400' },
    appointment_update: { icon: Pencil, color: 'text-blue-600 dark:text-blue-400' },
    appointment_delete: { icon: Trash2, color: 'text-destructive' },
    task_update: { icon: Pencil, color: 'text-primary' },
    task_complete: { icon: Check, color: 'text-primary' },
    task_delete: { icon: Trash2, color: 'text-destructive' },
    shopping_check: { icon: Check, color: 'text-emerald-600 dark:text-emerald-400' },
    shopping_delete: { icon: Trash2, color: 'text-destructive' },
} as const;

/** "Every week on Tue, 10 times" from an RRULE line, in the user's language. */
function describeRepeat(rule: string, t: (key: string, options?: Record<string, unknown>) => string): string {
    const fields = Object.fromEntries(rule.replace(/^RRULE:/, '').split(';').map((part) => part.split('=')));
    const days = fields.BYDAY ? String(fields.BYDAY).split(',').map((code) => t(`ai:magic.days.${code}`, { defaultValue: code })).join(', ') : '';
    const every = t(`ai:magic.repeat.${String(fields.FREQ).toLowerCase()}`, { defaultValue: String(fields.FREQ).toLowerCase() });
    const until = fields.UNTIL ? `${String(fields.UNTIL).slice(0, 4)}-${String(fields.UNTIL).slice(4, 6)}-${String(fields.UNTIL).slice(6, 8)}` : '';
    return [days ? `${every} (${days})` : every, fields.COUNT ? t('ai:magic.repeat.count', { count: Number(fields.COUNT), defaultValue: '{{count}} times' }) : '', until ? t('ai:magic.repeat.until', { date: until, defaultValue: 'until {{date}}' }) : ''].filter(Boolean).join(' · ');
}


const ProposalCard: React.FC<{
    proposal: AiProposal;
    checked: boolean;
    onToggle: () => void;
}> = ({ proposal, checked, onToggle }) => {
    const { t } = useTranslation(['ai', 'shopping']);
    const meta = TYPE_META[proposal.type];
    const Icon = meta.icon;
    const locale = dateLocale();

    const formatDay = (iso: string) => format(new Date(`${iso}T12:00:00`), 'EEE dd MMM', { locale });
    const formatDateTime = (iso: string) => `${format(new Date(iso), 'EEE dd MMM', { locale })} ${formatTime(iso)}`;

    // A point of a Google event: its date, or its time in the household's zone.
    const formatPoint = (point: EventPoint) => point.date ? formatDay(point.date) : formatDateTime(point.dateTime ?? '');
    const details: string[] = [];
    let title = '';
    let change = '';
    if (proposal.type === 'appointment_update') {
        title = proposal.before.title;
        const before = formatPoint(proposal.before.start), after = formatPoint(proposal.start);
        if (before !== after || formatPoint(proposal.before.end) !== formatPoint(proposal.end)) change = `${before} → ${after}`;
        if (proposal.title !== proposal.before.title) details.push(`→ “${proposal.title}”`);
        if (proposal.location !== proposal.before.location) details.push(`→ ${proposal.location || t('ai:magic.noPlace', { defaultValue: 'no place' })}`);
        if (proposal.people.length) details.push(proposal.people.join(', '));
    } else if (proposal.type === 'appointment_delete') {
        title = proposal.title; details.push(formatPoint(proposal.start));
    } else if (proposal.type === 'task_update') {
        title = proposal.before.title;
        if (proposal.title !== proposal.before.title) details.push(`→ “${proposal.title}”`);
        if (proposal.due_date !== proposal.before.due_date) change = `${proposal.before.due_date ? formatDay(proposal.before.due_date) : '—'} → ${proposal.due_date ? formatDay(proposal.due_date) : '—'}`;
    } else if (proposal.type === 'task_complete' || proposal.type === 'task_delete') {
        title = proposal.title;
    } else if (proposal.type === 'shopping_check' || proposal.type === 'shopping_delete') {
        title = proposal.name; details.push(proposal.list_title);
    } else if (proposal.type === 'task') {
        if (proposal.due_date) details.push(formatDay(proposal.due_date));
        if (proposal.priority) details.push(proposal.priority);
        if (proposal.frequency && proposal.frequency !== 'Une fois') details.push(proposal.frequency);
    } else if (proposal.type === 'appointment') {
        details.push(formatDateTime(proposal.start_time));
        if (proposal.recurrence) details.push(describeRepeat(proposal.recurrence, t));
    } else if (proposal.type === 'shopping_item') {
        if (proposal.list_title) details.push(proposal.list_title);
        details.push(t(`shopping:categories.${proposal.category}`, { defaultValue: proposal.category }));
        if (proposal.quantity) details.push(`×${proposal.quantity}${proposal.unit ? ` ${proposal.unit}` : ''}`);
    } else if (proposal.type === 'budget_entry') {
        details.push(proposal.category);
        details.push(
            `${proposal.is_expense ? '−' : '+'}${proposal.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
        );
        details.push(formatDay(proposal.date));
    }

    if (!title) {
        title = proposal.type === 'shopping_item'
            ? proposal.name
            : proposal.type === 'budget_entry'
                ? proposal.description || proposal.category
                : 'title' in proposal ? proposal.title : '';
    }
    if (change) details.unshift(change);

    const memberNames =
        proposal.type === 'appointment' && proposal.people?.length ? proposal.people
            : proposal.type === 'task' || proposal.type === 'appointment' ? proposal.member_names : [];
    const removing = proposal.type === 'appointment_delete' || proposal.type === 'task_delete' || proposal.type === 'shopping_delete';

    return (
        <label className="flex cursor-pointer items-start gap-3 rounded-input border border-border p-3 transition-colors hover:bg-surface-2">
            <input
                type="checkbox"
                checked={checked}
                onChange={onToggle}
                className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${meta.color}`} />
            <span className="min-w-0 flex-1">
                <span className={`block text-caption font-medium ${removing ? 'text-destructive line-through' : 'text-foreground'}`}>{title}</span>
                <span className="mt-0.5 block text-micro text-muted-foreground">
                    {t(`ai:magic.types.${proposal.type}`)}
                    {details.length > 0 && ` · ${details.join(' · ')}`}
                </span>
                {memberNames.length > 0 && (
                    <span className="mt-0.5 flex items-center gap-1 text-micro text-muted-foreground">
                        <Users className="h-3 w-3" />
                        {memberNames.join(', ')}
                    </span>
                )}
                {proposal.type === 'appointment' && proposal.location && (
                    <span className="mt-0.5 flex items-center gap-1 text-micro text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {proposal.location}
                    </span>
                )}
            </span>
        </label>
    );
};

/**
 * Sparkles button + "magic input" dialog: a natural-language note is parsed by
 * the configured AI into proposals (task / appointment / shopping / budget) that
 * the user reviews and confirms. Rendered only when the AI is configured+enabled.
 */
export const MagicInputButton: React.FC<{ google?: { timeZone: string }; onSaved?: () => void; label?: string }> = ({ google, onSaved, label }) => {
    const { t } = useTranslation(['ai', 'common']);
    const aiEnabled = useAiEnabled();
    const { isModuleEnabled } = useAuth();
    const { showToast } = useToast();
    const [open, setOpen] = useState(false);
    const [text, setText] = useState('');
    const [parsing, setParsing] = useState(false);
    const [proposals, setProposals] = useState<AiProposal[] | null>(null);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    // Ctrl+K / Cmd+K opens the dialog.
    useEffect(() => {
        if (!aiEnabled) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setOpen(true);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [aiEnabled]);

    const reset = () => {
        setText('');
        setProposals(null);
        setSelected(new Set());
        setError('');
        setParsing(false);
        setSubmitting(false);
    };

    const errorText = useMemo(
        () => (err: unknown) => {
            const key = aiErrorKey(err);
            return key ? t(`ai:errors.${key}`) : err instanceof Error ? err.message : t('ai:errors.AI_PROVIDER_ERROR');
        },
        [t]
    );

    if (!aiEnabled || !isModuleEnabled('ai')) return null;

    const handleParse = async () => {
        if (!text.trim()) return;
        setParsing(true);
        setError('');
        try {
            const response = await api.post<{ success: boolean; data: { items: AiProposal[] } }>(
                '/api/ai/parse',
                { text: text.trim() }
            );
            const items = response.success ? response.data.items : [];
            setProposals(items);
            setSelected(new Set(items.map((_, index) => index)));
        } catch (err) {
            setError(errorText(err));
        } finally {
            setParsing(false);
        }
    };

    const toggle = (index: number) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    };

    const handleConfirm = async () => {
        if (!proposals) return;
        const chosen = proposals.filter((_, index) => selected.has(index));
        if (chosen.length === 0) return;
        setSubmitting(true);
        let added = 0;
        let failed = 0;
        let failureMessage = '';
        for (const proposal of chosen) {
            try {
                await postProposal(proposal, google);
                added += 1;
            } catch (err) {
                failureMessage = errorText(err);
                failed += 1;
            }
        }
        setSubmitting(false);
        if (added) onSaved?.();
        if (failed === 0) {
            showToast({
                title: t('ai:magic.successTitle'),
                description: t('ai:magic.successDescription', { count: added }),
            });
            setOpen(false);
            reset();
        } else if (added > 0) {
            showToast({
                title: t('ai:magic.partialTitle'),
                description: t('ai:magic.partialDescription', { added, failed }),
            });
            setOpen(false);
            reset();
        } else {
            setError(failureMessage || t('ai:magic.allFailed'));
        }
    };

    return (
        <>
            <Button
                variant="secondary"
                size={label ? undefined : 'icon'}
                onClick={() => setOpen(true)}
                aria-label={t('ai:magic.open')}
                title={`${t('ai:magic.open')} (Ctrl+K)`}
            >
                <Sparkles className="h-4 w-4 text-primary" />
                {label && <span className="ml-2">{label}</span>}
            </Button>

            <Dialog
                open={open}
                viewportAware
                onOpenChange={(next) => {
                    setOpen(next);
                    if (!next) reset();
                }}
                title={t('ai:magic.title')}
                description={t('ai:magic.description')}
            >
                {proposals === null ? (
                    <div className="space-y-4">
                        <Textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder={t('ai:magic.placeholder')}
                            rows={4}
                            autoFocus
                            style={{ scrollMarginBottom: 'env(safe-area-inset-bottom, 12px)' }}
                            onKeyDown={(e) => {
                                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                    e.preventDefault();
                                    void handleParse();
                                }
                            }}
                        />
                        {error && (
                            <p className="flex items-center gap-1 text-micro text-destructive">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                {error}
                            </p>
                        )}
                        <div className="flex justify-end gap-3">
                            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                                {t('common:actions.cancel')}
                            </Button>
                            <Button type="button" onClick={() => void handleParse()} disabled={parsing || !text.trim()}>
                                {parsing ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Sparkles className="mr-2 h-4 w-4" />
                                )}
                                {parsing ? t('ai:magic.parsing') : t('ai:magic.parse')}
                            </Button>
                        </div>
                    </div>
                ) : proposals.length === 0 ? (
                    <div className="space-y-4">
                        <div className="py-6 text-center">
                            <Sparkles className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                            <p className="text-caption text-muted-foreground">{t('ai:magic.nothingFound')}</p>
                        </div>
                        <div className="flex justify-end">
                            <Button type="button" variant="secondary" onClick={() => setProposals(null)}>
                                {t('ai:magic.back')}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <p className="text-micro text-muted-foreground">{t('ai:magic.reviewHint')}</p>
                        {(google || import.meta.env.VITE_FAMILYHUB_LOCAL === 'true') && <p className="text-micro text-muted-foreground">Events and tasks save to the selected Google sources. Google Tasks supports due dates and descriptions; family assignments and priorities are not transferred. Configure recurring tasks in Google Tasks.</p>}
                        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                            {proposals.map((proposal, index) => (
                                <ProposalCard
                                    key={index}
                                    proposal={proposal}
                                    checked={selected.has(index)}
                                    onToggle={() => toggle(index)}
                                />
                            ))}
                        </div>
                        {error && (
                            <p className="flex items-center gap-1 text-micro text-destructive">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                {error}
                            </p>
                        )}
                        <div className="flex justify-end gap-3">
                            <Button type="button" variant="secondary" onClick={() => setProposals(null)} disabled={submitting}>
                                {t('ai:magic.back')}
                            </Button>
                            <Button
                                type="button"
                                onClick={() => void handleConfirm()}
                                disabled={submitting || selected.size === 0}
                            >
                                {submitting ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <CheckSquare className="mr-2 h-4 w-4" />
                                )}
                                {submitting
                                    ? t('ai:magic.confirming')
                                    : proposals.some((proposal, index) => selected.has(index) && isEdit(proposal))
                                        ? t('ai:magic.apply', { count: selected.size, defaultValue: 'Apply ({{count}})' })
                                        : t('ai:magic.confirm', { count: selected.size })}
                            </Button>
                        </div>
                    </div>
                )}
            </Dialog>
        </>
    );
};
