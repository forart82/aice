#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>

namespace sf { class RenderTarget; }
namespace dof::entities { class Enemy; }
namespace dof::loaders { class ConfigLoader; }
namespace dof::render::ui { class QuadBatch; }

namespace dof::render {

// Compact swarm-view facts: weapon presence, dice presence, and a subdued
// ready marker. Detailed loadout cards are deliberately reserved for debug UI.
class EnemyInfoBar {
public:
    explicit EnemyInfoBar(const dof::loaders::ConfigLoader& config);

    void appendChrome(sf::RenderTarget& window,
                      ui::QuadBatch& batch,
                      const dof::entities::Enemy& enemy,
                      sf::FloatRect barRect,
                      float scale,
                      float alphaScalar) const;
    void drawForeground(sf::RenderTarget& window,
                        const dof::entities::Enemy& enemy,
                        sf::FloatRect barRect,
                        float scale,
                        float alphaScalar) const;

private:
    const dof::loaders::ConfigLoader& configRef;
    float offsetY;
    float indicatorSize;
    float indicatorGap;
    float readinessHeight;
    sf::Color readinessColor;
    sf::Color diceColor;
    float chargeWidth;
    float chargeHeight;
    sf::Color chargeTrackColor;
    sf::Color chargeFillColor;
};

}
