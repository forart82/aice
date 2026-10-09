#include "hubs/EvasionHub.hpp"

#include "combat/EvasionCalculator.hpp"
#include "helpers/RandomHelper.hpp"
#include "loaders/ConfigLoader.hpp"

namespace dof::hubs {

EvasionHub::EvasionHub(const dof::loaders::ConfigLoader& config) {
    refreshConfig(config);
}

void EvasionHub::refreshConfig(const dof::loaders::ConfigLoader& config) {
    cachedCap           = config.getFloat("EVASION_CAP");
    cachedFlashDuration = config.getFloat("GHOST_TRAIL_FLASH_DURATION");
}

bool EvasionHub::tryEvade(dof::helpers::RandomHelper& rng, std::span<const float> evasionPerSlots) {
    ++attempts;
    bool evaded = false;
    if (isForceNextEvade) {
        evaded = true;
        isForceNextEvade = false;
    } else {
        const float chance = dof::combat::evadeChance(evasionPerSlots, cachedCap);
        evaded = rng.bernoulli(chance);
    }
    if (evaded) {
        ++evades;
        flashRemaining = cachedFlashDuration;
    }
    return evaded;
}

void EvasionHub::forceNextEvade() { isForceNextEvade = true; }

void EvasionHub::advanceFlash(float dt) {
    if (flashRemaining > 0.0f) {
        flashRemaining -= dt;
        if (flashRemaining < 0.0f) flashRemaining = 0.0f;
    }
}

float EvasionHub::cap() const { return cachedCap; }
float EvasionHub::flashDurationSeconds() const { return cachedFlashDuration; }
float EvasionHub::flashRemainingSeconds() const { return flashRemaining; }
bool  EvasionHub::isFlashActive() const { return flashRemaining > 0.0f; }
std::uint64_t EvasionHub::totalAttempts() const { return attempts; }
std::uint64_t EvasionHub::totalEvades() const { return evades; }

}
