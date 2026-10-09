#include "render/EntityInspectorTab.hpp"

#include "core/World.hpp"
#include "entities/Enemy.hpp"
#include "entities/FloorItem.hpp"
#include "entities/Hero.hpp"
#include "entities/Weapon.hpp"
#include "hubs/EvasionHub.hpp"
#include "hubs/LuckHub.hpp"
#include "hubs/WeaponSlotHub.hpp"
#include "render/DebugPanel.hpp"
#include "render/EntityInspectorExpand.hpp"
#include "render/ui/UiDivider.hpp"
#include "render/ui/UiLabel.hpp"
#include "render/ui/UiPanel.hpp"

#include "helpers/StringHelper.hpp"

#include <algorithm>
#include <sstream>

// SFML rendering for the debug Entity inspector. The pure, render-free
// formatters and roster/DPS math live in EntityInspectorTab.cpp; this
// translation unit owns the table-chrome scaffolding (zebra rows,
// dividers, word-wrap painting, scroll clamp) and the three tab entry
// points (drawGeneralTab / drawHeroTab / drawEnemiesTab) that assemble
// formatter output into painted tables.

namespace dof::render {

namespace {

float approxCharWidthFor(unsigned textSize) {
    return std::max(1.0f, static_cast<float>(textSize) * 0.55f);
}

int maxCharsPerLineFor(const DebugPanelRects& rects, unsigned textSize, float padX) {
    const float approx = approxCharWidthFor(textSize);
    return std::max(20, static_cast<int>((rects.panelWidth - 2.0f * padX) / approx));
}

// Shared body painter for General tab. `emit` calls drawLine once per logical row.
template <typename EmitFn>
int paintBodyLines(sf::RenderWindow& window,
                    const DebugPanelRects& rects,
                    const sf::Font& font,
                    unsigned textSize,
                    sf::Color textColor,
                    int scrollOffset,
                    sf::Color rowBgColor,
                    sf::Color rowAltColor,
                    EmitFn emit) {
    ui::UiPanel{rowBgColor, sf::Color::Transparent, 0.0f}
        .draw(window, {{rects.panelX, rects.bodyY()},
                       {rects.panelWidth, rects.bodyHeight()}});

    const float lineHeight = static_cast<float>(textSize) + 4.0f;
    const float padX = 12.0f;
    const float padY = 8.0f;
    float y = rects.bodyY() + padY;
    int totalLineCount = 0;
    int rowOrdinal = 0;
    const int maxCharsPerLine = maxCharsPerLineFor(rects, textSize, padX);

    auto drawLine = [&](const std::string& text) {
        const auto wrapped = wrapTextByCharCount(text, maxCharsPerLine);
        const float rowHeight = lineHeight * static_cast<float>(wrapped.size());
        const bool rowVisible = (y < rects.bodyBottom())
            && (totalLineCount + static_cast<int>(wrapped.size()) > scrollOffset);
        if (rowVisible) {
            ui::UiPanel{(rowOrdinal % 2 == 0) ? rowBgColor : rowAltColor,
                         sf::Color::Transparent, 0.0f}
                .draw(window, {{rects.panelX, y}, {rects.panelWidth, rowHeight}});
            ui::UiDivider{rowAltColor}
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
        ++rowOrdinal;
    };

    emit(drawLine);
    return totalLineCount;
}

}

int drawGeneralTab(sf::RenderWindow& window,
                    const DebugPanelRects& rects,
                    const dof::core::World& world,
                    const dof::hubs::WeaponSlotHub* weaponSlotHub,
                    const sf::Font& font,
                    unsigned textSize,
                    sf::Color textColor,
                    int scrollOffset,
                    sf::Color rowBgColor,
                    sf::Color rowAltColor) {
    return paintBodyLines(window, rects, font, textSize, textColor, scrollOffset,
                          rowBgColor, rowAltColor,
                          [&](auto& drawLine) {
        const auto& hero = world.hero();
        const auto rosterSummary = summariseEnemyRoster(world);

        int floorWeapons = 0, floorDices = 0;
        for (const auto& itemPtr : world.floorItems()) {
            if (!itemPtr) continue;
            if (itemPtr->kind() == dof::entities::FloorItemKind::Weapon) ++floorWeapons;
            else if (itemPtr->kind() == dof::entities::FloorItemKind::Dice) ++floorDices;
        }
        int sidebarWeapons = 0, sidebarDices = 0, equippedWeapons = 0, weaponRows = 0;
        float totalDps = 0.0f;
        if (weaponSlotHub) {
            weaponRows = weaponSlotHub->rowCount();
            for (int row = 0; row < weaponRows; ++row) {
                if (weaponSlotHub->peek(row)) {
                    ++sidebarWeapons;
                    ++equippedWeapons;
                    totalDps += computeRowDps(row, *weaponSlotHub);
                }
                for (int cell = 0; cell < weaponSlotHub->diceCellsPerRow(); ++cell) {
                    if (weaponSlotHub->peekDice(row, cell)) ++sidebarDices;
                }
            }
        }

        const auto& lvl = hero.levelable();
        drawLine("== HERO ==");
        { std::ostringstream s; s << "  Level     " << lvl.level; drawLine(s.str()); }
        { std::ostringstream s; s << "  Health    " << static_cast<int>(hero.damageable().health)
              << " / " << static_cast<int>(hero.damageable().maxHealth); drawLine(s.str()); }
        { std::ostringstream s; s << "  XP        " << lvl.experience
              << " / " << lvl.experienceForNextLevel; drawLine(s.str()); }

        drawLine("== COMBAT ==");
        { std::ostringstream s; s << "  Weapons   " << equippedWeapons
              << " / " << weaponRows << " slots"; drawLine(s.str()); }
        { std::ostringstream s; s << "  Total DPS " << static_cast<int>(totalDps); drawLine(s.str()); }

        drawLine("== ENEMIES ==");
        { std::ostringstream s; s << "  Alive " << rosterSummary.total
              << "    Common " << rosterSummary.common
              << "    Uncommon " << rosterSummary.uncommon
              << "    Rare " << rosterSummary.rare; drawLine(s.str()); }

        drawLine("== LOOT ==");
        { std::ostringstream s; s << "  Floor     weapons " << floorWeapons
              << "    dices " << floorDices; drawLine(s.str()); }
        { std::ostringstream s; s << "  Sidebar   weapons " << sidebarWeapons
              << "    dices " << sidebarDices; drawLine(s.str()); }
    });
}

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
                 const HeroTabExpandContext& expand,
                 std::vector<EntityInspectorRowBand>* outRowBands) {
    if (outRowBands) outRowBands->clear();

    ui::UiPanel{expand.zebraEvenBg, sf::Color::Transparent, 0.0f}
        .draw(window, {{rects.panelX, rects.bodyY()},
                       {rects.panelWidth, rects.bodyHeight()}});

    const float lineHeight = static_cast<float>(textSize) + 4.0f;
    const float padX = 12.0f;
    const float padY = 8.0f;
    float y = rects.bodyY() + padY;
    int totalLineCount = 0;
    int rowOrdinal = 0;
    const int maxCharsPerLine = maxCharsPerLineFor(rects, textSize, padX);

    auto paintWrapped = [&](const std::vector<std::string>& wrapped,
                             sf::Color rowBg, sf::Color textCol, bool drawDivider) {
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
            ui::UiLabel{textCol, textSize, ui::TextAlign::Left}
                .draw(window, {{rects.panelX + padX, y},
                               {rects.panelWidth - padX, lineHeight}},
                      font, line);
            y += lineHeight;
        }
    };

