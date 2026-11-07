import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import {
    BookOpen, CalendarDays, CheckCheck, GraduationCap, House, CalendarClock, ListChecks, LogOut, Monitor, MoreHorizontal,
    PiggyBank, Plug, Settings, ShoppingBasket, Sparkles, StickyNote, Wallet, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { applyNavOrder, NavOrderEditor, useNavOrder } from './navOrder';
import { FAMILYHUB_MODULES, type FamilyHubModuleKey } from './modules';
import { familyHubVersionLabel } from './version';
import { FamilyHubNav as ClassicNav } from './ClassicNav';
import { LookPicker, getLook } from './look';
import './familyhub.css';
import './board.css';

type NavItem = { to: string; label: string; icon: LucideIcon };
const MODULE_ICONS: Record<FamilyHubModuleKey, LucideIcon> = {
    todos: CheckCheck, chores: ListChecks, daycare: BookOpen, classroom: GraduationCap, budget: Wallet,
    rewards: PiggyBank, shopping: ShoppingBasket, planning: CalendarClock, integrations: Plug, notes: StickyNote, ai: Sparkles,
};
/** How many destinations the phone tab bar shows before More. */
const PHONE_TABS = 4;

/** One ordered list of destinations shared by the desktop rail, the phone tab bar and More. */
export function useNavItems(): NavItem[] {
    const { user, isModuleShown } = useAuth();
    const isParent = Boolean(user?.is_owner || user?.role === 'parent');
    const order = useNavOrder();
    if (user?.is_display) return [];
    return applyNavOrder([
        { to: '/', label: 'Home', icon: House },
        { to: '/calendar', label: 'Calendar', icon: CalendarDays },
        ...FAMILYHUB_MODULES.filter((mod) => mod.key !== 'ai' && isModuleShown(mod.key))
            .map((mod) => ({ to: mod.path, label: mod.label, icon: MODULE_ICONS[mod.key] })),
        { to: '/display', label: 'Ambient display', icon: Monitor },
        ...(isParent && isModuleShown('ai') ? [{ to: '/ai', label: 'AI assistant', icon: Sparkles }] : []),
        { to: '/settings', label: 'Settings', icon: Settings },
    ], order);
}

export function ThemeSelect() {
    const { theme, setTheme } = useTheme();
    return <label className="bb-theme">Theme <select aria-label="Colour theme" value={theme} onChange={(event) => setTheme(event.target.value as 'light' | 'dark' | 'system')}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></label>;
}

export function Avatar() {
    const { user } = useAuth();
    return <span className="bb-me" aria-hidden="true">{user?.avatar_url ? <img src={user.avatar_url} alt="" /> : (user?.name?.trim()[0] ?? '?').toUpperCase()}</span>;
}

const roleLabel = (user: ReturnType<typeof useAuth>['user']) => user?.is_owner ? 'Parent · owner' : user?.role === 'parent' ? 'Parent' : 'Family member';

/**
 * The management app's shell: a cobalt rail on desktop; on a phone, a cobalt
 * header (title, optional subtitle and tools) and a bottom tab bar whose last
 * tab opens everything else. The display session never sees it.
 */
export function AppShell(props: { title: ReactNode; subtitle?: ReactNode; tools?: ReactNode; deskTitle?: boolean; children: ReactNode }) {
    // Classic keeps the original header and tab row, without Board Book's styles.
    if (getLook() === 'classic') return <div className="fh-scope fh-app"><header className="fh-header"><Link className="fh-brand" to="/">familyhub <small>A LITTLE MORE TOGETHER</small></Link></header><ClassicNav /><main className="fh-main" id="fh-content" tabIndex={-1}>{props.children}<footer className="fh-page-footer"><span>A little more together.</span><span>{familyHubVersionLabel} · Built on OpenFamily</span></footer></main></div>;
    return <BoardShell {...props} />;
}

function BoardShell({ title, subtitle, tools, deskTitle = true, children }: { title: ReactNode; subtitle?: ReactNode; tools?: ReactNode; deskTitle?: boolean; children: ReactNode }) {
    const { user, logout } = useAuth();
    const items = useNavItems();
    const location = useLocation();
    const [moreOpen, setMoreOpen] = useState(false);
    useEffect(() => { document.body.classList.add('bb-on'); return () => document.body.classList.remove('bb-on'); }, []);
    useEffect(() => { setMoreOpen(false); }, [location.pathname]);
    useEffect(() => {
        if (!moreOpen) return;
        const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(false); };
        window.addEventListener('keydown', close);
        return () => window.removeEventListener('keydown', close);
    }, [moreOpen]);
    const signOut = () => { logout(); window.location.assign('/'); };
    const isCurrent = (to: string) => to === '/' ? location.pathname === '/' : location.pathname === to;
    const tabs = items.slice(0, PHONE_TABS);
    const rest = items.slice(PHONE_TABS);
    const moreActive = rest.some((item) => isCurrent(item.to));

    return <div className="fh-scope fh-app bb">
        <a className="fh-skip" href="#fh-content">Skip to content</a>
        <aside className="bb-rail" aria-label="Family Hub">
            <Link className="bb-brand" to="/"><span><House size={20} strokeWidth={2.4} /></span>family hub</Link>
            <nav className="bb-railnav" aria-label="Family Hub navigation">{items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end className={({ isActive }) => isActive ? 'is-current' : ''}><Icon size={22} strokeWidth={2.2} />{label}</NavLink>)}</nav>
            <div className="bb-railfoot">
                <div className="bb-railme"><Avatar /><div><b>{user?.name}</b><small>{roleLabel(user)}</small></div></div>
                <div className="bb-railtools"><LookPicker className="bb-theme" /></div><div className="bb-railtools"><ThemeSelect /><button type="button" className="fh-icon-button" aria-label="Sign out" title="Sign out" onClick={signOut}><LogOut size={20} /></button></div>
            </div>
        </aside>
        <header className="bb-head">
            <div>{subtitle && <p>{subtitle}</p>}<h1>{title}</h1></div>
            <div className="bb-head-tools">{tools}<Avatar /></div>
        </header>
        <main className="bb-main" id="fh-content" tabIndex={-1}>
            <div className="bb-page">{deskTitle && <h1 className="bb-desk-title">{title}</h1>}{children}</div>
            <footer className="fh-page-footer bb-foot"><span>{familyHubVersionLabel} · Built on OpenFamily</span></footer>
        </main>
        {items.length > 0 && <nav className="bb-tabs" aria-label="Main">
            {tabs.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end className={({ isActive }) => isActive ? 'is-current' : ''}><Icon size={24} strokeWidth={2.2} />{label}</NavLink>)}
            <button type="button" className={moreActive ? 'is-current' : ''} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}><MoreHorizontal size={24} strokeWidth={2.2} />More</button>
        </nav>}
        {moreOpen && <div className="bb-more" role="dialog" aria-modal="true" aria-label="More">
            <button type="button" className="bb-more-scrim" aria-label="Close" onClick={() => setMoreOpen(false)} />
            <div className="bb-more-sheet">
                <h2>More</h2>
                {rest.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end className={({ isActive }) => isActive ? 'is-current' : ''}><Icon size={22} strokeWidth={2.2} />{label}</NavLink>)}
                <hr />
                <div className="bb-more-foot"><LookPicker className="bb-theme" /></div><div className="bb-more-foot"><ThemeSelect /><button type="button" className="bb-btn is-small" onClick={signOut}><LogOut size={16} />Sign out</button></div>
            </div>
        </div>}
    </div>;
}

/** Settings → You → Menu order (both looks share the same list). */
export function NavOrderSettings({ board, asSection }: { board?: boolean; asSection?: boolean }) {
    const items = useNavItems();
    return <NavOrderEditor items={items} phoneTabs={board ? PHONE_TABS : undefined} asSection={asSection} />;
}
