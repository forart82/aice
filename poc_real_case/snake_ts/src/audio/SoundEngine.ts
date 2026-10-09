/**
 * Ouroboros Ascension — Core Web Audio Sound Engine (SoundEngine.ts)
 *
 * Provides a production-grade Web Audio signal pipeline and hybrid audio dispatcher:
 *
 * 1. Web Audio Signal Graph Topology:
 *    [SFX Voices / Buffers]
 *             │
 *             ▼
 *        [_sfxGain]  ───┐
 *                       ├─► [_masterGain] ──► [_masterCompressor] ──► [ctx.destination]
 *       [_musicGain] ───┘
 *             ▲
 *             │
 *    [Music Stream / Synth]
 *
 * 2. Studio Master Dynamics Compressor (Mastering Chain):
 *    - Threshold: -10 dB (transparent dynamic headroom)
 *    - Knee: 12 dB (smooth soft-knee curve)
 *    - Ratio: 6:1 (transparent program leveling preserving transient punch)
 *    - Attack: 0.002 s (2 ms ultra-fast transient catch)
 *    - Release: 0.12 s (120 ms musical release envelope)
 *
 * 3. Dynamic Sidechain Ducking Engine:
 *    - Attenuates `_musicGain` down to `target * duckGain` over a 30ms anti-thump linear ramp.
 *    - Mathematical formula: $g(t) = g_{\text{start}} + (g_{\text{target}} - g_{\text{start}}) \cdot \frac{t - t_0}{\tau_{\text{ramp}}}$
 *    - Carves out 6dB+ headroom for explosive combat SFX without DC pops or clicks.
 *
 * 4. Voice Concurrency Limiter & Debounce System:
 *    - Rejects duplicate rapid triggers within `minIntervalMs` (default 35ms).
 *    - Enforces polyphonic voice ceiling (`maxConcurrent`, default 3) per sound key.
 *    - Increments voice counters on trigger and decrements on source termination (`onended`).
 *
 * 5. Hybrid Audio Dispatcher:
 *    - Primary: Preloaded broadcast-quality 44.1kHz 16-bit PCM WAV buffers.
 *    - Fallback: Pure procedural Web Audio DSP synthesis (instant, zero-latency, headless-safe).
 *
 * Conforms strictly to Rule 10 (Strict Architectural Documentation) and Rule 7 (Commercial Viability).
 */

import { ISound } from '../core/Contracts';
import { MathX } from '../core/MathX';
import {
  VoiceSpec,
  AudioPlaybackHandle,
  getAudioContext,
  playWarpJump,
  playUniqueHelmetReveal,
  playVoiceSpecs,
  createEatVoices,
  createStarVoices,
  createBiteVoices,
  createShootVoices,
  createLaserFireVoices,
  createHitVoices,
  createCritVoices,
  createExplosionVoices,
  createThunderVoices,
  createFlameVoices,
  createDashVoices,
  createSkillVoices,
  createFrenzyVoices,
  createShieldVoices,
  createShieldBreakVoices,
  createHurtVoices,
  createGameOverVoices,
  createBossAlertVoices,
  createLevelUpVoices,
  createVictoryVoices,
  createUiClickVoices,
  createUiHoverVoices,
  createErrorVoices,
  createCardPickVoices,
  createComboTickVoices,
  createReviveVoices,
  createVoidCollapseVoices,
  loadAudioBuffer,
  playAudioBuffer,
  getCachedAudioBuffer,
  BROADCAST_AUDIO_PATHS,
  EAT_POP_VARIATION_PATHS,
} from './Synth';
import type { IMusicPlayer } from './MusicPlayer';

export class SoundEngine implements ISound {
  private _ctx: AudioContext | null = null;
  private _masterGain: GainNode | null = null;
  private _sfxGain: GainNode | null = null;
  private _musicGain: GainNode | null = null;
  private _sfxVol: number = 0.75;
  private _musVol: number = 0.38;
  private _muted: boolean = false;
  private _paused: boolean = false;
  private _musicPlayer: IMusicPlayer | null = null;

  public readonly _lastPlayTimes: Map<string, number> = new Map();
  public readonly _activeVoiceCounts: Map<string, number> = new Map();
  public _masterCompressor: DynamicsCompressorNode | null = null;
  public get masterCompressor(): DynamicsCompressorNode | null { return this._masterCompressor; }

