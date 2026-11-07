import { useEffect, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowUp, ListOrdered } from 'lucide-react';
import { SettingsSection } from '../components/app/SettingsSection';
import { api } from '../lib/api';
import { applyNavOrder } from './navOrderCore';
export { applyNavOrder };

/**
 * Each account's own order for the management menu (v1.5.2). Saved on the
 * server per account and cached in this browser so the menu draws in the
 * right order before the request returns.
 */
const KEY = 'familyhub.nav.order';
const read = (): string[] => { try { const value = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []; } catch { return []; } };
let current = read();
let fetched = false;
const listeners = new Set<() => void>();
const set = (order: string[]) => {
    current = order;
    try { localStorage.setItem(KEY, JSON.stringify(order)); } catch { /* the server copy is the record */ }
    listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useNavOrder() {
    const order = useSyncExternalStore(subscribe, () => current);
    useEffect(() => {
        if (fetched) return;
        fetched = true;
        api.get<{ data: { order: string[] } }>('/api/familyhub/nav').then((response) => set(response.data?.order ?? [])).catch(() => { fetched = false; });
    }, []);
    return order;
}

export async function saveNavOrder(order: string[]) {
    const previous = current;
    set(order);
    try { await api.put('/api/familyhub/nav', { order }); } catch (error) { set(previous); throw error; }
}

/** Settings → You → Menu order. */
export function NavOrderEditor({ items, phoneTabs, asSection }: { items: Array<{ to: string; label: string }>; phoneTabs?: number; asSection?: boolean }) {
    const order = useNavOrder();
    const sorted = applyNavOrder(items, order);
    const move = (index: number, step: -1 | 1) => {
        const next = sorted.map((item) => item.to);
        [next[index], next[index + step]] = [next[index + step], next[index]];
        void saveNavOrder(next).catch(() => undefined);
    };
    const preview = `${sorted.slice(0, phoneTabs ?? 4).map((item) => item.label).join(', ')}${sorted.length > (phoneTabs ?? 4) ? ', More…' : ''}`;
    const content = <>
        <div className="fh-nav-order-body">
        <p className="fh-nav-order-help">Move what you use most to the top. The first items show in the menu bar and the rest go under More{phoneTabs ? ` (on a phone, the first ${phoneTabs})` : ''}. This applies to your account on every device.</p>
        <ol className="fh-layout">{sorted.map((item, index) => <li key={item.to} className="fh-layout-row">
            <span className="fh-layout-order">
                <button type="button" aria-label={`Move ${item.label} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
                <button type="button" aria-label={`Move ${item.label} down`} disabled={index === sorted.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
            </span>
            <span className="fh-layout-name"><strong>{index + 1}. {item.label}</strong></span>
            <span />
        </li>)}</ol>
        {order.length > 0 && <button type="button" className="fh-text-button" onClick={() => void saveNavOrder([]).catch(() => undefined)}>Reset to the default order</button>}
        </div>
    </>;
    if (asSection) return <SettingsSection id="menu-order" icon={<ListOrdered size={20} />} title="Menu order" subtitle={preview}><div className="fh-nav-order">{content}</div></SettingsSection>;
    // Closed by default, like "Your name"; the summary previews the first items.
    return <details className="fh-card fh-advanced fh-profile-name-details fh-nav-order">
        <summary>Menu order <small>{preview}</small></summary>
        {content}
    </details>;
}
