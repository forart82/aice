import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SoundEngine } from '../audio/SoundEngine';
import { clearAudioBufferCache, setCachedAudioBuffer, BROADCAST_AUDIO_PATHS } from '../audio/Synth';

describe('Master Dynamics Compressor, Voice Limiter & Sidechain Ducking', () => {
  class MockAudioParam {
    public value: number = 0;
    public setValueAtTime = vi.fn((val: number, _t: number) => {
      this.value = val;
      return this;
    });
    public linearRampToValueAtTime = vi.fn((val: number, _t: number) => {
      this.value = val;
      return this;
    });
    public exponentialRampToValueAtTime = vi.fn((val: number, _t: number) => {
      this.value = val;
      return this;
    });
    public setTargetAtTime = vi.fn().mockReturnThis();
    public cancelScheduledValues = vi.fn().mockReturnThis();
  }

  class MockAudioNode {
    public connectedTargets: any[] = [];
    public disconnected: boolean = false;

    public connect(target: any): any {
      this.connectedTargets.push(target);
      return target;
    }

    public disconnect(): void {
      this.disconnected = true;
      this.connectedTargets = [];
    }
  }

  class MockGainNode extends MockAudioNode {
    public gain = new MockAudioParam();
  }

  class MockDynamicsCompressorNode extends MockAudioNode {
    public threshold = new MockAudioParam();
    public knee = new MockAudioParam();
    public ratio = new MockAudioParam();
    public attack = new MockAudioParam();
    public release = new MockAudioParam();
  }

  class MockOscillatorNode extends MockAudioNode {
    public type: string = 'sine';
    public frequency = new MockAudioParam();
    public detune = new MockAudioParam();
    public onended: (() => void) | null = null;
    public started: boolean = false;
    public stopped: boolean = false;
    public start(): void { this.started = true; }
    public stop(): void { this.stopped = true; }
  }

  class MockBufferSourceNode extends MockAudioNode {
    public buffer: any = null;
    public playbackRate = new MockAudioParam();
    public detune = new MockAudioParam();
    public loop: boolean = false;
    public onended: (() => void) | null = null;
    public started: boolean = false;
    public stopped: boolean = false;
    public start(): void { this.started = true; }
    public stop(): void { this.stopped = true; }
  }

  class MockAudioContext {
    public currentTime: number = 10.0;
    public sampleRate: number = 44100;
    public state: string = 'running';
    public destination = new MockAudioNode();

    public createdCompressors: MockDynamicsCompressorNode[] = [];
    public createdGains: MockGainNode[] = [];
    public createdOscillators: MockOscillatorNode[] = [];
    public createdSources: MockBufferSourceNode[] = [];

    public createGain(): MockGainNode {
      const g = new MockGainNode();
      this.createdGains.push(g);
      return g;
    }

    public createDynamicsCompressor(): MockDynamicsCompressorNode {
      const c = new MockDynamicsCompressorNode();
      this.createdCompressors.push(c);
      return c;
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

    public createBuffer(channels: number, length: number, sampleRate: number): any {
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: () => new Float32Array(length),
      };
    }

    public resume(): Promise<void> {
      return Promise.resolve();
    }
  }

  let sound: SoundEngine;
  let mockCtx: MockAudioContext;

  beforeEach(() => {
    clearAudioBufferCache();
    sound = new SoundEngine();
    mockCtx = new MockAudioContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Master Dynamics Compressor Node & Audio Graph Topology', () => {
    it('creates DynamicsCompressorNode and configures studio mastering parameters', () => {
      (sound as any)._ctx = mockCtx;
      (sound as any).initCtx();

      expect(mockCtx.createdCompressors.length).toBe(1);
      const compressor = mockCtx.createdCompressors[0]!;

      // Studio mastering parameters check (-10dB, 6:1 ratio, 2ms attack, 120ms release)
      expect(compressor.threshold.value).toBe(-10);
      expect(compressor.knee.value).toBe(12);
      expect(compressor.ratio.value).toBe(6);
      expect(compressor.attack.value).toBeCloseTo(0.002, 4);
      expect(compressor.release.value).toBeCloseTo(0.12, 4);
    });

    it('connects audio graph: sfxGain & musicGain -> masterGain -> masterCompressor -> destination', () => {
      (sound as any)._ctx = mockCtx;
      (sound as any).initCtx();

      const compressor = (sound as any)._masterCompressor;
      const masterGain = (sound as any)._masterGain;
      const sfxGain = (sound as any)._sfxGain;
      const musicGain = (sound as any)._musicGain;

      expect(compressor).toBeDefined();
      expect(masterGain).toBeDefined();
      expect(sfxGain).toBeDefined();
      expect(musicGain).toBeDefined();

      // sfxGain -> masterGain
      expect(sfxGain.connectedTargets).toContain(masterGain);
      // musicGain -> masterGain
      expect(musicGain.connectedTargets).toContain(masterGain);
      // masterGain -> masterCompressor
      expect(masterGain.connectedTargets).toContain(compressor);
      // masterCompressor -> destination
      expect(compressor.connectedTargets).toContain(mockCtx.destination);
    });
  });

  describe('2. Voice Concurrency Limiter & Debounce System', () => {
    it('exposes canPlay query method and respects cooldown intervals and concurrency limits', () => {
      expect(typeof sound.canPlay).toBe('function');

      // Initial query for 'hit' should be allowed
      expect(sound.canPlay('hit', 35, 3)).toBe(true);

      // Artificially simulate last play time as right now
      sound._lastPlayTimes.set('hit', performance.now());
      // Calling canPlay within 35ms returns false
      expect(sound.canPlay('hit', 35, 3)).toBe(false);

      // After cooldown expires, canPlay is true again
      sound._lastPlayTimes.set('hit', performance.now() - 40);
      expect(sound.canPlay('hit', 35, 3)).toBe(true);

      // When active count reaches maxConcurrent (3), canPlay returns false
      sound._activeVoiceCounts.set('hit', 3);
      expect(sound.canPlay('hit', 35, 3)).toBe(false);

      // When active count drops below 3, canPlay is true again
      sound._activeVoiceCounts.set('hit', 2);
      expect(sound.canPlay('hit', 35, 3)).toBe(true);
    });

    it('rapidly calling playHit() 20 times within 10ms only emits within the allowed threshold', () => {
      const playVoicesSpy = vi.spyOn(sound, 'playVoices');

      // Call playHit 20 times rapidly (synchronously executes in < 2ms)
      for (let i = 0; i < 20; i++) {
        sound.playHit(1.0);
      }

      // Only the first hit should have been emitted due to 35ms debounce
      expect(playVoicesSpy).toHaveBeenCalledTimes(1);
    });

    it('enforces specific throttling rules across SFX types', () => {
      const playVoicesSpy = vi.spyOn(sound, 'playVoices');

      // 1. bite: minInterval = 40ms, maxConcurrent = 2
      sound.playBite(10);
      sound.playBite(10);
      sound.playBite(10);
      expect(playVoicesSpy).toHaveBeenCalledTimes(1);

      playVoicesSpy.mockClear();

      // 2. explosion: minInterval = 60ms, maxConcurrent = 2
      sound.playExplosion(1.0);
      sound.playExplosion(1.0);
      expect(playVoicesSpy).toHaveBeenCalledTimes(1);

      playVoicesSpy.mockClear();

      // 3. thunder: minInterval = 80ms, maxConcurrent = 2
      sound.playThunder(1.0);
      sound.playThunder(1.0);
      expect(playVoicesSpy).toHaveBeenCalledTimes(1);
    });

    it('applies subtle round-robin micro-pitch variation (detune ±35 cents) to eliminate robotic shoot repetition', () => {
      (sound as any)._ctx = mockCtx;
      (sound as any)._masterGain = mockCtx.createGain();
      (sound as any)._sfxGain = mockCtx.createGain();

      const dummyBuf: any = { duration: 0.1, length: 4410 };
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.laserPew, dummyBuf);

      const capturedPlaybackRates: number[] = [];

      // Advance time artificially to bypass 40ms interval
      for (let i = 0; i < 4; i++) {
        sound._lastPlayTimes.set('shoot', performance.now() - 50);
        sound._activeVoiceCounts.set('shoot', 0);
        sound.playShoot(880);

        const src = mockCtx.createdSources[i]!;
        expect(src).toBeDefined();
        // Check playbackRate value was set
        const rate = src.playbackRate.value;
        capturedPlaybackRates.push(rate);
      }

      expect(capturedPlaybackRates.length).toBe(4);
      // Verify values differ and stay within ±35 cents multiplier range: [2^(-35/1200), 2^(35/1200)] = [0.980, 1.020]
      for (const rate of capturedPlaybackRates) {
        expect(rate).toBeGreaterThanOrEqual(0.979);
        expect(rate).toBeLessThanOrEqual(1.021);
      }
      // Verify not all rates are identical (micro-pitch variation present)
      const allIdentical = capturedPlaybackRates.every(r => r === capturedPlaybackRates[0]);
      expect(allIdentical).toBe(false);
    });

    it('tracks voice completion and decrements _activeVoiceCounts when onended / cleanup occurs', () => {
      (sound as any)._ctx = mockCtx;
      (sound as any)._masterGain = mockCtx.createGain();
      (sound as any)._sfxGain = mockCtx.createGain();

      const dummyBuf: any = { duration: 0.2, length: 8820 };
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.eat, dummyBuf);

      // Calling playEat increments active voice count
      sound.playEat(1, false);
      expect(sound._activeVoiceCounts.get('eat')).toBe(1);

      // Trigger source onended callback
      const src = mockCtx.createdSources[0]!;
      expect(src.onended).toBeDefined();
      src.onended!();

      // Count decrements back to 0
      expect(sound._activeVoiceCounts.get('eat')).toBe(0);
    });
  });

  describe('3. Sidechain Ducking System', () => {
    it('duckMusic ramps _musicGain down to _musVol * duckGain over 0.03s and restores to _musVol over durationSec', () => {
      (sound as any)._ctx = mockCtx;
      (sound as any).initCtx();

      const musicGain = (sound as any)._musicGain as MockGainNode;
      expect(musicGain).toBeDefined();

      sound.setMusicVolume(0.5);
      mockCtx.currentTime = 100.0;

      // Invoke sidechain ducking with transparent timing
      sound.duckMusic(0.4, 0.55);

      expect(musicGain.gain.cancelScheduledValues).toHaveBeenCalledWith(100.0);
      expect(musicGain.gain.setValueAtTime).toHaveBeenCalledWith(0.5, 100.0);
      // Target ducked volume: 0.5 * 0.4 = 0.2 ramped down over 0.03s
      expect(musicGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.2, 100.03);
      // Restores back to 0.5 over 0.55s
      expect(musicGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, 100.55);
    });

    it('duckMusic default duration is transparent (<= 0.55s) to prevent prolonged music attenuation', () => {
      (sound as any)._ctx = mockCtx;
      (sound as any).initCtx();

      const musicGain = (sound as any)._musicGain as MockGainNode;
      mockCtx.currentTime = 100.0;

      // Default duckMusic call
      sound.duckMusic();
      const calls = musicGain.gain.linearRampToValueAtTime.mock.calls;
      const restoreCall = calls[calls.length - 1];
      expect(restoreCall).toBeDefined();
      const restoreTime = restoreCall[1];
      const duckDuration = restoreTime - mockCtx.currentTime;
      expect(duckDuration).toBeLessThanOrEqual(0.55);
    });

    it('automatically triggers duckMusic with transparent duration (<= 0.55s) on major milestone and alert events', () => {
      const duckSpy = vi.spyOn(sound, 'duckMusic');

      sound.playLevelUp();
      expect(duckSpy).toHaveBeenCalled();
      const levelUpDur = duckSpy.mock.calls[0]?.[1] ?? 0.55;
      expect(levelUpDur).toBeLessThanOrEqual(0.55);
      duckSpy.mockClear();

      sound.playVictory();
      expect(duckSpy).toHaveBeenCalled();
      const vicDur = duckSpy.mock.calls[0]?.[1] ?? 0.55;
      expect(vicDur).toBeLessThanOrEqual(0.55);
      duckSpy.mockClear();

      sound.playGameOver();
      expect(duckSpy).toHaveBeenCalled();
      const goDur = duckSpy.mock.calls[0]?.[1] ?? 0.55;
      expect(goDur).toBeLessThanOrEqual(0.55);
      duckSpy.mockClear();

      sound.playBossAlert(1);
      expect(duckSpy).toHaveBeenCalled();
      const bossDur = duckSpy.mock.calls[0]?.[1] ?? 0.55;
      expect(bossDur).toBeLessThanOrEqual(0.55);
    });
  });
});
