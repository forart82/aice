#pragma once

#include "abilities/Aimable.hpp"
#include "abilities/Countdownable.hpp"
#include "abilities/Pickupable.hpp"
#include "abilities/Rangeable.hpp"
#include "core/EntityId.hpp"
#include "entities/Dice.hpp"
#include "entities/QualityTier.hpp"

#include <array>
#include <memory>
#include <string>
#include <vector>

namespace dof::entities {

enum class WeaponType {
    Pitchfork,
    LongSword,
    GreatSword,
    Halberd,
    Quarterstaff,
    Knives,
    Dagger,
    Mace,
    Warhammer,
    BigAxe
};

// Spec §Attack L1437-1582. Every Weapon belongs to exactly one
// AttackType; the type drives per-fire targeting AND per-fire VFX.
// The starter Pitchfork stays Single; the other 9 types are
// stamped from config so a balance pass never has to recompile.
enum class AttackType {
    Single,        // closest target only (Pitchfork)
    Swipe,         // angular cone sweep (sword family)
    MultiTarget,   // N nearest enemies, independent rolls (Knives)
    MultiSingle,   // N hits stacked on closest, summed text (Dagger)
    Aoe            // every enemy in range, one roll replicated (Mace family)
};

// Index into the per-stat quality score array. Each weapon stat rolls
// independently so luck + enemy tier produce per-stat variation instead
// of a single scalar that moves all stats together.
enum class WeaponStatIndex { Damage = 0, Aps = 1, Range = 2, CritMult = 3, CritChance = 4 };
static constexpr int kWeaponStatCount = 5;

class Weapon;

const char* weaponTypeName(WeaponType type);
const char* attackTypeName(AttackType type);
AttackType  parseAttackType(const std::string& token);
std::string weaponAttackName(const Weapon& weapon);
int         weaponTypeCount();
WeaponType  weaponTypeAtIndex(int index);

// T-CHEAT-spawn-type-arg — canonical lowercase token for the
// `SpawnWeapon=N,TYPE` console cheat (`weaponTypeName` lowercased
// with spaces stripped, e.g. `LongSword` -> `longsword`).
const char* weaponTypeCanonicalToken(WeaponType type);
// Parse a user-supplied TYPE token (any case, spaces / hyphens
// tolerated) into a WeaponType. Returns true + writes `out` on a
// canonical-token match; returns false on any other input (the
// parser collapses the whole command to Invalid in that case —
// no silent fallback to random).
bool        parseWeaponTypeToken(const std::string& token, WeaponType& out);

class Weapon {
public:
    Weapon(dof::core::EntityId id, WeaponType type, float baseDamage, float attacksPerSecond, float range);

    dof::core::EntityId id() const;
    WeaponType          type() const;
    const std::string&  displayName() const;
    void                setDisplayName(std::string name);

    float baseDamage() const;
    void  setBaseDamage(float value);
    float attacksPerSecond() const;
    void  setAttacksPerSecond(float value);

    float crit() const;
    float critChance() const;
    void  setCrit(float critMultiplier, float critProbability);

    QualityTier tier() const;
    void        setTier(QualityTier value);

    int         qualityScore() const;
    void        setQualityScore(int value);

    // Per-stat quality score (0–100). Each stat rolls independently;
    // the overall qualityScore is the average. Used by the tooltip
    // renderer to colour-code individual stats by roll quality.
    int  statQualityScore(WeaponStatIndex s) const;
    void setStatQualityScore(WeaponStatIndex s, int score);

    int         itemLevel() const;
    void        setItemLevel(int value);

    // Spec §Loot — Drop Weights — Slot Count (Stage 2b L2036-L2069):
    // how many Diceslot cells the Weapon exposes. Stored, never derived.
    // Default `2` so any path that bypasses the picker (e.g. the Starter
    // Pitchfork) lands on the spec-floor weapon shape automatically.
    int         slotCount() const;
    // minSlotCount/maxSlotCount are passed by the caller (WeaponMaker, who
    // reads WEAPON_SLOT_COUNT_MIN/MAX from loot.yaml) so the Weapon entity
    // has no ConfigLoader coupling, matching applyLevelScaling's convention.
    void        setSlotCount(int value, int minSlotCount, int maxSlotCount);

