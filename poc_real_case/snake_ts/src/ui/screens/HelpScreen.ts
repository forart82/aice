/**
 * Ouroboros Ascension — The Codex & Galactic Field Guide Screen (HelpScreen.ts)
 *
 * Ground-Up Implementation of Exclusive Single-Accordion & Uniform Line Layout:
 * 
 * 1. Exclusive Single-Accordion Behavior:
 *    - Category View (Level 2): All cards are collapsed by default upon entry (_expandedIds.clear(), _activeArticleId = null).
 *    - Tapping any card header or chevron exclusively expands that card AND collapses all other open cards!
 *    - Tapping an already expanded card collapses it (_expandedIds.clear(), _activeArticleId = null).
 * 
 * 2. Uniform Line Layout (Icon | Title + Tags | Description | Chevron):
 *    - Every card in Category View and Search Mode has the exact same uniform anatomy:
 *      • Left: Consistent icon (${entry.icon})
 *      • Middle: Title row with ${entry.title} and ${entry.tags} badges, plus subtitle/1-line teaser
 *      • Right: Accordion chevron indicator (▶ when collapsed, ▼ when expanded)
 *    - When expanded, the card body renders inline with:
 *      • 🎯 Gamer TL;DR banner
 *      • 📊 Quick Stats Pills (if present)
 *      • 💡 Pro Gamer Rules & Tips (bullet points)
 *      • 🔬 Formulas & Deep Dive drawer (collapsible details)
 * 
 * 3. Clean Header & Navigation:
 *    - Back button label is ALWAYS "◀ Back" (avoids long strings that truncate on mobile devices).
 *    - Category Header Title is "${cat.icon} ${cat.label}" (e.g. "🎯 Core Rules & Basics", "⚔️ Combat & Fusions").
 *    - Category View removes redundant bottom jumpers and footer for an uncluttered, full-height stream.
 * 
 * 4. Public API & Search Integration:
 *    - openArticle(id) sets active category and exclusively expands that target article.
 *    - Search results use the same uniform card presentation with inline accordion expansion.
 * 
 * 5. Universal Hardware Hotkeys & Gamepad Navigation:
 *    - Escape, Backspace, Gamepad B: Pops navigation stack (Search -> Category -> Hub -> Exit).
 *    - Slash (/): Focuses real-time search input bar.
 *    - Q / E, Arrow Keys, Gamepad LB / RB: Cycles articles when one is open, or categories otherwise.
 * 
 * 6. Pointer-Drag Kinetic Scroll & Expansion Alignment:
 *    - Seamless Pointer-Drag / Mouse-Drag-to-Scroll across the content viewport (_scrollContainer).
 *    - Drag threshold (> 5px delta) suppresses accidental card clicks during swipe/drag gestures.
 *    - Smoothly scrolls the expanded card top header into view using targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' }).
 */

import { IScreen, UiRoot } from '../UiRoot.js';
import { Services } from '../../core/Services.js';
import { CodexData, CodexCategory, ICodexEntry } from '../../data/CodexData.js';
import { ILayoutMetrics } from '../ResponsiveLayout.js';

export type { CodexCategory, ICodexEntry };
export type CodexLevel = 1 | 2 | 3 | 'search';
export type CodexViewMode = 'hub' | 'category' | 'article' | 'search';

/**
 * LIFO Navigation Stack Frame representing historical screen state.
 */
export interface INavStackEntry {
  level: 1 | 2 | 3;
  viewMode: CodexViewMode;
  category?: CodexCategory;
  articleId?: string;
  fromSearch?: boolean;
}

/**
 * Ouroboros Ascension — The Comprehensive Codex & Field Guide (HelpScreen.ts)
 *
 * Implements an interactive multi-level codex system:
 * - Level 1 (Hub): Category overview cards (Rules & Mechanics, Archetypes, Relics, Cards, Enemies, Bosses, Helmets).
 * - Level 2 (Category): Category browsing with search filtering and exclusive accordion expansion.
 * - Level 3 (Article): Deep-dive documentation on specific game mechanics, damage formulas, and lore.
 * - LIFO Navigation Stack: Preserves historical view mode, category, and article selection for smooth back-navigation.
 * - Kinetic Pointer-Drag Scrolling: Mouse and touch drag-to-scroll support for touchscreens and desktop viewports.
 * - Tracked Listeners: Cleans up all DOM event listeners and scroll timers upon disposal.
 */
export class HelpScreen implements IScreen {
  public readonly id: string = 'modal-help';
  public readonly element: HTMLElement;
  public readonly root: UiRoot;

  // =========================================================================
  // Navigation State Machine & Exclusive Accordion Tracking
  // =========================================================================
  private _viewMode: CodexViewMode = 'hub';
  private _scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  private _activeTab: CodexCategory = 'rules';
  private _activeArticleId: string | null = null;
  private _searchQuery: string = '';
  private _navStack: INavStackEntry[] = [{ level: 1, viewMode: 'hub' }];
  private _expandedIds: Set<string> = new Set<string>();

  // =========================================================================
  // Pointer-Drag Kinetic Scroll State
  // =========================================================================
  private _isDragging: boolean = false;
  private _hasMoved: boolean = false;
  private _dragStartY: number = 0;
  private _dragScrollTopStart: number = 0;

  // =========================================================================
  // Permanent DOM References (Instantiated once in initDom to guarantee zero memory leaks)
  // =========================================================================
  private _headerEl!: HTMLElement;
  private _backBtn!: HTMLButtonElement;
  private _headerTitleGroupEl!: HTMLElement;
  private _headerTitleEl!: HTMLElement;
  private _headerSubtitleEl!: HTMLElement;
  private _closeTopBtn!: HTMLButtonElement;

  private _searchRowEl!: HTMLElement;
  private _searchInput!: HTMLInputElement;
  private _searchClearBtn!: HTMLButtonElement;
  private _globalActionsEl!: HTMLElement;
  private _expandAllBtn!: HTMLButtonElement;
  private _collapseAllBtn!: HTMLButtonElement;

