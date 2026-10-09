#pragma once

#include "entities/Dice.hpp"
#include "entities/PowderColor.hpp"

#include <memory>
#include <string>
#include <vector>

namespace dof::helpers { class DeterministicRandom; using RandomHelper = DeterministicRandom; }
namespace dof::hubs     { class PowderHub; }
namespace dof::loaders  { class ConfigLoader; }

namespace dof::hubs {

// Result of one DiceCrafter attempt. Powder is always spent when kind != NoPowder.
struct DiceCraftResult {
    enum class Kind {
        NoPowder,            // not enough powder — nothing changed
        NoChange,            // powder spent; random roll produced no improvement
        FaceValueChanged,    // powder spent; one face value was rewritten
        FaceCountIncreased,  // powder spent; dice evolved to the next face tier
        NoDice,              // nothing slotted in the crafter
        InvalidFace,         // face index outside the slotted dice's range
        AlreadyMaxFace,      // dice is already at the top of the ladder
    };
    // NOTE: no default member initialiser. Every early return in attemptReface/
    // attemptEvolve must state its own kind — the previous default of NoPowder
    // meant a maxed dice, an empty slot and a bad face index all reported
    // "Not enough powder!" to a player who had plenty.
    Kind kind;
    int  faceIndex{-1};   // 1-based face that changed (-1 when not applicable)
    int  oldValue{0};
    int  newValue{0};
};

// Dice ladder: D4→D6→D8→D12→D20→D24→D30→D42→D60→D100.
// Returns the next DiceFace in the ladder; `isMax` set true when already at top.
dof::entities::DiceFace nextDiceFaceInLadder(dof::entities::DiceFace current,
                                              bool& isMax);

// Maximum face value reachable when refacing with a given powder color.
// Matches the face count of the dice that produces that color (Red=4, Yellow=6…).
int maxFaceValueForPowderColor(dof::entities::PowderColor color);

// All powder colors usable for reface starting at `native` tier and up.
// Button index i in DiceCrafterPanel maps to tiers[i].
std::vector<dof::entities::PowderColor> refaceTiersFor(dof::entities::PowderColor native);

// Human-readable label for the result of one DiceCrafter operation.
std::string diceCraftResultLabel(const DiceCraftResult& result);

class DiceCrafterHub {
public:
    // Slot management
    // Returns whatever was already in the slot (null when it was empty), so a
    // caller physically cannot overwrite and destroy the previous die. It used
    // to return void and assign straight over slottedDice; safety lived
    // entirely in two call sites that each proved it a different ad-hoc way.
    [[nodiscard]] std::unique_ptr<dof::entities::Dice> insertDice(
        std::unique_ptr<dof::entities::Dice> dice);
    std::unique_ptr<dof::entities::Dice> extractDice();
    const dof::entities::Dice* peekedDice() const;
    bool isSlotFilled() const;

    // REFACE: spend DICE_CRAFTER_REFACE_COST powder of `color` on the player-selected
    // face (1-based `faceIndex`). New value is max(roll, roll) against
    // [1, maxFaceValueForPowderColor(color)] — weighted toward higher values.
    // Always spends powder if available. Returns NoPowder if insufficient.
    DiceCraftResult attemptReface(PowderHub& powder,
                              dof::entities::PowderColor color,
                              int faceIndex,
                              dof::helpers::RandomHelper& rng,
                              const dof::loaders::ConfigLoader& cfg);

    // EVOLVE: spend DICE_CRAFTER_EVOLVE_COST powder of the color that matches the
    // NEXT dice tier; roll probability from config. On success the dice grows
    // to the next DiceFace; on failure powder is still spent.
    DiceCraftResult attemptEvolve(PowderHub& powder,
                              dof::helpers::RandomHelper& rng,
                              const dof::loaders::ConfigLoader& cfg);

    // Powder color the equipped dice natively drops (its own tier).
    dof::entities::PowderColor nativeColor() const;
    // Powder color required to evolve (next tier up; invalid if already max).
    dof::entities::PowderColor evolveColor() const;
    bool isAtMaxFace() const;

private:
    std::unique_ptr<dof::entities::Dice> slottedDice;
};

}
