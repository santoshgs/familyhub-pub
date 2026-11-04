import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    test: {
        include: ['test/familyhub/local.test.ts', 'test/familyhub/googleRoutes.test.ts'],
        setupFiles: ['test/setupEnv.ts'],
        environment: 'node',
        // All cases use the same disposable PostgreSQL database.
        fileParallelism: false,
        testTimeout: 20_000,
        hookTimeout: 30_000,
    },
});
