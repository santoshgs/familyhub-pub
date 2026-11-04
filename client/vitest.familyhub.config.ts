import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: { include: ['client/src/familyhub/**/*.test.ts'], environment: 'node' },
});
