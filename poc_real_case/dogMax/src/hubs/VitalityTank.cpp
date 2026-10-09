#include "hubs/VitalityTank.hpp"

#include "abilities/Damageable.hpp"
#include "loaders/ConfigLoader.hpp"

#include <algorithm>

namespace dof::hubs {

VitalityTank::VitalityTank(const dof::loaders::ConfigLoader& config)
    : configRef(config) {
}

float VitalityTank::addEmptyKillCharge() {
    const float maximum = capacity();
    const float before = std::clamp(reserveAmount, 0.0f, maximum);
    const float contribution = std::max(
        0.0f, configRef.getFloat("VITAL_TANK_CHARGE_PER_EMPTY_KILL"));
    reserveAmount = std::min(maximum, before + contribution);
    return reserveAmount - before;
}

float VitalityTank::transferTo(dof::abilities::Damageable& damageable, float dt) {
    const float maximum = capacity();
    reserveAmount = std::clamp(reserveAmount, 0.0f, maximum);
    if (dt <= 0.0f || reserveAmount <= 0.0f || damageable.isDead()) return 0.0f;

    const float missingHealth = std::max(0.0f, damageable.maxHealth - damageable.health);
    const float transferRate = std::max(
        0.0f, configRef.getFloat("VITAL_TANK_TRANSFER_HP_PER_SECOND"));
    const float requested = std::min({reserveAmount, missingHealth, transferRate * dt});
    if (requested <= 0.0f) return 0.0f;

    const float healthBefore = damageable.health;
    damageable.heal(requested);
    const float transferred = damageable.health - healthBefore;
    reserveAmount = std::max(0.0f, reserveAmount - transferred);
    return transferred;
}

void VitalityTank::reset() {
    reserveAmount = 0.0f;
}

float VitalityTank::reserve() const {
    return std::clamp(reserveAmount, 0.0f, capacity());
}

float VitalityTank::capacity() const {
    return std::max(0.0f, configRef.getFloat("VITAL_TANK_CAPACITY"));
}

float VitalityTank::fillRatio() const {
    const float maximum = capacity();
    if (maximum <= 0.0f) return 0.0f;
    return reserve() / maximum;
}

}
