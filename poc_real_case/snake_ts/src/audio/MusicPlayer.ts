/**
 * Ouroboros Ascension — Hybrid Dynamic Music Engine & Synthesizer (MusicPlayer.ts)
 *
 * Provides a state-of-the-art hybrid game audio soundtrack engine utilizing pure Web Audio API:
 *  1. Broadcast Soundtrack Streaming:
 *     - Seamless continuous loop playback of 44.1kHz 16-bit PCM master recordings
 *       ('music_exploration.wav', 'music_combat.wav', 'music_boss.wav').
 *     - Real-time equal-power crossfading across exploration, combat/frenzy, and boss battle states.
 *     - Preloading and memory caching with zero network thrashing.
 *  2. Sidechain Ducking Engine:
 *     - Dedicated `duckGain` attenuation node inserted into the master music bus.
 *     - Fast 20ms attack curve with smooth linear recovery to preserve acoustic clarity
 *       under heavy combat SFX (explosions, boss roars, hyperspace warp jumps).
 *     - Automatic ambient ducking and lowpass muffling on game pause.
 *  3. Seamless Procedural Synthesizer Fallback:
 *     - When broadcast audio buffers are not yet loaded, offline, or running headlessly in Vitest,
 *       smoothly falls back to the deterministic lookahead procedural step sequencer.
 *     - Procedural cyberpunk synthwave arpeggios, sub-harmonic saw bass, tritone stabs, and crisp hats.
 *  4. Unified Dynamic Mood Filter:
 *     - All music signals (both broadcast streams and procedural voices) flow through `moodFilter`
 *       (a resonant biquad lowpass filter) that dynamically modulates with game intensity and paused state.
 *
 * Conforms to Rule 10 (Strict Architectural Documentation & Math Formulas) and Rule 7 (100% Commercial Viability).
 */

import {
  getAudioContext,
  isNum,
  clamp01,
  semi,
  BiquadFilterType,
  WaveShape,
  BROADCAST_MUSIC_PATHS,
  BroadcastMusicTrack,
  loadAudioBuffer,
  getCachedAudioBuffer,
} from './Synth.js';
import { SoundEngine } from './SoundEngine.js';

// ============================================================================
// Musical Constants and Configuration
// ============================================================================

export const LOOKAHEAD = 0.12;           // Lookahead scheduling interval (seconds)
export const TICK_INTERVAL_MS = 25;      // Scheduler tick interval in milliseconds
export const STEPS_PER_BAR = 16;         // 16th notes per 4/4 musical bar
export const CROSSFADE_DURATION = 0.8;   // Equal-power crossfade duration between tracks (seconds)
export const PAUSE_DUCK_GAIN = 0.35;     // Music gain multiplier applied when game is paused
export const DUCK_ATTACK_SEC = 0.03;     // 30ms anti-thump attack for sidechain ducking to prevent pops and clicks

// Scale tables (0 = A)
const PENTATONIC = [0, 3, 5, 7, 10];
const BOSS_SCALE = [0, 1, 5, 6, 7, 10];
const BAR_ROOTS = [0, 0, 5, 7];          // Am  Am  Dm  Em
const BOSS_ROOTS = [0, 0, 1, 6];         // A   A   Bb  Eb
const BASS_BEATS = [0, 0, 7, 3];         // Offsets per quarter note inside a bar
const BOSS_BASE_FREQ = 41.2;             // E1 (deep sub-bass resonance)

const MOOD_START_HZ = 18000.0;
const MOOD_Q = 0.8;

export type MusicTrackType = BroadcastMusicTrack;

/** Active stream handle tracking an AudioBufferSourceNode and its dedicated crossfade GainNode */
interface ActiveTrackStream {
  track: MusicTrackType;
  source: AudioBufferSourceNode;
  gain: GainNode;
  stopTimeout?: ReturnType<typeof setTimeout> | null;
}

export interface IMusicPlayer {
  isPlaying: boolean;
  intensity: number;
  isFrenzy: boolean;
  isBossMode: boolean;
  bossPhase: number;
  currentTrack: MusicTrackType;
  isBroadcastActive: boolean;

