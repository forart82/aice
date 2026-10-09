#include "abilities/Dashable.hpp"
#include <algorithm>

namespace dof::abilities {

void Dashable::armDash(sf::Vector2f dir, float speed, float duration,
                        sf::Vector2f origin, float ghostDuration, float ghostInitAlpha) {
    dashDirection        = dir;
    dashSpeed            = speed;
    dashTimeRemaining    = duration;
    isDashing            = true;
    hasDealtContactDamage = false;
    ghostOrigin          = origin;
    ghostTimeRemaining = ghostDuration;
    ghostTotalDuration = ghostDuration;
    ghostInitialAlpha  = ghostInitAlpha;
    ghostAlpha         = ghostInitAlpha;
}

void Dashable::advanceCooldowns(float dt) {
    defensiveCooldown = std::max(0.0f, defensiveCooldown - dt);
    offensiveCooldown = std::max(0.0f, offensiveCooldown - dt);
}

void Dashable::advanceDash(float dt) {
    dashTimeRemaining -= dt;
    if (dashTimeRemaining <= 0.0f) {
        dashTimeRemaining = 0.0f;
        isDashing = false;
    }
}

void Dashable::advanceGhost(float dt) {
    if (ghostTimeRemaining <= 0.0f) return;
    ghostTimeRemaining = std::max(0.0f, ghostTimeRemaining - dt);
    ghostAlpha = (ghostTotalDuration > 0.0f)
        ? ghostInitialAlpha * (ghostTimeRemaining / ghostTotalDuration)
        : 0.0f;
}

bool Dashable::isGhostActive() const {
    return ghostTimeRemaining > 0.0f && ghostAlpha > 0.0f;
}

}  // namespace dof::abilities
