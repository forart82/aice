#include "core/SpatialGrid.hpp"

#include <cmath>
#include <cstdint>
#include <stdexcept>

namespace dof::core {

SpatialGrid::SpatialGrid(float cellSize) : gridCellSize(cellSize) {
    if (cellSize <= 0.0f) {
        throw std::invalid_argument("SpatialGrid: cellSize must be > 0");
    }
}

void SpatialGrid::clear() {
    buckets.clear();
}

void SpatialGrid::insert(EntityId id, sf::Vector2f position) {
    const int cellX = cellIndexX(position.x);
    const int cellY = cellIndexY(position.y);
    buckets[packCellKey(cellX, cellY)].push_back(Entry{id, position});
}

std::vector<EntityId> SpatialGrid::queryRadius(sf::Vector2f centre, float radius) const {
    std::vector<EntityId> result;
    if (radius < 0.0f) return result;

    // Compute the inclusive cell-range that the query circle's
    // bounding box covers. Anything outside this range cannot
    // possibly intersect the circle; everything inside it gets
    // an exact distance check (so we never return an entity
    // that is in the bbox but outside the radius).
    const int minCellX = cellIndexX(centre.x - radius);
    const int maxCellX = cellIndexX(centre.x + radius);
    const int minCellY = cellIndexY(centre.y - radius);
    const int maxCellY = cellIndexY(centre.y + radius);

    const float radiusSq = radius * radius;
    for (int cy = minCellY; cy <= maxCellY; ++cy) {
        for (int cx = minCellX; cx <= maxCellX; ++cx) {
            const auto it = buckets.find(packCellKey(cx, cy));
            if (it == buckets.end()) continue;
            for (const auto& entry : it->second) {
                const float dx = entry.position.x - centre.x;
                const float dy = entry.position.y - centre.y;
                if (dx * dx + dy * dy <= radiusSq) {
                    result.push_back(entry.id);
                }
            }
        }
    }
    return result;
}

int SpatialGrid::cellIndexX(float x) const {
    return static_cast<int>(std::floor(x / gridCellSize));
}

int SpatialGrid::cellIndexY(float y) const {
    return static_cast<int>(std::floor(y / gridCellSize));
}

int SpatialGrid::cellCount() const {
    return static_cast<int>(buckets.size());
}

float SpatialGrid::cellSize() const {
    return gridCellSize;
}

std::int64_t SpatialGrid::packCellKey(int cellX, int cellY) {
    // Cast each signed coord to its unsigned bit-pattern first so
    // negative indices don't sign-extend into the upper word when
    // we shift. The result is a unique 64-bit key per (cellX,
    // cellY) pair.
    const std::uint64_t hi = static_cast<std::uint64_t>(static_cast<std::uint32_t>(cellX));
    const std::uint64_t lo = static_cast<std::uint64_t>(static_cast<std::uint32_t>(cellY));
    return static_cast<std::int64_t>((hi << 32) | lo);
}

}
