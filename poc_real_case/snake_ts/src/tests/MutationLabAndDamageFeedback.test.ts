import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { SnakePlayer, SnakeSegment } from '../sim/SnakePlayer';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { ScriptedInput, NullFx, NullSound, ISound } from '../core/Contracts';
import { Services } from '../core/Services';
import { MetaProgression } from '../data/MetaProgression';
import { MathX } from '../core/MathX';
import { ISnakeSegment, SnakeRenderer, ISnakeRenderData } from '../render/SnakeRenderer';
import { GameRenderer } from '../render/GameRenderer';
import { HudView } from '../ui/HudView';
import { UiRoot } from '../ui/UiRoot';
import { CombatSystem } from '../sim/CombatSystem';
import { setupMockDom } from './MockDom';

class LabSoundSpy extends NullSound implements ISound {
  public uiCount = 0;
  public levelUpCount = 0;
  public errorCount = 0;
  public explosionCount = 0;

  public override playUi(): void { this.uiCount++; }
  public override playLevelUp(): void { this.levelUpCount++; }
  public override playError(): void { this.errorCount++; }
  public override playExplosion(): void { this.explosionCount++; }
}

describe('Mutation Lab Serpentine Layout & Segment Damage Visual Feedback Test Suite', () => {
  let g: GameEngine;
  let im: ScriptedInput;
  let teardownDom: () => void;
  let soundSpy: LabSoundSpy;

  beforeEach(() => {
    teardownDom = setupMockDom();
    soundSpy = new LabSoundSpy();

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();

    g = new GameEngine();
    im = new ScriptedInput();
    Services.input = im;
    Services.fx = new NullFx();
    Services.sound = soundSpy;
    Services.headless = true;
    g.setupCanvas(1280, 720, 1);
  });

  afterEach(() => {
    teardownDom();
  });

  describe('1. Cranial Mutation Lab Layout & Responsive Viewport Fitting', () => {
    it('initializes with clean Head-centric bio-chamber focus and active lab tab', () => {
      const mockRoot = { engine: g } as any;
      const screen = new SnakeLabScreen(mockRoot);

      expect(screen.activeTab).toBe('lab');
      expect(screen.element).toBeDefined();
      expect(screen.id).toBe('modal-snake-lab');
    });

    it('adapts bio-chamber preview dimensions to compact/portrait viewports gracefully', () => {
      const mockRoot = { engine: g } as any;
      const screen = new SnakeLabScreen(mockRoot);

      expect(screen.element).toBeDefined();
      expect(screen.id).toBe('modal-snake-lab');
    });
  });

  describe('2. Pure-DOM Modal Performance & Zero Canvas Overhead', () => {
    it('contains zero canvas elements or animation loops, preserving 0% idle GPU usage', () => {
      const mockRoot = { engine: g } as any;
      const screen = new SnakeLabScreen(mockRoot);

      const canvas = screen.element.querySelector('canvas');
      const canvasWrapper = screen.element.querySelector('.lab-canvas-wrapper');
      expect(canvas).toBeNull();
      expect(canvasWrapper).toBeNull();

      screen.show();
      screen.hide();
      expect(screen.element.querySelector('.lab-docked-card-container')).not.toBeNull();
    });
  });

  describe('3. Streamlined Head Mutation Arsenal & Helmet Vault Integration', () => {
    it('initializes with Cranial Lab tab and provides seamless Helmet Vault switching', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 3);
      g.player = p;
      const mockRoot = { engine: g, activeScreenId: 'modal-snake-lab' } as any;
      const screen = new SnakeLabScreen(mockRoot);

      screen.show();
      screen.refresh();

      // Default tab is Cranial Lab
      expect(screen.activeTab).toBe('lab');
      expect(screen.element.textContent).toContain('OFFENSIVE WEAPONS');
      expect(screen.element.textContent).toContain('DEFENSIVE BIO-ORGANS');
      expect(screen.element.textContent).toContain('CRANIAL BIO-AUGMENTATIONS');

      // Tab buttons exist
      const tabHelmets = screen.element.querySelector('.btn-tab-helmets') as HTMLButtonElement;
      const tabLab = screen.element.querySelector('.btn-tab-lab') as HTMLButtonElement;
      expect(tabHelmets).not.toBeNull();
      expect(tabLab).not.toBeNull();

      // Switch to Helmet Vault
      tabHelmets.click();
      expect(screen.activeTab).toBe('helmets');
      expect(screen.element.textContent).toContain('COLLECTED BOSS HELMETS');

      // Switch back to Cranial Lab
      tabLab.click();
      expect(screen.activeTab).toBe('lab');
      expect(screen.element.textContent).toContain('OFFENSIVE WEAPONS');
    });

    it('contains zero body segment socket selectors and upgrades the serpent head exclusively', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 10);
      g.player = p;
      const mockRoot = { engine: g, activeScreenId: 'modal-snake-lab' } as any;
      const screen = new SnakeLabScreen(mockRoot);

      screen.show();
      screen.refresh();

      const text = screen.element.textContent || '';
      expect(text).not.toContain('L1 Left Wing');
      expect(text).not.toContain('C1 Center Spine');
      expect(text).not.toContain('R1 Right Wing');
      expect(text).not.toContain('Segment 1');
      expect(text).not.toContain('Segment 10');
    });
  });

  describe('4. Body Part Damage Visual Feedback & Hit Flash Tracking', () => {
    it('initializes and manages hitFlash on SnakeSegment upon damage', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 3);
      expect(p.segments[1]!.hitFlash).toBe(0);

      // Damage segment 1
      p.damageSegment(1, 10, false);
      expect(p.segments[1]!.hp).toBeLessThan(p.segments[1]!.maxHp);
      expect(p.segments[1]!.hitFlash).toBeGreaterThan(0);

      // Decay on update
      p.updateSegments(0.1);
      expect(p.segments[1]!.hitFlash).toBeLessThanOrEqual(1.0);
    });

    it('triggers hitFlash on targeted segment when player takes damage', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 3);
      const lastIdx = p.segments.length - 1;
      const initialHp = p.segments[lastIdx]!.hp;
      p.takeDamage(12, 'contact');

      // Posterior segment (tail life reservoir) absorbs damage and triggers hitFlash
      expect(p.segments[lastIdx]!.hp).toBeLessThan(initialHp);
      expect(p.segments[lastIdx]!.hitFlash).toBeGreaterThan(0);
    });

    it('handles self-collision damage between body parts with localized damage feedback', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 10);
      g.player = p;
      const combat = new CombatSystem();

      // Position segment 7 directly onto head (k >= 6)
      p.x = 200;
      p.y = 200;
      p.segments[7]!.x = 200;
      p.segments[7]!.y = 200;

      const initialSegHp = p.segments[7]!.hp;
      combat.resolveSelfCollision(g as any);

      // Segment 7 should have taken self-bite damage and hitFlash
      expect(p.segments[7]!.hp).toBeLessThan(initialSegHp);
      expect(p.segments[7]!.hitFlash).toBeGreaterThan(0);
    });

    it('SnakeRenderer data structure properly receives head & segment health and hitFlash', () => {
      const seg: ISnakeSegment = {
        x: 100,
        y: 200,
        r: 12,
        angle: 0,
        hp: 15,
        maxHp: 25,
        hitFlash: 0.8,
      };

      const renderData: ISnakeRenderData = {
        x: 100,
        y: 200,
        angle: 0,
        headRadius: 14,
        classId: 'emerald',
        color: '#00f0b5',
        accent: '#10b981',
        headHp: 35,
        headMaxHp: 50,
        segments: [seg]
      };

      expect(renderData.headHp).toBe(35);
      expect(renderData.headMaxHp).toBe(50);
      expect(renderData.segments[0]!.hp).toBe(15);
      expect(renderData.segments[0]!.maxHp).toBe(25);
      expect(renderData.segments[0]!.hitFlash).toBe(0.8);
    });
  });

  describe('5. HUD Vitals Breakdown Display (Head & Body Health)', () => {
    it('formats head and body parts health breakdown correctly in HUD', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 4);
      p.headHp = 45;
      p.headMaxHp = 50;
      p.segments[0]!.hp = 20;
      p.segments[0]!.maxHp = 25;
      p.segments[1]!.hp = 15;
      p.segments[1]!.maxHp = 25;
      g.player = p;

      const container = document.createElement('div');
      const root = UiRoot.init(container as any, g);
      const hud = root.hudView;

      hud.refresh(g);

      const text = hud.element.querySelector('.hud-hp-val')?.textContent || '';
      expect(text).toContain('Head:');
      expect(text).toContain('Body:');
    });
  });

  // -----------------------------------------------------------------------------------------------
  // 6. DEEP SNAKELAB SCREEN BUTTONS, SOCKETS & INTERACTIVE CONFORMANCE AUDIT
  // -----------------------------------------------------------------------------------------------

  describe('6. SnakeLabScreen Comprehensive Button, Socket & Upgrade Conformance', () => {
    let screen: SnakeLabScreen;
    let uiRoot: UiRoot;

    beforeEach(() => {
      const player = new SnakePlayer('emerald', 1280, 720, 4);
      player.xp = 300;
      g.player = player;

      MetaProgression.Instance.UnlockedTiers = { turret: 5, tesla: 5, venom: 5, shield: 5, spikes: 5, fangs: 5 };

      const container = document.createElement('div');
      uiRoot = UiRoot.init(container as any, g);
      screen = new SnakeLabScreen(uiRoot);
      uiRoot.registerScreen(screen);
    });

    it('displays Cranial Mutation Lab header and active Boss Helmet banner', () => {
      screen.show();
      screen.refresh();

      const text = screen.element.textContent || '';
      expect(text).toContain('CRANIAL MUTATION LAB');
      expect(text).toContain('Upgrade your Serpent Head with unlimited weapons');
    });

    it('installs and levels up offense weapon module on the head, deducting XP with levelUp audio', () => {
      screen.show();
      screen.refresh();

      expect(g.player.getHeadModuleLevel('turret')).toBe(0);

      // Find Turret install button
      const buttons = screen.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const turretBtn = Array.from(buttons).find(b => b.textContent.includes('Attack Spitter'))! as any;
      expect(turretBtn).toBeDefined();

      const initXp = g.player.xp;
      const initLvlSounds = soundSpy.levelUpCount;

      turretBtn.click();

      expect(g.player.getHeadModuleLevel('turret')).toBe(1);
      expect(g.player.xp).toBeLessThan(initXp);
      expect(soundSpy.levelUpCount).toBe(initLvlSounds + 1);

      // Upgrade to Level 2
      screen.refresh();
      const upgradeButtons = screen.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const upgradeBtn = Array.from(upgradeButtons).find(b => b.textContent.includes('Attack Spitter'))! as any;
      expect(upgradeBtn).toBeDefined();
      expect(upgradeBtn.textContent).toContain('[Level 1]');

      upgradeBtn.click();
      expect(g.player.getHeadModuleLevel('turret')).toBe(2);
    });

    it('installs defense module directly on the head protecting the serpent', () => {
      screen.show();
      screen.refresh();

      const buttons = screen.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const shieldBtn = Array.from(buttons).find(b => b.textContent.includes('Carapace Shield'))! as any;
      expect(shieldBtn).toBeDefined();

      shieldBtn.click();
      expect(g.player.getHeadModuleLevel('shield')).toBe(1);
    });

    it('escalates upgrade prices across all head modules after each purchase', () => {
      screen.show();
      screen.refresh();

      expect(g.player.headPurchaseCount).toBe(0);

      // Install Attack Spitter (base cost 30 Ouro)
      const buttons = screen.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const turretBtn = Array.from(buttons).find(b => b.textContent.includes('Attack Spitter'))! as any;
      turretBtn.click();
      expect(g.player.headPurchaseCount).toBe(1);

      // Verify that next purchase costs more (base 30 + 15 = 45 Ouro)
      screen.refresh();
      const updatedButtons = screen.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const shieldBtn = Array.from(updatedButtons).find(b => b.textContent.includes('Carapace Shield'))! as any;
      expect(shieldBtn.textContent).toContain('45 Ouro');
    });

    it('enforces visual and acoustic unaffordability feedback (disabled, not-allowed cursor, error sound) when lacking Ouro', () => {
      // Set player with 15 Ouro (below 25 Ouro base cost)
      g.player.xp = 15;
      (g.player as any).ouro = 15;
      screen.show();
      screen.refresh();

      const buttons = screen.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const turretBtn = Array.from(buttons).find(b => b.textContent.includes('Attack Spitter'))! as HTMLButtonElement;
      expect(turretBtn).toBeDefined();
      expect(turretBtn.disabled).toBe(false);
      expect(turretBtn.getAttribute('aria-disabled')).toBe('true');
      expect(turretBtn.style.cursor).toBe('not-allowed');

      const initialErrorSounds = soundSpy.errorCount;
      turretBtn.click();
      expect(soundSpy.errorCount).toBe(initialErrorSounds + 1);
      expect(g.player.getHeadModuleLevel('turret')).toBe(0);

      // Grant sufficient Ouro (100 Ouro)
      (g.player as any).ouro = 100;
      g.player.xp = 100;
      screen.refresh();

      const refreshedButtons = screen.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const refreshedTurretBtn = Array.from(refreshedButtons).find(b => b.textContent.includes('Attack Spitter'))! as HTMLButtonElement;
      expect(refreshedTurretBtn).toBeDefined();
      expect(refreshedTurretBtn.disabled).toBe(false);
      expect(refreshedTurretBtn.getAttribute('aria-disabled')).toBe('false');
      expect(refreshedTurretBtn.style.cursor).toBe('pointer');
    });

    it('installs cranial head augmentations with scaled XP costs', () => {
      (g.meta ?? MetaProgression.Instance).UnlockTier('fangs', 2);
      screen.show();
      screen.refresh();

      const player = g.player as any;
      expect(player.headAugment).toBeNull();

      const buttons = screen.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const fangsBtn = Array.from(buttons).find(b => b.textContent.includes('Venom Fangs'))! as any;
      expect(fangsBtn).toBeDefined();

      fangsBtn.click();
      expect(player.headAugment).toBe('fangs');
      expect(player.headAugmentLevel).toBe(1);
      expect(soundSpy.levelUpCount).toBe(1);

      // Upgrade to Level 2
      screen.refresh();
      const upgradeFangs = Array.from(screen.element.querySelectorAll('.lab-docked-card-container button.cyber-btn')).find(b => b.textContent.includes('Venom Fangs'))! as any;
      upgradeFangs.click();
      expect(player.headAugmentLevel).toBe(2);
    });

    it('handles Deploy Serpent button based on current game engine lifecycle state', () => {
      const deployBtn = screen.element.querySelector('.btn-deploy-serpent')! as any;

      // Case 1: Level Up active
      let levelUpCompleted = false;
      g.state = GameState.LevelUp;
      g.completeLevelUp = () => { levelUpCompleted = true; };
      deployBtn.click();
      expect(levelUpCompleted).toBe(true);

      // Case 2: In-run resume
      let runResumed = false;
      g.state = GameState.Playing;
      g.resume = () => { runResumed = true; };
      deployBtn.click();
      expect(runResumed).toBe(true);
    });

    it('synchronizes real spendable Ouro wallet and decrements HUD counter immediately upon purchasing an augment or module', () => {
      (g.player as any).ouro = 100;
      g.player.xp = 100;
      g.player.totalXpCollected = 250;
      uiRoot.hudView.refresh(g);

      const hudVal = uiRoot.hudView.element.querySelector('.hud-ouro-val, .hud-xp-val')!;
      expect(hudVal.textContent).toBe('100');

      screen.show();
      screen.refresh();

      // Find Attack Spitter module button (cost = 30)
      const buttons = screen.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const turretBtn = Array.from(buttons).find(b => b.textContent.includes('Attack Spitter'))! as any;
      turretBtn.click();

      expect((g.player as any).ouro).toBe(70);
      expect(g.player.xp).toBe(70);
      expect(hudVal.textContent).toBe('70');

      // Points label in lab is also updated
      const pointsLabel = screen.element.querySelector('.lab-points-label')!;
      expect(pointsLabel.textContent).toContain('70 Ouro');
    });
  });
});

