/**
 * Ouroboros Ascension — Standardized Glassmorphic UI Widgets (Widgets.ts)
 *
 * Provides factory methods and formatting utilities for consistent, cybernetic,
 * high-performance WebGL HUD & DOM glass overlays across all game screens and modals.
 *
 * Design Guidelines:
 * - High Contrast Cyber Neon: Primary cyan (#00f0b5), Gold (#ffd166), Crimson (#ff3366), Glass backgrounds.
 * - Zero DOM Thrashing: Factory methods return lightweight elements with structured event listeners.
 * - Reactive Form Controls: Sliders, checkboxes, and selects provide direct functional binding.
 */

import { UiTheme } from './UiTheme';

export class Widgets {
  /**
   * Formats a number with standard comma grouping for readable score and currency displays.
   * e.g., 12500 -> "12,500"
   */
  public static grouped(num: number): string {
    return Math.round(num).toLocaleString('en-US');
  }

  /**
   * Formats a number as a plain rounded integer string.
   */
  public static plain(num: number): string {
    return Math.round(num).toString();
  }

  /**
   * Creates a standardized translucent glass panel container with rounded neon borders.
   * @param maxWidth Max pixel width of the panel (default: 560px).
   * @param customClass Optional additional CSS class for specialized layouts.
   */
  public static createGlassPanel(maxWidth: number = 560, customClass?: string): HTMLElement {
    const el = document.createElement('div');
    el.className = customClass ? `modal-panel glass-panel ${customClass}` : 'modal-panel glass-panel';
    el.style.maxWidth = `${maxWidth}px`;
    return el;
  }

  /**
   * Creates a standardized modal header element with cyan neon glowing title and subtle subtitle.
   */
  public static createModalHeader(
    title: string,
    subtitle?: string,
    customTitleClass?: string
  ): { container: HTMLElement; titleEl: HTMLElement; subtitleEl?: HTMLElement } {
    const container = document.createElement('div');
    container.className = 'modal-header';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '4px';

    const titleEl = document.createElement('h2');
    titleEl.className = customTitleClass
      ? `cyber-modal-title ${customTitleClass}`
      : 'cyber-modal-title';
    titleEl.textContent = title;
    container.appendChild(titleEl);

    let subtitleEl: HTMLElement | undefined;
    if (subtitle) {
      subtitleEl = document.createElement('p');
      subtitleEl.className = 'cyber-modal-subtitle';
      subtitleEl.textContent = subtitle;
      container.appendChild(subtitleEl);
    }

    return { container, titleEl, subtitleEl };
  }

  /**
   * Creates an individual stat telemetry card displaying a small label and highlighted value.
   * @param label Uppercase metric label (e.g., "FINAL FLOOR", "MAX COMBO").
   * @param value Initial metric value.
   * @param color Custom value accent color (default: UiTheme.Cyan).
   * @param valClass Optional CSS class applied to the value span.
   */
  public static createStatCard(
    label: string,
    value: string | number,
    color: string = UiTheme.Cyan,
    valClass?: string
  ): { card: HTMLElement; labelEl: HTMLElement; valEl: HTMLElement; setValue: (v: string | number) => void } {
    const card = document.createElement('div');
    card.className = 'stat-card';

    const labelEl = document.createElement('span');
    labelEl.className = 'stat-label';
    labelEl.textContent = label;
    card.appendChild(labelEl);

    const valEl = document.createElement('span');
    valEl.className = valClass ? `stat-val ${valClass}` : 'stat-val';
    valEl.style.color = color;
    valEl.textContent = typeof value === 'number' ? this.grouped(value) : value;
    card.appendChild(valEl);

    const setValue = (v: string | number) => {
      valEl.textContent = typeof v === 'number' ? this.grouped(v) : v;
    };

    return { card, labelEl, valEl, setValue };
  }

  /**
   * Creates a multi-column responsive grid container for metric cards.
   */
  public static createStatGrid(cards: HTMLElement[] = [], customClass?: string): HTMLElement {
    const grid = document.createElement('div');
    grid.className = customClass ? `stats-grid ${customClass}` : 'stats-grid';
    for (const card of cards) {
      grid.appendChild(card);
    }
    return grid;
  }

  /**
   * Creates a cybernetic button with neon glow, hover feedback, and click handler.
   */
  public static createButton(
    text: string,
    variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'primary',
    onClick?: () => void,
    extraClass?: string
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = extraClass
      ? `cyber-btn btn-${variant} ${extraClass}`
      : `cyber-btn btn-${variant}`;
    btn.textContent = text;
    if (onClick) {
      btn.addEventListener('click', onClick);
    }
    return btn;
  }

