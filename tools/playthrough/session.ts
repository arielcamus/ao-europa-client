// AGPL-3.0-or-later. Protocol session over raw TCP for the playthrough harness (WP-D): one connected character, every packet decoded and
// kept, state tracked (position, stats, inventory, messages). Talks to ANY VB6 server (AO_SERVER_HOST / AO_SERVER_PORT) with the same
// codecs the browser client uses; sequenced counters come from the client's own PacketCounters, never hand-numbered.
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import * as protocol from '@ao/protocol';
import { ClientPacketId as C, ServerPacketId as S, Heading, FrameDecoder, decodeServerPacket, encodeClientFrame, SessionClientPacketId as SCP } from '@ao/protocol';
import type { ClientPacket, ServerPacket, UserStats, InventorySlot, SpellSlot, CharacterCreate } from '@ao/protocol';
import { PacketCounters, SEQUENCED_CLIENT_PACKETS } from '../../apps/web/src/packet-counters.js';
import { ChatInput } from '../../apps/web/src/chat-input.js';
import { parseGmLine } from '../../apps/web/src/gm-commands.js';

export const SERVER = { host: process.env.AO_SERVER_HOST ?? process.env.AO_TCP_HOST ?? '127.0.0.1', port: Number(process.env.AO_SERVER_PORT ?? process.env.AO_TCP_PORT ?? 7667) };

/** id -> name for both directions, from every `*PacketId` object the protocol package exports. */
const NAMES = { s: new Map<number, string>(), c: new Map<number, string>() };
for (const [group, table] of Object.entries(protocol as Record<string, unknown>)) {
  if (!/PacketId$/.test(group) || typeof table !== 'object' || !table) continue;
  const side = /^(Server|.*Server)PacketId$/.test(group) ? 's' : 'c';
  for (const [name, id] of Object.entries(table as Record<string, number>)) if (typeof id === 'number' && !NAMES[side].has(id)) NAMES[side].set(id, name);
}
export const packetName = (side: 's' | 'c', id: number) => NAMES[side].get(id) ?? `id${id}`;

export interface Rx { t: number; packet: ServerPacket | { unknown: true; id: number; payload: Uint8Array }; name: string; hex: string }
export interface Wire { t_ms: number; dir: 's2c' | 'c2s'; id: number; name: string; hex: string }

export class Sess {
  readonly counters = new Counters();
  readonly rx: Rx[] = [];
  readonly wire: Wire[] = [];
  readonly messages: string[] = [];
  readonly errors: string[] = [];
  readonly inventory = new Map<number, InventorySlot>();
  readonly spells = new Map<number, SpellSlot>();
  readonly chars = new Map<number, CharacterCreate>();
  stats?: UserStats;
  hunger?: { maxWater: number; water: number; maxFood: number; food: number };
  map = 0; charIndex = 0; x = 0; y = 0; isGM = false; closed = false;
  characters: protocol.AccountCharacter[] = [];
  private decoder = new FrameDecoder();
  private socket!: Socket;
  private t0 = Date.now();
  private chat = new ChatInput();
  private waiters: { test: () => boolean; resolve: () => void }[] = [];

  static async open(host = SERVER.host, port = SERVER.port): Promise<Sess> {
    const s = new Sess();
    s.socket = createConnection({ host, port });
    s.socket.setNoDelay(true);
    await new Promise<void>((resolve, reject) => { s.socket.once('connect', resolve); s.socket.once('error', reject); });
    s.socket.on('data', chunk => s.onData(chunk));
    s.socket.on('close', () => { s.closed = true; s.wake(); });
    s.socket.on('error', e => { s.errors.push(String(e)); s.closed = true; s.wake(); });
    await s.until(() => s.rx.some(r => r.name === 'Connected'), 5000, 'Connected');
    return s;
  }

