# 🎨 Asset Provenance & License Manifest

> **Rule Reference:** `AGENTS.md#rule-9`, `AGENTS.md#rule-7`, `ORACLE.md`
> **Standard:** 100% Commercial Usability & Zero Copyright Risk
> **Last audited:** 2026-08-22 — full pass over all 381 binary assets in `assets/`.

Every external or generated asset — audio, music, sprites, textures, fonts —
must be registered here before it enters the repository.

---

## 📊 Audit result at a glance

381 binary assets: 206 png, 120 ttf, 33 jpg, 19 wav, 2 mp3, 1 blend.

| Bucket | Count | What it means |
| :--- | ---: | :--- |
| **Referenced by name** in `src/` or live `configs/` | 60 | These ship and are load-bearing. Each gets an individual row below. |
| **Referenced by directory scan only** (`assets/fonts/showcase/`) | 119 | Loaded en bloc by the dev-only Ctrl+H font gallery, never named individually. |
| **Orphaned** — no reference of any kind | 202 | ~240 MB. Deletable today; deletion is the cheapest way to erase the licence risk. |

**What "orphaned" means here:** unreferenced by name in `src/` and in the live
`configs/` tree. The dev-only `WorldAssetGallery` still walks the whole `assets/`
tree recursively (`src/render/WorldAssetGallery.cpp:178`), so deleting an orphan
removes it from the WorldEditor authoring palette but breaks no gameplay path,
no config key and no test.

**Ship verdict:** ⛔ **BLOCKED.** Three specific blockers are listed below; the
120 fonts are effectively cleared; the 241 image/music files (206 PNG + 33 JPG
+ 2 MP3) have an identified *generator* for 35 of them and an unverified
*rights position* for all of them.

---

## 🚨 Blockers — resolve before any public build

### B1 — `assets/blend/humain.blend` contains Adobe Mixamo content (highest risk)

The 40.5 MB Blender file carries a `mixamorig1:` armature and verbatim Mixamo
animation clip names (`Dying`, `Injured Jog`, `Injured Run`, `Jump Attack`,
`Running`, `Sad Idle`, `Standing React Small From Back`, each also in its
`(In Place)` variant). Mixamo content ships under **Adobe's Mixamo terms**,
which are **not** on Rule 7's permissive allowlist and which prohibit
redistributing the assets standalone — a `.blend` holding the rig and clips,
distributed with the project, is arguably exactly that. (Whether this repository
is public was **not verified**; the finding does not depend on it.) The file also references two
hash-named textures (`0dac0b05ae44d0d8663c049cdde90b2ced7ef559_1_500x500.jpg`
and a sibling) that are **not present in the repo**, i.e. it carries third-party
content of unknown origin.

It is **orphaned** — nothing in `src/` or `configs/` loads it. **Recommendation:
delete.** Zero cost, removes the single largest legal exposure in the project.

### B2 — `assets/fonts/showcase/LiberationSansNarrow-Regular.ttf` is GPL-family

Its name table states: *"Licensed under the Liberation Fonts license"*
(`https://fedoraproject.org/wiki/Licensing/LiberationFontLicense`) — that is
**GPLv2 + a font-embedding exception**, © 2010 Oracle. Every other Liberation
face in the directory was relicensed to OFL-1.1 by Red Hat in 2012; **Narrow was
not.** This is a literal hit on Rule 7's forbidden list.

Practical risk is low — the embedding exception means bundling it does not
infect the game — but it is showcase-only (dev font gallery), so **deleting it
is cheaper than the licence analysis.** **Recommendation: delete.**

### B3 — AI-generated art and music: generator identified, rights position unresolved

All 33 JPGs and both MP3s carry an in-file **C2PA manifest signed by Google
C2PA Media Services**, stating *"Created by Google Generative AI."* with
`digitalSourceType = trainedAlgorithmicMedia`. This is hard, cryptographic
provenance — see the Method section. It identifies the **tool**, not the
**rights**, and two questions are open:

1. **Which product/tier generated them is not in the manifest**, so the
   applicable terms of service cannot be read off the file. Google's consumer
   and API image/music terms differ on commercial use. **UNVERIFIED — needs the
   owner to state which product was used and under which plan.**
2. **Purely AI-generated output is not copyrightable** under the current US
   Copyright Office position. The project can *use* these assets but holds no
   registrable copyright in them — there is no exclusive right to assert if a
   competitor reuses them, and no copyright to point at in a takedown dispute.
   This is a commercial-strategy decision, not a licence defect.

Rule 9 requires "the tool and its terms of service" for AI-generated assets.
The tool is now recorded; **the ToS half is still missing.**

---

## ⚠️ Rule 7 spec gaps — need an owner decision, not an asset change

Rule 7's allowlist is *MIT, Apache-2.0, BSD-2/3, ISC, Zlib, BSL-1.0, CC0, CC-BY*.
Three licences that the repository actually relies on are **absent from that
list**, so the assets are non-compliant *as the rule is written* even though all
three are commercially safe in practice:

| Licence | Files affected | Reality | Action needed |
| :--- | ---: | :--- | :--- |
| **OFL-1.1** (SIL Open Font License) | ~110 fonts | Explicitly permits bundling/embedding in commercial software; forbids only selling the font standalone and reusing a Reserved Font Name on a modified copy. Safe. | Add OFL-1.1 to the Rule 7 allowlist. |
| **Ubuntu Font Licence 1.0** | 4 (`Ubuntu*`) | Free redistribution and embedding; restricts renaming/modification. Safe, but bespoke. | Allowlist it, or delete the 4 showcase-only files. |
| **Bitstream Vera / DejaVu terms** | 5 (`DejaVu*`) | MIT-like; DejaVu's own changes are public domain. Safe. | Allowlist it. `assets/fonts/DejaVuSans.ttf` is the one font that actually ships in gameplay, so this one cannot be resolved by deletion. |

`AGENTS.md` is outside this document's write scope; these are recorded for the
owner to action.

---

## 🔎 Method and its limits

Read this before trusting a row.

**Reference analysis.** Every binary's filename and stem was grepped against
`src/`, `configs/` (including `configs/effects/`, `configs/enemies/`),
`tests/`, `CMakeLists.txt` and `assets/help.md`. Stem-only hits were then
verified by hand — all nine were false positives (short stems like `abel`,
`actor`, `akt` matching unrelated identifiers; `worn_farm_track_modules_6x6`
matching the `_hq_v2` sibling). Config keys that name a texture were followed
into `src/` to confirm a reader exists; three do not — see the
`assets/textures/visual_spike/` table below.

**Provenance evidence.** JPEG/MP3 APP11-JUMBF (C2PA) segments were extracted and
read directly. PNG `tEXt`/`iTXt`/`zTXt` chunks were checked on all 206 PNGs —
**zero** carry any text metadata. WAV `LIST`/`INFO` chunks — **zero**. TrueType
`name` tables (IDs 0, 13, 14) were parsed for all 120 fonts. `git log` was read
for every asset-adding commit.

**What could not be established.**
- **PNG provenance is not readable from the files.** PNGs carry no metadata at
  all, so every PNG claim below is inference from naming, from a byte-identical
  or same-stem C2PA-signed sibling, or from commit context — never from the file
  itself. Tiers are labelled accordingly.
