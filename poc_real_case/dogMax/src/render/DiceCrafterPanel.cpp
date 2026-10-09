#include "render/DiceCrafterPanel.hpp"

#include "entities/Dice.hpp"
#include "entities/PowderColor.hpp"
#include "hubs/DiceCrafterHub.hpp"
#include "hubs/PowderHub.hpp"
#include "loaders/ConfigLoader.hpp"
#include "render/ColorTheme.hpp"
#include "render/UiAccent.hpp"
#include "render/UiState.hpp"
#include "render/ui/PixelSnap.hpp"
#include "render/ui/UiScrollPanel.hpp"

#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Text.hpp>
#include <SFML/Graphics/View.hpp>

#include <algorithm>
#include <sstream>
#include <string>

namespace dof::render {

namespace {

// Craft-outcome SEMANTIC feedback colors (success / fail / neutral). These carry
// pass/fail meaning and are gameplay feedback, NOT chrome — kept as-is.
constexpr sf::Color kResultOk    { 0, 220, 120, 255};
constexpr sf::Color kResultFail  {200, 100,  60, 255};
constexpr sf::Color kResultNone  {130, 140, 150, 200};

constexpr unsigned int kTitleSize  = 13;
constexpr unsigned int kLabelSize  = 10;
constexpr unsigned int kFaceSize   = 11;
constexpr unsigned int kResultSize = 10;

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
    return sf::Color{
        static_cast<std::uint8_t>(cfg.getInt(std::string(base) + "_R")),
        static_cast<std::uint8_t>(cfg.getInt(std::string(base) + "_G")),
        static_cast<std::uint8_t>(cfg.getInt(std::string(base) + "_B"))};
}



// Ordered list of powder tiers from native upwards (for REFACE buttons).
// Returns up to 4 tiers starting from `native`.
std::vector<dof::entities::PowderColor> refaceTiers(dof::entities::PowderColor native) {
    using PC = dof::entities::PowderColor;
    const PC all[] = {PC::Red, PC::Yellow, PC::Cyan, PC::Green,
                      PC::Blue, PC::Magenta, PC::Purple, PC::Orange,
                      PC::Pink, PC::White};
    std::vector<PC> out;
    bool found = false;
    for (auto c : all) {
        if (c == native) found = true;
        if (found) { out.push_back(c); if (out.size() == 4) break; }
    }
    return out;
}

} // namespace

// ── DiceCrafterPanel ──────────────────────────────────────────────────────────────

DiceCrafterPanel::DiceCrafterPanel(const dof::loaders::ConfigLoader& config,
                       const sf::Font& font)
    : configRef(config), fontRef(font) {
    // ---------------------------------------------------------------------------------
    // Resolve the shared single-accent chrome tokens ONCE from config and cache them
    // as members. Every chrome surface (panel frame, cells, buttons, labels) reads
    // its outline/fill/text through these so the panel reads as one accent set with
    // no per-widget colour drift. Gameplay/content colours (powder swatches, craft
    // result feedback) are handled separately and are NOT tokenised.
    // ---------------------------------------------------------------------------------
    const UiAccent accent = UiAccent::loadFromConfig(config);
    const ColorTheme theme = buildColorTheme(config);
    accentColor    = accent.full();
    accentDimColor = accent.dim();
    panelBgColor   = resolvePanelBackground(config, "THEME_PANEL_BG");
    textColor      = theme.uiText;
    textDimColor   = theme.uiDim;

    panel.background = panelBgColor;
    panel.border = accentColor;
    panel.borderThickness = 1.5f;

    slotCell.bgEmpty = panelBgColor;
    slotCell.bgOccupied = panelBgColor;
    slotCell.border = accentDimColor;
    slotCell.borderHover = accentColor;
    slotCell.borderThickness = 1.5f;

    faceCell.bgEmpty = panelBgColor;
    faceCell.bgOccupied = panelBgColor;
    faceCell.border = accentDimColor;
    faceCell.borderHover = accentColor;
    faceCell.borderThickness = 1.0f;

    button.bgNormal = panelBgColor;
    button.bgHover = accentDimColor;
    button.border = accentColor;
    button.textNormal = textColor;
    button.textHover = textColor;
    button.borderThickness = 1.0f;

    titleLabel.color = accentColor;
    titleLabel.fontSize = kTitleSize;
    titleLabel.align = ui::TextAlign::Left;

    // Title now reads as a chip badge on the panel top edge, coherent with the
    // inventory and settings panels (was a plain left label). Panel frame glows.
    titleChip = ui::UiChip::loadFromConfig(configRef);
    glowEnabled = configRef.getInt("UI_GLOW_ENABLE") != 0;
    glowSpread  = configRef.getFloat("UI_GLOW_SPREAD");
    glowLayers  = configRef.getInt("UI_GLOW_LAYERS");
    glowAlpha   = configRef.getFloat("UI_GLOW_ALPHA");

    textLabel.color = textDimColor;
    textLabel.fontSize = kLabelSize;
    textLabel.align = ui::TextAlign::Left;

    resultLabel.color = kResultOk;
    resultLabel.fontSize = kResultSize;
    resultLabel.align = ui::TextAlign::Left;
}

