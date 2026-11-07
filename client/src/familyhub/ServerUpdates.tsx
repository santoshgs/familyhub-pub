import { useCallback, useEffect, useState } from 'react';
import { Download, Power, RefreshCw, RotateCw } from 'lucide-react';
import { api } from '../lib/api';
import { apiBase } from '../lib/serverConfig';
import { FAMILYHUB_VERSION } from './version';

type State = 'checked' | 'up-to-date' | 'installing' | 'updated' | 'failed' | 'check-failed';
type Status = { available: false } | {
    available: true; current: string | null; previous: string | null; latest: string | null; updateAvailable: boolean;
    state: State | null; message: string; checkedAt: string | null; requestedAt: string | null; finishedAt: string | null;
    autoUpdates: boolean | null; pending: Array<'check' | 'install'>;
};

const short = (version: string | null) => version ? version.replace(/^familyhub-/, '') : '—';
const formatTime = (iso: string | null) => iso ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : 'never';
// An update normally takes a few minutes (backup, image pull, health check).
const SLOW_AFTER_MS = 25 * 60_000;

/** Settings → Advanced → Software updates (server administrator only). */
export function ServerUpdates() {
    const [status, setStatus] = useState<Status | null>(null);
    const [error, setError] = useState('');
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const installing = status?.available === true && (status.pending.includes('install') || status.state === 'installing');
    const load = useCallback(async (quiet = false) => {
        try { setStatus((await api.get<{ success: boolean; data: Status }>('/api/familyhub/admin/updates')).data); setError(''); }
        // The server restarts while an update installs, so a failed poll then is expected.
        catch { if (!quiet) setError('Update status could not be loaded.'); }
    }, []);
    useEffect(() => { void load(); }, [load]);
    const waiting = status?.available === true && (status.pending.length > 0 || status.state === 'installing');
    useEffect(() => {
        if (!waiting) return;
        const timer = window.setInterval(() => void load(true), 5_000);
        return () => window.clearInterval(timer);
    }, [waiting, load]);

    const send = async (kind: 'check' | 'install') => {
        setBusy(true); setError(''); setConfirming(false);
        try { await api.post(`/api/familyhub/admin/updates/${kind}`, {}); await load(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'The request could not be sent.'); }
        finally { setBusy(false); }
    };

    if (!status) return <p className="fh-fine-print">{error || 'Loading software updates…'}</p>;
    if (!status.available) return null;
    // Only release builds carry a plain version; a local build describes its checkout.
    const pageIsOld = Boolean(status.current && /^v\d+\.\d+\.\d+$/.test(FAMILYHUB_VERSION) && short(status.current) !== FAMILYHUB_VERSION && !installing);
    const slow = installing && status.requestedAt && Date.now() - Date.parse(status.requestedAt) > SLOW_AFTER_MS;
    const note = installing
        ? (slow ? 'This is taking longer than expected. The Pi keeps the previous version running if the new one fails its health check; check the Pi if nothing changes.'
            : `Installing ${short(status.latest)} on the Pi: backup, download, health check. FamilyHub restarts briefly; this page keeps checking.`)
        : status.pending.includes('check') ? 'Asking GitHub for the newest release…'
        : status.state === 'failed' ? `The last update did not complete: ${status.message || 'see the Pi.'} The previous version kept running.`
        : status.state === 'check-failed' ? `The last check did not complete: ${status.message}`
        : status.state === 'updated' ? `Updated ${formatTime(status.finishedAt)}. ${status.message}`
        : '';

    return <section className="fh-credentials fh-updates">
        <header><div><h3><Download size={17} /> Software updates</h3><p>The Pi installs new FamilyHub releases by itself{status.autoUpdates === false ? ' when automatic updates are on (they are off now)' : ', checking every hour'}. Each update takes a backup first and goes back to the running version if the new one does not start cleanly. You can also check or install now.</p></div>
            <button className="fh-button fh-secondary" onClick={() => void send('check')} disabled={busy || waiting}><RefreshCw size={15} />Check for updates</button></header>
        {error && <p role="alert" className="fh-credentials-error">{error}</p>}
        <ul>
            <li className="is-ok"><div className="fh-credential-row"><div><strong>Running on the Pi</strong><small>{status.previous ? `Previous: ${short(status.previous)}` : 'Installed release'}</small></div><div className="fh-credential-expiry"><span>{short(status.current)}</span></div></div></li>
            <li className={status.updateAvailable ? 'is-warn' : 'is-ok'}><div className="fh-credential-row"><div><strong>Newest release</strong><small>Last checked {formatTime(status.checkedAt)}</small></div>
                <div className="fh-credential-expiry"><span>{short(status.latest)}</span><small>{status.updateAvailable ? 'Update available' : status.latest ? 'Up to date' : 'Not checked yet'}</small></div>
                {status.updateAvailable && !installing && (confirming
                    ? <span className="fh-update-confirm"><button className="fh-button fh-primary" onClick={() => void send('install')} disabled={busy}>Install {short(status.latest)}</button><button className="fh-button fh-secondary" onClick={() => setConfirming(false)}>Cancel</button></span>
                    : <button className="fh-button fh-secondary" onClick={() => setConfirming(true)}>Install now</button>)}
            </div></li>
        </ul>
        {note && <p role="status" className={`fh-credential-note ${status.state === 'failed' || status.state === 'check-failed' ? 'is-error' : installing ? '' : 'is-ok'}`}>{note}</p>}
        {pageIsOld && <p className="fh-credential-note">This page is {FAMILYHUB_VERSION}. <button className="fh-text-button" onClick={() => window.location.reload()}><RotateCw size={13} /> Reload to use {short(status.current)}</button></p>}
    </section>;
}

