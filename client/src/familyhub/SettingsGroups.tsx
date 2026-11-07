import { Suspense, lazy, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { NavOrderSettings } from './FamilyHubNav';
import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import Settings from '../pages/Settings';
import { ProfileName } from './ProfileName';
import { ServerCredentials } from './ServerCredentials';
import { ServerRestart, ServerUpdates } from './ServerUpdates';
import { Avatar } from './FamilyHubNav';
import { FlatSettings } from '../components/app/SettingsSection';
import { api } from '../lib/api';
import { onColour, worldHue } from './today';
import './board.css';

const DashboardExtrasSettings = lazy(() => import('./DashboardExtrasSettings'));
const DisplaySetupPanel = lazy(() => import('./DisplaySettings').then((module) => ({ default: module.DisplaySetupPanel })));

type Group = { id: string; tone: string; title: string; summary: string; body: () => ReactNode };

/**
 * Family Hub's Settings, in five groups. On a phone the page is a list that
 * opens one group at a time (the URL hash names it, so links like
 * /settings#display keep working); on a desktop the list sits beside the open
 * group, whose tab joins its panel.
 */
export function SettingsGroups() {
    const { t } = useTranslation('settings');
    const { user } = useAuth();
    const hash = useLocation().hash.slice(1);
    const isParent = Boolean(user?.is_owner || user?.role === 'parent');
    const [members, setMembers] = useState<{ id: string; name: string; color: string }[]>([]);
    useEffect(() => { void api.get<{ data: { id: string; name: string; color: string }[] }>('/api/family').then((response) => setMembers(response.data ?? [])).catch(() => setMembers([])); }, []);
    const groups: Group[] = [
        { id: 'you', tone: 'g-you', title: t('groups.you.title', { defaultValue: 'You' }), summary: t('groups.you.summary', { defaultValue: 'Name, menu order, language, notifications, sign-in' }),
            body: () => <><ProfileName /><NavOrderSettings board /><Settings only={['language', 'week', 'profile', 'notif', 'signin']} /></> },
        { id: 'household', tone: 'g-house', title: t('groups.household.title', { defaultValue: 'Household' }), summary: t('groups.household.summary', { defaultValue: 'Members, modules, AI assistant' }),
            body: () => <><section className="bb-flat"><header><h3>{t('groups.household.membersTitle', { defaultValue: 'Family members' })}</h3><p>{t('groups.household.membersHelp', { defaultValue: 'Parents manage settings and approve chores.' })}</p></header><div className="bb-flat-body bb-chips">{members.map((member) => <span key={member.id} style={{ '--m': worldHue(member.color), '--on': onColour(worldHue(member.color)) } as CSSProperties}><i aria-hidden="true">{member.name.trim()[0]?.toUpperCase()}</i>{member.name}</span>)}<Link className="bb-btn is-small" to="/family">{isParent ? t('groups.household.invite', { defaultValue: 'Invite or manage' }) : t('groups.household.members', { defaultValue: 'Manage family members' })}</Link></div></section><Settings only={['modules', 'ai', 'categories', 'currency']} /></> },
        ...(isParent ? [{ id: 'display', tone: 'g-display', title: t('groups.display.title', { defaultValue: 'Display' }), summary: t('groups.display.summary', { defaultValue: 'Layout, weather, night mode, frames, photos' }),
            body: () => <Suspense fallback={<p role="status" className="fh-extras-loading">Loading display options…</p>}><DisplaySetupPanel /><DashboardExtrasSettings /></Suspense> }] : []),
        { id: 'data', tone: 'g-data', title: t('groups.data.title', { defaultValue: 'Data' }), summary: t('groups.data.summary', { defaultValue: 'Export and import' }),
            body: () => <Settings only={['export', 'import']} /> },
        ...(user?.is_owner ? [{ id: 'advanced', tone: 'g-adv', title: t('groups.advanced.title', { defaultValue: 'Advanced' }), summary: t('groups.advanced.summary', { defaultValue: 'Updates, restart, server credentials' }),
            body: () => <><ServerUpdates /><ServerRestart /><ServerCredentials /></> }] : []),
    ];
    const chosen = groups.find((group) => group.id === hash);
    const open = chosen ?? groups[0];
    const intro: Record<string, string> = {
        you: t('groups.you.intro', { defaultValue: 'Only affects your account and this device.' }),
        household: t('groups.household.intro', { defaultValue: 'Changes here apply to everyone in the family.' }),
        display: t('groups.display.intro', { defaultValue: 'What the kitchen frame shows. The frame itself stays read-only.' }),
        data: t('groups.data.intro', { defaultValue: 'Portable JSON. Passwords and secrets are never included.' }),
        advanced: t('groups.advanced.intro', { defaultValue: 'Server administrator only.' }),
    };

    return <div className="bb-set">
        <div className={`bb-set-grid ${chosen ? 'bb-is-panel' : 'bb-is-list'}`}>
            <div className="bb-glist-wrap">
                <div className="bb-set-me"><Avatar /><div><b>{user?.name}</b><small>{user?.email}</small></div></div>
                <ul className="bb-glist">{groups.map((group) => <li key={group.id} className={group.tone}><a href={`#${group.id}`} aria-current={group.id === open.id ? 'true' : undefined}><i className="dot" aria-hidden="true" /><span>{group.title}<small>{group.summary}</small></span><ChevronRight className="chev" size={20} /></a></li>)}</ul>
            </div>
            <section className={`bb-panel ${open.tone}`} aria-labelledby="bb-group-title">
                <a className="bb-back" href="#"><ChevronLeft size={20} />{t('title', { defaultValue: 'Settings' })}</a>
                <header className="bb-panel-head"><h2 id="bb-group-title">{open.title}</h2><p>{intro[open.id]}</p></header>
                <div className="bb-panel-body"><FlatSettings.Provider value={true}>{open.body()}</FlatSettings.Provider></div>
            </section>
        </div>
    </div>;
}
