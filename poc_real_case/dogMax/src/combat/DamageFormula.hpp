#pragma once

#include <span>

namespace dof::combat {

struct DamageResult {
    float damage{0.0f};
    int   sumFaces{0};
    float productMultipliers{1.0f};
    float dronMultiplier{1.0f};
    bool  isCritical{false};
};

DamageResult computeDamage(float baseDamage,
                            std::span<const int>   diceFaces,
                            std::span<const float> diceMultipliers,
                            float dronMultiplier,
                            float critMultiplier,
                            bool  isCritical,
                            float diceProductFloor,
                            float damageFloor);

}
