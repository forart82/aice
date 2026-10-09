#pragma once

#include "entities/QualityTier.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/System/Vector2.hpp>

#include <string>
#include <vector>

namespace dof::loaders { class ConfigLoader; }
namespace dof::helpers { class DeterministicRandom; using RandomHelper = DeterministicRandom; }

namespace dof::hubs {

// Spec §Damage Text + §Appendix J: three visual tiers keyed off the
// damage *value* (independent of the boolean crit flag).
enum class DamageTextTier { Normal, Heavy, Critical };

struct DamageTextEvent {
    std::string                  text;
    sf::Vector2f                 worldPosition;
    float                        age{0.0f};
    float                        duration{1.0f};
    sf::Color                    color{255, 255, 255, 255};
    int                          fontSize{16};
    DamageTextTier               tier{DamageTextTier::Normal};
    dof::entities::QualityTier   sourceTier{dof::entities::QualityTier::Common};
    bool                         isCritical{false};
};

class DamageTextHub {
public:
    // SA21 / spec §Appendix J L4235 — the hub now owns horizontal-jitter
    // perturbation at spawn time so stacked hits on the same enemy don't
    // overlap perfectly. The jitter half-range comes from
    // `DAMAGE_TEXT_HORIZONTAL_JITTER` (combat.yaml); each spawn draws
    // `rng.uniformFloat(-jitter, +jitter)` into `worldPosition.x`. The
    // rng pointer is captured by reference and outlives the hub
    // (mirror of WeaponManager / LootMaker pattern).
    DamageTextHub(const dof::loaders::ConfigLoader& config,
                  dof::helpers::RandomHelper& rng);

    void spawnDamage(sf::Vector2f worldPosition, float amount, bool isCritical,
                     dof::entities::QualityTier sourceTier = dof::entities::QualityTier::Common);
    void update(float dt);
    const std::vector<DamageTextEvent>& events() const;
    void clear();

    // Classifies an incoming damage amount into one of the three
    // spec tiers (Normal / Heavy / Critical) using the threshold
    // config keys. Exposed for tests so the classification is
    // pinned independent of the spawn pipeline.
    DamageTextTier classifyAmount(float amount) const;

    float duration() const;
    // SA46 — spec §Appendix J L4234 semantic. Returns the vertical
    // drift speed in px/s. Renderer computes the per-frame rise as
    // `moveSpeed() * event.age` so the visual decouples from the
    // event's lifetime.
    float moveSpeed() const;
    int   fontSize() const;
    int   heavyFontSize() const;
    int   critFontSize() const;
    float horizontalJitter() const;

private:
    dof::helpers::RandomHelper&  rngRef;
    std::vector<DamageTextEvent> activeEvents;
    float    durationSeconds;
    float    moveSpeedValue;
    int      normalFontSize;
    int      heavyFontSize_;
    int      critFontSize_;
    float    heavyThreshold;
    float    criticalThreshold;
    float    horizontalJitterPixels;
    sf::Color normalColor;
    sf::Color heavyColor;
    sf::Color critColor;
};

}
