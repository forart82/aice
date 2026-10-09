#include "makers/WeaponMaker.hpp"

#include "combat/LootRolls.hpp"
#include "combat/QualityScale.hpp"
#include "entities/QualityTier.hpp"
#include "helpers/RandomHelper.hpp"
#include "loaders/ConfigLoader.hpp"
#include "makers/NameMaker.hpp"
#include "makers/WeaponTypeKeys.hpp"

#include <algorithm>
#include <array>
#include <cmath>

namespace dof::makers {

using namespace dof::makers::detail;

WeaponMaker::WeaponMaker(const dof::loaders::ConfigLoader& config,
                         dof::helpers::RandomHelper& rng,
                         NameMaker* nameMaker)
    : configRef(config), rngRef(rng), nameMakerPtr(nameMaker) {}

std::unique_ptr<dof::entities::Weapon> WeaponMaker::makeStarterPitchfork(dof::core::EntityId id) {
    const float dmgMin = configRef.getFloat("PITCHFORK_STARTER_DAMAGE_MIN");
    const float dmgMax = configRef.getFloat("PITCHFORK_STARTER_DAMAGE_MAX");
    const float aps    = configRef.getFloat("PITCHFORK_APS");
    const float range  = configRef.getFloat("PITCHFORK_RANGE");
    auto weapon = std::make_unique<dof::entities::Weapon>(id, dof::entities::WeaponType::Pitchfork,
                                                          rngRef.uniformFloat(dmgMin, dmgMax),
                                                          aps, range);
    weapon->setCrit(configRef.getFloat("PITCHFORK_CRIT_MULT"),
                    configRef.getFloat("PITCHFORK_CRIT_CHANCE"));
    weapon->setDisplayName("Starter Pitchfork");
    weapon->pickupable().pickupRadius = configRef.getFloat("ITEM_PICKUP_RADIUS");
    applyAttackKeys(configRef, *weapon, dof::entities::WeaponType::Pitchfork);
    applyEvasionBonus(configRef, *weapon, dof::entities::WeaponType::Pitchfork);
    return weapon;
}

dof::entities::WeaponType WeaponMaker::pickWeightedType() {
    const int count = dof::entities::weaponTypeCount();
    int total = 0;
    for (int i = 0; i < count; ++i) {
        const auto keys = statsKeysFor(dof::entities::weaponTypeAtIndex(i));
        total += configRef.getInt(keys.dropWeight);
    }
    if (total <= 0) return dof::entities::WeaponType::Pitchfork;
    int roll = rngRef.uniformInt(1, total);
    for (int i = 0; i < count; ++i) {
        const auto type = dof::entities::weaponTypeAtIndex(i);
        const auto keys = statsKeysFor(type);
        roll -= configRef.getInt(keys.dropWeight);
        if (roll <= 0) return type;
    }
    return dof::entities::WeaponType::Pitchfork;
}

int WeaponMaker::pickSlotCount(int qualityScore, int itemLevel, int luckTotal) {
    // Spec §Loot L2036-L2069 (Stage 2b).
    //
    // Step 1: gather the five base weights from `loot.yaml`. The
    // slot-count tiers are fixed at [2..6] per spec; the 1-slot tier
    // was removed (L2038 footnote).
    const std::array<const char*, 5> baseWeightKeys{
        "DROP_WEIGHT_WEAPON_SLOTS_2", "DROP_WEIGHT_WEAPON_SLOTS_3",
        "DROP_WEIGHT_WEAPON_SLOTS_4", "DROP_WEIGHT_WEAPON_SLOTS_5",
        "DROP_WEIGHT_WEAPON_SLOTS_6"};

    const float alpha        = configRef.getFloat("WEAPON_SLOT_COUNT_QUALITY_ALPHA");
    const float beta         = configRef.getFloat("WEAPON_SLOT_COUNT_LEVEL_BETA");
    const float gamma        = configRef.getFloat("WEAPON_SLOT_COUNT_LUCK_GAMMA");
    const int   luckReference = std::max(1, configRef.getInt("WEAPON_SLOT_COUNT_LUCK_REFERENCE"));
    const float qNorm    = std::clamp(static_cast<float>(qualityScore) / 100.0f, 0.0f, 1.0f);
    const float lvlNorm  = std::clamp((static_cast<float>(itemLevel) - 1.0f) / 98.0f, 0.0f, 1.0f);
    const float luckNorm = std::clamp(static_cast<float>(luckTotal) / static_cast<float>(luckReference),
                                       0.0f, 1.0f);
    const float inner = 1.0f + alpha * qNorm + beta * lvlNorm + gamma * luckNorm;

    std::array<double, 5> effectiveWeights{};
    double totalWeight = 0.0;
    for (int idx = 0; idx < 5; ++idx) {
        const double base     = static_cast<double>(std::max(0, configRef.getInt(baseWeightKeys[static_cast<std::size_t>(idx)])));
        const double exponent = static_cast<double>(idx);
        const double w        = base * std::pow(static_cast<double>(inner), exponent);
        effectiveWeights[static_cast<std::size_t>(idx)] = w;
        totalWeight += w;
    }
    if (totalWeight <= 0.0) return 2;

    const double roll = static_cast<double>(rngRef.uniformFloat(0.0f, 1.0f)) * totalWeight;
    double cumulative = 0.0;
    for (int idx = 0; idx < 5; ++idx) {
        cumulative += effectiveWeights[static_cast<std::size_t>(idx)];
        if (roll <= cumulative) return idx + 2;
    }
    return 6;
}

// Per-stat independent quality rolls. biasFloor = qFloor + tierBias so
// luck + enemy tier both lift every stat's lower bound independently.
// The overall qualityScore (average of 5 rolls) drives tier and slot count.
static std::unique_ptr<dof::entities::Weapon> buildWeaponWithRolledStats(
    const dof::loaders::ConfigLoader& configRef,
    dof::helpers::RandomHelper& rngRef,
    dof::makers::NameMaker* nameMakerPtr,
    const WeaponTypeStatsKeys& keys,
    dof::core::EntityId id,
    dof::entities::WeaponType type,
    int biasFloor,
    int itemLevel) {

    const float dmgMin = configRef.getFloat(keys.baseMin);
    const float dmgMax = configRef.getFloat(keys.baseMax);
    const float aps    = configRef.getFloat(keys.aps);
    const float range  = configRef.getFloat(keys.range);

    auto weapon = std::make_unique<dof::entities::Weapon>(id, type,
                                                          rngRef.uniformFloat(dmgMin, dmgMax),
                                                          aps, range);
    if (nameMakerPtr) {
        weapon->setDisplayName(nameMakerPtr->makeWeaponName(type));
    } else {
        weapon->setDisplayName(dof::entities::weaponTypeName(type));
    }

    const int qDamage     = dof::combat::rollStatQuality(rngRef, biasFloor);
    const int qAps        = dof::combat::rollStatQuality(rngRef, biasFloor);
    const int qRange      = dof::combat::rollStatQuality(rngRef, biasFloor);
    const int qCritMult   = dof::combat::rollStatQuality(rngRef, biasFloor);
    const int qCritChance = dof::combat::rollStatQuality(rngRef, biasFloor);
    const int overallQ    = (qDamage + qAps + qRange + qCritMult + qCritChance + 2) / 5;

    weapon->setQualityScore(overallQ);
    weapon->setItemLevel(itemLevel);
    weapon->setStatQualityScore(dof::entities::WeaponStatIndex::Damage,     qDamage);
    weapon->setStatQualityScore(dof::entities::WeaponStatIndex::Aps,        qAps);
    weapon->setStatQualityScore(dof::entities::WeaponStatIndex::Range,      qRange);
    weapon->setStatQualityScore(dof::entities::WeaponStatIndex::CritMult,   qCritMult);
    weapon->setStatQualityScore(dof::entities::WeaponStatIndex::CritChance, qCritChance);

    const int uncommonThreshold = configRef.getInt("QUALITY_UNCOMMON_THRESHOLD");
    const int rareThreshold     = configRef.getInt("QUALITY_RARE_THRESHOLD");
    const auto tier = dof::entities::qualityTierFromScore(overallQ, uncommonThreshold, rareThreshold);
    weapon->setTier(tier);

    const float damageFloor = configRef.getFloat("WEAPON_DAMAGE_FLOOR");
    const float apsFloor    = configRef.getFloat("WEAPON_APS_FLOOR");
    const float rangeFloor  = configRef.getFloat("WEAPON_RANGE_FLOOR");
    const float critMultFloor = configRef.getFloat("WEAPON_CRIT_MULT_FLOOR");
    const float qualityMult = dof::combat::qualityStatMultiplier(tier, configRef);
    const float qualityFactorMin = configRef.getFloat("QUALITY_STAT_FACTOR_MIN");

    weapon->setBaseDamage(std::max(damageFloor,
        weapon->baseDamage() * dof::combat::universalMultiplier(qDamage, itemLevel, qualityFactorMin) * qualityMult));
    weapon->setAttacksPerSecond(std::max(apsFloor,
        aps * dof::combat::universalMultiplier(qAps, itemLevel, qualityFactorMin) * qualityMult));

    const float critBase      = configRef.getFloat(keys.critMult);
    const float critChBase    = configRef.getFloat(keys.critChance);
    weapon->setCrit(
        std::max(critMultFloor,
                 critBase * dof::combat::universalMultiplier(qCritMult, itemLevel, qualityFactorMin) * qualityMult),
        critChBase * dof::combat::universalMultiplier(qCritChance, itemLevel, qualityFactorMin) * qualityMult);

    const float rangePower = configRef.getFloat("WEAPON_RANGE_LEVEL_POWER");
    weapon->rangeable().range = std::max(rangeFloor,
        range * dof::combat::qualityStatFactor(qRange, qualityFactorMin)
              * std::pow(static_cast<float>(itemLevel), rangePower) * qualityMult);

    return weapon;
}

std::unique_ptr<dof::entities::Weapon> WeaponMaker::makeLoot(dof::core::EntityId id,
                                                              dof::entities::WeaponType type,
                                                              int enemyLevel,
                                                              int qFloor,
                                                              int luckTotal,
                                                              int enemyTierIndex) {
    const auto keys     = statsKeysFor(type);
    const int  itemLevel = dof::combat::rollItemLevel(rngRef, enemyLevel);
    const int  tierBias  = configRef.getInt("TIER_STAT_BIAS") * enemyTierIndex;
    const int  biasFloor = std::clamp(qFloor + tierBias, 0, 99);
    auto weapon = buildWeaponWithRolledStats(configRef, rngRef, nameMakerPtr,
                                             keys, id, type, biasFloor, itemLevel);
    weapon->setSlotCount(pickSlotCount(weapon->qualityScore(), itemLevel, luckTotal),
                          configRef.getInt("WEAPON_SLOT_COUNT_MIN"),
                          configRef.getInt("WEAPON_SLOT_COUNT_MAX"));
    weapon->pickupable().pickupRadius = configRef.getFloat("ITEM_PICKUP_RADIUS");
    applyAttackKeys(configRef, *weapon, type);
    applyEvasionBonus(configRef, *weapon, type);
    return weapon;
}

std::unique_ptr<dof::entities::Weapon> WeaponMaker::makeLootRandom(dof::core::EntityId id,
                                                                    int enemyLevel,
                                                                    int qFloor,
                                                                    int luckTotal,
                                                                    int enemyTierIndex) {
    return makeLoot(id, pickWeightedType(), enemyLevel, qFloor, luckTotal, enemyTierIndex);
}

std::unique_ptr<dof::entities::Weapon> WeaponMaker::makeAtLevel(dof::core::EntityId id,
                                                                  dof::entities::WeaponType type,
                                                                  int itemLevel,
                                                                  int qFloor,
                                                                  int luckTotal) {
    const auto keys      = statsKeysFor(type);
    const int  biasFloor = std::clamp(qFloor, 0, 99);
    auto weapon = buildWeaponWithRolledStats(configRef, rngRef, nameMakerPtr,
                                             keys, id, type, biasFloor, itemLevel);
    weapon->setSlotCount(pickSlotCount(weapon->qualityScore(), itemLevel, luckTotal),
                          configRef.getInt("WEAPON_SLOT_COUNT_MIN"),
                          configRef.getInt("WEAPON_SLOT_COUNT_MAX"));
    weapon->pickupable().pickupRadius = configRef.getFloat("ITEM_PICKUP_RADIUS");
    applyAttackKeys(configRef, *weapon, type);
    applyEvasionBonus(configRef, *weapon, type);
    return weapon;
}

}
