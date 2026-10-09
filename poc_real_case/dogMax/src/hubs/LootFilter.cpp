#include "hubs/LootFilter.hpp"

namespace dof::hubs {

bool LootFilter::isActive() const {
    return !weaponTypes.empty() || !diceTypes.empty();
}

void LootFilter::clear() {
    weaponTypes.clear();
    diceTypes.clear();
    maxQuality = 0;
    maxLevel   = 0;
}

bool LootFilter::matchesFloorItem(const dof::entities::FloorItem& item) const {
    if (!isActive()) return false;
    if (item.kind() == dof::entities::FloorItemKind::Weapon) {
        const auto* w = item.weapon();
        if (!w) return false;
        if (weaponTypes.find(w->type()) == weaponTypes.end()) return false;
        if (maxQuality > 0 && w->qualityScore() > maxQuality) return false;
        if (maxLevel   > 0 && w->itemLevel()    > maxLevel)   return false;
        return true;
    }
    if (item.kind() == dof::entities::FloorItemKind::Dice) {
        const auto* d = item.dice();
        if (!d) return false;
        // Faceted dice are never auto-destroyed — powder was invested in them.
        if (d->isCrafted()) return false;
        if (diceTypes.find(d->face()) == diceTypes.end()) return false;
        if (maxQuality > 0 && d->qualityScore() > maxQuality) return false;
        if (maxLevel   > 0 && d->itemLevel()    > maxLevel)   return false;
        return true;
    }
    return false;
}

bool LootFilter::matchesInventoryItem(const InventoryItem& item) const {
    if (!isActive()) return false;
    if (item.isWeapon()) {
        if (weaponTypes.find(item.weapon->type()) == weaponTypes.end()) return false;
        if (maxQuality > 0 && item.weapon->qualityScore() > maxQuality) return false;
        if (maxLevel   > 0 && item.weapon->itemLevel()    > maxLevel)   return false;
        return true;
    }
    if (item.isDice()) {
        // Faceted dice are never auto-destroyed — powder was invested in them.
        if (item.dice->isCrafted()) return false;
        if (diceTypes.find(item.dice->face()) == diceTypes.end()) return false;
        if (maxQuality > 0 && item.dice->qualityScore() > maxQuality) return false;
        if (maxLevel   > 0 && item.dice->itemLevel()    > maxLevel)   return false;
        return true;
    }
    return false;
}

} // namespace dof::hubs
