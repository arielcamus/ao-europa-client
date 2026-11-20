// TEST STAND-IN, not a game server. Real target: ao-org VB6 server. AGPL-3.0-or-later.
import { startStandin } from './index.js';

async function main(): Promise<void> {
  const port = Number(process.env.AO_PORT ?? 7666);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid AO_PORT');
  const standin = await startStandin({
    host: process.env.AO_HOST ?? '127.0.0.1', port,
    debugging: process.env.AO_STANDIN_DEBUG === '1',
    rejectWalks: process.env.AO_STANDIN_REJECT_WALKS === '1',
    email: process.env.AO_EMAIL ?? 'standin@local', password: process.env.AO_PASSWORD ?? 'testpass',
    log: message => console.log(`[STAND-IN] ${message}`),
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void standin.close().catch(console.error); });
  }
}
main().catch(error => { console.error(`[STAND-IN] ${String(error)}`); process.exitCode = 1; });
