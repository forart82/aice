/**
 * StarCurrencyAndZeroStartAudit.test.ts
 *
 * TDD Test Suite verifying:
 * 1. Player begins fresh with 0 Stars (no automatic 1,000 diamond testing grant at boot).
 * 2. MetaProgression supports `Stars` / `stars` property aliases and `AddStars` / `addStars` methods.
 * 3. Food entity and GameData definitions define the currency item as Cosmic Star with '⭐' glyph.
 * 4. Sanctuary, Codex, HUD, MenuScreen, StatsModalScreen, ClassSelectScreen, and RunSummaryScreen
 *    present Stars with '⭐' and proper "Stars" terminology instead of diamonds / shards.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockDom } from './MockDom.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { GameData } from '../data/GameData.js';
import { CodexData } from '../data/CodexData.js';
import { createDefaultMetaSave } from '../platform/SaveIO.js';
import { HudView } from '../ui/HudView.js';
import { MenuScreen } from '../ui/screens/MenuScreen.js';
import { SanctuaryScreen } from '../ui/screens/SanctuaryScreen.js';
import { ClassSelectScreen } from '../ui/screens/ClassSelectScreen.js';
import { RunSummaryScreen } from '../ui/screens/RunSummaryScreen.js';
import { StatsModalScreen } from '../ui/screens/StatsModalScreen.js';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen.js';
import { CombatSystem } from '../sim/CombatSystem.js';
import { Services } from '../core/Services.js';
import { FoodItem } from '../sim/FoodItem.js';
import { NullSound, NullFx } from '../core/Contracts.js';

import { SnakePlayer } from '../sim/SnakePlayer.js';

describe('Star Currency and Zero Start Audit', () => {
  let restoreDom: () => void;
  let mockRoot: any;
  let mockEngine: any;

  beforeEach(() => {
    restoreDom = setupMockDom();
    Services.sound = new NullSound();
    Services.fx = new NullFx();

    const player = new SnakePlayer('emerald');
    player.ouro = 150;

    mockEngine = {
      meta: new MetaProgression(),
      state: 'menu',
      State: 'menu',
      selectedClass: 'emerald',
      combat: {
        score: 1200,
        shardsEarned: 45,
        kills: 10,
        runTime: 65,
        floorShardsEarned: 45,
      },
      player,
      toast: (msg: string) => { mockEngine.lastToast = msg; },
      Toast: (msg: string) => { mockEngine.lastToast = msg; },
      lastToast: '',
      hudSet: () => {},
      showScreen: () => {},
    };

    mockRoot = {
      engine: mockEngine,
      showScreen: (id: string) => { mockRoot.activeScreen = id; },
      hudSet: () => {},
      activeScreen: '',
    };
  });

  afterEach(() => {
    restoreDom();
  });

  describe('1. Default Zero Stars Balance & MetaProgression Aliases', () => {
    it('1.1 fresh save file initializes with exactly 0 stars / shards', () => {
      const defaultSave = createDefaultMetaSave();
      expect(defaultSave.shards).toBe(0);

      const meta = new MetaProgression();
      expect(meta.Shards).toBe(0);
      expect(meta.shards).toBe(0);
      expect((meta as any).Stars).toBe(0);
      expect((meta as any).stars).toBe(0);
    });

    it('1.2 MetaProgression Stars and stars property getters/setters mutate Shards', () => {
      const meta = new MetaProgression() as any;
      meta.Stars = 150;
      expect(meta.Shards).toBe(150);
      expect(meta.stars).toBe(150);

      meta.stars = 300;
      expect(meta.Shards).toBe(300);
      expect(meta.Stars).toBe(300);
    });

    it('1.3 MetaProgression AddStars() and addStars() properly increment balance and records', () => {
      const meta = new MetaProgression() as any;
      const added1 = meta.AddStars(50);
      expect(added1).toBe(50);
      expect(meta.Stars).toBe(50);
      expect(meta.Records.TotalShards).toBe(50);

      const added2 = meta.addStars(25);
      expect(added2).toBe(25);
      expect(meta.stars).toBe(75);
      expect(meta.Records.TotalShards).toBe(75);
    });
  });

  describe('2. Game Data & Codex Presentation', () => {
    it('2.1 Food item shard definition uses ⭐ glyph and Cosmic Star name', () => {
      const shardDef = GameData.Foods.Get('shard');
      expect(shardDef).toBeDefined();
      expect(shardDef!.Glyph).toBe('⭐');
      expect(shardDef!.glyph).toBe('⭐');
      expect((shardDef as any).Name).toBe('Cosmic Star');
      expect((shardDef as any).name).toBe('Cosmic Star');
    });

    it('2.2 Greed meta-upgrade uses ⭐ icon, Star Harvest name, and +15% Stars earned bonus', () => {
      const greedDef = GameData.MetaUpgrades.Get('greed');
      expect(greedDef).toBeDefined();
      expect(greedDef!.Icon).toBe('⭐');
      expect(greedDef!.Name).toBe('Star Harvest');
      expect(greedDef!.Bonus).toBe('+15% Stars earned');
    });

    it('2.3 Codex entries present Cosmic Star with ⭐ and permanent Sanctuary Stars description', () => {
      const entries = CodexData.Entries || (CodexData as any);
      const foodCodex = entries.find((c: any) => c.id === 'rules_food_economy' || c.id === 'rules_food' || c.id === 'codex_pickups');
      expect(foodCodex).toBeDefined();
      expect(foodCodex!.contentHtml).toContain('⭐');
      expect(foodCodex!.contentHtml).toContain('Cosmic Star');
      expect(foodCodex!.contentHtml).toContain('+5 permanent Sanctuary Stars');
      expect(foodCodex!.contentHtml).not.toContain('💎</span><strong>Essence Shard');
    });
  });

  describe('3. UI Screen Presentations and Star Terminology', () => {
    it('3.1 HudView currency pill displays ⭐ and title tooltip "Stars"', () => {
      const hud = new HudView(mockRoot);
      const shardPill = hud.element.querySelector('.shard-pill');
      expect(shardPill).not.toBeNull();
      expect(shardPill?.getAttribute('title')).toBe('Stars');
      expect(shardPill?.querySelector('.pill-label')?.textContent).toBe('⭐');
    });

    it('3.2 MenuScreen currency pill displays ⭐ and tooltip "Stars"', () => {
      const menu = new MenuScreen(mockRoot);
      const shardPill = menu.element.querySelector('.shard-pill');
      expect(shardPill).not.toBeNull();
      expect(shardPill?.getAttribute('title')).toBe('Stars');
      expect(shardPill?.querySelector('.pill-label')?.textContent).toBe('⭐');
    });

    it('3.3 SanctuaryScreen displays ⭐ in currency banner and on upgrade buy buttons', () => {
      const sanctuary = new SanctuaryScreen(mockRoot);
      sanctuary.show();
      const banner = sanctuary.element.querySelector('.sanctuary-shard-banner');
      expect(banner?.textContent).toContain('⭐');
      expect(banner?.textContent).not.toContain('💎');

      const buyBtns = sanctuary.element.querySelectorAll('.btn-buy');
      expect(buyBtns.length).toBeGreaterThan(0);
      const firstBtnText = buyBtns[0]!.textContent || '';
      expect(firstBtnText).toContain('⭐');
      expect(firstBtnText).not.toContain('💎');
    });

    it('3.4 ClassSelectScreen displays ⭐ lock badge and toast requires stars', () => {
      const classSelect = new ClassSelectScreen(mockRoot);
      classSelect.show();
      const lockBadges = classSelect.element.querySelectorAll('.class-lock-badge');
      expect(lockBadges.length).toBeGreaterThan(0);
      expect(lockBadges[0]!.textContent).toContain('⭐');
      expect(lockBadges[0]!.textContent).not.toContain('💎');

      // Attempt to unlock without sufficient stars
      mockEngine.meta.Shards = 0;
      const lockedCard = classSelect.element.querySelector('.class-card.locked') as HTMLElement;
      expect(lockedCard).not.toBeNull();
      lockedCard.click();
      expect(mockEngine.lastToast).toContain('Need ⭐');
      expect(mockEngine.lastToast).toContain('stars to unlock');
      expect(mockEngine.lastToast).not.toContain('💎');
      expect(mockEngine.lastToast).not.toContain('shards');
    });

    it('3.5 RunSummaryScreen formats earned stars with ⭐ suffix', () => {
      const runSummary = new RunSummaryScreen(mockRoot);
      runSummary.show({ mode: 'game_over' });
      const statLabels = Array.from(runSummary.element.querySelectorAll('.stat-label')).map(el => el.textContent);
      expect(statLabels.some(l => l?.includes('STARS'))).toBe(true);

      const shardsVal = runSummary.element.querySelector('.shards-earned-val');
      expect(shardsVal?.textContent).toContain('⭐');
      expect(shardsVal?.textContent).not.toContain('💎');
    });

    it('3.6 StatsModalScreen displays ⭐ Available Stars, ⭐ Total Stars, and ⭐ Banked', () => {
      const statsModal = new StatsModalScreen(mockRoot);
      statsModal.show({ tab: 'run' });
      const statCards = Array.from(statsModal.element.querySelectorAll('.stat-card'));
      const starsCard = statCards.find(c => c.textContent?.includes('STARS BANKED'));
      expect(starsCard).toBeDefined();
      expect(starsCard?.textContent).toContain('⭐');

      statsModal.show({ tab: 'global' });
      const globalText = statsModal.element.textContent || '';
      expect(globalText).toContain('⭐ Total Stars');
      expect(globalText).toContain('⭐');
      expect(globalText).toContain('Available Stars');
      expect(globalText).not.toContain('Available Shards');
    });

    it('3.7 SnakeLabScreen displays STARS BANKED and ⭐ Stars in food breakdown', () => {
      const snakeLab = new SnakeLabScreen(mockRoot);
      snakeLab.show({ tab: 'stats' });
      const labText = snakeLab.element.textContent || '';
      expect(labText).toContain('STARS BANKED');
      expect(labText).toContain('⭐ Stars');
      expect(labText).not.toContain('💎 Shards');
    });
  });

  describe('4. Simulation & Combat Floating Text', () => {
    it('4.1 CombatSystem floating text emits +amount ⭐ when star food is eaten', () => {
      const combat = new CombatSystem();
      let capturedText = '';
      Services.fx.addText = (_x: number, _y: number, text: string) => {
        capturedText = text;
      };

      const food = new FoodItem(100, 100, 'shard');
      const world: any = {
        game: mockEngine,
        Game: mockEngine,
        player: mockEngine.player,
        Player: mockEngine.player,
      };

      combat.eatFood(food, world);
      expect(capturedText).toContain('⭐');
      expect(capturedText).not.toContain('💎');
    });
  });
});
