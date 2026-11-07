import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Card } from '../ui';

/**
 * One collapsible Settings section (Family Hub). Closed by default; each
 * browser remembers which sections were left open. The header keeps the icon,
 * title and one-line description the cards had before.
 */
const OPEN_KEY = 'familyhub.settings.open';
const readOpen = (): string[] => {
    try { const value = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]'); return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []; }
    catch { return []; }
};
const writeOpen = (id: string, open: boolean) => {
    try {
        const next = new Set(readOpen());
        if (open) next.add(id); else next.delete(id);
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
    } catch { /* remembered until reload only */ }
};

/** Board Book's grouped Settings shows sections open and flat, as labelled rows. */
export const FlatSettings = createContext(false);

export function SettingsSection({ id, icon, title, subtitle, children }: { id: string; icon: ReactNode; title: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
    const flat = useContext(FlatSettings);
    // A link to /settings#<id> (for example the frame's settings button) opens that section.
    const [open, setOpen] = useState(() => readOpen().includes(id) || (typeof window !== 'undefined' && window.location.hash === `#${id}`));
    useEffect(() => { if (window.location.hash === `#${id}`) document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start' }); }, [id]);
    if (flat) return <section className="bb-flat" id={`settings-${id}`}><header><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</header><div className="bb-flat-body">{children}</div></section>;
    return <Card className="fh-settings-section">
        <details id={`settings-${id}`} open={open} onToggle={(event) => { const next = event.currentTarget.open; if (next !== open) { setOpen(next); writeOpen(id, next); } }}>
            <summary className="flex cursor-pointer list-none items-start gap-4 p-6">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-primary-soft text-primary">{icon}</span>
                <span className="flex-1">
                    <span className="block text-caption font-semibold text-foreground">{title}</span>
                    {subtitle && <span className="mt-1 block text-micro text-muted-foreground">{subtitle}</span>}
                </span>
                <ChevronDown className="fh-settings-chevron mt-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </summary>
            <div className="fh-settings-body px-6 pb-6">{children}</div>
        </details>
    </Card>;
}
