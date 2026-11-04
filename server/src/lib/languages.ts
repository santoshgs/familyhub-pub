/** The languages of the interface, e-mails, notifications and reminders: English and French. Keep in step with client/src/i18n/languages.ts. */
export const LANGUAGES = ['fr', 'en'] as const;

export type Language = typeof LANGUAGES[number];

export const isLanguage = (value: unknown): value is Language =>
    typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
