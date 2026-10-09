import { describe, it, expect, vi } from 'vitest';
import {
  createEatVoices,
  createStarVoices,
  createLevelUpVoices,
  createVictoryVoices,
  createGameOverVoices,
  createShootVoices,
  createLaserFireVoices,
  createHitVoices,
  createBiteVoices,
  createExplosionVoices,
  createDashVoices,
  createShieldVoices,
  createShieldBreakVoices,
  createBossAlertVoices,
  createUiClickVoices,
  createUiHoverVoices,
  createCritVoices,
  bakeSoundToBuffer,
  VoiceSpec,
  BROADCAST_AUDIO_PATHS,
  clearAudioBufferCache,
  setCachedAudioBuffer,
} from '../audio/Synth.js';
import { SoundEngine } from '../audio/SoundEngine.js';
import { MusicPlayer, DUCK_ATTACK_SEC } from '../audio/MusicPlayer.js';

describe('Crystal-Clear Cyber-Emerald Audio Overhaul (Strict Conformance Suite)', () => {
  const getMaxDuration = (voices: VoiceSpec[]): number =>
    Math.max(...voices.map(v => (v.when ?? 0) + (v.dur ?? 0)));

  describe('1. createEatVoices(combo, isGolden)', () => {
    it('generates a unified 38ms eat chomp with rich lower tones identical across all food (not a ding)', () => {
      const vNormal = createEatVoices(1, false);
      const vCombo = createEatVoices(10, false);
      const vGolden = createEatVoices(1, true);
      const vGoldenCombo = createEatVoices(25, true);

      // Identity across all combinations
      expect(vNormal).toEqual(vCombo);
      expect(vNormal).toEqual(vGolden);
      expect(vNormal).toEqual(vGoldenCombo);

      // Max duration strictly <= 38ms
      expect(getMaxDuration(vNormal)).toBeLessThanOrEqual(0.03801);

      // Deep jaw chomp: downward chirp in lower tones (240Hz -> 110Hz) under bite pressure
      const deepJaw = vNormal.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 240) < 5);
      expect(deepJaw).toBeDefined();
      expect(deepJaw!.freqEnd).toBeCloseTo(110, 1);
      expect(deepJaw!.dur).toBeCloseTo(0.038, 3);
      expect(deepJaw!.type).toBe('triangle');
      expect(deepJaw!.filter).toBe('lowpass');
      expect(deepJaw!.cutoff).toBeLessThanOrEqual(500);

      // Low-mid mouth cavity resonance: 380Hz -> 180Hz sine wave
      const mouthRes = vNormal.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 380) < 5);
      expect(mouthRes).toBeDefined();
      expect(mouthRes!.freqEnd).toBeCloseTo(180, 1);

      // Tactile tooth bite crunch snap: filtered noise transient around 2200Hz
      const toothSnap = vNormal.find(v => v.isNoise && Math.abs((v.cutoff ?? 0) - 2200) < 400);
      expect(toothSnap).toBeDefined();
      expect(toothSnap!.dur).toBeLessThanOrEqual(0.015);
      expect(toothSnap!.filter).toBe('bandpass');

      // Verify absence of static bell chime tones (no static sine > 1000Hz)
      const bell = vNormal.find(v => !v.isNoise && v.type === 'sine' && (v.freq ?? 0) > 1000 && v.freqEnd === undefined);
      expect(bell).toBeUndefined();
    });
  });

  describe('2. createStarVoices()', () => {
    it('produces a crystalline celestial ping (1760Hz + 2637Hz, 80ms)', () => {
      const voices = createStarVoices();
      expect(getMaxDuration(voices)).toBeLessThanOrEqual(0.08001);

      const a6 = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 1760) < 5);
      const e7 = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 2637) < 5);
      expect(a6).toBeDefined();
      expect(e7).toBeDefined();
    });
  });

  describe('3. createLevelUpVoices()', () => {
    it('produces short 450ms ascending cyber ascension chime (880Hz -> 1108Hz -> 1318Hz -> 1760Hz) with 65Hz sub-bass anchor', () => {
      const voices = createLevelUpVoices();
      expect(getMaxDuration(voices)).toBeLessThanOrEqual(0.45001);

      // 65Hz sub-bass anchor
      const sub = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 65) < 3);
      expect(sub).toBeDefined();

      // Ascending notes: 880, 1108, 1318, 1760
      const n1 = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 880) < 5);
      const n2 = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 1108) < 5);
      const n3 = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 1318) < 5);
      const n4 = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 1760) < 5);

      expect(n1).toBeDefined();
      expect(n2).toBeDefined();
      expect(n3).toBeDefined();
      expect(n4).toBeDefined();

      // Monotonically ascending start times
      expect(n2!.when).toBeGreaterThan(n1!.when);
      expect(n3!.when).toBeGreaterThan(n2!.when);
      expect(n4!.when).toBeGreaterThan(n3!.when);
    });
  });

  describe('4. createVictoryVoices()', () => {
    it('produces short 650ms rising cyber-triumph cadence (E5 -> B5 -> E6 -> G#6) with 50Hz sub-bass', () => {
      const voices = createVictoryVoices();
      expect(getMaxDuration(voices)).toBeLessThanOrEqual(0.65001);

      // 50Hz sub-bass anchor
      const sub = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 50) < 3);
      expect(sub).toBeDefined();

      // Rising cadence: E5 (659Hz), B5 (988Hz), E6 (1319Hz), G#6 (1661Hz)
      const e5 = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 659.25) < 5);
      const b5 = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 987.77) < 5);
      const e6 = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 1318.51) < 5);
      const gs6 = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 1661.22) < 5);

      expect(e5).toBeDefined();
      expect(b5).toBeDefined();
      expect(e6).toBeDefined();
      expect(gs6).toBeDefined();

      expect(b5!.when).toBeGreaterThan(e5!.when);
      expect(e6!.when).toBeGreaterThan(b5!.when);
      expect(gs6!.when).toBeGreaterThan(e6!.when);
    });
  });

  describe('5. createGameOverVoices()', () => {
    it('produces short 500ms clean deactivation pulse (440Hz -> 55Hz pure sine glide)', () => {
      const voices = createGameOverVoices();
      expect(getMaxDuration(voices)).toBeLessThanOrEqual(0.50001);

      const glide = voices.find(
        v => !v.isNoise && v.type === 'sine' && Math.abs((v.freq ?? 0) - 440) < 10 && Math.abs((v.freqEnd ?? 0) - 55) < 5
      );
      expect(glide).toBeDefined();
    });
  });

  describe('6. createShootVoices(freq)', () => {
    it('produces tight 60ms FM laser chirp (1400Hz -> 350Hz) with 4.5kHz transient and zero white noise', () => {
      const voices = createShootVoices();
      expect(getMaxDuration(voices)).toBeLessThanOrEqual(0.06001);

      // ZERO WHITE NOISE MANDATE
      expect(voices.every(v => !v.isNoise)).toBe(true);

      const chirp = voices.find(v => Math.abs((v.freq ?? 0) - 1400) < 10 && Math.abs((v.freqEnd ?? 0) - 350) < 10);
      expect(chirp).toBeDefined();

      const transient = voices.find(v => (v.freq ?? 0) >= 4000);
      expect(transient).toBeDefined();
    });
  });

  describe('7. createLaserFireVoices(freq)', () => {
    it('produces crisp 95ms heavy blaster chirp (650Hz -> 180Hz) with 60Hz punch', () => {
      const voices = createLaserFireVoices();
      expect(getMaxDuration(voices)).toBeLessThanOrEqual(0.09501);

      const chirp = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 650) < 10 && Math.abs((v.freqEnd ?? 0) - 180) < 10);
      expect(chirp).toBeDefined();

      const punch = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 60) < 5);
      expect(punch).toBeDefined();
    });
  });

  describe('8. createHitVoices(intensity)', () => {
    it('produces punchy 30ms tactile cyber-impact (3.2kHz transient snap + 110Hz sub kick)', () => {
      const voices = createHitVoices(1.0);
      expect(getMaxDuration(voices)).toBeLessThanOrEqual(0.03001);

      const snap = voices.find(v => (v.freq ?? 0) >= 3000 || (v.cutoff ?? 0) >= 3000);
      expect(snap).toBeDefined();

      const kick = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 110) < 10);
      expect(kick).toBeDefined();
    });
  });

  describe('9. createBiteVoices(damage, isCrit)', () => {
    it('produces quick 32ms chitin snap + 120Hz thud without distortion', () => {
      const voices = createBiteVoices(10, false);
      expect(getMaxDuration(voices)).toBeLessThanOrEqual(0.03201);

      // Clean: no waveshaper distortion
      voices.forEach(v => expect(v.distortion ?? 0).toBe(0));

      const thud = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 120) < 10);
      expect(thud).toBeDefined();
    });
  });

  describe('10. createExplosionVoices(intensity)', () => {
    it('produces clean 250ms cyber-plasma detonation (bright 2.6kHz transient flash + deep 55Hz sub-bass boom)', () => {
      const voices = createExplosionVoices(1.0);
      expect(getMaxDuration(voices)).toBeLessThanOrEqual(0.25001);

      const flash = voices.find(v => (v.freq ?? 0) >= 2400 || (v.cutoff ?? 0) >= 2400);
      expect(flash).toBeDefined();

      const boom = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 55) < 5);
      expect(boom).toBeDefined();
    });
  });

  describe('11. createDashVoices()', () => {
    it('produces smooth 140ms aerodynamic slipstream whoosh with 60Hz sub-bass displacement', () => {
      const voices = createDashVoices();
      expect(getMaxDuration(voices)).toBeLessThanOrEqual(0.14001);

      const sub = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 60) < 5);
      expect(sub).toBeDefined();
    });
  });

  describe('12. createShieldVoices()', () => {
    it('produces 130ms dual harmonic swell (659Hz + 987Hz)', () => {
      const voices = createShieldVoices();
      expect(getMaxDuration(voices)).toBeLessThanOrEqual(0.13001);

      const e5 = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 659.25) < 5);
      const b5 = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 987.77) < 5);
      expect(e5).toBeDefined();
      expect(b5).toBeDefined();
    });
  });

  describe('13. createShieldBreakVoices()', () => {
    it('produces 140ms crystalline shatter (2800Hz -> 1200Hz)', () => {
      const voices = createShieldBreakVoices();
      expect(getMaxDuration(voices)).toBeLessThanOrEqual(0.14001);

      const shatter = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 2800) < 50 && Math.abs((v.freqEnd ?? 0) - 1200) < 50);
      expect(shatter).toBeDefined();
    });
  });

  describe('14. createBossAlertVoices(tier)', () => {
    it('produces 580ms ominous sub-bass pulse (45Hz + 880Hz harmonic)', () => {
      const voices = createBossAlertVoices(1);
      expect(getMaxDuration(voices)).toBeLessThanOrEqual(0.58001);

      const sub = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 45) < 5);
      expect(sub).toBeDefined();

      const harmonic = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 880) < 50);
      expect(harmonic).toBeDefined();
    });
  });

  describe('15. createUiClickVoices() & createUiHoverVoices()', () => {
    it('produces 10ms pure tactile glass clicks (3200Hz / 4000Hz)', () => {
      const click = createUiClickVoices();
      const hover = createUiHoverVoices();

      expect(getMaxDuration(click)).toBeLessThanOrEqual(0.01001);
      expect(getMaxDuration(hover)).toBeLessThanOrEqual(0.01001);

      const clickTone = click.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 3200) < 50);
      expect(clickTone).toBeDefined();

      const hoverTone = hover.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 4000) < 50);
      expect(hoverTone).toBeDefined();
    });
  });

  describe('16. createCritVoices()', () => {
    it('produces clean 90ms cyber-snap (2400Hz + 120Hz sub)', () => {
      const voices = createCritVoices();
      expect(getMaxDuration(voices)).toBeLessThanOrEqual(0.09001);

      const snap = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 2400) < 50);
      expect(snap).toBeDefined();

      const sub = voices.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 120) < 10);
      expect(sub).toBeDefined();
    });
  });

  describe('17. Headless Offline DSP Rendering', () => {
    it('renders non-empty finite PCM buffers for all overhauled sound recipes', () => {
      const recipes = [
        createEatVoices(),
        createStarVoices(),
        createLevelUpVoices(),
        createVictoryVoices(),
        createGameOverVoices(),
        createShootVoices(),
        createLaserFireVoices(),
        createHitVoices(),
        createBiteVoices(),
        createExplosionVoices(),
        createDashVoices(),
        createShieldVoices(),
        createShieldBreakVoices(),
        createBossAlertVoices(),
        createUiClickVoices(),
        createUiHoverVoices(),
        createCritVoices(),
      ];

      for (const recipe of recipes) {
        const pcm = bakeSoundToBuffer(recipe, 22050);
        expect(pcm.length).toBeGreaterThan(0);
        let energy = 0;
        for (let i = 0; i < pcm.length; i++) {
          const sample = pcm[i]!;
          expect(Number.isFinite(sample)).toBe(true);
          energy += Math.abs(sample);
        }
        expect(energy).toBeGreaterThan(0.0001);
      }
    });
  });

  describe('Master Audio Signal Chain & Mastering (Sections 18-22)', () => {
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

    describe('18. Master Dynamics Compressor Settings', () => {
      it('initializes compressor with studio mastering values (-10dB, 12dB knee, 6:1 ratio, 2ms attack, 120ms release)', () => {
        const sound = new SoundEngine();
        const mockCtx = new MockAudioContext();
        (sound as any)._ctx = mockCtx;
        (sound as any).initCtx();

        expect(mockCtx.createdCompressors.length).toBe(1);
        const comp = mockCtx.createdCompressors[0]!;
        expect(comp.threshold.value).toBe(-10);
        expect(comp.knee.value).toBe(12);
        expect(comp.ratio.value).toBe(6);
        expect(comp.attack.value).toBeCloseTo(0.002, 4);
        expect(comp.release.value).toBeCloseTo(0.12, 4);
      });
    });

    describe('19. Bus Volume Balancing Defaults', () => {
      it('sets SFX default volume to 0.75 and Music default volume to 0.38 for clean acoustic headroom', () => {
        const sound = new SoundEngine();
        expect(sound.sfxVolume).toBe(0.75);
        expect(sound.musicVolume).toBe(0.38);
      });
    });

    describe('20. Sidechain Ducking System', () => {
      it('uses 0.03s attack ramp and default 0.50s recovery to 40% volume', () => {
        const sound = new SoundEngine();
        const mockCtx = new MockAudioContext();
        (sound as any)._ctx = mockCtx;
        (sound as any).initCtx();
        mockCtx.currentTime = 10.0;

        sound.duckMusic(); // defaults: duckGain = 0.4, durationSec = 0.50

        const musicGain = (sound as any)._musicGain as MockGainNode;
        expect(musicGain.gain.cancelScheduledValues).toHaveBeenCalledWith(10.0);
        expect(musicGain.gain.setValueAtTime).toHaveBeenCalledWith(0.38, 10.0);
        // 0.38 * 0.4 = 0.152 ducked level, ramped over 0.03s
        expect(musicGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
          expect.closeTo(0.38 * 0.4, 4),
          expect.closeTo(10.03, 3)
        );
        // Recovery restored to 0.38 at 10.0 + 0.50 = 10.50
        expect(musicGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
          expect.closeTo(0.38, 4),
          expect.closeTo(10.50, 3)
        );
      });
    });

    describe('21. Standardized 18-Dispatcher Audio Routing', () => {
      it('routes all 18 dispatchers through playBroadcastOrFallback with matching BROADCAST_AUDIO_PATHS', () => {
        const sound = new SoundEngine();
        const mockCtx = new MockAudioContext();
        (sound as any)._ctx = mockCtx;
        (sound as any).initCtx();

        const broadcastSpy = vi.spyOn(sound, 'playBroadcastOrFallback');

        const dispatchers: { name: string; call: () => void; expectedPath: string }[] = [
          { name: 'playEat', call: () => sound.playEat(), expectedPath: BROADCAST_AUDIO_PATHS.eat },
          { name: 'playStar', call: () => sound.playStar(), expectedPath: BROADCAST_AUDIO_PATHS.gemChime },
          { name: 'playShard', call: () => sound.playShard(), expectedPath: BROADCAST_AUDIO_PATHS.starDing },
          { name: 'playShoot', call: () => sound.playShoot(), expectedPath: BROADCAST_AUDIO_PATHS.laserPew },
          { name: 'playLaserFire', call: () => sound.playLaserFire(), expectedPath: BROADCAST_AUDIO_PATHS.laserHeavy },
          { name: 'playHit', call: () => sound.playHit(), expectedPath: BROADCAST_AUDIO_PATHS.hit },
          { name: 'playBite', call: () => sound.playBite(), expectedPath: (BROADCAST_AUDIO_PATHS as any).bite },
          { name: 'playCrit', call: () => sound.playCrit(), expectedPath: (BROADCAST_AUDIO_PATHS as any).crit },
          { name: 'playExplosion', call: () => sound.playExplosion(), expectedPath: (BROADCAST_AUDIO_PATHS as any).explosion },
          { name: 'playDash', call: () => sound.playDash(), expectedPath: BROADCAST_AUDIO_PATHS.dash },
          { name: 'playShield', call: () => sound.playShield(), expectedPath: BROADCAST_AUDIO_PATHS.shieldOn },
          { name: 'playShieldBreak', call: () => sound.playShieldBreak(), expectedPath: BROADCAST_AUDIO_PATHS.shieldBreak },
          { name: 'playLevelUp', call: () => sound.playLevelUp(), expectedPath: BROADCAST_AUDIO_PATHS.levelUp },
          { name: 'playVictory', call: () => sound.playVictory(), expectedPath: BROADCAST_AUDIO_PATHS.victory },
          { name: 'playGameOver', call: () => sound.playGameOver(), expectedPath: BROADCAST_AUDIO_PATHS.gameOver },
          { name: 'playBossAlert', call: () => sound.playBossAlert(), expectedPath: BROADCAST_AUDIO_PATHS.bossRoar },
          { name: 'playUiClick', call: () => sound.playUiClick(), expectedPath: BROADCAST_AUDIO_PATHS.uiClick },
          { name: 'playUiHover', call: () => sound.playUiHover(), expectedPath: BROADCAST_AUDIO_PATHS.uiTab },
        ];

        expect(dispatchers.length).toBe(18);

        for (const d of dispatchers) {
          broadcastSpy.mockClear();
          d.call();
          expect(broadcastSpy).toHaveBeenCalled();
          expect(broadcastSpy.mock.calls[0]![0]).toBe(d.expectedPath);
        }
      });

      it('enforces concurrency limiter on playCrit and playBite', () => {
        const sound = new SoundEngine();
        const mockCtx = new MockAudioContext();
        (sound as any)._ctx = mockCtx;
        (sound as any).initCtx();

        const canPlaySpy = vi.spyOn(sound, 'canPlay');

        sound.playBite();
        expect(canPlaySpy).toHaveBeenCalledWith('bite', 40, 2);

        sound.playCrit();
        expect(canPlaySpy).toHaveBeenCalledWith('crit', 40, 2);
      });

      it('enforces single unified eating sound BROADCAST_AUDIO_PATHS.eat regardless of combo or golden food', () => {
        const sound = new SoundEngine();
        const mockCtx = new MockAudioContext();
        (sound as any)._ctx = mockCtx;
        (sound as any).initCtx();

        const broadcastSpy = vi.spyOn(sound, 'playBroadcastOrFallback');

        sound.playEat(1, false);
        expect(broadcastSpy).toHaveBeenLastCalledWith(
          BROADCAST_AUDIO_PATHS.eat,
          expect.any(Function),
          1.0,
          expect.any(Function)
        );

        sound.playEat(10, true);
        expect(broadcastSpy).toHaveBeenLastCalledWith(
          BROADCAST_AUDIO_PATHS.eat,
          expect.any(Function),
          1.0,
          expect.any(Function)
        );
      });
    });

    describe('22. MusicPlayer Master Mood Lowpass Filter & Anti-Thump Ducking', () => {
      it('sets exploration cutoff to 18,000 Hz, combat/boss to 20,000 Hz, and pause to 400 Hz', () => {
        const sound = new SoundEngine();
        const music = new MusicPlayer(sound);
        const mockCtx = new MockAudioContext();
        (music as any).ctx = mockCtx;
        (music as any).initGraph();

        const filter = (music as any).moodFilter as MockBiquadFilterNode;
        expect(filter).toBeDefined();

        // Exploration:
        music.isBossMode = false;
        music.isFrenzy = false;
        music.intensity = 0.2;
        music.applyMusicFilter();
        expect(filter.frequency.setTargetAtTime).toHaveBeenLastCalledWith(18000, expect.any(Number), expect.any(Number));

        // Combat / high intensity:
        music.intensity = 0.8;
        music.applyMusicFilter();
        expect(filter.frequency.setTargetAtTime).toHaveBeenLastCalledWith(20000, expect.any(Number), expect.any(Number));

        // Boss mode:
        music.intensity = 0.0;
        music.isBossMode = true;
        music.applyMusicFilter();
        expect(filter.frequency.setTargetAtTime).toHaveBeenLastCalledWith(20000, expect.any(Number), expect.any(Number));

        // Frenzy mode:
        music.isBossMode = false;
        music.isFrenzy = true;
        music.applyMusicFilter();
        expect(filter.frequency.setTargetAtTime).toHaveBeenLastCalledWith(20000, expect.any(Number), expect.any(Number));

        // Paused mode:
        music.isFrenzy = false;
        music.pauseMusic();
        expect(filter.frequency.setTargetAtTime).toHaveBeenLastCalledWith(400, expect.any(Number), expect.any(Number));
      });

      it('uses 0.03s attack ramp for sidechain ducking in MusicPlayer', () => {
        expect(DUCK_ATTACK_SEC).toBe(0.03);

        const sound = new SoundEngine();
        const music = new MusicPlayer(sound);
        const mockCtx = new MockAudioContext();
        (music as any).ctx = mockCtx;
        (music as any).initGraph();
        mockCtx.currentTime = 50.0;

        const duckGain = (music as any).duckGain as MockGainNode;
        music.duck(0.4, 0.50);

        expect(duckGain.gain.cancelScheduledValues).toHaveBeenCalledWith(50.0);
        expect(duckGain.gain.setValueAtTime).toHaveBeenCalledWith(duckGain.gain.value, 50.0);
        expect(duckGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.4, 50.03);
        expect(duckGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1.0, 50.53);
      });
    });
  });
});