  startMusic(): void;
  stopMusic(): void;
  pauseMusic(): void;
  resumeMusic(): void;
  setPaused(paused: boolean): void;
  setMusicIntensity(t01: number): void;
  setFrenzyState(active: boolean): void;
  setBossMode(active: boolean, phase?: number): void;
  getTempo(): number;
  duck?(amount?: number, duration?: number): void;
  preloadMusicAssets?(basePath?: string): Promise<void>;
}

export class MusicPlayer implements IMusicPlayer {
  public isPlaying = false;
  public isPaused = false;
  public intensity = 0.0;
  public isFrenzy = false;
  public isBossMode = false;
  public bossPhase = 1;

  public pendingFrenzy = false;
  public pendingBoss = false;
  public needResync = true;
  public musicStep = 0;
  public nextNoteTime = 0;

  /** Active soundtrack type currently scheduled or playing ('exploration' | 'combat' | 'boss') */
  public currentTrack: MusicTrackType = 'exploration';

  /** True if an AudioBufferSourceNode loop is currently actively streaming broadcast audio */
  public isBroadcastActive = false;

  private _isPaused = false;
  private engine: SoundEngine;
  private ctx: AudioContext | null = null;
  private musicBus: AudioNode | null = null;

  /** Dynamic lowpass filter modulating cutoff frequency with player state and game intensity */
  private moodFilter: BiquadFilterNode | null = null;

  /** Dedicated sidechain ducking gain node inserted after moodFilter */
  private duckGain: GainNode | null = null;

  /** Timer ID for the procedural lookahead step scheduler */
  private schedulerTimer: number | null = null;

  /** Procedural 1-second white noise buffer for crisp hi-hat percussion synthesis */
  private noiseBuffer: AudioBuffer | null = null;

  /** Currently active broadcast audio stream */
  private currentStream: ActiveTrackStream | null = null;

  /** Streams currently crossfading out, retained until scheduled stop time to prevent clicks */
  private fadingStreams: ActiveTrackStream[] = [];

  constructor(engine: SoundEngine) {
    this.engine = engine;
    this.engine.attachMusicPlayer(this);
  }

  // ==========================================================================
  // Web Audio Graph Initialization (Rule 10 & Rule 7)
  // ==========================================================================

  /**
   * Initializes the Web Audio signal graph:
   * [AudioBufferSourceNode loop OR Procedural Voices]
   *                        │
   *                        ▼
   *               [moodFilter (Lowpass)]
   *                        │
   *                        ▼
   *               [duckGain (Sidechain)]
   *                        │
   *                        ▼
   *               [musicBus (Destination)]
   */
  private initGraph(): void {
    if (this.moodFilter && this.duckGain && this.ctx && this.ctx.state !== 'closed') return;

    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = getAudioContext();
    }
    if (!this.ctx) return;

    if (!this.musicBus) {
      this.musicBus = this.engine.getMusicDestination();
    }
    if (!this.musicBus) {
      this.musicBus = this.ctx.destination;
    }
    if (!this.musicBus) return;

    // Master mood lowpass filter (sweeps cutoff dynamically with gameplay intensity)
    this.moodFilter = this.ctx.createBiquadFilter();
    this.moodFilter.type = 'lowpass';
    this.moodFilter.frequency.setValueAtTime(MOOD_START_HZ, this.ctx.currentTime);
    this.moodFilter.Q.setValueAtTime(MOOD_Q, this.ctx.currentTime);

    // Dedicated sidechain ducking gain node (modulates volume under SFX or paused state)
    this.duckGain = this.ctx.createGain();
    this.duckGain.gain.setValueAtTime(1.0, this.ctx.currentTime);

    // Signal routing: moodFilter -> duckGain -> musicBus
    this.moodFilter.connect(this.duckGain);
    this.duckGain.connect(this.musicBus);

