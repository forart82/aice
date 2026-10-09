/**
 * Ouroboros Ascension — Developer Verification & Audit Checklist Screen (DevChecklistScreen.ts)
 *
 * Dedicated development, testing, and subsystem verification interface.
 * Supports interactive status cycling, subtask checkbox persistence, live simulator action triggers,
 * search filtering, category tabs, and diagnostic inspect panels.
 */

import { IScreen, UiRoot } from '../UiRoot.js';
import { Services } from '../../core/Services.js';
import {
  DevChecklistData,
  ChecklistCategory,
  ChecklistStatus,
  IChecklistItem,
  IDevChecklistState,
} from '../../data/DevChecklistData.js';
import { ILayoutMetrics } from '../ResponsiveLayout.js';
import { GameState } from '../../sim/GameState.js';

export class DevChecklistScreen implements IScreen {
  public readonly id: string = 'modal-dev-checklist';
  public readonly element: HTMLElement;
  public readonly root: UiRoot;

  private _state: IDevChecklistState;
  private _activeTab: ChecklistCategory | 'all' = 'all';
  private _statusFilter: ChecklistStatus | 'ALL' = 'ALL';
  private _searchQuery: string = '';
  private _expandedIds: Set<string> = new Set(['weapons', 'lab_ux']);

  // DOM References
  private _searchInput!: HTMLInputElement;
  private _searchClearBtn!: HTMLButtonElement;
  private _tabBar!: HTMLElement;
  private _statusFilterSelect!: HTMLSelectElement;
  private _progressBarFill!: HTMLElement;
  private _progressSummaryLabel!: HTMLElement;
  private _entriesContainer!: HTMLElement;
  private _lastSavedLabel!: HTMLElement;

  public get activeTab(): ChecklistCategory | 'all' {
    return this._activeTab;
  }
  public set activeTab(v: ChecklistCategory | 'all') {
    this._activeTab = v;
  }

  constructor(root: UiRoot) {
    this.root = root;
    this._state = DevChecklistData.loadState();
    if (typeof document !== 'undefined') {
      this.element = document.createElement('div');
      this.element.className = 'modal-overlay dev-checklist-modal';
      this.element.setAttribute('role', 'dialog');
      this.element.setAttribute('aria-label', 'Developer Verification and Subsystem Checklist');
      this.build();
    } else {
      this.element = {} as HTMLElement;
    }
  }

  // ---------------------------------------------------------------- Lifecycle

  public render(): void {
    this.build();
  }

  public show(_payload?: any): void {
    this._state = DevChecklistData.loadState();
    this._searchQuery = '';
    if (this._searchInput) {
      this._searchInput.value = '';
    }
    this.refresh();
  }

  public hide(): void {
    DevChecklistData.saveState(this._state);
  }

  public handleInput(event: KeyboardEvent | string): void {
    if (typeof event === 'string') {
      if (event === 'Escape' || event === 'close') this.close();
      return;
    }
    this.handleKeyDown(event);
  }

