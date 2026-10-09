#include "core/Clock.hpp"

#include <stdexcept>

namespace dof::core {

Clock::Clock(int hertz) {
    setHertz(hertz);
    accumulator = 0.0f;
    totalSteps = 0;
}

void Clock::setHertz(int hertz) {
    if (hertz <= 0) throw std::invalid_argument("Clock: hertz must be > 0");
    tickHertz = hertz;
    dtFixed = 1.0f / static_cast<float>(hertz);
}

void Clock::setMaxDeltaSeconds(float seconds) {
    if (seconds <= 0.0f) throw std::invalid_argument("Clock: maxDeltaSeconds must be > 0");
    maxDeltaSeconds = seconds;
}

int Clock::hertz() const { return tickHertz; }
float Clock::fixedDt() const { return dtFixed; }

void Clock::accumulate(float realDeltaSeconds) {
    if (realDeltaSeconds < 0.0f) realDeltaSeconds = 0.0f;
    if (realDeltaSeconds > maxDeltaSeconds) realDeltaSeconds = maxDeltaSeconds;
    accumulator += realDeltaSeconds;
}

bool Clock::consumeStep() {
    if (accumulator >= dtFixed) {
        accumulator -= dtFixed;
        ++totalSteps;
        return true;
    }
    return false;
}

void Clock::reset() {
    accumulator = 0.0f;
    totalSteps  = 0;
}

void Clock::forceStep() {
    ++totalSteps;
}

float Clock::interpolationAlpha() const {
    return accumulator / dtFixed;
}

// Derived from the exact step count rather than accumulated per step: a float
// summed 60x/second stops advancing once its ULP exceeds the step size, which
// stalled every time-animated visual on a long session.
float Clock::simulatedSeconds() const { return static_cast<float>(totalSteps) * dtFixed; }
long Clock::stepsConsumedTotal() const { return totalSteps; }

}
