import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock } from 'lucide-react';
import { SettingsSection } from '../components/app/SettingsSection';
import { api } from '../lib/api';
import { forgetEventDefaults, type EventDefaults } from './eventDefaults';

interface Preview { source: 'calendar' | 'main' | 'none'; reminders: Array<{ method: 'popup' | 'email'; minutes: number }> }
type Loaded = EventDefaults & { google?: Preview | null };

/** "15 minutes", "1 hour", "1 day" (English and French). */
function duration(minutes: number, t: (key: string, options: Record<string, unknown>) => string): string {
    if (minutes > 0 && minutes % 1440 === 0) return t('calendarEvents.days', { count: minutes / 1440, defaultValue: '{{count}} days' });
    if (minutes > 0 && minutes % 60 === 0) return t('calendarEvents.hours', { count: minutes / 60, defaultValue: '{{count}} hours' });
    return t('calendarEvents.minutes', { count: minutes, defaultValue: '{{count}} minutes' });
}

/**
 * Settings → Household → Calendar events (parents, v2.0.1): the length of an
 * event created without an end, and the notification new events get.
 */
export function CalendarEventDefaults() {
    const { t } = useTranslation('settings');
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [eventMinutes, setEventMinutes] = useState(60);
    const [mode, setMode] = useState<EventDefaults['reminderMode']>('google');
    const [reminderMinutes, setReminderMinutes] = useState(15);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        void api.get<{ data: Loaded }>('/api/familyhub/google/event-defaults?preview=1').then(({ data }) => {
            setLoaded(data); setEventMinutes(data.eventMinutes); setMode(data.reminderMode); setReminderMinutes(data.reminderMinutes);
        }).catch((cause) => setMessage(cause instanceof Error ? cause.message : 'Calendar settings could not be loaded.'));
    }, []);

    const save = async (event: FormEvent) => {
        event.preventDefault();
        setBusy(true); setMessage('');
        try {
            await api.put('/api/familyhub/google/event-defaults', { eventMinutes, reminderMode: mode, reminderMinutes });
            forgetEventDefaults();
            setMessage(t('calendarEvents.saved', { defaultValue: 'Saved.' }));
        } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Not saved.'); }
        finally { setBusy(false); }
    };

    const google = loaded?.google;
    const googleText = !google ? t('calendarEvents.googleUnknown', { defaultValue: 'Uses the notification set for the calendar in Google Calendar.' })
        : google.source === 'none' ? t('calendarEvents.googleNone', { defaultValue: 'Google Calendar has no default notification set, so new events get none.' })
        : t(google.source === 'calendar' ? 'calendarEvents.googleCalendar' : 'calendarEvents.googleMain', {
            when: google.reminders.map((reminder) => duration(reminder.minutes, t)).join(', '),
            defaultValue: google.source === 'calendar' ? 'Now: {{when}} before, from the shared calendar\'s settings in Google Calendar.' : 'Now: {{when}} before, from your main calendar in Google Calendar (the shared calendar has no default of its own).',
        });
    const lengths = [15, 30, 45, 60, 90, 120];
    const before = [0, 5, 10, 15, 30, 60, 120, 1440];
    const subtitle = loaded ? `${duration(eventMinutes, t)} · ${mode === 'none' ? t('calendarEvents.noneShort', { defaultValue: 'no notification' }) : mode === 'custom' ? t('calendarEvents.customShort', { when: duration(reminderMinutes, t), defaultValue: 'notify {{when}} before' }) : t('calendarEvents.googleShort', { defaultValue: 'Google\'s notification' })}` : '';
    const select = 'mt-1 min-h-11 w-full rounded-input border border-input bg-background px-2 text-body';

    return <SettingsSection id="calendar-events" icon={<CalendarClock size={20} />} title={t('calendarEvents.title', { defaultValue: 'Calendar events' })} subtitle={subtitle}>
        {!loaded ? <p className="fh-fine-print">{message || t('calendarEvents.loading', { defaultValue: 'Loading…' })}</p>
            : !loaded.configured ? <p className="fh-fine-print">{t('calendarEvents.connect', { defaultValue: 'Connect Google and choose the shared calendar first (Home → Google).' })}</p>
            : <form className="space-y-3" onSubmit={(event) => void save(event)}>
                <label className="block text-label font-medium text-foreground">{t('calendarEvents.length', { defaultValue: 'Default event length' })}
                    <select className={select} value={eventMinutes} onChange={(e) => setEventMinutes(Number(e.target.value))}>
                        {[...new Set([...lengths, eventMinutes])].sort((a, b) => a - b).map((value) => <option key={value} value={value}>{duration(value, t)}</option>)}
                    </select>
                    <span className="mt-1 block text-micro font-normal text-muted-foreground">{t('calendarEvents.lengthHelp', { defaultValue: 'Used when an event is added without an end time, for example by the AI assistant, and to fill in the end in the event form.' })}</span>
                </label>
                <fieldset className="space-y-1">
                    <legend className="text-label font-medium text-foreground">{t('calendarEvents.reminder', { defaultValue: 'Notification for new events' })}</legend>
                    <label className="flex min-h-11 items-start gap-3 text-body text-foreground"><input type="radio" className="mt-1 h-5 w-5" name="reminder-mode" checked={mode === 'google'} onChange={() => setMode('google')} />
                        <span>{t('calendarEvents.google', { defaultValue: 'Use Google Calendar\'s default' })}<small className="block text-micro text-muted-foreground">{googleText}</small></span></label>
                    <label className="flex min-h-11 items-center gap-3 text-body text-foreground"><input type="radio" className="h-5 w-5" name="reminder-mode" checked={mode === 'custom'} onChange={() => setMode('custom')} />
                        <span className="flex flex-wrap items-center gap-2">{t('calendarEvents.custom', { defaultValue: 'Notify me' })}
                            <select className="min-h-9 rounded-input border border-input bg-background px-2" value={reminderMinutes} disabled={mode !== 'custom'} aria-label={t('calendarEvents.customWhen', { defaultValue: 'How long before' })}
                                onChange={(e) => setReminderMinutes(Number(e.target.value))}>
                                {[...new Set([...before, reminderMinutes])].sort((a, b) => a - b).map((value) => <option key={value} value={value}>{value === 0 ? t('calendarEvents.atStart', { defaultValue: 'at the start' }) : t('calendarEvents.before', { when: duration(value, t), defaultValue: '{{when}} before' })}</option>)}
                            </select></span></label>
                    <label className="flex min-h-11 items-center gap-3 text-body text-foreground"><input type="radio" className="h-5 w-5" name="reminder-mode" checked={mode === 'none'} onChange={() => setMode('none')} />
                        {t('calendarEvents.none', { defaultValue: 'No notification' })}</label>
                    <p className="text-micro text-muted-foreground">{t('calendarEvents.reminderHelp', { defaultValue: 'Applies to timed events created from Family Hub, the AI assistant and connected apps. All-day events keep Google\'s own setting. Notifications are personal in Google: they show for the connected account.' })}</p>
                </fieldset>
                <button className="fh-button fh-primary min-h-11" disabled={busy}>{t('calendarEvents.save', { defaultValue: 'Save' })}</button>
                {message && <p role="status" className="fh-fine-print">{message}</p>}
            </form>}
    </SettingsSection>;
}