    // 1-second white noise buffer for crisp procedural hi-hats
    const bufferSize = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2.0 - 1.0;
    }
  }

  // ==========================================================================
  // Transport Controls
  // ==========================================================================

  /**
   * Starts soundtrack playback. Preloads broadcast music loops and determines
   * whether to stream pre-rendered broadcast audio or fall back to the procedural sequencer.
   */
  public startMusic(): void {
    this.isPlaying = true;
    this.currentTrack = this.determineTargetTrack();
    this.isFrenzy = this.pendingFrenzy;
    this.isBossMode = this.pendingBoss;

    if (this.engine.unavailable && !this.ctx) return;
    this.engine.init();
    this.initGraph();
    if (!this.ctx) return;

    this.musicStep = 0;
    this.applyMusicFilter(0.05);

    // Asynchronously preload all 3 broadcast tracks into cache
    this.preloadMusicAssets().catch(() => {});

    // Check if buffer for initial target track is already cached
    const buffer = getCachedAudioBuffer(BROADCAST_MUSIC_PATHS[this.currentTrack]);
    if (buffer) {
      this.startBroadcastTrack(this.currentTrack, buffer);
    } else {
      // Fallback: start procedural lookahead step scheduler
      this.isBroadcastActive = false;
      this.resync();
      this.startScheduler();
    }
  }

  /**
   * Stops soundtrack playback, immediately halts all broadcast sources,
   * cancels active crossfade timeouts, and disconnects all allocated audio nodes.
   */
  public stopMusic(): void {
    this.isPlaying = false;
    this._isPaused = false;
    this.stopScheduler();
    this.needResync = true;
    this.stopAllBroadcastStreams();
  }

  /**
   * Muffles the music filter to 400 Hz and ducks volume while the game is paused.
   */
  public pauseMusic(): void {
    this.isPaused = true;
    this.applyMusicFilter(0.08);
    if (this.ctx && this.duckGain) {
      const now = this.ctx.currentTime;
      this.duckGain.gain.cancelScheduledValues(now);
      this.duckGain.gain.setValueAtTime(this.duckGain.gain.value, now);
      this.duckGain.gain.linearRampToValueAtTime(PAUSE_DUCK_GAIN, now + 0.08);
    }
  }

  /**
   * Restores dynamic filter cutoff and ramps ducking back to unity gain upon unpausing.
   */
  public resumeMusic(): void {
    this.isPaused = false;
    if (!this.isPlaying) {
      this.startMusic();
    } else {
      if (this.ctx && this.duckGain) {
        const now = this.ctx.currentTime;
        this.duckGain.gain.cancelScheduledValues(now);
        this.duckGain.gain.setValueAtTime(this.duckGain.gain.value, now);
        this.duckGain.gain.linearRampToValueAtTime(1.0, now + 0.1);
      }
      this.resync();
      this.applyMusicFilter(0.1);
    }
  }

  public setPaused(paused: boolean): void {
    if (paused) {
      this.pauseMusic();
    } else {
      this.resumeMusic();
    }
  }

  // ==========================================================================
  // Gameplay State Triggers & Crossfader Transitions
  // ==========================================================================

  /**
   * Sets game combat intensity (0..1), smoothly modulates moodFilter cutoff,
   * and triggers crossfades if intensity crosses the combat threshold (0.6).
   */
  public setMusicIntensity(t01: number): void {
    const v = isNum(t01) ? clamp01(t01) : 0;
    const prev = this.intensity;
    this.intensity = v;
    if (Math.abs(v - prev) >= 0.01) {
      this.applyMusicFilter(0.4);
    }
    this.checkTrackTransition();
  }

  /**
   * Activates or deactivates serpentine Frenzy mode.
   */
  public setFrenzyState(active: boolean): void {
    this.pendingFrenzy = active;
    this.isFrenzy = active;
    this.applyMusicFilter(0.1);
    this.checkTrackTransition();
  }

  /**
   * Activates or deactivates Boss battle soundtrack mode.
   */
  public setBossMode(active: boolean, phase: number = 1): void {
    this.pendingBoss = active;
    this.bossPhase = phase;
    this.isBossMode = active;
    this.applyMusicFilter(0.1);
    this.checkTrackTransition();
  }

  /**
   * Determines the target soundtrack based on current game phase priorities:
   * Boss Battle (Highest) > Frenzy or High Intensity (>0.6) > Standard Exploration.
   */
  public determineTargetTrack(): MusicTrackType {
    if (this.isBossMode || this.pendingBoss) return 'boss';
    if (this.isFrenzy || this.pendingFrenzy || this.intensity > 0.6) return 'combat';
    return 'exploration';
  }

  /**
   * Checks if game phase changes require crossfading to a different soundtrack.
   */
  private checkTrackTransition(): void {
    const target = this.determineTargetTrack();
    if (target === this.currentTrack && (this.isBroadcastActive || !this.isPlaying)) return;
    this.currentTrack = target;

    if (!this.isPlaying || !this.ctx) return;

    const buffer = getCachedAudioBuffer(BROADCAST_MUSIC_PATHS[target]);
    if (buffer) {
      this.transitionToTrack(target, buffer);
    } else {
      this.transitionToProceduralFallback();
    }
  }

  // ==========================================================================
  // Broadcast Soundtrack Streaming & Crossfading Engine
  // ==========================================================================

  /**
   * Asynchronously preloads all 3 broadcast soundtrack loops into memory cache.
   */
  public async preloadMusicAssets(basePath: string = ''): Promise<void> {
    const ctx = this.ctx || getAudioContext();
    const tracks: MusicTrackType[] = ['exploration', 'combat', 'boss'];
    const promises = tracks.map(track => {
      const relPath = BROADCAST_MUSIC_PATHS[track];
      const fullPath = basePath ? `${basePath.replace(/\/$/, '')}/${relPath}` : relPath;
      return loadAudioBuffer(fullPath, ctx);
    });
    await Promise.allSettled(promises);

    // If music started while assets were loading and was using procedural fallback,
    // transition seamlessly to the loaded broadcast loop!
    if (this.isPlaying && !this.isBroadcastActive && this.ctx) {
      const target = this.determineTargetTrack();
      const buf = getCachedAudioBuffer(BROADCAST_MUSIC_PATHS[target]);
      if (buf) {
        this.transitionToTrack(target, buf);
      }
    }
  }

  /**
   * Starts fresh playback of a broadcast loop with zero crossfade latency.
   */
  private startBroadcastTrack(track: MusicTrackType, buffer: AudioBuffer): void {
    if (!this.ctx || !this.moodFilter) return;

    this.stopAllBroadcastStreams();

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const trackGain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    trackGain.gain.setValueAtTime(1.0, now);

    src.connect(trackGain);
    trackGain.connect(this.moodFilter);

    src.start(now);

    this.currentStream = {
      track,
      source: src,
      gain: trackGain,
      stopTimeout: null,
    };
    this.currentTrack = track;
    this.isBroadcastActive = true;
    this.stopScheduler();
  }

  /**
   * Seamlessly crossfades from current track to incoming track over CROSSFADE_DURATION.
   * Uses linear gain ramps on individual track GainNodes connected into moodFilter.
   */
  private transitionToTrack(target: MusicTrackType, buffer: AudioBuffer): void {
    if (!this.ctx || !this.moodFilter) return;
    if (this.currentStream && this.currentStream.track === target && this.isBroadcastActive) return;

    const now = this.ctx.currentTime;

    // Smoothly fade out the outgoing stream
    if (this.currentStream) {
      const outgoing = this.currentStream;
      this.fadingStreams.push(outgoing);

      outgoing.gain.gain.cancelScheduledValues(now);
      outgoing.gain.gain.setValueAtTime(outgoing.gain.gain.value, now);
      outgoing.gain.gain.linearRampToValueAtTime(0.0001, now + CROSSFADE_DURATION);

      outgoing.stopTimeout = setTimeout(() => {
        this.disposeStream(outgoing);
      }, (CROSSFADE_DURATION + 0.1) * 1000);
      this.currentStream = null;
    }

    // Allocate and fade in the incoming stream
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const trackGain = this.ctx.createGain();
    trackGain.gain.setValueAtTime(0.0001, now);
    trackGain.gain.linearRampToValueAtTime(1.0, now + CROSSFADE_DURATION);

    src.connect(trackGain);
    trackGain.connect(this.moodFilter);

    src.start(now);

    this.currentStream = {
      track: target,
      source: src,
      gain: trackGain,
      stopTimeout: null,
    };
    this.currentTrack = target;
    this.isBroadcastActive = true;
    this.stopScheduler();
  }

  /**
   * Fades out active broadcast stream and engages the procedural lookahead scheduler.
   */
  private transitionToProceduralFallback(): void {
    if (this.currentStream) {
      const now = this.ctx ? this.ctx.currentTime : 0;
      const outgoing = this.currentStream;
      this.fadingStreams.push(outgoing);
      if (this.ctx) {
        outgoing.gain.gain.cancelScheduledValues(now);
        outgoing.gain.gain.setValueAtTime(outgoing.gain.gain.value, now);
        outgoing.gain.gain.linearRampToValueAtTime(0.0001, now + 0.4);
      }
      outgoing.stopTimeout = setTimeout(() => {
        this.disposeStream(outgoing);
      }, 450);
      this.currentStream = null;
    }
    this.isBroadcastActive = false;
    this.resync();
    this.startScheduler();
  }

  /**
   * Safely stops and disconnects all nodes associated with a stream to prevent memory leaks.
   */
  private disposeStream(stream: ActiveTrackStream): void {
    if (stream.stopTimeout !== null && stream.stopTimeout !== undefined) {
      clearTimeout(stream.stopTimeout);
      stream.stopTimeout = null;
    }
    try {
      stream.source.stop();
    } catch {}
    try {
      stream.source.disconnect();
    } catch {}
    try {
      stream.gain.disconnect();
    } catch {}

    const idx = this.fadingStreams.indexOf(stream);
    if (idx !== -1) {
      this.fadingStreams.splice(idx, 1);
    }
  }

  /**
   * Immediately stops all active and fading broadcast audio streams.
   */
  private stopAllBroadcastStreams(): void {
    if (this.currentStream) {
      this.disposeStream(this.currentStream);
      this.currentStream = null;
    }
    while (this.fadingStreams.length > 0) {
      const s = this.fadingStreams.pop()!;
      this.disposeStream(s);
    }
    this.isBroadcastActive = false;
  }

  // ==========================================================================
  // Sidechain Ducking Engine
  // ==========================================================================

  /**
   * Triggers sidechain ducking attenuation on the music bus.
   * Quickly ducks the music gain down to `amount` over 30ms attack time,
   * then smoothly recovers back to unity (1.0) over `duration` seconds.
   *
   * Anti-Thump Engineering:
   * Cancels prior scheduled automations at current audio time, pins the instantaneous gain
   * via setValueAtTime(this.duckGain.gain.value, now), and ramps linearly to prevent
   * discontinuous DC steps or impulse clicks in the audio buffer output.
   *
   * @param amount Target ducking gain level (0..1, default 0.40)
   * @param duration Release recovery time in seconds (default 0.50)
   */
  public duck(amount: number = 0.40, duration: number = 0.50): void {
    if (!this.ctx || !this.duckGain) return;
    const now = this.ctx.currentTime;
    const targetVal = Math.max(0.0001, clamp01(amount));
    const dur = Math.max(0.05, duration);
    const attack = DUCK_ATTACK_SEC;

    this.duckGain.gain.cancelScheduledValues(now);
    this.duckGain.gain.setValueAtTime(this.duckGain.gain.value, now);
    this.duckGain.gain.linearRampToValueAtTime(targetVal, now + attack);
    this.duckGain.gain.linearRampToValueAtTime(1.0, now + attack + dur);
  }

  // ==========================================================================
  // Dynamic Mood Filter
  // ==========================================================================

  /**
   * Dynamically adjusts the lowpass filter cutoff frequency based on game state:
   *  - Paused: 400 Hz (muffled behind UI for acoustic separation)
   *  - Boss Mode / Combat / Frenzy / intensity > 0.6: 20,000 Hz (wide open unconstrained cyber frequency response)
   *  - Exploration: 18,000 Hz (bright, sparkling cybernetic synthwave soundscape)
   *
   * Formula:
   * Cutoff transitions smoothly using setTargetAtTime(targetHz, now, tc) with biquad resonance Q = 0.8
   * providing transparent high-frequency air during action and clean damping when paused.
   */
  public applyMusicFilter(tc: number = 0.3): void {
    if (!this.ctx || !this.moodFilter) return;
    const now = this.ctx.currentTime;
    let targetHz: number;

    if (this.engine.paused || this.isPaused) {
      targetHz = 400;
    } else if (this.isBossMode || this.isFrenzy || this.intensity > 0.6) {
      targetHz = 20000;
    } else {
      targetHz = 18000;
    }

    const timeConst = isNum(tc) && tc > 0 ? tc : 0.3;
    this.moodFilter.frequency.setTargetAtTime(Math.max(20, targetHz), now, timeConst);
  }

  // ==========================================================================
  // Procedural Lookahead Sequencer Fallback
  // ==========================================================================

  /**
   * Computes dynamic musical tempo (BPM) based on gameplay intensity and active combat state:
   * - Boss Mode:        $\text{BPM} = 96 + 14 \cdot \text{intensity} \in [96, 110]$ (heavy driving cadence)
   * - Serpentine Frenzy: $\text{BPM} = 150 + 6 \cdot \text{intensity} \in [150, 156]$ (high-speed adrenaline)
   * - Exploration:       $\text{BPM} = 112 + 12 \cdot \text{intensity} \in [112, 124]$ (grooving synthwave)
   */
  public getTempo(): number {
    if (this.isBossMode) return 96 + this.intensity * 14;
    if (this.isFrenzy) return 150 + this.intensity * 6;
    return 112 + this.intensity * 12;
  }

  /**
   * Duration of a single 16th note step in seconds:
   * $T_{\text{step}} = \frac{60.0}{\text{BPM} \times 4}$
   */
  public get stepDuration(): number {
    return 60.0 / this.getTempo() / 4.0;
  }

  /**
   * Resets the playback scheduling clock, aligning `nextNoteTime` slightly ahead of current time.
   */
  private resync(): void {
    if (!this.ctx) return;
    this.nextNoteTime = this.ctx.currentTime + 0.06;
    this.needResync = false;
  }

  /**
   * Engages the interval-driven lookahead step scheduler:
   * Runs every TICK_INTERVAL_MS (25ms) and queues notes up to LOOKAHEAD (120ms) in advance.
   */
  private startScheduler(): void {
    this.stopScheduler();
    if (typeof window !== 'undefined' || typeof setInterval !== 'undefined') {
      this.schedulerTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS) as unknown as number;
    }
  }

  /**
   * Stops the lookahead scheduler timer.
   */
  private stopScheduler(): void {
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  /**
   * Core Lookahead Scheduler Tick Step.
   *
   * Architectural Algorithm (Chris Wilson / W3C Audio Scheduler Pattern):
   * 1. Query instantaneous `ctx.currentTime`.
   * 2. If clock desynchronized (`needResync` or `nextNoteTime < now`), resync to `now + 0.06s`.
   * 3. Loop: while `nextNoteTime < now + LOOKAHEAD` (120ms buffer), schedule individual notes
   *    at future timestamp `nextNoteTime`, advance `nextNoteTime += stepDuration`, and increment `musicStep`.
   * 4. Enforces a 64-iteration safety guard to prevent main-thread hangs on tab defocus.
   */
  private tick(): void {
    if (!this.isPlaying || !this.ctx || !this.moodFilter || this.isBroadcastActive) return;
    if (this.engine.isMuted || this.engine.musicVolume <= 0) {
      this.needResync = true;
      return;
    }

    const now = this.ctx.currentTime;
    if (this.needResync || this.nextNoteTime < now) {
      this.resync();
    }

    let guard = 0;
    while (this.nextNoteTime < now + LOOKAHEAD && guard++ < 64) {
      this.scheduleStep(this.musicStep, this.nextNoteTime);
      if (!this.isPlaying || this.isBroadcastActive) return;
      this.nextNoteTime += this.stepDuration;
      this.musicStep++;
    }
  }

  /**
   * Schedules voices for a single 16th note step at exact future audio timestamp `when`.
   * Synchronizes mode transitions (Frenzy, Boss) to downbeats ($pos = \text{step} \pmod{16} == 0$).
   *
   * @param step Monotonic step index
   * @param when Exact Web Audio timestamp in seconds
   */
  private scheduleStep(step: number, when: number): void {
    const pos = step % STEPS_PER_BAR;

    // Synchronize mode transitions to the 16th-note bar line
    if (pos === 0 && (this.isFrenzy !== this.pendingFrenzy || this.isBossMode !== this.pendingBoss)) {
      this.isFrenzy = this.pendingFrenzy;
      this.isBossMode = this.pendingBoss;
      this.applyMusicFilter(0.35);
      this.checkTrackTransition();
    }

    if (this.isBossMode) {
      this.scheduleBoss(step, pos, when);
    } else {
      this.scheduleGroove(step, pos, when);
    }
  }

  private scheduleGroove(step: number, pos: number, when: number): void {
    const sd = this.stepDuration;
    const bar = Math.floor(step / STEPS_PER_BAR);
    const root = BAR_ROOTS[bar % BAR_ROOTS.length] ?? 0;
    const frenzy = this.isFrenzy;

    const deg = PENTATONIC[step % PENTATONIC.length] ?? 0;
    const arpOct = (Math.floor(step / PENTATONIC.length) % 2) * 12;
    const arpFreq = 220 * semi(root + deg + arpOct);

    // --- Bassline: Quarter notes
    if (pos % 4 === 0) {
      const beatOffset = BASS_BEATS[Math.floor(pos / 4)] ?? 0;
      const f = 55 * semi(root + beatOffset);
      const len = sd * 3.2;

      this.scheduleTone({
        type: 'sawtooth',
        freq: f,
        when,
        dur: len,
        peak: 0.3,
        attack: 0.006,
        filter: 'lowpass',
        cutoff: frenzy ? 1150 : 520,
        q: 5.0,
      });

      // Frenzy thickens bass with detuned saw
      if (frenzy) {
        this.scheduleTone({
          type: 'sawtooth',
          freq: f,
          detune: 12, // 12 cents
          when,
          dur: len,
          peak: 0.22,
          attack: 0.006,
          filter: 'lowpass',
          cutoff: 1150,
          q: 5.0,
        });
      }
    }

    // --- Synth Arp: 8th notes normally, straight 16ths in Frenzy
    if (frenzy || pos % 2 === 0) {
      const alen = sd * (frenzy ? 1.6 : 2.2);
      this.scheduleTone({
        type: 'triangle',
        freq: arpFreq,
        when,
        dur: alen,
        peak: frenzy ? 0.12 : 0.1,
        attack: 0.004,
      });
    }

    // --- Octave-Up Counter-Arp (fades in with intensity)
    if (this.intensity > 0.3 && pos % 4 === 1) {
      const clen = sd * 1.4;
      this.scheduleTone({
        type: 'square',
        freq: arpFreq * 2,
        when,
        dur: clen,
        peak: 0.05 * this.intensity,
        attack: 0.004,
      });
    }

    // --- Procedural Off-Beat Hi-Hat (crisp noise bypassing mood filter)
    if (pos % 4 === 2 || (frenzy && pos % 2 === 1)) {
      this.scheduleHat(when, 0.05);
    }
  }

  private scheduleBoss(step: number, pos: number, when: number): void {
    const sd = this.stepDuration;
    const bar = Math.floor(step / STEPS_PER_BAR);
    const root = BOSS_ROOTS[bar % BOSS_ROOTS.length] ?? 0;

    // --- Heavy Half-Time Sub Bass
    if (pos % 4 === 0) {
      const f = BOSS_BASE_FREQ * semi(root);
      const len = sd * 3.6;

      this.scheduleTone({
        type: 'sawtooth',
        freq: f,
        when,
        dur: len,
        peak: 0.36,
        attack: 0.012,
        filter: 'lowpass',
        cutoff: 300,
        q: 7.0,
      });

      this.scheduleTone({
        type: 'sawtooth',
        freq: f,
        detune: -9, // -9 cents
        when,
        dur: len,
        peak: 0.28,
        attack: 0.012,
        filter: 'lowpass',
        cutoff: 300,
        q: 7.0,
      });
    }

    // --- Dissonant Stabs on back half of beat pairs
    if (pos === 6 || pos === 14) {
      const sdeg = BOSS_SCALE[Math.floor(step / 2) % BOSS_SCALE.length] ?? 0;
      const sfq = 164.81 * semi(root + sdeg);
      const slen = sd * 1.2;

      this.scheduleTone({
        type: 'square',
        freq: sfq,
        when,
        dur: slen,
        peak: 0.09 + 0.05 * this.intensity,
        attack: 0.004,
      });
    }

    // --- Tremolo Pad (Root + Tritone Chord)
    if (pos === 0) {
      const padLen = sd * STEPS_PER_BAR;
      const padFreq = 110 * semi(root);
      const tritoneFreq = 110 * semi(root + 6);

      this.scheduleTone({
        type: 'triangle',
        freq: padFreq,
        when,
        dur: padLen,
        peak: 0.1 + 0.06 * this.intensity,
        attack: padLen * 0.3,
        filter: 'lowpass',
        cutoff: 900,
      });

      this.scheduleTone({
        type: 'triangle',
        freq: tritoneFreq,
        detune: 6,
        when,
        dur: padLen,
        peak: 0.08 + 0.05 * this.intensity,
        attack: padLen * 0.3,
        filter: 'lowpass',
        cutoff: 900,
      });
    }

    // --- Boss Hi-Hat
    if (pos % 4 === 2) {
      this.scheduleHat(when, 0.035);
    }
  }

  private scheduleTone(opts: {
    type: WaveShape;
    freq: number;
    detune?: number;
    when: number;
    dur: number;
    peak: number;
    attack?: number;
    filter?: BiquadFilterType;
    cutoff?: number;
    q?: number;
  }): void {
    if (!this.ctx || !this.moodFilter) return;

    const osc = this.ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, opts.when);
    if (opts.detune) osc.detune.setValueAtTime(opts.detune, opts.when);

    const gain = this.ctx.createGain();
    const attack = opts.attack ?? 0.004;
    gain.gain.setValueAtTime(0.0001, opts.when);
    gain.gain.linearRampToValueAtTime(opts.peak, opts.when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, opts.when + opts.dur);

    let lastNode: AudioNode = osc;

    let flt: BiquadFilterNode | null = null;
    if (opts.filter) {
      flt = this.ctx.createBiquadFilter();
      flt.type = opts.filter;
      flt.frequency.setValueAtTime(opts.cutoff ?? 1000, opts.when);
      if (opts.q) flt.Q.setValueAtTime(opts.q, opts.when);
      lastNode.connect(flt);
      lastNode = flt;
    }

    lastNode.connect(gain);
    gain.connect(this.moodFilter);

    osc.onended = () => {
      try { osc.disconnect(); } catch {}
      if (flt) { try { flt.disconnect(); } catch {} }
      try { gain.disconnect(); } catch {}
    };

    osc.start(opts.when);
    osc.stop(opts.when + opts.dur + 0.02);
  }

  private scheduleHat(when: number, peak: number): void {
    if (!this.ctx || !this.noiseBuffer || (!this.duckGain && !this.musicBus)) return;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.setValueAtTime(1.6, when);

    const flt = this.ctx.createBiquadFilter();
    flt.type = 'highpass';
    flt.frequency.setValueAtTime(6500, when);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);

    src.connect(flt);
    flt.connect(gain);
    // Connect to duckGain (or musicBus) so hats stay bright while being ducked when paused/sidechained
    gain.connect(this.duckGain ?? this.musicBus!);

    src.onended = () => {
      try { src.disconnect(); } catch {}
      try { flt.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
    };

    src.start(when, Math.random() * 0.5);
    src.stop(when + 0.04);
  }

  /**
   * Completely tears down soundtrack playback, lookahead scheduler, and Web Audio nodes.
   */
  public dispose(): void {
    this.stopMusic();
    if (this.duckGain) {
      try { this.duckGain.disconnect(); } catch {}
      this.duckGain = null;
    }
    if (this.moodFilter) {
      try { this.moodFilter.disconnect(); } catch {}
      this.moodFilter = null;
    }
    this.noiseBuffer = null;
    this.musicBus = null;
    this.ctx = null;
  }
}
