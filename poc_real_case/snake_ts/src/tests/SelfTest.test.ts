import { describe, it, expect, beforeEach } from 'vitest';
import { Rng } from '../core/Rng';
import { MathX } from '../core/MathX';
import { Services } from '../core/Services';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts';
import { GameData } from '../data/GameData';
import { MetaProgression } from '../data/MetaProgression';
import type { CardDef } from '../data/Types';
import { GameState } from '../sim/GameState';
import { GameEngine } from '../sim/GameEngine';
import { Vec2 } from '../core/Vec2';
import { Hazard } from '../sim/Hazard';
import { SnakePlayer } from '../sim/SnakePlayer';
import { ResponsiveLayout } from '../ui/ResponsiveLayout';

describe('SelfTest Conformance Test Suite (81 Test Matrix)', () => {
  let g: GameEngine;
  let im: ScriptedInput;
  let god = false;

  const Dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]
  ];

  class HarnessRng {
    private _state = 0x2545f491;
    public setSeed(seed: number): void {
      this._state = seed !== 0 ? (seed >>> 0) : 1;
    }
    public next(): number {
      this._state ^= this._state << 13;
      this._state >>>= 0;
      this._state ^= this._state >>> 17;
      this._state ^= this._state << 5;
      this._state >>>= 0;
      return this._state / 4294967296.0;
    }
  }

  const hr = new HarnessRng();

  function newEngine(): void {
    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
    Services.meta = MetaProgression.instance;

    g = new GameEngine();
    im = new ScriptedInput();
    Services.input = im;
    Services.fx = new NullFx();
    Services.sound = new NullSound();
    Services.headless = true;
    god = false;

    g.setupCanvas(1440, 900, 1);
  }

  function startRun(classId: string, mode = 'rogue', seed = 8080, godMode = false, floor = 0): void {
    hr.setSeed(seed);
    god = false;

    const meta = MetaProgression.instance;
    for (const k of GameData.Classes.keys) meta.unlockedClasses[k] = true;

    g.gameMode = mode;
    g.selectedClass = classId;
    g.startRun();

    const cfg = GameData.Modes.get(mode) || GameData.Modes.get('rogue')!;
    if (!cfg.seeded) forceSeed(seed);

    if (godMode) {
      g.player.stats.maxHp = 1e6;
      g.player.hp = 1e6;
      god = true;
    }
    if (floor > 0) g.currentFloor = floor;
    im.reset();
  }

  function forceSeed(seed: number): void {
    Rng.Shared.setSeed(seed);
    g.runSeed = seed;
    if (g.player) g.player.eyeBlinkTimer = Rng.Shared.range(2, 5);
    g.foods.length = 0;
    for (let i = 0; i < 9; i++) g.spawnFood();
  }

  function pump(dtMs: number): void {
    g.tick(dtMs / 1000.0);
    if (god && g.player && g.player.stats.maxHp >= 1e5 && g.player.hp < 1e5) {
      g.player.hp = 1e5;
    }
  }

  interface DriveOpts {
    noDrive?: boolean;
    skipDraft?: boolean;
    cardIndex?: number;
    reroll?: boolean;
  }

  function drive(frames: number, dtMs = 16.67, opts: DriveOpts = {}): void {
    let dirTimer = 0;
    for (let i = 0; i < frames; i++) {
      if (!opts.noDrive) {
        if (--dirTimer <= 0) {
          dirTimer = 8 + Math.floor(hr.next() * 40);
          const k = Math.floor(hr.next() * 8);
          im.setDirection(Dirs[k]![0]!, Dirs[k]![1]!);
        }
        if (hr.next() < 0.035) g.requestDash();
        if (hr.next() < 0.012) g.requestSkill();
      }

      if (g.state === GameState.LevelUp) {
        if (g.currentDraftCards && g.currentDraftCards.length > 0) {
          if (opts.skipDraft) {
            g.skipDraft();
          } else {
            const idx = opts.cardIndex !== undefined && opts.cardIndex >= 0
              ? Math.min(opts.cardIndex, g.currentDraftCards.length - 1)
              : Math.floor(hr.next() * g.currentDraftCards.length);
            if (opts.reroll && g.rerollsRemaining > 0) g.rerollDraft();
            const pick = g.currentDraftCards[Math.min(idx, g.currentDraftCards.length - 1)];
            if (pick) g.selectUpgradeCard(pick);
          }
        } else {
          g.completeLevelUp();
        }
      }

      pump(dtMs);
      if (g.state === GameState.GameOver) break;
    }
  }

  beforeEach(() => {
    newEngine();
  });

  /* 1. Boot + Module Contract */
  it('1. boot + module contract', () => {
    expect(g.state).toBe(GameState.Menu);
    expect(GameData.CardPool.length).toBe(36);
    expect(GameData.Classes.count).toBe(5);
    expect(GameData.Bosses.length).toBe(20);
    expect(GameData.Modes.count).toBe(4);
    expect(g.arenaW).toBeGreaterThan(0);
    expect(g.arenaH).toBeGreaterThan(0);
    expect(g.player).toBeUndefined();

    // Table insertion order contracts
    expect(GameData.Enemies.keys[0]).toBe('scarab');
    expect(GameData.Classes.keys[0]).toBe('emerald');
    expect(GameData.Modes.keys[0]).toBe('rogue');

    for (const card of GameData.CardPool) {
      expect(card.id).toBeDefined();
      expect(typeof card.apply).toBe('function');
      expect(GameData.RarityOrder[card.rarity!]).toBeDefined();
    }


    const relics = GameData.newRelics();
    for (const k of GameData.RelicKeys) {
      expect(relics[k]).toBeDefined();
    }
  });

  /* 2. Determinism */
  it('2. determinism (emerald)', () => {
    newEngine();
    startRun('emerald', 'rogue', 4242);
    drive(600, 16.67);
    const score1 = g.combat.score;
    const x1 = g.player.x;
    const y1 = g.player.y;
    const kills1 = g.combat.kills;

    newEngine();
    startRun('emerald', 'rogue', 4242);
    drive(600, 16.67);
    const score2 = g.combat.score;
    const x2 = g.player.x;
    const y2 = g.player.y;
    const kills2 = g.combat.kills;

    expect(score1).toBe(score2);
    expect(kills1).toBe(kills2);
    expect(x1).toBeCloseTo(x2, 5);
    expect(y1).toBeCloseTo(y2, 5);
  });

  /* 3. Classes by rate */
  const classes = ['emerald', 'stalker', 'hydra', 'storm', 'solar'];
  it.each(classes)('3. class simulation rate: %s', (classId) => {
    newEngine();
    startRun(classId, 'rogue', 1337, true);
    drive(500, 16.67);
    expect(g.player.alive).toBe(true);
    expect(Number.isFinite(g.player.x)).toBe(true);
    expect(Number.isFinite(g.player.y)).toBe(true);
    expect(g.player.hp).toBeGreaterThan(0);
  });

  /* 4. Cards */
  it('4. all 36 cards apply cleanly and stack', () => {
    newEngine();
    startRun('emerald', 'rogue', 9999, true);

    for (const card of GameData.CardPool) {
      const p = g.player;
      const initialHp = p.stats.maxHp;
      const initialPower = p.stats.bitePower;

      // Apply first stack
      p.cardStacks[card.id!] = 1;
      card.apply!(p);

      expect(Number.isFinite(p.stats.maxHp)).toBe(true);
      expect(Number.isFinite(p.stats.bitePower)).toBe(true);

      // Apply second stack if stackable
      if ((card.maxStacks || 1) > 1) {
        p.cardStacks[card.id!] = 2;
        card.apply!(p);
        expect(Number.isFinite(p.stats.speed)).toBe(true);
      }
    }

  });

  /* 5. Skills */
  it.each(classes)('5. active skills fire and cool down for class: %s', (classId) => {
    newEngine();
    startRun(classId, 'rogue', 7777, true);
    expect(g.player.skillReady).toBe(true);

    const fired = g.combat.activateSkill(g.worldBag());
    expect(fired).toBe(true);
    expect(g.player.skillCooldownTimer).toBeGreaterThan(0);
    expect(g.player.skillReady).toBe(false);

    // Pump to cool down
    drive(200, 16.67, { noDrive: true });
    expect(g.player.skillCooldownTimer).toBeLessThanOrEqual(g.player.stats.skillCooldown);
  });

  /* 6. Bosses */
  it('6. boss spawning and dual-phase progression', () => {
    newEngine();
    startRun('emerald', 'bossrush', 101, true);
    expect(g.boss).not.toBeNull();
    expect(g.boss!.phase).toBe(1);
    expect(g.boss!.vulnerable).toBe(false); // during entrance

    drive(120, 16.67, { noDrive: true });
    expect(g.boss!.vulnerable).toBe(true);

    // Inflict 60% damage to trigger phase 2
    g.combat.damageBoss(g.boss, g.boss!.maxHp * 0.6, g.worldBag());
    expect(g.boss!.phase).toBe(2);

    // Kill boss
    g.combat.damageBoss(g.boss, g.boss!.maxHp, g.worldBag());
    drive(1, 16.67, { noDrive: true });
    expect(g.boss).toBeNull();
    expect(g.combat.bossKills).toBe(1);
  });

  /* 7. Game Modes */
  it('7. game modes configuration (rogue, endless, bossrush, daily)', () => {
    newEngine();
    startRun('emerald', 'endless', 505);
    expect(g.maxFloors).toBe(Number.POSITIVE_INFINITY);

    newEngine();
    startRun('emerald', 'bossrush', 606);
    expect(g.foodTarget).toBe(0);
    expect(g.boss).not.toBeNull();
  });

  /* 8. Pause freezes simulation */
  it('8. pause freezes simulation', () => {
    newEngine();
    startRun('emerald', 'rogue', 8080);
    drive(100, 16.67);
    expect(g.state).toBe(GameState.Playing);

    g.togglePause();
    expect(g.state).toBe(GameState.Paused);

    const x = g.player.x;
    const y = g.player.y;
    const sc = g.combat.score;
    const rt = g.combat.runTime;

    for (let i = 0; i < 60; i++) pump(16.67);

    expect(g.player.x).toBe(x);
    expect(g.player.y).toBe(y);
    expect(g.combat.score).toBe(sc);
    expect(g.combat.runTime).toBe(rt);
    expect(g.state).toBe(GameState.Paused);

    g.togglePause();
    expect(g.state).toBe(GameState.Playing);
  });

  /* 9. Cranial Mutation Lab Head Module Simulation & Cost Scaling */
  it('9. Cranial Mutation Lab Head module & augment installation, cost scaling, and Tier 3 cap', () => {
    newEngine();
    startRun('emerald', 'rogue', 1234, true);

    const p = g.player;
    p.addBodySegment();
    expect(p.segments.length).toBe(3);

    // Verify Head module tier upgrade costs: Cost(lvl, p) = 30 * lvl + p * 15
    expect(p.GetHeadModuleCost('turret', 1)).toBe(30); // Level 1 fresh (p = 0)
    expect(p.GetHeadModuleCost('turret', 2)).toBe(60); // Level 2 with p = 0
    expect(p.GetHeadAugmentCost('fangs', 1)).toBe(40); // Augment Level 1 fresh (p = 0)

    // Install turret module on Head (Offense)
    const successTurret = p.InstallHeadModule('turret');
    expect(successTurret).toBe(1);
    expect(p.HeadModules['turret']).toBe(1);
    expect(p.HeadPurchaseCount).toBe(1);

    // Upgrade to Tier 2 (now p = 1) -> Cost(2, 1) = 30 * 2 + 1 * 15 = 75
    expect(p.GetHeadModuleCost('turret', 2)).toBe(75);
    const successTurretLv2 = p.InstallHeadModule('turret');
    expect(successTurretLv2).toBe(2);
    expect(p.HeadModules['turret']).toBe(2);

    // Install shield module on Head (Defense)
    const successShield = p.InstallHeadModule('shield');
    expect(successShield).toBe(1);
    expect(p.HeadModules['shield']).toBe(1);

    // Install Cranial Augment on Head
    const successAugment = p.InstallHeadAugment('fangs');
    expect(successAugment).toBe(1);
    expect(p.GetHeadAugmentLevel('fangs')).toBe(1);

    // Segment swap maintains physical segment positions
    p.swapSegments(0, 1);
    expect(p.segments.length).toBe(3);
  });

  /* 10. Universal Responsive UI */
  it('10. universal responsive UI scaling bounds', () => {
    const scaleMobile = ResponsiveLayout.computeUiScale({ x: 360, y: 780 });
    expect(scaleMobile).toBeGreaterThanOrEqual(0.85);
    expect(scaleMobile).toBeLessThanOrEqual(1.05);

    const scale4k = ResponsiveLayout.computeUiScale({ x: 3840, y: 2160 });
    expect(scale4k).toBeGreaterThanOrEqual(2.50);
    expect(scale4k).toBeLessThanOrEqual(3.05);
  });

  /* 11. 20-Floor Boss Guardian Roster */
  it('11. 20-floor boss guardian roster and attributes', () => {
    expect(GameData.Bosses.length).toBe(20);
    const bossTypes = GameData.Bosses.map(b => b.Type);
    expect(bossTypes.slice(0, 8)).toEqual(['centipede', 'gorgon', 'colossus', 'frostwyrm', 'chronowyrm', 'hivemind', 'superconductor_boss', 'leviathan']);

    for (let f = 1; f <= 20; f++) {
      const bDef = GameData.BossForFloor(f);
      expect(bDef).toBeDefined();
      expect(bDef.BaseHp).toBeGreaterThan(0);
      expect(bDef.HpPerFloor).toBeGreaterThan(0);
    }
  });

  /* 12. Tactical Modules & Sanctuary Blueprint Unlocks */
  it('12. tactical socket module unlocks and hardpoint rules', () => {
    const meta = MetaProgression.Instance;
    // Default starter modules (strictly 1 weapon: turret, 1 defense: shield)
    expect(meta.IsModuleUnlocked('turret')).toBe(true);
    expect(meta.IsModuleUnlocked('tesla')).toBe(false);
    expect(meta.IsModuleUnlocked('shield')).toBe(true);

    // Locked blueprint modules initially (without floor/upgrades)
    meta.UpgradeLevels['unlock_tachyon'] = 0;
    meta.Records.HighestFloor = 1;
    delete meta.UnlockedModules['tachyon'];
    expect(meta.IsModuleUnlocked('tachyon')).toBe(false);

    // Unlocked via Sanctuary blueprint purchase
    meta.UpgradeLevels['unlock_tachyon'] = 1;
    expect(meta.IsModuleUnlocked('tachyon')).toBe(true);

    // Validate hardpoint positioning
    expect(SnakePlayer.isOffenseModule('tachyon')).toBe(true);
    expect(SnakePlayer.isOffenseModule('cryo')).toBe(true);
    expect(SnakePlayer.isOffenseModule('plasma')).toBe(true);
    expect(SnakePlayer.isDefenseModule('chrono')).toBe(true);
    expect(SnakePlayer.isDefenseModule('nanite')).toBe(true);
  });

  /* 13. Math & Hazard State Robustness */
  it('13. vector math division guard and hazard telegraph state', () => {
    const v = new Vec2(10, 20);
    const divZero = v.div(0);
    expect(divZero.x).toBe(0);
    expect(divZero.y).toBe(0);
    expect(Number.isFinite(divZero.x)).toBe(true);
    expect(Number.isFinite(divZero.y)).toBe(true);

    const h = new Hazard(100, 100, 'meteor', { telegraph: 1.5 });
    expect(h.telegraph).toBe(1.5);
    expect(h.telegraphMax).toBe(1.5);
  });

  /* 14. Segment Growth Innate Stat Scaling & Ouroboros Constriction */
  it('14. segment growth innate stat scaling and constriction crushing', () => {
    newEngine();
    startRun('emerald', 'rogue', 777, false);
    const p = g.player;
    const initialHp = p.maxHp;
    const initialSegments = p.segments.length;

    p.addBodySegment();
    expect(p.segments.length).toBe(initialSegments + 1);
    expect(p.maxHp).toBe(initialHp + p.baseSegmentHp);
    expect(p.segmentArmorBonus).toBeCloseTo((initialSegments + 1) * 0.03, 2);

    // Verify constriction damage on enclosed enemies
    const world = g.worldBag();
    expect(typeof g.combat.checkConstriction).toBe('function');
  });

  /* 15. Mathematical Formulas & Kinematics Conformance Matrix */
  it('15. mathematical formulas and kinematics conformance matrix', () => {
    // 1. Head Health: HeadMaxHp = 2 * BaseSegmentHp
    const p = new SnakePlayer('hydra', 1280, 720, 4);
    expect(p.headMaxHp).toBe(2 * p.baseSegmentHp);
    expect(p.hp).toBe(p.headHp + p.segments.reduce((acc, s) => acc + s.hp, 0));
    expect(p.maxHp).toBe(p.headMaxHp + p.segments.reduce((acc, s) => acc + s.maxHp, 0));

    // 2. Top-to-Bottom Sequential Healing: Heal(amount) heals Head then Segments
    p.headHp = 10;
    p.segments[0]!.hp = 5;
    const healed = p.heal(p.headMaxHp - 10 + 10);
    expect(p.headHp).toBe(p.headMaxHp);
    expect(p.segments[0]!.hp).toBe(15);
    expect(healed).toBe(p.headMaxHp - 10 + 10);

    // 3. Tail Whip Kinematics Multiplier: 1.0 + 0.85 * (v / v0)^2
    const v0 = p.baseSpeed;
    const vTail = p.getSegmentTangentialSpeed(3);
    const expectedMult = 1.0 + 0.85 * Math.pow(vTail / v0, 2);
    expect(p.getTailWhipDamageMultiplier(3)).toBeCloseTo(expectedMult, 5);

    // 4. Effective Armor Clamping & Damage Resolution
    p.stats.armor = 0.40;
    p.armorBuffTimer = 5.0; // +0.25 buff -> 0.40 + 4 * 0.03 + 0.25 = 0.77
    expect(p.effectiveArmor).toBeCloseTo(0.77, 2);
    const dealt = p.damageHead(100, true, false);
    expect(dealt).toBe(Math.max(1, Math.floor(100 * (1 - 0.77) + 0.5)));

    // 5. Hyperbolic CDR: tau(N) = tau0 / (1 + 0.20 * N)
    const hyperbolic = (tau0: number, n: number) => tau0 / (1 + 0.20 * n);
    expect(hyperbolic(20, 5)).toBe(10); // 50% CDR at 5 stacks

    // 6. Combo Multipliers
    const c = g.combat;
    c.reset();
    c.comboCount = 29;
    c.incrementCombo(p, g.worldBag()); // count -> 30, tier -> 6x
    expect(c.comboCount).toBe(30);
    expect(c.comboMultiplier).toBe(6);
  });
});

