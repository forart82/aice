#include "render/BarLayout.hpp"

#include <algorithm>

namespace dof::render {

BarRect BarLayout::computeHeroBarRect(sf::Vector2f heroCenter,
                                      float heroRadius,
                                      float barWidth,
                                      float barHeight,
                                      float offsetAboveTopEdge) {
    const float topEdge   = heroCenter.y - heroRadius;
    const float bottomY   = topEdge - offsetAboveTopEdge;
    return BarRect{heroCenter.x - barWidth / 2.0f,
                   bottomY - barHeight,
                   barWidth,
                   barHeight};
}

BarRect BarLayout::computeEnemyBarRect(sf::Vector2f enemyCenter,
                                       float enemyRadius,
                                       float tierVisualScale,
                                       float barWidth,
                                       float barHeight,
                                       float offsetAboveTopEdge) {
    const float scaledRadius = enemyRadius * tierVisualScale;
    const float scaledOffset = offsetAboveTopEdge * tierVisualScale;
    const float topEdge      = enemyCenter.y - scaledRadius;
    const float bottomY      = topEdge - scaledOffset;
    return BarRect{enemyCenter.x - barWidth / 2.0f,
                   bottomY - barHeight,
                   barWidth,
                   barHeight};
}

float BarLayout::computeFadeAlpha(float deathTimer, float deathAnimDuration) {
    if (deathAnimDuration <= 0.0f) return 0.0f;
    const float progress = std::clamp(deathTimer / deathAnimDuration, 0.0f, 1.0f);
    return 1.0f - progress;
}

sf::Vector2f BarLayout::computeEnemyLevelLabelPosition(const BarRect& barRect, float offsetY) {
    return sf::Vector2f{barRect.x + barRect.width * 0.5f,
                        barRect.y - offsetY};
}

}
