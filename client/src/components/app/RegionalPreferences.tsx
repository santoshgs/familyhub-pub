import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { Select, useToast } from '../ui';
import { useAuth } from '../../contexts/AuthContext';
import { applyRegionalPreferences, weekStartsOn } from '../../i18n/format';
import { SettingsSection } from './SettingsSection';

// ISO numbering, as stored on the account: Monday = 1 ... Sunday = 7.
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

/** Settings card: the first day of the week, for this member only. */
const RegionalPreferences: React.FC = () => {
    const { t } = useTranslation('settings');
    const { user, updateRegionalPreferences } = useAuth();
    const { showToast } = useToast();
    const [saving, setSaving] = useState(false);

    const saved = user?.week_start_day ?? null;

    // Name the day "automatic" resolves to right now, so the choice is concrete.
    applyRegionalPreferences(null);
    const automaticIso = weekStartsOn() === 0 ? 7 : weekStartsOn();
    applyRegionalPreferences(saved);

    const options = [
        {
            value: '',
            label: t('regional.automatic', { day: t(`regional.days.${DAYS[automaticIso - 1]}`) }),
        },
        ...DAYS.map((day, index) => ({ value: String(index + 1), label: t(`regional.days.${day}`) })),
    ];

    const handleChange = async (value: string) => {
        setSaving(true);
        try {
            await updateRegionalPreferences({ week_start_day: value ? Number(value) : null });
        } catch {
            showToast({ title: t('regional.saveError') });
        } finally {
            setSaving(false);
        }
    };

    return (
        <SettingsSection id="regional" icon={<CalendarDays className="h-5 w-5" />} title={t('regional.title')} subtitle={t('regional.subtitle')}>
                        <div className="mt-4 max-w-xs">
                            <label className="mb-1.5 block text-label font-medium text-foreground">
                                {t('regional.weekStart')}
                            </label>
                            <Select
                                value={saved ? String(saved) : ''}
                                onValueChange={(value) => void handleChange(value)}
                                options={options}
                                className={saving ? 'opacity-60' : undefined}
                            />
                            <p className="mt-1.5 text-micro text-muted-foreground">{t('regional.weekStartHelp')}</p>
                        </div>
                    </SettingsSection>
    );
};

export default RegionalPreferences;