  private wake() { for (const w of [...this.waiters]) if (w.test()) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(); } }
  private onData(chunk: Buffer) {
    let bodies: Uint8Array[];
    try { bodies = this.decoder.push(chunk); } catch (e) { this.errors.push(String(e)); return; }
    for (const body of bodies) {
      let packet;
      try { packet = decodeServerPacket(body); } catch (e) { this.errors.push(String(e)); continue; }
      const name = packetName('s', packet.id), hex = Buffer.from(body).toString('hex');
      this.rx.push({ t: Date.now() - this.t0, packet, name, hex });
      this.wire.push({ t_ms: Date.now() - this.t0, dir: 's2c', id: packet.id, name, hex });
      if (!('unknown' in packet)) this.track(packet);
    }
    this.wake();
  }
  private track(p: ServerPacket) {
    switch (p.id) {
      case S.UpdateUserStats: this.stats = p; break;
      case S.UpdateHP: if (this.stats) this.stats = { ...this.stats, hp: p.hp }; break;
      case S.UpdateMana: if (this.stats) this.stats = { ...this.stats, mana: p.mana }; break;
      case S.UpdateSta: if (this.stats) this.stats = { ...this.stats, stamina: p.stamina }; break;
      case S.UpdateGold: if (this.stats) this.stats = { ...this.stats, gold: p.gold }; break;
      case S.UpdateExp: if (this.stats) this.stats = { ...this.stats, experience: p.experience }; break;
      case S.UpdateHungerAndThirst: this.hunger = p; break;
      case S.ChangeInventorySlot: if (p.object === 0) this.inventory.delete(p.slot); else this.inventory.set(p.slot, p); break;
      case S.ChangeSpellSlot: this.spells.set(p.slot, p); break;
      case S.ChangeMap: this.map = p.map; this.chars.clear(); break;
      case S.UserCharIndexInServer: this.charIndex = p.charIndex; { const me = this.chars.get(p.charIndex); if (me) { this.x = me.x; this.y = me.y; } } break;
      case S.CharacterCreate: this.chars.set(p.charIndex, p); if (p.charIndex === this.charIndex) { this.x = p.x; this.y = p.y; } break;
      case S.PosUpdate: this.x = p.x; this.y = p.y; break;
      case S.CharacterMove: case S.PosUpdateChar: { const c = this.chars.get(p.charIndex); if (c) this.chars.set(p.charIndex, { ...c, x: p.x, y: p.y }); if (p.charIndex === this.charIndex) { this.x = p.x; this.y = p.y; } break; }
      case S.PosUpdateUserChar: this.x = p.x; this.y = p.y; break;
      case S.AccountCharacterList: this.characters = p.characters; break;
      case S.ConsoleMsg: this.messages.push(p.message); break;
      case S.ErrorMsg: this.errors.push(p.message); this.messages.push(p.message); break;
      default: {
        const anyp = p as unknown as { message?: string; id: number; privileges?: number };
        if (p.id === 177 /* Privilegios */) this.isGM = !!(p as any).isGM;
        if ((p.id as number) === 43 /* CharacterRemove */) this.chars.delete((p as any).charIndex);
        if (p.id === 141 /* LocaleMsg */) this.messages.push(`[${(p as any).messageId}] ${(p as any).text}`);
      }
    }
  }

  /** Sends one client packet; sequenced families get their counter from PacketCounters.next, exactly like the browser Session. */
  send(packet: ClientPacket) {
    const family = SEQUENCED_CLIENT_PACKETS[packet.id];
    const p = family ? { ...packet, counter: this.counters.next(family) } as ClientPacket : packet;
    const body = encodeClientFrame(p);
    this.wire.push({ t_ms: Date.now() - this.t0, dir: 'c2s', id: p.id, name: packetName('c', p.id), hex: Buffer.from(body).subarray(2).toString('hex') });
    this.socket.write(body);
  }
  /** Types a line like the player: ChatInput decides talk / slash command, GM commands go through the GM parser. */
  say(text: string) {
    const out = this.chat.submit(text, { isGM: this.isGM, level: this.stats?.level, dead: false });
    if (out.talk !== undefined) this.send({ id: C.Talk, message: out.talk, counter: 0 });
    if (out.packet) this.send(out.packet);
    for (const p of out.more ?? []) this.send(p);
    if (!out.packet && out.talk === undefined) {
      const gm = parseGmLine(text, { isGM: true });
      if (gm) for (const p of gm.packets) this.send(p);
    }
  }
  /** GM command: always through the GM parser. */
  gm(text: string) { const o = parseGmLine(text, { isGM: true }); if (!o) throw new Error(`not a GM command: ${text}`); for (const p of o.packets) this.send(p); return o; }

  until(test: () => boolean, ms = 5000, what = 'condition'): Promise<void> {
    if (test()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const w = { test, resolve: () => { clearTimeout(timer); resolve(); } };
      const timer = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); reject(new Error(`timeout (${ms} ms) waiting for ${what}`)); }, ms);
      this.waiters.push(w);
      if (this.closed) { w.resolve(); }
    });
  }
  /** Right after login the server answers nothing for several seconds: ask for the position every second until it answers. */
  async settle(maxMs = 20_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const m = this.mark(); this.send({ id: C.RequestPositionUpdate });
      await this.sleep(900);
      if (this.rx.slice(m).some(r => r.name === 'PosUpdate')) { this.settledMs = Date.now() - t0; return; }
    }
    this.settledMs = -1;
  }
  settledMs = 0;
  mark() { return this.rx.length; }
  since(mark: number) { return this.rx.slice(mark); }
  /** Waits for a packet by name (optionally matching) after `mark`. */
  async waitFor(name: string, after = 0, ms = 5000, match: (p: any) => boolean = () => true): Promise<any> {
    await this.until(() => this.rx.slice(after).some(r => r.name === name && match(r.packet)), ms, name);
    const hit = this.rx.slice(after).find(r => r.name === name && match(r.packet));
    if (!hit) throw new Error(`the session closed while waiting for ${name}`);
    return hit.packet;
  }
  /** LocaleMsg (141) lines since mark as {id, params}: the server's own messages are locale ids, the params are joined by the char 172. */
  localeSince(mark: number) { return this.rx.slice(mark).filter(r => r.name === 'LocaleMsg').map(r => ({ id: (r.packet as any).messageId as number, text: (r.packet as any).text as string })); }
  messagesSince(mark: number) { return this.rx.slice(mark).filter(r => r.name === 'ConsoleMsg').map(r => (r.packet as any).message as string); }
  sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
  close() { this.socket.destroy(); }

  // ---- account / login ----
  async createAccount(email: string, password: string) {
    const m = this.mark(); this.send({ id: SCP.CreateAccount, email, password } as ClientPacket);
    await this.waitFor('AccountCharacterList', m, 8000);
  }
  async loginAccount(email: string, password: string) {
    const m = this.mark(); this.send({ id: C.LoginAccount, email, password });
    await this.until(() => this.rx.slice(m).some(r => r.name === 'AccountCharacterList' || r.name === 'ErrorMsg'), 8000, 'AccountCharacterList');
    const err = this.rx.slice(m).find(r => r.name === 'ErrorMsg'); if (err) throw new Error(`LoginAccount: ${(err.packet as any).message}`);
  }
  async loginChar(charId: number, name: string) {
    const m = this.mark(); this.send({ id: C.LoginExistingChar, charId, name });
    await this.until(() => this.rx.slice(m).some(r => r.name === 'ErrorMsg') || (this.rx.slice(m).some(r => r.name === 'Logged') && this.rx.slice(m).some(r => r.name === 'Intervals') && this.rx.slice(m).some(r => r.name === 'UserCharIndexInServer')), 12000, 'Logged + placement');
    const err = this.rx.slice(m).find(r => r.name === 'ErrorMsg'); if (err) throw new Error(`LoginExistingChar: ${(err.packet as any).message}`);
    await this.settle();
  }
  /** LoginNewChar (the server enters the new character directly). Returns false when the server answered ErrorMsg. */
  async createChar(c: { name: string; race: number; gender: number; characterClass: number; head: number; home?: number }) {
    const m = this.mark(); this.send({ id: SCP.LoginNewChar, name: c.name, race: c.race, gender: c.gender, characterClass: c.characterClass, head: c.head, home: c.home ?? 7 } as ClientPacket);
    await this.until(() => this.closed || this.rx.slice(m).some(r => ['ErrorMsg', 'ShowMessageBox', 'Logged'].includes(r.name)), 15000, 'Logged or refusal').catch(() => undefined);
    const err = this.rx.slice(m).find(r => r.name === 'ErrorMsg' || r.name === 'ShowMessageBox');
    if (err) return { ok: false as const, error: err.name === 'ErrorMsg' ? (err.packet as any).message as string : `ShowMessageBox ${JSON.stringify(err.packet)}` };
    if (this.closed) return { ok: false as const, error: 'socket closed by the server' };
    if (!this.rx.slice(m).some(r => r.name === 'Logged')) return { ok: false as const, error: 'no Logged and no ErrorMsg (the known intermittent creation bug)' };
    await this.until(() => this.rx.slice(m).some(r => r.name === 'Intervals') && this.rx.slice(m).some(r => r.name === 'UserCharIndexInServer'), 8000, 'placement');
    await this.settle();
    return { ok: true as const };
  }
  /** fixture jsonl in the format of tests/fixtures/vb6 */
  jsonl(from = 0) { return this.wire.slice(from).map((w, i) => JSON.stringify({ ...w, t_ms: i, hex: (w.id === 305 || w.id === 304) ? w.hex.slice(0, 4) : w.hex })).join('\n') + '\n'; }

  // ---- movement helpers ----
  /**
   * One walk. The server never echoes the walker's own CharacterMove: an accepted step is silent, a refused one is a PosUpdate with the old
   * position. So the authoritative answer is RequestPositionUpdate -> PosUpdate (what apps/bot does), awaited with generous latency on the shared VM.
   */
  async step(heading: Heading, wait = 700) {
    const bx = this.x, by = this.y;
    const before = this.mark();
    this.send({ id: C.Walk, heading, counter: 0 });
    await this.sleep(wait);
    const m = this.mark(); this.send({ id: C.RequestPositionUpdate });
    await this.until(() => this.rx.slice(m).some(r => r.name === 'PosUpdate'), 6000, 'PosUpdate after RequestPositionUpdate').catch(() => undefined);
    const moved = this.x !== bx || this.y !== by;
    return { moved, corrected: !moved, x: this.x, y: this.y, from: before };
  }
}
class Counters extends PacketCounters {}
export { Heading, C, S, SCP };
