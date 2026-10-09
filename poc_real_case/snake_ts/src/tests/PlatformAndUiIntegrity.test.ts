import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom, MockElement } from './MockDom';
import { App, OuroborosApp } from '../main.js';
import * as SynthModule from '../audio/Synth.js';
import { UiRoot } from '../ui/UiRoot';
import { HudView } from '../ui/HudView';
import { ResponsiveLayout, ILayoutMetrics } from '../ui/ResponsiveLayout';
import { InputManager } from '../input/InputManager';
import { TouchControls } from '../input/TouchControls';
import { VirtualStick } from '../input/VirtualStick';
import { SettingsScreen } from '../ui/screens/SettingsScreen';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { SoundEngine } from '../audio/SoundEngine';
import { MusicPlayer } from '../audio/MusicPlayer';
import {
  bakeSoundToBuffer,
  VoiceSpec,
  DEFAULT_SAMPLE_RATE,
  makeDistortionCurve,
  softClip,
  gainToDb,
  dbToGain
} from '../audio/Synth';
import {
  SaveIO,
  computeCrc32,
  createDefaultMetaSave,
  STORAGE_KEY_V1,
  STORAGE_KEY_V2,
  LegacyMetaSaveV1,
  MetaSaveV2
} from '../platform/SaveIO';
import { MetaProgression } from '../data/MetaProgression';
import { SnakePlayer } from '../sim/SnakePlayer';
import { GameState } from '../sim/GameState';
import { Services } from '../core/Services';
import { NullFx, NullSound, ISound } from '../core/Contracts';

