# DogMax — Health Bar (Static)

A **static**, pre-rendered replica of the DogMax hero **HUD health bar** — the
floating bar that shows current HP, with the hero **level number** to its left.
No JavaScript: `healthbar.html` is the finished markup, `styles.css` paints it.
Open `healthbar.html` in any browser. Four files:

```
healthbar_static/
  healthbar.html   # the bar as fixed HTML markup (HP ramp + level)
  styles.css       # the complete dark-cyberpunk neon stylesheet
  README.md        # this file
  preview.png      # screenshot of the rendered health bars
```

## What it is

The HUD bar floats above the hero. It shows the three points of the **HP ramp**
(the fill colour shifts with `currentHP / maxHP`):

| State | Fill colour | Hex | Shown at |
|-------|-------------|-----|----------|
| Healthy (> 50%) | green | `#50dc64` | 700 / 850 |
| Wounded (25–50%) | yellow | `#f0d246` | 323 / 850 |
| Critical (< 25%) | red | `#eb4646` | 119 / 850 |

## Element / class reference

| Class | Purpose |
|-------|---------|
| `.bar-line` | One HUD row: the level number + the bar, side by side. |
| `.lvl` | The hero **level number** (orange `#ff7828`, glowing) sitting OUTSIDE the bar, to its left. |
| `.hp` | The bar shell. Add `.healthy` / `.wounded` / `.critical` to set fill width + colour. |
| `.hp .fill` | The coloured HP fill (width = HP fraction). |
| `.hp .label` | Centred `<currentHP> / <maxHP> HP` text, white with a dark outline. |
| `.hp .br` | The four glowing cyan **corner brackets** (`.tl/.tr/.bl/.br`). |

## Spec (matches the kit)

- Bar dimensions here: `300 × 20 px` (the in-game Hero Healthbar is `200 × 14 px`,
  `40 px` above the sprite — scale `.hp` to match if porting).
- Background fill: dark `#202028`.
- Fill ramp: green → yellow → red by `currentHP / maxHP`.
- Level number is hero-orange and lives to the **left** of the bar, never inside it.

## Customising

- **HP %** — change the `.fill` width in the `.healthy/.wounded/.critical` rules.
- **Colours / size** — all in `styles.css` `:root` and the `.hp*` rules.
- **Level** — edit the `27` inside each `.lvl` span in `healthbar.html`.

Pure HTML + CSS, no dependencies beyond two Google Fonts. This is the static
snapshot; the live HUD lives in the DogMax UI Kit (`kit-hud.jsx`).
