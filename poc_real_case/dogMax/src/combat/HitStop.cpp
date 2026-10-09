#include "combat/HitStop.hpp"

#include <algorithm>

namespace dof::combat {

void HitStop::request(float seconds) {
    if (seconds <= 0.0f) return;
    remainingSeconds = std::max(remainingSeconds, seconds);
}

void HitStop::advanceRealTime(float realDeltaSeconds) {
    if (remainingSeconds <= 0.0f) return;
    remainingSeconds = std::max(0.0f, remainingSeconds - realDeltaSeconds);
}

} // namespace dof::combat
