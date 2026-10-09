# DogMax — Weapon Slots Sidebar (RmlUI)

The in-game **WEAPON SLOTS** rail rebuilt in RmlUI's HTML/CSS-like languages
(RML + RCSS). Same approach as the inventory package: plain markup + stylesheet +
SVG icons, rendered natively by the engine.

```
rmlui_sidebar/
  sidebar.rml       # the document — the panel + 8 weapon-slot rows (static)
  theme.rcss        # shared tokens: tier strip, dice colours, fonts
  sidebar.rcss      # layout & chrome (panel, row, dice, charge bar, dron flag)
  icons/*.svg       # 12 weapon glyphs (shared with the inventory package)
  preview.html      # browser-viewable mirror (open this to SEE it render)
  preview.css       # the preview's plain-CSS stylesheet (reference only)
  README.md
```

Open `preview.html` in a browser to see it. The engine uses `sidebar.rml` +
`theme.rcss` + `sidebar.rcss`, which carry the same class names and values.

## Loading in RmlUI

```cpp
Rml::LoadFontFace("assets/JetBrainsMono-Bold.ttf");   // "JetBrains Mono"
Rml::LoadFontFace("assets/ChakraPetch-SemiBold.ttf"); // "Chakra Petch"
Rml::SVG::Initialise();                                // for <svg src="..."/>

auto* doc = context->LoadDocument("ui/sidebar.rml");
doc->Show();
```

> Weapon icons use the RmlUi **SVG plugin** (`<svg src="icons/<id>.svg"/>`). No
> SVG plugin? Swap each for `<img src="icons/<id>.svg"/>` backed by your own
> texture (e.g. the one `weapon.frag` renders).

## Row anatomy

Each `.row` is a flex strip, `78px` tall, with a clipped bottom-left corner:

1. **`.tier`** — 6px saturation strip, colour = item tier (read at a glance).
2. **`.wzone`** (78px) — weapon glyph + name + `LV n`.
3. **`.dzone`** (flex) — the dice on a **single row** (up to six, never wraps),
   each a coloured diamond showing its current rolled **value**; below them a
   **charge bar** (`.charge` / `.cfill`, width = charge %).
4. **`.dron`** (56px) — the payoff flag: either a Dron multiplier
   (`x40` + `HEXADRON`) telling you this swing hits big, or vertical `ROLLING`
   while it spins up.

### State classes
- Tier: `t-common` / `t-uncommon` / `t-rare` on the row → tier strip + charge fill.
- `ready` on the row → golden border + glow, gold charge fill (your dive cue).
- Dice: `d-4 … d-20` on `.die` → diamond border + value colour; `.die.empty`
  is an open socket, `.die.disabled` a locked socket.
- Dron label colour is set inline per row (`HEXADRON` gold, `TRIDRON` tan,
  `DUODRON` bronze).

## Making it data-driven (optional)

Bind the rows to live equipped-weapon state with an RmlUI data model:

```xml
<div class="pbody" data-model="rail">
  <div class="row {{slot.tier}}" data-for="slot : slots" data-class-ready="slot.ready">
    <div class="tier"></div>
    <div class="wzone">
      <svg class="wpn" data-attr-src="slot.icon"/>
      <span class="wname">{{ slot.name }}</span>
      <span class="wlv">LV {{ slot.level }}</span>
    </div>
    <div class="dzone">
      <div class="dice">
        <div class="die {{die.cls}}" data-for="die : slot.dice"><span class="dn">{{ die.value }}</span></div>
      </div>
      <div class="charge"><div class="cfill" data-style-width="slot.chargePct"></div></div>
    </div>
    <div class="dron">
      <span class="dmult" data-if="slot.hasDron">x{{ slot.dronMult }}</span>
      <span class="dlabel" data-if="slot.hasDron">{{ slot.dronLabel }}</span>
      <span class="rolling" data-if="slot.hasDron == false">ROLLING</span>
    </div>
  </div>
</div>
```

## RCSS gotchas baked in
- **No `clip-path`** → straight neon borders (preview keeps the chamfer for looks).
- **No `gap`** → spacing via `margin-*`; dice are `inline-block` with right margin.
- **Gradients** via `decorator: linear-gradient(...)`, not `background`.
- **Glow** via `font-effect: glow(...)`, not `text-shadow`.
- **`box-shadow`** is RmlUi 6.0+ (degrades gracefully on older builds).
- Colours are `#rrggbb` / `#rrggbbaa`.
