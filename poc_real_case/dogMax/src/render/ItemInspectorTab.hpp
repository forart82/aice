#pragma once

// card-mpl1ldva — Weapons + Dices debug tabs. Both share the same
// layout (background slab + scrolling line list) so the painters
// live behind one header. Each function scans the inventory, sidebar
// weapon slots, and floor-item collection for items of the requested
// kind and emits a one-line summary per item; `scrollOffset` honours
// the same body-scroll plumbing the Entity tab uses.

#include "render/EntityInspectorExpand.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/RenderWindow.hpp>

#include <string>
#include <vector>

namespace dof::core    { class World; }
namespace dof::hubs    { class InventoryHub; class WeaponSlotHub; }
namespace dof::render  { struct DebugPanelRects; }
namespace dof::entities { class Weapon; class Dice; class FloorItem; }

namespace dof::render {

// Pure formatters — testable without an SFML context.
std::string formatWeaponInventoryRow(int slotIndex, const dof::entities::Weapon& weapon);
std::string formatWeaponSlotRow(int rowIndex, const dof::entities::Weapon& weapon);
std::string formatWeaponFloorRow(const dof::entities::Weapon& weapon);
std::string formatDiceInventoryRow(int slotIndex, const dof::entities::Dice& dice);
std::string formatDiceCellRow(int rowIndex, int cellIndex, const dof::entities::Dice& dice);
std::string formatDiceFloorRow(const dof::entities::Dice& dice);

// Shared expand-context for the Weapons / Dices / Floor tabs. Same
// shape as `EnemiesTabExpandContext` (card-mpmzs1j5) so the table
// chrome + drawer pacing match across every per-row drilldown tab.
struct ItemTabExpandContext {
    int   expandedRowIndex{-1};
    float animSeconds{0.0f};
    float animDurationSeconds{0.0f};
    sf::Color zebraEvenBg{20, 20, 28, 220};
    sf::Color zebraOddBg{28, 28, 40, 220};
    sf::Color rowDivider{60, 60, 80, 200};
    sf::Color drawerBg{18, 14, 36, 230};
};

// Body painters. Each scans Inventory + WeaponSlot rows + World floor
// items for the requested item kind. Returns the total line count
// emitted this frame so DebugPanel can clamp `scrollOffset`. The
// `expand` + `outRowBands` parameters mirror the Hero/Enemies tabs:
// `expandedRowIndex` is a flat paint-order ordinal over item-bearing
// rows, and `outRowBands` (when non-null) is filled with one band per
// item-bearing row so the click handler can hit-test the cursor.
int drawWeaponsInspectorTab(sf::RenderWindow& window,
                             const DebugPanelRects& rects,
                             const dof::core::World& world,
                             const dof::hubs::InventoryHub* inventoryHub,
                             const dof::hubs::WeaponSlotHub* weaponSlotHub,
                             const sf::Font& font,
                             unsigned textSize,
                             sf::Color textColor,
                             int scrollOffset,
                             const ItemTabExpandContext& expand = {},
                             const std::string& searchQuery = "",
                             std::vector<EntityInspectorRowBand>* outRowBands = nullptr);

int drawDicesInspectorTab(sf::RenderWindow& window,
                           const DebugPanelRects& rects,
                           const dof::core::World& world,
                           const dof::hubs::InventoryHub* inventoryHub,
                           const dof::hubs::WeaponSlotHub* weaponSlotHub,
                           const sf::Font& font,
                           unsigned textSize,
                           sf::Color textColor,
                           int scrollOffset,
                           const ItemTabExpandContext& expand = {},
                           const std::string& searchQuery = "",
                           std::vector<EntityInspectorRowBand>* outRowBands = nullptr);

// card-mpl1zaar — dedicated Floor tab listing every dropped item in
// the world. The Entity tab already shows a Floor Items section as
// part of its omnibus dump; this tab is the focused drill-down with
// per-item Type / Lv / Quality / position. Returns total line count
// for the scroll clamp.
int drawFloorItemsInspectorTab(sf::RenderWindow& window,
                                 const DebugPanelRects& rects,
                                 const dof::core::World& world,
                                 const sf::Font& font,
                                 unsigned textSize,
                                 sf::Color textColor,
                                 int scrollOffset,
                                 const ItemTabExpandContext& expand = {},
                                 const std::string& searchQuery = "",
                                 std::vector<EntityInspectorRowBand>* outRowBands = nullptr);

std::string formatFloorItemDetailedLine(const dof::entities::FloorItem& item);

}
