import { useState, type FormEvent } from 'react';
import { UserRound } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { SettingsSection } from '../components/app/SettingsSection';

/** Lets the signed-in account change the name shown in greetings and on the display. */
/** `asSection`: the Classic Settings card look; otherwise a compact collapsible row (Board Book). */
export function ProfileName({ asSection }: { asSection?: boolean } = {}) {
    const { user, updateProfile } = useAuth();
    const [name, setName] = useState(user?.name ?? '');
    const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const save = async (event: FormEvent) => {
        event.preventDefault();
        setState('saving');
        try { await updateProfile({ name: name.trim() }); setState('saved'); }
        catch { setState('error'); }
    };
    const form = <form className="fh-profile-name" onSubmit={(event) => void save(event)}>
        <label htmlFor="profile-name"><small>Shown in greetings and on the family display for {user?.email}.</small></label>
        <div><input id="profile-name" value={name} maxLength={100} onChange={(event) => { setName(event.target.value); setState('idle'); }} required />
            <button className="fh-button fh-primary" disabled={state === 'saving' || !name.trim() || name.trim() === user?.name}>{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save'}</button></div>
        {state === 'error' && <p role="alert">The name could not be saved.</p>}
    </form>;
    if (asSection) return <SettingsSection id="profile-name" icon={<UserRound size={20} />} title="Your name" subtitle={user?.name}>{form}</SettingsSection>;
    return <details className="fh-card fh-advanced fh-profile-name-details"><summary>Your name <small>{user?.name}</small></summary>{form}</details>;
}
