#pragma once

#include <SFML/Graphics/RenderTexture.hpp>
#include <SFML/System/Vector2.hpp>

#include <optional>

namespace dof::loaders { class ConfigLoader; class ShaderLoader; }
namespace sf { class Texture; }

namespace dof::render {

struct BloomParams {
    int radius;
    int downsample;
    float intensity;
    int brightThreshold;
    bool isEnabled;
};

class BloomPipeline {
public:
    BloomPipeline(const dof::loaders::ConfigLoader& config,
                  dof::loaders::ShaderLoader& shaders);

    // Runs bright-pass and separable blur entirely on GPU. Returns `source`
    // unchanged when bloom is disabled or shader support is unavailable.
    const sf::Texture& compose(const sf::Texture& source, sf::Vector2u sourceSize);

    const BloomParams& params() const { return cachedParams; }

private:
    void ensureBuffersSized(sf::Vector2u sourceSize);

    BloomParams cachedParams;
    dof::loaders::ShaderLoader& shaderLoader;
    sf::Vector2u bufferSize{0u, 0u};
    sf::Vector2u downsampledSize{0u, 0u};
    std::optional<sf::RenderTexture> brightTarget;
    std::optional<sf::RenderTexture> horizontalTarget;
    std::optional<sf::RenderTexture> verticalTarget;
    std::optional<sf::RenderTexture> compositeTarget;
};

} // namespace dof::render
