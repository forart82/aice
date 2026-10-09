#pragma once

#include "render/UiAccent.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>

#include <string>

namespace dof::loaders { class ConfigLoader; }
namespace sf { class RenderWindow; class Font; }

namespace dof::render::ui {

// Badge chip anchored ON a panel's top edge (overhanging upward by half
// its height so it reads as a tab on the outline). One struct covers both
// the title chip (top-left, label only) and the status chip (top-right,
// optional status dot + label). Ported from the former free functions
// titleChipRect/drawTitleChip + statusChipRect/drawStatusChip; the chip
// body is composed from ui::UiPanel rather than hand-drawn.
struct UiChip {
    enum class Anchor { TopLeft, TopRight };

    UiAccent  accent{};
    Anchor    anchor{Anchor::TopLeft};
    float     chamferOffset{0.0f};
    float     height{0.0f};
    float     paddingX{0.0f};
    float     paddingY{0.0f};
    unsigned  fontSize{0u};
    sf::Color fill;
    sf::Color text;
    float     statusDotRadius{0.0f};

    // Load the canonical chip metrics + colours from config
    // (UIR_CHAMFER_OFFSET, UIR_CHIP_*, UIR_STATUS_DOT_RADIUS, accent).
    static UiChip loadFromConfig(const dof::loaders::ConfigLoader& config);

    // Chip rect for `panel` with the given `width`, anchored per `style.anchor`.
    // Static so callers can position against it without drawing. The anchor is
    // read off `style` rather than passed separately — it used to be both, and
    // draw() handed its own member in twice.
    static sf::FloatRect rectFor(sf::FloatRect panel, const UiChip& style, float width);

    // Draw the chip on `panel`. When `dotColor.a > 0` a status dot is
    // drawn on the left and the label is shifted past it (status-chip
    // form); otherwise it is a plain title chip.
    void draw(sf::RenderWindow& window, sf::FloatRect panel, const sf::Font& font,
              const std::string& label, float width,
              sf::Color dotColor = sf::Color::Transparent) const;
};

} // namespace dof::render::ui
