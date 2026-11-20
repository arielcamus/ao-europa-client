import { ClientPacketId as C, Heading, ServerPacketId as S } from '../src/index.js';
import type { ClientPacket, ServerPacket } from '../src/index.js';

/** Inputs independently repeated in tools/protocol-oracle.cpp. */
export const clientFixtures = {
  LoginAccount: { id: C.LoginAccount, email: 'a@b', password: 'pñ' },
  LoginExistingChar: { id: C.LoginExistingChar, charId: 300, name: 'Añ' },
  Walk: { id: C.Walk, heading: Heading.East, counter: 0x01020304 },
  RequestPositionUpdate: { id: C.RequestPositionUpdate },
  Talk: { id: C.Talk, message: 'Hola ñ', counter: 3 },
} satisfies Record<string, ClientPacket>;

export const serverFixtures = {
  UpdateSta: { id: S.UpdateSta, stamina: 90 },
  UpdateMana: { id: S.UpdateMana, mana: 60 },
  UpdateHP: { id: S.UpdateHP, hp: 80, shield: 123456 },
  UpdateGold: { id: S.UpdateGold, gold: 1200, goldPerLevel: 1000 },
  UpdateExp: { id: S.UpdateExp, experience: 25 },
  ConsoleMsg: { id: S.ConsoleMsg, message: 'Hola ñ', font: 2 },
  UpdateUserStats: { id: S.UpdateUserStats, maxHp: 100, hp: 80, shield: 123456, maxMana: 80, mana: 60,
    maxStamina: 100, stamina: 90, gold: 1200, goldPerLevel: 1000, level: 12, nextLevel: 200, experience: 25, characterClass: 3 },
  ChangeInventorySlot: { id: S.ChangeInventorySlot, slot: 42, object: 2, amount: 3, equipped: true, value: 1.5, canUse: 1, elementalTags: 0x01020304, bindable: false },
  InventoryUnlockSlots: { id: S.InventoryUnlockSlots, rows: 3 },
  ChangeSpellSlot: { id: S.ChangeSpellSlot, slot: 40, spell: 0, index: -1, bindable: false },
  UpdateHungerAndThirst: { id: S.UpdateHungerAndThirst, maxWater: 100, water: 75, maxFood: 100, food: 85 },
  Connected: { id: S.Connected, debugging: false },
  ConnectedDebug: { id: S.Connected, debugging: true },
  Logged: { id: S.Logged, newUser: false },
  Disconnect: { id: S.Disconnect, fullLogout: true },
  ErrorMsg: { id: S.ErrorMsg, message: 'No ñ' },
  ChangeMap: { id: S.ChangeMap, map: 257, resourceMap: 258 },
  PosUpdate: { id: S.PosUpdate, x: 200, y: 201 },
  UserCharIndexInServer: { id: S.UserCharIndexInServer, charIndex: 0x1234 },
  PosUpdateUserChar: { id: S.PosUpdateUserChar, x: 200, y: 201, charIndex: 0x1234 },
  PosUpdateChar: { id: S.PosUpdateChar, charIndex: 0x1234, x: 200, y: 201 },
  CharacterMove: { id: S.CharacterMove, charIndex: 0x1234, x: 200, y: 201 },
  Intervals: {
    id: S.Intervals, hit: 101, bow: 102, magic: 103, extractWork: 104, buildWork: 105,
    walk: 300, dropItem: 107, useItemKey: 108, useItemClick: 109, hitMagic: 110,
    magicHit: 111, hitUseItem: 112, hide: 113, talk: 114, leftClick: 115, meditate: 116,
  },
  AccountCharacterList: {
    id: S.AccountCharacterList,
    characters: [
      { id: 300, name: 'Añ', body: 200, head: 128, characterClass: 3, map: 257,
        x: 50, y: 51, level: 12, status: 1, helmet: 2, shield: 3, weapon: 4, backpack: 5 },
      { id: 2, name: 'B', body: 1, head: 2, characterClass: 3, map: 4,
        x: 5, y: 6, level: 7, status: 8, helmet: 9, shield: 10, weapon: 11, backpack: 12 },
    ],
  },
  CharacterCreate: {
    id: S.CharacterCreate, charIndex: 0x1234, body: 200, head: 201, heading: 4, x: 50, y: 60,
    weapon: 202, shield: 203, helmet: 204, cart: 205, backpack: 206, fx: 207, fxLoops: -1,
    name: 'Añ', status: 1, privileges: 128, particleFx: 255,
    headAura: 'H', weaponAura: 'W', bodyAura: 'B', damageAura: 'D', resistanceAura: 'R', otherAura: 'O', shieldAura: 'S',
    speeding: 1.5, npc: 2, appear: 1, groupIndex: 0x102, clanIndex: 0x304, clanLevel: 5,
    minHp: 1000, maxHp: 2000, minMana: 3000, maxMana: 4000, symbol: 6, flags: 3,
    userType: 7, team: 8, flag: 9, npcNumber: 0x506, clanAlignment: 10,
  },
} satisfies Record<string, ServerPacket>;
