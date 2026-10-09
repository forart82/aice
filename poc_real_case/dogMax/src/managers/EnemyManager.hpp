#pragma once

#include "combat/EnemyLevelCurve.hpp"
#include "combat/SpecialEnemyGates.hpp"
#include "combat/TierCadence.hpp"
#include "core/EntityId.hpp"
#include "core/SpatialGrid.hpp"
#include "entities/Dice.hpp"
#include "entities/Enemy.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/System/Vector2.hpp>

#include <deque>
#include <memory>
#include <cstddef>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace dof::core { class World; }
namespace dof::core { class WorldEnvironment; }
namespace dof::audio { class SpatialAudio; }
namespace dof::entities { class Hero; }
namespace dof::loaders { class ConfigLoader; }
namespace dof::combat { class HitStop; }
namespace dof::hubs { class EffectBurstHub; }
namespace dof::helpers { class DeterministicRandom; using RandomHelper = DeterministicRandom; }
namespace dof::hubs { class AttackVfxHub; class DamageTextHub; class EvasionHub; class LuckHub; class VitalityTank; class WeaponSlotHub; class XpFloatHub; }
namespace dof::makers { class LootMaker; class WeaponMaker; class DiceMaker; }

namespace dof::managers {

class EnemyManager {
public:
    EnemyManager(const dof::loaders::ConfigLoader& config,
                 dof::helpers::RandomHelper& rng,
                 dof::hubs::DamageTextHub& damageTextHub);

    void update(dof::core::World& world, float dt);

    // Rebuilds the live enemies authored through Ctrl+M from their persistent
    // world-environment definitions. Non-editor enemies are left untouched.
    void synchronizeWorldEditorEnemies(
        dof::core::World& world,
        const dof::core::WorldEnvironment& environment);

    // Spawns an enemy and pushes it straight into world.enemies().
    // Returns void: the pointer is owned by the World immediately, and
    // every caller drives off world.enemies() rather than a return value.
    void spawnAt(dof::core::World& world,
                 sf::Vector2f spawnPosition,
                 int explicitLevel = -1);

    // Console cheat: spawn with explicit level + tier override.
    void spawnAt(dof::core::World& world,
                 sf::Vector2f spawnPosition,
                 int level,
                 dof::entities::QualityTier tier);

    // T-CHEAT-spawn-type-arg — public wrapper around the private
    // `applySpecialEnemyOverride`. The cheat path
    // (`SpawnEnemy=N,KIND`) uses the 4-arg `spawnAt` (which skips the
    // gate predicate) and then needs to stamp the per-kind stat
    // overrides on the freshly-spawned enemy. Production spawns
    // continue to apply overrides through the private hook from
    // inside `spawnAt(world, pos, level)` so this wrapper has no
    // production caller besides the cheat dispatcher.
    void applySpecialKindAfterSpawn(dof::entities::Enemy& enemy);

    int         totalSpawns() const;
    std::string wavePhaseString() const;

    // Injects defense pipeline; if either pointer is null the manager keeps
    // its pre-Phase-13 behaviour and applies damage directly. Tests that
    // build a bare EnemyManager don't need to wire Evasion.
    void setEvasionContext(dof::hubs::EvasionHub& evasionHub, const dof::hubs::WeaponSlotHub& weaponSlotHub);

    // Wires the live loot drop pipeline (Integration Wiring Gaps G1+G2):
    // when an enemy dies the manager rolls a drop via lootMaker using
    // luckHub.qualityFloor() and pushes the resulting FloorItem onto
    // World::floorItems(). If either pointer is null, no drops are
    // produced (tests that need quiet death paths stay unaffected).
    void setLootContext(dof::makers::LootMaker& lootMaker, dof::hubs::LuckHub& luckHub);
    void setVitalityTank(dof::hubs::VitalityTank& vitalityTank);

    // Wires the weapon/dice makers used to roll each enemy's equipment at
    // spawn (the same maker instances the loot pipeline uses, so enemy gear
    // and dropped loot are the same kind of instances). Unwired enemies use
    // the authoritative unarmed charge behavior.
    void setEquipContext(dof::makers::WeaponMaker& weaponMaker,
                         dof::makers::DiceMaker& diceMaker);

