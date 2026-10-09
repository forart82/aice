#include "render/ItemInspectorTab.hpp"

#include "core/World.hpp"
#include "entities/Dice.hpp"
#include "entities/FloorItem.hpp"
#include "entities/QualityTier.hpp"
#include "entities/Weapon.hpp"
#include "hubs/InventoryHub.hpp"
#include "hubs/InventoryItem.hpp"
#include "hubs/WeaponSlotHub.hpp"
#include "render/DebugPanel.hpp"
#include "render/EntityInspectorExpand.hpp"
#include "render/EntityInspectorTab.hpp"
#include "render/ui/UiDivider.hpp"
#include "render/ui/UiLabel.hpp"
#include "render/ui/UiPanel.hpp"

#include "helpers/StringHelper.hpp"

#include <algorithm>
#include <sstream>

namespace dof::render {

std::string formatWeaponInventoryRow(int slotIndex, const dof::entities::Weapon& weapon) {
    std::ostringstream out;
    out << "[Inv " << slotIndex << "] \"" << weapon.displayName() << "\""
        << "  Type "  << dof::entities::weaponTypeName(weapon.type())
        << "  Lv "    << weapon.itemLevel()
        << "  Q "     << dof::entities::qualityTierName(weapon.tier())
        << " (q "     << weapon.qualityScore() << ")"
        << "  Dmg "   << weapon.baseDamage()
        << "  Aps "   << weapon.attacksPerSecond()
        << "  Range " << weapon.rangeable().range
        << "  Slots " << weapon.slotCount();
    return out.str();
}

std::string formatWeaponSlotRow(int rowIndex, const dof::entities::Weapon& weapon) {
    std::ostringstream out;
    out << "[Slot " << rowIndex << "] \"" << weapon.displayName() << "\""
        << "  Type "  << dof::entities::weaponTypeName(weapon.type())
        << "  Lv "    << weapon.itemLevel()
        << "  Q "     << dof::entities::qualityTierName(weapon.tier())
        << " (q "     << weapon.qualityScore() << ")"
        << "  Dmg "   << weapon.baseDamage()
        << "  Aps "   << weapon.attacksPerSecond()
        << "  Range " << weapon.rangeable().range
        << "  Slots " << weapon.slotCount();
    return out.str();
}

std::string formatWeaponFloorRow(const dof::entities::Weapon& weapon) {
    std::ostringstream out;
    out << "[Floor] \"" << weapon.displayName() << "\""
        << "  Type "  << dof::entities::weaponTypeName(weapon.type())
        << "  Lv "    << weapon.itemLevel()
        << "  Q "     << dof::entities::qualityTierName(weapon.tier())
        << " (q "     << weapon.qualityScore() << ")"
        << "  Dmg "   << weapon.baseDamage()
        << "  Aps "   << weapon.attacksPerSecond()
        << "  Range " << weapon.rangeable().range
        << "  Slots " << weapon.slotCount();
    return out.str();
}

std::string formatDiceInventoryRow(int slotIndex, const dof::entities::Dice& dice) {
    std::ostringstream out;
    out << "[Inv " << slotIndex << "] " << dof::entities::diceFaceLabel(dice.face())
        << "  Lv "   << dice.itemLevel()
        << "  Q "    << dof::entities::qualityTierName(dice.tier())
        << " (q "    << dice.qualityScore() << ")"
        << "  Val "  << dice.faceValue(dice.currentFace())
        << "  Face " << dice.currentFace() << "/" << dice.faceCount()
        << "  Mult " << dice.damageMultiplier()
        << "  Crit " << dice.crit() << " @ " << static_cast<int>(dice.critChance() * 100.0f) << "%"
        << "  Luck " << dice.luck();
    return out.str();
}

std::string formatDiceCellRow(int rowIndex, int cellIndex, const dof::entities::Dice& dice) {
    std::ostringstream out;
    out << "[Slot " << rowIndex << "." << cellIndex << "] "
        << dof::entities::diceFaceLabel(dice.face())
        << "  Lv "   << dice.itemLevel()
        << "  Q "    << dof::entities::qualityTierName(dice.tier())
        << " (q "    << dice.qualityScore() << ")"
        << "  Val "  << dice.faceValue(dice.currentFace())
        << "  Face " << dice.currentFace() << "/" << dice.faceCount()
        << "  Mult " << dice.damageMultiplier()
        << "  Crit " << dice.crit() << " @ " << static_cast<int>(dice.critChance() * 100.0f) << "%"
        << "  Luck " << dice.luck();
    return out.str();
}

std::string formatDiceFloorRow(const dof::entities::Dice& dice) {
    std::ostringstream out;
    out << "[Floor] " << dof::entities::diceFaceLabel(dice.face())
        << "  Lv "   << dice.itemLevel()
        << "  Q "    << dof::entities::qualityTierName(dice.tier())
        << " (q "    << dice.qualityScore() << ")"
        << "  Mult " << dice.damageMultiplier()
        << "  Crit " << dice.crit() << " @ " << static_cast<int>(dice.critChance() * 100.0f) << "%"
        << "  Luck " << dice.luck();
    return out.str();
}

std::string formatFloorItemDetailedLine(const dof::entities::FloorItem& item) {
    std::ostringstream out;
    const auto pos = item.position();
    out << "[Floor #" << item.id().value << "]"
        << "  at (" << static_cast<int>(pos.x) << ", " << static_cast<int>(pos.y) << ")"
        << "  ";
    if (item.kind() == dof::entities::FloorItemKind::Weapon && item.weapon()) {
        const auto* weapon = item.weapon();
        out << "Weapon \"" << weapon->displayName() << "\""
            << "  Type "  << dof::entities::weaponTypeName(weapon->type())
            << "  Lv "    << weapon->itemLevel()
            << "  Q "     << dof::entities::qualityTierName(weapon->tier())
            << " (q "     << weapon->qualityScore() << ")"
            << "  Dmg "   << weapon->baseDamage()
            << "  Aps "   << weapon->attacksPerSecond()
            << "  Slots " << weapon->slotCount();
    } else if (item.kind() == dof::entities::FloorItemKind::Dice && item.dice()) {
        const auto* dice = item.dice();
        out << "Dice " << dof::entities::diceFaceLabel(dice->face())
            << "  Lv "   << dice->itemLevel()
            << "  Q "    << dof::entities::qualityTierName(dice->tier())
            << " (q "    << dice->qualityScore() << ")"
            << "  Mult " << dice->damageMultiplier()
            << "  Luck " << dice->luck();
    } else {
        out << "Empty";
    }
    return out.str();
}

namespace {

// Table-chrome painter shared by Weapons / Dices / Floor tabs.
// Mirrors EntityInspectorTab_Render.cpp's expand-drawer scaffolding.
struct ItemTablePainter {
    sf::RenderWindow&            window;
    const DebugPanelRects&       rects;
    const sf::Font&              font;
    unsigned                     textSize;
    sf::Color                    textColor;
    int                          scrollOffset;
    const ItemTabExpandContext&  expand;
    std::vector<EntityInspectorRowBand>* outRowBands{nullptr};

