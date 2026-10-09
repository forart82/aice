#pragma once

#include <SFML/System/Vector2.hpp>

namespace dof::render {

struct BarRect {
    float x{0.0f};
    float y{0.0f};
    float width{0.0f};
    float height{0.0f};
};

struct BarLayout {
    static BarRect computeHeroBarRect(sf::Vector2f heroCenter,
                                      float heroRadius,
                                      float barWidth,
                                      float barHeight,
                                      float offsetAboveTopEdge);

    static BarRect computeEnemyBarRect(sf::Vector2f enemyCenter,
                                       float enemyRadius,
                                       float tierVisualScale,
                                       float barWidth,
                                       float barHeight,
                                       float offsetAboveTopEdge);

    static float   computeFadeAlpha(float deathTimer, float deathAnimDuration);

    // B-UX-12 — pure helper returning the position the enemy `Lv N`
    // label should be centred on. Sits horizontally on the bar
    // centre, vertically `offsetY` above the top edge of the bar.
    static sf::Vector2f computeEnemyLevelLabelPosition(const BarRect& barRect, float offsetY);
};

}
