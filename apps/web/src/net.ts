/*
 * Browser login/movement adaptation of Argentum 20 CODIGO/Protocol.bas,
 * Protocol_Writes.bas and TileEngine_Chars.bas, using the M1 packet codecs.
 * Copyright (C) 2022 Noland Studios. GNU AGPL version 3 or any later version.
 * WITHOUT ANY WARRANTY, including MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See ../../../LICENSE and ../../../NOTICE.
 */
import {
  FrameDecoder, decodeServerPacket, encodeClientFrame, Heading,
  ClientPacketId as C, ServerPacketId as S,
} from '@ao/protocol';
import type { CharacterCreate, ClientPacket, ServerPacket } from '@ao/protocol';

export interface SessionState {
  status: 'offline' | 'connecting' | 'authenticating' | 'loading' | 'ready' | 'error';
  message: string;
  mapId: number;
  resourceMap: number;
  player: CharacterCreate | undefined;
  walkMs: number;
  walks: number;
  corrections: number;
}

export class GameClient {
  private socket: WebSocket | undefined;
  private decoder = new FrameDecoder();
  private characters = new Map<number, CharacterCreate>();
  private ownIndex = 0;
  private logged = false;
  private assetsReady = false;
  private phase: 'connected' | 'account' | 'character' | 'playing' = 'connected';
  private lastWalk = -Infinity;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private state: SessionState = this.initialState();

