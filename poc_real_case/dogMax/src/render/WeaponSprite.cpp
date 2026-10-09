#include "render/WeaponSprite.hpp"

#include "loaders/ConfigLoader.hpp"
#include "render/TexturePreparation.hpp"

#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Image.hpp>
#include <SFML/Graphics/Sprite.hpp>
#include <SFML/Graphics/Texture.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <numbers>
#include <stdexcept>
#include <string>

namespace dof::render {
namespace {

constexpr std::array<const char*, 10> kTextureKeys{
    "WEAPON_SPRITE_PITCHFORK", "WEAPON_SPRITE_LONG_SWORD",
    "WEAPON_SPRITE_GREAT_SWORD", "WEAPON_SPRITE_HALBERD",
    "WEAPON_SPRITE_QUARTERSTAFF", "WEAPON_SPRITE_KNIVES",
    "WEAPON_SPRITE_DAGGER", "WEAPON_SPRITE_MACE",
    "WEAPON_SPRITE_WARHAMMER", "WEAPON_SPRITE_BIG_AXE"};

std::size_t textureIndex(dof::entities::WeaponType type) {
    return static_cast<std::size_t>(type);
}

struct WeaponSpriteAsset {
    sf::Texture texture;
    sf::IntRect opaqueRect;
};

sf::IntRect findOpaqueRect(const sf::Image& image) {
    const auto size = image.getSize();
    unsigned left = size.x, top = size.y, right = 0, bottom = 0;
    bool found = false;
    for (unsigned y = 0; y < size.y; ++y) {
        for (unsigned x = 0; x < size.x; ++x) {
            if (image.getPixel({x, y}).a == 0) continue;
            found = true;
            left = std::min(left, x);
            top = std::min(top, y);
            right = std::max(right, x);
            bottom = std::max(bottom, y);
        }
    }
    if (!found) return {{0, 0}, {static_cast<int>(size.x), static_cast<int>(size.y)}};
    return {{static_cast<int>(left), static_cast<int>(top)},
            {static_cast<int>(right - left + 1), static_cast<int>(bottom - top + 1)}};
}

const std::array<WeaponSpriteAsset, 10>& weaponTextures(
    const dof::loaders::ConfigLoader& config) {
    static const std::array<WeaponSpriteAsset, 10> textures = [&config] {
        std::array<WeaponSpriteAsset, 10> loaded;
        for (std::size_t index = 0; index < loaded.size(); ++index) {
            const std::string path = config.getString(kTextureKeys[index]);
            sf::Image image;
            if (!image.loadFromFile(path)) {
                throw std::runtime_error("Failed to load weapon sprite: " + path);
            }
            loaded[index].opaqueRect = findOpaqueRect(image);
            dilateTransparentRgb(image,
                config.getInt("WORLD_TEXTURE_ALPHA_DILATION_PASSES"));
            if (!loaded[index].texture.loadFromImage(image)) {
                throw std::runtime_error("Failed to upload weapon sprite: " + path);
            }
            prepareWorldTexture(loaded[index].texture, false, path);
        }
        return loaded;
    }();
    return textures;
}

} // namespace

void drawWeaponSprite(sf::RenderTarget& window,
                      const sf::FloatRect& rect,
                      dof::entities::WeaponType type,
                      const dof::loaders::ConfigLoader& config,
                      sf::Color tint,
                      float rotationDegrees) {
    const auto& asset = weaponTextures(config)[textureIndex(type)];
    const auto size = asset.opaqueRect.size;
    if (size.x <= 0 || size.y <= 0 || rect.size.x <= 0.f || rect.size.y <= 0.f) return;

    sf::Sprite sprite(asset.texture, asset.opaqueRect);
    sprite.setOrigin({static_cast<float>(size.x) * 0.5f, static_cast<float>(size.y) * 0.5f});
    sprite.setPosition({rect.position.x + rect.size.x * 0.5f,
                        rect.position.y + rect.size.y * 0.5f});
    // Fit the TRUE rotated bounding box. A boolean extent swap is a step
    // function, so a continuously spinning sprite — AttackVfxRenderer sweeps
    // AoE weapons a full revolution — jumped in size at every threshold
    // crossing. This is continuous in the angle and reduces to the plain
    // extents at 0 degrees and to the swapped ones at 90.
    const float rotationRadians = rotationDegrees * std::numbers::pi_v<float> / 180.0f;
    const float absCos = std::abs(std::cos(rotationRadians));
    const float absSin = std::abs(std::sin(rotationRadians));
    const float spriteWidth = static_cast<float>(size.x);
    const float spriteHeight = static_cast<float>(size.y);
    const float displayedWidth = spriteWidth * absCos + spriteHeight * absSin;
    const float displayedHeight = spriteWidth * absSin + spriteHeight * absCos;
    const float scale = std::min(rect.size.x / displayedWidth, rect.size.y / displayedHeight);
    sprite.setScale({scale, scale});
    sprite.setRotation(sf::degrees(rotationDegrees));
    sprite.setColor(tint);
    window.draw(sprite);
}

} // namespace dof::render
