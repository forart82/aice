import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  VoiceSpec,
  DEFAULT_SAMPLE_RATE,
  bakeSoundToBuffer,
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
  setCachedAudioBuffer,
  clearAudioBufferCache,
  BROADCAST_AUDIO_PATHS,
  BROADCAST_MUSIC_PATHS,
} from '../audio/Synth.js';
import { SoundEngine } from '../audio/SoundEngine.js';
import { MusicPlayer } from '../audio/MusicPlayer.js';

describe('Professional Procedural Audio Redesign (TDD Suite)', () => {
  describe('1. Eating & Food Pickup Voice Specifications', () => {
    it('createEatVoices generates organic crunch/pop with noise click and frequency drop', () => {
      const voices = createEatVoices(1, false);
      expect(voices.length).toBeGreaterThanOrEqual(2);

      // Layer 1: Transient click (filtered noise burst, <= 25ms)
      const noiseClick = voices.find(v => v.isNoise && v.dur <= 0.035);
      expect(noiseClick).toBeDefined();
      expect(noiseClick!.filter).toBeDefined();

      // Layer 2: Pitch envelope with lower tones mouth chomp
      const pitchPop = voices.find(v => !v.isNoise && v.freq !== undefined);
      expect(pitchPop).toBeDefined();
      expect(pitchPop!.freq).toBeGreaterThan(100);
    });

    it('createEatVoices produces crisp cyber-bite crunch (<50ms body thud) for standard apples', () => {
      const voices = createEatVoices(1, false);
      const pitchPop = voices.find(v => !v.isNoise && v.freq !== undefined);
      expect(pitchPop).toBeDefined();
      expect(pitchPop!.dur).toBeLessThanOrEqual(0.05);
    });

    it('createEatVoices generates identical duration (<= 45ms) and frequency profile regardless of combo multiplier or isGolden flag', () => {
      const vCombo1 = createEatVoices(1, false);
      const vCombo10 = createEatVoices(10, false);
      const vGolden = createEatVoices(1, true);
      const vGoldenCombo = createEatVoices(10, true);

      // Duration must be snappy and <= 45ms across all voice components
      for (const list of [vCombo1, vCombo10, vGolden, vGoldenCombo]) {
        for (const v of list) {
          expect((v.when ?? 0) + (v.dur ?? 0)).toBeLessThanOrEqual(0.045);
        }
      }

      // Assert identical frequency profile and voice structure regardless of combo or isGolden
      expect(vCombo1).toEqual(vCombo10);
      expect(vCombo1).toEqual(vGolden);
      expect(vCombo1).toEqual(vGoldenCombo);
    });

    it('createStarVoices produces celestial star chime with soft sparkle', () => {
      const starVoices = createStarVoices();
      expect(starVoices.length).toBeGreaterThanOrEqual(2);

      const highTone = starVoices.find(v => !v.isNoise && (v.freq ?? 0) >= 1700);
      expect(highTone).toBeDefined();
    });
  });

  describe('2. Combat & Attack Voice Specifications', () => {
    it('createBiteVoices produces quick 32ms chitin snap + 120Hz thud (clean, no distortion)', () => {
      const bite = createBiteVoices(10, false);
      expect(bite.length).toBeGreaterThanOrEqual(2);

      const maxDur = Math.max(...bite.map(v => (v.when ?? 0) + (v.dur ?? 0)));
      expect(maxDur).toBeLessThanOrEqual(0.03201);

      const snap = bite.find(v => (v.freq ?? 0) >= 2000 || v.isNoise);
      expect(snap).toBeDefined();

      const bodyThud = bite.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 120) < 10);
      expect(bodyThud).toBeDefined();
      // Zero distortion
      bite.forEach(v => expect(v.distortion ?? 0).toBe(0));

      const biteCrit = createBiteVoices(25, true);
      const critThud = biteCrit.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 120) < 10);
      expect(critThud!.peak).toBeGreaterThan(bodyThud!.peak);
    });

    it('createShootVoices produces tight 60ms FM laser chirp (1400Hz -> 350Hz) with 4.5kHz transient and zero white noise', () => {
      const shoot = createShootVoices();
      expect(shoot.length).toBeGreaterThanOrEqual(2);

      const maxDur = Math.max(...shoot.map(v => (v.when ?? 0) + (v.dur ?? 0)));
      expect(maxDur).toBeLessThanOrEqual(0.06001);

      // MANDATE: Zero white noise
      expect(shoot.every(v => !v.isNoise)).toBe(true);

      const chirp = shoot.find(v => Math.abs((v.freq ?? 0) - 1400) < 10 && Math.abs((v.freqEnd ?? 0) - 350) < 10);
      expect(chirp).toBeDefined();

      const transient = shoot.find(v => (v.freq ?? 0) >= 4000);
      expect(transient).toBeDefined();
    });

    it('createLaserFireVoices produces crisp 95ms heavy blaster chirp (650Hz -> 180Hz) with 60Hz punch', () => {
      const laser = createLaserFireVoices();
      expect(laser.length).toBeGreaterThanOrEqual(2);

      const maxDur = Math.max(...laser.map(v => (v.when ?? 0) + (v.dur ?? 0)));
      expect(maxDur).toBeLessThanOrEqual(0.09501);

      const chirp = laser.find(v => Math.abs((v.freq ?? 0) - 650) < 10 && Math.abs((v.freqEnd ?? 0) - 180) < 10);
      expect(chirp).toBeDefined();

      const punch = laser.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 60) < 5);
      expect(punch).toBeDefined();
    });

    it('createHitVoices produces punchy 30ms tactile cyber-impact (3.2kHz transient snap + 110Hz sub kick)', () => {
      const hit = createHitVoices(1.0);
      expect(hit.length).toBeGreaterThanOrEqual(2);

      const maxDur = Math.max(...hit.map(v => (v.when ?? 0) + (v.dur ?? 0)));
      expect(maxDur).toBeLessThanOrEqual(0.03001);

      const snap = hit.find(v => (v.freq ?? 0) >= 3000 || (v.cutoff ?? 0) >= 3000);
      expect(snap).toBeDefined();

      const body = hit.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 110) < 10);
      expect(body).toBeDefined();
    });

    it('createCritVoices produces clean 90ms cyber-snap (2400Hz + 120Hz sub)', () => {
      const crit = createCritVoices();
      expect(crit.length).toBeGreaterThanOrEqual(2);

      const maxDur = Math.max(...crit.map(v => (v.when ?? 0) + (v.dur ?? 0)));
      expect(maxDur).toBeLessThanOrEqual(0.09001);

      const snap = crit.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 2400) < 50);
      expect(snap).toBeDefined();

      const sub = crit.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 120) < 10);
      expect(sub).toBeDefined();
    });

    it('createExplosionVoices produces clean 250ms cyber-plasma detonation (bright 2.6kHz transient flash + deep 55Hz sub-bass boom)', () => {
      const explosion = createExplosionVoices(1.0);
      expect(explosion.length).toBeGreaterThanOrEqual(2);

      const maxDur = Math.max(...explosion.map(v => (v.when ?? 0) + (v.dur ?? 0)));
      expect(maxDur).toBeLessThanOrEqual(0.25001);

      const flash = explosion.find(v => (v.freq ?? 0) >= 2400 || (v.cutoff ?? 0) >= 2400);
      expect(flash).toBeDefined();

      const boom = explosion.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 55) < 5);
      expect(boom).toBeDefined();
    });

    it('createThunderVoices produces 3 micro-bursts in 40ms + rolling low-frequency tail', () => {
      const thunder = createThunderVoices(1.0);
      expect(thunder.length).toBeGreaterThanOrEqual(4);

      const bursts = thunder.filter(v => v.isNoise && v.when <= 0.045 && v.dur <= 0.03);
      expect(bursts.length).toBeGreaterThanOrEqual(3);

      const tail = thunder.find(v => v.dur >= 0.35);
      expect(tail).toBeDefined();
    });

    it('createFlameVoices produces warm filtered pink noise with dynamic breath envelope', () => {
      const flame = createFlameVoices();
      expect(flame.length).toBeGreaterThanOrEqual(1);

      const noiseWhoosh = flame.find(v => v.isNoise && (v.cutoff ?? 0) >= 200 && (v.cutoff ?? 0) <= 1500);
      expect(noiseWhoosh).toBeDefined();
      expect(noiseWhoosh!.attack).toBeGreaterThan(0.01);
    });
  });

  describe('3. Serpent Kinematics & Ability Voice Specifications', () => {
    it('createDashVoices produces smooth 140ms aerodynamic slipstream whoosh with 60Hz sub-bass displacement', () => {
      const dash = createDashVoices();
      expect(dash.length).toBeGreaterThanOrEqual(2);

      const maxDur = Math.max(...dash.map(v => (v.when ?? 0) + (v.dur ?? 0)));
      expect(maxDur).toBeLessThanOrEqual(0.14001);

      const subAir = dash.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 60) < 5);
      expect(subAir).toBeDefined();

      const slipstream = dash.find(v => v.isNoise);
      expect(slipstream).toBeDefined();
    });

    it('createSkillVoices produces bio-energy surge with sweeping bandpass (300Hz->2400Hz) and detuned saw', () => {
      const skill = createSkillVoices();
      expect(skill.length).toBeGreaterThanOrEqual(2);

      const sawOsc = skill.find(v => !v.isNoise && (v.type === 'sawtooth' || v.type === 'square'));
      expect(sawOsc).toBeDefined();
      expect(sawOsc!.filter).toBe('bandpass');
      expect(sawOsc!.cutoffEnd).toBeGreaterThan(sawOsc!.cutoff ?? 0);
    });

    it('createFrenzyVoices produces ascending riser (220Hz->880Hz) + heart-thump sub kick', () => {
      const frenzy = createFrenzyVoices();
      expect(frenzy.length).toBeGreaterThanOrEqual(2);

      const riser = frenzy.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 220) < 30 && (v.freqEnd ?? 0) >= 800);
      expect(riser).toBeDefined();

      const kick = frenzy.find(v => !v.isNoise && (v.freq ?? 0) <= 100 && (v.freqEnd ?? 0) < (v.freq ?? 0));
      expect(kick).toBeDefined();
    });

    it('createShieldVoices produces 130ms dual harmonic swell (659Hz + 987Hz)', () => {
      const shield = createShieldVoices();
      expect(shield.length).toBeGreaterThanOrEqual(2);

      const maxDur = Math.max(...shield.map(v => (v.when ?? 0) + (v.dur ?? 0)));
      expect(maxDur).toBeLessThanOrEqual(0.13001);

      const e5 = shield.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 659.25) < 5);
      const b5 = shield.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 987.77) < 5);
      expect(e5).toBeDefined();
      expect(b5).toBeDefined();
      expect(e5!.attack).toBeGreaterThan(0.01);
    });

    it('createShieldBreakVoices produces 140ms crystalline shatter (2800Hz -> 1200Hz)', () => {
      const shatter = createShieldBreakVoices();
      expect(shatter.length).toBeGreaterThanOrEqual(2);

      const maxDur = Math.max(...shatter.map(v => (v.when ?? 0) + (v.dur ?? 0)));
      expect(maxDur).toBeLessThanOrEqual(0.14001);

      const crystal = shatter.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 2800) < 50 && Math.abs((v.freqEnd ?? 0) - 1200) < 50);
      expect(crystal).toBeDefined();
    });
  });

  describe('4. Bosses, Health & Milestones Voice Specifications', () => {
    it('createHurtVoices produces low-frequency dull impact (130Hz) with soft high-cut (380Hz)', () => {
      const hurt = createHurtVoices();
      expect(hurt.length).toBeGreaterThanOrEqual(1);

      const impact = hurt.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 130) < 25);
      expect(impact).toBeDefined();
      expect(impact!.filter).toBe('lowpass');
      expect((impact!.cutoff ?? 0)).toBeLessThanOrEqual(450);
    });

    it('createGameOverVoices produces short 500ms clean deactivation pulse (440Hz -> 55Hz pure sine glide)', () => {
      const die = createGameOverVoices();
      expect(die.length).toBeGreaterThanOrEqual(1);

      const maxDur = Math.max(...die.map(v => (v.when ?? 0) + (v.dur ?? 0)));
      expect(maxDur).toBeLessThanOrEqual(0.50001);

      const drop = die.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 440) < 15 && (v.freqEnd ?? 0) <= 60);
      expect(drop).toBeDefined();
    });

    it('createBossAlertVoices produces 580ms ominous sub-bass pulse (45Hz + 880Hz harmonic)', () => {
      const boss = createBossAlertVoices(1);
      expect(boss.length).toBeGreaterThanOrEqual(2);

      const maxDur = Math.max(...boss.map(v => (v.when ?? 0) + (v.dur ?? 0)));
      expect(maxDur).toBeLessThanOrEqual(0.58001);

      const sub = boss.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 45) < 5);
      const harmonic = boss.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 880) < 50);

      expect(sub).toBeDefined();
      expect(harmonic).toBeDefined();
    });

    it('createLevelUpVoices produces short 450ms ascending cyber chime (880Hz -> 1108Hz -> 1318Hz -> 1760Hz) with 65Hz sub-bass anchor', () => {
      const lvl = createLevelUpVoices();
      expect(lvl.length).toBeGreaterThanOrEqual(3);

      const maxDur = Math.max(...lvl.map(v => (v.when ?? 0) + (v.dur ?? 0)));
      expect(maxDur).toBeLessThanOrEqual(0.45001);

      const sub = lvl.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 65) < 3);
      expect(sub).toBeDefined();

      const notes = [880.00, 1108.73, 1318.51, 1760.00];
      const toneVoices = lvl.filter(v => !v.isNoise && v.freq !== undefined);

      notes.forEach(note => {
        const found = toneVoices.some(v => Math.abs(v.freq! - note) < 5);
        expect(found).toBe(true);
      });
    });

    it('createVictoryVoices produces short 650ms rising cyber-triumph cadence (E5 -> B5 -> E6 -> G#6) with 50Hz sub-bass', () => {
      const vic = createVictoryVoices();
      expect(vic.length).toBeGreaterThanOrEqual(4);

      const maxDur = Math.max(...vic.map(v => (v.when ?? 0) + (v.dur ?? 0)));
      expect(maxDur).toBeLessThanOrEqual(0.65001);

      const sub = vic.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 50) < 3);
      expect(sub).toBeDefined();

      const notes = [659.25, 987.77, 1318.51, 1661.22];
      const toneVoices = vic.filter(v => !v.isNoise && v.freq !== undefined);

      notes.forEach(note => {
        const found = toneVoices.some(v => Math.abs(v.freq! - note) < 5);
        expect(found).toBe(true);
      });
    });

    it('procedural fallback jingle voice specs (createLevelUpVoices, createVictoryVoices, createGameOverVoices) have duration <= 0.68s and use sleek cyber harmonic synth structures', () => {
      const lvlVoices = createLevelUpVoices();
      const vicVoices = createVictoryVoices();
      const goVoices = createGameOverVoices();

      const maxLvl = Math.max(...lvlVoices.map(v => (v.when ?? 0) + (v.dur ?? 0)));
      const maxVic = Math.max(...vicVoices.map(v => (v.when ?? 0) + (v.dur ?? 0)));
      const maxGo = Math.max(...goVoices.map(v => (v.when ?? 0) + (v.dur ?? 0)));

      expect(maxLvl).toBeLessThanOrEqual(0.68);
      expect(maxVic).toBeLessThanOrEqual(0.68);
      expect(maxGo).toBeLessThanOrEqual(0.68);

      lvlVoices.forEach(v => expect((v.when ?? 0) + (v.dur ?? 0)).toBeLessThanOrEqual(0.68));
      vicVoices.forEach(v => expect((v.when ?? 0) + (v.dur ?? 0)).toBeLessThanOrEqual(0.68));
      goVoices.forEach(v => expect((v.when ?? 0) + (v.dur ?? 0)).toBeLessThanOrEqual(0.68));
    });
  });

  describe('5. UI Audio Specifications', () => {
    it('createUiClickVoices produces 10ms pure tactile glass click (3200Hz)', () => {
      const click = createUiClickVoices();
      expect(click.length).toBeGreaterThanOrEqual(1);

      const maxDur = Math.max(...click.map(v => (v.when ?? 0) + (v.dur ?? 0)));
      expect(maxDur).toBeLessThanOrEqual(0.01001);

      const tone = click.find(v => !v.isNoise && Math.abs((v.freq ?? 0) - 3200) < 50);
      expect(tone).toBeDefined();
    });

    it('createUiHoverVoices produces 10ms pure tactile glass click (4000Hz)', () => {
      const hover = createUiHoverVoices();
      expect(hover.length).toBeGreaterThanOrEqual(1);

      const blip = hover[0]!;
      expect(Math.abs((blip.freq ?? 0) - 4000)).toBeLessThan(50);
      expect(blip.dur).toBeLessThanOrEqual(0.01001);
      expect(blip.peak).toBeLessThanOrEqual(0.1);
    });

    it('createErrorVoices produces subdued low-frequency double-pulse warning (140Hz->120Hz)', () => {
      const err = createErrorVoices();
      expect(err.length).toBeGreaterThanOrEqual(2);

      expect(err[0]!.freq).toBeCloseTo(140, -1);
      expect(err[1]!.when).toBeGreaterThan(err[0]!.when);
    });

    it('createCardPickVoices varies chime brightness based on rarity tier', () => {
      const common = createCardPickVoices('common');
      const rare = createCardPickVoices('rare');
      const legendary = createCardPickVoices('legendary');

      expect(legendary.length).toBeGreaterThan(common.length);
      expect(rare.length).toBeGreaterThanOrEqual(common.length);
    });

    it('createComboTickVoices, createReviveVoices, and createVoidCollapseVoices produce rich recipes', () => {
      const tick = createComboTickVoices(5);
      const revive = createReviveVoices();
      const voidCollapse = createVoidCollapseVoices();

      expect(tick.length).toBeGreaterThanOrEqual(1);
      expect(revive.length).toBeGreaterThanOrEqual(2);
      expect(voidCollapse.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('6. Headless Offline DSP Rendering (bakeSoundToBuffer)', () => {
    it('bakes valid finite PCM audio buffers for all procedural sound recipes without NaN or Infinity', () => {
      const recipes = [
        createEatVoices(1, false),
        createEatVoices(5, true),
        createStarVoices(),
        createBiteVoices(20, true),
        createShootVoices(),
        createLaserFireVoices(),
        createHitVoices(1.5),
        createCritVoices(),
        createExplosionVoices(1.2),
        createThunderVoices(1.0),
        createFlameVoices(),
        createDashVoices(),
        createSkillVoices(),
        createFrenzyVoices(),
        createShieldVoices(),
        createShieldBreakVoices(),
        createHurtVoices(25),
        createGameOverVoices(),
        createBossAlertVoices(2),
        createLevelUpVoices(),
        createVictoryVoices(),
        createUiClickVoices(),
        createUiHoverVoices(),
        createErrorVoices(),
        createCardPickVoices('legendary'),
        createComboTickVoices(10),
        createReviveVoices(),
        createVoidCollapseVoices(),
      ];

      for (const recipe of recipes) {
        const pcm = bakeSoundToBuffer(recipe, 22050); // fast sample rate for headless test
        expect(pcm.length).toBeGreaterThan(100);

        let energy = 0;
        for (let i = 0; i < pcm.length; i++) {
          const sample = pcm[i]!;
          expect(Number.isFinite(sample)).toBe(true);
          energy += Math.abs(sample);
        }
        expect(energy).toBeGreaterThan(0.001);
      }
    });
  });

  describe('7. Web Audio Graph Lifecycle, Leak Prevention & Null Resilience', () => {
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
      public start(): void { this.started = true; }
      public stop(): void { this.stopped = true; }
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
      public playbackRate = new MockAudioParam();
      public onended: (() => void) | null = null;
      public started = false;
      public stopped = false;
      public start(): void { this.started = true; }
      public stop(): void { this.stopped = true; }
    }

    class MockAudioContext {
      public currentTime = 100.0;
      public sampleRate = 44100;
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

    it('playVoiceSpecs safely executes with null audio context without throwing', () => {
      expect(() => {
        playVoiceSpecs(createExplosionVoices(), null, null);
      }).not.toThrow();
    });

    it('playVoiceSpecs compiles graph and disconnects all nodes on stop() ensuring zero memory leaks', () => {
      const mockCtx = new MockAudioContext();
      const dest = new MockAudioNode();

      const handle = playVoiceSpecs(createExplosionVoices(1.5), mockCtx as any, dest as any);
      expect(handle).toBeDefined();

      expect(mockCtx.createdGains.length).toBeGreaterThan(0);
      expect(mockCtx.createdOscillators.length + mockCtx.createdSources.length).toBeGreaterThan(0);

      // Trigger manual stop
      handle!.stop();

      // Ensure every allocated node has disconnect() called
      expect(mockCtx.createdOscillators.every(o => o.disconnected)).toBe(true);
      expect(mockCtx.createdSources.every(s => s.disconnected)).toBe(true);
      expect(mockCtx.createdGains.every(g => g.disconnected)).toBe(true);
      expect(mockCtx.createdFilters.every(f => f.disconnected)).toBe(true);
    });

    it('playVoiceSpecs disconnects all nodes automatically when terminal onended fires', () => {
      const mockCtx = new MockAudioContext();
      const dest = new MockAudioNode();

      playVoiceSpecs(createStarVoices(), mockCtx as any, dest as any);

      // Fire all onended callbacks
      mockCtx.createdOscillators.forEach(o => {
        if (o.onended) o.onended();
      });
      mockCtx.createdSources.forEach(s => {
        if (s.onended) s.onended();
      });

      expect(mockCtx.createdOscillators.every(o => o.disconnected)).toBe(true);
      expect(mockCtx.createdGains.every(g => g.disconnected)).toBe(true);
    });
  });

  describe('8. SoundEngine SFX Dispatcher Integration', () => {
    let sound: SoundEngine;

    beforeEach(() => {
      sound = new SoundEngine();
    });

    it('dispatches all 28 sound methods headlessly without throwing errors', () => {
      expect(() => {
        sound.playEat(1, false);
        sound.playEat(5, true);
        sound.playShard();
        sound.PlayShard();
        sound.playBite(25, true);
        sound.playShoot(880);
        sound.PlayShoot(880);
        sound.playLaserFire(1200);
        sound.playHit(1.5);
        sound.PlayHit(1.5);
        sound.playCrit();
        sound.PlayCrit();
        sound.playExplosion(2.0);
        sound.PlayExplosion(2.0);
        sound.playThunder(1.0);
        sound.PlayThunder();
        sound.playFlame();
        sound.PlayFlame();
        sound.playDash();
        sound.PlayDash();
        sound.playSkill();
        sound.PlaySkill();
        sound.playFrenzy();
        sound.PlayFrenzy();
        sound.playFrenzyStart();
        sound.playShield();
        sound.PlayShield();
        sound.playShieldBreak();
        sound.playHurt(30);
        sound.playDie();
        sound.playGameOver();
        sound.PlayGameOver();
        sound.playBossAlert(1);
        sound.PlayBossAlert(1);
        sound.playBossRoar(2);
        sound.playLevelUp();
        sound.PlayLevelUp();
        sound.playVictory();
        sound.PlayVictory();
        sound.playFloorClear();
        sound.PlayFloorClear();
        sound.playUi();
        sound.PlayUi();
        sound.playUiClick();
        sound.playUiHover();
        sound.playError();
        sound.PlayError();
        sound.playCardPick('epic');
        sound.playComboTick(8);
        sound.playRevive();
        sound.PlayRevive();
        sound.playVoidCollapse();
        sound.PlayVoidCollapse();
        sound.playWarpJump();
        sound.PlayWarpJump();
        sound.playUniqueHelmetReveal();
        sound.PlayUniqueHelmetReveal();
      }).not.toThrow();
    });
  });

  describe('9. Broadcast-Quality Audio Buffer Cache & Hybrid Dispatcher', () => {
    class MockAudioParam {
      public value: number = 1.0;
      public setValueAtTime(_val: number, _time: number): void { this.value = _val; }
      public linearRampToValueAtTime(_val: number, _time: number): void { this.value = _val; }
      public exponentialRampToValueAtTime(_val: number, _time: number): void { this.value = _val; }
    }

    class MockAudioNode {
      public connectedTo: any[] = [];
      public disconnected = false;
      public connect(dest: any): any {
        this.connectedTo.push(dest);
        return dest;
      }
      public disconnect(): void {
        this.disconnected = true;
        this.connectedTo.length = 0;
      }
    }

    class MockGainNode extends MockAudioNode {
      public gain = new MockAudioParam();
    }

    class MockBufferSourceNode extends MockAudioNode {
      public buffer: any = null;
      public playbackRate = new MockAudioParam();
      public onended: (() => void) | null = null;
      public started = false;
      public stopped = false;
      public start(): void { this.started = true; }
      public stop(): void { this.stopped = true; }
    }

    class MockAudioContext {
      public currentTime = 100.0;
      public sampleRate = 44100;
      public state = 'running';
      public destination = new MockAudioNode();

      public createdOscillators: any[] = [];
      public createdGains: MockGainNode[] = [];
      public createdFilters: any[] = [];
      public createdSources: MockBufferSourceNode[] = [];

      public createGain(): any {
        const gain = new MockGainNode();
        this.createdGains.push(gain);
        return gain;
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

      public createBufferSource(): any {
        const src = new MockBufferSourceNode();
        this.createdSources.push(src);
        return src;
      }

      public decodeAudioData(buffer: ArrayBuffer): Promise<any> {
        return Promise.resolve({
          numberOfChannels: 2,
          length: 44100,
          sampleRate: 44100,
          duration: 1.0,
          getChannelData: () => new Float32Array(44100),
        });
      }

      public resume(): Promise<void> {
        return Promise.resolve();
      }
    }

    beforeEach(() => {
      clearAudioBufferCache();
    });

    it('BROADCAST_AUDIO_PATHS dictionary contains all 18 broadcast-quality asset paths', () => {
      expect(BROADCAST_AUDIO_PATHS).toBeDefined();
      expect(Object.keys(BROADCAST_AUDIO_PATHS).length).toBeGreaterThanOrEqual(18);
      expect(BROADCAST_AUDIO_PATHS.warpJump).toContain('sfx_warp_jump.wav');
      expect(BROADCAST_AUDIO_PATHS.starDing).toContain('sfx_star_ding.wav');
      expect(BROADCAST_AUDIO_PATHS.gemChime).toContain('sfx_gem_chime.wav');
      expect((BROADCAST_AUDIO_PATHS as any).eatPop).toContain('sfx_eat');
      expect(BROADCAST_AUDIO_PATHS.shieldOn).toContain('sfx_shield_on.wav');
      expect(BROADCAST_AUDIO_PATHS.shieldBreak).toContain('sfx_shield_break.wav');
      expect(BROADCAST_AUDIO_PATHS.laserPew).toContain('sfx_laser_pew.wav');
      expect(BROADCAST_AUDIO_PATHS.laserHeavy).toContain('sfx_laser_heavy.wav');
      expect(BROADCAST_AUDIO_PATHS.uiClick).toContain('sfx_ui_click.wav');
      expect(BROADCAST_AUDIO_PATHS.uiTab).toContain('sfx_ui_tab.wav');
      expect(BROADCAST_AUDIO_PATHS.levelUp).toContain('sfx_level_up.wav');
      expect(BROADCAST_AUDIO_PATHS.victory).toContain('sfx_victory.wav');
      expect(BROADCAST_AUDIO_PATHS.gameOver).toContain('sfx_game_over.wav');
      expect(BROADCAST_AUDIO_PATHS.bossRoar).toContain('sfx_boss_roar.wav');
      expect(BROADCAST_AUDIO_PATHS.dash).toContain('sfx_dash.wav');
      expect((BROADCAST_AUDIO_PATHS as any).musicExploration).toContain('music_exploration.wav');
      expect((BROADCAST_AUDIO_PATHS as any).musicCombat).toContain('music_combat.wav');
      expect((BROADCAST_AUDIO_PATHS as any).musicBoss).toContain('music_boss.wav');
    });

    it('loadAudioBuffer gracefully handles headless environment or missing asset by returning null', async () => {
      const res = await loadAudioBuffer('assets/audio/missing_sound.wav');
      expect(res).toBeNull();
    });

    it('loadAudioBuffer caches decoded AudioBuffer in memory and avoids duplicate decodes', async () => {
      const mockCtx = new MockAudioContext();
      const decodeSpy = vi.spyOn(mockCtx, 'decodeAudioData');

      // Mock fetch
      const origFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      } as any);

      try {
        const buf1 = await loadAudioBuffer('test_sfx.wav', mockCtx as any);
        expect(buf1).toBeDefined();
        expect(decodeSpy).toHaveBeenCalledTimes(1);

        // Second call should return cached instance without calling decodeAudioData again
        const buf2 = await loadAudioBuffer('test_sfx.wav', mockCtx as any);
        expect(buf2).toBe(buf1);
        expect(decodeSpy).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('setCachedAudioBuffer, getCachedAudioBuffer, and clearAudioBufferCache manage the cache', () => {
      const dummyBuf: any = { duration: 1.0, length: 44100 };
      setCachedAudioBuffer('custom/sfx.wav', dummyBuf);
      expect(getCachedAudioBuffer('custom/sfx.wav')).toBe(dummyBuf);

      clearAudioBufferCache();
      expect(getCachedAudioBuffer('custom/sfx.wav')).toBeNull();
    });

    it('playAudioBuffer creates BufferSourceNode, connects through GainNode and triggers playback', () => {
      const mockCtx = new MockAudioContext();
      const dest = new MockAudioNode();
      const dummyBuf: any = { duration: 1.5, length: 66150 };

      const handle = playAudioBuffer(dummyBuf, mockCtx as any, dest as any, 0.8);
      expect(handle).toBeDefined();
      expect(mockCtx.createdSources.length).toBe(1);
      expect(mockCtx.createdGains.length).toBe(1);

      const src = mockCtx.createdSources[0]!;
      expect(src.buffer).toBe(dummyBuf);
      expect(src.started).toBe(true);

      // Manual stop disconnects nodes
      handle!.stop();
      expect(src.stopped).toBe(true);
      expect(src.disconnected).toBe(true);
      expect(mockCtx.createdGains[0]!.disconnected).toBe(true);
    });

    it('playAudioBuffer automatically disconnects nodes on onended event', () => {
      const mockCtx = new MockAudioContext();
      const dest = new MockAudioNode();
      const dummyBuf: any = { duration: 1.5, length: 66150 };

      playAudioBuffer(dummyBuf, mockCtx as any, dest as any);
      const src = mockCtx.createdSources[0]!;
      expect(src.onended).toBeDefined();

      src.onended!();
      expect(src.disconnected).toBe(true);
      expect(mockCtx.createdGains[0]!.disconnected).toBe(true);
    });

    it('playAudioBuffer safely returns void if audio context is null or closed', () => {
      expect(() => {
        const dummyBuf: any = { duration: 1.0 };
        const h1 = playAudioBuffer(dummyBuf, null);
        expect(h1).toBeUndefined();

        const h2 = playAudioBuffer(dummyBuf, { state: 'closed' } as any);
        expect(h2).toBeUndefined();
      }).not.toThrow();
    });

    it('SoundEngine.preloadBroadcastAudio executes without errors and triggers asset preloading', async () => {
      const sound = new SoundEngine();
      await expect(sound.preloadBroadcastAudio()).resolves.not.toThrow();
    });

    it('SoundEngine hybrid dispatch plays cached broadcast AudioBuffer when available for all 12 sounds', () => {
      const sound = new SoundEngine();
      const mockCtx = new MockAudioContext();
      (sound as any)._ctx = mockCtx;
      (sound as any)._masterGain = mockCtx.createGain();
      (sound as any)._sfxGain = mockCtx.createGain();
      (sound as any)._musicGain = mockCtx.createGain();

      const dummyBuf: any = { duration: 1.0, length: 44100 };
      // Inject all broadcast assets into cache
      for (const key of Object.keys(BROADCAST_AUDIO_PATHS)) {
        setCachedAudioBuffer((BROADCAST_AUDIO_PATHS as any)[key], dummyBuf);
      }

      // Initial source count
      expect(mockCtx.createdSources.length).toBe(0);

      sound.playWarpJump();
      expect(mockCtx.createdSources.length).toBe(1);

      sound.playEat(1, false);
      expect(mockCtx.createdSources.length).toBe(2);

      sound.playStar();
      expect(mockCtx.createdSources.length).toBe(3);

      sound.playShoot(880);
      expect(mockCtx.createdSources.length).toBe(4);

      sound.playDash();
      expect(mockCtx.createdSources.length).toBe(5);

      sound.playShield();
      expect(mockCtx.createdSources.length).toBe(6);

      sound.playShieldBreak();
      expect(mockCtx.createdSources.length).toBe(7);

      sound.playLevelUp();
      expect(mockCtx.createdSources.length).toBe(8);

      sound.playVictory();
      expect(mockCtx.createdSources.length).toBe(9);

      sound.playGameOver();
      expect(mockCtx.createdSources.length).toBe(10);

      sound.playBossRoar(2);
      expect(mockCtx.createdSources.length).toBe(11);

      sound.playUiClick();
      expect(mockCtx.createdSources.length).toBe(12);
    });

    it('SoundEngine hybrid dispatch seamlessly falls back to procedural Synth when buffer is uncached', () => {
      clearAudioBufferCache();
      const sound = new SoundEngine();

      // In headless environment without Web Audio context, dispatches cleanly
      expect(() => {
        sound.playWarpJump();
        sound.playEat(1, false);
        sound.playStar();
        sound.playShoot(880);
        sound.playDash();
        sound.playShield();
        sound.playShieldBreak();
        sound.playLevelUp();
        sound.playVictory();
        sound.playGameOver();
        sound.playBossRoar(1);
        sound.playUiClick();
      }).not.toThrow();
    });

    it('SoundEngine respects muted state when playing broadcast buffers', () => {
      const sound = new SoundEngine();
      const mockCtx = new MockAudioContext();
      (sound as any)._ctx = mockCtx;
      (sound as any)._masterGain = mockCtx.createGain();
      (sound as any)._sfxGain = mockCtx.createGain();

      const dummyBuf: any = { duration: 1.0, length: 44100 };
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.dash, dummyBuf);

      sound.setMuted(true);
      sound.playDash();
      // Should not play when muted
      expect(mockCtx.createdSources.length).toBe(0);
    });

    it('all jingle broadcast WAV assets (sfx_level_up.wav, sfx_victory.wav, sfx_game_over.wav) have durations <= 0.68s', () => {
      const jingles = ['sfx_level_up.wav', 'sfx_victory.wav', 'sfx_game_over.wav'];
      for (const file of jingles) {
        const p = path.resolve(__dirname, '../../public/assets/audio', file);
        expect(fs.existsSync(p), `Missing audio asset: ${p}`).toBe(true);
        const buf = fs.readFileSync(p);
        const dataIdx = buf.indexOf('data');
        expect(dataIdx).toBeGreaterThan(0);
        const dataLen = buf.readUInt32LE(dataIdx + 4);
        const byteRate = buf.readUInt32LE(28);
        const duration = dataLen / byteRate;
        expect(duration).toBeLessThanOrEqual(0.68);
      }
    });

    it('asserts all broadcast assets exist on disk, load cleanly, and procedural fallbacks produce pristine voice specs', () => {
      const allPaths = [
        ...Object.values(BROADCAST_AUDIO_PATHS),
        ...Object.values(BROADCAST_MUSIC_PATHS),
      ];

      for (const relPath of allPaths) {
        const p = path.resolve(__dirname, '../../public', relPath);
        expect(fs.existsSync(p), `Broadcast audio file missing on disk: ${p}`).toBe(true);
        const buf = fs.readFileSync(p);
        expect(buf.length).toBeGreaterThan(44);
        // Valid RIFF WAVE container
        expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
        expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
        const sampleRate = buf.readUInt32LE(24);
        expect(sampleRate).toBe(44100);
        const bitDepth = buf.readUInt16LE(34);
        expect(bitDepth).toBe(16);
      }

      // Assert all procedural fallback recipes produce pristine VoiceSpecs (pure harmonics, finite values, no NaN/Infinity)
      const fallbackRecipes: [string, VoiceSpec[]][] = [
        ['eat', createEatVoices(1, false)],
        ['eatGolden', createEatVoices(5, true)],
        ['star', createStarVoices()],
        ['bite', createBiteVoices(25, true)],
        ['shoot', createShootVoices(880)],
        ['laser', createLaserFireVoices(1200)],
        ['hit', createHitVoices(1.5)],
        ['crit', createCritVoices()],
        ['explosion', createExplosionVoices(2.0)],
        ['thunder', createThunderVoices(1.0)],
        ['flame', createFlameVoices()],
        ['dash', createDashVoices()],
        ['skill', createSkillVoices()],
        ['frenzy', createFrenzyVoices()],
        ['shield', createShieldVoices()],
        ['shieldBreak', createShieldBreakVoices()],
        ['hurt', createHurtVoices(30)],
        ['gameOver', createGameOverVoices()],
        ['bossAlert', createBossAlertVoices(1)],
        ['levelUp', createLevelUpVoices()],
        ['victory', createVictoryVoices()],
        ['uiClick', createUiClickVoices()],
        ['uiHover', createUiHoverVoices()],
        ['error', createErrorVoices()],
        ['cardPick', createCardPickVoices('legendary')],
        ['comboTick', createComboTickVoices(8)],
        ['revive', createReviveVoices()],
        ['voidCollapse', createVoidCollapseVoices()],
      ];

      for (const [name, specs] of fallbackRecipes) {
        expect(specs.length, `${name} has empty voice specs`).toBeGreaterThan(0);
        for (const v of specs) {
          if (v.freq !== undefined) expect(Number.isFinite(v.freq), `${name} non-finite freq`).toBe(true);
          if (v.freqPeak !== undefined) expect(Number.isFinite(v.freqPeak), `${name} non-finite freqPeak`).toBe(true);
          if (v.freqEnd !== undefined) expect(Number.isFinite(v.freqEnd), `${name} non-finite freqEnd`).toBe(true);
          if (v.cutoff !== undefined) expect(Number.isFinite(v.cutoff), `${name} non-finite cutoff`).toBe(true);
          if (v.cutoffEnd !== undefined) expect(Number.isFinite(v.cutoffEnd), `${name} non-finite cutoffEnd`).toBe(true);
          expect(Number.isFinite(v.dur), `${name} non-finite dur`).toBe(true);
          expect(v.dur, `${name} non-positive dur`).toBeGreaterThan(0);
          expect(Number.isFinite(v.peak), `${name} non-finite peak`).toBe(true);
          expect(v.peak, `${name} non-positive peak`).toBeGreaterThan(0);
        }
      }
    });

    it('playEat unifies all eating sound routing to identical broadcast asset path (sfx_eat.wav or eat)', () => {
      const sound = new SoundEngine();
      const mockCtx = new MockAudioContext();
      (sound as any)._ctx = mockCtx;
      (sound as any)._masterGain = mockCtx.createGain();
      (sound as any)._sfxGain = mockCtx.createGain();

      const eatBuf: any = { id: 'eat', duration: 0.042, length: 1852 };
      const gemChimeBuf: any = { id: 'gemChime', duration: 1.0, length: 44100 };
      const starDingBuf: any = { id: 'starDing', duration: 0.5, length: 22050 };

      const eatPath = (BROADCAST_AUDIO_PATHS as any).eat ?? (BROADCAST_AUDIO_PATHS as any).eatPop;
      expect(eatPath).toMatch(/sfx_eat/);

      setCachedAudioBuffer(eatPath, eatBuf);
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.gemChime, gemChimeBuf);
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.starDing, starDingBuf);

      // 1. Standard food triggers eat buffer
      sound.playEat(1, false);
      expect(mockCtx.createdSources.length).toBe(1);
      expect(mockCtx.createdSources[0]!.buffer).toBe(eatBuf);

      // 2. High combo triggers identical eat buffer
      sound.playEat(10, false);
      expect(mockCtx.createdSources.length).toBe(2);
      expect(mockCtx.createdSources[1]!.buffer).toBe(eatBuf);

      // 3. Golden food triggers identical eat buffer (NOT gemChime)
      sound.playEat(1, true);
      expect(mockCtx.createdSources.length).toBe(3);
      expect(mockCtx.createdSources[2]!.buffer).toBe(eatBuf);
      expect(mockCtx.createdSources[2]!.buffer).not.toBe(gemChimeBuf);

      // 4. Shard triggers starDing buffer
      sound.playShard();
      expect(mockCtx.createdSources.length).toBe(4);
      expect(mockCtx.createdSources[3]!.buffer).toBe(starDingBuf);

      // 5. Star triggers gemChime buffer
      sound.playStar();
      expect(mockCtx.createdSources.length).toBe(5);
      expect(mockCtx.createdSources[4]!.buffer).toBe(gemChimeBuf);
    });

    it('broadcast music tracks and sfx_eat are registered in BROADCAST_AUDIO_PATHS', () => {
      expect((BROADCAST_AUDIO_PATHS as any).musicExploration).toBe('assets/audio/music_exploration.wav');
      expect((BROADCAST_AUDIO_PATHS as any).musicCombat).toBe('assets/audio/music_combat.wav');
      expect((BROADCAST_AUDIO_PATHS as any).musicBoss).toBe('assets/audio/music_boss.wav');
      expect((BROADCAST_AUDIO_PATHS as any).eat ?? (BROADCAST_AUDIO_PATHS as any).eatPop).toMatch(/sfx_eat/);
    });
  });

  describe('10. Broadcast Soundtrack Streaming & Sidechain Ducking Hybrid Engine', () => {
    class MockAudioParam {
      public value: number = 1.0;
      public setValueAtTime = vi.fn().mockImplementation((val: number) => { this.value = val; return this; });
      public linearRampToValueAtTime = vi.fn().mockImplementation((val: number) => { this.value = val; return this; });
      public exponentialRampToValueAtTime = vi.fn().mockImplementation((val: number) => { this.value = val; return this; });
      public setTargetAtTime = vi.fn().mockImplementation((val: number) => { this.value = val; return this; });
      public cancelScheduledValues = vi.fn().mockReturnThis();
    }

    class MockAudioNode {
      public connectedTo: any[] = [];
      public disconnected = false;
      public connect(dest: any): any {
        this.connectedTo.push(dest);
        return dest;
      }
      public disconnect(): void {
        this.disconnected = true;
        this.connectedTo.length = 0;
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
      public loop: boolean = false;
      public playbackRate = new MockAudioParam();
      public onended: (() => void) | null = null;
      public started = false;
      public stopped = false;
      public start = vi.fn().mockImplementation(() => { this.started = true; });
      public stop = vi.fn().mockImplementation(() => { this.stopped = true; });
    }

    class MockAudioContext {
      public currentTime = 100.0;
      public sampleRate = 44100;
      public state = 'running';
      public destination = new MockAudioNode();

      public createdOscillators: any[] = [];
      public createdGains: MockGainNode[] = [];
      public createdFilters: MockBiquadFilterNode[] = [];
      public createdSources: MockBufferSourceNode[] = [];

      public createOscillator(): any {
        const osc = {
          type: 'sine',
          frequency: new MockAudioParam(),
          detune: new MockAudioParam(),
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
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
          duration: length / sampleRate,
          getChannelData: () => new Float32Array(length),
        };
      }

      public createBufferSource(): any {
        const src = new MockBufferSourceNode();
        this.createdSources.push(src);
        return src;
      }

      public decodeAudioData(buffer: ArrayBuffer): Promise<any> {
        return Promise.resolve({
          numberOfChannels: 2,
          length: 44100,
          sampleRate: 44100,
          duration: 4.0,
          getChannelData: () => new Float32Array(44100),
        });
      }

      public resume(): Promise<void> {
        return Promise.resolve();
      }
    }

    let sound: SoundEngine;
    let music: MusicPlayer;
    let mockCtx: MockAudioContext;
    const explorationBuf: any = { duration: 10.0, length: 441000 };
    const combatBuf: any = { duration: 8.0, length: 352800 };
    const bossBuf: any = { duration: 12.0, length: 529200 };

    beforeEach(() => {
      clearAudioBufferCache();
      mockCtx = new MockAudioContext();
      sound = new SoundEngine();
      Object.defineProperty(sound, 'unavailable', { get: () => false, configurable: true });
      (sound as any)._ctx = mockCtx;
      (sound as any)._masterGain = mockCtx.createGain();
      (sound as any)._sfxGain = mockCtx.createGain();
      (sound as any)._musicGain = mockCtx.createGain();

      music = new MusicPlayer(sound);
      (music as any).ctx = mockCtx;
      (music as any).musicBus = (sound as any)._musicGain;
    });

    it('BROADCAST_MUSIC_PATHS dictionary contains exploration, combat, and boss tracks', () => {
      expect(BROADCAST_MUSIC_PATHS).toBeDefined();
      expect(BROADCAST_MUSIC_PATHS.exploration).toContain('music_exploration.wav');
      expect(BROADCAST_MUSIC_PATHS.combat).toContain('music_combat.wav');
      expect(BROADCAST_MUSIC_PATHS.boss).toContain('music_boss.wav');
    });

    it('plays broadcast audio loop with loop=true when buffer is cached on startMusic()', () => {
      setCachedAudioBuffer(BROADCAST_MUSIC_PATHS.exploration, explorationBuf);
      music.startMusic();

      expect(music.isPlaying).toBe(true);
      expect(music.isBroadcastActive).toBe(true);
      expect(music.currentTrack).toBe('exploration');

      expect(mockCtx.createdSources.length).toBe(1);
      const src = mockCtx.createdSources[0]!;
      expect(src.buffer).toBe(explorationBuf);
      expect(src.loop).toBe(true);
      expect(src.started).toBe(true);
    });

    it('crossfades seamlessly to music_combat.wav when frenzy or intensity > 0.6 is triggered', () => {
      setCachedAudioBuffer(BROADCAST_MUSIC_PATHS.exploration, explorationBuf);
      setCachedAudioBuffer(BROADCAST_MUSIC_PATHS.combat, combatBuf);
      music.startMusic();

      expect(music.currentTrack).toBe('exploration');
      expect(mockCtx.createdSources.length).toBe(1);

      // Trigger high intensity
      music.setMusicIntensity(0.75);
      expect(music.currentTrack).toBe('combat');
      // A second source created for combat crossfade
      expect(mockCtx.createdSources.length).toBe(2);
      const combatSrc = mockCtx.createdSources[1]!;
      expect(combatSrc.buffer).toBe(combatBuf);
      expect(combatSrc.loop).toBe(true);
      expect(combatSrc.started).toBe(true);

      // Verify outgoing track gain was ramped down and incoming track gain ramped up
      expect(mockCtx.createdGains.length).toBeGreaterThanOrEqual(2);
    });

    it('crossfades seamlessly to music_boss.wav when boss mode is activated', () => {
      setCachedAudioBuffer(BROADCAST_MUSIC_PATHS.exploration, explorationBuf);
      setCachedAudioBuffer(BROADCAST_MUSIC_PATHS.boss, bossBuf);
      music.startMusic();

      expect(music.currentTrack).toBe('exploration');

      music.setBossMode(true, 1);
      expect(music.currentTrack).toBe('boss');
      expect(mockCtx.createdSources.length).toBe(2);
      const bossSrc = mockCtx.createdSources[1]!;
      expect(bossSrc.buffer).toBe(bossBuf);
      expect(bossSrc.loop).toBe(true);
    });

    it('connects broadcast track through moodFilter so dynamic lowpass filtering applies', () => {
      setCachedAudioBuffer(BROADCAST_MUSIC_PATHS.exploration, explorationBuf);
      music.startMusic();

      // moodFilter should be created and connected
      expect(mockCtx.createdFilters.length).toBeGreaterThan(0);
      const moodFilter = (music as any).moodFilter;
      expect(moodFilter).toBeDefined();
      expect(moodFilter.type).toBe('lowpass');

      // Pausing sets lowpass cutoff to 400 Hz
      music.pauseMusic();
      expect(moodFilter.frequency.setTargetAtTime).toHaveBeenCalledWith(
        400,
        expect.any(Number),
        expect.any(Number)
      );
    });

    it('smoothly falls back to procedural sequencer when broadcast buffers are absent', () => {
      clearAudioBufferCache();
      music.startMusic();

      expect(music.isPlaying).toBe(true);
      expect(music.isBroadcastActive).toBe(false);
      // No broadcast AudioBufferSourceNode created
      expect(mockCtx.createdSources.length).toBe(0);
    });

    it('sidechain duck(amount, duration) attenuates duckGain and ramps back to unity', () => {
      setCachedAudioBuffer(BROADCAST_MUSIC_PATHS.exploration, explorationBuf);
      music.startMusic();

      const duckGain = (music as any).duckGain;
      expect(duckGain).toBeDefined();

      music.duck(0.3, 0.5);
      expect(duckGain.gain.cancelScheduledValues).toHaveBeenCalled();
      expect(duckGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.3, expect.any(Number));
      expect(duckGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1.0, expect.any(Number));
    });

    it('pausing ducks volume and lowers filter, resuming restores both', () => {
      setCachedAudioBuffer(BROADCAST_MUSIC_PATHS.exploration, explorationBuf);
      music.startMusic();

      const duckGain = (music as any).duckGain;
      const moodFilter = (music as any).moodFilter;

      music.setPaused(true);
      expect(duckGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number)
      );

      music.setPaused(false);
      expect(duckGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1.0, expect.any(Number));
    });

    it('stopMusic() stops all active sources, crossfade timers, and disconnects nodes without leaks', () => {
      setCachedAudioBuffer(BROADCAST_MUSIC_PATHS.exploration, explorationBuf);
      music.startMusic();

      const src = mockCtx.createdSources[0]!;
      expect(src.started).toBe(true);

      music.stopMusic();
      expect(music.isPlaying).toBe(false);
      expect(music.isBroadcastActive).toBe(false);
      expect(src.stopped).toBe(true);
      expect(src.disconnected).toBe(true);
    });
  });
});