  constructor(private readonly change: (state: SessionState) => void, private readonly now = () => performance.now()) {}
  private initialState(): SessionState {
    return { status: 'offline', message: 'Ready to connect', mapId: 0, resourceMap: 0, player: undefined, walkMs: 0, walks: 0, corrections: 0 };
  }
  get snapshot(): Readonly<SessionState> { return this.state; }
  private emit(): void { this.change(this.state); }
  private refresh(): void {
    if (this.logged && this.state.player && this.state.walkMs > 0 && this.assetsReady) {
      this.state = { ...this.state, status: 'ready', message: 'Connected' };
      clearTimeout(this.timeout);
    }
    this.emit();
  }
  connect(url: string, email: string, password: string): void {
    this.disconnect();
    const endpoint = new URL(url, locationOrigin());
    if (!['ws:', 'wss:'].includes(endpoint.protocol)) throw new Error('Bridge URL must use ws:// or wss://');
    this.decoder = new FrameDecoder(); this.characters.clear(); this.ownIndex = 0;
    this.logged = false; this.assetsReady = false; this.phase = 'connected'; this.lastWalk = -Infinity;
    this.state = { ...this.initialState(), status: 'connecting', message: 'Connecting to bridge…' };
    const socket = new WebSocket(endpoint.href);
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    this.timeout = setTimeout(() => this.fail('Login or map loading timed out. Check the bridge and AO_ASSETS.'), 30_000);
    socket.addEventListener('message', event => {
      if (this.socket !== socket) return;
      try {
        if (!(event.data instanceof ArrayBuffer)) throw new Error('Bridge sent a non-binary message');
        for (const body of this.decoder.push(new Uint8Array(event.data))) {
          const packet = decodeServerPacket(body);
          if ('unknown' in packet) continue; // An entire framed message, safely skipped by M1.
          if (packet.id === S.Connected) {
            if (this.phase !== 'connected') throw new Error('Repeated Connected packet');
            this.phase = 'account';
            this.state = { ...this.state, status: 'authenticating', message: 'Signing in…' };
            this.send({ id: C.LoginAccount, email, password });
            // Credentials remain only in this connection closure, never storage/logs/URLs.
            email = ''; password = '';
          } else this.receive(packet);
          if (this.socket !== socket) break;
        }
        if (this.socket === socket) this.refresh();
      } catch (error) { this.fail(error instanceof Error ? error.message : String(error)); }
    });
    socket.addEventListener('error', () => { if (this.socket === socket) this.fail('Bridge unavailable. Check its address and server.'); });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      try { this.decoder.finish(); this.fail('Connection closed. Connect again to continue.'); }
      catch (error) { this.fail(String(error)); }
    });
    this.emit();
  }
  private receive(packet: ServerPacket): void {
    switch (packet.id) {
      case S.AccountCharacterList: {
        if (this.phase !== 'account') throw new Error('Unexpected character list');
        const character = packet.characters[0];
        if (!character) throw new Error('This account has no character');
        this.phase = 'character';
        this.send({ id: C.LoginExistingChar, charId: character.id, name: character.name });
        this.state = { ...this.state, status: 'loading', message: 'Loading world…' };
        break;
      }
      case S.Intervals:
        if (packet.walk <= 0 || packet.walk > 60_000) throw new Error('Invalid server walk interval');
        this.state = { ...this.state, walkMs: packet.walk };
        break;
      case S.ChangeMap:
        if (packet.resourceMap < 1) throw new Error('Invalid resource map');
        this.characters.clear(); this.assetsReady = false;
        this.state = { ...this.state, status: 'loading', mapId: packet.map, resourceMap: packet.resourceMap, player: undefined, message: 'Loading world…' };
        break;
      case S.CharacterCreate:
        this.characters.set(packet.charIndex, packet);
        if (packet.charIndex === this.ownIndex) this.setPlayer(packet);
        break;
      case S.UserCharIndexInServer:
        this.ownIndex = packet.charIndex;
        if (this.characters.has(this.ownIndex)) this.setPlayer(this.characters.get(this.ownIndex)!);
        break;
      case S.Logged:
        if (this.phase !== 'character') throw new Error('Unexpected Logged packet');
        this.logged = true; this.phase = 'playing';
        break;
      case S.PosUpdate:
        this.correct(packet.x, packet.y);
        break;
      case S.CharacterMove:
      case S.PosUpdateChar:
      case S.PosUpdateUserChar:
        if (packet.charIndex === this.ownIndex) this.correct(packet.x, packet.y);
        break;
      case S.ErrorMsg: this.fail(packet.message); break;
      case S.Disconnect: this.fail('Server disconnected this character'); break;
    }
  }
  private setPlayer(player: CharacterCreate): void {
    if (player.x < 1 || player.x > 100 || player.y < 1 || player.y > 100 || !Number.isFinite(player.speeding) || player.speeding <= 0) {
      throw new Error('Invalid character position or movement speed');
    }
    this.state = { ...this.state, player };
  }
  private correct(x: number, y: number): void {
    const player = this.state.player;
    if (!player) return;
    const changed = player.x !== x || player.y !== y;
    this.setPlayer({ ...player, x, y });
    this.state = { ...this.state, corrections: this.state.corrections + Number(changed) };
    // Packet 31 has no sequence/ack field: snap to authoritative position and
    // discard speculation. Never pretend it acknowledges a particular Walk.
  }
  setMapReady(resourceMap: number): void {
    if (resourceMap !== this.state.resourceMap || !this.socket) return;
    this.assetsReady = true;
    this.refresh();
  }
  get stepInterval(): number { return Math.max(16, this.state.walkMs / (this.state.player?.speeding ?? 1)) + 15; }
  walk(heading: Heading): boolean {
    const player = this.state.player, now = this.now();
    if (this.state.status !== 'ready' || !player || now - this.lastWalk < this.stepInterval) return false;
    const x = player.x + (heading === Heading.East ? 1 : heading === Heading.West ? -1 : 0);
    const y = player.y + (heading === Heading.South ? 1 : heading === Heading.North ? -1 : 0);
    if (x < 1 || x > 100 || y < 1 || y > 100) return false;
    try {
      const counter = this.state.walks + 1;
      this.send({ id: C.Walk, heading, counter });
      this.lastWalk = now;
      this.state = { ...this.state, walks: counter, player: { ...player, x, y, heading } };
      this.emit();
      return true;
    } catch (error) { this.fail(String(error)); return false; }
  }
  private send(packet: ClientPacket): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('Bridge is not connected');
    if (this.socket.bufferedAmount > 64 * 1024) throw new Error('Bridge is too slow; reconnect to resume');
    this.socket.send(encodeClientFrame(packet));
  }
  fail(message: string): void {
    this.disconnect();
    this.state = { ...this.state, status: 'error', message };
    this.emit();
  }
  disconnect(): void {
    clearTimeout(this.timeout);
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.state = { ...this.state, status: 'offline', message: 'Disconnected' };
    this.emit();
  }
}
// Only Web APIs; also permits a Node WebSocket integration test without a DOM.
function locationOrigin(): string { return typeof location === 'undefined' ? 'http://localhost' : location.href; }
