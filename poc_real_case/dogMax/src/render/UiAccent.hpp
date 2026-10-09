#pragma once

#include <SFML/Graphics/Color.hpp>
#include <cstdint>

namespace dof::loaders { class ConfigLoader; }

namespace dof::render {

// Canonical UI accent stroke loaded from `theme.yaml`. Every UI
// surface (inventory, tooltip, debug panel, console, sidebar, fps
// label, healthbar trim) reads its outline + active-state colour
// through this helper so the chrome reads as one set instead of
// drifting per surface.
//
// Two alpha bands keep the visual hierarchy: `full` is the high-
// emphasis stroke used on framed panels (inventory, tooltip, debug
// panel, console); `dim` is the low-emphasis stroke used on tiled
// rows that would otherwise stack into a loud frame (weapon-slot
// sidebar). Two thickness bands mirror the same idea (`outline` for
// framed panels, `hairline` for tooltip rules + healthbar trim).
struct UiAccent {
    sf::Color    rgb;
    std::uint8_t alphaFull{0};
    std::uint8_t alphaDim{0};
    float        thicknessOutline{0.0f};
    float        thicknessHairline{0.0f};

    static UiAccent loadFromConfig(const dof::loaders::ConfigLoader& config);

    sf::Color full() const;
    sf::Color dim() const;
};

}
