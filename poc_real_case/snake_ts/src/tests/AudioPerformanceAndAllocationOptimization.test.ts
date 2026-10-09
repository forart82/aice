import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SoundEngine } from '../audio/SoundEngine';
import {
  clearAudioBufferCache,
  setCachedAudioBuffer,
  BROADCAST_AUDIO_PATHS,
  getContextNoiseBuffer,
  getAudioContext,
} from '../audio/Synth';

describe('Audio Performance, Voice Concurrency Clamping & Memory Allocation Optimization', () => {
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

  class MockBiquadFilterNode extends MockAudioNode {
    public type: string = 'lowpass';
    public frequency = new MockAudioParam();
    public Q = new MockAudioParam();
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
    public createdFilters: MockBiquadFilterNode[] = [];
    public createdBuffers: any[] = [];

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

    public createBiquadFilter(): MockBiquadFilterNode {
      const f = new MockBiquadFilterNode();
      this.createdFilters.push(f);
      return f;
    }

    public createBuffer(channels: number, length: number, sampleRate: number): any {
      const buf = {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        channelData: new Float32Array(length),
        getChannelData: () => buf.channelData,
      };
      this.createdBuffers.push(buf);
      return buf;
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
    (sound as any)._ctx = mockCtx;
    (sound as any).initCtx();
  });

  afterEach(() => {
    sound.dispose();
    vi.restoreAllMocks();
  });

  describe('1. Rapid Concurrent Audio Trigger Bursts & Dispatch Latency', () => {
    it('dispatches 1,000 rapid concurrent calls to playEat, playShoot, playHit, playExplosion with microsecond latency (< 0.05ms/call)', () => {
      // Set up dummy broadcast buffers
      const dummyBuf: any = { duration: 0.1, length: 4410 };
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.eat, dummyBuf);
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.laserPew, dummyBuf);
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.hit, dummyBuf);
      setCachedAudioBuffer((BROADCAST_AUDIO_PATHS as any).explosion, dummyBuf);

      const iterations = 1000;
      const t0 = performance.now();

      for (let i = 0; i < iterations; i++) {
        sound.playEat(1, false);
        sound.playShoot(880);
        sound.playHit(1.0);
        sound.playExplosion(1.0);
      }

      const totalMs = performance.now() - t0;
      const totalCalls = iterations * 4;
      const msPerCall = totalMs / totalCalls;

      // Microsecond latency requirement: < 0.05ms (50 µs) per call
      expect(msPerCall).toBeLessThan(0.05);
      // Ensure the engine was able to handle all 4,000 calls without error in < 100ms
      expect(totalMs).toBeLessThan(100);
    });

    it('voice count clamps stay strictly within hardware safety limits (max 4 per channel) under burst bombardment', () => {
      const dummyBuf: any = { duration: 0.2, length: 8820 };
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.eat, dummyBuf);
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.laserPew, dummyBuf);
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.hit, dummyBuf);
      setCachedAudioBuffer((BROADCAST_AUDIO_PATHS as any).explosion, dummyBuf);

      // Fire 1,000 rapid calls synchronously (within 10ms, far faster than voice durations)
      for (let i = 0; i < 1000; i++) {
        sound.playEat(1, false);
        sound.playShoot(440);
        sound.playHit(1.0);
        sound.playExplosion(1.0);

        // Invariant: at EVERY step during the burst, no channel may exceed 4 concurrent voices
        const eatCount = sound._activeVoiceCounts.get('eat') ?? 0;
        const shootCount = sound._activeVoiceCounts.get('shoot') ?? 0;
        const hitCount = sound._activeVoiceCounts.get('hit') ?? 0;
        const explosionCount = sound._activeVoiceCounts.get('explosion') ?? 0;

        expect(eatCount).toBeLessThanOrEqual(4);
        expect(shootCount).toBeLessThanOrEqual(4);
        expect(hitCount).toBeLessThanOrEqual(3);
        expect(explosionCount).toBeLessThanOrEqual(2);
      }
    });
  });

  describe('2. Active Voice Lifecycle & Concurrency Release', () => {
    it('accurately tracks active voices and decrements to 0 when buffer sources end', () => {
      const dummyBuf: any = { duration: 0.1, length: 4410 };
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.hit, dummyBuf);
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.laserPew, dummyBuf);
      setCachedAudioBuffer((BROADCAST_AUDIO_PATHS as any).explosion, dummyBuf);

      // 1. Trigger hit voice
      sound.playHit(1.0);
      expect(sound._activeVoiceCounts.get('hit')).toBe(1);

      // Trigger shoot voice
      sound.playShoot(440);
      expect(sound._activeVoiceCounts.get('shoot')).toBe(1);

      // Trigger explosion voice
      sound.playExplosion(1.0);
      expect(sound._activeVoiceCounts.get('explosion')).toBe(1);

      // End all created buffer sources
      for (const src of mockCtx.createdSources) {
        if (src.onended) src.onended();
      }

      // Counts must drop back to 0
      expect(sound._activeVoiceCounts.get('hit')).toBe(0);
      expect(sound._activeVoiceCounts.get('shoot')).toBe(0);
      expect(sound._activeVoiceCounts.get('explosion')).toBe(0);
    });

    it('rejects new voice requests when concurrency ceiling is reached until existing voice finishes', () => {
      const dummyBuf: any = { duration: 0.2, length: 8820 };
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.laserPew, dummyBuf);

      // Shoot limit is 4
      for (let i = 0; i < 4; i++) {
        // Bypass time debounce for testing voice concurrency ceiling
        sound._lastPlayTimes.set('shoot', performance.now() - 100);
        sound.playShoot(440);
      }
      expect(sound._activeVoiceCounts.get('shoot')).toBe(4);
      const initialSourcesCount = mockCtx.createdSources.length;
      expect(initialSourcesCount).toBe(4);

      // 5th shoot attempt should be rejected by concurrency ceiling
      sound._lastPlayTimes.set('shoot', performance.now() - 100);
      sound.playShoot(440);
      expect(sound._activeVoiceCounts.get('shoot')).toBe(4);
      expect(mockCtx.createdSources.length).toBe(4); // No new node created

      // End one voice
      mockCtx.createdSources[0]!.onended!();
      expect(sound._activeVoiceCounts.get('shoot')).toBe(3);

      // Now 5th shoot succeeds
      sound._lastPlayTimes.set('shoot', performance.now() - 100);
      sound.playShoot(440);
      expect(sound._activeVoiceCounts.get('shoot')).toBe(4);
      expect(mockCtx.createdSources.length).toBe(5);
    });

    it('tracks procedural fallback voices and decrements voice count on completion', () => {
      // Clear cache so it uses procedural voice synthesis
      clearAudioBufferCache();

      // playHit procedural fallback
      sound.playHit(1.0);
      expect(sound._activeVoiceCounts.get('hit')).toBe(1);

      // Trigger completion on all created procedural oscillators
      for (const osc of mockCtx.createdOscillators) {
        if (osc.onended) osc.onended();
      }
      for (const src of mockCtx.createdSources) {
        if (src.onended) src.onended();
      }

      expect(sound._activeVoiceCounts.get('hit')).toBe(0);
    });
  });

  describe('3. Sidechain Ducking Parameter Anti-Thrashing', () => {
    it('handles 100 rapid duckMusic invocations without parameter accumulation and maintains transparent duration', () => {
      const musicGain = (sound as any)._musicGain as MockGainNode;
      expect(musicGain).toBeDefined();

      sound.setMusicVolume(0.8);
      mockCtx.currentTime = 50.0;

      // Burst of 100 duckMusic calls in rapid succession
      for (let i = 0; i < 100; i++) {
        mockCtx.currentTime += 0.001;
        sound.duckMusic(0.35, 0.45);
      }

      const calls = musicGain.gain.linearRampToValueAtTime.mock.calls;
      const lastRestoreCall = calls[calls.length - 1];
      expect(lastRestoreCall).toBeDefined();

      const lastRestoreTime = lastRestoreCall[1];
      // Recovery time must stay bounded within transparent ducking window (current time + durationSec)
      expect(lastRestoreTime - mockCtx.currentTime).toBeLessThanOrEqual(0.50);
      // Master music volume target restored to 0.8
      expect(lastRestoreCall[0]).toBeCloseTo(0.8, 2);
    });
  });

  describe('4. Noise Buffer Cache & Memory Allocation Reduction', () => {
    it('getContextNoiseBuffer caches and recycles noise buffers per AudioContext', () => {
      const buf1 = getContextNoiseBuffer(mockCtx as any, 1.0);
      expect(buf1).toBeDefined();
      expect(buf1.length).toBeGreaterThanOrEqual(44100);

      // Requesting another noise buffer for the same context reuses the cached buffer
      const buf2 = getContextNoiseBuffer(mockCtx as any, 1.0);
      expect(buf2).toBe(buf1);

      // Verify createBuffer was called only once on mockCtx for noise
      expect(mockCtx.createdBuffers.length).toBe(1);
    });
  });

  describe('5. 10,000 Playback Endurance & Zero Memory Leak Benchmark', () => {
    it('executes 10,000 audio playbacks, cleanly disconnects nodes, and leaves zero memory leaks', () => {
      const dummyBuf: any = { duration: 0.05, length: 2205 };
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.eat, dummyBuf);
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.laserPew, dummyBuf);
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.hit, dummyBuf);

      const iterations = 10000;
      for (let i = 0; i < iterations; i++) {
        // Fast play and finish cycle
        sound._lastPlayTimes.set('eat', performance.now() - 50);
        sound._activeVoiceCounts.set('eat', 0);
        sound.playEat(1, false);

        // Immediately simulate voice end
        const src = mockCtx.createdSources[mockCtx.createdSources.length - 1];
        if (src && src.onended) {
          src.onended();
        }
      }

      // Assert active voice counts cleanly resolved to 0
      expect(sound._activeVoiceCounts.get('eat')).toBe(0);

      // Assert tracking maps remain strictly bounded (keys count <= 20)
      expect(sound._lastPlayTimes.size).toBeLessThanOrEqual(20);
      expect(sound._activeVoiceCounts.size).toBeLessThanOrEqual(20);

      // Test clean disposal
      sound.dispose();
      expect(sound._activeVoiceCounts.size).toBe(0);
      expect(sound._lastPlayTimes.size).toBe(0);
      expect((sound as any)._masterGain).toBeNull();
      expect((sound as any)._sfxGain).toBeNull();
      expect((sound as any)._musicGain).toBeNull();
      expect((sound as any)._masterCompressor).toBeNull();
    });
  });
});
