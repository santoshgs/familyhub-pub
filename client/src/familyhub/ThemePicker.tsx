import { useTheme } from '../contexts/ThemeContext';
export function ThemePicker() {
    const { theme, setTheme } = useTheme();
    return <label className="fh-theme-picker">Theme <select aria-label="Colour theme" value={theme} onChange={(event) => setTheme(event.target.value as 'light' | 'dark' | 'system')}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></label>;
}
