#include "render/TexturePreparation.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Image.hpp>
#include <SFML/Graphics/Texture.hpp>

#include <algorithm>
#include <cstddef>
#include <stdexcept>
#include <string>
#include <vector>

namespace dof::render {

void dilateTransparentRgb(sf::Image& image, int passes) {
    if (passes <= 0) return;
    const sf::Vector2u size = image.getSize();
    if (size.x == 0u || size.y == 0u) return;
    const std::size_t count = static_cast<std::size_t>(size.x) * size.y;
    std::vector<sf::Color> colors(count);
    std::vector<bool> isFilled(count, false);
    const auto indexOf = [size](unsigned x, unsigned y) {
        return static_cast<std::size_t>(y) * size.x + x;
    };
    for (unsigned y = 0; y < size.y; ++y) {
        for (unsigned x = 0; x < size.x; ++x) {
            const std::size_t index = indexOf(x, y);
            colors[index] = image.getPixel({x, y});
            isFilled[index] = colors[index].a > 0u;
        }
    }

    for (int pass = 0; pass < passes; ++pass) {
        std::vector<sf::Color> nextColors = colors;
        std::vector<bool> nextFilled = isFilled;
        bool addedAny = false;
        for (unsigned y = 0; y < size.y; ++y) {
            for (unsigned x = 0; x < size.x; ++x) {
                const std::size_t index = indexOf(x, y);
                if (isFilled[index]) continue;
                unsigned red = 0u, green = 0u, blue = 0u, neighbours = 0u;
                for (int offsetY = -1; offsetY <= 1; ++offsetY) {
                    for (int offsetX = -1; offsetX <= 1; ++offsetX) {
                        if (offsetX == 0 && offsetY == 0) continue;
                        const int nx = static_cast<int>(x) + offsetX;
                        const int ny = static_cast<int>(y) + offsetY;
                        if (nx < 0 || ny < 0
                            || nx >= static_cast<int>(size.x)
                            || ny >= static_cast<int>(size.y)) continue;
                        const std::size_t neighbourIndex = indexOf(
                            static_cast<unsigned>(nx), static_cast<unsigned>(ny));
                        if (!isFilled[neighbourIndex]) continue;
                        red += colors[neighbourIndex].r;
                        green += colors[neighbourIndex].g;
                        blue += colors[neighbourIndex].b;
                        ++neighbours;
                    }
                }
                if (neighbours == 0u) continue;
                nextColors[index] = sf::Color{
                    static_cast<std::uint8_t>(red / neighbours),
                    static_cast<std::uint8_t>(green / neighbours),
                    static_cast<std::uint8_t>(blue / neighbours), 0u};
                nextFilled[index] = true;
                addedAny = true;
            }
        }
        colors.swap(nextColors);
        isFilled.swap(nextFilled);
        if (!addedAny) break;
    }

    for (unsigned y = 0; y < size.y; ++y) {
        for (unsigned x = 0; x < size.x; ++x) {
            const std::size_t index = indexOf(x, y);
            if (image.getPixel({x, y}).a != 0u || !isFilled[index]) continue;
            image.setPixel({x, y}, colors[index]);
        }
    }
}

void prepareWorldTexture(sf::Texture& texture,
                         bool isRepeated,
                         std::string_view textureName) {
    texture.setRepeated(isRepeated);
    texture.setSmooth(true);
    if (!texture.generateMipmap()) {
        throw std::runtime_error("Failed to generate mipmaps for world texture: "
                                 + std::string(textureName));
    }
}

} // namespace dof::render
