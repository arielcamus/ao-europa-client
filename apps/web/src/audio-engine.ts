/*
 * Web Audio engine of the classic client. Replaces VB6 clsAudioEngine (DirectSound/BASS): sound effects are decoded once and cached,
 * music streams from an <audio> element, volumes follow the options window (ao20audio.bas CurFxVolume/CurMusicVolume/...).
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; no warranty. See ../../../LICENSE.
 *
 * Sound files are the user's local Recursos (never bundled), served by tools/local-assets.mjs. Like VB6 PlayWav, an effect looks for
 * OGG/<id>.ogg first and falls back to wav/<id>.wav; music is OGG/ost_<id>.ogg (PlayMapMusic).
 */
import { DEFAULT_AUDIO_SETTINGS, effectiveVolume, gainOf, panOf, sanitizeSettings } from './audio-rules.js';
import type { AudioSettings, FxCategory } from './audio-rules.js';

/** `unique`: PlayFxUniqueByLabel, an effect already playing under that label keeps playing (its sound is not restarted). */
export interface PlayOptions { loop?: boolean; volume?: number; pan?: number; label?: string; category?: FxCategory; unique?: boolean }
/** What the engine was asked to play, in order. A test fixture of the ids the server sends is this log. */
export interface AudioEvent {
  t: number; kind: 'wave' | 'ambient' | 'music' | 'stop'; id: string; category?: FxCategory;
  volume?: number; pan?: number; label?: string; source?: string; result?: 'pending' | 'played' | 'missing' | 'locked';
}
export interface AudioDeps {
  context?: () => AudioContext;
  loadBytes?: (url: string) => Promise<ArrayBuffer | undefined>;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | undefined;
  now?: () => number;
  /** Streams a music file; the first url that loads wins (OGG first, MP3 where the pack has one). */
  music?: (urls: string[]) => MusicStream;
}
export interface MusicStream { start(): Promise<boolean>; stop(): void; setGain(gain: number): void; /** The playing <audio> element, for diagnostics. */ element?(): HTMLMediaElement | undefined }

/** Decoded effects kept in memory (least recently used go first); the pack has ~2000 sounds. */
export const MAX_CACHED_BUFFERS = 96;
export const SETTINGS_KEY = 'ao.audio.settings.v1';
/** Which sound files the local Recursos holds (served as /ao-assets/audio-index.json); lower-case names without extension. */
export interface SoundCatalog { ogg: ReadonlySet<string>; wav: ReadonlySet<string>; mp3: ReadonlySet<string> }
export const parseCatalog = (raw: unknown): SoundCatalog | undefined => {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return undefined;
  const set = (value: unknown) => new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  return { ogg: set(o.ogg), wav: set(o.wav), mp3: set(o.mp3) };
};
const sfxUrls = (name: string, catalog?: SoundCatalog) => {
  const key = name.toLowerCase();
  const urls: string[] = [];
  if (!catalog || catalog.ogg.has(key)) urls.push(`/ao-assets/OGG/${encodeURIComponent(name)}.ogg`);
  if (!catalog || catalog.wav.has(key)) urls.push(`/ao-assets/wav/${encodeURIComponent(name)}.wav`);
  return urls;
};
/** OGG/ost_31.ogg is the one track that also ships as Mp3/31.mp3 (for browsers without Vorbis). */
export const musicUrls = (name: string, catalog?: SoundCatalog) => {
  const urls: string[] = [];
  if (!catalog || catalog.ogg.has(name.toLowerCase())) urls.push(`/ao-assets/OGG/${name}.ogg`);
  const mp3 = /^ost_(\d+)$/.exec(name);
  if (mp3 && (!catalog || catalog.mp3.has(mp3[1]!))) urls.push(`/ao-assets/Mp3/${mp3[1]}.mp3`);
  return urls;
};

interface Voice { id: string; label: string; category: FxCategory; source: AudioBufferSourceNode; gain: GainNode }

async function fetchBytes(url: string): Promise<ArrayBuffer | undefined> {
  try {
    const response = await fetch(url);
    return response.ok ? await response.arrayBuffer() : undefined;
  } catch { return undefined; }
}

