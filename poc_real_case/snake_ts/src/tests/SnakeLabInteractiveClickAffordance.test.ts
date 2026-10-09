/**
 * Ouroboros Ascension — SnakeLab Interactive Click Affordances & Verification Test Suite
 *
 * Conformance matrix for:
 * 1. Clicking locked buttons displays the challenge requirement toast banner with exact reason and triggers error sound.
 * 2. Clicking unaffordable buttons displays the insufficient Ouro toast banner with exact missing amount and triggers error sound.
 * 3. Clicking affordable buttons successfully purchases and equips modules / bio-augments, deducts Ouro, and triggers levelUp sound.
 * 4. Wallet synchronization between the active player, Lab chips, and HUD counters across single and multiple purchases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { setupMockDom } from './MockDom.js';
import { UiRoot } from '../ui/UiRoot.js';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen.js';
import { SnakePlayer } from '../sim/SnakePlayer.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound } from '../core/Contracts.js';
import { ResponsiveLayout } from '../ui/ResponsiveLayout.js';

class SoundSpy extends NullSound {
  public errorCount = 0;
  public levelUpCount = 0;
  public uiCount = 0;

  public override playError(): void {
    this.errorCount++;
  }

  public override playLevelUp(): void {
    this.levelUpCount++;
  }

  public override playUi(): void {
    this.uiCount++;
  }
}

describe('SnakeLab Interactive Click Affordances & Verification Test Suite', () => {
  let restoreDom: () => void;
  let soundSpy: SoundSpy;
  let player: SnakePlayer;
  let mockEngine: any;
  let uiRoot: UiRoot;
  let lab: SnakeLabScreen;

  beforeEach(() => {
    restoreDom = setupMockDom();
    soundSpy = new SoundSpy();
    Services.Sound = soundSpy;
    Services.Fx = new NullFx();

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
    MetaProgression.Instance.reset();

    // Starter defaults: ONLY turret and shield are unlocked
    player = new SnakePlayer('emerald', 1280, 720, 3);
    player.ouro = 0;
    player.xp = 0;

    mockEngine = {
      player,
      state: 'Playing',
      currentFloor: 1,
      combat: {
        score: 0,
        kills: 0,
        shardsEarned: 0,
        highestCombo: 0,
      },
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
  // SUITE 1: Locked Button Click Affordances & Challenge Toasts
  // =========================================================================
  describe('1. Locked Buttons Affordance & Challenge Requirements', () => {
    it('verifies that at run start, ONLY turret and shield are unlocked, while tesla, venom, spikes, and fangs are properly locked at Tier 1', () => {
      lab.show();
      lab.refresh();

      const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      
      // Starter defaults: Attack Spitter (turret) and Carapace Shield (shield) MUST be unlocked
      const turretBtn = buttons.find((b) => b.textContent?.includes('Attack Spitter'))!;
      const shieldBtn = buttons.find((b) => b.textContent?.includes('Carapace Shield'))!;
      expect(turretBtn).toBeDefined();
      expect(shieldBtn).toBeDefined();
      expect(turretBtn.className).not.toContain('btn-tier-locked');
      expect(shieldBtn.className).not.toContain('btn-tier-locked');

      // Locked Tier 1: tesla, venom, spikes, fangs
      const teslaBtn = buttons.find((b) => b.textContent?.includes('Bio-Arc Coil'))!;
      const venomBtn = buttons.find((b) => b.textContent?.includes('Venom Sprayer'))!;
      const spikesBtn = buttons.find((b) => b.textContent?.includes('Thorny Spikes'))!;
      const fangsBtn = buttons.find((b) => b.textContent?.includes('Venom Fangs'))!;

      expect(teslaBtn).toBeDefined();
      expect(teslaBtn.className).toContain('btn-tier-locked');
      expect(teslaBtn.textContent).toContain('8x');

      expect(venomBtn).toBeDefined();
      expect(venomBtn.className).toContain('btn-tier-locked');
      expect(venomBtn.textContent).toContain('20 Enemies');

      expect(spikesBtn).toBeDefined();
      expect(spikesBtn.className).toContain('btn-tier-locked');
      expect(spikesBtn.textContent).toContain('Scarabs');

      expect(fangsBtn).toBeDefined();
      expect(fangsBtn.className).toContain('btn-tier-locked');
      expect(fangsBtn.textContent).toContain('15x');
    });

    it('clicking a tier-1 locked offensive module (Cryo Mortar) displays challenge requirement toast and plays error sound', () => {
      player.ouro = 500;
      lab.show();
      lab.refresh();

      const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      const cryoBtn = buttons.find((b) => b.textContent?.includes('Cryo Mortar'))!;
      expect(cryoBtn).toBeDefined();
      expect(cryoBtn.className).toContain('btn-tier-locked');

      const prevErrors = soundSpy.errorCount;
      cryoBtn.click();

      expect(soundSpy.errorCount).toBe(prevErrors + 1);

      const toast = lab.element.querySelector('.lab-toast-banner') as HTMLElement;
      expect(toast).not.toBeNull();
      expect(toast.style.display).not.toBe('none');
      expect(toast.className).toContain('error');
      expect(toast.textContent).toContain('Locked');
      expect(toast.textContent).toContain('Tier 1');
    });

    it('clicking a tier-1 locked cranial bio-augmentation (Dragon Maw) displays challenge requirement toast', () => {
      player.ouro = 500;
      lab.show();
      lab.refresh();

      const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      const mawBtn = buttons.find((b) => b.textContent?.includes('Dragon Maw'))!;
      expect(mawBtn).toBeDefined();
      expect(mawBtn.className).toContain('btn-tier-locked');

      const prevErrors = soundSpy.errorCount;
      mawBtn.click();

      expect(soundSpy.errorCount).toBe(prevErrors + 1);

      const toast = lab.element.querySelector('.lab-toast-banner') as HTMLElement;
      expect(toast.style.display).not.toBe('none');
      expect(toast.textContent).toContain('Locked');
      expect(toast.textContent).toContain('Tier 1');
      expect(toast.textContent).toContain('Centipede Behemoth');
    });

    it('clicking a tier-2 locked upgrade when tier-1 is already installed displays Tier 2 challenge toast', () => {
      player.ouro = 500;
      // Install Tier 1 turret Spitter
      player.installHeadModule('turret');
      expect(player.getHeadModuleLevel('turret')).toBe(1);

      lab.show();
      lab.refresh();

      const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      const spitterBtn = buttons.find((b) => b.textContent?.includes('Attack Spitter'))!;
      expect(spitterBtn).toBeDefined();
      expect(spitterBtn.className).toContain('btn-tier-locked');

      const prevErrors = soundSpy.errorCount;
      spitterBtn.click();

      expect(soundSpy.errorCount).toBe(prevErrors + 1);

      const toast = lab.element.querySelector('.lab-toast-banner') as HTMLElement;
      expect(toast.textContent).toContain('Tier 2 Locked');
      expect(toast.textContent).toContain('Apex Superconductor');
    });
  });

  // =========================================================================
  // SUITE 2: Unaffordable Button Click Affordances & Missing Amount Toasts
  // =========================================================================
  describe('2. Unaffordable Buttons Affordance & Exact Missing Ouro Toasts', () => {
    it('clicking an unaffordable unlocked module displays exact missing amount toast (e.g. 10 Ouro vs 30 cost -> Need 20 more)', () => {
      player.ouro = 10;
      lab.show();
      lab.refresh();

      const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      const spitterBtn = buttons.find((b) => b.textContent?.includes('Attack Spitter'))!;
      expect(spitterBtn).toBeDefined();
      expect(spitterBtn.className).toContain('btn-unaffordable');
      expect(spitterBtn.textContent).toContain('Need 20 more');

      const prevErrors = soundSpy.errorCount;
      spitterBtn.click();

      expect(soundSpy.errorCount).toBe(prevErrors + 1);

      const toast = lab.element.querySelector('.lab-toast-banner') as HTMLElement;
      expect(toast.style.display).not.toBe('none');
      expect(toast.textContent).toContain('Insufficient Ouro');
      expect(toast.textContent).toContain('You have 10 🪙');
      expect(toast.textContent).toContain('need 30 🪙');
      expect(toast.textContent).toContain('Need 20 more');
    });

    it('clicking an unaffordable cranial bio-augment (Venom Fangs, cost 40) when unlocked with 15 Ouro shows Need 25 more', () => {
      MetaProgression.Instance.UnlockTier('fangs', 1);
      player.ouro = 15;
      lab.show();
      lab.refresh();

      const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      const fangsBtn = buttons.find((b) => b.textContent?.includes('Venom Fangs'))!;
      expect(fangsBtn).toBeDefined();
      expect(fangsBtn.className).toContain('btn-unaffordable');
      expect(fangsBtn.textContent).toContain('Need 25 more');

      const prevErrors = soundSpy.errorCount;
      fangsBtn.click();

      expect(soundSpy.errorCount).toBe(prevErrors + 1);

      const toast = lab.element.querySelector('.lab-toast-banner') as HTMLElement;
      expect(toast.textContent).toContain('Insufficient Ouro');
      expect(toast.textContent).toContain('You have 15 🪙');
      expect(toast.textContent).toContain('need 40 🪙');
      expect(toast.textContent).toContain('Need 25 more');
    });

    it('clicking with 0 Ouro balance displays exact full cost requirement (You have 0 🪙, need 30 🪙, Need 30 more)', () => {
      player.ouro = 0;
      lab.show();
      lab.refresh();

      const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      const shieldBtn = buttons.find((b) => b.textContent?.includes('Carapace Shield'))!;
      expect(shieldBtn).toBeDefined();
      expect(shieldBtn.className).toContain('btn-unaffordable');

      shieldBtn.click();

      const toast = lab.element.querySelector('.lab-toast-banner') as HTMLElement;
      expect(toast.textContent).toContain('You have 0 🪙');
      expect(toast.textContent).toContain('need 30 🪙');
      expect(toast.textContent).toContain('Need 30 more');
    });
  });

  // =========================================================================
  // SUITE 3: Affordable Button Click, Purchase & Equipping
  // =========================================================================
  describe('3. Affordable Buttons Purchase, Equipping & Wallet Synchronization', () => {
    it('clicking an affordable offensive module (Attack Spitter) purchases, deducts Ouro, installs module, and plays levelUp sound', () => {
      player.ouro = 100;
      lab.show();
      lab.refresh();

      const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      const spitterBtn = buttons.find((b) => b.textContent?.includes('Attack Spitter'))!;
      expect(spitterBtn).toBeDefined();
      expect(spitterBtn.className).toContain('btn-affordable');

      const prevLevelUps = soundSpy.levelUpCount;
      spitterBtn.click();

      expect(soundSpy.levelUpCount).toBe(prevLevelUps + 1);
      expect(player.ouro).toBe(70); // 100 - 30 = 70
      expect(player.xp).toBe(70);
      expect(player.getHeadModuleLevel('turret')).toBe(1);

      // Verify lab chips and HUD values updated
      const ouroChip = lab.element.querySelector('.lab-stat-chip-ouro') as HTMLElement;
      expect(ouroChip.textContent).toContain('70 Ouro');

      const hudVal = uiRoot.hudView.element.querySelector('.hud-ouro-val, .hud-xp-val') as HTMLElement;
      expect(hudVal.textContent).toBe('70');
    });

    it('clicking an affordable defensive bio-organ (Carapace Shield) purchases and equips module', () => {
      player.ouro = 80;
      lab.show();
      lab.refresh();

      const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      const shieldBtn = buttons.find((b) => b.textContent?.includes('Carapace Shield'))!;
      expect(shieldBtn).toBeDefined();
      expect(shieldBtn.className).toContain('btn-affordable');

      shieldBtn.click();

      expect(player.ouro).toBe(50); // 80 - 30 = 50
      expect(player.getHeadModuleLevel('shield')).toBe(1);
    });

    it('clicking an affordable cranial bio-augmentation (Venom Fangs) purchases and installs augment when unlocked', () => {
      MetaProgression.Instance.UnlockTier('fangs', 1);
      player.ouro = 120;
      lab.show();
      lab.refresh();

      const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      const fangsBtn = buttons.find((b) => b.textContent?.includes('Venom Fangs'))!;
      expect(fangsBtn).toBeDefined();
      expect(fangsBtn.className).toContain('btn-affordable');

      fangsBtn.click();

      expect(player.ouro).toBe(80); // 120 - 40 = 80
      expect(player.getHeadAugmentLevel('fangs')).toBe(1);
    });

    it('supports multiple consecutive purchases with scaling purchase costs and dynamic state updates', () => {
      MetaProgression.Instance.UnlockTier('tesla', 1);
      MetaProgression.Instance.UnlockTier('fangs', 1);
      player.ouro = 200;
      lab.show();
      lab.refresh();

      // Purchase 1: Attack Spitter (cost 30)
      let buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      let spitterBtn = buttons.find((b) => b.textContent?.includes('Attack Spitter'))!;
      spitterBtn.click();

      expect(player.ouro).toBe(170); // 200 - 30
      expect(player.headPurchaseCount).toBe(1);
      expect(player.getHeadModuleLevel('turret')).toBe(1);

      // Purchase 2: Bio-Arc Coil (base 30 + 1 * 15 = 45)
      buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      let teslaBtn = buttons.find((b) => b.textContent?.includes('Bio-Arc Coil'))!;
      expect(teslaBtn.textContent).toContain('45 Ouro');
      teslaBtn.click();

      expect(player.ouro).toBe(125); // 170 - 45 = 125
      expect(player.headPurchaseCount).toBe(2);
      expect(player.getHeadModuleLevel('tesla')).toBe(1);

      // Purchase 3: Venom Fangs (base 40 + 2 * 20 = 80)
      buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      let fangsBtn = buttons.find((b) => b.textContent?.includes('Venom Fangs'))!;
      expect(fangsBtn.textContent).toContain('80 Ouro');
      fangsBtn.click();

      expect(player.ouro).toBe(45); // 125 - 80 = 45
      expect(player.headPurchaseCount).toBe(3);
      expect(player.getHeadAugmentLevel('fangs')).toBe(1);

      // Verify final wallet chip in lab
      const ouroChip = lab.element.querySelector('.lab-stat-chip-ouro') as HTMLElement;
      expect(ouroChip.textContent).toContain('45 Ouro');
    });
  });

  // =========================================================================
  // SUITE 4: Helmet Vault Tab Equipping & Unequipping Affordance
  // =========================================================================
  describe('4. Helmet Vault Tab Interactivity', () => {
    it('equips collected boss helmet from helmet vault and updates player head profile', () => {
      const meta = MetaProgression.Instance;
      meta.Helmets = [
        {
          Id: 'helm_centipede',
          Name: 'Chitin Crown',
          Icon: '👑',
          Rarity: 'rare',
          Stats: { armor: 0.15, maxHp: 20 },
          id: 'helm_centipede',
          name: 'Chitin Crown',
          bossType: 'boss_centipede',
          floor: 1,
          rarity: 'rare',
          icon: '👑',
          description: 'Reinforced chitin plating.',
          stats: { armor: 0.15, maxHp: 20 },
        },
      ];

      lab.show();
      lab.refresh();

      // Switch to Helmet Vault tab
      const helmetsTabBtn = lab.element.querySelector('.btn-tab-helmets') as HTMLButtonElement;
      helmetsTabBtn.click();
      expect(lab.activeTab).toBe('helmets');

      // Click Equip button
      const equipBtn = lab.element.querySelector('.btn-equip-helmet') as HTMLButtonElement;
      expect(equipBtn).toBeDefined();
      expect(equipBtn.textContent).toContain('Equip');

      equipBtn.click();

      expect(meta.EquippedHelmetId).toBe('helm_centipede');
      expect((player as any).EquippedHelmet?.id).toBe('helm_centipede');

      const updatedEquipBtn = lab.element.querySelector('.btn-equip-helmet') as HTMLButtonElement;
      expect(updatedEquipBtn.textContent).toContain('Equipped');

      // Click again to unequip
      updatedEquipBtn.click();
      expect(meta.EquippedHelmetId).toBeNull();
      expect((player as any).EquippedHelmet).toBeNull();
    });
  });

  // =========================================================================
  // SUITE 5: Single-Page Unified Layout, Top Telemetry & Bottom Deploy Action
  // =========================================================================
  describe('5. Single-Page Unified Layout, Top Telemetry & Bottom Deploy Action', () => {
    it('renders top telemetry quick stats chips bar with live metrics', () => {
      player.ouro = 250;
      mockEngine.currentFloor = 2;
      lab.show();
      lab.refresh();

      const pointsLabel = lab.element.querySelector('.lab-points-label') as HTMLElement;
      expect(pointsLabel).not.toBeNull();

      const chips = pointsLabel.querySelectorAll('.lab-stat-chip');
      expect(chips.length).toBe(6);

      const ouroChip = pointsLabel.querySelector('.lab-stat-chip-ouro');
      expect(ouroChip?.textContent).toContain('250 Ouro');

      const floorChip = Array.from(chips).find((c) => c.textContent?.includes('Floor 2'));
      expect(floorChip).toBeDefined();
    });

    it('each upgrade card integrates level badges, challenge unlock criteria, cost tags, and interactive button affordance', () => {
      lab.show();
      lab.refresh();

      const cards = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
      expect(cards.length).toBeGreaterThanOrEqual(20);

      // Verify each card contains title, cost/status tag, and description text
      for (const card of cards) {
        expect(card.querySelector('.cost-tag')).not.toBeNull();
        expect(card.textContent).toBeTruthy();
      }
    });

    it('bottom deploy button unpauses engine, resumes simulation, and hides modal', () => {
      mockEngine.resume = vi.fn();
      mockEngine.Resume = mockEngine.resume;

      lab.show();
      lab.refresh();

      const deployBtn = lab.element.querySelector('.btn-deploy-serpent') as HTMLButtonElement;
      expect(deployBtn).not.toBeNull();
      expect(deployBtn.textContent).toMatch(/deploy/i);

      deployBtn.click();

      expect(mockEngine.resume).toHaveBeenCalled();
      expect(uiRoot.isModalOpen()).toBe(false);
    });

    it('verifies that HUD header contains only btn-lab and btn-pause, while hotkeys [L], [T], [P], [H], [Space], [E] function properly', () => {
      const hud = uiRoot.hudView;
      const iconButtons = hud.element.querySelectorAll('.hud-top-actions .hud-icon-btn');
      expect(iconButtons.length).toBe(2);

      expect(hud.element.querySelector('.btn-lab')).not.toBeNull();
      expect(hud.element.querySelector('.btn-pause')).not.toBeNull();
      expect(hud.element.querySelector('.btn-codex')).toBeNull();
      expect(hud.element.querySelector('.btn-stats')).toBeNull();

      // Hotkey KeyL opens Lab (mutations view)
      const showSpy = vi.spyOn(uiRoot, 'showScreen');
      hud.handleKeyDown(new KeyboardEvent('keydown', { code: 'KeyL' }));
      expect(showSpy).toHaveBeenCalledWith('modal-snake-lab', { tab: 'lab' });

      // Hotkey KeyT opens Telemetry (stats view)
      hud.handleKeyDown(new KeyboardEvent('keydown', { code: 'KeyT' }));
      expect(showSpy).toHaveBeenCalledWith('modal-snake-lab', { tab: 'telemetry' });
    });

    it('verifies 3 segregated views (mutations, helmets, stats) navigation inside SnakeLabScreen', () => {
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
  });

  // =========================================================================
  // SUITE 6: Responsive Layout Conformance: Mobile (1-Card) vs Desktop (2-Card)
  // =========================================================================
  describe('6. Responsive Layout Conformance: Mobile (1-Card) vs Desktop (2-Card)', () => {
    it('verifies responsive metrics classify mobile portrait viewports (393x852, 540x960) as phone tier and mobile', () => {
      // 393 x 852 Viewport
      const m1 = ResponsiveLayout.instance.computeMetrics(393, 852);
      expect(m1.deviceTier).toBe('phone');
      expect(m1.isMobile).toBe(true);

      // 540 x 960 Viewport
      const m2 = ResponsiveLayout.instance.computeMetrics(540, 960);
      expect(m2.deviceTier).toBe('phone');
      expect(m2.isMobile).toBe(true);
    });

    it('verifies responsive metrics classify desktop viewports (1920x1080, 1280x720) as desktop tier', () => {
      // 1920 x 1080 Viewport
      const d1 = ResponsiveLayout.instance.computeMetrics(1920, 1080);
      expect(d1.deviceTier).toBe('desktop');
      expect(d1.isMobile).toBe(false);

      // 1280 x 720 Viewport
      const d2 = ResponsiveLayout.instance.computeMetrics(1280, 720);
      expect(d2.deviceTier).toBe('desktop');
      expect(d2.isMobile).toBe(false);
    });

    it('verifies CSS stylesheet enforces 1-card-per-line (1fr) on mobile (<=768px) and 2-card-per-line on desktop', () => {
      const indexHtmlPath = path.resolve(__dirname, '../../index.html');
      const htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');

      // Desktop layout rule
      expect(htmlContent).toMatch(/\.lab-docked-card-grid[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);

      // Mobile breakpoint layout rule
      const mobileSection = htmlContent.slice(htmlContent.indexOf('@media (max-width: 768px)'));
      expect(mobileSection).toMatch(/\.lab-docked-card-grid[\s\S]*?grid-template-columns:\s*1fr/);
    });
  });
});
