#include "render/InteractionController.hpp"

#include "core/World.hpp"
#include "entities/FloorItem.hpp"
#include "hubs/InventoryHub.hpp"
#include "hubs/WeaponSlotHub.hpp"

// Programmatic item-transfer operations for InteractionController. These are
// the mouse-independent inventory/weapon/dice movement primitives invoked by
// the right-click handlers; the
// pointer hit-testing, hover, and drag-drop surface lives in
// InteractionController.cpp. Both translation units define methods of the
// same class, so calls between the two resolve at link time.

namespace dof::render {

bool InteractionController::autoEquipInventorySlot(int slotIndex) {
    // `peekItem` is null for an out-of-range slot and empty for a free one,
    // so the isWeapon() test alone answers "is there a weapon here".
    auto* item = inventoryRef.peekItem(slotIndex);
    if (!item || !item->isWeapon()) return false;
    auto weapon = inventoryRef.takeFrom(slotIndex);
    if (!weapon) return false;
    auto rejected = weaponSlotRef.equipFirstEmpty(std::move(weapon));
    if (!rejected) return true;
    // No unlocked empty row. The hub hands the weapon back rather than
    // destroying it, so the firstEmptyRow() pre-check that used to prove a
    // destination in advance is gone: the weapon simply returns to the pair
    // `takeFrom` just vacated and the right-click is a no-op.
    if (auto stillRejected = inventoryRef.storeAt(slotIndex, std::move(rejected)))
        storeOrDropItem(dof::hubs::InventoryItem::makeWeapon(std::move(stillRejected)));
    return false;
}

bool InteractionController::autoUnequipWeaponRow(int rowIndex) {
    if (weaponSlotRef.isRowEmpty(rowIndex)) return false;
    // Destination guard, kept: without room in the grid the weapon stays
    // equipped. Letting it bounce back instead would re-enter the row through
    // equipAt, which re-packs the row's dice from cell 0 and would silently
    // close any gap between them.
    if (!inventoryRef.hasSpaceForWeapon()) return false;
    // card-mpkwji9p — `unequipFrom` migrates the row's dice into the
    // weapon entity, so the inventory only ever needs room for the
    // weapon itself; the dice ride along inside the weapon.
    auto weapon = weaponSlotRef.unequipFrom(rowIndex);
    if (!weapon) return false;
    auto rejected = inventoryRef.storeAtFirstEmpty(std::move(weapon));
    if (!rejected) return true;
    if (auto stillRejected = weaponSlotRef.equipAt(rowIndex, std::move(rejected)))
        storeOrDropItem(dof::hubs::InventoryItem::makeWeapon(std::move(stillRejected)));
    return false;
}

bool InteractionController::autoUnslotDiceCell(int rowIndex, int cellIndex) {
    // Presence, not vacancy — `isDiceCellEmpty` is now false for inert and
    // locked cells too, so only `peekDice` still means "there is a die here".
    if (weaponSlotRef.peekDice(rowIndex, cellIndex) == nullptr) return false;
    // Destination guard, kept: with no free grid cell the die stays slotted.
    if (!inventoryRef.hasSpace()) return false;
    auto dice = weaponSlotRef.unslotDice(rowIndex, cellIndex);
    if (!dice) return false;
    auto rejected = inventoryRef.storeDiceAtFirstEmpty(std::move(dice));
    if (!rejected) return true;
    if (auto stillRejected = weaponSlotRef.slotDiceAt(rowIndex, cellIndex, std::move(rejected)))
        storeOrDropItem(dof::hubs::InventoryItem::makeDice(std::move(stillRejected)));
    return false;
}

bool InteractionController::autoSlotDiceFromInventory(int slotIndex) {
    auto* item = inventoryRef.peekItem(slotIndex);
    if (!item || !item->isDice()) return false;
    auto dice = inventoryRef.takeDiceFrom(slotIndex);
    if (!dice) return false;
    auto rejected = weaponSlotRef.slotDiceAtFirstEmptyAnyRow(std::move(dice));
    if (!rejected) return true;
    // B-UX-2 — every equipped row's dice cells are full, or nothing is
    // equipped at all. The hub hands the die back, so the die returns to the
    // slot `takeDiceFrom` just vacated and the right-click stays the true
    // no-op B-UX-2 asks for. The hasAnyEmptyDiceCellOnEquippedRow() probe that
    // used to prove a destination in advance existed only because a rejected
    // call destroyed the die; it is deleted with this guard.
    if (auto stillRejected = inventoryRef.storeDiceAt(slotIndex, std::move(rejected)))
        storeOrDropItem(dof::hubs::InventoryItem::makeDice(std::move(stillRejected)));
    return false;
}

bool InteractionController::moveBetweenInventorySlots(int fromSlot, int toSlot) {
    if (fromSlot == toSlot) return false;
    if (inventoryRef.isSlotEmpty(fromSlot)) return false;
    // Unified grid — any item moves to any slot. Reject only an invalid
    // destination index; the pre-check keeps the move atomic so we never
    // half-consume the source slot.
    if (!inventoryRef.isValidIndex(toSlot)) return false;
    auto payload = inventoryRef.takeItemFrom(fromSlot);
    if (payload.isEmpty()) return false;
    // A weapon that does not fit a 2-cell pair at the destination is handed
    // back instead of destroyed, so it no longer has to be pre-checked before
    // the item is offered — the hand-back goes to the first pair that fits.
    if (inventoryRef.isSlotEmpty(toSlot)) {
        payload = inventoryRef.storeAt(toSlot, std::move(payload));
        if (!payload.isEmpty()) storeOrDropItem(std::move(payload));
        return true;
    }
    // Destination occupied — swap the two items.
    auto evicted = inventoryRef.takeItemFrom(toSlot);
    payload = inventoryRef.storeAt(toSlot, std::move(payload));
    if (!payload.isEmpty()) storeOrDropItem(std::move(payload));
    evicted = inventoryRef.storeAt(fromSlot, std::move(evicted));
    if (!evicted.isEmpty()) storeOrDropItem(std::move(evicted));
    return true;
}

bool InteractionController::moveInventoryToWeaponRow(int fromSlot, int toRow) {
    if (!weaponSlotRef.isRowUnlocked(toRow)) return false;
    if (inventoryRef.isSlotEmpty(fromSlot)) return false;
    auto* item = inventoryRef.peekItem(fromSlot);
    if (!item || !item->isWeapon()) return false;
    auto weapon = inventoryRef.takeFrom(fromSlot);
    if (!weapon) return false;
    if (weaponSlotRef.isRowEmpty(toRow)) {
        auto rejected = weaponSlotRef.equipAt(toRow, std::move(weapon));
        if (!rejected) return true;
        // Row refused it — back into the pair `takeFrom` just vacated.
        if (auto stillRejected = inventoryRef.storeAt(fromSlot, std::move(rejected)))
            storeOrDropItem(dof::hubs::InventoryItem::makeWeapon(std::move(stillRejected)));
        return false;
    }
    // card-mpkwji9p — dice ride with their weapon through equip/unequip.
    auto evicted = weaponSlotRef.unequipFrom(toRow);
    if (auto rejected = weaponSlotRef.equipAt(toRow, std::move(weapon)))
        storeOrDropItem(dof::hubs::InventoryItem::makeWeapon(std::move(rejected)));
    if (auto rejected = inventoryRef.storeAt(fromSlot, std::move(evicted)))
        storeOrDropItem(dof::hubs::InventoryItem::makeWeapon(std::move(rejected)));
    return true;
}

bool InteractionController::moveWeaponRowToInventoryFirstEmpty(int fromRow) {
    if (weaponSlotRef.isRowEmpty(fromRow)) return false;
    auto weapon = weaponSlotRef.unequipFrom(fromRow);
    if (!weapon) return false;
    auto rejected = inventoryRef.storeAtFirstEmpty(std::move(weapon));
    if (!rejected) return true;
    // The grid has no free 2-cell pair — this used to destroy the weapon.
    // Put it back on the row it came from so the move is a no-op instead.
    if (auto stillRejected = weaponSlotRef.equipAt(fromRow, std::move(rejected)))
        storeOrDropItem(dof::hubs::InventoryItem::makeWeapon(std::move(stillRejected)));
    return false;
}

bool InteractionController::slotDiceFromInventoryToCell(int fromSlot, int toRow, int toCell) {
    if (!weaponSlotRef.isRowUnlocked(toRow)) return false;
    auto* item = inventoryRef.peekItem(fromSlot);
    if (!item || !item->isDice()) return false;
    // `isDiceCellEmpty` now refuses inert cells itself (past the equipped
    // Weapon's slotCount, or any cell of a weapon-less row), so the
    // hand-rolled maxSlotsForRow gate that used to stand in for it is gone.
    if (weaponSlotRef.isDiceCellEmpty(toRow, toCell)) {
        auto dice = inventoryRef.takeDiceFrom(fromSlot);
        if (!dice) return false;
        auto rejected = weaponSlotRef.slotDiceAt(toRow, toCell, std::move(dice));
        if (!rejected) return true;
        if (auto stillRejected = inventoryRef.storeDiceAt(fromSlot, std::move(rejected)))
            storeOrDropItem(dof::hubs::InventoryItem::makeDice(std::move(stillRejected)));
        return false;
    }
    // Not empty and holding nothing means an inert cell: no destination.
    if (weaponSlotRef.peekDice(toRow, toCell) == nullptr) return false;
    auto evicted = weaponSlotRef.unslotDice(toRow, toCell);
    auto dice = inventoryRef.takeDiceFrom(fromSlot);
    if (!dice) {
        // Nothing to move — put the evicted die straight back so the swap
        // cannot leave the cell empty.
        if (auto rejected = weaponSlotRef.slotDiceAt(toRow, toCell, std::move(evicted)))
            storeOrDropItem(dof::hubs::InventoryItem::makeDice(std::move(rejected)));
        return false;
    }
    if (auto rejected = weaponSlotRef.slotDiceAt(toRow, toCell, std::move(dice)))
        storeOrDropItem(dof::hubs::InventoryItem::makeDice(std::move(rejected)));
    if (auto rejected = inventoryRef.storeDiceAt(fromSlot, std::move(evicted)))
        storeOrDropItem(dof::hubs::InventoryItem::makeDice(std::move(rejected)));
    return true;
}

bool InteractionController::dropItemToFloor(dof::hubs::InventoryItem item, sf::Vector2f worldPosition) {
    if (item.isWeapon()) {
        auto weapon = std::move(item.weapon);
        weapon->pickupable().isPickedUp = false;
        weapon->pickupable().pickupRadius = floorPickupRadius;
        auto floorItem = std::make_unique<dof::entities::FloorItem>(worldRef.allocateId(), worldPosition,
                                                                    std::move(weapon), false);
        worldRef.floorItems().push_back(std::move(floorItem));
        return true;
    }
    if (item.isDice()) {
        auto dice = std::move(item.dice);
        dice->pickupable().isPickedUp = false;
        dice->pickupable().pickupRadius = floorPickupRadius;
        auto floorItem = std::make_unique<dof::entities::FloorItem>(worldRef.allocateId(), worldPosition,
                                                                    std::move(dice));
        worldRef.floorItems().push_back(std::move(floorItem));
        return true;
    }
    return false;
}

}  // namespace dof::render