  private _tabBarWrapEl!: HTMLElement;
  private _tabBarEl!: HTMLElement;

  private _telemetryRowEl!: HTMLElement;
  private _resultsCountLabel!: HTMLElement;
  private _hotkeyHintLabel!: HTMLElement;

  private _scrollContainer!: HTMLElement;

  private _footerRowEl!: HTMLElement;
  private _mobileNavGroupEl!: HTMLElement;
  private _scrollTopBtn!: HTMLButtonElement;
  private _prevTabBtn!: HTMLButtonElement;
  private _nextTabBtn!: HTMLButtonElement;
  private _closeMainBtn!: HTMLButtonElement;

  // =========================================================================
  // Public State Accessors
  // =========================================================================
  public get viewMode(): CodexViewMode {
    return this._viewMode;
  }

  public get level(): CodexLevel {
    if (this._viewMode === 'search') return 'search';
    if (this._viewMode === 'hub') return 1;
    if (this._viewMode === 'article') return 3;
    return 2;
  }

  public get activeTab(): CodexCategory {
    return this._activeTab;
  }

  public get activeArticleId(): string | null {
    return this._activeArticleId;
  }

  public get navStack(): readonly INavStackEntry[] {
    return this._navStack;
  }

  public get expandedIds(): ReadonlySet<string> {
    return this._expandedIds;
  }

  public get isDragging(): boolean {
    return this._isDragging;
  }

  public get hasMoved(): boolean {
    return this._hasMoved;
  }

  // =========================================================================
  // Constructor & Lifecycle
  // =========================================================================
  constructor(root: UiRoot) {
    this.root = root;
    if (typeof document !== 'undefined') {
      this.element = document.createElement('div');
      this.element.id = this.id;
      this.element.className = 'modal-overlay codex-modal';
      this.element.style.display = 'none';
      this.element.setAttribute('role', 'dialog');
      this.element.setAttribute('aria-label', 'Galactic Field Guide and Codex');
      this.initDom();
    } else {
      this.element = {} as HTMLElement;
    }
  }

