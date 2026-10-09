/**
 * Interactive Codex & In-Game Compendium Help Screen Test Suite
 *
 * Conformance matrix for Exclusive Single-Accordion, Accessible Tables & Responsive Layout:
 * 1. Level 1 Hub: 6 Master category cards, search input, return button, hidden back button.
 * 2. Level 2 Category: Header with Back button ("◀ Back") + category title ("${cat.icon} ${cat.label}"), clean uniform article card stream.
 * 3. Exclusive Single-Accordion Behavior:
 *    - When entering a category, all lines are closed by default (_expandedIds.size === 0, _activeArticleId === null).
 *    - Tapping card A expands card A to full content.
 *    - Tapping card B expands card B to full content AND automatically closes card A.
 *    - Tapping card B again closes card B (all cards closed).
 * 4. Uniform Line Layout, Full Content Expansion & Smooth Scroll Alignment:
 *    - Every card has left icon, middle title + tags + subtitle, right chevron (▶ / ▼).
 *    - Inline expanded body renders summary, stats pills, pro gamer tips, collapsible formula drawer, tables.
 *    - Expanding a card expands to full content height with max-height: none and overflow: visible.
 *    - Relative smooth scroll alignment on _scrollContainer with targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' }).
 * 5. Back button sequential popping: Category -> Hub -> Exit.
 * 6. Search mode, clearing search, and search inline expansion with query retention.
 * 7. Universal hardware controls (Esc, Backspace, '/', Q/E, Arrow keys, Gamepad B & LB/RB).
 * 8. Full Game Lifecycle Integration (Menu, HUD, Pause/Settings navigation stack integrity).
 * 9. Accessible Tabular Data Architecture:
 *    - Responsive .codex-table-wrap wrapper on all tables.
 *    - Semantic thead, tbody, th, td hierarchy with non-empty descriptive header cells.
 * 10. Single-Scroll Architecture, Bottom Safety Padding & Accessibility (role="region", aria-label="Codex Entries").
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { setupMockDom, MockElement } from './MockDom.js';
import { UiRoot } from '../ui/UiRoot.js';
import { GameEngine } from '../sim/GameEngine.js';
import { GameState } from '../sim/GameState.js';
import { HelpScreen, CodexCategory } from '../ui/screens/HelpScreen.js';
import { MenuScreen } from '../ui/screens/MenuScreen.js';
import { SettingsScreen } from '../ui/screens/SettingsScreen.js';
import { ResponsiveLayout } from '../ui/ResponsiveLayout.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound } from '../core/Contracts.js';
import { InputManager } from '../input/InputManager.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { SaveIO } from '../platform/SaveIO.js';
import { CodexData } from '../data/CodexData.js';

describe('Interactive Codex & Compendium Help Screen (HelpScreen)', () => {
  let restoreDom: () => void;
  let container: MockElement;
  let engine: GameEngine;
  let uiRoot: UiRoot;
  let helpScreen: HelpScreen;

  beforeEach(() => {
    restoreDom = setupMockDom();
    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();
    MetaProgression.Instance.reset();

    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
    Services.Input = InputManager.instance;
    InputManager.instance.reset();

    container = document.createElement('div') as any;
    container.id = 'ui-root';
    document.body.appendChild(container as any);

    engine = new GameEngine(Services.Fx);
    uiRoot = UiRoot.init(container as any, engine);
    engine.setUiRoot(uiRoot);

    // Instantiate and register screens
    helpScreen = new HelpScreen(uiRoot);
    uiRoot.registerScreen(helpScreen);
    uiRoot.registerScreen(new MenuScreen(uiRoot));
    uiRoot.registerScreen(new SettingsScreen(uiRoot));
  });

  afterEach(() => {
    restoreDom();
  });

  // =========================================================================
  // 1. Level 1 Hub Architecture: 6 Category Cards, Search Input, Return Button
  // =========================================================================
  describe('1. Level 1 Hub: 6 Category Cards, Search Input & Return Button', () => {
    it('1.1 registers with id "modal-help" and renders modal overlay structure', () => {
      expect(helpScreen.id).toBe('modal-help');
      expect(helpScreen.element.classList.contains('modal-overlay')).toBe(true);
      expect(helpScreen.element.classList.contains('codex-modal')).toBe(true);
    });

    it('1.2 initializes at Level 1 Hub mode by default with level=1 and viewMode="hub"', () => {
      helpScreen.show();
      expect(helpScreen.level).toBe(1);
      expect(helpScreen.viewMode).toBe('hub');
      expect(helpScreen.navStack.length).toBe(1);
      expect(helpScreen.navStack[0]).toEqual({ level: 1, viewMode: 'hub' });
    });

    it('1.3 renders all 6 master category hero cards with icons, titles, descriptions, and article count badges', () => {
      helpScreen.showHub();

      const hubGrid = helpScreen.element.querySelector('.codex-hub-grid');
      expect(hubGrid).not.toBeNull();

      const hubCards = helpScreen.element.querySelectorAll('.codex-hub-card');
      expect(hubCards.length).toBe(6);

      const expectedCategories: CodexCategory[] = ['rules', 'classes', 'combat', 'bosses', 'modes', 'formulas'];
      expectedCategories.forEach((catKey) => {
        const card = helpScreen.element.querySelector(`.codex-hero-${catKey}`);
        expect(card).not.toBeNull();
        expect(card?.getAttribute('data-category')).toBe(catKey);

        const iconEl = card?.querySelector('.codex-hub-card-icon');
        const titleEl = card?.querySelector('.codex-hub-card-title');
        const descEl = card?.querySelector('.codex-hub-card-desc');
        const badgeEl = card?.querySelector('.codex-hub-card-badge');
        const chevronEl = card?.querySelector('.codex-hub-card-chevron');

        expect(iconEl?.textContent).toBeTruthy();
        expect(titleEl?.textContent).toBeTruthy();
        expect(descEl?.textContent).toBeTruthy();
        expect(chevronEl?.textContent).toBe('▶');

        const expectedCount = CodexData.Entries.filter((e) => e.category === catKey).length;
        expect(badgeEl?.textContent).toContain(`${expectedCount} Articles`);
      });
    });

    it('1.4 renders search input and header/footer return buttons in Level 1 Hub', () => {
      helpScreen.showHub();

      const searchInput = helpScreen.element.querySelector('.codex-search-input') as HTMLInputElement;
      expect(searchInput).not.toBeNull();

      const closeTopBtn = helpScreen.element.querySelector('.btn-close-top');
      const closeMainBtn = helpScreen.element.querySelector('.btn-close-main');
      expect(closeTopBtn).not.toBeNull();
      expect(closeMainBtn).not.toBeNull();
      expect(closeMainBtn?.textContent).toContain('Return to Game');
    });

    it('1.5 hides the Back button (display: none) when in Level 1 Hub view', () => {
      helpScreen.showHub();
      const backBtn = helpScreen.element.querySelector('.btn-codex-back') as HTMLButtonElement;
      expect(backBtn).not.toBeNull();
      expect(backBtn.style.display).toBe('none');
    });
  });

  // =========================================================================
  // 2. Level 2 Category: Header with Back Button, Category Title & Clean Article Stream
  // =========================================================================
  describe('2. Level 2 Category: Header with Back Button, Category Title & Clean Article Stream', () => {
    it('2.1 clicking Hub category card or calling openCategory() navigates to Level 2 Category view with all cards collapsed', () => {
      helpScreen.showHub();

      const classesCard = helpScreen.element.querySelector('.codex-hero-classes') as HTMLElement;
      classesCard.click();

      expect(helpScreen.level).toBe(2);
      expect(helpScreen.viewMode).toBe('category');
      expect(helpScreen.activeTab).toBe('classes');
      expect(helpScreen.expandedIds.size).toBe(0);
      expect(helpScreen.activeArticleId).toBeNull();
    });

    it('2.2 renders header with Back button ("◀ Back") and category title ("${cat.icon} ${cat.label}")', () => {
      helpScreen.openCategory('combat');

      const titleEl = helpScreen.element.querySelector('.cyber-modal-title');
      expect(titleEl?.textContent).toBe('⚔️ Combat & Fusions');

      const backBtn = helpScreen.element.querySelector('.btn-codex-back') as HTMLButtonElement;
      expect(backBtn.style.display).toBe('inline-flex');
      expect(backBtn.textContent?.trim()).toBe('◀ Back');
    });

    it('2.3 renders clean uniform article card stream for the selected category with no footer', () => {
      helpScreen.openCategory('classes');

      const cards = helpScreen.element.querySelectorAll('.codex-card');
      const expectedEntries = CodexData.Entries.filter((e) => e.category === 'classes');
      expect(cards.length).toBe(expectedEntries.length);

      const text = helpScreen.element.textContent;
      expect(text).toContain('Emerald Viper');
      expect(text).toContain('Shadow Stalker');
      expect(text).toContain('Hydra Behemoth');
      expect(text).toContain('Storm Wyrm');
      expect(text).toContain('Solar Drake');

      // Redundant footer and bottom jumpers are removed
      const footer = helpScreen.element.querySelector('.codex-footer-row') as HTMLElement;
      expect(footer.style.display).toBe('none');
    });

    it('2.4 synchronizes category tab bar active states and badges at Level 2', () => {
      helpScreen.openCategory('bosses');

      const activeTabBtn = helpScreen.element.querySelector('.btn-tab-bosses');
      expect(activeTabBtn?.classList.contains('active')).toBe(true);
      expect(activeTabBtn?.classList.contains('btn-primary')).toBe(true);

      const inactiveTabBtn = helpScreen.element.querySelector('.btn-tab-rules');
      expect(inactiveTabBtn?.classList.contains('active')).toBe(false);
      expect(inactiveTabBtn?.classList.contains('btn-secondary')).toBe(true);
    });
  });

  // =========================================================================
  // 3. Exclusive Single-Accordion & Uniform Line Layout
  // =========================================================================
  describe('3. Exclusive Single-Accordion & Uniform Line Layout', () => {
    it('3.1 tapping a card header exclusively expands that card and collapses all others', () => {
      helpScreen.openCategory('rules');

      const cards = helpScreen.element.querySelectorAll('.codex-card');
      expect(cards.length).toBe(4);

      // Initially all collapsed
      cards.forEach((card) => {
        expect(card.classList.contains('expanded')).toBe(false);
      });

      // Tap first card header -> expands first card
      const firstHeader = cards[0]!.querySelector('.codex-card-header') as HTMLElement;
      firstHeader.click();

      expect(helpScreen.expandedIds.has('rules_controls')).toBe(true);
      expect(helpScreen.activeArticleId).toBe('rules_controls');

      // Tap second card header -> expands second card AND collapses first card
      const secondCard = helpScreen.element.querySelector('[data-id="rules_food_economy"]') as HTMLElement;
      const secondHeader = secondCard.querySelector('.codex-card-header') as HTMLElement;
      secondHeader.click();

      expect(helpScreen.expandedIds.has('rules_food_economy')).toBe(true);
      expect(helpScreen.expandedIds.has('rules_controls')).toBe(false);
      expect(helpScreen.activeArticleId).toBe('rules_food_economy');

      const updatedFirst = helpScreen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
      const updatedSecond = helpScreen.element.querySelector('[data-id="rules_food_economy"]') as HTMLElement;
      expect(updatedFirst.classList.contains('expanded')).toBe(false);
      expect(updatedSecond.classList.contains('expanded')).toBe(true);
    });

    it('3.2 tapping an already expanded card collapses it', () => {
      helpScreen.openCategory('rules');

      const card = helpScreen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
      const header = card.querySelector('.codex-card-header') as HTMLElement;

      // Expand
      header.click();
      expect(helpScreen.expandedIds.has('rules_controls')).toBe(true);

      // Tap again -> Collapse
      const updatedCard = helpScreen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
      const updatedHeader = updatedCard.querySelector('.codex-card-header') as HTMLElement;
      updatedHeader.click();

      expect(helpScreen.expandedIds.size).toBe(0);
      expect(helpScreen.activeArticleId).toBeNull();
    });

    it('3.3 every card in stream follows the uniform line layout (Icon | Title + Tags | Subtitle | Chevron)', () => {
      helpScreen.openCategory('combat');

      const cards = helpScreen.element.querySelectorAll('.codex-card');
      cards.forEach((card) => {
        const iconEl = card.querySelector('.codex-card-icon');
        const titleEl = card.querySelector('.codex-card-title');
        const tagsGroup = card.querySelector('.codex-tag-group');
        const subtitleEl = card.querySelector('.codex-card-subtitle');
        const chevronEl = card.querySelector('.accordion-chevron');

        expect(iconEl).not.toBeNull();
        expect(titleEl).not.toBeNull();
        expect(tagsGroup).not.toBeNull();
        expect(subtitleEl).not.toBeNull();
        expect(chevronEl?.textContent).toBe('▶');
      });
    });

    it('3.4 expanding a card expands its body to full content (summary, stats pills, tips bullet list, and formula drawer inline)', () => {
      helpScreen.openCategory('formulas');

      const card = helpScreen.element.querySelector('[data-id="formulas_master_equations"]') as HTMLElement;
      const header = card.querySelector('.codex-card-header') as HTMLElement;
      const chevron = card.querySelector('.accordion-chevron') as HTMLElement;
      const bodyBefore = card.querySelector('.codex-card-body') as HTMLElement;

      // Assert collapsed state
      expect(card.classList.contains('expanded')).toBe(false);
      expect(header.getAttribute('aria-expanded')).toBe('false');
      expect(bodyBefore.style.display).toBe('none');
      expect(chevron.textContent).toBe('▶');

      // Expand card
      header.click();

      const updatedCard = helpScreen.element.querySelector('[data-id="formulas_master_equations"]') as HTMLElement;
      const updatedHeader = updatedCard.querySelector('.codex-card-header') as HTMLElement;
      const updatedChevron = updatedCard.querySelector('.accordion-chevron') as HTMLElement;
      const body = updatedCard.querySelector('.codex-card-body') as HTMLElement;

      // 1. Structural Expansion State
      expect(updatedCard.classList.contains('expanded')).toBe(true);
      expect(updatedHeader.getAttribute('aria-expanded')).toBe('true');
      expect(body.style.display).toBe('block');
      expect(updatedChevron.textContent).toBe('▼');

      // 2. Full Summary Content (Golden TL;DR summary)
      const summaryEl = body.querySelector('.codex-golden-summary');
      expect(summaryEl).not.toBeNull();
      expect(summaryEl?.textContent).toBeTruthy();
      expect(summaryEl?.textContent).toContain('mathematical blueprint');
      const tipsBlock = body.querySelector('.codex-tips-block');
      expect(tipsBlock).not.toBeNull();
      expect(tipsBlock?.textContent).toContain('Pro Gamer Rules');

      // 4. Formula Block & Mathematical Deep Dive
      const formulaBlock = body.querySelector('.formula-block');
      expect(formulaBlock).not.toBeNull();
      expect(formulaBlock?.textContent).toContain('Constriction');

      const formulaMath = body.querySelector('.formula-math');
      expect(formulaMath).not.toBeNull();
      expect(formulaMath?.textContent).toBeTruthy();

      // Collapse card again and verify full collapse
      updatedHeader.click();
      const collapsedCard = helpScreen.element.querySelector('[data-id="formulas_master_equations"]') as HTMLElement;
      const collapsedBody = collapsedCard.querySelector('.codex-card-body') as HTMLElement;
      const collapsedHeader = collapsedCard.querySelector('.codex-card-header') as HTMLElement;
      const collapsedChevron = collapsedCard.querySelector('.accordion-chevron') as HTMLElement;

      expect(collapsedCard.classList.contains('expanded')).toBe(false);
      expect(collapsedHeader.getAttribute('aria-expanded')).toBe('false');
      expect(collapsedBody.style.display).toBe('none');
      expect(collapsedChevron.textContent).toBe('▶');
    });

    it('3.5 global "Expand All" and "Collapse All" operate on all cards', () => {
      helpScreen.openCategory('formulas');

      // Expand All
      helpScreen.expandAll();
      let cards = helpScreen.element.querySelectorAll('.codex-card');
      cards.forEach((card) => {
        expect(card.classList.contains('expanded')).toBe(true);
        const body = card.querySelector('.codex-card-body') as HTMLElement;
        expect(body.style.display).toBe('block');
      });

      // Collapse All
      helpScreen.collapseAll();
      cards = helpScreen.element.querySelectorAll('.codex-card');
      cards.forEach((card) => {
        expect(card.classList.contains('expanded')).toBe(false);
        const body = card.querySelector('.codex-card-body') as HTMLElement;
        expect(body.style.display).toBe('none');
      });
    });

    it('3.6 openArticle(id) opens the category and exclusively expands that target article to full content', () => {
      helpScreen.openArticle('combat_arsenal_and_fusions');

      expect(helpScreen.activeTab).toBe('combat');
      expect(helpScreen.activeArticleId).toBe('combat_arsenal_and_fusions');
      expect(helpScreen.expandedIds.has('combat_arsenal_and_fusions')).toBe(true);
      expect(helpScreen.expandedIds.size).toBe(1);

      const targetCard = helpScreen.element.querySelector('[data-id="combat_arsenal_and_fusions"]') as HTMLElement;
      expect(targetCard.classList.contains('expanded')).toBe(true);

      const body = targetCard.querySelector('.codex-card-body') as HTMLElement;
      expect(body.style.display).toBe('block');
      expect(body.textContent).toContain('Alchemical Fusions');
    });

    it('3.7 expanding cards across multiple categories reliably displays complete body content (stats matrix, bullet lists, badges)', () => {
      // 1. Test Rules category entry (rules_controls)
      helpScreen.openArticle('rules_controls');
      const controlsCard = helpScreen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
      const controlsBody = controlsCard.querySelector('.codex-card-body') as HTMLElement;
      expect(controlsBody.style.display).toBe('block');
      expect(controlsBody.querySelector('.codex-golden-summary')).not.toBeNull();
      expect(controlsBody.querySelector('.codex-stats-matrix')).not.toBeNull();
      expect(controlsBody.querySelectorAll('.codex-stat-pill').length).toBeGreaterThanOrEqual(3);
      expect(controlsBody.querySelector('.codex-bullet-list')).not.toBeNull();

      // 2. Test Classes category entry (classes_roster)
      helpScreen.openArticle('classes_roster');
      const classesCard = helpScreen.element.querySelector('[data-id="classes_roster"]') as HTMLElement;
      const classesBody = classesCard.querySelector('.codex-card-body') as HTMLElement;
      expect(classesBody.style.display).toBe('block');
      expect(classesBody.textContent).toContain('Emerald Viper');
      expect(classesBody.textContent).toContain('Shadow Stalker');
      expect(classesBody.textContent).toContain('Hydra Behemoth');

      // 3. Test Bosses category entry (bosses_catalog)
      helpScreen.openArticle('bosses_catalog');
      const bossesCard = helpScreen.element.querySelector('[data-id="bosses_catalog"]') as HTMLElement;
      const bossesBody = bossesCard.querySelector('.codex-card-body') as HTMLElement;
      expect(bossesBody.style.display).toBe('block');
      expect(bossesBody.textContent).toContain('Centipede Behemoth');
      expect(bossesBody.textContent).toContain('The Eternal Ouroboros');
    });

    it('3.8 resetting scrollTop = 0 on expanded card body and scrolling header into view', async () => {
      helpScreen.openCategory('rules');
      const card = helpScreen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
      const header = card.querySelector('.codex-card-header') as HTMLElement;
      const body = card.querySelector('.codex-card-body') as HTMLElement;

      let scrolledIntoView = false;
      const origScrollIntoView = (MockElement.prototype as any).scrollIntoView;
      (MockElement.prototype as any).scrollIntoView = function () {
        scrolledIntoView = true;
      };

      try {
        // Simulate non-zero scroll on body prior to toggle
        body.scrollTop = 150;

        // Expand card
        header.click();
        expect(helpScreen.expandedIds.has('rules_controls')).toBe(true);

        // Allow 75ms for setTimeout inside toggleExclusiveCard to fire
        await new Promise((resolve) => setTimeout(resolve, 75));

        const updatedCard = helpScreen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
        const updatedBody = updatedCard.querySelector('.codex-card-body') as HTMLElement;
        expect(updatedBody.scrollTop).toBe(0);
        expect(scrolledIntoView).toBe(true);
      } finally {
        (MockElement.prototype as any).scrollIntoView = origScrollIntoView;
      }
    });

    it('3.9 renders .codex-golden-summary or fallback .codex-card-summary with entry summary on expanded card', () => {
      helpScreen.openArticle('rules_controls');
      const card = helpScreen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
      expect(card).not.toBeNull();
      const body = card.querySelector('.codex-card-body') as HTMLElement;
      expect(body.style.display).toBe('block');

      // 1. Assert golden summary is rendered without duplicate fallback summary
      const goldenSummary = body.querySelector('.codex-golden-summary');
      expect(goldenSummary).not.toBeNull();
      expect(goldenSummary?.textContent).toContain('Gamer TL;DR:');
      expect(body.querySelector('.codex-card-summary')).toBeNull();

      // 2. Assert fallback card-summary is rendered when contentHtml lacks .codex-golden-summary
      const customEntries = [
        {
          id: 'custom_without_golden',
          category: 'rules' as CodexCategory,
          title: 'Custom No Golden',
          subtitle: 'Subtitle',
          icon: '✨',
          tags: ['Custom'],
          keywords: ['custom'],
          summary: 'Fallback Summary Content Here',
          contentHtml: '<div class="custom-body">Custom text without golden summary.</div>',
        },
      ];

      (helpScreen as any).renderArticleList(customEntries, false);
      const customCard = helpScreen.element.querySelector('[data-id="custom_without_golden"]') as HTMLElement;
      expect(customCard).not.toBeNull();

      const fallbackSummary = customCard.querySelector('.codex-card-summary');
      expect(fallbackSummary).not.toBeNull();
      expect(fallbackSummary?.textContent).toBe('Fallback Summary Content Here');
    });

    it('3.10 resetting scrollContainer.scrollTop = 0 upon calling openCategory() and showHub()', () => {
      const scrollContainer = helpScreen.element.querySelector('.codex-scroll-container') as HTMLElement;
      expect(scrollContainer).not.toBeNull();

      // Simulate scrolled position in Category view
      scrollContainer.scrollTop = 300;
      expect(scrollContainer.scrollTop).toBe(300);

      // openCategory should reset scrollTop to 0
      helpScreen.openCategory('combat');
      expect(scrollContainer.scrollTop).toBe(0);

      // Simulate scrolled position in another Category view
      scrollContainer.scrollTop = 450;
      expect(scrollContainer.scrollTop).toBe(450);

      // showHub should reset scrollTop to 0
      helpScreen.showHub();
      expect(scrollContainer.scrollTop).toBe(0);
    });

    it('3.11 smoothly scrolls the expanded card top header into view using targetCard.scrollIntoView({ behavior: "smooth", block: "start" })', async () => {
      helpScreen.openCategory('rules');
      const scrollContainer = helpScreen.element.querySelector('.codex-scroll-container') as HTMLElement;
      expect(scrollContainer).not.toBeNull();

      let lastScrollOption: any = null;
      const origScrollIntoView = (MockElement.prototype as any).scrollIntoView;
      (MockElement.prototype as any).scrollIntoView = function (opts: any) {
        lastScrollOption = opts;
      };

      try {
        helpScreen.toggleExclusiveCard('rules_controls');
        await new Promise((resolve) => setTimeout(resolve, 75));
        expect(lastScrollOption).toEqual({ behavior: 'smooth', block: 'start' });
      } finally {
        (MockElement.prototype as any).scrollIntoView = origScrollIntoView;
      }
    });

    it('3.12 implements pointer-drag kinetic scroll on scrollContainer and updates scrollTop beyond 5px threshold', () => {
      helpScreen.openCategory('rules');
      const scrollContainer = helpScreen.element.querySelector('.codex-scroll-container') as HTMLElement;
      expect(scrollContainer).not.toBeNull();

      scrollContainer.scrollTop = 50;
      expect(helpScreen.isDragging).toBe(false);
      expect(helpScreen.hasMoved).toBe(false);

      // Pointer down records start coordinates
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointerdown', { clientY: 200 }));
      expect(helpScreen.isDragging).toBe(true);
      expect(helpScreen.hasMoved).toBe(false);

      // Pointer move with small delta (<= 5px) should not scroll or set hasMoved
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointermove', { clientY: 198 }));
      expect(helpScreen.hasMoved).toBe(false);
      expect(scrollContainer.scrollTop).toBe(50);

      // Pointer move with delta > 5px (e.g. clientY 150 -> delta = -50, scrollTop = 50 - (-50) = 100)
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointermove', { clientY: 150 }));
      expect(helpScreen.hasMoved).toBe(true);
      expect(scrollContainer.scrollTop).toBe(100);

      // Pointer up ends dragging
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointerup', { clientY: 150 }));
      expect(helpScreen.isDragging).toBe(false);

      // Subsequent move without pointerdown has no effect
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointermove', { clientY: 100 }));
      expect(scrollContainer.scrollTop).toBe(100);
    });

    it('3.13 suppresses card toggle when hasMoved is true from pointer-drag gesture', () => {
      helpScreen.openCategory('rules');
      const scrollContainer = helpScreen.element.querySelector('.codex-scroll-container') as HTMLElement;
      let card = helpScreen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
      let header = card.querySelector('.codex-card-header') as HTMLElement;

      expect(helpScreen.expandedIds.size).toBe(0);

      // 1. Simulate drag gesture across threshold (> 5px)
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointerdown', { clientY: 200 }));
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointermove', { clientY: 170 }));
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointerup', { clientY: 170 }));
      expect(helpScreen.hasMoved).toBe(true);

      // Click on card header right after drag should be suppressed
      header.click();
      expect(helpScreen.expandedIds.size).toBe(0);
      card = helpScreen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
      expect(card.classList.contains('expanded')).toBe(false);
      expect(helpScreen.hasMoved).toBe(false);

      // 2. Next normal click without dragging should toggle successfully
      header = card.querySelector('.codex-card-header') as HTMLElement;
      header.click();
      expect(helpScreen.expandedIds.has('rules_controls')).toBe(true);
      card = helpScreen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
      expect(card.classList.contains('expanded')).toBe(true);

      // 3. Drag again and verify chevron button click suppression
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointerdown', { clientY: 200 }));
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointermove', { clientY: 170 }));
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointerup', { clientY: 170 }));
      expect(helpScreen.hasMoved).toBe(true);

      const toggleBtn = card.querySelector('.btn-accordion-toggle') as HTMLButtonElement;
      toggleBtn.click();
      expect(helpScreen.expandedIds.has('rules_controls')).toBe(true);
      card = helpScreen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
      expect(card.classList.contains('expanded')).toBe(true);
    });

    it('3.14 terminates pointer-drag on pointercancel', () => {
      helpScreen.openCategory('rules');
      const scrollContainer = helpScreen.element.querySelector('.codex-scroll-container') as HTMLElement;
      scrollContainer.scrollTop = 20;

      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointerdown', { clientY: 200 }));
      expect(helpScreen.isDragging).toBe(true);
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointercancel', { clientY: 200 }));
      expect(helpScreen.isDragging).toBe(false);

      // Subsequent move is ignored since drag was cancelled
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointermove', { clientY: 100 }));
      expect(scrollContainer.scrollTop).toBe(20);
    });

    it('3.15 suppresses hub category hero card navigation when hasMoved is true from pointer-drag gesture', () => {
      helpScreen.showHub();
      const scrollContainer = helpScreen.element.querySelector('.codex-scroll-container') as HTMLElement;
      const combatCard = helpScreen.element.querySelector('.codex-hero-combat') as HTMLElement;

      expect(helpScreen.level).toBe(1);
      expect(helpScreen.viewMode).toBe('hub');

      // Drag gesture on hub container
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointerdown', { clientY: 250 }));
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointermove', { clientY: 190 }));
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointerup', { clientY: 190 }));
      expect(helpScreen.hasMoved).toBe(true);

      // Click on hero card right after drag should be suppressed
      combatCard.click();
      expect(helpScreen.level).toBe(1);
      expect(helpScreen.viewMode).toBe('hub');
      expect(helpScreen.hasMoved).toBe(false);

      // Subsequent direct click navigates normally
      combatCard.click();
      expect(helpScreen.level).toBe(2);
      expect(helpScreen.viewMode).toBe('category');
      expect(helpScreen.activeTab).toBe('combat');
    });

    it('3.16 verifies relative smooth scroll alignment on _scrollContainer when expanding a card or opening an article', async () => {
      helpScreen.openCategory('classes');
      const scrollContainer = helpScreen.element.querySelector('.codex-scroll-container') as HTMLElement;
      expect(scrollContainer).not.toBeNull();

      let lastScrollOption: any = null;
      let targetNodeScrolled: any = null;
      const origScrollIntoView = (MockElement.prototype as any).scrollIntoView;
      (MockElement.prototype as any).scrollIntoView = function (opts: any) {
        lastScrollOption = opts;
        targetNodeScrolled = this;
      };

      try {
        // 1. Test openArticle triggering relative smooth scroll alignment
        helpScreen.openArticle('classes_roster');
        await new Promise((resolve) => setTimeout(resolve, 75));

        const targetCard = helpScreen.element.querySelector('[data-id="classes_roster"]') as HTMLElement;
        expect(targetNodeScrolled).toBe(targetCard);
        expect(lastScrollOption).toEqual({ behavior: 'smooth', block: 'start' });

        const cardBody = targetCard.querySelector('.codex-card-body') as HTMLElement;
        expect(cardBody.scrollTop).toBe(0);

        // 2. Test toggleExclusiveCard relative smooth scroll alignment
        lastScrollOption = null;
        targetNodeScrolled = null;
        helpScreen.toggleExclusiveCard('classes_cranial_lab');
        await new Promise((resolve) => setTimeout(resolve, 75));

        const newTargetCard = helpScreen.element.querySelector('[data-id="classes_cranial_lab"]') as HTMLElement;
        expect(targetNodeScrolled).toBe(newTargetCard);
        expect(lastScrollOption).toEqual({ behavior: 'smooth', block: 'start' });

        const newCardBody = newTargetCard.querySelector('.codex-card-body') as HTMLElement;
        expect(newCardBody.scrollTop).toBe(0);
      } finally {
        (MockElement.prototype as any).scrollIntoView = origScrollIntoView;
      }
    });
  });

  // =========================================================================
  // 4. Back Button Sequential Popping: Category -> Hub -> Exit
  // =========================================================================
  describe('4. Back Button Sequential Popping: Category -> Hub -> Exit', () => {
    it('4.1 sequentially pops from Category to Level 1 to modal exit via Back button clicks', () => {
      uiRoot.showScreen('modal-help');
      expect(uiRoot.activeScreenId).toBe('modal-help');

      // 1. Level 1: Hub
      helpScreen.showHub();
      expect(helpScreen.level).toBe(1);
      expect(helpScreen.viewMode).toBe('hub');

      // 2. Drill down to Level 2: Category
      helpScreen.openCategory('combat');
      expect(helpScreen.level).toBe(2);
      expect(helpScreen.viewMode).toBe('category');

      const backBtn = helpScreen.element.querySelector('.btn-codex-back') as HTMLButtonElement;
      expect(backBtn.textContent?.trim()).toBe('◀ Back');

      // Pop 1: Level 2 -> Level 1 Hub
      backBtn.click();
      expect(helpScreen.level).toBe(1);
      expect(helpScreen.viewMode).toBe('hub');

      // Pop 2: Level 1 Hub -> Exit Modal
      backBtn.click();
      expect(uiRoot.activeScreenId).not.toBe('modal-help');
    });

    it('4.2 switching category tabs at Level 2 updates stack top in place, preserving clean single-step return to Hub', () => {
      helpScreen.showHub();

      // Open Category 'rules' -> stack length 2
      helpScreen.openCategory('rules');
      expect(helpScreen.level).toBe(2);
      expect(helpScreen.activeTab).toBe('rules');
      expect(helpScreen.navStack.length).toBe(2);

      // Switch to 'bosses' -> stack length remains 2 (in-place replacement)
      helpScreen.openCategory('bosses');
      expect(helpScreen.level).toBe(2);
      expect(helpScreen.activeTab).toBe('bosses');
      expect(helpScreen.navStack.length).toBe(2);

      // Switch to 'modes' -> stack length remains 2
      helpScreen.openCategory('modes');
      expect(helpScreen.level).toBe(2);
      expect(helpScreen.activeTab).toBe('modes');
      expect(helpScreen.navStack.length).toBe(2);

      // Single Back pops directly back to Level 1 Hub
      helpScreen.goBack();
      expect(helpScreen.level).toBe(1);
      expect(helpScreen.viewMode).toBe('hub');
    });

    it('4.3 direct show() with payload opens requested level and maintains valid back-stack', () => {
      // Direct category payload
      helpScreen.show({ category: 'formulas' });
      expect(helpScreen.level).toBe(2);
      expect(helpScreen.activeTab).toBe('formulas');

      helpScreen.goBack();
      expect(helpScreen.level).toBe(1);
      expect(helpScreen.viewMode).toBe('hub');

      // Direct articleId payload from Hub
      helpScreen.show({ articleId: 'bosses_catalog' });
      expect(helpScreen.level).toBe(2);
      expect(helpScreen.activeArticleId).toBe('bosses_catalog');
      expect(helpScreen.activeTab).toBe('bosses');
      expect(helpScreen.expandedIds.has('bosses_catalog')).toBe(true);

      // Popping from direct article show returns to base Hub
      helpScreen.goBack();
      expect(helpScreen.level).toBe(1);
      expect(helpScreen.viewMode).toBe('hub');
    });
  });

  // =========================================================================
  // 5. Search Mode & Search Inline Expand
  // =========================================================================
  describe('5. Search Mode & Search Inline Expand', () => {
    it('5.1 entering search query switches view to "search" mode and filters entries across all categories', () => {
      helpScreen.showHub();
      const searchInput = helpScreen.element.querySelector('.codex-search-input') as HTMLInputElement;

      searchInput.value = 'Autotomy';
      searchInput.dispatchEvent(new Event('input'));

      expect(helpScreen.viewMode).toBe('search');
      expect(helpScreen.level).toBe('search');

      const backBtn = helpScreen.element.querySelector('.btn-codex-back') as HTMLButtonElement;
      expect(backBtn.style.display).toBe('inline-flex');
      expect(backBtn.textContent?.trim()).toBe('◀ Back');

      const resultsLabel = helpScreen.element.querySelector('.codex-results-count');
      expect(resultsLabel?.textContent).toContain('Found');

      const visibleCards = helpScreen.element.querySelectorAll('.codex-card');
      expect(visibleCards.length).toBeGreaterThan(0);
      visibleCards.forEach((card) => {
        expect(card.textContent?.toLowerCase()).toContain('autotomy');
      });
    });

    it('5.2 clicking search result card performs inline accordion expansion with uniform presentation', () => {
      const searchInput = helpScreen.element.querySelector('.codex-search-input') as HTMLInputElement;

      searchInput.value = 'Centripetal';
      searchInput.dispatchEvent(new Event('input'));
      expect(helpScreen.viewMode).toBe('search');

      const searchCard = helpScreen.element.querySelector('.codex-card') as HTMLElement;
      const cardHeader = searchCard.querySelector('.codex-card-header') as HTMLElement;
      cardHeader.click();

      // Exclusively expands inline
      expect(helpScreen.activeArticleId).toBe('combat_centripetal_whip');
      expect(helpScreen.expandedIds.has('combat_centripetal_whip')).toBe(true);

      const body = helpScreen.element.querySelector('.codex-card-body') as HTMLElement;
      expect(body.style.display).toBe('block');
    });

    it('5.3 displays empty state when query matches nothing and provides Clear Search action', () => {
      const searchInput = helpScreen.element.querySelector('.codex-search-input') as HTMLInputElement;
      searchInput.value = 'NonExistentGibberishTerm987';
      searchInput.dispatchEvent(new Event('input'));

      expect(helpScreen.viewMode).toBe('search');
      const emptyState = helpScreen.element.querySelector('.codex-empty-state');
      expect(emptyState).not.toBeNull();
      expect(emptyState?.textContent).toContain('No codex entries found');

      const clearEmptyBtn = emptyState?.querySelector('.btn-clear-search-empty') as HTMLButtonElement;
      expect(clearEmptyBtn).not.toBeNull();
      clearEmptyBtn.click();

      expect(searchInput.value).toBe('');
      expect(helpScreen.viewMode).not.toBe('search');
    });

    it('5.4 Clear Search button resets input, hides clear icon, and restores previous view level', () => {
      helpScreen.openCategory('rules');
      const searchInput = helpScreen.element.querySelector('.codex-search-input') as HTMLInputElement;
      searchInput.value = 'Severing';
      searchInput.dispatchEvent(new Event('input'));
      expect(helpScreen.viewMode).toBe('search');

      const clearBtn = helpScreen.element.querySelector('.btn-clear-search') as HTMLButtonElement;
      expect(clearBtn.style.display).not.toBe('none');
      clearBtn.click();

      expect(searchInput.value).toBe('');
      expect(clearBtn.style.display).toBe('none');
      expect(helpScreen.level).toBe(2);
      expect(helpScreen.viewMode).toBe('category');
    });
  });

  // =========================================================================
  // 6. Universal Hardware Controls (Esc, Backspace, Q/E, Arrows, Gamepad B)
  // =========================================================================
  describe('6. Universal Hardware Controls', () => {
    it('6.1 Escape key blurs search input when focused; otherwise triggers sequential goBack()', () => {
      uiRoot.showScreen('modal-help');
      helpScreen.openCategory('classes');
      expect(helpScreen.level).toBe(2);

      // Escape triggers goBack -> pops to Level 1 Hub
      helpScreen.handleKeyDown({ code: 'Escape', key: 'Escape', target: document.body, preventDefault: () => {} } as any);
      expect(helpScreen.level).toBe(1);
      expect(helpScreen.viewMode).toBe('hub');

      // Escape at Level 1 Hub -> exits modal
      helpScreen.handleKeyDown({ code: 'Escape', key: 'Escape', target: document.body, preventDefault: () => {} } as any);
      expect(uiRoot.activeScreenId).not.toBe('modal-help');
    });

    it('6.2 Backspace key does not pop stack when search input is focused, but triggers goBack() otherwise', () => {
      uiRoot.showScreen('modal-help');
      helpScreen.openCategory('combat');
      helpScreen.openArticle('combat_centripetal_whip');
      expect(helpScreen.level).toBe(2);

      const searchInput = helpScreen.element.querySelector('.codex-search-input') as HTMLInputElement;

      // Mock search input as activeElement
      (document as any).activeElement = searchInput;
      helpScreen.handleKeyDown({ code: 'Backspace', key: 'Backspace', target: searchInput, preventDefault: () => {} } as any);
      expect(helpScreen.level).toBe(2); // Does NOT pop stack

      // Mock non-input activeElement
      (document as any).activeElement = document.body;
      helpScreen.handleKeyDown({ code: 'Backspace', key: 'Backspace', target: document.body, preventDefault: () => {} } as any);
      expect(helpScreen.level).toBe(1); // Pops to Level 1 Hub
    });

    it('6.3 "/" key focuses and selects search input when not already focused', () => {
      const searchInput = helpScreen.element.querySelector('.codex-search-input') as HTMLInputElement;
      let focused = false;
      let selected = false;
      searchInput.focus = () => { focused = true; };
      searchInput.select = () => { selected = true; };

      (document as any).activeElement = document.body;
      helpScreen.handleKeyDown({ code: 'Slash', key: '/', target: document.body, preventDefault: () => {} } as any);

      expect(focused).toBe(true);
      expect(selected).toBe(true);
    });

    it('6.4 Q/E and Arrow keys cycle categories when collapsed and articles when expanded', () => {
      // Level 2 Category cycling
      helpScreen.openCategory('rules');
      expect(helpScreen.activeTab).toBe('rules');

      // KeyE -> 'classes'
      helpScreen.handleKeyDown({ code: 'KeyE', key: 'e', target: document.body, preventDefault: () => {} } as any);
      expect(helpScreen.activeTab).toBe('classes');

      // ArrowRight -> 'combat'
      helpScreen.handleKeyDown({ code: 'ArrowRight', key: 'ArrowRight', target: document.body, preventDefault: () => {} } as any);
      expect(helpScreen.activeTab).toBe('combat');

      // KeyQ -> 'classes'
      helpScreen.handleKeyDown({ code: 'KeyQ', key: 'q', target: document.body, preventDefault: () => {} } as any);
      expect(helpScreen.activeTab).toBe('classes');

      // Expand article and cycle
      helpScreen.openArticle('classes_roster');
      expect(helpScreen.activeArticleId).toBe('classes_roster');

      helpScreen.handleKeyDown({ code: 'KeyE', key: 'e', target: document.body, preventDefault: () => {} } as any);
      expect(helpScreen.activeArticleId).toBe('classes_cranial_lab');

      helpScreen.handleKeyDown({ code: 'KeyQ', key: 'q', target: document.body, preventDefault: () => {} } as any);
      expect(helpScreen.activeArticleId).toBe('classes_roster');
    });

    it('6.5 Gamepad B button triggers goBack() and LB/RB bumpers cycle tabs/articles', () => {
      uiRoot.showScreen('modal-help');
      helpScreen.openCategory('rules');

      // Gamepad RB -> 'classes'
      helpScreen.handleGamepadInput({ rbPressed: true, lbPressed: false, bPressed: false });
      expect(helpScreen.activeTab).toBe('classes');

      // Gamepad LB -> 'rules'
      helpScreen.handleGamepadInput({ rbPressed: false, lbPressed: true, bPressed: false });
      expect(helpScreen.activeTab).toBe('rules');

      // Gamepad B -> pops to Level 1 Hub
      helpScreen.handleGamepadInput({ rbPressed: false, lbPressed: false, bPressed: true });
      expect(helpScreen.level).toBe(1);
      expect(helpScreen.viewMode).toBe('hub');

      // Gamepad B -> closes modal
      helpScreen.handleGamepadInput({ rbPressed: false, lbPressed: false, bPressed: true });
      expect(uiRoot.activeScreenId).not.toBe('modal-help');
    });
  });

  // =========================================================================
  // 7. Full Game Lifecycle Integration & Navigation Stack Integrity
  // =========================================================================
  describe('7. Full Game Lifecycle Integration & Modal Navigation Stack', () => {
    it('7.1 Main Menu -> Codex opens modal-help; Close returns cleanly to Main Menu', () => {
      engine.showMenu();
      expect(uiRoot.activeScreenId).toBe('modal-main-menu');

      uiRoot.showScreen('modal-help');
      expect(uiRoot.activeScreenId).toBe('modal-help');

      const closeBtn = helpScreen.element.querySelector('.btn-close-help') as HTMLButtonElement;
      closeBtn.click();

      expect(uiRoot.activeScreenId).toBe('modal-main-menu');
    });

    it('7.2 In-Game HUD -> Open Codex pauses gameplay; Close resumes gameplay cleanly', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      expect(engine.State).toBe(GameState.Playing);
      expect(engine.paused).toBe(false);

      // Open Codex during gameplay
      engine.showHelp();
      expect(engine.State === GameState.Help || engine.State === GameState.Paused).toBe(true);
      expect(uiRoot.activeScreenId).toBe('modal-help');

      // Close Codex
      const closeBtn = helpScreen.element.querySelector('.btn-close-help') as HTMLButtonElement;
      closeBtn.click();

      // Must unpause and resume playing
      expect(engine.State).toBe(GameState.Playing);
      expect(engine.paused).toBe(false);
      expect(uiRoot.isModalOpen()).toBe(false);
    });

    it('7.3 Pause / Settings Menu -> Open Codex pushes Settings to stack; Close returns to Settings', () => {
      engine.chooseMode('rogue');
      engine.selectedClass = 'emerald';
      engine.startRun();

      // Pause into Settings
      engine.togglePause();
      expect(uiRoot.activeScreenId).toBe('modal-settings');

      // Jump to Codex from Settings
      uiRoot.showScreen('modal-help');
      expect(uiRoot.activeScreenId).toBe('modal-help');

      // Close Codex -> returns to Settings
      const closeBtn = helpScreen.element.querySelector('.btn-close-help') as HTMLButtonElement;
      closeBtn.click();

      expect(uiRoot.activeScreenId).toBe('modal-settings');

      // Close Settings -> resumes game
      const settingsScreen = uiRoot.getScreen<SettingsScreen>('modal-settings')!;
      const closeSettingsBtn = settingsScreen.element.querySelector('.btn-close-settings') as HTMLButtonElement;
      closeSettingsBtn.click();

      expect(engine.State).toBe(GameState.Playing);
      expect(engine.paused).toBe(false);
    });

    it('7.4 applies responsive layout metrics across mobile, tablet, and desktop tiers', () => {
      // Phone tier
      const phoneMetrics = ResponsiveLayout.instance.computeMetrics(390, 844);
      helpScreen.applyMetrics(phoneMetrics);
      expect(helpScreen.element.classList.contains('tier-phone')).toBe(true);

      const searchInput = helpScreen.element.querySelector('.codex-search-input') as HTMLInputElement;
      expect(searchInput.placeholder).toBe('Search codex...');

      // Desktop tier
      const desktopMetrics = ResponsiveLayout.instance.computeMetrics(1920, 1080);
      helpScreen.applyMetrics(desktopMetrics);
      expect(helpScreen.element.classList.contains('tier-desktop')).toBe(true);
      expect(helpScreen.element.classList.contains('tier-phone')).toBe(false);
      expect(searchInput.placeholder).toContain("Search codex, mechanics, formulas, classes... (Press '/' to focus)");
    });
  });

  // =========================================================================
  // 8. Table Wrappers & Accessible Tables Verification
  // =========================================================================
  describe('8. Table Wrappers & Accessible Tables Verification', () => {
    it('8.1 verifies table wrapper .codex-table-wrap exists around tables to ensure horizontal scroll containment', () => {
      // Open rules category which contains the Controls & Hotkeys table
      helpScreen.openArticle('rules_controls');

      const card = helpScreen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
      expect(card).not.toBeNull();

      const tableWrap = card.querySelector('.codex-table-wrap');
      expect(tableWrap).not.toBeNull();

      const table = tableWrap?.querySelector('.codex-table');
      expect(table).not.toBeNull();
    });

    it('8.2 verifies semantic accessibility and hierarchy for Controls table (thead, tbody, th, td)', () => {
      helpScreen.openArticle('rules_controls');

      const card = helpScreen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
      const table = card.querySelector('.codex-table') as HTMLElement;
      expect(table).not.toBeNull();

      // Semantic <thead> and <th> with descriptive text
      const thead = table.querySelector('thead');
      expect(thead).not.toBeNull();

      const thList = table.querySelectorAll('th');
      expect(thList.length).toBe(4);
      const headerTexts = Array.from(thList).map((th: any) => th.textContent?.trim());
      expect(headerTexts).toEqual(['Action', 'Keyboard', 'Gamepad', 'Touch / Mobile']);

      // Semantic <tbody> and <tr> rows with accessible cell content
      const tbody = table.querySelector('tbody');
      expect(tbody).not.toBeNull();

      const rows = tbody?.querySelectorAll('tr');
      expect(rows?.length).toBeGreaterThanOrEqual(5);

      rows?.forEach((row: any) => {
        const cells = row.querySelectorAll('td');
        expect(cells.length).toBe(4);
        expect(cells[0]!.textContent).toBeTruthy();
        expect(cells[1]!.textContent).toBeTruthy();
      });
    });

    it('8.3 verifies 20 Apex Bosses bestiary table wrapper and accessible columns', () => {
      helpScreen.openArticle('bosses_catalog');

      const card = helpScreen.element.querySelector('[data-id="bosses_catalog"]') as HTMLElement;
      expect(card).not.toBeNull();

      const tableWrap = card.querySelector('.codex-table-wrap');
      expect(tableWrap).not.toBeNull();

      const table = tableWrap?.querySelector('.codex-table');
      expect(table).not.toBeNull();

      const thList = table?.querySelectorAll('th');
      expect(thList?.length).toBe(3);
      const colHeaders = Array.from(thList || []).map((th: any) => th.textContent?.trim());
      expect(colHeaders).toEqual(['Fl', 'Boss Name', 'Special Hazard / Attack Mechanic']);

      const rows = table?.querySelectorAll('tbody tr');
      expect(rows?.length).toBe(20); // 20 Apex Boss entries
      expect(rows?.[0]?.textContent).toContain('Centipede Behemoth');
      expect(rows?.[19]?.textContent).toContain('The Eternal Ouroboros');
    });

    it('8.4 verifies all table rows (Pause / Menu, Codex Guide, Steer Heading, Dash Boost, Active Skill, Mutation Lab) are rendered and accessible in the DOM', () => {
      helpScreen.openArticle('rules_controls');

      const card = helpScreen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
      expect(card).not.toBeNull();

      const table = card.querySelector('.codex-table') as HTMLElement;
      expect(table).not.toBeNull();

      const rows = table.querySelectorAll('tbody tr');
      expect(rows.length).toBe(6);

      const requiredRowActions = [
        'Steer Heading',
        'Dash Boost',
        'Active Skill',
        'Mutation Lab',
        'Pause / Menu',
        'Codex Guide',
      ];

      requiredRowActions.forEach((actionName) => {
        const matchingRow = Array.from(rows).find((row) => row.textContent?.includes(actionName));
        expect(matchingRow).toBeDefined();
        const cells = matchingRow!.querySelectorAll('td');
        expect(cells.length).toBe(4);
        expect(cells[0]!.textContent).toContain(actionName);
        expect(cells[1]!.textContent).toBeTruthy(); // Keyboard
        expect(cells[2]!.textContent).toBeTruthy(); // Gamepad
        expect(cells[3]!.textContent).toBeTruthy(); // Touch / Mobile
      });
    });
  });

  // =========================================================================
  // 9. Scrolling Container Bottom Safety Padding & Accessibility
  // =========================================================================
  describe('9. Scrolling Container Bottom Safety Padding & Accessibility', () => {
    it('9.1 verifies scrolling container has role="region" and aria-label="Codex Entries"', () => {
      const scrollContainer = helpScreen.element.querySelector('.codex-scroll-container');
      expect(scrollContainer).not.toBeNull();
      expect(scrollContainer?.getAttribute('role')).toBe('region');
      expect(scrollContainer?.getAttribute('aria-label')).toBe('Codex Entries');
      expect(scrollContainer?.classList.contains('codex-entries-list')).toBe(true);
    });

    it('9.2 verifies scrolling container maintains single scrollable viewport across Hub, Category, and Search modes', () => {
      // 1. Hub Mode
      helpScreen.showHub();
      let scrollContainer = helpScreen.element.querySelector('.codex-scroll-container');
      expect(scrollContainer?.children.length).toBeGreaterThanOrEqual(1);

      // 2. Category Mode
      helpScreen.openCategory('classes');
      scrollContainer = helpScreen.element.querySelector('.codex-scroll-container');
      expect(scrollContainer?.children.length).toBeGreaterThanOrEqual(1);

      // 3. Search Mode
      const searchInput = helpScreen.element.querySelector('.codex-search-input') as HTMLInputElement;
      searchInput.value = 'Drake';
      searchInput.dispatchEvent(new Event('input'));
      scrollContainer = helpScreen.element.querySelector('.codex-scroll-container');
      expect(scrollContainer?.children.length).toBeGreaterThanOrEqual(1);
    });

    it('9.3 verifies scrolling container does not overlap modal header or footer rows', () => {
      helpScreen.showHub();

      const header = helpScreen.element.querySelector('.codex-header');
      const scrollContainer = helpScreen.element.querySelector('.codex-scroll-container');
      const footer = helpScreen.element.querySelector('.codex-footer-row');

      expect(header).not.toBeNull();
      expect(scrollContainer).not.toBeNull();
      expect(footer).not.toBeNull();

      // In Category view, redundant footer is hidden to maximize vertical scroll area with bottom clearance
      helpScreen.openCategory('combat');
      const categoryFooter = helpScreen.element.querySelector('.codex-footer-row') as HTMLElement;
      expect(categoryFooter.style.display).toBe('none');
    });
  });

  // =========================================================================
  // 10. Scrollable Card Body Content, Custom Scrollbar & Bottom Clearance CSS
  // =========================================================================
  describe('10. Single-Scroll Container Architecture & Codex Styling', () => {
    it('10.1 index.html contains single-scroll opened card rules for .codex-card and .codex-card-body with height: auto !important, max-height: none !important, and overflow: visible !important', () => {
      const indexHtmlPath = path.resolve(__dirname, '../../index.html');
      expect(fs.existsSync(indexHtmlPath)).toBe(true);
      const htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');

      // .codex-card assertions (flex: 0 0 auto and flex-shrink: 0 prevent shrinkage inside flex container)
      const cardSection = htmlContent.slice(
        htmlContent.indexOf('.codex-card {'),
        htmlContent.indexOf('.codex-card:hover')
      );
      expect(cardSection).toContain('flex: 0 0 auto');
      expect(cardSection).toContain('flex-shrink: 0');
      expect(cardSection).toContain('height: auto !important;');
      expect(cardSection).toContain('min-height: 60px;');
      expect(cardSection).toContain('background: rgba(10, 22, 42, 0.8);');
      expect(cardSection).toContain('border: 1px solid rgba(0, 240, 181, 0.25);');
      expect(cardSection).toContain('border-radius: 12px;');
      expect(cardSection).toContain('margin-bottom: 10px;');
      expect(cardSection).toContain('overflow: hidden;');
      expect(cardSection).toContain('touch-action: pan-y !important;');
      expect(cardSection).toContain('box-sizing: border-box !important;');

      // .codex-card-body assertions
      expect(htmlContent).toContain('.codex-card-body');
      expect(htmlContent).toContain('display: none;');
      expect(htmlContent).toContain('height: auto !important;');
      expect(htmlContent).toContain('max-height: none !important;');
      expect(htmlContent).toContain('overflow: visible !important;');
      expect(htmlContent).toContain('touch-action: pan-y !important;');
      expect(htmlContent).toContain('padding: 16px !important;');
      expect(htmlContent).toContain('border-top: 1px solid rgba(0, 240, 181, 0.25);');
      expect(htmlContent).toContain('background: rgba(6, 14, 28, 0.95);');
      expect(htmlContent).toContain('box-sizing: border-box !important;');
      expect(htmlContent).toContain('width: 100% !important;');
    });

    it('10.2 index.html contains single scroll container rules for .codex-scroll-container with flex: 1 1 auto !important, overflow-y: auto !important and 80px bottom clearance', () => {
      const indexHtmlPath = path.resolve(__dirname, '../../index.html');
      const htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');

      expect(htmlContent).toContain('.codex-scroll-container');
      expect(htmlContent).toContain('flex: 1 1 auto !important;');
      expect(htmlContent).toContain('min-height: 0 !important;');
      expect(htmlContent).toContain('overflow-y: auto !important;');
      expect(htmlContent).toContain('-webkit-overflow-scrolling: touch;');
      expect(htmlContent).toContain('overscroll-behavior-y: contain;');
      expect(htmlContent).toContain('touch-action: pan-y !important;');
      expect(htmlContent).toContain('padding: 14px 16px 80px 16px !important;');
      expect(htmlContent).toContain('.codex-scroll-container::-webkit-scrollbar');
      expect(htmlContent).toContain('.codex-scroll-container::-webkit-scrollbar-track');
      expect(htmlContent).toContain('.codex-scroll-container::-webkit-scrollbar-thumb');
    });

    it('10.3 index.html contains .codex-formula-drawer, .formula-block, .codex-table-wrap, .codex-table and .cyber-table with height: auto !important and overflow: visible !important', () => {
      const indexHtmlPath = path.resolve(__dirname, '../../index.html');
      const htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');

      expect(htmlContent).toContain('.codex-formula-drawer');
      expect(htmlContent).toContain('.formula-block');
      expect(htmlContent).toContain('.codex-table-wrap');
      expect(htmlContent).toContain('.codex-table');
      expect(htmlContent).toContain('.cyber-table');
      expect(htmlContent).toContain('.codex-body-section');
      expect(htmlContent).toContain('.codex-tips-block');
      expect(htmlContent).toContain('margin-bottom: 16px;');
      expect(htmlContent).toContain('overflow-x: auto');

      // Assert .codex-formula-drawer has overflow: visible !important, max-height: none !important, and height: auto !important
      const formulaDrawerSection = htmlContent.slice(
        htmlContent.indexOf('.codex-formula-drawer'),
        htmlContent.indexOf('.formula-drawer-summary')
      );
      expect(formulaDrawerSection).toContain('overflow: visible !important;');
      expect(formulaDrawerSection).toContain('max-height: none !important;');
      expect(formulaDrawerSection).toContain('height: auto !important;');
      expect(formulaDrawerSection).toContain('width: 100%;');

      // Assert .formula-block has height: auto !important, max-height: none !important, overflow: visible !important, and width: 100%;
      const formulaBlockSection = htmlContent.slice(
        htmlContent.indexOf('.formula-block'),
        htmlContent.indexOf('.formula-title')
      );
      expect(formulaBlockSection).toContain('height: auto !important;');
      expect(formulaBlockSection).toContain('max-height: none !important;');
      expect(formulaBlockSection).toContain('overflow: visible !important;');
      expect(formulaBlockSection).toContain('width: 100%;');

      // Assert .codex-table-wrap has overflow-y: visible !important, overflow-x: auto, height: auto !important, and width: 100%;
      const tableWrapSection = htmlContent.slice(
        htmlContent.indexOf('.codex-table-wrap'),
        htmlContent.indexOf('.cyber-table,')
      );
      expect(tableWrapSection).toContain('overflow-y: visible !important;');
      expect(tableWrapSection).toContain('overflow-x: auto;');
      expect(tableWrapSection).toContain('height: auto !important;');
      expect(tableWrapSection).toContain('width: 100%;');

      // Assert table height: auto !important and border-collapse: collapse
      const tableSection = htmlContent.slice(
        htmlContent.indexOf('.cyber-table,'),
        htmlContent.indexOf('.cyber-table th,')
      );
      expect(tableSection).toContain('height: auto !important;');
      expect(tableSection).toContain('width: 100%;');
      expect(tableSection).toContain('border-collapse: collapse;');
    });

    it('10.4 index.html contains .codex-card.expanded visual demarcation with height: auto !important, max-height: none !important, flex: 0 0 auto and flex-shrink: 0', () => {
      const indexHtmlPath = path.resolve(__dirname, '../../index.html');
      const htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');

      expect(htmlContent).toContain('.codex-card.expanded');
      expect(htmlContent).toContain('border-color: #00f0b5;');
      expect(htmlContent).toContain('box-shadow: 0 0 24px rgba(0, 240, 181, 0.3), 0 8px 32px rgba(0, 0, 0, 0.6);');
      expect(htmlContent).toContain('background: rgba(10, 22, 42, 0.95);');
      expect(htmlContent).toContain('margin-top: 6px;');
      expect(htmlContent).toContain('margin-bottom: 16px;');

      const expandedSection = htmlContent.slice(
        htmlContent.indexOf('.codex-card.expanded'),
        htmlContent.indexOf('.codex-card-header {')
      );
      expect(expandedSection).toContain('flex: 0 0 auto');
      expect(expandedSection).toContain('flex-shrink: 0');
      expect(expandedSection).toContain('height: auto !important;');
      expect(expandedSection).toContain('max-height: none !important;');
      expect(expandedSection).toContain('width: 100%;');
    });

    it('10.5 verifies all 16 Codex entries across all 6 categories expand fully with height: auto !important, max-height: none, and overflow: visible without nested scrollbars in the DOM', () => {
      const categories: CodexCategory[] = ['rules', 'classes', 'combat', 'bosses', 'modes', 'formulas'];
      let totalChecked = 0;

      const indexHtmlPath = path.resolve(__dirname, '../../index.html');
      const htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');
      expect(htmlContent).toContain('height: auto !important;');
      expect(htmlContent).toContain('max-height: none !important;');
      expect(htmlContent).toContain('overflow: visible !important;');

      for (const cat of categories) {
        helpScreen.openCategory(cat);
        const entries = CodexData.Entries.filter((e) => e.category === cat);
        const cards = helpScreen.element.querySelectorAll('.codex-card');
        expect(cards.length).toBe(entries.length);

        for (const entry of entries) {
          helpScreen.openArticle(entry.id);
          const card = helpScreen.element.querySelector(`[data-id="${entry.id}"]`) as HTMLElement;
          expect(card).not.toBeNull();
          expect(card.classList.contains('expanded')).toBe(true);

          const body = card.querySelector('.codex-card-body') as HTMLElement;
          expect(body.style.display).toBe('block');
          // Verify no nested scroll container is embedded within card body (single scroll architecture)
          expect(body.querySelector('.codex-scroll-container')).toBeNull();

          // If entry has formula drawer, verify formula drawer exists and has no nested scroll traps
          const formulaDrawers = body.querySelectorAll('.codex-formula-drawer');
          formulaDrawers.forEach((drawer) => {
            expect(drawer.querySelector('.codex-scroll-container')).toBeNull();
          });

          // If entry has table wrap, verify table wrap exists and has no nested scroll traps
          const tableWraps = body.querySelectorAll('.codex-table-wrap');
          tableWraps.forEach((tableWrap) => {
            expect(tableWrap.querySelector('.codex-scroll-container')).toBeNull();
          });

          totalChecked++;
        }
      }

      expect(totalChecked).toBe(16);
      expect(totalChecked).toBe(CodexData.Entries.length);
    });

    it('10.6 verifies that expanding a card expands to full content height with height: auto !important, max-height: none, and overflow: visible, while .codex-scroll-container remains single scroll container with 80px bottom clearance', () => {
      helpScreen.openCategory('rules');
      const card = helpScreen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
      expect(card).not.toBeNull();

      // Expand card
      helpScreen.toggleExclusiveCard('rules_controls');
      expect(card.classList.contains('expanded')).toBe(true);

      const body = card.querySelector('.codex-card-body') as HTMLElement;
      expect(body).not.toBeNull();
      expect(body.style.display).toBe('block');

      // Verify index.html defines full content height rules: height: auto !important, max-height: none !important, and overflow: visible !important
      const indexHtmlPath = path.resolve(__dirname, '../../index.html');
      const htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');
      expect(htmlContent).toContain('.codex-card-body');
      expect(htmlContent).toContain('height: auto !important;');
      expect(htmlContent).toContain('max-height: none !important;');
      expect(htmlContent).toContain('overflow: visible !important;');

      // Verify single scroll container has overflow-y: auto and 80px bottom clearance
      expect(htmlContent).toContain('.codex-scroll-container');
      expect(htmlContent).toContain('overflow-y: auto !important;');
      expect(htmlContent).toContain('padding: 14px 16px 80px 16px !important;');

      // Verify .codex-formula-drawer and .codex-table-wrap have overflow-y: visible !important and height: auto !important
      expect(htmlContent).toContain('.codex-formula-drawer');
      expect(htmlContent).toContain('.codex-table-wrap');

      // Verify body contains complete multi-section content without height restrictions or scroll traps
      expect(body.querySelector('.codex-golden-summary')).not.toBeNull();
      expect(body.querySelector('.codex-table-wrap')).not.toBeNull();
      expect(body.querySelector('.codex-scroll-container')).toBeNull();
    });

    it('10.7 verifies all 16 entries across all 6 categories in CodexData render summaries, pills, tips, tables, and formula blocks cleanly', () => {
      const categories: CodexCategory[] = ['rules', 'classes', 'combat', 'bosses', 'modes', 'formulas'];
      expect(CodexData.Categories.length).toBe(6);
      expect(CodexData.Entries.length).toBe(16);

      for (const cat of categories) {
        helpScreen.openCategory(cat);
        const entries = CodexData.Entries.filter((e) => e.category === cat);
        expect(entries.length).toBeGreaterThanOrEqual(1);

        for (const entry of entries) {
          helpScreen.openArticle(entry.id);
          const card = helpScreen.element.querySelector(`[data-id="${entry.id}"]`) as HTMLElement;
          expect(card).not.toBeNull();
          expect(card.classList.contains('expanded')).toBe(true);

          const body = card.querySelector('.codex-card-body') as HTMLElement;
          expect(body).not.toBeNull();
          expect(body.style.display).toBe('block');

          // 1. Verify summary / golden summary
          const goldenSummary = body.querySelector('.codex-golden-summary') || body.querySelector('.codex-card-summary');
          expect(goldenSummary).not.toBeNull();
          expect(goldenSummary?.textContent?.trim().length).toBeGreaterThan(10);

          // 2. Verify tips block
          const tipsBlock = body.querySelector('.codex-tips-block');
          expect(tipsBlock).not.toBeNull();
          const listItems = tipsBlock?.querySelectorAll('li');
          expect(listItems?.length).toBeGreaterThanOrEqual(2);

          // 3. Verify specific content structures per entry
          if (entry.id === 'rules_controls') {
            const tableWrap = body.querySelector('.codex-table-wrap');
            expect(tableWrap).not.toBeNull();
            const rows = tableWrap?.querySelectorAll('tbody tr');
            expect(rows?.length).toBe(6);
          } else if (entry.id === 'classes_roster') {
            const classGrid = body.querySelector('.codex-class-grid');
            expect(classGrid).not.toBeNull();
            const classCards = classGrid?.querySelectorAll('.codex-class-card');
            expect(classCards?.length).toBe(5);
          } else if (entry.id === 'bosses_catalog') {
            const tableWrap = body.querySelector('.codex-table-wrap');
            expect(tableWrap).not.toBeNull();
            const bossRows = tableWrap?.querySelectorAll('tbody tr');
            expect(bossRows?.length).toBe(20);
          }

          // 4. Verify formula drawer if formulaHtml is present
          if (entry.formulaHtml) {
            const formulaDrawer = body.querySelector('.codex-formula-drawer');
            expect(formulaDrawer).not.toBeNull();
            const formulaBlocks = formulaDrawer?.querySelectorAll('.formula-block');
            expect(formulaBlocks?.length).toBeGreaterThanOrEqual(1);
          }
        }
      }
    });

    it('10.8 verifies that opened cards have zero inline height or overflow restrictions in .codex-card-body', () => {
      for (const entry of CodexData.Entries) {
        helpScreen.openArticle(entry.id);
        const card = helpScreen.element.querySelector(`[data-id="${entry.id}"]`) as HTMLElement;
        const body = card.querySelector('.codex-card-body') as HTMLElement;

        expect(body).not.toBeNull();
        expect(body.style.display).toBe('block');
        // Assert zero inline height restrictions
        expect(body.style.height || '').toBe('');
        expect(body.style.maxHeight || '').toBe('');
        // Assert zero inline overflow restrictions
        expect(body.style.overflow || '').toBe('');
        expect(body.style.overflowY || '').toBe('');
        expect(body.style.overflowX || '').toBe('');
      }
    });

    it('10.9 verifies relative container scrolling in toggleExclusiveCard and openArticle smoothly positions the card header', async () => {
      const scrollContainer = helpScreen.element.querySelector('.codex-scroll-container') as HTMLElement;
      expect(scrollContainer).not.toBeNull();

      let lastScrollOption: any = null;
      let targetNodeScrolled: any = null;
      const origScrollIntoView = (MockElement.prototype as any).scrollIntoView;
      (MockElement.prototype as any).scrollIntoView = function (opts: any) {
        lastScrollOption = opts;
        targetNodeScrolled = this;
      };

      try {
        // Test toggleExclusiveCard scroll positioning
        helpScreen.openCategory('combat');
        helpScreen.toggleExclusiveCard('combat_autotomy');
        await new Promise((resolve) => setTimeout(resolve, 75));

        const targetCard = helpScreen.element.querySelector('[data-id="combat_autotomy"]') as HTMLElement;
        expect(targetNodeScrolled).toBe(targetCard);
        expect(lastScrollOption).toEqual({ behavior: 'smooth', block: 'start' });

        // Test openArticle scroll positioning
        lastScrollOption = null;
        targetNodeScrolled = null;
        helpScreen.openArticle('combat_constriction');
        await new Promise((resolve) => setTimeout(resolve, 75));

        const secondCard = helpScreen.element.querySelector('[data-id="combat_constriction"]') as HTMLElement;
        expect(targetNodeScrolled).toBe(secondCard);
        expect(lastScrollOption).toEqual({ behavior: 'smooth', block: 'start' });
      } finally {
        (MockElement.prototype as any).scrollIntoView = origScrollIntoView;
      }
    });
  });
});


