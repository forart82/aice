#pragma once

namespace dof::abilities {

struct Pickupable {
    float pickupRadius{0.0f};
    bool  isPickedUp{false};

    bool canBePickedAt(float distance) const;
};

}
