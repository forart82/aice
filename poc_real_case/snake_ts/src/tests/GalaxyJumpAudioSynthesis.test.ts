import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Services, MockSound } from '../core/Services.js';
import { NullSound, ISound } from '../core/Contracts.js';
import {
  playWarpJump,
  playUniqueHelmetReveal,
  createWarpJumpVoices,
  createUniqueHelmetRevealVoices,
  bakeSoundToBuffer,
  DEFAULT_SAMPLE_RATE,
  setCachedAudioBuffer,
  clearAudioBufferCache,
  BROADCAST_AUDIO_PATHS,
} from '../audio/Synth.js';
import { SoundEngine } from '../audio/SoundEngine.js';

describe('Galaxy Jump Procedural Audio Synthesis (TDD Red/Green Suite)', () => {
  beforeEach(() => {
    Services.resetToNull();
  });

  describe('Contract & Mock Implementations', () => {
    it('NullSound implements playWarpJump and playUniqueHelmetReveal without throwing', () => {
      const nullSound: ISound = new NullSound();
      expect(typeof nullSound.playWarpJump).toBe('function');
      expect(typeof nullSound.playUniqueHelmetReveal).toBe('function');
      expect(() => {
        nullSound.playWarpJump();
        nullSound.playUniqueHelmetReveal();
      }).not.toThrow();
    });

    it('MockSound implements playWarpJump and playUniqueHelmetReveal with invocation tracking', () => {
      const mock = new MockSound();
      expect(typeof mock.playWarpJump).toBe('function');
      expect(typeof mock.playUniqueHelmetReveal).toBe('function');
      expect(mock.warpJumpCalls).toBe(0);
      expect(mock.uniqueHelmetRevealCalls).toBe(0);

      mock.playWarpJump();
      expect(mock.warpJumpCalls).toBe(1);

      mock.playUniqueHelmetReveal();
      expect(mock.uniqueHelmetRevealCalls).toBe(1);
    });

    it('Services.Sound dispatches playWarpJump and playUniqueHelmetReveal headlessly', () => {
      expect(() => {
        Services.Sound.playWarpJump();
        Services.Sound.playUniqueHelmetReveal();
      }).not.toThrow();

      const mock = new MockSound();
      Services.Sound = mock;
      Services.Sound.playWarpJump();
      Services.Sound.playUniqueHelmetReveal();
      expect(mock.warpJumpCalls).toBe(1);
      expect(mock.uniqueHelmetRevealCalls).toBe(1);
    });

    it('SoundEngine implements playWarpJump and playUniqueHelmetReveal without errors', () => {
      const engine = new SoundEngine();
      expect(typeof engine.playWarpJump).toBe('function');
      expect(typeof engine.playUniqueHelmetReveal).toBe('function');
      expect(() => {
        engine.playWarpJump();
        engine.playUniqueHelmetReveal();
      }).not.toThrow();
    });

    it('SoundEngine.playWarpJump plays broadcast buffer if cached, or procedural warp voices when uncached', () => {
      const engine = new SoundEngine();
      clearAudioBufferCache();

      // Uncached: should dispatch cleanly to procedural
      expect(() => engine.playWarpJump()).not.toThrow();

      // Cached: should play from broadcast buffer
      const dummyBuf: any = { duration: 2.4, length: 105840 };
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.warpJump, dummyBuf);
      expect(() => engine.playWarpJump()).not.toThrow();
    });
  });

  describe('Procedural Voice Specifications & DSP Architecture', () => {
    it('createWarpJumpVoices defines sweeping oscillator, bandpass noise rush, and 40Hz sub-bass boom', () => {
      const voices = createWarpJumpVoices();
      expect(voices.length).toBeGreaterThanOrEqual(3);

      // 1. Sweeping pitch-up oscillator (sawtooth/triangle 80Hz -> 880Hz over 2.2s)
      const pitchSweep = voices.find(
        v => !v.isNoise && (v.type === 'sawtooth' || v.type === 'triangle') && v.freq === 80 && v.freqEnd === 880
      );
      expect(pitchSweep).toBeDefined();
      expect(pitchSweep!.dur).toBeGreaterThanOrEqual(2.0);
      expect(pitchSweep!.dur).toBeLessThanOrEqual(2.5);

      // 2. White/pink noise bandpass filter sweep (cosmic rush)
      const noiseRush = voices.find(v => v.isNoise && v.filter === 'bandpass');
      expect(noiseRush).toBeDefined();
      expect(noiseRush!.dur).toBeGreaterThanOrEqual(2.0);
      expect(noiseRush!.cutoffEnd).toBeGreaterThan(noiseRush!.cutoff ?? 0);

      // 3. Resonant sub-bass boom (40Hz rift transition)
      const subBoom = voices.find(v => !v.isNoise && (v.freq === 40 || v.freqEnd === 40));
      expect(subBoom).toBeDefined();
      expect(subBoom!.when).toBeGreaterThanOrEqual(2.0); // Fires near or at rift transition
    });

    it('createUniqueHelmetRevealVoices defines 5-note Cmaj9 arpeggio (C4, E4, G4, B4, D5) with rich decay', () => {
      const voices = createUniqueHelmetRevealVoices();
      expect(voices.length).toBeGreaterThanOrEqual(5);

      // Notes in Cmaj9 fanfare: C4 (~261.6), E4 (~329.6), G4 (~392.0), B4 (~493.9), D5 (~587.3)
      const expectedPitches = [261.63, 329.63, 392.0, 493.88, 587.33];
      const toneVoices = voices.filter(v => !v.isNoise && v.freq !== undefined);

      expect(toneVoices.length).toBeGreaterThanOrEqual(5);

      expectedPitches.forEach(pitch => {
        const match = toneVoices.some(v => Math.abs(v.freq! - pitch) < 1.0);
        expect(match).toBe(true);
      });

      // Verify arpeggiated stagger: ascending start times
      for (let i = 0; i < expectedPitches.length - 1; i++) {
        const vA = toneVoices.find(v => Math.abs(v.freq! - expectedPitches[i]!) < 1.0)!;
        const vB = toneVoices.find(v => Math.abs(v.freq! - expectedPitches[i + 1]!) < 1.0)!;
        expect(vB.when).toBeGreaterThan(vA.when);
      }

      // Verify concise decay for cyber celestial aura
      toneVoices.forEach(v => {
        expect(v.dur).toBeGreaterThanOrEqual(0.45);
      });
    });

    it('offline DSP rendering bakes valid non-empty PCM buffers for hyperspace warp and unique reveal', () => {
      const warpVoices = createWarpJumpVoices();
      const revealVoices = createUniqueHelmetRevealVoices();

      const warpBuffer = bakeSoundToBuffer(warpVoices, DEFAULT_SAMPLE_RATE);
      expect(warpBuffer.length).toBeGreaterThan(DEFAULT_SAMPLE_RATE * 2); // > 2s of audio
      let warpEnergy = 0;
      for (let i = 0; i < warpBuffer.length; i++) {
        expect(Number.isFinite(warpBuffer[i])).toBe(true);
        warpEnergy += Math.abs(warpBuffer[i]!);
      }
      expect(warpEnergy).toBeGreaterThan(10);

      const revealBuffer = bakeSoundToBuffer(revealVoices, DEFAULT_SAMPLE_RATE);
      expect(revealBuffer.length).toBeGreaterThan(DEFAULT_SAMPLE_RATE * 0.6);
      let revealEnergy = 0;
      for (let i = 0; i < revealBuffer.length; i++) {
        expect(Number.isFinite(revealBuffer[i])).toBe(true);
        revealEnergy += Math.abs(revealBuffer[i]!);
      }
      expect(revealEnergy).toBeGreaterThan(10);
    });
  });

  describe('Web Audio Graph Lifecycle & Leak Prevention', () => {
    class MockAudioParam {
      public value = 0;
      public setValueAtTime = vi.fn().mockReturnThis();
      public linearRampToValueAtTime = vi.fn().mockReturnThis();
      public exponentialRampToValueAtTime = vi.fn().mockReturnThis();
    }

    class MockAudioNode {
      public connectedTargets: any[] = [];
      public disconnected = false;

      public connect(target: any): any {
        this.connectedTargets.push(target);
        return target;
      }

      public disconnect(): void {
        this.disconnected = true;
        this.connectedTargets = [];
      }
    }

    class MockOscillatorNode extends MockAudioNode {
      public type = 'sine';
      public frequency = new MockAudioParam();
      public detune = new MockAudioParam();
      public onended: (() => void) | null = null;
      public started = false;
      public stopped = false;
      public stopTime = 0;

      public start(): void {
        this.started = true;
      }

      public stop(time?: number): void {
        this.stopped = true;
        this.stopTime = time ?? 0;
      }
    }

    class MockGainNode extends MockAudioNode {
      public gain = new MockAudioParam();
    }

    class MockBiquadFilterNode extends MockAudioNode {
      public type = 'lowpass';
      public frequency = new MockAudioParam();
      public Q = new MockAudioParam();
    }

    class MockBufferSourceNode extends MockAudioNode {
      public buffer: any = null;
      public onended: (() => void) | null = null;
      public started = false;
      public stopped = false;

      public start(): void {
        this.started = true;
      }

      public stop(): void {
        this.stopped = true;
      }
    }

    class MockAudioContext {
      public currentTime = 10.0;
      public sampleRate = 48000;
      public state = 'running';
      public destination = new MockAudioNode();

      public createdOscillators: MockOscillatorNode[] = [];
      public createdGains: MockGainNode[] = [];
      public createdFilters: MockBiquadFilterNode[] = [];
      public createdSources: MockBufferSourceNode[] = [];

      public createOscillator(): any {
        const osc = new MockOscillatorNode();
        this.createdOscillators.push(osc);
        return osc;
      }

      public createGain(): any {
        const gain = new MockGainNode();
        this.createdGains.push(gain);
        return gain;
      }

      public createBiquadFilter(): any {
        const filter = new MockBiquadFilterNode();
        this.createdFilters.push(filter);
        return filter;
      }

      public createBuffer(channels: number, length: number, sampleRate: number): any {
        return {
          numberOfChannels: channels,
          length,
          sampleRate,
          getChannelData: () => new Float32Array(length),
        };
      }

      public createBufferSource(): any {
        const src = new MockBufferSourceNode();
        this.createdSources.push(src);
        return src;
      }
    }

    it('playWarpJump builds audio graph and cleans up all audio nodes on completion', () => {
      const mockCtx = new MockAudioContext();
      const dest = new MockAudioNode();

      const handle = playWarpJump(mockCtx as any, dest as any);
      expect(handle).toBeDefined();

      // Ensure oscillators and noise buffer source were created
      expect(mockCtx.createdOscillators.length).toBeGreaterThanOrEqual(2); // sweep + sub boom
      expect(mockCtx.createdFilters.length).toBeGreaterThanOrEqual(1); // bandpass filter
      expect(mockCtx.createdSources.length).toBeGreaterThanOrEqual(1); // noise source
      expect(mockCtx.createdGains.length).toBeGreaterThanOrEqual(2);

      // Verify pitch sweep setup: 80Hz -> 880Hz
      const sweepOsc = mockCtx.createdOscillators.find(
        o => o.type === 'sawtooth' || o.type === 'triangle'
      );
      expect(sweepOsc).toBeDefined();
      expect(sweepOsc!.frequency.setValueAtTime).toHaveBeenCalledWith(80, 10.0);
      expect(sweepOsc!.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
        880,
        expect.closeTo(10.0 + 2.2, 0.05)
      );

      // Verify sub-bass boom (40Hz)
      const subOsc = mockCtx.createdOscillators.find(o => o !== sweepOsc);
      expect(subOsc).toBeDefined();

      // Trigger all onended callbacks to simulate sound completion
      mockCtx.createdOscillators.forEach(o => {
        if (o.onended) o.onended();
      });
      mockCtx.createdSources.forEach(s => {
        if (s.onended) s.onended();
      });

      // Verify ZERO LEAKS: All created nodes must have had disconnect() called
      expect(mockCtx.createdOscillators.every(o => o.disconnected)).toBe(true);
      expect(mockCtx.createdSources.every(s => s.disconnected)).toBe(true);
      expect(mockCtx.createdGains.every(g => g.disconnected)).toBe(true);
      expect(mockCtx.createdFilters.every(f => f.disconnected)).toBe(true);
    });

    it('playUniqueHelmetReveal builds arpeggio graph and cleans up nodes upon decay end', () => {
      const mockCtx = new MockAudioContext();
      const dest = new MockAudioNode();

      const handle = playUniqueHelmetReveal(mockCtx as any, dest as any);
      expect(handle).toBeDefined();

      // 5 chord tones arpeggiated
      expect(mockCtx.createdOscillators.length).toBeGreaterThanOrEqual(5);
      expect(mockCtx.createdGains.length).toBeGreaterThanOrEqual(5);

      // Trigger all onended callbacks
      mockCtx.createdOscillators.forEach(o => {
        if (o.onended) o.onended();
      });

      // Zero node leaks
      expect(mockCtx.createdOscillators.every(o => o.disconnected)).toBe(true);
      expect(mockCtx.createdGains.every(g => g.disconnected)).toBe(true);
    });

    it('playWarpJump and playUniqueHelmetReveal execute safely when audio context is null', () => {
      expect(() => {
        playWarpJump(null, null);
        playUniqueHelmetReveal(null, null);
      }).not.toThrow();
    });
  });
});
