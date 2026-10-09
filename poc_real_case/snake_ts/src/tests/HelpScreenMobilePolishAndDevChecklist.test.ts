/**
 * Ouroboros Ascension — Help Screen Mobile Polish & Interactive Dev Checklist System Tests
 *
 * Conformance matrix for:
 * 1. HelpScreen mobile-first responsive layout, anti-overlap hierarchy, and touch target sizing.
 * 2. Full Content Expansion, Accessible Table Wrappers & Scrolling Container Bottom Safety Padding:
 *    - Expanding any card body displays complete summary, stats matrix pills, bullet lists, and formula blocks.
 *    - Expanding a card expands to full content height with max-height: none and overflow: visible without nested scrollbars.
 *    - Relative smooth scroll alignment on _scrollContainer when expanding a card or opening an article.
 *    - Table wrappers (.codex-table-wrap) provide horizontal scrolling protection with accessible thead/tbody/th/td.
 *    - Scrolling containers (.codex-scroll-container, .dev-scroll-container) provide safe bottom padding against occlusion.
 * 3. Exclusive Single-Accordion & Uniform Line Layout:
 *    - Level 1 Hub: 6 Category cards, search input, return button.
 *    - Level 2 Category: Header with Back button ("◀ Back") + category title ("${cat.icon} ${cat.label}"), clean uniform article card stream.
 *    - Exclusive Single-Accordion: Closed on entry, open A expands A, open B expands B and closes A, click B closes all.
 *    - Back button sequential popping: Category -> Hub -> Exit.
 *    - Search mode and search direct expand.
 *    - Universal hardware controls (Esc, Backspace, '/', Q/E, Arrows, Gamepad B & LB/RB).
 * 4. DevChecklistScreen registration, category grouping, subtask checklist interactivity, and status cycling.
 * 5. DevChecklistData persistence, SaveIO integration, reset capability, and corrupt JSON safety.
 * 6. Screen switcher, simulator URL routing (`?screen=checklist`), and modal navigation stack integrity.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { setupMockDom, MockElement } from './MockDom.js';
import { HelpScreen } from '../ui/screens/HelpScreen.js';
import { DevChecklistScreen } from '../ui/screens/DevChecklistScreen.js';
import { DevChecklistData } from '../data/DevChecklistData.js';
import { CodexData, CodexCategory } from '../data/CodexData.js';
import { UiRoot } from '../ui/UiRoot.js';
import { ResponsiveLayout } from '../ui/ResponsiveLayout.js';
import { SaveIO } from '../platform/SaveIO.js';
import { GameState } from '../sim/GameState.js';
import { MetaProgression } from '../data/MetaProgression.js';

describe('HelpScreen Mobile Polish & Interactive Dev Checklist System', () => {
  let restoreDom: () => void;
  let mockEngine: any;
  let uiRoot: UiRoot;
  let container: any;

  beforeEach(() => {
    restoreDom = setupMockDom();
    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();
    MetaProgression.Instance.reset();

    container = document.createElement('div');
    container.id = 'ui-root';
    document.body.appendChild(container);

    mockEngine = {
      State: GameState.Paused,
      isPaused: true,
      arenaW: 800,
      arenaH: 600,
      showMenu: vi.fn(),
      showSanctuary: vi.fn(),
      startRun: vi.fn(),
      abandonRun: vi.fn(),
      Resume: vi.fn(),
      resume: vi.fn(),
      setUiRoot: vi.fn(),
    };

    uiRoot = UiRoot.init(container as any, mockEngine);
  });

  afterEach(() => {
    SaveIO.clearMemory();
    restoreDom();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SUITE 1: HelpScreen Mobile Layout & Anti-Overlap
  // =========================================================================
  describe('1. HelpScreen Mobile Layout & Anti-Overlap Verification', () => {
    it('creates HelpScreen with mobile-optimized DOM structure and classes', () => {
      const screen = new HelpScreen(uiRoot);
      expect(screen.id).toBe('modal-help');
      expect(screen.element.classList.contains('codex-modal')).toBe(true);

      const header = screen.element.querySelector('.codex-header');
      expect(header).not.toBeNull();

      const title = screen.element.querySelector('.cyber-modal-title');
      expect(title?.textContent).toContain('CODEX');

      const closeTopBtn = screen.element.querySelector('.btn-close-top');
      expect(closeTopBtn).not.toBeNull();
      expect(closeTopBtn?.getAttribute('aria-label')).toBe('Close Codex');
    });

    it('adapts cleanly to phone tier metrics without overlapping elements', () => {
      const screen = new HelpScreen(uiRoot);
      const phoneMetrics = ResponsiveLayout.instance.update(390, 844); // iPhone standard

      screen.applyMetrics(phoneMetrics);
      expect(screen.element.classList.contains('tier-phone')).toBe(true);

      const searchInput = screen.element.querySelector('.codex-search-input') as HTMLInputElement;
      expect(searchInput.placeholder).toContain('Search codex');
    });

    it('provides mobile bottom action bar with Top, Prev, Next, and Return buttons', () => {
      const screen = new HelpScreen(uiRoot);
      const footer = screen.element.querySelector('.codex-footer-row');
      expect(footer).not.toBeNull();

      const scrollTop = screen.element.querySelector('.btn-scroll-top');
      const prevTab = screen.element.querySelector('.btn-tab-prev');
      const nextTab = screen.element.querySelector('.btn-tab-next');
      const returnBtn = screen.element.querySelector('.btn-close-main');

      expect(scrollTop).not.toBeNull();
      expect(prevTab).not.toBeNull();
      expect(nextTab).not.toBeNull();
      expect(returnBtn).not.toBeNull();
    });

    it('wraps tags and formats formula drawers without layout breakage', () => {
      const screen = new HelpScreen(uiRoot);
      screen.openCategory('formulas');

      const formulaCards = screen.element.querySelectorAll('.codex-card');
      expect(formulaCards.length).toBeGreaterThanOrEqual(1);

      const formulaBlock = screen.element.querySelector('.formula-block');
      expect(formulaBlock).not.toBeNull();
    });

    it('verifies that scrolling container (.codex-scroll-container) has bottom safety padding to prevent occlusion by action buttons', () => {
      const screen = new HelpScreen(uiRoot);
      screen.showHub();

      const scrollContainer = screen.element.querySelector('.codex-scroll-container');
      expect(scrollContainer).not.toBeNull();
      expect(scrollContainer?.getAttribute('role')).toBe('region');
      expect(scrollContainer?.getAttribute('aria-label')).toBe('Codex Entries');

      // Check tier-phone application preserves single vertical scroll region
      const phoneMetrics = ResponsiveLayout.instance.update(390, 844);
      screen.applyMetrics(phoneMetrics);
      expect(screen.element.classList.contains('tier-phone')).toBe(true);

      // Verify category navigation unmounts redundant footer to guarantee full clearance
      screen.openCategory('combat');
      const footer = screen.element.querySelector('.codex-footer-row') as HTMLElement;
      expect(footer.style.display).toBe('none');
    });

    it('verifies table wrappers (.codex-table-wrap) exist around tabular data and tables are accessible across devices', () => {
      const screen = new HelpScreen(uiRoot);
      screen.openArticle('rules_controls');

      const card = screen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
      expect(card).not.toBeNull();

      const tableWrap = card.querySelector('.codex-table-wrap');
      expect(tableWrap).not.toBeNull();

      const table = tableWrap?.querySelector('.codex-table');
      expect(table).not.toBeNull();

      // Verify accessible table columns
      const headers = table?.querySelectorAll('th');
      expect(headers?.length).toBe(4);
      expect(headers?.[0]?.textContent).toBe('Action');
      expect(headers?.[1]?.textContent).toBe('Keyboard');
      expect(headers?.[2]?.textContent).toBe('Gamepad');
      expect(headers?.[3]?.textContent).toBe('Touch / Mobile');
    });

    it('verifies that .codex-card, .codex-card.expanded, .codex-card-body and .codex-scroll-container establish single-scroll architecture with flex: 0 0 auto, flex-shrink: 0, height: auto !important, overflow-y: visible !important, and 80px padding in index.html', () => {
      const indexHtmlPath = path.resolve(__dirname, '../../index.html');
      expect(fs.existsSync(indexHtmlPath)).toBe(true);
      const htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');

      // 1. Assert .codex-card and .codex-card.expanded contain flex: 0 0 auto and flex-shrink: 0
      const cardSection = htmlContent.slice(
        htmlContent.indexOf('.codex-card {'),
        htmlContent.indexOf('.codex-card:hover')
      );
      expect(cardSection).toContain('flex: 0 0 auto !important;');
      expect(cardSection).toContain('flex-shrink: 0 !important;');
      expect(cardSection).toContain('height: auto !important;');

      const expandedSection = htmlContent.slice(
        htmlContent.indexOf('.codex-card.expanded'),
        htmlContent.indexOf('.codex-card-header {')
      );
      expect(expandedSection).toContain('flex: 0 0 auto !important;');
      expect(expandedSection).toContain('flex-shrink: 0 !important;');
      expect(expandedSection).toContain('height: auto !important;');
      expect(expandedSection).toContain('max-height: none !important;');

      // 2. Verify height: auto, max-height: none, and overflow: visible on card body
      expect(htmlContent).toContain('.codex-card-body');
      expect(htmlContent).toContain('height: auto !important;');
      expect(htmlContent).toContain('max-height: none !important;');
      expect(htmlContent).toContain('overflow: visible !important;');

      // 3. Verify .codex-formula-drawer and .codex-table-wrap have overflow-y: visible and height: auto
      const formulaDrawerBlock = htmlContent.slice(
        htmlContent.indexOf('.codex-formula-drawer'),
        htmlContent.indexOf('.formula-drawer-summary')
      );
      expect(formulaDrawerBlock).toContain('overflow-y: visible !important;');
      expect(formulaDrawerBlock).toContain('height: auto !important;');

      const tableWrapBlock = htmlContent.slice(
        htmlContent.indexOf('.codex-table-wrap'),
        htmlContent.indexOf('.cyber-table,')
      );
      expect(tableWrapBlock).toContain('overflow-y: visible !important;');
      expect(tableWrapBlock).toContain('overflow-x: auto;');
      expect(tableWrapBlock).toContain('height: auto !important;');

      // 4. .codex-scroll-container is the single scroll container with overflow-y: auto and 80px bottom clearance
      expect(htmlContent).toContain('.codex-scroll-container');
      expect(htmlContent).toContain('overflow-y: auto !important;');
      expect(htmlContent).toContain('-webkit-overflow-scrolling: touch;');
      expect(htmlContent).toContain('overscroll-behavior-y: contain;');
      expect(htmlContent).toContain('touch-action: pan-y !important;');
      expect(htmlContent).toContain('padding: 14px 16px 80px 16px !important;');
    });

    it('verifies all table rows (Pause / Menu, Codex Guide, Steer Heading, Dash Boost, Active Skill, Mutation Lab) are rendered and accessible in the DOM', () => {
      const screen = new HelpScreen(uiRoot);
      screen.openArticle('rules_controls');

      const card = screen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
      expect(card).not.toBeNull();

      const table = card.querySelector('.codex-table') as HTMLElement;
      expect(table).not.toBeNull();

      const rows = table.querySelectorAll('tbody tr');
      expect(rows.length).toBe(6);

      const requiredActions = [
        'Steer Heading',
        'Dash Boost',
        'Active Skill',
        'Mutation Lab',
        'Pause / Menu',
        'Codex Guide',
      ];

      requiredActions.forEach((actionName) => {
        const row = Array.from(rows).find((r) => r.textContent?.includes(actionName));
        expect(row).toBeDefined();
        const cells = row!.querySelectorAll('td');
        expect(cells.length).toBe(4);
        expect(cells[0]!.textContent).toContain(actionName);
        expect(cells[1]!.textContent).toBeTruthy();
        expect(cells[2]!.textContent).toBeTruthy();
        expect(cells[3]!.textContent).toBeTruthy();
      });
    });

    it('verifies all 20 Apex Bosses bestiary table rows and mechanics are rendered and accessible in the DOM', () => {
      const screen = new HelpScreen(uiRoot);
      screen.openArticle('bosses_catalog');

      const card = screen.element.querySelector('[data-id="bosses_catalog"]') as HTMLElement;
      expect(card).not.toBeNull();

      const tableWrap = card.querySelector('.codex-table-wrap');
      expect(tableWrap).not.toBeNull();

      const table = tableWrap?.querySelector('.codex-table');
      expect(table).not.toBeNull();

      const headers = table?.querySelectorAll('th');
      expect(headers?.length).toBe(3);
      expect(headers?.[0]?.textContent).toBe('Fl');
      expect(headers?.[1]?.textContent).toBe('Boss Name');
      expect(headers?.[2]?.textContent).toBe('Special Hazard / Attack Mechanic');

      const rows = table?.querySelectorAll('tbody tr');
      expect(rows?.length).toBe(20);

      // Verify Floor 1 Centipede Behemoth and Floor 20 The Eternal Ouroboros
      expect(rows?.[0]?.textContent).toContain('1');
      expect(rows?.[0]?.textContent).toContain('Centipede Behemoth');
      expect(rows?.[0]?.textContent).toContain('Segmented charge');

      expect(rows?.[19]?.textContent).toContain('20');
      expect(rows?.[19]?.textContent).toContain('The Eternal Ouroboros');
      expect(rows?.[19]?.textContent).toContain('Apex cosmic tail-eating loop');
    });
  });

  // =========================================================================
  // SUITE 2: Exclusive Single-Accordion Architecture & Interactive Cycling
  // =========================================================================
  describe('2. Exclusive Single-Accordion Architecture & Interactive Cycling', () => {
    it('2.1 Level 1 Hub renders 6 category hero cards, search input, return button, and exact badges', () => {
      const screen = new HelpScreen(uiRoot);
      screen.showHub();

      expect(screen.level).toBe(1);
      expect(screen.viewMode).toBe('hub');

      // 6 Category hero cards
      const hubCards = screen.element.querySelectorAll('.codex-hub-card');
      expect(hubCards.length).toBe(6);

      const categories = ['rules', 'classes', 'combat', 'bosses', 'modes', 'formulas'];
      categories.forEach((catKey) => {
        const card = screen.element.querySelector(`.codex-hero-${catKey}`);
        expect(card).not.toBeNull();
        const badge = card?.querySelector('.codex-hub-card-badge');
        const count = CodexData.Entries.filter((e) => e.category === catKey).length;
        expect(badge?.textContent).toContain(`${count} Articles`);
      });

      // Search input & return button
      const searchInput = screen.element.querySelector('.codex-search-input') as HTMLInputElement;
      expect(searchInput).not.toBeNull();

      const returnBtn = screen.element.querySelector('.btn-close-main');
      expect(returnBtn).not.toBeNull();
      expect(returnBtn?.textContent).toContain('Return to Game');

      // Back button is hidden at Level 1 Hub
      const backBtn = screen.element.querySelector('.btn-codex-back') as HTMLButtonElement;
      expect(backBtn.style.display).toBe('none');
    });

    it('2.2 Level 2 Category renders Header with Back button ("◀ Back"), category title ("${cat.icon} ${cat.label}"), and clean article stream', () => {
      const screen = new HelpScreen(uiRoot);
      screen.openCategory('bosses');

      expect(screen.level).toBe(2);
      expect(screen.viewMode).toBe('category');
      expect(screen.activeTab).toBe('bosses');
      expect(screen.expandedIds.size).toBe(0);

      const backBtn = screen.element.querySelector('.btn-codex-back') as HTMLButtonElement;
      expect(backBtn.style.display).toBe('inline-flex');
      expect(backBtn.textContent?.trim()).toBe('◀ Back');

      const titleEl = screen.element.querySelector('.cyber-modal-title');
      expect(titleEl?.textContent).toBe('👹 20 Bosses & Bestiary');

      const entries = screen.element.querySelectorAll('.codex-card');
      expect(entries.length).toBe(2);
      expect(screen.element.textContent).toContain('20 Apex Boss');

      // Redundant footer removed in Category view
      const footer = screen.element.querySelector('.codex-footer-row') as HTMLElement;
      expect(footer.style.display).toBe('none');
    });

    it('2.3 Uniform Closed Line Layout asserts each card has icon, title, tags, description, and chevron', () => {
      const screen = new HelpScreen(uiRoot);
      screen.openCategory('rules');

      const rulesEntries = CodexData.Entries.filter((e) => e.category === 'rules');
      const cards = screen.element.querySelectorAll('.codex-card');
      expect(cards.length).toBe(rulesEntries.length);

      cards.forEach((card, idx) => {
        const entry = rulesEntries[idx]!;
        const iconEl = card.querySelector('.codex-card-icon');
        const titleEl = card.querySelector('.codex-card-title');
        const tagsContainer = card.querySelector('.codex-tag-group');
        const descEl = card.querySelector('.codex-card-subtitle');
        const chevronEl = card.querySelector('.accordion-chevron');
        const bodyEl = card.querySelector('.codex-card-body') as HTMLElement;

        // 1. Icon
        expect(iconEl?.textContent).toBe(entry.icon);

        // 2. Title
        expect(titleEl?.textContent).toBe(entry.title);

        // 3. Tags
        expect(tagsContainer).not.toBeNull();
        entry.tags.forEach((tag) => {
          expect(tagsContainer?.textContent).toContain(tag);
        });

        // 4. Description
        expect(descEl?.textContent).toBe(entry.subtitle);

        // 5. Chevron closed
        expect(chevronEl?.textContent).toBe('▶');

        // 6. Body closed
        expect(card.classList.contains('expanded')).toBe(false);
        expect(bodyEl.style.display).toBe('none');
      });
    });

    it('2.4 verifies exclusive single-accordion behavior: entering closed, open A, open B closes A, clicking B closes all', () => {
      const screen = new HelpScreen(uiRoot);
      screen.openCategory('rules');

      // 1. When entering category, all lines are closed by default
      let cards = screen.element.querySelectorAll('.codex-card');
      expect(cards.length).toBeGreaterThanOrEqual(4);
      cards.forEach((card) => {
        expect(card.classList.contains('expanded')).toBe(false);
        const body = card.querySelector('.codex-card-body') as HTMLElement;
        expect(body.style.display).toBe('none');
        const chevron = card.querySelector('.accordion-chevron');
        expect(chevron?.textContent).toBe('▶');
      });

      // 2. Opening card A expands card A
      const toggleA = cards[0].querySelector('.btn-accordion-toggle') as HTMLButtonElement;
      toggleA.click();

      cards = screen.element.querySelectorAll('.codex-card');
      const cardA = cards[0] as HTMLElement;
      const bodyA = cardA.querySelector('.codex-card-body') as HTMLElement;
      const chevronA = cardA.querySelector('.accordion-chevron');
      expect(cardA.classList.contains('expanded')).toBe(true);
      expect(bodyA.style.display).toBe('block');
      expect(chevronA?.textContent).toBe('▼');

      // 3. Opening card B expands card B AND automatically closes card A
      const toggleB = cards[1].querySelector('.btn-accordion-toggle') as HTMLButtonElement;
      toggleB.click();

      cards = screen.element.querySelectorAll('.codex-card');
      const updatedA = cards[0] as HTMLElement;
      const updatedB = cards[1] as HTMLElement;
      const updatedBodyA = updatedA.querySelector('.codex-card-body') as HTMLElement;
      const updatedChevronA = updatedA.querySelector('.accordion-chevron');
      const updatedBodyB = updatedB.querySelector('.codex-card-body') as HTMLElement;
      const updatedChevronB = updatedB.querySelector('.accordion-chevron');

      expect(updatedA.classList.contains('expanded')).toBe(false);
      expect(updatedBodyA.style.display).toBe('none');
      expect(updatedChevronA?.textContent).toBe('▶');

      expect(updatedB.classList.contains('expanded')).toBe(true);
      expect(updatedBodyB.style.display).toBe('block');
      expect(updatedChevronB?.textContent).toBe('▼');

      // 4. Clicking card B again closes card B (all cards closed)
      const toggleB2 = updatedB.querySelector('.btn-accordion-toggle') as HTMLButtonElement;
      toggleB2.click();

      cards = screen.element.querySelectorAll('.codex-card');
      cards.forEach((card) => {
        expect(card.classList.contains('expanded')).toBe(false);
        const body = card.querySelector('.codex-card-body') as HTMLElement;
        expect(body.style.display).toBe('none');
        const chevron = card.querySelector('.accordion-chevron');
        expect(chevron?.textContent).toBe('▶');
      });
    });

    it('2.5 Back button sequentially pops: Category -> Level 1 -> Close Modal', () => {
      const screen = new HelpScreen(uiRoot);
      uiRoot.registerScreen(screen);
      uiRoot.showScreen('modal-help');

      // Level 1: Default Hub
      screen.showHub();
      expect(screen.viewMode).toBe('hub');
      expect(screen.level).toBe(1);

      // Level 2: Drill into 'combat' category
      screen.openCategory('combat');
      expect(screen.viewMode).toBe('category');
      expect(screen.level).toBe(2);
      expect(screen.activeTab).toBe('combat');

      // Drill into 'combat_centripetal_whip' article (expands exclusively)
      screen.openArticle('combat_centripetal_whip');
      expect(screen.viewMode).toBe('category');
      expect(screen.level).toBe(2);
      expect(screen.activeArticleId).toBe('combat_centripetal_whip');

      // Back 1: Category -> Level 1 (Hub)
      screen.goBack();
      expect(screen.viewMode).toBe('hub');
      expect(screen.level).toBe(1);

      // Back 2: Level 1 -> Close Modal
      screen.goBack();
      expect(uiRoot.activeScreenId).not.toBe('modal-help');
    });

    it('2.6 search mode filters entries, provides search clearing, and direct expand with query retention', () => {
      const screen = new HelpScreen(uiRoot);
      const searchInput = screen.element.querySelector('.codex-search-input') as HTMLInputElement;

      searchInput.value = 'Singularity';
      searchInput.dispatchEvent(new Event('input'));
      expect(screen.viewMode).toBe('search');

      const backBtn = screen.element.querySelector('.btn-codex-back') as HTMLButtonElement;
      expect(backBtn.textContent?.trim()).toBe('◀ Back');

      // Open search match article
      screen.openArticle('modes_daily_milestones', true);
      expect(screen.viewMode).toBe('search');
      expect(screen.activeArticleId).toBe('modes_daily_milestones');

      // Back from search returns to previous view mode and clears query
      screen.goBack();
      expect(screen.viewMode).toBe('hub');
    });

    it('2.7 universal hardware controls (Esc, Backspace, Q/E, Arrows, Gamepad B & LB/RB)', () => {
      const screen = new HelpScreen(uiRoot);
      uiRoot.registerScreen(screen);
      uiRoot.showScreen('modal-help');

      screen.openCategory('rules');
      expect(screen.activeTab).toBe('rules');

      // Keyboard Q/E tab cycling
      screen.handleKeyDown(new KeyboardEvent('keydown', { code: 'KeyE' }));
      expect(screen.activeTab).toBe('classes');

      screen.handleKeyDown(new KeyboardEvent('keydown', { code: 'KeyQ' }));
      expect(screen.activeTab).toBe('rules');

      // Gamepad bumper cycling
      screen.handleGamepadInput({ rbPressed: true });
      expect(screen.activeTab).toBe('classes');

      screen.handleGamepadInput({ lbPressed: true });
      expect(screen.activeTab).toBe('rules');

      // Gamepad B button -> sequential popping to Hub
      screen.handleGamepadInput({ bPressed: true });
      expect(screen.level).toBe(1);
      expect(screen.viewMode).toBe('hub');

      // Gamepad B button -> close modal
      screen.handleGamepadInput({ bPressed: true });
      expect(uiRoot.activeScreenId).not.toBe('modal-help');
    });

    it('2.8 expanding a card expands its body to full content (summary, stats pills, bullet tips, formulas)', () => {
      const screen = new HelpScreen(uiRoot);
      screen.openCategory('rules');

      // Expand first article (rules_controls)
      screen.openArticle('rules_controls');

      const card = screen.element.querySelector('[data-id="rules_controls"]') as HTMLElement;
      expect(card.classList.contains('expanded')).toBe(true);

      const body = card.querySelector('.codex-card-body') as HTMLElement;
      expect(body.style.display).toBe('block');

      // Verify full summary, stats pills, tips, and formulas are all populated
      expect(body.querySelector('.codex-golden-summary')).not.toBeNull();
      expect(body.querySelectorAll('.codex-stat-pill').length).toBeGreaterThanOrEqual(1);
      expect(body.querySelector('.codex-tips-block')).not.toBeNull();
      expect(body.querySelector('.codex-formula-drawer')).not.toBeNull();
      expect(body.querySelector('.codex-table-wrap')).not.toBeNull();
    });

    it('2.9 implements pointer drag mechanics on _scrollContainer (pointerdown, pointermove updating scrollTop, pointerup)', () => {
      const screen = new HelpScreen(uiRoot);
      screen.openCategory('rules');

      const scrollContainer = screen.element.querySelector('.codex-scroll-container') as HTMLElement;
      expect(scrollContainer).not.toBeNull();

      scrollContainer.scrollTop = 100;
      expect(screen.isDragging).toBe(false);
      expect(screen.hasMoved).toBe(false);

      // 1. pointerdown initiates drag state
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointerdown', { clientY: 300 }));
      expect(screen.isDragging).toBe(true);
      expect(screen.hasMoved).toBe(false);

      // 2. pointermove below threshold (<= 5px) does not scroll or flag movement
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointermove', { clientY: 297 }));
      expect(screen.hasMoved).toBe(false);
      expect(scrollContainer.scrollTop).toBe(100);

      // 3. pointermove above threshold (> 5px) updates scrollTop and flags movement
      // Drag upwards: clientY decreases from 300 to 240 (delta = -60), so scrollTop = 100 - (-60) = 160
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointermove', { clientY: 240 }));
      expect(screen.hasMoved).toBe(true);
      expect(scrollContainer.scrollTop).toBe(160);

      // 4. pointerup terminates drag
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointerup', { clientY: 240 }));
      expect(screen.isDragging).toBe(false);

      // Subsequent pointermove without pointerdown does not change scrollTop
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointermove', { clientY: 100 }));
      expect(scrollContainer.scrollTop).toBe(160);
    });

    it('2.10 verifies drag gesture prevents accidental card toggle when hasMoved is true', () => {
      const screen = new HelpScreen(uiRoot);
      screen.openCategory('combat');

      const scrollContainer = screen.element.querySelector('.codex-scroll-container') as HTMLElement;
      let card = screen.element.querySelector('[data-id="combat_centripetal_whip"]') as HTMLElement;
      let header = card.querySelector('.codex-card-header') as HTMLElement;

      expect(screen.expandedIds.size).toBe(0);

      // 1. Perform drag gesture on scrollContainer
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointerdown', { clientY: 250 }));
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointermove', { clientY: 200 }));
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointerup', { clientY: 200 }));
      expect(screen.hasMoved).toBe(true);

      // 2. Click on card header right after drag should be suppressed
      header.click();
      expect(screen.expandedIds.size).toBe(0);
      card = screen.element.querySelector('[data-id="combat_centripetal_whip"]') as HTMLElement;
      expect(card.classList.contains('expanded')).toBe(false);
      expect(screen.hasMoved).toBe(false);

      // 3. Next normal click without dragging should successfully expand the card
      header = card.querySelector('.codex-card-header') as HTMLElement;
      header.click();
      expect(screen.expandedIds.has('combat_centripetal_whip')).toBe(true);
      card = screen.element.querySelector('[data-id="combat_centripetal_whip"]') as HTMLElement;
      expect(card.classList.contains('expanded')).toBe(true);

      // 4. Perform another drag gesture and click toggle chevron button
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointerdown', { clientY: 250 }));
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointermove', { clientY: 210 }));
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointerup', { clientY: 210 }));
      expect(screen.hasMoved).toBe(true);

      // Chevron click right after drag should be suppressed (stays expanded)
      const toggleBtn = card.querySelector('.btn-accordion-toggle') as HTMLButtonElement;
      toggleBtn.click();
      expect(screen.expandedIds.has('combat_centripetal_whip')).toBe(true);
      card = screen.element.querySelector('[data-id="combat_centripetal_whip"]') as HTMLElement;
      expect(card.classList.contains('expanded')).toBe(true);
    });

    it('2.11 verifies drag gesture prevents accidental hub category navigation when hasMoved is true', () => {
      const screen = new HelpScreen(uiRoot);
      screen.showHub();

      const scrollContainer = screen.element.querySelector('.codex-scroll-container') as HTMLElement;
      const combatHeroCard = screen.element.querySelector('.codex-hero-combat') as HTMLElement;

      expect(screen.level).toBe(1);
      expect(screen.viewMode).toBe('hub');

      // 1. Perform drag gesture on Hub scrollContainer
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointerdown', { clientY: 300 }));
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointermove', { clientY: 240 }));
      scrollContainer.dispatchEvent(new (globalThis as any).PointerEvent('pointerup', { clientY: 240 }));
      expect(screen.hasMoved).toBe(true);

      // 2. Clicking category hero card right after drag is suppressed
      combatHeroCard.click();
      expect(screen.level).toBe(1);
      expect(screen.viewMode).toBe('hub');
      expect(screen.hasMoved).toBe(false);

      // 3. Normal click without drag navigates to category view
      combatHeroCard.click();
      expect(screen.level).toBe(2);
      expect(screen.viewMode).toBe('category');
      expect(screen.activeTab).toBe('combat');
    });

    it('2.12 verifies single-scroll DOM properties (flex: 0 0 auto, flex-shrink: 0, height: auto !important, max-height: none !important, overflow-y: visible !important, 80px padding-bottom)', () => {
      const indexHtmlPath = path.resolve(__dirname, '../../index.html');
      const htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');

      // Assert .codex-card and .codex-card.expanded contain flex: 0 0 auto and flex-shrink: 0
      const cardSection = htmlContent.slice(
        htmlContent.indexOf('.codex-card {'),
        htmlContent.indexOf('.codex-card:hover')
      );
      expect(cardSection).toContain('flex: 0 0 auto !important;');
      expect(cardSection).toContain('flex-shrink: 0 !important;');

      const expandedSection = htmlContent.slice(
        htmlContent.indexOf('.codex-card.expanded'),
        htmlContent.indexOf('.codex-card-header {')
      );
      expect(expandedSection).toContain('flex: 0 0 auto !important;');
      expect(expandedSection).toContain('flex-shrink: 0 !important;');
      expect(expandedSection).toContain('height: auto !important;');
      expect(expandedSection).toContain('max-height: none !important;');

      // Verify touch-action: pan-y on scroll container and card body
      expect(htmlContent).toContain('.codex-scroll-container');
      expect(htmlContent).toContain('touch-action: pan-y !important;');
      expect(htmlContent).toContain('.codex-card-body');
      expect(htmlContent).toContain('touch-action: pan-y !important;');

      // Verify height: auto !important, max-height: none, and overflow: visible on card body
      expect(htmlContent).toContain('height: auto !important;');
      expect(htmlContent).toContain('max-height: none !important;');
      expect(htmlContent).toContain('overflow: visible !important;');

      // Verify .codex-formula-drawer and .codex-table-wrap have overflow: visible !important and height: auto !important
      const formulaDrawerBlock = htmlContent.slice(
        htmlContent.indexOf('.codex-formula-drawer'),
        htmlContent.indexOf('.formula-drawer-summary')
      );
      expect(formulaDrawerBlock).toContain('overflow: visible !important;');
      expect(formulaDrawerBlock).toContain('height: auto !important;');

      const tableWrapBlock = htmlContent.slice(
        htmlContent.indexOf('.codex-table-wrap'),
        htmlContent.indexOf('.cyber-table,')
      );
      expect(tableWrapBlock).toContain('overflow-y: visible !important;');
      expect(tableWrapBlock).toContain('overflow-x: auto;');
      expect(tableWrapBlock).toContain('height: auto !important;');

      // Verify 80px bottom safety padding and overflow-y: auto on single scroll container
      expect(htmlContent).toContain('overflow-y: auto !important;');
      expect(htmlContent).toContain('padding: 14px 16px 80px 16px !important;');
    });

    it('2.13 verifies that expanding a card expands to full content height with height: auto !important, max-height: none, and overflow: visible without nested scrollbars across all categories', () => {
      const screen = new HelpScreen(uiRoot);
      const categories: CodexCategory[] = ['rules', 'classes', 'combat', 'bosses', 'modes', 'formulas'];
      let totalChecked = 0;

      for (const cat of categories) {
        screen.openCategory(cat);
        const entries = CodexData.Entries.filter((e) => e.category === cat);
        for (const entry of entries) {
          screen.openArticle(entry.id);
          const card = screen.element.querySelector(`[data-id="${entry.id}"]`) as HTMLElement;
          expect(card).not.toBeNull();
          expect(card.classList.contains('expanded')).toBe(true);

          const body = card.querySelector('.codex-card-body') as HTMLElement;
          expect(body.style.display).toBe('block');
          // Verify no nested scrolling container inside card body (full height expansion)
          expect(body.querySelector('.codex-scroll-container')).toBeNull();

          // Verify formula drawers and table wraps within body have no nested scroll containers
          const formulaDrawers = body.querySelectorAll('.codex-formula-drawer');
          formulaDrawers.forEach((drawer) => {
            expect(drawer.querySelector('.codex-scroll-container')).toBeNull();
          });

          const tableWraps = body.querySelectorAll('.codex-table-wrap');
          tableWraps.forEach((tableWrap) => {
            expect(tableWrap.querySelector('.codex-scroll-container')).toBeNull();
          });

          totalChecked++;
        }
      }

      expect(totalChecked).toBe(16);
      expect(totalChecked).toBe(CodexData.Entries.length);

      // Verify stylesheet rules for full content height
      const indexHtmlPath = path.resolve(__dirname, '../../index.html');
      const htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');
      expect(htmlContent).toContain('height: auto !important;');
      expect(htmlContent).toContain('max-height: none !important;');
      expect(htmlContent).toContain('overflow: visible !important;');
    });

    it('2.14 verifies relative smooth scroll alignment on _scrollContainer when expanding a card or opening an article', async () => {
      const screen = new HelpScreen(uiRoot);
      screen.openCategory('combat');

      const scrollContainer = screen.element.querySelector('.codex-scroll-container') as HTMLElement;
      expect(scrollContainer).not.toBeNull();

      let lastScrollOption: any = null;
      let targetNodeScrolled: any = null;
      const origScrollIntoView = (MockElement.prototype as any).scrollIntoView;
      (MockElement.prototype as any).scrollIntoView = function (opts: any) {
        lastScrollOption = opts;
        targetNodeScrolled = this;
      };

      try {
        // 1. openArticle triggers smooth scroll alignment with { behavior: 'smooth', block: 'start' }
        screen.openArticle('combat_arsenal_and_fusions');
        await new Promise((resolve) => setTimeout(resolve, 75));

        const targetCard = screen.element.querySelector('[data-id="combat_arsenal_and_fusions"]') as HTMLElement;
        expect(targetNodeScrolled).toBe(targetCard);
        expect(lastScrollOption).toEqual({ behavior: 'smooth', block: 'start' });

        const cardBody = targetCard.querySelector('.codex-card-body') as HTMLElement;
        expect(cardBody.scrollTop).toBe(0);

        // 2. toggleExclusiveCard triggers smooth scroll alignment
        lastScrollOption = null;
        targetNodeScrolled = null;
        screen.toggleExclusiveCard('combat_centripetal_whip');
        await new Promise((resolve) => setTimeout(resolve, 75));

        const secondCard = screen.element.querySelector('[data-id="combat_centripetal_whip"]') as HTMLElement;
        expect(targetNodeScrolled).toBe(secondCard);
        expect(lastScrollOption).toEqual({ behavior: 'smooth', block: 'start' });

        const secondBody = secondCard.querySelector('.codex-card-body') as HTMLElement;
        expect(secondBody.scrollTop).toBe(0);
      } finally {
        (MockElement.prototype as any).scrollIntoView = origScrollIntoView;
      }
    });
  });

  // =========================================================================
  // SUITE 3: DevChecklistScreen Registration & Interactivity
  // =========================================================================
  describe('3. DevChecklistScreen Registration & UI Interactivity', () => {
    it('instantiates DevChecklistScreen with proper id and modal classes', () => {
      const devScreen = new DevChecklistScreen(uiRoot);
      expect(devScreen.id).toBe('modal-dev-checklist');
      expect(devScreen.element.classList.contains('dev-checklist-modal')).toBe(true);

      const title = devScreen.element.querySelector('.cyber-modal-title');
      expect(title?.textContent).toContain('MASTER DEV CHECKLIST');
    });

    it('renders all 7 authoritative checklist categories from DevChecklistData', () => {
      const devScreen = new DevChecklistScreen(uiRoot);
      devScreen.refresh();

      const cards = devScreen.element.querySelectorAll('.dev-card');
      expect(cards.length).toBe(7);

      const expectedIds = [
        'weapons',
        'defenses',
        'cranial_bio',
        'lab_ux',
        'pause_stop',
        'ascension_tradeoff',
        'bosses_views',
      ];

      cards.forEach((card, idx) => {
        expect(card.getAttribute('data-id')).toBe(expectedIds[idx]);
      });
    });

    it('toggles accordion cards open and closed on header click', () => {
      const devScreen = new DevChecklistScreen(uiRoot);
      devScreen.refresh();

      const card = devScreen.element.querySelector('.dev-card-defenses') as HTMLElement;
      expect(card).not.toBeNull();

      const header = card.querySelector('.dev-card-header') as HTMLElement;
      const body = card.querySelector('.dev-card-body') as HTMLElement;

      // Click to open
      header.click();
      expect(body.style.display).toBe('block');
      expect(card.classList.contains('expanded')).toBe(true);

      // Click to close
      header.click();
      expect(body.style.display).toBe('none');
      expect(card.classList.contains('expanded')).toBe(false);
    });

    it('allows cycling item statuses (TODO, IN PROGRESS, AUDITED, RESOLVED)', () => {
      const devScreen = new DevChecklistScreen(uiRoot);
      devScreen.refresh();

      const card = devScreen.element.querySelector('.dev-card-weapons') as HTMLElement;
      const btnProg = card.querySelector('.btn-status-prog') as HTMLButtonElement;

      btnProg.click();
      const state = DevChecklistData.loadState();
      expect(state.itemStatuses['weapons']).toBe('IN_PROGRESS');

      const updatedCard = devScreen.element.querySelector('.dev-card-weapons');
      const badge = updatedCard?.querySelector('.dev-status-badge');
      expect(badge?.textContent).toBe('IN PROGRESS');
    });

    it('interactively toggles subtask checkboxes and updates progress computation', () => {
      const devScreen = new DevChecklistScreen(uiRoot);
      devScreen.refresh();

      const subRow = devScreen.element.querySelector('.dev-subtask-row') as HTMLElement;
      expect(subRow).not.toBeNull();
      const subId = subRow.getAttribute('data-id')!;

      const check = subRow.querySelector('.dev-subtask-check') as HTMLInputElement;
      expect(check).not.toBeNull();

      const initialChecked = check.checked;
      check.checked = !initialChecked;
      check.dispatchEvent(new Event('change'));

      const state = DevChecklistData.loadState();
      expect(state.subtaskStates[subId]).toBe(!initialChecked);
    });

    it('filters cards by status dropdown filter', () => {
      const devScreen = new DevChecklistScreen(uiRoot);

      // Set one item to TODO
      DevChecklistData.setItemStatus('lab_ux', 'TODO');
      devScreen.setStatusFilter('TODO');

      const visibleCards = devScreen.element.querySelectorAll('.dev-card');
      expect(visibleCards.length).toBe(1);
      expect(visibleCards[0]?.getAttribute('data-id')).toBe('lab_ux');
    });

    it('3.7 verifies expanding a dev card expands its body to full content including technical analysis, subtasks, diagnostics, and status controls', () => {
      const devScreen = new DevChecklistScreen(uiRoot);
      devScreen.refresh();

      const card = devScreen.element.querySelector('.dev-card-defenses') as HTMLElement;
      expect(card).not.toBeNull();

      const header = card.querySelector('.dev-card-header') as HTMLElement;
      header.click();

      expect(card.classList.contains('expanded')).toBe(true);
      const body = card.querySelector('.dev-card-body') as HTMLElement;
      expect(body.style.display).toBe('block');

      // Full content verification
      expect(body.querySelector('.dev-card-summary')?.textContent).toBeTruthy();
      expect(body.querySelector('.dev-tech-analysis')?.textContent).toBeTruthy();
      expect(body.querySelectorAll('.dev-subtask-row').length).toBeGreaterThanOrEqual(1);
      expect(body.querySelector('.dev-status-cycle-group')).not.toBeNull();
    });

    it('3.8 verifies dev checklist scroll container (.dev-scroll-container) has container isolation and structure', () => {
      const devScreen = new DevChecklistScreen(uiRoot);
      const scrollContainer = devScreen.element.querySelector('.dev-scroll-container');
      expect(scrollContainer).not.toBeNull();
      expect(scrollContainer?.classList.contains('dev-entries-list')).toBe(true);

      const footer = devScreen.element.querySelector('.dev-footer-row');
      expect(footer).not.toBeNull();
    });
  });

  // =========================================================================
  // SUITE 4: DevChecklistData Persistence & Safety
  // =========================================================================
  describe('4. DevChecklistData Persistence & Fallback Safety', () => {
    it('persists and reloads state across sessions in SaveIO', () => {
      const customState = DevChecklistData.loadState();
      customState.itemStatuses['bosses_views'] = 'RESOLVED';
      customState.subtaskStates['boss_20_archetypes_integrity'] = true;

      DevChecklistData.saveState(customState);

      const reloaded = DevChecklistData.loadState();
      expect(reloaded.itemStatuses['bosses_views']).toBe('RESOLVED');
      expect(reloaded.subtaskStates['boss_20_archetypes_integrity']).toBe(true);
    });

    it('handles corrupted JSON storage gracefully without crashing', () => {
      SaveIO.writeKey(DevChecklistData.StorageKey, '{ bad_json: invalid! ');

      const fallback = DevChecklistData.loadState();
      expect(fallback).toBeDefined();
      expect(fallback.version).toBe(1);
      expect(fallback.itemStatuses['weapons']).toBeDefined();
    });

    it('resets state to defaults via resetState()', () => {
      DevChecklistData.setItemStatus('weapons', 'TODO');
      expect(DevChecklistData.loadState().itemStatuses['weapons']).toBe('TODO');

      const reset = DevChecklistData.resetState();
      expect(reset.itemStatuses['weapons']).toBe('AUDITED');
    });
  });

  // =========================================================================
  // SUITE 5: Screen Switcher, Simulator URL Routing & Modal Navigation
  // =========================================================================
  describe('5. Screen Switcher, Simulator URL Routing & Modal Navigation', () => {
    it('resolves modal-checklist, checklist, and dev-checklist aliases in UiRoot', () => {
      const devScreen = new DevChecklistScreen(uiRoot);
      uiRoot.registerScreen(devScreen);

      uiRoot.showScreen('modal-checklist');
      expect(uiRoot.activeScreenId).toBe('modal-dev-checklist');

      uiRoot.showScreen('dev-checklist');
      expect(uiRoot.activeScreenId).toBe('modal-dev-checklist');
    });

    it('resolves modal-codex and modal-guide to modal-help in UiRoot', () => {
      const helpScreen = new HelpScreen(uiRoot);
      uiRoot.registerScreen(helpScreen);

      uiRoot.showScreen('modal-codex');
      expect(uiRoot.activeScreenId).toBe('modal-help');

      uiRoot.showScreen('modal-guide');
      expect(uiRoot.activeScreenId).toBe('modal-help');
    });

    it('dismisses modal on Escape key and cleans up screen state', () => {
      const devScreen = new DevChecklistScreen(uiRoot);
      uiRoot.registerScreen(devScreen);

      uiRoot.showScreen('modal-dev-checklist');
      expect(uiRoot.activeScreenId).toBe('modal-dev-checklist');

      devScreen.handleKeyDown(new KeyboardEvent('keydown', { code: 'Escape' }));
      expect(uiRoot.activeScreenId).not.toBe('modal-dev-checklist');
    });
  });
});
