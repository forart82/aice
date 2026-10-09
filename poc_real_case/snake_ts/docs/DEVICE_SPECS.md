# 📱 Device Specifications & Responsive Viewport Scaling Guide

> **Rule Reference:** [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Target Platforms:** PC Desktop (16:9, 21:9 Ultrawide, 32:9 Super-Ultrawide, 4:3), Mobile (Phones & Tablets, 9:16 Portrait & Landscape), Multi-Screen Monitors  

---

## 🖥️ 1. Viewport & Canvas Scaling Standards

- **Base Design Coordinate Space:** `1280 x 720` (16:9 Standard HD Landscape).
- **Responsive Layout Engine (`ResponsiveLayout`):**
  - Evaluates device physical dimensions $(W, H)$, aspect ratio, and device pixel ratio ($DPI$).
  - Dynamic UI matrix scale:
    $$S_{\text{ui}} = \text{clamp}\left(\min\left(\frac{W}{1280}, \frac{H}{720}\right), 0.65, 3.0\right)$$
  - High-DPI Canvas backing store matches `window.devicePixelRatio` for sharp rendering on Retina / 4K displays.
  - Safe-area insets scale to logical units: $Inset_{\text{logical}} = Inset_{\text{physical}} / S_{\text{ui}}$.

---

## 📲 2. Smartphone Safe-Area Margins & Insets

Smartphones exhibit varied display hardware (camera punch-holes, top sensor notches, dynamic islands, curved display corners, and bottom OS gesture navigation bars).

```
┌─────────────────────────────────────────────────────────────┐
│ ▰ TOP SAFE MARGIN / NOTCH INSET (Min: ~40px)               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │                                                         │ │
│ │             PRIMARY INTERACTIVE & HUD ZONE              │ │
│ │         (Score, Health, Level, Combo, Cards)            │ │
│ │                                                         │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ▰ BOTTOM OS GESTURE BAR INSET (Min: ~30px)                 │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [⚡ DASH] [✨ SKILL]                 [🕹️ Dynamic Stick]  │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### UI Docking Invariants
- **Player Stats & Health/Shield Bar:** Anchored to `top-left` with safe inset (with adaptive portrait reflow).
- **Combo Overdrive & Score Display:** Anchored to `top-center` / top stack.
- **Pause & Settings Button:** Anchored to `top-right`.
- **Touch Virtual Steering Joystick (Right-Handed Default):** Confined to lower-right quadrant (`x: 55% - 100%`, `y: 40% - 100%`).
- **Active Dash & Skill Action Buttons (Right-Handed Default):** Docked to lower-left quadrant (`x: safe.left + margin`, `y: safe.bottom - margin`).
- **Left-Handed Toggle Mode (`isLefty = true`):** Inverts layout, placing Steering Joystick on lower-left (`x: 0% - 45%`) and Action Buttons on lower-right.

---

## 🧪 3. Viewport Conformance Matrix

Validated across all extreme display resolutions in [`src/tests/UiLayoutAudit.test.ts`](file:///home/forart/dev/snake_ts/src/tests/UiLayoutAudit.test.ts):
- ✅ `320 x 480` (Compact Mobile)
- ✅ `390 x 844` (Modern Smartphone Portrait)
- ✅ `844 x 390` (Modern Ultrawide Smartphone Landscape)
- ✅ `1024 x 768` (4:3 Tablet / iPad)
- ✅ `1920 x 1080` (Standard 16:9 1080p Desktop)
- ✅ `2560 x 1080` (21:9 Ultrawide Monitor)
- ✅ `5120 x 1440` (32:9 Super Ultrawide Display)
- ✅ `3840 x 2160` (4K Ultra HD Desktop)
