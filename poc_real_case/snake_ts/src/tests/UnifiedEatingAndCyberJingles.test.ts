import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BROADCAST_AUDIO_PATHS,
  createEatVoices,
  createLevelUpVoices,
  createVictoryVoices,
  createGameOverVoices,
  createBossAlertVoices,
  createUniqueHelmetRevealVoices,
  playUniqueHelmetReveal,
  setCachedAudioBuffer,
  clearAudioBufferCache,
} from '../audio/Synth';
import { SoundEngine } from '../audio/SoundEngine';

describe('Unified Eating Sound & Short Cyber Jingles Conformance Suite (TDD)', () => {
  class MockAudioParam {
    public value: number = 1.0;
    public setValueAtTime = vi.fn((val: number, _t: number) => { this.value = val; return this; });
    public linearRampToValueAtTime = vi.fn((val: number, _t: number) => { this.value = val; return this; });
    public exponentialRampToValueAtTime = vi.fn((val: number, _t: number) => { this.value = val; return this; });
    public cancelScheduledValues = vi.fn().mockReturnThis();
  }

  class MockAudioNode {
    public connectedTargets: any[] = [];
    public disconnected: boolean = false;
    public connect(dest: any): any {
      this.connectedTargets.push(dest);
      return dest;
    }
    public disconnect(): void {
      this.disconnected = true;
      this.connectedTargets = [];
    }
  }

  class MockGainNode extends MockAudioNode {
    public gain = new MockAudioParam();
  }

  class MockOscillatorNode extends MockAudioNode {
    public type: string = 'sine';
    public frequency = new MockAudioParam();
    public onended: (() => void) | null = null;
    public start(): void {}
    public stop(): void {}
  }

  class MockBufferSourceNode extends MockAudioNode {
    public buffer: any = null;
    public playbackRate = new MockAudioParam();
    public onended: (() => void) | null = null;
    public start(): void {}
    public stop(): void {}
  }

  class MockAudioContext {
    public currentTime: number = 50.0;
    public sampleRate: number = 44100;
    public state: string = 'running';
    public destination = new MockAudioNode();
    public createdOscillators: MockOscillatorNode[] = [];
    public createdGains: MockGainNode[] = [];
    public createdSources: MockBufferSourceNode[] = [];

    public createGain(): MockGainNode {
      const g = new MockGainNode();
      this.createdGains.push(g);
      return g;
    }

    public createOscillator(): MockOscillatorNode {
      const o = new MockOscillatorNode();
      this.createdOscillators.push(o);
      return o;
    }

    public createBufferSource(): MockBufferSourceNode {
      const s = new MockBufferSourceNode();
      this.createdSources.push(s);
      return s;
    }

    public resume(): Promise<void> {
      return Promise.resolve();
    }
  }

  beforeEach(() => {
    clearAudioBufferCache();
  });

  describe('1. BROADCAST_AUDIO_PATHS Registration', () => {
    it('registers eat and eatPop pointing to assets/audio/sfx_eat.wav', () => {
      expect((BROADCAST_AUDIO_PATHS as any).eat).toBe('assets/audio/sfx_eat.wav');
      expect((BROADCAST_AUDIO_PATHS as any).eatPop).toMatch(/sfx_eat/);
    });
  });

  describe('2. Unified Eating Sound (createEatVoices)', () => {
    it('returns strictly identical VoiceSpec array for all combos and golden status', () => {
      const v1 = createEatVoices(1, false);
      const v5 = createEatVoices(5, false);
      const v20 = createEatVoices(20, false);
      const vGolden1 = createEatVoices(1, true);
      const vGolden10 = createEatVoices(10, true);

      expect(v1).toEqual(v5);
      expect(v1).toEqual(v20);
      expect(v1).toEqual(vGolden1);
      expect(v1).toEqual(vGolden10);
    });

    it('implements <= 38ms duration with rich lower tones mouth chomp (not a ding)', () => {
      const voices = createEatVoices(1, false);
      expect(voices.length).toBeGreaterThanOrEqual(2);

      // Verify max duration is strictly <= 38ms (0.038s)
      const maxDur = Math.max(...voices.map(v => v.when + v.dur));
      expect(maxDur).toBeCloseTo(0.038, 3);
      expect(maxDur).toBeLessThanOrEqual(0.03801);

      // Layer 1: Deep jaw chomp in lower tones (240Hz -> 110Hz downward chirp with lowpass filter)
      const deepJaw = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 240) < 5);
      expect(deepJaw).toBeDefined();
      expect(deepJaw!.freqEnd).toBeCloseTo(110, 1);
      expect(deepJaw!.dur).toBeCloseTo(0.038, 3);
      expect(deepJaw!.filter).toBe('lowpass');
      expect(deepJaw!.cutoff).toBeLessThanOrEqual(500);

      // Layer 2: Low-mid mouth cavity resonance (380Hz -> 180Hz)
      const mouthRes = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 380) < 5);
      expect(mouthRes).toBeDefined();
      expect(mouthRes!.freqEnd).toBeCloseTo(180, 1);

      // Layer 3: Tactile tooth bite crunch snap (dur <= 15ms, bandpass around 2200Hz)
      const snap = voices.find(v => v.isNoise && Math.abs((v.cutoff ?? 0) - 2200) < 400);
      expect(snap).toBeDefined();
      expect(snap!.dur).toBeLessThanOrEqual(0.015);
      expect(snap!.filter).toBe('bandpass');

      // Verify absence of high-pitch static bell ding frequencies (> 1000Hz)
      const highBell = voices.find(v => !v.isNoise && v.type === 'sine' && (v.freq ?? 0) > 1000 && v.freqEnd === undefined);
      expect(highBell).toBeUndefined();
    });

    it('asserts single unified eating sound has duration <= 38ms, rich lower tones profile, identical for standard & golden food', () => {
      const standardVoices = createEatVoices(1, false);
      const goldenVoices = createEatVoices(1, true);
      const highComboVoices = createEatVoices(15, false);

      expect(standardVoices).toEqual(goldenVoices);
      expect(standardVoices).toEqual(highComboVoices);

      for (const voices of [standardVoices, goldenVoices, highComboVoices]) {
        const totalDuration = Math.max(...voices.map(v => (v.when ?? 0) + (v.dur ?? 0)));
        expect(totalDuration).toBeLessThanOrEqual(0.03801);

        // Lower tones jaw chomp: 240Hz -> 110Hz
        const deepJaw = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 240) < 5);
        expect(deepJaw).toBeDefined();
        expect(deepJaw!.freqEnd).toBeCloseTo(110, 1);

        // Tooth snap transient
        const snap = voices.find(v => v.isNoise && Math.abs((v.cutoff ?? 0) - 2200) < 400);
        expect(snap).toBeDefined();
        expect(snap!.filter).toBe('bandpass');

        // Must NOT have static bell ding (>1000Hz)
        const bell = voices.find(v => !v.isNoise && v.type === 'sine' && (v.freq ?? 0) > 1000 && v.freqEnd === undefined);
        expect(bell).toBeUndefined();
      }
    });
  });

  describe('3. Short Cyber Jingles Procedural Specifications', () => {
    it('createLevelUpVoices produces a short <= 0.45s cyber ascension chime with 65Hz sub-bass', () => {
      const voices = createLevelUpVoices();
      const maxDur = Math.max(...voices.map(v => v.when + v.dur));
      expect(maxDur).toBeCloseTo(0.45, 2);
      expect(maxDur).toBeLessThanOrEqual(0.45001);

      const sub = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 65) < 3);
      expect(sub).toBeDefined();

      const toneVoices = voices.filter(v => !v.isNoise && v.freq !== undefined && v.freq > 100);
      expect(toneVoices.length).toBe(4);

      // Notes: A5 (880.00Hz), C#6 (1108.73Hz), E6 (1318.51Hz), A6 (1760.00Hz)
      const expectedPitches = [880.00, 1108.73, 1318.51, 1760.00];
      expectedPitches.forEach(pitch => {
        const match = toneVoices.some(v => Math.abs(v.freq! - pitch) < 5.0);
        expect(match).toBe(true);
      });

      // Ascending timing
      expect(toneVoices[1]!.when).toBeGreaterThan(toneVoices[0]!.when);
      expect(toneVoices[2]!.when).toBeGreaterThan(toneVoices[1]!.when);
      expect(toneVoices[3]!.when).toBeGreaterThan(toneVoices[2]!.when);
    });

    it('createVictoryVoices produces a short <= 0.65s futuristic triumph cadence with 50Hz sub-bass', () => {
      const voices = createVictoryVoices();
      const maxDur = Math.max(...voices.map(v => v.when + v.dur));
      expect(maxDur).toBeCloseTo(0.65, 2);
      expect(maxDur).toBeLessThanOrEqual(0.65001);

      const subBass = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 50) < 3);
      expect(subBass).toBeDefined();

      const tones = voices.filter(v => !v.isNoise && v.freq !== undefined && v.freq > 100);
      expect(tones.length).toBeGreaterThanOrEqual(4);
    });

    it('createGameOverVoices produces a short <= 0.50s clean cybernetic deactivation pulse (440Hz -> 55Hz)', () => {
      const voices = createGameOverVoices();
      const maxDur = Math.max(...voices.map(v => v.when + v.dur));
      expect(maxDur).toBeCloseTo(0.50, 2);
      expect(maxDur).toBeLessThanOrEqual(0.50001);

      const drop = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 440) < 15 && (v.freqEnd ?? 0) <= 60);
      expect(drop).toBeDefined();
    });

    it('createBossAlertVoices produces a short <= 0.58s ominous sub-bass pulse with resonant filter sweep', () => {
      const voices = createBossAlertVoices(1);
      const maxDur = Math.max(...voices.map(v => v.when + v.dur));
      expect(maxDur).toBeCloseTo(0.58, 2);
      expect(maxDur).toBeLessThanOrEqual(0.58001);

      const sub = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 45) < 5);
      expect(sub).toBeDefined();
    });

    it('createUniqueHelmetRevealVoices produces a short <= 0.68s celestial cyber-resonance', () => {
      const voices = createUniqueHelmetRevealVoices();
      const maxDur = Math.max(...voices.map(v => v.when + v.dur));
      expect(maxDur).toBeCloseTo(0.65, 2);
      expect(maxDur).toBeLessThanOrEqual(0.68);

      const toneVoices = voices.filter(v => !v.isNoise && v.freq !== undefined);
      expect(toneVoices.length).toBeGreaterThanOrEqual(5);
    });

    it('asserts all procedural jingle voice specs are concise, crystal-clear, with durations <= 0.68s', () => {
      const allJingles = [
        { name: 'levelUp', specs: createLevelUpVoices() },
        { name: 'victory', specs: createVictoryVoices() },
        { name: 'gameOver', specs: createGameOverVoices() },
        { name: 'bossAlert', specs: createBossAlertVoices(1) },
        { name: 'helmetReveal', specs: createUniqueHelmetRevealVoices() },
      ];

      for (const { name, specs } of allJingles) {
        const dur = Math.max(...specs.map(v => (v.when ?? 0) + (v.dur ?? 0)));
        expect(dur, `${name} exceeds 0.68s ceiling`).toBeLessThanOrEqual(0.68);
        const harmonicTones = specs.filter(v => !v.isNoise && (v.type === 'sine' || v.type === 'triangle'));
        expect(harmonicTones.length, `${name} missing harmonic tones`).toBeGreaterThanOrEqual(1);
      }
    });

    it('playUniqueHelmetReveal executes within 0.65s and cleans up all audio nodes', () => {
      const mockCtx = new MockAudioContext();
      const dest = new MockAudioNode();
      const handle = playUniqueHelmetReveal(mockCtx as any, dest as any);

      expect(handle).toBeDefined();
      expect(mockCtx.createdOscillators.length).toBeGreaterThanOrEqual(5);

      mockCtx.createdOscillators.forEach(o => o.onended?.());
      expect(mockCtx.createdOscillators.every(o => o.disconnected)).toBe(true);
      expect(mockCtx.createdGains.every(g => g.disconnected)).toBe(true);
    });
  });

  describe('4. SoundEngine Integration & Routing', () => {
    let sound: SoundEngine;
    let mockCtx: MockAudioContext;

    beforeEach(() => {
      sound = new SoundEngine();
      mockCtx = new MockAudioContext();
      (sound as any)._ctx = mockCtx;
      (sound as any)._masterGain = mockCtx.createGain();
      (sound as any)._sfxGain = mockCtx.createGain();
      (sound as any)._musicGain = mockCtx.createGain();
    });

    it('playEat unconditionally plays BROADCAST_AUDIO_PATHS.eat for both normal and golden food', () => {
      const eatBuf: any = { id: 'sfx_eat_unified', duration: 0.038 };
      setCachedAudioBuffer((BROADCAST_AUDIO_PATHS as any).eat, eatBuf);

      // Normal food
      sound.playEat(1, false);
      expect(mockCtx.createdSources.length).toBe(1);
      expect(mockCtx.createdSources[0]!.buffer).toBe(eatBuf);

      // Golden food -> MUST PLAY THE SAME UNIFIED EAT BUFFER!
      sound.playEat(5, true);
      expect(mockCtx.createdSources.length).toBe(2);
      expect(mockCtx.createdSources[1]!.buffer).toBe(eatBuf);
    });

    it('playShard and playStar trigger the unified eating sound profile', () => {
      const starBuf: any = { id: 'star_buffer', duration: 0.038 };
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.starDing, starBuf);
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.gemChime, starBuf);

      mockCtx.currentTime = 10.0;
      sound.playShard();
      expect(mockCtx.createdSources.length).toBe(1);
      expect(mockCtx.createdSources[0]!.buffer).toBe(starBuf);

      mockCtx.currentTime = 10.1;
      sound.playStar();
      expect(mockCtx.createdSources.length).toBe(2);
      expect(mockCtx.createdSources[1]!.buffer).toBe(starBuf);
    });

    it('playFloorClear delegates to playLevelUp (concise chime instead of 3.4s fanfare)', () => {
      const levelUpSpy = vi.spyOn(sound, 'playLevelUp');
      const victorySpy = vi.spyOn(sound, 'playVictory');

      sound.playFloorClear();
      expect(levelUpSpy).toHaveBeenCalledTimes(1);
      expect(victorySpy).not.toHaveBeenCalled();
    });

    it('duckMusic applies transparent sidechain ducking (<= 0.55s)', () => {
      sound.setMusicVolume(0.5);
      mockCtx.currentTime = 100.0;

      // Default duckMusic duration is <= 0.55s
      sound.duckMusic();
      const musicGain = (sound as any)._musicGain as MockGainNode;
      expect(musicGain).toBeDefined();
      const calls = musicGain.gain.linearRampToValueAtTime.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      const restoreTime = calls[calls.length - 1]![1];
      expect(restoreTime).toBeCloseTo(100.50, 2);
    });

    it('milestone events invoke concise ducking durations matching short jingles (<= 0.55s)', () => {
      const duckSpy = vi.spyOn(sound, 'duckMusic');

      sound.playLevelUp();
      const lastCall1 = duckSpy.mock.calls[duckSpy.mock.calls.length - 1]!;
      expect(lastCall1[1]).toBeCloseTo(0.50, 2);
      expect(lastCall1[1]).toBeLessThanOrEqual(0.55);

      sound.playVictory();
      const lastCall2 = duckSpy.mock.calls[duckSpy.mock.calls.length - 1]!;
      expect(lastCall2[1]).toBeCloseTo(0.50, 2);
      expect(lastCall2[1]).toBeLessThanOrEqual(0.55);

      sound.playGameOver();
      const lastCall3 = duckSpy.mock.calls[duckSpy.mock.calls.length - 1]!;
      expect(lastCall3[1]).toBeCloseTo(0.50, 2);
      expect(lastCall3[1]).toBeLessThanOrEqual(0.55);

      sound.playBossAlert(1);
      const lastCall4 = duckSpy.mock.calls[duckSpy.mock.calls.length - 1]!;
      expect(lastCall4[1]).toBeCloseTo(0.50, 2);
      expect(lastCall4[1]).toBeLessThanOrEqual(0.55);

      sound.playWarpJump();
      const lastCall5 = duckSpy.mock.calls[duckSpy.mock.calls.length - 1]!;
      expect(lastCall5[1]).toBeCloseTo(0.55, 2);
      expect(lastCall5[1]).toBeLessThanOrEqual(0.55);
    });
  });
});