void DiceCrafterPanel::buildLayout(const dof::hubs::DiceCrafterHub& DiceCrafter) {
    const float px = configRef.getFloat("DICE_CRAFTER_PANEL_X");
    const float py = configRef.getFloat("DICE_CRAFTER_PANEL_Y");
    const float pw = configRef.getFloat("DICE_CRAFTER_PANEL_WIDTH");
    const float ph = configRef.getFloat("DICE_CRAFTER_PANEL_HEIGHT");

    const float pad          = configRef.getFloat("DICE_CRAFTER_PANEL_PADDING");
    const float rowH         = configRef.getFloat("DICE_CRAFTER_TITLE_ROW_HEIGHT");
    const float titleSlotGap = configRef.getFloat("DICE_CRAFTER_TITLE_SLOT_GAP");
    const float slotSz       = configRef.getFloat("DICE_CRAFTER_SLOT_SIZE");
    const float gridLeftGap  = configRef.getFloat("DICE_CRAFTER_FACE_GRID_LEFT_GAP");
    const float promptClear  = configRef.getFloat("DICE_CRAFTER_FACE_PROMPT_CLEARANCE");
    const float cellGap      = configRef.getFloat("DICE_CRAFTER_FACE_CELL_GAP");
    const int   cellMax      = configRef.getInt("DICE_CRAFTER_FACE_CELL_MAX_SIZE");
    const int   cellMin      = configRef.getInt("DICE_CRAFTER_FACE_CELL_MIN_SIZE");
    const float gridMaxH     = configRef.getFloat("DICE_CRAFTER_FACE_REGION_MAX_HEIGHT");
    const float regBtnGap    = configRef.getFloat("DICE_CRAFTER_REGION_BUTTON_GAP");
    const float btnH         = configRef.getFloat("DICE_CRAFTER_BUTTON_HEIGHT");
    const float btnGap       = configRef.getFloat("DICE_CRAFTER_BUTTON_GAP");
    const float evolveGap    = configRef.getFloat("DICE_CRAFTER_EVOLVE_GAP");
    const float footerGap    = configRef.getFloat("DICE_CRAFTER_FOOTER_GAP");

    layout.panelRect = {{px, py}, {pw, ph}};
    layout.titleRect = {{px + pad, py + pad}, {pw - pad * 2.0f, rowH}};

    const float slotTop    = py + pad + rowH + titleSlotGap;
    const float slotBottom = slotTop + slotSz;
    layout.slotRect = {{px + pad, slotTop}, {slotSz, slotSz}};

    // Face cells form a BOUNDED grid to the right of the slot. Its width is fixed
    // (panel edge minus the slot); its height is capped at gridMaxH. Cell size and
    // column count adapt to faceCount so every face — up to a d100's 100 — fits the
    // region instead of spilling downward over the REFACE/EVOLVE buttons.
    const float gridLeft = px + pad + slotSz + gridLeftGap;
    const float gridTop  = slotTop + promptClear;
    const float gridW    = (px + pw - pad) - gridLeft;

    layout.faceCells.clear();
    float gridHeight = 0.0f;
    if (DiceCrafter.isSlotFilled()) {
        const int n = DiceCrafter.peekedDice()->faceCount();
        // Pick the largest cell edge whose full grid fits the capped height; the
        // smaller edge packs more columns and rows. Falls back to cellMin.
        int cell = cellMin;
        for (int c = cellMax; c >= cellMin; --c) {
            const float stride = std::max(1.0f, static_cast<float>(c) + cellGap);
            const int   perRow = std::max(1, static_cast<int>((gridW + cellGap) / stride));
            const int   rows   = (n + perRow - 1) / perRow;
            if (static_cast<float>(rows) * stride - cellGap <= gridMaxH) { cell = c; break; }
        }
        // max(1,…) so a degenerate cell+gap of 0 can't divide-by-zero below.
        const float stride = std::max(1.0f, static_cast<float>(cell) + cellGap);
        const int   perRow = std::max(1, static_cast<int>((gridW + cellGap) / stride));
        const int   rows   = (n + perRow - 1) / perRow;
        gridHeight = std::min(gridMaxH, static_cast<float>(rows) * stride - cellGap);

        const float fCell = static_cast<float>(cell);
        float cx = gridLeft;
        float cy = gridTop;
        for (int i = 0; i < n; ++i) {
            if (i > 0 && i % perRow == 0) { cx = gridLeft; cy += stride; }
            layout.faceCells.push_back({{cx, cy}, {fCell, fCell}});
            cx += stride;
        }
    }
    // Clip region: the grid plus one cell-gap of bottom breathing room (< the
    // region-to-button gap, so it never reaches the buttons).
    layout.faceGridClipRect = {{gridLeft, gridTop}, {gridW, gridHeight + cellGap}};

    // Buttons flow BELOW both the slot and the bounded grid, so no face cell can
    // ever share vertical space with a button, for any face count.
    layout.refaceButtons.clear();
    const float btnW = pw - pad * 2.0f;
    float by = std::max(slotBottom, gridTop + gridHeight) + regBtnGap;

    if (DiceCrafter.isSlotFilled()) {
        const auto native = dof::entities::powderColorForDice(DiceCrafter.peekedDice()->face());
        const auto tiers  = refaceTiers(native);
        for (auto color : tiers) {
            DiceCrafterButton btn;
            btn.rect      = {{px + pad, by}, {btnW, btnH}};
            btn.isEnabled = true;
            btn.label       = std::string("REFACE  ") + dof::entities::powderColorName(color);
            btn.powderColor = color;
            layout.refaceButtons.push_back(btn);
            by += btnH + btnGap;
        }
    }

    // EVOLVE button
    by += evolveGap;
    layout.evolveButton.rect      = {{px + pad, by}, {btnW, btnH}};
    layout.evolveButton.isEnabled = DiceCrafter.isSlotFilled() && !DiceCrafter.isAtMaxFace();
    layout.evolveButton.label     = "EVOLVE  (next tier)";

    // The action footer is persistent. Craft result feedback sits above it so
    // REFACE/EVOLVE outcomes never hide the local control hints.
    layout.footerRect = {{px + pad, py + ph - rowH - pad}, {btnW, rowH}};
    layout.resultRect = {{px + pad, layout.footerRect.position.y - footerGap - rowH}, {btnW, rowH}};
}

