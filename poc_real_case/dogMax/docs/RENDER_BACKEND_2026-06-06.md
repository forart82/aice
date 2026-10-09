# Render / Shader Backend Decision (R2-00)

**Date:** 2026-06-06 · **Status:** LOCKED · **Gates:** R2-02 … R2-22 (all of P2), and feeds R3-01.

## Decision

The P2 render identity is built on **SFML 3 `sf::Shader` (GLSL fragment shaders)**
— the graphics library the engine already links (R0-02). No new dependency is
introduced.

## Why SFML 3, not something else

P2 needed four backend capabilities. SFML 3 covers all four; the historical
throwaway spike proved each one end-to-end on this machine, but that spike source
and test target are no longer part of current source truth:

| P2 need | SFML 3 mechanism | Proven by the spike |
|---|---|---|
| Compile + run GLSL fragment shaders | `sf::Shader::loadFromMemory(src, Fragment)` | neon-outline shader compiles + runs |
| Render-to-texture (for bloom / multi-pass) | `sf::RenderTexture` | 3-pass pipeline: disc → outline → bloom |
| Read pixels back to the CPU (visual-E2E) | `Texture::copyToImage()` → `Image::getPixel` | `render::PixelProbe` asserts the cyan ring |
| Screenshot capture (golden tests) | `sf::Image::saveToFile` | writes `shader_spike.png` |

The old build's "GL2 has no shader support" failure was **RmlUi's GL2 renderer**,
not SFML. SFML 3 uses a modern GL context and shaders work — the spike confirms
`sf::Shader::isAvailable()` is true and the shader visibly runs. Heavier
alternatives (raw GL, bgfx, a second graphics lib) add a dependency and build
surface for capabilities SFML already gives us, so they were rejected on KISS
grounds.

## The visual-E2E seam this establishes

**2026-07-07 status:** superseded as an implementation commitment. The SFML 3
shader decision still stands, but the described `dogtests`/`dogspike`/standing
visual-E2E split is historical. Current source CMake defines `dogcore` and
`dogmax` only; no source `add_test`, `dogtests`, or `dogspike` target remains.
Any matching files under `build/` or `build-dev/` are stale generated artifacts
from older configure state, not live project structure.

The durable seam remains `sf::RenderTexture` -> `copyToImage()` for screenshots
and manual/offscreen visual verification when a render change needs it. Tests are
now bug-triggered only per CLAUDE.md, not a standing per-render-card suite.

### Guarding against a false pass

A pixel assertion can pass for the wrong reason (the *shape* rendered, but the
shader never ran). The spike is triple-gated so a green result means the shader
genuinely ran: (1) `sf::Shader::isAvailable()`; (2) every `loadFromMemory`
return is checked; (3) the assertion targets a **cyan the shader uniquely
writes** — a disc drawn without the shader stays white and can never satisfy it.

## CI / headless caveat (honest constraint on the lock)

Shaders and `RenderTexture` need a **GL context**, i.e. a display. The
historical `shader_spike` test ran only because `DISPLAY=:0` was present;
**`Xvfb` was not installed on this host**. Consequences for current work:

- Offscreen screenshots still require a GL-capable display/context.
- Pure `--headless` smoke runs are useful for boot/config/update-loop crashes,
  but they do not validate shader pixels.
- The former `ctest -LE e2e`/`dogtests`/`dogspike` split is not current source
  structure; do not use it as a verification gate unless tests are deliberately
  reintroduced for a concrete bug.

## Deferred to later P2 cards (explicitly not done here)

- `.frag` files under `assets/shaders/` + the `POST_BUILD` copy of them — R2-01+.
  The spike inlines its GLSL to avoid a runtime file dependency.
- Real bloom (threshold + blur + composite tuning) — **R2-03**. The spike does a
  single bright-pass only, just to prove the multi-pass plumbing.
- Shader tunables in a `*.yaml` (outline width/colour, bloom strength) — land
  with the real R2-02/R2-03 shaders that consume them.
