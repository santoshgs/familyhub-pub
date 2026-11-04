import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';

type Item = { kind: string; name: string; expiresAt: string | null; state: 'ok' | 'warn' | 'unknown'; note: string; updatable: boolean };
type Status = { available: false } | { available: true; checkedAt: string | null; warnDays: number; items: Item[]; results: Record<string, { ok: boolean; message: string; at: string }>; pending: string[] };

const HOW_TO: Record<string, { label: string; link: string; help: string }> = {
    'github-release': { label: 'Create a fine-grained token', link: 'https://github.com/settings/personal-access-tokens/new',
        help: 'Expiration: No expiration. Repository access: only santoshgs/familyhub. Permissions: Contents → Read-only.' },
    ghcr: { label: 'Create a classic token', link: 'https://github.com/settings/tokens/new?scopes=read:packages&description=FamilyHub%20Pi%20GHCR',
        help: 'Expiration: No expiration. Scope: read:packages only (the image registry accepts only classic tokens).' },
    cloudflare: { label: 'Create a Cloudflare API token', link: 'https://dash.cloudflare.com/profile/api-tokens',
        help: 'Template "Edit zone DNS", limited to the example.com zone.' },
    tailscale: { label: 'Open the Tailscale admin console', link: 'https://login.tailscale.com/admin/machines',
        help: 'Machines → raspbian → ⋯ → Disable key expiry, so it never needs renewing.' },
};
const daysLeft = (iso: string | null) => iso ? Math.floor((Date.parse(iso) - Date.now()) / 86_400_000) : null;
const formatDate = (iso: string | null) => iso ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso)) : 'No expiry';

/** Settings → Advanced → Server credentials (household owner only). */
export function ServerCredentials() {
    const [status, setStatus] = useState<Status | null>(null);
    const [error, setError] = useState('');
    const [editing, setEditing] = useState<string | null>(null);
    const [token, setToken] = useState('');
    const [busy, setBusy] = useState(false);
    const load = useCallback(async () => {
        try { setStatus((await api.get<{ success: boolean; data: Status }>('/api/familyhub/admin/credentials')).data); setError(''); }
        catch { setError('Credential status could not be loaded.'); }
    }, []);
    useEffect(() => { void load(); }, [load]);
    const pending = status?.available ? status.pending : [];
    useEffect(() => {
        if (!pending.length) return;
        const timer = window.setInterval(() => void load(), 3_000);
        return () => window.clearInterval(timer);
    }, [pending.length, load]);

    const submit = async (event: FormEvent, kind: string) => {
        event.preventDefault(); setBusy(true); setError('');
        try { await api.put(`/api/familyhub/admin/credentials/${kind}`, { token: token.trim() }); setToken(''); setEditing(null); await load(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'The token could not be sent.'); }
        finally { setBusy(false); }
    };
    const checkNow = async () => { try { await api.post('/api/familyhub/admin/credentials/check', {}); await load(); } catch { setError('The check could not be started.'); } };

    if (!status) return <p className="fh-fine-print">{error || 'Loading server credentials…'}</p>;
    if (!status.available) return <p className="fh-fine-print">The server helper is not installed on this host. See <code>deploy/familyhub/admin/README.md</code>.</p>;
    return <section className="fh-credentials">
        <header><div><h3><KeyRound size={17} /> Server credentials</h3><p>Tokens the Raspberry Pi uses for updates and certificates. A new token is tested on the Pi before it replaces the current one, and is never stored by FamilyHub or shown again. Warnings start {status.warnDays} days before expiry.</p></div>
            <button className="fh-button fh-secondary" onClick={() => void checkNow()} disabled={pending.length > 0}><RefreshCw size={15} />Check now</button></header>
        {error && <p role="alert" className="fh-credentials-error">{error}</p>}
        <ul>{status.items.map((item) => {
            const days = daysLeft(item.expiresAt), result = status.results[item.kind], howTo = HOW_TO[item.kind], isPending = pending.includes(item.kind);
            return <li key={item.kind} className={`is-${item.state}`}>
                <div className="fh-credential-row">
                    <div><strong>{item.name}</strong><small>{item.note}</small></div>
                    <div className="fh-credential-expiry"><span>{formatDate(item.expiresAt)}</span><small>{item.state === 'unknown' ? 'Could not be checked' : days === null ? 'Never expires' : days < 0 ? 'Expired' : `${days} days left`}</small></div>
                    {item.updatable && <button className="fh-button fh-secondary" onClick={() => { setEditing(editing === item.kind ? null : item.kind); setToken(''); }}>{editing === item.kind ? 'Cancel' : 'Replace'}</button>}
                </div>
                {isPending && <p className="fh-credential-note">Testing the new token on the Pi…</p>}
                {!isPending && result && <p className={`fh-credential-note ${result.ok ? 'is-ok' : 'is-error'}`}>{result.ok ? 'Updated' : 'Not updated'} {formatDate(result.at)}: {result.message}</p>}
                {(editing === item.kind || (!item.updatable && (item.state !== 'ok' || item.expiresAt))) && howTo && <p className="fh-credential-help"><a href={howTo.link} target="_blank" rel="noreferrer">{howTo.label}</a> — {howTo.help}</p>}
                {editing === item.kind && <form onSubmit={(event) => void submit(event, item.kind)}><input type="password" autoComplete="off" spellCheck={false} placeholder="Paste the new token" value={token} onChange={(event) => setToken(event.target.value)} aria-label={`New token for ${item.name}`} required /><button className="fh-button fh-primary" disabled={busy || token.trim().length < 20}>{busy ? 'Sending…' : 'Test and save'}</button></form>}
            </li>;
        })}</ul>
        <p className="fh-fine-print">Last checked {status.checkedAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(status.checkedAt)) : 'never'}. The Pi rechecks daily.</p>
    </section>;
}