void DiceCrafterPanel::render(sf::RenderWindow& window,
                        const dof::hubs::DiceCrafterHub& DiceCrafter,
                        const dof::hubs::PowderHub& powder,
                        const std::string& lastResultText,
                        const UiState& uiState,
                        int selectedFaceIndex) const {
    const_cast<DiceCrafterPanel*>(this)->buildLayout(DiceCrafter);
    drawBackground(window);
    drawSlot(window, DiceCrafter, uiState);
    drawFaceCells(window, DiceCrafter, uiState, selectedFaceIndex);
    drawRefaceButtons(window, powder, uiState, selectedFaceIndex >= 1);
    drawEvolveButton(window, DiceCrafter, powder, uiState);
    drawResultText(window, lastResultText);
    drawActionFooter(window);
}

void DiceCrafterPanel::drawBackground(sf::RenderWindow& window) const {
    if (glowEnabled) {
        ui::drawGlowFrame(window, layout.panelRect, panelBgColor, accentColor,
                          2.0f, glowLayers, glowSpread, glowAlpha);
    } else {
        panel.draw(window, layout.panelRect);
    }
    // Title chip anchored on the panel top edge — width measured from the label.
    sf::Text probe(fontRef, "DICE CRAFTER", titleChip.fontSize);
    const float chipW = probe.getLocalBounds().size.x + titleChip.paddingX * 2.0f;
    titleChip.draw(window, layout.panelRect, fontRef, "DICE CRAFTER", chipW);
}

