import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MetaProgression } from '../data/MetaProgression';
import { SnakePlayer } from '../sim/SnakePlayer';
import { setupMockDom } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';

describe('Mutation Lab Challenge & Tier Progression Test Suite', () => {
  let teardownDom: () => void;
  let uiRoot: UiRoot;
  let labScreen: SnakeLabScreen;
  let mockEngine: any;

  beforeEach(() => {
    teardownDom = setupMockDom();
    Services.sound = new NullSound();
    Services.fx = new NullFx();
    Services.headless = true;

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();

    const player = new SnakePlayer('emerald', 1280, 720, 3);
    player.xp = 1000;

    mockEngine = {
      player,
      state: 1,
    };

    const container = document.createElement('div');
    uiRoot = UiRoot.init(container as any, mockEngine);
    labScreen = new SnakeLabScreen(uiRoot);
    uiRoot.registerScreen(labScreen);
  });

  afterEach(() => {
    teardownDom();
  });

  it('1. provides starter Tier 1 weapon (Spitter) & defense (Shield) unlocked by default', () => {
    const meta = MetaProgression.instance;

    // Starter defaults unlocked (strictly 1 weapon, 1 defense)
    expect(meta.isTierUnlocked('turret', 1)).toBe(true);
    expect(meta.isTierUnlocked('shield', 1)).toBe(true);
    expect(meta.isTierUnlocked('venom', 1)).toBe(false);

    // Advanced modules locked by default at Tier 1
    expect(meta.isTierUnlocked('cryo', 1)).toBe(false);
    expect(meta.isTierUnlocked('tachyon', 1)).toBe(false);
    expect(meta.isTierUnlocked('plasma', 1)).toBe(false);
    expect(meta.isTierUnlocked('chrono', 1)).toBe(false);

    // Tier 2 locked by default for starter weapon
    expect(meta.isTierUnlocked('turret', 2)).toBe(false);
  });

  it('2. unlocks modules and higher tiers when challenge conditions are achieved', () => {
    const meta = MetaProgression.instance;

    // Single-challenge in-run evaluation: reaching exact targets unlocks modules
    expect(meta.isTierUnlocked('magma', 1, { swarmlings: 14 })).toBe(false);
    expect(meta.isTierUnlocked('magma', 1, { swarmlings: 15 })).toBe(true);

    meta.resetRunUnlocks();
    expect(meta.isTierUnlocked('plasma', 1, { length: 34 })).toBe(false);
    expect(meta.isTierUnlocked('plasma', 1, { length: 35 })).toBe(true);

    meta.resetRunUnlocks();
    expect(meta.isTierUnlocked('cryo', 1, { potions: 1 })).toBe(false);
    expect(meta.isTierUnlocked('cryo', 1, { potions: 2 })).toBe(true);

    meta.resetRunUnlocks();
    expect(meta.isTierUnlocked('tachyon', 1, { combo: 9 })).toBe(false);
    expect(meta.isTierUnlocked('tachyon', 1, { combo: 10 })).toBe(true);

    // Post-run batch evaluation with diverse criteria
    meta.resetRunUnlocks();
    expect(meta.isTierUnlocked('cryo', 1)).toBe(false);
    meta.evaluateChallenges({ potions: 2, combo: 10, length: 35, swarmlings: 15 });
    expect(meta.isTierUnlocked('cryo', 1)).toBe(true);
    expect(meta.isTierUnlocked('plasma', 1)).toBe(true);
    expect(meta.isTierUnlocked('tachyon', 1)).toBe(true);
    expect(meta.isTierUnlocked('magma', 1)).toBe(true);
  });

  it('3. SnakeLabScreen UI renders padlock 🔒 and disables locked modules', () => {
    labScreen.show();
    labScreen.refresh();

    // Starter module (Venom Spitter) is enabled
    const buttons = labScreen.element.querySelectorAll('.lab-docked-card-container button');
    const venomBtn = Array.from(buttons).find(b => b.textContent?.includes('Venom Spitter') || b.textContent?.includes('Attack Spitter')) as HTMLButtonElement;
    expect(venomBtn).toBeDefined();
    expect(venomBtn.disabled).toBe(false);

    // Locked module (Cryo Mortar) has lock icon, is disabled via aria-disabled, and preserves native click dispatch
    const cryoBtn = Array.from(buttons).find(b => b.textContent?.includes('Cryo Mortar') || b.textContent?.includes('❄️')) as HTMLButtonElement;
    expect(cryoBtn).toBeDefined();
    expect(cryoBtn.textContent).toContain('🔒');
    expect(cryoBtn.disabled).toBe(false);
    expect(cryoBtn.getAttribute('aria-disabled')).toBe('true');
  });
});
