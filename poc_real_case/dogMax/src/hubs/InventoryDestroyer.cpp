#include "hubs/InventoryDestroyer.hpp"

#include "combat/PowderCalculator.hpp"
#include "entities/Dice.hpp"
#include "entities/PowderColor.hpp"
#include "entities/Weapon.hpp"
#include "hubs/InventoryHub.hpp"
#include "hubs/PowderHub.hpp"
#include "loaders/ConfigLoader.hpp"

namespace dof::hubs {

int destroyItemAtSlot(InventoryHub& inventory,
                      PowderHub& powderHub,
                      int slot,
                      const dof::loaders::ConfigLoader& config) {
    if (slot < 0 || slot >= inventory.slotCount()) return 0;
    // A weapon occupies two vertically adjacent cells; the lower one is a
    // WeaponShadow, whose isWeapon()/isDice() are both false. Without this
    // resolution, destroying a weapon by clicking its lower half fell through
    // every branch and silently did nothing — while the comment below claims
    // this path mirrors the drag-out path, which does resolve.
    slot = inventory.resolvePrimarySlot(slot);
    const auto* item = inventory.peekItem(slot);
    if (!item || item->isEmpty()) return 0;
    if (item->isWeapon()) {
        const int amount = dof::combat::powderForWeapon(*item->weapon, config);
        const auto color  = dof::entities::powderColorForWeapon(item->weapon->type());
        powderHub.addPowder(color, amount);
        // takeItemFrom clears BOTH cells of a 2-cell weapon (primary +
        // shadow), mirroring the drag-out path in handleLeftClick.
        inventory.takeItemFrom(slot);
        return 1;
    }
    if (item->isDice()) {
        const int amount = dof::combat::powderForDice(*item->dice, config);
        const auto color  = dof::entities::powderColorForDice(item->dice->face());
        powderHub.addPowder(color, amount);
        inventory.takeItemFrom(slot);
        return 1;
    }
    return 0;
}

int destroyTierFromInventory(InventoryHub& inventory,
                             PowderHub& powderHub,
                             dof::entities::QualityTier tier,
                             const dof::loaders::ConfigLoader& config) {
    int destroyed = 0;
    for (int i = 0; i < inventory.slotCount(); ++i) {
        const auto* item = inventory.peekItem(i);
        if (!item || item->isEmpty()) continue;
        // Single-item destroy is the core path; tier-destroy is a sweep
        // that delegates to it for every slot whose item matches `tier`.
        if (item->isWeapon() && item->weapon->tier() != tier) continue;
        if (item->isDice()   && item->dice->tier()   != tier) continue;
        if (!item->isWeapon() && !item->isDice()) continue;
        destroyed += destroyItemAtSlot(inventory, powderHub, i, config);
    }
    return destroyed;
}

}
