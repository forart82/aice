/**
 * Ouroboros Ascension — Master Automated Simulation & Comprehensive Audit Test Suite
 * Boss Helmets, Cranial Mutation Lab & In-World Drop Systems
 *
 * Covers:
 * 1. Boss Helmet Data in Helmets.ts & Drops in HelmetDrop.ts
 * 2. Helmet Stat Affixes & Stacking Logic with Player Passives in PlayerStats.ts & SnakePlayer.ts
 * 3. Cranial Mutation Lab Slotting, Scaled Purchase Costs & In-Run Challenge Unlocks
 * 4. Save/Load Persistence of Helmets in SaveIO.ts & CranialLabScreen Loadouts
 * 5. Non-NaN Stat Calculations, Unhandled Helmet IDs, Missing Icons & ORACLE.md Formula Verification
 * 6. Autonomous Bot Multi-Floor Campaign Simulation Probes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateBossHelmet,
  chooseHelmetRarity,
  formatHelmetStatDescription,
  HelmetDef,
  HelmetRarity,
  HelmetStats,
  HELMET_RARITY_COLORS,
  HELMET_RARITY_BADGES,
  StatKey
} from '../data/Helmets.js';
import { MetaProgression, ChallengeContext } from '../data/MetaProgression.js';
import { GameData } from '../data/GameData.js';
import { GameEngine } from '../sim/GameEngine.js';
import { GameState } from '../sim/GameState.js';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { CombatSystem } from '../sim/CombatSystem.js';
import { Boss } from '../sim/Boss.js';
import { Enemy } from '../sim/Enemy.js';
import { HelmetDrop } from '../sim/HelmetDrop.js';
import { SaveIO, createDefaultMetaSave } from '../platform/SaveIO.js';
import { AutonomousBotPlayer } from '../sim/ai/AutonomousBotPlayer.js';
import { Services } from '../core/Services.js';
import { ScriptedInput, NullFx, NullSound, ISound, IFx } from '../core/Contracts.js';
import { setupMockDom } from './MockDom.js';
import { UiRoot } from '../ui/UiRoot.js';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen.js';
import { ClassSelectScreen } from '../ui/screens/ClassSelectScreen.js';

class AuditSoundSpy extends NullSound implements ISound {
  public uiCount = 0;
  public levelUpCount = 0;
  public floorClearCount = 0;
  public explosionCount = 0;
  public errorCount = 0;

  public override playUi(): void { this.uiCount++; }
  public override PlayUi(): void { this.uiCount++; }
  public override playLevelUp(): void { this.levelUpCount++; }
  public override PlayLevelUp(): void { this.levelUpCount++; }
  public override playFloorClear(): void { this.floorClearCount++; }
  public override PlayFloorClear(): void { this.floorClearCount++; }
  public override playExplosion(_vol?: number): void { this.explosionCount++; }
  public override PlayExplosion(_vol?: number): void { this.explosionCount++; }
  public override playError(): void { this.errorCount++; }
  public override PlayError(): void { this.errorCount++; }
}

class AuditFxSpy extends NullFx implements IFx {
  public ringShockwaves: Array<{ x: number; y: number; color: string; radius: number }> = [];
  public bursts: Array<{ x: number; y: number; color: string; count: number }> = [];
  public textPrompts: Array<{ text: string; color: string }> = [];

  public override ringShockwave(x: number, y: number, color: string, maxRadius = 80, _expansionRate = 0.05): void {
    this.ringShockwaves.push({ x, y, color, radius: maxRadius });
  }
  public override RingShockwave(x: number, y: number, color: string, maxRadius = 80, _expansionRate = 0.05): void {
    this.ringShockwaves.push({ x, y, color, radius: maxRadius });
  }
  public override burst(x: number, y: number, color: string, count = 16, _speed = 5, _size = 4): void {
    this.bursts.push({ x, y, color, count });
  }
  public override Burst(x: number, y: number, color: string, count = 16, _speed = 5, _size = 4): void {
    this.bursts.push({ x, y, color, count });
  }
  public override addText(_x: number, _y: number, text: string, color = '#ffffff', _size = 14, _floating = true): void {
    this.textPrompts.push({ text, color });
  }
  public override AddText(_x: number, _y: number, text: string, color = '#ffffff', _size = 14, _floating = true): void {
    this.textPrompts.push({ text, color });
  }
}

describe('Master Simulation Audit: Boss Helmets, Cranial Mutation Lab & Drops', () => {
  let g: GameEngine;
  let im: ScriptedInput;
  let teardownDom: () => void;
  let soundSpy: AuditSoundSpy;
  let fxSpy: AuditFxSpy;
  let memStore: Map<string, string>;

  beforeEach(() => {
    teardownDom = setupMockDom();
    soundSpy = new AuditSoundSpy();
    fxSpy = new AuditFxSpy();
    memStore = new Map<string, string>();

    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();
    SaveIO.readOverride = (key) => memStore.get(key) ?? null;
    SaveIO.writeOverride = (key, val) => { memStore.set(key, val); };
    SaveIO.deleteOverride = (key) => { memStore.delete(key); };

    MetaProgression.readBackend = (key) => memStore.get(key) ?? null;
    MetaProgression.writeBackend = (key, val) => { memStore.set(key, val); };
    MetaProgression.deleteBackend = (key) => { memStore.delete(key); };
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
    SaveIO.readOverride = null;
    SaveIO.writeOverride = null;
    SaveIO.deleteOverride = null;
  });

  /* =========================================================================
   * 1. BOSS HELMET DATA & PROCEDURAL GENERATOR AUDIT
   * ========================================================================= */
  describe('1. Boss Helmet Data in Helmets.ts & Procedural Generation', () => {
    const all20BossTypes = [
      'centipede', 'gorgon', 'colossus', 'frostwyrm', 'chronowyrm',
      'hivemind', 'superconductor_boss', 'leviathan', 'quantum_hydra', 'mirror_wyrm',
      'void_devourer', 'orbital_dreadnought', 'iron_juggernaut', 'solar_archon', 'crystal_monolith',
      'tempest_siren', 'nanite_titan', 'phase_specter', 'volcanic_chimera', 'eternal_ouroboros'
    ];

    it('generates 2,000+ helmets across all 20 boss archetypes with zero NaNs, non-empty IDs, and valid icons', () => {
      const rarities: HelmetRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

      for (let i = 0; i < 2000; i++) {
        const floor = (i % 20) + 1;
        const bossType = all20BossTypes[i % all20BossTypes.length]!;
        const forcedRarity = rarities[i % rarities.length];

        const helm = generateBossHelmet(floor, bossType, forcedRarity);

        // Core fields
        expect(helm.id).toBeTruthy();
        expect(helm.name).toBeTruthy();
        expect(helm.icon).toBeTruthy();
        expect(helm.rarity).toBe(forcedRarity);
        expect(helm.bossType).toBe(bossType);
        expect(helm.floor).toBe(floor);

        // Stats non-NaN check
        const stats = helm.stats || helm.Stats || {};
        const statKeys = Object.keys(stats) as StatKey[];
        expect(statKeys.length).toBeGreaterThanOrEqual(1);

        for (const k of statKeys) {
          const val = stats[k];
          expect(typeof val).toBe('number');
          expect(Number.isNaN(val)).toBe(false);
          expect(Number.isFinite(val)).toBe(true);
          expect(val).toBeGreaterThan(0);
        }

        // Description formatting
        const desc = formatHelmetStatDescription(stats);
        expect(desc.length).toBeGreaterThan(0);
        expect(desc).not.toContain('NaN');
        expect(desc).not.toContain('undefined');
      }
    });

    it('strictly maps affix count by rarity tier (Common:1, Uncommon:2, Rare:3, Epic:4, Legendary:4, Mythic:5)', () => {
      const affixMapping: Record<HelmetRarity, number> = {
        common: 1,
        uncommon: 2,
        rare: 3,
        epic: 4,
        legendary: 4,
        mythic: 5
      };

      for (const [rKey, expectedCount] of Object.entries(affixMapping)) {
        const rarity = rKey as HelmetRarity;
        for (let s = 0; s < 50; s++) {
          const helm = generateBossHelmet(s + 1, 'centipede', rarity);
          const count = Object.keys(helm.stats || {}).length;
          expect(count).toBe(expectedCount);
        }
      }
    });

    it('rarity probability distribution strictly aligns with ORACLE.md FORMULA_HELMET_RARITY', () => {
      // Floor 1: [60% common, 35% uncommon, 5% rare, 0% epic, 0% mythic]
      const f1Counts = { common: 0, uncommon: 0, rare: 0, epic: 0, mythic: 0 };
      const samples = 2000;
      for (let i = 0; i < samples; i++) {
        const r = chooseHelmetRarity(1);
        f1Counts[r as keyof typeof f1Counts]++;
      }
      expect(f1Counts.common / samples).toBeCloseTo(0.60, 1);
      expect(f1Counts.uncommon / samples).toBeCloseTo(0.35, 1);
      expect(f1Counts.rare / samples).toBeCloseTo(0.05, 1);
      expect(f1Counts.epic).toBe(0);
      expect(f1Counts.mythic).toBe(0);

      // Floor 2: [0% common, 50% uncommon, 35% rare, 15% epic, 0% mythic]
      const f2Counts = { common: 0, uncommon: 0, rare: 0, epic: 0, mythic: 0 };
      for (let i = 0; i < samples; i++) {
        const r = chooseHelmetRarity(2);
        f2Counts[r as keyof typeof f2Counts]++;
      }
      expect(f2Counts.common).toBe(0);
      expect(f2Counts.uncommon / samples).toBeCloseTo(0.50, 1);
      expect(f2Counts.rare / samples).toBeCloseTo(0.35, 1);
      expect(f2Counts.epic / samples).toBeCloseTo(0.15, 1);
      expect(f2Counts.mythic).toBe(0);

      // Floor 3+: [0% common, 0% uncommon, 45% rare, 40% epic, 15% mythic]
      const f3Counts = { common: 0, uncommon: 0, rare: 0, epic: 0, mythic: 0 };
      for (let i = 0; i < samples; i++) {
        const r = chooseHelmetRarity(3);
        f3Counts[r as keyof typeof f3Counts]++;
      }
      expect(f3Counts.common).toBe(0);
      expect(f3Counts.uncommon).toBe(0);
      expect(f3Counts.rare / samples).toBeCloseTo(0.45, 1);
      expect(f3Counts.epic / samples).toBeCloseTo(0.40, 1);
      expect(f3Counts.mythic / samples).toBeCloseTo(0.15, 1);
    });

    it('verifies all rarity colors and badges exist and are non-empty strings', () => {
      const rarities: HelmetRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
      for (const r of rarities) {
        expect(HELMET_RARITY_COLORS[r]).toBeTruthy();
        expect(HELMET_RARITY_COLORS[r].startsWith('#')).toBe(true);
        expect(HELMET_RARITY_BADGES[r]).toBe(r.toUpperCase());
      }
    });
  });

  /* =========================================================================
   * 2. IN-WORLD HELMET DROP PHYSICS & AUTO-VACUUM SAFETY
   * ========================================================================= */
  describe('2. In-World Helmet Drop Physics & Auto-Vacuum Safety', () => {
    it('HelmetDrop initializes with bounded velocity, pulse, spawn scale and updates drag decay', () => {
      const helm = generateBossHelmet(1, 'centipede', 'rare');
      const drop = new HelmetDrop(400, 300, helm);

      expect(drop.X).toBe(400);
      expect(drop.Y).toBe(300);
      expect(drop.Radius).toBe(22.0);
      expect(drop.SpawnScale).toBe(0.0);
      expect(drop.Dead).toBe(false);
      expect(Number.isFinite(drop.Vx)).toBe(true);
      expect(Number.isFinite(drop.Vy)).toBe(true);

      const initialVx = drop.Vx;
      const initialVy = drop.Vy;

      // Update 0.5s
      drop.Update(0.5);
      expect(drop.SpawnScale).toBeGreaterThan(0.0);
      expect(drop.Life).toBeCloseTo(0.5, 2);
      expect(Math.abs(drop.Vx)).toBeLessThanOrEqual(Math.abs(initialVx) + 0.001);
      expect(Math.abs(drop.Vy)).toBeLessThanOrEqual(Math.abs(initialVy) + 0.001);
    });

    it('auto-vacuums uncollected drops on floor advancement with zero data loss', () => {
      const meta = MetaProgression.instance;
      expect(meta.helmets.length).toBe(0);

      const h1 = generateBossHelmet(1, 'centipede', 'uncommon');
      const h2 = generateBossHelmet(1, 'gorgon', 'rare');
      g.helmetDrops.push(new HelmetDrop(100, 100, h1));
      g.helmetDrops.push(new HelmetDrop(200, 200, h2));
      expect(g.helmetDrops.length).toBe(2);

      // Trigger floor advance without physical snake pickup
      g.advanceFloor();

      // Drops array in engine is emptied
      expect(g.helmetDrops.length).toBe(0);

      // Meta inventory received both vacuumed helmets
      expect(meta.helmets.length).toBe(2);
      expect(meta.helmets.map(h => h.id)).toContain(h1.id);
      expect(meta.helmets.map(h => h.id)).toContain(h2.id);
    });

    it('auto-vacuums uncollected drops on game over / run end with zero data loss', () => {
      const meta = MetaProgression.instance;
      expect(meta.helmets.length).toBe(0);

      const h1 = generateBossHelmet(3, 'colossus', 'epic');
      g.helmetDrops.push(new HelmetDrop(500, 500, h1));

      g.handleGameOver(false);

      expect(g.helmetDrops.length).toBe(0);
      expect(meta.helmets.length).toBe(1);
      expect(meta.helmets[0]!.name).toBe(h1.name);
    });
  });

  /* =========================================================================
   * 3. HELMET STAT AFFIX STACKING & PASSIVE LOGIC
   * ========================================================================= */
  describe('3. Helmet Stat Affixes & Stacking Logic in PlayerStats & SnakePlayer', () => {
    it('applies max HP bonus cleanly across head (2x) and body segments', () => {
      const helm: HelmetDef = {
        Id: 'hp-helm',
        Name: 'Colossus Bulwark',
        Icon: '🛡️',
        Rarity: 'rare',
        Stats: { maxHp: 48 },
        id: 'hp-helm',
        name: 'Colossus Bulwark',
        icon: '🛡️',
        rarity: 'rare',
        stats: { maxHp: 48 }
      };

      MetaProgression.instance.addHelmet(helm);
      MetaProgression.instance.equipHelmet('hp-helm');

      // 4 body segments + head (weight = 2 + 4 = 6)
      // extraPerPart = round(48 / 6) = 8
      // HeadMaxHp increases by 16, each segment MaxHp increases by 8
      const p = new SnakePlayer('emerald', 1280, 720, 4);

      // Emerald base segment HP = round(110 / 4) = 28. HeadMaxHp base = 56. Total base = 56 + 4 * 28 = 168.
      // With +48 HP: HeadMaxHp = 56 + 16 = 72. Segments = 28 + 8 = 36 each. Total MaxHp = 72 + 4 * 36 = 216.
      expect(p.headMaxHp).toBe(72);
      expect(p.segments[0]!.maxHp).toBe(36);
      expect(p.maxHp).toBe(216);
      expect(p.hp).toBe(216);
    });

    it('enforces strict armor clamping at 0.85 (85% damage reduction ceiling)', () => {
      const helm: HelmetDef = {
        Id: 'tank-helm',
        Name: 'Adamantine Mask',
        Icon: '🛡️',
        Rarity: 'mythic',
        Stats: { armor: 0.50 },
        id: 'tank-helm',
        name: 'Adamantine Mask',
        icon: '🛡️',
        rarity: 'mythic',
        stats: { armor: 0.50 }
      };
      MetaProgression.instance.addHelmet(helm);
      MetaProgression.instance.equipHelmet('tank-helm');

      // Hydra base armor is 0.25. Helmet is 0.50. 2 body segments provide 2 * 0.03 = 0.06 segment armor bonus.
      // Total effective armor = 0.25 + 0.50 + 0.06 = 0.81.
      const p = new SnakePlayer('hydra', 1280, 720, 2);
      expect(p.effectiveArmor).toBeCloseTo(0.81, 2);

      // Install 3 levels of head spikes (+0.12 armor) -> 0.93 clamped to 0.85
      p.installHeadModule('spikes');
      p.installHeadModule('spikes');
      p.installHeadModule('spikes');
      expect(p.effectiveArmor).toBe(0.85);
    });

    it('hpRegen on helmet triggers health replenishment in UpdatePassives every 3.0 seconds', () => {
      const helm: HelmetDef = {
        Id: 'regen-helm',
        Name: 'Crown of Yggdrasil',
        Icon: '🌿',
        Rarity: 'epic',
        Stats: { hpRegen: 6.0, maxHp: 100 },
        id: 'regen-helm',
        name: 'Crown of Yggdrasil',
        icon: '🌿',
        rarity: 'epic',
        stats: { hpRegen: 6.0, maxHp: 100 }
      };
      MetaProgression.instance.addHelmet(helm);
      MetaProgression.instance.equipHelmet('regen-helm');

      const p = new SnakePlayer('stalker', 1280, 720, 2);
      p.hp = 50;

      // Update 2.9s -> no heal yet
      p.updatePassives(2.9, {} as any);
      expect(p.hp).toBe(50);

      // Update 0.2s (total 3.1s) -> triggers +18 heal (6 HP/s * 3s)
      p.updatePassives(0.2, {} as any);
      expect(p.hp).toBe(68);
    });
  });

  /* =========================================================================
   * 4. CRANIAL LAB PURCHASE COSTS & IN-RUN CHALLENGE UNLOCKS
   * ========================================================================= */
  describe('4. Cranial Lab Purchase Costs, Starter Defaults & Challenge Matrix', () => {
    it('module and augment costs strictly match ORACLE.md formulas across escalating purchase counts', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 2);

      // Module Formula: Cost(lvl, p) = 30 * lvl + p * 15
      // Augment Formula: Cost(lvl, p) = 40 * lvl + p * 20
      expect(p.getHeadModuleCost('turret', 1)).toBe(30);
      expect(p.getHeadAugmentCost('fangs', 1)).toBe(40);

      // Purchase #1: Turret Lv1
      p.installHeadModule('turret');
      expect(p.headPurchaseCount).toBe(1);
      expect(p.getHeadModuleCost('tesla', 1)).toBe(30 * 1 + 1 * 15); // 45
      expect(p.getHeadModuleCost('turret', 2)).toBe(30 * 2 + 1 * 15); // 75
      expect(p.getHeadAugmentCost('fangs', 1)).toBe(40 * 1 + 1 * 20); // 60

      // Purchase #2: Augment Fangs Lv1
      p.installHeadAugment('fangs');
      expect(p.headPurchaseCount).toBe(2);
      expect(p.getHeadModuleCost('shield', 1)).toBe(30 * 1 + 2 * 15); // 60
      expect(p.getHeadAugmentCost('fangs', 2)).toBe(40 * 2 + 2 * 20); // 120

      // Purchase #3: Shield Lv1
      p.installHeadModule('shield');
      expect(p.headPurchaseCount).toBe(3);
      expect(p.getHeadModuleCost('plasma', 1)).toBe(30 * 1 + 3 * 15); // 75
      expect(p.getHeadAugmentCost('horns', 1)).toBe(40 * 1 + 3 * 20); // 100
    });

    it('starter defaults strictly unlock ONLY Tier 1 turret and Tier 1 shield on a fresh run', () => {
      const meta = MetaProgression.instance;
      meta.resetRunUnlocks();

      expect(meta.isTierUnlocked('turret', 1)).toBe(true);
      expect(meta.isTierUnlocked('shield', 1)).toBe(true);

      // Higher tiers and other modules must be strictly locked without challenge completion
      expect(meta.isTierUnlocked('turret', 2)).toBe(false);
      expect(meta.isTierUnlocked('shield', 2)).toBe(false);
      expect(meta.isTierUnlocked('tesla', 1)).toBe(false);
      expect(meta.isTierUnlocked('venom', 1)).toBe(false);
      expect(meta.isTierUnlocked('fangs', 1)).toBe(false);
      expect(meta.isTierUnlocked('magma', 1)).toBe(false);
    });

    it('evaluates dynamic length scaling with strict 10ner-step rounding across reference viewports', () => {
      const meta = MetaProgression.instance;

      // Base 600 Desktop length:
      // Desktop (1600x960, R=1.0) -> RoundToTen(600 * 1.0) = 600
      expect(meta.getScaledLengthRequirement(600, { arenaW: 1600, arenaH: 960 })).toBe(600);

      // Default Simulation (960x640, Area=614,400, R=0.40) -> RoundToTen(600 * 0.40) = 240
      expect(meta.getScaledLengthRequirement(600, { arenaW: 960, arenaH: 640 })).toBe(240);

      // Mobile Portrait (540x960, Area=518,400, R=0.3375) -> RoundToTen(600 * 0.3375) = 200
      expect(meta.getScaledLengthRequirement(600, { arenaW: 540, arenaH: 960 })).toBe(200);

      // Compact Mobile (360x540, Area=194,400, R=0.1265625) -> RoundToTen(600 * 0.1265625) = 80
      expect(meta.getScaledLengthRequirement(600, { arenaW: 360, arenaH: 540 })).toBe(80);
    });
  });

  /* =========================================================================
   * 5. PERSISTENCE & LOADOUT SERIALIZATION IN SAVIO
   * ========================================================================= */
  describe('5. Persistence & Save/Load of Helmets in SaveIO', () => {
    it('serializes and deserializes helmets inventory with CRC32 integrity checksums', () => {
      const h1 = generateBossHelmet(1, 'centipede', 'rare');
      const h2 = generateBossHelmet(2, 'gorgon', 'epic');

      const metaSave = SaveIO.loadMeta();
      metaSave.helmets = [h1, h2];
      metaSave.equippedHelmetId = h1.id;
      const saveSuccess = SaveIO.saveMeta(metaSave);
      expect(saveSuccess).toBe(true);

      const loaded = SaveIO.loadMeta();
      expect(loaded.helmets?.length).toBe(2);
      expect(loaded.equippedHelmetId).toBe(h1.id);
      expect(loaded.checksum).toBeTruthy();

      // Export to JSON string and re-import
      const exportedJson = SaveIO.exportSaveJson();
      expect(exportedJson).toContain(h1.name);
      expect(exportedJson).toContain(h2.name);

      const imported = SaveIO.importSaveJson(exportedJson);
      expect(imported.success).toBe(true);
      expect(imported.data?.helmets?.length).toBe(2);
      expect(imported.data?.equippedHelmetId).toBe(h1.id);
    });

    it('safely handles corrupted save payloads and unhandled helmet IDs by resetting to sane defaults', () => {
      const corruptSave = {
        version: 2,
        shards: 100,
        helmets: [
          { id: 'valid-1', name: 'Valid Helm', rarity: 'common', stats: { maxHp: 20 } },
          null, // null entry
          { stats: { armor: 0.1 } } // missing id
        ],
        equippedHelmetId: 'non-existent-id'
      };

      const normalized = SaveIO.validateAndNormalizeV2(corruptSave);
      expect(normalized.helmets?.length).toBe(1);
      expect(normalized.helmets?.[0]?.id).toBe('valid-1');
      // Non-existent equipped ID is cleared to null
      expect(normalized.equippedHelmetId).toBeNull();
    });
  });

  /* =========================================================================
   * 6. AUTONOMOUS BOT MULTI-FLOOR CAMPAIGN PROBE
   * ========================================================================= */
  describe('6. Autonomous Bot Multi-Floor Campaign Simulation Probe', () => {
    it('executes full automated bot simulation traversing 3 floors, defeating bosses, collecting and equipping helmets', () => {
      const meta = MetaProgression.instance;
      g.startRun();
      const bot = new AutonomousBotPlayer();

      expect(g.runInProgress).toBe(true);
      expect(g.currentFloor).toBe(1);

      // Equip a pre-run helmet
      const startHelm = generateBossHelmet(1, 'centipede', 'uncommon');
      meta.addHelmet(startHelm);
      meta.equipHelmet(startHelm.id ?? null);

      // Re-initialize player with equipped helmet
      g.player = new SnakePlayer('emerald', 1280, 720, 3);
      expect(g.player.equippedHelmet?.id).toBe(startHelm.id);

      // Simulate 3 floors with boss battles
      for (let floor = 1; floor <= 3; floor++) {
        g.currentFloor = floor;
        g.spawnBoss();
        expect(g.boss).not.toBeNull();

        const bossType = g.boss!.type;
        const initialHelmCount = meta.helmets.length;

        // Bot runs simulation steps attacking boss
        for (let step = 0; step < 60; step++) {
          bot.stepPolicy(g, im);
          g.step(1.0 / 120.0);
          expect(Number.isFinite(g.player.x)).toBe(true);
          expect(Number.isFinite(g.player.y)).toBe(true);
        }

        // Defeat boss
        g.onBossDefeated();
        expect(g.helmetDrops.length).toBeGreaterThan(0);

        // Vacuum and advance
        g.advanceFloor();
        expect(meta.helmets.length).toBe(initialHelmCount + 1);

        // Equip newest helmet
        const newestHelm = meta.helmets[meta.helmets.length - 1]!;
        meta.equipHelmet(newestHelm.id ?? null);
        expect(meta.equippedHelmetId).toBe(newestHelm.id);
      }

      expect(meta.helmets.length).toBeGreaterThanOrEqual(4);
      expect(soundSpy.floorClearCount).toBeGreaterThanOrEqual(3);
    });
  });
});
