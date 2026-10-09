# DogMax — Item Tooltip (Static)

A **static**, pinned rendering of the DogMax inventory **item tooltip** — the
hover card that appears when you inspect a weapon or a die in the inventory.
In the live UI it follows the cursor and fades in on hover; here both variants
are **pinned (always visible)** so the layout can be studied. No JavaScript.
Open `inventory.html` in any browser. Four files:

```
tooltip_static/
  inventory.html   # the two tooltip variants as fixed HTML markup (glyph inlined)
  styles.css       # the complete dark-cyberpunk neon stylesheet
  README.md        # this file
  preview.png      # screenshot of the rendered tooltips
```

## What it is

The tooltip is a small chamfered (clipped-corner) neon card whose **border
colour matches the item's tier** (Common `#b4b4c8` · Uncommon `#50c8ff` ·
Rare `#ffd732`). It has two parts:

- **`.tiphead`** — an icon + the item name + a sub-line. The sub-line is the
  tier (coloured) followed by extra tags (weapon archetype / `EQUIPPED`, or the
  die's powder colour).
- **`.tipbody`** — a list of `.tiprow` stat rows: a dim **label** on the left and
  a bright **value** on the right, each on a single line.

Two variants are shown:

### Weapon tooltip
- **Header** — weapon glyph (inlined SVG) + name + `TIER · ARCHETYPE · EQUIPPED`.
- **Rows** — Damage, Attacks / sec, Range, Crit.

### Dice tooltip
- **Header** — a coloured dice **diamond** with its face number + `dN Dice` +
  `TIER · <COLOUR> POWDER`.
- **Rows** — Faces, Held (×count), Destroy yields (how much powder it gives).

## Element / class reference

| Class | Purpose |
|-------|---------|
| `.tip` | The card. Add `.common` / `.uncommon` / `.rare` to set the border colour. |
| `.tiphead` | Header band (icon + name + sub-line), divider underneath. |
| `.tipname` | Item name (display font, white). |
| `.tipsub` | Tier + tags line. Colour with `.sub-common/-uncommon/-rare`. |
| `.tipbody` | Stat list container. |
| `.tiprow` | One `label / value` line (`white-space:nowrap`). |
| `.die.d-N` | The dice diamond in the header (colour-coded per face count). |

## Tier colours

| Tier | Hex |
|------|-----|
| Common | `#b4b4c8` |
| Uncommon | `#50c8ff` |
| Rare | `#ffd732` |

## Customising

- **Tier border / sub colour** — swap the `.tip` modifier class (`rare` →
  `uncommon` / `common`) and the `.tipsub` colour class.
- **Stats** — edit the `.tiprow` lines directly in `inventory.html`.
- **Width / spacing / colours** — all in `styles.css` (`:root` plus `.tip*`).

Pure HTML + CSS, no dependencies beyond two Google Fonts. This is the static
snapshot of the tooltip; the live hover behaviour lives in
`inventory_interactive/`.
