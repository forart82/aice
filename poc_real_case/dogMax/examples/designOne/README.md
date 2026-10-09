# DogMax — procedural dice & weapon shaders (SFML 3.0)

Render every **die** and **weapon** icon straight from a GLSL fragment shader —
**no image assets, no texture atlas**. The silhouettes are signed-distance
fields, so they stay crisp at any size and feed the existing bloom pass exactly
like the rest of the neon UI. They mirror the HTML `DogMax UI Kit` 1:1.

```
sfml/
  die.frag            # the 10 dice (n-gon by face count + d100 prism)
  weapon.frag         # the 12 weapon silhouettes (segment SDFs)
  enemy.frag          # the base enemy + 6 special enemies (segment SDFs)
  dogmax_shapes.hpp   # colours + face→sides map + one-call draw helpers
  slot.frag           # chamfered neon inventory-slot plate (tier frame)
  sidebar_example.cpp # composes the WEAPON SLOTS sidebar row from the shaders
  enemy_example.cpp   # base-enemy tiers + wind-up + the 6 special enemies
  inventory_example.cpp # 56-place inventory: powder column + 7×8 slot grid
  README.md           # this file
```

## Quick start

```cpp
#include "dogmax_shapes.hpp"

dogmax::ShapeShaders fx;
if (!fx.load("sfml/die.frag", "sfml/weapon.frag"))
    return -1;                       // shaders unsupported / missing

// in your draw pass — pos is the CENTRE, size is px:
fx.drawDie(window, {120.f, 120.f}, 48.f, /*faces*/ 20, dogmax::diceColor(20));
fx.drawDie(window, {180.f, 120.f}, 48.f, /*faces*/ 100, dogmax::diceColor(100));

using W = dogmax::WeaponId;
fx.drawWeapon(window, {120.f, 200.f}, 48.f, W::Warhammer, dogmax::weaponColor(W::Warhammer));

using E = dogmax::EnemyId;
fx.drawEnemy(window, {120.f, 280.f}, 56.f, E::Base, dogmax::enemyColor(E::Base));
// wind-up telegraph: cyan-flash + thicker stroke, drive `charged` 0..1
fx.drawEnemy(window, {180.f, 280.f}, 56.f, E::Base, dogmax::enemyColor(E::Base), /*charged*/ 1.f);

// "charged" (0..1) thickens the stroke + hots up the glow — drive it from the
// weapon-slot ready state:
fx.drawWeapon(window, {180.f, 200.f}, 48.f, W::BigAxe, dogmax::weaponColor(W::BigAxe), /*charged*/ 1.f);
```

`fx.load(...)` takes an optional third path for `enemy.frag`; pass it to enable
`drawEnemy`:

```cpp
fx.load("sfml/die.frag", "sfml/weapon.frag", "sfml/enemy.frag");
```

The rolled face **value** is your own `sf::Text` drawn on top of the die quad —
the shader only paints the gem.

## Weapon-slot sidebar example

`sidebar_example.cpp` builds the kit's **weapon slot row** 1:1 from the shaders —
no images. Each row mirrors the HTML `WeaponRow` body, left → right: ① tier strip
· ② weapon zone (glyph + name + Lv) · ③ dice zone (up to **six dice on a single
row**) + ④ charge bar · ⑤ dron / ready flag. `drawWeaponSlotRow(...)` paints one
row; `drawWeaponSidebar(...)` stacks the 8-row `WEAPON SLOTS` panel.

```cpp
#include "dogmax_shapes.hpp"          // sidebar_example.cpp also includes this
// dogmax::SlotRow describes one equipped weapon (tier, level, dice, dron, …)
dogmax::drawWeaponSidebar(window, fx, font, {44.f, 20.f}, rows);
```

```
g++ -std=c++17 sidebar_example.cpp -o sidebar \
    -lsfml-graphics -lsfml-window -lsfml-system
./sidebar     # needs die.frag, weapon.frag, and a mono .ttf beside it
```

The dice **values** and the weapon **name / Lv / dron** labels are `sf::Text`
drawn over the shader gems — supply any monospace `.ttf` (the demo loads
`JetBrainsMono-Bold.ttf`).

