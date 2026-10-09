#include "render/BloomPipeline.hpp"

#include "loaders/ConfigLoader.hpp"
#include "loaders/ShaderLoader.hpp"

#include <SFML/Graphics/RenderStates.hpp>
#include <SFML/Graphics/Shader.hpp>
#include <SFML/Graphics/Sprite.hpp>
#include <SFML/Graphics/Texture.hpp>

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>

namespace dof::render {

namespace {

constexpr int kBloomShaderMaxRadius = 16;

void prepareTarget(std::optional<sf::RenderTexture>& target,
                   sf::Vector2u size,
                   bool isSmooth) {
    if (!target || target->getSize() != size) {
        target.emplace(size);
        target->setSmooth(isSmooth);
    }
    target->setView(target->getDefaultView());
    target->clear(sf::Color::Transparent);
}

void drawScaledTexture(sf::RenderTarget& target,
                       const sf::Texture& texture,
                       sf::Vector2u destinationSize,
                       const sf::RenderStates& states = sf::RenderStates::Default) {
    const auto sourceSize = texture.getSize();
    if (sourceSize.x == 0u || sourceSize.y == 0u) return;
    sf::Sprite sprite(texture);
    sprite.setScale({static_cast<float>(destinationSize.x) / static_cast<float>(sourceSize.x),
                     static_cast<float>(destinationSize.y) / static_cast<float>(sourceSize.y)});
    target.draw(sprite, states);
}

} // namespace

BloomPipeline::BloomPipeline(const dof::loaders::ConfigLoader& config,
                             dof::loaders::ShaderLoader& shaders)
    : cachedParams{
          config.getInt("BLOOM_RADIUS"),
          config.getInt("BLOOM_DOWNSAMPLE"),
          config.getFloat("BLOOM_INTENSITY"),
          config.getInt("BLOOM_BRIGHT_THRESHOLD"),
          config.getInt("BLOOM_ENABLE") != 0},
      shaderLoader(shaders) {
    if (cachedParams.radius < 1 || cachedParams.radius > kBloomShaderMaxRadius) {
        throw std::runtime_error("BLOOM_RADIUS must be in [1, 16]");
    }
    if (cachedParams.downsample < 1) {
        throw std::runtime_error("BLOOM_DOWNSAMPLE must be positive");
    }
}

const sf::Texture& BloomPipeline::compose(const sf::Texture& source,
                                          sf::Vector2u sourceSize) {
    if (!cachedParams.isEnabled) return source;
    auto* brightShader = shaderLoader.getShader("bloom_bright");
    auto* blurShader = shaderLoader.getShader("bloom_blur");
    if (!brightShader || !blurShader) return source;

    ensureBuffersSized(sourceSize);

    // Every pass must start from transparent pixels. Alpha blending does not
    // overwrite a previous frame where the new shader output is transparent;
    // without these clears, bright pixels leave persistent trails while the
    // camera moves.
    brightTarget->clear(sf::Color::Transparent);
    horizontalTarget->clear(sf::Color::Transparent);
    verticalTarget->clear(sf::Color::Transparent);
    compositeTarget->clear(sf::Color::Transparent);

    brightShader->setUniform("sf_Texture", sf::Shader::CurrentTexture);
    brightShader->setUniform("u_threshold",
        static_cast<float>(std::clamp(cachedParams.brightThreshold, 0, 255)) / 255.0f);
    sf::RenderStates brightStates;
    brightStates.shader = brightShader;
    drawScaledTexture(*brightTarget, source, downsampledSize, brightStates);
    brightTarget->display();

    blurShader->setUniform("sf_Texture", sf::Shader::CurrentTexture);
    blurShader->setUniform("u_radius", cachedParams.radius);
    blurShader->setUniform("u_texel_step", sf::Glsl::Vec2{
        1.0f / static_cast<float>(downsampledSize.x), 0.0f});
    sf::RenderStates blurStates;
    blurStates.shader = blurShader;
    drawScaledTexture(*horizontalTarget, brightTarget->getTexture(),
                      downsampledSize, blurStates);
    horizontalTarget->display();

    blurShader->setUniform("u_texel_step", sf::Glsl::Vec2{
        0.0f, 1.0f / static_cast<float>(downsampledSize.y)});
    drawScaledTexture(*verticalTarget, horizontalTarget->getTexture(),
                      downsampledSize, blurStates);
    verticalTarget->display();

    drawScaledTexture(*compositeTarget, source, sourceSize);
    sf::RenderStates additiveStates;
    additiveStates.blendMode = sf::BlendAdd;
    sf::Sprite bloomSprite(verticalTarget->getTexture());
    bloomSprite.setScale({
        static_cast<float>(sourceSize.x) / static_cast<float>(downsampledSize.x),
        static_cast<float>(sourceSize.y) / static_cast<float>(downsampledSize.y)});
    const auto channel = static_cast<std::uint8_t>(std::clamp(
        cachedParams.intensity * 255.0f, 0.0f, 255.0f));
    bloomSprite.setColor({channel, channel, channel, 255});
    compositeTarget->draw(bloomSprite, additiveStates);
    compositeTarget->display();
    return compositeTarget->getTexture();
}

void BloomPipeline::ensureBuffersSized(sf::Vector2u sourceSize) {
    if (sourceSize.x == 0u || sourceSize.y == 0u) {
        throw std::runtime_error("Bloom source size must be non-zero");
    }
    const unsigned divisor = static_cast<unsigned>(cachedParams.downsample);
    const sf::Vector2u requiredDownsampled{
        std::max(1u, sourceSize.x / divisor),
        std::max(1u, sourceSize.y / divisor)};
    if (bufferSize == sourceSize && downsampledSize == requiredDownsampled
        && brightTarget && horizontalTarget && verticalTarget && compositeTarget) return;

    bufferSize = sourceSize;
    downsampledSize = requiredDownsampled;
    try {
        prepareTarget(brightTarget, downsampledSize, true);
        prepareTarget(horizontalTarget, downsampledSize, true);
        prepareTarget(verticalTarget, downsampledSize, true);
        prepareTarget(compositeTarget, bufferSize, false);
    } catch (const std::exception& error) {
        throw std::runtime_error("Failed to create GPU bloom buffers: "
                                 + std::string(error.what()));
    }
}

} // namespace dof::render
