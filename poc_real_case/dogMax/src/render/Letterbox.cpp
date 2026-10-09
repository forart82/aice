#include "render/Letterbox.hpp"

#include <algorithm>

namespace dof::render {

LetterboxRect computeLetterbox(unsigned windowWidth,
                               unsigned windowHeight,
                               unsigned designWidth,
                               unsigned designHeight) {
    if (windowWidth == 0 || windowHeight == 0 || designWidth == 0 || designHeight == 0) {
        return LetterboxRect{0.0f, 0.0f,
                             static_cast<float>(windowWidth),
                             static_cast<float>(windowHeight)};
    }
    const float windowAspect = static_cast<float>(windowWidth) / static_cast<float>(windowHeight);
    const float designAspect = static_cast<float>(designWidth) / static_cast<float>(designHeight);

    LetterboxRect rect{0.0f, 0.0f,
                       static_cast<float>(windowWidth),
                       static_cast<float>(windowHeight)};
    if (windowAspect > designAspect) {
        // Window is wider than the design — shrink width, centre horizontally.
        rect.width  = static_cast<float>(windowHeight) * designAspect;
        rect.height = static_cast<float>(windowHeight);
        rect.originX = (static_cast<float>(windowWidth) - rect.width) * 0.5f;
        rect.originY = 0.0f;
    } else if (windowAspect < designAspect) {
        // Window is taller than the design — shrink height, centre vertically.
        rect.width  = static_cast<float>(windowWidth);
        rect.height = static_cast<float>(windowWidth) / designAspect;
        rect.originX = 0.0f;
        rect.originY = (static_cast<float>(windowHeight) - rect.height) * 0.5f;
    }
    return rect;
}

sf::FloatRect computeLetterboxViewport(unsigned windowWidth,
                                       unsigned windowHeight,
                                       unsigned designWidth,
                                       unsigned designHeight) {
    const auto rect = computeLetterbox(windowWidth, windowHeight, designWidth, designHeight);
    if (windowWidth == 0 || windowHeight == 0) {
        return sf::FloatRect{{0.0f, 0.0f}, {1.0f, 1.0f}};
    }
    const float w = static_cast<float>(windowWidth);
    const float h = static_cast<float>(windowHeight);
    return sf::FloatRect{
        {rect.originX / w, rect.originY / h},
        {rect.width  / w, rect.height  / h}};
}

}
