import { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, ListPlus, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { DaycareTimeline, type DaycareUpdate } from './DaycareUpdates';

/** A suggestion the household's AI found in an email (v2.3). Plain text throughout. */
export interface MailSuggestion {
    id: string; messageId: string; sourceName: string; emailTitle: string; kind: 'event' | 'task';
    title: string; date: string; startTime: string | null; endTime: string | null; location: string | null; notes: string | null; evidence: string;
}

const day = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
export const whenText = (item: MailSuggestion) => [day(item.date), item.startTime && (item.endTime ? `${item.startTime}–${item.endTime}` : item.startTime)].filter(Boolean).join(', ');

/**
 * Family Updates page body: suggestions waiting for a parent, then the emails
 * with their AI summaries. Without AI set up, it is just the timeline.
 */
export function FamilyUpdatesView({ updates }: { updates: DaycareUpdate[] }) {
    const { user } = useAuth();
    const parent = Boolean(user?.is_owner || user?.role === 'parent');
    const [suggestions, setSuggestions] = useState<MailSuggestion[]>([]);
    const [summaries, setSummaries] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [message, setMessage] = useState('');
    const load = useCallback(() => api.get<{ data: { suggestions: MailSuggestion[]; summaries: Record<string, string> } }>('/api/familyhub/family-updates/suggestions')
        .then(({ data }) => { setSuggestions(data.suggestions); setSummaries(data.summaries); }).catch(() => undefined), []);
    useEffect(() => { void load(); }, [load, updates]);

    const decide = async (item: MailSuggestion, action: 'accept' | 'dismiss') => {
        setBusy(item.id); setMessage('');
        try {
            await api.post(`/api/familyhub/family-updates/suggestions/${item.id}/${action}`, {});
            setSuggestions((current) => current.filter((entry) => entry.id !== item.id));
            if (action === 'accept') setMessage(`Added “${item.title}” to ${item.kind === 'event' ? 'the calendar' : 'the to-dos'}.`);
        } catch (cause) {
            setMessage(cause instanceof Error ? cause.message : 'That did not work. Try again.');
            void load();
        } finally { setBusy(null); }
    };

    return <>
        {suggestions.length > 0 && <section className="fh-mail-suggestions" aria-label="Suggestions from emails">
            <h3>Suggested from emails <small>{suggestions.length}</small></h3>
            <p className="fh-fine-print">Found by your AI assistant. Nothing is added until {parent ? 'you add it' : 'a parent adds it'}.</p>
            <ul>{suggestions.map((item) => <li key={item.id}>
                <div>
                    <span className="fh-eyebrow">{item.kind === 'event' ? 'Event' : 'To-do'} · {whenText(item)}</span>
                    <strong>{item.title}</strong>
                    {item.location && <span>{item.location}</span>}
                    <small>From {item.sourceName}: “{item.emailTitle}”</small>
                    <q>{item.evidence}</q>
                </div>
                {parent && <div className="fh-mail-actions">
                    <button type="button" className="fh-button fh-primary" disabled={busy !== null} onClick={() => void decide(item, 'accept')}>
                        {item.kind === 'event' ? <CalendarPlus size={16} /> : <ListPlus size={16} />}{item.kind === 'event' ? 'Add to calendar' : 'Add to to-dos'}</button>
                    <button type="button" className="fh-button fh-secondary" disabled={busy !== null} onClick={() => void decide(item, 'dismiss')} aria-label={`Dismiss ${item.title}`}><X size={16} />Dismiss</button>
                </div>}
            </li>)}</ul>
        </section>}
        {message && <p role="status" className="fh-fine-print">{message}</p>}
        <DaycareTimeline updates={updates} summaries={summaries} />
    </>;
}