describe('Platform, UI, Audio & Input Integrity Conformance', () => {
  let restoreDom: () => void;
  let container: MockElement;
  let mockEngine: any;

  beforeEach(() => {
    restoreDom = setupMockDom();
    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();
    MetaProgression.Instance.reset();

    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
    Services.Input = InputManager.instance;
    InputManager.instance.reset();

    container = document.createElement('div') as any;
    container.id = 'ui-root';
    document.body.appendChild(container as any);

    mockEngine = {
      player: new SnakePlayer('emerald', 800, 600, 5),
      combat: {
        score: 2500,
        comboCount: 6,
        comboMultiplier: 3,
        comboTimer: 3.2,
        comboMaxTime: 4.0,
        frenzyActive: false,
        shardsEarned: 25
      },
      currentFloor: 2,
      floorFoodProgress: 8,
      foodTarget: 20,
      fps: 60,
      state: GameState.Playing,
      runInProgress: true,
      meta: { shards: 350 },
      toggleLab: () => {},
      togglePause: () => {},
      completeLevelUp: () => {},
      resume: () => {}
    };
  });

  afterEach(() => {
    restoreDom();
  });

  // ==========================================================================
  // 1. Right-handed vs Left-handed Layout & Dynamic Settings Toggle
  // ==========================================================================
  describe('1. Joystick & Touch Action Layout Handedness Contracts', () => {
    it('switches handedness dynamically via SettingsScreen and propagates to InputManager and HudView', () => {
      const root = UiRoot.init(container as any, mockEngine);
      const settingsScreen = new SettingsScreen(root);
      root.registerScreen(settingsScreen);
      root.showScreen('modal-settings');

      const joystickSelect = settingsScreen.element.querySelector('.joystick-pos-select') as HTMLSelectElement;
      expect(joystickSelect).not.toBeNull();

      // Default: Right-Handed (lefty = false)
      expect(InputManager.instance.isLefty).toBe(false);
      expect(settingsScreen.settings.lefty).toBe(false);

      const phoneMetrics = ResponsiveLayout.instance.computeMetrics(390, 844);
      root.hudView.applyMetrics(phoneMetrics);
      const touchLayer = root.hudView.element.querySelector('.touch-controls-layer');
      expect(touchLayer?.classList.contains('lefty-mode')).toBe(false);

      // Toggle to Left-Handed
      joystickSelect.value = 'left';
      joystickSelect.dispatchEvent({ type: 'change' } as any);

      expect(settingsScreen.settings.lefty).toBe(true);
      expect(settingsScreen.settings.joystickPosition).toBe('left');
      expect(InputManager.instance.isLefty).toBe(true);
      expect(touchLayer?.classList.contains('lefty-mode')).toBe(true);

      // Settings serialization check
      const rawStored = localStorage.getItem('ouroboros_settings_v2');
      expect(rawStored).not.toBeNull();
      const parsedStored = JSON.parse(rawStored!);
      expect(parsedStored.lefty).toBe(true);
      expect(parsedStored.joystickPosition).toBe('left');

      // Toggle back to Right-Handed
      joystickSelect.value = 'right';
      joystickSelect.dispatchEvent({ type: 'change' } as any);

      expect(settingsScreen.settings.lefty).toBe(false);
      expect(settingsScreen.settings.joystickPosition).toBe('right');
      expect(InputManager.instance.isLefty).toBe(false);
      expect(touchLayer?.classList.contains('lefty-mode')).toBe(false);
    });

    it('correctly computes symmetrical bottom-center action button layout in smartphone portrait mode', () => {
      const tc = new TouchControls();
      const width = 390;
      const height = 844;
      const safeInsets = { left: 0, top: 47, right: 0, bottom: 34 };

      // Right-Handed Mode (Default): Skill on Left, Dash on Right
      tc.isLefty = false;
      tc.updateLayout(width, height, safeInsets);

      const centerX = width * 0.5; // 195
      const skillCenter = tc.skillRect.x + tc.skillRect.width * 0.5;
      const dashCenter = tc.dashRect.x + tc.dashRect.width * 0.5;

      expect(skillCenter).toBeLessThan(centerX);
      expect(dashCenter).toBeGreaterThan(centerX);
      expect(centerX - skillCenter).toBeCloseTo(dashCenter - centerX, 2);
      expect(tc.dashRect.y + tc.dashRect.height).toBeLessThanOrEqual(height - safeInsets.bottom);

      // Left-Handed Mode: Dash on Left, Skill on Right
      tc.isLefty = true;
      tc.updateLayout(width, height, safeInsets);

      const leftyDashCenter = tc.dashRect.x + tc.dashRect.width * 0.5;
      const leftySkillCenter = tc.skillRect.x + tc.skillRect.width * 0.5;

      expect(leftyDashCenter).toBeLessThan(centerX);
      expect(leftySkillCenter).toBeGreaterThan(centerX);
      expect(centerX - leftyDashCenter).toBeCloseTo(leftySkillCenter - centerX, 2);
      expect(tc.skillRect.y + tc.skillRect.height).toBeLessThanOrEqual(height - safeInsets.bottom);
    });

    it('correctly computes corner docked layout in tablet / desktop landscape mode', () => {
      const tc = new TouchControls();
      const width = 1280;
      const height = 720;

      // Right-Handed Mode: Action buttons docked on Bottom-Left, Pause at Top-Right
      tc.isLefty = false;
      tc.updateLayout(width, height);

      expect(tc.skillRect.x).toBeLessThan(tc.dashRect.x);
      expect(tc.dashRect.x).toBeLessThan(400);
      expect(tc.pauseRect.x).toBeGreaterThan(width - 100);

      // Left-Handed Mode: Action buttons docked on Bottom-Right, Pause at Top-Left
      tc.isLefty = true;
      tc.updateLayout(width, height);

      expect(tc.skillRect.x).toBeGreaterThan(800);
      expect(tc.dashRect.x).toBeGreaterThan(tc.skillRect.x);
      expect(tc.pauseRect.x).toBeLessThan(100);
    });

    it('handles multi-touch simultaneously on Dash and Skill buttons', () => {
      const input = InputManager.instance;
      const tc = new TouchControls(input);
      tc.updateLayout(390, 844);

      const dashCx = tc.dashRect.x + tc.dashRect.width / 2;
      const dashCy = tc.dashRect.y + tc.dashRect.height / 2;
      const skillCx = tc.skillRect.x + tc.skillRect.width / 2;
      const skillCy = tc.skillRect.y + tc.skillRect.height / 2;

      // Touch 1 starts on Dash
      const t1Handled = tc.onTouchStart(1, dashCx, dashCy);
      expect(t1Handled).toBe(true);
      expect(tc.dashActive).toBe(true);
      expect(input.dashHeld).toBe(true);

      // Touch 2 starts on Skill
      const t2Handled = tc.onTouchStart(2, skillCx, skillCy);
      expect(t2Handled).toBe(true);
      expect(tc.skillActive).toBe(true);
      expect(input.skillHeld).toBe(true);

      // Release Dash only
      tc.onTouchEnd(1);
      expect(tc.dashActive).toBe(false);
      expect(input.dashHeld).toBe(false);
      expect(tc.skillActive).toBe(true);
      expect(input.skillHeld).toBe(true);

      // Release Skill
      tc.onTouchEnd(2);
      expect(tc.skillActive).toBe(false);
      expect(input.skillHeld).toBe(false);
    });
  });

  // ==========================================================================
  // 2. Touch Hitboxes, Slop Tolerance & Event Shielding
  // ==========================================================================
  describe('2. Touch Hitboxes, Slop Tolerance & Event Shielding Contracts', () => {
    it('honors generous +10px touch-slop tolerance for mobile button hit testing', () => {
      const tc = new TouchControls();
      tc.updateLayout(390, 844);

      const cx = tc.dashRect.x + tc.dashRect.width / 2;
      const cy = tc.dashRect.y + tc.dashRect.height / 2;
      const r = tc.dashRect.radius;

      // Point exactly on the boundary: radius + 5px (inside slop tolerance)
      const handledInsideSlop = tc.onTouchStart(10, cx + r + 5, cy);
      expect(handledInsideSlop).toBe(true);
      tc.onTouchEnd(10);

      // Point outside the boundary: radius + 15px (outside slop tolerance)
      const handledOutsideSlop = tc.onTouchStart(11, cx + r + 15, cy);
      expect(handledOutsideSlop).toBe(false);
    });

    it('shields HUD Lab and Pause buttons from triggering background joystick steering', () => {
      const root = UiRoot.init(container as any, mockEngine);
      const hud = root.hudView;
      const metrics = ResponsiveLayout.instance.computeMetrics(390, 844);
      hud.applyMetrics(metrics);

      let labCalled = false;
      let pauseCalled = false;
      mockEngine.toggleLab = () => { labCalled = true; };
      mockEngine.togglePause = () => { pauseCalled = true; };

      const labBtn = hud.element.querySelector('.btn-lab') as HTMLButtonElement;
      const pauseBtn = hud.element.querySelector('.btn-pause') as HTMLButtonElement;

      expect(labBtn).not.toBeNull();
      expect(pauseBtn).not.toBeNull();

      // Click Lab button
      let stopPropagationCalled = false;
      labBtn.dispatchEvent({
        type: 'click',
        stopPropagation: () => { stopPropagationCalled = true; }
      } as any);

      expect(labCalled).toBe(true);
      expect(stopPropagationCalled).toBe(true);
      expect(InputManager.instance.hasDirection).toBe(false);

      // Click Pause button
      stopPropagationCalled = false;
      pauseBtn.dispatchEvent({
        type: 'click',
        stopPropagation: () => { stopPropagationCalled = true; }
      } as any);

      expect(pauseCalled).toBe(true);
      expect(stopPropagationCalled).toBe(true);
      expect(InputManager.instance.hasDirection).toBe(false);
    });

    it('validates SnakeLabScreen tab navigation and state deployment transitions', () => {
      const root = UiRoot.init(container as any, mockEngine);
      const labScreen = new SnakeLabScreen(root);
      root.registerScreen(labScreen);
      root.showScreen('modal-snake-lab');

      expect(labScreen.activeTab).toBe('lab');

      // Tab switch to Helmet Vault
      const helmetsTabBtn = labScreen.element.querySelector('.btn-tab-helmets') as HTMLButtonElement;
      helmetsTabBtn.click();
      expect(labScreen.activeTab).toBe('helmets');
      expect(helmetsTabBtn.className).toContain('btn-primary');

      // Tab switch back to Cranial Lab
      const labTabBtn = labScreen.element.querySelector('.btn-tab-lab') as HTMLButtonElement;
      labTabBtn.click();
      expect(labScreen.activeTab).toBe('lab');
      expect(labTabBtn.className).toContain('btn-primary');

      // Deploy button during Playing state triggers resume()
      let resumeTriggered = false;
      mockEngine.state = GameState.Playing;
      mockEngine.resume = () => { resumeTriggered = true; };
      const deployBtn = labScreen.element.querySelector('.btn-deploy-serpent') as HTMLButtonElement;
      deployBtn.click();
      expect(resumeTriggered).toBe(true);

      // Deploy button during LevelUp state triggers completeLevelUp()
      let levelUpTriggered = false;
      mockEngine.state = GameState.LevelUp;
      mockEngine.completeLevelUp = () => { levelUpTriggered = true; };
      root.showScreen('modal-snake-lab');
      deployBtn.click();
      expect(levelUpTriggered).toBe(true);
    });
  });

  // ==========================================================================
  // 3. Audio Synthesizer, Procedural SFX Dispatch & Polyphony
  // ==========================================================================
  describe('3. Audio Procedural Synthesizer & Polyphony Stress Contracts', () => {
    let sound: SoundEngine;

    beforeEach(() => {
      sound = new SoundEngine();
      sound.init();
    });

    it('dispatches all 31 SFX recipes in headless mode without crashing or throwing', () => {
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

    it('survives rapid-fire concurrent burst SFX dispatches (stress test)', () => {
      expect(() => {
        for (let i = 0; i < 150; i++) {
          sound.playUiClick();
          sound.playHit(i % 3);
          sound.playShoot(200 + i * 5);
          sound.playExplosion(0.5);
        }
      }).not.toThrow();
    });

    it('enforces volume boundaries and mute state propagation', () => {
      sound.setSfxVolume(1.5); // should clamp to 1.0
      expect(sound.sfxVolume).toBe(1.0);

      sound.setSfxVolume(-0.5); // should clamp to 0.0
      expect(sound.sfxVolume).toBe(0.0);

      sound.setMusicVolume(0.85);
      expect(sound.musicVolume).toBe(0.85);

      sound.setMute(true);
      expect(sound.isMuted).toBe(true);

      sound.setMute(false);
      expect(sound.isMuted).toBe(false);
    });

    it('bakes polyphonic multi-voice chords and noise into valid non-NaN PCM buffers', () => {
      const polyphonicVoices: VoiceSpec[] = [
        { type: 'sawtooth', freq: 220, when: 0, dur: 0.15, peak: 0.4 }, // A3
        { type: 'sawtooth', freq: 277.18, when: 0, dur: 0.15, peak: 0.3 }, // C#4
        { type: 'sawtooth', freq: 329.63, when: 0, dur: 0.15, peak: 0.3 }, // E4
        { type: 'sine', freq: 110, when: 0, dur: 0.2, peak: 0.5 }, // A2 Sub
        { isNoise: true, when: 0.05, dur: 0.1, peak: 0.25, filter: 'bandpass', cutoff: 1800, distortion: 0.3 }
      ];

      const pcm = bakeSoundToBuffer(polyphonicVoices, DEFAULT_SAMPLE_RATE);
      expect(pcm.length).toBeGreaterThan(Math.round(0.2 * DEFAULT_SAMPLE_RATE));

      let maxAmp = 0;
      let hasSignal = false;
      for (let i = 0; i < pcm.length; i++) {
        const val = pcm[i]!;
        expect(Number.isFinite(val)).toBe(true);
        expect(Number.isNaN(val)).toBe(false);
        const abs = Math.abs(val);
        if (abs > maxAmp) maxAmp = abs;
        if (abs > 0.01) hasSignal = true;
      }

      expect(hasSignal).toBe(true);
      expect(maxAmp).toBeGreaterThan(0.05);
    });

    it('computes soft clipping and waveshaper distortion curves reliably', () => {
      const curve = makeDistortionCurve(25, 1024);
      expect(curve.length).toBe(1024);
      expect(curve[0]).toBeLessThan(0);
      expect(curve[512]).toBeCloseTo(0, 1);
      expect(curve[1023]).toBeGreaterThan(0);

      expect(softClip(0)).toBe(0);
      expect(softClip(5, 1)).toBeCloseTo(1.0, 2);
      expect(softClip(-5, 1)).toBeCloseTo(-1.0, 2);
    });
  });

  // ==========================================================================
  // 4. MetaProgression Save/Load Serialization & CRC32 Verification
  // ==========================================================================
  describe('4. MetaProgression Save/Load Serialization & CRC32 Contracts', () => {
    it('computes deterministic CRC32 checksums', () => {
      expect(computeCrc32('123456789')).toBe('cbf43926');
      expect(computeCrc32('Ouroboros Ascension')).toBe(computeCrc32('Ouroboros Ascension'));
      expect(computeCrc32('payload_a')).not.toBe(computeCrc32('payload_b'));
    });

    it('detects corrupted or tampered save payloads during JSON and Base64 import', () => {
      const cleanSave = createDefaultMetaSave();
      cleanSave.shards = 7500;
      cleanSave.records.highScore = 150000;
      cleanSave.unlockedClasses['solar'] = true;
      SaveIO.saveMeta(cleanSave);

      const exportedJson = SaveIO.exportSaveJson();
      const parsedEnvelope = JSON.parse(exportedJson);

      // Tamper: Modify shards without updating checksum
      parsedEnvelope.data.shards = 999999;
      const tamperedJson = JSON.stringify(parsedEnvelope);

      const importResult = SaveIO.importSaveJson(tamperedJson);
      expect(importResult.success).toBe(false);
      expect(importResult.error).toContain('Checksum mismatch');

      // Valid export / import round-trip
      const validExport = SaveIO.exportSaveBase64();
      SaveIO.clearMemory();

      const validImport = SaveIO.importSaveBase64(validExport);
      expect(validImport.success).toBe(true);
      expect(validImport.data?.shards).toBe(7500);
      expect(validImport.data?.records.highScore).toBe(150000);
      expect(validImport.data?.unlockedClasses['solar']).toBe(true);
    });

    it('migrates legacy Schema v1 save data automatically to Schema v2', () => {
      const legacySave: LegacyMetaSaveV1 = {
        shards: 1200,
        highScore: 78000,
        highestFloor: 5,
        highestCombo: 22,
        totalRuns: 18,
        totalKills: 600,
        totalFoods: 950,
        unlockedClasses: ['emerald', 'hydra', 'leviathan'],
        upgrades: {
          vitality: 3,
          swiftness: 2,
          fortune: { level: 4 }
        }
      };

      SaveIO.writeKey(STORAGE_KEY_V1, JSON.stringify(legacySave));

      const loaded = SaveIO.loadMeta();
      expect(loaded.version).toBe(2);
      expect(loaded.shards).toBe(1200);
      expect(loaded.records.highScore).toBe(78000);
      expect(loaded.records.highestFloor).toBe(5);
      expect(loaded.records.highestCombo).toBe(22);
      expect(loaded.unlockedClasses['emerald']).toBe(true);
      expect(loaded.unlockedClasses['hydra']).toBe(true);
      expect(loaded.unlockedClasses['leviathan']).toBe(true);
      expect(loaded.upgrades['vitality']?.level).toBe(3);
      expect(loaded.upgrades['swiftness']?.level).toBe(2);
      expect(loaded.upgrades['fortune']?.level).toBe(4);
    });

    it('defensively normalizes corrupted, negative, or invalid data types', () => {
      const malformedPayload = {
        version: 2,
        shards: -500, // invalid negative shards
        unlockedClasses: { emerald: true, '': false, '  ': true },
        upgrades: {
          vitality: { level: -2 },
          ferocity: { level: 'invalid' as any }
        },
        records: {
          highScore: -100,
          highestFloor: 0, // floor cannot be 0
          highestCombo: NaN
        },
        helmets: [{ id: 'helm_behemoth', name: 'Behemoth Crest' }],
        equippedHelmetId: 'non_existent_helmet_id' // must be reset to null
      };

      const normalized = SaveIO.validateAndNormalizeV2(malformedPayload);
      expect(normalized.shards).toBe(0);
      expect(normalized.records.highScore).toBe(0);
      expect(normalized.records.highestFloor).toBe(1);
      expect(normalized.records.highestCombo).toBe(0);
      expect(normalized.upgrades['vitality']?.level).toBe(0);
      expect(normalized.equippedHelmetId).toBeNull();
      expect(normalized.helmets?.length).toBe(1);
    });

    it('integrates MetaProgression singleton lifecycle seamlessly with SaveIO backend', () => {
      SaveIO.install();
      const meta = MetaProgression.Instance;
      meta.reset();

      expect(meta.shards).toBe(0);
      meta.addShards(500);
      expect(meta.shards).toBe(500);

      const bought = meta.buyUpgrade('vitality');
      expect(bought).toBe(true);
      expect(meta.level('vitality')).toBe(1);
      expect(meta.shards).toBe(460); // 500 - 40

      // Read from storage memory backend
      const rawStored = SaveIO.readKey(STORAGE_KEY_V2);
      expect(rawStored).not.toBeNull();
      const parsed = JSON.parse(rawStored!);
      expect(parsed.shards).toBe(460);
      expect(parsed.upgrades.vitality.level).toBe(1);

      // Save through SaveIO and verify CRC32
      SaveIO.saveMeta(parsed);
      const reloaded = SaveIO.loadMeta();
      expect(reloaded.shards).toBe(460);
      expect(reloaded.checksum).toBeDefined();
    });
  });

  // ==========================================================================
  // 5. Startup Audio Initialization and Gesture Unlock Contracts
  // ==========================================================================
  describe('5. Startup Audio Initialization and Gesture Unlock Contracts', () => {
    it('initializes sound on App / OuroborosApp construction and sets up window gesture unlock listeners', () => {
      const initSpy = vi.spyOn(SoundEngine.prototype, 'init');
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

      const app = new OuroborosApp();
      expect(initSpy).toHaveBeenCalled();
      expect(app.sound).toBeDefined();
      expect(Services.Sound).toBe(app.sound);

      // Verifies pointerdown and keydown gesture listeners are attached to window
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'pointerdown',
        expect.any(Function),
        expect.objectContaining({ once: true, passive: true })
      );
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function),
        expect.objectContaining({ once: true, passive: true })
      );

      initSpy.mockRestore();
      addEventListenerSpy.mockRestore();
    });

    it('unlocks audio context and invokes sound.init on pointerdown and keydown gesture and detaches listeners', () => {
      const unlockAudioSpy = vi.spyOn(SynthModule, 'unlockAudioContext');
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const app = new OuroborosApp();
      const soundInitSpy = vi.spyOn(app.sound, 'init');

      // Dispatch user interaction gesture (pointerdown)
      window.dispatchEvent(new (globalThis as any).PointerEvent('pointerdown'));

      expect(unlockAudioSpy).toHaveBeenCalled();
      expect(soundInitSpy).toHaveBeenCalled();
      expect(removeEventListenerSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

      // Second gesture should not re-trigger unlock since listeners are detached
      soundInitSpy.mockClear();
      window.dispatchEvent(new (globalThis as any).KeyboardEvent('keydown', { key: 'Space' }));
      expect(soundInitSpy).not.toHaveBeenCalled();

      unlockAudioSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
      soundInitSpy.mockRestore();
    });

    it('ensures sound.init is invoked and active when entering game runs', () => {
      const app = new OuroborosApp();
      const soundInitSpy = vi.spyOn(app.sound, 'init');

      app.startRun('rogue', 'emerald', 42);
      expect(soundInitSpy).toHaveBeenCalled();
      expect(app.engine.runInProgress).toBe(true);

      soundInitSpy.mockRestore();
    });
  });
});

