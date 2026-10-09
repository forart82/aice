#include "render/WorldRenderSurface.hpp"

#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Sprite.hpp>
#include <SFML/Graphics/Texture.hpp>

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace dof::render {

sf::IntRect computeIntegerLetterbox(sf::Vector2u windowSize,
                                    sf::Vector2u designSize) {
    if (windowSize.x == 0u || windowSize.y == 0u
        || designSize.x == 0u || designSize.y == 0u) {
        return {{0, 0},
                {static_cast<int>(std::max(1u, windowSize.x)),
                 static_cast<int>(std::max(1u, windowSize.y))}};
    }

    unsigned width = windowSize.x;
    unsigned height = static_cast<unsigned>(std::lround(
        static_cast<double>(width) * static_cast<double>(designSize.y)
        / static_cast<double>(designSize.x)));
    if (height > windowSize.y) {
        height = windowSize.y;
        width = static_cast<unsigned>(std::lround(
            static_cast<double>(height) * static_cast<double>(designSize.x)
            / static_cast<double>(designSize.y)));
    }
    width = std::clamp(width, 1u, windowSize.x);
    height = std::clamp(height, 1u, windowSize.y);
    return {{static_cast<int>((windowSize.x - width) / 2u),
             static_cast<int>((windowSize.y - height) / 2u)},
            {static_cast<int>(width), static_cast<int>(height)}};
}

sf::RenderTexture& WorldRenderSurface::beginFrame(sf::Vector2u windowSize,
                                                   sf::Vector2u designSize,
                                                   const sf::View& worldView) {
    viewportPixels = computeIntegerLetterbox(windowSize, designSize);
    ensureSize({static_cast<unsigned>(viewportPixels.size.x),
                static_cast<unsigned>(viewportPixels.size.y)});
    target->setView(worldView);
    target->clear(sf::Color::Black);
    return *target;
}

void WorldRenderSurface::finishFrame() {
    if (target) target->display();
}

void WorldRenderSurface::drawToWindow(sf::RenderWindow& window,
                                      const sf::Texture& texture) const {
    const sf::View savedView = window.getView();
    const sf::Vector2u windowSize = window.getSize();
    // SFML's default view retains the dimensions from window creation. After
    // an OS maximise/restore resize it therefore no longer represents physical
    // window pixels, which scales and offsets this nominally 1:1 world blit.
    // Build the presentation view from the live size every frame so the resized
    // world surface maps to the resized window without stale coordinates.
    window.setView(sf::View(sf::FloatRect{
        {0.0f, 0.0f},
        {static_cast<float>(std::max(1u, windowSize.x)),
         static_cast<float>(std::max(1u, windowSize.y))}}));
    sf::Sprite sprite(texture);
    sprite.setPosition({static_cast<float>(viewportPixels.position.x),
                        static_cast<float>(viewportPixels.position.y)});
    window.draw(sprite);
    window.setView(savedView);
}

sf::IntRect WorldRenderSurface::windowRect() const { return viewportPixels; }

sf::Vector2u WorldRenderSurface::size() const {
    if (!target) return {0u, 0u};
    return target->getSize();
}

void WorldRenderSurface::ensureSize(sf::Vector2u requestedSize) {
    if (target && target->getSize() == requestedSize) return;
    try {
        target.emplace(requestedSize);
    } catch (const std::exception& error) {
        throw std::runtime_error(
            "Failed to create physical-pixel world render surface "
            + std::to_string(requestedSize.x) + "x"
            + std::to_string(requestedSize.y) + ": " + error.what());
    }
    target->setSmooth(false);
}

} // namespace dof::render