    // card-mpo9q5ih — wires the "+N XP" feedback hub so non-weapon kills
    // (the Shocker death-AOE chain) can credit the hero and float the
    // reward at the corpse, matching the weapon-fire grant path. If left
    // unwired, chain kills still grant XP to the hero's Levelable; only
    // the on-screen float is suppressed (tests that don't need feedback).
    void setXpRewardContext(dof::hubs::XpFloatHub& xpFloatHub);
    void setSpatialAudio(dof::audio::SpatialAudio* audio);
    void setAttackVfxHub(dof::hubs::AttackVfxHub* hub) { attackVfxHubPtr = hub; }
    // Impact freeze on hero-takes-damage. Optional, like the pointers above.
    void setHitStop(dof::combat::HitStop* hitStop) { hitStopPtr = hitStop; }
    void setEffectBurstHub(dof::hubs::EffectBurstHub* hub) { effectBurstHubPtr = hub; }

    // Read-only view of the spawn-exclusion FIFO (spec §Spawn
    // Exclusion FIFO). Each entry is the spawn position of a
    // recently-killed enemy. Tests use this to assert the FIFO
    // invariants without poking at private state.
    const std::deque<sf::Vector2f>& spawnExclusions() const;

    // Spec §Hero Death — Run restart wipes the per-run spawn state so the
    // new run begins like a fresh process: spawn counter at zero, wave phase
    // back to Idle, authored-region placement re-armed, alert targets purged.
    // The exclusion FIFO is deliberately NOT emptied — those zones are the
    // session's kill history, not a single run's. Caller is responsible for
    // clearing live enemies on `World`.
    void resetSpawnState();

    // Read-only view of the per-frame spatial grid (spec §Appendix
    // J §Spatial Grid). `update` rebuilds the grid three times: before the
    // AI tick, after it (positions moved), and once more after
    // `World::removeDeadEnemies`. That last rebuild is what callers between
    // updates observe, and it is load-bearing — it guarantees the grid holds
    // no ids of enemies that were just erased, which is the state
    // WeaponManager reads.
    const dof::core::SpatialGrid& spatialGrid() const;

    // Dash system — called by WeaponManager on every hit so the enemy can
    // roll a defensive sidestep before damage lands. Implementation lives
    // in EnemyManager_Dash.cpp.
    bool tryConsumeDefensiveDash(dof::entities::Enemy& enemy, sf::Vector2f heroPos);
    void notifyEnemyHit(dof::entities::Enemy& enemy);

private:
    enum class WavePhase { Idle, ScoutAlive, DiceEquipWait, GroupAlive, Exploration };

    struct AuthoredEncounterDefinition {
        sf::Vector2f centre;
        int count{0};
        int level{1};
        dof::entities::QualityTier tier{dof::entities::QualityTier::Common};
        float spacing{1.0f};
        float activationRadius{1.0f};
        float patrolRadius{1.0f};
    };

    struct AuthoredEnemyState {
        int encounterIndex{0};
        sf::Vector2f homePosition;
        sf::Vector2f defensivePosition;
        float patrolPhase{0.0f};
        bool isActive{false};
        bool hasSeenHero{false};
    };

    void tickWaveSpawning(dof::core::World& world);
    void loadAuthoredEncounterDefinitions();
    void ensureAuthoredRegionEnemies(dof::core::World& world);
    void placeAuthoredEnemy(dof::core::World& world, sf::Vector2f position,
                            int level, dof::entities::QualityTier tier,
                            int encounterIndex);
    bool prepareAuthoredEnemyForAi(dof::core::World& world,
                                   dof::entities::Enemy& enemy, float dt);
    void activateAuthoredEncounter(int encounterIndex);
    void processEnemyDeaths(dof::core::World& world);
    void tickAi(dof::core::World& world, dof::entities::Enemy& enemy, float dt);
    bool tickActiveJumpArc(dof::core::World& world, dof::entities::Enemy& enemy, float dt);
    bool tickActiveDash(dof::core::World& world, dof::entities::Enemy& enemy, float dt);
    bool tickOffensiveDashTelegraph(dof::entities::Enemy& enemy);
    bool tickJumpTelegraph(dof::entities::Enemy& enemy);
    void tickChaseMovement(dof::entities::Enemy& enemy,
                           float dt,
                           float dx,
                           float dy,
                           float distanceSq,
                           float dist);
    void tickAttack(dof::core::World& world,
                    dof::entities::Enemy& enemy,
                    float dt,
                    float distanceSq);
    void tickAlertFallback(dof::entities::Enemy& enemy, float dt);
    void applyDashContactDamage(dof::core::World& world, dof::entities::Enemy& enemy);

