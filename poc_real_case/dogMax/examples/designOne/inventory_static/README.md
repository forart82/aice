# DogMax — Inventory (Static)

A **static**, pre-rendered replica of the DogMax inventory screen. No
JavaScript at all — the markup in `inventory.html` is the finished layout, and
`styles.css` paints it. Open `inventory.html` in any browser. Just four files:

```
inventory_static/
  inventory.html   # the inventory as fixed HTML markup (no scripts)
  styles.css       # the complete dark-cyberpunk neon stylesheet
  README.md        # this file
  preview.png      # screenshot of the rendered inventory
```

> Want the clickable version (select, sort tabs, destroy→powder, tooltips)? See
> the sibling `inventory_interactive/` folder. This folder is the **static**
> snapshot of the same screen.

## Layout

One framed panel holding two regions side by side:

1. **Powder Column** (left, 110px) — the destroy→powder economy display.
2. **Item Grid** (right) — a continuous **7 columns × 8 rows = 56-cell** grid
   whose cells share border lines with **no gaps**.

Each grid **column** is one weapon loadout: a **weapon** on top (occupying
**2 cells**) over up to **6 dice** (1 cell each) → `2 + 6 = 8 rows`.

## Elements, exactly

### Panel
- **Title bar** — `INVENTORY` in cyan on a chamfered (clipped-corner) panel.
- **Toolbar** — three **sort labels** (`BY TIER` shown active) + a **capacity
  counter** `24 / 56` (filled cells of 56).

### Item Grid
- **Cell** — a 54px square (`--cell`). Empty cells show only the grid lines.
- **Weapon cell** — spans **2 rows**, with a horizontal **seam** through its
  middle so the two-cell footprint reads inside the continuous grid. The glyph is
  an inlined SVG centered across both cells.
- **Dice cell** — a single cell with a rotated **diamond**, the **face number**
  upright inside, and a **×count** in the corner.
- **Tier** shows as the slot tint/border, a top-left **corner tab**, and the
  glow on the selected cell:
  - Common `#b4b4c8` · Uncommon `#50c8ff` · Rare `#ffd732`.
- **Equipped flag** — a small cyan diamond, top-right (equipped = safe from
  destroy).
- **Selected** — one cell (the Warhammer) carries the golden selection glow to
  show that state.

### Powder Column
- **DESTROY → POWDER** — three **tier rows** (Common / Uncommon / Rare), each
  showing how many dice of that tier would convert (`destroy ×N`:
  16 / 12 / 7 here).
- **POWDER total** — sum of all powder held (`803`).
- **Powder stash** — all **11 powders**, one per item type. The first 10 are the
  dice colours; the 11th (**BLACK**) is weapon powder.

## Powder colour map (item type → powder)

| Item | Powder | Hex | Held |
|------|--------|-----|------|
| d4   | RED     | `#ff4646` | 240 |
| d6   | YELLOW  | `#f0c846` | 180 |
| d8   | CYAN    | `#50dcf0` | 70 |
| d12  | GREEN   | `#50f078` | 60 |
| d20  | BLUE    | `#5090ff` | 95 |
| d24  | MAGENTA | `#ff50dc` | 45 |
| d30  | PURPLE  | `#b450f0` | 30 |
| d42  | ORANGE  | `#ffa028` | 18 |
| d60  | PINK    | `#ff82c8` | 22 |
| d100 | WHITE   | `#f0f0f0` | 12 |
| Weapon | BLACK | `#2c2c34` | 31 |

## Contents shown

- **Column 1** — Warhammer (rare, equipped, selected) over d20·3, d6·7, d4·9,
  d8·5, d12·4, d24·2.
- **Column 2** — Big Axe (uncommon, equipped) over d30·2, d42·1, d60·1, d100·1.
- **Columns 3–7** — Great Sword, Long Sword (equipped), Mace, Dagger, Halberd,
  each with empty dice cells.
- **Capacity** — 24 / 56 cells used.

## Customising

- **Cell size** — change `--cell` in `styles.css`.
- **Colours** — tier and powder hexes live in `:root` and the per-die `.d-*`
  rules in `styles.css`.
- **Contents** — edit the markup directly in `inventory.html` (it's plain HTML).

Pure HTML + CSS, no dependencies beyond two Google Fonts — drop it anywhere.
