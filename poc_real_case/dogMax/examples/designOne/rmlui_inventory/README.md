# DogMax — Inventory (RmlUI)

The inventory rebuilt in **RmlUI**'s HTML/CSS-like languages (RML + RCSS), ready
to drop into the SFML game. No React, no canvas — plain markup + stylesheet +
SVG icons, so the engine renders it natively.

```
rmlui_inventory/
  inventory.rml     # the document (structure + the 56-cell grid, static)
  theme.rcss        # shared tokens: tier accents, dice colours, fonts
  inventory.rcss    # layout & chrome (panel, powder column, grid, footer)
  icons/*.svg       # 12 weapon glyphs (neon-traced, viewBox 0 0 48 48)
  preview.html      # browser-viewable mirror (open this to SEE it render)
  preview.css       # the preview's plain-CSS stylesheet (reference only)
  README.md
```

`preview.html` + `preview.css` are a **browser reference** so you can eyeball the
result without building — open `preview.html` in any browser. The engine itself
uses `inventory.rml` + `theme.rcss` + `inventory.rcss`, which carry the same
class names and values.

## Loading in RmlUI

```cpp
// 1) register fonts BEFORE loading the document (family names used in RCSS)
Rml::LoadFontFace("assets/JetBrainsMono-Bold.ttf");   // "JetBrains Mono"
Rml::LoadFontFace("assets/ChakraPetch-SemiBold.ttf"); // "Chakra Petch"

// 2) the SVG plugin renders the <svg src="..."/> weapon icons
Rml::SVG::Initialise();                 // link RmlUi_Plugin_SVG / lunasvg

// 3) load + show
Rml::ElementDocument* doc =
    context->LoadDocument("ui/inventory.rml");
doc->Show();
```

> The weapon icons use the `<svg src="icons/<id>.svg"/>` element from the
> official **RmlUi SVG plugin** (lunasvg). If you don't build that plugin, swap
> each `<svg .../>` for an `<img src="icons/<id>.svg"/>` backed by your own
> texture (e.g. the one your `weapon.frag` already renders).

## Structure

- **`.panel`** → titlebar (`INVENTORY`) + `.pbody`.
- **`.toolbar`** → sort tabs (`BY TIER / BY TYPE / BY VALUE`) + the `24 / 56`
  capacity counter.
- **`.main`** is a flex row of:
  - **`.powder`** (left, 108px): three `.pbtn` tier *destroy → powder* buttons
    (each shows how many unequipped items that tier would convert) then the
    **stash** — all 11 powder colours with their held amount + the total.
  - **`.grid`**: **7 columns × 8 rows = 56 cells** that share 1px border lines,
    so there is **no gap**. Built as 7 `.col` flex columns; a **die** fills one
    `.cell`, a **weapon** fills a `.cell.weapon` (1 wide × 2 tall) and a `.seam`
    line marks the cell boundary it spans. Column-flow: a weapon tops each
    column over its dice/empty cells.
- **`.footer`** → the key (weapon = 2 cells, die = 1 cell, equipped = safe).

### Per-item classes
- Quality tier: `t-common` / `t-uncommon` / `t-rare` on the cell — drives the
  slot frame gradient, the corner tab, and the powder shard.
- Dice colour: `d-4 … d-100` on the `.die` — drives the diamond border + number
  colour (red d4, yellow d6, cyan d8, green d12, blue d20, magenta d24, purple
  d30, orange d42, pink d60, white d100).
- `.selected` highlights a slot; `.eq` is the equipped flag (never destroyed).
  Dice do not stack — each die is a single item in one cell.

## Making it data-driven (optional)

The shipped `.rml` is static so it renders as-is. To bind it to live game state,
wrap the grid in an RmlUI **data model** and loop the cells:

```xml
<div class="grid" data-model="inventory">
  <div class="col" data-for="col : columns">
    <div class="cell {{cell.tier}}" data-for="cell : col.cells"
         data-class-weapon="cell.isWeapon" data-class-selected="cell.selected">
      <div class="slot"></div>
      <svg class="wpn" data-if="cell.isWeapon" data-attr-src="cell.icon"/>
      <div class="die {{cell.diceClass}}" data-if="cell.isDie">
        <span class="dn">{{ cell.faces }}</span>
      </div>
      <span class="count" data-if="cell.isDie">x{{ cell.count }}</span>
      <div class="corner"></div>
    </div>
  </div>
</div>
```

```cpp
Rml::DataModelConstructor c = context->CreateDataModel("inventory");
c.RegisterArray<std::vector<Cell>>();
c.Bind("columns", &columns);   // your inventory state
```

## Colours (verbatim from the kit)

| Tier | hex | Dice | hex |
|---|---|---|---|
| Common | `#b4b4c8` | d4 | `#ff4646` |
| Uncommon | `#50c8ff` | d6 | `#f0c846` |
| Rare | `#ffd732` | d8 | `#50dcf0` |
| | | d12 | `#50f078` |
| Accent (cyan) | `#50e6ff` | d20 | `#5090ff` |
| | | d24 | `#ff50dc` |
| Powder (weapon) | `#2c2c34` | d30 | `#b450f0` |
| | | d42 | `#ffa028` |
| | | d60 | `#ff82c8` |
| | | d100 | `#f0f0f0` |

## RCSS gotchas baked in

- **No `clip-path`** → chamfers dropped; panel/slots use straight neon borders.
- **No `gap`** → spacing is done with `margin-*` on children.
- **Gradients** use the `decorator: linear-gradient(...)` property, not
  `background`.
- **Text glow** uses `font-effect: glow(...)`, not `text-shadow`.
- **`box-shadow`** is RmlUi 6.0+; it degrades gracefully (ignored) on older builds.
- Colours are `#rrggbb` / `#rrggbbaa` (8-digit hex carries the alpha).
