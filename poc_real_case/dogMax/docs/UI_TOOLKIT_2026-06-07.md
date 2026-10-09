# UI Toolkit Decision (R3-01)

**Date:** 2026-06-07 · **Status:** SHIPPED IN SIMPLER FORM · **Gates:** every UI surface in P3+ (inventory, sidebar, tooltip, debug panel, HUD bars).

## Decision

Build a **bespoke SFML widget layer** for all player-facing UI: a small, owned
C++ widget system that renders through the locked SFML 3 `sf::Shader` stack
(R2-00).

**2026-07-07 status:** the bespoke-SFML direction shipped in a simpler form than
this ADR proposed. Current UI widgets are hand-written C++/SFML rect math and
small reusable primitives under `src/render/ui/`. The declarative
HTML/CSS-like markup, stylesheet loader, and flexbox-style layout engine below
were proposed but not built.

- **No RmlUi.** No ImGui for player UI.
- **No new runtime dependency** — SFML 3 + the P2 render modules only.
- Authoring did **not** become declarative; current shipped UI code is direct
  C++ using config values and small drawing helpers.

## Why bespoke, not RmlUi or ImGui

The decision turns on the axis a static panel never exercises — **layout, input
routing, text, and the automation-E2E seam** — not on aesthetics (all three
options can draw a neon panel).

| Axis | Bespoke SFML (chosen) | RmlUi + custom renderer | ImGui |
|---|---|---|---|
| Neon aesthetic (outline/bloom/SDF/chamfer/4-state icons) | Native — **already prototyped** in `examples/designOne/` | Needs a custom `Rml::RenderInterface` (the GL2 reference renderer is exactly what failed before) | Fights the art direction (dev-tool look) |
| Layout | Proposed flexbox-subset solver; shipped implementation is direct C++ rect layout | Free (RCSS flexbox) | Free-ish, dev-tool layouts |
| Input / hit-test / hover / drag | Owned, uniform element model | RmlUi event routing | Immediate-mode |
| Text | `sf::Font`/`sf::Text` (single-line labels only) | Free | Free |
| Dependency / KISS | Zero new dep | Heavy dep + a renderer we'd write anyway | Medium dep |
| Control over the failure that caused the rewrite | Total — we own every pixel | Partial — third-party renderer surprises (the original GL2 trap) | N/A |

The old build's UI was the reason for the whole rewrite, and its concrete failure
was **RmlUi's bundled GL2 reference renderer having no shader support** — gradients
and box-shadow rendered white. The honest RmlUi path today is "RmlUi + a *custom*
SFML3 `RenderInterface`" — but writing that interface (routing every element's
geometry through our outline/bloom shaders) costs about as much as the bespoke
widget layer, while keeping a heavy dependency and re-exposing us to third-party
renderer behaviour. Bespoke spends the same effort and keeps total control.

## The evidence that makes bespoke low-risk

This is not a green-field gamble. `examples/designOne/` already contains the design
realised three ways, and the pure-C++/shader path already draws the hard parts:

- **`weapon.frag`** — all 10 weapon archetypes as one shader (`u_weapon` id switch),
  each a union of line-segment + circle SDFs ported 1:1 from the kit's neon glyphs,
  rendered as a glowing neon stroke the bloom pass amplifies. This **deletes the
  "SVG icon handling" build risk**: icons are procedural shaders, not a
  rasterization pipeline. (The `.frag` family also covers `die`, `enemy`, `slot`,
  `panel`, `powder`.)
- **`inventory_static/` + `sidebar_static/`** — the target UI as plain **HTML + CSS**
  (no toolkit). Every CSS technique they use maps to something SFML already does:

  | CSS in the mockup | SFML / shader equivalent |
  |---|---|
  | `clip-path:polygon()` chamfered corners | `sf::ConvexShape` points / SDF |
  | `linear/radial-gradient` fills | fragment shader |
  | `box-shadow` outer glow | `BloomShader` / `HaloShader` (built) |
  | `border:1px solid rgba()` | ConvexShape outline / `OutlineShader` (built) |
  | `text-shadow` neon text | text → texture → bloom |
  | `transform:rotate(45deg)` dice | `sf::Transformable::setRotation` |
  | `transition` / `@keyframes` | per-frame lerp on a timer |
  | flex `row/column/gap/justify` | the layout subset below (the one real task) |
  | SVG `<path>` icons | the `.frag` SDF approach above |
  | TTF fonts | `sf::Font` |

