#pragma once

// card-mpkz662b part 1b — the NEW active Doge mechanic. Press Space
// to dash in the current input direction. The system tracks a small
// pool of charges and a per-charge cooldown:
//
// - `maxCharges` charges are available at run start.
// - `tryConsumeCharge()` is true exactly once when the player has a
//   charge available; the charge is decremented and the cooldown
//   timer starts. Returns false when no charge is available.
// - `update(dt)` advances the cooldown timer; whenever it elapses,
//   one charge is added back (capped at `maxCharges`).
//
// The cooldown timer is shared across the entire pool — if the
// player burns both charges back-to-back, the first refill arrives
// `cooldownSeconds` later; the next refill arrives another
// `cooldownSeconds` after that. This keeps the rhythm predictable
// rather than per-charge tracking which surprises the player.
//
// Equipment modifiers (number of charges + cooldown) are scoped for
// a future card; this header exposes setters so the wiring stays
// straightforward when that lands.

namespace dof::loaders { class ConfigLoader; }

namespace dof::combat {

class DodgeSystem {
public:
    DodgeSystem() = default;
    explicit DodgeSystem(const dof::loaders::ConfigLoader& config);

    bool tryConsumeCharge();
    void update(float dt);

    int   maxCharges() const;
    int   chargesAvailable() const;
    float cooldownSeconds() const;
    float cooldownRemaining() const;

    // Equipment-modifier hooks (future card-driven scope). Calling
    // either re-clamps `chargesAvailable` so a shrunk pool doesn't
    // leave stale charges in flight.
    void setMaxCharges(int value);
    void setCooldownSeconds(float seconds);

    // Hard reset — clears the cooldown timer + refills every
    // charge. Use on run restart so the player always starts a
    // run with full dash.
    void reset();

private:
    int   maxChargesValue{2};
    int   chargesAvailableValue{2};
    float cooldownSecondsValue{2.0f};
    float cooldownRemainingValue{0.0f};
};

}
