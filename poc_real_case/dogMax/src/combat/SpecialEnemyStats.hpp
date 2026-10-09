#pragma once

#include "entities/SpecialEnemyKind.hpp"

namespace dof::loaders { class ConfigLoader; }

namespace dof::combat {

// Phase 14 — Per-kind stat-override multipliers applied at spawn time
// on top of the baseline tier-driven HP/speed/etc. Spec L607-686:
//
//   Shocker      health × 1.15           (+15 %)
//   Glasswraith  health × 0.75           (-25 %)
//   Hexarchon    health × 4.0  (Common HP baseline) + deadzone widen
//   Voidcrawler  speed  × 0.75           (-25 %)
//
// Tassidean Sentinel + Pact-Walker overrides are spec-deferred (3-
// phase invuln + NPC wander) and stay at the defaults below until
// the follow-up cards land.
struct SpecialEnemyStatOverride {
    float healthMultiplier{1.0f};
    float speedMultiplier{1.0f};
    float deadzoneFactor{0.0f}; // 0 = inherit baseline; else override
};

// Pure helper — looks up the spec-pinned overrides for a given kind.
// Uses loader keys so each multiplier stays data-driven (no inline
// literals in source per CLAUDE.md Configuration rule).
SpecialEnemyStatOverride loadSpecialEnemyStatOverride(dof::entities::SpecialEnemyKind kind,
                                                       const dof::loaders::ConfigLoader& config);

}
