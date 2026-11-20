// TEST STAND-IN runner. Real target: ao-org VB6 server. AGPL-3.0-or-later.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startStandin } from './standin-server/dist/index.js';

const standin = await startStandin({
  debugging: process.env.AO_STANDIN_DEBUG !== '0',
  rejectWalks: process.env.AO_STANDIN_REJECT_WALKS === '1',
  log: message => console.log(`[STAND-IN] ${message}`),
});
let child;
let interrupted = false;
const stop = () => { interrupted = true; child?.kill('SIGTERM'); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  child = spawn(process.execPath, [fileURLToPath(new URL('../apps/bot/dist/cli.js', import.meta.url))], {
    stdio: 'inherit',
    env: { ...process.env, AO_HOST: standin.host, AO_PORT: String(standin.port), AO_EMAIL: 'standin@local', AO_PASSWORD: 'testpass' },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(interrupted ? 130 : code ?? 1));
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  await standin.close();
}