    // Armed enemies fire each carried weapon at the hero exactly like the
    // player: the shared dof::combat helpers pace the cooldown (weapon APS,
    // or the slowest dice when dice are slotted), and a charged weapon fires
    // only when the hero is within that weapon's range. Definition lives in
    // EnemyManager_Attack.cpp.
    bool tickArmedAttack(dof::core::World& world, dof::entities::Enemy& enemy,
                         float dt, float distanceToHeroSq);
    // Unarmed enemies attack by charging: a wind-up telegraph (charge bar
    // fills) then a Dashable lunge into the hero for collision damage.
    // Returns true while the enemy is frozen mid wind-up so the caller
    // skips normal movement this tick. Definition in EnemyManager_Attack.cpp.
    bool tickUnarmedCharge(dof::core::World& world, dof::entities::Enemy& enemy,
                           float dt, float distanceToHeroSq);
    // Applies one enemy hit to the hero through the shared defensive path:
    // the hero's evasion/dodge roll, dash i-frames, the floating damage
    // number, and the death mark. Returns true when damage actually landed.
    bool applyEnemyHitToHero(dof::entities::Enemy& enemy, dof::entities::Hero& hero,
                             float damage, bool isCritical, std::string_view attackName);
    float scaledEnemyDamage(float damage) const;

    // card-dash-through — offensive side of the hero dash. While the hero
    // is dashing, every enemy whose body centre falls within
    // `dashThroughRadius` of the hero takes `dashThroughDamageFrac` of its
    // own max health and is shoved `dashThroughKnockback` world units
    // along the dash heading — at most once per dash (gated on the hero's
    // `dashId()` vs the enemy's `lastHeroDashHitId`). Spawns a damage
    // number at the enemy and marks it dead if the hit is lethal. Runs
    // after the AI loop so knockback acts on each enemy's settled
    // position. Definition lives in EnemyManager_HeroDash.cpp.
    void applyHeroDashDamage(dof::core::World& world);

    // Enemy-vs-enemy separation (config `ENEMY_ENEMY_COLLISION_ENABLED`).
    // Run once per frame AFTER the AI tick: any two live, grounded enemies
    // whose centres are within `2 * collisionRadius` are pushed symmetrically
    // apart by half the overlap each so bodies stop merging into one blob.
    // Uses a LOCAL spatial grid rather than the member `grid` because the
    // local one is built from a filtered roster — dead, still-rising and
    // airborne (dashing/jumping) enemies are excluded so their trajectories
    // are not disturbed. Definition in EnemyManager_Collisions.cpp.
    void resolveEnemyCollisions(dof::core::World& world);

    int  computeLevelFromDistance(sf::Vector2f spawnPosition) const;
    dof::entities::QualityTier nextTier(sf::Vector2f spawnPosition);
    dof::entities::SpecialEnemyKind pickSpecialForSpawn(dof::entities::QualityTier tier,
                                                         sf::Vector2f spawnPosition,
                                                         const dof::core::World& world);
    void applySpecialEnemyOverride(dof::entities::Enemy& enemy);

    // Phase 14 — Shocker death AOE (spec L621). Friendly explosion
    // damages every OTHER enemy within `SPECIAL_SHOCKER_DEATH_AOE_RADIUS`
    // for `SHOCKER_DEATH_AOE_HERO_HP_FRACTION × heroMaxHealth` damage.
    // The dying Shocker itself is excluded. Pure helper bound to the
    // manager because it needs the live enemy roster + the hero ref.
    void triggerShockerDeathAOE(dof::core::World& world, const dof::entities::Enemy& shocker);

