import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockDom } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { SnakePlayer } from '../sim/SnakePlayer';
import { MetaProgression } from '../data/MetaProgression';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';

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

describe('SnakeLab Purchase Affordances & Interactive Feedback Test Suite', () => {
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

    // Default starter unlocked tiers: turret and shield at Tier 1
    player = new SnakePlayer('emerald', 1280, 720, 3);
    player.ouro = 0;
    player.xp = 0;

    mockEngine = {
      player,
      state: 1,
    };

    const container = document.createElement('div');
    uiRoot = UiRoot.init(container as any, mockEngine);
    lab = new SnakeLabScreen(uiRoot);
    uiRoot.registerScreen(lab);
  });

  afterEach(() => {
    restoreDom();
  });

  it('1. Quick Stats Pill Bar highlights player Ouro balance prominently with golden neon chip', () => {
    player.ouro = 250;
    lab.show();
    lab.refresh();

    const ouroChip = lab.element.querySelector('.lab-stat-chip-ouro') as HTMLElement;
    expect(ouroChip).toBeDefined();
    expect(ouroChip.textContent).toContain('🪙 250 Ouro');
    expect(ouroChip.className).toContain('lab-stat-chip-ouro');
  });

  it('2. Renders distinct unaffordable button affordances and cost breakdown badges when Ouro is insufficient', () => {
    player.ouro = 15;
    lab.show();
    lab.refresh();

    // Attack Spitter is Tier 1 unlocked by default, costs 30 Ouro (30 * 1 + 0 * 15)
    const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
    const spitterBtn = buttons.find((b) => b.textContent?.includes('Attack Spitter'))!;
    expect(spitterBtn).toBeDefined();

    // Must have unaffordable class and cost tag breakdown
    expect(spitterBtn.className).toContain('btn-unaffordable');
    expect(spitterBtn.textContent).toContain('Need 15 more');
    expect(spitterBtn.textContent).toContain('[15/30 🪙]');

    const costTag = spitterBtn.querySelector('.cost-tag.unaffordable');
    expect(costTag).toBeDefined();
    expect(costTag?.textContent).toContain('Need 15 more');
  });

  it('3. Clicking an unaffordable upgrade triggers playError sound and displays in-lab warning banner toast', () => {
    player.ouro = 20;
    lab.show();
    lab.refresh();

    const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
    const spitterBtn = buttons.find((b) => b.textContent?.includes('Attack Spitter'))!;
    expect(spitterBtn).toBeDefined();

    const prevErrors = soundSpy.errorCount;
    spitterBtn.click();

    expect(soundSpy.errorCount).toBe(prevErrors + 1);

    const toastBanner = lab.element.querySelector('.lab-toast-banner') as HTMLElement;
    expect(toastBanner).toBeDefined();
    expect(toastBanner.textContent).toContain('Insufficient Ouro');
    expect(toastBanner.textContent).toContain('20');
    expect(toastBanner.textContent).toContain('30');
    expect(toastBanner.textContent).toContain('Need 10 more');
    expect(toastBanner.style.display).not.toBe('none');
  });

  it('4. Clicking a tier-locked upgrade triggers playError sound and displays challenge requirement toast', () => {
    player.ouro = 500;
    lab.show();
    lab.refresh();

    // Cryo Mortar is locked by default at Tier 1
    const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
    const cryoBtn = buttons.find((b) => b.textContent?.includes('Cryo Mortar'))!;
    expect(cryoBtn).toBeDefined();
    expect(cryoBtn.className).toContain('btn-tier-locked');

    const prevErrors = soundSpy.errorCount;
    cryoBtn.click();

    expect(soundSpy.errorCount).toBe(prevErrors + 1);

    const toastBanner = lab.element.querySelector('.lab-toast-banner') as HTMLElement;
    expect(toastBanner).toBeDefined();
    expect(toastBanner.textContent).toContain('Locked');
    expect(toastBanner.textContent).toContain('Tier 1');
  });

  it('5. Affordable upgrades render with .btn-affordable and purchase smoothly with levelUp sound and Ouro deduction', () => {
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
    expect(player.getHeadModuleLevel('turret')).toBe(1);
  });

  it('6. Spending in the lab decreases both the lab Ouro counter and the in-game HUD counter (wallet synchronization)', () => {
    player.ouro = 100;
    lab.show();
    lab.refresh();

    const hud = uiRoot.hudView;
    hud.refresh(mockEngine);

    const initialLabChip = lab.element.querySelector('.lab-stat-chip-ouro') as HTMLElement;
    const initialHudVal = hud.element.querySelector('.hud-ouro-val, .hud-xp-val') as HTMLElement;
    expect(initialLabChip.textContent).toContain('🪙 100 Ouro');
    expect(initialHudVal.textContent).toBe('100');

    const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
    const spitterBtn = buttons.find((b) => b.textContent?.includes('Attack Spitter'))!;
    spitterBtn.click();

    expect(player.ouro).toBe(70);

    const updatedLabChip = lab.element.querySelector('.lab-stat-chip-ouro') as HTMLElement;
    const updatedHudVal = hud.element.querySelector('.hud-ouro-val, .hud-xp-val') as HTMLElement;
    expect(updatedLabChip.textContent).toContain('🪙 70 Ouro');
    expect(updatedHudVal.textContent).toBe('70');
  });

  it('7. Buttons never set native disabled=true, instead preserving click dispatch with aria-disabled', () => {
    player.ouro = 10;
    lab.show();
    lab.refresh();

    const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
    for (const btn of buttons) {
      // Native disabled must always be false to allow browser click event dispatch for toasts/audio
      expect(btn.disabled).toBe(false);
      // aria-disabled communicates assistive state
      expect(btn.hasAttribute('aria-disabled')).toBe(true);
    }

    const spitterBtn = buttons.find((b) => b.textContent?.includes('Attack Spitter'))!;
    expect(spitterBtn.getAttribute('aria-disabled')).toBe('true');

    // Make affordable
    player.ouro = 200;
    lab.refresh();

    const affordableButtons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
    const affordableSpitter = affordableButtons.find((b) => b.textContent?.includes('Attack Spitter'))!;
    expect(affordableSpitter.disabled).toBe(false);
    expect(affordableSpitter.getAttribute('aria-disabled')).toBe('false');
  });

  it('8. Enforces Max Level = 3 on Head Modules with [MAX LEVEL] badge, golden border, and max level toast', () => {
    player.ouro = 1000;
    // Set turret module to level 3 (max level)
    player.setHeadModuleLevel('turret', 3);
    lab.show();
    lab.refresh();

    const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
    const spitterBtn = buttons.find((b) => b.textContent?.includes('Attack Spitter'))!;
    expect(spitterBtn).toBeDefined();

    // Check Max Level Badge and Golden Border styling
    expect(spitterBtn.className).toContain('btn-max-level');
    expect(spitterBtn.textContent).toContain('[MAX LEVEL]');
    expect(spitterBtn.textContent).toContain('LVL 3/3');
    expect(spitterBtn.getAttribute('aria-disabled')).toBe('true');
    expect(spitterBtn.disabled).toBe(false);

    const costTag = spitterBtn.querySelector('.cost-tag.max-level');
    expect(costTag).toBeDefined();
    expect(costTag?.textContent).toContain('[MAX LEVEL]');

    // Clicking max level shows max level toast banner and does NOT deduct Ouro
    const prevOuro = player.ouro;
    const prevErrors = soundSpy.errorCount;
    spitterBtn.click();

    expect(player.ouro).toBe(prevOuro);
    expect(player.getHeadModuleLevel('turret')).toBe(3);
    expect(soundSpy.errorCount).toBe(prevErrors);

    const toastBanner = lab.element.querySelector('.lab-toast-banner') as HTMLElement;
    expect(toastBanner).toBeDefined();
    expect(toastBanner.textContent).toContain('🌟 Module is already at Maximum Level!');
    expect(toastBanner.style.display).not.toBe('none');
  });

  it('9. Enforces Max Level = 3 on Cranial Augments with [MAX LEVEL] badge, golden border, and max level toast', () => {
    player.ouro = 1000;
    // Set fangs augment to level 3 (max level)
    player.setHeadAugment('fangs', 3);
    lab.show();
    lab.refresh();

    const buttons = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLButtonElement[];
    const fangsBtn = buttons.find((b) => b.textContent?.includes('Venom Fangs'))!;
    expect(fangsBtn).toBeDefined();

    // Check Max Level Badge and styling
    expect(fangsBtn.className).toContain('btn-max-level');
    expect(fangsBtn.textContent).toContain('[MAX LEVEL]');
    expect(fangsBtn.textContent).toContain('LVL 3/3');
    expect(fangsBtn.getAttribute('aria-disabled')).toBe('true');
    expect(fangsBtn.disabled).toBe(false);

    const costTag = fangsBtn.querySelector('.cost-tag.max-level');
    expect(costTag).toBeDefined();
    expect(costTag?.textContent).toContain('[MAX LEVEL]');

    // Clicking max level shows max level toast banner and does NOT deduct Ouro
    const prevOuro = player.ouro;
    fangsBtn.click();

    expect(player.ouro).toBe(prevOuro);
    expect(player.headAugmentLevel).toBe(3);

    const toastBanner = lab.element.querySelector('.lab-toast-banner') as HTMLElement;
    expect(toastBanner).toBeDefined();
    expect(toastBanner.textContent).toContain('🌟 Module is already at Maximum Level!');
  });
});