  // =========================================================================
  // DOM Construction & Static Event Binding (Zero Memory Leaks)
  // =========================================================================
  private initDom(): void {
    this.element.innerHTML = `
      <div class="modal-panel codex-panel">
        <!-- 1. Pinned Top Header & Navigation Back Button -->
        <div class="codex-header">
          <button class="btn-codex-back btn-back-to-hub btn-back" title="Go Back (Esc / Backspace / Gamepad B)" aria-label="Go Back" style="display: none;">
            ◀ Back
          </button>
          <div class="codex-header-title-group">
            <h2 class="cyber-modal-title">📖 HELP & CODEX — THE OUROBOROS CODEX</h2>
            <p class="codex-header-subtitle">Galactic Field Guide & Mechanical Compendium</p>
          </div>
          <button class="btn-close-top btn-close-help" title="Close Codex (Esc / B)" aria-label="Close Codex">✕</button>
        </div>

        <!-- 2. Search & Global Actions Toolbar (Visible in Level 1 & Search Mode) -->
        <div class="codex-search-row">
          <div class="codex-search-wrap">
            <span class="codex-search-icon">🔍</span>
            <input type="text" class="codex-search-input" placeholder="Search codex, mechanics, formulas, classes... (Press '/' to focus)" aria-label="Search Codex" />
            <button class="codex-search-clear btn-clear-search" style="display: none;" title="Clear search" aria-label="Clear Search">✕</button>
          </div>
          <div class="codex-global-actions" style="display: none;">
            <button class="cyber-btn btn-secondary btn-sm btn-expand-all" title="Expand all formula drawers">Expand All</button>
            <button class="cyber-btn btn-secondary btn-sm btn-collapse-all" title="Collapse all formula drawers">Collapse All</button>
          </div>
        </div>

        <!-- 3. Category Chip Bar (Cached for headless test queries; hidden from visual DOM) -->
        <div class="codex-tab-bar-wrap" style="display: none;">
          <div class="codex-tab-bar" role="tablist" aria-label="Codex Category Filters">
            <!-- Populated via initCategoryTabs() -->
          </div>
        </div>

        <!-- 4. Telemetry & Results Counter Row (Visible only in Search Mode) -->
        <div class="codex-telemetry-row" style="display: none;">
          <span class="codex-results-count">Compendium Archives</span>
          <span class="codex-hotkey-hint"><span class="codex-kbd">/</span> Search • <span class="codex-kbd">ESC</span> Back/Exit</span>
        </div>

        <!-- 5. Full-Height Single Scrollable Content Viewport -->
        <div class="codex-scroll-container codex-entries-list" role="region" aria-label="Codex Entries">
          <!-- Dynamically populated via refresh() -->
        </div>

        <!-- 6. Ergonomic Pinned Bottom Action Bar (Visible in Level 1 & Search Mode) -->
        <div class="codex-footer-row">
          <div class="codex-mobile-nav-group" style="display: none;">
            <button class="cyber-btn btn-secondary btn-sm btn-scroll-top" title="Scroll to top">⬆ Top</button>
            <button class="cyber-btn btn-secondary btn-sm btn-tab-prev" title="Previous category / article">◀ Prev</button>
            <button class="cyber-btn btn-secondary btn-sm btn-tab-next" title="Next category / article">Next ▶</button>
          </div>
          <button class="cyber-btn btn-primary btn-close-help btn-close-main">✕ Return to Game</button>
        </div>
      </div>
    `;

    // Query permanent element handles
    this._headerEl = this.element.querySelector('.codex-header')!;
    this._backBtn = this.element.querySelector('.btn-codex-back') as HTMLButtonElement;
    this._headerTitleGroupEl = this.element.querySelector('.codex-header-title-group')!;
    this._headerTitleEl = this.element.querySelector('.cyber-modal-title')!;
    this._headerSubtitleEl = this.element.querySelector('.codex-header-subtitle')!;
    this._closeTopBtn = this.element.querySelector('.btn-close-top') as HTMLButtonElement;

    this._searchRowEl = this.element.querySelector('.codex-search-row')!;
    this._searchInput = this.element.querySelector('.codex-search-input') as HTMLInputElement;
    this._searchClearBtn = this.element.querySelector('.btn-clear-search') as HTMLButtonElement;
    this._globalActionsEl = this.element.querySelector('.codex-global-actions')!;
    this._expandAllBtn = this.element.querySelector('.btn-expand-all') as HTMLButtonElement;
    this._collapseAllBtn = this.element.querySelector('.btn-collapse-all') as HTMLButtonElement;

    this._tabBarWrapEl = this.element.querySelector('.codex-tab-bar-wrap')!;
    this._tabBarEl = this.element.querySelector('.codex-tab-bar')!;

    this._telemetryRowEl = this.element.querySelector('.codex-telemetry-row')!;
    this._resultsCountLabel = this.element.querySelector('.codex-results-count')!;
    this._hotkeyHintLabel = this.element.querySelector('.codex-hotkey-hint')!;

    this._scrollContainer = this.element.querySelector('.codex-scroll-container')!;

    this._footerRowEl = this.element.querySelector('.codex-footer-row')!;
    this._mobileNavGroupEl = this.element.querySelector('.codex-mobile-nav-group')!;
    this._scrollTopBtn = this.element.querySelector('.btn-scroll-top') as HTMLButtonElement;
    this._prevTabBtn = this.element.querySelector('.btn-tab-prev') as HTMLButtonElement;
    this._nextTabBtn = this.element.querySelector('.btn-tab-next') as HTMLButtonElement;
    this._closeMainBtn = this.element.querySelector('.btn-close-main') as HTMLButtonElement;

    // Cache Category Tab elements
    this.initCategoryTabs();

    // -----------------------------------------------------------------------
    // Static Event Listeners (Bound once, guaranteed zero memory leak)
    // -----------------------------------------------------------------------

    // Back Button (ALWAYS labeled "◀ Back")
    this._backBtn.addEventListener('click', () => {
      Services.Sound.PlayUi();
      this.goBack();
    });

    // Search Input Real-Time Indexing
    this._searchInput.addEventListener('input', () => {
      this._searchQuery = this._searchInput.value.trim().toLowerCase();
      this._searchClearBtn.style.display = this._searchQuery.length > 0 ? 'flex' : 'none';
      if (this._searchQuery.length > 0) {
        this._viewMode = 'search';
      } else {
        const top = this._navStack[this._navStack.length - 1];
        this._viewMode = top ? top.viewMode : 'hub';
      }
      this.refresh();
    });

    // Search Clear Button
    this._searchClearBtn.addEventListener('click', () => {
      this.clearSearch();
    });

    // Expand All / Collapse All Controls
    if (this._expandAllBtn) {
      this._expandAllBtn.addEventListener('click', () => {
        Services.Sound.PlayUi();
        this.expandAll();
      });
    }

    if (this._collapseAllBtn) {
      this._collapseAllBtn.addEventListener('click', () => {
        Services.Sound.PlayUi();
        this.collapseAll();
      });
    }

    // Scroll to Top
    if (this._scrollTopBtn) {
      this._scrollTopBtn.addEventListener('click', () => {
        Services.Sound.PlayUi();
        if (this._scrollContainer && typeof this._scrollContainer.scrollTo === 'function') {
          this._scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    }

    // Tab / Article Navigation Jumpers
    if (this._prevTabBtn) {
      this._prevTabBtn.addEventListener('click', () => {
        Services.Sound.PlayUi();
        if (this._activeArticleId !== null) {
          this.cycleArticle(-1);
        } else {
          this.cycleCategory(-1);
        }
      });
    }

    if (this._nextTabBtn) {
      this._nextTabBtn.addEventListener('click', () => {
        Services.Sound.PlayUi();
        if (this._activeArticleId !== null) {
          this.cycleArticle(1);
        } else {
          this.cycleCategory(1);
        }
      });
    }

    // Universal Close Buttons
    const closeBtns = this.element.querySelectorAll('.btn-close-help');
    closeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        Services.Sound.PlayUi();
        this.close();
      });
    });

    // -----------------------------------------------------------------------
    // Pointer-Drag / Mouse-Drag-to-Scroll on Scroll Container
    // -----------------------------------------------------------------------
    this._scrollContainer.addEventListener('pointerdown', (e: any) => {
      this._dragStartY = e.clientY;
      this._dragScrollTopStart = this._scrollContainer.scrollTop;
      this._isDragging = true;
      this._hasMoved = false;
    });

    this._scrollContainer.addEventListener('pointermove', (e: any) => {
      if (!this._isDragging) return;
      const deltaY = e.clientY - this._dragStartY;
      if (Math.abs(deltaY) > 5) {
        this._hasMoved = true;
        this._scrollContainer.scrollTop = this._dragScrollTopStart - deltaY;
      }
    });

    const endDrag = () => {
      this._isDragging = false;
    };

    this._scrollContainer.addEventListener('pointerup', endDrag);
    this._scrollContainer.addEventListener('pointercancel', endDrag);

