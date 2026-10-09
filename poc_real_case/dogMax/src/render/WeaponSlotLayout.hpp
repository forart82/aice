#pragma once

#include <SFML/Graphics/Rect.hpp>
#include <SFML/System/Vector2.hpp>

#include <array>

namespace dof::loaders { class ConfigLoader; }

namespace dof::render {

enum class InfoBarAction {
    None = -1,
    Inventory = 0,
    LootFilter = 1,
    DiceCrafter = 2,
    Help = 3,
};

constexpr int kInfoBarActionCount = 4;

// Geometry for the bottom info bar. The bar is a horizontal band pinned to
// the bottom edge of the design-space screen; its body is partitioned
// left-to-right into health as the physical left anchor, weapon slots, then
// small stat-readout areas (luck, powder, dash) and a vertical action icon
// stack. XP is a full-width rail along the top edge so progress reads as a
// cockpit spine instead of another small stat box. The configured
// physical weapon rows lay out horizontally across the weapons area; the
// WeaponSlotHub decides which of those rows are currently unlocked.
//
// `rowRect(i)` (kept for the many existing consumers — sidebar draw,
// InteractionController hit-testing, CombatTextRenderer dron labels) is the
// i-th weapon-slot TILE. `weaponZoneRect`/`diceZoneRect`/`progressZoneRect`
// split each tile vertically; `diceCellRect` lays the dice in a grid.
class WeaponSlotLayout {
public:
    WeaponSlotLayout(const dof::loaders::ConfigLoader& config, sf::Vector2u windowSize);

    // The whole bar band (former sidebar rect — kept name for consumers).
    sf::FloatRect sidebarRect() const;

    // Sub-section rects of the bar, left to right.
    sf::FloatRect weaponSlotsAreaRect() const;
    sf::FloatRect xpAreaRect() const;
    sf::FloatRect healthAreaRect() const;
    sf::FloatRect luckAreaRect() const;
    sf::FloatRect powderAreaRect() const;
    sf::FloatRect dashAreaRect() const;
    sf::FloatRect actionAreaRect() const;
    sf::FloatRect actionSlotRect(int slotIndex) const;
    sf::FloatRect actionButtonRect(InfoBarAction action) const;
    InfoBarAction actionAt(sf::Vector2f cursorUi) const;

    // One weapon-slot tile and its internal zones.
    sf::FloatRect rowRect(int rowIndex) const;
    sf::FloatRect weaponZoneRect(int rowIndex) const;
    sf::FloatRect diceZoneRect(int rowIndex) const;
    sf::FloatRect progressZoneRect(int rowIndex) const;
    sf::FloatRect diceCellRect(int rowIndex, int cellIndex) const;

    int           rowIndexAt(sf::Vector2f cursorUi) const;
    bool          containsPoint(sf::Vector2f cursorUi) const;
    void          setWindowSize(sf::Vector2u windowSize);
    sf::Vector2u  windowSize() const;

    int   rowCount() const;
    int   diceCellsPerRow() const;
    // Right-edge gutter the inventory once reserved for the old vertical
    // sidebar. The bar now lives at the bottom, so this is 0 — the inventory
    // reserves a bottom band instead (see InventoryLayout).
    float sidebarWidth() const;
    // Height the bar occupies at the bottom (for the inventory bottom
    // reservation): bar height + bottom margin.
    float barBottomReservation() const;

private:
    int   rows;
    int   diceCells;
    float barHeight;
    float bottomMargin;
    float sideMargin;
    float contentPad;
    float slotPad;
    float fracWeapons;
    float fracHealth;
    float fracLuck;
    float fracPowder;
    float fracDash;
    float fracActions;
    float xpStripHeight;
    float xpStripGap;
    float actionButtonSize;
    float actionButtonGapX;
    float actionButtonGapY;
    float actionIconOffsetX;
    float actionIconOffsetY;
    int   actionColumns;
    int   actionCapacity;
    std::array<int, kInfoBarActionCount> actionSlots;
    float actionAreaXFraction;
    float actionAreaYFraction;
    float slotWeaponZoneFraction;
    float slotDiceZoneFraction;
    float slotProgressZoneFraction;
    int   diceGridCols;
    sf::Vector2u screenSize;
};

}
