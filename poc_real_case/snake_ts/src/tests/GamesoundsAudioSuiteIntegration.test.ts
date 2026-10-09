import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  BROADCAST_AUDIO_PATHS,
  BROADCAST_MUSIC_PATHS,
  EAT_POP_VARIATION_PATHS,
  setCachedAudioBuffer,
  getCachedAudioBuffer,
  clearAudioBufferCache,
  bakeSoundToBuffer,
  createEatVoices,
  createHitVoices,
  createShootVoices,
  createBiteVoices,
  createCritVoices,
  createExplosionVoices,
  createDashVoices,
  createShieldVoices,
  createShieldBreakVoices,
  createBossAlertVoices,
  createLevelUpVoices,
  createVictoryVoices,
  createGameOverVoices,
  createUiClickVoices,
  createUiHoverVoices,
  createStarVoices,
} from '../audio/Synth';
import { SoundEngine } from '../audio/SoundEngine';

describe('Gamesounds Audio Suite Integration & Complete Asset Deployment Suite', () => {
  const AUDIO_DIR = path.resolve(__dirname, '../../public/assets/audio');

  const EXPECTED_WAV_FILES = [
    // 01_ui (5)
    'sfx_ui_click.wav',
    'sfx_ui_tab.wav',
    'sfx_level_up.wav',
    'sfx_victory.wav',
    'sfx_game_over.wav',
    // 02_combat (10)
    'sfx_bite.wav',
    'sfx_hit.wav',
    'sfx_laser_pew.wav',
    'sfx_laser_heavy.wav',
    'sfx_crit.wav',
    'sfx_explosion.wav',
    'sfx_shield_on.wav',
    'sfx_shield_break.wav',
    'sfx_boss_alert.wav',
    'sfx_boss_roar.wav',
    // 03_movement_and_pickups (10)
    'sfx_dash.wav',
    'sfx_warp_jump.wav',
    'sfx_eat.wav',
    'sfx_eat_pop.wav',
    'sfx_eat_pop_01.wav',
    'sfx_eat_pop_02.wav',
    'sfx_eat_pop_03.wav',
    'sfx_eat_pop_04.wav',
    'sfx_star_ding.wav',
    'sfx_gem_chime.wav',
    // 05_music (3)
    'music_exploration.wav',
    'music_combat.wav',
    'music_boss.wav',
  ];

  describe('1. Filesystem Asset Deployment & Sidecar Integrity', () => {
    it('verifies all 28 canonical WAV deliverables exist in public/assets/audio with non-zero size', () => {
      expect(EXPECTED_WAV_FILES.length).toBe(28);
      for (const file of EXPECTED_WAV_FILES) {
        const fullPath = path.join(AUDIO_DIR, file);
        expect(fs.existsSync(fullPath), `Missing audio asset: ${file}`).toBe(true);
        const stats = fs.statSync(fullPath);
        expect(stats.size, `File is empty: ${file}`).toBeGreaterThan(100);
      }
    });

    it('verifies all 28 corresponding .audio.meta.json metadata sidecars exist and contain valid JSON', () => {
      for (const file of EXPECTED_WAV_FILES) {
        const metaPath = path.join(AUDIO_DIR, `${file}.audio.meta.json`);
        expect(fs.existsSync(metaPath), `Missing metadata sidecar: ${metaPath}`).toBe(true);
        const raw = fs.readFileSync(metaPath, 'utf8');
        const parsed = JSON.parse(raw);
        expect(parsed).toBeDefined();
        expect(parsed.id || parsed.file || parsed.asset_id).toBeDefined();
      }
    });
  });

  describe('2. Engine Dictionary Registration & Path Verification', () => {
    it('verifies BROADCAST_AUDIO_PATHS contains all 28 audio keys', () => {
      expect(BROADCAST_AUDIO_PATHS).toBeDefined();
      const keys = Object.keys(BROADCAST_AUDIO_PATHS);
      expect(keys.length).toBeGreaterThanOrEqual(28);

      // Verify all multi-take eat pops exist
      expect((BROADCAST_AUDIO_PATHS as any).eatPop01).toBe('assets/audio/sfx_eat_pop_01.wav');
      expect((BROADCAST_AUDIO_PATHS as any).eatPop02).toBe('assets/audio/sfx_eat_pop_02.wav');
      expect((BROADCAST_AUDIO_PATHS as any).eatPop03).toBe('assets/audio/sfx_eat_pop_03.wav');
      expect((BROADCAST_AUDIO_PATHS as any).eatPop04).toBe('assets/audio/sfx_eat_pop_04.wav');

      // Verify boss alert vs roar
      expect(BROADCAST_AUDIO_PATHS.bossAlert).toBe('assets/audio/sfx_boss_alert.wav');
      expect(BROADCAST_AUDIO_PATHS.bossRoar).toBe('assets/audio/sfx_boss_roar.wav');

      // Verify UI assets
      expect(BROADCAST_AUDIO_PATHS.uiClick).toBe('assets/audio/sfx_ui_click.wav');
      expect(BROADCAST_AUDIO_PATHS.uiTab).toBe('assets/audio/sfx_ui_tab.wav');
      expect(BROADCAST_AUDIO_PATHS.levelUp).toBe('assets/audio/sfx_level_up.wav');
      expect(BROADCAST_AUDIO_PATHS.victory).toBe('assets/audio/sfx_victory.wav');
      expect(BROADCAST_AUDIO_PATHS.gameOver).toBe('assets/audio/sfx_game_over.wav');

      // Verify combat
      expect(BROADCAST_AUDIO_PATHS.bite).toBe('assets/audio/sfx_bite.wav');
      expect(BROADCAST_AUDIO_PATHS.hit).toBe('assets/audio/sfx_hit.wav');
      expect(BROADCAST_AUDIO_PATHS.laserPew).toBe('assets/audio/sfx_laser_pew.wav');
      expect(BROADCAST_AUDIO_PATHS.laserHeavy).toBe('assets/audio/sfx_laser_heavy.wav');
      expect(BROADCAST_AUDIO_PATHS.crit).toBe('assets/audio/sfx_crit.wav');
      expect(BROADCAST_AUDIO_PATHS.explosion).toBe('assets/audio/sfx_explosion.wav');
      expect(BROADCAST_AUDIO_PATHS.shieldOn).toBe('assets/audio/sfx_shield_on.wav');
      expect(BROADCAST_AUDIO_PATHS.shieldBreak).toBe('assets/audio/sfx_shield_break.wav');

      // Verify movement & pickups
      expect(BROADCAST_AUDIO_PATHS.dash).toBe('assets/audio/sfx_dash.wav');
      expect(BROADCAST_AUDIO_PATHS.warpJump).toBe('assets/audio/sfx_warp_jump.wav');
      expect(BROADCAST_AUDIO_PATHS.eat).toBe('assets/audio/sfx_eat.wav');
      expect((BROADCAST_AUDIO_PATHS as any).eatPop).toBe('assets/audio/sfx_eat_pop.wav');
      expect(BROADCAST_AUDIO_PATHS.starDing).toBe('assets/audio/sfx_star_ding.wav');
      expect(BROADCAST_AUDIO_PATHS.gemChime).toBe('assets/audio/sfx_gem_chime.wav');

      // Verify music tracks
      expect((BROADCAST_AUDIO_PATHS as any).musicExploration).toBe('assets/audio/music_exploration.wav');
      expect((BROADCAST_AUDIO_PATHS as any).musicCombat).toBe('assets/audio/music_combat.wav');
      expect((BROADCAST_AUDIO_PATHS as any).musicBoss).toBe('assets/audio/music_boss.wav');
    });

    it('exports EAT_POP_VARIATION_PATHS array with all 4 multi-take eat pops', () => {
      expect(EAT_POP_VARIATION_PATHS).toBeDefined();
      expect(EAT_POP_VARIATION_PATHS.length).toBe(4);
      expect(EAT_POP_VARIATION_PATHS[0]).toBe('assets/audio/sfx_eat_pop_01.wav');
      expect(EAT_POP_VARIATION_PATHS[1]).toBe('assets/audio/sfx_eat_pop_02.wav');
      expect(EAT_POP_VARIATION_PATHS[2]).toBe('assets/audio/sfx_eat_pop_03.wav');
      expect(EAT_POP_VARIATION_PATHS[3]).toBe('assets/audio/sfx_eat_pop_04.wav');
    });

    it('verifies BROADCAST_MUSIC_PATHS contains 3 seamless tracks', () => {
      expect(BROADCAST_MUSIC_PATHS.exploration).toBe('assets/audio/music_exploration.wav');
      expect(BROADCAST_MUSIC_PATHS.combat).toBe('assets/audio/music_combat.wav');
      expect(BROADCAST_MUSIC_PATHS.boss).toBe('assets/audio/music_boss.wav');
    });
  });

  describe('3. SoundEngine Dispatcher Routing', () => {
    let sound: SoundEngine;
    let mockSources: any[] = [];

    beforeEach(() => {
      clearAudioBufferCache();
      sound = new SoundEngine();
      mockSources = [];

      const mockCtx: any = {
        currentTime: 0,
        sampleRate: 44100,
        state: 'running',
        destination: {},
        createGain: () => ({
          gain: { value: 1.0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() },
          connect: vi.fn(),
          disconnect: vi.fn(),
        }),
        createDynamicsCompressor: () => ({
          threshold: { value: -10 },
          knee: { value: 12 },
          ratio: { value: 6 },
          attack: { value: 0.002 },
          release: { value: 0.12 },
          connect: vi.fn(),
          disconnect: vi.fn(),
        }),
        createBufferSource: () => {
          const src = {
            buffer: null as any,
            playbackRate: { value: 1.0, setValueAtTime: vi.fn() },
            connect: vi.fn(),
            disconnect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            onended: null as any,
          };
          mockSources.push(src);
          return src;
        },
      };

      (sound as any)._ctx = mockCtx;
      (sound as any)._masterGain = mockCtx.createGain();
      (sound as any)._sfxGain = mockCtx.createGain();
      (sound as any)._musicGain = mockCtx.createGain();
    });

    it('PlayBossAlert dispatches BROADCAST_AUDIO_PATHS.bossRoar', () => {
      const roarBuf: any = { id: 'sfx_boss_roar_buffer', duration: 0.58 };
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.bossRoar, roarBuf);

      sound.PlayBossAlert(1);
      expect(mockSources.length).toBe(1);
      expect(mockSources[0].buffer).toBe(roarBuf);
    });

    it('playBossRoar dispatches BROADCAST_AUDIO_PATHS.bossRoar', () => {
      const roarBuf: any = { id: 'sfx_boss_roar_buffer', duration: 0.58 };
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.bossRoar, roarBuf);

      sound.playBossRoar(1);
      expect(mockSources.length).toBe(1);
      expect(mockSources[0].buffer).toBe(roarBuf);
    });

    it('SoundEngine provides getEatPopVariationPath cycling through all 4 variations', () => {
      expect(typeof (sound as any).getEatPopVariationPath).toBe('function');
      expect((sound as any).getEatPopVariationPath(0)).toBe('assets/audio/sfx_eat_pop_01.wav');
      expect((sound as any).getEatPopVariationPath(1)).toBe('assets/audio/sfx_eat_pop_02.wav');
      expect((sound as any).getEatPopVariationPath(2)).toBe('assets/audio/sfx_eat_pop_03.wav');
      expect((sound as any).getEatPopVariationPath(3)).toBe('assets/audio/sfx_eat_pop_04.wav');
      expect((sound as any).getEatPopVariationPath(4)).toBe('assets/audio/sfx_eat_pop_01.wav');
    });
  });

  describe('4. Headless DSP Offline Synthesis Validation', () => {
    it('verifies offline bake generates valid finite float arrays with zero NaN/Inf for key recipes', () => {
      const recipes = [
        createEatVoices(1, false),
        createHitVoices(1.0),
        createShootVoices(),
        createBiteVoices(20, false),
        createCritVoices(),
        createExplosionVoices(),
        createDashVoices(),
        createShieldVoices(),
        createShieldBreakVoices(),
        createBossAlertVoices(1),
        createLevelUpVoices(),
        createVictoryVoices(),
        createGameOverVoices(),
        createUiClickVoices(),
        createUiHoverVoices(),
        createStarVoices(),
      ];

      for (const recipe of recipes) {
        const buf = bakeSoundToBuffer(recipe, 44100);
        expect(buf).toBeInstanceOf(Float32Array);
        expect(buf.length).toBeGreaterThan(0);
        for (let i = 0; i < buf.length; i++) {
          expect(Number.isFinite(buf[i])).toBe(true);
          expect(Number.isNaN(buf[i])).toBe(false);
          expect(Math.abs(buf[i]!)).toBeLessThanOrEqual(1.05);
        }
      }
    });
  });
});
