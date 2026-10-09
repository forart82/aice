#include "makers/WeaponTypeKeys.hpp"

#include "entities/Weapon.hpp"
#include "loaders/ConfigLoader.hpp"

namespace dof::makers::detail {

const char* evasionBonusKeyFor(dof::entities::WeaponType type) {
    switch (type) {
        case dof::entities::WeaponType::Pitchfork:    return "PITCHFORK_EVASION_BONUS";
        case dof::entities::WeaponType::LongSword:    return "LONG_SWORD_EVASION_BONUS";
        case dof::entities::WeaponType::GreatSword:   return "GREAT_SWORD_EVASION_BONUS";
        case dof::entities::WeaponType::Halberd:      return "HALBERD_EVASION_BONUS";
        case dof::entities::WeaponType::Quarterstaff: return "QUARTERSTAFF_EVASION_BONUS";
        case dof::entities::WeaponType::Knives:       return "KNIVES_EVASION_BONUS";
        case dof::entities::WeaponType::Dagger:       return "DAGGER_EVASION_BONUS";
        case dof::entities::WeaponType::Mace:         return "MACE_EVASION_BONUS";
        case dof::entities::WeaponType::Warhammer:    return "WARHAMMER_EVASION_BONUS";
        case dof::entities::WeaponType::BigAxe:       return "BIG_AXE_EVASION_BONUS";
    }
    return "PITCHFORK_EVASION_BONUS";
}

void applyEvasionBonus(const dof::loaders::ConfigLoader& config,
                       dof::entities::Weapon& weapon,
                       dof::entities::WeaponType type) {
    weapon.setEvasionBonus(config.getFloat(evasionBonusKeyFor(type)));
}

AttackTypeKeys attackKeysFor(dof::entities::WeaponType type) {
    switch (type) {
        case dof::entities::WeaponType::Pitchfork:
            return {"PITCHFORK_ATTACK_TYPE", "PITCHFORK_SWIPE_ARC_DEG",
                    "PITCHFORK_MULTI_TARGET_MAX", "PITCHFORK_MULTI_SINGLE_MAX"};
        case dof::entities::WeaponType::LongSword:
            return {"LONG_SWORD_ATTACK_TYPE", "LONG_SWORD_SWIPE_ARC_DEG",
                    "LONG_SWORD_MULTI_TARGET_MAX", "LONG_SWORD_MULTI_SINGLE_MAX"};
        case dof::entities::WeaponType::GreatSword:
            return {"GREAT_SWORD_ATTACK_TYPE", "GREAT_SWORD_SWIPE_ARC_DEG",
                    "GREAT_SWORD_MULTI_TARGET_MAX", "GREAT_SWORD_MULTI_SINGLE_MAX"};
        case dof::entities::WeaponType::Halberd:
            return {"HALBERD_ATTACK_TYPE", "HALBERD_SWIPE_ARC_DEG",
                    "HALBERD_MULTI_TARGET_MAX", "HALBERD_MULTI_SINGLE_MAX"};
        case dof::entities::WeaponType::Quarterstaff:
            return {"QUARTERSTAFF_ATTACK_TYPE", "QUARTERSTAFF_SWIPE_ARC_DEG",
                    "QUARTERSTAFF_MULTI_TARGET_MAX", "QUARTERSTAFF_MULTI_SINGLE_MAX"};
        case dof::entities::WeaponType::Knives:
            return {"KNIVES_ATTACK_TYPE", "KNIVES_SWIPE_ARC_DEG",
                    "KNIVES_MULTI_TARGET_MAX", "KNIVES_MULTI_SINGLE_MAX"};
        case dof::entities::WeaponType::Dagger:
            return {"DAGGER_ATTACK_TYPE", "DAGGER_SWIPE_ARC_DEG",
                    "DAGGER_MULTI_TARGET_MAX", "DAGGER_MULTI_SINGLE_MAX"};
        case dof::entities::WeaponType::Mace:
            return {"MACE_ATTACK_TYPE", "MACE_SWIPE_ARC_DEG",
                    "MACE_MULTI_TARGET_MAX", "MACE_MULTI_SINGLE_MAX"};
        case dof::entities::WeaponType::Warhammer:
            return {"WARHAMMER_ATTACK_TYPE", "WARHAMMER_SWIPE_ARC_DEG",
                    "WARHAMMER_MULTI_TARGET_MAX", "WARHAMMER_MULTI_SINGLE_MAX"};
        case dof::entities::WeaponType::BigAxe:
            return {"BIG_AXE_ATTACK_TYPE", "BIG_AXE_SWIPE_ARC_DEG",
                    "BIG_AXE_MULTI_TARGET_MAX", "BIG_AXE_MULTI_SINGLE_MAX"};
    }
    return {"PITCHFORK_ATTACK_TYPE", "PITCHFORK_SWIPE_ARC_DEG",
            "PITCHFORK_MULTI_TARGET_MAX", "PITCHFORK_MULTI_SINGLE_MAX"};
}

void applyAttackKeys(const dof::loaders::ConfigLoader& config,
                     dof::entities::Weapon& weapon,
                     dof::entities::WeaponType type) {
    const auto keys = attackKeysFor(type);
    weapon.setAttackType(dof::entities::parseAttackType(config.getString(keys.attackType)));
    weapon.setSwipeArcDegrees(config.getFloat(keys.swipeArcDegrees));
    weapon.setMultiTargetMax(config.getInt(keys.multiTargetMax));
    weapon.setMultiSingleMax(config.getInt(keys.multiSingleMax));
}

WeaponTypeStatsKeys statsKeysFor(dof::entities::WeaponType type) {
    switch (type) {
        case dof::entities::WeaponType::Pitchfork:
            return {"PITCHFORK_BASE_DAMAGE_MIN", "PITCHFORK_BASE_DAMAGE_MAX",
                    "PITCHFORK_APS", "PITCHFORK_RANGE",
                    "PITCHFORK_CRIT_MULT", "PITCHFORK_CRIT_CHANCE",
                    "DROP_WEIGHT_WEAPON_PITCHFORK"};
        case dof::entities::WeaponType::LongSword:
            return {"LONG_SWORD_BASE_DAMAGE_MIN", "LONG_SWORD_BASE_DAMAGE_MAX",
                    "LONG_SWORD_APS", "LONG_SWORD_RANGE",
                    "LONG_SWORD_CRIT_MULT", "LONG_SWORD_CRIT_CHANCE",
                    "DROP_WEIGHT_WEAPON_LONG_SWORD"};
        case dof::entities::WeaponType::GreatSword:
            return {"GREAT_SWORD_BASE_DAMAGE_MIN", "GREAT_SWORD_BASE_DAMAGE_MAX",
                    "GREAT_SWORD_APS", "GREAT_SWORD_RANGE",
                    "GREAT_SWORD_CRIT_MULT", "GREAT_SWORD_CRIT_CHANCE",
                    "DROP_WEIGHT_WEAPON_GREAT_SWORD"};
        case dof::entities::WeaponType::Halberd:
            return {"HALBERD_BASE_DAMAGE_MIN", "HALBERD_BASE_DAMAGE_MAX",
                    "HALBERD_APS", "HALBERD_RANGE",
                    "HALBERD_CRIT_MULT", "HALBERD_CRIT_CHANCE",
                    "DROP_WEIGHT_WEAPON_HALBERD"};
        case dof::entities::WeaponType::Quarterstaff:
            return {"QUARTERSTAFF_BASE_DAMAGE_MIN", "QUARTERSTAFF_BASE_DAMAGE_MAX",
                    "QUARTERSTAFF_APS", "QUARTERSTAFF_RANGE",
                    "QUARTERSTAFF_CRIT_MULT", "QUARTERSTAFF_CRIT_CHANCE",
                    "DROP_WEIGHT_WEAPON_QUARTERSTAFF"};
        case dof::entities::WeaponType::Knives:
            return {"KNIVES_BASE_DAMAGE_MIN", "KNIVES_BASE_DAMAGE_MAX",
                    "KNIVES_APS", "KNIVES_RANGE",
                    "KNIVES_CRIT_MULT", "KNIVES_CRIT_CHANCE",
                    "DROP_WEIGHT_WEAPON_KNIVES"};
        case dof::entities::WeaponType::Dagger:
            return {"DAGGER_BASE_DAMAGE_MIN", "DAGGER_BASE_DAMAGE_MAX",
                    "DAGGER_APS", "DAGGER_RANGE",
                    "DAGGER_CRIT_MULT", "DAGGER_CRIT_CHANCE",
                    "DROP_WEIGHT_WEAPON_DAGGER"};
        case dof::entities::WeaponType::Mace:
            return {"MACE_BASE_DAMAGE_MIN", "MACE_BASE_DAMAGE_MAX",
                    "MACE_APS", "MACE_RANGE",
                    "MACE_CRIT_MULT", "MACE_CRIT_CHANCE",
                    "DROP_WEIGHT_WEAPON_MACE"};
        case dof::entities::WeaponType::Warhammer:
            return {"WARHAMMER_BASE_DAMAGE_MIN", "WARHAMMER_BASE_DAMAGE_MAX",
                    "WARHAMMER_APS", "WARHAMMER_RANGE",
                    "WARHAMMER_CRIT_MULT", "WARHAMMER_CRIT_CHANCE",
                    "DROP_WEIGHT_WEAPON_WARHAMMER"};
        case dof::entities::WeaponType::BigAxe:
            return {"BIG_AXE_BASE_DAMAGE_MIN", "BIG_AXE_BASE_DAMAGE_MAX",
                    "BIG_AXE_APS", "BIG_AXE_RANGE",
                    "BIG_AXE_CRIT_MULT", "BIG_AXE_CRIT_CHANCE",
                    "DROP_WEIGHT_WEAPON_BIG_AXE"};
    }
    return {"PITCHFORK_BASE_DAMAGE_MIN", "PITCHFORK_BASE_DAMAGE_MAX",
            "PITCHFORK_APS", "PITCHFORK_RANGE",
            "PITCHFORK_CRIT_MULT", "PITCHFORK_CRIT_CHANCE",
            "DROP_WEIGHT_WEAPON_PITCHFORK"};
}

}
