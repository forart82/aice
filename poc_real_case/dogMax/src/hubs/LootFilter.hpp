#pragma once

#include "entities/Dice.hpp"
#include "entities/FloorItem.hpp"
#include "entities/Weapon.hpp"
#include "hubs/InventoryItem.hpp"

#include <set>

namespace dof::hubs {

// Defines which items the hero auto-destroys on pickup or inventory apply.
// An item matches when ALL of these hold:
//   1. Its type is in weaponTypes (for weapons) or diceTypes (for dice).
//   2. maxQuality == 0  OR  item.qualityScore() <= maxQuality.
//   3. maxLevel   == 0  OR  item.itemLevel()   <= maxLevel.
// isActive() returns false when both type sets are empty (no filtering).
struct LootFilter {
    std::set<dof::entities::WeaponType> weaponTypes;
    std::set<dof::entities::DiceFace>   diceTypes;
    int maxQuality{0}; // 0 = no ceiling
    int maxLevel{0};   // 0 = no ceiling

    bool isActive() const;

    // Resets the filter to its inactive default: clears both type sets and
    // both thresholds. Backs the "UNSET" button in the loot-filter popup.
    void clear();

    bool matchesFloorItem(const dof::entities::FloorItem& item) const;
    bool matchesInventoryItem(const InventoryItem& item) const;
};

} // namespace dof::hubs
