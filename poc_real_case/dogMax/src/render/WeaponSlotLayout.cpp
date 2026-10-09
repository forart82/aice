#include "render/WeaponSlotLayout.hpp"

#include "loaders/ConfigLoader.hpp"

#include <algorithm>

namespace dof::render {

WeaponSlotLayout::WeaponSlotLayout(const dof::loaders::ConfigLoader& config, sf::Vector2u windowSize)
    : screenSize(windowSize) {
    rows          = config.getInt("WEAPONSLOT_ROWS");
    diceCells     = config.getInt("WEAPONSLOT_DICE_CELLS_PER_ROW");
    barHeight     = config.getFloat("INFOBAR_HEIGHT");
    bottomMargin  = config.getFloat("INFOBAR_BOTTOM_MARGIN");
    sideMargin    = config.getFloat("INFOBAR_SIDE_MARGIN");
    contentPad    = config.getFloat("INFOBAR_CONTENT_PAD");
    slotPad       = config.getFloat("INFOBAR_SLOT_PAD");
    fracWeapons   = config.getFloat("INFOBAR_FRACTION_WEAPONS");
    fracHealth    = config.getFloat("INFOBAR_FRACTION_HEALTH");
    fracLuck      = config.getFloat("INFOBAR_FRACTION_LUCK");
    fracPowder    = config.getFloat("INFOBAR_FRACTION_POWDER");
    fracDash      = config.getFloat("INFOBAR_FRACTION_DASH");
    fracActions   = config.getFloat("INFOBAR_FRACTION_ACTIONS");
    xpStripHeight = config.getFloat("INFOBAR_XP_STRIP_HEIGHT");
    xpStripGap    = config.getFloat("INFOBAR_XP_STRIP_GAP");
    actionButtonSize = config.getFloat("INFOBAR_ACTION_BUTTON_SIZE");
    actionButtonGapX = config.getFloat("INFOBAR_ACTION_BUTTON_GAP_X");
    actionButtonGapY = config.getFloat("INFOBAR_ACTION_BUTTON_GAP_Y");
    actionIconOffsetX = config.getFloat("INFOBAR_ACTION_ICON_OFFSET_X");
    actionIconOffsetY = config.getFloat("INFOBAR_ACTION_ICON_OFFSET_Y");
    actionColumns = std::clamp(config.getInt("INFOBAR_ACTION_COLUMNS"), 1, kInfoBarActionCount);
    actionCapacity = std::max(kInfoBarActionCount, config.getInt("INFOBAR_ACTION_CAPACITY"));
    actionSlots = {
        config.getInt("INFOBAR_ACTION_INVENTORY_SLOT"),
        config.getInt("INFOBAR_ACTION_FILTER_SLOT"),
        config.getInt("INFOBAR_ACTION_CRAFT_SLOT"),
        config.getInt("INFOBAR_ACTION_HELP_SLOT"),
    };
    actionAreaXFraction = config.getFloat("INFOBAR_ACTION_X_FRACTION");
    actionAreaYFraction = config.getFloat("INFOBAR_ACTION_Y_FRACTION");
    slotWeaponZoneFraction   = config.getFloat("INFOBAR_SLOT_WEAPON_ZONE_FRACTION");
    slotDiceZoneFraction     = config.getFloat("INFOBAR_SLOT_DICE_ZONE_FRACTION");
    slotProgressZoneFraction = config.getFloat("INFOBAR_SLOT_PROGRESS_ZONE_FRACTION");
    diceGridCols  = std::max(1, config.getInt("INFOBAR_DICE_GRID_COLS"));
}

sf::FloatRect WeaponSlotLayout::sidebarRect() const {
    const float width   = static_cast<float>(screenSize.x) - sideMargin * 2.0f;
    const float originX = sideMargin;
    const float originY = static_cast<float>(screenSize.y) - barHeight - bottomMargin;
    return sf::FloatRect{{originX, originY}, {width, barHeight}};
}

namespace {
// The bar's inner content region (inside contentPad).
sf::FloatRect contentOf(sf::FloatRect bar, float pad) {
    return sf::FloatRect{{bar.position.x + pad, bar.position.y + pad},
                         {bar.size.x - pad * 2.0f, bar.size.y - pad * 2.0f}};
}
// A horizontal slice of `content` from fraction `start`, width fraction `frac`.
sf::FloatRect sliceOf(sf::FloatRect content, float start, float frac) {
    return sf::FloatRect{{content.position.x + content.size.x * start, content.position.y},
                         {content.size.x * frac, content.size.y}};
}
sf::FloatRect mainContentOf(sf::FloatRect content, float xpHeight, float xpGap) {
    const float railHeight = std::clamp(xpHeight, 0.0f, content.size.y * 0.35f);
    const float gap = railHeight > 0.0f ? std::max(0.0f, xpGap) : 0.0f;
    const float consumed = std::min(content.size.y, railHeight + gap);
    return sf::FloatRect{{content.position.x, content.position.y + consumed},
                         {content.size.x, std::max(0.0f, content.size.y - consumed)}};
}
} // namespace

sf::FloatRect WeaponSlotLayout::weaponSlotsAreaRect() const {
    return sliceOf(mainContentOf(contentOf(sidebarRect(), contentPad), xpStripHeight, xpStripGap),
                   fracHealth, fracWeapons);
}
sf::FloatRect WeaponSlotLayout::xpAreaRect() const {
    const auto content = contentOf(sidebarRect(), contentPad);
    const float railHeight = std::clamp(xpStripHeight, 0.0f, content.size.y * 0.35f);
    return sf::FloatRect{{content.position.x, content.position.y},
                         {content.size.x, railHeight}};
}
sf::FloatRect WeaponSlotLayout::healthAreaRect() const {
    return sliceOf(mainContentOf(contentOf(sidebarRect(), contentPad), xpStripHeight, xpStripGap),
                   0.0f, fracHealth);
}
sf::FloatRect WeaponSlotLayout::luckAreaRect() const {
    return sliceOf(mainContentOf(contentOf(sidebarRect(), contentPad), xpStripHeight, xpStripGap),
                   fracHealth + fracWeapons, fracLuck);
}
sf::FloatRect WeaponSlotLayout::powderAreaRect() const {
    return sliceOf(mainContentOf(contentOf(sidebarRect(), contentPad), xpStripHeight, xpStripGap),
                   fracHealth + fracWeapons + fracLuck, fracPowder);
}
sf::FloatRect WeaponSlotLayout::dashAreaRect() const {
    return sliceOf(mainContentOf(contentOf(sidebarRect(), contentPad), xpStripHeight, xpStripGap),
                   fracHealth + fracWeapons + fracLuck + fracPowder, fracDash);
}

sf::FloatRect WeaponSlotLayout::actionAreaRect() const {
    const auto health = healthAreaRect();
    const int actionRows = (actionCapacity + actionColumns - 1) / actionColumns;
    const float width = actionButtonSize * static_cast<float>(actionColumns)
                      + actionButtonGapX * static_cast<float>(actionColumns - 1);
    const float height = actionButtonSize * static_cast<float>(actionRows)
                       + actionButtonGapY * static_cast<float>(actionRows - 1);
    return sf::FloatRect{{health.position.x + health.size.x * actionAreaXFraction,
                          health.position.y + health.size.y * actionAreaYFraction},
                         {width, height}};
}

sf::FloatRect WeaponSlotLayout::actionButtonRect(InfoBarAction action) const {
    const int index = static_cast<int>(action);
    if (index < 0 || index >= kInfoBarActionCount) {
        return sf::FloatRect{{0.0f, 0.0f}, {0.0f, 0.0f}};
    }
    const int slotIndex = std::clamp(actionSlots[static_cast<std::size_t>(index)],
                                     0, actionCapacity - 1);
    return actionSlotRect(slotIndex);
}

sf::FloatRect WeaponSlotLayout::actionSlotRect(int slotIndex) const {
    const auto area = actionAreaRect();
    slotIndex = std::clamp(slotIndex, 0, actionCapacity - 1);
    const int column = slotIndex % actionColumns;
    const int row = slotIndex / actionColumns;
    const float x = area.position.x + actionIconOffsetX
                  + static_cast<float>(column) * (actionButtonSize + actionButtonGapX);
    const float y = area.position.y + actionIconOffsetY
                  + static_cast<float>(row) * (actionButtonSize + actionButtonGapY);
    return sf::FloatRect{{x, y}, {actionButtonSize, actionButtonSize}};
}

InfoBarAction WeaponSlotLayout::actionAt(sf::Vector2f cursorUi) const {
    for (int index = 0; index < kInfoBarActionCount; ++index) {
        const auto action = static_cast<InfoBarAction>(index);
        if (actionButtonRect(action).contains(cursorUi)) return action;
    }
    return InfoBarAction::None;
}

sf::FloatRect WeaponSlotLayout::rowRect(int rowIndex) const {
    if (rowIndex < 0 || rowIndex >= rows) return sf::FloatRect{{0.0f, 0.0f}, {0.0f, 0.0f}};
    const auto area = weaponSlotsAreaRect();
    const float totalPad = slotPad * static_cast<float>(rows - 1);
    const float tileW = (area.size.x - totalPad) / static_cast<float>(rows);
    const float originX = area.position.x + static_cast<float>(rowIndex) * (tileW + slotPad);
    return sf::FloatRect{{originX, area.position.y}, {tileW, area.size.y}};
}

sf::FloatRect WeaponSlotLayout::weaponZoneRect(int rowIndex) const {
    const auto tile = rowRect(rowIndex);
    return sf::FloatRect{{tile.position.x, tile.position.y},
                         {tile.size.x, tile.size.y * slotWeaponZoneFraction}};
}

sf::FloatRect WeaponSlotLayout::diceZoneRect(int rowIndex) const {
    const auto tile = rowRect(rowIndex);
    const float yStart = tile.position.y + tile.size.y * slotWeaponZoneFraction;
    return sf::FloatRect{{tile.position.x, yStart},
                         {tile.size.x, tile.size.y * slotDiceZoneFraction}};
}

sf::FloatRect WeaponSlotLayout::progressZoneRect(int rowIndex) const {
    const auto tile = rowRect(rowIndex);
    const float yStart = tile.position.y + tile.size.y * (slotWeaponZoneFraction + slotDiceZoneFraction);
    return sf::FloatRect{{tile.position.x, yStart},
                         {tile.size.x, tile.size.y * slotProgressZoneFraction}};
}

sf::FloatRect WeaponSlotLayout::diceCellRect(int rowIndex, int cellIndex) const {
    const auto zone = diceZoneRect(rowIndex);
    if (cellIndex < 0 || cellIndex >= diceCells) return sf::FloatRect{{0.0f, 0.0f}, {0.0f, 0.0f}};
    const int cols = diceGridCols;
    const int gridRows = (diceCells + cols - 1) / cols;
    const int col = cellIndex % cols;
    const int gridRow = cellIndex / cols;
    const float cellW = zone.size.x / static_cast<float>(cols);
    const float cellH = zone.size.y / static_cast<float>(gridRows);
    const float side = std::min(cellW, cellH);            // square cell
    const float xOff = (cellW - side) * 0.5f;
    const float yOff = (cellH - side) * 0.5f;
    return sf::FloatRect{{zone.position.x + static_cast<float>(col) * cellW + xOff,
                          zone.position.y + static_cast<float>(gridRow) * cellH + yOff},
                         {side, side}};
}

int WeaponSlotLayout::rowIndexAt(sf::Vector2f cursorUi) const {
    for (int i = 0; i < rows; ++i) {
        if (rowRect(i).contains(cursorUi)) return i;
    }
    return -1;
}

bool WeaponSlotLayout::containsPoint(sf::Vector2f cursorUi) const {
    return sidebarRect().contains(cursorUi);
}

int WeaponSlotLayout::rowCount() const { return rows; }
int WeaponSlotLayout::diceCellsPerRow() const { return diceCells; }
float WeaponSlotLayout::sidebarWidth() const { return 0.0f; }
float WeaponSlotLayout::barBottomReservation() const { return barHeight + bottomMargin; }

void WeaponSlotLayout::setWindowSize(sf::Vector2u windowSizeValue) {
    screenSize = windowSizeValue;
}

sf::Vector2u WeaponSlotLayout::windowSize() const {
    return screenSize;
}

}
