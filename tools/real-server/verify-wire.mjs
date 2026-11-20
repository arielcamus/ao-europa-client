// AGPL-3.0-or-later. Consume actual adapter output with the production client codec.
import assert from 'node:assert/strict';
import { FrameDecoder, decodeServerPacket, encodeServerFrame } from '../../packages/protocol/dist/index.js';

const rows = JSON.parse(process.argv[2]);
const wire = Buffer.concat(rows.map(row => Buffer.from(row.hex, 'hex')));
for (const chunks of [[wire], [...wire].map(byte => Uint8Array.of(byte))]) {
  const framing = new FrameDecoder();
  const packets = chunks.flatMap(chunk => framing.push(chunk));
  framing.finish();
  assert.equal(packets.length, rows.length);
  packets.forEach((body, index) => {
    const packet = decodeServerPacket(body); // Rejects missing or trailing fields.
    assert.ok(!packet.unknown, rows[index].name);
    assert.equal(Buffer.from(encodeServerFrame(packet)).toString('hex'), rows[index].hex.toLowerCase());
  });
}
console.log(`${rows.length}/${rows.length} adapter packet types decoded exactly (coalesced and byte-at-a-time).`);
