# Feature TDD Specification: Multi-Tier Responsive Device UI (Smartphone, Tablet, Desktop)

> **Feature Identifier:** `docs/tdd/responsive_multi_tier_device_ui.tdd.md`  
> **Status:** GREEN & REFACTORED  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Problem Statement

### Problem Statement
On smartphones (compact portrait/landscape viewports), previous UI layouts took up too much screen space. We established 3 distinct, dedicated UI tiers:
1. **Smartphone (`phone`)**: Ultra-compact top mini status strip (~40px height), ghost semi-transparent floating touch joystick (~96px) and ergonomic action buttons (~50px), zero bottom hint text clutter, ensuring $\ge 85\%$ unobstructed arena view.
2. **Tablet (`tablet`)**: Medium-scale balanced dual-column cards, floating corner stats, and comfortable tablet touch zones.
3. **PC / Desktop (`desktop`)**: Expanded rich HUD cards with keyboard shortcuts, Head/Body vitals breakdown, full perks list, and hidden touch layers.

---

## 2. Architecture & Design Specification

### A. Device Tier Classification in `ResponsiveLayout`
`DeviceTier = 'phone' | 'tablet' | 'desktop'`
- `phone`: $W \le 600\text{px}$ (portrait) OR ($H \le 500\text{px}$ and $W \le 960\text{px}$, mobile landscape).
- `tablet`: $W \in [601, 1024\text{px}]$ AND $H \in [501, 1366\text{px}]$ (iPad / Android tablets).
- `desktop`: $W > 1024\text{px}$ and non-touch/desktop environments.

### B. Tier-Specific HUD Layouts in `HudView` & CSS
- **Phone Mode (`.tier-phone`)**:
  - Top header transforms into an ultra-compact single-row **Mini Status Bar** housing:
    - Left: Mini Vitals Pill (`.phone-vitals-pill`: Level, Class icon, animated HP fill & Shield).
    - Center: Mini Floor / Nourishment Pill (`.phone-mission-pill`).
    - Right: Mini Combo & Score Pill (`.phone-stats-pill`) + compact Lab/Pause buttons.
  - Bottom touch controls (`.touch-controls-layer`):
    - Ghost semi-transparent joystick (`opacity: 0.38` idle, `0.9` active, 96px).
    - Compact action buttons (`opacity: 0.5` idle, `0.95` active, 52px).
    - Zero hint text clutter (`.hud-hints-col { display: none; }`).
- **Tablet Mode (`.tier-tablet`)**:
  - Scaled cards with comfortable touch margins.
- **Desktop Mode (`.tier-desktop`)**:
  - Full expanded multi-panel HUD with hotkey badges and hints bar.

---

## 3. Test Plan & Conformance Assertions (Red Phase)

- **Test File:** [`src/tests/DeviceTierUiLayout.test.ts`](file:///home/forart/dev/snake_ts/src/tests/DeviceTierUiLayout.test.ts)
- **Assertions:**
  1. `ResponsiveLayout` correctly categorizes viewports into `phone`, `tablet`, and `desktop` tiers.
  2. Phone viewport activates `.tier-phone` class on `#ui-root` / `.hud-layer`.
  3. Phone mode compacts top HUD into single-row mini status bar with height $\le 56\text{px}$.
  4. Phone mode hides desktop hints and redundant hotkey chips.
  5. Tablet mode activates `.tier-tablet` with balanced touch controls.
  6. Desktop mode activates `.tier-desktop` with full expanded panels and hidden touch layers.

---

## 4. Verification Gate

```bash
npx vitest run src/tests/DeviceTierUiLayout.test.ts
./verify
```
- **Result:** 100% Quality Gate PASS (18 test files, 216 tests pass, zero TypeScript errors, clean production bundle).
