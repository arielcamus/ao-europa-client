// AGPL-3.0-or-later. Offline stand-in for the npcs feature ONLY (NOT the VB6 oracle): a TCP server that
// logs one account in, then shows a priest NPC, a player with a weapon/shield/helmet that walks back and
// forth and talks, and answers left clicks the way the VB6 LookatTile does. Use when the VB6 server is down.
// Usage: AO_MOCK_PORT=7716 node tools/npcs-mock-server.mjs
import net from 'node:net';
import { applyWireProfileFromEnv, FrameDecoder, decodeClientPacket, encodeServerFrame, ServerPacketId as S, NpcsServerPacketId as N } from '../packages/protocol/dist/index.js';

applyWireProfileFromEnv(process.env);
const port = Number(process.env.AO_MOCK_PORT ?? 7716);
const base = { cart: 0, backpack: 0, fx: 0, fxLoops: 0, particleFx: 0, headAura: '', weaponAura: '', bodyAura: '', damageAura: '', resistanceAura: '', otherAura: '', shieldAura: '',
  speeding: 1, appear: 0, groupIndex: 0, clanIndex: 0, clanLevel: 0, minHp: 100, maxHp: 100, minMana: 0, maxMana: 0, symbol: 0, flags: 1, userType: 0, team: 0, flag: 0, clanAlignment: 0, privileges: 0 };
const char = (charIndex, name, x, y, extra) => ({ id: S.CharacterCreate, charIndex, name, x, y, heading: 3, weapon: 0, shield: 0, helmet: 0, status: 1, npc: 0, npcNumber: 0, ...base, ...extra });
const me = char(1, 'TNpcs', 58, 44, { body: 107, head: 1 });
const priest = char(20, 'Sacerdote', 60, 42, { body: 117, head: 3, npc: 1, npcNumber: 1 });
const mage = char(30, 'Mock Mage <Los Pibes>', 55, 46, { body: 107, head: 7, weapon: 11, shield: 2, helmet: 3, status: 1 });
const criminal = char(31, 'Mock Rogue', 62, 47, { body: 107, head: 12, weapon: 3, status: 0 });
const sendAll = (socket, ...packets) => packets.forEach(packet => socket.write(encodeServerFrame(packet)));
const frame = (id, build) => ({ id, ...build });

net.createServer(socket => {
  const decoder = new FrameDecoder(); let stage = 0; const timers = [];
  sendAll(socket, { id: S.Connected, debugging: true });
  let mageX = 55, dir = 1;
  const start = () => {
    sendAll(socket, { id: S.Intervals, hit: 1000, bow: 1000, magic: 1000, extractWork: 1000, buildWork: 1000, walk: 300, dropItem: 100, useItemKey: 100, useItemClick: 100, hitMagic: 1000, magicHit: 1000, hitUseItem: 1000, hide: 1000, talk: 500, leftClick: 100, meditate: 100 },
      { id: S.ChangeMap, map: 1, resourceMap: 1 }, me, priest, mage, criminal, { id: S.UserCharIndexInServer, charIndex: 1 }, { id: S.Logged, newUser: false });
    timers.push(setInterval(() => {
      mageX += dir; if (mageX > 59) dir = -1; if (mageX < 55) dir = 1;
      sendAll(socket, { id: S.CharacterMove, charIndex: 30, x: mageX, y: 46 });
    }, 700));
    timers.push(setTimeout(() => sendAll(socket, { id: N.ChatOverHead, chat: 'Hola, buenas!', charIndex: 30, color: 0xffffff, isSpell: false, x: 0, y: 0, minChatTime: 0, maxChatTime: 0 }), 3000));
    timers.push(setTimeout(() => sendAll(socket, { id: N.CharacterChange, charIndex: 31, flags: 0, body: 107, head: 12, heading: 4, weapon: 7, shield: 0, helmet: 4, cart: 0, backpack: 0, fx: 0, fxLoops: 0 }), 6000));
    timers.push(setTimeout(() => sendAll(socket, { id: N.CharacterRemove, charIndex: 31, vanish: false, warp: false }), 12000));
  };
  socket.on('data', bytes => {
    for (const body of decoder.push(new Uint8Array(bytes))) {
      const packet = decodeClientPacket(body);
      if (packet.id === 305) sendAll(socket, { id: S.AccountCharacterList, characters: [{ id: 1, name: 'TNpcs', body: 107, head: 1, characterClass: 3, map: 1, x: 58, y: 44, level: 1, status: 1, helmet: 0, shield: 0, weapon: 0, backpack: 0 }] });
      else if (packet.id === 73 && !stage++) start();
      else if (packet.id === 95) {
        const hit = [priest, mage, criminal, me].find(c => c.x === packet.x && (c.y === packet.y || c.y === packet.y + 1));
        if (!hit) sendAll(socket, { id: N.LocaleMsg, messageId: 1106, text: '', font: 3, channel: 0 });
        else if (hit.npc) sendAll(socket, { id: N.ChatOverHead, chat: `NPCDESC*${hit.npcNumber}`, charIndex: hit.charIndex, color: 0xffffff, isSpell: false, x: me.x, y: me.y, // receiver's position, like WriteChatOverHead
           minChatTime: 0, maxChatTime: 0 });
        else {
          const nick = hit.name.split(' <')[0], guild = hit.name.includes('<') ? 'Los Pibes' : '';
          sendAll(socket, { id: N.LocaleMsg, messageId: 1105, text: `${nick}---${guild}--3-1-20-\u00ac0\u00ac0`, font: 3, channel: 0 });
        }
      }
    }
  });
  socket.on('close', () => timers.forEach(t => { clearInterval(t); clearTimeout(t); }));
  socket.on('error', () => {});
}).listen(port, '127.0.0.1', () => console.log(`npcs mock server (NOT the VB6 oracle) on 127.0.0.1:${port}`));
