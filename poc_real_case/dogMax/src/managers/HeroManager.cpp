#include "managers/HeroManager.hpp"

#include "entities/Hero.hpp"

#include <cmath>

namespace dof::managers {

void HeroManager::update(dof::entities::Hero& hero, float dt) {
    levelUpEventPending = false;
    // Spec §Level System: stats rescale every time the hero levels up.
    // Polling the Levelable level here keeps the side-effect single-
    // sourced inside the manager without coupling Levelable to a
    // callback registry. SA16 — `Hero::applyLevelScaling` also walks
    // the equipped-weapon mirror (SA28) and rescales each weapon, so a
    // weapon-side level-up curve falls out of the same hero-level poll.
    const int currentLevel = hero.levelable().level;
    if (currentLevel != lastAppliedLevel) {
        const bool isRunLevelUp = lastAppliedLevel > 0 && currentLevel > lastAppliedLevel;
        hero.applyLevelScaling(currentLevel);
        // Spec §Level-Up Effects: fire the 0.5 s outline pulse on every
        // level-up. The very first call when the hero is constructed
        // also passes through (level moves from 0 → 1), so the pulse
        // briefly plays on world entry; that is the intended seed.
        // A level DOWN must stay silent: `Hero::respawn` resets Levelable
        // to 1 while this manager keeps the pre-death `lastAppliedLevel`,
        // so without the gate the full level-up pulse fired on every death.
        if (isRunLevelUp || lastAppliedLevel == 0) hero.notifyLevelUp();
        lastAppliedLevel = currentLevel;
        if (isRunLevelUp) levelUpEventPending = true;
    }

    // P0.4 — equip-time weapon scaling. The level gate above only fires
    // on a hero level CHANGE, so a weapon equipped BETWEEN level-ups —
    // and, critically, any weapon equipped AT the level cap where no
    // next level-up ever comes — would otherwise stay at raw drop-base
    // forever, silently voiding every late-game loot upgrade. The
    // WeaponSlotHub bumps its epoch on every equip / unequip; when it
    // changes, rescale the equipped weapons to the current hero level.
    // `rescaleEquippedWeapons` performs NO heal (unlike applyLevelScaling)
    // so this can never be abused as a free full heal, and
    // `Weapon::applyLevelScaling` is idempotent, so overlapping with the
    // level gate in the same frame is safe.
    const int currentSlotEpoch = hero.weaponSlotEpoch();
    if (currentSlotEpoch != lastSlotEpoch) {
        hero.rescaleEquippedWeapons(currentLevel);
        lastSlotEpoch = currentSlotEpoch;
    }

    // Spec §Appendix J §Hero Attack Flash: decay the per-hit pulse so
    // the shader `u_attacking` uniform falls back to zero ~0.25 s
    // after the last landed hit. Runs every frame regardless of hero
    // alive/dead state — a dying hero still shows the trailing pulse
    // from the killing blow.
    hero.advanceAttackFlash(dt);
    hero.advanceIncomingHitFlash(dt);
    hero.advanceIncomingAttackFlash(dt);
    hero.advanceAvoidedAttackFlash(dt);
    // Spec §Level-Up Effects: same pattern for the level-up outline
    // pulse (separate channel so the two effects can stack).
    hero.advanceLevelUpFlash(dt);
    // Spec §Evasion Visual L1412: tick the ghost-step trail so the
    // trailing sprite fades out over its configured duration. The
    // renderer reads `isEvasionGhostActive` + `evasionGhostRemainingSeconds`
    // each frame to compute the ghost alpha; without this advance the
    // trail would latch on forever after the first evade.
    hero.advanceEvasionGhost(dt);
    // card-mpkz662b part 1b — tick the dash timer. While `isDashing()`
    // is true the dash overrides the regular WASD velocity below so
    // the hero shoots forward for the configured duration.
    hero.advanceDash(dt);
    // card-dash-iframes — decay the dash invulnerability window. Runs
    // every frame regardless of dash state (a no-op when the window is
    // already empty) so the i-frames granted by `triggerDash` expire on
    // schedule rather than latching forever.
    hero.damageable().advanceInvulnerability(dt);

    if (hero.damageable().isDead()) {
        hero.deathable().advance(dt);
        hero.moveable().velocity = {0.0f, 0.0f};
        return;
    }
    if (hero.isDashing()) {
        // Dash velocity overrides input — the player can't steer
        // mid-dash. Position still advances via `moveable().advance`.
        hero.moveable().velocity = hero.dashVelocity();
    } else {
        auto direction = hero.inputable().resolveDirection();
        // Eased rather than snapped so the hero has weight (Step 7). Aim below
        // still reads the raw input direction, not the eased velocity — aim must
        // never lag behind the stick.
        hero.moveable().approachVelocityFromDirection(direction, dt);
        if (direction.x != 0.0f || direction.y != 0.0f) {
            hero.aimable().aimAlong(direction);
        }
    }
    const auto velocity = hero.moveable().velocity;
    if (velocity.x != 0.0f || velocity.y != 0.0f) {
        hero.advanceMovementAnimation(
            std::sqrt(velocity.x * velocity.x + velocity.y * velocity.y) * dt);
    }
    hero.moveable().advance(dt);
    hero.targetable().anchorPosition = hero.moveable().position;

}

bool HeroManager::consumeLevelUpEvent() {
    const bool wasPending = levelUpEventPending;
    levelUpEventPending = false;
    return wasPending;
}

}
