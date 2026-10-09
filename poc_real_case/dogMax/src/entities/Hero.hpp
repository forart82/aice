#pragma once

#include "abilities/Aimable.hpp"
#include "abilities/Countdownable.hpp"
#include "abilities/Damageable.hpp"
#include "abilities/Deathable.hpp"
#include "abilities/Inputable.hpp"
#include "abilities/Levelable.hpp"
#include "abilities/Moveable.hpp"
#include "abilities/Pickupable.hpp"
#include "abilities/Targetable.hpp"
#include "core/EntityId.hpp"
#include "entities/QualityTier.hpp"
#include "entities/SpecialEnemyKind.hpp"

#include <SFML/System/Vector2.hpp>

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace dof::loaders {
class ConfigLoader;
}

namespace dof::hubs {
class WeaponSlotHub;
}

namespace dof::entities {

class Weapon;
class Enemy;

struct HeroDeathRecap {
    dof::core::EntityId enemyId{};
    sf::Vector2f enemyPosition{};
    int enemyLevel{1};
    QualityTier enemyTier{QualityTier::Common};
    SpecialEnemyKind enemySpecialKind{SpecialEnemyKind::None};
    std::string attackName;
    float damage{0.0f};
};

class Hero {
public:
    explicit Hero(const dof::loaders::ConfigLoader& config);

    dof::core::EntityId      id() const;
    void                     assignId(dof::core::EntityId newId);

    // Spec §Level System: rescale every base stat through
    // multiplier^(newLevel-1). Heals to full max HP on level-up
    // (spec §Level-Up Effects). Stores base values from the first
    // call so repeated calls converge on the exact spec value
    // rather than drifting from compounding. Delegates the
    // equipped-weapon walk to `rescaleEquippedWeapons` so the heal
    // lives only on this level-up path.
    void applyLevelScaling(int newLevel);

    // P0.4 — rescale every EQUIPPED weapon to `level` WITHOUT touching
    // hero HP / move / pickup. This is the equip-time scaling path:
    // `applyLevelScaling` only fires on a hero level CHANGE, so a
    // weapon equipped between level-ups (or AT the level cap, where no
    // next level-up ever comes) would otherwise stay at raw drop-base
    // forever. Calling this on every WeaponSlotHub epoch change scales
    // fresh drops to the current hero level immediately. It deliberately
    // performs NO health change: healing here would create an
    // equip/unequip full-heal exploit, so the HP refill stays exclusive
    // to `applyLevelScaling`. `Weapon::applyLevelScaling` is idempotent
    // (first-call base snapshot), so running this alongside the level-up
    // walk in the same frame converges on the same `base·mult^(level-1)`.
    void rescaleEquippedWeapons(int level);

    // Spec §Appendix J §Hero Attack Flash. `notifyAttack` is called
    // once per landed weapon hit (independent of the weapon
    // sprite's own attackFlash pulse) and sets `attackFlash` to
    // `HERO_ATTACK_FLASH_INITIAL`. `advanceAttackFlash` decays the
    // value toward zero at `HERO_ATTACK_FLASH_DECAY_RATE * dt` per
    // frame so a single hit produces a ~0.25 s pulse with the
    // default 1.0 / 4.0 config values. The shader-side
    // `u_attacking` uniform reads `attackFlash()` directly.
    void  notifyAttack();
    void  advanceAttackFlash(float dt);
    float attackFlash() const;

    void  notifyIncomingHit(float strength = 1.0f);
    void  advanceIncomingHitFlash(float dt);
    float incomingHitFlash() const;
    float incomingHitStrength() const;
    void  notifyIncomingAttack(sf::Vector2f attackerDirection);
    void  advanceIncomingAttackFlash(float dt);
    float incomingAttackFlash() const;
    int   incomingAttackCount() const;
    sf::Vector2f incomingAttackDirection() const;
    void  notifyAvoidedAttack();
    void  advanceAvoidedAttackFlash(float dt);
    float avoidedAttackFlash() const;

    // Movement sprite phase measured in complete walk cycles. Advancing by
    // travelled distance rather than wall time keeps foot cadence locked to
    // ground speed across normal movement, dash, and level scaling.
    void  advanceMovementAnimation(float travelledDistance);
    float movementAnimationCycle() const;

    // Spec §Level-Up Effects: every level increment triggers a 0.5 s
    // outline pulse on the hero body. Independent channel from
    // `attackFlash` so the two effects can stack visually without
    // resetting each other. SFX hookup stays a future polish slice;
    // the value + decay schedule are what the renderer / audio
    // pipeline will consume when they land.
    void  notifyLevelUp();
    void  advanceLevelUpFlash(float dt);
    float levelUpFlash() const;

