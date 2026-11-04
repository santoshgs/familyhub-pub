import { useEffect, useState } from 'react';
import { House, Plus, Pin, Pencil, Trash2, Monitor, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useWebSocketUpdates } from '../hooks/useWebSocketUpdates';
import { api } from '../lib/api';
import { HubDialog } from './FamilyHub';
import { FamilyHubNav } from './FamilyHubNav';
import './familyhub.css';
interface LocalNote { id: string; author_name: string; content: string; color: string; pinned: boolean; created_at: string }
const COLORS = { yellow: 'butter', pink: 'rose', green: 'sage' } as const;
export default function LocalNotes() {
    const { user, logout } = useAuth();
    const [notes, setNotes] = useState<LocalNote[]>([]);
    const [readOnly, setReadOnly] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [editor, setEditor] = useState<LocalNote | 'new' | null>(null);
    const [displayPrompt, setDisplayPrompt] = useState(false);
    const [content, setContent] = useState('');
    const [color, setColor] = useState('yellow');
    const load = async () => {
        try {
            const result = await api.get<{ data: { notes: LocalNote[]; readOnly: boolean } }>('/api/familyhub');
            setNotes(result.data.notes); setReadOnly(result.data.readOnly); setError('');
        } catch { setError('Notes could not be loaded. Check the server connection and try again.'); }
        finally { setLoading(false); }
    };
    useEffect(() => { void load(); document.title = 'Family Hub · Local notes'; }, []);
    useWebSocketUpdates('notes', () => void load());
    const change = async (method: 'post' | 'put' | 'delete', endpoint: string, body?: unknown) => {
        if (readOnly || saving) return;
        setSaving(true); setError('');
        try {
            if (method === 'delete') await api.delete(endpoint);
            else await api[method](endpoint, body);
            setEditor(null); await load();
        } catch { setError('That change could not be saved. Please try again.'); }
        finally { setSaving(false); }
    };
    const edit = (note?: LocalNote) => { setContent(note?.content ?? ''); setColor(note?.color ?? 'yellow'); setEditor(note ?? 'new'); };
    const enterDisplay = async () => {
        setSaving(true);
        try {
            const result = await api.post<{ data: { token: string } }>('/api/familyhub/display-session', {});
            api.setToken(result.data.token);
            // Remove the old profile and remount so no editable UI/data survives.
            localStorage.removeItem('user'); window.location.reload();
        } catch { setError('Display access could not be created. Try again.'); setSaving(false); }
    };
    return <div className="fh-scope fh-app"><header className="fh-header"><a href="/" className="fh-brand"><span className="fh-brand-icon"><House size={23} /></span><span>family<span className="fh-brand-hub">hub</span><small>LOCAL FAMILY NOTES</small></span></a><div className="fh-header-actions">{!readOnly && (user?.is_owner || user?.role === 'parent') && <button className="fh-button fh-secondary" onClick={() => setDisplayPrompt(true)}><Monitor size={17} />Use as display</button>}<button className="fh-icon-button" aria-label="Sign out" onClick={logout}><LogOut size={18} /></button></div></header><FamilyHubNav /><main className="fh-main"><div className="fh-greeting"><div><p className="fh-eyebrow">{readOnly ? 'Protected display session' : `Signed in as ${user?.name ?? 'family member'}`}</p><h1>Notes from <em>home.</em></h1><p className="fh-greeting-copy">Stored on your server. Shared with your family.</p></div>{!readOnly && <button className="fh-button fh-primary" onClick={() => edit()}><Plus size={17} />Leave a note</button>}</div>{readOnly && !loading && <div className="fh-display-notice"><Monitor size={17} />Read-only access is enforced by the server. Sign out and sign in to edit.</div>}{error && <div className="fh-callout" role="alert">{error}<button className="fh-icon-button" aria-label="Reload notes" onClick={() => void load()}><RefreshCw size={17} /></button></div>}{loading ? <p role="status">Loading local notes…</p> : <section className="fh-grid fh-view-notes"><div className="fh-card fh-notes"><div className="fh-notes-list">{notes.map((note) => <article className={`fh-note fh-note-${COLORS[note.color as keyof typeof COLORS] ?? 'butter'}`} key={note.id}><div className="fh-note-top"><span>{note.pinned && <><Pin size={14} />Pinned</>}</span>{!readOnly && <div><button className="fh-icon-button" disabled={saving} aria-label={note.pinned ? 'Unpin note' : 'Pin note'} onClick={() => void change('put', `/api/notes/${note.id}`, { pinned: !note.pinned })}><Pin size={15} /></button><button className="fh-icon-button" aria-label="Edit note" onClick={() => edit(note)}><Pencil size={15} /></button><button className="fh-icon-button" disabled={saving} aria-label="Delete note" onClick={() => void change('delete', `/api/notes/${note.id}`)}><Trash2 size={15} /></button></div>}</div><p style={{ whiteSpace: 'pre-wrap' }}>{note.content}</p><footer><span>{note.author_name}</span><time className="fh-note-time">{new Date(note.created_at).toLocaleDateString()}</time></footer></article>)}</div>{!notes.length && <div className="fh-empty"><h2>A fresh space for your family.</h2><p>{readOnly ? 'Shared notes will appear here.' : 'Leave a reminder or a little kindness.'}</p></div>}</div></section>}<footer className="fh-page-footer"><a href="/">Back to Family Hub</a><span>Notes are stored on your Family Hub server.</span></footer></main><HubDialog open={Boolean(editor)} onClose={() => setEditor(null)} title={editor === 'new' ? 'Leave a little note' : 'Edit your family note'} description={`Saved to your server · author: ${editor && editor !== 'new' ? editor.author_name : user?.name ?? ''}`}><form className="fh-form" onSubmit={(event) => { event.preventDefault(); void change(editor === 'new' ? 'post' : 'put', editor === 'new' ? '/api/notes' : `/api/notes/${editor?.id}`, { content: content.trim(), color }); }}><label>Message<textarea autoFocus required maxLength={500} rows={5} value={content} onChange={(event) => setContent(event.target.value)} /></label><label>Colour<select value={color} onChange={(event) => setColor(event.target.value)}><option value="yellow">Butter</option><option value="pink">Rose</option><option value="green">Sage</option></select></label><p className="fh-fine-print">{content.length}/500 · Notes remain after reload. Family members can edit shared notes.</p><button className="fh-button fh-primary" disabled={saving || readOnly || !content.trim()}>{saving ? 'Saving…' : 'Save note'}</button></form></HubDialog><HubDialog open={displayPrompt} onClose={() => setDisplayPrompt(false)} title="Use this browser as a display?" description="This replaces the current editing session with restricted access."><p>Notes remain private to your family. This browser will be able to read notes, but cannot change them or open account and integration settings. Sign in again to return to editing.</p><button className="fh-button fh-primary" style={{ marginTop: 20 }} disabled={saving} onClick={() => void enterDisplay()}>Start protected display</button></HubDialog></div>;
}
