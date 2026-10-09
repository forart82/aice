#pragma once

#include "combat/DronDetector.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>

namespace sf { class RenderWindow; class Font; }

namespace dof::render::widgets {

// Renders the dron-indicator column: a vertical divider hairline on the
// left edge of `zone`, then either a rotated "ROLLING" label (when all
// dice are still rolling) or a centred multiplier + Dron name when the
// detector fires a pattern (PACT, STORM, etc.).
//
// All colours are caller-supplied so the cell can be styled per-row
// (charged vs dim) without carrying a reference to the full config.
struct UiDronCell {
    sf::Color multiplierColor;   // accent colour for "xN"
    sf::Color nameColor;         // dim grey for the Dron pattern name
    // Neutral dim slate default (was a baked bright-cyan 80,230,255 — the old
    // accent hue). Consumers override this from the canonical accent; the
    // fallback just harmonises with the dark-blue chrome if left unset.
    sf::Color dividerColor{60, 80, 110, 40};
    float     dividerThickness{1.0f};
    // Fonts + layout offsets — caller-overridable, but no caller sets them:
    // the weapon-slot sidebar and the component gallery leave every field at
    // the hard-coded C++ defaults below (no weapon-slot config keys feed them).
    unsigned  rollingFontSize{7};           // vertical "ROLLING" label
    unsigned  multiplierFontSize{15};       // "xN" multiplier label
    unsigned  nameFontSize{7};              // Dron pattern-name label
    float     rollingOffsetX{4.0f};         // ROLLING nudge right of column centre
    float     rollingVerticalFactor{0.25f}; // ROLLING lift = rowHeight * this
    float     multiplierOffsetY{20.0f};     // multiplier band above centre
    float     multiplierHeight{18.0f};      // multiplier band height
    float     nameOffsetY{4.0f};            // name band below centre
    float     nameHeight{10.0f};            // name band height

    void draw(sf::RenderWindow& window,
              sf::FloatRect zone,
              float rowHeight,
              const sf::Font& font,
              const dof::combat::DronResult& dron) const;
};

} // namespace dof::render::widgets
