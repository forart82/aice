import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockDom } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { MenuScreen } from '../ui/screens/MenuScreen';
import { SanctuaryScreen } from '../ui/screens/SanctuaryScreen';
import { SettingsScreen } from '../ui/screens/SettingsScreen';
import { MultiScreenModal } from '../ui/screens/MultiScreenModal';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';
import { MetaProgression } from '../data/MetaProgression';

describe('Ouroboros Galaxy Main Menu & MultiScreen Architecture Test Suite', () => {
  let teardownDom: () => void;
  let uiRoot: UiRoot;
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

    mockEngine = {
      chosenMode: '',
      state: 0,
      chooseMode(m: string) { this.chosenMode = m; },
    };

    const container = document.createElement('div');
    uiRoot = UiRoot.init(container as any, mockEngine);
  });

  afterEach(() => {
    teardownDom();
  });

  it('1. renders "OUROBOROS GALAXY" branding banner in MenuScreen', () => {
    const menu = new MenuScreen(uiRoot);
    uiRoot.registerScreen(menu);
    uiRoot.showScreen('modal-main-menu');

    const topTitle = menu.element.querySelector('.top-title');
    const bottomTitle = menu.element.querySelector('.bottom-title');
    expect(topTitle?.textContent).toBe('OUROBOROS');
    expect(bottomTitle?.textContent).toBe('GALAXY');
  });

  it('2. confirms Mutation Lab and Multi-Screen buttons are completely removed from Main Menu', () => {
    const menu = new MenuScreen(uiRoot);
    uiRoot.registerScreen(menu);
    uiRoot.showScreen('modal-main-menu');

    const labBtn = menu.element.querySelector('.btn-lab');
    const multiBtn = menu.element.querySelector('.btn-multiscreen');
    expect(labBtn).toBeNull();
    expect(multiBtn).toBeNull();

    // Verify Sanctuary and Settings remain accessible on Main Menu
    const sanctuaryBtn = menu.element.querySelector('.btn-sanctuary');
    const settingsBtn = menu.element.querySelector('.btn-settings');
    expect(sanctuaryBtn).not.toBeNull();
    expect(settingsBtn).not.toBeNull();
  });

  it('3. verifies MultiScreen module and modal remain fully operational and preserved', () => {
    const multiModal = new MultiScreenModal(uiRoot);
    uiRoot.registerScreen(multiModal);
    uiRoot.showScreen('modal-multiscreen');

    expect(uiRoot.activeScreenId).toBe('modal-multiscreen');
    const copyBtn = multiModal.element.querySelector('.btn-copy-url') as HTMLButtonElement;
    const popoutBtn = multiModal.element.querySelector('.btn-popout-window') as HTMLButtonElement;
    expect(copyBtn).not.toBeNull();
    expect(popoutBtn).not.toBeNull();

    // Test URL copy interaction
    copyBtn.click();
    expect(copyBtn.textContent).toContain('Copied!');
  });
});
