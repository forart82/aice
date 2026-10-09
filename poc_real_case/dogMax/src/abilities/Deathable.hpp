#pragma once

namespace dof::abilities {

struct Deathable {
    bool  isDead{false};
    float deathTimer{0.0f};

    void markDead();
    void advance(float dt);
};

}
