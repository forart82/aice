#include "entities/Weapon.hpp"

#include "entities/Dice.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace dof::entities {

const char* attackTypeName(AttackType type) {
    switch (type) {
        case AttackType::Single:      return "Single";
        case AttackType::Swipe:       return "Swipe";
        case AttackType::MultiTarget: return "MultiTarget";
        case AttackType::MultiSingle: return "MultiSingle";
        case AttackType::Aoe:         return "Aoe";
    }
    return "Single";
}

namespace {

const char* attackTypeDisplayName(AttackType type) {
    switch (type) {
        case AttackType::Single:      return "Single Strike";
        case AttackType::Swipe:       return "Swipe";
        case AttackType::MultiTarget: return "Multi-Target Volley";
        case AttackType::MultiSingle: return "Focused Flurry";
        case AttackType::Aoe:         return "Area Burst";
    }
    return "Single Strike";
}

}

AttackType parseAttackType(const std::string& token) {
    // Spec §Attack — config writes tokens in upper-snake (SINGLE,
    // SWIPE, ...). Accept the canonical short forms only; anything
    // else is a configuration error rather than a silent behavior change.
    if (token == "SINGLE")      return AttackType::Single;
    if (token == "SWIPE")       return AttackType::Swipe;
    if (token == "MULTITARGET") return AttackType::MultiTarget;
    if (token == "MULTISINGLE") return AttackType::MultiSingle;
    if (token == "AOE")         return AttackType::Aoe;
    throw std::runtime_error("Unknown weapon attack type: " + token);
}

const char* weaponTypeName(WeaponType type) {
    switch (type) {
        case WeaponType::Pitchfork:    return "Pitchfork";
        case WeaponType::LongSword:    return "Long Sword";
        case WeaponType::GreatSword:   return "Great Sword";
        case WeaponType::Halberd:      return "Halberd";
        case WeaponType::Quarterstaff: return "Quarterstaff";
        case WeaponType::Knives:       return "Knives";
        case WeaponType::Dagger:       return "Dagger";
        case WeaponType::Mace:         return "Mace";
        case WeaponType::Warhammer:    return "Warhammer";
        case WeaponType::BigAxe:       return "Big Axe";
    }
    return "Unknown";
}

int weaponTypeCount() { return 10; }

const char* weaponTypeCanonicalToken(WeaponType type) {
    // T-CHEAT-spawn-type-arg — lowercase, no spaces. Mirrors the
    // strings the console cheat parser accepts AFTER normalising the
    // user input. Keeping the canonical table here next to
    // `weaponTypeName` so a new WeaponType only needs a single edit.
    switch (type) {
        case WeaponType::Pitchfork:    return "pitchfork";
        case WeaponType::LongSword:    return "longsword";
        case WeaponType::GreatSword:   return "greatsword";
        case WeaponType::Halberd:      return "halberd";
        case WeaponType::Quarterstaff: return "quarterstaff";
        case WeaponType::Knives:       return "knives";
        case WeaponType::Dagger:       return "dagger";
        case WeaponType::Mace:         return "mace";
        case WeaponType::Warhammer:    return "warhammer";
        case WeaponType::BigAxe:       return "bigaxe";
    }
    return "unknown";
}

bool parseWeaponTypeToken(const std::string& token, WeaponType& out) {
    // Normalise: lowercase + strip space/hyphen/underscore so the
    // user can write `SpawnWeapon=10,Long Sword` or `long-sword` or
    // `LONGSWORD` and all three resolve to the same canonical token.
    std::string norm;
    norm.reserve(token.size());
    for (char c : token) {
        if (c == ' ' || c == '-' || c == '_') continue;
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c + ('a' - 'A'));
        norm.push_back(c);
    }
    if (norm.empty()) return false;
    const int count = weaponTypeCount();
    for (int i = 0; i < count; ++i) {
        const auto candidate = weaponTypeAtIndex(i);
        if (norm == weaponTypeCanonicalToken(candidate)) {
            out = candidate;
            return true;
        }
    }
    return false;
}

std::string weaponAttackName(const Weapon& weapon) {
    std::string name = weapon.displayName().empty()
        ? std::string(weaponTypeName(weapon.type()))
        : weapon.displayName();
    name += " ";
    name += attackTypeDisplayName(weapon.attackType());
    return name;
}

WeaponType weaponTypeAtIndex(int index) {
    switch (index) {
        case 0:  return WeaponType::Pitchfork;
        case 1:  return WeaponType::LongSword;
        case 2:  return WeaponType::GreatSword;
        case 3:  return WeaponType::Halberd;
        case 4:  return WeaponType::Quarterstaff;
        case 5:  return WeaponType::Knives;
        case 6:  return WeaponType::Dagger;
        case 7:  return WeaponType::Mace;
        case 8:  return WeaponType::Warhammer;
        case 9:  return WeaponType::BigAxe;
        default: throw std::out_of_range("weaponTypeAtIndex");
    }
}

