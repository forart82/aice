#include "render/YSort.hpp"

#include <algorithm>

namespace dof::render {

float computeYSortKeyFeetBody(sf::Vector2f position, float bodyRadius) {
    // §Render Order L328: round-bodied entities anchor at the bottom of
    // their circle silhouette, i.e. centre.y + radius. Treat negative
    // radii as zero so a misconfigured entity never anchors above its
    // own centre.
    const float clampedRadius = bodyRadius < 0.0f ? 0.0f : bodyRadius;
    return position.y + clampedRadius;
}

float computeYSortKeyFloor(sf::Vector2f position) {
    // §Render Order L328: floor items already sit on the ground plane
    // so their sort key is exactly the world-Y of their position.
    return position.y;
}

bool isWithinViewRect(sf::FloatRect viewRect, sf::Vector2f position, float paddedRadius) {
    const float clampedRadius = paddedRadius < 0.0f ? 0.0f : paddedRadius;
    const float left   = viewRect.position.x - clampedRadius;
    const float top    = viewRect.position.y - clampedRadius;
    const float right  = viewRect.position.x + viewRect.size.x + clampedRadius;
    const float bottom = viewRect.position.y + viewRect.size.y + clampedRadius;
    return position.x >= left && position.x <= right
        && position.y >= top  && position.y <= bottom;
}

sf::FloatRect padViewRect(sf::FloatRect viewRect, float padding) {
    const float clampedPadding = padding < 0.0f ? 0.0f : padding;
    return sf::FloatRect{
        {viewRect.position.x - clampedPadding, viewRect.position.y - clampedPadding},
        {viewRect.size.x + clampedPadding * 2.0f, viewRect.size.y + clampedPadding * 2.0f}};
}

void sortDrawablesByFeetY(std::vector<WorldDrawableEntry>& drawables) {
    // §Render Order L332: stable_sort + insertionIndex tie-break gives a
    // deterministic FIFO order across frames, so equal-Y entities never
    // swap z-order from one frame to the next.
    std::stable_sort(drawables.begin(), drawables.end(),
                     [](const WorldDrawableEntry& a, const WorldDrawableEntry& b) {
                         if (a.worldYKey != b.worldYKey) return a.worldYKey < b.worldYKey;
                         return a.insertionIndex < b.insertionIndex;
                     });
}

}
