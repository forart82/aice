# DogMax — The Ten Dice (Static)

A **static**, pre-rendered gallery of the **10 DogMax dice** — the polyhedral
neon gems you slot into weapons. No JavaScript: `dice.html` is the finished
markup (every die baked as inline SVG) and `styles.css` paints the panel. Open
`dice.html` in any browser. Four files:

```
dice_static/
  dice.html    # the 10-die gallery as fixed HTML (each die = inline SVG)
  styles.css   # the complete dark-cyberpunk neon stylesheet
  README.md    # this file
  preview.png  # screenshot of the rendered dice
```

## What it is

Every die is a **faceted neon gem token**. The silhouette's **side count grows
with the die's face count**, each die has a **signature hue**, and the token
shows the **rolled value** (big, centered) and a **dN label** (corner).

## The dice

| Die | Silhouette | Hue (RGB) | Drop weight |
|-----|------------|-----------|-------------|
| d4   | triangle (3) | `255,70,70` red | 4000 |
| d6   | diamond (4) | `240,200,70` yellow | 2200 |
| d8   | diamond (4) | `80,220,240` cyan | 800 |
| d12  | pentagon (5) | `80,240,120` green | 300 |
| d20  | hexagon (6) | `80,140,255` blue | 180 |
| d24  | hexagon (6) | `255,80,220` magenta | 80 |
| d30  | heptagon (7) | `180,80,240` purple | 50 |
| d42  | octagon (8) | `255,160,40` orange | 20 |
| d60  | octagon (8) | `255,130,200` pink | 10 |
| d100 | apex nonagon (9) | `240,240,240` white | 2 |

**Drop weight** is the relative roll-rarity: a d4 is ~2000× more common than a
d100, so higher-face dice are the rare, powerful pulls.

## How a die token is built (per card)

1. **Outer polygon** — `N` sides (per the table), filled at 12% of the hue,
   stroked solid in the hue, with a soft outer glow (`drop-shadow`).
2. **Inner polygon** — a smaller concentric polygon at 40% hue (the cut facet).
3. **Spokes** — faint lines from the centre to every other outer vertex.
4. **Value** — the rolled number, white with a hue-coloured glow (the d100 uses
   a black outline instead because its body is near-white).
5. **Label** — `dN` in the corner, in the hue.

The **d100** is special — an *apex die*: a translucent body with **two-colour
(cyan + magenta) spokes** and a magenta inner nonagon under the cyan outline.

## Customising

- **Rolled value shown** — each token's `.val` span (set per die in `dice.html`).
- **Colours / sizes / layout** — all in `styles.css` (`:root` + `.card`/`.token`).
- The geometry is plain inline SVG, so any die can be lifted out and reused
  on its own.

Pure HTML + CSS, no dependencies beyond two Google Fonts. This is the static
snapshot; the live, animated dice (rolling / charged / spent states) live in the
DogMax UI Kit (`kit-dice.jsx`).
