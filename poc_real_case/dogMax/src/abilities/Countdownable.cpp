#include "abilities/Countdownable.hpp"

namespace dof::abilities {

void Countdownable::setDuration(float seconds) {
    if (seconds < 0.0f) seconds = 0.0f;
    duration = seconds;
    remaining = seconds;
}

void Countdownable::reset() {
    remaining = duration;
}

void Countdownable::advance(float dt) {
    if (dt <= 0.0f) return;
    remaining -= dt;
    if (remaining < 0.0f) remaining = 0.0f;
}

bool Countdownable::isFinished() const {
    return remaining <= 0.0f;
}

float Countdownable::progress() const {
    if (duration <= 0.0f) return 1.0f;
    return 1.0f - (remaining / duration);
}

}
