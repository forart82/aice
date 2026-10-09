#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>

namespace dof::loaders { class ConfigLoader; }
namespace sf { class RenderWindow; }

namespace dof::render::ui {

// Diagonal hazard-stripe plate — a dark wash overlaid with angled bars,
// pre-clipped to the target rect so stripes never bleed onto neighbours.
// Plain style-holder ported from the former free function drawHazardStripe.
struct UiHazardStripe {
    float     period{0.0f};       // stripe pitch; bar width is half the pitch
    sf::Color stripeA;            // bar colour (the "hazard yellow")
    sf::Color stripeB;            // base wash colour behind the bars
    float     angleDegrees{0.0f}; // bar direction

    // Load the canonical stripe params from config (UIR_HAZARD_STRIPE_*).
    static UiHazardStripe loadFromConfig(const dof::loaders::ConfigLoader& config);

    // Fill `rect` with the base wash and the clipped diagonal bars.
    void draw(sf::RenderWindow& window, sf::FloatRect rect) const;
};

} // namespace dof::render::ui
