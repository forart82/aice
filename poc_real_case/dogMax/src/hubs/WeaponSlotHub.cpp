#include "hubs/WeaponSlotHub.hpp"

#include "combat/WeaponFiring.hpp"
#include "loaders/ConfigLoader.hpp"

#include <algorithm>
#include <string>
#include <vector>

namespace dof::hubs {

namespace {

// Collect the non-null dice in a row as raw pointers so the shared
// `dof::combat` firing helpers can consume them through a span — the
// single source of truth for the charged / progress rule (de-dup:
// hero, sidebar, and enemy paths all resolve it identically).
std::vector<dof::entities::Dice*> rowDicePointers(
        const std::vector<std::unique_ptr<dof::entities::Dice>>& diceRow) {
    std::vector<dof::entities::Dice*> dice;
    for (const auto& slot : diceRow) {
        if (slot) dice.push_back(slot.get());
    }
    return dice;
}

}

WeaponSlotHub::WeaponSlotHub(const dof::loaders::ConfigLoader& config) {
    rows = std::max(1, config.getInt("WEAPONSLOT_ROWS"));
    diceCells = std::max(1, config.getInt("WEAPONSLOT_DICE_CELLS_PER_ROW"));
    unlockLevels.reserve(static_cast<size_t>(rows));
    for (int row = 0; row < rows; ++row) {
        const std::string key = "WEAPONSLOT_UNLOCK_LEVEL_ROW_" + std::to_string(row + 1);
        const int fallback = row == 0 ? 1 : 9999;
        unlockLevels.push_back(std::max(1, config.hasKey(key) ? config.getInt(key) : fallback));
    }
    unlockedRows = computeUnlockedRows(currentHeroLevel);
    equippedWeapons.resize(static_cast<size_t>(rows));
    slottedDice.resize(static_cast<size_t>(rows));
    for (auto& row : slottedDice) row.resize(static_cast<size_t>(diceCells));
}

int WeaponSlotHub::rowCount() const { return rows; }
int WeaponSlotHub::diceCellsPerRow() const { return diceCells; }
int WeaponSlotHub::unlockedRowCount() const { return unlockedRows; }

int WeaponSlotHub::unlockLevelForRow(int rowIndex) const {
    if (!isValidRow(rowIndex)) return 0;
    return unlockLevels[static_cast<size_t>(rowIndex)];
}

bool WeaponSlotHub::isRowUnlocked(int rowIndex) const {
    if (!isValidRow(rowIndex)) return false;
    return rowIndex < unlockedRows
        && currentHeroLevel >= unlockLevels[static_cast<size_t>(rowIndex)];
}

void WeaponSlotHub::setHeroLevel(int heroLevel) {
    currentHeroLevel = std::max(1, heroLevel);
    const int nextUnlockedRows = computeUnlockedRows(currentHeroLevel);
    if (nextUnlockedRows != unlockedRows) {
        unlockedRows = nextUnlockedRows;
        bumpEpoch();
    }
}

bool WeaponSlotHub::isRowEmpty(int rowIndex) const {
    if (!isValidRow(rowIndex) || !isRowUnlocked(rowIndex)) return true;
    return !equippedWeapons[static_cast<size_t>(rowIndex)];
}

const dof::entities::Weapon* WeaponSlotHub::peek(int rowIndex) const {
    if (!isValidRow(rowIndex) || !isRowUnlocked(rowIndex)) return nullptr;
    return equippedWeapons[static_cast<size_t>(rowIndex)].get();
}

dof::entities::Weapon* WeaponSlotHub::peek(int rowIndex) {
    if (!isValidRow(rowIndex) || !isRowUnlocked(rowIndex)) return nullptr;
    return equippedWeapons[static_cast<size_t>(rowIndex)].get();
}

int WeaponSlotHub::firstEmptyRow() const {
    for (size_t i = 0; i < equippedWeapons.size(); ++i) {
        if (isRowUnlocked(static_cast<int>(i)) && !equippedWeapons[i]) return static_cast<int>(i);
    }
    return -1;
}

int WeaponSlotHub::findRowByWeaponId(dof::core::EntityId id) const {
    for (size_t i = 0; i < equippedWeapons.size(); ++i) {
        if (!isRowUnlocked(static_cast<int>(i))) continue;
        if (equippedWeapons[i] && equippedWeapons[i]->id() == id) return static_cast<int>(i);
    }
    return -1;
}

std::unique_ptr<dof::entities::Weapon> WeaponSlotHub::equipAt(
        int rowIndex, std::unique_ptr<dof::entities::Weapon> weapon) {
    if (!isValidRow(rowIndex) || !isRowUnlocked(rowIndex)) return weapon;
    if (equippedWeapons[static_cast<size_t>(rowIndex)]) return weapon;
    if (weapon) weapon->countdownable().reset();
    // card-mpkwji9p — pull any dice that travelled with the weapon
    // (drained on the matching `unequipFrom`) into a local stash
    // BEFORE the weapon's slotCount is queried for slot gating. The
    // dice slot back into the destination row's cells in the same
    // cell-index order; cells past the weapon's `slotCount` (or beyond
    // the physical row width) are silently skipped, matching the
    // existing `slotDiceAt` invariant.
    std::vector<std::unique_ptr<dof::entities::Dice>> pendingDice;
    if (weapon) pendingDice = weapon->takeAttachedDice();
    equippedWeapons[static_cast<size_t>(rowIndex)] = std::move(weapon);
    for (size_t i = 0; i < pendingDice.size(); ++i) {
        if (!pendingDice[i]) continue;
        if (static_cast<int>(i) >= diceCells) break;
        if (static_cast<int>(i) >= maxSlotsForRow(rowIndex)) break;
        slottedDice[static_cast<size_t>(rowIndex)][i] = std::move(pendingDice[i]);
        slottedDice[static_cast<size_t>(rowIndex)][i]->countdownable().reset();
    }
    bumpEpoch();
    return nullptr;
}

std::unique_ptr<dof::entities::Weapon> WeaponSlotHub::equipFirstEmpty(
        std::unique_ptr<dof::entities::Weapon> weapon) {
    const int row = firstEmptyRow();
    if (row < 0) return weapon;
    return equipAt(row, std::move(weapon));
}

std::unique_ptr<dof::entities::Weapon> WeaponSlotHub::unequipFrom(int rowIndex) {
    if (!isValidRow(rowIndex)) return nullptr;
    auto weapon = std::move(equippedWeapons[static_cast<size_t>(rowIndex)]);
    // No reset() needed — move already leaves the slot in the null state.
    // card-mpkwji9p — drain any slotted dice into the outgoing weapon
    // so they travel with it (into the inventory, onto the floor, or
    // back into another row) instead of being orphaned in this row.
    // `takeAllRowDice` bumps the epoch iff dice were actually moved,
    // so a no-dice row stays cheap.
    if (weapon) {
        auto rowDice = takeAllRowDice(rowIndex);
        weapon->attachDice(std::move(rowDice));
        bumpEpoch();
    }
    return weapon;
}

bool WeaponSlotHub::swapRows(int rowA, int rowB) {
    if (!isValidRow(rowA) || !isValidRow(rowB)) return false;
    if (!isRowUnlocked(rowA) || !isRowUnlocked(rowB)) return false;
    std::swap(equippedWeapons[static_cast<size_t>(rowA)], equippedWeapons[static_cast<size_t>(rowB)]);
    std::swap(slottedDice[static_cast<size_t>(rowA)], slottedDice[static_cast<size_t>(rowB)]);
    bumpEpoch();
    return true;
}

bool WeaponSlotHub::isValidRow(int rowIndex) const {
    return rowIndex >= 0 && rowIndex < rows;
}

bool WeaponSlotHub::isValidCell(int rowIndex, int cellIndex) const {
    return isValidRow(rowIndex) && cellIndex >= 0 && cellIndex < diceCells;
}

int WeaponSlotHub::maxSlotsForRow(int rowIndex) const {
    const auto* weapon = peek(rowIndex);
    if (!weapon) return 0;
    // Spec §Loot L2038 clamps slotCount to [2, 6]; respect the
    // physical row width as a hard upper bound in case `diceCells`
    // is ever raised above 6.
    return std::min(weapon->slotCount(), diceCells);
}

bool WeaponSlotHub::isDiceCellEmpty(int rowIndex, int cellIndex) const {
    // Deliberately `slotDiceAt`'s guard sequence, in the same order, so the
    // probe and the placer can never disagree. It used to answer TRUE for
    // input the placer refuses — an out-of-range cell, a locked row, or a
    // cell past `maxSlotsForRow` (on a slotCount-2 weapon, cell 5 read as
    // "empty" while `slotDiceAt` rejected it) — which invited a caller to
    // hand over a die that was guaranteed to bounce.
    if (!isValidCell(rowIndex, cellIndex)) return false;
    if (!isRowUnlocked(rowIndex)) return false;
    if (cellIndex >= maxSlotsForRow(rowIndex)) return false;
    return !slottedDice[static_cast<size_t>(rowIndex)][static_cast<size_t>(cellIndex)];
}

const dof::entities::Dice* WeaponSlotHub::peekDice(int rowIndex, int cellIndex) const {
    if (!isValidCell(rowIndex, cellIndex) || !isRowUnlocked(rowIndex)) return nullptr;
    return slottedDice[static_cast<size_t>(rowIndex)][static_cast<size_t>(cellIndex)].get();
}

dof::entities::Dice* WeaponSlotHub::peekDice(int rowIndex, int cellIndex) {
    if (!isValidCell(rowIndex, cellIndex) || !isRowUnlocked(rowIndex)) return nullptr;
    return slottedDice[static_cast<size_t>(rowIndex)][static_cast<size_t>(cellIndex)].get();
}

std::unique_ptr<dof::entities::Dice> WeaponSlotHub::slotDiceAt(
        int rowIndex, int cellIndex, std::unique_ptr<dof::entities::Dice> dice) {
    if (!isValidCell(rowIndex, cellIndex)) return dice;
    if (!isRowUnlocked(rowIndex)) return dice;
    // SA10 / spec §Loot L1675-L1676: per-Weapon slot gate. Cells past
    // the equipped Weapon's slotCount are inert. `maxSlotsForRow`
    // returns 0 when the row is empty, which keeps the existing
    // "no weapon -> no dice" invariant intact.
    if (cellIndex >= maxSlotsForRow(rowIndex)) return dice;
    auto& cell = slottedDice[static_cast<size_t>(rowIndex)][static_cast<size_t>(cellIndex)];
    if (cell) return dice;
    if (!dice) return dice;
    dice->countdownable().reset();
    cell = std::move(dice);
    bumpEpoch();
    return nullptr;
}

std::unique_ptr<dof::entities::Dice> WeaponSlotHub::slotDiceAtFirstEmpty(
        int rowIndex, std::unique_ptr<dof::entities::Dice> dice) {
    const int cell = firstEmptyDiceCell(rowIndex);
    if (cell < 0) return dice;
    return slotDiceAt(rowIndex, cell, std::move(dice));
}

std::unique_ptr<dof::entities::Dice> WeaponSlotHub::slotDiceAtFirstEmptyAnyRow(
        std::unique_ptr<dof::entities::Dice> dice) {
    for (int r = 0; r < rows; ++r) {
        if (!isRowUnlocked(r)) continue;
        if (equippedWeapons[static_cast<size_t>(r)]) {
            const int cell = firstEmptyDiceCell(r);
            if (cell >= 0) {
                return slotDiceAt(r, cell, std::move(dice));
            }
        }
    }
    return dice;
}

std::vector<std::unique_ptr<dof::entities::Dice>> WeaponSlotHub::takeAllRowDice(int rowIndex) {
    std::vector<std::unique_ptr<dof::entities::Dice>> taken;
    if (!isValidRow(rowIndex)) return taken;
    auto& row = slottedDice[static_cast<size_t>(rowIndex)];
    for (auto& cell : row) {
        if (cell) {
            taken.push_back(std::move(cell));
            cell.reset();
        }
    }
    if (!taken.empty()) bumpEpoch();
    return taken;
}

std::unique_ptr<dof::entities::Dice> WeaponSlotHub::unslotDice(int rowIndex, int cellIndex) {
    if (!isValidCell(rowIndex, cellIndex)) return nullptr;
    auto& cell = slottedDice[static_cast<size_t>(rowIndex)][static_cast<size_t>(cellIndex)];
    auto dice = std::move(cell);
    cell.reset();
    if (dice) bumpEpoch();
    return dice;
}

int  WeaponSlotHub::epoch() const { return slotEpoch; }
void WeaponSlotHub::bumpEpoch() { ++slotEpoch; }

int WeaponSlotHub::firstEmptyDiceCell(int rowIndex) const {
    if (!isValidRow(rowIndex) || !isRowUnlocked(rowIndex)) return -1;
    // Only scan cells the equipped Weapon actually exposes. An
    // empty row reports `maxSlotsForRow = 0`, so the auto-slot
    // helpers refuse to place dice on a Weapon-less row — same
    // outcome as before this gate landed.
    const int limit = maxSlotsForRow(rowIndex);
    const auto& row = slottedDice[static_cast<size_t>(rowIndex)];
    for (int i = 0; i < limit && static_cast<size_t>(i) < row.size(); ++i) {
        if (!row[static_cast<size_t>(i)]) return i;
    }
    return -1;
}

int WeaponSlotHub::countSlottedDice(int rowIndex) const {
    if (!isValidRow(rowIndex) || !isRowUnlocked(rowIndex)) return 0;
    int count = 0;
    for (const auto& slot : slottedDice[static_cast<size_t>(rowIndex)]) {
        if (slot) ++count;
    }
    return count;
}

bool WeaponSlotHub::isRowCharged(int rowIndex) const {
    const auto* weapon = peek(rowIndex);
    if (!weapon) return false;
    const auto dice = rowDicePointers(slottedDice[static_cast<size_t>(rowIndex)]);
    return dof::combat::isWeaponCharged(*weapon, dice);
}

float WeaponSlotHub::rowProgress(int rowIndex) const {
    const auto* weapon = peek(rowIndex);
    if (!weapon) return 0.0f;
    const auto dice = rowDicePointers(slottedDice[static_cast<size_t>(rowIndex)]);
    return dof::combat::weaponChargeProgress(*weapon, dice);
}

int WeaponSlotHub::computeUnlockedRows(int heroLevel) const {
    int count = 0;
    for (const int unlockLevel : unlockLevels) {
        if (heroLevel >= unlockLevel) ++count;
    }
    return std::clamp(count, 1, rows);
}

}
