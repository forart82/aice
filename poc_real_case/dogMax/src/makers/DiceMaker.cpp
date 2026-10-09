#include "makers/DiceMaker.hpp"

#include "combat/LootRolls.hpp"
#include "combat/QualityScale.hpp"
#include "entities/QualityTier.hpp"
#include "helpers/RandomHelper.hpp"
#include "loaders/ConfigLoader.hpp"
#include "makers/NameMaker.hpp"

#include <algorithm>

namespace dof::makers {

DiceMaker::DiceMaker(const dof::loaders::ConfigLoader& config,
                     dof::helpers::RandomHelper& rng,
                     NameMaker* nameMaker)
    : configRef(config), rngRef(rng), nameMakerPtr(nameMaker) {
    refreshConfig();
}

void DiceMaker::refreshConfig() {
    weightD4   = configRef.getInt("DROP_WEIGHT_DICE_4");
    weightD6   = configRef.getInt("DROP_WEIGHT_DICE_6");
    weightD8   = configRef.getInt("DROP_WEIGHT_DICE_8");
    weightD12  = configRef.getInt("DROP_WEIGHT_DICE_12");
    weightD20  = configRef.getInt("DROP_WEIGHT_DICE_20");
    weightD24  = configRef.getInt("DROP_WEIGHT_DICE_24");
    weightD30  = configRef.getInt("DROP_WEIGHT_DICE_30");
    weightD42  = configRef.getInt("DROP_WEIGHT_DICE_42");
    weightD60  = configRef.getInt("DROP_WEIGHT_DICE_60");
    weightD100 = configRef.getInt("DROP_WEIGHT_DICE_100");
    gateLevelD8   = configRef.getInt("DICE_LEVEL_GATE_D8");
    gateLevelD12  = configRef.getInt("DICE_LEVEL_GATE_D12");
    gateLevelD20  = configRef.getInt("DICE_LEVEL_GATE_D20");
    gateLevelD24  = configRef.getInt("DICE_LEVEL_GATE_D24");
    gateLevelD30  = configRef.getInt("DICE_LEVEL_GATE_D30");
    gateLevelD42  = configRef.getInt("DICE_LEVEL_GATE_D42");
    gateLevelD60  = configRef.getInt("DICE_LEVEL_GATE_D60");
    gateLevelD100 = configRef.getInt("DICE_LEVEL_GATE_D100");
}

bool DiceMaker::isFaceUnlocked(dof::entities::DiceFace face, int level) const {
    switch (face) {
        case dof::entities::DiceFace::D4:  return true;
        case dof::entities::DiceFace::D6:  return true;
        case dof::entities::DiceFace::D8:  return level >= gateLevelD8;
        case dof::entities::DiceFace::D12: return level >= gateLevelD12;
        case dof::entities::DiceFace::D20: return level >= gateLevelD20;
        case dof::entities::DiceFace::D24: return level >= gateLevelD24;
        case dof::entities::DiceFace::D30: return level >= gateLevelD30;
        case dof::entities::DiceFace::D42: return level >= gateLevelD42;
        case dof::entities::DiceFace::D60: return level >= gateLevelD60;
        case dof::entities::DiceFace::D100: return level >= gateLevelD100;
    }
    return true;
}

dof::entities::DiceFace DiceMaker::pickWeightedFace() {
    const int total = weightD4 + weightD6 + weightD8 + weightD12 + weightD20
                    + weightD24 + weightD30 + weightD42 + weightD60 + weightD100;
    if (total <= 0) return dof::entities::DiceFace::D6;
    int roll = rngRef.uniformInt(1, total);
    if ((roll -= weightD4)  <= 0) return dof::entities::DiceFace::D4;
    if ((roll -= weightD6)  <= 0) return dof::entities::DiceFace::D6;
    if ((roll -= weightD8)  <= 0) return dof::entities::DiceFace::D8;
    if ((roll -= weightD12) <= 0) return dof::entities::DiceFace::D12;
    if ((roll -= weightD20) <= 0) return dof::entities::DiceFace::D20;
    if ((roll -= weightD24) <= 0) return dof::entities::DiceFace::D24;
    if ((roll -= weightD30) <= 0) return dof::entities::DiceFace::D30;
    if ((roll -= weightD42) <= 0) return dof::entities::DiceFace::D42;
    if ((roll -= weightD60) <= 0) return dof::entities::DiceFace::D60;
    return dof::entities::DiceFace::D100;
}

dof::entities::DiceFace DiceMaker::pickWeightedFace(int level) {
    // Build effective weights: zero out any face whose level gate is not met.
    // isFaceUnlocked is the single source of truth for each gate threshold.
    using F = dof::entities::DiceFace;
    const int eD4   = isFaceUnlocked(F::D4,   level) ? weightD4   : 0;
    const int eD6   = isFaceUnlocked(F::D6,   level) ? weightD6   : 0;
    const int eD8   = isFaceUnlocked(F::D8,   level) ? weightD8   : 0;
    const int eD12  = isFaceUnlocked(F::D12,  level) ? weightD12  : 0;
    const int eD20  = isFaceUnlocked(F::D20,  level) ? weightD20  : 0;
    const int eD24  = isFaceUnlocked(F::D24,  level) ? weightD24  : 0;
    const int eD30  = isFaceUnlocked(F::D30,  level) ? weightD30  : 0;
    const int eD42  = isFaceUnlocked(F::D42,  level) ? weightD42  : 0;
    const int eD60  = isFaceUnlocked(F::D60,  level) ? weightD60  : 0;
    const int eD100 = isFaceUnlocked(F::D100, level) ? weightD100 : 0;
    const int total = eD4 + eD6 + eD8 + eD12 + eD20
                    + eD24 + eD30 + eD42 + eD60 + eD100;
    // D4 and D6 are always nonzero so total > 0 is guaranteed,
    // but guard defensively to match the ungated overload's contract.
    if (total <= 0) return dof::entities::DiceFace::D6;
    int roll = rngRef.uniformInt(1, total);
    if ((roll -= eD4)  <= 0) return dof::entities::DiceFace::D4;
    if ((roll -= eD6)  <= 0) return dof::entities::DiceFace::D6;
    if ((roll -= eD8)  <= 0) return dof::entities::DiceFace::D8;
    if ((roll -= eD12) <= 0) return dof::entities::DiceFace::D12;
    if ((roll -= eD20) <= 0) return dof::entities::DiceFace::D20;
    if ((roll -= eD24) <= 0) return dof::entities::DiceFace::D24;
    if ((roll -= eD30) <= 0) return dof::entities::DiceFace::D30;
    if ((roll -= eD42) <= 0) return dof::entities::DiceFace::D42;
    if ((roll -= eD60) <= 0) return dof::entities::DiceFace::D60;
    return dof::entities::DiceFace::D100;
}

std::unique_ptr<dof::entities::Dice> DiceMaker::makeLoot(dof::core::EntityId id,
                                                          dof::entities::DiceFace face,
                                                          int enemyLevel,
                                                          int qFloor) {
    return buildDice(id, face, dof::combat::rollItemLevel(rngRef, enemyLevel), qFloor);
}

std::unique_ptr<dof::entities::Dice> DiceMaker::buildDice(dof::core::EntityId id,
                                                           dof::entities::DiceFace face,
                                                           int itemLevel,
                                                           int qualityFloor) {
    auto dice = std::make_unique<dof::entities::Dice>(id, face);

    const float dmgMin  = configRef.getFloat("DICE_DAMAGE_MULT_MIN");
    const float dmgMax  = configRef.getFloat("DICE_DAMAGE_MULT_MAX");
    const float critMin = configRef.getFloat("DICE_CRIT_MIN");
    const float critMax = configRef.getFloat("DICE_CRIT_MAX");
    const float ccMin   = configRef.getFloat("DICE_CRIT_CHANCE_MIN");
    const float ccMax   = configRef.getFloat("DICE_CRIT_CHANCE_MAX");
    const int   luckMin = configRef.getInt("DICE_LUCK_MIN");
    const int   luckMax = configRef.getInt("DICE_LUCK_MAX");
    const float evasionMin = configRef.getFloat("DICE_EVASION_PER_SLOT_MIN");
    const float evasionMax = configRef.getFloat("DICE_EVASION_PER_SLOT_MAX");

    const int qDmg        = dof::combat::rollStatQuality(rngRef, qualityFloor);
    const int qCrit       = dof::combat::rollStatQuality(rngRef, qualityFloor);
    const int qCritChance = dof::combat::rollStatQuality(rngRef, qualityFloor);
    const int qLuck       = dof::combat::rollStatQuality(rngRef, qualityFloor);
    const int qEvasion    = dof::combat::rollStatQuality(rngRef, qualityFloor);
    const int qualityScore = (qDmg + qCrit + qCritChance + qLuck + qEvasion + 2) / 5;

    const int uncommonThreshold = configRef.getInt("QUALITY_UNCOMMON_THRESHOLD");
    const int rareThreshold     = configRef.getInt("QUALITY_RARE_THRESHOLD");
    const auto tier = dof::entities::qualityTierFromScore(qualityScore, uncommonThreshold, rareThreshold);
    const float qualityMult = dof::combat::qualityStatMultiplier(tier, configRef);
    const float qualityFactorMin = configRef.getFloat("QUALITY_STAT_FACTOR_MIN");

    const float damageMultFloor    = configRef.getFloat("DICE_DAMAGE_MULT_FLOOR");
    const float critFloor          = configRef.getFloat("DICE_CRIT_FLOOR");
    const float critChanceFloor    = configRef.getFloat("DICE_CRIT_CHANCE_FLOOR");
    const float evasionPerSlotFloor   = configRef.getFloat("DICE_EVASION_PER_SLOT_FLOOR");

    const float baseDamageMult = rngRef.uniformFloat(dmgMin, dmgMax);
    const float baseCrit       = rngRef.uniformFloat(critMin, critMax);
    const float baseCritChance = rngRef.uniformFloat(ccMin, ccMax);
    const int   baseLuck       = rngRef.uniformInt(luckMin, luckMax);
    const float baseEvasion    = rngRef.uniformFloat(evasionMin, evasionMax);

    dice->setDamageMultiplier(std::max(damageMultFloor,
        baseDamageMult * dof::combat::universalMultiplier(qDmg, itemLevel, qualityFactorMin) * qualityMult));
    dice->setCrit(
        std::max(critFloor,       baseCrit       * dof::combat::universalMultiplier(qCrit,       itemLevel, qualityFactorMin) * qualityMult),
        std::max(critChanceFloor, baseCritChance * dof::combat::universalMultiplier(qCritChance, itemLevel, qualityFactorMin) * qualityMult));
    dice->setLuck(baseLuck);
    dice->setEvasionPerSlot(std::max(evasionPerSlotFloor,
        baseEvasion * dof::combat::universalMultiplier(qEvasion, itemLevel, qualityFactorMin) * qualityMult));
    dice->countdownable().setDuration(rollDuration());
    dice->pickupable().pickupRadius = configRef.getFloat("ITEM_PICKUP_RADIUS");
    dice->setCurrentFace(rngRef.uniformInt(1, dice->faceCount()));
    if (nameMakerPtr) {
        dice->setDisplayName(nameMakerPtr->makeDiceName(face));
    } else {
        dice->setDisplayName(std::string(dof::entities::diceFaceLabel(face)));
    }

    dice->setQualityScore(qualityScore);
    dice->setItemLevel(itemLevel);
    dice->setTier(tier);
    return dice;
}

std::unique_ptr<dof::entities::Dice> DiceMaker::makeAtLevel(dof::core::EntityId id,
                                                             dof::entities::DiceFace face,
                                                             int level) {
    const int clampedLevel = std::clamp(level, 1, 100);
    return buildDice(id, face, clampedLevel, configRef.getInt("QUALITY_MAX_SCORE"));
}

std::unique_ptr<dof::entities::Dice> DiceMaker::makeLootRandom(dof::core::EntityId id,
                                                                int enemyLevel,
                                                                int qFloor) {
    return makeLoot(id, pickWeightedFace(enemyLevel), enemyLevel, qFloor);
}

float DiceMaker::rollDuration() {
    const float rollMin   = configRef.getFloat("DICE_ROLL_DURATION_MIN");
    const float rollMax   = configRef.getFloat("DICE_ROLL_DURATION_MAX");
    return rngRef.uniformFloat(rollMin, rollMax);
}

}
