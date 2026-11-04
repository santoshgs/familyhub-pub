import type { ReactElement } from 'react';
import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/layout/Layout';
import { ModulePage } from './familyhub/ModulePage';
import { moduleForPath } from './familyhub/modules';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import SsoCallback from './pages/SsoCallback';
import Dashboard from './pages/Dashboard';
import ShoppingList from './pages/ShoppingList';
import Tasks from './pages/Tasks';
const Rewards = lazy(() => import('./pages/Rewards'));
import Calendar from './pages/Calendar';
const Planning = lazy(() => import('./pages/Planning'));
const Budget = lazy(() => import('./pages/Budget'));
import Family from './pages/Family';
import Settings from './pages/Settings';
import Join from './pages/Join';
import { ProfileName } from './familyhub/ProfileName';
import { ServerCredentials } from './familyhub/ServerCredentials';
const Integrations = lazy(() => import('./pages/Integrations'));

const AiHub = lazy(() => import('./familyhub/AiHub'));
const ConnectedHub = lazy(() => import('./familyhub/ConnectedHub'));
const LocalNotes = lazy(() => import('./familyhub/LocalNotes'));
const FamilyHub = lazy(() => import('./familyhub/FamilyHub'));
const AmbientDisplay = lazy(() => import('./familyhub/AmbientDisplay'));
const DisplaySettings = lazy(() => import('./familyhub/DisplaySettings'));
const DisplayPair = lazy(() => import('./familyhub/DisplayPair'));

function App() {
    const { isAuthenticated, loading, isModuleEnabled, user } = useAuth();
    const { t } = useTranslation('common');
    const location = useLocation();
    const navigate = useNavigate();

    // For an optional module: render its element only when enabled, otherwise
    // redirect to the dashboard so a bookmarked/typed URL never shows a hidden page.
    const moduleRoute = (key: string, element: ReactElement) =>
        isModuleEnabled(key) ? element : <Navigate to="/" replace />;

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-3">
                    <div className="spinner-brand" />
                    <p className="text-caption text-muted-foreground">{t('states.loading')}</p>
                </div>
            </div>
        );
    }

    // Password reset arrives by email link, so it must work while logged out.
    if (location.pathname === '/reset-password') {
        return <ResetPassword onDone={() => navigate('/', { replace: true })} />;
    }

    // The identity provider sends the browser back here, signed in or not.
    if (location.pathname === '/auth/callback') {
        return <SsoCallback onDone={(path) => navigate(path, { replace: true })} />;
    }

    // A paired frame that lands on the pairing page goes straight back to its display.
    if (location.pathname === '/display-pair' && user?.is_display) return <Navigate to="/display" replace />;
    if (location.pathname === '/display-pair' || (!isAuthenticated && location.pathname === '/display')) return <Suspense fallback={<div role="status">Opening frame pairing…</div>}><DisplayPair /></Suspense>;

    if (!isAuthenticated) {
        return <Login />;
    }

    if (import.meta.env.VITE_FAMILYHUB_LOCAL === 'true' || user?.is_display) {
        if (user?.is_display && location.pathname !== '/display') return <Navigate to="/display" replace />;
        if (location.pathname === '/display') return <Suspense fallback={<div role="status" className="ambient-loading">Opening family display…</div>}><AmbientDisplay /></Suspense>;
        if (location.pathname === '/display-settings' && !user?.is_display) return <Suspense fallback={<div role="status" className="p-8">Opening display settings…</div>}><DisplaySettings /></Suspense>;
        const mod = moduleForPath(location.pathname);
        // Pocket money manages its reward chores on the Chores page.
        const reachable = mod && (isModuleEnabled(mod.key) || (mod.key === 'chores' && isModuleEnabled('rewards')));
        if (mod && !reachable) return <Navigate to="/settings" replace />;
        if (location.pathname === '/settings' && !user?.is_display) return <ModulePage><ProfileName /><p className="mb-4">Choose which modules your family uses below. Switching one off hides it for everyone and keeps its saved data.</p><a href="/family" className="fh-text-button">Manage family members</a><Settings />{user?.is_owner && <details className="fh-card fh-advanced"><summary>Advanced</summary><ServerCredentials /></details>}</ModulePage>;
        const optionalPages: Record<string, ReactElement> = {
            '/budget': <Budget />, '/rewards': <><p className="mb-4">Pocket money uses local reward chores and parent approvals. Google to-dos do not earn points automatically. <a className="fh-text-button" href="/chores">Manage reward chores</a></p><Rewards /></>,
            '/shopping': <ShoppingList />, '/planning': <Planning />, '/integrations': <Integrations />,
            '/family': <Family />, '/join': <Join />,
            '/chores': <><p className="mb-4">Chores are stored in FamilyHub, separately from Google to-dos. Chores due today appear on the family display.{isModuleEnabled('rewards') && <> <a className="fh-text-button" href="/rewards">Pocket money</a></>}</p><Tasks /></>,
        };
        if (!user?.is_display && optionalPages[location.pathname]) return <ModulePage>{optionalPages[location.pathname]}</ModulePage>;
        if (!['/', '/calendar', '/tasks', '/notes', '/ai', '/daycare', '/classroom'].includes(location.pathname)) return <Navigate to="/" replace />;
        return <Suspense fallback={<div role="status" className="p-8">Opening Family Hub…</div>}>{location.pathname === '/notes' ? <LocalNotes /> : location.pathname === '/ai' && !user?.is_display ? <AiHub /> : <ConnectedHub />}</Suspense>;
    }

    // Phase 1 lives in the existing authenticated demo shell. Both flags are
    // required: this prototype must never be mistaken for a live integration.
    if (import.meta.env.VITE_FAMILYHUB === 'true' && import.meta.env.VITE_DEMO === 'true') {
        return <Suspense fallback={<div role="status" className="p-8">Opening Family Hub…</div>}><FamilyHub /></Suspense>;
    }

    return (
        <Layout>
            <Suspense fallback={<p role="status" className="p-8">Opening module…</p>}>
            <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/shopping" element={<ShoppingList />} />
                <Route path="/tasks" element={<Tasks />} />
                <Route path="/rewards" element={moduleRoute('rewards', <Rewards />)} />
                <Route path="/calendar" element={<Calendar />} />
                <Route path="/planning" element={moduleRoute('planning', <Planning />)} />
                <Route path="/budget" element={moduleRoute('budget', <Budget />)} />
                <Route path="/family" element={<Family />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/integrations" element={moduleRoute('integrations', <Integrations />)} />
                <Route path="/join" element={<Join />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
        </Layout>
    );
}

export default App;
