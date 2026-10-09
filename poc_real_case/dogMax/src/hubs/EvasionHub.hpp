#pragma once

#include <cstdint>
#include <span>

namespace dof::loaders { class ConfigLoader; }
namespace dof::helpers { class DeterministicRandom; using RandomHelper = DeterministicRandom; }

namespace dof::hubs {

class EvasionHub {
public:
    explicit EvasionHub(const dof::loaders::ConfigLoader& config);
    void refreshConfig(const dof::loaders::ConfigLoader& config);

    // Returns true when the incoming damage was evaded. Increments counters,
    // arms the ghost-step flash on a successful evade, and lets the next
    // forced-evade flag short-circuit the RNG check (armed via
    // `forceNextEvade` to force a deterministic evade).
    bool tryEvade(dof::helpers::RandomHelper& rng, std::span<const float> evasionPerSlots);

    void  forceNextEvade();
    void  advanceFlash(float dt);

    float  cap() const;
    float  flashDurationSeconds() const;
    float  flashRemainingSeconds() const;
    bool   isFlashActive() const;
    std::uint64_t totalAttempts() const;
    std::uint64_t totalEvades() const;

private:
    float                cachedCap;
    float                cachedFlashDuration;
    float                flashRemaining{0.0f};
    bool                 isForceNextEvade{false};
    std::uint64_t        attempts{0};
    std::uint64_t        evades{0};
};

}
