import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Bot, Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';

/**
 * Settings → Agents (parents). Connected apps are the sessions outside tools,
 * such as an MCP server, sign in with: docs/familyhub/AGENT_API.md. A key is
 * shown once, when it is made; the server keeps only its hash.
 */

type Permissions = { read: string[]; write: string[] };
type Session = { id: string; name: string; permissions: Permissions; created_at: string; last_used_at: string | null; expires_at: string; status: 'active' | 'expired' | 'signed-out' };
type Grantable = { read: { grant: string; routes: string[] }[]; write: { endpoint: string; summary: string }[]; defaultDays: number; maxDays: number; maxSessions: number };
type Write = { id: string; session_id: string; session_name: string; session_removed: boolean; method: string; path: string; status: number; created_at: string };
type Envelope<T> = { success: boolean; data: T };

const BASE = '/api/familyhub/agent-sessions';
/** Areas a household is likely to share, in this order, with a plain name. Others are listed by address. */
const AREAS: Record<string, string> = {
    '/api/familyhub': 'overview', '/api/familyhub/google/*': 'google', '/api/budget/*': 'budget', '/api/notes/*': 'notes', '/api/tasks/*': 'chores',
    '/api/familyhub/shopping/*': 'googleShopping', '/api/shopping/*': 'shopping', '/api/family/*': 'family', '/api/rewards/*': 'rewards',
    '/api/planning/*': 'planning', '/api/appointments/*': 'appointments', '/api/kakeibo/*': 'kakeibo', '/api/categories/*': 'categories',
    '/api/dashboard/*': 'dashboard', '/api/familyhub/modules': 'modules',
};
const EXPIRY_DAYS = [30, 90, 180, 365];
const message = (cause: unknown, fallback: string) => (cause instanceof Error && cause.message ? cause.message : fallback);

