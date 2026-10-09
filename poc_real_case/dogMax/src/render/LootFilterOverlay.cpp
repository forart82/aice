#include "render/LootFilterOverlay.hpp"

#include "entities/Dice.hpp"
#include "entities/Weapon.hpp"
#include "hubs/LootFilter.hpp"
#include "loaders/ConfigLoader.hpp"
#include "render/ColorTheme.hpp"
#include "render/ui/UiChip.hpp"
#include "render/ui/UiPanel.hpp"
#include "render/WeaponSprite.hpp"

#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Text.hpp>

#include <algorithm>
#include <string>

namespace dof::render {

namespace {

// Pixel height reserved at the bottom of a chip for its text label.
constexpr float kChipLabelH = 14.0f;

// Draws the chip body (fill + selection outline) and returns the inset
// rect available for the icon, leaving room for the label strip below.
sf::FloatRect drawChipCell(sf::RenderWindow& window,
                           sf::FloatRect rect,
                           bool selected,
                           const LootFilterPalette& pal) {
    ui::UiPanel bg;
    bg.background      = selected ? pal.chipSelFill : pal.chipBgFill;
    bg.border          = selected ? pal.cyan : pal.chipBorder;
    bg.borderThickness = selected ? 1.5f : 1.0f;
    bg.draw(window, rect);

    const float pad = 6.0f;
    return {{rect.position.x + pad, rect.position.y + pad},
            {rect.size.x - pad * 2.0f, rect.size.y - kChipLabelH - pad}};
}

// Centered label strip drawn along the bottom of a chip.
void drawChipLabel(sf::RenderWindow& window,
                   sf::FloatRect rect,
                   const std::string& label,
                   bool selected,
                   const sf::Font& font,
                   unsigned fontSize,
                   const LootFilterPalette& pal) {
    sf::Text text{font, label, fontSize};
    text.setFillColor(selected ? pal.cyan : pal.textDim);
    const auto tb = text.getLocalBounds();
    text.setPosition({
        rect.position.x + (rect.size.x - tb.size.x) * 0.5f - tb.position.x,
        rect.position.y + rect.size.y - kChipLabelH - tb.position.y + 1.0f
    });
    window.draw(text);
}

// Largest centered square that fits inside the icon rect.
sf::FloatRect squareInRect(sf::FloatRect iconRect) {
    const float side = std::min(iconRect.size.x, iconRect.size.y);
    return {{iconRect.position.x + (iconRect.size.x - side) * 0.5f,
             iconRect.position.y + (iconRect.size.y - side) * 0.5f},
            {side, side}};
}

void drawWeaponChip(sf::RenderWindow& window,
                    sf::FloatRect rect,
                    dof::entities::WeaponType type,
                    const std::string& label,
                    bool selected,
                    const sf::Font& font,
                    unsigned fontSize,
                    const LootFilterPalette& pal,
                    const dof::loaders::ConfigLoader& config) {
    const sf::FloatRect iconRect = drawChipCell(window, rect, selected, pal);
    drawWeaponSprite(window, squareInRect(iconRect), type, config,
                     selected ? sf::Color::White : sf::Color{210, 210, 210});
    drawChipLabel(window, rect, label, selected, font, fontSize, pal);
}

void drawDiceChip(sf::RenderWindow& window,
                  sf::FloatRect rect,
                  int faceCount,
                  const std::string& label,
                  bool selected,
                  const sf::Font& font,
                  unsigned fontSize,
                  const LootFilterPalette& pal) {
    const sf::FloatRect iconRect = drawChipCell(window, rect, selected, pal);
    const sf::FloatRect sq = squareInRect(iconRect);
    const sf::Color line = selected ? pal.cyan : pal.chipBorder;

    // Die glyph — a square body outline with the side-count drawn inside.
    sf::RectangleShape die{{sq.size.x, sq.size.y}};
    die.setPosition(sq.position);
    sf::Color fill = selected ? pal.chipSelFill : pal.chipBgFill;
    die.setFillColor(fill);
    die.setOutlineThickness(2.0f);
    die.setOutlineColor(line);
    window.draw(die);

    sf::Text num{font, std::to_string(faceCount), fontSize};
    num.setFillColor(selected ? pal.cyan : pal.textDim);
    const auto nb = num.getLocalBounds();
    num.setPosition({
        sq.position.x + (sq.size.x - nb.size.x) * 0.5f - nb.position.x,
        sq.position.y + (sq.size.y - nb.size.y) * 0.5f - nb.position.y
    });
    window.draw(num);

    drawChipLabel(window, rect, label, selected, font, fontSize, pal);
}

void drawInputField(sf::RenderWindow& window,
                    sf::FloatRect rect,
                    const std::string& value,
                    bool focused,
                    const sf::Font& font,
                    unsigned fontSize,
                    const LootFilterPalette& pal) {
    ui::UiPanel bg;
    bg.background      = pal.chipBgFill;
    bg.border          = focused ? pal.cyan : pal.chipBorder;
    bg.borderThickness = focused ? 1.5f : 1.0f;
    bg.draw(window, rect);

    const std::string display = value + (focused ? "|" : "");
    sf::Text text{font, display, fontSize};
    text.setFillColor(focused ? pal.cyan : pal.textBright);
    const auto tb = text.getLocalBounds();
    text.setPosition({
        rect.position.x + (rect.size.x - tb.size.x) * 0.5f - tb.position.x,
        rect.position.y + (rect.size.y - tb.size.y) * 0.5f - tb.position.y
    });
    window.draw(text);
}

void drawSectionLabel(sf::RenderWindow& window,
                      sf::Vector2f pos,
                      const std::string& label,
                      const sf::Font& font,
                      unsigned fontSize,
                      const LootFilterPalette& pal) {
    sf::Text text{font, label, fontSize};
    text.setFillColor(pal.sectionHdr);
    text.setPosition(pos);
    window.draw(text);
}

} // namespace

LootFilterOverlay::LootFilterOverlay(const dof::loaders::ConfigLoader& config, const sf::Font& font)
    : configRef(config)
    , accent(UiAccent::loadFromConfig(config))
    , chip(ui::UiChip::loadFromConfig(config))
    , fontPtr(&font)
    , uncommonThreshold(config.getInt("QUALITY_UNCOMMON_THRESHOLD"))
    , rareThreshold(config.getInt("QUALITY_RARE_THRESHOLD"))
    , tierCommon{readRgb(config, "QUALITY_TIER_COMMON_R", "QUALITY_TIER_COMMON_G",
                         "QUALITY_TIER_COMMON_B")}
    , tierUncommon{readRgb(config, "QUALITY_TIER_UNCOMMON_R", "QUALITY_TIER_UNCOMMON_G",
                           "QUALITY_TIER_UNCOMMON_B")}
    , tierRare{readRgb(config, "QUALITY_TIER_RARE_R", "QUALITY_TIER_RARE_G",
                       "QUALITY_TIER_RARE_B")}
    , palette{
        resolvePanelBackground(config, "LOOT_FILTER_POPUP_BG"),
        // Single-accent chrome collapse (Phase B). The selection/focus accent
        // is the canonical UI accent (was a distinct LOOT_FILTER_ACCENT cyan).
        // The unselected chip border (was a cool blue-grey) and the selected
        // chip fill (was a teal wash) now collapse to the dim accent band, so
        // selection reads by luminance against the neutral panel-bg chip body.
        readRgb(config, "UI_ACCENT_R", "UI_ACCENT_G", "UI_ACCENT_B"),
        accent.dim(),
        accent.dim(),
        readRgba(config, "LOOT_FILTER_CHIP_BG_FILL_R", "LOOT_FILTER_CHIP_BG_FILL_G",
                         "LOOT_FILTER_CHIP_BG_FILL_B", "LOOT_FILTER_CHIP_BG_FILL_A"),
        readRgb(config, "LOOT_FILTER_TEXT_BRIGHT_R", "LOOT_FILTER_TEXT_BRIGHT_G", "LOOT_FILTER_TEXT_BRIGHT_B"),
        readRgba(config, "LOOT_FILTER_TEXT_DIM_R", "LOOT_FILTER_TEXT_DIM_G",
                         "LOOT_FILTER_TEXT_DIM_B", "LOOT_FILTER_TEXT_DIM_A"),
        readRgb(config, "LOOT_FILTER_SECTION_HDR_R", "LOOT_FILTER_SECTION_HDR_G", "LOOT_FILTER_SECTION_HDR_B"),
        readRgba(config, "LOOT_FILTER_SWATCH_OFF_FILL_R", "LOOT_FILTER_SWATCH_OFF_FILL_G",
                         "LOOT_FILTER_SWATCH_OFF_FILL_B", "LOOT_FILTER_SWATCH_OFF_FILL_A"),
        readRgba(config, "LOOT_FILTER_SWATCH_OFF_BORDER_R", "LOOT_FILTER_SWATCH_OFF_BORDER_G",
                         "LOOT_FILTER_SWATCH_OFF_BORDER_B", "LOOT_FILTER_SWATCH_OFF_BORDER_A"),
        readRgba(config, "LOOT_FILTER_SWATCH_OFF_LABEL_R", "LOOT_FILTER_SWATCH_OFF_LABEL_G",
                         "LOOT_FILTER_SWATCH_OFF_LABEL_B", "LOOT_FILTER_SWATCH_OFF_LABEL_A")}
    , fontChip(static_cast<unsigned>(config.getInt("LOOT_FILTER_CHIP_FONT_SIZE")))
    , fontSection(static_cast<unsigned>(config.getInt("LOOT_FILTER_SECTION_SIZE")))
    , fontLabel(static_cast<unsigned>(config.getInt("LOOT_FILTER_LABEL_FONT_SIZE")))
    , fontInput(static_cast<unsigned>(config.getInt("LOOT_FILTER_INPUT_FONT_SIZE")))
    , fontSwatchLabel(static_cast<unsigned>(config.getInt("LOOT_FILTER_SWATCH_LABEL_FONT_SIZE"))) {
    hintText = config.getString("LOOT_FILTER_HINT_TEXT");
}

void LootFilterOverlay::drawQualityTierSwatches(sf::RenderWindow& window,
                                                  sf::FloatRect fieldRect,
                                                  const std::string& qualityInput) const {
    if (!fontPtr) return;

    int q = 0;
    if (!qualityInput.empty()) {
        try { q = std::stoi(qualityInput); } catch (...) { q = 0; }
    }

    // Which tiers are affected by this ceiling:
    //   q==0 → no ceiling → all tiers destroyed
    //   q>0  → items with qualityScore <= q are destroyed
    const bool showCommon   = (q == 0) || (q >= 1);
    const bool showUncommon = (q == 0) || (q >= uncommonThreshold);
    const bool showRare     = (q == 0) || (q >= rareThreshold);

    constexpr float kSwatchSz  = 10.0f;
    constexpr float kSwatchGap =  4.0f;
    constexpr float kLabelGap  =  2.0f;
    constexpr float kTotalW    = kSwatchSz * 3.0f + kSwatchGap * 2.0f;

    // Center the three swatches horizontally under the field.
    const float startX = fieldRect.position.x + (fieldRect.size.x - kTotalW) * 0.5f;
    const float swatchY = fieldRect.position.y + fieldRect.size.y + 4.0f;
    const float labelY  = swatchY + kSwatchSz + kLabelGap;

    struct Swatch { sf::Color color; bool active; const char* label; };
    const Swatch swatches[3] = {
        {tierCommon,   showCommon,   "C"},
        {tierUncommon, showUncommon, "U"},
        {tierRare,     showRare,     "R"},
    };

    for (int i = 0; i < 3; ++i) {
        const float x = startX + static_cast<float>(i) * (kSwatchSz + kSwatchGap);
        const sf::Color col = swatches[i].active
            ? swatches[i].color
            : palette.swatchOffFill;
        const sf::Color border = swatches[i].active
            ? swatches[i].color
            : palette.swatchOffBorder;

        sf::RectangleShape sq{{kSwatchSz, kSwatchSz}};
        sq.setPosition({x, swatchY});
        sq.setFillColor(col);
        sq.setOutlineColor(border);
        sq.setOutlineThickness(1.0f);
        window.draw(sq);

        sf::Text lbl{*fontPtr, swatches[i].label, fontSwatchLabel};
        lbl.setFillColor(swatches[i].active ? swatches[i].color : palette.swatchOffLabel);
        const auto lb = lbl.getLocalBounds();
        lbl.setPosition({x + (kSwatchSz - lb.size.x) * 0.5f - lb.position.x, labelY - lb.position.y});
        window.draw(lbl);
    }
}

void LootFilterOverlay::draw(sf::RenderWindow& window,
                              const LootFilterLayout& layout,
                              const dof::hubs::LootFilter& filter,
                              bool isQualityFocused,
                              bool isLevelFocused,
                              const std::string& qualityInput,
                              const std::string& levelInput) const {
    if (!fontPtr) return;
    const sf::Font& font = *fontPtr;

    // Panel background.
    ui::UiPanel bg;
    bg.background      = palette.popupBg;
    bg.border          = accent.full();
    bg.borderThickness = accent.thicknessOutline;
    bg.draw(window, layout.popupRect());

    // Title chip.
    ui::UiChip titleChip = chip;
    titleChip.anchor = ui::UiChip::Anchor::TopLeft;
    titleChip.draw(window, layout.popupRect(), font, "LOOT FILTER", 120.0f);

    const sf::FloatRect panel = layout.popupRect();
    const float px = panel.position.x;
    // Must be the SAME padding the layout uses to place the chips and fields
    // these headers label — a local literal of 16 against the configured 18
    // left every section header and the hint footer 2px off its column.
    const float padding = configRef.getFloat("LOOT_FILTER_PADDING");

    // "WEAPON TYPES" section header sits just above the first chip row.
    // Use chipRect(0) as the anchor — offset upward by fontSection + gap.
    const auto wChip0 = layout.weaponChipRect(0);
    drawSectionLabel(window,
        {px + padding, wChip0.position.y - static_cast<float>(fontSection) - 6.0f},
        "WEAPON TYPES", font, fontSection, palette);

    for (int i = 0; i < kWeaponChipCount; ++i) {
        const bool sel = filter.weaponTypes.count(kWeaponChipTypes[i]) > 0;
        drawWeaponChip(window, layout.weaponChipRect(i),
                       kWeaponChipTypes[i],
                       dof::entities::weaponTypeName(kWeaponChipTypes[i]),
                       sel, font, fontChip, palette, configRef);
    }

    // "DICE TYPES" section header.
    const auto dChip0 = layout.diceChipRect(0);
    drawSectionLabel(window,
        {px + padding, dChip0.position.y - static_cast<float>(fontSection) - 6.0f},
        "DICE TYPES", font, fontSection, palette);

    for (int i = 0; i < kDiceChipCount; ++i) {
        const bool sel = filter.diceTypes.count(kDiceChipFaces[i]) > 0;
        drawDiceChip(window, layout.diceChipRect(i),
                     dof::entities::diceFaceCount(kDiceChipFaces[i]),
                     dof::entities::diceFaceLabel(kDiceChipFaces[i]),
                     sel, font, fontChip, palette);
    }

    // Input row section header — raised clear of the per-field
    // "MAX QUALITY" / "MAX LEVEL" sublabels (drawn at field.y - 14).
    const auto qRect = layout.qualityFieldRect();
    drawSectionLabel(window,
        {px + padding, qRect.position.y - static_cast<float>(fontSection) - 20.0f},
        "FILTER THRESHOLD  (0 = all)", font, fontSection, palette);

    // Quality field.
    {
        sf::Text lbl{font, "MAX QUALITY", fontLabel};
        lbl.setFillColor(palette.textDim);
        lbl.setPosition({qRect.position.x, qRect.position.y - 14.0f});
        window.draw(lbl);
    }
    drawInputField(window, qRect, qualityInput, isQualityFocused, font, fontInput, palette);
    drawQualityTierSwatches(window, qRect, qualityInput);

    // Level field.
    const auto lRect = layout.levelFieldRect();
    {
        sf::Text lbl{font, "MAX LEVEL", fontLabel};
        lbl.setFillColor(palette.textDim);
        lbl.setPosition({lRect.position.x, lRect.position.y - 14.0f});
        window.draw(lbl);
    }
    drawInputField(window, lRect, levelInput, isLevelFocused, font, fontInput, palette);

    // UNSET button — clears every chip + threshold. Bottom-right of the panel
    // (opposite the bottom-left quality-tier swatches).
    {
        const sf::FloatRect btn = layout.unsetButtonRect();
        const bool armed = filter.isActive();
        ui::UiPanel box;
        box.background      = armed ? palette.chipSelFill : palette.chipBgFill;
        box.border          = armed ? palette.cyan : palette.chipBorder;
        box.borderThickness = armed ? 1.5f : 1.0f;
        box.draw(window, btn);

        sf::Text label{font, "UNSET", fontChip};
        label.setFillColor(armed ? palette.cyan : palette.textDim);
        const auto lb = label.getLocalBounds();
        label.setPosition({
            btn.position.x + (btn.size.x - lb.size.x) * 0.5f - lb.position.x,
            btn.position.y + (btn.size.y - lb.size.y) * 0.5f - lb.position.y
        });
        window.draw(label);
    }

    // Context hint footer: panel-local guidance, not a first-run tutorial.
    sf::Text hint{font, hintText, fontLabel};
    hint.setFillColor(palette.textDim);
    const auto hb = hint.getLocalBounds();
    hint.setPosition({
        panel.position.x + padding,
        panel.position.y + panel.size.y - hb.size.y - padding * 0.55f
    });
    window.draw(hint);
}

} // namespace dof::render
