#pragma once

#include <span>

namespace dof::combat {

int sumLuck(std::span<const int> luckPerDice);
int qualityFloor(int luckTotal, float scale);
int effectiveMinFace(int luckTotal, float scale);

}
