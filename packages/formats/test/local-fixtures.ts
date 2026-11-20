// Test-only excerpts, assembled in memory from AO_ASSETS. Never written or committed.
// Independent Buffer offset arithmetic intentionally does not call the production parser.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function mapExcerpt(root: string) {
  const bytes = readFileSync(join(root, 'Mapas/mapa1.csm'));
  const modern = bytes.readUInt32LE(0) === 0x324c3557;
  const prefix = modern ? 4 : 0, headerSize = modern ? 52 : 44;
  const counts = Array.from({ length: modern ? 12 : 11 }, (_, i) => bytes.readInt32LE(prefix + i * 4));
  let pos = headerSize + 8;
  const string = () => { const n = bytes.readUInt16LE(pos); pos += 2 + n; };
  string(); pos++; string(); pos += 9;
  string(); string(); string(); pos += 16; string(); pos += 3;
  const metadataEnd = pos;
  // Physical section order: blocks, layers, triggers, particles, lights, objects, NPCs, exits.
  const layers = modern ? 5 : 4, base = 1 + layers;
  const sections = [0, ...Array.from({ length: layers }, (_, i) => i + 1), base, base + 2, base + 1, base + 4, base + 3, base + 5];
  const widths = [5, ...Array<number>(layers).fill(8), 6, 8, 9, 8, 6, 10];
  const header = Buffer.from(bytes.subarray(0, headerSize));
  const parts: Buffer[] = [header, bytes.subarray(headerSize, metadataEnd)];
  const records: Buffer[] = [];
  for (const [n, section] of sections.entries()) {
    const count = counts[section]!, size = widths[n]!;
    const sample = bytes.subarray(pos, pos + Math.min(3, count) * size);
    records.push(sample);
    parts.push(sample);
    header.writeInt32LE(Math.min(3, count), prefix + section * 4);
    pos += count * size;
  }
  return { bytes: Buffer.concat(parts), records, headerSize, metadataEnd, modern };
}

export function graphicsExcerpt(root: string) {
  const bytes = readFileSync(join(root, 'init/graficos.ind'));
  const records = new Map<number, Buffer>();
  let animation: Buffer | undefined;
  for (let p = 8; p < bytes.length;) {
    const id = bytes.readInt32LE(p), count = bytes.readInt16LE(p + 4);
    const end = p + 6 + (count === 1 ? 12 : count * 4 + 4);
    const record = bytes.subarray(p, end);
    records.set(id, record);
    if (count > 1 && !animation) animation = record;
    p = end;
  }
  if (!animation) throw new Error('No real animation found');
  const count = animation.readInt16LE(4);
  const ids = Array.from({ length: count }, (_, i) => animation.readInt32LE(6 + 4 * i));
  return {
    bytes: Buffer.concat([bytes.subarray(0, 8), ...[...new Set(ids)].map(id => records.get(id)!), animation]),
    animation, first: records.get(ids[0]!)!, ids,
  };
}
