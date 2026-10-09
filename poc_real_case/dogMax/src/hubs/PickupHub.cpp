#include "hubs/PickupHub.hpp"

#include "combat/PowderCalculator.hpp"
#include "core/World.hpp"
#include "entities/FloorItem.hpp"
#include "entities/PowderColor.hpp"
#include "entities/Weapon.hpp"
#include "entities/Dice.hpp"
#include "helpers/MathHelper.hpp"
#include "hubs/InventoryHub.hpp"
#include "hubs/LootFilter.hpp"
#include "hubs/PowderHub.hpp"
#include "loaders/ConfigLoader.hpp"

namespace dof::hubs {

namespace {

// Moves the floor item's payload into the inventory. Both sinks hand back what
// they cannot keep; both pickup paths check `hasSpaceForWeapon`/`hasSpace`
// first, which is exactly those sinks' own precondition, so a hand-back should
// be unreachable. If it ever happens the payload goes back on the floor as a
// fresh floor item rather than dying with this scope.
// CAREFUL: that path pushes into `world.floorItems()` and therefore invalidates
// any reference the caller holds into that vector.
bool absorbInto(dof::core::World& world, InventoryHub& inventory, dof::entities::FloorItem& floorItem) {
    const sf::Vector2f floorPosition = floorItem.position();
    if (floorItem.kind() == dof::entities::FloorItemKind::Weapon) {
        auto weapon = floorItem.releaseWeapon();
        if (!weapon) return false;
        weapon->pickupable().isPickedUp = true;
        auto rejected = inventory.storeAtFirstEmpty(std::move(weapon));
        if (!rejected) return true;
        rejected->pickupable().isPickedUp = false;
        world.floorItems().push_back(std::make_unique<dof::entities::FloorItem>(
            world.allocateId(), floorPosition, std::move(rejected), false));
        return false;
    }
    auto dice = floorItem.releaseDice();
    if (!dice) return false;
    dice->pickupable().isPickedUp = true;
    auto rejected = inventory.storeDiceAtFirstEmpty(std::move(dice));
    if (!rejected) return true;
    rejected->pickupable().isPickedUp = false;
    world.floorItems().push_back(std::make_unique<dof::entities::FloorItem>(
        world.allocateId(), floorPosition, std::move(rejected)));
    return false;
}

// Converts `floorItem` to powder (if hub+config available) and discards it.
// `floorItem` must NOT be in the inventory — it is released directly here.
void filterDestroyFloorItem(dof::entities::FloorItem& floorItem,
                             PowderHub* powderHub,
                             const dof::loaders::ConfigLoader* config) {
    if (powderHub && config) {
        if (floorItem.kind() == dof::entities::FloorItemKind::Weapon) {
            if (auto* w = floorItem.weapon()) {
                const int amount = dof::combat::powderForWeapon(*w, *config);
                const auto color = dof::entities::powderColorForWeapon(w->type());
                powderHub->addPowder(color, amount);
            }
            floorItem.releaseWeapon(); // discard
        } else {
            if (auto* d = floorItem.dice()) {
                const int amount = dof::combat::powderForDice(*d, *config);
                const auto color = dof::entities::powderColorForDice(d->face());
                powderHub->addPowder(color, amount);
            }
            floorItem.releaseDice(); // discard
        }
    } else {
        if (floorItem.kind() == dof::entities::FloorItemKind::Weapon)
            floorItem.releaseWeapon();
        else
            floorItem.releaseDice();
    }
}

} // namespace

PickupResult PickupHub::tryAutoPickup(dof::core::World& world,
                                       InventoryHub& inventory,
                                       PowderHub* powderHub,
                                       const dof::loaders::ConfigLoader* config,
                                       const LootFilter* filter) {
    auto& hero = world.hero();
    if (hero.damageable().isDead()) return {};
    const auto heroPosition = hero.moveable().position;
    const float heroRadius = hero.pickupable().pickupRadius;

    for (auto& floorItem : world.floorItems()) {
        if (floorItem->pickupable().isPickedUp) continue;
        const float distance = dof::helpers::distanceBetween(floorItem->position(), heroPosition);
        if (distance > heroRadius) continue;

        // Filter check runs BEFORE hasSpace so junk is destroyed even
        // when the inventory is full.
        if (filter && filter->matchesFloorItem(*floorItem)) {
            floorItem->markPickedUp();
            filterDestroyFloorItem(*floorItem, powderHub, config);
            const auto pickedId = floorItem->id();
            world.removePickedUpFloorItems();
            return PickupResult{true, pickedId};
        }

        const bool isWeapon = (floorItem->kind() == dof::entities::FloorItemKind::Weapon);
        if (isWeapon ? !inventory.hasSpaceForWeapon() : !inventory.hasSpace()) continue;
        // Read the id BEFORE absorbing: a handed-back payload is pushed back
        // onto the floor, which invalidates `floorItem`.
        const auto pickedId = floorItem->id();
        floorItem->markPickedUp();
        absorbInto(world, inventory, *floorItem);
        world.removePickedUpFloorItems();
        return PickupResult{true, pickedId};
    }
    return {};
}

bool PickupHub::pickupById(dof::core::World& world, InventoryHub& inventory, dof::core::EntityId floorItemId) {
    for (auto& floorItem : world.floorItems()) {
        if (floorItem->id() != floorItemId) continue;
        if (floorItem->pickupable().isPickedUp) return false;
        const bool isWeapon = (floorItem->kind() == dof::entities::FloorItemKind::Weapon);
        if (isWeapon ? !inventory.hasSpaceForWeapon() : !inventory.hasSpace()) return false;
        floorItem->markPickedUp();
        // Nothing off `floorItem` is read after this call — absorbInto may push
        // a refused payload back onto the floor and invalidate it.
        absorbInto(world, inventory, *floorItem);
        world.removePickedUpFloorItems();
        return true;
    }
    return false;
}

}