- **The Fontsource subsets strip name ID 13** (licence text), so for 98 of the
  100 fonts the embedded licence *body* is gone. Name ID 14 (licence URL) and
  name ID 0 (copyright) survive and were used instead.
- **None of the 19 WAVs has a stated origin anywhere.** `43342e6`, which added
  18 of them (17 `sfx_*` plus `level_up.wav`), was read in full: it describes
  the feature and never says where the audio came from. `pickup.wav` came from
  `d9a862f`, likewise silent on origin.
- **No asset-generation script exists** in `scripts/` or `tools/`, so nothing
  can be re-derived to prove in-house authorship.

---

## 🔤 Fonts

### Gameplay font — the only font that ships in the running game

| Asset Key | File Path | Author / Source | Verified Commercial License | Monetization | Status | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `UI_FONT_PATH` | `assets/fonts/DejaVuSans.ttf` | DejaVu Fonts project; © 2003 Bitstream Inc., © 2006 Tavmjong Bah | ✅ **Bitstream Vera + Arev terms** (MIT-like), DejaVu's own changes public domain — read from name ID 0/13/14 | ✅ Yes | **REFERENCED** — `configs/ui.yaml:5` | Not on Rule 7's literal allowlist; safe in substance. See spec-gap table. |

### Showcase fonts — `assets/fonts/showcase/` (119 files, dev-only Ctrl+H gallery)

Loaded as a directory scan by `src/render/ComponentShowcaseRenderer.cpp:127`;
no individual file is named in config. None of these ship in gameplay — the
whole directory could be dropped from a release package.

**100 of the 119 are already documented** in
[`assets/fonts/showcase/LICENSES.md`](../assets/fonts/showcase/LICENSES.md),
which is the per-file authority for them and is **not duplicated here** (two
copies of the same fact will diverge). Verification performed against it:

- Coverage: **100 listed / 100 present, 0 listed-but-missing, 19 present-but-unlisted.**
- Independent corroboration from the embedded name table: **96 of 100 confirmed**
  — 94 carry an OFL URL (`scripts.sil.org/OFL` / `openfontlicense.org`),
  `aclonica.ttf` carries the Apache-2.0 URL, `aileron.ttf` declares
  *"No Rights Reserved"* (CC0). `actor.ttf` resolves to OFL via its
  `scripts.sil.org/SIL` URL plus the Reserved Font Name idiom.
- **4 documented-only, not file-verifiable:** `alef.ttf`, `allan.ttf`,
  `anonymous-pro.ttf` (and `actor.ttf` above) have no licence URL in the
  subsetted name table. LICENSES.md records all as OFL-1.1 from Fontsource; that
  is credible (Fontsource repackages Google Fonts unmodified) but rests on the
  source URL, not on the file. ⚠️ **Spot-check against the upstream repos before ship.**

**The 19 files LICENSES.md does not cover** — these are the previously
unexamined surface, so each gets its own row. All were read from the TrueType
`name` table of the file itself.

| Asset Key | File Path | Author / Source | Verified Commercial License | Monetization | Status | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `SHOWCASE_FONT_DEJAVU_SANS` | `assets/fonts/showcase/DejaVuSans-Regular.ttf` | DejaVu project / Bitstream Inc. / Tavmjong Bah | ✅ Bitstream Vera + Arev (MIT-like) | ✅ Yes | Dev gallery only | Byte-identical in size to `assets/fonts/DejaVuSans.ttf` |
| `SHOWCASE_FONT_DEJAVU_SANS_BOLD` | `assets/fonts/showcase/DejaVuSans-Bold.ttf` | DejaVu project / Bitstream Inc. / Tavmjong Bah | ✅ Bitstream Vera + Arev (MIT-like) | ✅ Yes | Dev gallery only | — |
| `SHOWCASE_FONT_DEJAVU_SANS_MONO` | `assets/fonts/showcase/DejaVuSansMono-Regular.ttf` | DejaVu project / Bitstream Inc. | ✅ Bitstream Vera (MIT-like) | ✅ Yes | Dev gallery only | — |
| `SHOWCASE_FONT_DEJAVU_SERIF` | `assets/fonts/showcase/DejaVuSerif-Regular.ttf` | DejaVu project / Bitstream Inc. | ✅ Bitstream Vera (MIT-like) | ✅ Yes | Dev gallery only | — |
| `SHOWCASE_FONT_LATO` | `assets/fonts/showcase/Lato-Regular.ttf` | tyPoland Łukasz Dziedzic, latofonts.com | ✅ **OFL-1.1** (stated in name ID 0) | ✅ Yes | Dev gallery only | RFN "Lato" |
| `SHOWCASE_FONT_LATO_HEAVY` | `assets/fonts/showcase/Lato-Heavy.ttf` | tyPoland Łukasz Dziedzic, latofonts.com | ✅ **OFL-1.1** | ✅ Yes | Dev gallery only | RFN "Lato" |
| `SHOWCASE_FONT_LIBERATION_SANS` | `assets/fonts/showcase/LiberationSans-Regular.ttf` | Red Hat Inc. (2012), digitized data © Google | ✅ **OFL-1.1** (name ID 13/14) | ✅ Yes | Dev gallery only | — |
| `SHOWCASE_FONT_LIBERATION_SERIF` | `assets/fonts/showcase/LiberationSerif-Regular.ttf` | Red Hat Inc. (2012), digitized data © Google | ✅ **OFL-1.1** | ✅ Yes | Dev gallery only | — |
| `SHOWCASE_FONT_LIBERATION_MONO` | `assets/fonts/showcase/LiberationMono-Regular.ttf` | Red Hat Inc. (2012), digitized data © Google | ✅ **OFL-1.1** | ✅ Yes | Dev gallery only | — |
| `SHOWCASE_FONT_LIBERATION_SANS_NARROW` | `assets/fonts/showcase/LiberationSansNarrow-Regular.ttf` | © 2010 Oracle and/or its affiliates | ⛔ **Liberation Fonts License = GPLv2 + font exception** | ⛔ **BLOCKED** | Dev gallery only | **Blocker B2 — delete.** Never relicensed to OFL. |
| `SHOWCASE_FONT_NOTO_SANS` | `assets/fonts/showcase/NotoSans-Regular.ttf` | Google LLC (2015) | ✅ **OFL-1.1** (name ID 13/14) | ✅ Yes | Dev gallery only | — |
| `SHOWCASE_FONT_NOTO_SANS_DISPLAY` | `assets/fonts/showcase/NotoSansDisplay-Regular.ttf` | Google Inc. (2015) | ✅ **OFL-1.1** | ✅ Yes | Dev gallery only | — |
| `SHOWCASE_FONT_NOTO_SANS_MONO` | `assets/fonts/showcase/NotoSansMono-Regular.ttf` | Google LLC (2015) | ✅ **OFL-1.1** | ✅ Yes | Dev gallery only | — |
| `SHOWCASE_FONT_NOTO_MONO` | `assets/fonts/showcase/NotoMono-Regular.ttf` | Google Inc. (2007) | ✅ **OFL-1.1** | ✅ Yes | Dev gallery only | — |
| `SHOWCASE_FONT_ORBITRON` | `assets/fonts/showcase/Orbitron-Regular.ttf` | The Orbitron Project Authors / The League of Moveable Type | ✅ **OFL-1.1** (name ID 13/14) | ✅ Yes | Dev gallery only | RFN "Orbitron". Strong candidate if a display face is ever needed in-game. |
| `SHOWCASE_FONT_UBUNTU` | `assets/fonts/showcase/Ubuntu-Regular.ttf` | Canonical Ltd. (2011–2023) | ⚠️ **Ubuntu Font Licence 1.0** — not on Rule 7's allowlist | ⚠️ Permitted in substance, non-compliant as written | Dev gallery only | See spec-gap table |
| `SHOWCASE_FONT_UBUNTU_MONO` | `assets/fonts/showcase/UbuntuMono-Regular.ttf` | Canonical Ltd. (2011, 2022) | ⚠️ **Ubuntu Font Licence 1.0** | ⚠️ Same | Dev gallery only | See spec-gap table |
| `SHOWCASE_FONT_UBUNTU_SANS` | `assets/fonts/showcase/UbuntuSans-Regular.ttf` | Canonical Ltd. (2011–2023) | ⚠️ **Ubuntu Font Licence 1.0** | ⚠️ Same | Dev gallery only | See spec-gap table |
| `SHOWCASE_FONT_UBUNTU_SANS_MONO` | `assets/fonts/showcase/UbuntuSansMono-Regular.ttf` | Canonical Ltd. (2011–2023) | ⚠️ **Ubuntu Font Licence 1.0** | ⚠️ Same | Dev gallery only | See spec-gap table |

