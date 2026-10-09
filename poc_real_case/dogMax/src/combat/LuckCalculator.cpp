#include "combat/LuckCalculator.hpp"

#include <algorithm>
#include <cmath>

namespace dof::combat {

int sumLuck(std::span<const int> luckPerDice) {
    int total = 0;
    for (const int luck : luckPerDice) total += luck;
    return total;
}

int qualityFloor(int luckTotal, float scale) {
    if (luckTotal <= 0 || scale <= 0.0f) return 0;
    // SE9 / spec §Drop Floor L1914-1921 — sqrt curve replaces the
    // linear scaling. At the spec-pinned scale 9.0 this gives
    // Luck 1 → qFloor 9, Luck 25 → qFloor 45, Luck ~78 → qFloor 79
    // (Rare floor). The sqrt curve makes the first dice's luck very
    // valuable while the late-game stack saturates smoothly toward
    // the clamp at 99 instead of hitting it the moment a player
    // equips a second Rare luck dice.
    const float sqrtLuck = std::sqrt(static_cast<float>(luckTotal));
    const int raw = static_cast<int>(std::floor(sqrtLuck * scale));
    return std::clamp(raw, 0, 99);
}

int effectiveMinFace(int luckTotal, float scale) {
    if (luckTotal <= 0 || scale <= 0.0f) return 1;
    const int raw = static_cast<int>(std::floor(static_cast<float>(luckTotal) * scale));
    return std::max(1, raw);
}

}
