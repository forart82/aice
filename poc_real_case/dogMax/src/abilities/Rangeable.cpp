#include "abilities/Rangeable.hpp"

namespace dof::abilities {

bool Rangeable::isWithinRange(float distance) const {
    return distance <= range;
}

bool Rangeable::isWithinSquaredRange(float distanceSquared) const {
    return distanceSquared <= range * range;
}

}