## Why it needs no images

SFML's default vertex shader fills `gl_TexCoord[0]` from the drawable's
texcoords. `ShapeShaders` binds a **1×1 white pixel** and a texRect equal to the
quad size, so `gl_TexCoord[0].xy` runs `0..size`; the fragment shader divides by
`u_resolution` to get a clean `0..1` UV. The white texture's colour is never
sampled — it only exists so SFML emits texcoords. Everything visible is computed
in the shader.

## Uniform reference

### die.frag
| uniform | type | meaning |
|---|---|---|
| `u_resolution` | vec2 | quad size in px |
| `u_color` | vec3 | signature hue 0..1 (`diceColor`). Ignored by the d100 prism, which is cyan×magenta in-shader |
| `u_sides` | float | polygon sides; `0` = d100 prism (`diceSides`) |
| `u_rotation` | float | point-up tweak, radians |
| `u_charged` | float | 0 idle … 1 charged |

Face → sides: `4→3  6→4  8→4  12→5  20→6  24→6  30→7  42→8  60→8  100→0`.

### weapon.frag
| uniform | type | meaning |
|---|---|---|
| `u_resolution` | vec2 | quad size in px |
| `u_color` | vec3 | outline hue 0..1 (`weaponColor`) |
| `u_weapon` | float | archetype id 0..11 (`WeaponId`) |
| `u_charged` | float | 0 idle … 1 charged |

`WeaponId`: `0 Pitchfork 1 Sword 2 LongSword 3 GreatSword 4 Halberd
5 Quarterstaff 6 Knives 7 Dagger 8 Mace 9 Warhammer 10 SmallAxe 11 BigAxe`.

### enemy.frag
| uniform | type | meaning |
|---|---|---|
| `u_resolution` | vec2 | quad size in px |
| `u_color` | vec3 | outline hue 0..1 (`enemyColor`) |
| `u_enemy` | float | enemy id 0..6 (`EnemyId`) |
| `u_charged` | float | 0 idle … 1 wind-up (cyan-flash telegraph + thicker stroke) |

`EnemyId`: `0 Base 1 Shocker 2 Glasswraith 3 Hexarchon 4 Sentinel
5 Voidcrawler 6 PactWalker`. The base enemy is the faceted magenta shard;
specials carry their own silhouette + hue. `enemy_example.cpp` shows the base
enemy across the three quality tiers (with a rotated-diamond aura frame), the
wind-up state, and the six specials in a labelled grid.

## Where the values come from (config provenance)

All colours are lifted verbatim from the game configs so a palette swap stays a
one-file change:

- **dice hues** → `configs/dice.config` `DICE_COLOR_*`
- **weapon outlines** → `configs/weapon.config` `*_OUTLINE_*`
- **quality tiers** → `configs/quality.config` `QUALITY_TIER_*` (`tierCommon/Uncommon/Rare`, for the slot frame/aura around an icon)

If you later move these onto `THEME_*` keys, update `dogmax_shapes.hpp` (or feed
the shader from your config loader instead of the inline tables).

## Blending & bloom

`drawDie` / `drawWeapon` default to `sf::BlendAlpha`. For a hotter neon that the
bloom bright-pass picks up more strongly, pass `sf::BlendAdd` as the last arg —
matches the additive outline treatment described in `theme.config`
(`BLOOM_*`, `OUTLINE_INTENSITY_*`). Draw these in the **world/entity pass before
the bloom composite** so the glow blooms; draw UI-rail copies in the UI pass.

## Notes / tuning

- Stroke width, glow falloff and the apex-prism colours are constants near the
  bottom of each `.frag` — safe to tune without touching the C++.
- The weapon silhouettes are ported segment-for-segment from the kit's
  48×48 glyph space; to tweak a shape, edit the `SEG(...)` / `CIR(...)` lines in
  `weapon.frag` (same coordinates as the HTML `WeaponGlyph`).
- Desktop GLSL only (uses `fwidth`). That matches SFML 3.0 on the desktop
  targets the project already builds for.
```
