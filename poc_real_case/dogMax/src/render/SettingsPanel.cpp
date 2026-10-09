#include "render/SettingsPanel.hpp"

#include "render/UiAccent.hpp"
#include "render/ColorTheme.hpp"
#include "render/ui/UiChip.hpp"
#include "loaders/ConfigLoader.hpp"

#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/RenderWindow.hpp>

#include <algorithm>
#include <cmath>
#include <string>

namespace dof::render {

using Kind = SettingDescriptor::Kind;

SettingsPanel::SettingsPanel(const dof::loaders::ConfigLoader& config, const sf::Font& font)
    : font_(font) {
    const auto& c = config;
    // Small scalar readers keep the constructor's geometry block declarative.
    const auto readInt   = [&](const std::string& k) { return c.getInt(k); };
    const auto readFloat = [&](const std::string& k) { return c.getFloat(k); };

    // ---- geometry ----
    bounds_ = sf::FloatRect{
        {static_cast<float>(readInt("SETTINGS_PANEL_X")),
         static_cast<float>(readInt("SETTINGS_PANEL_Y"))},
        {static_cast<float>(readInt("SETTINGS_PANEL_WIDTH")),
         static_cast<float>(readInt("SETTINGS_PANEL_HEIGHT"))}};
    rowHeight_   = readFloat("SETTINGS_ROW_HEIGHT");
    rowGap_      = readFloat("SETTINGS_ROW_GAP");
    labelWidth_  = readFloat("SETTINGS_LABEL_WIDTH");
    valueWidth_  = readFloat("SETTINGS_VALUE_WIDTH");
    controlGap_  = readFloat("SETTINGS_CONTROL_GAP");

    // ---- window frame: body fill from the canonical THEME_PANEL_BG (so the
    // Panel-Opacity slider restyles this window too), border + title chip
    // from the live UI_ACCENT (so the accent sliders restyle it too). ----
    const UiAccent accent = UiAccent::loadFromConfig(c);
    // Single-accent chrome: every control colour routes through the accent
    // brightness ladder (panel-bg / accent-dim / accent-full) plus the shared
    // text tokens, built once here and reused for all widgets below.
    const ColorTheme theme    = buildColorTheme(c);
    const sf::Color   panelBg = resolvePanelBackground(c, "THEME_PANEL_BG");
    window_.panel.background      = readRgba(c, "THEME_PANEL_BG_R", "THEME_PANEL_BG_G",
                                             "THEME_PANEL_BG_B", "THEME_PANEL_BG_A");
    window_.panel.border          = accent.full();
    window_.panel.borderThickness = accent.thicknessOutline;
    window_.panel.isPixelSnapped  = true;
    window_.titleChip             = ui::UiChip::loadFromConfig(c);
    titleFontSize_                = static_cast<unsigned>(readInt("SETTINGS_TITLE_FONT_SIZE"));
    window_.titleChip.fontSize    = titleFontSize_;
    window_.titleBarHeight        = readFloat("SETTINGS_TITLE_BAR_HEIGHT");
    window_.contentPadding        = readFloat("SETTINGS_CONTENT_PADDING");
    window_.showTitle             = true;
    // Neon glow frame, coherent with the inventory / dice-crafter panels.
    if (c.getInt("UI_GLOW_ENABLE") != 0) {
        window_.glowSpread = c.getFloat("UI_GLOW_SPREAD");
        window_.glowLayers = c.getInt("UI_GLOW_LAYERS");
        window_.glowAlpha  = c.getFloat("UI_GLOW_ALPHA");
    }
    title_                        = c.getString("SETTINGS_TITLE");
    content_                      = window_.contentRect(bounds_, title_);

    // ---- settings list ----
    const int rowCount = readInt("SETTINGS_ROW_COUNT");
    for (int i = 0; i < rowCount; ++i) {
        const std::string p = "SETTINGS_ROW" + std::to_string(i);
        SettingDescriptor d;
        d.label     = c.getString(p + "_LABEL");
        d.configKey = c.getString(p + "_KEY");
        d.minValue  = c.getInt(p + "_MIN");
        d.maxValue  = c.getInt(p + "_MAX");
        d.kind      = (c.getString(p + "_KIND") == "toggle") ? Kind::Toggle : Kind::Slider;
        rows_.push_back(std::move(d));
    }

    // ---- save button, right-aligned below the last row ----
    const float saveW   = readFloat("SETTINGS_SAVE_BUTTON_WIDTH");
    const float saveH   = readFloat("SETTINGS_SAVE_BUTTON_HEIGHT");
    const float saveGap = readFloat("SETTINGS_SAVE_BUTTON_GAP");
    const float rowsBottom = content_.position.y
                           + static_cast<float>(rowCount) * (rowHeight_ + rowGap_);
    saveButton_ = sf::FloatRect{
        {content_.position.x + content_.size.x - saveW, rowsBottom + saveGap}, {saveW, saveH}};

    // ---- control styling (slider / toggle / button) ----
    slider_.track           = panelBg;          // inert track -> panel background
    slider_.fill            = accent.full();     // active fill -> accent
    slider_.knob            = theme.uiText;      // idle handle -> text
    slider_.knobDragging    = accent.full();     // dragged handle -> accent (active)
    slider_.border          = accent.dim();      // knob outline -> accent-dim
    slider_.trackThickness  = readFloat("SETTINGS_SLIDER_TRACK_THICKNESS");
    slider_.knobWidth       = readFloat("SETTINGS_SLIDER_KNOB_WIDTH");
    slider_.knobHeight      = readFloat("SETTINGS_SLIDER_KNOB_HEIGHT");
    slider_.borderThickness = readFloat("SETTINGS_SLIDER_BORDER_THICKNESS");

    toggle_.boxOff          = panelBg;           // off box -> panel background
    toggle_.boxOn           = accent.full();      // on box -> accent (was green drift)
    toggle_.boxHover        = accent.dim();        // hovered off box -> accent-dim
    toggle_.border          = accent.dim();        // box outline -> accent-dim
    toggle_.check           = theme.uiText;        // inset check -> text
    toggle_.borderThickness = readFloat("SETTINGS_TOGGLE_BORDER_THICKNESS");
    toggle_.boxSize         = readFloat("SETTINGS_TOGGLE_BOX_SIZE");
    toggle_.labelGap        = readFloat("SETTINGS_TOGGLE_LABEL_GAP");
    toggle_.checkInset      = readFloat("SETTINGS_TOGGLE_CHECK_INSET");

    // Save button: bg -> panel background, hover -> accent-dim, border reuses
    // the live accent stroke (accent sliders restyle it), label -> text.
    button_ = ui::UiButton{panelBg, accent.dim(),
                           accent.full(), theme.uiText,
                           theme.uiText};
    buttonFontSize_ = static_cast<unsigned>(readInt("SETTINGS_BUTTON_FONT_SIZE"));

    labelStyle_  = ui::UiLabel{theme.uiText,
                               static_cast<unsigned>(readInt("SETTINGS_LABEL_FONT_SIZE")),
                               ui::TextAlign::Left};
    valueStyle_  = ui::UiLabel{theme.uiText,
                               static_cast<unsigned>(readInt("SETTINGS_VALUE_FONT_SIZE")),
                               ui::TextAlign::Right};
    // "Saved!" confirmation flash -> accent (no dedicated success token).
    statusStyle_ = ui::UiLabel{accent.full(),
                               static_cast<unsigned>(readInt("SETTINGS_LABEL_FONT_SIZE")),
                               ui::TextAlign::Left};
}

sf::FloatRect SettingsPanel::labelRect(int rowIndex) const {
    const float y = content_.position.y + static_cast<float>(rowIndex) * (rowHeight_ + rowGap_);
    return sf::FloatRect{{content_.position.x, y}, {labelWidth_, rowHeight_}};
}

sf::FloatRect SettingsPanel::controlRect(int rowIndex) const {
    const float y = content_.position.y + static_cast<float>(rowIndex) * (rowHeight_ + rowGap_);
    const float x = content_.position.x + labelWidth_ + controlGap_;
    const float w = content_.size.x - labelWidth_ - valueWidth_ - 2.0f * controlGap_;
    return sf::FloatRect{{x, y}, {std::max(0.0f, w), rowHeight_}};
}

sf::FloatRect SettingsPanel::valueRect(int rowIndex) const {
    const float y = content_.position.y + static_cast<float>(rowIndex) * (rowHeight_ + rowGap_);
    return sf::FloatRect{{content_.position.x + content_.size.x - valueWidth_, y},
                         {valueWidth_, rowHeight_}};
}

void SettingsPanel::render(sf::RenderWindow& window, const dof::loaders::ConfigLoader& config,
                           sf::Vector2f mouseUi, int dragRow, const std::string& status) const {
    window_.drawFrame(window, bounds_, font_, title_);

    for (int i = 0; i < static_cast<int>(rows_.size()); ++i) {
        const SettingDescriptor& d = rows_[i];
        labelStyle_.draw(window, labelRect(i), font_, d.label);
        const sf::FloatRect ctl = controlRect(i);
        const int value = config.getInt(d.configKey);
        if (d.kind == Kind::Slider) {
            const float span = static_cast<float>(d.maxValue - d.minValue);
            const float t = span > 0.0f
                ? std::clamp((static_cast<float>(value) - static_cast<float>(d.minValue)) / span,
                             0.0f, 1.0f)
                : 0.0f;
            slider_.draw(window, ctl, t, dragRow == i);
            valueStyle_.draw(window, valueRect(i), font_, std::to_string(value));
        } else {
            const bool isOn  = value != 0;
            // Hover comes from the widget's OWN hit-test, the same one
            // toggleRowAt() clicks through — so the highlighted area and the
            // clickable area are the same rect by construction.
            const bool hover = toggle_.hitTest(ctl, mouseUi, /*isEnabled=*/true);
            toggle_.draw(window, ctl, isOn, hover);
            valueStyle_.draw(window, valueRect(i), font_, isOn ? "On" : "Off");
        }
    }

    button_.draw(window, saveButton_, font_, "Save", buttonFontSize_, saveButton_.contains(mouseUi));

    // Transient Save confirmation, left of the button on the same band.
    if (!status.empty()) {
        const sf::FloatRect statusRect{
            {content_.position.x, saveButton_.position.y},
            {std::max(0.0f, saveButton_.position.x - content_.position.x - 8.0f), saveButton_.size.y}};
        statusStyle_.draw(window, statusRect, font_, status);
    }
}

bool SettingsPanel::contains(sf::Vector2f point) const { return bounds_.contains(point); }

bool SettingsPanel::saveButtonContains(sf::Vector2f point) const {
    return saveButton_.contains(point);
}

int SettingsPanel::sliderRowAt(sf::Vector2f point) const {
    for (int i = 0; i < static_cast<int>(rows_.size()); ++i) {
        if (rows_[i].kind == Kind::Slider && controlRect(i).contains(point)) return i;
    }
    return -1;
}

int SettingsPanel::toggleRowAt(sf::Vector2f point) const {
    // ui::UiToggle::hitTest, not a hand-rolled box test: the widget owns what
    // "inside this toggle" means (its whole rect, box + label area), and
    // render() paints hover through the same call. Every setting row is always
    // interactive here, so enablement is a literal true.
    for (int i = 0; i < static_cast<int>(rows_.size()); ++i) {
        if (rows_[i].kind == Kind::Toggle
            && toggle_.hitTest(controlRect(i), point, /*isEnabled=*/true))
            return i;
    }
    return -1;
}

int SettingsPanel::sliderValueAt(int rowIndex, float x) const {
    const SettingDescriptor& d = rows_[static_cast<std::size_t>(rowIndex)];
    const float t = slider_.valueAtX(controlRect(rowIndex), x);
    const int span = d.maxValue - d.minValue;
    const int value = d.minValue + static_cast<int>(std::lround(t * static_cast<float>(span)));
    return std::clamp(value, d.minValue, d.maxValue);
}

}
