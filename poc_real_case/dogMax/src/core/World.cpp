#include "core/World.hpp"

#include <algorithm>

namespace dof::core {

World::World(std::unique_ptr<dof::entities::Hero> hero) : heroPointer(std::move(hero)) {
    if (heroPointer) heroPointer->assignId(allocateId());
}

EntityId World::allocateId() {
    return EntityId{nextId++};
}

dof::entities::Hero& World::hero() { return *heroPointer; }
const dof::entities::Hero& World::hero() const { return *heroPointer; }

std::vector<std::unique_ptr<dof::entities::Enemy>>& World::enemies() { return enemyList; }
const std::vector<std::unique_ptr<dof::entities::Enemy>>& World::enemies() const { return enemyList; }

std::vector<std::unique_ptr<dof::entities::FloorItem>>& World::floorItems() { return floorItemList; }
const std::vector<std::unique_ptr<dof::entities::FloorItem>>& World::floorItems() const { return floorItemList; }

void World::removeDeadEnemies(float deathAnimSeconds) {
    enemyList.erase(
        std::remove_if(enemyList.begin(), enemyList.end(),
                       [deathAnimSeconds](const std::unique_ptr<dof::entities::Enemy>& e) {
                           return e->deathable().isDead && e->deathable().deathTimer >= deathAnimSeconds;
                       }),
        enemyList.end());
}

void World::removePickedUpFloorItems() {
    floorItemList.erase(
        std::remove_if(floorItemList.begin(), floorItemList.end(),
                       [](const std::unique_ptr<dof::entities::FloorItem>& f) {
                           return f->pickupable().isPickedUp;
                       }),
        floorItemList.end());
}

void World::clearTransients() {
    enemyList.clear();
    floorItemList.clear();
}

}
