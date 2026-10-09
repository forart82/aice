import { describe, it, expect, beforeEach } from 'vitest';
import {
  isNum,
  clamp01,
  semi,
  cents,
  gainToDb,
  dbToGain,
  OscillatorVoice,
  BiquadFilter,
  OnePoleFilter,
  ParamCurve,
  ParamRunner,
  NoiseBuffer,
  makeDistortionCurve,
  softClip,
  bakeSoundToBuffer,
  VoiceSpec,
  DEFAULT_SAMPLE_RATE
} from '../audio/Synth.js';
import { SoundEngine } from '../audio/SoundEngine.js';
import { MusicPlayer } from '../audio/MusicPlayer.js';

describe('Synth DSP and Math Utilities', () => {
  it('validates numbers and clamps accurately', () => {
    expect(isNum(42)).toBe(true);
    expect(isNum(0)).toBe(true);
    expect(isNum(-3.14)).toBe(true);
    expect(isNum(NaN)).toBe(false);
    expect(isNum(Infinity)).toBe(false);
    expect(isNum('42')).toBe(false);

    expect(clamp01(-0.5)).toBe(0.0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1.5)).toBe(1.0);
  });

  it('converts semitones and cents precisely', () => {
    expect(semi(0)).toBeCloseTo(1.0, 5);
    expect(semi(12)).toBeCloseTo(2.0, 5);
    expect(semi(-12)).toBeCloseTo(0.5, 5);
    expect(semi(7)).toBeCloseTo(1.4983, 3); // Perfect fifth

    expect(cents(0)).toBeCloseTo(1.0, 5);
    expect(cents(1200)).toBeCloseTo(2.0, 5);
    expect(cents(100)).toBeCloseTo(semi(1), 5);
  });

  it('converts gain and dB bidirectionally', () => {
    expect(gainToDb(1.0)).toBeCloseTo(0.0, 2);
    expect(gainToDb(0.5)).toBeCloseTo(-6.02, 1);
    expect(gainToDb(0.0)).toBe(-80.0);

    expect(dbToGain(0.0)).toBeCloseTo(1.0, 5);
    expect(dbToGain(-6.0206)).toBeCloseTo(0.5, 3);
    expect(dbToGain(-80.0)).toBe(0.0);
  });

  it('synthesizes band-limited PolyBLEP waveforms without crashing or NaN', () => {
    const osc = new OscillatorVoice();
    const shapes = ['sine', 'sawtooth', 'square', 'triangle'] as const;

    for (const shape of shapes) {
      osc.reset();
      for (let i = 0; i < 200; i++) {
        const sample = osc.next(shape, 440, DEFAULT_SAMPLE_RATE);
        expect(Number.isFinite(sample)).toBe(true);
        expect(sample).toBeGreaterThanOrEqual(-1.5);
        expect(sample).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it('processes RBJ Biquad filters across multiple configurations', () => {
    const filter = new BiquadFilter();
    filter.set('lowpass', 1000, 0.707, DEFAULT_SAMPLE_RATE);

    let output = 0;
    for (let i = 0; i < 100; i++) {
      output = filter.process(Math.sin(i * 0.1));
      expect(Number.isFinite(output)).toBe(true);
    }

    filter.set('highpass', 500, 1.0, DEFAULT_SAMPLE_RATE);
    filter.reset();
    for (let i = 0; i < 50; i++) {
      output = filter.process(0.5);
      expect(Number.isFinite(output)).toBe(true);
    }
  });

  it('evaluates ParamCurve and ParamRunner envelopes', () => {
    const curve = new ParamCurve();
    curve.setValueAtTime(0.1, 0.0);
    curve.linearRampToValueAtTime(1.0, 0.1);
    curve.exponentialRampToValueAtTime(0.01, 0.3);

    expect(curve.at(0.0)).toBeCloseTo(0.1, 2);
    expect(curve.at(0.05)).toBeCloseTo(0.55, 2);
    expect(curve.at(0.1)).toBeCloseTo(1.0, 2);

    const runner = new ParamRunner();
    runner.reset(curve, 1000); // 1000 Hz for easy calculation
    const samples: number[] = [];
    for (let i = 0; i < 300; i++) {
      samples.push(runner.next());
    }
    expect(samples.length).toBe(300);
    expect(samples[0]).toBeCloseTo(0.1, 1);
  });

  it('reads noise buffer fractionally with linear interpolation', () => {
    const noise = new NoiseBuffer(1000);
    expect(noise.data.length).toBe(1000);
    const s1 = noise.read(0.5);
    const s2 = noise.read(1500.25);
    expect(Number.isFinite(s1)).toBe(true);
    expect(Number.isFinite(s2)).toBe(true);
  });

  it('computes waveshaper distortion curves and soft clipping', () => {
    const dist = makeDistortionCurve(20, 512);
    expect(dist.length).toBe(512);
    expect(dist[0]).toBeLessThan(0);
    expect(dist[256]).toBeCloseTo(0, 1);
    expect(dist[511]).toBeGreaterThan(0);

    expect(softClip(0)).toBe(0);
    expect(softClip(10, 1)).toBeCloseTo(1.0, 2);
    expect(softClip(-10, 1)).toBeCloseTo(-1.0, 2);
  });

  it('bakes multiple voice specifications into a float buffer headlessly', () => {
    const voices: VoiceSpec[] = [
      { type: 'sine', freq: 440, when: 0, dur: 0.1, peak: 0.5 },
      { isNoise: true, when: 0.02, dur: 0.08, peak: 0.3, filter: 'highpass', cutoff: 2000 }
    ];
    const pcm = bakeSoundToBuffer(voices, 44100);
    expect(pcm.length).toBeGreaterThan(4400); // ~0.1s * 44100
    let hasSignal = false;
    for (let i = 0; i < pcm.length; i++) {
      if (Math.abs(pcm[i]!) > 0.001) hasSignal = true;
    }
    expect(hasSignal).toBe(true);
  });
});

describe('SoundEngine SFX Dispatcher', () => {
  let sound: SoundEngine;

  beforeEach(() => {
    sound = new SoundEngine();
  });

  it('initializes headlessly without throwing errors', () => {
    expect(sound).toBeDefined();
    sound.init();
    expect(sound.sfxVolume).toBe(0.75);
    expect(sound.musicVolume).toBe(0.38);
    expect(sound.isMuted).toBe(false);
  });

  it('handles volume and mute changes cleanly', () => {
    sound.setSfxVolume(0.85);
    expect(sound.sfxVolume).toBe(0.85);

    sound.setMusicVolume(0.5);
    expect(sound.musicVolume).toBe(0.5);

    sound.setMute(true);
    expect(sound.isMuted).toBe(true);

    sound.setMute(false);
    expect(sound.isMuted).toBe(false);
  });

  it('dispatches all SFX recipes safely in headless mode', () => {
    expect(() => {
      sound.playEat(1, false);
      sound.playEat(5, true);
      sound.playBite(25, true);
      sound.playHurt(15);
      sound.playDie();
      sound.playDash();
      sound.playHit(1);
      sound.playShoot(880);
      sound.playLaserFire(1040);
      sound.playExplosion(1.5);
      sound.playLevelUp();
      sound.playCardPick('legendary');
      sound.playBossAlert(1);
      sound.playBossRoar(2);
      sound.playComboTick(10);
      sound.playFrenzy();
      sound.playFrenzyStart();
      sound.playCrit();
      sound.playShield();
      sound.playShieldBreak();
      sound.playShard();
      sound.playUi();
      sound.playUiClick();
      sound.playUiHover();
      sound.playError();
      sound.playThunder(1.2);
      sound.playFlame();
      sound.playRevive();
      sound.playFloorClear();
      sound.playVictory();
      sound.playGameOver();
    }).not.toThrow();
  });
});

describe('MusicPlayer Procedural Synthesizer', () => {
  let sound: SoundEngine;
  let music: MusicPlayer;

  beforeEach(() => {
    sound = new SoundEngine();
    music = new MusicPlayer(sound);
  });

  it('calculates tempo and step duration dynamically', () => {
    music.setMusicIntensity(0.0);
    expect(music.getTempo()).toBe(112);
    expect(music.stepDuration).toBeCloseTo(60.0 / 112 / 4.0, 4);

    music.setMusicIntensity(1.0);
    expect(music.getTempo()).toBe(124);

    music.setFrenzyState(true);
    expect(music.getTempo()).toBe(156);

    music.setBossMode(true, 1);
    expect(music.getTempo()).toBe(110);
  });

  it('handles transport methods headlessly', () => {
    expect(() => {
      music.startMusic();
      music.setMusicIntensity(0.75);
      music.pauseMusic();
      music.resumeMusic();
      music.stopMusic();
    }).not.toThrow();
  });

  it('tracks currentTrack state and seamlessly transitions across game phases', () => {
    music.startMusic();
    expect(music.currentTrack).toBe('exploration');

    // High intensity (>0.6) transitions to combat
    music.setMusicIntensity(0.7);
    expect(music.currentTrack).toBe('combat');

    // Dropping intensity transitions back to exploration
    music.setMusicIntensity(0.3);
    expect(music.currentTrack).toBe('exploration');

    // Frenzy transitions to combat regardless of intensity
    music.setFrenzyState(true);
    expect(music.currentTrack).toBe('combat');

    // Boss mode takes precedence over frenzy
    music.setBossMode(true, 1);
    expect(music.currentTrack).toBe('boss');

    // Ending boss mode restores frenzy (combat)
    music.setBossMode(false);
    expect(music.currentTrack).toBe('combat');

    // Ending frenzy restores exploration
    music.setFrenzyState(false);
    expect(music.currentTrack).toBe('exploration');
  });

  it('supports sidechain ducking without throwing errors', () => {
    music.startMusic();
    expect(() => {
      music.duck(0.3, 0.4);
      music.duck(0.5);
      music.duck();
    }).not.toThrow();
  });

  it('falls back to procedural sequencer when broadcast buffers are absent', () => {
    music.startMusic();
    // Headless without cached buffers should keep procedural mode available
    expect(music.isPlaying).toBe(true);
    expect(music.isBroadcastActive).toBe(false);
  });
});

describe('Main Startup Audio & Gesture Unlock Integration', () => {
  it('calls sound.init upon application startup and sets up unlock handlers', async () => {
    const { setupMockDom } = await import('./MockDom.js');
    const restoreDom = setupMockDom();
    const { App, OuroborosApp } = await import('../main.js');

    const app = new OuroborosApp();
    expect(app.sound).toBeDefined();
    expect(app.sound.sfxVolume).toBe(0.75);
    expect(typeof app.init).toBe('function');
    expect(typeof app.hookAudioUnlock).toBe('function');

    restoreDom();
  });
});

