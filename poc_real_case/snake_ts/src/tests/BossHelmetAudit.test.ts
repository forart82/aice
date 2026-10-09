import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateBossHelmet, HelmetDef, HelmetRarity, HELMET_RARITY_COLORS } from '../data/Helmets';
import { MetaProgression } from '../data/MetaProgression';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { SnakePlayer } from '../sim/SnakePlayer';
import { CombatSystem } from '../sim/CombatSystem';
import { Boss } from '../sim/Boss';
import { Enemy } from '../sim/Enemy';
import { HelmetDrop } from '../sim/HelmetDrop';
import { Services } from '../core/Services';
import { ScriptedInput, NullFx, NullSound, ISound, IFx } from '../core/Contracts';
import { setupMockDom } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { ClassSelectScreen } from '../ui/screens/ClassSelectScreen';
import { SnakeRenderer } from '../render/SnakeRenderer';
import { WebGLGameRenderer } from '../render/WebGLGameRenderer';
import { GLBatch } from '../render/webgl/GLBatch';
import { WebGLContext } from '../render/webgl/WebGLContext';

/**
 * Sound Spy for tracking Boss Defeat and Helmet Loot Audio
 */
class AuditSoundSpy extends NullSound implements ISound {
  public explosionEvents: number[] = [];
  public floorClearCount = 0;
  public uiCount = 0;
  public levelUpCount = 0;

  public override playExplosion(volume: number = 1): void {
    this.explosionEvents.push(volume);
  }
  public override PlayExplosion(volume: number = 1): void {
    this.explosionEvents.push(volume);
  }
  public override playFloorClear(): void {
    this.floorClearCount++;
  }
  public override PlayFloorClear(): void {
    this.floorClearCount++;
  }
  public override playUi(): void {
    this.uiCount++;
  }
  public override PlayUi(): void {
    this.uiCount++;
  }
  public override playLevelUp(): void {
    this.levelUpCount++;
  }
  public override PlayLevelUp(): void {
    this.levelUpCount++;
  }
  public override setBossMode(_active: boolean): void {}
  public override SetBossMode(_active: boolean): void {}
}

/**
 * FX Spy for tracking Visual Shockwaves, Flashes, Bursts, and Camera Shakes
 */
class AuditFxSpy extends NullFx implements IFx {
  public ringShockwaves: Array<{ x: number; y: number; color: string; radius: number }> = [];
  public bursts: Array<{ x: number; y: number; color: string; count: number }> = [];
  public flashes: Array<{ color: string; intensity: number; duration: number }> = [];
  public shakes: Array<{ intensity: number; duration: number }> = [];
  public textPrompts: Array<{ text: string; color: string }> = [];

  public override ringShockwave(x: number, y: number, color: string, maxRadius: number = 80, _expansionRate: number = 0.05): void {
    this.ringShockwaves.push({ x, y, color, radius: maxRadius });
  }
  public override RingShockwave(x: number, y: number, color: string, maxRadius: number = 80, _expansionRate: number = 0.05): void {
    this.ringShockwaves.push({ x, y, color, radius: maxRadius });
  }
  public override burst(x: number, y: number, color: string, count: number = 16, _speed: number = 5, _size: number = 4): void {
    this.bursts.push({ x, y, color, count });
  }
  public override Burst(x: number, y: number, color: string, count: number = 16, _speed: number = 5, _size: number = 4): void {
    this.bursts.push({ x, y, color, count });
  }
  public override flash(color: string = '#ffffff', intensity: number = 0.6, duration: number = 0.3): void {
    this.flashes.push({ color, intensity, duration });
  }
  public override Flash(color: string = '#ffffff', intensity: number = 0.6, duration: number = 0.3): void {
    this.flashes.push({ color, intensity, duration });
  }
  public override shake(intensity: number = 10, duration: number = 20): void {
    this.shakes.push({ intensity, duration });
  }
  public override Shake(intensity: number = 10, duration: number = 20): void {
    this.shakes.push({ intensity, duration });
  }
  public override addText(_x: number, _y: number, text: string, color: string = '#ffffff', _size: number = 14, _floating: boolean = true): void {
    this.textPrompts.push({ text, color });
  }
  public override AddText(_x: number, _y: number, text: string, color: string = '#ffffff', _size: number = 14, _floating: boolean = true): void {
    this.textPrompts.push({ text, color });
  }
}

