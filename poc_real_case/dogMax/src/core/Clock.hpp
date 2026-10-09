#pragma once

namespace dof::core {

class Clock {
public:
    explicit Clock(int hertz);

    void  setHertz(int hertz);
    void  setMaxDeltaSeconds(float seconds);
    int   hertz() const;
    float fixedDt() const;

    void  accumulate(float realDeltaSeconds);
    bool  consumeStep();
    // Zero the simulated time, accumulator, and step counter. Restarts
    // the time-animated visuals (floor neon shimmer, etc.) from a
    // deterministic phase — otherwise the monotonic simSeconds keeps
    // accumulating and the shimmer would resume at an arbitrary colour.
    void  reset();
    // Unconditionally advance by one fixed step — used by forced-step loops
    // so animation clocks (simSeconds) advance alongside physics state.
    void  forceStep();

    float interpolationAlpha() const;
    float simulatedSeconds() const;
    long  stepsConsumedTotal() const;

private:
    int   tickHertz;
    float dtFixed;
    float maxDeltaSeconds{0.25f};
    float accumulator;
    long  totalSteps;
};

}