    float lineHeight{0.0f};
    float padX{12.0f};
    float padY{8.0f};
    float y{0.0f};
    int   totalLineCount{0};
    int   rowOrdinal{0};
    int   itemRowOrdinal{0};
    int   maxCharsPerLine{20};

    void begin() {
        lineHeight = static_cast<float>(textSize) + 4.0f;
        y = rects.bodyY() + padY;
        const float approx = std::max(1.0f, static_cast<float>(textSize) * 0.55f);
        maxCharsPerLine = std::max(20, static_cast<int>(
            (rects.panelWidth - 2.0f * padX) / approx));
        ui::UiPanel{expand.zebraEvenBg, sf::Color::Transparent, 0.0f}
            .draw(window, {{rects.panelX, rects.bodyY()},
                           {rects.panelWidth, rects.bodyHeight()}});
    }

    void paintWrapped(const std::vector<std::string>& wrapped,
                       sf::Color rowBg, bool drawDivider) {
        const float rowHeight = lineHeight * static_cast<float>(wrapped.size());
        const bool rowVisible = (y < rects.bodyBottom())
                              && (totalLineCount + static_cast<int>(wrapped.size()) > scrollOffset);
        if (rowVisible) {
            ui::UiPanel{rowBg, sf::Color::Transparent, 0.0f}
                .draw(window, {{rects.panelX, y}, {rects.panelWidth, rowHeight}});
            if (drawDivider)
                ui::UiDivider{expand.rowDivider}
                    .drawHorizontal(window, rects.panelX, y + rowHeight - 1.0f,
                                    rects.panelWidth);
        }
        for (const auto& line : wrapped) {
            const int idx = totalLineCount++;
            if (idx < scrollOffset) continue;
            if (y + lineHeight > rects.bodyBottom()) continue;
            ui::UiLabel{textColor, textSize, ui::TextAlign::Left}
                .draw(window, {{rects.panelX + padX, y},
                               {rects.panelWidth - padX, lineHeight}},
                      font, line);
            y += lineHeight;
        }
    }

