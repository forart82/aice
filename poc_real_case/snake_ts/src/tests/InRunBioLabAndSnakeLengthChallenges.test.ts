import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockDom, MockElement } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { GameEngine } from '../sim/GameEngine';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { MetaProgression } from '../data/MetaProgression';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';
import { InputManager } from '../input/InputManager';
import { SaveIO } from '../platform/SaveIO';
import { SnakeSegment } from '../sim/SnakePlayer';

describe('In-Run Bio-Lab Reset & Snake Length Challenge Progression', () => {
  let restoreDom: () => void;
  let container: MockElement;
  let engine: GameEngine;
  let uiRoot: UiRoot;
  let meta: MetaProgression;

  beforeEach(() => {
    restoreDom = setupMockDom();
    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();
    MetaProgression.Instance.reset();
    meta = MetaProgression.Instance;

    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
    Services.Input = InputManager.instance;
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

  it('1. Starting a new run initializes Bio-Lab with only starter modules unlocked and 0 purchases', () => {
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();

    const player = engine.player!;
    expect(player.headModules).toEqual({});
    expect(player.headAugment).toBeNull();
    expect(player.headPurchaseCount).toBe(0);

    // Starter defaults are unlocked at Tier 1 (strictly 1 weapon, 1 defense)
    expect(meta.IsTierUnlocked('turret', 1)).toBe(true);
    expect(meta.IsTierUnlocked('shield', 1)).toBe(true);

    // Non-starter modules start locked in the new run
    expect(meta.IsTierUnlocked('tesla', 1)).toBe(false);
    expect(meta.IsTierUnlocked('venom', 1)).toBe(false);
    expect(meta.IsTierUnlocked('spikes', 1)).toBe(false);
    expect(meta.IsTierUnlocked('fangs', 1)).toBe(false);
    expect(meta.IsTierUnlocked('magma', 1)).toBe(false);
    expect(meta.IsTierUnlocked('cryo', 1)).toBe(false);
    expect(meta.IsTierUnlocked('tachyon', 1)).toBe(false);
    expect(meta.IsTierUnlocked('nanite', 1)).toBe(false);
    expect(meta.IsTierUnlocked('turret', 2)).toBe(false);
  });

  it('2. Growing snake length to milestones dynamically unlocks cranial modules in-run', () => {
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();

    const player = engine.player!;
    expect(meta.IsTierUnlocked('plasma', 1)).toBe(false);

    // Grow snake length to 14 segments (scaled Tier 1 requirement for 960x640 arena: 35 * 0.4 = 14)
    while (player.segments.length < 13) {
      player.segments.push(new SnakeSegment(player.x, player.y, 10, 100));
    }
    expect(player.segments.length + 1).toBe(14);

    // Plasma Tier 1 (requires Length >= 14 on 960x640) should now be unlocked!
    expect(meta.IsTierUnlocked('plasma', 1)).toBe(true);
    expect(meta.IsTierUnlocked('shield', 2)).toBe(false);

    // Grow to 240 segments -> Shield Tier 2 unlocks (600 * 0.4 = 240)
    while (player.segments.length < 239) {
      player.segments.push(new SnakeSegment(player.x, player.y, 10, 100));
    }
    expect(player.segments.length + 1).toBe(240);
    expect(meta.IsTierUnlocked('shield', 2)).toBe(true);
  });

  it('3. In-run purchases deduct XP and apply directly to player serpent', () => {
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();

    const player = engine.player!;
    player.xp = 100;

    const labScreen = new SnakeLabScreen(uiRoot);
    uiRoot.registerScreen(labScreen);
    uiRoot.showScreen('modal-snake-lab');

    // Purchase Turret (Attack Spitter)
    const turretBtn = Array.from(labScreen.element.querySelectorAll('.lab-docked-card-btn')).find(
      btn => btn.textContent && btn.textContent.includes('Attack Spitter')
    ) as HTMLButtonElement;

    expect(turretBtn).toBeDefined();
    turretBtn.click();

    expect(player.headModules['turret']).toBe(1);
    expect(player.headPurchaseCount).toBe(1);
    expect(player.xp).toBe(70); // 100 - 30
  });

  it('4. Starting a subsequent run resets Bio-Lab upgrades and in-run tier unlocks', () => {
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();

    const player = engine.player!;
    // Grow length to 14 to unlock Plasma Mortar
    while (player.segments.length < 13) {
      player.segments.push(new SnakeSegment(player.x, player.y, 10, 100));
    }
    expect(meta.IsTierUnlocked('plasma', 1)).toBe(true);

    // End run and start a new one
    engine.abandonRun();
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();

    const newPlayer = engine.player!;
    expect(newPlayer.segments.length).toBeLessThan(10);
    expect(newPlayer.headModules).toEqual({});
    expect(newPlayer.headPurchaseCount).toBe(0);

    // Magma Vent should be locked again at the start of the new run until length 100 is reached again
    expect(meta.IsTierUnlocked('magma', 1)).toBe(false);
  });

  it('5. Helmet Vault and Sanctuary meta-upgrades persist across runs while Bio-Lab resets', () => {
    // Add helmet to vault and buy sanctuary upgrade
    meta.AddHelmet({
      Id: 'helm_test_centipede',
      Name: 'Centipede Crown',
      Icon: '🪖',
      Rarity: 'rare',
      BossType: 'centipede',
      Stats: { armor: 0.15 },
      id: 'helm_test_centipede',
      name: 'Centipede Crown',
      icon: '🪖',
      rarity: 'rare',
      bossType: 'centipede',
      stats: { armor: 0.15 }
    });
    meta.UpgradeLevels['rerolls'] = 2;
    meta.Save();

    // Start a run, unlock in-run plasma
    engine.chooseMode('rogue');
    engine.selectedClass = 'emerald';
    engine.startRun();

    const player = engine.player!;
    while (player.segments.length < 13) {
      player.segments.push(new SnakeSegment(player.x, player.y, 10, 100));
    }
    expect(meta.IsTierUnlocked('plasma', 1)).toBe(true);

    // Start another run
    engine.startRun();

    // Bio-Lab reset:
    expect(meta.IsTierUnlocked('plasma', 1)).toBe(false);

    // Meta persisted:
    expect(meta.Helmets.length).toBeGreaterThan(0);
    expect(meta.Level('rerolls')).toBe(2);
  });
});