Weapon::Weapon(dof::core::EntityId id, WeaponType type, float baseDamage, float attacksPerSecond, float range)
    : identity(id),
      weaponType(type),
      name(),
      baseDamageValue(baseDamage),
      attacksPerSecondValue(attacksPerSecond) {
    rangeableComponent.range = range;
    countdownableComponent.setDuration(attacksPerSecond > 0.0f ? 1.0f / attacksPerSecond : 1.0f);
}

dof::core::EntityId Weapon::id() const { return identity; }
WeaponType Weapon::type() const { return weaponType; }
const std::string& Weapon::displayName() const { return name; }
void Weapon::setDisplayName(std::string n) { name = std::move(n); }

float Weapon::baseDamage() const { return baseDamageValue; }
void  Weapon::setBaseDamage(float value) { baseDamageValue = value; }
float Weapon::attacksPerSecond() const { return attacksPerSecondValue; }
void  Weapon::setAttacksPerSecond(float value) {
    attacksPerSecondValue = value;
    // P2.2 — a pure attack-RATE change (level scaling, re-equip) must
    // preserve the cooldown's elapsed progress instead of re-arming from
    // full. `Countdownable::setDuration` resets remaining = duration, so
    // routing every level-up (and, after the P0.4 equip fix, every equip)
    // through it re-armed each row's attack cooldown from full — a combat
    // hitch. Scale the remaining time by the new/old duration ratio so the
    // fraction already elapsed carries across the rate change; a genuinely
    // fresh weapon (remaining == duration) maps a full bar to a full bar
    // and so still arms full on its first countdown.
    const float previousDuration  = countdownableComponent.duration;
    const float previousRemaining = countdownableComponent.remaining;
    const float newDuration       = value > 0.0f ? 1.0f / value : 1.0f;
    countdownableComponent.setDuration(newDuration);
    if (previousDuration > 0.0f) {
        countdownableComponent.remaining = previousRemaining * (newDuration / previousDuration);
    }
}

float Weapon::crit() const { return critValue; }
float Weapon::critChance() const { return critChanceValue; }
void  Weapon::setCrit(float critMultiplier, float critProbability) {
    critValue = critMultiplier;
    critChanceValue = critProbability;
}
QualityTier Weapon::tier() const { return qualityTier; }
void Weapon::setTier(QualityTier value) { qualityTier = value; }
int  Weapon::qualityScore() const { return qualityScoreValue; }
void Weapon::setQualityScore(int value) { qualityScoreValue = value; }

int Weapon::statQualityScore(WeaponStatIndex s) const {
    const auto idx = static_cast<std::size_t>(s);
    if (idx >= static_cast<std::size_t>(kWeaponStatCount)) return qualityScoreValue;
    return statQualityScores_[idx];
}
void Weapon::setStatQualityScore(WeaponStatIndex s, int score) {
    const auto idx = static_cast<std::size_t>(s);
    if (idx >= static_cast<std::size_t>(kWeaponStatCount)) return;
    statQualityScores_[idx] = std::clamp(score, 0, 100);
}

int  Weapon::itemLevel() const { return itemLevelValue; }
void Weapon::setItemLevel(int value) { itemLevelValue = value; }

int  Weapon::slotCount() const { return slotCountValue; }
void Weapon::setSlotCount(int value, int minSlotCount, int maxSlotCount) {
    // Spec §Loot L2038: "Slot range is **2..6**" (WEAPON_SLOT_COUNT_MIN/MAX
    // in loot.yaml). Clamp here so callers (the live picker and any future
    // config-driven overrides) cannot poison the slot grid with out-of-band
    // values.
    slotCountValue = std::clamp(value, minSlotCount, maxSlotCount);
}

AttackType Weapon::attackType() const { return attackTypeValue; }
void Weapon::setAttackType(AttackType value) { attackTypeValue = value; }
float Weapon::swipeArcDegrees() const { return swipeArcDegreesValue; }
void  Weapon::setSwipeArcDegrees(float value) {
    // Spec §Swipe L1463: arc ∈ {45°, 90°, 180°, 360°}. The setter
    // does not enforce the discrete set — config callers stamp
    // exactly those values, and a free-form override (test, cheat)
    // is still useful for boundary checks. Negative arcs clamp to
    // zero so the inclusion math never sees a malformed cone.
    swipeArcDegreesValue = value < 0.0f ? 0.0f : value;
}
int Weapon::multiTargetMax() const { return multiTargetMaxValue; }
void Weapon::setMultiTargetMax(int value) {
    // Floor at 1 — even a misconfigured MultiTarget weapon must
    // still hit at least one enemy per fire so the row doesn't
    // silently stall on a missing key.
    multiTargetMaxValue = value < 1 ? 1 : value;
}
int Weapon::multiSingleMax() const { return multiSingleMaxValue; }
void Weapon::setMultiSingleMax(int value) {
    multiSingleMaxValue = value < 1 ? 1 : value;
}

