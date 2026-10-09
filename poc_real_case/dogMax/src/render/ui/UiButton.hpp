#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/System/Vector2.hpp>
#include <string>

namespace dof::render::ui {

// Text button. Immediate mode: the CALLER owns hover and enablement and passes
// both to draw() AND to hitTest(), so a dimmed button can never stay clickable.
// A disabled button ignores `isHovered` entirely — no hover fill, no brightened
// halo — and hitTest() reports no hit.
struct UiButton {
    sf::Color  bgNormal;
    sf::Color  bgHover;
    sf::Color  border;
    sf::Color  textNormal;
    sf::Color  textHover;
    float      borderThickness{1.0f};
    // Neon outer glow around the button border — a small default so every
    // button across every form reads as a glowing cyberpunk control without
    // per-call setup. glowSpread <= 0 disables it (flat border). Hover
    // brightens the halo (glowAlphaHover) so pressability reads at a glance.
    float      glowSpread{5.0f};
    int        glowLayers{4};
    float      glowAlpha{45.0f};
    float      glowAlphaHover{95.0f};

    void draw(sf::RenderWindow& window, sf::FloatRect rect,
              const sf::Font& font, const std::string& label,
              unsigned fontSize, bool isHovered, bool isEnabled = true) const;

    // Point-in-control test — the whole rect is the target. `isEnabled` is
    // deliberately NOT defaulted: the caller must hand the hit-test the same
    // flag it handed draw(), so "painted dimmed but still clickable" cannot
    // survive a compile.
    bool hitTest(sf::FloatRect rect, sf::Vector2f point, bool isEnabled) const;
};

} // namespace dof::render::ui
