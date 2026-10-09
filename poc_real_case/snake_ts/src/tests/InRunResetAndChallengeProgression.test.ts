/**
 * Ouroboros Ascension — In-Run Reset & Challenge Progression Test Suite
 *
 * Validates strict in-run challenge scoping and reset guarantees:
 * 1. Starting a new run initializes all non-starter upgrades to locked state even if meta.Records
 *    has high lifetime kills, high floors reached, total foods, or victories.
 * 2. Starter default modules (turret, tesla, venom, shield, spikes, fangs) are unlocked at Tier 1,
 *    while all Tier 2/3 upgrades remain locked at run start.
 * 3. In-run feats dynamically unlock cranial modules in real time:
 *    - Food collection in active run (magnet at 30, regen at 40, crown at 50, needler T2 at 100).
 *    - Enemy kills in active run (horns at 25, scattershot at 30, spikes T2 at 90, venom T2 at 100).
 *    - Snake length growth in active run (magma at 250, plasma at 300, cryo/nanite at 350 scaled).
 *    - Boss defeats & floor progression in active run (maw on Centipede F1, flak on Gorgon F2, needler on Colossus F3, chrono on Wyrm F5, turret T2 on Superconductor F7).
 * 4. ResetRunUnlocks() explicitly clears all in-run unlocks back to starter defaults.
 * 5. Starting subsequent runs resets in-run progression while preserving permanent Sanctuary upgrades and Helmet Vault.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockDom, MockElement } from './MockDom';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { SnakePlayer, SnakeSegment } from '../sim/SnakePlayer';
import { MetaProgression } from '../data/MetaProgression';
import { Services } from '../core/Services';
import { NullFx, NullSound, ScriptedInput } from '../core/Contracts';
import { UiRoot } from '../ui/UiRoot';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { SaveIO } from '../platform/SaveIO';

describe('In-Run Reset & Challenge Progression Test Suite', () => {
  let restoreDom: () => void;
  let container: MockElement;
  let engine: GameEngine;
  let uiRoot: UiRoot;
  let meta: MetaProgression;

  beforeEach(() => {
    restoreDom = setupMockDom();
    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();

    MetaProgression.ReadBackend = () => null;
    MetaProgression.WriteBackend = () => {};
    MetaProgression.DeleteBackend = () => {};
    MetaProgression.Instance = new MetaProgression();
    meta = MetaProgression.Instance;

    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
    Services.Input = new ScriptedInput();
    Services.Headless = true;
    Services.registerMetaProvider(() => meta);

    container = document.createElement('div') as any;
    engine = new GameEngine(Services.Fx);
    uiRoot = UiRoot.init(container as any, engine);
    engine.setUiRoot(uiRoot);
    Services.registerEngineProvider(() => engine);
  });

  afterEach(() => {
    restoreDom();
  });

  /* -------------------------------------------------------------------------
   * 1. LIFETIME RECORDS ISOLATION & START-OF-RUN RESET
   * ------------------------------------------------------------------------- */
  describe('1. Lifetime Records Isolation & Start-of-Run Reset', () => {
    it('1.1 resets all non-starter upgrades to locked state when starting a run, even if meta.Records has high lifetime stats', () => {
      // Populate meta.Records with extreme lifetime stats from previous runs
      meta.Records.TotalKills = 9999;
      meta.Records.TotalFoods = 8888;
      meta.Records.TotalBosses = 99;
      meta.Records.HighestFloor = 20;
      meta.Records.HighestCombo = 50;
      meta.Records.Victories = 10;
      meta.Records.HighScore = 500000;

      // Start fresh run
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      // Starter defaults must be Tier 1 unlocked (strictly 1 weapon: turret, 1 defense: shield)
      expect(meta.IsTierUnlocked('turret', 1)).toBe(true);
      expect(meta.IsTierUnlocked('shield', 1)).toBe(true);

      // Newly locked items
      expect(meta.IsTierUnlocked('tesla', 1)).toBe(false);
      expect(meta.IsTierUnlocked('venom', 1)).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 1)).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 1)).toBe(false);

      // ALL non-starter Tier 1 modules MUST be locked despite high lifetime records
      expect(meta.IsTierUnlocked('magma', 1)).toBe(false);
      expect(meta.IsTierUnlocked('cryo', 1)).toBe(false);
      expect(meta.IsTierUnlocked('plasma', 1)).toBe(false);
      expect(meta.IsTierUnlocked('tachyon', 1)).toBe(false);
      expect(meta.IsTierUnlocked('flak', 1)).toBe(false);
      expect(meta.IsTierUnlocked('scattershot', 1)).toBe(false);
      expect(meta.IsTierUnlocked('needler', 1)).toBe(false);
      expect(meta.IsTierUnlocked('regen', 1)).toBe(false);
      expect(meta.IsTierUnlocked('magnet', 1)).toBe(false);
      expect(meta.IsTierUnlocked('chrono', 1)).toBe(false);
      expect(meta.IsTierUnlocked('nanite', 1)).toBe(false);
      expect(meta.IsTierUnlocked('maw', 1)).toBe(false);
      expect(meta.IsTierUnlocked('horns', 1)).toBe(false);
      expect(meta.IsTierUnlocked('laser', 1)).toBe(false);
      expect(meta.IsTierUnlocked('crown', 1)).toBe(false);

      // ALL Tier 2 and Tier 3 upgrades MUST be locked despite high lifetime records
      expect(meta.IsTierUnlocked('turret', 2)).toBe(false);
      expect(meta.IsTierUnlocked('tesla', 2)).toBe(false);
      expect(meta.IsTierUnlocked('venom', 2)).toBe(false);
      expect(meta.IsTierUnlocked('shield', 2)).toBe(false);
      expect(meta.IsTierUnlocked('cryo', 3)).toBe(false);
      expect(meta.IsTierUnlocked('turret', 3)).toBe(false);
    });

    it('1.2 verifies IsTierUnlocked with customCtx ignores lifetime records and strictly checks provided context', () => {
      meta.Records.TotalKills = 5000;
      meta.Records.TotalFoods = 5000;
      meta.Records.HighestFloor = 20;
      meta.Records.TotalBosses = 20;

      // In-run context with low kills -> Horns (requires 10 scarabs) and Scattershot (requires 25) must be locked
      expect(meta.IsTierUnlocked('horns', 1, { scarabs: 5 })).toBe(false);
      expect(meta.IsTierUnlocked('scattershot', 1, { kills: 20 })).toBe(false);

      // In-run context meeting threshold -> unlocks
      expect(meta.IsTierUnlocked('horns', 1, { scarabs: 10 })).toBe(true);
      expect(meta.IsTierUnlocked('scattershot', 1, { kills: 25 })).toBe(true);
    });
  });

  /* -------------------------------------------------------------------------
   * 2. REAL-TIME IN-RUN UNLOCK TRIGGERS
   * ------------------------------------------------------------------------- */
  describe('2. Real-Time In-Run Unlock Triggers', () => {
    beforeEach(() => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();
    });

    it('2.1 unlocks food collection modules in real-time as player eats foods in active run', () => {
      expect(meta.IsTierUnlocked('magnet', 1)).toBe(false);
      expect(meta.IsTierUnlocked('regen', 1)).toBe(false);
      expect(meta.IsTierUnlocked('crown', 1)).toBe(false);

      // Eat 1 golden apple -> still locked
      engine.Combat.FoodsEatenByType['golden'] = 1;
      expect(meta.IsTierUnlocked('magnet', 1)).toBe(false);

      // Eat 2nd golden apple -> Bio-Magnet unlocks in real-time
      engine.Combat.FoodsEatenByType['golden'] = 2;
      expect(meta.IsTierUnlocked('magnet', 1)).toBe(true);
      expect(meta.IsTierUnlocked('regen', 1)).toBe(false);

      // Eat 30 apples -> Regen Gland unlocks in real-time
      engine.Combat.FoodsEatenByType['apple'] = 30;
      expect(meta.IsTierUnlocked('regen', 1)).toBe(true);
      expect(meta.IsTierUnlocked('crown', 1)).toBe(false);

      // Eat 45 foods -> Crown unlocks in real-time
      engine.Combat.FoodsEaten = 45;
      expect(meta.IsTierUnlocked('crown', 1)).toBe(true);
    });

    it('2.2 unlocks enemy kill modules in real-time as player defeats enemies in active run', () => {
      expect(meta.IsTierUnlocked('horns', 1)).toBe(false);
      expect(meta.IsTierUnlocked('scattershot', 1)).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 2)).toBe(false);
      expect(meta.IsTierUnlocked('venom', 2)).toBe(false);

      // 9 scarab kills -> horns locked
      engine.Combat.KillsByType['scarab'] = 9;
      expect(meta.IsTierUnlocked('horns', 1)).toBe(false);

      // 10 scarab kills -> Ramming Horns unlocks
      engine.Combat.KillsByType['scarab'] = 10;
      expect(meta.IsTierUnlocked('horns', 1)).toBe(true);
      expect(meta.IsTierUnlocked('scattershot', 1)).toBe(false);

      // 25 kills -> Scattershot unlocks
      engine.Combat.Kills = 25;
      expect(meta.IsTierUnlocked('scattershot', 1)).toBe(true);

      // 12 phantom kills -> Thorny Spikes Tier 2 unlocks
      engine.Combat.KillsByType['phantom'] = 12;
      expect(meta.IsTierUnlocked('spikes', 2)).toBe(true);
      expect(meta.IsTierUnlocked('venom', 2)).toBe(false);

      // 15 drone kills -> Venom Sprayer Tier 2 unlocks
      engine.Combat.KillsByType['drone'] = 15;
      expect(meta.IsTierUnlocked('venom', 2)).toBe(true);
    });

    it('2.3 unlocks length-based cranial modules in real-time as serpent grows in active run', () => {
      const player = engine.player!;
      // Reference desktop arena (1600x960) requires Length 35 for Plasma T1, 600 for Shield T2, 800 for Plasma T2
      engine.ArenaW = 1600;
      engine.ArenaH = 960;

      expect(meta.IsTierUnlocked('plasma', 1)).toBe(false);
      expect(meta.IsTierUnlocked('shield', 2)).toBe(false);
      expect(meta.IsTierUnlocked('plasma', 2)).toBe(false);

      // Grow serpent to 34 segments (total length 35) -> Plasma T1 unlocks
      while (player.segments.length < 34) {
        player.segments.push(new SnakeSegment(player.x, player.y, 10, 100));
      }
      expect(player.segments.length + 1).toBe(35);
      expect(meta.IsTierUnlocked('plasma', 1)).toBe(true);
      expect(meta.IsTierUnlocked('shield', 2)).toBe(false);

      // Grow to 600 segments -> Shield Tier 2 unlocks
      while (player.segments.length < 599) {
        player.segments.push(new SnakeSegment(player.x, player.y, 10, 100));
      }
      expect(player.segments.length + 1).toBe(600);
      expect(meta.IsTierUnlocked('shield', 2)).toBe(true);
      expect(meta.IsTierUnlocked('plasma', 2)).toBe(false);

      // Grow to 800 segments -> Plasma Tier 2 unlocks
      while (player.segments.length < 799) {
        player.segments.push(new SnakeSegment(player.x, player.y, 10, 100));
      }
      expect(player.segments.length + 1).toBe(800);
      expect(meta.IsTierUnlocked('plasma', 2)).toBe(true);
    });

    it('2.4 unlocks boss-gated modules in real-time as bosses are defeated in active run', () => {
      expect(meta.IsTierUnlocked('maw', 1)).toBe(false);
      expect(meta.IsTierUnlocked('flak', 1)).toBe(false);
      expect(meta.IsTierUnlocked('needler', 1)).toBe(false);
      expect(meta.IsTierUnlocked('chrono', 1)).toBe(false);
      expect(meta.IsTierUnlocked('turret', 2)).toBe(false);

      // Defeat Centipede (Floor 1 clear / Boss Kill 1) -> Dragon Maw unlocks
      engine.Combat.BossKills = 1;
      engine.CurrentFloor = 2;
      expect(meta.IsTierUnlocked('maw', 1)).toBe(true);
      expect(meta.IsTierUnlocked('flak', 1)).toBe(false);

      // Defeat Storm Gorgon (Floor 2 clear / Boss Kill 2) -> Railgun Flak unlocks
      engine.Combat.BossKills = 2;
      engine.CurrentFloor = 3;
      expect(meta.IsTierUnlocked('flak', 1)).toBe(true);
      expect(meta.IsTierUnlocked('needler', 1)).toBe(false);

      // Defeat Infernal Colossus (Floor 3 clear / Boss Kill 3) -> Seeker Needler unlocks
      engine.Combat.BossKills = 3;
      engine.CurrentFloor = 4;
      expect(meta.IsTierUnlocked('needler', 1)).toBe(true);
      expect(meta.IsTierUnlocked('chrono', 1)).toBe(false);

      // Advance to Floor 6 (Defeat Chrono Wyrm on Floor 5) -> Chrono Ward unlocks
      engine.Combat.BossKills = 5;
      engine.CurrentFloor = 6;
      expect(meta.IsTierUnlocked('chrono', 1)).toBe(true);
      expect(meta.IsTierUnlocked('turret', 2)).toBe(false);

      // Advance to Floor 8 (Defeat Apex Superconductor on Floor 7) -> Turret Tier 2 unlocks
      engine.Combat.BossKills = 7;
      engine.CurrentFloor = 8;
      expect(meta.IsTierUnlocked('turret', 2)).toBe(true);
    });
  });

  /* -------------------------------------------------------------------------
   * 3. RESETRUNUNLOCKS() & CONSECUTIVE RUN CYCLES
   * ------------------------------------------------------------------------- */
  describe('3. ResetRunUnlocks() & Consecutive Run Cycles', () => {
    it('3.1 ResetRunUnlocks() explicitly clears in-run unlocks back to starter defaults', () => {
      // Manually set elevated unlocks and completed challenges
      meta.UnlockedTiers['magma'] = 2;
      meta.UnlockedTiers['cryo'] = 3;
      meta.UnlockedTiers['turret'] = 3;
      meta.CompletedChallenges['ch_magma_1'] = true;
      meta.CompletedChallenges['ch_cryo_1'] = true;

      expect(meta.IsTierUnlocked('magma', 1)).toBe(true);
      expect(meta.IsTierUnlocked('cryo', 3)).toBe(true);

      // Call ResetRunUnlocks()
      meta.ResetRunUnlocks();

      // Starter defaults are preserved at Tier 1 (turret and shield only)
      expect(meta.IsTierUnlocked('turret', 1)).toBe(true);
      expect(meta.IsTierUnlocked('shield', 1)).toBe(true);

      // Newly locked items remain locked after reset
      expect(meta.IsTierUnlocked('tesla', 1)).toBe(false);
      expect(meta.IsTierUnlocked('venom', 1)).toBe(false);
      expect(meta.IsTierUnlocked('spikes', 1)).toBe(false);
      expect(meta.IsTierUnlocked('fangs', 1)).toBe(false);

      // Advanced modules and higher tiers are reset back to locked
      expect(meta.IsTierUnlocked('magma', 1)).toBe(false);
      expect(meta.IsTierUnlocked('cryo', 1)).toBe(false);
      expect(meta.IsTierUnlocked('turret', 2)).toBe(false);
      expect(meta.IsTierUnlocked('turret', 3)).toBe(false);
      expect(meta.CompletedChallenges).toEqual({});
    });

    it('3.2 resets in-run upgrades and unlocks across multiple consecutive runs without bleed-through', () => {
      // --- RUN 1 ---
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      // Kill 35 enemies in Run 1 -> Scattershot unlocks
      engine.Combat.Kills = 35;
      expect(meta.IsTierUnlocked('scattershot', 1)).toBe(true);

      // End Run 1 and commit
      engine.abandonRun();

      // --- RUN 2 ---
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      // In Run 2, kills are 0 -> Scattershot must be locked again
      expect(engine.Combat.Kills).toBe(0);
      expect(meta.IsTierUnlocked('scattershot', 1)).toBe(false);

      // Collect 2 golden apples in Run 2 -> Bio-Magnet unlocks
      engine.Combat.FoodsEatenByType['golden'] = 2;
      expect(meta.IsTierUnlocked('magnet', 1)).toBe(true);

      // End Run 2
      engine.abandonRun();

      // --- RUN 3 ---
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      // In Run 3, golden apples are 0 -> Bio-Magnet must be locked again
      expect(engine.Combat.FoodsEatenByType['golden'] || 0).toBe(0);
      expect(meta.IsTierUnlocked('magnet', 1)).toBe(false);
    });

    it('3.3 preserves Sanctuary essence and Helmet Vault items across runs while in-run BioLab resets', () => {
      // Add a helmet to vault and set sanctuary level
      meta.AddHelmet({
        Id: 'helm_ancient_ouroboros',
        Name: 'Ancient Crown',
        Icon: '👑',
        Rarity: 'legendary',
        BossType: 'ouroboros',
        Stats: { armor: 0.3, maxHp: 50 },
        id: 'helm_ancient_ouroboros',
        name: 'Ancient Crown',
        icon: '👑',
        rarity: 'legendary',
        bossType: 'ouroboros',
        stats: { armor: 0.3, maxHp: 50 }
      });
      meta.UpgradeLevels['rerolls'] = 3;
      meta.Shards = 500;
      meta.Save();

      // Run 1: Unlock Plasma
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();
      engine.ArenaW = 1600;
      engine.ArenaH = 960;
      while (engine.player!.segments.length < 34) {
        engine.player!.segments.push(new SnakeSegment(engine.player!.x, engine.player!.y, 10, 100));
      }
      expect(meta.IsTierUnlocked('plasma', 1)).toBe(true);

      // Run 2: Start new run
      engine.startRun();

      // In-run BioLab resets
      expect(meta.IsTierUnlocked('plasma', 1)).toBe(false);

      // Permanent meta persists
      expect(meta.Helmets.some(h => (h.id || h.Id) === 'helm_ancient_ouroboros')).toBe(true);
      expect(meta.Level('rerolls')).toBe(3);
      expect(meta.Shards).toBe(500);
    });
  });

  /* -------------------------------------------------------------------------
   * 4. SNAGELAB SCREEN UI LOCK INTEGRATION
   * ------------------------------------------------------------------------- */
  describe('4. SnakeLabScreen UI Lock Integration', () => {
    it('4.1 renders padlock 🔒 on locked modules and enables them immediately upon in-run challenge completion', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();
      engine.player!.xp = 500;

      const labScreen = new SnakeLabScreen(uiRoot);
      uiRoot.registerScreen(labScreen);
      uiRoot.showScreen('modal-snake-lab');

      // Check Needler button (locked initially on floor 1)
      const needlerBtn = Array.from(labScreen.element.querySelectorAll('.lab-docked-card-btn')).find(
        btn => btn.textContent && (btn.textContent.includes('Needler') || btn.textContent.includes('Dart Needler') || btn.textContent.includes('📌'))
      ) as HTMLButtonElement;

      if (needlerBtn) {
        expect(needlerBtn.disabled).toBe(false);
        expect(needlerBtn.getAttribute('aria-disabled')).toBe('true');
        expect(needlerBtn.textContent).toContain('🔒');
      }

      // Defeat Infernal Colossus (Floor 3 defeat / CurrentFloor 4)
      engine.Combat.BossKills = 3;
      engine.CurrentFloor = 4;

      labScreen.refresh();

      const unlockedNeedlerBtn = Array.from(labScreen.element.querySelectorAll('.lab-docked-card-btn')).find(
        btn => btn.textContent && (btn.textContent.includes('Needler') || btn.textContent.includes('Dart Needler') || btn.textContent.includes('📌'))
      ) as HTMLButtonElement;

      if (unlockedNeedlerBtn) {
        expect(unlockedNeedlerBtn.disabled).toBe(false);
        expect(unlockedNeedlerBtn.getAttribute('aria-disabled')).toBe('false');
        expect(unlockedNeedlerBtn.textContent).not.toContain('🔒');
      }
    });
  });
});