  private _shootRoundRobin: number = 0;
  private static readonly SHOOT_DETUNES: readonly number[] = [-35, 18, -12, 35, -24, 28, 0, -30];

  /**
   * Voice Concurrency Limiter & Debounce System:
   * Rejects sounds triggered before minIntervalMs cooldown expires or when active
   * polyphonic voices for soundKey reach or exceed maxConcurrent ceiling.
   */
  public canPlay(soundKey: string, minIntervalMs: number = 35, maxConcurrent: number = 3): boolean {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const last = this._lastPlayTimes.get(soundKey) ?? -Infinity;
    if (now - last < minIntervalMs) return false;
    const count = this._activeVoiceCounts.get(soundKey) ?? 0;
    if (count >= maxConcurrent) return false;
    return true;
  }

  /**
   * Sidechain Ducking System:
   * Smoothly ramps _musicGain down to _musVol * duckGain over 0.03s (30ms anti-thump),
   * holds, and smoothly restores to _musVol over durationSec (default 0.50s).
   *
   * Mathematical Rationale:
   * Uses linear ramp down: g(t) = g_curr + (g_duck - g_curr) * ((t - t0) / 0.03)
   * Prevents sharp step discontinuity / DC pops in music playback while immediately
   * carving out 6dB+ acoustic headroom for punchy combat sound effects.
   */
  public duckMusic(duckGain: number = 0.4, durationSec: number = 0.50): void {
    if (this._musicPlayer && typeof this._musicPlayer.duck === 'function') {
      try {
        this._musicPlayer.duck(duckGain, durationSec);
      } catch {}
    }
    if (this._muted) return;
    const ctx = this.initCtx();
    if (!ctx || !this._musicGain) return;

    const param = this._musicGain.gain;
    const targetVol = this._musVol;
    const duckedVol = targetVol * MathX.clamp01(duckGain);
    const t0 = ctx.currentTime;
    const rampDownSec = 0.03;
    const restoreTime = t0 + Math.max(rampDownSec, durationSec);

    try {
      if (typeof param.cancelScheduledValues === 'function') {
        param.cancelScheduledValues(t0);
      }
      if (typeof param.setValueAtTime === 'function') {
        param.setValueAtTime(param.value || targetVol, t0);
      }
      if (typeof param.linearRampToValueAtTime === 'function') {
        param.linearRampToValueAtTime(duckedVol, t0 + rampDownSec);
        param.linearRampToValueAtTime(targetVol, restoreTime);
      } else {
        param.value = duckedVol;
      }
    } catch {
      param.value = duckedVol;
    }
  }

  public get sfxVolume(): number { return this._sfxVol; }
  public get musicVolume(): number { return this._musVol; }
  public get isMuted(): boolean { return this._muted; }
  public get paused(): boolean { return this._paused; }

  public get unavailable(): boolean {
    return typeof window === 'undefined';
  }

  public init(): void {
    this.initCtx();
    this.preloadBroadcastAudio().catch(() => {});
  }
  public Init(): void {
    this.init();
  }

  /**
   * Asynchronously preloads all broadcast-quality WAV assets (44.1kHz 16-bit PCM)
   * into the Web Audio buffer cache for immediate zero-latency playback.
   */
  public async preloadBroadcastAudio(basePath: string = ''): Promise<void> {
    const ctx = this.initCtx();
    const loadPromises = Object.values(BROADCAST_AUDIO_PATHS).map(path => {
      const fullPath = basePath ? `${basePath.replace(/\/$/, '')}/${path}` : path;
      return loadAudioBuffer(fullPath, ctx);
    });
    await Promise.allSettled(loadPromises);
  }

  /**
   * Hybrid Audio Dispatcher:
   * 1. Attempts to play the pre-rendered broadcast-quality buffer if already cached.
   * 2. If the buffer is not yet loaded, running headlessly in Vitest, or offline,
   *    smoothly falls back to the synthesized procedural DSP pipeline.
   */
  public playBroadcastOrFallback(
    path: string,
    fallbackFn: (onEnded?: () => void) => AudioPlaybackHandle | void,
    gainMultiplier: number = 1.0,
    onEnded?: () => void,
    playbackRateMultiplier: number = 1.0
  ): AudioPlaybackHandle | void {
    if (this._muted) {
      if (onEnded) onEnded();
      return;
    }
    const buf = getCachedAudioBuffer(path);
    if (buf) {
      const ctx = this.initCtx();
      if (ctx) {
        const dest = this._sfxGain || this._masterGain || ctx.destination;
        return playAudioBuffer(buf, ctx, dest, gainMultiplier, onEnded, playbackRateMultiplier);
      }
    }
    return fallbackFn(onEnded);
  }