    auto paintHeaderLine = [&](const std::string& text) {
        const auto wrapped = wrapTextByCharCount(text, maxCharsPerLine);
        const sf::Color rowBg = (rowOrdinal % 2 == 0)
            ? expand.zebraEvenBg : expand.zebraOddBg;
        paintWrapped(wrapped, rowBg, textColor, /*drawDivider*/ true);
        ++rowOrdinal;
    };

    const float evasionChancePercent = (evasionHub ? evasionHub->cap() : 0.0f) * 100.0f;
    paintHeaderLine(formatHeroLine(world.hero(), evasionChancePercent));
    if (luckHub) paintHeaderLine(formatHeroLuckLine(luckHub->luckTotal()));
    if (weaponSlotHub) {
        paintHeaderLine("== DPS ==");
        float totalDps = 0.0f;
        for (int row = 0; row < weaponSlotHub->rowCount(); ++row) {
            const auto* weapon = weaponSlotHub->peek(row);
            if (!weapon) continue;
            const float dps = computeRowDps(row, *weaponSlotHub);
            totalDps += dps;
            const float effectiveAps = weapon->baseDamage() > 0.0f
                ? dps / weapon->baseDamage()
                : 0.0f;

            const float bandTop = y;
            const auto wrapped = wrapTextByCharCount(
                formatHeroRowDpsLine(row, weapon->baseDamage(), effectiveAps, dps),
                maxCharsPerLine);
            const bool isExpanded = (row == expand.expandedRowIndex);
            const sf::Color rowBg = isExpanded
                ? expand.drawerBg
                : ((rowOrdinal % 2 == 0) ? expand.zebraEvenBg : expand.zebraOddBg);
            paintWrapped(wrapped, rowBg, textColor, /*drawDivider*/ true);

            if (isExpanded) {
                const auto drawerLines = buildHeroWeaponRowDrawerLines(row, *weapon);
                const int revealed = revealedDrawerLineCount(
                    expand.animSeconds, expand.animDurationSeconds,
                    static_cast<int>(drawerLines.size()));
                for (int i = 0; i < revealed; ++i) {
                    const auto wrappedDrawer = wrapTextByCharCount(drawerLines[i], maxCharsPerLine);
                    paintWrapped(wrappedDrawer, expand.drawerBg, textColor,
                                  /*drawDivider*/ (i == revealed - 1));
                }
            }
            const float bandBottom = y;
            if (outRowBands) outRowBands->push_back({row, bandTop, bandBottom});
            ++rowOrdinal;
        }
        paintHeaderLine(formatHeroTotalDpsLine(totalDps));
    }
    return totalLineCount;
}

