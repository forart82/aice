#pragma once

#include <SFML/Graphics/Rect.hpp>
#include <SFML/System/Vector2.hpp>

namespace dof::loaders { class ConfigLoader; }

namespace dof::render {

class InventoryLayout {
public:
    InventoryLayout(const dof::loaders::ConfigLoader& config, sf::Vector2u windowSize,
                    float sidebarWidth, float bottomReservation);

    sf::FloatRect panelRect() const;
    sf::FloatRect gridRect() const;
    sf::FloatRect slotRect(int slotIndex) const;
    int           slotIndexAt(sf::Vector2f cursorUi) const;
    bool          containsPoint(sf::Vector2f cursorUi) const;
    void          setWindowSize(sf::Vector2u windowSize);
    void          setSidebarWidth(float width);
    sf::Vector2u  windowSize() const;
    float         infobarTopY() const;

    // card-mpl1tkff — user-drag offset for the whole inventory panel.
    // Stored on the layout so every derived rect (slots, powder
    // column, sort buttons, drag handle) shifts together. Persists
    // for the lifetime of the InventoryLayout instance — that's the
    // session, since GameSession reconstructs the layout only on
    // window-resize or panel construction; the offset survives a
    // resize because `setWindowSize` doesn't touch it.
    void          setDragOffset(sf::Vector2f offset);
    sf::Vector2f  dragOffset() const;
    void          setDeployOffset(sf::Vector2f offset);
    sf::FloatRect dragHandleRect() const;
    bool          dragHandleContains(sf::Vector2f cursorUi) const;

    int rows() const;
    int columns() const;
    float slotSize() const;

    // Adaptive layout: scale ∈ (0, 1] applied uniformly to slot
    // size, slot padding, panel padding, powder column, and sort
    // button strip whenever the spec-sized panel would overflow the
    // window minus the right-anchored weapon-slot sidebar. The
    // scale is recomputed on every `setWindowSize` /
    // `setSidebarWidth` call, so the rest of the API stays
    // unchanged: callers see the effective rects.
    float effectiveScale() const;

    // Powder column (Phase 5). Index 0..2 maps to Common/Uncommon/Rare buttons.
    sf::FloatRect destroyButtonRect(int tierIndex) const;
    int           destroyButtonIndexAt(sf::Vector2f cursorUi) const;
    sf::FloatRect powderStackAreaRect() const;

    // SA27 / spec §Inventory L2254-L2256 — sort button strip sits in
    // a row above the slot grid (between the powder column header and
    // the first row of slots). Index 0 = sort-by-tier, 1 = sort-by-type,
    // 2 = toggle auto-sort. `sortButtonIndexAt` returns -1 if the
    // cursor doesn't land on any button.
    sf::FloatRect sortButtonRect(int buttonIndex) const;
    int           sortButtonIndexAt(sf::Vector2f cursorUi) const;

    // T-INVRD-pdf-rewrite — PDF-conformant overlay rects (PDF reference:
    // examples/designOne/inventory_example.cpp). The title/count chips are
    // now drawn as ui::UiChip badges anchored on the panel's top edge (see
    // InventoryRenderer), so this class only owns the uniform cell grid:
    //   - cellRect        : one uniform square cell at (row, column);
    //                       any item kind may occupy any cell.
    sf::FloatRect cellRect(int rowIndex, int columnIndex) const;
    // Merged 2-cell rect for a weapon at primarySlotIndex.
    // Height spans primarySlot + the shadow slot directly below (including gap).
    sf::FloatRect weaponRect(int primarySlotIndex) const;

private:
    int   inventoryRows;
    int   inventoryColumns;
    float inventorySlotSize;
    float inventorySlotPadding;
    float panelPadding;
    float panelTopOffset;
    float powderColumnWidth;
    float horizontalMargin;
    float gridLeftRatio;
    float gridRightRatio;
    float gridTopRatio;
    float gridBottomRatio;
    float gridColumnGap;
    float gridRowGap;
    float controlLeftRatio;
    float controlRightRatio;
    float controlTopRatio;
    float controlHeightRatio;
    float controlGapRatio;
    float powderListTopRatio;
    float powderListBottomRatio;
    float powderListLeftRatio;
    float powderListWidthRatio;
    // T-INV-good-parity — vertical reserve at the top of the panel for
    // the inline "◆ INVENTORY" title row + sort-tab strip + count badge
    // row. Scales with `adaptiveScale`. The powder column + slot grid
    // slide down by this amount, and `panelRect` grows accordingly.
    float topBandHeight;
    float footerHeight;
    sf::Vector2u screenSize;
    float sidebarWidth;
    float bottomReservation;   // bottom info-bar height + margin to avoid overlap
    float adaptiveScale{1.0f};
    sf::Vector2f dragOffsetValue{0.0f, 0.0f};
    sf::Vector2f deployOffsetValue{0.0f, 0.0f};

    void recomputeAdaptiveScale();
    sf::FloatRect controlButtonRect(int buttonIndex) const;
};

}
