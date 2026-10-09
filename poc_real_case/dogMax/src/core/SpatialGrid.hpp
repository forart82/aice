#pragma once

#include "core/EntityId.hpp"

#include <SFML/System/Vector2.hpp>

#include <cstdint>
#include <unordered_map>
#include <vector>

namespace dof::core {

// Bucketed neighbour lookup. Spec §Appendix J §Spatial Grid:
// - Cell size is provided by `SPATIAL_GRID_CELL_SIZE` and must
//   equal `2 · ENEMY_COLLISION_RADIUS` (a designer constraint —
//   the class does NOT validate it; the consumer reads both
//   keys from `enemy.yaml` and is expected to keep them in
//   sync).
// - Rebuilt every frame by the caller from the live enemy list.
// - Reduces neighbour scans from O(N²) to O(N) for typical
//   play densities, sustaining `MAX_ENEMIES = 5000` at 60 FPS.
//
// The world has no bounds: negative positions are valid. Cell
// indices therefore floor toward negative infinity (we do NOT
// truncate toward zero, which would double-map cells across
// the origin).
class SpatialGrid {
public:
    // `cellSize` must be > 0. Construction with a non-positive
    // cell size throws so a misconfigured caller fails loudly
    // instead of silently dividing by zero on the first insert.
    explicit SpatialGrid(float cellSize);

    void clear();
    void insert(EntityId id, sf::Vector2f position);

    // Returns every EntityId within `radius` of `centre`. The
    // result is unordered. Distance is checked exactly (not just
    // by cell membership) so the radius is honoured even when
    // the query spans more than four cells.
    std::vector<EntityId> queryRadius(sf::Vector2f centre, float radius) const;

    // Cell-index helpers exposed for testing. They floor toward
    // negative infinity so positions like `-1.0f` land in cell
    // `-1`, not cell `0`.
    int cellIndexX(float x) const;
    int cellIndexY(float y) const;

    // Number of non-empty buckets currently held. Useful for
    // testing `clear()` and for cheap sanity checks.
    int cellCount() const;

    float cellSize() const;

private:
    struct Entry {
        EntityId     id;
        sf::Vector2f position;
    };

    // Packed (cellX, cellY) -> bucket. The pack reinterprets the
    // two 32-bit signed cell indices as unsigned, then composes
    // them into a 64-bit hash key. Using `uint32_t` casts before
    // the shift prevents sign extension from corrupting the
    // upper bits when either coordinate is negative.
    static std::int64_t packCellKey(int cellX, int cellY);

    float gridCellSize;
    std::unordered_map<std::int64_t, std::vector<Entry>> buckets;
};

}
