#include "abilities/Moveable.hpp"

#include "helpers/MathHelper.hpp"

#include <algorithm>

namespace dof::abilities {

void Moveable::beginSimulationStep() {
    previousPosition = position;
}

void Moveable::teleportTo(sf::Vector2f target) {
    position = target;
    previousPosition = target;
    velocity = sf::Vector2f{0.0f, 0.0f};
}

void Moveable::advance(float dt) {
    position.x += velocity.x * dt;
    position.y += velocity.y * dt;
}

void Moveable::setVelocityFromDirection(sf::Vector2f unitDirection) {
    velocity = sf::Vector2f{unitDirection.x * moveSpeed, unitDirection.y * moveSpeed};
}

// Ease `velocity` toward the direction's full-speed target instead of snapping
// to it, so the hero starts and stops with weight. Accelerating and stopping
// get separate rates because they are different sensations: a responsive launch
// wants a fast rate, a heavy glide to rest wants a slower one.
void Moveable::approachVelocityFromDirection(sf::Vector2f unitDirection, float dt) {
    const sf::Vector2f target{unitDirection.x * moveSpeed,
                              unitDirection.y * moveSpeed};
    const bool isStopping = target.x == 0.0f && target.y == 0.0f;
    const float rate = isStopping ? decelerationRate : accelerationRate;
    if (rate <= 0.0f || dt <= 0.0f) {
        velocity = target;
        return;
    }
    velocity = dof::helpers::lerpVector(
        velocity, target, dof::helpers::clampValue(rate * dt, 0.0f, 1.0f));
    // Exponential approach never actually reaches zero, so a stop needs a
    // cutoff or the hero drifts forever at sub-pixel speed and the walk
    // animation never settles. Gated on a ZERO TARGET on purpose: an
    // unconditional epsilon snap would also fire mid-reversal, when velocity
    // legitimately passes through zero on its way from +x to -x, and turning
    // around would stutter.
    if (isStopping && dof::helpers::lengthOf(velocity) <= stopEpsilon) {
        velocity = sf::Vector2f{0.0f, 0.0f};
    }
}

sf::Vector2f Moveable::interpolatedPosition(float alpha) const {
    const float clampedAlpha = std::clamp(alpha, 0.0f, 1.0f);
    return previousPosition + (position - previousPosition) * clampedAlpha;
}

}
