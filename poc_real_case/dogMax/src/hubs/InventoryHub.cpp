#include "hubs/InventoryHub.hpp"

#include "entities/Dice.hpp"
#include "entities/Weapon.hpp"
#include "loaders/ConfigLoader.hpp"

#include <algorithm>
#include <cstdint>
#include <vector>

namespace dof::hubs {

InventoryHub::InventoryHub(const dof::loaders::ConfigLoader& config) {
    gridRows    = config.getInt("INVENTORY_ROWS");
    gridColumns = config.getInt("INVENTORY_COLUMNS");
    slots.resize(static_cast<size_t>(gridRows * gridColumns));
}

int InventoryHub::rows()      const { return gridRows; }
int InventoryHub::columns()   const { return gridColumns; }
int InventoryHub::slotCount() const { return gridRows * gridColumns; }

bool InventoryHub::hasSpace() const {
    return firstEmptySlot() >= 0;
}

bool InventoryHub::hasSpaceForWeapon() const {
    return firstEmptySlotPair() >= 0;
}

int InventoryHub::countOccupied() const {
    int count = 0;
    for (const auto& slot : slots)
        if (!slot.isEmpty() && !slot.isWeaponShadow()) ++count;
    return count;
}

bool InventoryHub::isSlotEmpty(int slotIndex) const {
    // Same validity gate as `storeAt`, so probe and placer agree: an
    // out-of-range index is not a place an item can go, so it is not
    // "empty". It used to answer true there, which invited a caller to hand
    // `storeAt` an item it was guaranteed to refuse.
    if (!isValidIndex(slotIndex)) return false;
    return slots[static_cast<size_t>(slotIndex)].isEmpty();
}

const InventoryItem* InventoryHub::peekItem(int slotIndex) const {
    if (!isValidIndex(slotIndex)) return nullptr;
    return &slots[static_cast<size_t>(slotIndex)];
}

InventoryItem* InventoryHub::peekItem(int slotIndex) {
    if (!isValidIndex(slotIndex)) return nullptr;
    return &slots[static_cast<size_t>(slotIndex)];
}

const dof::entities::Weapon* InventoryHub::peek(int slotIndex) const {
    auto* item = peekItem(slotIndex);
    return (item && item->isWeapon()) ? item->weapon.get() : nullptr;
}

dof::entities::Weapon* InventoryHub::peek(int slotIndex) {
    auto* item = peekItem(slotIndex);
    return (item && item->isWeapon()) ? item->weapon.get() : nullptr;
}

const dof::entities::Dice* InventoryHub::peekDice(int slotIndex) const {
    auto* item = peekItem(slotIndex);
    return (item && item->isDice()) ? item->dice.get() : nullptr;
}

dof::entities::Dice* InventoryHub::peekDice(int slotIndex) {
    auto* item = peekItem(slotIndex);
    return (item && item->isDice()) ? item->dice.get() : nullptr;
}

int InventoryHub::firstEmptySlot() const {
    const int end = slotCount();
    for (int i = 0; i < end; ++i) {
        if (slots[static_cast<size_t>(i)].isEmpty()) return i;
    }
    return -1;
}

int InventoryHub::firstEmptySlotPair() const {
    const int end = slotCount();
    for (int i = 0; i + gridColumns < end; ++i) {
        if (!slots[static_cast<size_t>(i)].isEmpty()) continue;
        if (slots[static_cast<size_t>(i + gridColumns)].isEmpty()) return i;
    }
    return -1;
}

int InventoryHub::resolvePrimarySlot(int slotIndex) const {
    if (!isValidIndex(slotIndex)) return slotIndex;
    const auto& item = slots[static_cast<size_t>(slotIndex)];
    if (item.isWeaponShadow()) return item.shadowOf;
    return slotIndex;
}

bool InventoryHub::canPlaceWeaponAt(int primarySlot) const {
    if (!isValidIndex(primarySlot)) return false;
    const int shadow = primarySlot + gridColumns;
    if (!isValidIndex(shadow)) return false;
    return slots[static_cast<size_t>(primarySlot)].isEmpty()
        && slots[static_cast<size_t>(shadow)].isEmpty();
}

int InventoryHub::findSlotByWeaponId(dof::core::EntityId id) const {
    for (size_t i = 0; i < slots.size(); ++i) {
        if (slots[i].isWeapon() && slots[i].weapon->id() == id) return static_cast<int>(i);
    }
    return -1;
}

int InventoryHub::findSlotByDiceId(dof::core::EntityId id) const {
    for (size_t i = 0; i < slots.size(); ++i) {
        if (slots[i].isDice() && slots[i].dice->id() == id) return static_cast<int>(i);
    }
    return -1;
}

std::unique_ptr<dof::entities::Weapon> InventoryHub::storeAt(
        int slotIndex, std::unique_ptr<dof::entities::Weapon> weapon) {
    auto rejected = storeAt(slotIndex, InventoryItem::makeWeapon(std::move(weapon)));
    return std::move(rejected.weapon);
}

InventoryItem InventoryHub::storeAt(int slotIndex, InventoryItem item) {
    if (!isValidIndex(slotIndex)) return item;
    if (item.isEmpty()) return item;
    if (!slots[static_cast<size_t>(slotIndex)].isEmpty()) return item;

    if (item.isWeapon()) {
        // Weapons occupy two vertically adjacent cells in one grid column.
        const int shadow = slotIndex + gridColumns;
        if (!isValidIndex(shadow)) return item;
        if (!slots[static_cast<size_t>(shadow)].isEmpty()) return item;
        slots[static_cast<size_t>(slotIndex)] = std::move(item);
        slots[static_cast<size_t>(shadow)]    = InventoryItem::makeWeaponShadow(slotIndex);
        return {};
    }

    slots[static_cast<size_t>(slotIndex)] = std::move(item);
    return {};
}

std::unique_ptr<dof::entities::Dice> InventoryHub::storeDiceAt(
        int slotIndex, std::unique_ptr<dof::entities::Dice> dice) {
    auto rejected = storeAt(slotIndex, InventoryItem::makeDice(std::move(dice)));
    return std::move(rejected.dice);
}

std::unique_ptr<dof::entities::Weapon> InventoryHub::storeAtFirstEmpty(
        std::unique_ptr<dof::entities::Weapon> weapon) {
    // A null weapon would write an empty primary cell plus a shadow pointing
    // at it — a shadow with no weapon behind it. Nothing to store, nothing to
    // hand back.
    if (!weapon) return nullptr;
    const int pair = firstEmptySlotPair();
    if (pair < 0) return weapon;
    slots[static_cast<size_t>(pair)]               = InventoryItem::makeWeapon(std::move(weapon));
    slots[static_cast<size_t>(pair + gridColumns)] = InventoryItem::makeWeaponShadow(pair);
    reapplyAutoSort();
    return nullptr;
}

InventoryItem InventoryHub::storeItemAtFirstEmpty(InventoryItem item) {
    if (item.isWeapon()) {
        auto rejected = storeAtFirstEmpty(std::move(item.weapon));
        if (!rejected) return {};
        return InventoryItem::makeWeapon(std::move(rejected));
    }
    const int slot = firstEmptySlot();
    if (slot < 0) return item;
    auto rejected = storeAt(slot, std::move(item));
    if (rejected.isEmpty()) reapplyAutoSort();
    return rejected;
}

std::unique_ptr<dof::entities::Dice> InventoryHub::storeDiceAtFirstEmpty(
        std::unique_ptr<dof::entities::Dice> dice) {
    auto rejected = storeItemAtFirstEmpty(InventoryItem::makeDice(std::move(dice)));
    return std::move(rejected.dice);
}

InventoryItem InventoryHub::takeItemFrom(int slotIndex) {
    const int primary = resolvePrimarySlot(slotIndex);
    if (!isValidIndex(primary)) return {};
    auto item = std::move(slots[static_cast<size_t>(primary)]);
    slots[static_cast<size_t>(primary)] = InventoryItem{};
    if (item.isWeapon()) {
        const int shadow = primary + gridColumns;
        if (isValidIndex(shadow)
            && slots[static_cast<size_t>(shadow)].isWeaponShadow()
            && slots[static_cast<size_t>(shadow)].shadowOf == primary) {
            slots[static_cast<size_t>(shadow)] = InventoryItem{};
        }
    }
    return item;
}

std::unique_ptr<dof::entities::Weapon> InventoryHub::takeFrom(int slotIndex) {
    const int primary = resolvePrimarySlot(slotIndex);
    if (!isValidIndex(primary)) return nullptr;
    auto& item = slots[static_cast<size_t>(primary)];
    if (!item.isWeapon()) return nullptr;
    auto weapon = std::move(item.weapon);
    slots[static_cast<size_t>(primary)] = InventoryItem{};
    const int shadow = primary + gridColumns;
    if (isValidIndex(shadow)
        && slots[static_cast<size_t>(shadow)].isWeaponShadow()
        && slots[static_cast<size_t>(shadow)].shadowOf == primary) {
        slots[static_cast<size_t>(shadow)] = InventoryItem{};
    }
    return weapon;
}

std::unique_ptr<dof::entities::Dice> InventoryHub::takeDiceFrom(int slotIndex) {
    if (!isValidIndex(slotIndex)) return nullptr;
    auto& item = slots[static_cast<size_t>(slotIndex)];
    if (!item.isDice()) return nullptr;
    auto dice = std::move(item.dice);
    slots[static_cast<size_t>(slotIndex)] = InventoryItem{};
    return dice;
}

bool InventoryHub::swapSlots(int slotA, int slotB) {
    if (!isValidIndex(slotA) || !isValidIndex(slotB)) return false;
    // Weapons occupy 2 cells; a raw single-slot swap corrupts the pair.
    if (slots[static_cast<size_t>(slotA)].isWeapon()
        || slots[static_cast<size_t>(slotA)].isWeaponShadow()
        || slots[static_cast<size_t>(slotB)].isWeapon()
        || slots[static_cast<size_t>(slotB)].isWeaponShadow()) return false;
    std::swap(slots[static_cast<size_t>(slotA)], slots[static_cast<size_t>(slotB)]);
    return true;
}

bool InventoryHub::isValidIndex(int slotIndex) const {
    return slotIndex >= 0 && slotIndex < slotCount();
}

bool InventoryHub::isSlotAccessible(int slotIndex) const {
    return isValidIndex(slotIndex);
}

namespace {

int tierRankFor(const dof::hubs::InventoryItem& item) {
    if (item.isEmpty() || item.isWeaponShadow()) return 9999;
    const auto tier = item.isWeapon() ? item.weapon->tier() : item.dice->tier();
    return static_cast<int>(tier);
}

int typeRankFor(const dof::hubs::InventoryItem& item) {
    if (item.isEmpty() || item.isWeaponShadow()) return 9999;
    if (item.isWeapon()) return 0 * 100 + static_cast<int>(item.weapon->type());
    return 1 * 100 + static_cast<int>(item.dice->face());
}

std::uint64_t entityIdFor(const dof::hubs::InventoryItem& item) {
    if (item.isWeapon()) return item.weapon->id().value;
    if (item.isDice())   return item.dice->id().value;
    return 0;
}

// Packs `ordered` back into `slots`. TOTAL by construction: the layout is fully
// planned against a scratch occupancy map BEFORE anything is moved, so a packing
// that cannot place every item returns false with `slots` untouched and the sort
// becomes a no-op. The previous version moved items out first and then `break`ed
// out of its two passes, destroying whatever was left when the temp vector died
// — reachable by making INVENTORY_ROWS odd, where the greedy row-pair packing
// yields less capacity than the layout the items came from.
bool repackSortedItems(std::vector<dof::hubs::InventoryItem>& slots,
                       const std::vector<dof::hubs::InventoryItem*>& ordered,
                       int gridColumns) {
    const int total = static_cast<int>(slots.size());
    std::vector<char> isOccupied(static_cast<size_t>(total), 0);
    std::vector<int>  targetSlot(ordered.size(), -1);

    // Plan weapons first: each takes a vertical pair within one column.
    int weaponCursor = 0;
    for (size_t i = 0; i < ordered.size(); ++i) {
        if (!ordered[i]->isWeapon()) continue;
        while (weaponCursor + gridColumns < total
               && (isOccupied[static_cast<size_t>(weaponCursor)]
                   || isOccupied[static_cast<size_t>(weaponCursor + gridColumns)])) {
            ++weaponCursor;
        }
        if (weaponCursor + gridColumns >= total) return false;
        isOccupied[static_cast<size_t>(weaponCursor)] = 1;
        isOccupied[static_cast<size_t>(weaponCursor + gridColumns)] = 1;
        targetSlot[i] = weaponCursor;
        ++weaponCursor;
    }

    // Then dice into whatever single cells remain.
    int diceCursor = 0;
    for (size_t i = 0; i < ordered.size(); ++i) {
        if (!ordered[i]->isDice()) continue;
        while (diceCursor < total && isOccupied[static_cast<size_t>(diceCursor)]) ++diceCursor;
        if (diceCursor >= total) return false;
        isOccupied[static_cast<size_t>(diceCursor)] = 1;
        targetSlot[i] = diceCursor;
        ++diceCursor;
    }

    // Every item has a home — only now is it safe to move.
    std::vector<dof::hubs::InventoryItem> packed(static_cast<size_t>(total));
    for (size_t i = 0; i < ordered.size(); ++i) {
        const int target = targetSlot[i];
        if (target < 0) continue;
        const bool isWeaponItem = ordered[i]->isWeapon();
        packed[static_cast<size_t>(target)] = std::move(*ordered[i]);
        if (isWeaponItem) {
            packed[static_cast<size_t>(target + gridColumns)] =
                dof::hubs::InventoryItem::makeWeaponShadow(target);
        }
    }
    slots.swap(packed);
    return true;
}

}

void InventoryHub::sortByTier() {
    auto byTier = [](const InventoryItem& a, const InventoryItem& b) {
        const int ra = tierRankFor(a);
        const int rb = tierRankFor(b);
        if (ra != rb) return ra < rb;
        return entityIdFor(a) < entityIdFor(b);
    };
    // Gather POINTERS, not the items themselves: nothing leaves the grid until
    // repackSortedItems has proved every item has a destination.
    std::vector<InventoryItem*> ordered;
    ordered.reserve(slots.size());
    for (auto& s : slots)
        if (!s.isEmpty() && !s.isWeaponShadow()) ordered.push_back(&s);
    std::stable_sort(ordered.begin(), ordered.end(),
                     [&](const InventoryItem* a, const InventoryItem* b) {
                         return byTier(*a, *b);
                     });
    repackSortedItems(slots, ordered, gridColumns);
}

void InventoryHub::sortByType() {
    auto byType = [](const InventoryItem& a, const InventoryItem& b) {
        const int ra = typeRankFor(a);
        const int rb = typeRankFor(b);
        if (ra != rb) return ra < rb;
        return entityIdFor(a) < entityIdFor(b);
    };
    // Gather POINTERS, not the items themselves: nothing leaves the grid until
    // repackSortedItems has proved every item has a destination.
    std::vector<InventoryItem*> ordered;
    ordered.reserve(slots.size());
    for (auto& s : slots)
        if (!s.isEmpty() && !s.isWeaponShadow()) ordered.push_back(&s);
    std::stable_sort(ordered.begin(), ordered.end(),
                     [&](const InventoryItem* a, const InventoryItem* b) {
                         return byType(*a, *b);
                     });
    repackSortedItems(slots, ordered, gridColumns);
}

bool InventoryHub::isAutoSortEnabled() const { return autoSortEnabled; }

void InventoryHub::setAutoSortEnabled(bool enabled) {
    autoSortEnabled = enabled;
    if (autoSortEnabled) reapplyAutoSort();
}

InventoryHub::AutoSortKey InventoryHub::autoSortKey() const { return autoSortKeyValue; }

void InventoryHub::setAutoSortKey(AutoSortKey key) {
    autoSortKeyValue = key;
    if (autoSortEnabled) reapplyAutoSort();
}

void InventoryHub::reapplyAutoSort() {
    if (!autoSortEnabled) return;
    if (autoSortKeyValue == AutoSortKey::Tier) sortByTier();
    else                                       sortByType();
}

}
