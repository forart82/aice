#include "hubs/InventoryItem.hpp"

namespace dof::hubs {

InventoryItem InventoryItem::makeWeapon(std::unique_ptr<dof::entities::Weapon> weapon) {
    InventoryItem item;
    if (!weapon) return item;
    item.kind = InventoryItemKind::Weapon;
    item.weapon = std::move(weapon);
    return item;
}

InventoryItem InventoryItem::makeDice(std::unique_ptr<dof::entities::Dice> dice) {
    InventoryItem item;
    if (!dice) return item;
    item.kind = InventoryItemKind::Dice;
    item.dice = std::move(dice);
    return item;
}

InventoryItem InventoryItem::makeWeaponShadow(int primarySlot) {
    InventoryItem item;
    item.kind     = InventoryItemKind::WeaponShadow;
    item.shadowOf = primarySlot;
    return item;
}

}