/**
 * Settings → Advanced → Restart (server administrator, v1.5.3). The server
 * exits cleanly and Docker starts it again; this page waits for it to answer
 * and then reloads. The database and the frame's pairing are unaffected.
 */
export function ServerRestart() {
    const [phase, setPhase] = useState<'idle' | 'confirm' | 'restarting' | 'back' | 'slow'>('idle');
    const [error, setError] = useState('');
    const restart = async () => {
        setError(''); setPhase('restarting');
        try { await api.post('/api/familyhub/admin/restart', {}); }
        catch (cause) { setPhase('idle'); setError(cause instanceof Error ? cause.message : 'The restart could not be requested.'); return; }
        const started = Date.now();
        let wentDown = false;
        const poll = async () => {
            let up = false;
            // A request to the server that is shutting down can hang: give each check 3 s.
            const controller = new AbortController();
            const timer = window.setTimeout(() => controller.abort(), 3_000);
            try { up = (await fetch(`${apiBase()}/health`, { cache: 'no-store', signal: controller.signal })).ok; } catch { up = false; }
            finally { window.clearTimeout(timer); }
            if (!up) wentDown = true;
            // Back once it answers after going away (or after 20 s, if the restart was too quick to see).
            if (up && (wentDown || Date.now() - started > 20_000)) { setPhase('back'); window.setTimeout(() => window.location.reload(), 1_200); return; }
            if (Date.now() - started > 120_000) { setPhase('slow'); return; }
            window.setTimeout(() => void poll(), 1_500);
        };
        window.setTimeout(() => void poll(), 1_500);
    };
    return <section className="fh-credentials fh-restart">
        <header><div><h3><Power size={17} /> Restart Family Hub</h3><p>Restarts the Family Hub server on the Pi, which clears its caches (weather, news, Formula 1, markets). It takes about 10–30 seconds; frames reconnect by themselves and nothing is lost.</p></div>
            {phase === 'idle' && <button className="fh-button fh-secondary" onClick={() => setPhase('confirm')}><RotateCw size={15} />Restart</button>}</header>
        {phase === 'confirm' && <p className="fh-update-confirm"><button className="fh-button fh-primary" onClick={() => void restart()}>Restart now</button><button className="fh-button fh-secondary" onClick={() => setPhase('idle')}>Cancel</button></p>}
        {phase === 'restarting' && <p role="status" className="fh-fine-print">Restarting… this page reloads when Family Hub is back.</p>}
        {phase === 'back' && <p role="status" className="fh-fine-print">Family Hub is back. Reloading…</p>}
        {phase === 'slow' && <p role="alert" className="fh-credentials-error">Family Hub has not answered for two minutes. Check the Pi (<code>release.py status</code>).</p>}
        {error && <p role="alert" className="fh-credentials-error">{error}</p>}
    </section>;
}