All 19 look like copies of a Linux system font directory (versions and metadata
match distro packaging). That is consistent with their licences but was **not
byte-verified against `/usr/share/fonts`** — recorded as inference.

---

## 🎵 Audio & SFX

### Music — `assets/audio/background/` (2 files)

Both carry a Google-signed C2PA manifest: `c2pa.created` /
*"Created by Google Generative AI."* + `c2pa.edited` /
*"Applied imperceptible SynthID watermark."*, `digitalSourceType =
trainedAlgorithmicMedia`.

| Asset Key | File Path | Author / Source | Verified Commercial License | Monetization | Status | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `BACKGROUND_MUSIC_PATH` | `assets/audio/background/The_Burden_of_Stone.mp3` | **AI-generated — Google Generative AI** (C2PA, SynthID) | ⚠️ **UNVERIFIED** — product/tier and ToS not in the manifest | ⚠️ Pending B3 | **REFERENCED** — `configs/background_music.yaml:2` | Hard in-file provenance |
| — | `assets/audio/background/Iron_Breath.mp3` | **AI-generated — Google Generative AI** (C2PA, SynthID) | ⚠️ **UNVERIFIED** — as above | ⚠️ Pending B3 | **ORPHANED** — no config key | Alternate track; delete or wire up |

### Sound effects — `assets/audio/` (19 WAV, all referenced by `configs/audio.yaml`)

**All 19 carry zero metadata** — no `LIST`/`INFO` chunk, no authoring tool
string. Provenance rests entirely on commit context, and `43342e6` (which added
18 of them) states no origin. Two supporting inferences, labelled as such:
16-bit mono PCM with no metadata at all is characteristic of programmatic
generation rather than a downloaded library file; and the two 22050 Hz files
(`pickup.wav`, `level_up.wav`) sit apart from the 44100 Hz `sfx_*` set, i.e. two
different production passes. The earlier, since-deleted SFX set from `c885071`
*was* explicitly described in its commit as "procedurally-generated placeholder
SFX" — that statement covers the **deleted** files, **not** these.

⚠️ **Every row below is UNVERIFIED. The owner must state how these were made.**

