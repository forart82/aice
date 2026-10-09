# Feature TDD Specification: Menu Ouroboros Backdrop Animation & Logo Cleanup

> **Feature ID:** `menu_ouroboros_backdrop_animation`  
> **Status:** Red $\rightarrow$ Green $\rightarrow$ Refactor  
> **Target Files:**
> - `src/ui/screens/MenuScreen.ts`
> - `src/render/OuroborosMenuAnimation.ts`
> - `src/render/ArenaBackdrop.ts`
> - `src/render/GameRenderer.ts`
> - `src/tests/MenuOuroborosBackdropAnimation.test.ts`

---

## 1. Feature Requirements

1. **App Icon Preservation:**
   - App icon remains untouched in `public/icon.png`, `public/favicon.png`, and `android/app/src/main/res/mipmap-*/`.
2. **Main Screen Logo Image Removal:**
   - Remove `<img class="menu-logo-img" ...>` from `MenuScreen.ts`.
   - Preserve all title headers (`OUROBOROS GALAXY`), subtitle tagline, horizontal best stats row badges (`BEST`, `FLOOR`, `COMBO`, `💎`), and game mode buttons.
3. **Animated Self-Crossing, Self-Winding, Tail-Biting Ouroboros Serpent Backdrop:**
   - A multi-lobed parametric coiling curve (e.g. 3-lobed Lissajous knot / torus projection) where the serpent coils, crosses itself multiple times, and bites its glowing tail in continuous loop.
   - Smooth 60/120 FPS animation driven by frame count / delta time with zero per-frame garbage collection.
   - Rendered as a translucent cosmic background layer behind the title screen modal panel (`globalAlpha` $\approx 0.35 \dots 0.55$).
