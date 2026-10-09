#pragma once
#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <string>
#include <vector>

namespace dof::render::ui {
// Tab strip — `labels.size()` equal-width tabs across `stripRect`. The CALLER
// owns the active index, the hovered index and enablement, and passes the same
// enablement to draw() AND hitTest(): a disabled strip paints no hover and
// reports no hit, so a dimmed strip can never stay clickable. The active tab
// still reads as active when disabled — you can see where you are, you just
// cannot move.
struct UiTab {
    sf::Color bgInactive, bgActive, bgHover, border, textInactive, textActive;
    float     borderThickness{1.0f};
    void draw(sf::RenderWindow& window, sf::FloatRect stripRect,
              const sf::Font& font, unsigned fontSize,
              const std::vector<std::string>& labels, int activeIndex, int hoveredIndex,
              bool isEnabled = true) const;

    // Index of the tab under `point`, or -1 for none. `isEnabled` is
    // deliberately NOT defaulted so it must come from the same source draw()
    // got it from.
    int hitTest(sf::FloatRect stripRect, const std::vector<std::string>& labels,
                sf::Vector2f point, bool isEnabled) const;
};
} // namespace dof::render::ui
