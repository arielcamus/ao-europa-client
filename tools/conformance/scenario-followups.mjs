// Follow-ups scenario (#43, #44): GM-driven recordings on the pinned pre-HOO server. Aotest is an Admin (Server.ini).
// AO_FU_STEP=dumb    /ESTUPIDO <self> -> Dumb (29), /NOESTUPIDO <self> -> DumbNoMore (HandleMakeDumb / HandleMakeDumbNoMore).
// AO_FU_STEP=trainer /ACC 649 (Entrenador, NpcType 3), LeftClick on it, TrainList (46) -> TrainerCreatureList; then /RMATA on it.
// AO_FU_STEP=travel  /ACC 301 (NpcType 10 = Pirata, "VIAJES"), LeftClick on it -> ViajarForm; then /RMATA on it.
// Only the NPC spawned in this run is clicked and removed (its charIndex comes from the CharacterCreate with that npcNumber).
// AO_FU_STEP=cleanup AO_FU_TARGET=<charIndex>,<x>,<y>: /RMATA on an NPC a failed run of this scenario left behind.
import { decodeServerPacket } from '../../packages/protocol/dist/index.js';
import { i32, str } from './wire.mjs';
const i16 = n => { const b = Buffer.alloc(2); b.writeInt16LE(n); return [...b]; };

export default async function run(rec) {
  const step = process.env.AO_FU_STEP ?? 'dumb', self = process.env.AO_CHAR;
  let leftClick = 0;
  const decoded = () => rec.records.filter(r => r.dir === 's2c').map(r => ({ r, p: decodeServerPacket(Buffer.from(r.hex, 'hex')) }));
  rec.mark = rec.records.length;
  if (step === 'dumb') {
    rec.send(161, str(self)); await rec.wait(r => r.name === 'Dumb', 5000); await rec.sleep(1500);
    rec.send(162, str(self)); await rec.wait(r => r.name === 'DumbNoMore', 5000); await rec.sleep(800);
    return;
  }
  // LookatTile tries the tile BELOW the click first (users, then NPCs), so the NPC is selected by clicking one tile above it.
  const select = async (x, y) => { rec.send(95, [x, y - 1, ...i32(++leftClick)]); await rec.sleep(1800); };
  if (step === 'cleanup') { // AO_FU_TARGET=charIndex,x,y of an NPC this agent spawned and failed to remove
    const [charIndex, x, y] = process.env.AO_FU_TARGET.split(',').map(Number);
    await select(x, y); rec.send(121);
    await rec.wait(r => r.name === 'CharacterRemove' && decodeServerPacket(Buffer.from(r.hex, 'hex')).charIndex === charIndex, 5000).then(() => console.log('removed', charIndex)).catch(() => console.log('REMOVE NOT SEEN for', charIndex));
    return;
  }
  const npcNumber = step === 'trainer' ? 649 : 301;
  const before = rec.records.length;
  rec.send(181, i16(npcNumber));
  await rec.wait(r => r.name === 'CharacterCreate' && rec.records.indexOf(r) >= before && decodeServerPacket(Buffer.from(r.hex, 'hex')).npcNumber === npcNumber, 5000);
  const spawned = decoded().filter(({ r }) => rec.records.indexOf(r) >= before).map(({ p }) => p).find(p => p.id === 42 && p.npcNumber === npcNumber);
  console.log('spawned', npcNumber, 'charIndex', spawned.charIndex, 'at', spawned.x, spawned.y);
  await rec.sleep(1200);
  const click = () => select(spawned.x, spawned.y);
  try {
    await click();
    if (step === 'trainer') { rec.send(46); await rec.wait(r => r.name === 'TrainerCreatureList', 5000).catch(() => console.log('no TrainerCreatureList')); }
    else {
      // HandleLeftClick runs the world action (HandleNpcInteractionByType) only when no USER is on the clicked tile or the one below it,
      // and on the exact NPC tile: /ACC put the NPC right above us, so step west first, then click the NPC's own tile.
      rec.send(78, [4, ...i32(1)]); await rec.sleep(900);
      rec.send(95, [spawned.x, spawned.y, ...i32(++leftClick)]);
      await rec.wait(r => r.name === 'ViajarForm', 5000).catch(() => console.log('no ViajarForm')); await rec.sleep(1800);
    }
    await rec.sleep(800);
  } finally {
    // Remove exactly the NPC this run spawned: select it, then /RMATA.
    await click(); rec.send(121);
    await rec.wait(r => r.name === 'CharacterRemove' && decodeServerPacket(Buffer.from(r.hex, 'hex')).charIndex === spawned.charIndex, 5000).catch(() => console.log('REMOVE NOT SEEN for', spawned.charIndex));
    await rec.sleep(500);
  }
  console.log('replies', [...new Set(rec.records.slice(rec.mark).filter(r => r.dir === 's2c').map(r => r.name))].join(' '));
}
