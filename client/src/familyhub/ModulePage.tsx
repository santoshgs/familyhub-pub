import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { AppShell, useNavItems } from './FamilyHubNav';
import './familyhub.css';

const EXTRA_TITLES: Record<string, string> = { '/family': 'Family members', '/join': 'Join a family' };

export function ModulePage({ children, title }: { children: ReactNode; title?: string }) {
    const path = useLocation().pathname;
    const items = useNavItems();
    const label = title ?? items.find((item) => item.to === path)?.label ?? EXTRA_TITLES[path] ?? 'Family Hub';
    return <AppShell title={label}><Suspense fallback={<p role="status">Opening module…</p>}>{children}</Suspense></AppShell>;
}
