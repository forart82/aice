#include "hubs/DiceCrafterHub.hpp"

#include "hubs/PowderHub.hpp"
#include "helpers/RandomHelper.hpp"
#include "loaders/ConfigLoader.hpp"

#include <algorithm>
#include <string>

namespace dof::hubs {

using namespace dof::entities;

// ── ladder helpers ──────────────────────────────────────────────────────────

DiceFace nextDiceFaceInLadder(DiceFace current, bool& isMax) {
    switch (current) {
        case DiceFace::D4:   isMax = false; return DiceFace::D6;
        case DiceFace::D6:   isMax = false; return DiceFace::D8;
        case DiceFace::D8:   isMax = false; return DiceFace::D12;
        case DiceFace::D12:  isMax = false; return DiceFace::D20;
        case DiceFace::D20:  isMax = false; return DiceFace::D24;
        case DiceFace::D24:  isMax = false; return DiceFace::D30;
        case DiceFace::D30:  isMax = false; return DiceFace::D42;
        case DiceFace::D42:  isMax = false; return DiceFace::D60;
        case DiceFace::D60:  isMax = false; return DiceFace::D100;
        case DiceFace::D100: isMax = true;  return DiceFace::D100;
    }
    isMax = true; return DiceFace::D100;
}

int maxFaceValueForPowderColor(PowderColor color) {
    // Each powder tier unlocks the value ceiling of its associated dice.
    switch (color) {
        case PowderColor::Red:     return 4;
        case PowderColor::Yellow:  return 6;
        case PowderColor::Cyan:    return 8;
        case PowderColor::Green:   return 12;
        case PowderColor::Blue:    return 20;
        case PowderColor::Magenta: return 24;
        case PowderColor::Purple:  return 30;
        case PowderColor::Orange:  return 42;
        case PowderColor::Pink:    return 60;
        case PowderColor::White:
        case PowderColor::Black:   return 100;
    }
    return 4;
}

// ── free helpers ────────────────────────────────────────────────────────────

std::vector<PowderColor> refaceTiersFor(PowderColor native) {
    static const std::vector<PowderColor> kLadder = {
        PowderColor::Red,  PowderColor::Yellow, PowderColor::Cyan,
        PowderColor::Green, PowderColor::Blue,  PowderColor::Magenta,
        PowderColor::Purple, PowderColor::Orange, PowderColor::Pink,
        PowderColor::White
    };
    std::vector<PowderColor> result;
    bool found = false;
    for (auto c : kLadder) {
        if (c == native) found = true;
        if (found) {
            result.push_back(c);
            if (result.size() == 4) break;  // match DiceCrafterPanel 4-button cap
        }
    }
    return result;
}

std::string diceCraftResultLabel(const DiceCraftResult& r) {
    switch (r.kind) {
        case DiceCraftResult::Kind::NoPowder:
            return "Not enough powder!";
        case DiceCraftResult::Kind::NoChange:
            return "No change. Powder spent.";
        case DiceCraftResult::Kind::FaceValueChanged:
            return "Face " + std::to_string(r.faceIndex) + ": "
                 + std::to_string(r.oldValue) + " -> " + std::to_string(r.newValue);
        case DiceCraftResult::Kind::FaceCountIncreased:
            return "Evolved! Now " + std::to_string(r.newValue) + " faces.";
        case DiceCraftResult::Kind::NoDice:
            return "Slot a dice first.";
        case DiceCraftResult::Kind::InvalidFace:
            return "No such face on this dice.";
        case DiceCraftResult::Kind::AlreadyMaxFace:
            return "Already at the highest dice tier.";
    }
    return {};
}

// ── DiceCrafterHub ────────────────────────────────────────────────────────────────

std::unique_ptr<Dice> DiceCrafterHub::insertDice(std::unique_ptr<Dice> dice) {
    auto previouslySlotted = std::move(slottedDice);
    slottedDice = std::move(dice);
    return previouslySlotted;
}

std::unique_ptr<Dice> DiceCrafterHub::extractDice() {
    return std::move(slottedDice);
}

const Dice* DiceCrafterHub::peekedDice() const {
    return slottedDice.get();
}

bool DiceCrafterHub::isSlotFilled() const {
    return slottedDice != nullptr;
}

PowderColor DiceCrafterHub::nativeColor() const {
    if (!slottedDice) return PowderColor::Red;
    return powderColorForDice(slottedDice->face());
}

PowderColor DiceCrafterHub::evolveColor() const {
    if (!slottedDice) return PowderColor::Yellow;
    bool isMax = false;
    const DiceFace next = nextDiceFaceInLadder(slottedDice->face(), isMax);
    return powderColorForDice(next);
}

bool DiceCrafterHub::isAtMaxFace() const {
    if (!slottedDice) return false;
    bool isMax = false;
    nextDiceFaceInLadder(slottedDice->face(), isMax);
    return isMax;
}

DiceCraftResult DiceCrafterHub::attemptReface(PowderHub& powder,
                                    PowderColor color,
                                    int faceIndex,
                                    dof::helpers::RandomHelper& rng,
                                    const dof::loaders::ConfigLoader& cfg) {
    DiceCraftResult result;
    if (!slottedDice) { result.kind = DiceCraftResult::Kind::NoDice; return result; }
    if (faceIndex < 1 || faceIndex > slottedDice->faceCount()) {
        result.kind = DiceCraftResult::Kind::InvalidFace;
        return result;
    }

    const int cost = cfg.getInt("DICE_CRAFTER_REFACE_COST");
    if (!powder.spendPowder(color, cost)) {
        result.kind = DiceCraftResult::Kind::NoPowder;
        return result;
    }

    const int maxVal = maxFaceValueForPowderColor(color);
    // Weighted toward higher values: take max of two uniform rolls.
    // P(X = v) = (2v - 1) / N² — linear bias, v=N is most likely.
    const int roll1  = rng.uniformInt(1, maxVal);
    const int roll2  = rng.uniformInt(1, maxVal);
    const int newVal = std::max(roll1, roll2);
    const int oldVal = slottedDice->faceValue(faceIndex);
    const int keptVal = std::max(newVal, oldVal);

    slottedDice->setFaceValue(faceIndex, keptVal);
    // Powder spent on this dice — mark it faceted so the loot filter never
    // auto-destroys it.
    slottedDice->setCrafted(true);

    result.faceIndex = faceIndex;
    result.oldValue  = oldVal;
    result.newValue  = keptVal;
    result.kind = (keptVal != oldVal) ? DiceCraftResult::Kind::FaceValueChanged
                                      : DiceCraftResult::Kind::NoChange;
    return result;
}

DiceCraftResult DiceCrafterHub::attemptEvolve(PowderHub& powder,
                                    dof::helpers::RandomHelper& rng,
                                    const dof::loaders::ConfigLoader& cfg) {
    DiceCraftResult result;
    if (!slottedDice) { result.kind = DiceCraftResult::Kind::NoDice; return result; }
    if (isAtMaxFace()) { result.kind = DiceCraftResult::Kind::AlreadyMaxFace; return result; }

    const int cost = cfg.getInt("DICE_CRAFTER_EVOLVE_COST");
    const PowderColor evColor = evolveColor();
    if (!powder.spendPowder(evColor, cost)) {
        result.kind = DiceCraftResult::Kind::NoPowder;
        return result;
    }
    // Powder spent on this dice — mark it faceted so the loot filter never
    // auto-destroys it (even on an evolve roll that fails to grow it).
    slottedDice->setCrafted(true);

    // Per-tier success probability key: DICE_CRAFTER_EVOLVE_CHANCE_D4, _D6, …
    const char* key = nullptr;
    switch (slottedDice->face()) {
        case DiceFace::D4:   key = "DICE_CRAFTER_EVOLVE_CHANCE_D4";   break;
        case DiceFace::D6:   key = "DICE_CRAFTER_EVOLVE_CHANCE_D6";   break;
        case DiceFace::D8:   key = "DICE_CRAFTER_EVOLVE_CHANCE_D8";   break;
        case DiceFace::D12:  key = "DICE_CRAFTER_EVOLVE_CHANCE_D12";  break;
        case DiceFace::D20:  key = "DICE_CRAFTER_EVOLVE_CHANCE_D20";  break;
        case DiceFace::D24:  key = "DICE_CRAFTER_EVOLVE_CHANCE_D24";  break;
        case DiceFace::D30:  key = "DICE_CRAFTER_EVOLVE_CHANCE_D30";  break;
        case DiceFace::D42:  key = "DICE_CRAFTER_EVOLVE_CHANCE_D42";  break;
        case DiceFace::D60:  key = "DICE_CRAFTER_EVOLVE_CHANCE_D60";  break;
        case DiceFace::D100: key = "DICE_CRAFTER_EVOLVE_CHANCE_D100"; break;
    }
    const float chance = key ? cfg.getFloat(key) : 0.0f;

    if (!rng.bernoulli(chance)) {
        result.kind = DiceCraftResult::Kind::NoChange;
        return result;
    }

    bool isMax = false;
    const DiceFace nextFace = nextDiceFaceInLadder(slottedDice->face(), isMax);
    result.kind     = DiceCraftResult::Kind::FaceCountIncreased;
    result.oldValue = diceFaceCount(slottedDice->face());  // face count before evolve
    slottedDice->evolveToFace(nextFace);
    result.newValue = diceFaceCount(slottedDice->face());  // face count after evolve
    return result;
}

}