    void header(const std::string& text) {
        const auto wrapped = wrapTextByCharCount(text, maxCharsPerLine);
        const sf::Color rowBg = (rowOrdinal % 2 == 0)
            ? expand.zebraEvenBg : expand.zebraOddBg;
        paintWrapped(wrapped, rowBg, /*drawDivider*/ true);
        ++rowOrdinal;
    }

    void row(const std::string& text, const std::vector<std::string>& drawerLines) {
        const float bandTop = y;
        const auto wrapped = wrapTextByCharCount(text, maxCharsPerLine);
        const bool hasDrawer = !drawerLines.empty();
        const int  thisItemIndex = itemRowOrdinal;
        const bool isExpanded = hasDrawer && (thisItemIndex == expand.expandedRowIndex);
        const sf::Color rowBg = isExpanded
            ? expand.drawerBg
            : ((rowOrdinal % 2 == 0) ? expand.zebraEvenBg : expand.zebraOddBg);
        paintWrapped(wrapped, rowBg, /*drawDivider*/ true);

        if (isExpanded) {
            const int revealed = revealedDrawerLineCount(
                expand.animSeconds, expand.animDurationSeconds,
                static_cast<int>(drawerLines.size()));
            for (int i = 0; i < revealed; ++i) {
                const auto wrappedDrawer = wrapTextByCharCount(
                    drawerLines[i], maxCharsPerLine);
                paintWrapped(wrappedDrawer, expand.drawerBg, /*drawDivider*/ (i == revealed - 1));
            }
        }
        const float bandBottom = y;
        if (hasDrawer) {
            if (outRowBands) outRowBands->push_back({thisItemIndex, bandTop, bandBottom});
            ++itemRowOrdinal;
        }
        ++rowOrdinal;
    }
};

}  // anonymous namespace

int drawWeaponsInspectorTab(sf::RenderWindow& window,
                             const DebugPanelRects& rects,
                             const dof::core::World& world,
                             const dof::hubs::InventoryHub* inventoryHub,
                             const dof::hubs::WeaponSlotHub* weaponSlotHub,
                             const sf::Font& font,
                             unsigned textSize,
                             sf::Color textColor,
                             int scrollOffset,
                             const ItemTabExpandContext& expand,
                             const std::string& searchQuery,
                             std::vector<EntityInspectorRowBand>* outRowBands) {
    const std::string lowerQ = searchQuery.empty() ? "" : dof::helpers::toLower(searchQuery);
    auto matchesQuery = [&](const std::string& rowText) {
        if (lowerQ.empty()) return true;
        return dof::helpers::toLower(rowText).find(lowerQ) != std::string::npos;
    };

    if (outRowBands) outRowBands->clear();
    ItemTablePainter painter{window, rects, font, textSize, textColor,
                              scrollOffset, expand, outRowBands};
    painter.begin();

    painter.header("== EQUIPPED (SIDEBAR) ==");
    if (weaponSlotHub) {
        for (int row = 0; row < weaponSlotHub->rowCount(); ++row) {
            const auto* weapon = weaponSlotHub->peek(row);
            if (weapon) {
                const std::string rowText = formatWeaponSlotRow(row, *weapon);
                if (matchesQuery(rowText))
                    painter.row(rowText, buildWeaponsDrawerLines(weapon));
            }
        }
    }

    painter.header("== INVENTORY ==");
    if (inventoryHub) {
        for (int slot = 0; slot < inventoryHub->slotCount(); ++slot) {
            const auto* item = inventoryHub->peekItem(slot);
            if (item && item->isWeapon()) {
                const std::string rowText = formatWeaponInventoryRow(slot, *item->weapon);
                if (matchesQuery(rowText))
                    painter.row(rowText, buildWeaponsDrawerLines(item->weapon.get()));
            }
        }
    }

    painter.header("== FLOOR ==");
    for (const auto& itemPtr : world.floorItems()) {
        if (!itemPtr) continue;
        if (itemPtr->kind() != dof::entities::FloorItemKind::Weapon) continue;
        if (const auto* weapon = itemPtr->weapon()) {
            const std::string rowText = formatWeaponFloorRow(*weapon);
            if (matchesQuery(rowText))
                painter.row(rowText, buildWeaponsDrawerLines(weapon));
        }
    }
    return painter.totalLineCount;
}

int drawDicesInspectorTab(sf::RenderWindow& window,
                           const DebugPanelRects& rects,
                           const dof::core::World& world,
                           const dof::hubs::InventoryHub* inventoryHub,
                           const dof::hubs::WeaponSlotHub* weaponSlotHub,
                           const sf::Font& font,
                           unsigned textSize,
                           sf::Color textColor,
                           int scrollOffset,
                           const ItemTabExpandContext& expand,
                           const std::string& searchQuery,
                           std::vector<EntityInspectorRowBand>* outRowBands) {
    const std::string lowerQ = searchQuery.empty() ? "" : dof::helpers::toLower(searchQuery);
    auto matchesQuery = [&](const std::string& rowText) {
        if (lowerQ.empty()) return true;
        return dof::helpers::toLower(rowText).find(lowerQ) != std::string::npos;
    };

    if (outRowBands) outRowBands->clear();
    ItemTablePainter painter{window, rects, font, textSize, textColor,
                              scrollOffset, expand, outRowBands};
    painter.begin();

    painter.header("== SLOTTED (SIDEBAR CELLS) ==");
    if (weaponSlotHub) {
        for (int row = 0; row < weaponSlotHub->rowCount(); ++row) {
            for (int cell = 0; cell < weaponSlotHub->diceCellsPerRow(); ++cell) {
                const auto* dice = weaponSlotHub->peekDice(row, cell);
                if (dice) {
                    const std::string rowText = formatDiceCellRow(row, cell, *dice);
                    if (matchesQuery(rowText))
                        painter.row(rowText, buildDicesDrawerLines(dice));
                }
            }
        }
    }

    painter.header("== INVENTORY ==");
    if (inventoryHub) {
        for (int slot = 0; slot < inventoryHub->slotCount(); ++slot) {
            const auto* item = inventoryHub->peekItem(slot);
            if (item && item->isDice()) {
                const std::string rowText = formatDiceInventoryRow(slot, *item->dice);
                if (matchesQuery(rowText))
                    painter.row(rowText, buildDicesDrawerLines(item->dice.get()));
            }
        }
    }

    painter.header("== FLOOR ==");
    for (const auto& itemPtr : world.floorItems()) {
        if (!itemPtr) continue;
        if (itemPtr->kind() != dof::entities::FloorItemKind::Dice) continue;
        if (const auto* dice = itemPtr->dice()) {
            const std::string rowText = formatDiceFloorRow(*dice);
            if (matchesQuery(rowText))
                painter.row(rowText, buildDicesDrawerLines(dice));
        }
    }
    return painter.totalLineCount;
}

int drawFloorItemsInspectorTab(sf::RenderWindow& window,
                                 const DebugPanelRects& rects,
                                 const dof::core::World& world,
                                 const sf::Font& font,
                                 unsigned textSize,
                                 sf::Color textColor,
                                 int scrollOffset,
                                 const ItemTabExpandContext& expand,
                                 const std::string& searchQuery,
                                 std::vector<EntityInspectorRowBand>* outRowBands) {
    const std::string lowerQ = searchQuery.empty() ? "" : dof::helpers::toLower(searchQuery);
    auto matchesQuery = [&](const std::string& rowText) {
        if (lowerQ.empty()) return true;
        return dof::helpers::toLower(rowText).find(lowerQ) != std::string::npos;
    };

    if (outRowBands) outRowBands->clear();
    ItemTablePainter painter{window, rects, font, textSize, textColor,
                              scrollOffset, expand, outRowBands};
    painter.begin();

    painter.header("== FLOOR ITEMS ==");
    int weaponCount = 0;
    int diceCount   = 0;
    for (const auto& itemPtr : world.floorItems()) {
        if (!itemPtr) continue;
        if (itemPtr->kind() == dof::entities::FloorItemKind::Weapon) ++weaponCount;
        else if (itemPtr->kind() == dof::entities::FloorItemKind::Dice) ++diceCount;
    }
    {
        std::ostringstream counts;
        counts << "Weapons " << weaponCount << "   Dices " << diceCount
               << "   Total " << (weaponCount + diceCount);
        painter.header(counts.str());
    }
    for (const auto& itemPtr : world.floorItems()) {
        if (!itemPtr) continue;
        const std::string rowText = formatFloorItemDetailedLine(*itemPtr);
        if (matchesQuery(rowText))
            painter.row(rowText, buildFloorDrawerLines(itemPtr.get()));
    }
    return painter.totalLineCount;
}

}
