#pragma once

namespace dof::combat {

// Hit-stop: a brief freeze of the whole simulation on impact, so a hit lands
// as a hit instead of the attacker passing through the target
// (docs/FEATURE_SPECS/visual_identity.md Step 8).
//
// The countdown runs on REAL time, not simulation time. While frozen the
// simulation does not step at all, so a sim-time countdown could never tick
// down and the game would freeze permanently on the first hit.
//
// Requests are MAX-WINS rather than additive: in a dense swarm several hits
// resolve on the same frame, and summing their durations would stack into a
// visible lock-up. The longest single request is the one that matters.
class HitStop {
public:
    void request(float seconds);
    void advanceRealTime(float realDeltaSeconds);
    bool isFrozen() const { return remainingSeconds > 0.0f; }
    void clear() { remainingSeconds = 0.0f; }

private:
    float remainingSeconds{0.0f};
};

} // namespace dof::combat