void DiceCrafterPanel::drawSlot(sf::RenderWindow& window,
                          const dof::hubs::DiceCrafterHub& DiceCrafter,
                          const UiState& uiState) const {
    const bool filled = DiceCrafter.isSlotFilled();
    const bool isHovered = layout.slotRect.contains(uiState.mouseUi);
    slotCell.draw(window, layout.slotRect, filled, isHovered);

    const sf::FloatRect textRect{{layout.slotRect.position.x + 4.0f,
                                  layout.slotRect.position.y + 18.0f},
                                 {layout.slotRect.size.x - 8.0f, 16.0f}};
    ui::UiLabel lbl = textLabel;
    lbl.fontSize = kLabelSize;
    lbl.align = ui::TextAlign::Left;

    if (filled) {
        const auto* d = DiceCrafter.peekedDice();
        const std::string labelText = std::string(dof::entities::diceFaceLabel(d->face()))
                                    + " Lv" + std::to_string(d->itemLevel());
        lbl.color = textColor;
        lbl.draw(window, textRect, fontRef, labelText);
    } else {
        lbl.color = textDimColor;
        lbl.draw(window, textRect, fontRef, "slot");
    }
}

void DiceCrafterPanel::drawFaceCells(sf::RenderWindow& window,
                               const dof::hubs::DiceCrafterHub& DiceCrafter,
                               const UiState& uiState,
                               int selectedFaceIndex) const {
    if (!DiceCrafter.isSlotFilled()) return;
    const auto* d  = DiceCrafter.peekedDice();

    // Selection highlight is chrome — the accent ring marks the REFACE target face.
    const sf::Color selectedFaceBorder = accentColor;

    const std::string prompt = (selectedFaceIndex < 1)
        ? "click a face to select it for REFACE"
        : "REFACE target selected | EVOLVE upgrades the whole die";
    const sf::FloatRect promptRect{{layout.slotRect.position.x + layout.slotRect.size.x + 8.0f,
                                    layout.slotRect.position.y},
                                   {layout.panelRect.size.x - layout.slotRect.size.x - 24.0f, 16.0f}};
    textLabel.draw(window, promptRect, fontRef, prompt);

    // Clip every face-cell draw to the bounded grid region. Adaptive sizing in
    // buildLayout already keeps all cells inside it, so this is a hard guarantee
    // against overflow: a cell can never paint over the buttons below the grid.
    // No scroll offset (0), so drawn cell rects equal the design-coord rects the
    // hit-testers use — draw and click stay in sync.
    const sf::View savedView = window.getView();
    ui::UiScrollPanel::applyClipView(window, layout.faceGridClipRect, savedView, 0.0f);

    for (int i = 0; i < static_cast<int>(layout.faceCells.size()); ++i) {
        const int faceIdx   = i + 1;
        const bool selected = (faceIdx == selectedFaceIndex);
        const auto rect = layout.faceCells[static_cast<std::size_t>(i)];
        const bool isHovered = rect.contains(uiState.mouseUi);

        ui::UiCell cellToDraw = faceCell;
        if (selected) {
            cellToDraw.borderHover = selectedFaceBorder;
            cellToDraw.bgOccupied = panelBgColor;
            cellToDraw.borderThickness = 2.0f;
        }

        // Draw cell. The face cells contain content, so hasContent is always true.
        cellToDraw.draw(window, rect, true, selected || isHovered);

        // The reusable UiCell paints its border on the INSIDE of the rect. The
        // selected-face indicator must read as a ring sitting ON the cell edge
        // (the player expects the highlight to frame the cell), so draw an
        // explicit outward outline for the selected cell on top of the
        // component. Transparent fill keeps the cell value
        // and inner styling untouched; the blue ring straddles the edge outward.
        if (selected) {
            sf::RectangleShape ring{rect.size};
            ring.setPosition(rect.position);
            ring.setFillColor(sf::Color::Transparent);
            ring.setOutlineColor(selectedFaceBorder);
            ring.setOutlineThickness(2.0f);
            window.draw(ring);
        }

        ui::UiLabel valLabel;
        valLabel.color = selected ? accentColor : textColor;
        valLabel.fontSize = kFaceSize;
        valLabel.align = ui::TextAlign::Left;

        const sf::FloatRect valRect{{rect.position.x + 4.0f, rect.position.y + 4.0f},
                                    {rect.size.x - 8.0f, rect.size.y - 8.0f}};
        valLabel.draw(window, valRect, fontRef, std::to_string(d->faceValue(faceIdx)));
    }

    window.setView(savedView);
}

