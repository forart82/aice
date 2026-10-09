#pragma once

#include "entities/Weapon.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/System/Vector2.hpp>

#include <vector>

namespace dof::loaders { class ConfigLoader; }

namespace dof::hubs {

// Spec §Attack §VFX L1551-1559 — per-mode visual feedback events.
// `WeaponManager::fireRow` pushes one event per fire (regardless of
// hit count) and `AttackVfxRenderer` consumes the live list during
// the render pass.

struct AttackVfxEvent {
    dof::entities::AttackType  mode{dof::entities::AttackType::Single};
    dof::entities::WeaponType  weaponTypeHint{dof::entities::WeaponType::Pitchfork};
    // When true the renderer uses the live hero position instead of
    // the fire-time originWorld — keeps melee VFX glued to a moving hero.
    // BigAxe sets false so its pulse travels in world space.
    bool                       isHeroAnchored{true};
    sf::Vector2f               originWorld{0.0f, 0.0f};  // hero feet at fire (or world AOE centre)
    sf::Vector2f               direction{0.0f, 0.0f};    // unit fire vector (Single/Swipe)
    float                      range{0.0f};
    float                      arcDegrees{0.0f};         // Swipe only
    sf::Color                  color{255, 255, 255, 255};
    float                      duration{0.28f};
    float                      age{0.0f};
    std::vector<sf::Vector2f>  radialTargets;            // MultiTarget: one per hit enemy
    sf::Vector2f               stabTarget{0.0f, 0.0f};  // MultiSingle: single anchor
    int                        stabCount{1};
    bool                       isEnemyAttack{false};
    sf::Vector2f               executionTarget{0.0f, 0.0f};
};

class AttackVfxHub {
public:
    explicit AttackVfxHub(const dof::loaders::ConfigLoader& config);

    // Per-mode spawn helpers. weaponType defaults keep existing test call
    // sites compiling without modification.
    void spawnSingle(sf::Vector2f heroFeet, sf::Vector2f direction,
                     float range, sf::Color color,
                     dof::entities::WeaponType weaponType = dof::entities::WeaponType::Pitchfork,
                     bool isHeroAnchored = true, bool isEnemyAttack = false);
    void spawnSwipe(sf::Vector2f heroFeet, sf::Vector2f direction,
                    float range, float arcDegrees, sf::Color color,
                    dof::entities::WeaponType weaponType = dof::entities::WeaponType::LongSword,
                    bool isHeroAnchored = true, bool isEnemyAttack = false);
    void spawnMultiTarget(sf::Vector2f heroFeet,
                          std::vector<sf::Vector2f> targets,
                          float range, sf::Color color,
                          dof::entities::WeaponType weaponType = dof::entities::WeaponType::Knives,
                          bool isHeroAnchored = true, bool isEnemyAttack = false);
    void spawnMultiSingle(sf::Vector2f heroFeet, sf::Vector2f target,
                          int hitCount, float range, sf::Color color,
                          dof::entities::WeaponType weaponType = dof::entities::WeaponType::Dagger,
                          bool isHeroAnchored = true, bool isEnemyAttack = false);
    void spawnAoe(sf::Vector2f heroFeet, float range, sf::Color color,
                  dof::entities::WeaponType weaponType = dof::entities::WeaponType::Mace,
                  bool isHeroAnchored = true, bool isEnemyAttack = false,
                  sf::Vector2f executionTarget = {0.0f, 0.0f});

    void update(float dt);
    const std::vector<AttackVfxEvent>& events() const;
    void clear();

    float durationFor(dof::entities::AttackType mode) const;

private:
    std::vector<AttackVfxEvent> activeEvents;
    float durationSingle;
    float durationSwipe;
    float durationMultiTarget;
    float durationMultiSingle;
    float durationAoe;
    float enemyDurationMultiplier;
};

}
