#pragma once

// card-mpmzs1j5 — click-to-expand drawer for the Enemies debug tab.
// Each enemy in the per-entity list paints as one "row" with zebra
// banding; clicking that row toggles an animated drawer underneath
// that surfaces the enemy's full ability state (chase / attack range,
// timers, etc) the summary line does not have room for.
//
// All entry points here are PURE helpers so they unit-test without
// an SFML render context. The Enemies tab body painter
// (`drawEnemiesTab` in EntityInspectorTab.cpp) consumes them via
// `buildEnemyDrawerLines` + `entityInspectorRowIndexAt` +
// `clampDebugExpandAnim`; the DebugPanel keeps a row-band snapshot
// from the previous render so the click handler in GameSession can
// hit-test the cursor against the same Y bands the user clicked on.

#include <SFML/System/Vector2.hpp>

#include <string>
#include <vector>

namespace dof::entities { class Enemy; class Weapon; class Dice; class FloorItem; }

namespace dof::render {

// One row's vertical band in UI design coords. Y-only because every
// row spans the full body width; storing the band rather than
// (rowIndex, rowHeight) is what lets variable-height wrapped rows
// hit-test correctly (Hero/Enemies rows can be 1-3 visual lines tall
// depending on wrap).
struct EntityInspectorRowBand {
    int   rowIndex{-1};
    float yTop{0.0f};
    float yBottom{0.0f};
};

// Build the drawer body for a single enemy. Returns a list of detail
// lines covering the ability fields the summary `formatEnemyLine`
// omits (spawn position, isElite, move speed, chase + attack ranges,
// attack cooldown / current timer, base damage, aim direction,
// death-timer when dead). Pure — testable. The caller is expected to
// run each line through `wrapTextByCharCount` before painting so the
// drawer respects the same body-width cap as the rest of the tab.
std::vector<std::string> buildEnemyDrawerLines(const dof::entities::Enemy& enemy);

// card-mpoa5j47 — drawer body for ONE equipped weapon row in the Hero
// tab. Lines surface the fields the summary DPS line omits: weapon
// type / name, base damage, crit, range, slot count, item level,
// quality tier, attached dice count + face summary. Pure helper —
// caller pipes through `wrapTextByCharCount` before painting so wide
// names wrap inside the panel body width like enemy rows do.
std::vector<std::string> buildHeroWeaponRowDrawerLines(int rowIndex,
                                                          const dof::entities::Weapon& weapon);

// Drawer body for ONE Weapons-tab row (equipped / inventory / floor).
// Pointer signature so callers can pipe `peek(slot/row)` straight in
// — null/empty payload returns an empty line list, which keeps the
// painter from pushing a hit-test band for a row that has no entity.
// Mirrors the Hero-tab drawer fields (type, name, tier, quality, item
// level, base damage, APS, range, crit, slot count, countdown).
std::vector<std::string> buildWeaponsDrawerLines(const dof::entities::Weapon* weapon);

// Drawer body for ONE Dices-tab row (sidebar cell / inventory slot /
// floor). Pointer signature — null returns an empty list. Surfaces
// the fields the Dices summary row omits: face label, displayName,
// tier, quality, item level, damage multiplier, crit + crit chance,
// luck, current face / face count, countdown (roll) remaining +
// duration.
std::vector<std::string> buildDicesDrawerLines(const dof::entities::Dice* dice);

// Drawer body for ONE Floor-tab row. The FloorItem itself can never
// be null (caller already dereferences via `world.floorItems()`), but
// its `weapon()` / `dice()` payload may be null — in which case the
// drawer returns an empty list so the painter skips pushing a hit-
// test band for a hollow entry. Surfaces type/displayName/quality/
// item level/age/position fields.
std::vector<std::string> buildFloorDrawerLines(const dof::entities::FloorItem* item);

// GameSession wires these drawers through the same click, reset, and fixed-step
// animation contract as the Hero and Enemies tabs. Tab indices are
// 3 (Weapons), 4 (Dices), 5 (Floor); the matching expand fields live
// on `UiState`:
//   - debugWeaponsExpandedRowIndex / debugWeaponsExpandAnimSeconds
//   - debugDicesExpandedRowIndex   / debugDicesExpandAnimSeconds
//   - debugFloorExpandedRowIndex   / debugFloorExpandAnimSeconds
// Wiring contract:
//   (1) On left-click hit-testing while the active tab is 3/4/5,
//       call `entityInspectorRowIndexAt(weaponsRowBands()/dicesRowBands()
//       /floorRowBands(), cursorUi)` and toggle the matching expanded
//       row index (set to clicked index, or -1 if equal → toggle-close);
//       reset the matching anim seconds to 0 on every transition.
//   (2) Per-step (fixed sim tick), advance each of the three new anim
//       timers via `clampDebugExpandAnim(seconds, dt,
//       rowExpandAnimDuration())` so the drawer reveal mirrors Enemies
//       /Hero pacing.
//   (3) On debug-tab switch, reset the three new `*ExpandedRowIndex`
//       fields to -1 and clear their `*ExpandAnimSeconds` to 0 — same
//       close-on-tab-switch semantics already applied to Hero/Enemies.
//   (4) On debug-panel minimise (and on close / hide), reset all three
//       expand indices to -1 + their anim timers to 0.
//   (5) The painter signatures `drawWeaponsInspectorTab`,
//       `drawDicesInspectorTab`, `drawFloorItemsInspectorTab` gained
//       expand-context + outRowBands parameters in
//       `render/ItemInspectorTab.hpp`. Existing callers (DebugPanel)
//       pass them; no other call site touches these painters yet.

// Hit-test the cursor against the previous frame's enemy row bands.
// Returns the matching rowIndex when the cursor Y falls inside any
// band, or -1 when no band contains it. Pure — testable without an
// SFML render context.
int entityInspectorRowIndexAt(const std::vector<EntityInspectorRowBand>& bands,
                               sf::Vector2f cursorUi);

// Advance + clamp the expand animation timer. Increments by `dt`,
// then clamps into [0, duration] so the timer never overshoots the
// finished-open state. Pure — keeps the timer monotone across
// frames so the renderer's reveal ratio (`seconds / duration`) is
// guaranteed inside [0,1].
float clampDebugExpandAnim(float seconds, float dt, float duration);

// Reveal-ratio → number of drawer lines to paint this frame. A
// duration <= 0 returns the full drawer count immediately (animation
// disabled fallback). Pure helper.
int revealedDrawerLineCount(float seconds, float duration, int drawerLineCount);

}
