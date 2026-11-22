// AGPL-3.0-or-later. Local-only launcher: browser + asset mount + WS/TCP bridge.
import { fileURLToPath } from 'node:url';
import { createServer, preview } from 'vite';
import { startBridge } from '../packages/bridge/dist/index.js';
import { parseWireProfile, setWireProfile } from '../packages/protocol/dist/index.js';
import { startStandin } from './standin-server/dist/index.js';
import { distDelivery, injectAssetVersion, localAssets } from './local-assets.mjs';
import { betaFromEnv, bugReportOptionsFromEnv, createBugReportHandler, pushPending } from './bug-reports.mjs';
import { execFileSync } from 'node:child_process';

const standinMode = process.argv.includes('--standin');
const previewMode = process.argv.includes('--preview');
const serverProfile = process.env.AO_SERVER_PROFILE ?? 'classic';
if (!['classic', 'elixir-classic'].includes(serverProfile)) throw new Error('Invalid AO_SERVER_PROFILE');
// Wire layout of the VB6 server (packages/protocol/src/profile.ts): the live one is the pinned pre-HOO build. The browser decodes with it
// (ao-config.json) and the stand-in encodes with it, so both ends agree. AO_WIRE_PROFILE=live for a HOO-era server.
const wireProfile = parseWireProfile(process.env.AO_WIRE_PROFILE ?? 'prehoo');
setWireProfile(wireProfile);
// The checked-out commit, for bug reports (ao-config.json `build`). play.sh rebuilds dist/ from this tree before starting.
const git = args => { try { return execFileSync('git', args, { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return undefined; } };
const build = { commit: git(['rev-parse', '--short=10', 'HEAD']), branch: git(['rev-parse', '--abbrev-ref', 'HEAD']), builtAt: new Date().toISOString() };
// POST /api/bug-report: the in-game bug reporter (docs/BUG-REPORTS.md). Reports land in AO_BUG_REPORT_DIR; GitHub only with a token.
const bugReports = bugReportOptionsFromEnv();
const bugReportHandler = createBugReportHandler(bugReports);
console.log(`Bug reports: ${bugReports.dir}${bugReports.github ? ` + GitHub issues in ${bugReports.github.repo}` : ' (local only; set AO_BUG_REPORT_GITHUB_TOKEN + AO_BUG_REPORT_GITHUB_REPO for issues)'}`);
// AO_BETA (on by default): the client's beta bug button and console line (apps/web/src/beta.ts), via ao-config.json `beta`.
const beta = betaFromEnv();
if (bugReports.github) void pushPending(bugReports).then(count => { if (count) console.log(`[bug-report] ${count} pending report(s) pushed to GitHub`); }, error => console.log(`[bug-report] GITHUB FAILED pushing pending reports: ${error instanceof Error ? error.message : String(error)}`));
const cleanup = [];
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const close of cleanup.reverse()) await close();
}
try {
  const assets = await localAssets(process.env.AO_ASSETS);
  const standin = standinMode ? await startStandin({ debugging: true, classicUi: true, rejectWalks: process.env.AO_STANDIN_REJECT_WALKS === '1', log: console.log }) : undefined;
  if (standin) cleanup.push(() => standin.close());
  const tcpPort = standin?.port ?? Number(process.env.AO_TCP_PORT ?? 7666);
  const bridge = await startBridge({ port: Number(process.env.AO_BRIDGE_PORT ?? 0), tcpHost: standin?.host ?? process.env.AO_TCP_HOST ?? '127.0.0.1', tcpPort, log: console.log });
  cleanup.push(() => bridge.close());
  const configure = server => {
    server.middlewares.use((request, response, next) => {
      if (request.url === '/ao-config.json') {
        // The resources are scanned again on page loads (local-assets.mjs refresh): a patch made while this server runs gets a new version.
        void assets.refresh().then(assetVersion => {
          response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify({ mode: standinMode ? 'standin' : 'classic', serverProfile, wireProfile, wsPath: '/bridge', assetVersion, build, beta }));
        }, next);
      } else next();
    });
    server.middlewares.use((request, response, next) => { void bugReportHandler(request, response, next); });
    server.middlewares.use(assets);
  };
  const settings = {
    host: process.env.AO_WEB_HOST ?? '127.0.0.1',
    port: Number(process.env.AO_WEB_PORT ?? 5173), strictPort: true,
    proxy: { '/bridge': { target: `ws://127.0.0.1:${bridge.port}`, ws: true } },
  };
  const options = {
    root: fileURLToPath(new URL('../apps/web', import.meta.url)), configFile: false,
    plugins: [{
      name: 'local-ao-resources', configureServer: configure,
      // The production bundle: compressed, the hashed files immutable, the page pinned to the asset version (#79).
      configurePreviewServer: server => { configure(server); server.middlewares.use(distDelivery(fileURLToPath(new URL('../apps/web/dist', import.meta.url)), () => assets.refresh())); },
      transformIndexHtml: async html => injectAssetVersion(html, await assets.refresh()),
    }],
    server: settings, preview: settings,
  };
  const web = previewMode ? await preview(options) : await createServer(options);
  cleanup.push(async () => {
    if ('close' in web) await web.close();
    else { web.httpServer.closeAllConnections(); await new Promise(resolve => web.httpServer.close(resolve)); }
  });
  if (!previewMode) await web.listen();
  console.log(standinMode ? 'TEST STAND-IN — movement fixture without collision rules.'
    : serverProfile === 'elixir-classic' ? 'AO COMMUNITY SERVER — lambdaclass/argentum with the classic adapter.'
    : 'Classic server target — verify interoperability with your configured server.');
  web.printUrls();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop().then(() => process.exit(0)); });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await stop(); process.exitCode = 1;
}
