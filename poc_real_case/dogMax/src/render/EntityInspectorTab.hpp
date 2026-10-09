#pragma once

// Spec §Debug Mode §Entity Inspector L2809-2822 + §Tabs §Entity Tab
// L2840-2844 — per-entity real-time data overlay in the debug panel's
// Entity tab. Lists the Hero with full inspector data, every alive
// Enemy with HP/level/tier/position, and floor Items with their
// quality.
//
// Formatters are pure helpers (return std::string from primitive
// inputs) so they can be unit-tested without an SFML render context.
// Each split tab entry point (`drawGeneralTab`, `drawHeroTab`,
// `drawEnemiesTab`) assembles the lines and paints them as a table
// (zebra rows + dividers + word-wrapped cells). The Enemies tab also
// supports the click-to-expand drawer driven by helpers in
// `render/EntityInspectorExpand.hpp` (card-mpmzs1j5).

#include "render/EntityInspectorExpand.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/System/Vector2.hpp>

#include <string>
#include <vector>

namespace dof::core    { class World; }
namespace dof::hubs    { class EvasionHub; class WeaponSlotHub; class LuckHub; }
namespace dof::render  { struct DebugPanelRects; }
namespace dof::entities {
class Hero;
class Enemy;
class FloorItem;
}

namespace dof::render {

// Pure formatters — testable. Each emits a single line per spec
// L2813-2820 listing the canonical fields.
std::string formatHeroLine(const dof::entities::Hero& hero, float evasionChancePercent);
std::string formatEnemyLine(const dof::entities::Enemy& enemy);
std::string formatFloorItemLine(const dof::entities::FloorItem& item);

// card-mpl0z3ud — debug summary of the current enemy roster grouped
// by tier and by level band. The four counters (`common`, `uncommon`,
// `rare`, `total`) cover the tier axis; `byLevelBand` is keyed by the
// upper-exclusive band thresholds (default L20/L40/L60/L80/+) so the
// player reads the "what is on screen right now" picture without
// scrolling the per-entity list. Dead enemies are excluded (the
// inspector body already filters them).
struct EnemyRosterSummary {
    int common{0};
    int uncommon{0};
    int rare{0};
    int total{0};
    // Five bands matching the default ENEMY_POLYGON_LEVEL_THRESHOLDS
    // table (1-19, 20-39, 40-59, 60-79, 80-99). Counts of alive
    // enemies whose level falls into each band.
    int bandLow{0};
    int bandLowMid{0};
    int bandMid{0};
    int bandHighMid{0};
    int bandHigh{0};
};

EnemyRosterSummary summariseEnemyRoster(const dof::core::World& world);
std::string formatEnemySummaryTierLine(const EnemyRosterSummary& summary);
std::string formatEnemySummaryBandLine(const EnemyRosterSummary& summary);

// card-mpl955r4 — pure helper. Wraps a single string into multiple
// lines at word boundaries so long entries (per-enemy formatter,
// floor-item details, config dump) don't overflow the debug panel
// width. `maxCharsPerLine <= 0` returns the input unchanged.
// Words longer than `maxCharsPerLine` get hard-broken so they
// always fit. Empty input yields a single empty line so the caller
// still sees a "row" for spacing.
std::vector<std::string> wrapTextByCharCount(const std::string& text,
                                              int maxCharsPerLine);

// card-mpl1x8l8 — hero stat block under the hero line: luck total +
// per-row DPS + total-row DPS so the player can audit damage output
// at a glance. DPS is the baseline (baseDamage * effective APS) and
// ignores Dron multiplier + crit (random) — those swing combat-time,
// not equipment-time, and stamping them here would lie about the
// guaranteed output. Pure formatters and a `computeRowDps` helper
// keep the math testable without standing up a renderer.
float computeRowDps(int rowIndex, const dof::hubs::WeaponSlotHub& weaponSlotHub);
std::string formatHeroLuckLine(int luckTotal);
std::string formatHeroRowDpsLine(int rowIndex,
                                  float baseDamage,
                                  float effectiveAps,
                                  float dps);
std::string formatHeroTotalDpsLine(float totalDps);

// Render the Entity tab body. Caller supplies the world (hero +
// enemies + floor items) plus the evasion hub for the hero's live evade
// chance. Lines paint top-to-bottom inside `rects.bodyHeight()`;
// `scrollOffset` (lines, >= 0) skips that many lines from the top so
// the user can scroll the list with wheel / PgUp / PgDn / Home (card-
// mpkwdbzn). The returned int is the total line count produced this
// frame — the caller (`DebugPanel`) uses it to clamp the live scroll
// state against the latest list length.
// card-mpl9it01 — Entity tab split into three focused tabs.
// `drawGeneralTab`  paints a top-level dashboard (hero level, alive
// enemy + floor-item + sidebar/inventory occupancy counters) so the
// player can read the world's overall state at a glance.
// `drawHeroTab`     owns the hero block previously at the top of the
// Entity tab (HP/Lv/XP/Evasion/Pos line + luck + per-slot DPS + total).
// `drawEnemiesTab`  owns the enemy roster summary + per-enemy lines.
// The Floor Items section is gone — that data now lives only in the
// dedicated Floor tab (`drawFloorItemsInspectorTab`).
int drawGeneralTab(sf::RenderWindow& window,
                    const DebugPanelRects& rects,
                    const dof::core::World& world,
                    const dof::hubs::WeaponSlotHub* weaponSlotHub,
                    const sf::Font& font,
                    unsigned textSize,
                    sf::Color textColor,
                    int scrollOffset,
                    sf::Color rowBgColor,
                    sf::Color rowAltColor);

// card-mpoa5j47 — Hero tab gains the same click-to-expand row drawer
// the Enemies tab already had (card-mpmzs1j5). One row per equipped
// weapon (rowIndex == WeaponSlotHub row). The drawer surfaces the
// weapon fields the per-row DPS summary line omits — name, tier,
// quality, item level, crit, range, slot count, attached dice.
// `outRowBands` (non-null) is filled with the painted row bands so
// the click handler in GameSession can hit-test the previous frame's
// layout (mirrors the Enemies-tab plumbing).
struct HeroTabExpandContext {
    int   expandedRowIndex{-1};
    float animSeconds{0.0f};
    float animDurationSeconds{0.0f};
    sf::Color zebraEvenBg{20, 20, 28, 220};
    sf::Color zebraOddBg{28, 28, 40, 220};
    sf::Color rowDivider{60, 60, 80, 200};
    sf::Color drawerBg{18, 14, 36, 230};
};

int drawHeroTab(sf::RenderWindow& window,
                 const DebugPanelRects& rects,
                 const dof::core::World& world,
                 const dof::hubs::EvasionHub* evasionHub,
                 const dof::hubs::WeaponSlotHub* weaponSlotHub,
                 const dof::hubs::LuckHub* luckHub,
                 const sf::Font& font,
                 unsigned textSize,
                 sf::Color textColor,
                 int scrollOffset,
                 const HeroTabExpandContext& expand = {},
                 std::vector<EntityInspectorRowBand>* outRowBands = nullptr);

// card-mpmzs1j5 — table-style enemy tab. Zebra row banding + dividers
// paint each enemy as a discrete row whose text wraps inside its
// band. Clicking a row toggles an animated drawer revealing the
// enemy's full ability state. The renderer also writes the live
// row-band list into `outRowBands` (cleared first) so the click
// handler in GameSession can hit-test the previous frame's bands
// without recomputing the layout client-side.
struct EnemiesTabExpandContext {
    int   expandedRowIndex{-1};
    float animSeconds{0.0f};
    float animDurationSeconds{0.0f};
    sf::Color zebraEvenBg{20, 20, 28, 220};
    sf::Color zebraOddBg{28, 28, 40, 220};
    sf::Color rowDivider{60, 60, 80, 200};
    sf::Color drawerBg{18, 14, 36, 230};
};

int drawEnemiesTab(sf::RenderWindow& window,
                    const DebugPanelRects& rects,
                    const dof::core::World& world,
                    const sf::Font& font,
                    unsigned textSize,
                    sf::Color textColor,
                    int scrollOffset,
                    const EnemiesTabExpandContext& expand,
                    const std::string& searchQuery = "",
                    std::vector<EntityInspectorRowBand>* outRowBands = nullptr);

}
