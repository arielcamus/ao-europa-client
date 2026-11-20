// AGPL-3.0-or-later. One process owns all three listeners and closes them on exit.
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, preview } from 'vite';
import { startStandin, loadWorld } from './standin-server/dist/index.js';
import { startBridge } from '../packages/bridge/dist/index.js';

const resources = [];
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  for (const close of resources.reverse()) {
    try { await close(); } catch (error) { console.error(error); process.exitCode = 1; }
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop(); });
try {
  const assetRoot = process.env.AO_ASSETS ?? resolve(homedir(), 'Projects/ao-reference/Recursos');
  process.env.AO_ASSETS = assetRoot;
  const world = await loadWorld(assetRoot, Number(process.env.AO_MAP_ID ?? 1));
  const standin = await startStandin({
    world, debugging: process.env.AO_STANDIN_DEBUG === '1',
    rejectWalks: process.env.AO_STANDIN_REJECT_WALKS === '1',
    log: message => { if (process.env.AO_VERBOSE === '1' || message.startsWith('real map')) console.log(`[STAND-IN] ${message}`); },
  });
  resources.push(() => standin.close());
  const bridge = await startBridge({ tcpHost: standin.host, tcpPort: standin.port });
  resources.push(() => bridge.close());
  process.env.AO_BRIDGE_TARGET = `ws://${bridge.host}:${bridge.port}`;
  const configFile = fileURLToPath(new URL('../apps/web/vite.config.ts', import.meta.url));
  if (process.argv.includes('--preview')) {
    const server = await preview({ configFile });
    resources.push(() => new Promise((resolve, reject) => {
      server.httpServer.closeAllConnections();
      server.httpServer.close(error => error ? reject(error) : resolve());
    }));
    server.printUrls();
  } else {
    const server = await createServer({ configFile });
    resources.push(() => server.close());
    await server.listen();
    server.printUrls();
  }
  console.log('TEST STAND-IN, not the AO game server. Login: standin@local / testpass');
  console.log(`Read-only /assets -> ${assetRoot}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  await stop();
}
