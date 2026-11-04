// Family Hub version for display (e.g. "v0.3.7"). Code run outside Vite (unit
// tests) has no injected value and reports "dev".
export const FAMILYHUB_VERSION: string =
    typeof __FAMILYHUB_VERSION__ === 'string' && __FAMILYHUB_VERSION__ ? __FAMILYHUB_VERSION__ : 'dev';

export const familyHubVersionLabel = `Family Hub ${FAMILYHUB_VERSION}`;
