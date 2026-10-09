#include "render/EnemyDesignEditor.hpp"

#include "render/ColorTheme.hpp"
#include "render/EnemyDesignEditorShared.hpp"
#include "render/EnemyTemplateWriter.hpp"
#include "render/UiAccent.hpp"
#include "render/UiState.hpp"
#include "render/WorldRenderer.hpp"
#include "render/ui/UiPanel.hpp"
#include "render/ui/UiScrollPanel.hpp"
#include "loaders/ConfigLoader.hpp"

#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/View.hpp>

#include <algorithm>
#include <filesystem>

namespace dof::render {

using namespace dof::render::editor;

namespace {

// Panel geometry (UI design space 1920×1080).
const sf::FloatRect kPanelRect{{60.f, 40.f}, {1800.f, 1000.f}};
constexpr float kPad = 18.f;
constexpr float kTitleH = 44.f;

} // namespace

// Build the editor chrome palette from the canonical UI tokens so the Ctrl+E
// editor reads as the same single dark-blue accent set as every other window
// (no parallel neon-purple accent, no hard-coded chrome literals).
namespace editor {

EditorPalette loadEditorPalette(const dof::loaders::ConfigLoader& config) {
    const UiAccent  accent  = UiAccent::loadFromConfig(config);
    const sf::Color panelBg = resolvePanelBackground(config, "THEME_PANEL_BG");

    EditorPalette palette;
    palette.panelFill    = panelBg;                // canonical dark panel body
    palette.panelOutline = accent.full();          // panel frame reads accent
    palette.accent       = accent.full();          // titles / section labels
    palette.buttonBg     = panelBg;                // button rest fill
    palette.buttonHover  = accent.dim();           // button hover fill
    palette.text         = sf::Color{
        static_cast<std::uint8_t>(config.getInt("THEME_UI_TEXT_R")),
        static_cast<std::uint8_t>(config.getInt("THEME_UI_TEXT_G")),
        static_cast<std::uint8_t>(config.getInt("THEME_UI_TEXT_B"))};
    palette.selected     = accent.full();          // brighter selection state
    return palette;
}

} // namespace editor

EnemyDesignEditor::EnemyDesignEditor(const sf::Font& font,
                                     const dof::loaders::ConfigLoader& config,
                                     WorldRenderer& worldRenderer,
                                     const dof::loaders::ShaderLoader& shaders,
                                     const std::string& templateDir,
                                     const std::string& buildTemplateDir,
                                     float previewSize)
    : fontRef(font),
      palette_(editor::loadEditorPalette(config)),
      worldRendererRef(worldRenderer),
      shadersRef(shaders),
      templateDir(templateDir),
      buildTemplateDir(buildTemplateDir),
      previewSize_(previewSize) {}

void EnemyDesignEditor::loadType(int typeIndex) {
    if (typeIndex < 0 || typeIndex >= static_cast<int>(typeIds.size()))
        return;
    const auto& reg = worldRendererRef.templateRegistry();
    const std::string& id = typeIds[static_cast<std::size_t>(typeIndex)];
    if (reg.has(id))
        currentEdit = reg.get(id);
    currentTypeIndex = typeIndex;
}

void EnemyDesignEditor::pushEdit() {
    worldRendererRef.pushEnemyTemplateEdit(currentEdit);
}

dof::entities::EnemyTierDesign& EnemyDesignEditor::currentTierDesign(int tierIndex) {
    switch (tierIndex) {
        case 1:  return currentEdit.uncommon;
        case 2:  return currentEdit.rare;
        default: return currentEdit.common;
    }
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

void EnemyDesignEditor::render(sf::RenderWindow& window, UiState& uiState,
                               const sf::View& uiView, sf::Vector2f /*viewSize*/,
                               float elapsed) {
    // Lazy first-load / external selection sync.
    if (currentTypeIndex == -1 || typeIds.empty())
        typeIds = worldRendererRef.templateRegistry().ids();
    std::sort(typeIds.begin(), typeIds.end());

    if (currentTypeIndex == -1 && !typeIds.empty())
        loadType(0);
    if (uiState.enemyEditorTypeIndex != currentTypeIndex &&
        uiState.enemyEditorTypeIndex >= 0 &&
        uiState.enemyEditorTypeIndex < static_cast<int>(typeIds.size())) {
        loadType(uiState.enemyEditorTypeIndex);
    }
    uiState.enemyEditorTypeIndex = currentTypeIndex;

    rects = ButtonRects{};

    // Frame.
    ui::UiPanel{palette_.panelFill, palette_.panelOutline, 2.f}.draw(window, kPanelRect);

    const float px = kPanelRect.position.x;
    const float py = kPanelRect.position.y;
    const float pw = kPanelRect.size.x;

    // Title bar.
    drawLabel(window, fontRef,
              {{px + kPad, py + 8.f}, {pw - 200.f, kTitleH - 8.f}},
              "ENEMY DESIGN EDITOR", ui::TextAlign::Left, 22u, palette_.accent);

    rects.closeButton = {{px + pw - kPad - 36.f, py + 8.f}, {36.f, 30.f}};
    drawButton(window, fontRef, palette_,rects.closeButton, "X",
               contains(rects.closeButton, uiState.mouseUi));

    const float contentY = py + kTitleH + 8.f;
    const float contentBottom = py + kPanelRect.size.y - 70.f;

    // --- Left column: type list (280 wide). ---
    const float leftX = px + kPad;
    const float leftW = 280.f;
    drawLabel(window, fontRef, {{leftX, contentY}, {leftW, 24.f}},
              "ENEMY TYPE", ui::TextAlign::Left, 15u, palette_.accent);
    typeListRect_ = {{leftX, contentY + 28.f}, {leftW, contentBottom - (contentY + 28.f)}};
    renderTypeList(window, uiView, uiState, typeListRect_);

    // --- Middle column: tier tabs + body controls (600 wide @ x=340 rel). ---
    const float midX = leftX + leftW + 30.f;
    const float midW = 600.f;
    drawLabel(window, fontRef, {{midX, contentY}, {midW, 24.f}},
              "BODY", ui::TextAlign::Left, 15u, palette_.accent);

    // Tier tabs.
    const float tabW = (midW - 2.f * 10.f) / 3.f;
    const float tabY = contentY + 28.f;
    rects.tierCommon   = {{midX,                    tabY}, {tabW, 32.f}};
    rects.tierUncommon = {{midX + tabW + 10.f,      tabY}, {tabW, 32.f}};
    rects.tierRare     = {{midX + 2.f * (tabW + 10.f), tabY}, {tabW, 32.f}};
    auto drawTab = [&](sf::FloatRect r, const std::string& label, int idx) {
        ui::UiPanel{currentTierIndex == idx ? palette_.selected : palette_.buttonBg,
                             palette_.panelOutline, 1.f}
            .draw(window, r);
        drawLabel(window, fontRef, r, label, ui::TextAlign::Center, 14u, palette_.text);
    };
    drawTab(rects.tierCommon, "Common", 0);
    drawTab(rects.tierUncommon, "Uncommon", 1);
    drawTab(rects.tierRare, "Rare", 2);

    renderBodyControls(window, uiState,
                       {{midX, tabY + 44.f}, {midW, contentBottom - (tabY + 44.f)}});

    // --- Preview: live enemy body below the body controls. ---
    // Body controls span 8×kRowH + 2 gaps of 6 = 252px total.
    const float bodyCtrlH = 8.f * kRowH + 12.f;
    drawLabel(window, fontRef,
              {{midX, tabY + 44.f + bodyCtrlH + 12.f}, {midW, 20.f}},
              "PREVIEW", ui::TextAlign::Center, 12u, palette_.accent);
    previewRect_ = {{midX + (midW - previewSize_) / 2.f,
                     tabY + 44.f + bodyCtrlH + 34.f},
                    {previewSize_, previewSize_}};
    renderPreview(window, elapsed);

    // --- Right column: layer list + per-layer controls (600 wide). ---
    const float rightX = midX + midW + 30.f;
    const float rightW = px + pw - kPad - rightX;
    layerListRect_ = {{rightX, contentY}, {rightW, contentBottom - contentY}};
    renderLayerList(window, uiView, uiState, layerListRect_, elapsed);

    // --- Bottom strip: Save + flash. ---
    rects.saveButton = {{px + kPad, py + kPanelRect.size.y - 54.f}, {160.f, 36.f}};
    drawButton(window, fontRef, palette_,rects.saveButton, "SAVE",
               contains(rects.saveButton, uiState.mouseUi));
    if (uiState.enemyEditorSavedFlash > 0.f) {
        drawLabel(window, fontRef,
                  {{px + kPad + 180.f, py + kPanelRect.size.y - 54.f}, {200.f, 36.f}},
                  "Saved!", ui::TextAlign::Left, 18u, sf::Color{120, 255, 160});
    }

    // Shader picker overlay (drawn last so it sits on top).
    if (uiState.enemyEditorShaderPickerOpen) {
        sf::FloatRect pickerRect{{px + pw * 0.5f - 300.f, py + 120.f}, {600.f, 480.f}};
        renderShaderPicker(window, uiState, pickerRect);
    }
}

void EnemyDesignEditor::renderTypeList(sf::RenderWindow& window,
                                       const sf::View& uiView, UiState& uiState,
                                       sf::FloatRect listRect) {
    ui::UiPanel{palette_.panelFill, palette_.panelOutline, 1.f}
        .draw(window, listRect);

    const float contentH = static_cast<float>(typeIds.size()) * kListItemH + 8.f;
    uiState.enemyEditorTypeScroll =
        ui::UiScrollPanel::clampOffset(uiState.enemyEditorTypeScroll, contentH,
                                       listRect.size.y);

    const sf::View saved = window.getView();
    ui::UiScrollPanel::applyClipView(window, listRect, uiView,
                                     uiState.enemyEditorTypeScroll);

    rects.typeListItems.clear();
    const float scroll = uiState.enemyEditorTypeScroll;
    // Content is drawn at raw content coords; applyClipView applies the scroll
    // translation. Hit-test rects are stored in on-screen coords (content - scroll).
    float y = listRect.position.y + 4.f;
    for (std::size_t i = 0; i < typeIds.size(); ++i) {
        sf::FloatRect contentRect{{listRect.position.x + 4.f, y},
                                  {listRect.size.x - 8.f, kListItemH - 2.f}};
        rects.typeListItems.push_back(
            {{contentRect.position.x, contentRect.position.y - scroll}, contentRect.size});
        if (static_cast<int>(i) == currentTypeIndex) {
            ui::UiPanel{palette_.selected, palette_.panelOutline, 1.f}.draw(window, contentRect);
        }
        drawLabel(window, fontRef,
                  {{contentRect.position.x + 8.f, contentRect.position.y}, {contentRect.size.x - 8.f, contentRect.size.y}},
                  typeIds[i], ui::TextAlign::Left, 13u, palette_.text);
        y += kListItemH;
    }

    window.setView(saved);
    ui::UiScrollPanel::drawScrollbar(window, listRect, uiState.enemyEditorTypeScroll,
                                     contentH, 6.f, palette_.accent);
}

void EnemyDesignEditor::renderBodyControls(sf::RenderWindow& window,
                                           UiState& uiState,
                                           sf::FloatRect controlsRect) {
    auto& tier = currentTierDesign(currentTierIndex);
    rects.bodyButtons.assign(16, sf::FloatRect{});

    const float x = controlsRect.position.x;
    const float w = controlsRect.size.x;
    float y = controlsRect.position.y;
    const float btnW = 34.f;
    const float valW = 70.f;
    const float labelW = 150.f;

    // One labeled [-] value [+] control. `slot` indexes rects.bodyButtons:
    // 2*slot = inc, 2*slot+1 = dec.
    auto control = [&](const std::string& label, const std::string& value, int slot) {
        drawLabel(window, fontRef, {{x, y}, {labelW, kRowH}}, label,
                  ui::TextAlign::Left, 13u, palette_.text);
        sf::FloatRect incR{{x + w - btnW, y}, {btnW, kRowH - 4.f}};
        sf::FloatRect valR{{incR.position.x - valW - 6.f, y}, {valW, kRowH - 4.f}};
        sf::FloatRect decR{{valR.position.x - btnW - 6.f, y}, {btnW, kRowH - 4.f}};
        drawButton(window, fontRef, palette_,decR, "-", contains(decR, uiState.mouseUi));
        ui::UiPanel{palette_.buttonBg, palette_.panelOutline, 1.f}.draw(window, valR);
        drawLabel(window, fontRef, valR, value, ui::TextAlign::Center, 13u, palette_.text);
        drawButton(window, fontRef, palette_,incR, "+", contains(incR, uiState.mouseUi));
        rects.bodyButtons[static_cast<std::size_t>(2 * slot)]     = incR;
        rects.bodyButtons[static_cast<std::size_t>(2 * slot + 1)] = decR;
        y += kRowH;
    };

    control("Shape", std::to_string(tier.bodyShape), 0);
    control("Size", formatFloat(tier.bodySize), 1);
    y += 6.f;
    control("Outline R", std::to_string(tier.outline.r), 2);
    control("Outline G", std::to_string(tier.outline.g), 3);
    control("Outline B", std::to_string(tier.outline.b), 4);
    y += 6.f;
    control("Fill R", std::to_string(tier.fill.r), 5);
    control("Fill G", std::to_string(tier.fill.g), 6);
    control("Fill B", std::to_string(tier.fill.b), 7);
}

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------

void EnemyDesignEditor::handleScroll(float delta, UiState& uiState) {
    if (uiState.enemyEditorShaderPickerOpen)
        return;
    if (contains(typeListRect_, uiState.mouseUi))
        uiState.enemyEditorTypeScroll += delta * 20.f;
    else
        uiState.enemyEditorLayerScroll += delta * 20.f;
}

namespace {

// Apply a clamped byte step to a colour channel.
std::uint8_t stepByte(std::uint8_t v, int step) {
    int n = static_cast<int>(v) + step;
    return static_cast<std::uint8_t>(std::clamp(n, 0, 255));
}

} // namespace

void EnemyDesignEditor::handleClick(sf::Vector2f uiPos, UiState& uiState) {
    // Shader picker is modal within the panel: handle it first, exclusively.
    if (uiState.enemyEditorShaderPickerOpen) {
        if (contains(rects.shaderPickerClose, uiPos)) {
            uiState.enemyEditorShaderPickerOpen = false;
            return;
        }
        for (std::size_t i = 0; i < rects.shaderPickerItems.size(); ++i) {
            if (contains(rects.shaderPickerItems[i], uiPos)) {
                int layerIdx = uiState.enemyEditorLayerIndex;
                auto& tier = currentTierDesign(currentTierIndex);
                static const char* kShaderNames[] = {
                    "effect_bolt", "effect_flame", "effect_glow", "effect_orb",
                    "effect_ring", "effect_shatter", "effect_slash", "effect_smoke",
                    "effect_spark", "effect_vortex"};
                if (layerIdx >= 0 && layerIdx < static_cast<int>(tier.layers.size()) &&
                    i < 10) {
                    tier.layers[static_cast<std::size_t>(layerIdx)].shaderName =
                        kShaderNames[i];
                    pushEdit();
                }
                uiState.enemyEditorShaderPickerOpen = false;
                return;
            }
        }
        return; // clicks elsewhere while picker open are swallowed
    }

    // Close / save.
    if (contains(rects.closeButton, uiPos)) {
        uiState.isEnemyEditorOpen = false;
        return;
    }
    if (contains(rects.saveButton, uiPos)) {
        if (!currentEdit.id.empty()) {
            namespace fs = std::filesystem;
            fs::path src = fs::path(templateDir) / (currentEdit.id + ".yaml");
            fs::path dst = fs::path(buildTemplateDir) / (currentEdit.id + ".yaml");
            writeEnemyTemplateAndSync(currentEdit, src, dst);
            uiState.enemyEditorSavedFlash = 2.0f;
        }
        return;
    }

    // Tier tabs.
    if (contains(rects.tierCommon, uiPos))   { currentTierIndex = 0; return; }
    if (contains(rects.tierUncommon, uiPos)) { currentTierIndex = 1; return; }
    if (contains(rects.tierRare, uiPos))     { currentTierIndex = 2; return; }

    // Type list (only when the click is within the visible list area, so
    // items scrolled out of the clip rect cannot be selected).
    if (contains(typeListRect_, uiPos))
    for (std::size_t i = 0; i < rects.typeListItems.size(); ++i) {
        if (contains(rects.typeListItems[i], uiPos)) {
            loadType(static_cast<int>(i));
            uiState.enemyEditorTypeIndex = currentTypeIndex;
            uiState.enemyEditorLayerIndex = -1;
            pushEdit();
            return;
        }
    }

    // Body +/- buttons.
    for (std::size_t slot = 0; slot < rects.bodyButtons.size() / 2; ++slot) {
        const sf::FloatRect incR = rects.bodyButtons[2 * slot];
        const sf::FloatRect decR = rects.bodyButtons[2 * slot + 1];
        const bool inc = contains(incR, uiPos);
        const bool dec = contains(decR, uiPos);
        if (!inc && !dec)
            continue;
        const int sign = inc ? 1 : -1;
        auto& tier = currentTierDesign(currentTierIndex);
        switch (slot) {
            case 0: // shape 0..59
                tier.bodyShape = std::clamp(tier.bodyShape + sign, 0, 59);
                break;
            case 1: // size step 5
                tier.bodySize = std::max(0.f, tier.bodySize + sign * 5.f);
                break;
            case 2: tier.outline.r = stepByte(tier.outline.r, sign * 8); break;
            case 3: tier.outline.g = stepByte(tier.outline.g, sign * 8); break;
            case 4: tier.outline.b = stepByte(tier.outline.b, sign * 8); break;
            case 5: tier.fill.r = stepByte(tier.fill.r, sign * 8); break;
            case 6: tier.fill.g = stepByte(tier.fill.g, sign * 8); break;
            case 7: tier.fill.b = stepByte(tier.fill.b, sign * 8); break;
            default: break;
        }
        pushEdit();
        return;
    }

    // Layer-area clicks (list items, add/remove, per-layer controls) are
    // handled in EnemyDesignEditor_Layers.cpp via handleLayerClick.
    handleLayerClick(uiPos, uiState);
}

} // namespace dof::render