    // card-mpo9q5ih — credit the hero baseline per-level XP for an enemy
    // finished off by a death-AOE chain (not a direct weapon hit), and
    // float the reward at the corpse when the XP hub is wired.
    void grantChainKillExperience(dof::core::World& world, const dof::entities::Enemy& victim);

    bool         isExcludedSpawn(sf::Vector2f candidate) const;
    bool         hasAnyRequiredDiceSlotted() const;
    void         recordSpawnExclusion(sf::Vector2f spawnPosition);
    void         applyTierAndLevel(dof::entities::Enemy& enemy, int enemyLevel, dof::entities::QualityTier tier);
    // Rolls this enemy's weapon/dice loadout from configs/enemy_combat.yaml
    // (armed probability, weapon-count weights, per-weapon dice count).
    // No-op when the equip context is unwired or the master switch is off.
    // Definition lives in EnemyManager_Loadout.cpp.
    void         rollEnemyLoadout(dof::core::World& world, dof::entities::Enemy& enemy);
    bool         spawnDeathLoot(dof::core::World& world, dof::entities::Enemy& enemy);
    // Opening-loot helper (defined in EnemyManager_Loot.cpp). The Scout drops
    // exactly one configured die and the wave remains gated until it is slotted.
    void         dropOpeningDiceAt(dof::core::World& world, sf::Vector2f position);
    void         rebuildSpatialGrid(dof::core::World& world);
    void         refreshPerFrameCachedConfig();
    void         refreshAlertQueryMovementSlack(const dof::core::World& world, float dt);

    const dof::loaders::ConfigLoader& configRef;
    dof::helpers::RandomHelper&       rngRef;
    dof::hubs::DamageTextHub&         damageTextHubRef;
    dof::hubs::EvasionHub*               evasionHubPtr{nullptr};
    const dof::hubs::WeaponSlotHub*   weaponSlotHubPtr{nullptr};
    dof::makers::LootMaker*           lootMakerPtr{nullptr};
    dof::makers::WeaponMaker*         weaponMakerPtr{nullptr};
    dof::makers::DiceMaker*           diceMakerPtr{nullptr};
    dof::hubs::LuckHub*               luckHubPtr{nullptr};
    dof::hubs::VitalityTank*          vitalityTankPtr{nullptr};
    dof::hubs::XpFloatHub*            xpFloatHubPtr{nullptr};
    dof::audio::SpatialAudio*         spatialAudioPtr{nullptr};
    dof::hubs::AttackVfxHub*          attackVfxHubPtr{nullptr};
    dof::combat::HitStop*             hitStopPtr{nullptr};
    float                             hitStopTakenSeconds{0.0f};
    dof::hubs::EffectBurstHub*        effectBurstHubPtr{nullptr};
    std::string                       burstHurtName;
    float                             burstHurtRadius{0.0f};
    std::string                       burstDeathName;
    float                             burstDeathRadius{0.0f};
    sf::Color                         heroAccentColor{sf::Color::White};
    sf::Color                         enemyTierColors[3]{};
    // Per-tier accent lookup for death bursts, so a burst always carries the
    // colour of the thing that produced it.
    sf::Color tierOutlineColor(dof::entities::QualityTier tier) const;
    int   spawnCounter{0};

    // Wave scenario state (active when weaponSlotHubPtr is wired).
    WavePhase    wavePhase{WavePhase::Idle};
    int          waveGroupSize{3};

    // DiceEquipWait advances only when the opening die is slotted. GroupAlive
    // tracks the exact three spawned IDs so Wave 3 cannot start until every
    // member of that authored group has actually reached zero HP or been
    // removed after its death animation.
    dof::entities::DiceFace waveRequiredDiceFace{dof::entities::DiceFace::D4};
    float        waveRequiredDiceRollDuration{1.2f};
    std::vector<std::uint64_t> openingGroupEnemyIds;
    std::uint64_t openingScoutEnemyId{0u};
    bool isAuthoredRegionPlaced{false};
    std::vector<AuthoredEncounterDefinition> authoredEncounters;
    std::unordered_map<std::uint64_t, AuthoredEnemyState> authoredEnemyStates;
    float authoredPatrolSpeedFraction{0.22f};
    float authoredDefensiveOffset{500.0f};