    // Spec §Evasion Visual L1412 — when the hero evades, a short trailing
    // copy of the hero sprite renders behind, fading over
    // `GHOST_TRAIL_TRAIL_DURATION` seconds. Hero owns the trail state
    // (origin position the ghost copy is anchored to + remaining time
    // until the trail disappears) so the renderer can pull both from
    // the same source. `notifyEvasion` captures the hero's pre-evade
    // position so the ghost reads as the spot they "stepped from"
    // even after the hero moves; `advanceEvasionGhost` decays the
    // remaining timer at 1.0 s/s real time.
    void         notifyEvasion(sf::Vector2f originPosition);
    void         advanceEvasionGhost(float dt);
    bool         isEvasionGhostActive() const;
    sf::Vector2f evasionGhostOrigin() const;
    float        evasionGhostRemainingSeconds() const;
    float        evasionGhostDurationSeconds() const;
    float        evasionGhostInitialAlpha() const;

    // Spec §Hero Death — restart helper. Restores level-1 base stats,
    // refills HP to max, clears death state + flash channels, and
    // re-anchors targetable. Position teleport is left to the caller
    // because GameSession owns the spawn coordinates from config.
    void  respawn();

    void recordFatalEnemy(const Enemy& enemy, std::string_view attackName, float damage);
    const std::optional<HeroDeathRecap>& deathRecap() const;

    // card-mpmzxm2n — re-read every cached scalar from the live
    // ConfigLoader so console-set overrides flow into the hero on
    // restart. Hero caches `baseMoveSpeed` / `baseMaxHealth` / etc at
    // construction; `Ctrl+R` calls `loadDirectoryPreservingOverrides`
    // which updates the loader but cannot reach into Hero's
    // member-cached values. GameSession::restartRun invokes this
    // method before respawn so `applyLevelScaling(1)` rebuilds the
    // hero from the overridden values.
    void  refreshBaseStatsFromConfig(const dof::loaders::ConfigLoader& config);

    // card-mpkz662b part 1b — new active Doge (Space-key dash). When
    // armed, the moveable velocity is overridden by `dashDirection *
    // dashSpeed` so the hero shoots forward for `dashRemaining`
    // seconds. `triggerDash` re-anchors the dash from the input
    // direction; `advanceDash` decays the timer + clears the override
    // when it elapses. `isDashing` is read by HeroManager so it
    // bypasses the regular WASD-driven velocity during the dash
    // window (the dash should feel instant + uncancellable).
    void          triggerDash(sf::Vector2f direction, float durationSeconds, float speed,
                              float invulnerableSeconds = 0.0f);
    void          advanceDash(float dt);
    bool          isDashing() const;
    sf::Vector2f  dashVelocity() const;
    float         dashRemainingSeconds() const;

    // card-dash-through — every `triggerDash` mints a fresh dash id.
    // The dash-through-damage pass stamps each enemy it hits with the
    // current id so a single dash damages each enemy at most once
    // (the enemy is re-hittable on the NEXT dash). Starts at 0; the
    // first dash is id 1, so an enemy's default `lastHeroDashHitId` of
    // 0 never collides with a live dash.
    int           dashId() const;

    // SA28 / spec §Weaponslot L1652-1653 — "the Hero carries a parallel
    // mirror list of every equipped Weapon". The mirror is read-only:
    // the WeaponSlotHub stays the source of truth, and the Hero merely
    // exposes a snapshot for consumers that own a Hero reference but
    // not a hub reference (e.g. HeroManager's level-up rescale pass).
    //
    // `attachWeaponSlot` is called once at GameSession construction
    // because the Hero is allocated before the hub exists; the Hero
    // holds a non-owning pointer (never null after attach).
    //
    // `equippedWeapons` returns a freshly built `std::vector` every
    // call rather than caching, because the slot hub mutates outside
    // the Hero's view (loot picks, drag-and-drop equip/unequip). A
    // snapshot is one pointer per row — cheap enough for the rare
    // consumers that need it. Returns an empty vector when the hub
    // is not attached (unit-test paths construct Hero standalone).
    void                                  attachWeaponSlot(dof::hubs::WeaponSlotHub& hub);
    std::vector<dof::entities::Weapon*>   equippedWeapons() const;

