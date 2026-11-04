export interface LanguageConfig {
    label: string;
}

// Family Hub ships English and French. Locale folders remain the source of
// truth for availability; keep this list and server/src/lib/languages.ts in step.
export const LANGUAGE_CONFIG: Record<string, LanguageConfig> = {
    fr: {
        label: 'FR',
    },
    en: {
        label: 'EN',
    },
};

export const CONFIGURED_LANGUAGE_ORDER = Object.keys(LANGUAGE_CONFIG);
