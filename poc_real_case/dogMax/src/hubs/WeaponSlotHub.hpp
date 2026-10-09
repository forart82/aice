#pragma once

#include "core/EntityId.hpp"
#include "entities/Dice.hpp"
#include "entities/Weapon.hpp"

#include <memory>
#include <vector>

namespace dof::loaders { class ConfigLoader; }

namespace dof::hubs {

class WeaponSlotHub {
public:
    explicit WeaponSlotHub(const dof::loaders::ConfigLoader& config);

    int rowCount() const;
    int diceCellsPerRow() const;
    int unlockedRowCount() const;
    int unlockLevelForRow(int rowIndex) const;
    bool isRowUnlocked(int rowIndex) const;
    void setHeroLevel(int heroLevel);

    bool isRowEmpty(int rowIndex) const;
    const dof::entities::Weapon* peek(int rowIndex) const;
    dof::entities::Weapon*       peek(int rowIndex);

    int  firstEmptyRow() const;
    int  findRowByWeaponId(dof::core::EntityId id) const;

    // Ownership contract shared by every sink below: the payload is taken BY
    // VALUE and handed BACK when the hub cannot keep it. Null (or an empty
    // return) means ACCEPTED; a non-null return is the rejected payload and
    // the caller must re-home it. These used to return bool, so a rejected
    // call destroyed the item with the parameter — the caller could not even
    // see what it had lost.
    [[nodiscard]] std::unique_ptr<dof::entities::Weapon> equipAt(
        int rowIndex, std::unique_ptr<dof::entities::Weapon> weapon);
    [[nodiscard]] std::unique_ptr<dof::entities::Weapon> equipFirstEmpty(
        std::unique_ptr<dof::entities::Weapon> weapon);
    std::unique_ptr<dof::entities::Weapon> unequipFrom(int rowIndex);

    bool swapRows(int rowA, int rowB);
    bool isValidRow(int rowIndex) const;

    bool isValidCell(int rowIndex, int cellIndex) const;
    // True only for a cell `slotDiceAt` would actually accept: valid, on an
    // unlocked row, within the equipped Weapon's slot count, and free. It
    // answers "can a die go here", NOT "is there a die here" — use `peekDice`
    // for presence. It used to return true for input `slotDiceAt` rejects
    // (out-of-range cells, locked rows, and cells past `maxSlotsForRow`),
    // which is how a probe-then-place caller could feed the placer a die it
    // was guaranteed to refuse.
    bool isDiceCellEmpty(int rowIndex, int cellIndex) const;

    // SA10 / spec §Loot L1675-L1676 + L2049: surplus dice cells past
    // the equipped Weapon's `slotCount` are inert ("disabled for
    // Weapons with fewer slots"). Returns the per-row maximum slot
    // count gated by the equipped Weapon — 0 when the row is empty.
    int maxSlotsForRow(int rowIndex) const;
    const dof::entities::Dice* peekDice(int rowIndex, int cellIndex) const;
    dof::entities::Dice*       peekDice(int rowIndex, int cellIndex);
    // Same hand-back contract as the equip sinks above: null == accepted,
    // non-null == the die the hub refused.
    [[nodiscard]] std::unique_ptr<dof::entities::Dice> slotDiceAt(
        int rowIndex, int cellIndex, std::unique_ptr<dof::entities::Dice> dice);
    [[nodiscard]] std::unique_ptr<dof::entities::Dice> slotDiceAtFirstEmpty(
        int rowIndex, std::unique_ptr<dof::entities::Dice> dice);
    [[nodiscard]] std::unique_ptr<dof::entities::Dice> slotDiceAtFirstEmptyAnyRow(
        std::unique_ptr<dof::entities::Dice> dice);

    // Drain every dice cell on the row and return the dice in cell
    // order. Used by callers that unequip a weapon (B-UX-3) so the
    // dice that were attached to the weapon are migrated alongside
    // it instead of being orphaned in a row that no longer has an
    // owner. Bumps the epoch iff any dice are returned.
    std::vector<std::unique_ptr<dof::entities::Dice>> takeAllRowDice(int rowIndex);
    std::unique_ptr<dof::entities::Dice> unslotDice(int rowIndex, int cellIndex);
    int  firstEmptyDiceCell(int rowIndex) const;
    int  countSlottedDice(int rowIndex) const;

    // Spec §Charged + §Effective APS:
    // - When no dice are slotted: row charged iff weapon countdown finished.
    // - When any dice slotted: weapon's own countdown is ignored and the row
    //   charges only when every slotted dice has finished its roll.
    // rowProgress mirrors the same logic so the sidebar's main progress bar
    // tracks the slowest dice while dice are slotted (the slowest dice has
    // the smallest progress, so we report `min(progress)`).
    bool  isRowCharged(int rowIndex) const;
    float rowProgress(int rowIndex) const;

    // Bumped on every slot-content mutation (equip / unequip / slot-dice /
    // unslot-dice / swap). Downstream caches (e.g. `LuckHub`) can compare
    // their stored epoch against this value to detect stale state without
    // any callback wiring.
    int epoch() const;

private:
    void bumpEpoch();

    int rows;
    int diceCells;
    int currentHeroLevel{1};
    int unlockedRows{1};
    int slotEpoch{0};
    std::vector<int> unlockLevels;
    std::vector<std::unique_ptr<dof::entities::Weapon>> equippedWeapons;
    std::vector<std::vector<std::unique_ptr<dof::entities::Dice>>> slottedDice;

    int computeUnlockedRows(int heroLevel) const;
};

}
