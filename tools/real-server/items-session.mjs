// Raw-TCP VB6 session helper for the items feature (login, send packets, record fixtures).
// AGPL-3.0-or-later. Talks straight to the VB6 server (default 127.0.0.1:7667) using @ao/protocol
// (build it first: pnpm --filter @ao/protocol build). Never touches another account.
import net from 'node:net';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  FrameDecoder, decodeServerPacket, encodeClientFrame, ClientPacketId as C, ServerPacketId as S,
  ItemsServerPacketId as IS, ItemsClientPacketId as IC,
} from '../../packages/protocol/dist/index.js';

const names = (...tables) => { const m = new Map(); for (const t of tables) for (const [k, v] of Object.entries(t)) if (typeof v === 'number') m.set(v, k); return m; };
const serverNames = names(S, IS), clientNames = names(C, IC);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hex = bytes => Buffer.from(bytes).toString('hex');

export class Vb6Session {
  constructor({ email, password, host = '127.0.0.1', port = 7667, record = true }) {
    Object.assign(this, { email, password, host, port });
    this.records = []; this.packets = []; this.start = Date.now(); this.decoder = new FrameDecoder();
    this.waiters = []; this.chars = new Map(); this.counters = {}; this.state = 'connecting'; this.character = undefined; this.record = record;
  }
  nextCounter(name) { return this.counters[name] = (this.counters[name] ?? 0) + 1; }
  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.connect(this.port, this.host);
      this.socket.setNoDelay(true);
      this.socket.on('error', reject);
      this.socket.on('close', () => { this.state = 'closed'; this.flush(); });
      this.socket.on('data', data => {
        for (const body of this.decoder.push(data)) {
          const id = body[0] | (body[1] << 8);
          this.records.push({ t_ms: Date.now() - this.start, dir: 's2c', id, name: serverNames.get(id) ?? `Unknown${id}`, hex: hex(body) });
          let packet;
          try { packet = decodeServerPacket(body); } catch (error) { packet = { unknown: true, id, error: String(error) }; }
          this.packets.push(packet);
          this.onPacket(packet);
          for (const w of [...this.waiters]) if (w.match(packet)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(packet); }
        }
      });
      this.once = (match, timeout = 8000) => new Promise((res, rej) => {
        const w = { match, resolve: res }; this.waiters.push(w);
        setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); rej(new Error('timeout')); } }, timeout);
      });
      this.loggedIn = new Promise(r => { this.resolveLogin = r; });
      resolve(this);
    });
  }
  onPacket(packet) {
    if (packet.id === S.Connected && this.state === 'connecting') { this.state = 'account'; this.send({ id: C.LoginAccount, email: this.email, password: this.password }); }
    else if (packet.id === S.AccountCharacterList && this.state === 'account') {
      const first = packet.characters[0]; if (!first) throw new Error('no character');
      this.character = first; this.state = 'login'; this.send({ id: C.LoginExistingChar, charId: first.id, name: first.name });
    } else if (packet.id === S.Logged) { this.state = 'playing'; this.resolveLogin(); }
    else if (packet.id === S.UserCharIndexInServer) { this.charIndex = packet.charIndex; const own = this.chars.get(packet.charIndex); if (own) this.pos = { x: own.x, y: own.y }; }
    else if (packet.id === S.CharacterCreate) { this.chars.set(packet.charIndex, packet); if (packet.charIndex === this.charIndex) this.self = packet; }
    else if (packet.id === S.CharacterMove || packet.id === S.PosUpdateChar) { const c = this.chars.get(packet.charIndex); if (c) this.chars.set(packet.charIndex, { ...c, x: packet.x, y: packet.y }); }
    else if (packet.id === S.PosUpdateUserChar) { this.pos = { x: packet.x, y: packet.y }; }
    else if (packet.id === S.ChangeMap) this.map = packet.map;
    else if (packet.id === S.PosUpdate) this.pos = { x: packet.x, y: packet.y };
    else if (packet.id === S.UpdateUserStats) this.stats = packet;
    else if (packet.id === S.UpdateGold) this.stats = { ...this.stats, gold: packet.gold };
    else if (packet.id === S.ChangeInventorySlot) { (this.inventory ??= new Map()).set(packet.slot, packet); }
    if (packet.id === S.CharacterCreate && packet.charIndex === this.charIndex) this.pos = { x: packet.x, y: packet.y };
    if ((packet.id === S.CharacterMove || packet.id === S.PosUpdateChar) && packet.charIndex === this.charIndex) this.pos = { x: packet.x, y: packet.y };
  }
  send(packet) {
    const frame = encodeClientFrame(packet);
    this.records.push({ t_ms: Date.now() - this.start, dir: 'c2s', id: packet.id, name: clientNames.get(packet.id) ?? `Unknown${packet.id}`, hex: hex(packet.id === 304 || packet.id === 305 ? frame.subarray(2, 4) : frame.subarray(2)) }); // credentials redacted (docs/CONFORMANCE.md)
    this.socket.write(frame);
  }
  async login() { await this.connect(); await this.loggedIn; await sleep(1500); return this; }
  async settle(ms = 600) { await sleep(ms); }
  since(index) { return this.packets.slice(index); }
  flush() { if (this.fixturePath) this.save(this.fixturePath); }
  save(path, from = 0) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, this.records.slice(from).map(r => JSON.stringify(r)).join('\n') + '\n');
  }
  close() { this.socket.end(); }
}
export { C, S, IC, IS, sleep, hex };

/** Greedy walk to within `near` tiles of (tx, ty); tries the other axis when a step is refused. */
export async function walkNear(s, tx, ty, near = 2, maxSteps = 60) {
  const H = { N: 1, E: 2, S: 3, W: 4 };
  for (let i = 0; i < maxSteps; i++) {
    const dx = tx - s.pos.x, dy = ty - s.pos.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) <= near) return true;
    const prefs = Math.abs(dx) >= Math.abs(dy)
      ? [dx > 0 ? H.E : H.W, dy > 0 ? H.S : H.N, dy > 0 ? H.N : H.S] : [dy > 0 ? H.S : H.N, dx > 0 ? H.E : H.W, dx > 0 ? H.W : H.E];
    for (const heading of prefs) {
      const before = { ...s.pos };
      s.send({ id: C.Walk, heading, counter: s.nextCounter('walk') });
      s.send({ id: C.RequestPositionUpdate });
      await sleep(420);
      if (s.pos.x !== before.x || s.pos.y !== before.y) break;
    }
  }
  return false;
}
