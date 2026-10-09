#include "render/EnemyEffectRenderer.hpp"

#include "loaders/ShaderLoader.hpp"
#include "render/ShapeShaders.hpp"

#include <SFML/Graphics/RenderTarget.hpp>
#include <SFML/Graphics/Shader.hpp>

#include <cmath>

namespace dof::render {

namespace {

constexpr float kPi = 3.14159265358979f;
constexpr float kDegToRad = kPi / 180.0f;

float deterministicHash(float a, float b, float c) {
    float v = std::sin(a * 127.1f + b * 311.7f + c * 74.7f) * 43758.5453f;
    return v - std::floor(v);
}

sf::Glsl::Vec3 layerColor(const dof::entities::EnemyEffectLayer& layer) {
    return colorToGlsl(layer.color);
}

}

float effectProgress(float elapsed, float speed) {
    return std::fmod(elapsed * speed, 1.0f);
}

sf::Vector2f effectOrbitPosition(sf::Vector2f center,
                                 const dof::entities::EnemyEffectLayer& layer,
                                 float elapsed) {
    const float angleDeg = layer.orbitPhaseDeg + elapsed * layer.orbitSpeedDeg;
    const float rad = angleDeg * kDegToRad;
    return {center.x + std::cos(rad) * layer.orbitRadius,
            center.y + std::sin(rad) * layer.orbitRadius};
}

sf::Vector2f effectPopupPosition(sf::Vector2f center,
                                 const dof::entities::EnemyEffectLayer& layer,
                                 int layerIndex,
                                 float elapsed) {
    const float interval = layer.popupInterval > 0.0f ? layer.popupInterval : 1.0f;
    const float popCycle = static_cast<float>(static_cast<int>(elapsed / interval));
    const float idx = static_cast<float>(layerIndex);
    const float angle  = deterministicHash(center.x, idx, popCycle) * 2.0f * kPi;
    const float radius = deterministicHash(center.y, idx + 100.0f, popCycle) * layer.popupRadius;
    return {center.x + std::cos(angle) * radius,
            center.y + std::sin(angle) * radius};
}

bool isEffectPopupVisible(const dof::entities::EnemyEffectLayer& layer,
                          float elapsed) {
    if (layer.popupInterval <= 0.0f) return false;
    return std::fmod(elapsed, layer.popupInterval) < layer.popupLifetime;
}

void drawEnemyEffectLayers(sf::RenderTarget& window,
                           sf::Vector2f enemyCenter,
                           const std::vector<dof::entities::EnemyEffectLayer>& layers,
                           const dof::loaders::ShaderLoader* shaders,
                           ShapeShaders& shapeShaders,
                           float elapsed,
                           bool beforeBody) {
    if (shaders == nullptr) return;
    for (std::size_t i = 0; i < layers.size(); ++i) {
        const dof::entities::EnemyEffectLayer& layer = layers[i];
        const bool inBand = beforeBody ? (layer.z < 0) : (layer.z >= 0);
        if (!inBand) continue;
        if (layer.size <= 0.0f) continue;

        sf::Shader* shader = const_cast<sf::Shader*>(shaders->getShader(layer.shaderName));
        if (shader == nullptr) continue;

        sf::Vector2f pos = enemyCenter;
        switch (layer.motion) {
            case dof::entities::EffectMotion::Static:
                pos = {enemyCenter.x + layer.offsetX, enemyCenter.y + layer.offsetY};
                break;
            case dof::entities::EffectMotion::Orbit:
                pos = effectOrbitPosition(enemyCenter, layer, elapsed);
                break;
            case dof::entities::EffectMotion::Popup:
                if (!isEffectPopupVisible(layer, elapsed)) continue;
                pos = effectPopupPosition(enemyCenter, layer, static_cast<int>(i), elapsed);
                break;
        }

        shapeShaders.drawEffect(window, shader, pos, layer.size * 2.0f,
                                layerColor(layer),
                                effectProgress(elapsed, layer.speed),
                                static_cast<float>(layer.variant),
                                layer.speed, layer.intensity,
                                sf::BlendAdd);
    }
}

}
