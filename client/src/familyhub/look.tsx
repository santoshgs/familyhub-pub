/**
 * Trial switch between the Classic management look and Board Book, saved per
 * browser. Classic is the default during the trial; once the household picks
 * one, delete the other look and this switch.
 */
export type Look = 'classic' | 'board';
const KEY = 'familyhub.look';

export function getLook(): Look {
    try { return localStorage.getItem(KEY) === 'board' ? 'board' : 'classic'; }
    catch { return 'classic'; }
}

export function setLook(look: Look) {
    try { localStorage.setItem(KEY, look); } catch { /* this visit only */ }
    // The two looks have different shells; a reload swaps them cleanly.
    window.location.reload();
}

export function LookPicker({ className }: { className?: string }) {
    return <label className={className ?? 'fh-theme-picker'}>Look <select aria-label="App look" value={getLook()} onChange={(event) => setLook(event.target.value as Look)}><option value="classic">Classic</option><option value="board">Board Book</option></select></label>;
}