export class AudioEngine {
  settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  readonly events: AudioEvent[] = [];
  private readonly listeners = new Set<(next: AudioSettings, previous: AudioSettings) => void>();
  /** Called after every settings change (the options window mirrors it). */
  subscribe(listener: (next: AudioSettings, previous: AudioSettings) => void) { this.listeners.add(listener); }
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private unlocked = false;
  private readonly buffers = new Map<string, Promise<AudioBuffer | undefined>>();
  private readonly voices = new Set<Voice>();
  private readonly uniquePending = new Set<string>();
  private ambient: Voice | undefined;
  private ambientId = 0;
  private music: { name: string; stream: MusicStream } | undefined;
  private desiredMusic: string | undefined;
  private suspended = false;
  private readonly deps: AudioDeps;
  private catalog: SoundCatalog | undefined;

  constructor(deps: AudioDeps = {}) {
    this.deps = deps;
    const storage = this.storage();
    try { const raw = storage?.getItem(SETTINGS_KEY); if (raw) this.settings = sanitizeSettings(JSON.parse(raw)); } catch { /* first run or blocked storage */ }
  }
  private storage() { try { return 'storage' in this.deps ? this.deps.storage : globalThis.localStorage; } catch { return undefined; } }
  private now() { return (this.deps.now ?? (() => performance.now()))(); }
  private log(event: Omit<AudioEvent, 't'>): AudioEvent {
    const entry: AudioEvent = { t: Math.round(this.now()), ...event };
    this.events.push(entry);
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
    return entry;
  }

  /** Tells the engine which files exist, so it requests only those (no 404 probes). Without it, every candidate is tried. */
  setCatalog(catalog: SoundCatalog | undefined) { this.catalog = catalog; this.buffers.clear(); }

  /** Browsers start an AudioContext suspended until a user gesture: call this from the first click or key press. */
  unlock(): void {
    if (this.unlocked) { void this.context?.resume(); return; }
    try {
      this.context = (this.deps.context ?? (() => new AudioContext()))();
      this.master = this.context.createGain(); this.master.connect(this.context.destination);
      void this.context.resume();
      this.unlocked = true;
    } catch { this.context = undefined; return; }
    if (this.desiredMusic) void this.startMusic(this.desiredMusic);
    if (this.ambientId) void this.startAmbient(this.ambientId);
  }
  get isUnlocked() { return this.unlocked; }

  update(patch: Partial<AudioSettings>): void {
    const previous = this.settings;
    this.settings = sanitizeSettings({ ...previous, ...patch });
    try { this.storage()?.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* storage full or blocked */ }
    const s = this.settings;
    // ao20audio.SetMusicVolume / SetFxVolume(ambient) apply at once to what is playing.
    this.music?.stream.setGain(gainOf(s.volMusic));
    if (this.ambient) this.ambient.gain.gain.value = gainOf(s.volAmbient);
    if (!this.musicOn() && this.music) this.stopMusicNow();
    if (!this.ambientOn()) this.stopAmbientNow();
    if (!s.audioEnabled || !s.fxEnabled) for (const voice of [...this.voices]) if (voice.category === 'general') this.stopVoice(voice);
    if (!s.audioEnabled || !s.stepsEnabled) for (const voice of [...this.voices]) if (voice.category === 'steps') this.stopVoice(voice);
    this.resumeMusic(); this.resumeAmbient();
    for (const listener of this.listeners) listener(s, previous);
  }
  private musicOn() { return this.settings.audioEnabled && this.settings.musicEnabled; }
  private ambientOn() { return this.settings.audioEnabled && this.settings.ambientEnabled; }
  private categoryOn(category: FxCategory) {
    const s = this.settings;
    if (!s.audioEnabled) return false;
    return category === 'steps' ? s.stepsEnabled : category === 'ambient' ? s.ambientEnabled : s.fxEnabled;
  }
  private categoryVolume(category: FxCategory) {
    const s = this.settings;
    return category === 'steps' ? s.volSteps : category === 'ambient' ? s.volAmbient : s.volFx;
  }

