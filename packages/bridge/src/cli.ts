// AGPL-3.0-or-later. See ../../../LICENSE.
import { startBridge } from './index.js';

function port(value: string | undefined, fallback: number): number {
  const result = Number(value ?? fallback);
  if (!Number.isInteger(result) || result < 1 || result > 65535) throw new Error('Invalid port');
  return result;
}
async function main(): Promise<void> {
  const bridge = await startBridge({
    host: process.env.AO_WS_HOST ?? '127.0.0.1', port: port(process.env.AO_WS_PORT, 7667),
    tcpHost: process.env.AO_TCP_HOST ?? '127.0.0.1', tcpPort: port(process.env.AO_TCP_PORT, 7666),
    log: message => console.log(`[bridge] ${message}`),
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void bridge.close().catch(console.error); });
  }
}
main().catch(error => { console.error(`[bridge] ${String(error)}`); process.exitCode = 1; });