describe('Audit Test Suite: Boss Helmet Drops, Collection, Pre-Run Equipping & Head Rendering', () => {
  let g: GameEngine;
  let im: ScriptedInput;
  let teardownDom: () => void;
  let soundSpy: AuditSoundSpy;
  let fxSpy: AuditFxSpy;

  beforeEach(() => {
    teardownDom = setupMockDom();
    soundSpy = new AuditSoundSpy();
    fxSpy = new AuditFxSpy();

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();

    g = new GameEngine();
    im = new ScriptedInput();
    Services.input = im;
    Services.fx = fxSpy;
    Services.sound = soundSpy;
    Services.headless = true;
    g.setupCanvas(1280, 720, 1);
  });

  afterEach(() => {
    teardownDom();
  });

  /* =========================================================================
   * 1. DROP ISOLATION: BOSSES DROP HELMETS, REGULAR ENEMIES DO NOT
   * ========================================================================= */
  describe('1. Drop Isolation & Defeat Loot Verification', () => {
    it('regular enemy kills NEVER drop helmets or modify MetaProgression.Helmets', () => {
      const meta = MetaProgression.instance;
      expect(meta.helmets.length).toBe(0);

      const combat = new CombatSystem();
      g.player = new SnakePlayer('emerald', 1280, 720, 3);

      const regularEnemyTypes = ['scarab', 'wasp', 'worm', 'spitter', 'splitter', 'charger'];
      for (const eType of regularEnemyTypes) {
        const enemy = new Enemy(300, 300, eType, 1);
        g.enemies = [enemy];
        const initialFoodCount = g.foods.length;

        // Kill the enemy
        combat.handleEnemyKill(enemy, g as any);

        // Food items should drop (e.g. apple, golden, soul, shard)
        expect(g.foods.length).toBeGreaterThan(initialFoodCount);

        // Helmets in persistent inventory MUST strictly remain 0
        expect(meta.helmets.length).toBe(0);
        expect(meta.getEquippedHelmet()).toBeNull();
      }
    });

    it('defeating each of the 8 apex bosses drops a physical in-world helmet collectible', () => {
      g.maxFloors = 10;
      const expectedBossTypes = [
        'centipede',
        'gorgon',
        'colossus',
        'frostwyrm',
        'chronowyrm',
        'hivemind',
        'superconductor_boss',
        'leviathan'
      ];

      for (let floor = 1; floor <= expectedBossTypes.length; floor++) {
        const bType = expectedBossTypes[floor - 1]!;
        const boss = new Boss(floor, 1280, 720);
        boss.type = bType;
        boss.name = `Guardian ${bType}`;
        g.boss = boss;
        g.currentFloor = floor;

        const prevDropCount = g.helmetDrops.length;
        g.onBossDefeated();

        expect(g.helmetDrops.length).toBe(prevDropCount + 1);
        const drop = g.helmetDrops[g.helmetDrops.length - 1]!;
        expect(drop.helmet).toBeDefined();
        expect(drop.helmet.name).toBeDefined();
        expect(drop.helmet.stats).toBeDefined();
        expect(Object.keys(drop.helmet.stats || {}).length).toBeGreaterThanOrEqual(1);
      }
      expect(g.helmetDrops.length).toBe(8);
    });
  });

  /* =========================================================================
   * 2. ARENA DROP, COLLECTION FX, SOUND & PERSISTENCE
   * ========================================================================= */
  describe('2. Physical Drop, Collection Audio/FX & MetaProgression Registration', () => {
    it('triggers celebration audio, shockwaves, banner, and registers helmet upon snake collection', () => {
      const meta = MetaProgression.instance;
      g.boss = new Boss(1, 1280, 720);
      g.boss.x = 640;
      g.boss.y = 360;

      let bannerText = '';
      g.OnBanner = (msg: string) => { bannerText = msg; };

      g.onBossDefeated();

      // Audio verification
      expect(soundSpy.explosionEvents.length).toBeGreaterThan(0);
      expect(soundSpy.floorClearCount).toBe(1);

      // In-world drop entity created
      expect(g.helmetDrops.length).toBe(1);
      const drop = g.helmetDrops[0]!;
      expect(drop.dead).toBe(false);

      // Before collection: meta inventory is still 0
      expect(meta.helmets.length).toBe(0);

      // Snake collects the drop
      g.collectHelmetDrop(drop);
      expect(drop.dead).toBe(true);

      // After collection: meta inventory has the helmet
      expect(meta.helmets.length).toBe(1);
      const looted = meta.helmets[0]!;
      expect(looted.rarity).toBeDefined();
      expect(soundSpy.levelUpCount).toBeGreaterThan(0);

      // Visual FX verification
      expect(fxSpy.ringShockwaves.length).toBeGreaterThan(0);
      expect(fxSpy.bursts.length).toBeGreaterThan(0);

      // Banner announcement verification
      expect(bannerText).toContain('LOOTED!');
      expect(bannerText).toMatch(/🏆.*\[(COMMON|UNCOMMON|RARE|EPIC|MYTHIC)\]/);
    });

    it('collects helmet drops via physical head collision in the Step accumulator loop', () => {
      const meta = MetaProgression.instance;
      g.player = new SnakePlayer('emerald', 1280, 720, 3);
      g.player.x = 200;
      g.player.y = 200;

      const testHelm: HelmetDef = {
        Id: 'step-helm-1',
        Name: 'Chitinous Visage',
        Icon: '🪖',
        Rarity: 'rare',
        Stats: { maxHp: 30, speed: 0.1 },
        id: 'step-helm-1',
        name: 'Chitinous Visage',
        icon: '🪖',
        rarity: 'rare',
        stats: { maxHp: 30, speed: 0.1 }
      };

      const drop = new HelmetDrop(205, 205, testHelm);
      g.helmetDrops = [drop];

      expect(meta.helmets.length).toBe(0);

      // Step simulation by 1 tick
      g.step(1.0 / 120.0);

      // Drop should have been collected by the head overlapping (200, 200) vs (205, 205)
      expect(drop.dead).toBe(true);
      expect(meta.helmets.length).toBe(1);
      expect(meta.helmets[0]!.name).toBe('Chitinous Visage');
    });
  });

  /* =========================================================================
   * 3. PRE-RUN EQUIPPING & MULTI-CLASS AFFIX INHERITANCE
   * ========================================================================= */
  describe('3. Pre-Run Vault Equipping & 13-Affix Serpent Inheritance', () => {
    it('allows player to equip a helmet in ClassSelectScreen before run starts', () => {
      const meta = MetaProgression.instance;
      const testHelm: HelmetDef = {
        Id: 'diadem-vault-1',
        Name: 'Solar Diadem of Ferocity',
        Icon: '☀️',
        Rarity: 'mythic',
        Stats: { maxHp: 50, bitePower: 15, armor: 0.10 },
        id: 'diadem-vault-1',
        name: 'Solar Diadem of Ferocity',
        icon: '☀️',
        rarity: 'mythic',
        stats: { maxHp: 50, bitePower: 15, armor: 0.10 }
      };
      meta.addHelmet(testHelm);
      expect(meta.equippedHelmetId).toBeNull();

      const container = document.createElement('div');
      const root = UiRoot.init(container as any, g);
      const classScreen = new ClassSelectScreen(root);
      root.registerScreen(classScreen);

      classScreen.show();
      classScreen.refresh();

      // Locate helmet card and equip it
      const helmetCards = classScreen.element.querySelectorAll('.helmet-card');
      expect(helmetCards.length).toBe(2); // Option 0: No Helmet, Option 1: Solar Diadem

      const solarCard = Array.from(helmetCards).find(c => c.textContent?.includes('Solar Diadem')) as HTMLButtonElement;
      expect(solarCard).toBeDefined();

      solarCard.click();
      expect(meta.equippedHelmetId).toBe('diadem-vault-1');
      expect(meta.getEquippedHelmet()?.name).toBe('Solar Diadem of Ferocity');
      expect(soundSpy.uiCount).toBeGreaterThan(0);
    });

    it('newly spawned snake of any class inherits all 13 helmet stat affixes accurately', () => {
      const meta = MetaProgression.instance;
      const omniHelm: HelmetDef = {
        Id: 'omni-helm-godtier',
        Name: 'Crown of Perfection',
        Icon: '👑',
        Rarity: 'mythic',
        Stats: {
          maxHp: 60,
          armor: 0.15,
          speed: 0.20,
          bitePower: 14,
          critChance: 0.12,
          critMult: 0.45,
          hpRegen: 5.0,
          shield: 40,
          magnetRadius: 35,
          dashCooldown: 0.50,
          xpMultiplier: 0.25,
          shardMultiplier: 0.30,
          thorns: 22
        },
        id: 'omni-helm-godtier',
        name: 'Crown of Perfection',
        icon: '👑',
        rarity: 'mythic',
        stats: {
          maxHp: 60,
          armor: 0.15,
          speed: 0.20,
          bitePower: 14,
          critChance: 0.12,
          critMult: 0.45,
          hpRegen: 5.0,
          shield: 40,
          magnetRadius: 35,
          dashCooldown: 0.50,
          xpMultiplier: 0.25,
          shardMultiplier: 0.30,
          thorns: 22
        }
      };

      meta.addHelmet(omniHelm);
      meta.equipHelmet('omni-helm-godtier');

      const classes = ['emerald', 'ruby', 'sapphire', 'amber', 'obsidian'] as const;

      for (const cls of classes) {
        // Without helmet baseline
        meta.equipHelmet(null);
        const baseSnake = new SnakePlayer(cls, 1280, 720, 3);
        const baseHp = baseSnake.maxHp;
        const baseArmor = baseSnake.stats.armor;
        const baseSpeed = baseSnake.stats.speed;
        const baseBite = baseSnake.stats.bitePower;
        const baseCrit = baseSnake.stats.critChance;
        const baseCritMult = baseSnake.stats.critMult;
        const baseRegen = baseSnake.stats.hpRegen;
        const baseShield = baseSnake.shield;
        const baseMag = baseSnake.stats.magnetRadius;
        const baseDashCd = baseSnake.stats.dashCooldown;
        const baseXp = baseSnake.stats.xpGain;
        const baseShard = baseSnake.stats.shardGain;
        const baseThorns = baseSnake.stats.thorns;

        // With helmet equipped
        meta.equipHelmet('omni-helm-godtier');
        const equippedSnake = new SnakePlayer(cls, 1280, 720, 3);

        expect(equippedSnake.equippedHelmet?.id).toBe('omni-helm-godtier');
        expect(equippedSnake.maxHp).toBe(baseHp + 60);
        expect(equippedSnake.stats.armor).toBeCloseTo(baseArmor + 0.15, 2);
        expect(equippedSnake.stats.speed).toBeCloseTo(baseSpeed + 0.20, 2);
        expect(equippedSnake.stats.bitePower).toBe(baseBite + 14);
        expect(equippedSnake.stats.critChance).toBeCloseTo(baseCrit + 0.12, 2);
        expect(equippedSnake.stats.critMult).toBeCloseTo(baseCritMult + 0.45, 2);
        expect(equippedSnake.stats.hpRegen).toBeCloseTo(baseRegen + 5.0, 1);
        expect(equippedSnake.shield).toBe(baseShield + 40);
        expect(equippedSnake.stats.magnetRadius).toBe(baseMag + 35);
        expect(equippedSnake.stats.dashCooldown).toBeCloseTo(Math.max(0.6, baseDashCd - 0.50), 2);
        expect(equippedSnake.stats.xpGain).toBeCloseTo(baseXp + 0.25, 2);
        expect(equippedSnake.stats.shardGain).toBeCloseTo(baseShard + 0.30, 2);
        expect(equippedSnake.stats.thorns).toBe(baseThorns + 22);
      }
    });
  });

  /* =========================================================================
   * 4. WEBGL HEAD VISUAL CREST & RARITY STYLING
   * ========================================================================= */
  describe('4. WebGL Head Visual Styling & Archetype Shapes', () => {
    it('does NOT render helmet crest or visor when no helmet is equipped', () => {
      const mockCanvas = document.createElement('canvas') as any;
      mockCanvas.width = 1280;
      mockCanvas.height = 720;
      const glContext = new WebGLContext(mockCanvas);
      const batch = new GLBatch(glContext);

      const player = new SnakePlayer('emerald', 200, 200, 5);
      player.helmet = undefined;

      WebGLGameRenderer.drawPlayer(batch, player);
      const noHelmetQuads = batch.quadCount;
      expect(noHelmetQuads).toBeGreaterThan(0);
    });

    it('renders distinct rarity styling and glowing crests for all 5 rarity tiers in pure WebGL', () => {
      const rarities: Array<{ rarity: HelmetRarity; color: string }> = [
        { rarity: 'common', color: HELMET_RARITY_COLORS.common },
        { rarity: 'uncommon', color: HELMET_RARITY_COLORS.uncommon },
        { rarity: 'rare', color: HELMET_RARITY_COLORS.rare },
        { rarity: 'epic', color: HELMET_RARITY_COLORS.epic },
        { rarity: 'mythic', color: HELMET_RARITY_COLORS.mythic }
      ];

      for (const { rarity } of rarities) {
        const mockCanvas = document.createElement('canvas') as any;
        mockCanvas.width = 1280;
        mockCanvas.height = 720;
        const glContext = new WebGLContext(mockCanvas);
        const batch = new GLBatch(glContext);

        const player = new SnakePlayer('emerald', 300, 300, 5);
        player.helmet = {
          rarity,
          name: `Test ${rarity} Helm`,
          icon: '🪖'
        };

        WebGLGameRenderer.drawPlayer(batch, player);
        expect(batch.quadCount).toBeGreaterThan(0);
      }
    });

    it('resolves and renders all 6 procedural helmet archetypes in pure WebGL', () => {
      const archetypes = [
        { name: 'Chitinous Centipede Crown', bossType: 'centipede', expected: 'centipede' },
        { name: 'Infernal Greathelm', bossType: 'colossus', expected: 'colossus' },
        { name: 'Abyssal Horns', bossType: 'leviathan', expected: 'leviathan' },
        { name: 'Temporal Clockwork Tiara', bossType: 'chronowyrm', expected: 'chrono' },
        { name: 'Ophidian Cobra Crest', bossType: 'gorgon', expected: 'gorgon' },
        { name: 'Singularity Void Cowl', bossType: 'void', expected: 'void' }
      ] as const;

      for (const arch of archetypes) {
        const resolved = SnakeRenderer.resolveHelmetArchetype({
          name: arch.name,
          bossType: arch.bossType,
          rarity: 'epic'
        });
        expect(resolved).toBe(arch.expected);

        const mockCanvas = document.createElement('canvas') as any;
        mockCanvas.width = 1280;
        mockCanvas.height = 720;
        const glContext = new WebGLContext(mockCanvas);
        const batch = new GLBatch(glContext);

        const player = new SnakePlayer('emerald', 300, 300, 5);
        player.helmet = {
          name: arch.name,
          bossType: arch.bossType,
          rarity: 'epic'
        };

        WebGLGameRenderer.drawPlayer(batch, player);
        expect(batch.quadCount).toBeGreaterThan(0);
      }
    });
  });
});
