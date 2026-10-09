#pragma once

// Spawn VFX extracted from EnemyBodyPainter so body rendering and portal
// animation stay separate. Renders a Stargate-style spawn: a static portal
// (event-horizon disc + bright rim) opens in place BEHIND the enemy, the
// enemy fades in on top of it, then the portal closes. The portal never
// moves and the enemy never rises — it simply materialises from the portal.
// All inputs come from EnemyBodyParams (loaded once) + the enemy's
// huntable().spawnAnimTimer; the functions are stateless.

#include "render/EnemyBodyPainter.hpp"

namespace sf { class RenderTarget; }

namespace dof::entities { class Enemy; }

namespace dof::render {

// Per-frame spawn factors derived from huntable().spawnAnimTimer.
//   fade           — body alpha, 0 (portal opening, enemy not yet there) ->
//                    1 (fully materialised).
//   portalOpenness — portal disc + rim brightness/size, 0 (closed) -> 1
//                    (fully open) -> 0 (closed again) across the open / hold
//                    / close phases.
// Both are the steady-state values (fade 1, portal closed) when no spawn
// anim is active.
struct SpawnInFactors {
    float fade{1.0f};
    float portalOpenness{0.0f};
};

SpawnInFactors computeSpawnInFactors(const dof::entities::Enemy& enemy,
                                     const EnemyBodyParams& params);

// Draws the Stargate portal (event-horizon disc + rim) in place. Call BEFORE
// the enemy body so the enemy fades in on top of the portal.
void drawEnemySpawnPortal(sf::RenderTarget& window,
                          const dof::entities::Enemy& enemy,
                          const EnemyBodyParams& params);

}  // namespace dof::render