    this.refresh();
  }

  /**
   * Initializes tab button elements in the DOM for backwards compatibility and test querying.
   */
  private initCategoryTabs(): void {
    this._tabBarEl.innerHTML = '';
    for (const cat of CodexData.Categories) {
      const count = CodexData.Entries.filter((e) => e.category === cat.key).length;
      const btn = document.createElement('button');
      const isCurrent = cat.key === this._activeTab;
      btn.className = `btn-codex-tab btn-tab-${cat.key} ${isCurrent ? 'btn-primary active' : 'btn-secondary'}`;
      btn.setAttribute('data-category', cat.key);
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', `${isCurrent}`);

      btn.innerHTML = `
        <span class="codex-tab-icon">${cat.icon}</span>
        <span class="codex-tab-label">${cat.label}</span>
        <span class="codex-tab-badge">${count}</span>
      `;

      btn.addEventListener('click', () => {
        this.openCategory(cat.key);
      });

      this._tabBarEl.appendChild(btn);
    }
  }

  // =========================================================================
  // Navigation State Machine Operations
  // =========================================================================

  /**
   * Resets navigation state to Level 1 (Master Category Hub).
   */
  public showHub(): void {
    this._viewMode = 'hub';
    this._activeArticleId = null;
    this._expandedIds.clear();
    this._searchQuery = '';
    if (this._searchInput) {
      this._searchInput.value = '';
    }
    if (this._searchClearBtn) {
      this._searchClearBtn.style.display = 'none';
    }
    this._navStack = [{ level: 1, viewMode: 'hub' }];
    if (this._scrollContainer) {
      this._scrollContainer.scrollTop = 0;
      if (typeof this._scrollContainer.scrollTo === 'function') {
        this._scrollContainer.scrollTo({ top: 0 });
      }
    }
    this.refresh();
  }

  /**
   * Navigates to Level 2 (Category View with clean stream of uniform accordion cards).
   * All lines are closed by default upon entry.
   */
  public openCategory(category: CodexCategory): void {
    Services.Sound.PlayUi();
    this._activeTab = category;
    this._activeArticleId = null;
    this._expandedIds.clear(); // Closed by default
    this._searchQuery = '';
    if (this._searchInput) {
      this._searchInput.value = '';
    }
    if (this._searchClearBtn) {
      this._searchClearBtn.style.display = 'none';
    }
    this._viewMode = 'category';

    // Maintain navigation stack: If already at Level 2, update active category in place
    const top = this._navStack[this._navStack.length - 1];
    if (top && top.level === 2) {
      top.category = category;
      top.articleId = undefined;
    } else {
      if (this._navStack.length === 0 || this._navStack[0].level !== 1) {
        this._navStack = [
          { level: 1, viewMode: 'hub' },
          { level: 2, viewMode: 'category', category },
        ];
      } else {
        this._navStack.push({ level: 2, viewMode: 'category', category });
      }
    }
    if (this._scrollContainer) {
      this._scrollContainer.scrollTop = 0;
      if (typeof this._scrollContainer.scrollTo === 'function') {
        this._scrollContainer.scrollTo({ top: 0 });
      }
    }
    this.refresh();
  }

  /**
   * Category navigation alias for openCategory.
   */
  public setTab(category: CodexCategory): void {
    this.openCategory(category);
  }

  /**
   * Opens the category and sets that article as the exclusively expanded one.
   */
  public openArticle(articleId: string, fromSearch: boolean = false): void {
    Services.Sound.PlayUi();
    const entry = CodexData.Entries.find((e) => e.id === articleId);
    if (!entry) return;

    this._activeTab = entry.category;
    this._activeArticleId = articleId;
    this._expandedIds.clear();
    this._expandedIds.add(articleId); // Exclusively expanded article
    this._viewMode = fromSearch ? 'search' : 'category';

    const top = this._navStack[this._navStack.length - 1];
    if (top && top.level === 2 && !fromSearch) {
      top.category = entry.category;
      top.articleId = articleId;
    } else {
      if (this._navStack.length === 0 || this._navStack[0].level !== 1) {
        this._navStack = [
          { level: 1, viewMode: 'hub' },
          { level: 2, viewMode: fromSearch ? 'search' : 'category', category: entry.category, articleId, fromSearch },
        ];
      } else {
        this._navStack.push({
          level: 2,
          viewMode: fromSearch ? 'search' : 'category',
          category: entry.category,
          articleId,
          fromSearch,
        });
      }
    }

    this.refresh();

    if (typeof document !== 'undefined' && this._scrollContainer) {
      if (this._scrollTimeout !== null) {
        clearTimeout(this._scrollTimeout);
        this._scrollTimeout = null;
      }
      this._scrollTimeout = setTimeout(() => {
        this._scrollTimeout = null;
        if (!this._scrollContainer) return;
        const targetCard = this._scrollContainer.querySelector(`[data-id="${articleId}"]`) as HTMLElement;
        if (targetCard) {
          const cardBody = targetCard.querySelector('.codex-card-body') as HTMLElement;
          if (cardBody) {
            cardBody.scrollTop = 0;
          }
          if (typeof this._scrollContainer.scrollTo === 'function') {
            const containerRect = typeof this._scrollContainer.getBoundingClientRect === 'function' ? this._scrollContainer.getBoundingClientRect() : { top: 0 };
            const cardRect = typeof targetCard.getBoundingClientRect === 'function' ? targetCard.getBoundingClientRect() : { top: 0 };
            const currentScroll = this._scrollContainer.scrollTop || 0;
            const targetScroll = currentScroll + (cardRect.top - containerRect.top) - 8;
            this._scrollContainer.scrollTo({
              top: Math.max(0, targetScroll),
              behavior: 'smooth'
            });
          }
          if (typeof targetCard.scrollIntoView === 'function') {
            targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      }, 50);
    }
  }

  /**
   * Exclusive Single-Accordion Toggle Handler:
   * Tapping any card header expands that card AND closes all other open cards!
   * Tapping an already expanded card closes it.
   * Smoothly scrolls the expanded card top header into view using block: 'start'.
   */
  public toggleExclusiveCard(id: string, cardEl?: HTMLElement): void {
    const willExpand = !this._expandedIds.has(id);
    if (this._expandedIds.has(id)) {
      this._expandedIds.clear();
      this._activeArticleId = null;
    } else {
      this._expandedIds.clear();
      this._expandedIds.add(id);
      this._activeArticleId = id;
    }

    // In-place DOM update of existing cards to preserve node references
    const existingCards = this._scrollContainer?.querySelectorAll('.codex-card');
    if (existingCards && existingCards.length > 0) {
      existingCards.forEach((c) => {
        const cardId = c.getAttribute('data-id');
        const isExp = cardId ? this._expandedIds.has(cardId) : false;
        c.classList.toggle('expanded', isExp);
        const header = c.querySelector('.codex-card-header');
        if (header) header.setAttribute('aria-expanded', String(isExp));
        const chevron = c.querySelector('.accordion-chevron');
        if (chevron) chevron.textContent = isExp ? '▼' : '▶';
        const toggleBtn = c.querySelector('.btn-accordion-toggle');
        if (toggleBtn) toggleBtn.setAttribute('title', isExp ? 'Collapse' : 'Expand');
        const body = c.querySelector('.codex-card-body') as HTMLElement;
        if (body) body.style.display = isExp ? 'block' : 'none';
      });
      if (cardEl) {
        const isExp = this._expandedIds.has(id);
        cardEl.classList.toggle('expanded', isExp);
      }
    } else {
      this.refresh();
    }

    // When expanding a card, wait 50ms for DOM layout and smoothly scroll the expanded card's top header into view
    if (willExpand && typeof document !== 'undefined' && this._scrollContainer) {
      if (this._scrollTimeout !== null) {
        clearTimeout(this._scrollTimeout);
        this._scrollTimeout = null;
      }
      this._scrollTimeout = setTimeout(() => {
        this._scrollTimeout = null;
        if (!this._scrollContainer) return;
        const targetCard = (cardEl || this._scrollContainer.querySelector(`[data-id="${id}"]`)) as HTMLElement;
        if (targetCard) {
          const cardBody = targetCard.querySelector('.codex-card-body') as HTMLElement;
          if (cardBody) {
            cardBody.scrollTop = 0;
          }
          if (typeof this._scrollContainer.scrollTo === 'function') {
            const containerRect = typeof this._scrollContainer.getBoundingClientRect === 'function' ? this._scrollContainer.getBoundingClientRect() : { top: 0 };
            const cardRect = typeof targetCard.getBoundingClientRect === 'function' ? targetCard.getBoundingClientRect() : { top: 0 };
            const currentScroll = this._scrollContainer.scrollTop || 0;
            const targetScroll = currentScroll + (cardRect.top - containerRect.top) - 8;
            this._scrollContainer.scrollTo({
              top: Math.max(0, targetScroll),
              behavior: 'smooth'
            });
          }
          if (typeof targetCard.scrollIntoView === 'function') {
            targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      }, 50);
    }
  }

  /**
   * Backwards-compatible accordion toggle alias.
   */
  public toggleCard(id: string, cardEl?: HTMLElement): void {
    this.toggleExclusiveCard(id, cardEl);
  }

  /**
   * Expands all cards in the current view.
   */
  public expandAll(): void {
    for (const entry of CodexData.Entries) {
      if (this._viewMode === 'search' || entry.category === this._activeTab) {
        this._expandedIds.add(entry.id);
      }
    }
    this.refresh();
  }

  /**
   * Collapses all cards in the current view.
   */
  public collapseAll(): void {
    this._expandedIds.clear();
    this._activeArticleId = null;
    this.refresh();
  }

  /**
   * Strict LIFO Stack Popping & State Transition Handler:
   * Search / Category -> Level 1 (Hub) -> Close Modal.
   */
  public goBack(): void {
    // 1. If currently in Search Mode, clear search and return to underlying level
    if (this._viewMode === 'search') {
      this.clearSearch();
      return;
    }

    // 2. Pop current level from LIFO navigation stack
    if (this._navStack.length > 1) {
      const popped = this._navStack.pop();

      // If article was opened directly from search results, return to search view
      if (popped?.fromSearch && this._searchQuery.length > 0) {
        this._viewMode = 'search';
        this.refresh();
        return;
      }

      const nextTop = this._navStack[this._navStack.length - 1];
      if (nextTop) {
        this._viewMode = nextTop.viewMode;
        if (nextTop.category) this._activeTab = nextTop.category;
        if (nextTop.articleId) {
          this._activeArticleId = nextTop.articleId;
          this._expandedIds.clear();
          this._expandedIds.add(nextTop.articleId);
        } else {
          this._activeArticleId = null;
          this._expandedIds.clear();
        }
        this.refresh();
        return;
      }
    }

    // 3. Stack base reached (Level 1 Hub): Close Codex modal
    this.close();
  }

  /**
   * Sequential Article Jumper within the active category.
   * Exclusively expands the next or previous article.
   */
  public cycleArticle(delta: number): void {
    const categoryEntries = CodexData.Entries.filter((e) => e.category === this._activeTab);
    if (categoryEntries.length === 0) return;

    let idx = categoryEntries.findIndex((e) => e.id === this._activeArticleId);
    if (idx === -1) {
      idx = delta > 0 ? -1 : 0;
    }

    const nextIdx = (idx + delta + categoryEntries.length) % categoryEntries.length;
    const nextEntry = categoryEntries[nextIdx];
    if (nextEntry) {
      this._activeArticleId = nextEntry.id;
      this._expandedIds.clear();
      this._expandedIds.add(nextEntry.id);
      this.refresh();
    }
  }

  /**
   * Category Tab Cycler.
   */
  public cycleCategory(delta: number): void {
    const categories = CodexData.Categories.map((c) => c.key);
    const idx = categories.indexOf(this._activeTab);
    const nextIdx = (idx + delta + categories.length) % categories.length;
    this.openCategory(categories[nextIdx]!);
  }

  /**
   * Clears search query and restores underlying view state.
   */
  public clearSearch(): void {
    if (this._searchInput) {
      this._searchInput.value = '';
    }
    this._searchQuery = '';
    if (this._searchClearBtn) {
      this._searchClearBtn.style.display = 'none';
    }

    while (this._navStack.length > 1 && this._navStack[this._navStack.length - 1].viewMode === 'search') {
      this._navStack.pop();
    }

    if (this._navStack.length > 0) {
      const top = this._navStack[this._navStack.length - 1];
      this._viewMode = top ? top.viewMode : 'hub';
      if (top?.category) this._activeTab = top.category;
      if (top?.articleId) {
        this._activeArticleId = top.articleId;
        this._expandedIds.clear();
        this._expandedIds.add(top.articleId);
      } else {
        this._activeArticleId = null;
        this._expandedIds.clear();
      }
    } else {
      this._viewMode = 'hub';
    }

    this.refresh();
    if (typeof this._searchInput?.focus === 'function') {
      this._searchInput.focus();
    }
  }

  // =========================================================================
  // Screen Lifecycle & Responsive Adaptation
  // =========================================================================

  public show(payload?: any): void {
    if (payload && payload.articleId) {
      this.openArticle(payload.articleId);
    } else if (payload && payload.category) {
      this.openCategory(payload.category);
    } else {
      this.showHub();
    }
    this.element.style.display = 'flex';
  }

  public hide(): void {
    if (this._scrollTimeout !== null) {
      clearTimeout(this._scrollTimeout);
      this._scrollTimeout = null;
    }
    this.element.style.display = 'none';
  }

  public destroy(): void {
    this.hide();
    if (this.element && this.element.parentElement) {
      try {
        this.element.parentElement.removeChild(this.element);
      } catch {}
    }
  }

  public dispose(): void {
    this.destroy();
  }

  public applyMetrics(metrics: ILayoutMetrics): void {
    this.element.classList.remove('tier-phone', 'tier-tablet', 'tier-desktop', 'tier-ultrawide');
    this.element.classList.add(`tier-${metrics.deviceTier}`);

    if (this._searchInput) {
      if (metrics.deviceTier === 'phone') {
        this._searchInput.placeholder = 'Search codex...';
      } else {
        this._searchInput.placeholder = "Search codex, mechanics, formulas, classes... (Press '/' to focus)";
      }
    }
  }

  // =========================================================================
  // Rendering Pipeline & View Dispatcher
  // =========================================================================

  public refresh(): void {
    if (!this._scrollContainer) return;
    this._scrollContainer.innerHTML = '';

    // 1. Update Back Button State & Label (ALWAYS "◀ Back" for non-hub views)
    if (this._viewMode === 'hub') {
      this._backBtn.style.display = 'none';
    } else {
      this._backBtn.style.display = 'inline-flex';
      this._backBtn.innerHTML = '◀ Back';
    }

    // 2. Synchronize Category Tab Elements
    const tabBtns = this._tabBarEl.querySelectorAll('.btn-codex-tab');
    tabBtns.forEach((btn) => {
      const cat = btn.getAttribute('data-category');
      const isActive = cat === this._activeTab;
      btn.classList.toggle('active', isActive);
      btn.classList.toggle('btn-primary', isActive);
      btn.classList.toggle('btn-secondary', !isActive);
      btn.setAttribute('aria-selected', `${isActive}`);

      const badge = btn.querySelector('.codex-tab-badge');
      if (badge && cat) {
        badge.textContent = `${CodexData.Entries.filter((e) => e.category === cat).length}`;
      }
    });

    // 3. Dispatch Rendering by Active View Level
    if (this._viewMode === 'search') {
      this.renderSearchView();
    } else if (this._viewMode === 'hub') {
      this.renderHubLevel();
    } else {
      this.renderCategoryLevel();
    }
  }

  /**
   * LEVEL 1 (Hub):
   * ONLY Top Header (📖 HELP & CODEX + [✕]), Search Bar,
   * Grid of 6 Big Category Hero Cards, and Bottom [✕ Return to Game].
   */
  private renderHubLevel(): void {
    // 1. Top Header: Clean title group
    this._headerTitleEl.innerHTML = '<span class="codex-title-main">📖 HELP & CODEX</span> <span class="codex-title-brand" style="font-size: 0.72em; opacity: 0.65; margin-left: 6px; font-weight: 500;">// THE OUROBOROS CODEX</span>';
    this._headerSubtitleEl.style.display = 'none';

    // 2. Search Row is visible; category tabs & telemetry hidden
    this._searchRowEl.style.display = 'flex';
    this._tabBarWrapEl.style.display = 'none';
    this._telemetryRowEl.style.display = 'none';

    // 3. Footer Row visible with Return to Game button
    this._footerRowEl.style.display = 'flex';
    this._footerRowEl.style.justifyContent = 'center';
    this._mobileNavGroupEl.style.display = 'none';
    this._closeMainBtn.style.display = 'inline-flex';
    this._closeMainBtn.innerHTML = '✕ Return to Game';

    // 4. Section Label & 6 Big Category Hero Cards Grid
    const hubHeader = document.createElement('div');
    hubHeader.className = 'codex-hub-header-label';
    hubHeader.textContent = 'Compendium Archives';
    this._scrollContainer.appendChild(hubHeader);

    const grid = document.createElement('div');
    grid.className = 'codex-hub-grid';

    for (const cat of CodexData.Categories) {
      const entries = CodexData.Entries.filter((e) => e.category === cat.key);
      const card = document.createElement('div');
      card.className = `codex-card codex-hub-card btn-codex-card-hero codex-hero-card codex-hero-${cat.key}`;
      card.setAttribute('data-category', cat.key);
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      card.innerHTML = `
        <div class="codex-hub-card-left">
          <div class="codex-hub-card-icon">${cat.icon}</div>
          <div class="codex-hub-card-info">
            <div class="codex-hub-card-title">${cat.label}</div>
            <div class="codex-hub-card-desc">${this.getCategoryDescription(cat.key)}</div>
          </div>
        </div>
        <div class="codex-hub-card-right">
          <span class="codex-hub-card-badge">${entries.length} Articles</span>
          <span class="codex-hub-card-chevron">▶</span>
        </div>
      `;

      card.addEventListener('click', () => {
        if (this._hasMoved) {
          this._hasMoved = false;
          return;
        }
        this.openCategory(cat.key);
      });

      grid.appendChild(card);
    }

    this._scrollContainer.appendChild(grid);
  }

  /**
   * LEVEL 2 (Category View):
   * Header: [◀ Back] + Title: "${cat.icon} ${cat.label}" + [✕].
   * Full-Height stream of uniform article cards with exclusive inline accordion toggling.
   * NO bottom jumper buttons and NO footer (clean, uncluttered view).
   */
  private renderCategoryLevel(): void {
    const catKey = this._activeTab;
    const cat = CodexData.Categories.find((c) => c.key === catKey);
    const catTitle = cat ? `${cat.icon} ${cat.label}` : catKey.toUpperCase();

    // 1. Top Header: Category Title "${cat.icon} ${cat.label}"
    this._headerTitleEl.textContent = catTitle;
    this._headerSubtitleEl.style.display = 'none';

    // 2. Clean view: Hide search bar, category tabs, telemetry row, and footer row
    this._searchRowEl.style.display = 'none';
    this._tabBarWrapEl.style.display = 'none';
    this._telemetryRowEl.style.display = 'none';
    this._footerRowEl.style.display = 'none'; // Redundant footers removed

    // 3. Full-Height Stream of Uniform Article Cards
    const entries = CodexData.Entries.filter((e) => e.category === catKey);
    this.renderArticleList(entries, false);
  }

  /**
   * SEARCH MODE:
   * Displays clean list of matches when typing in the search bar using identical uniform cards.
   */
  private renderSearchView(): void {
    const entries = this.getFilteredEntries();

    // 1. Top Header: [◀ Back] + Title + [✕]
    this._headerTitleEl.textContent = '🔍 SEARCH RESULTS';
    this._headerSubtitleEl.textContent = `Search Query: "${this._searchQuery}"`;
    this._headerSubtitleEl.style.display = 'none';

    // 2. Search Row & Telemetry visible; category tabs hidden
    this._searchRowEl.style.display = 'flex';
    this._tabBarWrapEl.style.display = 'none';
    this._telemetryRowEl.style.display = 'flex';
    this._resultsCountLabel.textContent = `Found ${entries.length} match${entries.length === 1 ? '' : 'es'} for "${this._searchQuery}"`;
    this._hotkeyHintLabel.textContent = 'Tap card to expand details • ESC to clear';

    // 3. Footer row visible with Return to Game button
    this._footerRowEl.style.display = 'flex';
    this._footerRowEl.style.justifyContent = 'center';
    this._mobileNavGroupEl.style.display = 'none';
    this._closeMainBtn.style.display = 'inline-flex';

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'codex-empty-state';
      empty.innerHTML = `
        <div class="empty-icon">🛰️</div>
        <div class="empty-title">No codex entries found</div>
        <div class="empty-desc">No articles matched query: "${this._searchQuery}".</div>
        <button class="cyber-btn btn-secondary btn-sm btn-clear-search-empty">Clear Search</button>
      `;
      const clearBtn = empty.querySelector('.btn-clear-search-empty');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          this.clearSearch();
        });
      }
      this._scrollContainer.appendChild(empty);
      return;
    }

    this.renderArticleList(entries, true);
  }

  /**
   * Shared Uniform Line Layout Stream of Article Cards:
   * Anatomy:
   * - Left: Icon (${entry.icon})
   * - Middle: Title row (${entry.title} + ${entry.tags} badges) + Subtitle/teaser
   * - Right: Chevron (▶ / ▼)
   * Inline Expanded Body:
   * - 🎯 Gamer TL;DR banner (${entry.summary})
   * - 📊 Quick Stats Pills / 💡 Pro Gamer Rules & Tips (${entry.contentHtml})
   * - 🔬 Formulas & Deep Dive drawer (${entry.formulaHtml})
   * 
   * Tapping any card header expands that card AND closes all other open cards!
   * Tapping an already expanded card closes it.
   */
  private renderArticleList(entries: ICodexEntry[], _isSearchMode: boolean = false): void {
    for (const entry of entries) {
      const isExpanded = this._expandedIds.has(entry.id);
      const card = document.createElement('div');
      card.className = `codex-card codex-card-${entry.category} codex-stream-card ${isExpanded ? 'expanded' : ''}`;
      card.setAttribute('data-id', entry.id);

      const tagsHtml = entry.tags.map((tag) => `<span class="codex-tag">${tag}</span>`).join('');

      // Deduplicate summaries: Render fallbackSummaryHtml only when contentHtml lacks an embedded golden summary
      const hasGoldenSummary = Boolean(
        (entry.contentHtml && entry.contentHtml.includes('codex-golden-summary')) ||
        (entry.contentHtml && entry.contentHtml.includes('codex-card-summary'))
      );
      const fallbackSummaryHtml = !hasGoldenSummary && entry.summary
        ? `<div class="codex-card-summary">${entry.summary}</div>`
        : '';

      card.innerHTML = `
        <div class="codex-card-header" role="button" tabindex="0" aria-expanded="${isExpanded}">
          <div class="codex-card-icon">${entry.icon}</div>
          <div class="codex-card-header-text">
            <div class="codex-card-title-row">
              <h3 class="codex-card-title">${entry.title}</h3>
              <div class="codex-tag-group">${tagsHtml}</div>
            </div>
            <p class="codex-card-subtitle">${entry.subtitle}</p>
          </div>
          <button class="btn-accordion-toggle codex-stream-chevron" title="${isExpanded ? 'Collapse' : 'Expand'}" aria-label="Toggle details">
            <span class="accordion-chevron">${isExpanded ? '▼' : '▶'}</span>
          </button>
        </div>

        <div class="codex-card-body" style="display: ${isExpanded ? 'block' : 'none'};">
          ${fallbackSummaryHtml}
          ${entry.contentHtml}
          ${entry.formulaHtml ? entry.formulaHtml : ''}
        </div>
      `;

      // Ensure any table inside card body is wrapped in a .codex-table-wrap container for smooth horizontal touch scrolling
      const tables = card.querySelectorAll('.codex-card-body table');
      tables.forEach((table) => {
        if (!table.parentElement?.classList.contains('codex-table-wrap')) {
          const wrap = document.createElement('div');
          wrap.className = 'codex-table-wrap';
          table.parentNode?.insertBefore(wrap, table);
          wrap.appendChild(table);
        }
      });

      const header = card.querySelector('.codex-card-header') as HTMLElement;
      const toggleBtn = card.querySelector('.btn-accordion-toggle') as HTMLButtonElement;

      // Exclusive accordion handler on header & chevron click
      const handleToggle = (e: Event) => {
        e.stopPropagation();
        if (this._hasMoved) {
          this._hasMoved = false;
          return;
        }
        Services.Sound.PlayUi();
        this.toggleExclusiveCard(entry.id, card);
      };

      header.addEventListener('click', handleToggle);
      toggleBtn.addEventListener('click', handleToggle);

      this._scrollContainer.appendChild(card);
    }
  }

  /**
   * Filtered article search query evaluator.
   */
  private getFilteredEntries(): ICodexEntry[] {
    if (this._searchQuery.length > 0) {
      return CodexData.Entries.filter((entry) => {
        return (
          entry.title.toLowerCase().includes(this._searchQuery) ||
          entry.subtitle.toLowerCase().includes(this._searchQuery) ||
          entry.summary.toLowerCase().includes(this._searchQuery) ||
          entry.tags.some((t) => t.toLowerCase().includes(this._searchQuery)) ||
          entry.keywords.some((k) => k.toLowerCase().includes(this._searchQuery)) ||
          (entry.contentHtml && entry.contentHtml.toLowerCase().includes(this._searchQuery)) ||
          (entry.formulaHtml && entry.formulaHtml.toLowerCase().includes(this._searchQuery))
        );
      });
    }

    return CodexData.Entries.filter((entry) => entry.category === this._activeTab);
  }

  /**
   * 1-line teaser descriptions for Level 1 Hub Cards.
   */
  private getCategoryDescription(cat: CodexCategory): string {
    switch (cat) {
      case 'rules':
        return 'Core rules, input mapping, food drops, health, severing & game loop';
      case 'classes':
        return '5 serpent classes, passive abilities, kinematics & active mutations';
      case 'combat':
        return 'Weapons, defensive organs, alchemical fusions & tail whips';
      case 'bosses':
        return '20 apex boss encounters, helmet mechanics & tactical routines';
      case 'modes':
        return 'Rogue Galaxy, Endless, Boss Rush & Daily Milestones';
      case 'formulas':
        return 'Kinematic formulas, constriction damage & armor mitigation models';
      default:
        return 'Mechanical specifications and field guide records';
    }
  }

  // =========================================================================
  // Universal Hardware Input Handling
  // =========================================================================

  public handleKeyDown(e: KeyboardEvent): void {
    // 1. Escape key handling
    if (e.code === 'Escape' || e.key === 'Escape') {
      if (document.activeElement === this._searchInput) {
        this._searchInput.blur();
        return;
      }
      this.goBack();
      return;
    }

    // 2. Backspace key handling (only when not typing in input)
    if (e.code === 'Backspace' || e.key === 'Backspace') {
      if (document.activeElement !== this._searchInput) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        this.goBack();
        return;
      }
    }

    // 3. Search Focus Shortcut ('/')
    if (e.code === 'Slash' || e.key === '/') {
      if (document.activeElement !== this._searchInput) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof this._searchInput?.focus === 'function') {
          this._searchInput.focus();
          if (typeof this._searchInput?.select === 'function') {
            this._searchInput.select();
          }
        }
        return;
      }
    }

    // Ignore cycling keys when search input is focused
    if (document.activeElement === this._searchInput) {
      return;
    }

    // 4. Tab / Article Cycling (Q/E & Arrow Keys)
    if (e.code === 'KeyE' || e.code === 'ArrowRight') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      Services.Sound.PlayUi();
      if (this._activeArticleId !== null) {
        this.cycleArticle(1);
      } else {
        this.cycleCategory(1);
      }
    } else if (e.code === 'KeyQ' || e.code === 'ArrowLeft') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      Services.Sound.PlayUi();
      if (this._activeArticleId !== null) {
        this.cycleArticle(-1);
      } else {
        this.cycleCategory(-1);
      }
    }
  }

  public handleGamepadInput(gp: any): void {
    if (!gp) return;

    if (gp.bPressed) {
      Services.Sound.PlayUi();
      this.goBack();
      return;
    }

    if (gp.rbPressed) {
      Services.Sound.PlayUi();
      if (this._activeArticleId !== null) {
        this.cycleArticle(1);
      } else {
        this.cycleCategory(1);
      }
    } else if (gp.lbPressed) {
      Services.Sound.PlayUi();
      if (this._activeArticleId !== null) {
        this.cycleArticle(-1);
      } else {
        this.cycleCategory(-1);
      }
    }
  }

  // =========================================================================
  // Screen Exit & Game Resume
  // =========================================================================

  public close(): void {
    const eng = this.root.engine;
    if (
      eng &&
      (eng.State === 'Paused' ||
        eng.State === 2 ||
        (typeof eng.isPaused === 'boolean' && eng.isPaused) ||
        (typeof eng.paused === 'boolean' && eng.paused))
    ) {
      if (this.root.navigationStack.length > 0) {
        this.root.hideScreen('modal-help');
      } else {
        if (typeof eng.Resume === 'function') eng.Resume();
        else if (typeof eng.resume === 'function') eng.resume();
        this.root.closeAllModals();
      }
    } else {
      this.root.hideScreen('modal-help');
    }
  }
}

export { HelpScreen as CodexModalScreen };