  /** ao20audio.PlayWav / PlayFx: one sound effect. `volume` is a DirectSound attenuation (0 = category volume). */
  playWave(id: string | number, options: PlayOptions = {}): Promise<boolean> { return this.playWaveNow(id, options).catch(() => false); }
  private async playWaveNow(id: string | number, options: PlayOptions): Promise<boolean> {
    const category = options.category ?? 'general';
    const name = String(id);
    if (!this.categoryOn(category)) return false;
    const volume = effectiveVolume(this.categoryVolume(category), options.volume ?? 0);
    const event = { kind: 'wave' as const, id: name, category, volume, pan: options.pan ?? 0, ...(options.label ? { label: options.label } : {}) };
    const entry = this.log({ ...event, result: this.unlocked && this.context ? 'pending' : 'locked' });
    if (!this.unlocked || !this.context) return false;
    const label = options.label ?? '';
    if (label && options.unique) {
      if (this.uniquePending.has(label) || [...this.voices].some(voice => voice.label === label)) return true;
      this.uniquePending.add(label);
    }
    if (label) for (const voice of [...this.voices]) if (voice.label === label && voice.id === name) this.stopVoice(voice);
    let buffer: AudioBuffer | undefined;
    try { buffer = await this.buffer(name); } finally { this.uniquePending.delete(label); }
    if (!buffer) { entry.result = 'missing'; return false; }
    if (!this.categoryOn(category)) return false;
    entry.result = 'played';
    this.start(buffer, name, label, category, Boolean(options.loop), volume, options.pan ?? 0);
    return true;
  }
  /** ao20audio.StopWav: stops every playing copy of a wave id, or of a label when given. */
  stopWave(id: string | number, label = ''): void {
    const name = String(id);
    this.log({ kind: 'stop', id: name, ...(label ? { label } : {}) });
    for (const voice of [...this.voices]) if (voice.id === name && (!label || voice.label === label)) this.stopVoice(voice);
  }
  private start(buffer: AudioBuffer, id: string, label: string, category: FxCategory, loop: boolean, volume: number, pan: number): Voice | undefined {
    const context = this.context, master = this.master;
    if (!context || !master) return undefined;
    const source = context.createBufferSource(); source.buffer = buffer; source.loop = loop;
    const gain = context.createGain(); gain.gain.value = gainOf(volume);
    let tail: AudioNode = gain;
    source.connect(gain);
    if (typeof context.createStereoPanner === 'function') {
      const panner = context.createStereoPanner(); panner.pan.value = panOf(pan); gain.connect(panner); tail = panner;
    }
    tail.connect(master);
    const voice: Voice = { id, label, category, source, gain };
    this.voices.add(voice);
    source.onended = () => { this.voices.delete(voice); try { tail.disconnect(); gain.disconnect(); } catch { /* already gone */ } };
    source.start();
    return voice;
  }
  private stopVoice(voice: Voice) {
    this.voices.delete(voice);
    try { voice.source.stop(); } catch { /* not started or already stopped */ }
  }
  private buffer(name: string): Promise<AudioBuffer | undefined> {
    let pending = this.buffers.get(name);
    if (pending) { this.buffers.delete(name); this.buffers.set(name, pending); } // most recently used last
    if (!pending) {
      pending = (async () => {
        const load = this.deps.loadBytes ?? fetchBytes;
        for (const url of sfxUrls(name, this.catalog)) {
          const bytes = await load(url);
          if (!bytes || !this.context) continue;
          try { return await this.context.decodeAudioData(bytes.slice(0)); } catch { /* try the wav fallback */ }
        }
        return undefined;
      })();
      this.buffers.set(name, pending);
      while (this.buffers.size > MAX_CACHED_BUFFERS) this.buffers.delete(this.buffers.keys().next().value as string);
    }
    return pending;
  }

  /** ao20audio.PlayAmbientAudio / PlayWeatherAudio: one looping ambient bed at a time; 0 stops it. */
  playAmbient(id: number): Promise<void> { return this.playAmbientNow(id).catch(() => undefined); }
  private async playAmbientNow(id: number): Promise<void> {
    if (id !== 0 && id === this.ambientId) return; // already the bed (a rain toggle then the map load): keep it running
    this.log({ kind: 'ambient', id: String(id), category: 'ambient', volume: this.settings.volAmbient });
    this.ambientId = id;
    if (!id || !this.ambientOn()) { this.stopAmbientNow(); return; }
    if (this.unlocked) await this.startAmbient(id);
  }
  stopAmbient(): void { this.ambientId = 0; this.stopAmbientNow(); }
  private async startAmbient(id: number) {
    const buffer = await this.buffer(String(id));
    if (!buffer || this.ambientId !== id || !this.ambientOn()) return;
    this.stopAmbientNow();
    this.ambient = this.start(buffer, String(id), 'ambient', 'ambient', true, this.settings.volAmbient, 0);
    if (this.ambient) this.voices.delete(this.ambient);
  }
  private stopAmbientNow() {
    if (this.ambient) { try { this.ambient.source.stop(); } catch { /* stopped */ } this.ambient = undefined; }
  }

