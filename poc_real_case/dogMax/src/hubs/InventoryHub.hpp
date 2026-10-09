#pragma once

#include "core/EntityId.hpp"
#include "hubs/InventoryItem.hpp"

#include <vector>

namespace dof::loaders { class ConfigLoader; }

namespace dof::hubs {

class InventoryHub {
public:
    explicit InventoryHub(const dof::loaders::ConfigLoader& config);

    int rows() const;
    int columns() const;
    int slotCount() const;

    bool hasSpace() const;           // true if any single cell is free (for dice)
    bool hasSpaceForWeapon() const;  // true if a vertical 2-cell pair is free
    int  countOccupied() const;

    // True only for a slot `storeAt` would actually accept a single item
    // into: a valid index whose cell is free. It answers "can an item go
    // here", NOT "is there an item here" — use `peekItem` for presence, and
    // `canPlaceWeaponAt` for the 2-cell weapon question. It used to answer
    // true for an out-of-range index, which `storeAt` rejects.
    bool isSlotEmpty(int slotIndex) const;
    const InventoryItem* peekItem(int slotIndex) const;
    InventoryItem*       peekItem(int slotIndex);

    const dof::entities::Weapon* peek(int slotIndex) const;
    dof::entities::Weapon*       peek(int slotIndex);
    const dof::entities::Dice*   peekDice(int slotIndex) const;
    dof::entities::Dice*         peekDice(int slotIndex);

    // First free single cell from index 0 (for dice).
    int  firstEmptySlot() const;
    // First valid primary slot for a vertical weapon pair (slots N and
    // N+columns both empty in one grid column). Returns -1 if none exists.
    int  firstEmptySlotPair() const;
    // Returns primarySlot if slotIndex is a WeaponShadow; else slotIndex.
    int  resolvePrimarySlot(int slotIndex) const;
    // True when primarySlot and primarySlot+1 are both empty and same row.
    bool canPlaceWeaponAt(int primarySlot) const;

    int  findSlotByWeaponId(dof::core::EntityId id) const;
    int  findSlotByDiceId(dof::core::EntityId id) const;

    // Ownership contract shared by every sink below: the payload is taken BY
    // VALUE and handed BACK when the hub cannot keep it. An empty return (a
    // null pointer, or an `isEmpty()` InventoryItem) means ACCEPTED; anything
    // else IS the rejected payload and the caller must re-home it. These used
    // to return bool, so a rejected call destroyed the item together with the
    // parameter — the caller could not even see what it had lost.
    [[nodiscard]] std::unique_ptr<dof::entities::Weapon> storeAt(
        int slotIndex, std::unique_ptr<dof::entities::Weapon> weapon);
    [[nodiscard]] InventoryItem storeAt(int slotIndex, InventoryItem item);
    [[nodiscard]] std::unique_ptr<dof::entities::Dice> storeDiceAt(
        int slotIndex, std::unique_ptr<dof::entities::Dice> dice);

    [[nodiscard]] std::unique_ptr<dof::entities::Weapon> storeAtFirstEmpty(
        std::unique_ptr<dof::entities::Weapon> weapon);
    [[nodiscard]] InventoryItem storeItemAtFirstEmpty(InventoryItem item);
    [[nodiscard]] std::unique_ptr<dof::entities::Dice> storeDiceAtFirstEmpty(
        std::unique_ptr<dof::entities::Dice> dice);

    // Unified grid: every valid index is accessible — there is no hidden
    // shadow row and no weapon/dice band split.
    bool isSlotAccessible(int slotIndex) const;

    InventoryItem takeItemFrom(int slotIndex);
    std::unique_ptr<dof::entities::Weapon> takeFrom(int slotIndex);
    std::unique_ptr<dof::entities::Dice>   takeDiceFrom(int slotIndex);

    bool swapSlots(int slotA, int slotB);
    bool isValidIndex(int slotIndex) const;

    // SA27 / spec §Inventory L2254-L2256 — one-shot sort helpers
    // invoked by the inventory sort buttons (and by the auto-sort
    // flag below). Both compact items toward the front of the grid;
    // empty slots end up trailing. `sortByTier` orders by quality
    // tier (Common → Uncommon → Rare) then by entity id for
    // determinism; `sortByType` groups weapons before dice and
    // orders within each group by underlying type / face.
    void sortByTier();
    void sortByType();

    // Auto-sort flag — when true, every successful `storeAt*`
    // re-applies the last-used sort key so the inventory stays in
    // order as the hero picks new items up. Toggled by the
    // dedicated UI button; defaults to false so the existing
    // first-empty-slot pickup contract holds for legacy callers.
    bool isAutoSortEnabled() const;
    void setAutoSortEnabled(bool enabled);
    enum class AutoSortKey { Tier, Type };
    AutoSortKey autoSortKey() const;
    void setAutoSortKey(AutoSortKey key);

private:
    void reapplyAutoSort();

    int gridRows;
    int gridColumns;
    std::vector<InventoryItem> slots;
    bool        autoSortEnabled{false};
    AutoSortKey autoSortKeyValue{AutoSortKey::Tier};
};

}
