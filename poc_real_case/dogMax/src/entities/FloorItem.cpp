#include "entities/FloorItem.hpp"

namespace dof::entities {

FloorItem::FloorItem(dof::core::EntityId id, sf::Vector2f positionInit, std::unique_ptr<Weapon> weapon, bool isStarter)
    : identity(id),
      floorPosition(positionInit),
      itemKind(FloorItemKind::Weapon),
      isStarterFloor(isStarter),
      accumulatedAge(0.0f),
      heldWeapon(std::move(weapon)) {
    if (heldWeapon) {
        pickupableComponent.pickupRadius = heldWeapon->pickupable().pickupRadius;
    }
}

FloorItem::FloorItem(dof::core::EntityId id, sf::Vector2f positionInit, std::unique_ptr<Dice> dice)
    : identity(id),
      floorPosition(positionInit),
      itemKind(FloorItemKind::Dice),
      isStarterFloor(false),
      accumulatedAge(0.0f),
      heldDice(std::move(dice)) {
    if (heldDice) {
        pickupableComponent.pickupRadius = heldDice->pickupable().pickupRadius;
    }
}

dof::core::EntityId FloorItem::id() const { return identity; }
sf::Vector2f FloorItem::position() const { return floorPosition; }
FloorItemKind FloorItem::kind() const { return itemKind; }
bool FloorItem::isStarter() const { return isStarterFloor; }
float FloorItem::ageSeconds() const { return accumulatedAge; }

void FloorItem::advance(float dt) {
    if (dt > 0.0f) accumulatedAge += dt;
}

void FloorItem::markPickedUp() {
    pickupableComponent.isPickedUp = true;
    if (heldWeapon) heldWeapon->pickupable().isPickedUp = true;
    if (heldDice)   heldDice->pickupable().isPickedUp = true;
}

Weapon*  FloorItem::weapon()       { return heldWeapon.get(); }
const Weapon* FloorItem::weapon() const { return heldWeapon.get(); }
Dice*    FloorItem::dice()         { return heldDice.get(); }
const Dice*   FloorItem::dice()   const { return heldDice.get(); }

std::unique_ptr<Weapon> FloorItem::releaseWeapon() { return std::move(heldWeapon); }
std::unique_ptr<Dice>   FloorItem::releaseDice()   { return std::move(heldDice); }

dof::abilities::Pickupable&       FloorItem::pickupable()       { return pickupableComponent; }
const dof::abilities::Pickupable& FloorItem::pickupable() const { return pickupableComponent; }

}
