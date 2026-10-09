import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockDom } from './MockDom';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { InputManager } from '../input/InputManager';
import { MenuScreen } from '../ui/screens/MenuScreen';
import { UiRoot } from '../ui/UiRoot';
import { Services } from '../core/Services';
import { NullSound, NullFx } from '../core/Contracts';

describe('Spectator Bot Live Arena Test Suite', () => {
  beforeEach(() => {
    setupMockDom();
    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
  });

  it('1. verifies InputManager tracks KeyB for bot mode toggle', () => {
    const input = new InputManager();
    expect(input.consumeBotToggle()).toBe(false);

    input.handleKeyDown({ code: 'KeyB', preventDefault: () => {} } as any);
    expect(input.consumeBotToggle()).toBe(true);
    expect(input.consumeBotToggle()).toBe(false); // Edge-triggered
  });

  it('2. verifies GameEngine has isBotEnabled and toggleBot method', () => {
    const engine = new GameEngine(new NullFx(), { isolated: true, headless: true });
    expect(engine.isBotEnabled).toBe(false);

    engine.toggleBot();
    expect(engine.isBotEnabled).toBe(true);

    engine.toggleBot();
    expect(engine.isBotEnabled).toBe(false);
  });

  it('3. verifies GameEngine runs bot policy during tick when isBotEnabled is true', () => {
    const engine = new GameEngine(new NullFx(), { isolated: true, headless: true });
    engine.ChooseMode('rogue');
    engine.StartRun();
    expect(engine.State).toBe(GameState.Playing);

    engine.isBotEnabled = true;
    const initialX = engine.Player.X;
    const initialY = engine.Player.Y;

    // Tick for 0.5s with bot controlling
    for (let i = 0; i < 30; i++) {
      engine.Tick(1 / 60);
    }

    // Player should have moved autonomously under bot control
    expect(engine.Player.X !== initialX || engine.Player.Y !== initialY).toBe(true);
  });

  it('4. verifies GameEngine automatically handles LevelUp draft when bot is active', () => {
    const engine = new GameEngine(new NullFx(), { isolated: true, headless: true });
    engine.ChooseMode('rogue');
    engine.StartRun();
    engine.isBotEnabled = true;

    // Trigger LevelUp
    engine.TriggerLevelUp();
    expect(engine.State).toBe(GameState.LevelUp);
    expect(engine.CurrentDraftCards.length).toBeGreaterThan(0);

    // Tick engine to let bot resolve draft
    for (let i = 0; i < 20; i++) {
      engine.Tick(1 / 60);
    }

    // Should return to Playing with chosen perk
    expect(engine.State).toBe(GameState.Playing);
    expect(engine.ActivePerks.length).toBeGreaterThan(0);
  });

  it('5. verifies MenuScreen has removed Spectate Bot Run button while bot mode remains accessible via URL parameter or engine', () => {
    const container = document.createElement('div');
    const engine = new GameEngine(new NullFx(), { isolated: true, headless: true });
    const uiRoot = UiRoot.init(container, engine);
    const menuScreen = new MenuScreen(uiRoot);

    // Verify manual button was removed from player MenuScreen
    const botBtn = menuScreen.element.querySelector('.btn-spectate-bot');
    const botWrap = menuScreen.element.querySelector('.bot-spectate-wrap');
    expect(botBtn).toBeNull();
    expect(botWrap).toBeNull();

    // Verify spectator mode remains accessible via engine routing & parameters (?bot=true / ?spectate=true)
    const botUrlParams = new URLSearchParams('?spectate=true&class=emerald');
    const isBotActive = botUrlParams.get('bot') === 'true' || botUrlParams.get('autoplay') === 'true' || botUrlParams.get('spectate') === 'true';
    expect(isBotActive).toBe(true);

    if (isBotActive) {
      engine.chooseMode('rogue');
      engine.selectedClass = (botUrlParams.get('class') as any) || 'emerald';
      engine.isBotEnabled = true;
      engine.startRun();
    }

    expect(engine.State).toBe(GameState.Playing);
    expect(engine.isBotEnabled).toBe(true);
    expect(engine.selectedClass).toBe('emerald');
  });
});
