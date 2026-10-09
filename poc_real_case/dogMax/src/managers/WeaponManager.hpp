#pragma once

#include "combat/AttackModes.hpp"
#include "combat/DronDetector.hpp"
#include "combat/WeaponFiring.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/System/Vector2.hpp>

#include <string>
#include <vector>

namespace dof::core { class World; }
namespace dof::core { class SpatialGrid; }
namespace dof::audio { class SpatialAudio; }
namespace dof::entities { class Enemy; class Weapon; class Dice; enum class AttackType; }
namespace dof::hubs { class WeaponSlotHub; class DamageTextHub; class DronFloatTextHub; class LuckHub; class XpFloatHub; class AttackVfxHub; }
namespace dof::helpers { class DeterministicRandom; using RandomHelper = DeterministicRandom; }
namespace dof::loaders { class ConfigLoader; }

namespace dof::managers { class EnemyManager; }
namespace dof::combat { class HitStop; }
namespace dof::hubs { class EffectBurstHub; }

namespace dof::managers {

class WeaponManager {
public:
    WeaponManager(const dof::loaders::ConfigLoader& config,
                  dof::helpers::RandomHelper& rng,
                  dof::combat::DronDetector& dronDetector,
                  dof::hubs::WeaponSlotHub& weaponSlotHub,
                  dof::hubs::DamageTextHub& damageTextHub,
                  dof::hubs::DronFloatTextHub& dronFloatTextHub,
                  dof::hubs::LuckHub& luckHub,
                  dof::hubs::XpFloatHub& xpFloatHub);

    void update(dof::core::World& world, float dt);
    // Clears per-run counters and kill-streak timing during a full restart.
    void resetRunState();

    int totalFiredShots() const;

    // Spec §Attack §VFX L1551-1559 — optional. When set, every fire
    // queues a per-mode VFX event for the renderer to paint. Default
    // null so headless tests and the existing damage pipeline keep
    // working without the hub (the only place that needs it is the
    // live render frame in `GameSession`).
    void setAttackVfxHub(dof::hubs::AttackVfxHub* hub);
    // Wire the enemy manager so fireRow can intercept weapon hits
    // with a defensive dash roll before applying damage.
    // Impact freeze on hero-deals-damage. Optional: headless and self-test
    // paths never set it and simply get no hit-stop.
    void setHitStop(dof::combat::HitStop* hitStop) { hitStopPtr = hitStop; }
    void setEffectBurstHub(dof::hubs::EffectBurstHub* hub) { effectBurstHubPtr = hub; }
    void setEnemyManager(dof::managers::EnemyManager* mgr);
    void setSpatialAudio(dof::audio::SpatialAudio* audio);

private:
    void tickWeaponRow(dof::core::World& world, int rowIndex, float dt);
    void tickDiceFaceCycle(int rowIndex, float dt);
    void refreshPerFrameCachedConfig();
    // Collect the (non-null) dice slotted into `rowIndex` as raw pointers
    // so the shared `dof::combat` firing helpers can consume the hub row
    // through the same `std::span<Dice*>` interface the enemy path uses.
    std::vector<dof::entities::Dice*> rowDicePointers(int rowIndex);
    void fireRow(dof::core::World& world, int rowIndex);
    std::vector<dof::combat::HitTarget> selectTargetsForWeapon(dof::core::World& world,
                                                               const dof::entities::Weapon& weapon,
                                                               sf::Vector2f& swipeFireDirection) const;
    void applyDamageSharedRoll(dof::core::World& world,
                               const dof::entities::Weapon& weapon,
                               std::vector<dof::combat::HitTarget>& targets,
                               const dof::combat::DiceSlotSnapshot& diceSnapshot,
                               const dof::combat::DronResult& dronResult,
                               float critChance,
                               float critMult,
                               float baseDamageWithBonus);
    void applyDamageMultiTarget(dof::core::World& world,
                                const dof::entities::Weapon& weapon,
                                std::vector<dof::combat::HitTarget>& targets,
                                const dof::combat::DiceSlotSnapshot& diceSnapshot,
                                const dof::combat::DronResult& dronResult,
                                float critChance,
                                float critMult,
                                float baseDamageWithBonus);
    void applyDamageMultiSingle(dof::core::World& world,
                                const dof::entities::Weapon& weapon,
                                std::vector<dof::combat::HitTarget>& targets,
                                const dof::combat::DiceSlotSnapshot& diceSnapshot,
                                const dof::combat::DronResult& dronResult,
                                float critChance,
                                float critMult,
                                float baseDamageWithBonus);
    void spawnAttackVfx(dof::core::World& world,
                        const dof::entities::Weapon& weapon,
                        dof::entities::AttackType mode,
                        sf::Vector2f swipeFireDirection,
                        const std::vector<dof::combat::HitTarget>& targets);
    // card-mpl0eo9k — kill XP with rolling streak multiplier. Called
    // from each `fireRow` branch that kills the target. Reads the
    // base XP from `Levelable::computeKillExperience`, multiplies by
    // the current streak factor, then calls `grantExperience` +
    // `spawnXp` so the on-screen float reflects the boosted amount.
    void grantKillXpWithStreak(dof::core::World& world,
                                const dof::entities::Enemy& enemy);

    const dof::loaders::ConfigLoader& configRef;
    dof::helpers::RandomHelper&  rngRef;
    dof::combat::DronDetector&   dronDetectorRef;
    dof::hubs::WeaponSlotHub&    weaponSlotRef;
    dof::hubs::DamageTextHub&    damageTextRef;
    dof::hubs::DronFloatTextHub& dronFloatTextRef;
    dof::hubs::LuckHub&          luckHubRef;
    dof::hubs::XpFloatHub&       xpFloatRef;
    dof::hubs::AttackVfxHub*     attackVfxHubPtr{nullptr};
    dof::managers::EnemyManager* enemyManagerPtr{nullptr};
    dof::combat::HitStop*        hitStopPtr{nullptr};
    float                        hitStopDealtSeconds{0.0f};
    dof::hubs::EffectBurstHub*   effectBurstHubPtr{nullptr};
    std::string                  burstHitName;
    float                        burstHitRadius{0.0f};
    // Hero accent, read from HERO_OUTLINE_* so bursts caused by the hero are
    // tinted from the same swatch the hero is drawn with.
    sf::Color                    heroAccentColor{sf::Color::White};
    // Attack anticipation (visual_identity.md Step 9). Per-row wind-up
    // remaining, in simulation seconds. Sized on first use from the live row
    // count rather than a hard-coded array, so adding rows needs no change here.
    std::vector<float>           rowWindupRemaining;
    float                        heroWindupSeconds{0.0f};
    dof::audio::SpatialAudio*    spatialAudioPtr{nullptr};
    float                        faceCycleSeconds;
    float                        critChanceCap;
    float                        diceProductFloor;
    float                        damageFloor;
    int                          firedShots{0};
    // card-mpl0eo9k — kill-streak tracking. `simTimeAccumulator`
    // advances by `dt` each `update`; `lastKillSimTime` is set to that
    // accumulator at every kill grant. `currentKillStreak` counts the
    // consecutive kills inside the rolling window — see
    // `combat::computeKillStreakMultiplier` for the pure math.
    double                       simTimeAccumulator{0.0};
    double                       lastKillSimTime{-1.0};
    int                          currentKillStreak{0};
    float                        killStreakWindowSeconds{1.0f};
    float                        killStreakBonusPerKill{0.25f};
    float                        killStreakMaxMult{3.0f};
};

}
