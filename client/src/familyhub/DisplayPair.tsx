import { useEffect, useState } from 'react';
import { Tablet } from 'lucide-react';
import { api } from '../lib/api';
import './ambient.css';

/** The frame's pairing screen: shown on the LAN whenever the frame is not paired. */
export default function DisplayPair() {
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { document.title = 'FamilyHub · Connect this frame'; }, []);
    const pair = async (event: React.FormEvent) => {
        event.preventDefault(); setBusy(true); setError('');
        try {
            const result = await api.post<{ success: boolean; data: { token: string } }>('/api/familyhub/display/pair', { code });
            api.setToken(result.data.token);
            localStorage.removeItem('user');
            window.location.replace('/display');
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Pairing failed.'); setBusy(false); setCode(''); }
    };
    return <main className="ambient-screen display-pair">
        <section className="display-pair-card" aria-labelledby="pair-title">
            <span className="ambient-card-icon"><Tablet /></span>
            <h1 id="pair-title">Connect this frame</h1>
            <p>On a phone or computer, open FamilyHub → <strong>Display setup</strong> → <strong>Pair a frame</strong>, then enter the 8-digit code here. Codes expire after five minutes.</p>
            <form onSubmit={(event) => void pair(event)}>
                <label htmlFor="pairing-code">Pairing code</label>
                <input id="pairing-code" inputMode="numeric" autoComplete="one-time-code" maxLength={12} placeholder="00000000" autoFocus
                    value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))} required />
                {error && <p role="alert" className="display-pair-error">{error}</p>}
                <button className="display-pair-button" disabled={busy || code.length !== 8}>{busy ? 'Connecting…' : 'Connect frame'}</button>
            </form>
            <small>The frame gets read-only access to the family display. No password is entered here.</small>
        </section>
    </main>;
}