- **`render_e2e` global preview** — a chamfered neon sidebar panel with glow, hex
  cells and segmented bars, drawn with pure `sf::ConvexShape` + the P2 shaders, was
  rendered this session. Detailed UI in 100% SFML is demonstrated, not assumed.

## Proposed but not built: the layout engine

Extracted from both stylesheets, the **entire** layout surface the two screens use:

**Flow layout (flexbox subset):**
```
dir     : row | column
gap      : px
justify  : start | center | between
align    : start | center | stretch
size     : px (fixed) | grow (flex:1) | auto (fit children)
pad      : px (4-value)
```
**Overlay layout (absolute, for badges/seams/tooltip):**
```
anchor : top-left | top-right | center | inset(px)
z      : int (paint order)
```

Algorithm that was proposed: textbook two-pass — `measure` (bottom-up natural
sizes) then `arrange` (top-down placement, distributing grow-space, applying
justify/align), plus a final overlay pass placing absolute children by anchor.
This was not implemented in the current shipped UI.

**Explicitly OUT (keeps it KISS):** CSS-grid, text wrapping / inline flow, float,
percentage layout (the one bar fill is a value bind, not layout), media queries /
responsive reflow (fixed design rect, letterbox-scaled via the existing P2 camera
seam), scrolling containers (both mockups fit without it — add only if inventory
later needs it).

## Proposed but not built: the widget + attribute vocabulary

The complete element set for inventory + sidebar — ~15 kinds:
```
panel  titlebar  chip  tab/tabs  button
row    column    grid  cell      slot
icon(.frag)  die  bar  badge     label  tooltip  seam
```
That, plus the ~8 layout attributes above, was the proposed authoring language.
No recursive-descent loader or DSL exists in the current source tree.

## Historical proposed build cost (icons + neon already done)

| Piece | Status |
|---|---|
| Neon panels / chamfer / glow / borders | done (P2 shaders + ConvexShape) |
| Icons (weapon/die/enemy/slot) | done (`designOne` `.frag` family) |
| Bars (charge / xp / health) | done (segmented bar prototype) |
| Text + fonts | `sf::Font` — small |
| **Layout engine (flex subset + overlays)** | proposed, not built |
| Markup + stylesheet loader (`.html`/`.css`-ish -> element tree) | proposed, not built |
| Hit-test + hover / drag + per-widget probe (E2E hooks) | superseded by current bug-triggered testing rule |
| Tween system (hover scale, destroy flash) | implemented ad hoc where current C++ widgets need it |

The open-ended risks that usually sink a bespoke UI (custom art, icon pipeline)
were reduced by `designOne/`; the shipped path chose smaller hand-written C++
widgets instead of the broader DSL/toolkit build.

## Historical proposal: configuration & assets

- UI **markup** + **stylesheet** files were proposed as an authoring surface but
  were not adopted. Current UI surfaces are C++ widgets configured through the
  existing YAML/config pipeline where needed.
- The `.frag` icon shaders move from `examples/designOne/` (reference-only) into
  `assets/shaders/` when the first UI card consumes them — re-authored deliberately
  against the live palette, per the "Rebuild Context & Legacy Configs" rule, never
  copied blind.

## CLAUDE.md coupling — superseded

~~Every player-reachable widget ships a control + inspection automation hook and a
human-simulation gesture test in the same commit.~~ — superseded: this project's
current testing rule is **bug-triggered only, never proactive** (CLAUDE.md → "Tests").
No standing suite and no per-widget automation hooks are required; a test is written
only to lock in the fix for an actual discovered bug. The Human-Interaction /
Visual-Component E2E mandate this section carried forward has been removed from
CLAUDE.md.

## Historical throwaway spike note

The card asked for "a throwaway spike rendering one neon panel." That belonged to
the old standing `render_e2e`/`shader_spike` workflow and is no longer an
immediate next step. The shipped UI path is the current hand-written C++/SFML
widget layer, verified through normal builds and bug-triggered/manual/offscreen
checks when render changes require visual proof.

## CI / headless caveat (same as R2-00)

UI rendering uses shaders -> needs a GL context (a display). The old
render/golden E2E and `dogtests` split described here is historical; current
verification uses bug-triggered tests and manual/offscreen screenshot checks when
a render change needs visual validation.
