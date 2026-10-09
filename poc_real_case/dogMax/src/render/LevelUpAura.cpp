#include "render/LevelUpAura.hpp"

#include "entities/Hero.hpp"
#include "loaders/ConfigLoader.hpp"

#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/RenderTarget.hpp>

#include <algorithm>
#include <cstdint>

namespace dof::render {

LevelUpAuraParams loadLevelUpAuraParams(const dof::loaders::ConfigLoader& config) {
    LevelUpAuraParams p;
    p.ringCount           = config.getInt("HERO_LEVEL_UP_RING_COUNT");
    p.ringBaseRadiusMult  = config.getFloat("HERO_LEVEL_UP_RING_BASE_RADIUS_MULT");
    p.ringStepRadiusMult  = config.getFloat("HERO_LEVEL_UP_RING_STEP_RADIUS_MULT");
    p.ringExpansionMult   = config.getFloat("HERO_LEVEL_UP_RING_EXPANSION_MULT");
    p.ringThickness       = config.getFloat("HERO_LEVEL_UP_RING_THICKNESS");
    p.ringAlphaPeak       = config.getFloat("HERO_LEVEL_UP_RING_ALPHA_PEAK");
    p.ringColor = sf::Color{
        static_cast<std::uint8_t>(config.getInt("HERO_LEVEL_UP_RING_COLOR_R")),
        static_cast<std::uint8_t>(config.getInt("HERO_LEVEL_UP_RING_COLOR_G")),
        static_cast<std::uint8_t>(config.getInt("HERO_LEVEL_UP_RING_COLOR_B"))};
    p.flashInitial        = config.getFloat("HERO_LEVEL_UP_FLASH_INITIAL");
    return p;
}

void drawHeroLevelUpAura(sf::RenderTarget& window,
                          const dof::entities::Hero& hero,
                          float heroRadius,
                          const LevelUpAuraParams& params,
                          float interpolationAlpha) {
    const float flash = hero.levelUpFlash();
    if (flash <= 0.0f) return;
    const float normalised = params.flashInitial > 0.0f
        ? std::clamp(flash / params.flashInitial, 0.0f, 1.0f)
        : 0.0f;
    if (normalised <= 0.0f) return;
    // `expansion` goes 0 → 1 as the flash decays, so the ring burst
    // starts hugging the hero and fans outward over the flash duration.
    const float expansion = 1.0f - normalised;
    const auto position = hero.moveable().interpolatedPosition(interpolationAlpha);
    for (int i = 0; i < params.ringCount; ++i) {
        const float layerOffset = static_cast<float>(i) * params.ringStepRadiusMult;
        const float radius      = heroRadius
            * (params.ringBaseRadiusMult
               + layerOffset
               + expansion * params.ringExpansionMult);
        sf::CircleShape ring(radius, 36);
        ring.setOrigin({radius, radius});
        ring.setPosition(position);
        ring.setFillColor(sf::Color::Transparent);
        ring.setOutlineThickness(params.ringThickness);
        sf::Color colour = params.ringColor;
        const float fadedAlpha = normalised * params.ringAlphaPeak
            / static_cast<float>(i + 1);
        colour.a = static_cast<std::uint8_t>(
            std::clamp(fadedAlpha, 0.0f, 255.0f));
        ring.setOutlineColor(colour);
        window.draw(ring);
    }
}

}
