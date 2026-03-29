/**
 * src/shell/audio.ts
 * ═══════════════════════════════════════════════════════════════════════
 * Web Audio API synthesis engine. All sounds are generated procedurally
 * using oscillators, noise bursts, and frequency sweeps — no external
 * audio files are required.
 *
 * Converted from client/shell.js AudioManager.
 * ═══════════════════════════════════════════════════════════════════════
 */

/* ─── Sound definition types ─────────────────────────────────────── */

interface NoiseSoundDef {
  type: 'noise';
  dur: number;
  freq: number;
  decay: number;
  gain: number;
  bus?: 'sfx' | 'ui';
}

interface ToneSoundDef {
  type: 'tone';
  dur: number;
  freq: number;
  decay: number;
  gain: number;
  wave: OscillatorType;
  bus?: 'sfx' | 'ui';
}

interface SweepSoundDef {
  type: 'sweep';
  dur: number;
  freqStart: number;
  freqEnd: number;
  gain: number;
  bus?: 'sfx' | 'ui';
}

type SoundDef = NoiseSoundDef | ToneSoundDef | SweepSoundDef;

/** Valid audio bus identifiers */
export type AudioBus = 'master' | 'sfx' | 'ui';

/** All registered sound IDs */
export type SoundId = keyof typeof SOUNDS;

/* ─── Sound definitions — synthesized on demand ──────────────────── */

const SOUNDS = {
  // ── Weapon fire (noise burst filtered at freq) ──
  fire_ar:      { type: 'noise', dur: 0.08, freq: 200,  decay: 0.06, gain: 0.4  } as NoiseSoundDef,
  fire_smg:     { type: 'noise', dur: 0.05, freq: 280,  decay: 0.04, gain: 0.35 } as NoiseSoundDef,
  fire_sg:      { type: 'noise', dur: 0.12, freq: 140,  decay: 0.1,  gain: 0.5  } as NoiseSoundDef,
  fire_mk:      { type: 'noise', dur: 0.1,  freq: 160,  decay: 0.08, gain: 0.45 } as NoiseSoundDef,
  fire_ps:      { type: 'noise', dur: 0.06, freq: 320,  decay: 0.04, gain: 0.3  } as NoiseSoundDef,
  fire_lmg:     { type: 'noise', dur: 0.07, freq: 180,  decay: 0.05, gain: 0.4  } as NoiseSoundDef,

  // ── Impacts ──
  hit_shield:   { type: 'tone',  dur: 0.1,  freq: 800,  decay: 0.08, gain: 0.25, wave: 'sine'     } as ToneSoundDef,
  hit_flesh:    { type: 'tone',  dur: 0.08, freq: 400,  decay: 0.06, gain: 0.3,  wave: 'sawtooth'  } as ToneSoundDef,
  hit_head:     { type: 'tone',  dur: 0.12, freq: 1200, decay: 0.1,  gain: 0.3,  wave: 'sine'     } as ToneSoundDef,
  shield_break: { type: 'sweep', dur: 0.3,  freqStart: 1000, freqEnd: 200,  gain: 0.35 } as SweepSoundDef,
  down:         { type: 'sweep', dur: 0.5,  freqStart: 600,  freqEnd: 100,  gain: 0.3  } as SweepSoundDef,

  // ── Actions ──
  reload_start: { type: 'tone',  dur: 0.15, freq: 500,  decay: 0.12, gain: 0.15, wave: 'triangle' } as ToneSoundDef,
  reload_end:   { type: 'tone',  dur: 0.1,  freq: 700,  decay: 0.08, gain: 0.2,  wave: 'triangle' } as ToneSoundDef,
  swap_weapon:  { type: 'tone',  dur: 0.08, freq: 600,  decay: 0.06, gain: 0.15, wave: 'triangle' } as ToneSoundDef,
  pickup:       { type: 'tone',  dur: 0.12, freq: 900,  decay: 0.1,  gain: 0.2,  wave: 'sine'     } as ToneSoundDef,
  consumable:   { type: 'sweep', dur: 0.4,  freqStart: 400,  freqEnd: 800,  gain: 0.2  } as SweepSoundDef,

  // ── Abilities ──
  ability_tac:  { type: 'sweep', dur: 0.25, freqStart: 300,  freqEnd: 900,  gain: 0.25 } as SweepSoundDef,
  ability_ult:  { type: 'sweep', dur: 0.5,  freqStart: 200,  freqEnd: 1200, gain: 0.35 } as SweepSoundDef,

  // ── Traversal ──
  zip_start:    { type: 'tone',  dur: 0.2,  freq: 350,  decay: 0.15, gain: 0.2,  wave: 'sawtooth' } as ToneSoundDef,
  pad_launch:   { type: 'sweep', dur: 0.3,  freqStart: 200,  freqEnd: 800,  gain: 0.3  } as SweepSoundDef,

  // ── UI ──
  ui_click:     { type: 'tone',  dur: 0.04, freq: 1000, decay: 0.03, gain: 0.1,  wave: 'sine',    bus: 'ui' } as ToneSoundDef,
  ui_hover:     { type: 'tone',  dur: 0.02, freq: 800,  decay: 0.015,gain: 0.05, wave: 'sine',    bus: 'ui' } as ToneSoundDef,
  ui_error:     { type: 'tone',  dur: 0.15, freq: 200,  decay: 0.12, gain: 0.15, wave: 'sawtooth',bus: 'ui' } as ToneSoundDef,
  ui_confirm:   { type: 'sweep', dur: 0.15, freqStart: 600,  freqEnd: 1000, gain: 0.12, bus: 'ui' } as SweepSoundDef,

  // ── Match ──
  match_start:  { type: 'sweep', dur: 0.8,  freqStart: 200,  freqEnd: 600,  gain: 0.25 } as SweepSoundDef,
  kill_confirm: { type: 'tone',  dur: 0.15, freq: 1400, decay: 0.12, gain: 0.2,  wave: 'sine'     } as ToneSoundDef,

  // ── Ring ──
  ring_warning: { type: 'sweep', dur: 0.6,  freqStart: 800,  freqEnd: 300,  gain: 0.2  } as SweepSoundDef,
  ring_closing: { type: 'tone',  dur: 0.3,  freq: 250,  decay: 0.25, gain: 0.15, wave: 'sawtooth' } as ToneSoundDef,
} as const;

