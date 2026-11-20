// AGPL-3.0-or-later. Offline stand-in for the crafting windows ONLY (NOT the VB6 oracle): a level-1 character cannot open the smith or
// carpenter forms on the real server (no hammer, no saw, no skill), so this TCP server logs one account in and answers LeftClick
// with the packets the VB6 server writes (WriteBlacksmithWeapons/Armors/ExtraObjects + WriteShowBlacksmithForm, WriteCarpenterObjects +
// WriteShowCarpenterForm), using the real object lists from Dat/*.dat. A click on a tile with x < 37 opens the smith, x >= 37 the carpenter.
// Usage: AO_ASSETS=<Recursos> AO_MOCK_PORT=7750 node tools/crafting-mock-server.mjs
import net from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FrameDecoder, decodeClientPacket, encodeServerFrame, ServerPacketId as S, CraftingServerPacketId as CS } from '../packages/protocol/dist/index.js';

const port = Number(process.env.AO_MOCK_PORT ?? 7750);
const dat = file => [...readFileSync(path.join(process.env.AO_ASSETS ?? path.join(process.env.HOME, 'Projects/ao-reference/Recursos'), 'Dat', file), 'latin1').matchAll(/^Index=(\d+)/gm)].map(m => Number(m[1]));
const lists = { weapons: dat('ArmasHerrero.dat'), armors: dat('ArmadurasHerrero.dat'), runes: dat('BlackSmithElementalRunes.dat'), carpenter: dat('ObjCarpintero.dat') };
const base = { cart: 0, backpack: 0, fx: 0, fxLoops: 0, particleFx: 0, headAura: '', weaponAura: '', bodyAura: '', damageAura: '', resistanceAura: '', otherAura: '', shieldAura: '',
  speeding: 1, appear: 0, groupIndex: 0, clanIndex: 0, clanLevel: 0, minHp: 20, maxHp: 20, minMana: 0, maxMana: 0, symbol: 0, flags: 1, userType: 0, team: 0, flag: 0, clanAlignment: 0, privileges: 0 };
const me = { id: S.CharacterCreate, charIndex: 1, name: 'TCraft', x: 36, y: 66, heading: 3, weapon: 0, shield: 0, helmet: 0, status: 1, npc: 0, npcNumber: 0, body: 107, head: 1, ...base };
const sendAll = (socket, ...packets) => packets.forEach(packet => socket.write(encodeServerFrame(packet)));

net.createServer(socket => {
  const decoder = new FrameDecoder(); let started = false;
  sendAll(socket, { id: S.Connected, debugging: true });
  socket.on('data', bytes => {
    for (const body of decoder.push(new Uint8Array(bytes))) {
      const packet = decodeClientPacket(body);
      if (packet.id === 305) sendAll(socket, { id: S.AccountCharacterList, characters: [{ id: 1, name: 'TCraft', body: 107, head: 1, characterClass: 3, map: 1, x: 36, y: 66, level: 1, status: 1, helmet: 0, shield: 0, weapon: 0, backpack: 0 }] });
      else if (packet.id === 73 && !started) {
        started = true;
        sendAll(socket, { id: S.Intervals, hit: 1000, bow: 1000, magic: 1000, extractWork: 1000, buildWork: 1000, walk: 300, dropItem: 100, useItemKey: 100, useItemClick: 100, hitMagic: 1000, magicHit: 1000, hitUseItem: 1000, hide: 1000, talk: 500, leftClick: 100, meditate: 100 },
          { id: S.ChangeMap, map: 1, resourceMap: 1 }, me, { id: S.UserCharIndexInServer, charIndex: 1 }, { id: S.UpdateSta, stamina: 60 }, { id: S.Logged, newUser: false });
      } else if (packet.id === 95) {
        if (packet.x < 37) sendAll(socket, { id: CS.BlacksmithWeapons, objects: lists.weapons }, { id: CS.BlacksmithArmors, objects: lists.armors }, { id: CS.BlacksmithExtraObjects, objects: lists.runes }, { id: CS.ShowBlacksmithForm });
        else sendAll(socket, { id: CS.CarpenterObjects, objects: lists.carpenter }, { id: CS.ShowCarpenterForm });
      } else if ([100, 1, 229].includes(packet.id)) console.log('client sent', JSON.stringify(packet));
    }
  });
  socket.on('error', () => {});
}).listen(port, '127.0.0.1', () => console.log(`crafting mock server (NOT the VB6 oracle) on 127.0.0.1:${port}`));
