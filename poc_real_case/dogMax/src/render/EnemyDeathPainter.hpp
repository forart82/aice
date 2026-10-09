#pragma once

// card-phaseC — extracted from EnemyBodyPainter.cpp so death VFX stays separate
// from live body rendering. This header owns ONLY the enemy death-explosion VFX
// contract (expanding tier-tinted rings + shard-quad burst + body-fragment
// triangle burst).
//
// EnemyBodyParams is only forward-declared here (it is defined in
// EnemyBodyPainter.hpp and taken by const reference), so this header carries NO
// include back into the body painter — that keeps the include graph acyclic and
// lets EnemyBodyPainter.hpp re-include THIS header to preserve every existing
// call site (e.g. WorldRenderer) without edits.

namespace dof::entities { class Enemy; }
namespace sf            { class RenderTarget; }

namespace dof::render {

struct EnemyBodyParams;

// Draws the multi-layer death explosion for an enemy whose death animation is
// playing: tier-tinted expanding rings, a shard-quad burst and a body-fragment
// triangle burst. All geometry, timing and the warm-white accent colours come
// from `params`; a zero `deathAnimDuration` makes this a no-op.
void drawEnemyDeathExplosion(sf::RenderTarget& window,
                             const dof::entities::Enemy& enemy,
                             const EnemyBodyParams& params);

}
