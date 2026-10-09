# 📱 Device, Viewport & Scaling Specification

> **Rule Reference:** `AGENTS.md#rule-10`

## 1. Design resolution & letterboxing

The game renders into a fixed design resolution and letterboxes to the window.
The values are config-driven (`GLOBAL_SCREEN_WIDTH`, `GLOBAL_SCREEN_HEIGHT` in
`configs/`), never hard-coded.

This is already implemented by `render::WorldRenderSurface` (integer
physical-pixel world surface) and `render::Letterbox` (viewport arbitration), so
Rule 10's scaling half is **satisfied**.

- **World pass** renders to the design-sized surface, then blits to the window.
- **UI pass** runs under a design-sized letterbox view, so a UI element is placed
  in design coordinates and lands correctly at any window size.

## 2. Safe areas — re-scoped, not dropped

The original rule targeted smartphone notches, punch-holes and gesture bars.
**That does not apply to the current build and pretending otherwise would be
theatre.** SFML 3 has no supported browser target and only experimental Android
support, so dogmax is desktop-first.

What is binding **now**:

- Critical HUD (health, dash charges, weapon rows, XP) must remain inside a
  configurable margin from every window edge, so an unusual aspect ratio or a
  window-manager decoration cannot clip it.
- Nothing gameplay-critical may sit in the outer 3% of the design rect.

What is **deferred until a mobile target actually exists**:

- Notch / punch-hole insets
- Gesture-bar exclusion zones
- Touch-target minimum sizes (44×44 pt)

When a mobile port is attempted, this section becomes binding and needs its own
TDD spec before any layout code is written.

## 3. Aspect ratios to verify

| Ratio | Example | Status |
| :--- | :--- | :--- |
| 16:9 | 1920×1080 | Primary |
| 16:10 | 1920×1200 | Must not clip HUD |
| 21:9 | 3440×1440 | Must not clip HUD |
| 4:3 | 1600×1200 | Letterbox correctness |
