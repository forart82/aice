#pragma once
#include "render/ui/UiPanel.hpp"
#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/System/Vector2.hpp>
#include <string>

namespace dof::render::ui {
struct UiTooltip {
    UiPanel   panel;
    sf::Color titleColor{sf::Color::White};
    sf::Color bodyColor{sf::Color{180, 190, 210}};
    sf::Color labelColor{sf::Color{130, 145, 165}};
    sf::Color valueColor{sf::Color::White};
    sf::Color sectionColor{sf::Color::White};
    sf::Color ruleColor{sf::Color{255, 255, 255, 90}};
    sf::Color badgeTextColor{sf::Color::White};
    sf::Color badgeBgColor{sf::Color{255, 255, 255, 35}};
    float     padding{10.0f}, maxWidth{300.0f};
    float     titleFontSize{13.f}, bodyFontSize{11.f};
    float     lineHeight{15.0f}, titleBodyGap{6.0f};
    float     rowLabelWidth{84.0f}, badgeWidth{22.0f};
    float     sectionGap{5.0f}, emptyLineHeight{6.0f};
    // When `useGlow` is set (UI_GLOW_ENABLE on) the frame is drawn as the
    // aligned glow (crisp `glowColor` border on the rect edge + outward
    // additive halo) via drawGlowFrame; otherwise the flat `panel` frame.
    // The rect is computed here, so the glow is routed through this call.
    void draw(sf::RenderWindow& window, sf::Vector2f anchorPoint,
              const sf::Font& font, const std::string& title,
              const std::string& body, sf::Vector2f viewSize,
              bool useGlow = false,
              sf::Color glowColor = sf::Color::White,
              float glowSpread = 10.0f, int glowLayers = 5, float glowAlpha = 70.0f) const;
};
} // namespace dof::render::ui
