#include "render/EnemyDesignEditor.hpp"

#include "render/EnemyDesignEditorShared.hpp"
#include "render/UiState.hpp"
#include "render/ui/UiPanel.hpp"
#include "render/ui/UiScrollPanel.hpp"

#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/View.hpp>

#include <algorithm>
#include <array>
#include <string>

namespace dof::render {

using namespace dof::render::editor;

namespace {

// The 10 effect shaders selectable in the picker, alphabetical.
constexpr std::array<const char*, 10> kShaderNames = {
    "effect_bolt", "effect_flame", "effect_glow", "effect_orb",
    "effect_ring", "effect_shatter", "effect_slash", "effect_smoke",
    "effect_spark", "effect_vortex"};

std::string motionToken(dof::entities::EffectMotion m) {
    switch (m) {
        case dof::entities::EffectMotion::Orbit: return "Orbit";
        case dof::entities::EffectMotion::Popup: return "Popup";
        default:                                 return "Static";
    }
}

dof::entities::EffectMotion nextMotion(dof::entities::EffectMotion m) {
    using M = dof::entities::EffectMotion;
    switch (m) {
        case M::Static: return M::Orbit;
        case M::Orbit:  return M::Popup;
        default:        return M::Static;
    }
}

dof::entities::EffectMotion prevMotion(dof::entities::EffectMotion m) {
    using M = dof::entities::EffectMotion;
    switch (m) {
        case M::Static: return M::Popup;
        case M::Orbit:  return M::Static;
        default:        return M::Orbit;
    }
}

std::string truncate(const std::string& s, std::size_t n) {
    return s.size() <= n ? s : s.substr(0, n);
}

// Per-layer control slot ids. Each numeric control occupies one slot; its
// inc rect lives at 2*slot in rects.layerButtons, its dec rect at 2*slot+1.
// Slots 0 (shader) and 1 (motion) are special single-/double-action rows.
enum LayerSlot : std::uint8_t {
    SlotZ = 2, SlotColorR, SlotColorG, SlotColorB, SlotSize, SlotVariant,
    SlotSpeed, SlotIntensity,
    SlotP0, SlotP1, SlotP2,        // motion-specific params (1..3)
    SlotCount
};

std::uint8_t stepByte(std::uint8_t v, int step) {
    return static_cast<std::uint8_t>(std::clamp(static_cast<int>(v) + step, 0, 255));
}

} // namespace

void EnemyDesignEditor::renderLayerList(sf::RenderWindow& window,
                                        const sf::View& uiView, UiState& uiState,
                                        sf::FloatRect listRect, float /*elapsed*/) {
    auto& tier = currentTierDesign(currentTierIndex);

    // Header + Add button.
    drawLabel(window, fontRef, {{listRect.position.x, listRect.position.y}, {listRect.size.x - 90.f, 24.f}},
              "EFFECT LAYERS", ui::TextAlign::Left, 15u, palette_.accent);
    rects.addLayerButton = {{listRect.position.x + listRect.size.x - 84.f, listRect.position.y}, {84.f, 24.f}};
    drawButton(window, fontRef, palette_,rects.addLayerButton, "+ Add",
               contains(rects.addLayerButton, uiState.mouseUi));

    // Scrollable list of layers (top half of the column).
    const float listTop = listRect.position.y + 32.f;
    const float listH = std::min(listRect.size.y * 0.38f,
                                 static_cast<float>(tier.layers.size()) * kListItemH + 8.f);
    sf::FloatRect scrollRect{{listRect.position.x, listTop},
                             {listRect.size.x, std::max(listH, 60.f)}};
    layerScrollRect_ = scrollRect;
    ui::UiPanel{palette_.panelFill, palette_.panelOutline, 1.f}.draw(window, scrollRect);

    const float contentH = static_cast<float>(tier.layers.size()) * kListItemH + 8.f;
    uiState.enemyEditorLayerScroll =
        ui::UiScrollPanel::clampOffset(uiState.enemyEditorLayerScroll, contentH, scrollRect.size.y);

    const sf::View saved = window.getView();
    ui::UiScrollPanel::applyClipView(window, scrollRect, uiView, uiState.enemyEditorLayerScroll);

    rects.layerItems.clear();
    const float scroll = uiState.enemyEditorLayerScroll;
    // Content at raw coords; applyClipView applies the scroll. Hit-test rects
    // stored in on-screen coords (content - scroll).
    float y = scrollRect.position.y + 4.f;
    for (std::size_t i = 0; i < tier.layers.size(); ++i) {
        const auto& layer = tier.layers[i];
        sf::FloatRect contentRect{{scrollRect.position.x + 4.f, y},
                                  {scrollRect.size.x - 8.f, kListItemH - 2.f}};
        rects.layerItems.push_back(
            {{contentRect.position.x, contentRect.position.y - scroll}, contentRect.size});
        if (static_cast<int>(i) == uiState.enemyEditorLayerIndex)
            ui::UiPanel{palette_.selected, palette_.panelOutline, 1.f}.draw(window, contentRect);
        std::string label = std::to_string(i) + "  " + truncate(layer.shaderName, 14) +
                            "  " + motionToken(layer.motion) + "  z" + std::to_string(layer.z);
        drawLabel(window, fontRef,
                  {{contentRect.position.x + 8.f, contentRect.position.y}, {contentRect.size.x - 8.f, contentRect.size.y}},
                  label, ui::TextAlign::Left, 12u, palette_.text);
        y += kListItemH;
    }
    window.setView(saved);
    ui::UiScrollPanel::drawScrollbar(window, scrollRect, uiState.enemyEditorLayerScroll,
                                     contentH, 6.f, palette_.accent);

    // Per-layer controls below the list (only when a valid layer is selected).
    rects.layerButtons.assign(2u * static_cast<std::size_t>(SlotCount), sf::FloatRect{});
    rects.removeLayerButton = sf::FloatRect{};
    const int li = uiState.enemyEditorLayerIndex;
    if (li < 0 || li >= static_cast<int>(tier.layers.size()))
        return;
    auto& layer = tier.layers[static_cast<std::size_t>(li)];

    const float x = listRect.position.x;
    const float w = listRect.size.x;
    float cy = scrollRect.position.y + scrollRect.size.y + 12.f;
    const float btnW = 34.f;
    const float valW = 84.f;

    // A numeric [-] value [+] row.
    auto numeric = [&](const std::string& label, const std::string& value, int slot) {
        drawLabel(window, fontRef, {{x, cy}, {160.f, kRowH}}, label, ui::TextAlign::Left, 12u, palette_.text);
        sf::FloatRect incR{{x + w - btnW, cy}, {btnW, kRowH - 4.f}};
        sf::FloatRect valR{{incR.position.x - valW - 6.f, cy}, {valW, kRowH - 4.f}};
        sf::FloatRect decR{{valR.position.x - btnW - 6.f, cy}, {btnW, kRowH - 4.f}};
        drawButton(window, fontRef, palette_,decR, "-", contains(decR, uiState.mouseUi));
        ui::UiPanel{palette_.buttonBg, palette_.panelOutline, 1.f}.draw(window, valR);
        drawLabel(window, fontRef, valR, value, ui::TextAlign::Center, 12u, palette_.text);
        drawButton(window, fontRef, palette_,incR, "+", contains(incR, uiState.mouseUi));
        const auto sidx = static_cast<std::size_t>(slot) * 2;
        rects.layerButtons[sidx]     = incR;
        rects.layerButtons[sidx + 1] = decR;
        cy += kRowH;
    };

    // Shader row (single full-width toggle that opens the picker).
    sf::FloatRect shaderR{{x, cy}, {w, kRowH - 4.f}};
    drawButton(window, fontRef, palette_,shaderR,
               "< SHADER >  " + layer.shaderName, contains(shaderR, uiState.mouseUi));
    rects.layerButtons[0] = shaderR;  // slot 0 inc-rect == the toggle
    cy += kRowH;

    // Motion row (◄/► cycle).
    drawLabel(window, fontRef, {{x, cy}, {160.f, kRowH}}, "Motion", ui::TextAlign::Left, 12u, palette_.text);
    sf::FloatRect motNext{{x + w - btnW, cy}, {btnW, kRowH - 4.f}};
    sf::FloatRect motVal{{motNext.position.x - valW - 6.f, cy}, {valW, kRowH - 4.f}};
    sf::FloatRect motPrev{{motVal.position.x - btnW - 6.f, cy}, {btnW, kRowH - 4.f}};
    drawButton(window, fontRef, palette_,motPrev, "<", contains(motPrev, uiState.mouseUi));
    ui::UiPanel{palette_.buttonBg, palette_.panelOutline, 1.f}.draw(window, motVal);
    drawLabel(window, fontRef, motVal, motionToken(layer.motion), ui::TextAlign::Center, 12u, palette_.text);
    drawButton(window, fontRef, palette_,motNext, ">", contains(motNext, uiState.mouseUi));
    rects.layerButtons[2] = motNext;  // slot 1 inc == next motion
    rects.layerButtons[3] = motPrev;  // slot 1 dec == prev motion (same cycle)
    cy += kRowH;

    numeric("Z", std::to_string(layer.z), SlotZ);
    numeric("Color R", std::to_string(layer.color.r), SlotColorR);
    numeric("Color G", std::to_string(layer.color.g), SlotColorG);
    numeric("Color B", std::to_string(layer.color.b), SlotColorB);
    numeric("Size", formatFloat(layer.size), SlotSize);
    numeric("Variant", std::to_string(layer.variant), SlotVariant);
    numeric("Speed", formatFloat(layer.speed), SlotSpeed);
    numeric("Intensity", formatFloat(layer.intensity), SlotIntensity);

    using M = dof::entities::EffectMotion;
    if (layer.motion == M::Static) {
        numeric("Offset X", formatFloat(layer.offsetX), SlotP0);
        numeric("Offset Y", formatFloat(layer.offsetY), SlotP1);
    } else if (layer.motion == M::Orbit) {
        numeric("Orbit Radius", formatFloat(layer.orbitRadius), SlotP0);
        numeric("Orbit Speed", formatFloat(layer.orbitSpeedDeg), SlotP1);
        numeric("Orbit Phase", formatFloat(layer.orbitPhaseDeg), SlotP2);
    } else { // Popup
        numeric("Popup Radius", formatFloat(layer.popupRadius), SlotP0);
        numeric("Popup Interval", formatFloat(layer.popupInterval), SlotP1);
        numeric("Popup Lifetime", formatFloat(layer.popupLifetime), SlotP2);
    }

    rects.removeLayerButton = {{x, cy + 6.f}, {160.f, kRowH}};
    drawButton(window, fontRef, palette_,rects.removeLayerButton, "Remove Layer",
               contains(rects.removeLayerButton, uiState.mouseUi));
}

void EnemyDesignEditor::renderShaderPicker(sf::RenderWindow& window, UiState& uiState,
                                           sf::FloatRect pickerRect) {
    ui::UiPanel{palette_.panelFill, palette_.accent, 2.f}.draw(window, pickerRect);
    drawLabel(window, fontRef,
              {{pickerRect.position.x + 16.f, pickerRect.position.y + 10.f}, {pickerRect.size.x - 80.f, 30.f}},
              "PICK SHADER", ui::TextAlign::Left, 18u, palette_.accent);
    rects.shaderPickerClose = {{pickerRect.position.x + pickerRect.size.x - 46.f, pickerRect.position.y + 10.f}, {34.f, 30.f}};
    drawButton(window, fontRef, palette_,rects.shaderPickerClose, "X", contains(rects.shaderPickerClose, uiState.mouseUi));

    // 2-column grid of 10 names.
    rects.shaderPickerItems.clear();
    const float gridX = pickerRect.position.x + 16.f;
    const float gridY = pickerRect.position.y + 56.f;
    const float cellW = (pickerRect.size.x - 48.f) / 2.f;
    const float cellH = 64.f;
    for (std::size_t i = 0; i < kShaderNames.size(); ++i) {
        const std::size_t icol = i % 2u;
        const std::size_t irow = i / 2u;
        sf::FloatRect cell{{gridX + static_cast<float>(icol) * (cellW + 16.f),
                            gridY + static_cast<float>(irow) * (cellH + 12.f)}, {cellW, cellH}};
        rects.shaderPickerItems.push_back(cell);
        drawButton(window, fontRef, palette_,cell, kShaderNames[i], contains(cell, uiState.mouseUi));
    }
}

void EnemyDesignEditor::handleLayerClick(sf::Vector2f uiPos, UiState& uiState) {
    auto& tier = currentTierDesign(currentTierIndex);

    // Add layer.
    if (contains(rects.addLayerButton, uiPos)) {
        dof::entities::EnemyEffectLayer fresh;
        fresh.shaderName = "effect_glow";
        fresh.motion = dof::entities::EffectMotion::Static;
        fresh.z = 0;
        fresh.color = sf::Color::White;
        fresh.size = 40.f;
        fresh.variant = 0;
        fresh.speed = 1.f;
        fresh.intensity = 1.f;
        tier.layers.push_back(fresh);
        uiState.enemyEditorLayerIndex = static_cast<int>(tier.layers.size()) - 1;
        pushEdit();
        return;
    }

    // Select a layer (only within the visible scroll viewport).
    if (contains(layerScrollRect_, uiPos)) {
        for (std::size_t i = 0; i < rects.layerItems.size(); ++i) {
            if (contains(rects.layerItems[i], uiPos)) {
                uiState.enemyEditorLayerIndex = static_cast<int>(i);
                return;
            }
        }
    }

    const int li = uiState.enemyEditorLayerIndex;
    if (li < 0 || li >= static_cast<int>(tier.layers.size()))
        return;

    // Remove layer.
    if (contains(rects.removeLayerButton, uiPos)) {
        tier.layers.erase(tier.layers.begin() + li);
        uiState.enemyEditorLayerIndex = -1;
        pushEdit();
        return;
    }

    auto& layer = tier.layers[static_cast<std::size_t>(li)];

    // Shader toggle (slot 0).
    if (contains(rects.layerButtons[0], uiPos)) {
        uiState.enemyEditorShaderPickerOpen = true;
        return;
    }
    // Motion cycle (slot 1: > next, < previous).
    if (contains(rects.layerButtons[2], uiPos)) {
        layer.motion = nextMotion(layer.motion);
        pushEdit();
        return;
    }
    if (contains(rects.layerButtons[3], uiPos)) {
        layer.motion = prevMotion(layer.motion);
        pushEdit();
        return;
    }

    // Numeric inc/dec controls.
    for (int slot = SlotZ; slot < SlotCount; ++slot) {
        const auto uidx = static_cast<std::size_t>(slot) * 2;
        const bool inc = contains(rects.layerButtons[uidx], uiPos);
        const bool dec = contains(rects.layerButtons[uidx + 1], uiPos);
        if (!inc && !dec)
            continue;
        const int sign = inc ? 1 : -1;
        const float fsign = static_cast<float>(sign);
        using M = dof::entities::EffectMotion;
        switch (slot) {
            case SlotZ:         layer.z += sign; break;
            case SlotColorR:    layer.color.r = stepByte(layer.color.r, sign * 8); break;
            case SlotColorG:    layer.color.g = stepByte(layer.color.g, sign * 8); break;
            case SlotColorB:    layer.color.b = stepByte(layer.color.b, sign * 8); break;
            case SlotSize:      layer.size = std::max(0.f, layer.size + fsign * 4.f); break;
            case SlotVariant:   layer.variant = std::clamp(layer.variant + sign, 0, 9); break;
            case SlotSpeed:     layer.speed = std::clamp(layer.speed + fsign * 0.1f, 0.1f, 5.f); break;
            case SlotIntensity: layer.intensity = std::clamp(layer.intensity + fsign * 0.1f, 0.1f, 5.f); break;
            case SlotP0:
                if (layer.motion == M::Static)      layer.offsetX += fsign * 5.f;
                else if (layer.motion == M::Orbit)  layer.orbitRadius = std::max(0.f, layer.orbitRadius + fsign * 5.f);
                else                                layer.popupRadius = std::max(0.f, layer.popupRadius + fsign * 5.f);
                break;
            case SlotP1:
                if (layer.motion == M::Static)      layer.offsetY += fsign * 5.f;
                else if (layer.motion == M::Orbit)  layer.orbitSpeedDeg += fsign * 10.f;
                else                                layer.popupInterval = std::max(0.f, layer.popupInterval + fsign * 0.1f);
                break;
            case SlotP2:
                if (layer.motion == M::Orbit)       layer.orbitPhaseDeg += fsign * 15.f;
                else if (layer.motion == M::Popup)  layer.popupLifetime = std::max(0.f, layer.popupLifetime + fsign * 0.1f);
                break;
            default: break;
        }
        pushEdit();
        return;
    }
}

} // namespace dof::render
