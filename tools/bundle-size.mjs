// Sum each independently gzipped production JS/CSS file, including lazy chunks.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../apps/web/dist/', import.meta.url));
let raw = 0, compressed = 0, files = 0;
async function walk(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.(js|css)$/.test(entry.name)) {
      const data = await readFile(path), size = gzipSync(data, { level: 9 }).length;
      raw += data.length; compressed += size; files++;
      console.log(`${relative(root, path)}: ${data.length} bytes; gzip ${size} bytes`);
    }
  }
}
await walk(root);
if (!files) throw new Error('No JS/CSS found; run pnpm build:web first');
console.log(`TOTAL JS+CSS: ${raw} bytes raw; ${compressed} bytes gzip (${(compressed / 1024).toFixed(2)} KiB), ${files} files; game assets excluded.`);
