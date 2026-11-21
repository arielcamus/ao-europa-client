/*
 * Wire-layout profile (server side of the connection). 2026-11-21.
 *
 * Ariel (21 Nov) approved rebuilding the VB6 server at the last pre-HOO commit (server-classic 9ccd7fad, client-classic 619e69d). The
 * live server today is HOO-era (caac3133, 19 Nov). Eight server->client packets grew fields AFTER the pin (see docs/PINNED-LAYOUTS.md):
 * ConsoleMsg and LocaleMsg (+channel), CharacterCreate (+clanAlignment), UpdateTagAndStatus (+clanIndex, +clanAlignment),
 * FYA (+strength/agility base), GuildNews and GuildLeaderInfo (exp and exp-needed Int16 -> Int32), QuestDetails (+talkTo, +deliverMap).
 *
 * DECODING on 'live' is version-tolerant: the trailing fields are read only when bytes remain and the two exp pairs are told apart by how
 * many bytes are left (4 = Int16 pair, 8 = Int32 pair). DECODING on 'prehoo' reads exactly the pinned layout and never a HOO-era field
 * (hooTail), because a pinned-server frame CAN carry bytes after its packet: 138 call sites of the pinned server write
 * `WriteConsoleMsg(UserIndex, PrepareMessageLocaleMsg(...))`, so the LocaleMsg is followed by an empty ConsoleMsg (25 00 00 <font>) in the
 * same frame. The tolerant read took that 0x25 as the LocaleMsg channel and left 3 "trailing bytes" (Ariel's /EST disconnect, 21 Nov).
 * The pinned client reads its fields and drains the rest (HandleIncomingData, "extra bytes found"); see decodeServerFrame.
 * ENCODING (the stand-in server, the mock servers, the tests) follows the profile, because a writer must pick one layout.
 * 'live' stays the library default (the HOO-era fixtures and mocks); the web client talks to the pinned server and sets 'prehoo' at startup.
 */
export type WireProfile = 'prehoo' | 'live';
export const WIRE_PROFILES: readonly WireProfile[] = ['prehoo', 'live'];

let current: WireProfile = 'live';

export const getWireProfile = (): WireProfile => current;
export const isPreHoo = (): boolean => current === 'prehoo';
/** Read a HOO-era trailing field? Only on 'live', and only when `bytes` remain; on 'prehoo' the pinned layout ends before it. */
export const hooTail = (reader: { readonly remaining: number }, bytes: number): boolean => current !== 'prehoo' && reader.remaining >= bytes;

export function parseWireProfile(value: unknown): WireProfile {
  if (value === 'prehoo' || value === 'live') return value;
  throw new RangeError(`Unknown wire profile ${JSON.stringify(value)} (use 'prehoo' or 'live')`);
}

export function setWireProfile(profile: WireProfile): void { current = parseWireProfile(profile); }

/** Runs `fn` under `profile` and restores the previous one (tests, golden generators). */
export function withWireProfile<T>(profile: WireProfile, fn: () => T): T {
  const previous = current;
  current = parseWireProfile(profile);
  try { return fn(); } finally { current = previous; }
}

/** AO_WIRE_PROFILE=prehoo|live (unset keeps the current one); for the stand-in and mock servers, which ENCODE server packets. */
export function applyWireProfileFromEnv(env: Record<string, string | undefined>): WireProfile {
  if (env['AO_WIRE_PROFILE']) setWireProfile(parseWireProfile(env['AO_WIRE_PROFILE']));
  return current;
}
