import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { assetMiddleware } from './dev/assets.js';

const here = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root: here,
  publicDir: false,
  resolve: { alias: {
    '@ao/protocol': resolve(here, '../../packages/protocol/src/index.ts'),
    '@ao/formats': resolve(here, '../../packages/formats/src/index.ts'),
  } },
  plugins: [{
    name: 'ao-local-readonly-assets',
    configureServer(server) {
      server.middlewares.use(assetMiddleware(process.env.AO_ASSETS ?? resolve(homedir(), 'Projects/ao-reference/Recursos')));
    },
    // Explicit local preview convenience; still serves originals, never bundles them.
    configurePreviewServer(server) {
      server.middlewares.use(assetMiddleware(process.env.AO_ASSETS ?? resolve(homedir(), 'Projects/ao-reference/Recursos')));
    },
  }],
  server: {
    host: process.env.AO_WEB_HOST ?? '127.0.0.1',
    port: Number(process.env.AO_WEB_PORT ?? 5173), strictPort: true,
    proxy: { '/bridge': { target: process.env.AO_BRIDGE_TARGET ?? 'ws://127.0.0.1:7667', ws: true } },
  },
  preview: {
    host: process.env.AO_WEB_HOST ?? '127.0.0.1',
    port: Number(process.env.AO_WEB_PORT ?? 5173), strictPort: true,
    proxy: { '/bridge': { target: process.env.AO_BRIDGE_TARGET ?? 'ws://127.0.0.1:7667', ws: true } },
  },
  build: { target: 'es2022', assetsDir: 'static', sourcemap: false },
});
