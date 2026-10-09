#include "combat/EnemyExplosion.hpp"

#include <algorithm>
#include <cmath>

namespace dof::combat {

ExplosionRing computeExplosionRing(float lifetimeRatio,
                                   float startRadius,
                                   float endRadius,
                                   float startAlpha) {
    const float t = std::clamp(lifetimeRatio, 0.0f, 1.0f);
    ExplosionRing ring;
    ring.radius = startRadius + (endRadius - startRadius) * t;
    ring.alpha  = std::max(0.0f, startAlpha * (1.0f - t));
    return ring;
}

ExplosionShard computeExplosionShard(int shardIndex,
                                       int shardCount,
                                       float lifetimeRatio,
                                       float speed,
                                       float startAlpha,
                                       float spinDegPerLifetime) {
    ExplosionShard shard;
    if (shardCount <= 0) return shard;
    const float t = std::clamp(lifetimeRatio, 0.0f, 1.0f);
    const float angle = (2.0f * 3.14159265358979f)
        * static_cast<float>(shardIndex)
        / static_cast<float>(shardCount);
    const float distance = std::max(0.0f, speed * t);
    shard.offsetX        = std::cos(angle) * distance;
    shard.offsetY        = std::sin(angle) * distance;
    shard.rotationDegrees = spinDegPerLifetime * t;
    shard.alpha          = std::max(0.0f, startAlpha * (1.0f - t));
    return shard;
}

}
