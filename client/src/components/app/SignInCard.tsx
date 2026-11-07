import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, KeyRound, Loader2, LogOut } from 'lucide-react';
import { Button } from '../ui';
import { useAuth } from '../../contexts/AuthContext';
import { SettingsSection } from './SettingsSection';

/**
 * "Sign-in" section in Settings: sign out of this device or of every device.
 * Family Hub signs in with email and password only (single sign-on was removed
 * in v1.4.2); the Google connection for Calendar and Tasks is separate.
 */
const SignInCard: React.FC = () => {
    const { t } = useTranslation(['settings', 'common']);
    const { logout, logoutEverywhere } = useAuth();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const handleLogoutEverywhere = async () => {
        if (!confirm(t('settings:signIn.confirmLogoutEverywhere'))) return;
        setError('');
        setBusy(true);
        try {
            await logoutEverywhere();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('common:states.error'));
            setBusy(false);
        }
    };

    return (
        <SettingsSection id="signIn" icon={<KeyRound className="h-5 w-5" />} title={t('settings:signIn.title')} subtitle={t('settings:signIn.subtitle')}>
            <div className="space-y-4">
                {error && (
                    <p className="flex items-center gap-1 text-micro text-destructive">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        {error}
                    </p>
                )}
                <div className="space-y-2">
                    <p className="text-micro text-muted-foreground">{t('settings:signIn.logoutDesc')}</p>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => { logout(); window.location.assign('/'); }}>
                        <LogOut className="mr-2 h-4 w-4" />
                        {t('settings:signIn.logout')}
                    </Button>
                </div>
                <div className="space-y-2 border-t border-border pt-4">
                    <p className="text-micro text-muted-foreground">{t('settings:signIn.logoutEverywhereDesc')}</p>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={handleLogoutEverywhere}>
                        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
                        {t('settings:signIn.logoutEverywhere')}
                    </Button>
                </div>
            </div>
        </SettingsSection>
    );
};

export default SignInCard;
