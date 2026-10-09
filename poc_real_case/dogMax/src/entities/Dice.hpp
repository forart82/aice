#pragma once

#include "abilities/Countdownable.hpp"
#include "abilities/Pickupable.hpp"
#include "core/EntityId.hpp"
#include "entities/QualityTier.hpp"

#include <string>
#include <vector>

namespace dof::entities {

enum class DiceFace { D4, D6, D8, D12, D20, D24, D30, D42, D60, D100 };

int  diceFaceCount(DiceFace face);
const char* diceFaceLabel(DiceFace face);

// T-CHEAT-spawn-type-arg — parser for the `SpawnDice=N,FACES`
// console cheat. Accepts digit-only tokens whose integer value
// matches one of the ten supported dice faces (4, 6, 8, 12, 20, 24,
// 30, 42, 60, 100). Returns true + writes `out` on a match; false
// otherwise (the parser collapses the whole command to Invalid —
// no silent fallback to random).
bool parseDiceFaceCountToken(const std::string& token, DiceFace& out);

class Dice {
public:
    Dice(dof::core::EntityId id, DiceFace face);

    dof::core::EntityId id() const;
    DiceFace            face() const;
    int                 faceCount() const;

    int    currentFace() const;
    void   setCurrentFace(int face);

    // Per-face custom values. faceValue(i) returns the value on face i
    // (1-based, clamped). Defaults to {1,2,...,N} on construction.
    // The DiceCrafter customises individual faces; the damage pipeline reads
    // faceValue(currentFace()) so modified values feed real output.
    int    faceValue(int faceIndex) const;
    void   setFaceValue(int faceIndex, int value);
    void   resetFaceValues();
    // Evolve the dice to a larger face type (DiceCrafter evolution).
    // Updates faceKind, facesTotal, and faceValues. Existing face values
    // are preserved; new faces start at 1. No-op if newFace <= current.
    void   evolveToFace(DiceFace newFace);

    float  damageMultiplier() const;
    void   setDamageMultiplier(float value);

    float  crit() const;
    float  critChance() const;
    int    luck() const;
    float  evasionPerSlot() const;
    void   setCrit(float crit, float critChance);
    void   setLuck(int luck);
    void   setEvasionPerSlot(float evasionPerSlot);

    const std::string& displayName() const;
    void               setDisplayName(std::string name);

    QualityTier tier() const;
    void        setTier(QualityTier value);

    int         qualityScore() const;
    void        setQualityScore(int value);

    int         itemLevel() const;
    void        setItemLevel(int value);

    // True once the dice has been worked at the DiceCrafter (reface or evolve).
    // The loot filter never auto-destroys a faceted dice: powder invested in
    // a dice marks it kept, so a careless filter sweep cannot consume it.
    bool        isCrafted() const;
    void        setCrafted(bool value);

    // Spec §Dices §Rolling L1111 — per-dice face-cycle cadence. Each
    // equipped dice owns its own elapsed-time accumulator so they do
    // NOT cycle in lockstep across rows. The manager ticks this each
    // frame and resets it whenever it crosses the configured threshold.
    float       faceCycleAccumulator() const;
    void        setFaceCycleAccumulator(float value);

    dof::abilities::Countdownable& countdownable();
    dof::abilities::Pickupable&    pickupable();
    const dof::abilities::Countdownable& countdownable() const;
    const dof::abilities::Pickupable&    pickupable() const;

private:
    dof::core::EntityId            identity;
    DiceFace                       faceKind;
    int                            facesTotal;
    int                            faceShown{1};
    std::vector<int>               faceValues;   // 0-indexed; faceValue(i) uses i-1
    float                          damageMultiplierValue{1.0f};
    float                          critValue{0.0f};
    float                          critChanceValue{0.0f};
    int                            luckValue{0};
    float                          evasionPerSlotValue{0.0f};
    std::string                    name;
    QualityTier                    qualityTier{QualityTier::Common};
    int                            qualityScoreValue{1};
    int                            itemLevelValue{1};
    bool                           crafted{false};
    float                          faceCycleAccumulatorValue{0.0f};
    dof::abilities::Countdownable  countdownableComponent;
    dof::abilities::Pickupable     pickupableComponent;
};

}
