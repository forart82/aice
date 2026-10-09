#include "render/InventoryRenderer.hpp"

#include "entities/Dice.hpp"
#include "entities/PowderColor.hpp"
#include "hubs/InventoryHub.hpp"
#include "hubs/InventoryItem.hpp"
#include "hubs/PowderHub.hpp"
#include "loaders/ConfigLoader.hpp"
#include "loaders/ShaderLoader.hpp"
#include "render/DiceColor.hpp"
#include "render/InventoryLayout.hpp"
#include "render/ShapeShaders.hpp"
#include "render/UiState.hpp"
#include "render/WeaponColors.hpp"
#include "render/WeaponSprite.hpp"
#include "render/ui/PixelSnap.hpp"

#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/ConvexShape.hpp>
#include <SFML/Graphics/Shader.hpp>
#include <SFML/Graphics/Sprite.hpp>

#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Text.hpp>

#include <algorithm>
#include <cstdint>
#include <string>
#include <stdexcept>

namespace dof::render {

namespace {

sf::Color powderSfColor(const dof::loaders::ConfigLoader& cfg,
                        dof::entities::PowderColor color) {
    const char* base = "POWDER_COLOR_YELLOW";
    switch (color) {
        case dof::entities::PowderColor::Red:     base = "POWDER_COLOR_RED";     break;
        case dof::entities::PowderColor::Yellow:  base = "POWDER_COLOR_YELLOW";  break;
        case dof::entities::PowderColor::Cyan:    base = "POWDER_COLOR_CYAN";    break;
        case dof::entities::PowderColor::Green:   base = "POWDER_COLOR_GREEN";   break;
        case dof::entities::PowderColor::Blue:    base = "POWDER_COLOR_BLUE";    break;
        case dof::entities::PowderColor::Magenta: base = "POWDER_COLOR_MAGENTA"; break;
        case dof::entities::PowderColor::Purple:  base = "POWDER_COLOR_PURPLE";  break;
        case dof::entities::PowderColor::Orange:  base = "POWDER_COLOR_ORANGE";  break;
        case dof::entities::PowderColor::Pink:    base = "POWDER_COLOR_PINK";    break;
        case dof::entities::PowderColor::White:   base = "POWDER_COLOR_WHITE";   break;
        case dof::entities::PowderColor::Black:   base = "POWDER_COLOR_BLACK";   break;
    }
    return readRgbPrefixed(cfg, base);
}

void drawCockpitPanel(sf::RenderWindow& window,
                      sf::FloatRect rect,
                      float chamfer,
                      sf::Color fill,
                      sf::Color edge) {
    const float cut = std::clamp(chamfer, 0.0f, std::min(rect.size.x, rect.size.y) * 0.25f);
    sf::ConvexShape body(8);
    body.setPoint(0, {rect.position.x + cut, rect.position.y});
    body.setPoint(1, {rect.position.x + rect.size.x - cut, rect.position.y});
    body.setPoint(2, {rect.position.x + rect.size.x, rect.position.y + cut});
    body.setPoint(3, {rect.position.x + rect.size.x, rect.position.y + rect.size.y - cut});
    body.setPoint(4, {rect.position.x + rect.size.x - cut, rect.position.y + rect.size.y});
    body.setPoint(5, {rect.position.x + cut, rect.position.y + rect.size.y});
    body.setPoint(6, {rect.position.x, rect.position.y + rect.size.y - cut});
    body.setPoint(7, {rect.position.x, rect.position.y + cut});
    body.setFillColor(fill);
    body.setOutlineColor(edge);
    body.setOutlineThickness(1.0f);
    window.draw(body);
}

void drawInventoryFrame(sf::RenderWindow& window,
                        sf::FloatRect rect,
                        float chamfer,
                        float innerInset,
                        float railLength,
                        sf::Color fill,
                        sf::Color edge,
                        sf::Color rail,
                        sf::Color copper,
                        bool isTwoCell,
                        bool isOccupied,
                        bool isHovered) {
    sf::Color activeEdge = isHovered ? rail : edge;
    drawCockpitPanel(window, rect, chamfer, fill, activeEdge);

    // Empty bays keep one quiet manufactured outline. Occupied, hovered, and
    // two-cell bays gain the inset bezel, so content state reads without every
    // empty cell becoming a dense double-line box.
    if (isOccupied || isHovered || isTwoCell) {
        const sf::FloatRect inner{{rect.position.x + innerInset, rect.position.y + innerInset},
                                  {rect.size.x - innerInset * 2.0f, rect.size.y - innerInset * 2.0f}};
        sf::Color innerEdge = isOccupied ? rail : edge;
        innerEdge.a = static_cast<std::uint8_t>(
            std::min(255, static_cast<int>(innerEdge.a) + (isHovered ? 70 : 0)));
        drawCockpitPanel(window, inner, std::max(1.0f, chamfer - innerInset),
                         sf::Color::Transparent, innerEdge);
    }

    const float clampedRail = std::min(railLength, rect.size.x * 0.45f);
    const float yTop = rect.position.y + innerInset;
    const float yBottom = rect.position.y + rect.size.y - innerInset - 1.0f;
    ui::drawThinQuad(window, {{rect.position.x + rect.size.x * 0.5f - clampedRail * 0.5f, yTop},
                              {clampedRail, 1.0f}}, isOccupied ? rail : edge);
    ui::drawThinQuad(window, {{rect.position.x + rect.size.x * 0.5f - clampedRail * 0.5f, yBottom},
                              {clampedRail, 1.0f}}, isOccupied ? rail : edge);

    if (isTwoCell) {
        const float spineX = rect.position.x + innerInset;
        const float spineHeight = std::max(0.0f, rect.size.y - chamfer * 2.0f);
        ui::drawThinQuad(window, {{spineX, rect.position.y + chamfer}, {1.0f, spineHeight}}, copper);
        ui::drawThinQuad(window, {{rect.position.x + rect.size.x - innerInset - 1.0f,
                                   rect.position.y + chamfer}, {1.0f, spineHeight}}, copper);
    }
}

} // namespace

InventoryRenderer::InventoryRenderer(const dof::loaders::ConfigLoader& cfg,
                                               const ColorTheme& t,
                                               const sf::Font& f,
                                               const dof::loaders::ShaderLoader* shaders)
    : font{f}
    , config{cfg}
    , theme{t}
    , accent{UiAccent::loadFromConfig(cfg)}
    // Border + thickness are set from the canonical accent in the ctor body
    // (lines below), so the panel starts border-less here — the old
    // INVENTORY_PANEL_BORDER_* keys were dead (always overwritten) and are gone.
    , panel{resolvePanelBackground(cfg, "INVENTORY_PANEL_BG"),
            sf::Color::Transparent, 0.0f}
    , powderList{readRgb(cfg, "INVENTORY_LIST_ROW_BG_R",  "INVENTORY_LIST_ROW_BG_G",  "INVENTORY_LIST_ROW_BG_B"),
                 readRgb(cfg, "INVENTORY_LIST_ROW_ALT_R", "INVENTORY_LIST_ROW_ALT_G", "INVENTORY_LIST_ROW_ALT_B"),
                 accent.dim(),
                 theme.uiText,
                 cfg.getFloat("INVENTORY_LIST_ROW_HEIGHT")}
    , accentColor{accent.full()}
    , scrimColor{readRgba(cfg, "INVENTORY_SCRIM_R", "INVENTORY_SCRIM_G", "INVENTORY_SCRIM_B", "INVENTORY_SCRIM_A")}
    , destroyFlashColor{readRgb(cfg, "INVENTORY_DESTROY_FLASH_R",
                                    "INVENTORY_DESTROY_FLASH_G",
                                    "INVENTORY_DESTROY_FLASH_B")}
    , flashInitialSeconds{cfg.getFloat("INVENTORY_DESTROY_FLASH_SECONDS")}
    , deployOpenSeconds{cfg.getFloat("INVENTORY_DEPLOY_OPEN_SECONDS")}
    , deployCloseSeconds{cfg.getFloat("INVENTORY_DEPLOY_CLOSE_SECONDS")}
    , shadersPtr{shaders}
{
    // Accent-styled outline so the inventory frame reads from the same
    // catalog as the weapon-slot sidebar (mirrors WeaponSlotSidebar). Set
    // in the body — `accent` is declared before `panel`, but composing the
    // border here keeps the dependency explicit and avoids init-order traps.
    panel.border          = readRgba(cfg, "INVENTORY_COCKPIT_EDGE_R", "INVENTORY_COCKPIT_EDGE_G",
                                         "INVENTORY_COCKPIT_EDGE_B", "INVENTORY_COCKPIT_EDGE_A");
    panel.borderThickness = accent.thicknessOutline;

    const std::string cockpitTexturePath = cfg.getString("INVENTORY_COCKPIT_TEXTURE");
    if (!cockpitTexture.loadFromFile(cockpitTexturePath)) {
        throw std::runtime_error("Failed to load inventory cockpit texture: " + cockpitTexturePath);
    }

    // Canonical dice chip — the same widgets::UiDiceCell the weapon-slot
    // sidebar draws, so a stored die reads identically to an equipped one.
    // Only the inventory-specific label typography/translucency and the
    // static-context countdown suppression are overridden; the hex-radius
    // factors stay at the shared UiDiceCell defaults for a matching shape.
    diceCell.labelColor        = theme.uiText;
    diceCell.faceValueFontSize = static_cast<unsigned>(cfg.getInt("INVENTORY_DICE_FACE_FONT_SIZE"));
    diceCell.fallbackFillAlpha = cfg.getInt("INVENTORY_DICE_GLYPH_FILL_ALPHA");
    diceCell.showCountdownBar  = false;
}

void InventoryRenderer::render(sf::RenderWindow& window,
                                    const dof::hubs::InventoryHub& hub,
                                    InventoryLayout& layout,
                                    const dof::hubs::PowderHub* powderHub,
                                    const UiState& uiState) {
    shouldDeployOpen = uiState.isInventoryOpen;
    if (!shouldDeployOpen && deployProgress <= 0.0f) return;
    layout.setDeployOffset({0.0f, 0.0f});
    const float panelHeight = layout.panelRect().size.y;
    const float eased = deployProgress * deployProgress * (3.0f - 2.0f * deployProgress);
    layout.setDeployOffset({0.0f, panelHeight * (1.0f - eased)});
    drawScrim(window, layout);

    const sf::View originalView = window.getView();
    sf::View clippedView = originalView;
    const float revealFraction = std::clamp(
        layout.infobarTopY() / originalView.getSize().y, 0.0f, 1.0f);
    clippedView.setScissor(sf::FloatRect{{0.0f, 0.0f}, {1.0f, revealFraction}});
    window.setView(clippedView);
    drawPanel(window, layout);
    drawSortButtons(window, layout, hub, uiState);
    drawPowderColumn(window, layout, powderHub, uiState);
    drawSlots(window, hub, layout, uiState);
    drawActionHint(window, layout);
    drawDragPayload(window, uiState);
    window.setView(originalView);
}

void InventoryRenderer::drawScrim(sf::RenderWindow& window,
                                       const InventoryLayout& layout) {
    if (scrimColor.a == 0) return;
    const auto ws = layout.windowSize();
    // Full-window dim behind the panel — a UiPanel with no outline so the
    // scrim comes from the same fill/pixel-snap path as every other panel.
    sf::Color animatedScrim = scrimColor;
    animatedScrim.a = static_cast<std::uint8_t>(
        static_cast<float>(animatedScrim.a) * deployProgress);
    ui::UiPanel scrim{animatedScrim, sf::Color::Transparent, 0.f};
    scrim.draw(window, sf::FloatRect{{0.f, 0.f},
                                     {static_cast<float>(ws.x), static_cast<float>(ws.y)}});
}

void InventoryRenderer::drawPanel(sf::RenderWindow& window,
                                       const InventoryLayout& layout) {
    const auto rect = layout.panelRect();
    const sf::Color edge = readRgba(config, "INVENTORY_COCKPIT_EDGE_R", "INVENTORY_COCKPIT_EDGE_G",
                                            "INVENTORY_COCKPIT_EDGE_B", "INVENTORY_COCKPIT_EDGE_A");
    drawCockpitPanel(window, rect, config.getFloat("INVENTORY_COCKPIT_CHAMFER"),
                     panel.background, edge);

    sf::Sprite cockpitFrame(cockpitTexture);
    const auto textureSize = cockpitTexture.getSize();
    cockpitFrame.setPosition(rect.position);
    cockpitFrame.setScale({rect.size.x / static_cast<float>(textureSize.x),
                           rect.size.y / static_cast<float>(textureSize.y)});
    cockpitFrame.setColor(sf::Color{255, 255, 255, static_cast<std::uint8_t>(
        std::clamp(config.getInt("INVENTORY_COCKPIT_TEXTURE_ALPHA"), 0, 255))});
    window.draw(cockpitFrame);
}

void InventoryRenderer::drawSortButtons(sf::RenderWindow& window,
                                              const InventoryLayout& layout,
                                              const dof::hubs::InventoryHub& hub,
                                              const UiState& uiState) {
    static const char* labels[3] = {"BY TIER", "BY TYPE", "AUTO"};
    const bool autoOn = hub.isAutoSortEnabled();
    for (int i = 0; i < 3; ++i) {
        const auto rect = layout.sortButtonRect(i);
        if (rect.size.x <= 0.f) continue;
        const bool isHov = uiState.hover.kind == HoverTargetKind::SortButton
                           && uiState.hover.rowIndex == i;
        const bool isActive = i == 2 && autoOn;
        ui::UiLabel{(isHov || isActive) ? sf::Color::White : accentColor,
                    static_cast<unsigned>(config.getFloat("INVENTORY_LABEL_FONT_SIZE")),
                    ui::TextAlign::Center}.draw(window, rect, font, labels[i]);
    }
}

void InventoryRenderer::drawPowderColumn(sf::RenderWindow& window,
                                               const InventoryLayout& layout,
                                               const dof::hubs::PowderHub* powderHub,
                                               const UiState& uiState) {
    const sf::Color tierColors[3] = {theme.tierCommon, theme.tierUncommon, theme.tierRare};
    static const char* tierLabels[3] = {"COMMON", "UNCOMM", "RARE"};

    for (int i = 0; i < 3; ++i) {
        const auto rect = layout.destroyButtonRect(i);
        if (rect.size.x <= 0.f) continue;
        const bool isHov = uiState.hover.kind == HoverTargetKind::DestroyButton
                           && uiState.hover.rowIndex == i;
        const float flashT = flashSecondsByTier[i] / std::max(flashInitialSeconds, 0.001f);
        sf::Color fill = tierColors[i];
        if (flashT > 0.f) {
            const float t = std::clamp(flashT, 0.f, 1.f);
            fill.r = static_cast<std::uint8_t>(fill.r + (destroyFlashColor.r - fill.r) * t);
            fill.g = static_cast<std::uint8_t>(fill.g + (destroyFlashColor.g - fill.g) * t);
            fill.b = static_cast<std::uint8_t>(fill.b + (destroyFlashColor.b - fill.b) * t);
        }
        ui::UiLabel{isHov ? sf::Color::White : fill,
                    static_cast<unsigned>(config.getFloat("INVENTORY_LABEL_FONT_SIZE")),
                    ui::TextAlign::Center}.draw(window, rect, font, tierLabels[i]);
    }

    if (!powderHub) return;
    const auto stackArea = layout.powderStackAreaRect();
    std::vector<ui::UiListRow> rows;
    rows.push_back(ui::UiListRow{"POWDER  " + std::to_string(powderHub->totalCount()),
                                 readRgb(config, "INVENTORY_POWDER_HEADER_R",
                                         "INVENTORY_POWDER_HEADER_G", "INVENTORY_POWDER_HEADER_B"),
                                 false});
    for (const auto& stack : powderHub->allStacks()) {
        if (stack.count <= 0) continue;
        const std::string name{dof::entities::powderColorName(stack.color)};
        // Replaces the generic gray tint with the actual color loaded from configuration
        // to make the powder column visually distinct and premium.
        rows.push_back(ui::UiListRow{name + "  " + std::to_string(stack.count),
                                     powderSfColor(config, stack.color), false});
    }
    powderList.draw(window, stackArea, font,
                    static_cast<unsigned>(config.getFloat("INVENTORY_LABEL_FONT_SIZE")), rows);
}

void InventoryRenderer::drawSlots(sf::RenderWindow& window,
                                  const dof::hubs::InventoryHub& hub,
                                  const InventoryLayout& layout,
                                  const UiState& uiState) {
    for (int i = 0; i < hub.slotCount(); ++i) {
        const auto* item = hub.peekItem(i);
        if (item && item->isWeaponShadow()) continue;
        const bool isWeapon = item && item->isWeapon();
        const auto rect = isWeapon ? layout.weaponRect(i) : layout.slotRect(i);
        if (rect.size.x <= 0.f) continue;

        const bool isHov = uiState.hover.kind == HoverTargetKind::InventorySlot
                           && uiState.hover.rowIndex == i;
        const bool hasItem = item && !item->isEmpty();

        sf::Color edge = readRgba(config, "INVENTORY_COCKPIT_EDGE_R", "INVENTORY_COCKPIT_EDGE_G",
                                         "INVENTORY_COCKPIT_EDGE_B", "INVENTORY_COCKPIT_CELL_EDGE_A");
        const sf::Color rail = readRgba(config, "INVENTORY_COCKPIT_RAIL_R", "INVENTORY_COCKPIT_RAIL_G",
                                                "INVENTORY_COCKPIT_RAIL_B", "INVENTORY_COCKPIT_RAIL_A");
        const sf::Color copper = readRgba(config, "INVENTORY_COCKPIT_COPPER_R", "INVENTORY_COCKPIT_COPPER_G",
                                                  "INVENTORY_COCKPIT_COPPER_B", "INVENTORY_COCKPIT_COPPER_A");
        drawInventoryFrame(window, rect,
                           config.getFloat(isWeapon ? "INVENTORY_TWO_CELL_FRAME_CHAMFER"
                                                    : "INVENTORY_ONE_CELL_FRAME_CHAMFER") * layout.effectiveScale(),
                           config.getFloat("INVENTORY_CELL_FRAME_INNER_INSET") * layout.effectiveScale(),
                           config.getFloat("INVENTORY_CELL_FRAME_RAIL_LENGTH") * layout.effectiveScale(),
                           resolvePanelBackground(config, "INVENTORY_CELL_BG"), edge, rail, copper,
                           isWeapon, hasItem, isHov);

        if (!hasItem) continue;

        if (isWeapon) {
            drawWeaponGlyph(window, rect, item->weapon->type());
            const sf::FloatRect nameRect{
                {rect.position.x + 2.f, rect.position.y + rect.size.y - 16.f},
                {rect.size.x - 4.f, 14.f}};
            ui::UiLabel{theme.uiText,
                        static_cast<unsigned>(config.getInt("INVENTORY_ITEM_LABEL_FONT_SIZE")),
                        ui::TextAlign::Left}
                .draw(window, nameRect, font, item->weapon->displayName().substr(0, 8));
            // Equipped-flag: cyan corner triangle when weapon has attached dice.
            const auto& attached = item->weapon->attachedDicePeek();
            if (!attached.empty()) {
                constexpr float flag = 8.f;
                sf::ConvexShape corner;
                corner.setPointCount(3);
                corner.setPoint(0, {rect.position.x + rect.size.x - flag, rect.position.y});
                corner.setPoint(1, {rect.position.x + rect.size.x,        rect.position.y});
                corner.setPoint(2, {rect.position.x + rect.size.x,        rect.position.y + flag});
                corner.setFillColor(accentColor);
                window.draw(corner);
                constexpr float dotR = 3.f, gap = 2.f;
                float dotX = rect.position.x + dotR + 3.f;
                const float dotY = rect.position.y + dotR + 3.f;
                for (const auto& d : attached) {
                    if (!d) continue;
                    sf::CircleShape dot(dotR, 8);
                    dot.setOrigin({dotR, dotR});
                    dot.setPosition({dotX, dotY});
                    dot.setFillColor(diceColorForFace(config, d->face()));
                    dot.setOutlineThickness(1.f);
                    dot.setOutlineColor(theme.uiText);
                    window.draw(dot);
                    dotX += dotR * 2.f + gap;
                }
            }
        } else {
            drawDiceGlyph(window, rect, *item->dice);
        }
    }
}

void InventoryRenderer::drawWeaponGlyph(sf::RenderWindow& window,
                                        const sf::FloatRect& rect,
                                        dof::entities::WeaponType type) {
    const float pad = std::max(4.f, rect.size.x * 0.10f);
    const float labelReserve = std::max(12.f, rect.size.y * 0.18f);
    const sf::FloatRect inner{{rect.position.x + pad, rect.position.y + pad},
                              {rect.size.x - pad * 2.f, rect.size.y - pad * 2.f - labelReserve}};
    // V3 source art runs bottom-left to top-right. Rotate that authored axis
    // upright so the weapon fills the tall two-cell inventory bay cleanly.
    drawWeaponSprite(window, inner, type, config, sf::Color::White, -45.0f);
}

void InventoryRenderer::drawDiceGlyph(sf::RenderWindow& window,
                                      const sf::FloatRect& rect,
                                      const dof::entities::Dice& dice) {
    const auto color = diceColorForFace(config, dice.face());
    // Reconstruct the historical glyph box — a square centred a few pixels
    // above the cell centre so a bottom band stays clear for the face-name
    // label — and hand it to the canonical widgets::UiDiceCell instead of
    // hand-drawing a square. The widget supplies the shared shader-die look
    // (fallback hex when the "die" shader is absent) plus the centred
    // face-value label, so an inventoried die matches an equipped one. Passing
    // this box rather than the full cell keeps the die at its established
    // inventory size and clear of the label; the ctor already suppressed the
    // countdown strip (a stored die is static, not counting down).
    const float pad = std::max(config.getFloat("INVENTORY_DICE_GLYPH_PAD_MIN"),
                               rect.size.x * config.getFloat("INVENTORY_DICE_GLYPH_PAD_FACTOR"));
    const float size = std::min(rect.size.x, rect.size.y) - pad * 2.f;
    const float yOffset = config.getFloat("INVENTORY_DICE_GLYPH_CENTER_Y_OFFSET");
    const sf::FloatRect glyphRect{
        {rect.position.x + rect.size.x * 0.5f - size * 0.5f,
         rect.position.y + rect.size.y * 0.5f - yOffset - size * 0.5f},
        {size, size}};
    diceCell.draw(window, glyphRect, &dice, color,
                  /*isCharged=*/false, color, font, shadersPtr, shapeShaders);

    // Face-name strip ("D6") anchored bottom-left of the cell — an inventory
    // labelling concern the dice widget does not own, kept as before.
    const sf::FloatRect labelRect{
        {rect.position.x + 2.f, rect.position.y + rect.size.y - 16.f},
        {rect.size.x - 4.f, 14.f}};
    ui::UiLabel{color, static_cast<unsigned>(config.getInt("INVENTORY_ITEM_LABEL_FONT_SIZE")),
                ui::TextAlign::Left}
        .draw(window, labelRect, font, std::string(dof::entities::diceFaceLabel(dice.face())));
}

void InventoryRenderer::drawDragPayload(sf::RenderWindow& window,
                                        const UiState& uiState) {
    if (!uiState.drag.isActive()) return;
    const auto& payload = uiState.drag.payload;
    if (payload.isEmpty()) return;

    const sf::Vector2f pos = ui::pixelSnap(uiState.drag.cursorUi);
    if (payload.isWeapon()) {
        const sf::FloatRect ghostRect{{pos.x - 30.f, pos.y - 30.f}, {60.f, 60.f}};
        const auto type = payload.weapon->type();
        drawWeaponSprite(window, ghostRect, type, config,
                         sf::Color{255, 255, 255, 220});
        const auto& attached = payload.weapon->attachedDicePeek();
        if (!attached.empty()) {
            constexpr float dotR = 4.f, gap = 2.f;
            float dotX = ghostRect.position.x + dotR + 2.f;
            const float dotY = ghostRect.position.y + dotR + 2.f;
            for (const auto& d : attached) {
                if (!d) continue;
                sf::CircleShape dot(dotR, 8);
                dot.setOrigin({dotR, dotR});
                dot.setPosition({dotX, dotY});
                dot.setFillColor(diceColorForFace(config, d->face()));
                dot.setOutlineThickness(1.f);
                dot.setOutlineColor(theme.uiText);
                window.draw(dot);
                dotX += dotR * 2.f + gap;
            }
        }
        return;
    }
    if (payload.isDice()) {
        const auto color = diceColorForFace(config, payload.dice->face());
        sf::CircleShape ghost(28.f, 6);
        ghost.setOrigin({28.f, 28.f});
        ghost.setPosition(pos);
        sf::Color fill = color;
        fill.a = static_cast<std::uint8_t>(config.getInt("INVENTORY_DRAG_GHOST_FILL_ALPHA"));
        ghost.setFillColor(fill);
        ghost.setOutlineThickness(2.f);
        ghost.setOutlineColor(color);
        window.draw(ghost);
    }
}

void InventoryRenderer::drawActionHint(sf::RenderWindow& window,
                                       const InventoryLayout& layout) {
    const auto panelRect = layout.panelRect();
    const float scale = layout.effectiveScale();
    const float hintHeight = config.getFloat("INVENTORY_HINT_HEIGHT") * scale;
    const float padX = config.getFloat("INVENTORY_HINT_PADDING_X") * scale;
    const sf::FloatRect hintRect{
        {panelRect.position.x + padX,
         panelRect.position.y + panelRect.size.y - hintHeight - 4.0f * scale},
        {panelRect.size.x - padX * 2.0f, hintHeight}};

    sf::Color fill = panel.background;
    fill.a = static_cast<std::uint8_t>(config.getInt("INVENTORY_HINT_BG_ALPHA"));
    const sf::Color edge = readRgba(config, "INVENTORY_COCKPIT_EDGE_R", "INVENTORY_COCKPIT_EDGE_G",
                                            "INVENTORY_COCKPIT_EDGE_B", "INVENTORY_COCKPIT_EDGE_A");
    ui::UiPanel hintPanel{fill, edge, accent.thicknessHairline};
    hintPanel.draw(window, hintRect);

    const sf::Color copper = readRgba(config, "INVENTORY_COCKPIT_COPPER_R",
                                              "INVENTORY_COCKPIT_COPPER_G",
                                              "INVENTORY_COCKPIT_COPPER_B",
                                              "INVENTORY_COCKPIT_COPPER_A");
    ui::UiLabel{copper,
                static_cast<unsigned>(config.getInt("INVENTORY_HINT_FONT_SIZE")),
                ui::TextAlign::Center}
        .draw(window, hintRect, font, config.getString("INVENTORY_HINT_TEXT"));
}

void InventoryRenderer::advance(float dt) {
    const float duration = shouldDeployOpen ? deployOpenSeconds : deployCloseSeconds;
    const float step = dt / std::max(0.001f, duration);
    deployProgress = std::clamp(
        deployProgress + (shouldDeployOpen ? step : -step), 0.0f, 1.0f);
    for (int i = 0; i < 3; ++i)
        flashSecondsByTier[i] = std::max(0.f, flashSecondsByTier[i] - dt);
}

void InventoryRenderer::triggerDestroyFlash(int tierIndex) {
    if (tierIndex < 0 || tierIndex >= 3) return;
    flashSecondsByTier[tierIndex] = flashInitialSeconds;
}

float InventoryRenderer::flashSecondsForTier(int tierIndex) const {
    if (tierIndex < 0 || tierIndex >= 3) return 0.f;
    return flashSecondsByTier[tierIndex];
}

} // namespace dof::render