    // P0.4 — bridge the attached slot hub's mutation epoch so consumers
    // that own a Hero reference (HeroManager) can detect equip / unequip
    // without their own hub reference. Returns 0 when no hub is attached
    // (unit-test paths construct Hero standalone), matching the hub's own
    // initial epoch so a detached hero never triggers a rescale.
    int                                   weaponSlotEpoch() const;

    dof::abilities::Moveable&   moveable();
    dof::abilities::Inputable&  inputable();
    dof::abilities::Aimable&    aimable();
    dof::abilities::Damageable& damageable();
    dof::abilities::Deathable&  deathable();
    dof::abilities::Levelable&  levelable();
    dof::abilities::Pickupable& pickupable();
    dof::abilities::Targetable& targetable();

    const dof::abilities::Moveable&   moveable() const;
    const dof::abilities::Inputable&  inputable() const;
    const dof::abilities::Aimable&    aimable() const;
    const dof::abilities::Damageable& damageable() const;
    const dof::abilities::Deathable&  deathable() const;
    const dof::abilities::Levelable&  levelable() const;
    const dof::abilities::Pickupable& pickupable() const;
    const dof::abilities::Targetable& targetable() const;

private:
    dof::core::EntityId          identity{0};
    dof::abilities::Moveable     moveableComponent;
    dof::abilities::Inputable    inputableComponent;
    dof::abilities::Aimable      aimableComponent;
    dof::abilities::Damageable   damageableComponent;
    dof::abilities::Deathable    deathableComponent;
    dof::abilities::Levelable    levelableComponent;
    dof::abilities::Pickupable   pickupableComponent;
    dof::abilities::Targetable   targetableComponent;
    std::optional<HeroDeathRecap> deathRecapValue;

    float baseMaxHealth{0.0f};
    float baseMoveSpeed{0.0f};
    float basePickupRadius{0.0f};
    float healthPerLevel{1.0f};
    float damagePerLevel{1.0f};
    float pickupPerLevel{1.0f};
    float movePerLevel{1.0f};

    // SA16 — per-stat weapon-side level multipliers loaded once from
    // weapon.yaml at construction time. Read by `applyLevelScaling`
    // when it iterates the equipped-weapon mirror so each weapon
    // rescales against the same spec curve as the hero stats above.
    float weaponDamagePerLevel{1.0f};
    float weaponApsPerLevel{1.0f};
    float weaponRangePerLevel{1.0f};
    float weaponCritChancePerLevel{1.0f};
    float weaponCritMultPerLevel{1.0f};

    float attackFlashValue{0.0f};
    float attackFlashInitial{1.0f};
    float attackFlashDecayRate{4.0f};
    float incomingHitFlashValue{0.0f};
    float incomingHitFlashInitial{1.0f};
    float incomingHitFlashDecayRate{6.0f};
    float incomingHitStrengthValue{1.0f};
    float incomingAttackFlashValue{0.0f};
    float incomingAttackFlashInitial{1.0f};
    float incomingAttackFlashDecayRate{7.0f};
    int incomingAttackCountValue{0};
    sf::Vector2f incomingAttackDirectionSum{0.0f, 0.0f};
    float avoidedAttackFlashValue{0.0f};
    float avoidedAttackFlashInitial{1.0f};
    float avoidedAttackFlashDecayRate{7.0f};

    float movementAnimationCycleValue{0.0f};
    float movementAnimationCycleDistance;

    float levelUpFlashValue{0.0f};
    float levelUpFlashInitial{1.0f};
    float levelUpFlashDecayRate{2.0f};

    sf::Vector2f                  evasionGhostOriginValue{0.0f, 0.0f};
    // Ghost-trail countdown (duration + remaining) via the shared
    // Countdownable decrement-and-floor logic. Explicitly initialised to a
    // finished (0/0) state — Countdownable's own defaults are a live 1s
    // window — so the trail starts inactive until the ctor reads the
    // GHOST_TRAIL_TRAIL_DURATION config into `evasionGhost.duration`.
    dof::abilities::Countdownable evasionGhost{0.0f, 0.0f};
    float                         evasionGhostInitialAlphaValue{0.0f};

    // card-mpkz662b part 1b — see triggerDash / advanceDash above.
    sf::Vector2f dashDirectionValue{0.0f, 0.0f};
    float        dashRemainingValue{0.0f};
    float        dashSpeedValue{0.0f};

    // card-dash-through — monotonic dash counter; see dashId() above.
    int          dashIdValue{0};

    // SA28 — non-owning back-pointer to the slot hub. Lifetime is owned
    // by GameSession which guarantees the hub outlives the Hero.
    dof::hubs::WeaponSlotHub* weaponSlotHubPointer{nullptr};
};

}
