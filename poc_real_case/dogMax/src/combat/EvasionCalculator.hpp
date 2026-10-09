#pragma once

#include <span>

namespace dof::combat {

float evadeChance(std::span<const float> evasionPerSlots, float cap);

}