  public attachMusicPlayer(player: IMusicPlayer | null): void {
    this._musicPlayer = player;
  }

  public getMusicDestination(): AudioNode | null {
    const ctx = this.initCtx();
    if (!ctx) return null;
    return this._musicGain || this._masterGain || ctx.destination;
  }

  private initCtx(): AudioContext | null {
    if (!this._ctx || this._ctx.state === 'closed') {
      try {
        const audioCtx = getAudioContext();
        if (audioCtx) {
          this._ctx = audioCtx;
        }
      } catch {}
    }
    if (this._ctx && (!this._masterGain || !this._masterCompressor)) {
      try {
        this._masterGain = this._ctx.createGain();
        this._sfxGain = this._ctx.createGain();
        this._musicGain = this._ctx.createGain();

        this._sfxGain.gain.value = this._muted ? 0 : this._sfxVol;
        this._musicGain.gain.value = this._muted ? 0 : this._musVol;

        // Master Dynamics Compressor Node (Studio Mastering Specs)
        // - threshold: -10 dB (transparent headroom)
        // - knee: 12 dB (smooth soft-knee transition curve)
        // - ratio: 6 (6:1 transparent program compression preserving transient punch)
        // - attack: 0.002 s (2 ms ultra-fast transient catch)
        // - release: 0.12 s (120 ms musical release envelope)
        if (typeof this._ctx.createDynamicsCompressor === 'function') {
          this._masterCompressor = this._ctx.createDynamicsCompressor();
          this._masterCompressor.threshold.value = -10;
          this._masterCompressor.knee.value = 12;
          this._masterCompressor.ratio.value = 6;
          this._masterCompressor.attack.value = 0.002;
          this._masterCompressor.release.value = 0.12;
        }

        // Signal Graph Topology:
        // SFX Gain  ─┐
        //            ├─► Master Gain ─► Master Compressor ─► Destination
        // Music Gain ┘
        this._sfxGain.connect(this._masterGain);
        this._musicGain.connect(this._masterGain);
        if (this._masterCompressor) {
          this._masterGain.connect(this._masterCompressor);
          this._masterCompressor.connect(this._ctx.destination);
        } else {
          this._masterGain.connect(this._ctx.destination);
        }
      } catch {}
    }
    if (this._ctx && this._ctx.state === 'suspended') {
      this._ctx.resume().catch(() => {});
    }
    return this._ctx;
  }

  public playVoices(voices: readonly VoiceSpec[], gainMultiplier = 1.0, onEnded?: () => void): AudioPlaybackHandle | void {
    const ctx = this.initCtx();
    if (!ctx || this._muted) {
      if (onEnded) onEnded();
      return;
    }
    const dest = this._sfxGain || this._masterGain || ctx.destination;
    return playVoiceSpecs(voices, ctx, dest, gainMultiplier, onEnded);
  }

  /**
   * Dispatches an audio playback handle with strict active voice lifecycle tracking,
   * guaranteeing that _activeVoiceCounts increments upon start and decrements back to 0
   * upon source completion, cancellation, or error.
   */
  private dispatchVoiceTracked(
    soundKey: string,
    audioPath: string | undefined,
    fallbackFn: (cb?: () => void) => AudioPlaybackHandle | void,
    gainMultiplier: number = 1.0,
    playbackRate: number = 1.0
  ): AudioPlaybackHandle | void {
    const cur = this._activeVoiceCounts.get(soundKey) ?? 0;
    this._activeVoiceCounts.set(soundKey, cur + 1);

    let ended = false;
    const onEnd = () => {
      if (ended) return;
      ended = true;
      const c = this._activeVoiceCounts.get(soundKey) ?? 1;
      this._activeVoiceCounts.set(soundKey, Math.max(0, c - 1));
    };

    let handle: AudioPlaybackHandle | void;
    if (audioPath) {
      handle = playbackRate !== 1.0
        ? this.playBroadcastOrFallback(audioPath, fallbackFn, gainMultiplier, onEnd, playbackRate)
        : this.playBroadcastOrFallback(audioPath, fallbackFn, gainMultiplier, onEnd);
    } else {
      handle = fallbackFn(onEnd);
    }

    if (!handle && (!audioPath || !getCachedAudioBuffer(audioPath))) {
      onEnd();
    }
    return handle;
  }