    float spawnExclusionRadius;
    int   spawnExclusionFifoSize;
    std::deque<sf::Vector2f> spawnExclusionFifo;

    // Phase 14 — Special Enemy substitution layer. Per-tier counters
    // tick on every regular spawn and reset to zero when a special
    // claims the slot (so the next "every Nth" cycle starts from 0).
    dof::combat::SpecialEnemyGateParams specialGates{};
    dof::combat::SpecialEnemyCounters   specialCounters{};

    // Alert / call system. Entry presence means "this enemy has been alerted
    // and should move toward the stored world position." Entries are removed
    // when the alerted enemy arrives within collisionRadius * 2 of the target.
    // Keyed by Enemy::id().value.  Never touches enemies that are already
    // chasing the hero (chase always takes priority).
    std::unordered_map<std::uint64_t, sf::Vector2f> alertTargetMap;

    // Broadcast the caller's world position to every nearby idle enemy
    // (within ENEMY_CALL_RANGE) that is not already in the hero's chase
    // range.  Called every frame while the caller is in chase range — safe
    // because recipients that already have an entry just get it refreshed
    // and enemies that have arrived already had their entry removed.
    void broadcastAlert(const dof::core::World& world,
                        const dof::entities::Enemy& caller);

    // Keeps the targeting anchor synchronized after an enemy moves.
    void commitGroundedMove(dof::entities::Enemy& enemy);

    // Loads the Elite/Special AI aggression multipliers + flank geometry from
    // configs/enemy_ai_tuning.yaml into the members below. Kept out of the ctor
    // body so construction remains focused; defined in EnemyManager_Dash.cpp
    // and called once from the ctor.
    void loadAiTuning(const dof::loaders::ConfigLoader& config);


    float baseHealth;
    float baseSpeed;
    float chaseRange;
    float attackRange;
    float attackFlashDuration;
    float armedAttackWindupSeconds;
    float critChanceCap;
    float diceProductFloor;
    float damageFloor;
    float enemyAttackDamageMult{1.0f};
    float enemyAttackMinDamage{0.0f};
    float collisionRadius;
    bool  isEnemyEnemyCollisionEnabled{true};
    int   enemyCollisionMaxResolveCount{0};
    int   enemyAiMaxUpdatesPerFrame{0};
    std::size_t enemyAiUpdateCursor{0};
    // Elapsed simulation time retained for enemies skipped by the bounded AI
    // scheduler. Keyed by stable entity id and consumed on that enemy's next turn.
    std::unordered_map<std::uint64_t, float> enemyAiDeferredSeconds;
    float deadzoneFactor;
    float healthPerLevel;
    float speedPerLevel;
    // SE1 — piecewise distance-step curve replaces the flat
    // `levelDistanceStep` field. Optional unique_ptr because the
    // curve owns a small allocated table; the manager is constructed
    // once per session so this is one-shot init.
    std::unique_ptr<dof::combat::EnemyLevelCurve> levelCurve;
    // SE2 — distance-quintile tier cadence. Construction is one-shot
    // from config keys; cadenceFor(progress) is a const lookup.
    std::unique_ptr<dof::combat::TierCadence>     tierCadence;
    // card-dash-through — hero dash-through-damage tunables (dodge.yaml).
    float dashThroughRadius;
    float dashThroughDamageFrac;
    float dashThroughKnockback;

    float deathAnimDuration;
    float spawnAnimDuration{0.0f};
    float spawnPortalCloseFraction{0.82f};
    float tierStatMultCommon;
    float tierStatMultUncommon;
    float tierStatMultRare;
    sf::Vector2f heroStart;