  /** ao20audio.PlayMusic: streams OGG/<name>.ogg looping; the same track again is ignored; null stops (StopMusic). */
  playMusic(name: string | undefined): Promise<void> { return this.playMusicNow(name).catch(() => undefined); }
  private async playMusicNow(name: string | undefined): Promise<void> {
    this.log({ kind: 'music', id: name ?? '', volume: this.settings.volMusic });
    if (!name) { this.desiredMusic = undefined; this.stopMusicNow(); return; }
    if (this.desiredMusic === name && this.music) return;
    this.desiredMusic = name;
    if (this.musicOn() && this.unlocked) await this.startMusic(name);
  }
  /** Starts the wanted music again (the options window turned music back on). */
  resumeMusic(): void { if (this.desiredMusic && !this.music && this.musicOn() && this.unlocked) void this.startMusic(this.desiredMusic); }
  resumeAmbient(): void { if (this.ambientId && !this.ambient && this.ambientOn() && this.unlocked) void this.startAmbient(this.ambientId); }
  private async startMusic(name: string) {
    this.stopMusicNow();
    const stream = (this.deps.music ?? defaultMusic(() => this.context, () => this.master))(musicUrls(name, this.catalog));
    this.music = { name, stream };
    stream.setGain(gainOf(this.settings.volMusic));
    const ok = await stream.start();
    if (!ok && this.music?.stream === stream) this.music = undefined;
  }
  private stopMusicNow() {
    if (this.music) { this.music.stream.stop(); this.music = undefined; }
  }
  get currentMusic() { return this.music?.name; }
  /** Diagnostics for tests and the live check: the context state and the music element. */
  get status() {
    const element = this.music?.stream.element?.();
    return { context: this.context?.state, music: this.music?.name, musicPlaying: element ? !element.paused : undefined, musicTime: element?.currentTime };
  }
  get currentAmbient() { return this.ambientId; }

  /** VB6 PauseAllAudio / ResumeAllAudio on focus loss. */
  setSuspended(suspended: boolean): void {
    if (suspended === this.suspended || !this.context) return;
    this.suspended = suspended;
    void (suspended ? this.context.suspend() : this.context.resume());
  }
}

/** Music through an <audio> element: OGG files are 1-13 MB, decoding them whole would cost hundreds of MB of PCM. */
function defaultMusic(context: () => AudioContext | undefined, master: () => GainNode | undefined) {
  return (urls: string[]): MusicStream => {
    let element: HTMLAudioElement | undefined;
    let node: GainNode | undefined;
    let wanted = 1;
    let stopped = false;
    return {
      async start() {
        const ctx = context(), out = master();
        if (!ctx || !out) return false;
        for (const url of urls) {
          if (stopped) return false;
          const audio = new Audio();
          audio.loop = true; audio.preload = 'auto'; audio.crossOrigin = 'anonymous';
          const ok = await new Promise<boolean>(resolve => {
            audio.addEventListener('canplay', () => resolve(true), { once: true });
            audio.addEventListener('error', () => resolve(false), { once: true });
            audio.src = url;
          });
          if (!ok || stopped) { audio.removeAttribute('src'); audio.load(); continue; }
          element = audio;
          const source = ctx.createMediaElementSource(audio);
          node = ctx.createGain(); node.gain.value = wanted;
          source.connect(node); node.connect(out);
          try { await audio.play(); return true; } catch { return false; }
        }
        return false;
      },
      stop() {
        stopped = true;
        if (element) { element.pause(); element.removeAttribute('src'); element.load(); }
        try { node?.disconnect(); } catch { /* gone */ }
        element = undefined; node = undefined;
      },
      setGain(gain) { wanted = gain; if (node) node.gain.value = gain; },
      element: () => element,
    };
  };
}
