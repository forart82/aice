# Feature TDD Specification: Intricate Ouroboros Knot & Transparent Gameboard Backdrop

> **Feature Identifier:** `docs/tdd/intricate_ouroboros_knot_and_backdrop.tdd.md`  
> **Status:** Red $\rightarrow$ Green $\rightarrow$ Refactor  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Target Files:**
> - `src/render/OuroborosMenuAnimation.ts`
> - `src/render/ArenaBackdrop.ts`
> - `src/render/GameRenderer.ts`
> - `src/ui/UiTheme.ts`
> - `index.html`
> - `src/tests/IntricateOuroborosKnotAndBackdrop.test.ts`

---

## 1. Feature Requirements

1. **Intricate Multi-Crossing Celtic/Norse Ouroboros Knot:**
   - Dense multi-harmonic $(7, 5)$ Lissajous-Torus knot generating $\ge 12$ (up to 30) spatial self-intersections/crossovers across a wide horizontal screen span.
   - Smooth continuous slithering kinematics along the knot with 220 body segments and lateral muscular undulations.
   - 3D depth-sorting and contact drop shadows providing over/under crossover occlusion.
   - Dragon/viper head with glowing eyes and articulated jaws continuously biting/swallowing the golden crystal tail.
2. **Transparent Menu & Gameboard Layering:**
   - Glassmorphic modal panels and overlays styled with semi-transparency (`rgba(4, 9, 18, 0.70)` and soft blur) so underlying canvas layers are visible.
   - Gameboard starfield, neon grid, and perimeter walls render as the base layer.
   - Continuous backdrop present across `GameState.Title`, `GameState.Menu`, `GameState.Sanctuary`, and `GameState.GameOver` (death screen).
