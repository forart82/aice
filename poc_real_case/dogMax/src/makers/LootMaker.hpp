#pragma once

#include "core/EntityId.hpp"
#include "entities/Dice.hpp"
#include "entities/Weapon.hpp"

#include <functional>
#include <memory>
#include <variant>
#include <vector>

namespace dof::helpers { class DeterministicRandom; using RandomHelper = DeterministicRandom; }
namespace dof::loaders { class ConfigLoader; }
namespace dof::makers  { class DiceMaker; class WeaponMaker; }

namespace dof::makers {

struct LootDrop {
    enum class Kind { Weapon, Dice };
    Kind                                  kind;
    std::unique_ptr<dof::entities::Weapon> weapon;
    std::unique_ptr<dof::entities::Dice>   dice;
};

// Loot Pipeline orchestrator (spec §Loot Pipeline Overview).
//
// Drop chance replaces the old flat-bonus model with a formula that
// rewards player luck and hunting stronger enemies:
//
//   luckNorm  = clamp(luckTotal / LUCK_DROP_REFERENCE, 0, 1)
//   tierNorm  = enemyTierIndex / 2   (0=Common, 0.5=Uncommon, 1=Rare)
//   dropChance = clamp(BASE_DROP_CHANCE + LUCK_DROP_BONUS * luckNorm
//                                       + TIER_DROP_BONUS * tierNorm, 0, MAX)
//
// `rollDrop` runs Stage 1 alone (one weapon-vs-dice draw + the Stage 2
// quality / item-level / per-stat-roll machinery inside each maker).
// `rollAllDrops` runs the full pipeline for one enemy death.
class LootMaker {
public:
    LootMaker(const dof::loaders::ConfigLoader& config,
              dof::helpers::RandomHelper& rng,
              WeaponMaker& weaponMaker,
              DiceMaker& diceMaker);

    // `luckTotal` and `enemyTierIndex` are forwarded to the makers for
    // per-stat quality biasing and to the weapon path's Stage 2b slot-count
    // picker. Default to 0 so headless tests and fixtures stay terse.
    LootDrop rollDrop(dof::core::EntityId weaponOrDiceId,
                      int enemyLevel,
                      int qFloor,
                      int luckTotal = 0,
                      int enemyTierIndex = 0);

    // Returns the full set of drops for one enemy kill. Drop count is
    // chance-gated by luck + enemy tier (see class-level comment).
    // Elites receive ELITE_DROP_COUNT_BONUS guaranteed extra drops on top.
    // `allocateId` feeds each fresh drop a unique EntityId — callers
    // typically pass `[&world] { return world.allocateId(); }`.
    std::vector<LootDrop> rollAllDrops(int enemyLevel,
                                       int qFloor,
                                       bool isElite,
                                       const std::function<dof::core::EntityId()>& allocateId,
                                       int luckTotal = 0,
                                       int enemyTierIndex = 0);

    int   weaponDropWeight()    const;
    int   diceDropWeight()      const;
    float computeDropChance(int luckTotal, int enemyTierIndex) const;
    int   eliteDropCountBonus() const;

private:
    const dof::loaders::ConfigLoader& configRef;
    dof::helpers::RandomHelper&       rngRef;
    WeaponMaker&                      weaponMakerRef;
    DiceMaker&                        diceMakerRef;
};

}