float Weapon::evasionBonus() const { return evasionBonusValue; }
void  Weapon::setEvasionBonus(float value) {
    // Spec §Evasion Source L1397: bonus is a probability mass that
    // joins the `evasionPerSlots` aggregation. Negative values would
    // *reduce* evade chance non-monotonically and break the
    // "monotonic increasing in evasionPerSlot" invariant called out
    // by spec L1405, so we floor at zero.
    evasionBonusValue = value < 0.0f ? 0.0f : value;
}

dof::abilities::Aimable&       Weapon::aimable()       { return aimableComponent; }
dof::abilities::Rangeable&     Weapon::rangeable()     { return rangeableComponent; }
dof::abilities::Pickupable&    Weapon::pickupable()    { return pickupableComponent; }
dof::abilities::Countdownable& Weapon::countdownable() { return countdownableComponent; }
const dof::abilities::Rangeable&     Weapon::rangeable()     const { return rangeableComponent; }
const dof::abilities::Pickupable&    Weapon::pickupable()    const { return pickupableComponent; }
const dof::abilities::Countdownable& Weapon::countdownable() const { return countdownableComponent; }

void Weapon::applyLevelScaling(int newLevel,
                               float damagePerLevel,
                               float apsPerLevel,
                               float rangePerLevel,
                               float critChancePerLevel,
                               float critMultPerLevel) {
    // SA16 / spec §Weapon Per-Level Multipliers L1857-1864 — rescale
    // every base combat stat by `baseStat * multiplier^(newLevel-1)`.
    // Mirror of the Hero-side pattern in `Hero::applyLevelScaling`.
    //
    // First call snapshots the current stamped stats as the immutable
    // base. The WeaponMaker stamps post-construction (setBaseDamage,
    // setAttacksPerSecond, setCrit, rangeable.range = ...) so the
    // snapshot has to happen at scale-time, not at ctor-time — by then
    // the maker is done.
    //
    // Subsequent calls read from the cached base. This is what keeps
    // repeated level-ups from compounding into a runaway curve
    // (calling `applyLevelScaling(2)` twice would otherwise yield
    // `base * mult^2` instead of the correct `base * mult^1`).
    //
    // Multipliers are caller-supplied (the Hero reads them once from
    // weapon.yaml) so this entity stays free of ConfigLoader
    // coupling. Tests can stamp arbitrary curves to verify the
    // formula directly.
    if (newLevel < 1) newLevel = 1;
    if (!hasCapturedLevelBase) {
        baseDamageBase       = baseDamageValue;
        attacksPerSecondBase = attacksPerSecondValue;
        rangeBase            = rangeableComponent.range;
        critBase             = critValue;
        critChanceBase       = critChanceValue;
        hasCapturedLevelBase = true;
    }
    const float exponent = static_cast<float>(newLevel - 1);
    const float damageFactor      = std::pow(damagePerLevel,     exponent);
    const float apsFactor         = std::pow(apsPerLevel,        exponent);
    const float rangeFactor       = std::pow(rangePerLevel,      exponent);
    const float critChanceFactor  = std::pow(critChancePerLevel, exponent);
    const float critMultFactor    = std::pow(critMultPerLevel,   exponent);

    setBaseDamage(baseDamageBase * damageFactor);
    // `setAttacksPerSecond` also re-derives the countdown duration so
    // the row's `Countdownable` stays in sync with the new APS.
    setAttacksPerSecond(attacksPerSecondBase * apsFactor);
    rangeableComponent.range = rangeBase * rangeFactor;
    setCrit(critBase * critMultFactor, critChanceBase * critChanceFactor);
}

void Weapon::attachDice(std::vector<std::unique_ptr<Dice>> dice) {
    attachedDiceStorage = std::move(dice);
}

std::vector<std::unique_ptr<Dice>> Weapon::takeAttachedDice() {
    return std::move(attachedDiceStorage);
}

const std::vector<std::unique_ptr<Dice>>& Weapon::attachedDicePeek() const {
    return attachedDiceStorage;
}

int Weapon::attachedDiceCount() const {
    int count = 0;
    for (const auto& d : attachedDiceStorage) if (d) ++count;
    return count;
}

}
