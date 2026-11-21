import { describe, expect, it } from 'vitest';
import { AudioEngine, SETTINGS_KEY, musicUrls, parseCatalog } from '../src/audio-engine.js';
import { fakeAudio, memoryStorage } from './audio-fakes.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('audio engine', () => {
  it('stays silent and logs "locked" until a user gesture unlocks the context', async () => {
    const f = fakeAudio(); f.files.set('/ao-assets/OGG/2.ogg', 10);
    const engine = new AudioEngine(f.deps);
    expect(await engine.playWave(2)).toBe(false);
    expect(engine.events.at(-1)).toMatchObject({ kind: 'wave', id: '2', result: 'locked' });
    expect(f.started).toHaveLength(0);
    engine.unlock();
    expect(engine.isUnlocked).toBe(true);
    expect(await engine.playWave(2)).toBe(true);
    expect(f.started).toHaveLength(1);
    expect(engine.events.at(-1)).toMatchObject({ result: 'played' });
  });
  it('looks for the OGG first, then the wav, and caches the decoded buffer', async () => {
    const f = fakeAudio(); f.files.set('/ao-assets/wav/145%20.wav', 8);
    const engine = new AudioEngine(f.deps); engine.unlock();
    expect(await engine.playWave('145 ')).toBe(true);
    expect(f.requested).toEqual(['/ao-assets/OGG/145%20.ogg', '/ao-assets/wav/145%20.wav']);
    await engine.playWave('145 ');
    expect(f.requested).toHaveLength(2); // second play is from the cache
    expect(f.started).toHaveLength(2);
  });
  it('falls back to the wav when the browser cannot decode the OGG', async () => {
    const f = fakeAudio({ decodable: bytes => bytes.byteLength !== 5 });
    f.files.set('/ao-assets/OGG/7.ogg', 5); f.files.set('/ao-assets/wav/7.wav', 9);
    const engine = new AudioEngine(f.deps); engine.unlock();
    expect(await engine.playWave(7)).toBe(true);
    expect(f.requested).toEqual(['/ao-assets/OGG/7.ogg', '/ao-assets/wav/7.wav']);
  });
  it('logs a missing sound once and never throws', async () => {
    const f = fakeAudio(); const engine = new AudioEngine(f.deps); engine.unlock();
    expect(await engine.playWave(9999)).toBe(false);
    expect(await engine.playWave(9999)).toBe(false);
    expect(f.requested).toHaveLength(2); // one lookup of both files, cached afterwards
    expect(engine.events.filter(e => e.result === 'missing')).toHaveLength(2);
  });
  it('plays at the quieter of the category volume and the request, with pan', async () => {
    const f = fakeAudio(); f.files.set('/ao-assets/OGG/2.ogg', 4);
    const engine = new AudioEngine(f.deps); engine.unlock();
    engine.update({ volFx: -2000 });
    await engine.playWave(2, { volume: -600, pan: 3000 });
    expect(engine.events.at(-1)).toMatchObject({ volume: -2000, pan: 3000 });
    const gains = f.gainNodes.map(n => n.gain.value);
    expect(gains).toContain(0.1);
    expect(f.panners.at(-1)!.pan.value).toBeCloseTo(0.3);
  });
  it('honours the per-category switches and the master switch', async () => {
    const f = fakeAudio(); f.files.set('/ao-assets/OGG/23.ogg', 4);
    const engine = new AudioEngine(f.deps); engine.unlock();
    engine.update({ stepsEnabled: false });
    expect(await engine.playWave(23, { category: 'steps' })).toBe(false);
    expect(await engine.playWave(23)).toBe(true);
    engine.update({ fxEnabled: false });
    expect(await engine.playWave(23)).toBe(false);
    engine.update({ fxEnabled: true, audioEnabled: false });
    expect(await engine.playWave(23)).toBe(false);
  });
  it('replaces a playing copy with the same label and keeps a unique one running', async () => {
    const f = fakeAudio(); f.files.set('/ao-assets/OGG/23.ogg', 4); f.files.set('/ao-assets/OGG/50.ogg', 4);
    const engine = new AudioEngine(f.deps); engine.unlock();
    await engine.playWave(23, { label: 'pasos1_1' });
    await engine.playWave(23, { label: 'pasos1_1' });
    expect(f.started.map(s => s.stopped)).toEqual([true, false]);
    await engine.playWave(50, { label: 'sailing_1', unique: true });
    await engine.playWave(50, { label: 'sailing_1', unique: true });
    expect(f.started).toHaveLength(3);
    engine.stopWave(50);
    expect(f.started[2]!.stopped).toBe(true);
  });
  it('StopAllWavsMatchingLabel stops every sound under a label, also a unique one still loading, and logs nothing when none plays', async () => {
    const f = fakeAudio(); f.files.set('/ao-assets/OGG/50.ogg', 4); f.files.set('/ao-assets/OGG/23.ogg', 4);
    const engine = new AudioEngine(f.deps); engine.unlock();
    await engine.playWave(50, { label: 'sailing_7', unique: true });
    await engine.playWave(23, { label: 'sailing_8', unique: true });
    engine.stopLabel('sailing_7');
    expect(f.started.map(s => s.stopped)).toEqual([true, false]);
    const events = engine.events.length;
    engine.stopLabel('sailing_9');
    expect(engine.events.length).toBe(events);
    const loading = engine.playWave(50, { label: 'sailing_9', unique: true });
    engine.stopLabel('sailing_9'); // erased while its buffer is being fetched: it never starts
    expect(await loading).toBe(false);
    expect(f.started).toHaveLength(2);
    expect(await engine.playWave(50, { label: 'sailing_9', unique: true })).toBe(true); // the cancel is used up
  });
  it('remembers the settings in localStorage and sanitizes them on load', () => {
    const storage = memoryStorage();
    const first = new AudioEngine({ ...fakeAudio().deps, storage });
    first.update({ musicEnabled: false, volFx: -1500 });
    expect(JSON.parse(storage.data.get(SETTINGS_KEY)!)).toMatchObject({ musicEnabled: false, volFx: -1500 });
    const second = new AudioEngine({ ...fakeAudio().deps, storage });
    expect(second.settings).toMatchObject({ musicEnabled: false, volFx: -1500 });
    const hostile = new AudioEngine({ ...fakeAudio().deps, storage: memoryStorage({ [SETTINGS_KEY]: '{"volFx": 999, "fxEnabled": "yes"}' }) });
    expect(hostile.settings).toMatchObject({ volFx: 0, fxEnabled: true });
    const broken = new AudioEngine({ ...fakeAudio().deps, storage: memoryStorage({ [SETTINGS_KEY]: '{nope' }) });
    expect(broken.settings.audioEnabled).toBe(true);
    const noStorage = new AudioEngine({ ...fakeAudio().deps, storage: undefined });
    expect(() => noStorage.update({ volFx: -10 })).not.toThrow();
  });
  it('loops one ambient bed at a time and turns it back on with the option', async () => {
    const f = fakeAudio(); f.files.set('/ao-assets/OGG/191.ogg', 4); f.files.set('/ao-assets/OGG/194.ogg', 4);
    const engine = new AudioEngine(f.deps); engine.unlock();
    await engine.playAmbient(191); await tick();
    await engine.playAmbient(194); await tick();
    expect(f.started.map(s => [s.loop, s.stopped])).toEqual([[true, true], [true, false]]);
    engine.update({ ambientEnabled: false });
    expect(f.started[1]!.stopped).toBe(true);
    engine.update({ ambientEnabled: true }); await tick();
    expect(f.started).toHaveLength(3);
    expect(engine.currentAmbient).toBe(194);
    engine.stopAmbient();
    expect(f.started[2]!.stopped).toBe(true);
  });
  it('streams music, ignores the same track again, follows the volume and the switch, and starts after the gesture', async () => {
    const f = fakeAudio(); const engine = new AudioEngine(f.deps);
    await engine.playMusic('ost_3'); // before any gesture: remembered, not started
    expect(f.musicLog).toHaveLength(0);
    engine.unlock(); await tick();
    expect(f.musicLog).toHaveLength(1);
    expect(f.musicLog[0]!.urls).toEqual(['/ao-assets/OGG/ost_3.ogg', '/ao-assets/Mp3/3.mp3']);
    await engine.playMusic('ost_3');
    expect(f.musicLog).toHaveLength(1);
    engine.update({ volMusic: -2000 });
    expect(f.musicLog[0]!.gain).toBeCloseTo(0.1);
    engine.update({ musicEnabled: false });
    expect(f.musicLog[0]!.stopped).toBe(true);
    expect(engine.currentMusic).toBeUndefined();
    engine.update({ musicEnabled: true }); await tick();
    expect(f.musicLog).toHaveLength(2);
    await engine.playMusic('ost_4'); await tick();
    expect(f.musicLog[1]!.stopped).toBe(true);
    expect(engine.currentMusic).toBe('ost_4');
    await engine.playMusic(undefined);
    expect(f.musicLog[2]!.stopped).toBe(true);
    engine.update({ musicEnabled: false }); engine.update({ musicEnabled: true }); await tick();
    expect(f.musicLog).toHaveLength(3); // nothing wanted, nothing started
  });
  it('requests only the files the catalog lists, so a wav-only sound never probes a missing OGG', async () => {
    const f = fakeAudio(); f.files.set('/ao-assets/wav/69.wav', 6); f.files.set('/ao-assets/OGG/2.ogg', 6);
    const engine = new AudioEngine(f.deps); engine.unlock();
    engine.setCatalog(parseCatalog({ ogg: ['2', 'ost_3'], wav: ['69', '145 '], mp3: ['31'] }));
    await engine.playWave(69); await engine.playWave(2); await engine.playWave('145 '); await engine.playWave(404);
    expect(f.requested).toEqual(['/ao-assets/wav/69.wav', '/ao-assets/OGG/2.ogg', '/ao-assets/wav/145%20.wav']);
    expect(parseCatalog(null)).toBeUndefined();
    expect(parseCatalog({ ogg: [1, 'a'] })!.ogg.has('a')).toBe(true);
  });
  it('keeps at most 96 decoded buffers, dropping the least recently used, and runs a unique label once while loading', async () => {
    const f = fakeAudio(); for (let i = 1; i <= 100; i++) f.files.set(`/ao-assets/OGG/${i}.ogg`, 4);
    const engine = new AudioEngine(f.deps); engine.unlock();
    for (let i = 1; i <= 100; i++) await engine.playWave(i);
    f.requested.length = 0;
    await engine.playWave(100); await engine.playWave(1);
    expect(f.requested).toEqual(['/ao-assets/OGG/1.ogg']); // 100 cached, 1 was evicted
    const before = f.started.length;
    await Promise.all([engine.playWave(50, { label: 'u', unique: true }), engine.playWave(50, { label: 'u', unique: true })]);
    expect(f.started.length - before).toBe(1);
  });
  it('never rejects: a failing context is swallowed', async () => {
    const f = fakeAudio(); const engine = new AudioEngine({ ...f.deps, loadBytes: async () => { throw new Error('boom'); } }); engine.unlock();
    await expect(engine.playWave(1)).resolves.toBe(false);
    await expect(engine.playAmbient(3)).resolves.toBeUndefined();
  });
  it('lists the Mp3 only for tracks the pack ships twice', () => {
    expect(musicUrls('ost_31', parseCatalog({ ogg: [], mp3: ['31'] }))).toEqual(['/ao-assets/Mp3/31.mp3']);
    expect(musicUrls('ost_4', parseCatalog({ ogg: ['ost_4'], mp3: ['31'] }))).toEqual(['/ao-assets/OGG/ost_4.ogg']);
    expect(musicUrls('ost_mainmenu_01')).toEqual(['/ao-assets/OGG/ost_mainmenu_01.ogg']);
  });
  it('suspends and resumes the context with the page', () => {
    const f = fakeAudio(); const engine = new AudioEngine(f.deps); engine.unlock();
    engine.setSuspended(true); engine.setSuspended(true); engine.setSuspended(false);
    expect([f.suspended(), f.resumed()]).toEqual([1, 2]);
  });
});
