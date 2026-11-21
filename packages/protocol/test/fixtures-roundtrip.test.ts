import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { decodeClientPacket, decodeServerPacket, encodeClientPacket, encodeServerPacket, getWireProfile, setWireProfile } from '../src/index.js';

// docs/CONFORMANCE.md: `hex` is the full frame body, the 2-byte LE id included. Every known packet must re-encode byte for byte.
const root = fileURLToPath(new URL('../../../tests/fixtures/vb6', import.meta.url));
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : name.endsWith('.jsonl') ? [path] : [];
});
const files = walk(root);
// The recorder stores LoginAccount (305) and CreateAccount (304) as the bare id: credentials never reach a fixture.
const REDACTED = new Set([304, 305]);

describe('VB6 fixture round-trip (all tests/fixtures/vb6/**)', () => {
  // tests/fixtures/vb6/playthrough/ was recorded on the pre-HOO 9ccd server: re-encode it under that wire profile ('live', the default, re-appends
  // the HOO-era clanAlignment byte to NPC CharacterCreate, issue #70). Older fixtures were recorded on the HOO-era server and keep 'live'.
  // Single files recorded on the 9ccd server outside playthrough/ (same reason).
  const PREHOO_FILES = new Set(['audio/invisible-walker-steps.jsonl', 'audio/force-midi-map.jsonl']);
  const before = getWireProfile();
  // Folders recorded against the pinned pre-HOO server (9ccd7fad), whose layouts the 'prehoo' profile writes.
  const PREHOO_DIRS = ['playthrough', 'followups'];
  afterAll(() => setWireProfile(before));
  it('finds fixtures', () => { expect(files.length).toBeGreaterThan(0); });
  for (const file of files) {
    it(file.slice(root.length + 1), () => {
      setWireProfile(PREHOO_DIRS.some(dir => file.startsWith(join(root, dir) + '/')) || PREHOO_FILES.has(file.slice(root.length + 1)) ? 'prehoo' : before);
      const rows = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { dir: string; id: number; hex: string });
      let known = 0;
      for (const [index, row] of rows.entries()) {
        const body = Uint8Array.from(Buffer.from(row.hex, 'hex'));
        expect(Buffer.from(body).readInt16LE(0), `row ${index} hex must start with its id`).toBe(row.id);
        if (row.dir === 'c2s' && REDACTED.has(row.id)) { expect(row.hex, `row ${index} credentials must be redacted`).toHaveLength(4); continue; }
        const packet = row.dir === 's2c' ? decodeServerPacket(body) : decodeClientPacket(body);
        if ('unknown' in packet) continue;
        const again = row.dir === 's2c' ? encodeServerPacket(packet as never) : encodeClientPacket(packet as never);
        expect(Buffer.from(again).toString('hex'), `row ${index} id ${row.id}`).toBe(row.hex);
        known++;
      }
      expect(known).toBeGreaterThan(0);
    });
  }
});
