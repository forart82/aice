#include "abilities/Deathable.hpp"

namespace dof::abilities {

void Deathable::markDead() {
    isDead = true;
    deathTimer = 0.0f;
}

void Deathable::advance(float dt) {
    if (isDead) deathTimer += dt;
}

}