  /**
   * Creates a cybernetic status badge with outline border and optional icon.
   */
  public static createBadge(text: string, icon?: string, color: string = UiTheme.Cyan): HTMLElement {
    const badge = document.createElement('div');
    badge.className = 'cyber-badge';
    badge.style.borderColor = color;
    badge.style.color = color;
    badge.textContent = icon ? `${icon} ${text}` : text;
    return badge;
  }

  /**
   * Creates a horizontal gauge meter bar with animated fill percentage.
   */
  public static createMeter(
    height: number = 8,
    fillColor: string = UiTheme.Cyan,
    initialPct: number = 1
  ): { container: HTMLElement; fill: HTMLElement; setFill: (pct: number) => void } {
    const container = document.createElement('div');
    container.className = 'meter-container';
    container.style.height = `${height}px`;

    const fill = document.createElement('div');
    fill.className = 'meter-fill';
    fill.style.backgroundColor = fillColor;
    fill.style.width = `${Math.max(0, Math.min(100, initialPct * 100))}%`;
    container.appendChild(fill);

    const setFill = (pct: number) => {
      const p = Math.max(0, Math.min(100, pct * 100));
      fill.style.width = `${p}%`;
    };

    return { container, fill, setFill };
  }

  /**
   * Creates a docked horizontal row for bottom modal actions.
   */
  public static createActionsRow(...children: HTMLElement[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'modal-actions-row';
    for (const child of children) {
      row.appendChild(child);
    }
    return row;
  }

  /**
   * Creates an interactive slider setting row with real-time numeric value label.
   */
  public static createSliderRow(
    label: string,
    initialValue: number,
    min: number = 0,
    max: number = 1,
    step: number = 0.05,
    onChange?: (val: number) => void,
    valFormatter: (v: number) => string = (v) => `${Math.round(v * 100)}%`,
    sliderClass?: string,
    valClass?: string
  ): { row: HTMLElement; slider: HTMLInputElement; valLabel: HTMLElement; setValue: (v: number) => void } {
    const row = document.createElement('div');
    row.className = 'setting-row';

    const lbl = document.createElement('label');
    lbl.className = 'setting-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const controlWrap = document.createElement('div');
    controlWrap.className = 'slider-control';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min.toString();
    slider.max = max.toString();
    slider.step = step.toString();
    slider.value = initialValue.toString();
    slider.className = sliderClass ? `setting-slider ${sliderClass}` : 'setting-slider';

    const valLabel = document.createElement('span');
    valLabel.className = valClass ? `setting-val ${valClass}` : 'setting-val';
    valLabel.textContent = valFormatter(initialValue);

    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      valLabel.textContent = valFormatter(val);
      if (onChange) onChange(val);
    });

    controlWrap.appendChild(slider);
    controlWrap.appendChild(valLabel);
    row.appendChild(controlWrap);

    const setValue = (v: number) => {
      slider.value = v.toString();
      valLabel.textContent = valFormatter(v);
    };

    return { row, slider, valLabel, setValue };
  }

  /**
   * Creates an interactive checkbox toggle setting row.
   */
  public static createCheckboxRow(
    label: string,
    initialChecked: boolean,
    onChange?: (checked: boolean) => void,
    checkboxClass?: string
  ): { row: HTMLElement; checkbox: HTMLInputElement } {
    const row = document.createElement('div');
    row.className = 'setting-row';

    const lbl = document.createElement('label');
    lbl.className = 'setting-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = initialChecked;
    checkbox.className = checkboxClass ? `setting-checkbox ${checkboxClass}` : 'setting-checkbox';

    checkbox.addEventListener('change', () => {
      if (onChange) onChange(checkbox.checked);
    });

    row.appendChild(checkbox);
    return { row, checkbox };
  }

  /**
   * Creates an interactive select dropdown setting row.
   */
  public static createSelectRow(
    label: string,
    options: { value: string; label: string }[],
    selectedValue: string,
    onChange?: (val: string) => void,
    selectClass?: string
  ): { row: HTMLElement; select: HTMLSelectElement } {
    const row = document.createElement('div');
    row.className = 'setting-row';

    const lbl = document.createElement('label');
    lbl.className = 'setting-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const select = document.createElement('select');
    select.className = selectClass ? `setting-select ${selectClass}` : 'setting-select';

    for (const opt of options) {
      const optEl = document.createElement('option');
      optEl.value = opt.value;
      optEl.textContent = opt.label;
      if (opt.value === selectedValue) {
        optEl.selected = true;
      }
      select.appendChild(optEl);
    }

    select.addEventListener('change', () => {
      if (onChange) onChange(select.value);
    });

    row.appendChild(select);
    return { row, select };
  }
}
