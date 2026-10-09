#include "entities/Hero.hpp"

#include "entities/Enemy.hpp"
#include "entities/Weapon.hpp"
#include "hubs/WeaponSlotHub.hpp"
#include "loaders/ConfigLoader.hpp"

#include <cmath>

namespace dof::entities {

Hero::Hero(const dof::loaders::ConfigLoader& config) {
    baseMoveSpeed    = config.getFloat("HERO_MOVE_SPEED");
    baseMaxHealth    = config.getFloat("HERO_HEALTH_MAX");
    basePickupRadius = config.getFloat("HERO_PICKUP_RADIUS");
    healthPerLevel   = config.getFloat("HERO_HEALTH_PER_LEVEL");
    damagePerLevel   = config.getFloat("HERO_DAMAGE_PER_LEVEL");
    pickupPerLevel   = config.getFloat("HERO_PICKUP_PER_LEVEL");
    movePerLevel     = config.getFloat("HERO_MOVE_PER_LEVEL");
    (void)damagePerLevel;  // hero damage stat lives on equipped weapons; superseded by the WEAPON_*_PER_LEVEL block below (SA16).

    // SA16 / spec §Weapon Per-Level Multipliers L1857-1864 — Hero caches
    // the per-stat curve so `applyLevelScaling` can forward them to each
    // equipped weapon without the weapon entities needing their own
    // ConfigLoader reference. weapon.yaml is the source of truth.
    weaponDamagePerLevel      = config.getFloat("WEAPON_DAMAGE_PER_LEVEL");
    weaponApsPerLevel         = config.getFloat("WEAPON_APS_PER_LEVEL");
    weaponRangePerLevel       = config.getFloat("WEAPON_RANGE_PER_LEVEL");
    weaponCritChancePerLevel  = config.getFloat("WEAPON_CRIT_CHANCE_PER_LEVEL");
    weaponCritMultPerLevel    = config.getFloat("WEAPON_CRIT_MULT_PER_LEVEL");

    moveableComponent.moveSpeed = baseMoveSpeed;
    // Movement easing (visual_identity.md Step 7). Hero only — enemies leave
    // these at 0, which Moveable treats as "assign instantly", so their attack
    // wind-up and stagger freezes still plant on the exact frame they always did.
    moveableComponent.accelerationRate = config.getFloat("HERO_MOVE_ACCELERATION_RATE");
    moveableComponent.decelerationRate = config.getFloat("HERO_MOVE_DECELERATION_RATE");
    moveableComponent.stopEpsilon      = config.getFloat("HERO_MOVE_STOP_EPSILON");
    moveableComponent.teleportTo({config.getFloat("HERO_START_X"), config.getFloat("HERO_START_Y")});
    damageableComponent.setMaxHealth(baseMaxHealth);
    pickupableComponent.pickupRadius = basePickupRadius;
    levelableComponent.maxLevel = config.getInt("HERO_MAX_LEVEL");
    levelableComponent.loadFromConfig(config);
    targetableComponent.collisionRadius = config.getFloat("HERO_COLLISION_RADIUS");
    targetableComponent.anchorPosition = moveableComponent.position;

    attackFlashInitial   = config.getFloat("HERO_ATTACK_FLASH_INITIAL");
    attackFlashDecayRate = config.getFloat("HERO_ATTACK_FLASH_DECAY_RATE");
    attackFlashValue     = 0.0f;
    incomingHitFlashInitial = config.getFloat("HERO_INCOMING_HIT_FLASH_INITIAL");
    incomingHitFlashDecayRate = config.getFloat("HERO_INCOMING_HIT_FLASH_DECAY_RATE");
    incomingAttackFlashInitial = config.getFloat("HERO_INCOMING_ATTACK_FLASH_INITIAL");
    incomingAttackFlashDecayRate = config.getFloat("HERO_INCOMING_ATTACK_FLASH_DECAY_RATE");
    avoidedAttackFlashInitial = config.getFloat("HERO_AVOIDED_ATTACK_FLASH_INITIAL");
    avoidedAttackFlashDecayRate = config.getFloat("HERO_AVOIDED_ATTACK_FLASH_DECAY_RATE");
    movementAnimationCycleDistance = config.getFloat("VISUAL_SPIKE_HERO_CYCLE_DISTANCE");

    levelUpFlashInitial   = config.getFloat("HERO_LEVEL_UP_FLASH_INITIAL");
    levelUpFlashDecayRate = config.getFloat("HERO_LEVEL_UP_FLASH_DECAY_RATE");
    levelUpFlashValue     = 0.0f;

    // Spec §Evasion Visual L1412 — duration + initial alpha of the
    // ghost-step trailing sprite. Stored on the hero (not the
    // EvasionHub) because the trail also needs the hero's pre-evade
    // position to render at, and the hero owns position state.
    // Direct field writes (not setDuration, which would reload `remaining`
    // from `duration` and start the trail active). Duration comes from
    // config; the trail begins finished/inactive.
    evasionGhost.duration         = config.getFloat("GHOST_TRAIL_TRAIL_DURATION");
    evasionGhostInitialAlphaValue = config.getFloat("GHOST_TRAIL_TRAIL_INITIAL_ALPHA");
    evasionGhost.remaining        = 0.0f;
    evasionGhostOriginValue       = {0.0f, 0.0f};
}

void Hero::notifyAttack() {
    attackFlashValue = attackFlashInitial;
}

void Hero::advanceAttackFlash(float dt) {
    if (attackFlashValue <= 0.0f || dt <= 0.0f) return;
    attackFlashValue -= attackFlashDecayRate * dt;
    if (attackFlashValue < 0.0f) attackFlashValue = 0.0f;
}

float Hero::attackFlash() const { return attackFlashValue; }

void Hero::notifyIncomingHit(float strength) {
    incomingHitFlashValue = incomingHitFlashInitial;
    incomingHitStrengthValue = std::max(incomingHitStrengthValue, strength);
}

void Hero::advanceIncomingHitFlash(float dt) {
    if (incomingHitFlashValue <= 0.0f || dt <= 0.0f) return;
    incomingHitFlashValue = std::max(0.0f, incomingHitFlashValue - incomingHitFlashDecayRate * dt);
    if (incomingHitFlashValue <= 0.0f) incomingHitStrengthValue = 1.0f;
}

float Hero::incomingHitFlash() const { return incomingHitFlashValue; }
float Hero::incomingHitStrength() const { return incomingHitStrengthValue; }

void Hero::notifyIncomingAttack(sf::Vector2f attackerDirection) {
    incomingAttackFlashValue = incomingAttackFlashInitial;
    ++incomingAttackCountValue;
    incomingAttackDirectionSum += attackerDirection;
}

void Hero::advanceIncomingAttackFlash(float dt) {
    if (incomingAttackFlashValue <= 0.0f || dt <= 0.0f) return;
    incomingAttackFlashValue = std::max(
        0.0f, incomingAttackFlashValue - incomingAttackFlashDecayRate * dt);
    if (incomingAttackFlashValue <= 0.0f) {
        incomingAttackCountValue = 0;
        incomingAttackDirectionSum = {0.0f, 0.0f};
    }
}

float Hero::incomingAttackFlash() const { return incomingAttackFlashValue; }
int Hero::incomingAttackCount() const { return incomingAttackCountValue; }

sf::Vector2f Hero::incomingAttackDirection() const {
    const float length = std::sqrt(incomingAttackDirectionSum.x * incomingAttackDirectionSum.x
                                 + incomingAttackDirectionSum.y * incomingAttackDirectionSum.y);
    if (length <= 0.0f) return {0.0f, -1.0f};
    return {incomingAttackDirectionSum.x / length, incomingAttackDirectionSum.y / length};
}

void Hero::notifyAvoidedAttack() { avoidedAttackFlashValue = avoidedAttackFlashInitial; }

void Hero::advanceAvoidedAttackFlash(float dt) {
    if (avoidedAttackFlashValue <= 0.0f || dt <= 0.0f) return;
    avoidedAttackFlashValue = std::max(
        0.0f, avoidedAttackFlashValue - avoidedAttackFlashDecayRate * dt);
}

float Hero::avoidedAttackFlash() const { return avoidedAttackFlashValue; }

void Hero::advanceMovementAnimation(float travelledDistance) {
    if (travelledDistance <= 0.0f || movementAnimationCycleDistance <= 0.0f) return;
    movementAnimationCycleValue += travelledDistance / movementAnimationCycleDistance;
}

float Hero::movementAnimationCycle() const { return movementAnimationCycleValue; }

void Hero::notifyLevelUp() {
    levelUpFlashValue = levelUpFlashInitial;
}

void Hero::advanceLevelUpFlash(float dt) {
    if (levelUpFlashValue <= 0.0f || dt <= 0.0f) return;
    levelUpFlashValue -= levelUpFlashDecayRate * dt;
    if (levelUpFlashValue < 0.0f) levelUpFlashValue = 0.0f;
}

float Hero::levelUpFlash() const { return levelUpFlashValue; }

void Hero::notifyEvasion(sf::Vector2f originPosition) {
    // Capture the hero's pre-evade world position so the renderer can
    // pin the ghost copy at the spot they "stepped from". reset() reloads
    // the remaining timer from the config-driven duration so back-to-back
    // evades during the previous fade window simply restart the fade.
    evasionGhostOriginValue = originPosition;
    evasionGhost.reset();
}

void Hero::advanceEvasionGhost(float dt) {
    evasionGhost.advance(dt);
}

bool         Hero::isEvasionGhostActive()         const { return !evasionGhost.isFinished(); }
sf::Vector2f Hero::evasionGhostOrigin()           const { return evasionGhostOriginValue; }
float        Hero::evasionGhostRemainingSeconds() const { return evasionGhost.remaining; }
float        Hero::evasionGhostDurationSeconds()  const { return evasionGhost.duration; }
float        Hero::evasionGhostInitialAlpha()     const { return evasionGhostInitialAlphaValue; }

void Hero::respawn() {
    levelableComponent.reset();
    // Rescale to level-1 base values (same path as a level-up) so
    // pickup / move / health all return to their starter magnitudes
    // and the hero is healed to full.
    applyLevelScaling(1);
    deathableComponent.isDead = false;
    deathableComponent.deathTimer = 0.0f;
    attackFlashValue   = 0.0f;
    incomingHitFlashValue = 0.0f;
    incomingAttackFlashValue = 0.0f;
    incomingAttackCountValue = 0;
    incomingAttackDirectionSum = {0.0f, 0.0f};
    avoidedAttackFlashValue = 0.0f;
    incomingHitStrengthValue = 1.0f;
    levelUpFlashValue  = 0.0f;
    evasionGhost.remaining = 0.0f;
    evasionGhostOriginValue = {0.0f, 0.0f};
    dashRemainingValue  = 0.0f;
    dashDirectionValue  = {0.0f, 0.0f};
    damageableComponent.clearInvulnerability();
    moveableComponent.velocity = {0.0f, 0.0f};
    targetableComponent.anchorPosition = moveableComponent.position;
    deathRecapValue.reset();
}

void Hero::recordFatalEnemy(const Enemy& enemy, std::string_view attackName, float damage) {
    deathRecapValue = HeroDeathRecap{
        .enemyId = enemy.id(),
        .enemyPosition = enemy.moveable().position,
        .enemyLevel = enemy.level(),
        .enemyTier = enemy.tier(),
        .enemySpecialKind = enemy.specialKind(),
        .attackName = attackName.empty() ? std::string("Unknown Attack") : std::string(attackName),
        .damage = damage,
    };
}

const std::optional<HeroDeathRecap>& Hero::deathRecap() const { return deathRecapValue; }

void Hero::refreshBaseStatsFromConfig(const dof::loaders::ConfigLoader& config) {
    // card-mpmzxm2n — mirror the constructor reads so Ctrl+R can flow
    // console-overridden values into the existing Hero instance.
    // Position + level + HP are not touched here; the caller drives
    // respawn() which re-applies level-1 scaling using these updated
    // bases. Keep this list in lockstep with the Hero(config) ctor.
    baseMoveSpeed    = config.getFloat("HERO_MOVE_SPEED");
    baseMaxHealth    = config.getFloat("HERO_HEALTH_MAX");
    basePickupRadius = config.getFloat("HERO_PICKUP_RADIUS");
    healthPerLevel   = config.getFloat("HERO_HEALTH_PER_LEVEL");
    damagePerLevel   = config.getFloat("HERO_DAMAGE_PER_LEVEL");
    pickupPerLevel   = config.getFloat("HERO_PICKUP_PER_LEVEL");
    movePerLevel     = config.getFloat("HERO_MOVE_PER_LEVEL");
    (void)damagePerLevel;

    weaponDamagePerLevel      = config.getFloat("WEAPON_DAMAGE_PER_LEVEL");
    weaponApsPerLevel         = config.getFloat("WEAPON_APS_PER_LEVEL");
    weaponRangePerLevel       = config.getFloat("WEAPON_RANGE_PER_LEVEL");
    weaponCritChancePerLevel  = config.getFloat("WEAPON_CRIT_CHANCE_PER_LEVEL");
    weaponCritMultPerLevel    = config.getFloat("WEAPON_CRIT_MULT_PER_LEVEL");

    levelableComponent.maxLevel = config.getInt("HERO_MAX_LEVEL");
    levelableComponent.loadFromConfig(config);
    targetableComponent.collisionRadius = config.getFloat("HERO_COLLISION_RADIUS");

    attackFlashInitial   = config.getFloat("HERO_ATTACK_FLASH_INITIAL");
    attackFlashDecayRate = config.getFloat("HERO_ATTACK_FLASH_DECAY_RATE");
    incomingHitFlashInitial = config.getFloat("HERO_INCOMING_HIT_FLASH_INITIAL");
    incomingHitFlashDecayRate = config.getFloat("HERO_INCOMING_HIT_FLASH_DECAY_RATE");
    incomingAttackFlashInitial = config.getFloat("HERO_INCOMING_ATTACK_FLASH_INITIAL");
    incomingAttackFlashDecayRate = config.getFloat("HERO_INCOMING_ATTACK_FLASH_DECAY_RATE");
    avoidedAttackFlashInitial = config.getFloat("HERO_AVOIDED_ATTACK_FLASH_INITIAL");
    avoidedAttackFlashDecayRate = config.getFloat("HERO_AVOIDED_ATTACK_FLASH_DECAY_RATE");
    movementAnimationCycleDistance = config.getFloat("VISUAL_SPIKE_HERO_CYCLE_DISTANCE");
    levelUpFlashInitial   = config.getFloat("HERO_LEVEL_UP_FLASH_INITIAL");
    levelUpFlashDecayRate = config.getFloat("HERO_LEVEL_UP_FLASH_DECAY_RATE");

    // Only `duration` is refreshed here (not `remaining`), so a fade in
    // flight during a Ctrl+R config reload is preserved — direct write,
    // not setDuration which would reload remaining.
    evasionGhost.duration         = config.getFloat("GHOST_TRAIL_TRAIL_DURATION");
    evasionGhostInitialAlphaValue = config.getFloat("GHOST_TRAIL_TRAIL_INITIAL_ALPHA");
}

void Hero::triggerDash(sf::Vector2f direction, float durationSeconds, float speed,
                       float invulnerableSeconds) {
    // card-mpkz662b part 1b — caller pre-clamps a unit direction; we
    // re-normalise defensively so a zero vector cancels the dash
    // attempt cleanly. Speed below zero is treated as 0 so a
    // misconfigured value never sends the hero backwards.
    const float magnitude = std::sqrt(direction.x * direction.x + direction.y * direction.y);
    if (magnitude <= 0.0001f || durationSeconds <= 0.0f) {
        dashRemainingValue = 0.0f;
        dashDirectionValue = {0.0f, 0.0f};
        return;
    }
    dashDirectionValue = {direction.x / magnitude, direction.y / magnitude};
    dashRemainingValue = durationSeconds;
    dashSpeedValue     = speed > 0.0f ? speed : 0.0f;
    // card-dash-through — a new dash window opens; bump the id so the
    // dash-through-damage pass treats every enemy as freshly hittable.
    ++dashIdValue;
    // card-dash-iframes — arm the invulnerability window so the dash is
    // a defensive escape, not just repositioning. `setInvulnerable`
    // takes the max with any active window so chained dashes never
    // shorten the i-frames.
    damageableComponent.setInvulnerable(invulnerableSeconds);
    // card-mpkz9gst — reuse the evasion ghost-trail channel so the
    // dash leaves a fading copy of the hero at the dash start
    // position. Same GHOST_TRAIL_* fade window the evasion path
    // uses, so dash + evasion share one visual language. The
    // "forward animation in the going direction" the card asks for
    // falls out naturally from the hero racing forward while the
    // static ghost lingers behind.
    notifyEvasion(moveableComponent.position);
}

void Hero::advanceDash(float dt) {
    if (dashRemainingValue <= 0.0f || dt <= 0.0f) return;
    dashRemainingValue -= dt;
    if (dashRemainingValue <= 0.0f) {
        dashRemainingValue = 0.0f;
        dashDirectionValue = {0.0f, 0.0f};
    }
}

bool         Hero::isDashing()              const { return dashRemainingValue > 0.0f; }
sf::Vector2f Hero::dashVelocity()           const { return {dashDirectionValue.x * dashSpeedValue,
                                                              dashDirectionValue.y * dashSpeedValue}; }
float        Hero::dashRemainingSeconds()   const { return dashRemainingValue; }
int          Hero::dashId()                 const { return dashIdValue; }

void Hero::attachWeaponSlot(dof::hubs::WeaponSlotHub& hub) {
    // SA28 — store the back-pointer once at GameSession construction.
    // The hub outlives the Hero (both owned by GameSession with the hub
    // declared after the world that owns the Hero, so destruction is
    // bottom-up safe), so the non-owning pointer is stable.
    weaponSlotHubPointer = &hub;
    weaponSlotHubPointer->setHeroLevel(levelableComponent.level);
}

std::vector<dof::entities::Weapon*> Hero::equippedWeapons() const {
    // SA28 / spec §Weaponslot L1652-1653 — read-only snapshot. Empty
    // when the hub was never attached (unit-test paths construct a
    // standalone Hero and never wire a slot context). Rows with no
    // equipped weapon are skipped so consumers iterate only live
    // pointers; this matches the spec phrasing "list of every equipped
    // Weapon" (empty rows are not "equipped").
    std::vector<dof::entities::Weapon*> snapshot;
    if (!weaponSlotHubPointer) return snapshot;
    const int rows = weaponSlotHubPointer->rowCount();
    snapshot.reserve(static_cast<size_t>(rows));
    for (int row = 0; row < rows; ++row) {
        auto* weapon = weaponSlotHubPointer->peek(row);
        if (weapon) snapshot.push_back(weapon);
    }
    return snapshot;
}

int Hero::weaponSlotEpoch() const {
    // P0.4 — forward the attached hub's monotonic mutation epoch so
    // HeroManager can detect an equip / unequip without holding its own
    // hub reference. 0 when unattached (unit-test paths) — matches the
    // hub's initial epoch so a detached hero never spuriously rescales.
    return weaponSlotHubPointer ? weaponSlotHubPointer->epoch() : 0;
}

void Hero::applyLevelScaling(int newLevel) {
    if (newLevel < 1) newLevel = 1;
    if (weaponSlotHubPointer) weaponSlotHubPointer->setHeroLevel(newLevel);
    const float exponent = static_cast<float>(newLevel - 1);
    const float healthFactor = std::pow(healthPerLevel, exponent);
    const float pickupFactor = std::pow(pickupPerLevel, exponent);
    const float moveFactor   = std::pow(movePerLevel,   exponent);

    damageableComponent.setMaxHealth(baseMaxHealth * healthFactor);
    // Spec §Level-Up Effects — heal to full on a level-up. This HP
    // refill is EXCLUSIVE to the level-up path: the equip-time
    // `rescaleEquippedWeapons` deliberately omits it so equipping /
    // unequipping can never be abused as a free full heal (P0.4).
    damageableComponent.health = damageableComponent.maxHealth;
    pickupableComponent.pickupRadius = basePickupRadius * pickupFactor;
    moveableComponent.moveSpeed = baseMoveSpeed * moveFactor;

    // SA16 — every equipped weapon rescales alongside the hero. The
    // walk lives in `rescaleEquippedWeapons` (P0.4) so the equip path
    // reuses the exact same weapon scaling WITHOUT the heal above.
    rescaleEquippedWeapons(newLevel);
}

void Hero::rescaleEquippedWeapons(int level) {
    if (level < 1) level = 1;
    // SA16 / P0.4 — rescale each equipped weapon to `base·mult^(level-1)`
    // using the per-stat curves the Hero cached from weapon.yaml at
    // construction. The mirror (SA28) is empty when no slot hub is
    // attached (unit-test paths), so this becomes a no-op there. The
    // Weapon's own first-call base snapshot keeps repeated rescales
    // (a level-up and an epoch-change in the same frame, or a re-equip)
    // converging on the spec value rather than compounding. NO
    // health / move / pickup change happens here — that omission is the
    // heal-exploit guard: the equip path scales weapons but never heals.
    for (auto* weapon : equippedWeapons()) {
        if (weapon) {
            weapon->applyLevelScaling(level,
                                       weaponDamagePerLevel,
                                       weaponApsPerLevel,
                                       weaponRangePerLevel,
                                       weaponCritChancePerLevel,
                                       weaponCritMultPerLevel);
        }
    }
}

dof::core::EntityId Hero::id() const { return identity; }
void Hero::assignId(dof::core::EntityId newId) { identity = newId; targetableComponent.id = newId; }

dof::abilities::Moveable&   Hero::moveable()    { return moveableComponent; }
dof::abilities::Inputable&  Hero::inputable()   { return inputableComponent; }
dof::abilities::Aimable&    Hero::aimable()     { return aimableComponent; }
dof::abilities::Damageable& Hero::damageable()  { return damageableComponent; }
dof::abilities::Deathable&  Hero::deathable()   { return deathableComponent; }
dof::abilities::Levelable&  Hero::levelable()   { return levelableComponent; }
dof::abilities::Pickupable& Hero::pickupable()  { return pickupableComponent; }
dof::abilities::Targetable& Hero::targetable()  { return targetableComponent; }

const dof::abilities::Moveable&   Hero::moveable()    const { return moveableComponent; }
const dof::abilities::Inputable&  Hero::inputable()   const { return inputableComponent; }
const dof::abilities::Aimable&    Hero::aimable()     const { return aimableComponent; }
const dof::abilities::Damageable& Hero::damageable()  const { return damageableComponent; }
const dof::abilities::Deathable&  Hero::deathable()   const { return deathableComponent; }
const dof::abilities::Levelable&  Hero::levelable()   const { return levelableComponent; }
const dof::abilities::Pickupable& Hero::pickupable()  const { return pickupableComponent; }
const dof::abilities::Targetable& Hero::targetable()  const { return targetableComponent; }

}
