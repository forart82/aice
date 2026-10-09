#include "managers/FloorItemManager.hpp"

#include "core/World.hpp"

namespace dof::managers {

void FloorItemManager::update(dof::core::World& world, float dt) {
    for (auto& item : world.floorItems()) {
        item->advance(dt);
    }
}

}
