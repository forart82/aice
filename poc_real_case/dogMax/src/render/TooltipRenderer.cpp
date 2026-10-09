#include "render/TooltipRenderer.hpp"

#include "core/World.hpp"
#include "entities/Dice.hpp"
#include "entities/FloorItem.hpp"
#include "entities/QualityTier.hpp"
#include "entities/Weapon.hpp"
#include "hubs/InventoryHub.hpp"
#include "hubs/WeaponSlotHub.hpp"
#include "loaders/ConfigLoader.hpp"
#include "loaders/ShaderLoader.hpp"
#include "render/ItemDescriptions.hpp"
#include "render/UiAccent.hpp"
#include "render/UiState.hpp"

#include <SFML/Graphics/RenderWindow.hpp>

namespace dof::render {

TooltipRenderer::TooltipRenderer(const dof::loaders::ConfigLoader& config, const ColorTheme& themeInit, const sf::Font& fontInit,
                                 const dof::loaders::ShaderLoader* shaders)
    : theme(themeInit), font(fontInit), shadersPtr(shaders),
      isGlowEnabled(config.getInt("UI_GLOW_ENABLE") != 0) {
    // Single-accent chrome: the tooltip frame reads the canonical UI accent
    // like every other framed panel (was a distinct TOOLTIP_BORDER blue). The
    // title/body colours collapse onto the theme text tokens (title→uiText,
    // body→uiDim) — the old per-tooltip TOOLTIP_TITLE/BODY triples are gone.
    // The static title colour is only a fallback: renderTooltipLines overrides
    // it with the hovered item's TIER colour on every call (gameplay identity),
    // so this value is never actually shown for a real item.
    const auto accent = UiAccent::loadFromConfig(config);
    // Neon glow uses the canonical accent hue (dark-blue UI_ACCENT).
    glowColor  = accent.full();
    glowSpread = config.getFloat("UI_GLOW_SPREAD");
    glowLayers = config.getInt("UI_GLOW_LAYERS");
    glowAlpha  = config.getFloat("UI_GLOW_ALPHA");
    tooltip_.panel.background      = resolvePanelBackground(config, "TOOLTIP_BG");
    tooltip_.panel.border          = accent.full();
    tooltip_.panel.borderThickness = accent.thicknessOutline;
    tooltip_.titleColor  = theme.uiText;
    tooltip_.bodyColor   = theme.uiDim;
    tooltip_.labelColor  = theme.uiDim;
    tooltip_.valueColor  = theme.uiText;
    tooltip_.sectionColor = accent.full();
    tooltip_.ruleColor    = accent.dim();
    tooltip_.badgeTextColor = theme.uiText;
    tooltip_.badgeBgColor   = accent.dim();
    tooltip_.padding       = config.getFloat("TOOLTIP_PADDING");
    tooltip_.maxWidth      = config.getFloat("TOOLTIP_MAX_W");
    tooltip_.titleFontSize = config.getFloat("TOOLTIP_TITLE_FONT_SIZE");
    tooltip_.bodyFontSize  = config.getFloat("TOOLTIP_LINE_FONT_SIZE");
    tooltip_.lineHeight    = config.getFloat("TOOLTIP_LINE_HEIGHT");
    tooltip_.titleBodyGap  = config.getFloat("TOOLTIP_TITLE_BODY_GAP");
    tooltip_.rowLabelWidth = config.getFloat("TOOLTIP_ROW_LABEL_WIDTH");
    tooltip_.badgeWidth    = config.getFloat("TOOLTIP_BADGE_WIDTH");
    tooltip_.sectionGap    = config.getFloat("TOOLTIP_SECTION_GAP");
    tooltip_.emptyLineHeight = config.getFloat("TOOLTIP_EMPTY_LINE_HEIGHT");
}

sf::Color TooltipRenderer::tierColor(dof::entities::QualityTier tier) const {
    switch (tier) {
        case dof::entities::QualityTier::Common:   return theme.tierCommon;
        case dof::entities::QualityTier::Uncommon: return theme.tierUncommon;
        case dof::entities::QualityTier::Rare:     return theme.tierRare;
    }
    return theme.tierCommon;
}

void TooltipRenderer::render(sf::RenderWindow& window,
                             const UiState& uiState,
                             const dof::hubs::InventoryHub& inventoryHub,
                             const dof::hubs::WeaponSlotHub& weaponSlotHub,
                             const dof::core::World& world) {
    if (uiState.drag.isActive()) return;
    if (uiState.hover.kind == HoverTargetKind::DestroyButton) {
        const int tierIndex = uiState.hover.rowIndex;
        if (tierIndex < 0 || tierIndex > 2) return;
        const std::array<std::string, 3> tierLabels{
            std::string("Common"), std::string("Uncommon"), std::string("Rare")};
        const auto lines = describeDestroyButton(tierIndex, inventoryHub, tierLabels);
        if (lines.empty()) return;
        const auto tier = tierIndex == 0 ? dof::entities::QualityTier::Common
                        : tierIndex == 1 ? dof::entities::QualityTier::Uncommon
                                         : dof::entities::QualityTier::Rare;
        std::string title = "Destroy " + tierLabels[static_cast<size_t>(tierIndex)];
        renderTooltipLines(window, title, lines, uiState.mouseUi, tierColor(tier));
        return;
    }
    if (uiState.hover.kind == HoverTargetKind::InventorySlot) {
        const auto* item = inventoryHub.peekItem(uiState.hover.rowIndex);
        if (!item || item->isEmpty()) return;
        if (item->isWeapon()) {
            renderTooltipLines(window, item->weapon->displayName(),
                               describeWeapon(*item->weapon),
                               uiState.mouseUi,
                               tierColor(item->weapon->tier()));
        } else if (item->isDice()) {
            renderTooltipLines(window, item->dice->displayName(),
                               describeDice(*item->dice),
                               uiState.mouseUi,
                               tierColor(item->dice->tier()));
        }
        return;
    }
    if (uiState.hover.kind == HoverTargetKind::WeaponRow) {
        const auto* weapon = weaponSlotHub.peek(uiState.hover.rowIndex);
        if (weapon) renderTooltipLines(window, weapon->displayName(), describeWeapon(*weapon), uiState.mouseUi, tierColor(weapon->tier()));
        return;
    }
    if (uiState.hover.kind == HoverTargetKind::DiceCell) {
        const auto* dice = weaponSlotHub.peekDice(uiState.hover.rowIndex, uiState.hover.cellIndex);
        if (dice) renderTooltipLines(window, dice->displayName(), describeDice(*dice), uiState.mouseUi, tierColor(dice->tier()));
        return;
    }
    if (uiState.hover.kind == HoverTargetKind::FloorItem) {
        const auto& floorItems = world.floorItems();
        for (const auto& floorItem : floorItems) {
            if (!floorItem) continue;
            if (floorItem->id() != uiState.hover.floorItemId) continue;
            if (floorItem->pickupable().isPickedUp) return;
            if (floorItem->kind() == dof::entities::FloorItemKind::Weapon) {
                const auto* weapon = floorItem->weapon();
                if (!weapon) return;
                renderTooltipLines(window, weapon->displayName(),
                                   describeWeapon(*weapon),
                                   uiState.mouseUi,
                                   tierColor(weapon->tier()));
                return;
            }
            const auto* dice = floorItem->dice();
            if (!dice) return;
            renderTooltipLines(window, dice->displayName(),
                               describeDice(*dice),
                               uiState.mouseUi,
                               tierColor(dice->tier()));
            return;
        }
    }
}

void TooltipRenderer::renderTooltipLines(sf::RenderWindow& window, const std::string& title,
                                         const std::vector<std::string>& lines, sf::Vector2f anchorUi,
                                         sf::Color titleColor) {
    std::string body;
    for (std::size_t i = 0; i < lines.size(); ++i) {
        if (i > 0) body += '\n';
        body += lines[i];
    }
    auto faint = titleColor;
    faint.a = 95;
    auto wash = titleColor;
    wash.a = 32;
    tooltip_.titleColor = titleColor;
    tooltip_.panel.border = titleColor;
    tooltip_.sectionColor = titleColor;
    tooltip_.ruleColor = faint;
    tooltip_.badgeTextColor = titleColor;
    tooltip_.badgeBgColor = wash;
    tooltip_.draw(window, anchorUi, font, title, body, window.getView().getSize(),
                  isGlowEnabled, titleColor, glowSpread, glowLayers, glowAlpha);
}

}
