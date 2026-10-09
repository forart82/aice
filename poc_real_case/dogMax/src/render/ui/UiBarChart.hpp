#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>

#include <vector>

namespace sf { class RenderWindow; }

namespace dof::render::ui {

// Vertical bar chart — N bars laid left-to-right across a rect, each
// filled bottom-up by a normalized [0,1] height. Intended for compact
// perf/history read-outs. Plain caller-styled holder (no config keys of
// its own); the caller sets both colours and the inter-bar gap.
struct UiBarChart {
    sf::Color fill;        // filled portion of each bar
    sf::Color track;       // unfilled/background portion of each bar
    float     gap{2.0f};   // horizontal space between bars

    // Draw one bar per entry in `values` (each clamped to [0,1]) filling
    // `rect` left-to-right. Empty `values` is a no-op.
    void draw(sf::RenderWindow& window, sf::FloatRect rect,
              const std::vector<float>& values) const;

    // Same as above, but each bar's filled portion uses `perBarFill[i]`
    // instead of the uniform `fill` colour (e.g. a good/bad threshold
    // read-out). `perBarFill` must be empty or the same size as `values`;
    // when empty, falls back to the uniform `fill` colour.
    void draw(sf::RenderWindow& window, sf::FloatRect rect,
              const std::vector<float>& values,
              const std::vector<sf::Color>& perBarFill) const;
};

} // namespace dof::render::ui
