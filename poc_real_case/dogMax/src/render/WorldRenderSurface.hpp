#pragma once

#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderTexture.hpp>
#include <SFML/System/Vector2.hpp>

#include <optional>

namespace sf { class RenderWindow; class Texture; }

namespace dof::render {

// Owns the world framebuffer at exactly one texture pixel per physical window
// pixel inside the integer letterbox. The UI remains a separate window pass.
class WorldRenderSurface {
public:
    sf::RenderTexture& beginFrame(sf::Vector2u windowSize,
                                  sf::Vector2u designSize,
                                  const sf::View& worldView);
    void finishFrame();
    void drawToWindow(sf::RenderWindow& window, const sf::Texture& texture) const;

    sf::IntRect windowRect() const;
    sf::Vector2u size() const;

private:
    void ensureSize(sf::Vector2u size);

    std::optional<sf::RenderTexture> target;
    sf::IntRect viewportPixels{{0, 0}, {1, 1}};
};

sf::IntRect computeIntegerLetterbox(sf::Vector2u windowSize,
                                    sf::Vector2u designSize);

} // namespace dof::render
