# DogMax — Weapon Slots Sidebar (Static)

A **static**, pre-rendered replica of the DogMax in-game **Weapon Slots** rail —
the vertical sidebar that shows every equipped weapon, its dice pool, charge,
and payoff. No JavaScript: the markup in `sidebar.html` is the finished layout
and `styles.css` paints it. Open `sidebar.html` in any browser. Four files:

```
sidebar_static/
  sidebar.html   # the sidebar as fixed HTML markup (no scripts, glyphs inlined)
  styles.css     # the complete dark-cyberpunk neon stylesheet
  README.md      # this file
  preview.png    # screenshot of the rendered sidebar
```

## What it is

A framed **WEAPON SLOTS** panel stacking one **row per equipped weapon**
(8 shown). Each row is read left→right at a glance during combat.

## Row anatomy (left → right)

1. **Tier strip** — a 6px vertical bar coloured by the weapon's tier
   (Common `#b4b4c8` · Uncommon `#50c8ff` · Rare `#ffd732`).
2. **Weapon zone** — the weapon **glyph** (inlined SVG) + its **name** + level
   (`LV n`). Long names ellipsize.
3. **Dice zone** — the weapon's dice on a **single row** (up to six), each a
   coloured **diamond** showing its current rolled **value**; below them a
   **charge bar** whose fill width = charge/cooldown %.
4. **Dron flag** — the payoff: either a **Dron multiplier** (`x40` + label) when
   the dice line up for a big hit, or a vertical **ROLLING** while it spins up.

## State classes

- **Tier** — `t-common` / `t-uncommon` / `t-rare` on the `.row` sets the tier
  strip and the charge-bar fill colour.
- **`ready`** — on the `.row` adds the golden border + glow and a gold charge
  fill (the "fire now" cue). The Warhammer row shows this.
- **Dice** — `d-4 … d-20` on a `.die` sets its diamond border + value colour.
  `.die.empty` is an open socket; `.die.disabled` is a locked socket.
- **Dron** — `.dmult` (the ×N number) + `.dlabel` (HEXADRON / TRIDRON / DUODRON,
  coloured inline), or `.rolling` for the vertical ROLLING text.

## Dice colours

| Die | Hex |
|-----|-----|
| d4  | `#ff4646` |
| d6  | `#f0c846` |
| d8  | `#50dcf0` |
| d12 | `#50f078` |
| d20 | `#5090ff` |

## Rows shown (top → bottom)

| Weapon | Tier | LV | Dice (values) | Charge | Dron |
|--------|------|----|--------------|--------|------|
| Warhammer | Rare · **ready** | 6 | d6·6 (all 5) | 100% | ×40 HEXADRON |
| Big Axe | Uncommon | 4 | d8 4/4/4, d12 9/7, d20 11 | 66% | ×6 TRIDRON |
| Long Sword | Uncommon | 3 | d4 3/3, empty | 30% | ROLLING |
| Knives | Common | 2 | d4 3, d6 3, d8 7, d4 1, d6 5 | 50% | ×2 DUODRON |
| Halberd | Common | 2 | d20 14, 3× empty | 15% | ROLLING |
| Quarterstaff | Common | 1 | d20 7, 2× empty | 80% | ROLLING |
| Dagger | Uncommon | 1 | d4 2/2, empty, 2× disabled | 40% | ROLLING |
| Pitchfork | Common | 1 | d4 3, empty | 60% | ROLLING |

## Customising

- **Colours / sizes** — tier, dice and layout values live in `styles.css`
  (`:root` plus the `.t-*`, `.d-*`, `.row`, `.dzone` rules).
- **Rows** — edit the markup directly in `sidebar.html`; each `.row` block is one
  weapon slot. Weapon glyphs are inlined `<svg class="wpn">` elements.

Pure HTML + CSS, no dependencies beyond two Google Fonts — drop it anywhere.
This is the static snapshot; the engine-side version lives in `rmlui_sidebar/`.
