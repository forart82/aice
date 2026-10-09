#include "combat/DodgeSystem.hpp"

#include "loaders/ConfigLoader.hpp"

#include <algorithm>

namespace dof::combat {

DodgeSystem::DodgeSystem(const dof::loaders::ConfigLoader& config) {
    maxChargesValue       = std::max(0, config.getInt("DODGE_MAX_CHARGES"));
    cooldownSecondsValue  = std::max(0.0f, config.getFloat("DODGE_CHARGE_COOLDOWN_SECONDS"));
    chargesAvailableValue = maxChargesValue;
    cooldownRemainingValue = 0.0f;
}

bool DodgeSystem::tryConsumeCharge() {
    if (chargesAvailableValue <= 0) return false;
    --chargesAvailableValue;
    // Start the cooldown timer if it isn't already counting down.
    if (cooldownRemainingValue <= 0.0f) {
        cooldownRemainingValue = cooldownSecondsValue;
    }
    return true;
}

void DodgeSystem::update(float dt) {
    if (chargesAvailableValue >= maxChargesValue) {
        cooldownRemainingValue = 0.0f;
        return;
    }
    if (cooldownRemainingValue <= 0.0f) {
        // Should only happen when a setter shrinks the cooldown to
        // zero while charges are missing — refill instantly so the
        // state stays consistent.
        chargesAvailableValue = std::min(chargesAvailableValue + 1, maxChargesValue);
        return;
    }
    cooldownRemainingValue -= dt;
    if (cooldownRemainingValue <= 0.0f) {
        chargesAvailableValue = std::min(chargesAvailableValue + 1, maxChargesValue);
        cooldownRemainingValue = (chargesAvailableValue < maxChargesValue)
            ? cooldownSecondsValue
            : 0.0f;
    }
}

int   DodgeSystem::maxCharges() const         { return maxChargesValue; }
int   DodgeSystem::chargesAvailable() const   { return chargesAvailableValue; }
float DodgeSystem::cooldownSeconds() const    { return cooldownSecondsValue; }
float DodgeSystem::cooldownRemaining() const  { return cooldownRemainingValue; }

void DodgeSystem::setMaxCharges(int value) {
    maxChargesValue = std::max(0, value);
    chargesAvailableValue = std::min(chargesAvailableValue, maxChargesValue);
}

void DodgeSystem::setCooldownSeconds(float seconds) {
    cooldownSecondsValue = std::max(0.0f, seconds);
    if (cooldownRemainingValue > cooldownSecondsValue) {
        cooldownRemainingValue = cooldownSecondsValue;
    }
}

void DodgeSystem::reset() {
    chargesAvailableValue  = maxChargesValue;
    cooldownRemainingValue = 0.0f;
}

}
