import { ArrowDown, ArrowUp } from 'lucide-react';

/**
 * Settings → Display setup → Display layout (v1.6). Every module can be one of
 * up to six cards (in this order on the frame), a quick pill in the bar below
 * them, or hidden. Making a seventh card turns the last card into a pill.
 * The frame itself stays read-only.
 */
import { MAX_CARDS, moveModule, placeModule, type Layout } from './ambientLayout';
export type { Layout };
export const MODULES: Array<[key: string, title: string, description: string]> = [
    ['calendar', 'Family calendar', 'Next appointments from the connected Google Calendar.'],
    ['weather', 'Weather', 'Live conditions for the city chosen below.'],
    ['tasks', 'To-dos', 'Open items from the selected Google Tasks list.'],
    ['chores', 'Chores', 'Chores due today.'],
    ['news', 'News', 'Headlines from the feeds chosen in Settings → Display.'],
    ['daycare', 'Daycare updates', 'Short summaries of recent daycare emails.'],
    ['f1', 'Formula 1', 'The next race weekend in your time zone.'],
    ['photos', 'Family photos', 'A slideshow of photos uploaded in Settings → Display.'],
    ['wifi', 'Guest Wi-Fi', 'Network name, password and a QR code to join.'],
    ['countdown', 'Countdown', 'Days to a date you choose, with a checklist.'],
    ['markets', 'Stocks & crypto', 'Prices for the symbols you choose.'],
];
const titleOf = (key: string) => MODULES.find(([k]) => k === key)?.[1] ?? key;
type Place = 'card' | 'pill' | 'off';

function Row({ moduleKey, position, count, place, onPlace, onMove }: { moduleKey: string; position: number; count: number; place: Place; onPlace: (place: Place) => void; onMove: (step: -1 | 1) => void }) {
    const title = titleOf(moduleKey);
    return <li className="fh-layout-row">
        {place !== 'off' ? <span className="fh-layout-order">
            <button type="button" aria-label={`Move ${title} earlier`} disabled={position === 0} onClick={() => onMove(-1)}><ArrowUp size={15} /></button>
            <button type="button" aria-label={`Move ${title} later`} disabled={position === count - 1} onClick={() => onMove(1)}><ArrowDown size={15} /></button>
        </span> : <span className="fh-layout-order" aria-hidden="true" />}
        <span className="fh-layout-name"><strong>{place === 'card' ? `${position + 1}. ` : ''}{title}</strong><small>{MODULES.find(([k]) => k === moduleKey)?.[2]}</small></span>
        <span className="fh-layout-place" role="radiogroup" aria-label={`Where ${title} appears`}>
            {(['card', 'pill', 'off'] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={place === value} className={place === value ? 'is-on' : ''} onClick={() => onPlace(value)}>
                {value === 'card' ? 'Card' : value === 'pill' ? 'Pill' : 'Off'}</button>)}
        </span>
    </li>;
}

export function DisplayLayoutEditor({ layout, onChange }: { layout: Layout; onChange: (layout: Layout) => void }) {
    const hidden = MODULES.map(([key]) => key).filter((key) => !layout.cards.includes(key) && !layout.pills.includes(key));
    const row = (key: string, place: Place, index: number, count: number) => <Row key={key} moduleKey={key} position={index} count={count} place={place}
        onPlace={(next) => { if (next === 'off' && place === 'card' && layout.cards.length === 1) return; onChange(placeModule(layout, key, next)); }}
        onMove={(step) => onChange(moveModule(layout, key, step))} />;
    return <div className="fh-layout">
        <h3>Cards <small>{layout.cards.length} of {MAX_CARDS} · first row, then second row</small></h3>
        <ul>{layout.cards.map((key, index) => row(key, 'card', index, layout.cards.length))}</ul>
        <h3>Quick pills <small>The bar under the cards, left to right</small></h3>
        {layout.pills.length ? <ul>{layout.pills.map((key, index) => row(key, 'pill', index, layout.pills.length))}</ul> : <p className="ambient-settings-help">None. Choose Pill for a module to add it to the bar.</p>}
        {hidden.length > 0 && <><h3>Hidden</h3><ul>{hidden.map((key) => row(key, 'off', 0, 1))}</ul></>}
        <p className="ambient-settings-help">Guest Wi-Fi, Countdown, Stocks and Family photos also need their details further down this page. The frame stays read-only; arrange it here.</p>
    </div>;
}