export function AgentSessions() {
    const { t, i18n } = useTranslation('settings');
    const [sessions, setSessions] = useState<Session[] | null>(null);
    const [grantable, setGrantable] = useState<Grantable | null>(null);
    const [error, setError] = useState('');
    const [adding, setAdding] = useState(false);
    const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);
    const [copied, setCopied] = useState(false);
    const [confirm, setConfirm] = useState<{ id: string; action: 'rotate' | 'remove' } | null>(null);
    const [open, setOpen] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [recordKey, setRecordKey] = useState(0);

    const when = (iso: string, withTime = false) => new Intl.DateTimeFormat(i18n.language, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(iso));
    const areaName = (grant: string) => (AREAS[grant] ? t(`agents.area.${AREAS[grant]}`) : grant);
    const changeName = (endpoint: string, fallback?: string) => t(`agents.change.${endpoint}`, { defaultValue: fallback ?? endpoint });

    const load = useCallback(async () => {
        try {
            const [list, options] = await Promise.all([api.get<Envelope<Session[]>>(BASE), api.get<Envelope<Grantable>>(`${BASE}/grantable`)]);
            setSessions(list.data); setGrantable(options.data); setError('');
        } catch { setError(t('agents.loadFailed')); }
    }, [t]);
    useEffect(() => { void load(); }, [load]);

    const act = async (id: string, action: 'rotate' | 'remove') => {
        setBusy(true); setError(''); setConfirm(null);
        try {
            if (action === 'remove') await api.delete(`${BASE}/${id}`);
            else {
                const result = await api.post<Envelope<{ session: Session; token: string }>>(`${BASE}/${id}/rotate`, {});
                setCopied(false); setIssued({ name: result.data.session.name, token: result.data.token });
            }
            await load(); setRecordKey((key) => key + 1);
        } catch (cause) { setError(message(cause, t('agents.error'))); }
        finally { setBusy(false); }
    };
    const copy = async () => {
        if (!issued) return;
        try { await navigator.clipboard.writeText(issued.token); setCopied(true); } catch { setCopied(false); }
    };

    if (!sessions || !grantable) return <p className={error ? 'fh-credentials-error' : 'fh-fine-print'} role={error ? 'alert' : 'status'}>{error || t('agents.loading')}</p>;
    const atLimit = sessions.filter((session) => session.status !== 'expired').length >= grantable.maxSessions;

    return <>
        <section className="fh-credentials fh-agents">
            <header><div><h3><Bot size={17} /> {t('agents.title')}</h3><p>{t('agents.help')}</p></div>
                {!adding && !issued && <button className="fh-button fh-secondary" onClick={() => setAdding(true)} disabled={atLimit}><Plus size={15} />{t('agents.connect')}</button>}</header>
            {error && <p role="alert" className="fh-credentials-error">{error}</p>}
            {atLimit && !adding && <p className="fh-fine-print">{t('agents.form.limit', { max: grantable.maxSessions })}</p>}

            {issued && <div className="fh-agent-key" role="status">
                <strong><KeyRound size={15} /> {t('agents.token.title', { name: issued.name })}</strong>
                <p>{t('agents.token.help')}</p>
                <div className="fh-agent-key-row"><code>{issued.token}</code>
                    <button className="fh-button fh-secondary" onClick={() => void copy()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? t('agents.token.copied') : t('agents.token.copy')}</button></div>
                <button className="fh-button fh-primary" onClick={() => { setIssued(null); setCopied(false); }}>{t('agents.token.done')}</button>
            </div>}

            {adding && <ConnectForm grantable={grantable} areaName={areaName} changeName={changeName} onCancel={() => setAdding(false)}
                onCreated={(name, token) => { setAdding(false); setCopied(false); setIssued({ name, token }); void load(); }} />}

            {sessions.length === 0 && !adding ? <p className="fh-fine-print">{t('agents.none')}</p> : <ul>{sessions.map((session) => {
                const { read, write } = session.permissions;
                const asking = confirm?.id === session.id ? confirm.action : null;
                return <li key={session.id} className={session.status === 'active' ? 'is-ok' : 'is-warn'}>
                    <div className="fh-credential-row">
                        <div><strong>{session.name}</strong>
                            <small>{read.length ? t('agents.reads', { count: read.length }) : t('agents.readsNone')}, {write.length ? t('agents.writes', { count: write.length }) : t('agents.writesNone')}</small>
                            <small>{session.last_used_at ? t('agents.lastUsed', { when: when(session.last_used_at, true) }) : t('agents.neverUsed')}</small></div>
                        <div className="fh-credential-expiry"><span>{t(`agents.status.${session.status}`)}</span>
                            <small>{t(session.status === 'expired' ? 'agents.expired' : 'agents.expires', { when: when(session.expires_at) })}</small></div>
                        {!asking && <span className="fh-update-confirm">
                            <button className="fh-button fh-secondary" onClick={() => setOpen(open === session.id ? null : session.id)} aria-expanded={open === session.id}>{open === session.id ? t('agents.hideDetails') : t('agents.details')}</button>
                            {session.status !== 'expired' && <button className="fh-button fh-secondary" onClick={() => setConfirm({ id: session.id, action: 'rotate' })} disabled={busy}><KeyRound size={15} />{t('agents.rotate')}</button>}
                            <button className="fh-button fh-secondary" onClick={() => setConfirm({ id: session.id, action: 'remove' })} disabled={busy}><Trash2 size={15} />{t('agents.remove')}</button>
                        </span>}
                    </div>
                    {asking && <p className="fh-agent-confirm" role="alert">{asking === 'remove' ? t('agents.removeConfirm', { name: session.name }) : t('agents.rotateConfirm')}
                        <span className="fh-update-confirm"><button className="fh-button fh-primary" onClick={() => void act(session.id, asking)} disabled={busy}>{asking === 'remove' ? t('agents.removeYes') : t('agents.rotateYes')}</button>
                            <button className="fh-button fh-secondary" onClick={() => setConfirm(null)}>{t('agents.cancel')}</button></span></p>}
                    {open === session.id && <div className="fh-agent-reach">
                        <div><b>{t('agents.form.read')}</b><ul>{read.length ? read.map((grant) => <li key={grant}>{areaName(grant)}{AREAS[grant] && <code>{grant}</code>}</li>) : <li>{t('agents.readsNone')}</li>}</ul></div>
                        <div><b>{t('agents.form.write')}</b><ul>{write.length ? write.map((endpoint) => <li key={endpoint}>{changeName(endpoint)}<code>{endpoint}</code></li>) : <li>{t('agents.form.writeNone')}</li>}</ul></div>
                    </div>}
                </li>;
            })}</ul>}
        </section>
        <WriteRecord key={recordKey} when={(iso) => when(iso, true)} />
    </>;
}

