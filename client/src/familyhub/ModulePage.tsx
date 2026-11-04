import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { Link } from 'react-router-dom';
import { FamilyHubNav } from './FamilyHubNav';
import { familyHubVersionLabel } from './version';
import './familyhub.css';

export function ModulePage({ children }: { children: ReactNode }) {
    return <div className="fh-scope fh-app"><header className="fh-header"><Link className="fh-brand" to="/">familyhub <small>A LITTLE MORE TOGETHER</small></Link></header><FamilyHubNav /><main className="fh-main"><Suspense fallback={<p role="status">Opening module…</p>}>{children}</Suspense><footer className="fh-page-footer"><span>A little more together.</span><span>{familyHubVersionLabel} · Built on OpenFamily</span></footer></main></div>;
}
