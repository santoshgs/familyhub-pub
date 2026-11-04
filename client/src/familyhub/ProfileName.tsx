import { useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';

/** Lets the signed-in account change the name shown in greetings and on the display. */
export function ProfileName() {
    const { user, updateProfile } = useAuth();
    const [name, setName] = useState(user?.name ?? '');
    const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const save = async (event: FormEvent) => {
        event.preventDefault();
        setState('saving');
        try { await updateProfile({ name: name.trim() }); setState('saved'); }
        catch { setState('error'); }
    };
    return <form className="fh-card fh-profile-name" onSubmit={(event) => void save(event)}>
        <label htmlFor="profile-name"><strong>Your name</strong><small>Shown in greetings and on the family display for {user?.email}.</small></label>
        <div><input id="profile-name" value={name} maxLength={100} onChange={(event) => { setName(event.target.value); setState('idle'); }} required />
            <button className="fh-button fh-primary" disabled={state === 'saving' || !name.trim() || name.trim() === user?.name}>{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save'}</button></div>
        {state === 'error' && <p role="alert">The name could not be saved.</p>}
    </form>;
}
