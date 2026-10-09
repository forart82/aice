#pragma once

#include "entities/Weapon.hpp"
#include "core/EntityId.hpp"

#include <memory>
#include <string>

namespace dof::loaders { class ConfigLoader; }
namespace dof::helpers { class DeterministicRandom; using RandomHelper = DeterministicRandom; }
namespace dof::makers  { class NameMaker; }

namespace dof::makers {

class WeaponMaker {
public:
    WeaponMaker(const dof::loaders::ConfigLoader& config,
                dof::helpers::RandomHelper& rng,
                NameMaker* nameMaker);

    std::unique_ptr<dof::entities::Weapon> makeStarterPitchfork(dof::core::EntityId id);

    // enemyTierIndex: 0=Common, 1=Uncommon, 2=Rare — lifts the per-stat
    // quality bias floor via TIER_STAT_BIAS * tierIndex, so Rare enemies
    // produce better stat rolls independent of the luck-driven qFloor.
    std::unique_ptr<dof::entities::Weapon> makeLoot(dof::core::EntityId id,
                                                    dof::entities::WeaponType type,
                                                    int enemyLevel,
                                                    int qFloor,
                                                    int luckTotal = 0,
                                                    int enemyTierIndex = 0);
    std::unique_ptr<dof::entities::Weapon> makeLootRandom(dof::core::EntityId id,
                                                          int enemyLevel,
                                                          int qFloor,
                                                          int luckTotal = 0,
                                                          int enemyTierIndex = 0);

    // Deterministic spawn at exact `itemLevel` for the `SpawnWeapon=N`
    // console cheat. Differs from `makeLoot` only in
    // that the itemLevel roll is replaced with the caller-supplied value
    // (clamped to [1, 100] by the cheat dispatcher). Quality is rolled
    // normally from `qFloor` so the spawn still surfaces tier variation.
    std::unique_ptr<dof::entities::Weapon> makeAtLevel(dof::core::EntityId id,
                                                       dof::entities::WeaponType type,
                                                       int itemLevel,
                                                       int qFloor   = 0,
                                                       int luckTotal = 0);

    dof::entities::WeaponType pickWeightedType();

    // Spec §Loot L2036-L2069 (Stage 2b). Returns an integer in [2, 6]
    // sampled from the base slot-count weights modulated by the rolled
    // quality, the rolled item level, and the Hero's aggregated luck.
    // Exposed for direct unit testing of the modulation math; the
    // public `makeLoot` path is the only production caller.
    int pickSlotCount(int qualityScore, int itemLevel, int luckTotal);

private:
    const dof::loaders::ConfigLoader& configRef;
    dof::helpers::RandomHelper&       rngRef;
    NameMaker*                        nameMakerPtr;
};

}
