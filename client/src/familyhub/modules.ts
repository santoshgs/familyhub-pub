// Family Hub's optional modules, in navigation order. Home, Calendar, the family
// display and Settings are always on and are not listed. A switched-off module is
// hidden here and closed on the server (server/src/lib/modules.ts, keep in step).
// Switching one off keeps its saved data.
export const FAMILYHUB_MODULES = [
    { key: 'todos', label: 'To-dos', path: '/tasks', description: 'Google Tasks, shared with the family display.' },
    { key: 'chores', label: 'Chores', path: '/chores', description: 'Household chores kept in Family Hub. Due chores appear on the family display.' },
    { key: 'daycare', label: 'Daycare', path: '/daycare', description: 'Daycare updates read from Gmail.' },
    { key: 'classroom', label: 'School', path: '/classroom', description: 'School updates read from Gmail.' },
    { key: 'budget', label: 'Budget', path: '/budget', description: 'Household spending, income and budgets.' },
    { key: 'rewards', label: 'Pocket money', path: '/rewards', description: 'Points, approvals, balances and savings goals, earned through reward chores.' },
    { key: 'shopping', label: 'Shopping', path: '/shopping', description: 'Shared shopping lists.' },
    { key: 'planning', label: 'Weekly routines', path: '/planning', description: 'A recurring weekly family schedule.' },
    { key: 'integrations', label: 'Integrations', path: '/integrations', description: 'Home Assistant, Nextcloud and Immich.' },
    { key: 'notes', label: 'Notes', path: '/notes', description: 'Notes from home, also shown on the family display.' },
    { key: 'ai', label: 'AI assistant', path: '/ai', description: 'Choose a provider and review proposed actions. Parents only.' },
] as const;

export type FamilyHubModuleKey = (typeof FAMILYHUB_MODULES)[number]['key'];

export const DEFAULT_DISABLED_MODULES: string[] = ['shopping', 'planning', 'integrations'];

/** The module a Family Hub path belongs to, if it is an optional one. */
export const moduleForPath = (path: string) => FAMILYHUB_MODULES.find((mod) => mod.path === path);
