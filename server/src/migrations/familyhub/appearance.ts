import type { Migration } from '../runner';
export const appearanceMigrations: readonly Migration[] = [{ id: 'familyhub/0005-appearance', statements: [
    `CREATE TABLE familyhub_dashboard_preferences (user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, card_order JSONB NOT NULL)`,
    `CREATE TABLE familyhub_calendar_legend (family_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, labels JSONB NOT NULL)`,
] }];
