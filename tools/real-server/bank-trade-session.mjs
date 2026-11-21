// Raw-TCP VB6 session helper for the bank / player-trade scenarios (login, send packets, record fixtures).
// AGPL-3.0-or-later. Talks straight to the VB6 server (default 127.0.0.1:7667) using @ao/protocol
// (build it first: pnpm --filter @ao/protocol build). Two sessions can run at once (trade needs two characters).
// Counters: this standalone recorder keeps its own per-family counters because it is not the browser session.
import net from 'node:net';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { blockedTiles } from '../conformance/csm-blocked.mjs';
import {
  FrameDecoder, decodeServerPacket, encodeClientFrame, ClientPacketId as C, ServerPacketId as S,
  BankTradeServerPacketId as BS, BankTradeClientPacketId as BC, DoorClientPacketId as DC,
} from '../../packages/protocol/dist/index.js';

const names = (...tables) => { const m = new Map(); for (const t of tables) for (const [k, v] of Object.entries(t)) if (typeof v === 'number') m.set(v, k); return m; };
const serverNames = names(S, BS), clientNames = names(C, BC, DC);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
const hex = bytes => Buffer.from(bytes).toString('hex');

export class Vb6Session {
  constructor({ email, password, host = '127.0.0.1', port = 7667, character }) {
    Object.assign(this, { email, password, host, port, character_name: character });
    this.records = []; this.packets = []; this.start = Date.now(); this.decoder = new FrameDecoder();
    this.waiters = []; this.chars = new Map(); this.counters = {}; this.state = 'connecting'; this.inventory = new Map();
  }
  nextCounter(name) { return this.counters[name] = (this.counters[name] ?? 0) + 1; }
  connect() {
    return new Promise(resolve => {
      this.socket = net.connect(this.port, this.host); this.socket.setNoDelay(true);
      this.socket.on('error', error => console.error('socket', this.email, error.message));
      this.socket.on('close', () => { this.state = 'closed'; });
      this.socket.on('data', data => {
        for (const body of this.decoder.push(data)) {
          const id = body[0] | (body[1] << 8);
          this.records.push({ t_ms: Date.now() - this.start, dir: 's2c', id, name: serverNames.get(id) ?? `Unknown${id}`, hex: hex(body) });
          let packet; try { packet = decodeServerPacket(body); } catch (error) { packet = { unknown: true, id, error: String(error) }; }
          this.packets.push(packet); this.onPacket(packet);
          for (const w of [...this.waiters]) if (w.match(packet)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(packet); }
        }
      });
      this.loggedIn = new Promise(r => { this.resolveLogin = r; });
      resolve(this);
    });
  }
  once(match, timeout = 8000) {
    return new Promise((res, rej) => {
      const w = { match, resolve: res }; this.waiters.push(w);
      setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); rej(new Error('timeout')); } }, timeout);
    });
  }
  onPacket(p) {
    if (p.id === S.Connected && this.state === 'connecting') { this.state = 'account'; this.send({ id: C.LoginAccount, email: this.email, password: this.password }); }
    else if (p.id === S.AccountCharacterList && this.state === 'account') {
      const first = (this.character_name && p.characters.find(c => c.name === this.character_name)) || p.characters[0]; if (!first) throw new Error('no character'); this.character = first; this.state = 'login';
      this.send({ id: C.LoginExistingChar, charId: first.id, name: first.name });
    } else if (p.id === S.Logged) { this.state = 'playing'; this.resolveLogin(); }
    else if (p.id === S.UserCharIndexInServer) { this.charIndex = p.charIndex; const own = this.chars.get(p.charIndex); if (own) this.pos = { x: own.x, y: own.y }; }
    else if (p.id === S.CharacterCreate) { this.chars.set(p.charIndex, p); if (p.charIndex === this.charIndex) this.pos = { x: p.x, y: p.y }; }
    else if (p.id === S.CharacterMove || p.id === S.PosUpdateChar) { const c = this.chars.get(p.charIndex); if (c) this.chars.set(p.charIndex, { ...c, x: p.x, y: p.y }); if (p.charIndex === this.charIndex) this.pos = { x: p.x, y: p.y }; }
    else if (p.id === S.PosUpdateUserChar || p.id === S.PosUpdate) this.pos = { x: p.x, y: p.y };
    else if (p.id === S.ChangeMap) this.map = p.map;
    else if (p.id === S.UpdateGold) this.gold = p.gold;
    else if (p.id === S.UpdateUserStats) this.gold = p.gold;
    else if (p.id === S.ChangeInventorySlot) { if (p.object > 0 && p.amount > 0) this.inventory.set(p.slot, p); else this.inventory.delete(p.slot); }
  }
  send(packet) {
    const frame = encodeClientFrame(packet);
    this.records.push({ t_ms: Date.now() - this.start, dir: 'c2s', id: packet.id, name: clientNames.get(packet.id) ?? `Unknown${packet.id}`, hex: [304, 305].includes(packet.id) ? hex(frame.subarray(2, 4)) : hex(frame.subarray(2)) }); // credentials never reach a fixture
    this.socket.write(frame);
  }
  async login() { await this.connect(); await this.loggedIn; await sleep(1500); return this; }
  last(id) { return [...this.packets].reverse().find(p => p.id === id); }
  save(path, from = 0) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, this.records.slice(from).map(r => JSON.stringify(r)).join('\n') + '\n'); }
  close() { this.socket.end(); }
}

