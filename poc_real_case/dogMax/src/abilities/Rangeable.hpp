#pragma once

namespace dof::abilities {

struct Rangeable {
    float range{0.0f};

    bool isWithinRange(float distance) const;
    bool isWithinSquaredRange(float distanceSquared) const;
};

}
