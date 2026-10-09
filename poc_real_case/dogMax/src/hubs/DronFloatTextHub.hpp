#pragma once

#include "combat/DronDetector.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/System/Vector2.hpp>

#include <set>
#include <string>
#include <vector>

namespace dof::loaders { class ConfigLoader; }

namespace dof::hubs {

struct DronFloatTextEvent {
    int                       weaponRowIndex{-1};
    sf::Vector2f              anchorUi{0.0f, 0.0f};
    std::string               name{"Voidron"};
    float                     multiplier{1.0f};
    dof::combat::DronTier     tier{dof::combat::DronTier::Voidron};
    float                     age{0.0f};
    // SE5 / spec L1347-1366 — per-WeaponSlot dedup counter. When the
    // same tier repeats on the same row inside the active label's
    // lifetime, `count` increments and the renderer paints
    // `Tier (×N)` instead of stacking a second event. Higher-tier
    // events on the same row replace this one (count resets to 1).
    int                       count{1};
};

class DronFloatTextHub {
public:
    explicit DronFloatTextHub(const dof::loaders::ConfigLoader& config);

    void spawn(int weaponRowIndex, sf::Vector2f anchorUi, const dof::combat::DronResult& result);
    void update(float dt);
    const std::vector<DronFloatTextEvent>& events() const;
    void clear();

    float duration() const;
    float fadeIn() const;
    float fadeOut() const;
    float risePixels() const;
    int   fontSizeName() const;
    int   fontSizeMult() const;
    sf::Color color() const;
    const dof::combat::DronResult* lastNonSilent() const;

    // B-UX-6 / SE5 — true iff `tier` is on the always-show whitelist
    // (Hexadron, Pentadron, Twin-Tridron, Quad-Duodron, Omidron).
    // The DronResult::isSilent gate handles Voidron; every other
    // non-whitelisted tier (Hemidron .. Duodron) is suppressed by
    // this predicate at the float-spawn site.
    bool isTierFloatAllowed(dof::combat::DronTier tier) const;

private:
    std::vector<DronFloatTextEvent> activeEvents;
    dof::combat::DronResult lastNonSilentResult{};
    bool                    hasLastNonSilent{false};
    float                   durationSeconds;
    float                   fadeInSeconds;
    float                   fadeOutSeconds;
    float                   risePixelsValue;
    int                     fontSizeName_;
    int                     fontSizeMult_;
    sf::Color               textColor;
    std::set<dof::combat::DronTier> alwaysShowTiers;
};

}
