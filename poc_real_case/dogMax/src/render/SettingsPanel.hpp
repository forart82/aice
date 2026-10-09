#pragma once

// Phase G (G-misc) — player-facing Settings / Theme window. A real in-game
// panel to tune the UI live, built on the ui:: toolkit: it composes
// ui::UiWindow (frame + title chip) with one ui::UiLabel + one control
// (ui::UiSlider or ui::UiToggle) per setting row, plus a ui::UiButton to
// persist. Opened with the P key (GameSession_Events); Esc closes.
//
// Config-driven + immediate-mode. Geometry, colours and the SETTINGS LIST
// itself come from configs/settings.yaml (captured at construction — the
// panel is rebuilt by applyConfigToRenderers on every config change, so the
// styling always tracks the live theme). The bound VALUES are read from the
// ConfigLoader every frame in render(), so an override shows instantly.
//
// The panel owns NO mutable state: the open flag and the active drag row
// live in render::UiState (survive the rebuild). Each control edit routes
// through GameSession::handleSettingsMouseEvent -> ConfigLoader::setOverride,
// whose per-frame dirty -> applyConfigToRenderers makes the change live; the
// Save button calls ConfigLoader::saveOverrides to persist to _overrides.yaml.

#include "render/ui/UiButton.hpp"
#include "render/ui/UiLabel.hpp"
#include "render/ui/UiSlider.hpp"
#include "render/ui/UiToggle.hpp"
#include "render/ui/UiWindow.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/System/Vector2.hpp>

#include <cstdint>
#include <string>
#include <vector>

namespace sf { class RenderWindow; class Font; }
namespace dof::loaders { class ConfigLoader; }

namespace dof::render {

// One exposed setting: a display label bound to a config key over an integer
// range, rendered as either a draggable slider or an on/off toggle. Loaded
// from the SETTINGS_ROWi_* keys in settings.yaml.
struct SettingDescriptor {
    enum class Kind : std::uint8_t { Slider, Toggle };
    std::string label;
    std::string configKey;
    int         minValue{0};
    int         maxValue{255};
    Kind        kind{Kind::Slider};
};

class SettingsPanel {
public:
    SettingsPanel(const dof::loaders::ConfigLoader& config, const sf::Font& font);

    // Draw the window frame, every setting row (value read live from
    // `config`) and the Save button. `mouseUi` drives hover on the button +
    // toggle; `dragRow` (-1 = none) marks the slider knob being dragged;
    // `status` is the transient Save-confirmation banner (empty = hidden).
    void render(sf::RenderWindow& window, const dof::loaders::ConfigLoader& config,
                sf::Vector2f mouseUi, int dragRow, const std::string& status) const;

    // ---- pure hit-testing / geometry (UI design coords, captured at ctor) ----
    const std::vector<SettingDescriptor>& rows() const { return rows_; }
    bool contains(sf::Vector2f point) const;         // anywhere in the window
    int  sliderRowAt(sf::Vector2f point) const;      // slider row hit, else -1
    int  toggleRowAt(sf::Vector2f point) const;      // toggle box hit, else -1
    bool saveButtonContains(sf::Vector2f point) const;

    // Map a pointer x within slider row `rowIndex` back to that row's integer
    // config value, clamped to [min,max]. Precondition: rowIndex is a valid
    // Slider row (as returned by sliderRowAt).
    int sliderValueAt(int rowIndex, float x) const;

private:
    // Geometry helpers over the captured layout.
    sf::FloatRect controlRect(int rowIndex) const;   // slider track / toggle band
    sf::FloatRect labelRect(int rowIndex) const;
    sf::FloatRect valueRect(int rowIndex) const;

    const sf::Font& font_;
    std::vector<SettingDescriptor> rows_;

    // Captured geometry.
    sf::FloatRect bounds_;      // whole window
    sf::FloatRect content_;     // inner content area (below title bar, inset)
    float rowHeight_{0.0f};
    float rowGap_{0.0f};
    float labelWidth_{0.0f};
    float valueWidth_{0.0f};
    float controlGap_{0.0f};
    sf::FloatRect saveButton_;

    // Captured fonts.
    unsigned titleFontSize_{0u};
    unsigned buttonFontSize_{0u};

    // Captured styling.
    std::string  title_;
    ui::UiWindow window_;
    ui::UiSlider slider_;
    ui::UiToggle toggle_;
    ui::UiButton button_;
    ui::UiLabel  labelStyle_;
    ui::UiLabel  valueStyle_;
    ui::UiLabel  statusStyle_;
};

}
