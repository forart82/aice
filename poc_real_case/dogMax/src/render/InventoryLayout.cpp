#include "render/InventoryLayout.hpp"

#include "loaders/ConfigLoader.hpp"

#include <algorithm>

namespace dof::render {

InventoryLayout::InventoryLayout(const dof::loaders::ConfigLoader& config, sf::Vector2u windowSize,
                                 float sidebarWidthInit, float bottomReservationInit)
    : screenSize(windowSize), sidebarWidth(sidebarWidthInit), bottomReservation(bottomReservationInit) {
    inventoryRows        = config.getInt("INVENTORY_ROWS");
    inventoryColumns     = config.getInt("INVENTORY_COLUMNS");
    inventorySlotSize    = config.getFloat("INVENTORY_SLOT_SIZE");
    inventorySlotPadding = config.getFloat("INVENTORY_SLOT_PADDING");
    panelPadding         = config.getFloat("INVENTORY_PANEL_PADDING");
    panelTopOffset       = config.getFloat("INVENTORY_PANEL_TOP_OFFSET");
    powderColumnWidth    = config.getFloat("INVENTORY_POWDER_COLUMN_WIDTH");
    horizontalMargin         = config.getFloat("INVENTORY_PANEL_HORIZONTAL_MARGIN");
    topBandHeight            = config.getFloat("INVENTORY_TOP_BAND_HEIGHT");
    footerHeight             = config.getFloat("INVENTORY_HINT_HEIGHT") + 8.0f;
    gridLeftRatio            = config.getFloat("INVENTORY_GRID_LEFT_RATIO");
    gridRightRatio           = config.getFloat("INVENTORY_GRID_RIGHT_RATIO");
    gridTopRatio             = config.getFloat("INVENTORY_GRID_TOP_RATIO");
    gridBottomRatio          = config.getFloat("INVENTORY_GRID_BOTTOM_RATIO");
    gridColumnGap            = config.getFloat("INVENTORY_GRID_COLUMN_GAP");
    gridRowGap               = config.getFloat("INVENTORY_GRID_ROW_GAP");
    controlLeftRatio         = config.getFloat("INVENTORY_CONTROL_LEFT_RATIO");
    controlRightRatio        = config.getFloat("INVENTORY_CONTROL_RIGHT_RATIO");
    controlTopRatio          = config.getFloat("INVENTORY_CONTROL_TOP_RATIO");
    controlHeightRatio       = config.getFloat("INVENTORY_CONTROL_HEIGHT_RATIO");
    controlGapRatio          = config.getFloat("INVENTORY_CONTROL_GAP_RATIO");
    powderListTopRatio       = config.getFloat("INVENTORY_POWDER_LIST_TOP_RATIO");
    powderListBottomRatio    = config.getFloat("INVENTORY_POWDER_LIST_BOTTOM_RATIO");
    powderListLeftRatio      = config.getFloat("INVENTORY_POWDER_LIST_LEFT_RATIO");
    powderListWidthRatio     = config.getFloat("INVENTORY_POWDER_LIST_WIDTH_RATIO");
    recomputeAdaptiveScale();
}

void InventoryLayout::recomputeAdaptiveScale() {
    // Spec-sized panel width: grid + horizontal panel padding +
    // powder column. The sidebar (weapon-slot) anchors the right
    // edge of the window, so the inventory's horizontal budget is
    // `window.x - sidebarWidth`. Shrink uniformly if the spec
    // values don't fit. Vertical budget is `window.y` minus the
    // panel top offset; both axes use the same scale so the slots
    // stay square at every effective scale.
    const float specGridWidth  = inventoryColumns * inventorySlotSize
                                 + (inventoryColumns - 1) * inventorySlotPadding;
    const float specGridHeight = inventoryRows * inventorySlotSize
                                 + (inventoryRows - 1) * inventorySlotPadding;
    const float specPanelWidth  = specGridWidth + 2.0f * panelPadding + powderColumnWidth;
    // T-INV-good-parity — top band reserves space for the inline
    // "◆ INVENTORY" title row + sort-tab strip + count badge row that
    // now live INSIDE the panel content area (per goodinventory.png).
    const float specPanelHeight = specGridHeight + 2.0f * panelPadding
                                + topBandHeight + footerHeight;

    // B-UX-4 (b) — phantom mirror margin on the left equal to the
    // real sidebar reservation on the right. Total reserved =
    // `2 * sidebarWidth`, so the inventory shrinks to fit a
    // symmetric band centred on the window x-axis.
    const float availableWidth  = std::max(1.0f, static_cast<float>(screenSize.x) - 2.0f * sidebarWidth - 2.0f * horizontalMargin);
    // Reserve the bottom info-bar band so the panel never overlaps it.
    const float availableHeight = std::max(1.0f, static_cast<float>(screenSize.y) - panelTopOffset - bottomReservation);

    float scale = 1.0f;
    if (specPanelWidth  > availableWidth)  scale = std::min(scale, availableWidth  / specPanelWidth);
    if (specPanelHeight > availableHeight) scale = std::min(scale, availableHeight / specPanelHeight);
    // Floor at 0.25 so the panel stays interactable on absurdly
    // small windows. The `SA36` clamp pushes the OS resize back
    // up to `WINDOW_MIN_*` before we even get here, so 0.25 is
    // the truly-degenerate floor.
    adaptiveScale = std::max(0.25f, scale);
}

float InventoryLayout::effectiveScale() const { return adaptiveScale; }

sf::FloatRect InventoryLayout::panelRect() const {
    const float slotSizeEff    = inventorySlotSize    * adaptiveScale;
    const float slotPaddingEff = inventorySlotPadding * adaptiveScale;
    const float panelPaddingEff = panelPadding * adaptiveScale;
    const float powderColumnEff = powderColumnWidth * adaptiveScale;
    const float topBandEff      = topBandHeight * adaptiveScale;
    const float gridWidth  = inventoryColumns * slotSizeEff + (inventoryColumns - 1) * slotPaddingEff;
    const float gridHeight = inventoryRows    * slotSizeEff + (inventoryRows    - 1) * slotPaddingEff;
    const float panelWidth  = gridWidth  + 2.0f * panelPaddingEff + powderColumnEff;
    // T-INV-good-parity — top band houses the inline title + tab strip
    // + count badge (formerly v2 chips that floated above the panel).
    const float footerEff = footerHeight * adaptiveScale;
    const float panelHeight = gridHeight + 2.0f * panelPaddingEff + topBandEff + footerEff;
    const float originX = horizontalMargin;
    const float originY = static_cast<float>(screenSize.y) - bottomReservation - panelHeight;
    // card-mpl1tkff — apply the live drag offset on top of the
    // computed anchor. Every other rect in this class derives from
    // `panelRect`, so the whole layout follows the drag automatically.
    return sf::FloatRect{{originX + dragOffsetValue.x + deployOffsetValue.x,
                          originY + dragOffsetValue.y + deployOffsetValue.y},
                         {panelWidth, panelHeight}};
}

sf::FloatRect InventoryLayout::slotRect(int slotIndex) const {
    if (slotIndex < 0 || slotIndex >= inventoryRows * inventoryColumns) return sf::FloatRect{{0.0f, 0.0f}, {0.0f, 0.0f}};
    const int row = slotIndex / inventoryColumns;
    const int column = slotIndex % inventoryColumns;
    return cellRect(row, column);
}

sf::FloatRect InventoryLayout::gridRect() const {
    const auto panel = panelRect();
    const float left = panel.size.x * gridLeftRatio;
    const float top = panel.size.y * gridTopRatio;
    return sf::FloatRect{{panel.position.x + left, panel.position.y + top},
                         {panel.size.x * (1.0f - gridLeftRatio - gridRightRatio),
                          panel.size.y * (1.0f - gridTopRatio - gridBottomRatio)}};
}

sf::FloatRect InventoryLayout::cellRect(int rowIndex, int columnIndex) const {
    // Unified grid — every cell is the same square, addressed only by
    // (row, column); any item kind (weapon or dice) may occupy any cell.
    if (columnIndex < 0 || columnIndex >= inventoryColumns) return sf::FloatRect{{0.0f, 0.0f}, {0.0f, 0.0f}};
    if (rowIndex < 0 || rowIndex >= inventoryRows) return sf::FloatRect{{0.0f, 0.0f}, {0.0f, 0.0f}};
    const auto bay = gridRect();
    const float columnGapEff = gridColumnGap * adaptiveScale;
    const float rowGapEff = gridRowGap * adaptiveScale;
    const float cellWidth = (bay.size.x - columnGapEff * (inventoryColumns - 1))
                          / static_cast<float>(inventoryColumns);
    const float cellHeight = (bay.size.y - rowGapEff * (inventoryRows - 1))
                           / static_cast<float>(inventoryRows);
    const float originX = bay.position.x + columnIndex * (cellWidth + columnGapEff);
    const float originY = bay.position.y + rowIndex * (cellHeight + rowGapEff);
    return sf::FloatRect{{originX, originY}, {cellWidth, cellHeight}};
}

sf::FloatRect InventoryLayout::weaponRect(int primarySlotIndex) const {
    if (primarySlotIndex < 0 || primarySlotIndex >= inventoryRows * inventoryColumns)
        return sf::FloatRect{{0.0f, 0.0f}, {0.0f, 0.0f}};
    const int row = primarySlotIndex / inventoryColumns;
    if (row + 1 >= inventoryRows) return slotRect(primarySlotIndex);
    const auto base = slotRect(primarySlotIndex);
    const auto below = slotRect(primarySlotIndex + inventoryColumns);
    return sf::FloatRect{{base.position.x, base.position.y},
                         {base.size.x, below.position.y + below.size.y - base.position.y}};
}

sf::FloatRect InventoryLayout::destroyButtonRect(int tierIndex) const {
    if (tierIndex < 0 || tierIndex > 2) return sf::FloatRect{{0.0f, 0.0f}, {0.0f, 0.0f}};
    return controlButtonRect(tierIndex);
}

int InventoryLayout::destroyButtonIndexAt(sf::Vector2f cursorUi) const {
    for (int i = 0; i < 3; ++i) {
        if (destroyButtonRect(i).contains(cursorUi)) return i;
    }
    return -1;
}

sf::FloatRect InventoryLayout::powderStackAreaRect() const {
    const auto panel = panelRect();
    const float originY = panel.position.y + panel.size.y * powderListTopRatio;
    return sf::FloatRect{{panel.position.x + panel.size.x * powderListLeftRatio, originY},
                         {panel.size.x * powderListWidthRatio,
                          panel.size.y * (1.0f - powderListTopRatio - powderListBottomRatio)}};
}

sf::FloatRect InventoryLayout::sortButtonRect(int buttonIndex) const {
    if (buttonIndex < 0 || buttonIndex > 2) return sf::FloatRect{{0.0f, 0.0f}, {0.0f, 0.0f}};
    return controlButtonRect(buttonIndex + 3);
}

sf::FloatRect InventoryLayout::controlButtonRect(int buttonIndex) const {
    const auto panel = panelRect();
    const float gap = panel.size.x * controlGapRatio;
    const float availableWidth = panel.size.x * (1.0f - controlLeftRatio - controlRightRatio);
    const float width = (availableWidth - gap * 5.0f) / 6.0f;
    return sf::FloatRect{{panel.position.x + panel.size.x * controlLeftRatio
                            + buttonIndex * (width + gap),
                          panel.position.y + panel.size.y * controlTopRatio},
                         {width, panel.size.y * controlHeightRatio}};
}

int InventoryLayout::sortButtonIndexAt(sf::Vector2f cursorUi) const {
    for (int i = 0; i < 3; ++i) {
        if (sortButtonRect(i).contains(cursorUi)) return i;
    }
    return -1;
}

int InventoryLayout::slotIndexAt(sf::Vector2f cursorUi) const {
    // Unified grid — every flat index maps to a real cell rect; walk
    // them all and return the first that contains the cursor.
    const int total = inventoryRows * inventoryColumns;
    for (int i = 0; i < total; ++i) {
        auto rect = slotRect(i);
        if (rect.size.x <= 0.0f || rect.size.y <= 0.0f) continue;
        if (rect.contains(cursorUi)) return i;
    }
    return -1;
}

bool InventoryLayout::containsPoint(sf::Vector2f cursorUi) const {
    return panelRect().contains(cursorUi);
}

int InventoryLayout::rows() const { return inventoryRows; }
int InventoryLayout::columns() const { return inventoryColumns; }
float InventoryLayout::slotSize() const {
    const auto cell = cellRect(0, 0);
    return std::min(cell.size.x, cell.size.y);
}

void InventoryLayout::setWindowSize(sf::Vector2u windowSizeValue) {
    screenSize = windowSizeValue;
    recomputeAdaptiveScale();
}

void InventoryLayout::setSidebarWidth(float widthValue) {
    sidebarWidth = widthValue;
    recomputeAdaptiveScale();
}

sf::Vector2u InventoryLayout::windowSize() const {
    return screenSize;
}

float InventoryLayout::infobarTopY() const {
    return static_cast<float>(screenSize.y) - bottomReservation;
}

void InventoryLayout::setDragOffset(sf::Vector2f offset) { dragOffsetValue = offset; }
sf::Vector2f InventoryLayout::dragOffset() const { return dragOffsetValue; }
void InventoryLayout::setDeployOffset(sf::Vector2f offset) { deployOffsetValue = offset; }

sf::FloatRect InventoryLayout::dragHandleRect() const {
    // card-mpl1tkff — small grab square anchored at the panel's
    // top-right interior corner. Side length scales with the
    // adaptive panel scale so it stays touchable on shrunk windows
    // and matches the per-tier slot grid visually. Sits INSIDE the
    // panel rect so it always reads as part of the inventory chrome
    // (and never overlaps the right-anchored weapon-slot sidebar).
    const auto panel = panelRect();
    const float handleSide = std::max(12.0f, 18.0f * adaptiveScale);
    const float margin     = 4.0f * adaptiveScale;
    const float x = panel.position.x + panel.size.x - handleSide - margin;
    const float y = panel.position.y + margin;
    return sf::FloatRect{{x, y}, {handleSide, handleSide}};
}

bool InventoryLayout::dragHandleContains(sf::Vector2f cursorUi) const {
    const auto r = dragHandleRect();
    return cursorUi.x >= r.position.x
        && cursorUi.x <  r.position.x + r.size.x
        && cursorUi.y >= r.position.y
        && cursorUi.y <  r.position.y + r.size.y;
}

}