  public handleKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      e.preventDefault();
      Services.Sound.PlayUi();
      this.close();
    }
  }

  public close(): void {
    DevChecklistData.saveState(this._state);
    const eng = this.root.engine;
    if (eng && (eng.State === GameState.Paused || eng.State === 'Paused' || (typeof eng.isPaused === 'boolean' && eng.isPaused))) {
      if (this.root.navigationStack.length > 0) {
        this.root.hideScreen(this.id);
      } else {
        this.root.showScreen('modal-pause');
      }
    } else if (eng && (eng.State === GameState.Title || eng.State === 'Title')) {
      if (this.root.navigationStack.length > 0) {
        this.root.hideScreen(this.id);
      } else {
        eng.showMenu();
      }
    } else {
      this.root.hideScreen(this.id);
    }
  }

  public applyMetrics(metrics: ILayoutMetrics): void {
    if (!this.element || !this.element.classList) return;
    this.element.classList.remove('tier-phone', 'tier-tablet', 'tier-desktop', 'tier-ultrawide');
    this.element.classList.add(`tier-${metrics.deviceTier}`);
  }

  public setCategory(cat: ChecklistCategory | 'all'): void {
    this._activeTab = cat;
    this.updateTabStyles();
    this.refresh();
  }

  public setStatusFilter(filter: ChecklistStatus | 'ALL'): void {
    this._statusFilter = filter;
    this.refresh();
  }

  public toggleSubtask(subtaskId: string): void {
    Services.Sound.PlayUi();
    this._state = DevChecklistData.toggleSubtask(subtaskId);
    this.refresh();
  }

  public resetChecklist(): void {
    Services.Sound.PlayUi();
    this._state = DevChecklistData.resetState();
    this.refresh();
  }

  // ---------------------------------------------------------------- DOM Construction

  private build(): void {
    if (typeof document === 'undefined') return;

    this.element.innerHTML = `
      <div class="modal-panel dev-checklist-panel glass-panel">
        
        <!-- Header Row -->
        <div class="dev-header">
          <div class="dev-header-title-group">
            <div class="dev-title-badge-row">
              <h2 class="cyber-modal-title">🛠️ MASTER DEV CHECKLIST</h2>
              <span class="dev-version-tag">V1.0 TDD</span>
            </div>
            <p class="cyber-modal-subtitle">Authoritative Subsystem Verification, Simulation Diagnostics & Testing Suite</p>
          </div>
          <div class="dev-header-actions">
            <button class="cyber-btn btn-secondary btn-sm btn-reset-checklist" title="Reset all checkboxes and statuses">Reset All</button>
            <button class="cyber-btn btn-ghost btn-close-checklist btn-close-top" aria-label="Close Dev Checklist">✕</button>
          </div>
        </div>

        <!-- Audit Progress Bar -->
        <div class="dev-progress-section">
          <div class="dev-progress-label-row">
            <span class="dev-progress-summary">Audit Progress: 0 / 7 Subsystems Audited</span>
            <span class="dev-last-saved">Persistence Active</span>
          </div>
          <div class="dev-progress-bar-track">
            <div class="dev-progress-bar-fill"></div>
          </div>
        </div>

        <!-- Controls Row: Search Bar + Status Filter + Expand Actions -->
        <div class="dev-controls-row">
          <div class="dev-search-wrap">
            <span class="dev-search-icon">🔍</span>
            <input 
              type="text" 
              class="dev-search-input" 
              placeholder="Search checklist, subsystems, formulas, diagnostics..." 
            />
            <button class="dev-search-clear btn-clear-search" style="display:none;">✕</button>
          </div>

          <div class="dev-status-filter-wrap">
            <label class="dev-filter-label">Status:</label>
            <select class="dev-status-filter">
              <option value="ALL">All Statuses</option>
              <option value="TODO">TODO</option>
              <option value="IN_PROGRESS">IN PROGRESS</option>
              <option value="AUDITED">AUDITED</option>
              <option value="RESOLVED">RESOLVED</option>
            </select>
          </div>

          <div class="dev-global-actions">
            <button class="cyber-btn btn-secondary btn-sm btn-expand-all">Expand All</button>
            <button class="cyber-btn btn-secondary btn-sm btn-collapse-all">Collapse All</button>
          </div>
        </div>

        <!-- Category Tabs -->
        <div class="dev-tab-bar-wrap">
          <div class="dev-tab-bar" role="tablist"></div>
        </div>

        <!-- Scrollable Cards Container -->
        <div class="dev-scroll-container dev-entries-list"></div>

        <!-- Footer Actions -->
        <div class="modal-actions-row dev-footer-row">
          <span class="dev-storage-hint">Storage Key: <code>${DevChecklistData.StorageKey}</code></span>
          <button class="cyber-btn btn-primary btn-close-checklist btn-close-main">Return to Game</button>
        </div>
      </div>
    `;

    // Bind Query References
    this._searchInput = this.element.querySelector('.dev-search-input')!;
    this._searchClearBtn = this.element.querySelector('.btn-clear-search')!;
    this._tabBar = this.element.querySelector('.dev-tab-bar')!;
    this._statusFilterSelect = this.element.querySelector('.dev-status-filter')!;
    this._progressBarFill = this.element.querySelector('.dev-progress-bar-fill')!;
    this._progressSummaryLabel = this.element.querySelector('.dev-progress-summary')!;
    this._entriesContainer = this.element.querySelector('.dev-entries-list')!;
    this._lastSavedLabel = this.element.querySelector('.dev-last-saved')!;

    // Setup Event Listeners
    this._searchInput.addEventListener('input', () => {
      this._searchQuery = this._searchInput.value.trim().toLowerCase();
      this._searchClearBtn.style.display = this._searchQuery.length > 0 ? 'block' : 'none';
      this.refresh();
    });

    this._searchClearBtn.addEventListener('click', () => {
      this._searchInput.value = '';
      this._searchQuery = '';
      this._searchClearBtn.style.display = 'none';
      this.refresh();
    });

    this._statusFilterSelect.addEventListener('change', () => {
      this._statusFilter = this._statusFilterSelect.value as ChecklistStatus | 'ALL';
      this.refresh();
    });

    const expandAllBtn = this.element.querySelector('.btn-expand-all')!;
    expandAllBtn.addEventListener('click', () => {
      Services.Sound.PlayUi();
      for (const item of DevChecklistData.Items) {
        this._expandedIds.add(item.id);
      }
      this.refresh();
    });

    const collapseAllBtn = this.element.querySelector('.btn-collapse-all')!;
    collapseAllBtn.addEventListener('click', () => {
      Services.Sound.PlayUi();
      this._expandedIds.clear();
      this.refresh();
    });

    const resetBtn = this.element.querySelector('.btn-reset-checklist')!;
    resetBtn.addEventListener('click', () => {
      this.resetChecklist();
    });

    const closeButtons = this.element.querySelectorAll('.btn-close-checklist');
    closeButtons.forEach((b) => b.addEventListener('click', () => this.close()));

    this.buildTabs();
    this.refresh();
  }

  // ---------------------------------------------------------------- Tabs & Navigation

  private buildTabs(): void {
    this._tabBar.innerHTML = '';
    for (const cat of DevChecklistData.Categories) {
      const btn = document.createElement('button');
      btn.className = `cyber-btn btn-dev-tab btn-cat-${cat.key} ${this._activeTab === cat.key ? 'btn-primary active' : 'btn-secondary'}`;
      btn.innerHTML = `
        <span class="dev-tab-icon">${cat.icon}</span>
        <span class="dev-tab-label">${cat.label}</span>
      `;

      btn.addEventListener('click', () => {
        Services.Sound.PlayUi();
        this.setCategory(cat.key);
      });

      this._tabBar.appendChild(btn);
    }
  }

  private updateTabStyles(): void {
    const btns = this._tabBar.querySelectorAll('.btn-dev-tab');
    btns.forEach((b, idx) => {
      const cat = DevChecklistData.Categories[idx]?.key;
      const isCurrent = cat === this._activeTab;
      b.classList.toggle('btn-primary', isCurrent);
      b.classList.toggle('active', isCurrent);
      b.classList.toggle('btn-secondary', !isCurrent);
    });
  }

  // ---------------------------------------------------------------- Refresh & Card Rendering

  public refresh(): void {
    this._state = DevChecklistData.loadState();
    this.updateProgressSummary();

    if (!this._entriesContainer) return;
    this._entriesContainer.innerHTML = '';

    const filtered = this.getFilteredItems();

    if (filtered.length === 0) {
      const emptyBox = document.createElement('div');
      emptyBox.className = 'dev-empty-state';
      emptyBox.innerHTML = `
        <div class="empty-icon">🔍</div>
        <div class="empty-title">No matching audit items found</div>
        <p class="empty-desc">Try adjusting your search query or status filter.</p>
      `;
      this._entriesContainer.appendChild(emptyBox);
      return;
    }

    for (const item of filtered) {
      this._entriesContainer.appendChild(this.buildItemCard(item));
    }
  }

  private getFilteredItems(): IChecklistItem[] {
    return DevChecklistData.Items.filter((item) => {
      // 1. Tab category filter
      if (this._activeTab !== 'all' && item.category !== this._activeTab) {
        return false;
      }

      // 2. Status filter
      const currentStatus = this._state.itemStatuses[item.id] || item.status;
      if (this._statusFilter !== 'ALL' && currentStatus !== this._statusFilter) {
        return false;
      }

      // 3. Search query filter
      if (this._searchQuery.length > 0) {
        const q = this._searchQuery;
        const inTitle = item.title.toLowerCase().includes(q);
        const inSubtitle = item.subtitle.toLowerCase().includes(q);
        const inSummary = item.summary.toLowerCase().includes(q);
        const inSubtasks = item.subtasks.some((s) => s.title.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
        const inDiag = item.diagnostics.some((d) => d.label.toLowerCase().includes(q) || d.expectedBehavior.toLowerCase().includes(q));
        return inTitle || inSubtitle || inSummary || inSubtasks || inDiag;
      }

      return true;
    });
  }

  private buildItemCard(item: IChecklistItem): HTMLElement {
    const isExpanded = this._expandedIds.has(item.id);
    const status = this._state.itemStatuses[item.id] || item.status;

    const totalSubtasks = item.subtasks.length;
    const completedSubtasks = item.subtasks.filter((s) => this._state.subtaskStates[s.id] ?? s.completed).length;
    const subtaskPct = totalSubtasks > 0 ? Math.round((completedSubtasks / totalSubtasks) * 100) : 100;

    const card = document.createElement('article');
    card.className = `dev-card dev-card-${item.id} ${isExpanded ? 'expanded' : ''}`;
    card.setAttribute('data-id', item.id);

    // Status pill style
    const statusColors: Record<ChecklistStatus, { bg: string; color: string; border: string }> = {
      TODO: { bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: 'rgba(239, 68, 68, 0.4)' },
      IN_PROGRESS: { bg: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: 'rgba(245, 158, 11, 0.4)' },
      AUDITED: { bg: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: 'rgba(56, 189, 248, 0.4)' },
      RESOLVED: { bg: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: 'rgba(16, 185, 129, 0.4)' },
    };

    const sc = statusColors[status] || statusColors.TODO;

    card.innerHTML = `
      <div class="dev-card-header" tabindex="0" role="button" aria-expanded="${isExpanded}">
        <div class="dev-card-icon">${item.icon}</div>
        <div class="dev-card-header-text">
          <div class="dev-card-title-row">
            <h3 class="dev-card-title">${item.title}</h3>
            <span class="dev-category-badge">${item.badge}</span>
            <span class="dev-status-badge" style="background:${sc.bg}; color:${sc.color}; border:1px solid ${sc.border};">${status.replace('_', ' ')}</span>
            <span class="dev-subtask-counter">${completedSubtasks}/${totalSubtasks} (${subtaskPct}%)</span>
          </div>
          <p class="dev-card-subtitle">${item.subtitle}</p>
        </div>
        <button class="btn-accordion-toggle" aria-label="Toggle section" title="${isExpanded ? 'Collapse' : 'Expand'}">
          <span class="accordion-chevron">${isExpanded ? '▼' : '▶'}</span>
        </button>
      </div>

      <div class="dev-card-body" style="display: ${isExpanded ? 'block' : 'none'};">
        
        <!-- Summary & Tech Analysis -->
        <div class="dev-card-summary">${item.summary}</div>
        <div class="dev-tech-analysis">${item.technicalAnalysis.trim()}</div>

        <!-- Subtasks Checkbox List -->
        <div class="dev-subtasks-section">
          <h4 class="dev-section-title">Subsystem Audit Checklist (${completedSubtasks}/${totalSubtasks})</h4>
          <div class="dev-subtasks-list"></div>
        </div>

        <!-- Diagnostics & Verification Signatures -->
        ${
          item.diagnostics.length > 0
            ? `
          <div class="dev-diagnostics-section">
            <h4 class="dev-section-title">Diagnostic Failure Signatures</h4>
            <div class="dev-diagnostics-grid">
              ${item.diagnostics
                .map(
                  (d) => `
                <div class="dev-diagnostic-card">
                  <div class="diag-label">${d.label}</div>
                  <div class="diag-expected"><strong>Expected:</strong> ${d.expectedBehavior}</div>
                  ${d.failureSignature ? `<div class="diag-failure"><strong>Failure Signature:</strong> ${d.failureSignature}</div>` : ''}
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        `
            : ''
        }

        <!-- Status Cycle Control -->
        <div class="dev-card-actions-row">
          <div class="dev-status-cycle-group">
            <span class="cycle-label">Change Status:</span>
            <button class="cyber-btn btn-sm btn-status-todo ${status === 'TODO' ? 'active' : ''}">TODO</button>
            <button class="cyber-btn btn-sm btn-status-prog ${status === 'IN_PROGRESS' ? 'active' : ''}">IN PROGRESS</button>
            <button class="cyber-btn btn-sm btn-status-audit ${status === 'AUDITED' ? 'active' : ''}">AUDITED</button>
            <button class="cyber-btn btn-sm btn-status-res ${status === 'RESOLVED' ? 'active' : ''}">RESOLVED</button>
          </div>
        </div>
      </div>
    `;

    // Bind Header Toggle
    const header = card.querySelector('.dev-card-header') as HTMLElement;
    const toggleBtn = card.querySelector('.btn-accordion-toggle') as HTMLButtonElement;
    const toggleAction = (e: Event) => {
      e.stopPropagation();
      Services.Sound.PlayUi();
      this.toggleCard(item.id, card);
    };

    header.addEventListener('click', toggleAction);
    toggleBtn.addEventListener('click', toggleAction);

    // Bind Subtasks
    const subtasksContainer = card.querySelector('.dev-subtasks-list')!;
    for (const sub of item.subtasks) {
      const isCompleted = this._state.subtaskStates[sub.id] ?? sub.completed;

      const subRow = document.createElement('div');
      subRow.className = `dev-subtask-row ${isCompleted ? 'completed' : 'pending'}`;
      subRow.setAttribute('data-id', sub.id);

      subRow.innerHTML = `
        <label class="dev-subtask-label">
          <input type="checkbox" class="dev-subtask-check" ${isCompleted ? 'checked' : ''} />
          <span class="dev-subtask-box">${isCompleted ? '✔' : ''}</span>
          <div class="dev-subtask-info">
            <div class="dev-subtask-title ${isCompleted ? 'strikethrough' : ''}">${sub.title}</div>
            <div class="dev-subtask-desc">${sub.description}</div>
            ${sub.codeReference ? `<div class="dev-subtask-code">Ref: <code>${sub.codeReference}</code></div>` : ''}
          </div>
        </label>
      `;

      const check = subRow.querySelector('.dev-subtask-check') as HTMLInputElement;
      check.addEventListener('change', () => {
        this.toggleSubtask(sub.id);
      });

      subtasksContainer.appendChild(subRow);
    }

    // Bind Status Change Buttons
    const btnTodo = card.querySelector('.btn-status-todo')!;
    const btnProg = card.querySelector('.btn-status-prog')!;
    const btnAudit = card.querySelector('.btn-status-audit')!;
    const btnRes = card.querySelector('.btn-status-res')!;

    btnTodo.addEventListener('click', () => this.changeItemStatus(item.id, 'TODO'));
    btnProg.addEventListener('click', () => this.changeItemStatus(item.id, 'IN_PROGRESS'));
    btnAudit.addEventListener('click', () => this.changeItemStatus(item.id, 'AUDITED'));
    btnRes.addEventListener('click', () => this.changeItemStatus(item.id, 'RESOLVED'));

    return card;
  }

  private toggleCard(id: string, cardEl: HTMLElement): void {
    const isCurrentlyExpanded = this._expandedIds.has(id);
    if (isCurrentlyExpanded) {
      this._expandedIds.delete(id);
    } else {
      this._expandedIds.add(id);
    }

    const nextExpanded = !isCurrentlyExpanded;
    cardEl.classList.toggle('expanded', nextExpanded);

    const body = cardEl.querySelector('.dev-card-body') as HTMLElement;
    const chevron = cardEl.querySelector('.accordion-chevron') as HTMLElement;
    const toggleBtn = cardEl.querySelector('.btn-accordion-toggle') as HTMLButtonElement;
    const header = cardEl.querySelector('.dev-card-header') as HTMLElement;

    if (body) body.style.display = nextExpanded ? 'block' : 'none';
    if (chevron) chevron.textContent = nextExpanded ? '▼' : '▶';
    if (toggleBtn) toggleBtn.title = nextExpanded ? 'Collapse' : 'Expand';
    if (header) header.setAttribute('aria-expanded', `${nextExpanded}`);
  }

  private changeItemStatus(itemId: string, status: ChecklistStatus): void {
    Services.Sound.PlayUi();
    this._state = DevChecklistData.setItemStatus(itemId, status);
    this.refresh();
  }

  private updateProgressSummary(): void {
    const items = DevChecklistData.Items;
    let auditedCount = 0;

    for (const item of items) {
      const st = this._state.itemStatuses[item.id] || item.status;
      if (st === 'AUDITED' || st === 'RESOLVED') {
        auditedCount++;
      }
    }

    const pct = items.length > 0 ? Math.round((auditedCount / items.length) * 100) : 0;

    if (this._progressSummaryLabel) {
      this._progressSummaryLabel.textContent = `Audit Progress: ${auditedCount} / ${items.length} Subsystems Audited (${pct}%)`;
    }
    if (this._progressBarFill) {
      this._progressBarFill.style.width = `${pct}%`;
    }
  }
}
