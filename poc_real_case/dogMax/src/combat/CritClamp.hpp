#pragma once

namespace dof::combat {

// SE7 / spec L1598 — pure clamp helper for the effective crit
// chance after all positive contributions (per-weapon base, dice
// summed `critChance`, future per-level contributions) have been
// added together. Returns `min(cap, sum)` clamped from
// below at 0 so a stray negative dice value can't sink the chance
// below zero. The cap is config-driven (`CRIT_CHANCE_CAP=0.75`).
constexpr float clampEffectiveCritChance(float base, float diceContribution, float cap) {
    const float sum = base + diceContribution;
    if (sum <= 0.0f) return 0.0f;
    return (sum > cap) ? cap : sum;
}

}