function ConnectForm({ grantable, areaName, changeName, onCancel, onCreated }: {
    grantable: Grantable; areaName: (grant: string) => string; changeName: (endpoint: string, fallback?: string) => string;
    onCancel: () => void; onCreated: (name: string, token: string) => void;
}) {
    const { t } = useTranslation('settings');
    const [name, setName] = useState('');
    const [days, setDays] = useState(grantable.defaultDays);
    const [read, setRead] = useState<string[]>([]);
    const [write, setWrite] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const offered = grantable.read.map((entry) => entry.grant);
    const common = Object.keys(AREAS).filter((grant) => offered.includes(grant));
    const other = offered.filter((grant) => !AREAS[grant]);
    const toggle = (list: string[], set: (next: string[]) => void, value: string) => set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
    const box = (grant: string) => <label key={grant} className="fh-agent-check"><input type="checkbox" checked={read.includes(grant)} onChange={() => toggle(read, setRead, grant)} /><span>{areaName(grant)}{AREAS[grant] && <code>{grant}</code>}</span></label>;

    const submit = async (event: FormEvent) => {
        event.preventDefault(); setBusy(true); setError('');
        try {
            const result = await api.post<Envelope<{ session: Session; token: string }>>(BASE, { name: name.trim(), permissions: { read, write }, expiresInDays: days });
            onCreated(result.data.session.name, result.data.token);
        } catch (cause) { setError(message(cause, t('agents.error'))); setBusy(false); }
    };

    return <form className="fh-agent-form" onSubmit={(event) => void submit(event)}>
        <h4>{t('agents.form.title')}</h4>
        <div className="fh-agent-fields">
            <label><span>{t('agents.form.name')}</span><input type="text" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder={t('agents.form.namePlaceholder')} autoComplete="off" required /></label>
            <label><span>{t('agents.form.expiry')}</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}>
                {EXPIRY_DAYS.filter((option) => option <= grantable.maxDays).map((option) => <option key={option} value={option}>{t('agents.form.days', { count: option })}</option>)}</select></label>
        </div>
        <fieldset><legend>{t('agents.form.read')}</legend><p>{t('agents.form.readHelp')}</p>
            <div className="fh-agent-checks">{common.map(box)}</div>
            {other.length > 0 && <details><summary>{t('agents.form.more', { count: other.length })}</summary><div className="fh-agent-checks">{other.map(box)}</div></details>}
        </fieldset>
        <fieldset><legend>{t('agents.form.write')}</legend><p>{t('agents.form.writeHelp')}</p>
            <div className="fh-agent-checks">{grantable.write.map((entry) => <label key={entry.endpoint} className="fh-agent-check"><input type="checkbox" checked={write.includes(entry.endpoint)} onChange={() => toggle(write, setWrite, entry.endpoint)} /><span>{changeName(entry.endpoint, entry.summary)}<code>{entry.endpoint}</code></span></label>)}</div>
            {write.length === 0 && <p className="fh-fine-print">{t('agents.form.writeNone')}</p>}
        </fieldset>
        {error && <p role="alert" className="fh-credentials-error">{error}</p>}
        <div className="fh-update-confirm"><button className="fh-button fh-primary" disabled={busy || !name.trim()}>{busy ? t('agents.form.creating') : t('agents.form.create')}</button>
            <button type="button" className="fh-button fh-secondary" onClick={onCancel}>{t('agents.cancel')}</button></div>
    </form>;
}

/** Recent changes made or tried by connected apps (the agent write record). Loaded when opened. */
function WriteRecord({ when }: { when: (iso: string) => string }) {
    const { t } = useTranslation('settings');
    const [shown, setShown] = useState(false);
    const [rows, setRows] = useState<Write[] | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        if (!shown) return;
        let live = true;
        api.get<Envelope<Write[]>>(`${BASE}/writes`).then((result) => { if (live) { setRows(result.data); setError(''); } }).catch(() => { if (live) setError(t('agents.record.loadFailed')); });
        return () => { live = false; };
    }, [shown, t]);
    const outcome = (status: number) => (status < 300 ? 'done' : status === 401 || status === 403 ? 'refused' : 'failed');

    return <section className="fh-credentials fh-agents">
        <header><div><h3>{t('agents.record.title')}</h3><p>{t('agents.record.help')}</p></div>
            <button className="fh-button fh-secondary" onClick={() => setShown(!shown)} aria-expanded={shown}>{shown ? t('agents.record.hide') : t('agents.record.show')}</button></header>
        {shown && error && <p role="alert" className="fh-credentials-error">{error}</p>}
        {shown && rows && (rows.length === 0 ? <p className="fh-fine-print">{t('agents.record.none')}</p>
            : <ul>{rows.map((row) => <li key={row.id} className={outcome(row.status) === 'done' ? 'is-ok' : 'is-warn'}>
                <div className="fh-credential-row"><div><strong>{t(`agents.change.${row.method} ${row.path}`, { defaultValue: `${row.method} ${row.path}` })}</strong>
                    <small>{row.session_name}{row.session_removed ? ` (${t('agents.record.removedApp')})` : ''} · <code>{row.method} {row.path}</code></small></div>
                    <div className="fh-credential-expiry"><span>{t(`agents.record.${outcome(row.status)}`)}</span><small>{when(row.created_at)}</small></div></div>
            </li>)}</ul>)}
    </section>;
}
