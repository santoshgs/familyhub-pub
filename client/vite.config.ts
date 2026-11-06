import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { execFileSync } from 'child_process';

// Family Hub version shown on the display and management pages. Release images
// pass the tag (familyhub-vX.Y.Z) as VITE_FAMILYHUB_VERSION; local builds describe
// the checkout (e.g. v0.3.6-7-gdf77f8b on develop) and fall back to 'dev'.
const resolveFamilyHubVersion = (): string => {
    let version = process.env.VITE_FAMILYHUB_VERSION?.trim();
    if (!version) {
        try {
            version = execFileSync('git', ['describe', '--tags', '--match', 'familyhub-v*', '--dirty'], {
                cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
        } catch {
            version = '';
        }
    }
    return version ? version.replace(/^familyhub-/, '') : 'dev';
};

// Build variants:
//  - default  → the web app (PWA enabled, base '/' or VITE_FAMILYHUB_BASE).
//  - demo     → static demo (VITE_DEMO=true, sub-path base, no SW). The base
//               defaults to the GitHub Pages path; set VITE_DEMO_BASE to build
//               the demo for another host (e.g. '/demo/' for openfamily.fr).
export default defineConfig(() => {
    const isDemo = process.env.VITE_DEMO === 'true';
    const isFamilyHub = (process.env.VITE_FAMILYHUB === 'true' && isDemo) || process.env.VITE_FAMILYHUB_LOCAL === 'true';
    const usePwa = !isDemo;

    return {
        define: {
            __FAMILYHUB_VERSION__: JSON.stringify(resolveFamilyHubVersion()),
        },
        // VITE_FAMILYHUB_BASE serves the local develop build under a sub-path (for example /develop/).
        base: isDemo ? (process.env.VITE_DEMO_BASE || '/OpenFamily/demo/') : (process.env.VITE_FAMILYHUB_BASE || '/'),
        // iPhone/iPad Safari and the photo frame's Android System WebView 104
        // (Chromium 104): syntax and CSS are lowered for both. Real iPhone/iPad
        // verification remains required.
        ...(isFamilyHub ? {
            build: { target: ['safari15.4', 'chrome104'], cssTarget: ['safari15.4', 'chrome104'] },
        } : {}),
        plugins: [
            ...(isFamilyHub ? [{
                name: 'familyhub-prototype-document',
                transformIndexHtml: (html: string) => html
                    .replace('<html lang="fr">', '<html lang="en">')
                    .replace('width=device-width, initial-scale=1.0', 'width=device-width, initial-scale=1.0, viewport-fit=cover')
                    .replace('<title>OpenFamily - Gestion familiale</title>', '<title>Family Hub · A little more together</title>')
                    .replace('content="Application open source pour gérer la vie de famille"', 'content="Family Hub — a little more together, built on OpenFamily."')
                    .replace('content="#3B82F6"', 'content="#f7f8f2"'),
            }] : []),
            react(),
            ...(usePwa ? [VitePWA({
                registerType: 'autoUpdate',
                strategies: 'injectManifest',
                srcDir: 'src',
                filename: 'sw.js',
                includeAssets: ['favicon-32x32.png', 'favicon-16x16.png', 'apple-touch-icon.png', 'OpenFamily.png'],
                manifest: {
                    name: 'OpenFamily',
                    short_name: 'OpenFamily',
                    description: 'Application de gestion familiale',
                    theme_color: '#DC4A60',
                    background_color: '#F7F2E9',
                    display: 'standalone',
                    icons: [
                        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
                    ],
                },
                devOptions: { enabled: false },
            })] : []),
        ],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src'),
            },
        },
        server: {
            host: process.env.VITE_FAMILYHUB_LOCAL === 'true' ? '127.0.0.1' : undefined,
            port: process.env.VITE_FAMILYHUB_LOCAL === 'true' ? 5174 : 5173,
            strictPort: process.env.VITE_FAMILYHUB_LOCAL === 'true',
            proxy: {
                '/api': {
                    target: process.env.VITE_API_URL || 'http://localhost:3001',
                    changeOrigin: true,
                },
            },
        },
    };
});
