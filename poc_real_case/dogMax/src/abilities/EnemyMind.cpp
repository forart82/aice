#include "abilities/EnemyMind.hpp"
#include <algorithm>

namespace dof::abilities {

void EnemyMind::advanceTimers(float dt) {
    jukeCooldown = std::max(0.0f, jukeCooldown - dt);
    jumpCooldown = std::max(0.0f, jumpCooldown - dt);

    if (isJumpTelegraphing) {
        jumpTelegraphTimer = std::max(0.0f, jumpTelegraphTimer - dt);
    }

    if (isOffensiveDashTelegraphing) {
        offensiveDashTelegraphTimer = std::max(0.0f, offensiveDashTelegraphTimer - dt);
    }

    if (isJumpLanding) {
        jumpLandingTimer = std::max(0.0f, jumpLandingTimer - dt);
        if (jumpLandingTimer <= 0.0f) isJumpLanding = false;
    }

    if (isStrafing) {
        strafeTimer       = std::max(0.0f, strafeTimer - dt);
        strafeSwitchTimer = std::max(0.0f, strafeSwitchTimer - dt);
        if (strafeTimer <= 0.0f) isStrafing = false;
    }

    if (isJuking) {
        jukeTimer = std::max(0.0f, jukeTimer - dt);
        if (jukeTimer <= 0.0f) isJuking = false;
    }
}

}  // namespace dof::abilities
