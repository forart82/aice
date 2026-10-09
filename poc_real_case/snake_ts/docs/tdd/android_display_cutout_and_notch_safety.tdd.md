# Feature TDD Specification: Android Display Cutout & Notch Safe Area Protection

> **Feature ID:** `android_display_cutout_and_notch_safety`  
> **Status:** Red $\rightarrow$ Green $\rightarrow$ Refactor  
> **Target Files:**
> - `android/app/src/main/java/com/ouroboros/ascension/MainActivity.java`
> - `index.html`
> - `src/ui/ResponsiveLayout.ts`
> - `src/tests/AndroidDisplayCutoutAndNotchSafety.test.ts`

---

## 1. Problem Statement & User Requirements

On devices with camera punch-holes, display notches, or navigation gesture bars (such as the Google Pixel 6, Galaxy devices, and modern iPhones), the status bar and camera notch can overlap top game HUD buttons (`[🧬 LAB]`, `[⏸ PAUSE]`, vitals bar) and modal close buttons if the game does not properly compensate for display cutouts and safe areas.

---

## 2. Technical Architecture & Safeguards

1. **Android Native Immersive Sticky Mode & Cutout Support:**
   - In `MainActivity.java`:
     - Configure `layoutInDisplayCutoutMode = LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES`.
     - Configure `WindowCompat.setDecorFitsSystemWindows(window, false)`.
     - Hide system status and navigation bars with `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`.
2. **Safe Area Inset Compensation & Resilient Minimums:**
   - In `index.html`:
     - `.hud-layer.tier-phone`: `padding: max(14px, calc(var(--sat) + 10px)) max(14px, calc(var(--sar) + 10px)) max(8px, calc(var(--sab) + 6px)) max(14px, calc(var(--sal) + 10px));`
     - Landscape Mode: `padding: max(8px, calc(var(--sat) + 6px)) max(24px, calc(var(--sar) + 14px)) max(6px, calc(var(--sab) + 4px)) max(24px, calc(var(--sal) + 14px));`
3. **Touch Targets & Click Reliability:**
   - `.hud-icon-btn`: Minimum $44\text{px} \times 44\text{px}$ touch target with `touch-action: manipulation` and `-webkit-tap-highlight-color: transparent;`.
