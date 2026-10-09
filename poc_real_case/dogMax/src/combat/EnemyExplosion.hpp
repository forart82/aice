#pragma once

namespace dof::combat {

// Pure compute for the spec §Enemy Death explosion VFX. Each frame the
// explosion is rendered as three concentric rings (inner blob + ring 1 +
// ring 2) whose radii grow linearly from `startRadius` to `endRadius`
// over the death-animation lifetime and whose alpha fades from
// `startAlpha` to 0 over the same window.
struct ExplosionRing {
    float radius{0.0f};
    float alpha{0.0f};
};

// `lifetimeRatio` should be `deathTimer / deathAnimDuration` clamped to
// [0, 1]; the helper clamps internally so callers can pass raw values.
ExplosionRing computeExplosionRing(float lifetimeRatio,
                                   float startRadius,
                                   float endRadius,
                                   float startAlpha);

// card-mplgs9wc — fragmental shard layer added on top of the three
// rings. Each shard flies outward from the enemy centre at an even
// angle (`shardIndex / shardCount` of a full turn), travels at
// `speed` world-units per second of death-anim time, fades on the
// same lifetimeRatio curve, and spins by `spinDegPerLifetime` over
// its lifetime. Returns the live (offset, rotation, alpha) so the
// renderer can paint a small rotated quad without per-frame trig
// duplication.
struct ExplosionShard {
    float offsetX{0.0f};
    float offsetY{0.0f};
    float rotationDegrees{0.0f};
    float alpha{0.0f};
};

ExplosionShard computeExplosionShard(int shardIndex,
                                       int shardCount,
                                       float lifetimeRatio,
                                       float speed,
                                       float startAlpha,
                                       float spinDegPerLifetime);

}