void DiceCrafterPanel::drawRefaceButtons(sf::RenderWindow& window,
                                   const dof::hubs::PowderHub& powder,
                                   const UiState& uiState,
                                   bool hasSelection) const {
    const int cost = configRef.getInt("DICE_CRAFTER_REFACE_COST");
    for (const auto& btn : layout.refaceButtons) {
        const int stock     = powder.peek(btn.powderColor);
        const bool hasStock = (stock >= cost);
        const bool active  = hasStock && hasSelection;
        const bool isHovered = active && btn.rect.contains(uiState.mouseUi);

        ui::UiButton btnToDraw = button;
        if (active) {
            btnToDraw.border = accentColor;
            btnToDraw.textNormal = textColor;
            btnToDraw.textHover = textColor;
        } else {
            btnToDraw.border = textDimColor;
            btnToDraw.textNormal = textDimColor;
            btnToDraw.textHover = textDimColor;
        }

        std::ostringstream oss;
        oss << btn.label << "  [" << cost << "x | stock:" << stock << "]";
        btnToDraw.draw(window, btn.rect, fontRef, oss.str(), kLabelSize, isHovered);

        // Color swatch overlayed onto the left of the button.
        const sf::Color swatch = powderSfColor(configRef, btn.powderColor);
        const sf::FloatRect swatchR{{btn.rect.position.x + 6.0f,
                                     btn.rect.position.y + (btn.rect.size.y - 12.0f) / 2.0f},
                                    {12.0f, 12.0f}};
        sf::RectangleShape s{swatchR.size};
        s.setPosition(swatchR.position);
        s.setFillColor(swatch);
        s.setOutlineThickness(0.f);
        window.draw(s);
    }
}

void DiceCrafterPanel::drawEvolveButton(sf::RenderWindow& window,
                                  const dof::hubs::DiceCrafterHub& DiceCrafter,
                                  const dof::hubs::PowderHub& powder,
                                  const UiState& uiState) const {
    const auto& btn = layout.evolveButton;
    const bool isHovered = btn.isEnabled && btn.rect.contains(uiState.mouseUi);

    ui::UiButton btnToDraw = button;
    if (btn.isEnabled) {
        btnToDraw.border = accentColor;
        btnToDraw.textNormal = textColor;
        btnToDraw.textHover = textColor;
    } else {
        btnToDraw.border = textDimColor;
        btnToDraw.textNormal = textDimColor;
        btnToDraw.textHover = textDimColor;
    }

    std::string labelText;
    if (btn.isEnabled) {
        const int cost = configRef.getInt("DICE_CRAFTER_EVOLVE_COST");
        const auto evColor = DiceCrafter.evolveColor();
        const int stock = powder.peek(evColor);
        std::ostringstream oss;
        oss << btn.label << "  [" << cost << "x "
            << dof::entities::powderColorName(evColor)
            << " | stock:" << stock << "]";
        labelText = oss.str();
    } else {
        labelText = DiceCrafter.isAtMaxFace() ? "EVOLVE  (max tier reached)" : btn.label;
    }

    btnToDraw.draw(window, btn.rect, fontRef, labelText, kLabelSize, isHovered);
}

void DiceCrafterPanel::drawResultText(sf::RenderWindow& window,
                                const std::string& text) const {
    if (text.empty()) return;

    const sf::Color col = text.find("Not enough powder") != std::string::npos ? kResultFail
                        : text.find("No change") != std::string::npos ? kResultNone
                        : kResultOk;
    ui::UiLabel lbl = resultLabel;
    lbl.color = col;
    lbl.draw(window, layout.resultRect, fontRef, text);
}

void DiceCrafterPanel::drawActionFooter(sf::RenderWindow& window) const {
    ui::UiLabel footer = textLabel;
    footer.align = ui::TextAlign::Left;
    footer.color = textDimColor;
    footer.draw(window, layout.footerRect, fontRef, configRef.getString("DICE_CRAFTER_HINT_TEXT"));
}

// ── Hit-testing ─────────────────────────────────────────────────────────────

int DiceCrafterPanel::refaceButtonIndexAt(sf::Vector2f cursor) const {
    for (int i = 0; i < static_cast<int>(layout.refaceButtons.size()); ++i) {
        if (layout.refaceButtons[static_cast<std::size_t>(i)].rect.contains(cursor))
            return i;
    }
    return -1;
}

bool DiceCrafterPanel::evolveButtonHit(sf::Vector2f cursor) const {
    return layout.evolveButton.isEnabled
        && layout.evolveButton.rect.contains(cursor);
}

bool DiceCrafterPanel::slotHit(sf::Vector2f cursor) const {
    return layout.slotRect.contains(cursor);
}

int DiceCrafterPanel::faceCellIndexAt(sf::Vector2f cursor) const {
    for (int i = 0; i < static_cast<int>(layout.faceCells.size()); ++i) {
        if (layout.faceCells[static_cast<std::size_t>(i)].contains(cursor))
            return i + 1;  // 1-based
    }
    return -1;
}

} // namespace dof::render