/* ─── AudioManager class ─────────────────────────────────────────── */

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private uiGain: GainNode | null = null;
  private muted = false;
  private volumes = { master: 0.5, sfx: 0.7, ui: 0.5 };

  /** Sound definition table, exposed for inspection */
  readonly SOUNDS = SOUNDS;

  /**
   * Initialize the AudioContext. Must be called after a user gesture
   * (click / keypress) to comply with browser autoplay policies.
   */
  init(): void {
    this.ensureCtx();
  }

  /**
   * Play a synthesized sound by its registered ID.
   * @param id - One of the predefined sound IDs (e.g. 'fire_ar', 'ui_click')
   */
  play(id: string): void {
    if (this.muted) return;
    this.ensureCtx();
    const def = (SOUNDS as Record<string, SoundDef>)[id];
    if (!def || !this.ctx || !this.sfxGain || !this.uiGain) return;

    const ctx = this.ctx;
    const dest = def.bus === 'ui' ? this.uiGain : this.sfxGain;
    const now = ctx.currentTime;

    if (def.type === 'noise') {
      this.playNoise(ctx, def, dest, now);
    } else if (def.type === 'tone') {
      this.playTone(ctx, def, dest, now);
    } else if (def.type === 'sweep') {
      this.playSweep(ctx, def, dest, now);
    }
  }

  /**
   * Set volume for a specific audio bus.
   * @param bus - 'master', 'sfx', or 'ui'
   * @param value - Volume level clamped to 0..1
   */
  setVolume(bus: AudioBus, value: number): void {
    value = Math.max(0, Math.min(1, value));
    this.volumes[bus] = value;
    if (bus === 'master' && this.masterGain) this.masterGain.gain.value = value;
    if (bus === 'sfx' && this.sfxGain) this.sfxGain.gain.value = value;
    if (bus === 'ui' && this.uiGain) this.uiGain.gain.value = value;
  }

  /**
   * Get current volume for a bus.
   * @param bus - 'master', 'sfx', or 'ui'
   */
  getVolume(bus: AudioBus): number {
    return this.volumes[bus];
  }

  /**
   * Mute or unmute all audio output.
   * @param muted - true to mute, false to unmute
   */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.value = muted ? 0 : this.volumes.master;
    }
  }

  /** Check whether audio is currently muted */
  isMuted(): boolean {
    return this.muted;
  }

  /** Toggle mute state and return the new state */
  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * Restore volume levels from previously saved settings.
   * @param saved - Object with master/sfx/ui volume values
   */
  restore(saved: Partial<Record<AudioBus, number>>): void {
    if (saved) {
      Object.assign(this.volumes, saved);
    }
  }

  /* ── Private helpers ────────────────────────────────────────────── */

  /** Lazily create AudioContext and gain nodes */
  private ensureCtx(): void {
    if (!this.ctx) {
      this.ctx = new (
        (window as any).AudioContext || (window as any).webkitAudioContext
      )();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volumes.master;
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.volumes.sfx;
      this.sfxGain.connect(this.masterGain);

      this.uiGain = this.ctx.createGain();
      this.uiGain.gain.value = this.volumes.ui;
      this.uiGain.connect(this.masterGain);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /** Play a white-noise burst filtered at a given frequency */
  private playNoise(
    ctx: AudioContext,
    def: NoiseSoundDef,
    dest: AudioNode,
    now: number,
  ): void {
    const bufSize = Math.ceil(ctx.sampleRate * def.dur);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = def.freq;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(def.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + def.decay);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(now);
    src.stop(now + def.dur);
  }

  /** Play a single oscillator tone with decay envelope */
  private playTone(
    ctx: AudioContext,
    def: ToneSoundDef,
    dest: AudioNode,
    now: number,
  ): void {
    const osc = ctx.createOscillator();
    osc.type = def.wave || 'sine';
    osc.frequency.value = def.freq;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(def.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + def.decay);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + def.dur);
  }

  /** Play a frequency sweep (rising or falling) */
  private playSweep(
    ctx: AudioContext,
    def: SweepSoundDef,
    dest: AudioNode,
    now: number,
  ): void {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(def.freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(def.freqEnd, now + def.dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(def.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + def.dur);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + def.dur + 0.01);
  }
}

/** Global singleton audio manager */
export const Audio = new AudioManager();