| Asset Key | File Path | Author / Source | Verified Commercial License | Monetization | Status | Added by |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `PICKUP_SOUND_PATH` | `assets/audio/pickup.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `d9a862f` 2026-07-07 |
| `LEVEL_UP_SOUND_PATH` | `assets/audio/level_up.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` 2026-07-08 |
| `SFX_HERO_ATTACK_SINGLE_PATH` | `assets/audio/sfx_hero_attack_single.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` |
| `SFX_HERO_ATTACK_SWIPE_PATH` | `assets/audio/sfx_hero_attack_swipe.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` |
| `SFX_HERO_ATTACK_MULTITARGET_PATH` | `assets/audio/sfx_hero_attack_multitarget.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` |
| `SFX_HERO_ATTACK_MULTISINGLE_PATH` | `assets/audio/sfx_hero_attack_multisingle.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` |
| `SFX_HERO_ATTACK_AOE_PATH` | `assets/audio/sfx_hero_attack_aoe.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` |
| `SFX_HERO_DASH_PATH` | `assets/audio/sfx_hero_dash.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` |
| `SFX_HERO_DEATH_PATH` | `assets/audio/sfx_hero_death.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` |
| `SFX_ENEMY_ATTACK_SINGLE_PATH` | `assets/audio/sfx_enemy_attack_single.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` |
| `SFX_ENEMY_ATTACK_SWIPE_PATH` | `assets/audio/sfx_enemy_attack_swipe.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` |
| `SFX_ENEMY_ATTACK_MULTITARGET_PATH` | `assets/audio/sfx_enemy_attack_multitarget.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` |
| `SFX_ENEMY_ATTACK_MULTISINGLE_PATH` | `assets/audio/sfx_enemy_attack_multisingle.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` |
| `SFX_ENEMY_ATTACK_AOE_PATH` | `assets/audio/sfx_enemy_attack_aoe.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` |
| `SFX_ENEMY_UNARMED_DASH_PATH` | `assets/audio/sfx_enemy_unarmed_dash.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` |
| `SFX_ENEMY_JUMP_PATH` | `assets/audio/sfx_enemy_jump.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` |
| `SFX_ENEMY_DEATH_PATH` | `assets/audio/sfx_enemy_death.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` |
| `SFX_PORTAL_OPEN_PATH` | `assets/audio/sfx_portal_open.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` |
| `SFX_PORTAL_CLOSE_PATH` | `assets/audio/sfx_portal_close.wav` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED | `43342e6` |

---

## 🧊 3D source

| Asset Key | File Path | Author / Source | Verified Commercial License | Monetization | Status | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| — | `assets/blend/humain.blend` | **Adobe Mixamo** rig + animation clips (`mixamorig1:` armature; clip names `Dying`, `Injured Jog`, `Injured Run`, `Jump Attack`, `Running`, `Sad Idle`, `Standing React Small From Back`, all with `(In Place)` variants). Blender 4.0 file. Also references two hash-named `*_500x500.jpg` textures **absent from the repo**. | ⛔ **Mixamo terms — not on the Rule 7 allowlist; standalone redistribution prohibited** | ⛔ **BLOCKED** | **ORPHANED** (40.5 MB) | **Blocker B1 — delete.** |

`assets/renders/` exists but is **empty** — no files to audit.

---

## 🖼️ Textures named in live config (39 files — 36 loaded, 3 dead keys)

These 39 are the only textures any config file names. 36 of them have a reader
in `src/` and load at runtime; 3 are dead config keys whose PNGs are
effectively orphaned (see the `visual_spike` table). All 39 are packaged with
the build.

### Correction to a standing assumption

The claim that "the world layer is fully code-drawn and loads no texture art" is
**only half true**. Hero and enemy art *is* fully code-drawn — all 6 files in
`assets/textures/enemies/` are orphaned, confirming it. But **the world ground
is not**: 22 ground textures load at runtime through
`WORLD_ENVIRONMENT_MATERIAL_CATALOG` (`configs/world_editor.yaml:12`) into
`src/render/WorldEnvironmentRenderer.cpp:1103`. Do not treat
`assets/textures/world/ground/` as bulk-deletable.

### `assets/textures/weapons/` — 10 files, all live

Loaded via `WEAPON_SPRITE_*` (`configs/weapon.yaml:399-408`) →
`src/render/WeaponSprite.cpp:22-26`.
**Provenance tier: STRONGLY INFERRED — AI-generated.** Each is
**byte-identical** (md5-verified) to its `*_v3_*` counterpart in
`assets/textures/items/combat/`, which carries the ms-epoch naming of the
C2PA-signed generation batch.

| Asset Key | File Path | Author / Source | Verified Commercial License | Monetization | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `WEAPON_SPRITE_PITCHFORK` | `assets/textures/weapons/pitchfork.png` | AI-generated (inferred; = `combat_item_pitchfork_v3_1783801740589.png`) | ⚠️ UNVERIFIED — pending B3 | ⚠️ Pending | REFERENCED |
| `WEAPON_SPRITE_LONG_SWORD` | `assets/textures/weapons/long_sword.png` | AI-generated (inferred; = `combat_item_long_sword_v3_1783801778471.png`) | ⚠️ UNVERIFIED | ⚠️ Pending | REFERENCED |
| `WEAPON_SPRITE_GREAT_SWORD` | `assets/textures/weapons/great_sword.png` | AI-generated (inferred; = `combat_item_great_sword_v3_1783801817807.png`) | ⚠️ UNVERIFIED | ⚠️ Pending | REFERENCED |
| `WEAPON_SPRITE_HALBERD` | `assets/textures/weapons/halberd.png` | AI-generated (inferred; = `combat_item_halberd_v3_1783801894815.png`) | ⚠️ UNVERIFIED | ⚠️ Pending | REFERENCED |
| `WEAPON_SPRITE_QUARTERSTAFF` | `assets/textures/weapons/quarterstaff.png` | AI-generated (inferred; = `combat_item_quarterstaff_v3_1783801922691.png`) | ⚠️ UNVERIFIED | ⚠️ Pending | REFERENCED |
| `WEAPON_SPRITE_KNIVES` | `assets/textures/weapons/knives.png` | AI-generated (inferred; = `combat_item_knives_v3_1783801970699.png`) | ⚠️ UNVERIFIED | ⚠️ Pending | REFERENCED |
| `WEAPON_SPRITE_DAGGER` | `assets/textures/weapons/dagger.png` | AI-generated (inferred; = `combat_item_dagger_v3_1783802237046.png`) | ⚠️ UNVERIFIED | ⚠️ Pending | REFERENCED |
| `WEAPON_SPRITE_MACE` | `assets/textures/weapons/mace.png` | AI-generated (inferred; = `combat_item_mace_v3_1783802077923.png`) | ⚠️ UNVERIFIED | ⚠️ Pending | REFERENCED |
| `WEAPON_SPRITE_WARHAMMER` | `assets/textures/weapons/warhammer.png` | AI-generated (inferred; = `combat_item_warhammer_v3_1783802107391.png`) | ⚠️ UNVERIFIED | ⚠️ Pending | REFERENCED |
| `WEAPON_SPRITE_BIG_AXE` | `assets/textures/weapons/big_axe.png` | AI-generated (inferred; = `combat_item_big_axe_v3_1783831561166.png`) | ⚠️ UNVERIFIED | ⚠️ Pending | REFERENCED |

### `assets/textures/world/ground/` — 22 files, all live

Loaded via `WORLD_ENVIRONMENT_MATERIAL_CATALOG` / `WORLD_EDITOR_DEFAULT_PATH_ATLAS_ASSET`
(`configs/world_editor.yaml:12,18`) → `WorldEnvironmentRenderer.cpp:1103`,
`WorldEditor.cpp`, `src/core/WorldEnvironment.cpp:188`.
**Provenance tier: UNVERIFIED.** These carry no metadata and no ms-epoch naming
link to a signed sibling. They are the same project era and plausibly the same
workflow as the AI batches, but **nothing in the files says so.**

| Asset Key | File Path | Author / Source | Verified Commercial License | Monetization | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `…MATERIAL_CATALOG` "Farm track" | `assets/textures/world/ground/worn_farm_track.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Farm transition" | `assets/textures/world/ground/farm_transition_ground.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Portuguese stone" | `assets/textures/world/ground/portuguese_stone_path.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `WORLD_EDITOR_DEFAULT_PATH_ATLAS_ASSET` | `assets/textures/world/ground/worn_farm_track_modules_6x6_hq_v2.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Bloodmoor clay" | `assets/textures/world/ground/path_ground_bloodmoor_clay.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Bloodmoor clay" atlas | `assets/textures/world/ground/path_atlas_bloodmoor_clay_6x6.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Drowned boardwalk" | `assets/textures/world/ground/path_ground_drowned_boardwalk.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Drowned boardwalk" atlas | `assets/textures/world/ground/path_atlas_drowned_boardwalk_6x6.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Dune sandstone" | `assets/textures/world/ground/path_ground_dune_sandstone.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Dune sandstone" atlas | `assets/textures/world/ground/path_atlas_dune_sandstone_6x6.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Ember crust" | `assets/textures/world/ground/path_ground_ember_crust.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Ember crust" atlas | `assets/textures/world/ground/path_atlas_ember_crust_6x6.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Frostbound slate" | `assets/textures/world/ground/path_ground_frostbound_slate.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Frostbound slate" atlas | `assets/textures/world/ground/path_atlas_frostbound_slate_6x6.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Mossbound ruins" | `assets/textures/world/ground/path_ground_mossbound_ruins.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Mossbound ruins" atlas | `assets/textures/world/ground/path_atlas_mossbound_ruins_6x6.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Obsidian causeway" | `assets/textures/world/ground/path_ground_obsidian_causeway.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Obsidian causeway" atlas | `assets/textures/world/ground/path_atlas_obsidian_causeway_6x6.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Scrapmetal serviceway" | `assets/textures/world/ground/path_ground_scrapmetal_serviceway.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Scrapmetal serviceway" atlas | `assets/textures/world/ground/path_atlas_scrapmetal_serviceway_6x6.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Void chitin" | `assets/textures/world/ground/path_ground_void_chitin.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |
| `…MATERIAL_CATALOG` "Void chitin" atlas | `assets/textures/world/ground/path_atlas_void_chitin_6x6.png` | ❓ **UNVERIFIED** | ❓ UNVERIFIED | ⛔ BLOCKED | REFERENCED |

### `assets/textures/visual_spike/` — 7 files named in config, only 4 actually loaded

| Asset Key | File Path | Author / Source | Verified Commercial License | Monetization | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `VISUAL_SPIKE_HUD_FRAME_TEXTURE` | `assets/textures/visual_spike/ui_bottom_hud_health_left_vital.png` | AI-generated (inferred, no metadata) | ⚠️ UNVERIFIED — pending B3 | ⚠️ Pending | **REFERENCED** — `WeaponSlotSidebar.cpp` |
| `INVENTORY_COCKPIT_TEXTURE` | `assets/textures/visual_spike/ui_inventory_cockpit_top_controls.png` | AI-generated (inferred, no metadata) | ⚠️ UNVERIFIED — pending B3 | ⚠️ Pending | **REFERENCED** — `InventoryRenderer.cpp` |
| `VISUAL_SPIKE_VITAL_TANK_EMPTY_TEXTURE` | `assets/textures/visual_spike/vital_tank_empty.png` | ❓ UNVERIFIED — at 11 KB this reads as hand-authored or programmatic, **not** generated art | ❓ UNVERIFIED | ⛔ BLOCKED | **REFERENCED** — `WeaponSlotSidebar.cpp` |
| `VISUAL_SPIKE_VITAL_TANK_FLUID_TEXTURE` | `assets/textures/visual_spike/vital_tank_fluid.png` | ❓ UNVERIFIED — 20 KB, same reasoning | ❓ UNVERIFIED | ⛔ BLOCKED | **REFERENCED** — `WeaponSlotSidebar.cpp` |
| `VISUAL_SPIKE_UI_PANEL_FRAME_TEXTURE` | `assets/textures/visual_spike/ui_panel_frame.png` | AI-generated (inferred) | ⚠️ UNVERIFIED | ⚠️ Pending | ⚠️ **DEAD KEY** — no reader in `src/`; effectively orphaned |
| `VISUAL_SPIKE_BASIC_ENEMY_TEXTURE` | `assets/textures/visual_spike/basic_enemy.png` | AI-generated (inferred) | ⚠️ UNVERIFIED | ⚠️ Pending | ⚠️ **DEAD KEY** — no reader; superseded by the code-drawn enemy |
| `VISUAL_SPIKE_HERO_MOVEMENT_TEXTURE` | `assets/textures/visual_spike/hero_movement_sheet.png` | AI-generated (inferred) | ⚠️ UNVERIFIED | ⚠️ Pending | ⚠️ **DEAD KEY** — no reader; superseded by the code-drawn hero |

The three dead keys are also a **config-hygiene defect** (`configs/visual_spike.yaml`
declares values nothing consumes). Not fixed here — this document's write scope is
`docs/ASSETS.md` only.

---

## 🗑️ Orphaned assets — 202 files, ~240 MB, deletable

None of these is referenced by name in `src/` or in any live `configs/` file.
Deleting them breaks no gameplay path, no config key and no test; the only
visible effect is that they disappear from the dev-only WorldEditor gallery.

They are still **distributed**: `CMakeLists.txt:129-131` symlinks the entire
`assets/` tree into the build directory, so an unaudited orphan reaches any
package built from it. Unreferenced is not the same as unshipped.

### Provenance tiers

The three grades are **disjoint** and sum to 202. A file graded EVIDENCED is
never also counted as inferred.

| Tier | What backs it | Applies to |
| :--- | :--- | :--- |
| **EVIDENCED** | In-file C2PA manifest signed by Google C2PA Media Services. **All 33 JPGs and both MP3s** carry `c2pa.created` / *"Created by Google Generative AI."*, `c2pa.edited` / *"Applied imperceptible SynthID watermark."*, `digitalSourceType = trainedAlgorithmicMedia`. Two JPGs (`world_floor_toxic_grate_1783614282675.jpg`, `world_floor_laser_tiles_1783614473572.jpg`) additionally carry a `c2pa.opened` ingredient (`c2pa.ingredient.v3`) whose `softwareAgent` is **`gpt-image` v2.0** — so a second, non-Google generator is named somewhere in their chain. **Whether gpt-image produced the final image or only an ingredient is genuinely ambiguous; exact attribution UNVERIFIED.** | **34 orphans** — all 33 JPGs + `Iron_Breath.mp3`. (The 35th evidenced file, `The_Burden_of_Stone.mp3`, is referenced and listed in the music table.) |
| **STRONGLY INFERRED** | 13-digit ms-epoch filename suffix shared with a C2PA-signed sibling from the same batch, or direct byte-level derivation from one. | **81 orphans**, all PNG — all of `dices/` (39), all of `items/combat/` (39), the 3 `enemies/*_spritesheet.png` (derived from the C2PA'd JPG of the identical stem). No JPG appears here: every JPG is EVIDENCED above. |
| **UNVERIFIED** | No metadata, no naming link, no commit statement. Same project era, plausibly the same workflow — **nothing in the file says so.** | **87 orphans** — `world/ground/` (22 PNG), `world/environments/` (18), `world/structures/` (13 PNG), `visual_spike/` (10), `world/props/` (9 PNG), `world/nature/` (6 PNG), `world/monuments/` (5 PNG), `ui/` (2 PNG), `world/transparent/` (1), `blend/` (1) |

### By directory

| Directory | Files | Size | Provenance split | Commercial License | Monetization | Notes |
| :--- | ---: | ---: | :--- | :--- | :--- | :--- |
| `assets/textures/world/ground/` | 32 | 41.2 MB | 10 EVIDENCED (JPG) / 22 UNVERIFIED (PNG) | ⚠️ / ❓ | ⚠️ Pending B3 / ⛔ BLOCKED | Superseded atlas/road/river variants (`*_v1..v4`, `* copy`, `*_source`). The 22 **live** ground textures are listed above and are **not** in this list. |
| `assets/blend/` | 1 | 40.5 MB | UNVERIFIED | ⛔ Mixamo terms | ⛔ **BLOCKED** | **Blocker B1** — delete. |
| `assets/textures/dices/` | 39 | 33.8 MB | 39 STRONGLY INFERRED | ⚠️ UNVERIFIED | ⚠️ Pending B3 | All ms-epoch named; `v1..v4` iterations of 10 die shapes. No dice art loads — dice render from code. |
| `assets/textures/world/environments/` (9 biome dirs) | 18 | 31.4 MB | 18 UNVERIFIED | ❓ UNVERIFIED | ⛔ BLOCKED | Added `5a71ac2` 2026-08-06; never wired to a config key. |
| `assets/textures/visual_spike/` | 10 | 19.0 MB | 10 UNVERIFIED | ❓ UNVERIFIED | ⛔ BLOCKED | `hero_uv_map*` (7 files, 14 MB) are the UV bakes for the retired 3D hero pipeline — see B1; plus `world_floor.png`, `ui_bottom_hud_frame_wide.png`, `ui_bottom_hud_health_left.png`. |
| `assets/textures/items/combat/` | 39 | 18.3 MB | 39 STRONGLY INFERRED | ⚠️ UNVERIFIED | ⚠️ Pending B3 | **Provably safe to delete:** 10 of the 39 are the `*_v3_*` files byte-identical to the 10 live `weapons/*.png`; the other 29 are `v1`/`v2` iterations. No shipping art is lost. |
| `assets/textures/world/structures/` | 16 | 17.5 MB | 3 EVIDENCED (JPG) / 13 UNVERIFIED (PNG) | ⚠️ / ❓ | ⚠️ Pending B3 / ⛔ BLOCKED | Village buildings (intact/burning/burned sets), bridge, stepping stones. |
| `assets/textures/world/props/` | 12 | 11.8 MB | 3 EVIDENCED (JPG) / 9 UNVERIFIED (PNG) | ⚠️ / ❓ | ⚠️ Pending B3 / ⛔ BLOCKED | Signpost atlases `v1..v4`, fences, cart, scarecrow, chest. |
| `assets/textures/world/monuments/` | 11 | 8.5 MB | 6 EVIDENCED (JPG) / 5 UNVERIFIED (PNG) | ⚠️ / ❓ | ⚠️ Pending B3 / ⛔ BLOCKED | Shrine, spire, altar, archway, landmark atlas. |
| `assets/textures/world/nature/` | 9 | 8.2 MB | 3 EVIDENCED (JPG) / 6 UNVERIFIED (PNG) | ⚠️ / ❓ | ⚠️ Pending B3 / ⛔ BLOCKED | Trees, crops, fungus, reeds. |
| `assets/textures/enemies/` | 6 | 3.6 MB | 3 EVIDENCED (JPG) / 3 STRONGLY INFERRED (their spritesheets) | ⚠️ UNVERIFIED | ⚠️ Pending B3 | **Confirms the enemy layer is fully code-drawn.** |
| `assets/textures/ui/` | 4 | 2.1 MB | 2 EVIDENCED (JPG) / 2 UNVERIFIED (PNG) | ⚠️ / ❓ | ⚠️ Pending B3 / ⛔ BLOCKED | `ui_healthbar.png`, `ui_xpbar.png` are the unverified pair. |
| `assets/textures/items/world/` | 3 | 1.8 MB | 3 EVIDENCED | ⚠️ UNVERIFIED | ⚠️ Pending B3 | Keycard, power cell, hack terminal. |
| `assets/textures/world/transparent/` | 1 | 1.3 MB | 1 UNVERIFIED | ❓ UNVERIFIED | ⛔ BLOCKED | `village_house_intact.png` — alpha variant of the structures file. |
| `assets/audio/background/` | 1 | 0.7 MB | 1 EVIDENCED | ⚠️ UNVERIFIED | ⚠️ Pending B3 | `Iron_Breath.mp3` — see music table. |
| **Total** | **202** | **~240 MB** | 34 / 81 / 87 | — | — | — |

Legend: ⚠️ = AI-generated, licence turns on the Blocker B3 answer. ❓ = origin
not established at all. ⛔ = must not ship as it stands.

### Deletion list

All 202 orphans, verbatim, ready to pipe. Nothing here is loaded by the game.
`LiberationSansNarrow-Regular.ttf` is deliberately **not** in this list — it is
directory-scan referenced, not orphaned; delete it separately per Blocker B2.

```
assets/audio/background/Iron_Breath.mp3
assets/blend/humain.blend
assets/textures/dices/dices_holographic_d20_v2_1783791098584.png
assets/textures/dices/dices_holographic_d20_v3_1783831966663.png
assets/textures/dices/dices_holographic_d20_v4_1783873474758.png
assets/textures/dices/dices_neon_d100_1783754980000.png
assets/textures/dices/dices_neon_d100_v2_1783791309526.png
assets/textures/dices/dices_neon_d100_v3_1783832366120.png
assets/textures/dices/dices_neon_d100_v4_1783873908379.png
assets/textures/dices/dices_neon_d12_1783754844376.png
assets/textures/dices/dices_neon_d12_v2_1783777863389.png
assets/textures/dices/dices_neon_d12_v3_1783831908918.png
assets/textures/dices/dices_neon_d12_v4_1783873433543.png
assets/textures/dices/dices_neon_d24_1783754870262.png
assets/textures/dices/dices_neon_d24_v2_1783791135225.png
assets/textures/dices/dices_neon_d24_v3_1783832047444.png
assets/textures/dices/dices_neon_d24_v4_1783873544660.png
assets/textures/dices/dices_neon_d30_1783754898306.png
assets/textures/dices/dices_neon_d30_v2_1783791175692.png
assets/textures/dices/dices_neon_d30_v3_1783832132617.png
assets/textures/dices/dices_neon_d30_v4_1783873579721.png
assets/textures/dices/dices_neon_d4_1783754791210.png
assets/textures/dices/dices_neon_d42_1783754930165.png
assets/textures/dices/dices_neon_d42_v2_1783791220022.png
assets/textures/dices/dices_neon_d42_v3_1783832213381.png
assets/textures/dices/dices_neon_d42_v4_1783873647497.png
assets/textures/dices/dices_neon_d4_v2_1783774264251.png
assets/textures/dices/dices_neon_d4_v3_1783831715887.png
assets/textures/dices/dices_neon_d4_v4_1783832809007.png
assets/textures/dices/dices_neon_d60_1783754960064.png
assets/textures/dices/dices_neon_d60_v2_1783791266292.png
assets/textures/dices/dices_neon_d60_v3_1783832294883.png
assets/textures/dices/dices_neon_d60_v4_1783873772290.png
assets/textures/dices/dices_neon_d6_1783614186402.png
assets/textures/dices/dices_neon_d6_v2_1783774416093.png
assets/textures/dices/dices_neon_d6_v3_1783831774586.png
assets/textures/dices/dices_neon_d6_v4_1783832878652.png
assets/textures/dices/dices_neon_d8_1783754817973.png
assets/textures/dices/dices_neon_d8_v2_1783777706698.png
assets/textures/dices/dices_neon_d8_v3_1783831839571.png
assets/textures/dices/dices_neon_d8_v4_1783832960029.png
assets/textures/enemies/enemy_cyborg_spider_1783614338402.jpg
assets/textures/enemies/enemy_cyborg_spider_1783614338402_spritesheet.png
assets/textures/enemies/enemy_robotic_drone_1783614117060.jpg
assets/textures/enemies/enemy_robotic_drone_1783614117060_spritesheet.png
assets/textures/enemies/enemy_security_cyborg_1783614568529.jpg
assets/textures/enemies/enemy_security_cyborg_1783614568529_spritesheet.png
assets/textures/items/combat/combat_item_big_axe_1783754733057.png
assets/textures/items/combat/combat_item_big_axe_v2_1783773948499.png
assets/textures/items/combat/combat_item_big_axe_v3_1783831561166.png
assets/textures/items/combat/combat_item_dagger_1783754672485.png
assets/textures/items/combat/combat_item_dagger_v2_1783773465228.png
assets/textures/items/combat/combat_item_dagger_v3_1783802237046.png
assets/textures/items/combat/combat_item_great_sword_1783754601979.png
assets/textures/items/combat/combat_item_great_sword_v2_1783772986907.png
assets/textures/items/combat/combat_item_great_sword_v3_1783801817807.png
assets/textures/items/combat/combat_item_halberd_1783754621728.png
assets/textures/items/combat/combat_item_halberd_v2_1783773152166.png
assets/textures/items/combat/combat_item_halberd_v3_1783801894815.png
assets/textures/items/combat/combat_item_knives_1783754656947.png
assets/textures/items/combat/combat_item_knives_v2_1783773364519.png
assets/textures/items/combat/combat_item_knives_v3_1783801970699.png
assets/textures/items/combat/combat_item_laser_cannon_1783614317222.png
assets/textures/items/combat/combat_item_laser_cannon_v2_1783772691521.png
assets/textures/items/combat/combat_item_laser_cannon_v3_1783831586828.png
assets/textures/items/combat/combat_item_long_sword_1783754584217.png
assets/textures/items/combat/combat_item_long_sword_v2_1783772901702.png
assets/textures/items/combat/combat_item_long_sword_v3_1783801778471.png
assets/textures/items/combat/combat_item_mace_1783754692381.png
assets/textures/items/combat/combat_item_mace_v2_1783773688449.png
assets/textures/items/combat/combat_item_mace_v3_1783802077923.png
assets/textures/items/combat/combat_item_nanogrenade_1783614533032.png
assets/textures/items/combat/combat_item_nanogrenade_v2_1783772757412.png
assets/textures/items/combat/combat_item_nanogrenade_v3_1783831627408.png
assets/textures/items/combat/combat_item_pitchfork_1783754758632.png
assets/textures/items/combat/combat_item_pitchfork_v2_1783772855475.png
assets/textures/items/combat/combat_item_pitchfork_v3_1783801740589.png
assets/textures/items/combat/combat_item_plasma_blade_1783614088861.png
assets/textures/items/combat/combat_item_plasma_blade_v2_1783772811737.png
assets/textures/items/combat/combat_item_plasma_blade_v3_1783831659349.png
assets/textures/items/combat/combat_item_quarterstaff_1783754638521.png
assets/textures/items/combat/combat_item_quarterstaff_v2_1783773266318.png
assets/textures/items/combat/combat_item_quarterstaff_v3_1783801922691.png
assets/textures/items/combat/combat_item_warhammer_1783754710195.png
assets/textures/items/combat/combat_item_warhammer_v2_1783773814377.png
assets/textures/items/combat/combat_item_warhammer_v3_1783802107391.png
assets/textures/items/world/world_item_hack_terminal_1783614603308.jpg
assets/textures/items/world/world_item_keycard_1783614360346.jpg
assets/textures/items/world/world_item_power_cell_1783614146527.jpg
assets/textures/ui/ui_health_bar_1783614239758.jpg
assets/textures/ui/ui_healthbar.png
assets/textures/ui/ui_mini_map_1783614439858.jpg
assets/textures/ui/ui_xpbar.png
assets/textures/visual_spike/hero_uv_map_dark_medieval_cyberpunk_armor.png
assets/textures/visual_spike/hero_uv_map_dark_medieval_cyberpunk_enemy_naked.png
assets/textures/visual_spike/hero_uv_map_dark_medieval_cyberpunk_enemy.png
assets/textures/visual_spike/hero_uv_map_dark_medieval_cyberpunk_mask.png
assets/textures/visual_spike/hero_uv_map_dark_medieval_cyberpunk.png
assets/textures/visual_spike/hero_uv_map_dark_medieval_cyberpunk_recolor.png
assets/textures/visual_spike/hero_uv_map.png
assets/textures/visual_spike/ui_bottom_hud_frame_wide.png
assets/textures/visual_spike/ui_bottom_hud_health_left.png
assets/textures/visual_spike/world_floor.png
assets/textures/world/environments/bloodmoor_clay/peatstone_scar_ridge.png
assets/textures/world/environments/bloodmoor_clay/sealed_peat_shrine.png
assets/textures/world/environments/drowned_boardwalk/drowned_basalt_islet_ridge.png
assets/textures/world/environments/drowned_boardwalk/sealed_floodgate_pumphouse.png
assets/textures/world/environments/dune_sandstone/sealed_caravan_reliquary.png
assets/textures/world/environments/dune_sandstone/windcarved_mesa_ridge.png
assets/textures/world/environments/ember_crust/broken_caldera_ridge.png
assets/textures/world/environments/ember_crust/sealed_forge_sanctuary.png
assets/textures/world/environments/frostbound_slate/frozen_slate_mountain_spur.png
assets/textures/world/environments/frostbound_slate/sealed_watch_lodge.png
assets/textures/world/environments/mossbound_ruins/mossy_ruin_cliff_ridge.png
assets/textures/world/environments/mossbound_ruins/sealed_reliquary_chapel.png
assets/textures/world/environments/obsidian_causeway/obsidian_blade_ridge.png
assets/textures/world/environments/obsidian_causeway/sealed_monolith_bastion.png
assets/textures/world/environments/scrapmetal_serviceway/scrap_slag_ridge.png
assets/textures/world/environments/scrapmetal_serviceway/sealed_salvage_depot.png
assets/textures/world/environments/void_chitin/sealed_hive_reliquary.png
assets/textures/world/environments/void_chitin/void_chitin_spire_ridge.png
assets/textures/world/ground/bioluminescent_water_texture.png
assets/textures/world/ground/burned_earth_ground.png
assets/textures/world/ground/dark_cobblestone_floor.png
assets/textures/world/ground/lake_river_borders_set.png
assets/textures/world/ground/lake_shore_inner_corner.jpg
assets/textures/world/ground/lake_shore_outer_corner.jpg
assets/textures/world/ground/lake_shore_straight_piece.jpg
assets/textures/world/ground/modular_farm_fields_atlas.png
assets/textures/world/ground/modular_river_bank_atlas.png
assets/textures/world/ground/modular_roads_atlas.png
assets/textures/world/ground/modular_roads_atlas_v1.png
assets/textures/world/ground/modular_roads_atlas_v2.png
assets/textures/world/ground/modular_roads_atlas_v3.png
assets/textures/world/ground/modular_roads_atlas_v4.png
assets/textures/world/ground/opening_region_farm_ground.png
assets/textures/world/ground/opening_region_farm_ground_source.png
assets/textures/world/ground/plowed_furrow_field_patch.jpg
assets/textures/world/ground/river_corner_bank_border.jpg
assets/textures/world/ground/river_fork_delta_border.jpg
assets/textures/world/ground/river_meander_module.png
assets/textures/world/ground/river_straight_bank_border.jpg
assets/textures/world/ground/scorched_ash_ground_texture.png
assets/textures/world/ground/shattered_furrow_open.png
assets/textures/world/ground/shroudwater_flooded_texture.png
assets/textures/world/ground/shroudwater_lake.png
assets/textures/world/ground/waterfall_cliff_atlas.png
assets/textures/world/ground/wheat_crop_field_patch.jpg
assets/textures/world/ground/world_floor_laser_tiles_1783614473572.jpg
assets/textures/world/ground/world_floor_toxic_grate_1783614282675.jpg
assets/textures/world/ground/worn_farm_track_modules_6x6 copy.png
assets/textures/world/ground/worn_farm_track_modules_6x6_hq.png
assets/textures/world/ground/worn_farm_track_modules_6x6.png
assets/textures/world/monuments/ancient_stone_shrine_ruin.png
assets/textures/world/monuments/corrupted_crystal_spire.png
assets/textures/world/monuments/corrupted_plasma_barrier_1784483165708.jpg
assets/textures/world/monuments/corrupted_sacrificial_altar.png
assets/textures/world/monuments/dark_portal_arch_1784483308677.jpg
assets/textures/world/monuments/environment_landmarks_atlas.png
assets/textures/world/monuments/ethereal_soul_beacon_1784483185470.jpg
assets/textures/world/monuments/holographic_waystone_1784483262199.jpg
assets/textures/world/monuments/neon_runic_obelisk_1784483123556.jpg
assets/textures/world/monuments/ruined_cyber_statue_1784483234227.jpg
assets/textures/world/monuments/ruined_stone_archway.png
assets/textures/world/nature/ancient_oak_tree.png
assets/textures/world/nature/bioluminescent_fungus_cluster_1784483149244.jpg
assets/textures/world/nature/corrupted_plants_cluster.png
assets/textures/world/nature/dead_neon_tree.png
assets/textures/world/nature/dead_tree_grounded.png
assets/textures/world/nature/farm_field_crops_elements.png
assets/textures/world/nature/glowing_crystal_vein_1784483214140.jpg
assets/textures/world/nature/pumpkin_crop_field_patch.jpg
assets/textures/world/nature/shroudwater_reed_cluster.png
assets/textures/world/props/blank_signposts_atlas.png
assets/textures/world/props/blank_signposts_atlas_v1.png
assets/textures/world/props/blank_signposts_atlas_v2.png
assets/textures/world/props/blank_signposts_atlas_v3.png
assets/textures/world/props/blank_signposts_atlas_v4.png
assets/textures/world/props/crossroads_signs_blank.png
assets/textures/world/props/cyber_ancient_chest_1784483135447.jpg
assets/textures/world/props/fence_segment.png
assets/textures/world/props/field_fences_gates_atlas.png
assets/textures/world/props/hay_bale_stack_field_prop.jpg
assets/textures/world/props/ruined_wooden_cart.png
assets/textures/world/props/wooden_scarecrow_field_prop.jpg
assets/textures/world/structures/bioluminescent_waterfall_edge.jpg
assets/textures/world/structures/decayed_power_generator_1784483284442.jpg
assets/textures/world/structures/farmhouse.png
assets/textures/world/structures/mossy_river_stepping_stones.jpg
assets/textures/world/structures/stone_river_bridge.png
assets/textures/world/structures/village_blacksmith_burned.png
assets/textures/world/structures/village_blacksmith_intact.png
assets/textures/world/structures/village_house_burned.png
assets/textures/world/structures/village_house_burning.png
assets/textures/world/structures/village_house_intact.png
assets/textures/world/structures/village_stone_well.png
assets/textures/world/structures/village_watchtower_burned.png
assets/textures/world/structures/village_watchtower_intact.png
assets/textures/world/structures/village_windmill_burned.png
assets/textures/world/structures/village_windmill_burning.png
assets/textures/world/structures/village_windmill_intact.png
assets/textures/world/transparent/village_house_intact.png
```

---

## 📝 Non-binary assets (in-house, not part of the 381)

Text assets authored in this repository, no third-party content, no licence
question. Listed for completeness because Rule 9 registers "every asset".

| Path | Files | Origin | Status |
| :--- | ---: | :--- | :--- |
| `assets/shaders/*.frag`, `assets/shaders/effects/*.frag` | 16 | In-house GLSL, authored per commit history | REFERENCED — `GameSession_Setup.cpp:195` |
| `assets/names/*.names` | 16 | In-house word lists (dice + weapon naming) | REFERENCED — `NAMES_ASSET_DIRECTORY` (`configs/names.yaml:5`) |
| `assets/help.md` | 1 | In-house controls documentation | REFERENCED — `HelpOverlay.cpp:102` |

---

## 📦 Third-Party Code Dependencies

| Dependency | Version | License | Commercial | Notes |
| :--- | :--- | :--- | :--- | :--- |
| SFML | 3.x | **Zlib/png** | ✅ Yes | Permissive; static linking is fine |
| doctest | 2.x | **MIT** | ✅ Yes | Header-only test framework |

---

## ✅ Remediation checklist

Ordered cheapest-first. The first three steps cost nothing and remove the two
hard blockers plus 240 MB of unaudited surface.

1. **Delete `assets/blend/humain.blend`** — clears Blocker B1, the highest-risk
   single file. Orphaned, 40.5 MB.
2. **Delete `assets/fonts/showcase/LiberationSansNarrow-Regular.ttf`** — clears
   Blocker B2 (GPLv2-family). Dev gallery only.
3. **Delete the 202 orphans** in the list above. Nothing loads them. This drops
   the assets needing provenance from 381 to 179, and the image/music files
   needing an AI-rights answer from 241 to 40 (39 textures + 1 music track).
4. **Owner statement on the AI generator ToS** (Blocker B3) — which Google
   product and plan produced the images and music, and whether its terms grant
   commercial use. Record the answer in the tables above. Note separately that
   purely AI-generated output carries no registrable copyright.
5. **Owner statement on the 19 SFX WAVs** — how they were produced. Nothing in
   the repository records it. If they cannot be accounted for, regenerate them:
   they are short one-shots and cheap to replace.
6. **Add OFL-1.1, Ubuntu Font Licence 1.0 and the Bitstream Vera/DejaVu terms to
   Rule 7's allowlist** (or delete the Ubuntu faces). ~110 of 120 fonts are
   OFL-1.1; `assets/fonts/DejaVuSans.ttf` ships in gameplay and cannot be
   resolved by deletion.
7. **Spot-check `alef.ttf`, `allan.ttf`, `anonymous-pro.ttf`, `actor.ttf`**
   against their upstream repositories — the only four fonts whose licence rests
   on `LICENSES.md` alone, because Fontsource's subsetting strips name ID 13.
8. **Remove the three dead `VISUAL_SPIKE_*` config keys** and their PNGs
   (`ui_panel_frame.png`, `basic_enemy.png`, `hero_movement_sheet.png`) — config
   hygiene, and three fewer assets to audit.
9. **Re-run this audit before each release** — the reference split is what makes
   it tractable, and it drifts every time art is added.

---

## Audit procedure (for new assets)

For each asset: identify origin (in-house, purchased, CC0 library, AI-generated),
record the source URL and licence text, confirm commercial + monetization rights,
then fill the row. **If provenance cannot be established, the asset is deleted or
replaced — it is never shipped on hope.**

AI-generated assets: record the tool **and its terms of service**, and the
product/tier used — the C2PA manifest names the generator but not the plan, and
the plan is what determines commercial rights. Some generators grant full
commercial rights; some do not; some are unsettled in law. Record what is
actually true rather than assuming.

**Do not add a binary asset without adding its row in the same commit** (Rule 9).
