// NPC / character scenario for tools/conformance/vb6-record.mjs (replaces the old tools/npcs-record.mjs).
// Usage: AO_NPCS_SCRIPT="wait:3000,walk:2,click-npc,click:50,40,say:hola" AO_EMAIL=.. AO_PASSWORD=.. AO_CHAR_ID=.. AO_CHAR=.. \
//          node tools/conformance/vb6-record.mjs tools/conformance/scenario-npcs.mjs tests/fixtures/vb6/npcs/<scenario>.jsonl
// Steps: wait:<ms> | walk:<heading 1-4> | click:<x>,<y> | click-npc | click-self | click-player | click-empty | say:<text>
import { ClientPacketId as C, DoorClientPacketId, decodeServerPacket, encodeClientFrame } from '../../packages/protocol/dist/index.js';

const payload = packet => encodeClientFrame(packet).subarray(4); // length (2) and id (2) are added by the recorder
export default async function run(rec) {
  const script = (process.env.AO_NPCS_SCRIPT ?? 'wait:8000').split(',').reduce((steps, part) => {
    // "click:50,40" contains a comma: glue a bare number back onto the previous click.
    if (/^\d+$/.test(part) && steps.at(-1)?.startsWith('click:')) steps[steps.length - 1] += `,${part}`; else steps.push(part);
    return steps;
  }, []);
  const chars = new Map();
  let selfIndex, selfPos, walkInterval = 300, walk = 0, click = 0, talk = 0, seen = 0;
  const sync = () => {
    for (const r of rec.records.slice(seen)) {
      if (r.dir !== 's2c') continue;
      const packet = decodeServerPacket(Buffer.from(r.hex, 'hex'));
      if ('unknown' in packet) continue;
      if (packet.id === 158) walkInterval = packet.walk;
      else if (packet.id === 42) { chars.set(packet.charIndex, packet); if (packet.charIndex === selfIndex) selfPos = packet; }
      else if (packet.id === 43) chars.delete(packet.charIndex);
      else if (packet.id === 44 || packet.id === 187) { const c = chars.get(packet.charIndex); if (c) { c.x = packet.x; c.y = packet.y; } if (packet.charIndex === selfIndex) selfPos = chars.get(selfIndex) ?? packet; }
      else if (packet.id === 47) { selfIndex = packet.charIndex; selfPos = chars.get(selfIndex); }
      else if (packet.id === 31) selfPos = { x: packet.x, y: packet.y };
      else if (packet.id === 30) chars.clear();
    }
    seen = rec.records.length;
  };
  for (const step of script) {
    sync();
    const cut = step.indexOf(':'), name = cut < 0 ? step : step.slice(0, cut), rest = cut < 0 ? '' : step.slice(cut + 1);
    if (name === 'wait') await rec.sleep(Number(rest));
    else if (name === 'walk') { rec.send(C.Walk, payload({ id: C.Walk, heading: Number(rest), counter: ++walk })); rec.send(C.RequestPositionUpdate); await rec.sleep(walkInterval + 80); }
    else if (name === 'say') { rec.send(C.Talk, payload({ id: C.Talk, message: rest, counter: ++talk })); await rec.sleep(700); }
    else if (name.startsWith('click')) {
      const [x, y] = rest.split(',').map(Number);
      const near = filter => [...chars.values()].filter(c => c.charIndex !== selfIndex && filter(c))
        .sort((a, b) => Math.hypot(a.x - selfPos.x, a.y - selfPos.y) - Math.hypot(b.x - selfPos.x, b.y - selfPos.y))[0];
      const target = name === 'click-npc' ? near(c => c.npc > 0) : name === 'click-player' ? near(c => c.npc === 0)
        : name === 'click-self' ? chars.get(selfIndex) : name === 'click-empty' ? { x: selfPos.x + 5, y: selfPos.y + 5 } : { x, y };
      if (!target) { console.log(`${step}: nobody to click`); continue; }
      console.log(`${step} -> ${target.x},${target.y} ${target.name ?? ''}`);
      rec.send(DoorClientPacketId.LeftClick, payload({ id: DoorClientPacketId.LeftClick, x: target.x, y: target.y, counter: ++click }));
      await rec.sleep(1700);
    }
  }
  await rec.sleep(1500);
}