int drawEnemiesTab(sf::RenderWindow& window,
                    const DebugPanelRects& rects,
                    const dof::core::World& world,
                    const sf::Font& font,
                    unsigned textSize,
                    sf::Color textColor,
                    int scrollOffset,
                    const EnemiesTabExpandContext& expand,
                    const std::string& searchQuery,
                    std::vector<EntityInspectorRowBand>* outRowBands) {
    if (outRowBands) outRowBands->clear();

    ui::UiPanel{expand.zebraEvenBg, sf::Color::Transparent, 0.0f}
        .draw(window, {{rects.panelX, rects.bodyY()},
                       {rects.panelWidth, rects.bodyHeight()}});

    const float lineHeight = static_cast<float>(textSize) + 4.0f;
    const float padX = 12.0f;
    const float padY = 8.0f;
    float y = rects.bodyY() + padY;
    int totalLineCount = 0;
    int rowOrdinal = 0;
    const int maxCharsPerLine = maxCharsPerLineFor(rects, textSize, padX);

    auto paintWrapped = [&](const std::vector<std::string>& wrapped,
                             sf::Color rowBg, sf::Color textCol, bool drawDivider) {
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
            ui::UiLabel{textCol, textSize, ui::TextAlign::Left}
                .draw(window, {{rects.panelX + padX, y},
                               {rects.panelWidth - padX, lineHeight}},
                      font, line);
            y += lineHeight;
        }
    };

    auto drawHeaderLine = [&](const std::string& text) {
        const auto wrapped = wrapTextByCharCount(text, maxCharsPerLine);
        const sf::Color rowBg = (rowOrdinal % 2 == 0)
            ? expand.zebraEvenBg : expand.zebraOddBg;
        paintWrapped(wrapped, rowBg, textColor, /*drawDivider*/ true);
        ++rowOrdinal;
    };

    drawHeaderLine("== ENEMIES ==");
    const auto rosterSummary = summariseEnemyRoster(world);
    drawHeaderLine(formatEnemySummaryTierLine(rosterSummary));
    drawHeaderLine(formatEnemySummaryBandLine(rosterSummary));

    int enemyRowIndex = 0;
    for (const auto& enemyPtr : world.enemies()) {
        if (!enemyPtr || enemyPtr->deathable().isDead) continue;
        const std::string line = formatEnemyLine(*enemyPtr);
        if (!searchQuery.empty()) {
            const std::string lower  = dof::helpers::toLower(line);
            const std::string lowerQ = dof::helpers::toLower(searchQuery);
            if (lower.find(lowerQ) == std::string::npos) continue;
        }
        const float bandTop = y;
        const auto wrapped = wrapTextByCharCount(line, maxCharsPerLine);
        const bool isExpanded = (enemyRowIndex == expand.expandedRowIndex);
        const sf::Color rowBg = isExpanded
            ? expand.drawerBg
            : ((rowOrdinal % 2 == 0) ? expand.zebraEvenBg : expand.zebraOddBg);
        paintWrapped(wrapped, rowBg, textColor, /*drawDivider*/ true);

        if (isExpanded) {
            const auto drawerLines = buildEnemyDrawerLines(*enemyPtr);
            const int revealed = revealedDrawerLineCount(
                expand.animSeconds, expand.animDurationSeconds,
                static_cast<int>(drawerLines.size()));
            for (int i = 0; i < revealed; ++i) {
                const auto wrappedDrawer = wrapTextByCharCount(drawerLines[i], maxCharsPerLine);
                paintWrapped(wrappedDrawer, expand.drawerBg, textColor,
                              /*drawDivider*/ (i == revealed - 1));
            }
        }
        const float bandBottom = y;
        if (outRowBands) outRowBands->push_back({enemyRowIndex, bandTop, bandBottom});
        ++enemyRowIndex;
        ++rowOrdinal;
    }
    return totalLineCount;
}

}  // namespace dof::render
