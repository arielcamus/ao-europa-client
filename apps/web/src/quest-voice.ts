/*
 * Quest voice-over, adapted 2026-11-21 from client ModUtils.bas (PlayQuestDescAudio, PlayQuestFinalDescAudio, StopQuestDescAudio,
 * ResolveLocalizedAudioId) and ao20audio.bas (QUEST_DESC_AUDIO_LABEL). Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later;
 * no warranty. See NOTICE. One voice at a time: starting a new one stops the previous one (same label).
 */
import type { AudioEngine } from './audio-engine.js';

/** ao20audio.QUEST_DESC_AUDIO_LABEL. */
export const QUEST_DESC_AUDIO_LABEL = 'quest_desc_audio';

/**
 * ResolveLocalizedAudioId: an id already prefixed ("en_123": a "_" at position 3) is used as is, Spanish plays the base id, any other
 * language plays "<lang>_<id>" (the client asks GetLocalizedFilename, which falls back to the base id; the browser has no file test here,
 * so the engine's missing-file result is the fallback: see `QuestVoice.play`).
 */
export function resolveQuestAudio(baseName: string, language: string): { primary: string; fallback?: string } | undefined {
  const base = baseName.trim();
  if (base === '') return undefined;
  if (base[2] === '_' || language === 'es') return { primary: base };
  return { primary: `${language}_${base}`, fallback: base };
}

export type QuestVoiceEngine = Pick<AudioEngine, 'playWave' | 'stopWave'>;

export class QuestVoice {
  /** SndDescNpcsQuestEnabled (frmOpciones, default 1). */
  enabled = true;
  private playing: string | undefined;
  constructor(private readonly engine: QuestVoiceEngine, private readonly language: () => string) {}

  /** StopQuestDescAudio. */
  stop() {
    if (this.playing !== undefined) this.engine.stopWave(this.playing, QUEST_DESC_AUDIO_LABEL);
    this.playing = undefined;
  }
  /** PlayQuestDescAudio / PlayQuestFinalDescAudio: `audio` is the quest's DESCAUDIO or DESCFINALAUDIO value ('' plays nothing, after stopping the last one). */
  play(audio: string) {
    if (!this.enabled) return;
    this.stop();
    const choice = resolveQuestAudio(audio, this.language());
    if (!choice) return;
    this.playing = choice.primary;
    void this.engine.playWave(choice.primary, { label: QUEST_DESC_AUDIO_LABEL }).then(played => {
      if (!played && choice.fallback && this.playing === choice.primary) { this.playing = choice.fallback; void this.engine.playWave(choice.fallback, { label: QUEST_DESC_AUDIO_LABEL }); }
    });
  }
}
