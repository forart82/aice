/**
 * Ouroboros Ascension — SnakeLabScreen Responsive 1-Card-Per-Line Mobile Layout Test Suite
 *
 * Conformance assertions:
 * 1. Verifies offGrid, defGrid, and augGrid are assigned semantic classes .lab-card-grid and .challenge-tracker-list.
 * 2. Verifies helmets grid is assigned semantic class .helmet-grid (and .lab-card-grid).
 * 3. Verifies hardcoded inline gridTemplateColumns overrides are removed so CSS media queries control responsive layout.
 * 4. Verifies mutation cards and helmet cards have 100% width and box-sizing for clean responsive stretching.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockDom } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { SnakePlayer } from '../sim/SnakePlayer';
import { MetaProgression } from '../data/MetaProgression';
import { Services } from '../core/Services';
import { NullFx, NullSound } from '../core/Contracts';
import { HelmetDef } from '../data/Helmets';

describe('SnakeLabScreen Responsive 1-Card-Per-Line Grid Layout', () => {
  let restoreDom: () => void;
  let player: SnakePlayer;
  let mockEngine: any;
  let uiRoot: UiRoot;
  let lab: SnakeLabScreen;

  beforeEach(() => {
    restoreDom = setupMockDom();
    Services.Sound = new NullSound();
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
        foodsEatenByType: {},
        killsByType: {},
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

  it('1. assigns .lab-card-grid and .challenge-tracker-list to offGrid, defGrid, and augGrid in renderCranialMutationSection', () => {
    lab.show({ tab: 'mutations' });
    lab.refresh();

    const mutationSection = lab.element.querySelector('.lab-section-mutations') as HTMLElement;
    expect(mutationSection).not.toBeNull();

    const cardGrids = mutationSection.querySelectorAll('.challenge-tracker-list');
    expect(cardGrids.length).toBe(3); // offGrid, defGrid, augGrid

    cardGrids.forEach(grid => {
      expect(grid.classList.contains('lab-card-grid')).toBe(true);
      expect(grid.classList.contains('challenge-tracker-list')).toBe(true);
    });
  });

  it('2. removes hardcoded inline gridTemplateColumns overrides from mutation grids to allow CSS media queries control', () => {
    lab.show({ tab: 'mutations' });
    lab.refresh();

    const cardGrids = lab.element.querySelectorAll('.lab-section-mutations .lab-card-grid');
    expect(cardGrids.length).toBe(3);

    cardGrids.forEach(grid => {
      const htmlEl = grid as HTMLElement;
      expect(htmlEl.style.gridTemplateColumns).toBeFalsy();
    });
  });

  it('3. assigns .helmet-grid and removes inline gridTemplateColumns from collected boss helmets grid in renderHelmetVaultSection', () => {
    const meta = MetaProgression.Instance;
    const testHelm: HelmetDef = {
      Id: 'test_helm_1',
      id: 'test_helm_1',
      Name: 'Centipede Crown',
      name: 'Centipede Crown',
      Icon: '🪖',
      icon: '🪖',
      Rarity: 'rare',
      rarity: 'rare',
      Stats: { maxHp: 20 },
      stats: { maxHp: 20 },
      Description: 'Hardened chitin.',
      description: 'Hardened chitin.',
      Floor: 1,
      floor: 1,
      BossType: 'centipede',
      bossType: 'centipede',
    };
    meta.addHelmet(testHelm);

    lab.show({ tab: 'helmets' });
    lab.refresh();

    const helmetGrid = lab.element.querySelector('.helmet-grid') as HTMLElement;
    expect(helmetGrid).not.toBeNull();
    expect(helmetGrid.classList.contains('helmet-grid')).toBe(true);
    expect(helmetGrid.classList.contains('lab-card-grid')).toBe(true);
    expect(helmetGrid.style.gridTemplateColumns).toBeFalsy();
  });

  it('4. ensures mutation cards and helmet cards stretch cleanly with width: 100% and boxSizing: border-box', () => {
    const meta = MetaProgression.Instance;
    const testHelm: HelmetDef = {
      Id: 'test_helm_2',
      id: 'test_helm_2',
      Name: 'Colossus Helm',
      name: 'Colossus Helm',
      Icon: '🪖',
      icon: '🪖',
      Rarity: 'epic',
      rarity: 'epic',
      Stats: { armor: 0.15 },
      stats: { armor: 0.15 },
      Description: 'Dense obsidian plate.',
      description: 'Dense obsidian plate.',
      Floor: 3,
      floor: 3,
      BossType: 'colossus',
      bossType: 'colossus',
    };
    meta.addHelmet(testHelm);

    // Check mutation cards
    lab.show({ tab: 'mutations' });
    lab.refresh();

    const mutationCards = Array.from(lab.element.querySelectorAll('.lab-docked-card-btn')) as HTMLElement[];
    expect(mutationCards.length).toBeGreaterThan(0);
    mutationCards.forEach(card => {
      expect(card.style.width).toBe('100%');
      expect(card.style.boxSizing).toBe('border-box');
    });

    // Check helmet cards
    lab.show({ tab: 'helmets' });
    lab.refresh();

    const helmetCards = Array.from(lab.element.querySelectorAll('.helmet-card')) as HTMLElement[];
    expect(helmetCards.length).toBeGreaterThan(0);
    helmetCards.forEach(card => {
      expect(card.style.width).toBe('100%');
      expect(card.style.boxSizing).toBe('border-box');
    });
  });
});