/** Greedy walk to within `near` tiles of (tx, ty); tries the other axis when a step is refused. */
export async function walkNear(s, tx, ty, near = 1, maxSteps = 80) {
  const H = { N: 1, E: 2, S: 3, W: 4 };
  for (let i = 0; i < maxSteps; i++) {
    const dx = tx - s.pos.x, dy = ty - s.pos.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) <= near) return true;
    const prefs = Math.abs(dx) >= Math.abs(dy)
      ? [dx > 0 ? H.E : H.W, dy > 0 ? H.S : H.N, dy > 0 ? H.N : H.S] : [dy > 0 ? H.S : H.N, dx > 0 ? H.E : H.W, dx > 0 ? H.W : H.E];
    for (const heading of prefs) {
      const before = { ...s.pos };
      s.send({ id: C.Walk, heading, counter: s.nextCounter('walk') }); s.send({ id: C.RequestPositionUpdate });
      await sleep(420);
      if (s.pos.x !== before.x || s.pos.y !== before.y) break;
    }
  }
  return false;
}

const HEADS = [[1, 0, -1], [2, 1, 0], [3, 0, 1], [4, -1, 0]];
/** Path-finding walk over the map's CSM blocked tiles; tiles the server refuses are learned and avoided. */
export async function gotoTile(s, to, { blocked = blockedTiles(`${process.env.AO_ASSETS ?? `${process.env.HOME}/Projects/ao-reference/Recursos`}/Mapas/mapa${s.map ?? 1}.csm`), maxSteps = 400 } = {}) {
  const learned = new Set();
  for (let guard = 0; guard < maxSteps; guard++) {
    if (s.pos.x === to[0] && s.pos.y === to[1]) return true;
    const from = [s.pos.x, s.pos.y], q = [from], prev = new Map([[from.join(), null]]);
    while (q.length) {
      const [x, y] = q.shift(); if (x === to[0] && y === to[1]) break;
      for (const [h, dx, dy] of HEADS) {
        const n = [x + dx, y + dy], k = n.join(',');
        if (n[0] < 1 || n[1] < 1 || n[0] > 100 || n[1] > 100 || prev.has(k)) continue;
        if ((blocked.has(k) || learned.has(k)) && !(n[0] === to[0] && n[1] === to[1])) continue;
        prev.set(k, { from: [x, y], h, to: n }); q.push(n);
      }
    }
    if (!prev.has(to.join())) return false;
    let cur = to, step; while (prev.get(cur.join())) { step = prev.get(cur.join()); cur = step.from; }
    const before = { ...s.pos };
    s.send({ id: C.Walk, heading: step.h, counter: s.nextCounter('walk') }); s.send({ id: C.RequestPositionUpdate });
    await sleep(380);
    if (s.pos.x === before.x && s.pos.y === before.y) learned.add(step.to.join());
  }
  return false;
}
export { C, S, BC, BS, DC };
