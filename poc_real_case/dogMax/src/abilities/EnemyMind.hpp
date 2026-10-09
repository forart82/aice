#pragma once
#include <SFML/System/Vector2.hpp>

namespace dof::abilities {

struct EnemyMind {
    // Strafe — circles laterally in the deadzone instead of freezing.
    float strafeTimer{0.0f};
    float strafeSwitchTimer{0.0f};
    float strafeDir{1.0f};
    bool  isStrafing{false};

    // Berserk — speed/attack boost below HP threshold (re-latched each tick).
    bool isBerserk{false};

    // Juke — brief angular detour during chase.
    float        jukeCooldown{0.0f};
    float        jukeTimer{0.0f};
    sf::Vector2f jukePerp{0.0f, 0.0f};
    bool         isJuking{false};

    // Jump — telegraph pause, then fast arc movement to hero position.
    // Duration is computed from distance/speed so enemy always lands on target.
    // isActiveJump is true during the Dashable arc; isJumpLanding during shockwave.
    float        jumpCooldown{0.0f};
    float        jumpTelegraphTimer{0.0f};
    sf::Vector2f jumpTargetPos{0.0f, 0.0f};
    sf::Vector2f jumpStartPos{0.0f, 0.0f};   // origin of arc, for shadow lerp
    bool         isJumpTelegraphing{false};
    bool         isActiveJump{false};         // airborne — Dashable is armed
    float        jumpLandingTimer{0.0f};
    float        jumpLandingTotal{0.25f};
    bool         isJumpLanding{false};        // shockwave ring after landing

    // Generic offensive dash commits before launch. The stored target and
    // geometry are both the movement contract and the renderer's warning data.
    float        offensiveDashTelegraphTimer{0.0f};
    float        offensiveDashTelegraphTotal{0.0f};
    float        offensiveDashReach{0.0f};
    float        offensiveDashContactRadius{0.0f};
    sf::Vector2f offensiveDashTargetPos{0.0f, 0.0f};
    bool         isOffensiveDashTelegraphing{false};

    void advanceTimers(float dt);
};

}  // namespace dof::abilities
