/**
 * Ouroboros Ascension — Streamlined HUD Header & Key Action Hotkeys Test Suite
 * (StreamlineHudHeader.test.ts)
 *
 * Verifies:
 * 1. Cleaned up top-right HUD header actions (.hud-top-actions):
 *    - REMOVED: .btn-codex ([H]) and .btn-stats ([T]) icon buttons from the DOM.
 *    - KEPT: Exclusively two primary HUD buttons:
 *      1. 🧬 [L] (.btn-lab): Opens Cranial Mutation Lab Hub (modal-snake-lab).
 *      2. ⏸️ [P] (.btn-pause): Opens Pause Menu Overlay (modal-pause).
 * 2. Keyboard hotkey handling in handleKeyDown:
 *    - KeyL: opens modal-snake-lab on 'lab' tab.
 *    - KeyT: opens modal-snake-lab on 'telemetry' / 'stats' tab.
 *    - KeyP / Escape: toggles Pause menu (engine.togglePause() or modal-pause).
 *    - KeyH: opens Codex guide (engine.showHelp() or modal-help).
 * 3. Safe guards:
 *    - Does not trigger when HUD is hidden or typing into input fields.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom } from './MockDom.js';
import { HudView } from '../ui/HudView.js';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen.js';
import { HelpScreen } from '../ui/screens/HelpScreen.js';
import { PauseSettingsScreen } from '../ui/screens/PauseSettingsScreen.js';
import { RootLayout } from '../ui/RootLayout.js';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound } from '../core/Contracts.js';
import { GameState } from '../sim/GameState.js';

class SpySound extends NullSound {
  public uiCount = 0;
  public override playUi(): void {
    this.uiCount++;
  }
}

describe('Streamlined HUD Header & Action Hotkeys Suite', () => {
  let restoreDom: () => void;
  let soundSpy: SpySound;
  let player: SnakePlayer;
  let mockEngine: any;
  let root: RootLayout;
  let hudView: HudView;
  let labScreen: SnakeLabScreen;
  let helpScreen: HelpScreen;
  let pauseScreen: PauseSettingsScreen;

  beforeEach(() => {
    restoreDom = setupMockDom();
    soundSpy = new SpySound();
    Services.Sound = soundSpy;
    Services.Fx = new NullFx();

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
    MetaProgression.Instance.reset();

    player = new SnakePlayer('emerald', 1280, 720, 3);
    player.ouro = 250;
    player.xp = 250;
    player.headHp = 100;
    player.headMaxHp = 100;

    mockEngine = {
      player,
      Player: player,
      state: GameState.Playing,
      State: GameState.Playing,
      currentFloor: 1,
      CurrentFloor: 1,
      combat: {
        score: 1000,
        Score: 1000,
        kills: 5,
        Kills: 5,
        comboCount: 1,
        ComboCount: 1,
        shardsEarned: 10,
        ShardsEarned: 10,
      },
      togglePause: vi.fn(),
      TogglePause: vi.fn(),
      showHelp: vi.fn(),
      ShowHelp: vi.fn(),
      toggleLab: vi.fn(),
      ToggleLab: vi.fn(),
      resume: vi.fn(),
      Resume: vi.fn(),
    };

    const container = document.createElement('div');
    root = new RootLayout(container as any, mockEngine);
    hudView = root.hudView;
    labScreen = new SnakeLabScreen(root);
    helpScreen = new HelpScreen(root);
    pauseScreen = new PauseSettingsScreen(root);

    root.registerScreen(labScreen);
    root.registerScreen(helpScreen);
    root.registerScreen(pauseScreen);
  });

  afterEach(() => {
    restoreDom();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. DOM Template Streamlining
  // =========================================================================
  describe('1. Top-Right HUD Header DOM Clean Up', () => {
    it('contains ONLY .btn-lab and .btn-pause inside .hud-top-actions and removes .btn-codex & .btn-stats', () => {
      const topActions = hudView.element.querySelector('.hud-top-actions');
      expect(topActions).not.toBeNull();

      // btn-codex and btn-stats MUST NOT exist in the DOM
      const codexBtn = hudView.element.querySelector('.btn-codex');
      const statsBtn = hudView.element.querySelector('.btn-stats');
      expect(codexBtn).toBeNull();
      expect(statsBtn).toBeNull();

      // Exactly two action buttons must exist
      const labBtn = hudView.element.querySelector('.btn-lab') as HTMLButtonElement;
      const pauseBtn = hudView.element.querySelector('.btn-pause') as HTMLButtonElement;
      expect(labBtn).not.toBeNull();
      expect(pauseBtn).not.toBeNull();

      const allButtons = topActions?.querySelectorAll('button');
      expect(allButtons?.length).toBe(2);
    });

    it('clicking .btn-lab opens modal-snake-lab on "lab" tab and plays UI sound', () => {
      const showSpy = vi.spyOn(root, 'showScreen');
      const labBtn = hudView.element.querySelector('.btn-lab') as HTMLButtonElement;
      expect(labBtn).not.toBeNull();

      const prevAudio = soundSpy.uiCount;
      labBtn.click();

      expect(showSpy).toHaveBeenCalledWith('modal-snake-lab', { tab: 'lab' });
      expect(soundSpy.uiCount).toBe(prevAudio + 1);
    });

    it('clicking .btn-pause triggers engine.togglePause and plays UI sound', () => {
      const pauseBtn = hudView.element.querySelector('.btn-pause') as HTMLButtonElement;
      expect(pauseBtn).not.toBeNull();

      const prevAudio = soundSpy.uiCount;
      pauseBtn.click();

      expect(mockEngine.togglePause).toHaveBeenCalled();
      expect(soundSpy.uiCount).toBe(prevAudio + 1);
    });
  });

  // =========================================================================
  // 2. Keyboard Hotkey Handling in handleKeyDown
  // =========================================================================
  describe('2. Keyboard Hotkey Handling in handleKeyDown', () => {
    it('dispatches KeyL to open modal-snake-lab on "lab" tab and plays sound', () => {
      const showSpy = vi.spyOn(root, 'showScreen');
      const prevAudio = soundSpy.uiCount;
      const eventL = new KeyboardEvent('keydown', { code: 'KeyL' });

      const handled = hudView.handleKeyDown(eventL);

      expect(handled).toBe(true);
      expect(showSpy).toHaveBeenCalledWith('modal-snake-lab', { tab: 'lab' });
      expect(soundSpy.uiCount).toBe(prevAudio + 1);
    });

    it('dispatches KeyT to open modal-snake-lab on "telemetry" tab and plays sound', () => {
      const showSpy = vi.spyOn(root, 'showScreen');
      const prevAudio = soundSpy.uiCount;
      const eventT = new KeyboardEvent('keydown', { code: 'KeyT' });

      const handled = hudView.handleKeyDown(eventT);

      expect(handled).toBe(true);
      expect(showSpy).toHaveBeenCalledWith('modal-snake-lab', { tab: 'telemetry' });
      expect(soundSpy.uiCount).toBe(prevAudio + 1);
    });

    it('dispatches KeyP to toggle pause menu and plays sound', () => {
      const prevAudio = soundSpy.uiCount;
      const eventP = new KeyboardEvent('keydown', { code: 'KeyP' });

      const handled = hudView.handleKeyDown(eventP);

      expect(handled).toBe(true);
      expect(mockEngine.togglePause).toHaveBeenCalled();
      expect(soundSpy.uiCount).toBe(prevAudio + 1);
    });

    it('dispatches Escape to toggle pause menu and plays sound', () => {
      const prevAudio = soundSpy.uiCount;
      const eventEsc = new KeyboardEvent('keydown', { code: 'Escape' });

      const handled = hudView.handleKeyDown(eventEsc);

      expect(handled).toBe(true);
      expect(mockEngine.togglePause).toHaveBeenCalled();
      expect(soundSpy.uiCount).toBe(prevAudio + 1);
    });

    it('dispatches KeyH to open Codex guide and plays sound', () => {
      const prevAudio = soundSpy.uiCount;
      const eventH = new KeyboardEvent('keydown', { code: 'KeyH' });

      const handled = hudView.handleKeyDown(eventH);

      expect(handled).toBe(true);
      expect(mockEngine.showHelp).toHaveBeenCalled();
      expect(soundSpy.uiCount).toBe(prevAudio + 1);
    });

    it('returns false and does not trigger hotkeys when HUD is hidden', () => {
      hudView.element.style.display = 'none';
      const showSpy = vi.spyOn(root, 'showScreen');

      const eventL = new KeyboardEvent('keydown', { code: 'KeyL' });
      const handled = hudView.handleKeyDown(eventL);

      expect(handled).toBe(false);
      expect(showSpy).not.toHaveBeenCalled();
    });

    it('returns false and does not trigger hotkeys when target is an input field', () => {
      const inputEl = document.createElement('input');
      const showSpy = vi.spyOn(root, 'showScreen');

      const eventL = {
        code: 'KeyL',
        target: inputEl,
      } as unknown as KeyboardEvent;

      const handled = hudView.handleKeyDown(eventL);

      expect(handled).toBe(false);
      expect(showSpy).not.toHaveBeenCalled();
    });
  });
});
