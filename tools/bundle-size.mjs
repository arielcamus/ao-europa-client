// Reproducible sum of every emitted chunk, including lazy imports. No artwork.
import { readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
const root = new URL('../apps/web/dist/', import.meta.url);
const files = await readdir(root, { recursive: true });
const result = {};
for (const extension of ['js', 'css', 'html']) {
  const paths = files.filter(path => path.endsWith(`.${extension}`));
  let raw = 0, gzip = 0;
  for (const path of paths) {
    const bytes = await readFile(new URL(path, root));
    raw += bytes.length; gzip += gzipSync(bytes, { level: 9 }).length;
  }
  result[extension] = { files: paths.length, raw, gzip };
}
console.log(JSON.stringify({ ...result, compression: 'gzip level 9', artwork: 'excluded; loaded from AO_ASSETS' }, null, 2));
