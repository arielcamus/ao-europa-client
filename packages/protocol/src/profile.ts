/*
 * Wire-layout profile (server side of the connection). 2026-11-21.
 *
 * Ariel (21 Nov) approved rebuilding the VB6 server at the last pre-HOO commit (server-classic 9ccd7fad, client-classic 619e69d). The
 * live server today is HOO-era (caac3133, 19 Nov). Eight server->client packets grew fields AFTER the pin (see docs/PINNED-LAYOUTS.md):
 * ConsoleMsg and LocaleMsg (+channel), CharacterCreate (+clanAlignment), UpdateTagAndStatus (+clanIndex, +clanAlignment),
 * FYA (+strength/agility base), GuildNews and GuildLeaderInfo (exp and exp-needed Int16 -> Int32), QuestDetails (+talkTo, +deliverMap).
 *
 * DECODING is version-tolerant and needs no profile: the trailing fields are read only when bytes remain (a frame holds exactly one
 * packet) and the two exp pairs are told apart by how many bytes are left (4 = Int16 pair, 8 = Int32 pair).
 * ENCODING (the stand-in server, the mock servers, the tests) follows the profile, because a writer must pick one layout.
 * 'live' stays the default until the server swap; flip it with setWireProfile('prehoo') or AO_WIRE_PROFILE=prehoo.
 */
export type WireProfile = 'prehoo' | 'live';
export const WIRE_PROFILES: readonly WireProfile[] = ['prehoo', 'live'];

let current: WireProfile = 'live';

export const getWireProfile = (): WireProfile => current;
export const isPreHoo = (): boolean => current === 'prehoo';

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
