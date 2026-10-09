#pragma once

namespace dof::core { class World; }

namespace dof::managers {

class FloorItemManager {
public:
    void update(dof::core::World& world, float dt);
};

}
