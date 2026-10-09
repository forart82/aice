#pragma once

#include "core/EntityId.hpp"
#include "entities/Enemy.hpp"
#include "entities/FloorItem.hpp"
#include "entities/Hero.hpp"
#include "entities/Weapon.hpp"

#include <memory>
#include <vector>

namespace dof::core {

class World {
public:
    explicit World(std::unique_ptr<dof::entities::Hero> hero);

    EntityId allocateId();

    dof::entities::Hero& hero();
    const dof::entities::Hero& hero() const;

    std::vector<std::unique_ptr<dof::entities::Enemy>>& enemies();
    const std::vector<std::unique_ptr<dof::entities::Enemy>>& enemies() const;

    std::vector<std::unique_ptr<dof::entities::FloorItem>>& floorItems();
    const std::vector<std::unique_ptr<dof::entities::FloorItem>>& floorItems() const;

    void removeDeadEnemies(float deathAnimSeconds);
    void removePickedUpFloorItems();

    // Spec §Hero Death — Run restart wipes every transient world
    // entity. The hero pointer + entity id counter are preserved so
    // ids stay monotonic across the restart (so any in-flight entity
    // references stay valid). Caller is responsible for re-spawning the
    // starter Pitchfork after this call.
    void clearTransients();

private:
    std::unique_ptr<dof::entities::Hero> heroPointer;
    std::vector<std::unique_ptr<dof::entities::Enemy>> enemyList;
    std::vector<std::unique_ptr<dof::entities::FloorItem>> floorItemList;
    std::uint64_t nextId{1};
};

}
