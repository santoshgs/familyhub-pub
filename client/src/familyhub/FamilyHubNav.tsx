import { useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
    BookOpen, CalendarDays, CheckCheck, ChevronDown, CircleEllipsis, GraduationCap, House,
    CalendarClock, ListChecks, Monitor, PiggyBank, Plug, Settings, ShoppingBasket, Sparkles, StickyNote, Wallet, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { FAMILYHUB_MODULES, type FamilyHubModuleKey } from './modules';
import { ThemePicker } from './ThemePicker';
import './familyhub.css';

type NavItem = { to: string; label: string; icon: LucideIcon };
const MODULE_ICONS: Record<FamilyHubModuleKey, LucideIcon> = {
    todos: CheckCheck, chores: ListChecks, daycare: BookOpen, classroom: GraduationCap, budget: Wallet,
    rewards: PiggyBank, shopping: ShoppingBasket, planning: CalendarClock, integrations: Plug, notes: StickyNote, ai: Sparkles,
};

/**
 * One ordered list of destinations. As many as fit are shown as tabs; the rest
 * overflow, in the same order, into the More menu. Widths are measured from a
 * hidden copy of every tab, so the split follows the real fonts and labels.
 */
export function FamilyHubNav() {
    const { user, isModuleShown } = useAuth();
    const location = useLocation();
    const [menuOpen, setMenuOpen] = useState(false);
    const [visibleCount, setVisibleCount] = useState(4);
    const tabsRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);
    const moreRef = useRef<HTMLDetailsElement>(null);
    const isParent = Boolean(user?.is_owner || user?.role === 'parent');

    const items: NavItem[] = user?.is_display ? [] : [
        { to: '/', label: 'Home', icon: House },
        { to: '/calendar', label: 'Calendar', icon: CalendarDays },
        ...FAMILYHUB_MODULES.filter((mod) => mod.key !== 'ai' && isModuleShown(mod.key))
            .map((mod) => ({ to: mod.path, label: mod.label, icon: MODULE_ICONS[mod.key] })),
        { to: '/display', label: 'Ambient display', icon: Monitor },
        ...(isParent ? [{ to: '/display-settings', label: 'Display setup', icon: Settings }] : []),
        ...(isParent && isModuleShown('ai') ? [{ to: '/ai', label: 'AI assistant', icon: Sparkles }] : []),
        { to: '/settings', label: 'Settings', icon: Settings },
    ];
    const signature = items.map((item) => item.to).join('|');

    useLayoutEffect(() => {
        const tabs = tabsRef.current, measure = measureRef.current, more = moreRef.current;
        if (!tabs || !measure || !more) return;
        const fit = () => {
            const widths = Array.from(measure.children).map((child) => (child as HTMLElement).getBoundingClientRect().width);
            const gap = parseFloat(getComputedStyle(tabs).columnGap || '0') || 0;
            const available = tabs.getBoundingClientRect().width;
            const total = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);
            if (total <= available) { setVisibleCount(widths.length); return; }
            const room = available - more.getBoundingClientRect().width - gap;
            let used = 0, count = 0;
            for (const width of widths) {
                const next = used + (count ? gap : 0) + width;
                if (next > room) break;
                used = next; count += 1;
            }
            setVisibleCount(Math.max(1, count));
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(tabs.parentElement ?? tabs);
        void document.fonts?.ready.then(fit);
        return () => observer.disconnect();
    }, [signature]);

    if (user?.is_display) return null;
    const shown = items.slice(0, visibleCount);
    const overflow = items.slice(visibleCount);
    const isMoreActive = overflow.some((item) => item.to === location.pathname);
    const tab = ({ to, label, icon: Icon }: NavItem) => <NavLink key={to} to={to} end className={({ isActive }) => isActive ? 'is-current' : ''}><Icon size={17} strokeWidth={1.9} /><span>{label}</span></NavLink>;

    return <nav className="fh-section-nav fh-app-nav" aria-label="Family Hub navigation">
        <div className="fh-primary-tabs" ref={tabsRef}>{shown.map(tab)}</div>
        <div className="fh-tab-measure" ref={measureRef} aria-hidden="true">{items.map(({ to, label, icon: Icon }) => <a key={to} tabIndex={-1}><Icon size={17} strokeWidth={1.9} /><span>{label}</span></a>)}</div>
        <details ref={moreRef} className={`fh-more-menu${isMoreActive ? ' is-current' : ''}${overflow.length ? '' : ' is-empty'}`} open={menuOpen} onToggle={(event) => setMenuOpen(event.currentTarget.open)}>
            <summary aria-haspopup="menu" aria-expanded={menuOpen}><CircleEllipsis size={18} /><span>More</span><ChevronDown className="fh-more-chevron" size={14} /></summary>
            <div role="menu" className="fh-more-popover">{overflow.map(({ to, label, icon: Icon }) => <NavLink role="menuitem" key={to} to={to} onClick={() => setMenuOpen(false)} className={({ isActive }) => isActive ? 'is-current' : ''}><Icon size={17} /><span>{label}</span></NavLink>)}</div>
        </details>
        <div className="fh-nav-theme"><ThemePicker /></div>
    </nav>;
}
