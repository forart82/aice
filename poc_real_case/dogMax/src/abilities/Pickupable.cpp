#include "abilities/Pickupable.hpp"

namespace dof::abilities {

bool Pickupable::canBePickedAt(float distance) const {
    if (isPickedUp) return false;
    return distance <= pickupRadius;
}

}
