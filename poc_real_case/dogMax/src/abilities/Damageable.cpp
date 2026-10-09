#include "abilities/Damageable.hpp"

namespace dof::abilities {

void Damageable::setMaxHealth(float maxValue) {
    if (maxValue < 0.0f) maxValue = 0.0f;
    maxHealth = maxValue;
    health = maxValue;
    clearLastDamageAttackName();
}

float Damageable::takeDamage(float amount) {
    return takeDamage(amount, "Unknown Attack");
}

float Damageable::takeDamage(float amount, std::string_view attackName) {
    if (amount <= 0.0f) return 0.0f;
    // card-dash-iframes — an active invulnerability window swallows the
    // hit entirely. Returning 0 lets the caller skip the damage number /
    // death check so the i-frame reads as a clean dodge on screen.
    if (isInvulnerable()) return 0.0f;
    const float before = health;
    health -= amount;
    if (health < 0.0f) health = 0.0f;
    const float applied = before - health;
    if (applied > 0.0f) {
        lastDamageAttackNameValue = attackName.empty()
            ? std::string("Unknown Attack")
            : std::string(attackName);
        lastDamageAmountValue = applied;
    }
    return applied;
}

const std::string& Damageable::lastDamageAttackName() const {
    return lastDamageAttackNameValue;
}

float Damageable::lastDamageAmount() const {
    return lastDamageAmountValue;
}

void Damageable::clearLastDamageAttackName() {
    lastDamageAttackNameValue.clear();
    lastDamageAmountValue = 0.0f;
}

void Damageable::heal(float amount) {
    if (amount <= 0.0f) return;
    health += amount;
    if (health > maxHealth) health = maxHealth;
}

bool Damageable::isDead() const {
    return health <= 0.0f;
}

float Damageable::healthRatio() const {
    if (maxHealth <= 0.0f) return 0.0f;
    return health / maxHealth;
}

void Damageable::setInvulnerable(float seconds) {
    if (seconds <= 0.0f) return;
    // Extend-only: a fresh dash mid-window lengthens the i-frames but
    // never truncates an already-longer window. Countdownable::setDuration
    // would reset `remaining` unconditionally, discarding this max
    // semantic, so write the fields directly — keeping `duration` in sync
    // with the new window so `progress()` stays meaningful.
    if (seconds > invulnerability.remaining) {
        invulnerability.remaining = seconds;
        invulnerability.duration  = seconds;
    }
}

void Damageable::advanceInvulnerability(float dt) {
    invulnerability.advance(dt);
}

bool Damageable::isInvulnerable() const {
    return !invulnerability.isFinished();
}

void Damageable::clearInvulnerability() {
    invulnerability.remaining = 0.0f;
}

}
