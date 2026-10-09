#pragma once

#include "entities/EnemyTemplate.hpp"

#include <SFML/System/Vector2.hpp>

#include <vector>

namespace dof::loaders { class ShaderLoader; }
namespace sf           { class RenderTarget; }

namespace dof::render {

class ShapeShaders;

// Cyclic shader progress: fmod(elapsed * speed, 1.0). Drives u_progress so
// each effect loops over its 0..1 timeline at the layer's authored rate.
float effectProgress(float elapsed, float speed);

// Orbit placement: the layer circles the enemy centre at orbitRadius, its
// angle advancing from orbitPhaseDeg at orbitSpeedDeg degrees per second.
sf::Vector2f effectOrbitPosition(sf::Vector2f center,
                                 const dof::entities::EnemyEffectLayer& layer,
                                 float elapsed);

// Popup placement: a deterministic per-cycle offset within popupRadius. The
// position is stable for the whole pop cycle (so a pop holds in place) and
// re-randomises each cycle via a hash seeded by the centre + layer index.
sf::Vector2f effectPopupPosition(sf::Vector2f center,
                                 const dof::entities::EnemyEffectLayer& layer,
                                 int layerIndex,
                                 float elapsed);

// A popup layer is visible only during the first popupLifetime seconds of
// each popupInterval window.
bool isEffectPopupVisible(const dof::entities::EnemyEffectLayer& layer,
                          float elapsed);

// Draws the enemy's effect layers in one z-band: layers with z < 0 when
// `beforeBody` is true (behind the body), z >= 0 otherwise (in front). Each
// layer resolves its position from its motion mode and is drawn additively
// through `shapeShaders`.
void drawEnemyEffectLayers(sf::RenderTarget& window,
                           sf::Vector2f enemyCenter,
                           const std::vector<dof::entities::EnemyEffectLayer>& layers,
                           const dof::loaders::ShaderLoader* shaders,
                           ShapeShaders& shapeShaders,
                           float elapsed,
                           bool beforeBody);

}