    // Spec §Attack L1437-1582 — per-weapon attack mode. Defaults to
    // Single so any code path that bypasses the maker (test-only
    // constructors, default-init copies) lands on the conservative
    // closest-target behaviour.
    AttackType  attackType() const;
    void        setAttackType(AttackType value);
    // Per-mode targeting / VFX tuning knobs. The maker stamps these
    // from config at creation time; the manager reads them at fire
    // time. Stored on the weapon so the value follows the entity
    // through pickup → drop → equip without re-querying config.
    float       swipeArcDegrees() const;
    void        setSwipeArcDegrees(float value);
    int         multiTargetMax() const;
    void        setMultiTargetMax(int value);
    int         multiSingleMax() const;
    void        setMultiSingleMax(int value);

    // Spec §Evasion Source L1397: "light weapons add baseline evasion".
    // Stored per-weapon so the aggregation pipeline (EnemyManager
    // evade loop) can fold every equipped weapon's bonus into the
    // `evasionPerSlots` vector alongside the slotted dice contributions.
    // Default `0.0f` so any factory path that bypasses the maker
    // (test-only ctors) is evasion-neutral until explicitly set.
    float       evasionBonus() const;
    void        setEvasionBonus(float value);

    // SA16 / spec §Weapon Per-Level Multipliers L1857-1864 — rescale
    // every base combat stat (baseDamage, aps, range, crit multiplier,
    // crit chance) by `baseStat * multiplier^(newLevel-1)`. The first
    // call snapshots the current stamped values as the immutable base
    // so subsequent calls converge on the spec value rather than
    // compounding across repeated level-ups. Multipliers are passed by
    // the caller (Hero, who reads them once from weapon.yaml) so the
    // Weapon entity has no ConfigLoader coupling and unit tests can
    // exercise the formula with hand-picked values. `newLevel < 1`
    // clamps to 1 so a misconfigured caller never produces a negative
    // exponent.
    void applyLevelScaling(int newLevel,
                           float damagePerLevel,
                           float apsPerLevel,
                           float rangePerLevel,
                           float critChancePerLevel,
                           float critMultPerLevel);

    dof::abilities::Aimable&       aimable();
    dof::abilities::Rangeable&     rangeable();
    dof::abilities::Pickupable&    pickupable();
    dof::abilities::Countdownable& countdownable();
    const dof::abilities::Rangeable&     rangeable() const;
    const dof::abilities::Pickupable&    pickupable() const;
    const dof::abilities::Countdownable& countdownable() const;

    // card-mpkwji9p — dice that follow this weapon while it is OFF the
    // sidebar (in the inventory, on the floor, or held in a drag
    // payload). `WeaponSlotHub::unequipFrom` drains the row's cells
    // into here so the dice ride along with the weapon entity; the
    // matching `equipAt` empties the list back into the destination
    // row's cells in the same cell-index order. While the weapon is
    // equipped, this stays empty — the row's dice cells are the live
    // source of truth.
    void  attachDice(std::vector<std::unique_ptr<Dice>> dice);
    std::vector<std::unique_ptr<Dice>> takeAttachedDice();
    const std::vector<std::unique_ptr<Dice>>& attachedDicePeek() const;
    int   attachedDiceCount() const;

private:
    dof::core::EntityId            identity;
    WeaponType                     weaponType;
    QualityTier                    qualityTier{QualityTier::Common};
    int                            qualityScoreValue{1};
    std::array<int, kWeaponStatCount> statQualityScores_{};
    int                            itemLevelValue{1};
    int                            slotCountValue{2};
    AttackType                     attackTypeValue{AttackType::Single};
    float                          swipeArcDegreesValue{0.0f};
    int                            multiTargetMaxValue{1};
    int                            multiSingleMaxValue{1};
    std::string                    name;
    float                          baseDamageValue;
    float                          attacksPerSecondValue;
    float                          critValue{1.0f};
    float                          critChanceValue{0.0f};
    float                          evasionBonusValue{0.0f};
    // SA16 — immutable snapshot of the stamped stats, captured on the
    // first `applyLevelScaling` call. `hasCapturedLevelBase` gates the
    // snapshot so repeated rescales do not recapture the already-scaled
    // values (which would compound into a runaway curve).
    bool                           hasCapturedLevelBase{false};
    float                          baseDamageBase{0.0f};
    float                          attacksPerSecondBase{0.0f};
    float                          rangeBase{0.0f};
    float                          critBase{1.0f};
    float                          critChanceBase{0.0f};
    dof::abilities::Aimable        aimableComponent;
    dof::abilities::Rangeable      rangeableComponent;
    dof::abilities::Pickupable     pickupableComponent;
    dof::abilities::Countdownable  countdownableComponent;
    // card-mpkwji9p — see attachDice / takeAttachedDice above.
    std::vector<std::unique_ptr<Dice>> attachedDiceStorage;
};

}
