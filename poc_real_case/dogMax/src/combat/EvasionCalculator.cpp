#include "combat/EvasionCalculator.hpp"

#include <algorithm>

namespace dof::combat {

float evadeChance(std::span<const float> evasionPerSlots, float cap) {
    float survivalProduct = 1.0f;
    for (const float dps : evasionPerSlots) {
        const float clamped = std::clamp(dps, 0.0f, 1.0f);
        survivalProduct *= (1.0f - clamped);
    }
    const float raw = 1.0f - survivalProduct;
    const float effectiveCap = std::clamp(cap, 0.0f, 1.0f);
    return std::clamp(raw, 0.0f, effectiveCap);
}

}
