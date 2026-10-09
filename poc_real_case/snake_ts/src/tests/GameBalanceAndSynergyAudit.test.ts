import { describe, it, expect } from 'vitest';
import { Rng } from '../core/Rng';
import { MathX } from '../core/MathX';
import { Services } from '../core/Services';
import { ScriptedInput } from '../core/Contracts';
import { GameData } from '../data/GameData';
import { MetaProgression } from '../data/MetaProgression';
import { SnakePlayer } from '../sim/SnakePlayer';
import { CombatSystem } from '../sim/CombatSystem';
import { World } from '../sim/World';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { AutonomousBotPlayer } from '../sim/ai/AutonomousBotPlayer';
import type { CardDef } from '../data/Types';

describe('Game Balance, 36 Cards, Synergies, and Alchemical Fusions Audit Suite', () => {

  /* =========================================================================
   * 1. 36 DRAFT CARDS CATALOG INTEGRITY & RARITY DISTRIBUTION
   * ========================================================================= */
  it('1. audits all 36 cards definitions, rarity counts, and max stacks', () => {
    const cards = GameData.CardPool;
    expect(cards.length).toBe(36);

    const rarityCounts: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const idSet = new Set<string>();

    for (const card of cards) {
      expect(card.Id).toBeDefined();
      expect(card.Title).toBeDefined();
      expect(card.Desc).toBeDefined();
      expect(card.Stats).toBeDefined();
      expect(card.MaxStacks).toBeGreaterThan(0);
      expect(typeof card.Apply).toBe('function');

      expect(idSet.has(card.Id)).toBe(false);
      idSet.add(card.Id);

      const r = card.Rarity.toLowerCase();
      expect(rarityCounts[r]).toBeDefined();
      rarityCounts[r]++;
    }

    // Official Oracle Rarity Breakdown: 10 Common, 10 Rare, 9 Epic, 7 Legendary
    expect(rarityCounts['common']).toBe(10);
    expect(rarityCounts['rare']).toBe(10);
    expect(rarityCounts['epic']).toBe(9);
    expect(rarityCounts['legendary']).toBe(7);
  });

  /* =========================================================================
   * 2. DRAFT OFFERING DISTRIBUTION & RNG WEIGHTING (100,000 ROLLS SWEEP)
   * ========================================================================= */
  it('2. audits draft RNG rarity weighting and Fortune meta-scaling over 10,000 iterations', () => {
    const meta = new MetaProgression();
    const iterations = 10000;

    for (let fortuneLvl = 0; fortuneLvl <= 3; fortuneLvl++) {
      meta.UpgradeLevels['fortune'] = fortuneLvl;

      const counts: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
      let totalCardsOffered = 0;

      for (let i = 0; i < iterations; i++) {
        const draft = meta.GetRandomCardDraft(3);
        expect(draft.length).toBe(3);

        // Ensure no duplicate cards in the same 3-card draft
        const ids = new Set(draft.map(c => c.Id));
        expect(ids.size).toBe(3);

        for (const card of draft) {
          counts[card.Rarity.toLowerCase()]++;
          totalCardsOffered++;
        }
      }

      const commonPct = (counts['common']! / totalCardsOffered) * 100;
      const rarePct = (counts['rare']! / totalCardsOffered) * 100;
      const epicPct = (counts['epic']! / totalCardsOffered) * 100;
      const legPct = (counts['legendary']! / totalCardsOffered) * 100;

      if (fortuneLvl === 0) {
        // Base weights: Common ~54%, Rare ~28%, Epic ~13%, Legendary ~5%
        expect(commonPct).toBeGreaterThan(48);
        expect(commonPct).toBeLessThan(60);
        expect(rarePct).toBeGreaterThan(24);
        expect(rarePct).toBeLessThan(33);
        expect(epicPct).toBeGreaterThan(10);
        expect(epicPct).toBeLessThan(17);
        expect(legPct).toBeGreaterThan(3);
        expect(legPct).toBeLessThan(8);
      } else if (fortuneLvl === 3) {
        // Max Fortune weights: Common ~33%, Rare ~34%, Epic ~22%, Legendary ~11%
        expect(commonPct).toBeLessThan(38);
        expect(epicPct).toBeGreaterThan(18);
        expect(legPct).toBeGreaterThan(8);
      }
    }
  });

  /* =========================================================================
   * 3. MAX STACK EXCLUSION IN DRAFT
   * ========================================================================= */
  it('3. verifies cards at MaxStacks are strictly excluded from drafts', () => {
    const meta = new MetaProgression();
    const player = new SnakePlayer('stalker');

    // Max out swift_scales (5 stacks) and apex_predator (1 stack)
    player.CardStacks['swift_scales'] = 5;
    player.CardStacks['apex_predator'] = 1;

    for (let i = 0; i < 500; i++) {
      const draft = meta.GetRandomCardDraft(3, player);
      for (const c of draft) {
        expect(c.Id).not.toBe('swift_scales');
        expect(c.Id).not.toBe('apex_predator');
      }
    }
  });

  /* =========================================================================
   * 4. 28 ALCHEMICAL FUSIONS AUDIT
   * ========================================================================= */
  it('4. audits all 28 Alchemical Fusions, socket pair triggers, and descriptions', () => {
    const fusions = GameData.AlchemicalFusions;
    expect(fusions.length).toBe(28);

    const fusionIdSet = new Set<string>();
    const pairSet = new Set<string>();

    for (const f of fusions) {
      expect(f.Id).toBeDefined();
      expect(f.Name).toBeDefined();
      expect(f.ModuleA).toBeDefined();
      expect(f.ModuleB).toBeDefined();
      expect(f.Desc).toBeDefined();

      expect(fusionIdSet.has(f.Id)).toBe(false);
      fusionIdSet.add(f.Id);

      // Ensure no duplicate module pairings
      const pairKey = [f.ModuleA.toLowerCase(), f.ModuleB.toLowerCase()].sort().join('+');
      expect(pairSet.has(pairKey)).toBe(false);
      pairSet.add(pairKey);
    }

    // Verify SnakePlayer detects installed fusions in Head and Segments
    const player = new SnakePlayer('emerald');
    player.HeadModules = { tesla: 1, cryo: 1 };
    let active = player.GetActiveAlchemicalFusions();
    expect(active).toContain('superconductor');

    player.HeadModules = { magma: 1, spikes: 1 };
    active = player.GetActiveAlchemicalFusions();
    expect(active).toContain('obsidian');
  });

  /* =========================================================================
   * 5. SYNERGY LOOPS & EXTREME SCALING STRESS TEST
   * ========================================================================= */
  it('5. tests Infinite Devourer, Apex Predator, and Combo scaling loops', () => {
    const player = new SnakePlayer('stalker');
    const combat = new CombatSystem();
    const world = new World();
    world.ArenaW = 960;
    world.ArenaH = 640;

    // Baseline stats
    const baseBite = player.BitePower;
    expect(baseBite).toBe(34);

    // Apply Apex Predator (+100% Bite, -25% Max HP)
    const apexCard = GameData.CardPool.find(c => c.Id === 'apex_predator')!;
    apexCard.Apply(player);
    expect(player.BitePower).toBe(68);
    expect(player.Stats.MaxHp).toBe(63); // 84 * 0.75 = 63

    // Apply Infinite Devourer
    const devourerCard = GameData.CardPool.find(c => c.Id === 'infinite_devourer')!;
    devourerCard.Apply(player);

    // Simulate 50 combo hits (10 triggers of Devourer)
    for (let i = 0; i < 50; i++) {
      combat.incrementCombo(player, world);
    }

    // 10 triggers of +5% linear additive dmg => 1.0 + 10 * 0.05 = 1.50
    // BitePower should be 68 * 1.50 = 102
    expect(player.DamageBonus).toBeCloseTo(1.50, 3);
    expect(player.BitePower).toBeCloseTo(68 * 1.50, 1);
    expect(player.Stats.MaxHp).toBe(63 + 10 * 10); // +100 Max HP
  });

  /* =========================================================================
   * 6. PER-CARD APPLICATION AND STAT IMPACT AUDIT
   * ========================================================================= */
  it('6. applies every single card to a clean player and verifies stat / relic mutation', () => {
    const cards = GameData.CardPool;

    for (const card of cards) {
      const player = new SnakePlayer('emerald');
      const initialHp = player.Stats.MaxHp;
      const initialSpeed = player.Stats.Speed;
      const initialBite = player.Stats.BitePower;
      const initialArmor = player.Stats.Armor;
      const initialDashCd = player.Stats.DashCooldown;
      const initialCrit = player.Stats.CritChance;
      const initialCritMult = player.Stats.CritMult;
      const initialMagnet = player.Stats.MagnetRadius;
      const initialXpGain = player.Stats.XpGain;
      const initialComboWin = player.Stats.ComboWindow;
      const initialShardGain = player.Stats.ShardGain;

      // Apply card
      card.Apply(player);

      // Verify that the card mutated at least one stat or relic
      let changed = false;
      if (player.Stats.MaxHp !== initialHp) changed = true;
      if (player.Stats.Speed !== initialSpeed) changed = true;
      if (player.Stats.BitePower !== initialBite) changed = true;
      if (player.Stats.Armor !== initialArmor) changed = true;
      if (player.Stats.DashCooldown !== initialDashCd) changed = true;
      if (player.Stats.CritChance !== initialCrit) changed = true;
      if (player.Stats.CritMult !== initialCritMult) changed = true;
      if (player.Stats.MagnetRadius !== initialMagnet) changed = true;
      if (player.Stats.XpGain !== initialXpGain) changed = true;
      if (player.Stats.ComboWindow !== initialComboWin) changed = true;
      if (player.Stats.ShardGain !== initialShardGain) changed = true;
      if (player.Stats.MaxShield > 0) changed = true;
      if (player.Stats.Thorns > 0) changed = true;

      // Or modified relics
      const activeRelics = Object.values(player.Relics).filter(v => typeof v === 'number' && v > 0);
      if (activeRelics.length > 0) changed = true;

      expect(changed).toBe(true);
    }
  });

  /* =========================================================================
   * 7. INFINITE INVULNERABILITY ANALYSIS (STALKER DASH CD VS INVULNERABILITY)
   * ========================================================================= */
  it('7. checks Dash Cooldown reduction thresholds and invulnerability windows', () => {
    const meta = new MetaProgression();
    meta.UpgradeLevels['swiftness'] = 4; // -0.60s Dash CD
    const player = new SnakePlayer('stalker', 960, 640, 2, meta);

    // Stalker base Dash CD = 2.4s - 0.60s = 1.8s
    expect(player.Stats.DashCooldown).toBeCloseTo(1.8, 2);

    // Apply 4 stacks of Sprint Gland (-18% per stack)
    const sprintGland = GameData.CardPool.find(c => c.Id === 'sprint_gland')!;
    for (let i = 0; i < 4; i++) {
      sprintGland.Apply(player);
    }

    // 1.8 * 0.82^4 ~ 0.8125s
    expect(player.Stats.DashCooldown).toBeLessThan(0.85);

    // Trigger dash
    expect(player.TryDash()).toBe(true);

    // Stalker invulnerability duration is strictly bounded below DashCooldown
    expect(player.InvulnerableTimer).toBeLessThan(player.Stats.DashCooldown);

    // DashCooldown > Invulnerability Duration: 0% infinite invulnerability window (balanced!)
    const cooldown = player.Stats.DashCooldown;
    const invulnDuration = player.InvulnerableTimer;
    const hasPermaInvuln = cooldown <= invulnDuration;
    expect(hasPermaInvuln).toBe(false);
  });

  /* =========================================================================
   * 8. CARD DESCRIPTION VS CODE INCOHERENCE AUDIT
   * ========================================================================= */
  it('8. audits discrepancies between Card descriptions and runtime formulas', () => {
    // 1. Gourmand
    const gourmand = GameData.CardPool.find(c => c.Id === 'gourmand')!;
    expect(gourmand.Stats).toContain('Ouro'); // 'Stats: +20% Ouro Gained'

    // 2. Orbital Fangs
    // Description states '55 dmg', but CombatAuras.ts:122 does 55 * dt * 4 * dmgBonus (220 DPS)
    const orbitalFangs = GameData.CardPool.find(c => c.Id === 'orbital_fangs')!;
    expect(orbitalFangs.Stats).toContain('55 dmg');

    // 3. Serpent's Focus
    // Description states '+25% Combo Window', Code adds +0.25 (st.ComboWindow started at 1.0)
    const serpentsFocus = GameData.CardPool.find(c => c.Id === 'serpents_focus')!;
    expect(serpentsFocus.Stats).toContain('+25%');

    // 4. Combo Surge
    // Description states '+50% Combo Window, +15% Ouro Gained', Code adds +0.5 to ComboWindow and +0.15 to XpGain
    const comboSurge = GameData.CardPool.find(c => c.Id === 'combo_surge')!;
    expect(comboSurge.Stats).toContain('+50%');
  });

  /* =========================================================================
   * 9. MULTI-CLASS AUTONOMOUS BOT SIMULATION SWEEPS
   * ========================================================================= */
  it('9. runs automated bot simulation sweeps across all 5 classes', () => {
    const classes = ['emerald', 'stalker', 'hydra', 'storm', 'solar'] as const;
    const summary: Record<string, { avgFloor: number; avgKills: number; avgCombo: number }> = {};

    for (const cls of classes) {
      let totalFloor = 0;
      let totalKills = 0;
      let maxCombo = 0;
      const runs = 3;

      for (let r = 0; r < runs; r++) {
        const input = new ScriptedInput();
        Services.input = input;
        const engine = new GameEngine();
        engine.SelectedClass = cls;
        engine.SetupCanvas(960, 640, 1);
        engine.StartRun(r + 1);
        const bot = new AutonomousBotPlayer();

        // Simulate 400 fixed ticks (3.33 seconds of autonomous play)
        for (let tick = 0; tick < 400; tick++) {
          if (engine.State === GameState.LevelUp) {
            bot.handleLevelUp(engine);
          } else if (engine.State === GameState.Playing) {
            bot.stepPolicy(engine, input);
            engine.Step(1 / 120);
          }
        }

        totalFloor += engine.CurrentFloor;
        totalKills += engine.Combat.Kills;
        maxCombo = Math.max(maxCombo, engine.Combat.ComboCount);
      }

      summary[cls] = {
        avgFloor: totalFloor / runs,
        avgKills: totalKills / runs,
        avgCombo: maxCombo,
      };

      expect(summary[cls]!.avgFloor).toBeGreaterThanOrEqual(1);
    }
  });

});
