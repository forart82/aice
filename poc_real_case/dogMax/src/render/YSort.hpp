#pragma once

#include <SFML/Graphics/Rect.hpp>
#include <SFML/System/Vector2.hpp>

#include <cstddef>
#include <vector>

namespace dof::render {

// Spec §Render Order L324-338: every world-space entity participates in a
// single global painter sort keyed on its sprite-feet world-Y so that
// objects further down the screen occlude objects further up. The hero is
// not privileged. Equal-Y collisions are resolved by stable insertion order
// (FIFO of the spatial grid bucket).
//
// This module exposes the pure helpers (sort-key + cull-rect) used by the
// world pass so they can be unit-tested without a render window. The
// renderer wraps these helpers, drives the actual draw calls, and routes
// each entry to the right paint method.

enum class WorldDrawableKind {
    EnvironmentStamp,
    FloorItem,
    EnemyBody,
    EnemyDeathExplosion,
    HeroBody,
};

struct WorldDrawableEntry {
    float             worldYKey;       // §Render Order: sprite-feet Y in world space
    std::size_t       insertionIndex;  // §Render Order: FIFO tie-break for stable_sort
    WorldDrawableKind kind;
    std::size_t       sourceIndex;     // index back into the enemy / floor-item container
};

// §Render Order L328: each renderable's world-Y anchor is its sprite-feet
// position. Round-bodied entities (hero + enemy) anchor at centre.y plus
// their collision radius; floor items already sit at ground level so the
// anchor is the position itself.
float computeYSortKeyFeetBody(sf::Vector2f position, float bodyRadius);
float computeYSortKeyFloor(sf::Vector2f position);

// §Render Order: cull entities outside the continuous camera view
// rect before sorting so the per-frame painter only touches what the
// player can see. `paddedRadius` widens the rect by the worst-case
// drawable footprint so neon halos / death rings at the edge do not pop.
bool isWithinViewRect(sf::FloatRect viewRect, sf::Vector2f position, float paddedRadius);

// §Render Order L337: pad the camera view rect by a single tunable so
// halos and death rings do not pop at the edge. Centred padding (grows
// the rect outward from its centre by `padding` on each side).
sf::FloatRect padViewRect(sf::FloatRect viewRect, float padding);

// §Render Order L332: stable-sort the drawables ascending by worldYKey;
// ties fall back to insertionIndex so the FIFO order survives frame to
// frame and never causes z-fighting flicker.
void sortDrawablesByFeetY(std::vector<WorldDrawableEntry>& drawables);

}
