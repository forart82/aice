#pragma once

namespace dof::abilities {

struct Countdownable {
    float duration{1.0f};
    float remaining{1.0f};

    void  setDuration(float seconds);
    void  reset();
    void  advance(float dt);
    bool  isFinished() const;
    float progress() const;
};

}
