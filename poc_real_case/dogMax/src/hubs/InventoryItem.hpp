#pragma once

#include "entities/Dice.hpp"
#include "entities/Weapon.hpp"

#include <memory>

namespace dof::hubs {

enum class InventoryItemKind { None, Weapon, Dice, WeaponShadow };

struct InventoryItem {
    InventoryItemKind                       kind{InventoryItemKind::None};
    std::unique_ptr<dof::entities::Weapon>  weapon;
    std::unique_ptr<dof::entities::Dice>    dice;
    // Set when kind == WeaponShadow: index of the primary weapon slot.
    int shadowOf{-1};

    bool isEmpty()       const { return kind == InventoryItemKind::None; }
    bool isWeapon()      const { return kind == InventoryItemKind::Weapon && weapon != nullptr; }
    bool isDice()        const { return kind == InventoryItemKind::Dice && dice != nullptr; }
    bool isWeaponShadow() const { return kind == InventoryItemKind::WeaponShadow; }

    static InventoryItem makeWeapon(std::unique_ptr<dof::entities::Weapon> weapon);
    static InventoryItem makeDice(std::unique_ptr<dof::entities::Dice> dice);
    static InventoryItem makeWeaponShadow(int primarySlot);
};

}
