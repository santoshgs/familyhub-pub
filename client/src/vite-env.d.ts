/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_URL: string;
    readonly VITE_WS_URL: string;
    readonly VITE_DEMO?: string;
    readonly VITE_FAMILYHUB?: string;
    readonly VITE_FAMILYHUB_LOCAL?: string;
    readonly VITE_REGISTRATION_ENABLED?: string;
}

/** Injected by vite.config.ts: release tag (e.g. v0.3.7) or a git description. */
declare const __FAMILYHUB_VERSION__: string;

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
