#pragma once

#include "entities/Weapon.hpp"

#include <SFML/System/Vector2.hpp>

#include <vector>

namespace dof::core { class SpatialGrid; class World; }
namespace dof::entities { class Enemy; class Weapon; }

namespace dof::combat {

// Spec §Attack L1437-1582 — per-mode target selection. Each helper
// returns the list of (enemy*, optional fire direction) tuples the
// `WeaponManager::fireRow` pipeline should apply damage to. The
// helpers are *pure*: they perform no damage roll, spawn no VFX,
// emit no XP. They exist so the per-mode targeting logic is unit-
// testable in isolation and so `WeaponManager` keeps a single
// damage / text / dron-float pipeline regardless of mode.

struct HitTarget {
    dof::entities::Enemy* enemy{nullptr};
    // For MultiTarget the direction from hero -> enemy is the VFX
    // radial line origin; other modes can ignore it.
    sf::Vector2f direction{0.0f, 0.0f};
};

// Spec L1455: closest enemy in range. Returns 0 or 1 entry.
std::vector<HitTarget> pickSingleTarget(dof::core::World& world,
                                        const dof::entities::Weapon& weapon);
std::vector<HitTarget> pickSingleTarget(dof::core::World& world,
                                        const dof::core::SpatialGrid& grid,
                                        const dof::entities::Weapon& weapon);

// Spec L1460-1469: every enemy inside the angular cone centred on
// the firing direction. The firing direction is derived from the
// closest enemy in range (spec §Hero Aim L1530-1536) and shared by
// all targets so the VFX fan has a single anchor.
std::vector<HitTarget> pickSwipeTargets(dof::core::World& world,
                                        const dof::entities::Weapon& weapon,
                                        sf::Vector2f& fireDirectionOut);
std::vector<HitTarget> pickSwipeTargets(dof::core::World& world,
                                        const dof::core::SpatialGrid& grid,
                                        const dof::entities::Weapon& weapon,
                                        sf::Vector2f& fireDirectionOut);

// Spec L1471-1478: N nearest distinct enemies. If fewer than N are
// in range, fall back to repeating hits on the closest (spec
// L1476). The returned vector has exactly `weapon.multiTargetMax()`
// entries unless no enemy is in range, in which case it is empty.
std::vector<HitTarget> pickMultiTargets(dof::core::World& world,
                                         const dof::entities::Weapon& weapon);
std::vector<HitTarget> pickMultiTargets(dof::core::World& world,
                                        const dof::core::SpatialGrid& grid,
                                        const dof::entities::Weapon& weapon);

// Spec L1480-1486: N hits on the closest enemy. The returned vector
// has exactly `weapon.multiSingleMax()` entries with the same enemy
// pointer (the manager dispatches the damage roll per entry but
// spawns a single summed damage text — see WeaponManager).
std::vector<HitTarget> pickMultiSingleTargets(dof::core::World& world,
                                                const dof::entities::Weapon& weapon);
std::vector<HitTarget> pickMultiSingleTargets(dof::core::World& world,
                                              const dof::core::SpatialGrid& grid,
                                              const dof::entities::Weapon& weapon);

// Spec L1488-1493: every enemy inside `weapon.rangeable().range`.
// Returns 0..N entries; one shared damage roll is applied to each.
std::vector<HitTarget> pickAoeTargets(dof::core::World& world,
                                       const dof::entities::Weapon& weapon);
std::vector<HitTarget> pickAoeTargets(dof::core::World& world,
                                      const dof::core::SpatialGrid& grid,
                                      const dof::entities::Weapon& weapon);

}
