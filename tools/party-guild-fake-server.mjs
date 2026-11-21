// AGPL-3.0-or-later. A scripted stand-in for the party and guild packets (NOT the VB6 oracle; the real recordings are in
// tests/fixtures/vb6/party). It replaces the page's WebSocket (Playwright routeWebSocket), logs one character in and answers the party and
// guild requests the way the VB6 server's writers shape them, so the forms can be exercised and photographed without a guild on the server.
// Usage: const fake = await installFakeServer(page, { role: 'none' | 'member' | 'leader' }); fake.received (decoded client packets), fake.send(packet).
import { applyWireProfileFromEnv, FrameDecoder, decodeClientPacket, encodeServerFrame, joinList, ServerPacketId as S, GuildServerPacketId as G, PartyServerPacketId as P, SpellServerPacketId as SP } from '../packages/protocol/dist/index.js';

applyWireProfileFromEnv(process.env); // AO_WIRE_PROFILE=prehoo|live
const base = { cart: 0, backpack: 0, fx: 0, fxLoops: 0, particleFx: 0, headAura: '', weaponAura: '', bodyAura: '', damageAura: '', resistanceAura: '', otherAura: '', shieldAura: '',
  speeding: 1, appear: 0, groupIndex: 0, clanIndex: 0, clanLevel: 0, minHp: 20, maxHp: 20, minMana: 0, maxMana: 0, symbol: 0, flags: 1, userType: 0, team: 0, flag: 0, clanAlignment: 0, privileges: 0 };
const character = (charIndex, name, x, y, head = 1) => ({ id: S.CharacterCreate, charIndex, name, x, y, heading: 3, body: 107, head, weapon: 0, shield: 0, helmet: 0, status: 1, npc: 0, npcNumber: 0, ...base });
const sep = (...items) => joinList(items);

export async function installFakeServer(page, { role = 'none', fixture = {} } = {}) {
  const state = { role, ...fixture };
  const received = [];
  let socket;
  const send = (...packets) => { for (const packet of packets) socket.send(Buffer.from(encodeServerFrame(packet))); };
  const answer = packet => {
    switch (packet.id) {
      case 305: send({ id: S.AccountCharacterList, characters: [{ id: 1, name: 'TGuild', body: 107, head: 1, characterClass: 3, map: 1, x: 56, y: 43, level: 1, status: 1, helmet: 0, shield: 0, weapon: 0, backpack: 0 }] }); break;
      case 73:
        send({ id: S.Intervals, hit: 1000, bow: 1000, magic: 1000, extractWork: 1000, buildWork: 1000, walk: 300, dropItem: 100, useItemKey: 100, useItemClick: 100, hitMagic: 1000, magicHit: 1000, hitUseItem: 1000, hide: 1000, talk: 500, leftClick: 100, meditate: 100 },
          { id: S.ChangeMap, map: 1, resourceMap: 1 }, character(1, 'TGuild', 56, 43), character(2, 'Aotesta', 58, 43, 2), { id: S.UserCharIndexInServer, charIndex: 1 },
          { id: G.GuildConfig, levelCallSupport: 3, levelSeeInvisible: 6, levelSafe: 4, levelShowHpBar: 5, maxLevel: 6, membersByLevel: [3, 4, 5, 8, 10, 12] }, { id: S.Logged, newUser: false });
        break;
      case 84: // RequestGuildLeaderInfo: the list, the member's news view or the leader's panel, by role (modGuilds.SendGuildLeaderInfo)
        if (state.role === 'none') send({ id: G.GuildList, guilds: sep('Los Pibes-0', 'Armada Alpha-1', 'Legion Beta-2', 'Ciudad Gamma-3', 'Hampa Delta-4') });
        else if (state.role === 'member') send({ id: G.GuildNews, news: 'Hoy hay dungeon a las 21:00ºTraigan pociones', guilds: sep('Aliados-0', 'Enemigos-1'), members: sep('Ana', 'Bob', 'Cleo'), level: 4, exp: 1500, expNeeded: 6000 });
        else send({ id: G.GuildLeaderInfo, guilds: sep('Aliados-0', 'Enemigos-1'), members: sep('Ana', 'Bob', 'Cleo'), news: 'Hoy hay dungeon a las 21:00ºTraigan pociones', joinRequests: sep('Dan', 'Eva'), level: 4, exp: 1500, expNeeded: 6000 });
        break;
      case 37: send({ id: G.GuildDetails, name: packet.guild, founder: 'Ana', creationDate: '12/03/2026', leader: 'Ana', memberCount: 7, alignment: 'Neutral', description: 'Un clan para jugar tranquilos.ºSe aceptan nuevos.', level: 3 }); break;
      case 254: send({ id: G.ShowFundarClanForm }); break;
      case 34: send({ id: G.CharacterInfo, gender: 1, name: packet.userName, race: 2, characterClass: 3, level: 18, gold: 12000, bank: 50000, previousPetitions: 'Los Pibes: rechazado', currentGuild: '', previousGuilds: 'Viejo Clan', royalArmy: true, chaosLegion: false, citizensKilled: 4, criminalsKilled: 1 }); break;
      case 25: send({ id: G.OfferDetails, details: 'Quiero entrar al clan.ºJuego todos los dias.' }); break;
      case 26: send({ id: G.AlianceProposalsList, guilds: sep('Aliados', 'Los Amigos') }); break;
      case 27: send({ id: G.PeaceProposalsList, guilds: sep('Enemigos') }); break;
      case 236: send({ id: P.DatosGrupo, inGroup: state.group?.length > 0, members: state.group ?? [] }); break;
      case 234: send({ id: SP.WorkRequestTarget, skill: 90, area: false, radius: 0 }); break;
      default: break;
    }
  };
  await page.routeWebSocket(/bridge/, ws => {
    socket = ws; const decoder = new FrameDecoder();
    ws.onMessage(message => {
      for (const body of decoder.push(new Uint8Array(Buffer.from(message)))) {
        const packet = decodeClientPacket(body); received.push(packet);
        if (!packet.unknown) answer(packet);
      }
    });
    send({ id: S.Connected, debugging: true });
  });
  return { received, send, state, ids: () => received.map(p => p.id) };
}
