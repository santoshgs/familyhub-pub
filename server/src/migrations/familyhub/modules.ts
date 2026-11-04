import type { Migration } from '../runner';
export const moduleMigrations: readonly Migration[] = [{
    id: 'familyhub/0004-modules',
    statements: [`CREATE TABLE familyhub_module_preferences (
        family_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        disabled_modules JSONB NOT NULL
    )`],
}];
