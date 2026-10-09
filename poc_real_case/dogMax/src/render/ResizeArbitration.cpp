#include "render/ResizeArbitration.hpp"

#include "loaders/ConfigLoader.hpp"

#include <algorithm>

namespace dof::render {

WindowSizeLimits loadWindowSizeLimits(const dof::loaders::ConfigLoader& config) {
    return WindowSizeLimits{
        static_cast<unsigned>(std::max(0, config.getInt("WINDOW_MIN_WIDTH"))),
        static_cast<unsigned>(std::max(0, config.getInt("WINDOW_MIN_HEIGHT")))};
}

sf::Vector2u clampWindowSize(sf::Vector2u requested, WindowSizeLimits limits) {
    return sf::Vector2u{
        std::max(requested.x, limits.minWidth),
        std::max(requested.y, limits.minHeight)};
}

}
