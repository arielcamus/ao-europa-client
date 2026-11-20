// AGPL-3.0-or-later. See ../../../LICENSE.
import { runBot } from './index.js';

async function main(): Promise<void> {
  const email = process.env.AO_EMAIL;
  const password = process.env.AO_PASSWORD;
  const port = Number(process.env.AO_PORT ?? 7666);
  if (!email || !password) throw new Error('Set AO_EMAIL and AO_PASSWORD (or run pnpm bot:standin)');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid AO_PORT');
  const result = await runBot({
    host: process.env.AO_HOST ?? '127.0.0.1', port, email, password,
    observationMs: 30_000,
    log: message => console.log(`[bot ${new Date().toISOString()}] ${message}`),
  });
  if (result.connectedMs < 30_000 || result.confirmedWalks + result.inferredWalks < 1) {
    throw new Error('30-second connection / accepted-walk success condition not met');
  }
}
main().catch(error => { console.error(`[bot] FAILED: ${String(error)}`); process.exitCode = 1; });
