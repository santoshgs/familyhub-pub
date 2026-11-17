import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail } from 'lucide-react';
import { SettingsSection } from '../components/app/SettingsSection';
import { api } from '../lib/api';

interface LabelSource { labelId: string; name: string; display: boolean; verifiedOnly: boolean; ai: boolean }
interface Settings { lillio: { enabled: boolean; name: string; display: boolean; ai: boolean }; labels: LabelSource[] }
interface AiStatus { configured: boolean; provider: string | null; model: string | null; moduleOn: boolean }
interface Loaded { settings: Settings; gmail: boolean; labels: { id: string; name: string }[]; stats: Record<string, { shown: number; hidden: number }>; ai: AiStatus }
const PROVIDER_NAMES: Record<string, string> = { gemini: 'Google Gemini', openai: 'OpenAI', anthropic: 'Anthropic', ollama: 'Ollama' };

/** "Kids/School" → "School": the label's own last part makes a good card name. */
const shortName = (label: string) => (label.split('/').pop() || label).trim().slice(0, 40);

/**
 * Settings → Household → Family Updates (parents, v2.2): Lillio and the Gmail
 * labels the module shows. What goes into a label is managed in Gmail (usually
 * with a filter); here the household only picks labels, names them, and says
 * whether each may appear on the kitchen display.
 */
