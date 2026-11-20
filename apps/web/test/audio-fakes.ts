import type { AudioDeps, MusicStream } from '../src/audio-engine.js';

/** A recording stand-in for the Web Audio API: enough nodes to see what was started, with which gain and pan. */
export interface Started { buffer: unknown; loop: boolean; gain: number; pan: number | undefined; stopped: boolean }
export function fakeAudio(options: { decodable?: (bytes: ArrayBuffer) => boolean } = {}) {
  const started: Started[] = [];
  const musicLog: Array<{ urls: string[]; gain: number; stopped: boolean }> = [];
  const requested: string[] = [];
  let resumed = 0, suspended = 0;
  const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1 }, pan: { value: 0 } });
  const context = {
    state: 'suspended', destination: {},
    createGain: node,
    createStereoPanner: node,
    createBufferSource() {
      const record: Started = { buffer: undefined, loop: false, gain: 1, pan: undefined, stopped: false };
      const source = {
        set buffer(value: unknown) { record.buffer = value; }, set loop(value: boolean) { record.loop = value; }, onended: undefined as (() => void) | undefined,
        connect(target: { gain?: { value: number }; pan?: { value: number } }) { void target; }, disconnect() {},
        start() { started.push(record); }, stop() { record.stopped = true; },
      };
      sources.push({ record, source });
      return source;
    },
    async decodeAudioData(bytes: ArrayBuffer) {
      if (options.decodable && !options.decodable(bytes)) throw new Error('EncodingError');
      return { length: bytes.byteLength } as unknown as AudioBuffer;
    },
    resume() { resumed++; return Promise.resolve(); }, suspend() { suspended++; return Promise.resolve(); },
  };
  const sources: Array<{ record: Started; source: { connect(target: unknown): void } }> = [];
  const gainNodes: Array<{ gain: { value: number } }> = [];
  const original = context.createGain;
  context.createGain = () => { const n = original(); gainNodes.push(n); return n; };
  const panners: Array<{ pan: { value: number } }> = [];
  const originalPan = context.createStereoPanner;
  context.createStereoPanner = () => { const n = originalPan(); panners.push(n); return n; };
  const files = new Map<string, number>();
  const deps: AudioDeps = {
    context: () => context as unknown as AudioContext,
    loadBytes: async url => { requested.push(url); const size = files.get(url); return size === undefined ? undefined : new ArrayBuffer(size); },
    storage: memoryStorage(),
    now: () => 0,
    music: (urls): MusicStream => {
      const entry = { urls, gain: 1, stopped: false }; musicLog.push(entry);
      return { async start() { return true; }, stop() { entry.stopped = true; }, setGain(gain) { entry.gain = gain; } };
    },
  };
  return { deps, files, requested, started, musicLog, gainNodes, panners, resumed: () => resumed, suspended: () => suspended };
}
export function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data };
}