  public playTone(freq: number, type: OscillatorType, duration: number, gainVal: number = 0.3): void {
    const ctx = this.initCtx();
    if (!ctx || this._muted) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this._sfxGain || this._masterGain || ctx.destination);
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {}
      };

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {}
  }

  // --- UI Audio ---
  public PlayUi(): void {
    this.playBroadcastOrFallback(BROADCAST_AUDIO_PATHS.uiClick, () => this.playVoices(createUiClickVoices()));
  }
  public playUi(): void { this.PlayUi(); }
  public playUiClick(): void { this.PlayUi(); }
  public playUiHover(): void {
    this.playBroadcastOrFallback(BROADCAST_AUDIO_PATHS.uiTab, () => this.playVoices(createUiHoverVoices()));
  }
  public PlayError(): void { this.playVoices(createErrorVoices()); }
  public playError(): void { this.PlayError(); }

  // --- Eating & Food ---
  public PlayEat(_combo: number = 1, _isGolden: boolean = false): void {
    if (this._muted) return;
    if (!this.canPlay('eat', 0, 4)) return;
    this.dispatchVoiceTracked(
      'eat',
      BROADCAST_AUDIO_PATHS.eat,
      (cb) => this.playVoices(createEatVoices(_combo, false), 1.0, cb)
    );
  }

  public playEat(combo: number | boolean = 1, isGolden: boolean = false): void {
    if (typeof combo === 'boolean') this.PlayEat(1, combo);
    else this.PlayEat(combo, isGolden);
  }

  /**
   * Returns the canonical asset path for a specific multi-take eat pop variation (0-3).
   * Used for anti-machine-gun round-robin variation during rapid-fire feeding.
   */
  public getEatPopVariationPath(index: number = 0): string {
    const i = Math.abs(Math.floor(index)) % EAT_POP_VARIATION_PATHS.length;
    return EAT_POP_VARIATION_PATHS[i]!;
  }

  public PlayShard(): void {
    this.playBroadcastOrFallback(BROADCAST_AUDIO_PATHS.starDing, () => this.playVoices(createStarVoices()));
  }
  public playShard(): void { this.PlayShard(); }
  public PlayStar(): void {
    this.playBroadcastOrFallback(BROADCAST_AUDIO_PATHS.gemChime, () => this.playVoices(createStarVoices()));
  }
  public playStar(): void { this.PlayStar(); }
  public playComboTick(combo: number = 1): void { this.playVoices(createComboTickVoices(combo)); }

  // --- Combat & Attacks ---
  public playBite(damage: number = 10, isCrit: boolean = false): void {
    if (!this.canPlay('bite', 40, 2)) return;
    this._lastPlayTimes.set('bite', typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.dispatchVoiceTracked(
      'bite',
      BROADCAST_AUDIO_PATHS.bite,
      (cb) => this.playVoices(createBiteVoices(damage, isCrit), 1.0, cb)
    );
  }

  public PlayHit(intensity: number = 1.0): void {
    if (!this.canPlay('hit', 35, 3)) return;
    this._lastPlayTimes.set('hit', typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.dispatchVoiceTracked(
      'hit',
      BROADCAST_AUDIO_PATHS.hit,
      (cb) => this.playVoices(createHitVoices(intensity), 1.0, cb),
      intensity
    );
  }
  public playHit(intensity?: number): void { this.PlayHit(intensity ?? 1.0); }

  public PlayShoot(freq?: number): void {
    if (!this.canPlay('shoot', 40, 4)) return;
    this._lastPlayTimes.set('shoot', typeof performance !== 'undefined' ? performance.now() : Date.now());
    const detune = SoundEngine.SHOOT_DETUNES[this._shootRoundRobin % SoundEngine.SHOOT_DETUNES.length]!;
    this._shootRoundRobin++;
    const playbackRate = Math.pow(2, detune / 1200);

    this.dispatchVoiceTracked(
      'shoot',
      BROADCAST_AUDIO_PATHS.laserPew,
      (cb) => this.playVoices(createShootVoices(freq), 1.0, cb),
      1.0,
      playbackRate
    );
  }
  public playShoot(freq?: number): void { this.PlayShoot(freq); }

  public playLaserFire(freq?: number): void {
    if (!this.canPlay('laserFire', 40, 3)) return;
    this._lastPlayTimes.set('laserFire', typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.dispatchVoiceTracked(
      'laserFire',
      BROADCAST_AUDIO_PATHS.laserHeavy,
      (cb) => this.playVoices(createLaserFireVoices(freq), 1.0, cb)
    );
  }
  public PlayCrit(): void {
    if (!this.canPlay('crit', 40, 2)) return;
    this._lastPlayTimes.set('crit', typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.dispatchVoiceTracked(
      'crit',
      BROADCAST_AUDIO_PATHS.crit,
      (cb) => this.playVoices(createCritVoices(), 1.0, cb)
    );
  }
  public playCrit(): void { this.PlayCrit(); }

  public PlayExplosion(intensity: number = 1.0): void {
    if (!this.canPlay('explosion', 60, 2)) return;
    this._lastPlayTimes.set('explosion', typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.duckMusic(0.4, 0.50);
    this.dispatchVoiceTracked(
      'explosion',
      BROADCAST_AUDIO_PATHS.explosion,
      (cb) => this.playVoices(createExplosionVoices(intensity), 1.0, cb),
      intensity
    );
  }
  public playExplosion(intensity: number = 1.0): void { this.PlayExplosion(intensity); }

  public PlayThunder(intensity: number = 1.0): void {
    if (!this.canPlay('thunder', 80, 2)) return;
    this._lastPlayTimes.set('thunder', typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.dispatchVoiceTracked(
      'thunder',
      undefined,
      (cb) => this.playVoices(createThunderVoices(intensity), 1.0, cb)
    );
  }
  public playThunder(intensity: number = 1.0): void { this.PlayThunder(intensity); }

  public PlayFlame(): void { this.playVoices(createFlameVoices()); }
  public playFlame(): void { this.PlayFlame(); }

  // --- Kinematics & Serpentine Abilities ---
  public PlayDash(): void {
    this.playBroadcastOrFallback(BROADCAST_AUDIO_PATHS.dash, () => this.playVoices(createDashVoices()));
  }
  public playDash(): void { this.PlayDash(); }
  public PlaySkill(): void { this.playVoices(createSkillVoices()); }
  public playSkill(): void { this.PlaySkill(); }
  public PlayFrenzy(): void { this.playVoices(createFrenzyVoices()); }
  public playFrenzy(): void { this.PlayFrenzy(); }
  public playFrenzyStart(): void { this.PlayFrenzy(); }
  public PlayShield(): void {
    this.playBroadcastOrFallback(BROADCAST_AUDIO_PATHS.shieldOn, () => this.playVoices(createShieldVoices()));
  }
  public playShield(): void { this.PlayShield(); }
  public playShieldBreak(): void {
    this.playBroadcastOrFallback(BROADCAST_AUDIO_PATHS.shieldBreak, () => this.playVoices(createShieldBreakVoices()));
  }

  // --- Bosses, Health & Milestones ---
  public playHurt(damage: number = 10): void { this.playVoices(createHurtVoices(damage)); }
  public playDie(): void { this.PlayGameOver(); }
  public PlayGameOver(): void {
    this.duckMusic(0.2, 0.50);
    this.playBroadcastOrFallback(BROADCAST_AUDIO_PATHS.gameOver, () => this.playVoices(createGameOverVoices()));
  }
  public playGameOver(): void { this.PlayGameOver(); }
  public PlayBossAlert(tier: number = 1): void {
    this.duckMusic(0.3, 0.50);
    this.playBroadcastOrFallback(BROADCAST_AUDIO_PATHS.bossRoar, () => this.playVoices(createBossAlertVoices(tier)));
  }
  public playBossAlert(tier?: number): void { this.PlayBossAlert(tier ?? 1); }
  public playBossRoar(tier?: number): void {
    this.duckMusic(0.3, 0.50);
    this.playBroadcastOrFallback(BROADCAST_AUDIO_PATHS.bossRoar, () => this.playVoices(createBossAlertVoices(tier ?? 1)));
  }
  public PlayLevelUp(): void {
    this.duckMusic(0.4, 0.50);
    this.playBroadcastOrFallback(BROADCAST_AUDIO_PATHS.levelUp, () => this.playVoices(createLevelUpVoices()));
  }
  public playLevelUp(): void { this.PlayLevelUp(); }
  public PlayVictory(): void {
    this.duckMusic(0.4, 0.50);
    this.playBroadcastOrFallback(BROADCAST_AUDIO_PATHS.victory, () => this.playVoices(createVictoryVoices()));
  }
  public playVictory(): void { this.PlayVictory(); }
  public PlayFloorClear(): void { this.playLevelUp(); }
  public playFloorClear(): void { this.PlayFloorClear(); }
  public playCardPick(rarity?: string): void { this.playVoices(createCardPickVoices(rarity)); }
  public PlayRevive(): void { this.playVoices(createReviveVoices()); }
  public playRevive(): void { this.PlayRevive(); }

  // --- Celestial & Hyperspace Warp Events ---
  public PlayWarpJump(): void {
    this.duckMusic(0.25, 0.55);
    this.playBroadcastOrFallback(BROADCAST_AUDIO_PATHS.warpJump, () => {
      const ctx = this.initCtx();
      if (!ctx || this._muted) return;
      playWarpJump(ctx, this._sfxGain || this._masterGain || ctx.destination);
    });
  }
  public playWarpJump(): void { this.PlayWarpJump(); }

  public PlayUniqueHelmetReveal(): void {
    const ctx = this.initCtx();
    if (!ctx || this._muted) return;
    playUniqueHelmetReveal(ctx, this._sfxGain || this._masterGain || ctx.destination);
  }
  public playUniqueHelmetReveal(): void { this.PlayUniqueHelmetReveal(); }

  public PlayVoidCollapse(): void {
    this.playVoices(createVoidCollapseVoices());
  }
  public playVoidCollapse(): void { this.PlayVoidCollapse(); }

  public SetFrenzyState(on: boolean): void {
    if (this._musicPlayer?.setFrenzyState) this._musicPlayer.setFrenzyState(on);
  }
  public setFrenzyState(on: boolean): void { this.SetFrenzyState(on); }

  public SetMusicIntensity(intensity01: number): void {
    if (this._musicPlayer?.setMusicIntensity) this._musicPlayer.setMusicIntensity(intensity01);
  }
  public setMusicIntensity(intensity01: number): void { this.SetMusicIntensity(intensity01); }

  public SetBossMode(on: boolean): void {
    if (this._musicPlayer?.setBossMode) this._musicPlayer.setBossMode(on, 1);
  }
  public setBossMode(on: boolean): void { this.SetBossMode(on); }

  public StartMusic(): void {
    if (this._musicPlayer?.startMusic) this._musicPlayer.startMusic();
  }
  public startMusic(): void { this.StartMusic(); }

  public StopMusic(): void {
    if (this._musicPlayer?.stopMusic) this._musicPlayer.stopMusic();
  }
  public stopMusic(): void { this.StopMusic(); }

  public SetPaused(paused: boolean): void {
    this._paused = paused;
    if (this._musicPlayer?.setPaused) this._musicPlayer.setPaused(paused);
  }
  public setPaused(paused: boolean): void { this.SetPaused(paused); }

  public setSfxVolume(vol: number): void {
    this._sfxVol = MathX.clamp01(vol);
    if (this._sfxGain && !this._muted) {
      this._sfxGain.gain.value = this._sfxVol;
    }
  }

  public setMusicVolume(vol: number): void {
    this._musVol = MathX.clamp01(vol);
    if (this._musicGain && !this._muted) {
      this._musicGain.gain.value = this._musVol;
    }
  }

  public setMute(muted: boolean): void {
    this.setMuted(muted);
  }

  public setMuted(muted: boolean): void {
    this._muted = muted;
    if (this._sfxGain) {
      this._sfxGain.gain.value = this._muted ? 0 : this._sfxVol;
    }
    if (this._musicGain) {
      this._musicGain.gain.value = this._muted ? 0 : this._musVol;
    }
  }

  /** Cleanly tears down master audio nodes and voice limiter tracking maps. */
  public dispose(): void {
    if (this._musicPlayer && typeof this._musicPlayer.stopMusic === 'function') {
      try { this._musicPlayer.stopMusic(); } catch {}
    }
    if (this._sfxGain) {
      try { this._sfxGain.disconnect(); } catch {}
      this._sfxGain = null;
    }
    if (this._musicGain) {
      try { this._musicGain.disconnect(); } catch {}
      this._musicGain = null;
    }
    if (this._masterCompressor) {
      try { this._masterCompressor.disconnect(); } catch {}
      this._masterCompressor = null;
    }
    if (this._masterGain) {
      try { this._masterGain.disconnect(); } catch {}
      this._masterGain = null;
    }
    this._lastPlayTimes.clear();
    this._activeVoiceCounts.clear();
  }
}