export function FamilyUpdatesSettings() {
    const { t } = useTranslation('settings');
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [settings, setSettings] = useState<Settings | null>(null);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        void api.get<{ data: Loaded }>('/api/familyhub/google/family-updates').then(({ data }) => { setLoaded(data); setSettings(data.settings); })
            .catch((cause) => setMessage(cause instanceof Error && cause.message.includes('MODULE_DISABLED')
                ? t('familyUpdates.moduleOff', { defaultValue: 'Turn on the Family Updates module (Modules, below) to choose its emails.' })
                : cause instanceof Error ? cause.message : 'Family Updates settings could not be loaded.'));
    }, [t]);

    const chosen = (id: string) => settings?.labels.find((label) => label.labelId === id);
    const setLabel = (id: string, change: Partial<LabelSource>) => setSettings((current) => current && ({ ...current, labels: current.labels.map((label) => label.labelId === id ? { ...label, ...change } : label) }));
    const toggle = (id: string, name: string, on: boolean) => setSettings((current) => current && ({ ...current,
        labels: on ? [...current.labels, { labelId: id, name: shortName(name), display: true, verifiedOnly: true, ai: false }] : current.labels.filter((label) => label.labelId !== id) }));
    const save = async (event: FormEvent) => {
        event.preventDefault();
        if (!settings) return;
        setBusy(true); setMessage('');
        try {
            const { data } = await api.put<{ data: Settings }>('/api/familyhub/google/family-updates', settings);
            setSettings(data);
            setMessage(t('familyUpdates.saved', { defaultValue: 'Saved. Family Updates refreshes within a few minutes.' }));
        } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Not saved.'); }
        finally { setBusy(false); }
    };
    const stat = (id: string) => {
        const value = loaded?.stats[id];
        if (!value) return null;
        return <small className="block text-micro text-muted-foreground">{t('familyUpdates.stats', { shown: value.shown, defaultValue: 'Last refresh: {{shown}} shown' })}
            {value.hidden > 0 && t('familyUpdates.hidden', { hidden: value.hidden, defaultValue: ', {{hidden}} hidden (sender not verified or unreadable)' })}</small>;
    };

    const aiReady = Boolean(loaded?.ai.configured && loaded.ai.moduleOn);
    const aiBox = (checked: boolean, change: (value: boolean) => void) => <label className="flex min-h-10 items-start gap-3 text-body text-foreground">
        <input type="checkbox" className="mt-1 h-5 w-5" checked={checked && aiReady} disabled={!aiReady} onChange={(e) => change(e.target.checked)} />
        <span>{t('familyUpdates.ai', { defaultValue: 'AI summaries and suggestions' })}
            <small className="block text-micro text-muted-foreground">{aiReady
                ? t('familyUpdates.aiHelp', { provider: PROVIDER_NAMES[loaded!.ai.provider ?? ''] ?? loaded!.ai.provider, defaultValue: 'Sends these emails to {{provider}} once each, for a short summary and suggested events or to-dos you can add or dismiss.' })
                : t('familyUpdates.aiOff', { defaultValue: 'Set up and enable the AI assistant (Settings → Household → AI assistant) to use this.' })}</small></span></label>;
    const anyAi = Boolean(settings && aiReady && (settings.lillio.ai || settings.labels.some((label) => label.ai)));
    const count = settings ? Number(settings.lillio.enabled) + settings.labels.length : 0;
    const subtitle = settings ? t('familyUpdates.subtitle', { count, defaultValue: '{{count}} sources' }) : '';
    const input = 'mt-1 min-h-10 w-full rounded-input border border-input bg-background px-2 text-body';
    const check = 'flex min-h-10 items-center gap-3 text-body text-foreground';
    // Labels the household chose that Gmail no longer lists stay visible, so they can be removed.
    const missing = settings?.labels.filter((label) => !loaded?.labels.some((item) => item.id === label.labelId)) ?? [];

    return <SettingsSection id="family-updates" icon={<Mail size={20} />} title={t('familyUpdates.title', { defaultValue: 'Family Updates' })} subtitle={subtitle}>
        {!loaded || !settings ? <p className="fh-fine-print">{message || t('familyUpdates.loading', { defaultValue: 'Loading…' })}</p>
            : <form className="space-y-4" onSubmit={(event) => void save(event)}>
                {!loaded.gmail && <p className="fh-fine-print">{t('familyUpdates.noGmail', { defaultValue: 'Family Updates reads Gmail. Authorize Gmail from Home → Google first; until then nothing is shown.' })}</p>}
                <fieldset className="space-y-1">
                    <legend className="text-label font-medium text-foreground">{t('familyUpdates.lillio', { defaultValue: 'Lillio (daycare app)' })}</legend>
                    <label className={check}><input type="checkbox" className="h-5 w-5" checked={settings.lillio.enabled} onChange={(e) => setSettings({ ...settings, lillio: { ...settings.lillio, enabled: e.target.checked } })} />
                        {t('familyUpdates.lillioOn', { defaultValue: 'Show Lillio notification emails' })}</label>
                    {settings.lillio.enabled && <div className="space-y-1 pl-8">
                        <label className="block text-label text-foreground">{t('familyUpdates.name', { defaultValue: 'Name on the card' })}
                            <input className={input} maxLength={40} value={settings.lillio.name} onChange={(e) => setSettings({ ...settings, lillio: { ...settings.lillio, name: e.target.value } })} /></label>
                        <label className={check}><input type="checkbox" className="h-5 w-5" checked={settings.lillio.display} onChange={(e) => setSettings({ ...settings, lillio: { ...settings.lillio, display: e.target.checked } })} />
                            {t('familyUpdates.display', { defaultValue: 'Show on the kitchen display' })}</label>
                        {aiBox(settings.lillio.ai, (ai) => setSettings({ ...settings, lillio: { ...settings.lillio, ai } }))}
                        {stat('lillio')}
                    </div>}
                </fieldset>
                {loaded.gmail && <fieldset className="space-y-2">
                    <legend className="text-label font-medium text-foreground">{t('familyUpdates.labels', { defaultValue: 'Gmail labels' })}</legend>
                    <p className="text-micro text-muted-foreground">{t('familyUpdates.labelsHelp', { defaultValue: 'Choose labels to show, such as one for the school\'s mailing list. What goes into a label is set in Gmail: create a filter (for example, emails from the school\'s address) that applies the label. Emails from the last 30 days are shown.' })}</p>
                    {!loaded.labels.length && <p className="fh-fine-print">{t('familyUpdates.noLabels', { defaultValue: 'This Gmail account has no labels of its own yet. Create one in Gmail, then reload this page.' })}</p>}
                    {[...loaded.labels, ...missing.map((label) => ({ id: label.labelId, name: `${label.name} ${t('familyUpdates.gone', { defaultValue: '(no longer in Gmail)' })}` }))].map((label) => {
                        const source = chosen(label.id);
                        return <div key={label.id} className="rounded-input border border-input p-2">
                            <label className={check}><input type="checkbox" className="h-5 w-5" checked={Boolean(source)} onChange={(e) => toggle(label.id, label.name, e.target.checked)} />{label.name}</label>
                            {source && <div className="space-y-1 pl-8">
                                <label className="block text-label text-foreground">{t('familyUpdates.name', { defaultValue: 'Name on the card' })}
                                    <input className={input} maxLength={40} value={source.name} onChange={(e) => setLabel(label.id, { name: e.target.value })} /></label>
                                <label className={check}><input type="checkbox" className="h-5 w-5" checked={source.display} onChange={(e) => setLabel(label.id, { display: e.target.checked })} />
                                    {t('familyUpdates.display', { defaultValue: 'Show on the kitchen display' })}</label>
                                <label className="flex min-h-10 items-start gap-3 text-body text-foreground"><input type="checkbox" className="mt-1 h-5 w-5" checked={source.verifiedOnly} onChange={(e) => setLabel(label.id, { verifiedOnly: e.target.checked })} />
                                    <span>{t('familyUpdates.verified', { defaultValue: 'Only senders Gmail verified (recommended)' })}
                                        <small className="block text-micro text-muted-foreground">{t('familyUpdates.verifiedHelp', { defaultValue: 'Hides emails that fail Gmail\'s check that they really come from the address shown, so a forged email cannot appear here.' })}</small></span></label>
                                {aiBox(source.ai, (ai) => setLabel(label.id, { ai }))}
                                {stat(label.id)}
                            </div>}
                        </div>;
                    })}
                </fieldset>}
                {anyAi && <p className="rounded-input bg-surface-2 px-3 py-2 text-micro text-muted-foreground">{loaded.ai.provider === 'ollama'
                    ? t('familyUpdates.aiPrivacyLocal', { defaultValue: 'AI is on for some sources. Their email text goes to your own Ollama server; check that it runs on hardware you control.' })
                    : t('familyUpdates.aiPrivacy', { provider: PROVIDER_NAMES[loaded.ai.provider ?? ''] ?? loaded.ai.provider, defaultValue: 'AI is on for some sources: the subject and text of their emails are sent to {{provider}}. Use a paid API key (paid tiers say they do not train on your data; free tiers may) or a self-hosted model for private family information, or leave AI off. Nothing is added to your calendar or to-dos until a parent accepts a suggestion.' })}</p>}
                <p className="text-micro text-muted-foreground">{t('familyUpdates.displayHelp', { defaultValue: 'Sources shown on the kitchen display appear on the frame for anyone nearby to read. Emails are shown as plain text; images, attachments and most links are left out.' })}</p>
                <button className="fh-button fh-primary min-h-11" disabled={busy}>{t('familyUpdates.save', { defaultValue: 'Save' })}</button>
                {message && <p role="status" className="fh-fine-print">{message}</p>}
            </form>}
    </SettingsSection>;
}
