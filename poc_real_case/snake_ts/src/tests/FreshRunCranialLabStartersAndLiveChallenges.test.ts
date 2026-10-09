/**
 * Ouroboros Ascension — Fresh Run Cranial Lab Starters & Live Challenge Tracking Test Suite
 *
 * Conformance & Quality Verification:
 * 1. Fresh Run Starter Defaults:
 *    - Exactly 1 unlocked Offensive Weapon: turret (Attack Spitter)
 *    - Exactly 1 unlocked Defensive Bio-Organ: shield (Carapace Shield)
 *    - ALL other 19 cards locked (🔒 [TIER 1 LOCKED]) displaying their respective in-card live challenge progress bars.
 * 2. Real-time in-run challenge tracking and instant purchase unlocks when conditions are met.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockDom } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { SnakePlayer } from '../sim/SnakePlayer';
import { MetaProgression } from '../data/MetaProgression';
import { Services } from '../core/Services';
import { NullFx, NullSound, ISound } from '../core/Contracts';

class LabTestSound extends NullSound implements ISound {
  public uiCount = 0;
  public levelUpCount = 0;
  public errorCount = 0;

  public override playUi(): void { this.uiCount++; }
  public override playLevelUp(): void { this.levelUpCount++; }
  public override playError(): void { this.errorCount++; }
}

describe('Fresh Run Cranial Lab Starters & Live Challenge Tracking', () => {
  let restoreDom: () => void;
  let soundSpy: LabTestSound;
  let player: SnakePlayer;
  let mockEngine: any;
  let uiRoot: UiRoot;
  let lab: SnakeLabScreen;

  beforeEach(() => {
    restoreDom = setupMockDom();
    soundSpy = new LabTestSound();
    Services.Sound = soundSpy;
    Services.Fx = new NullFx();

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
    MetaProgression.Instance.reset();

    player = new SnakePlayer('emerald', 1280, 720, 3);
    player.ouro = 100;
    player.xp = 100;

    mockEngine = {
      player,
      state: 'Playing',
      currentFloor: 1,
      combat: {
        score: 0,
        kills: 0,
        shardsEarned: 0,
        comboCount: 0,
        highestRunCombo: 0,
        bossKills: 0,
        foodsEatenByType: {
          apple: 0,
          golden: 0,
          potion: 0,
          shard: 0,
          prism: 0,
        },
        killsByType: {
          swarmling: 0,
          scarab: 0,
          spitter: 0,
          phantom: 0,
          drone: 0,
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

  it('1. verifies that on a fresh run, exactly 1 offensive weapon and 1 defensive bio-organ are unlocked, and all other cards are locked', () => {
    lab.show();
    lab.refresh();

    const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
    expect(buttons.length).toBe(21); // 10 Offensive + 6 Defensive + 5 Augments = 21 Cards

    // Offensive weapons (10 cards)
    const turretBtn = buttons.find(b => b.textContent?.includes('Attack Spitter'))!;
    expect(turretBtn).toBeDefined();
    expect(turretBtn.className).not.toContain('btn-tier-locked');
    expect(turretBtn.textContent).not.toContain('🔒');
    expect(turretBtn.textContent).toContain('[TIER 1 UNLOCKED]');

    const otherOffenseKeys = ['Bio-Arc Coil', 'Magma Vent', 'Venom Sprayer', 'Tachyon Laser', 'Cryo Mortar', 'Plasma Mortar', 'Scattershot', 'Flak Cannon', 'Needler'];
    for (const name of otherOffenseKeys) {
      const btn = buttons.find(b => b.textContent?.includes(name))!;
      expect(btn, `Expected ${name} to be defined`).toBeDefined();
      expect(btn.className, `Expected ${name} to be locked`).toContain('btn-tier-locked');
      expect(btn.textContent, `Expected ${name} to contain lock icon`).toContain('🔒');
      expect(btn.textContent, `Expected ${name} to contain [TIER 1 LOCKED]`).toContain('[TIER 1 LOCKED]');
    }

    // Defensive bio-organs (6 cards)
    const shieldBtn = buttons.find(b => b.textContent?.includes('Carapace Shield'))!;
    expect(shieldBtn).toBeDefined();
    expect(shieldBtn.className).not.toContain('btn-tier-locked');
    expect(shieldBtn.textContent).not.toContain('🔒');
    expect(shieldBtn.textContent).toContain('[TIER 1 UNLOCKED]');

    const otherDefenseKeys = ['Thorny Spikes', 'Regen Gland', 'Bio-Magnet', 'Chrono Ward', 'Nanite Swarm'];
    for (const name of otherDefenseKeys) {
      const btn = buttons.find(b => b.textContent?.includes(name))!;
      expect(btn, `Expected ${name} to be defined`).toBeDefined();
      expect(btn.className, `Expected ${name} to be locked`).toContain('btn-tier-locked');
      expect(btn.textContent, `Expected ${name} to contain lock icon`).toContain('🔒');
      expect(btn.textContent, `Expected ${name} to contain [TIER 1 LOCKED]`).toContain('[TIER 1 LOCKED]');
    }

    // Cranial bio-augmentations (5 cards) - ALL locked on fresh run
    const augmentKeys = ['Venom Fangs', 'Dragon Maw', 'Ramming Horns', 'Laser Optics', 'Solar Crown'];
    for (const name of augmentKeys) {
      const btn = buttons.find(b => b.textContent?.includes(name))!;
      expect(btn, `Expected ${name} to be defined`).toBeDefined();
      expect(btn.className, `Expected ${name} to be locked`).toContain('btn-tier-locked');
      expect(btn.textContent, `Expected ${name} to contain lock icon`).toContain('🔒');
      expect(btn.textContent, `Expected ${name} to contain [TIER 1 LOCKED]`).toContain('[TIER 1 LOCKED]');
    }

    // Unlocked count: exactly 2 (turret + shield), Locked count: 19
    const unlockedButtons = buttons.filter(b => !b.className.includes('btn-tier-locked'));
    const lockedButtons = buttons.filter(b => b.className.includes('btn-tier-locked'));
    expect(unlockedButtons.length).toBe(2);
    expect(lockedButtons.length).toBe(19);
  });

  it('2. verifies all locked cards render live challenge progress bars, ratios, and percentages', () => {
    lab.show();
    lab.refresh();

    const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
    const lockedButtons = buttons.filter(b => b.className.includes('btn-tier-locked'));

    for (const btn of lockedButtons) {
      const bar = btn.querySelector('.challenge-progress-bar') as HTMLElement;
      expect(bar, 'Progress bar element should exist inside locked card').not.toBeNull();
      expect(bar.style.width).toBeDefined();
      expect(btn.textContent).toMatch(/\d+\s*\/\s*\d+/); // e.g. "0 / 15"
      expect(btn.textContent).toContain('%'); // e.g. "0%"
    }
  });

  it('3. verifies live challenge tracking and instant purchase unlocks when conditions are met', () => {
    lab.show();
    lab.refresh();

    // Slay 15 Swarmlings to unlock Magma Vent
    mockEngine.combat.killsByType['swarmling'] = 15;
    lab.refresh();

    let buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
    let magmaBtn = buttons.find(b => b.textContent?.includes('Magma Vent'))!;
    expect(magmaBtn.className).not.toContain('btn-tier-locked');
    expect(magmaBtn.textContent).not.toContain('🔒');
    expect(magmaBtn.textContent).toContain('[TIER 1 UNLOCKED]');

    // Purchase Magma Vent with Ouro
    const prevPurchases = player.headPurchaseCount;
    magmaBtn.click();
    expect(player.headPurchaseCount).toBe(prevPurchases + 1);
    expect(player.getHeadModuleLevel('magma')).toBe(1);
    expect(soundSpy.levelUpCount).toBeGreaterThan(0);

    // Maintain 20x Combo Streak to unlock Bio-Arc Coil & Venom Fangs
    mockEngine.combat.highestRunCombo = 20;
    lab.refresh();

    buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
    const teslaBtn = buttons.find(b => b.textContent?.includes('Bio-Arc Coil'))!;
    expect(teslaBtn.className).not.toContain('btn-tier-locked');
    expect(teslaBtn.textContent).toContain('[TIER 1 UNLOCKED]');

    const fangsBtn = buttons.find(b => b.textContent?.includes('Venom Fangs'))!;
    expect(fangsBtn.className).not.toContain('btn-tier-locked');
    expect(fangsBtn.textContent).toContain('[TIER 1 UNLOCKED]');

    // Drink 2 Health Potions to unlock Cryo Mortar
    mockEngine.combat.foodsEatenByType['potion'] = 2;
    lab.refresh();

    buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
    const cryoBtn = buttons.find(b => b.textContent?.includes('Cryo Mortar'))!;
    expect(cryoBtn.className).not.toContain('btn-tier-locked');
    expect(cryoBtn.textContent).toContain('[TIER 1 UNLOCKED]');

    // Defeat Centipede Behemoth (Floor 1 boss) to unlock Dragon Maw
    mockEngine.combat.bossKills = 1;
    mockEngine.currentFloor = 2;
    lab.refresh();

    buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
    const mawBtn = buttons.find(b => b.textContent?.includes('Dragon Maw'))!;
    expect(mawBtn.className).not.toContain('btn-tier-locked');
    expect(mawBtn.textContent).toContain('[TIER 1 UNLOCKED]');
  });
});