    // Dash system — config cached at ctor so per-enemy AI does not pay
    // config-loader hash lookups every frame.
    float dashCooldown{5.0f};
    float dashRangeMin{200.0f};
    float dashRangeMax{600.0f};
    float dashOffensiveChance{0.35f};
    float dashOffensiveSpeed{800.0f};
    float dashOffensiveDuration{0.3f};
    float dashOffensiveWindup{0.3f};
    float dashDefensiveSpeed{600.0f};
    float dashDefensiveDuration{0.25f};
    float dashGhostDuration{0.4f};
    float dashGhostInitialAlpha{180.0f};

    // EnemyMind behaviors — all four cached at ctor.
    float strafeSpeedFrac{0.45f};
    float strafeMinDist{80.0f};
    float strafeMaxDist{220.0f};
    float strafeDuration{1.8f};
    float strafeSwitchInterval{0.9f};
    float berserkHpFrac{0.25f};
    float berserkSpeedMult{1.55f};
    float jukeChance{0.04f};
    float jukeCooldownDuration{2.2f};
    float jukeDuration{0.38f};
    float jukeAngleDeg{55.0f};

    // Jump — telegraph → fast arc movement → lands on hero, shockwave ring.
    float jumpChance{0.28f};
    float jumpCooldown{4.0f};
    float jumpRangeMin{620.0f};
    float jumpRangeMax{1400.0f};
    float jumpTelegraphDuration{0.35f};
    float jumpSpeed{1400.0f};          // px/s; duration = dist/speed so always arrives
    float jumpGhostDuration{0.4f};
    float jumpGhostAlpha{210.0f};
    float jumpLandingDuration{0.30f};  // shockwave ring after landing

    // Dash/jump contact damage.
    float dashContactRadius{110.0f};
    float dashContactDamageFrac{0.05f};
    std::string unarmedChargeAttackName{"Dash Attack"};
    float alertQueryMovementSlack{0.0f};

    // Elite/Special AI aggression scaling + flank geometry
    // (configs/enemy_ai_tuning.yaml). Balance multipliers layered on the
    // baseline jump/dash/juke tunables above; loaded once at ctor via
    // loadAiTuning() (definition in EnemyManager_Dash.cpp).
    // Offensive jump + dash scaling — Special enemies.
    float specialJumpChanceMult;
    float specialJumpCooldownMult;
    float specialDashChanceMult;
    float specialDashCooldownMult;
    // Offensive jump + dash scaling — Rare elites.
    float rareJumpChanceMult;
    float rareJumpCooldownMult;
    float rareDashChanceMult;
    float rareDashCooldownMult;
    // Offensive jump + dash scaling — Uncommon elites.
    float uncommonJumpChanceMult;
    float uncommonJumpCooldownMult;
    float uncommonDashChanceMult;
    float uncommonDashCooldownMult;
    // Roll-failure retry cooldowns (seconds).
    float jumpRetryCooldown;
    float dashRetryCooldown;
    // Juke chance scaling by rank.
    float specialJukeChanceMult;
    float rareJukeChanceMult;
    float uncommonJukeChanceMult;
    // Flank approach geometry.
    float flankMaxDistance;
    float flankMidDistance;
    float flankBlendDivisor;
    float flankMaxAngleDeg;
    // Defensive dash scaling (on-hit sidestep).
    float specialDefensiveDashChanceMult;
    float specialDefensiveDashCooldownMult;
    float rareDefensiveDashChanceMult;
    float rareDefensiveDashCooldownMult;
    float uncommonDefensiveDashChanceMult;
    float uncommonDefensiveDashCooldownMult;

    int          alertBroadcastsThisFrame{0};
    int          alertMaxBroadcastsPerFrame{0};

    // Per-frame neighbour-lookup acceleration structure
    // (spec §Appendix J §Spatial Grid). Owned by the
    // manager because rebuild cadence is tied to the
    // enemy-update tick; passed by const-ref to consumers.
    dof::core::SpatialGrid grid;
    std::unordered_map<std::uint64_t, dof::entities::Enemy*> spatialGridEnemyById;
    std::vector<std::uint64_t> worldEditorEnemyIds;
    const dof::core::WorldEnvironment* worldEditorEnvironmentPtr{nullptr};
    bool areWorldEditorEnemiesSynchronized{false};
};

}
