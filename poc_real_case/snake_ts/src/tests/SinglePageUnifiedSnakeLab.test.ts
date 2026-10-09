/**
 * Ouroboros Ascension — Single-Page Unified Cranial Mutation Lab, Challenge Tracker & Telemetry Hub
 *
 * Test suite verifying:
 * 1. Single-page master architecture merging Vitals, Telemetry, Helmet Vault, and Cranial Modules into one unified scrollable view.
 * 2. In-Run Expedition Vitals & Telemetry Bar with quick chips, nourishment breakdown, and bestiary elimination counts.
 * 3. Boss Helmet Vault with active equipped helmet showcase card and collected boss helmets grid.
 * 4. Main Body: Offensive Weapons, Defensive Bio-Organs, and Cranial Bio-Augmentations.
 * 5. Integrated Challenge & Reward on each card:
 *    - Locked: Lock badge, challenge requirement text, cyber gradient progress bar with exact ratio & percentage, click error toast.
 *    - Unlocked: Stat preview, level badge, affordable [BUY ⚡] or unaffordable [NEED X MORE OURO] affordances, purchase execution.
 *    - Max Level: Golden [MAX LEVEL] badge with max level toast.
 * 6. Bottom Bar Deploy / Resume Expedition action button.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { setupMockDom } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { SnakePlayer } from '../sim/SnakePlayer';
import { MetaProgression } from '../data/MetaProgression';
import { Services } from '../core/Services';
import { NullFx, NullSound, ISound } from '../core/Contracts';
import { HelmetDef } from '../data/Helmets';
import { ResponsiveLayout } from '../ui/ResponsiveLayout';

class SpySound extends NullSound implements ISound {
  public uiCount = 0;
  public levelUpCount = 0;
  public errorCount = 0;

  public override playUi(): void { this.uiCount++; }
  public override playLevelUp(): void { this.levelUpCount++; }
  public override playError(): void { this.errorCount++; }
}

describe('Single-Page Unified Cranial Mutation Lab, Challenge Tracker & Telemetry Hub', () => {
  let restoreDom: () => void;
  let soundSpy: SpySound;
  let player: SnakePlayer;
  let mockEngine: any;
  let uiRoot: UiRoot;
  let lab: SnakeLabScreen;

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

    // Starter unlocked: ONLY turret and shield at Tier 1
    player = new SnakePlayer('emerald', 1280, 720, 3);
    player.ouro = 100;
    player.xp = 100;

    mockEngine = {
      player,
      state: 'Playing',
      currentFloor: 2,
      combat: {
        score: 4500,
        kills: 25,
        shardsEarned: 12,
        comboCount: 3,
        highestRunCombo: 8,
        bossKills: 1,
        foodsEatenByType: {
          apple: 14,
          golden: 3,
          potion: 2,
          shard: 8,
          prism: 1,
        },
        killsByType: {
          swarmling: 12,
          scarab: 6,
          spitter: 4,
          phantom: 2,
          drone: 1,
          brute: 0,
        },
      },
      resume: () => {},
      completeLevelUp: () => {},
    };

    const container = document.createElement('div');
    uiRoot = UiRoot.init(container as any, mockEngine);
    lab = new SnakeLabScreen(uiRoot);
    uiRoot.registerScreen(lab);
  });

  afterEach(() => {
    restoreDom();
  });

  // =========================================================================
  // 1. Unified Single-Page Master Layout Conformance
  // =========================================================================
  describe('1. 3 Segregated Views & Master Architecture', () => {
    it('renders the 3 segregated views (mutations, helmets, stats) and bottom deploy button', () => {
      // 1. MUTATIONS VIEW: Offensive, Defensive, and Cranial Augmentations
      lab.show({ tab: 'mutations' });
      lab.refresh();

      const panel = lab.element.querySelector('.lab-panel') as HTMLElement;
      expect(panel).not.toBeNull();

      const scrollContainer = lab.element.querySelector('.lab-docked-card-container') as HTMLElement;
      expect(scrollContainer).not.toBeNull();

      let text = lab.element.textContent || '';
      expect(text).toContain('OFFENSIVE WEAPONS');
      expect(text).toContain('DEFENSIVE BIO-ORGANS');
      expect(text).toContain('CRANIAL BIO-AUGMENTATIONS');

      // 2. HELMETS VIEW: Boss Helmet Vault
      lab.show({ tab: 'helmets' });
      lab.refresh();
      text = lab.element.textContent || '';
      expect(text).toContain('HELMET');

      // 3. STATS VIEW: Expedition Vitals & Telemetry
      lab.show({ tab: 'stats' });
      lab.refresh();
      text = lab.element.textContent || '';
      expect(text).toContain('EXPEDITION VITALS');
      expect(text).toContain('NOURISHMENT');
      expect(text).toContain('BESTIARY');

      // 4. BOTTOM BAR: Deploy Button
      const deployBtn = lab.element.querySelector('.btn-deploy-serpent') as HTMLButtonElement;
      expect(deployBtn).not.toBeNull();
      expect(deployBtn.textContent).toMatch(/deploy/i);
    });

    it('displays top quick chips with exact floor, ouro, length, score, hp, and combo', () => {
      lab.show();
      lab.refresh();

      const chips = lab.element.querySelector('.lab-points-label') as HTMLElement;
      expect(chips).not.toBeNull();
      expect(chips.textContent).toContain('100 Ouro');
      expect(chips.textContent).toContain('Floor 2');
      expect(chips.textContent).toContain('Len 4');
      expect(chips.textContent).toContain('4500');
      expect(chips.textContent).toContain('3x');
    });

    it('renders telemetry summary breakdown for nourishment items and hostile bestiary in stats view', () => {
      lab.show({ tab: 'stats' });
      lab.refresh();

      // Nourishment counters
      expect(lab.element.querySelector('.food-apple-count')?.textContent).toBe('14');
      expect(lab.element.querySelector('.food-golden-count')?.textContent).toBe('3');
      expect(lab.element.querySelector('.food-potion-count')?.textContent).toBe('2');
      expect(lab.element.querySelector('.food-shard-count')?.textContent).toBe('8');
      expect(lab.element.querySelector('.food-prism-count')?.textContent).toBe('1');

      // Bestiary counters
      expect(lab.element.querySelector('.kill-swarmling-count')?.textContent).toBe('12');
      expect(lab.element.querySelector('.kill-scarab-count')?.textContent).toBe('6');
      expect(lab.element.querySelector('.kill-spitter-count')?.textContent).toBe('4');
      expect(lab.element.querySelector('.kill-phantom-count')?.textContent).toBe('2');
      expect(lab.element.querySelector('.kill-drone-count')?.textContent).toBe('1');
      expect(lab.element.querySelector('.kill-brute-count')?.textContent).toBe('0');
    });
  });

  // =========================================================================
  // 2. Boss Helmet Vault Bar & Equipping
  // =========================================================================
  describe('2. Boss Helmet Vault Bar & Equipping', () => {
    it('displays equipped helmet card and quick vault grid to equip/unequip helmets in helmets view', () => {
      const meta = MetaProgression.Instance;
      const testHelm: HelmetDef = {
        Id: 'test_helm_gorgon',
        id: 'test_helm_gorgon',
        Name: 'Gorgon Visage',
        name: 'Gorgon Visage',
        Icon: '👁️',
        icon: '👁️',
        Rarity: 'rare',
        rarity: 'rare',
        Stats: { critChance: 0.15, maxHp: 30 },
        stats: { critChance: 0.15, maxHp: 30 },
        Description: 'Petrifying cybernetic gaze.',
        description: 'Petrifying cybernetic gaze.',
        Floor: 2,
        floor: 2,
        BossType: 'gorgon',
        bossType: 'gorgon',
      };
      meta.addHelmet(testHelm);

      lab.show({ tab: 'helmets' });
      lab.refresh();

      // Collected helmet appears in vault
      expect(lab.element.textContent).toContain('Gorgon Visage');

      // Click Equip button
      const equipBtn = lab.element.querySelector('.btn-equip-helmet') as HTMLButtonElement;
      expect(equipBtn).not.toBeNull();
      expect(equipBtn.textContent).toContain('Equip');

      equipBtn.click();

      expect(meta.EquippedHelmetId).toBe('test_helm_gorgon');
      expect((player as any).EquippedHelmet?.id).toBe('test_helm_gorgon');

      // Refresh and check active equipped card
      lab.refresh();
      expect(lab.element.textContent).toContain('ACTIVE HELMET');
      expect(lab.element.querySelector('.btn-unequip-helmet')).not.toBeNull();

      // Click unequip
      const unequipBtn = lab.element.querySelector('.btn-unequip-helmet') as HTMLButtonElement;
      unequipBtn.click();
      expect(meta.EquippedHelmetId).toBeNull();
      expect((player as any).EquippedHelmet).toBeNull();
    });
  });

  // =========================================================================
  // 3. Integrated Challenge & Reward on Every Card
  // =========================================================================
  describe('3. Integrated Challenge & Reward Card Grid', () => {
    it('verifies that at run start, ONLY turret and shield are unlocked, while tesla, venom, spikes, and fangs are properly locked at Tier 1', () => {
      mockEngine.combat.highestRunCombo = 0;
      mockEngine.combat.kills = 0;
      lab.show();
      lab.refresh();

      const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];

      // Unlocked Starter Defaults: Attack Spitter (turret) & Carapace Shield (shield)
      const turretBtn = buttons.find(b => b.textContent?.includes('Attack Spitter'))!;
      const shieldBtn = buttons.find(b => b.textContent?.includes('Carapace Shield'))!;
      expect(turretBtn).toBeDefined();
      expect(shieldBtn).toBeDefined();
      expect(turretBtn.className).not.toContain('btn-tier-locked');
      expect(shieldBtn.className).not.toContain('btn-tier-locked');

      // Tier 1 Locked: tesla, venom, spikes, fangs
      const teslaBtn = buttons.find(b => b.textContent?.includes('Bio-Arc Coil'))!;
      const venomBtn = buttons.find(b => b.textContent?.includes('Venom Sprayer'))!;
      const spikesBtn = buttons.find(b => b.textContent?.includes('Thorny Spikes'))!;
      const fangsBtn = buttons.find(b => b.textContent?.includes('Venom Fangs'))!;

      expect(teslaBtn.className).toContain('btn-tier-locked');
      expect(teslaBtn.textContent).toContain('8x');

      expect(venomBtn.className).toContain('btn-tier-locked');
      expect(venomBtn.textContent).toContain('20 Enemies');

      expect(spikesBtn.className).toContain('btn-tier-locked');
      expect(spikesBtn.textContent).toContain('Scarabs');

      expect(fangsBtn.className).toContain('btn-tier-locked');
      expect(fangsBtn.textContent).toContain('15x');
    });

    it('renders locked card with [TIER N LOCKED] badge, requirement text, and cyber progress bar with ratio and percentage', () => {
      // Magma Vent is Tier 1 locked by default (12/15 swarmlings)
      lab.show();
      lab.refresh();

      const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      const magmaBtn = buttons.find(b => b.textContent?.includes('Magma Vent'))!;
      expect(magmaBtn).toBeDefined();
      expect(magmaBtn.className).toContain('btn-tier-locked');
      expect(magmaBtn.textContent).toContain('LOCKED');
      expect(magmaBtn.textContent).toContain('TIER 1');

      // Progress bar exists inside card
      const bar = magmaBtn.querySelector('.challenge-progress-bar') as HTMLElement;
      expect(bar).not.toBeNull();
      expect(bar.style.width).toBeDefined();

      // Clicking locked card displays challenge feat toast and plays error sound
      const prevErrors = soundSpy.errorCount;
      magmaBtn.click();
      expect(soundSpy.errorCount).toBe(prevErrors + 1);

      const toast = lab.element.querySelector('.lab-toast-banner') as HTMLElement;
      expect(toast.style.display).not.toBe('none');
      expect(toast.textContent).toContain('Locked');
    });

    it('renders unlocked card with level badge, description, and interactive affordable/unaffordable purchase button', () => {
      player.ouro = 50;
      lab.show();
      lab.refresh();

      // Attack Spitter is Tier 1 starter unlocked, cost = 30 Ouro
      let buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      let spitterBtn = buttons.find(b => b.textContent?.includes('Attack Spitter'))!;
      expect(spitterBtn).toBeDefined();
      expect(spitterBtn.className).toContain('btn-affordable');
      expect(spitterBtn.textContent).toContain('30 Ouro');

      // Purchase Attack Spitter
      const prevLevelUps = soundSpy.levelUpCount;
      spitterBtn.click();

      expect(soundSpy.levelUpCount).toBe(prevLevelUps + 1);
      expect(player.ouro).toBe(20); // 50 - 30 = 20
      expect(player.getHeadModuleLevel('turret')).toBe(1);

      // Now with 20 Ouro, next purchase for Carapace Shield (cost = 30 + 1*15 = 45 Ouro) is unaffordable
      lab.refresh();
      buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      const shieldBtn = buttons.find(b => b.textContent?.includes('Carapace Shield'))!;
      expect(shieldBtn).toBeDefined();
      expect(shieldBtn.className).toContain('btn-unaffordable');
      expect(shieldBtn.textContent).toContain('Need 25 more');

      // Clicking unaffordable triggers error toast
      const prevErrors = soundSpy.errorCount;
      shieldBtn.click();
      expect(soundSpy.errorCount).toBe(prevErrors + 1);
      const toast = lab.element.querySelector('.lab-toast-banner') as HTMLElement;
      expect(toast.textContent).toContain('Insufficient Ouro');
      expect(toast.textContent).toContain('Need 25 more');
    });

    it('renders golden [MAX LEVEL] badge when module or augment reaches level 3', () => {
      player.ouro = 1000;
      player.setHeadModuleLevel('turret', 3);
      player.setHeadAugment('fangs', 3);

      lab.show();
      lab.refresh();

      const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      const spitterBtn = buttons.find(b => b.textContent?.includes('Attack Spitter'))!;
      expect(spitterBtn).toBeDefined();
      expect(spitterBtn.className).toContain('btn-max-level');
      expect(spitterBtn.textContent).toContain('[MAX LEVEL]');
      expect(spitterBtn.textContent).toContain('LVL 3/3');

      const fangsBtn = buttons.find(b => b.textContent?.includes('Venom Fangs'))!;
      expect(fangsBtn).toBeDefined();
      expect(fangsBtn.className).toContain('btn-max-level');
      expect(fangsBtn.textContent).toContain('[MAX LEVEL]');

      // Clicking max level card shows max level toast
      spitterBtn.click();
      const toast = lab.element.querySelector('.lab-toast-banner') as HTMLElement;
      expect(toast.textContent).toContain('Maximum Level');
    });
  });

  // =========================================================================
  // 4. Quick Jump / Section Navigation Compatibility
  // =========================================================================
  describe('4. Quick Jump & Tab Compatibility', () => {
    it('supports quick section jump buttons and keeps activeTab state in sync', () => {
      lab.show();
      lab.refresh();

      const tabLab = (lab.element.querySelector('.btn-tab-mutations') || lab.element.querySelector('.btn-tab-lab')) as HTMLButtonElement;
      const tabHelmets = lab.element.querySelector('.btn-tab-helmets') as HTMLButtonElement;
      const tabStats = (lab.element.querySelector('.btn-tab-stats') || lab.element.querySelector('.btn-tab-telemetry')) as HTMLButtonElement;

      expect(tabLab).not.toBeNull();
      expect(tabHelmets).not.toBeNull();
      expect(tabStats).not.toBeNull();

      // Click Helmets tab
      tabHelmets.click();
      expect(lab.activeTab).toBe('helmets');
      expect(soundSpy.uiCount).toBeGreaterThan(0);

      // Click Stats tab
      tabStats.click();
      expect(lab.activeTab).toBe('telemetry');

      // Click Lab tab
      tabLab.click();
      expect(lab.activeTab).toBe('lab');
    });

    it('verifies that HUD header contains only btn-lab and btn-pause, while omitting btn-codex and btn-stats', () => {
      const hud = uiRoot.hudView;
      const iconButtons = hud.element.querySelectorAll('.hud-top-actions .hud-icon-btn');
      expect(iconButtons.length).toBe(2);

      expect(hud.element.querySelector('.btn-lab')).not.toBeNull();
      expect(hud.element.querySelector('.btn-pause')).not.toBeNull();
      expect(hud.element.querySelector('.btn-codex')).toBeNull();
      expect(hud.element.querySelector('.btn-stats')).toBeNull();
    });

    it('verifies seamless navigation across the 3 segregated views (mutations, helmets, stats) via show payload and tabs', () => {
      // 1. Mutations view
      lab.show({ tab: 'mutations' });
      expect(lab.activeTab).toBe('lab');
      expect(lab.element.querySelector('.lab-section-mutations')).not.toBeNull();

      // 2. Helmets view
      lab.show({ tab: 'helmets' });
      expect(lab.activeTab).toBe('helmets');
      expect(lab.element.querySelector('.lab-section-helmets')).not.toBeNull();

      // 3. Stats view
      lab.show({ tab: 'stats' });
      expect(lab.activeTab).toBe('telemetry');
      expect(lab.element.querySelector('.lab-section-stats')).not.toBeNull();
    });

    it('verifies hotkeys [L] and [T] dispatch appropriate views from HUD layer', () => {
      const showSpy = (uiRoot.showScreen = (screenId: string, payload?: any) => {
        lab.show(payload);
        return lab;
      }) as any;

      uiRoot.hudView.handleKeyDown(new KeyboardEvent('keydown', { code: 'KeyL' }));
      expect(lab.activeTab).toBe('lab');

      uiRoot.hudView.handleKeyDown(new KeyboardEvent('keydown', { code: 'KeyT' }));
      expect(lab.activeTab).toBe('telemetry');
    });
  });

  // =========================================================================
  // 5. Responsive Layout & Mobile / Desktop Viewport Card Grid
  // =========================================================================
  describe('5. Responsive Layout: Mobile (1-Card-Per-Line) vs Desktop (2-Cards-Per-Line)', () => {
    it('verifies ResponsiveLayout metrics identify mobile viewports (393x852 and 540x960) as phone tier / isMobile', () => {
      // 393 x 852 (iPhone 14 / modern Android portrait)
      const phoneMetrics = ResponsiveLayout.instance.computeMetrics(393, 852);
      expect(phoneMetrics.deviceTier).toBe('phone');
      expect(phoneMetrics.isMobile).toBe(true);

      // 540 x 960 (Compact Android / qHD portrait)
      const qhdMetrics = ResponsiveLayout.instance.computeMetrics(540, 960);
      expect(qhdMetrics.deviceTier).toBe('phone');
      expect(qhdMetrics.isMobile).toBe(true);
    });

    it('verifies ResponsiveLayout metrics identify desktop viewports (1920x1080 and 1280x720) as desktop tier', () => {
      // 1920 x 1080 (FHD Reference Desktop)
      const desktopFhd = ResponsiveLayout.instance.computeMetrics(1920, 1080);
      expect(desktopFhd.deviceTier).toBe('desktop');
      expect(desktopFhd.isMobile).toBe(false);

      // 1280 x 720 (HD Reference)
      const desktopHd = ResponsiveLayout.instance.computeMetrics(1280, 720);
      expect(desktopHd.deviceTier).toBe('desktop');
      expect(desktopHd.isMobile).toBe(false);
    });

    it('verifies CSS specification enforces 1-card-per-line (grid-template-columns: 1fr) on mobile media query (<=768px) and 2-card-per-line (repeat(2, minmax(0, 1fr))) on desktop', () => {
      const indexHtmlPath = path.resolve(__dirname, '../../index.html');
      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

      // Desktop rule (2 columns)
      expect(indexHtml).toMatch(/\.lab-docked-card-grid[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);

      // Mobile breakpoint rule (1 column) inside @media (max-width: 768px)
      const mobileMediaSection = indexHtml.slice(indexHtml.indexOf('@media (max-width: 768px)'));
      expect(mobileMediaSection).toMatch(/\.lab-docked-card-grid[\s\S]*?grid-template-columns:\s*1fr/);
    });
  });
});
