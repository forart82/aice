#pragma once

#include "abilities/Countdownable.hpp"

#include <string>
#include <string_view>

namespace dof::abilities {

struct Damageable {
    float health{0.0f};
    float maxHealth{0.0f};

    // card-dash-iframes — invulnerability window. While it has time
    // remaining every `takeDamage` is fully ignored (no HP loss, returns
    // 0). The Hero's dash arms this so the dash doubles as a defensive
    // escape; enemies never set it, so their `takeDamage` is unaffected.
    // The timer decays via `advanceInvulnerability` each frame. Reuses
    // the shared Countdownable decrement-and-floor logic. Explicitly
    // initialised to a finished (0/0) state so a fresh Damageable starts
    // vulnerable — Countdownable's own defaults are a live 1s window.
    Countdownable invulnerability{0.0f, 0.0f};

    void  setMaxHealth(float maxValue);

    // Returns the amount of HP actually subtracted (0 while invulnerable
    // or when `amount <= 0`). Callers gate their satellite effects —
    // floating damage numbers, death marking — on a positive return so an
    // ignored hit never spawns a damage number for HP that was never lost.
    float takeDamage(float amount);
    float takeDamage(float amount, std::string_view attackName);

    const std::string& lastDamageAttackName() const;
    float              lastDamageAmount() const;
    void               clearLastDamageAttackName();

    void  heal(float amount);
    bool  isDead() const;
    float healthRatio() const;

    // card-dash-iframes — invulnerability control. `setInvulnerable`
    // never shrinks an active window (takes the max) so a fresh dash
    // mid-window extends rather than truncates the i-frames.
    void  setInvulnerable(float seconds);
    void  advanceInvulnerability(float dt);
    bool  isInvulnerable() const;
    void  clearInvulnerability();

private:
    std::string lastDamageAttackNameValue;
    float       lastDamageAmountValue{0.0f};
};

}
