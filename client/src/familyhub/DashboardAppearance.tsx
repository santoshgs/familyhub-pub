import { Children, isValidElement, createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { HubDialog } from './FamilyHub';
import { CARD_ORDER, CARD_LABELS, normalizeCardOrder, moveCard } from './appearance';

// `hidden`: overview cards this member chose not to show (or whose module is off).
export const CardLayout = createContext<{ order: string[]; editable: boolean; move: (card: string, target: string) => void; hidden?: string[] }>({ order: CARD_ORDER, editable: false, move: () => {} });
export function useDashboardAppearance(session: string | undefined) {
    const [order, setOrder] = useState(CARD_ORDER);
    const [legend, setLegend] = useState<Record<string, string>>({});
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        let active = true;
        setOrder(CARD_ORDER); setLegend({});
        void api.get<{ data: { cardOrder: string[]; legend: Record<string, string> } }>('/api/familyhub/preferences').then(({ data }) => {
            if (active) { setOrder(normalizeCardOrder(data.cardOrder)); setLegend(data.legend); }
        }).catch(() => { if (active) setError('Dashboard preferences could not be loaded.'); });
        return () => { active = false; };
    }, [session]);
    const save = async (kind: 'order' | 'legend', value: string[] | Record<string, string>) => {
        if (saving) return false;
        setSaving(true); setError('');
        try {
            await api.put(`/api/familyhub/preferences/${kind}`, kind === 'order' ? { cardOrder: value } : { legend: value });
            if (kind === 'order') setOrder(value as string[]); else setLegend(value as Record<string, string>);
            return true;
        } catch { setError('That preference could not be saved. Try again.'); return false; }
        finally { setSaving(false); }
    };
    return { order, legend, error, saving, save };
}
export function ArrangeCards({ order, saving, error, onSave, onClose }: {
    order: string[]; saving: boolean; error: string; onSave: (order: string[]) => Promise<void>; onClose: () => void;
}) {
    const [draft, setDraft] = useState(order);
    return <HubDialog open onClose={onClose} title="Arrange your overview" description="Saved for your account. Other family members keep their own layout."><div className="fh-form">{draft.map((card, index) => <div className="fh-arrange-row" key={card}><span>{CARD_LABELS[card]}</span><button className="fh-button fh-secondary" disabled={!index} aria-label={`Move ${CARD_LABELS[card]} up`} onClick={() => setDraft(moveCard(draft, card, draft[index - 1]))}>↑</button><button className="fh-button fh-secondary" disabled={index === draft.length - 1} aria-label={`Move ${CARD_LABELS[card]} down`} onClick={() => setDraft(moveCard(draft, card, draft[index + 1]))}>↓</button></div>)}{error && <p role="alert">{error}</p>}<button className="fh-button fh-secondary" onClick={() => setDraft(CARD_ORDER)}>Reset order</button><button className="fh-button fh-primary" disabled={saving} onClick={() => void onSave(draft)}>Save card order</button></div></HubDialog>;
}
export function CalendarLegend({ events, labels, editable, saving, error, onSave }: {
    events: { color?: string }[]; labels: Record<string, string>; editable: boolean; saving: boolean; error: string;
    onSave: (labels: Record<string, string>) => Promise<boolean>;
}) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<Record<string, string>>({});
    const [newColor, setNewColor] = useState('#039be5');
    const [newLabel, setNewLabel] = useState('');
    const colors = [...new Set([...Object.keys(labels), ...events.map((event) => (event.color ?? '#547b4d').toLowerCase())])].sort();
    return <div className="fh-calendar-legend"><h3>Calendar colours</h3><div className="fh-legend-items">{colors.map((color) => <span key={color}><i style={{ background: color }} aria-hidden="true" />{labels[color] || `Unlabelled (${color})`}</span>)}{!colors.length && <span>Add colour labels for your family.</span>}</div>{editable && <button className="fh-text-button" onClick={() => { setDraft(labels); setOpen(true); }}>Edit colour labels</button>}
        <HubDialog open={open} onClose={() => setOpen(false)} title="Calendar colour labels" description="Tell your family what each colour means. These labels do not change events in Google."><div className="fh-form">{[...new Set([...colors, ...Object.keys(draft)])].map((color) => <label key={color}><span className="fh-colour-caption"><i style={{ background: color }} />{color}</span><input maxLength={60} placeholder="Blue: Alex" value={draft[color] ?? ''} onChange={(event) => setDraft({ ...draft, [color]: event.target.value })} /></label>)}<div className="fh-form-row"><label>Another colour<input type="color" value={newColor} onChange={(event) => setNewColor(event.target.value)} /></label><label>Label<input maxLength={60} value={newLabel} onChange={(event) => setNewLabel(event.target.value)} placeholder="Blue: Alex" /></label></div><button className="fh-button fh-secondary" disabled={!newLabel.trim()} onClick={() => { setDraft({ ...draft, [newColor.toLowerCase()]: newLabel }); setNewLabel(''); }}>Add colour</button><p className="fh-fine-print">Leave a label blank to remove it. Colours without labels keep their swatches.</p>{error && <p role="alert">{error}</p>}<button className="fh-button fh-primary" disabled={saving} onClick={async () => { if (await onSave(Object.fromEntries(Object.entries(draft).filter(([, label]) => label.trim())))) setOpen(false); }}>Save colour labels</button></div></HubDialog>
    </div>;
}
export function OrderedCard({ card, children }: { card: string; children: ReactNode }) {
    const layout = useContext(CardLayout);
    return <section className={`fh-card fh-${card}`} style={{ order: layout.order.indexOf(card) }} onDragOver={(event) => { if (layout.editable) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (layout.editable) layout.move(event.dataTransfer.getData('text/plain'), card); }}>{children}</section>;
}

export function DashboardGrid({ children }: { children: ReactNode }) {
    const { order, hidden = [] } = useContext(CardLayout);
    const key = (child: ReactNode) => isValidElement<{ className?: string; card?: string }>(child) ? child.props.card ?? child.props.className?.replace('fh-', '') ?? '' : '';
    const cards = Children.toArray(children).filter((child) => !hidden.includes(key(child)));
    cards.sort((a, b) => order.indexOf(key(a)) - order.indexOf(key(b)));
    return <div className="fh-grid">{cards}</div>;
}
