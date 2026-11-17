import { Flower2, ArrowRight } from 'lucide-react';
import { Fragment } from 'react';

/** One Family Updates email (v2.2: from Lillio or a chosen Gmail label). All fields are plain text. */
export interface DaycareUpdate {
    id: string; title: string; text: string; receivedAt: string; kind: string; activityType?: string; hasDetails: boolean; link?: string;
    source?: { id: string; name: string }; sender?: string; display?: boolean;
}

const isLillio = (update: DaycareUpdate) => !update.source || update.source.id === 'lillio';

/** "School · Ms Example", "Daycare · feeding", "Daycare · Message". */
export function updateLabel(update: DaycareUpdate): string {
    const source = update.source?.name ?? 'Daycare';
    if (!isLillio(update)) return update.sender ? `${source} · ${update.sender}` : source;
    const what = update.kind === 'activity' ? update.activityType ?? 'Activity' : update.kind === 'message' ? 'Message' : 'Notification';
    return `${source} · ${what}`;
}

/**
 * The server's tidy text as paragraphs and bullet lists: blank lines separate
 * blocks, "• " starts a list item. React text nodes only, never HTML.
 */
export function FormattedText({ text, className }: { text: string; className?: string }) {
    const blocks = text.split(/\n{2,}/).map((block) => block.split('\n').filter((line) => line.trim())).filter((lines) => lines.length);
    return <div className={['fh-mail-text', className].filter(Boolean).join(' ')}>{blocks.map((lines, index) => {
        const bullets = lines.every((line) => line.startsWith('• '));
        if (bullets) return <ul key={index}>{lines.map((line, item) => <li key={item}>{line.slice(2)}</li>)}</ul>;
        return <p key={index}>{lines.map((line, item) => <Fragment key={item}>{item > 0 && <br />}{line}</Fragment>)}</p>;
    })}</div>;
}

export function DaycareSummary({ updates, emptyMessage, onOpen }: { updates: DaycareUpdate[]; emptyMessage?: string; onOpen: () => void }) {
    return <>{updates.slice(0, 3).map((update) => <article className="fh-daycare-entry" key={update.id}><p className="fh-eyebrow">{updateLabel(update)}</p><h3>{update.title}</h3><p>{update.text.replace(/\s+/g, ' ').slice(0, 240)}{update.text.length > 240 ? '…' : ''}</p><time>{new Date(update.receivedAt).toLocaleString()}</time></article>)}{!updates.length && <div className="fh-empty"><p>{emptyMessage}</p></div>}<button className="fh-text-button" onClick={onOpen}>See all updates<ArrowRight size={15} /></button></>;
}

export function DaycareTimeline({ updates, summaries = {} }: { updates: DaycareUpdate[]; summaries?: Record<string, string> }) {
    return <div className="fh-timeline">{updates.map((update) => <article key={update.id}><span className="fh-timeline-icon fh-tint-sage"><Flower2 size={18} /></span><div>
        <time>{updateLabel(update)} · {new Date(update.receivedAt).toLocaleString()}</time><h3>{update.title}</h3>
        {summaries[update.id] && <p className="fh-mail-summary"><b>AI summary</b> {summaries[update.id]}</p>}
        <FormattedText text={update.text} />
        {!update.hasDetails && <p>Open the original email for further details.</p>}
        {update.link && <a className="fh-text-button" href={update.link} target="_blank" rel="noreferrer noopener">{isLillio(update) ? 'Open in Lillio' : `Open link from ${update.source?.name ?? 'sender'}`}<ArrowRight size={14} /></a>}
    </div></article>)}{!updates.length && <p>No Family Updates are available.</p>}</div>;
}
