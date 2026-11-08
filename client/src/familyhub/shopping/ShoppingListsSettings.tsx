import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, ShoppingCart } from 'lucide-react';
import { SettingsSection } from '../../components/app/SettingsSection';
import { shoppingApi, type ShoppingSettings } from './model';

/**
 * Settings → Household → Shopping lists (parents): which Google Tasks lists
 * are shopping lists, in what order, and a way to create a new one.
 */
export function ShoppingListsSettings() {
    const { t } = useTranslation('shopping');
    const [settings, setSettings] = useState<ShoppingSettings | null>(null);
    const [selected, setSelected] = useState<string[]>([]);
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const load = useCallback(async () => {
        try { const data = await shoppingApi.settings(); setSettings(data); setSelected(data.selected); }
        catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Shopping lists could not be loaded.'); }
    }, []);
    useEffect(() => { void load(); }, [load]);

    const save = async (next: string[]) => {
        setBusy(true); setMessage('');
        try { await shoppingApi.saveLists(next); setSelected(next); setMessage(t('settings.saved', { defaultValue: 'Saved.' })); }
        catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Not saved.'); }
        finally { setBusy(false); }
    };
    const create = async (event: FormEvent) => {
        event.preventDefault();
        if (!title.trim()) return;
        setBusy(true); setMessage('');
        try { await shoppingApi.createList(title.trim()); setTitle(''); await load(); setMessage(t('settings.created', { defaultValue: 'List created in Google Tasks.' })); }
        catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The list could not be created.'); }
        finally { setBusy(false); }
    };
    const move = (index: number, step: -1 | 1) => {
        const next = [...selected];
        [next[index], next[index + step]] = [next[index + step], next[index]];
        void save(next);
    };

    const titles = new Map(settings?.available.map((list) => [list.id, list.title]));
    const subtitle = selected.length ? selected.map((id) => titles.get(id)).filter(Boolean).join(', ') : t('settings.none', { defaultValue: 'One list kept in Family Hub' });
    return <SettingsSection id="shopping-lists" icon={<ShoppingCart size={20} />} title={t('settings.title', { defaultValue: 'Shopping lists' })} subtitle={subtitle}>
        <div className="fh-nav-order"><div className="fh-nav-order-body">
            {!settings ? <p className="fh-fine-print">{message || t('settings.loading', { defaultValue: 'Loading…' })}</p>
                : !settings.connected ? <p className="fh-nav-order-help">{t('settings.connect', { defaultValue: 'Connect the family Google account (Home → Google) to keep shopping lists in Google Tasks. Until then Family Hub keeps one list of its own.' })}</p>
                : <>
                    <p className="fh-nav-order-help">{t('settings.help', { defaultValue: 'Tick the Google Tasks lists to use for shopping, for example one per store. Items stay in Google, so they also show in the Google Tasks app. The household to-do list can stay unticked.' })}</p>
                    <ol className="fh-layout">{selected.map((id, index) => <li key={id} className="fh-layout-row">
                        <span className="fh-layout-order">
                            <button type="button" aria-label={t('settings.up', { name: titles.get(id), defaultValue: 'Move {{name}} up' })} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
                            <button type="button" aria-label={t('settings.down', { name: titles.get(id), defaultValue: 'Move {{name}} down' })} disabled={busy || index === selected.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
                        </span>
                        <span className="fh-layout-name"><strong>{index + 1}. {titles.get(id)}</strong></span>
                        <button type="button" className="fh-text-button" disabled={busy} onClick={() => void save(selected.filter((x) => x !== id))}>{t('settings.remove', { defaultValue: 'Remove' })}</button>
                    </li>)}</ol>
                    {settings.available.some((list) => !selected.includes(list.id)) && <div className="mt-3">
                        <p className="mb-1 text-micro font-semibold uppercase tracking-wide text-muted-foreground">{t('settings.add', { defaultValue: 'Add an existing Google Tasks list' })}</p>
                        <ul className="divide-y divide-border rounded-input border border-border">{settings.available.filter((list) => !selected.includes(list.id)).map((list) =>
                            <li key={list.id}><label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 text-body text-foreground"><span>{list.title}</span>
                                <input type="checkbox" className="h-5 w-5" checked={false} disabled={busy} onChange={() => void save([...selected, list.id])} /></label></li>)}</ul>
                    </div>}
                    <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => void create(event)}>
                        <label className="min-w-[12rem] flex-1 text-label font-medium text-foreground">{t('settings.newList', { defaultValue: 'New shopping list' })}
                            <input className="mt-1 min-h-11 w-full rounded-input border border-input bg-background px-3 text-body" value={title} maxLength={100}
                                placeholder={t('settings.newPlaceholder', { defaultValue: 'For example: Costco' })} onChange={(e) => setTitle(e.target.value)} /></label>
                        <button className="fh-button fh-secondary min-h-11" disabled={busy || !title.trim()}>{t('settings.create', { defaultValue: 'Create in Google Tasks' })}</button>
                    </form>
                </>}
            {settings && message && <p role="status" className="fh-fine-print">{message}</p>}
        </div></div>
    </SettingsSection>;
}
