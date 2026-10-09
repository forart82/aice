#include "render/InteractionController.hpp"

#include "core/World.hpp"
#include "entities/FloorItem.hpp"
#include "entities/QualityTier.hpp"
#include "helpers/MathHelper.hpp"
#include "hubs/InventoryDestroyer.hpp"
#include "hubs/InventoryHub.hpp"
#include "hubs/PowderHub.hpp"
#include "hubs/WeaponSlotHub.hpp"
#include "loaders/ConfigLoader.hpp"
#include "render/InventoryLayout.hpp"
#include "render/InventoryRenderer.hpp"
#include "render/WeaponSlotLayout.hpp"

namespace dof::render {

InteractionController::InteractionController(dof::core::World& world,
                                             dof::hubs::InventoryHub& inventoryHub,
                                             dof::hubs::WeaponSlotHub& weaponSlotHub,
                                             UiState& uiState,
                                             const dof::loaders::ConfigLoader& config)
    : worldRef(world), inventoryRef(inventoryHub), weaponSlotRef(weaponSlotHub),
      uiStateRef(uiState), configRef(config) {
    floorPickupRadius = config.getFloat("ITEM_PICKUP_RADIUS");
    // Floor-item hover hit-radius (world px). Items live in world space
    // so the dice-cell margin is not directly reusable — the rect-vs-
    // point check is replaced by a circle-vs-point check around the
    // sprite centre. Tuned in tooltip.yaml so it can be widened
    // without touching code.
    floorItemHoverRadius = config.getFloat("FLOOR_ITEM_HOVER_RADIUS");
}

void InteractionController::setPowderHub(dof::hubs::PowderHub& powderHub) {
    powderHubPtr = &powderHub;
}

void InteractionController::setInventoryRenderer(InventoryRenderer& inventoryRenderer) {
    inventoryRendererPtr = &inventoryRenderer;
}

int InteractionController::clickDestroyButton(int tierIndex) {
    if (tierIndex < 0 || tierIndex > 2) return 0;
    // T-P5-destroy-buttons-hover-flash — every click flashes the button
    // even when the matching tier is empty. Player intent (the click)
    // is the trigger, not the outcome; an empty-tier click still gives
    // immediate "you pressed it" feedback.
    if (inventoryRendererPtr) inventoryRendererPtr->triggerDestroyFlash(tierIndex);
    if (!powderHubPtr) return 0;
    dof::entities::QualityTier tier = dof::entities::QualityTier::Common;
    if (tierIndex == 1) tier = dof::entities::QualityTier::Uncommon;
    else if (tierIndex == 2) tier = dof::entities::QualityTier::Rare;
    return dof::hubs::destroyTierFromInventory(inventoryRef, *powderHubPtr, tier, configRef);
}

int InteractionController::destroyInventoryItem(int slotIndex) {
    if (!powderHubPtr) return 0;
    if (slotIndex < 0) return 0;
    const int slot = inventoryRef.resolvePrimarySlot(slotIndex);
    // `isSlotEmpty` now answers the destination question ("can something go
    // here"), so the index has to be range-checked separately to keep this
    // line meaning "there is an item at `slot`".
    if (!inventoryRef.isValidIndex(slot) || inventoryRef.isSlotEmpty(slot)) return 0;
    // Tier of the item drives the feedback flash (Common/Uncommon/Rare
    // buttons exist; anything higher pulses the top "Rare" button). Read
    // it before destroyItemAtSlot clears the slot.
    int tierIndex = 2;
    if (const auto* item = inventoryRef.peekItem(slot)) {
        dof::entities::QualityTier tier = dof::entities::QualityTier::Common;
        if (item->isWeapon())    tier = item->weapon->tier();
        else if (item->isDice()) tier = item->dice->tier();
        if (tier == dof::entities::QualityTier::Common)        tierIndex = 0;
        else if (tier == dof::entities::QualityTier::Uncommon) tierIndex = 1;
        else                                                   tierIndex = 2;
    }
    const int destroyed =
        dof::hubs::destroyItemAtSlot(inventoryRef, *powderHubPtr, slot, configRef);
    if (destroyed > 0) {
        if (inventoryRendererPtr) inventoryRendererPtr->triggerDestroyFlash(tierIndex);
    }
    return destroyed;
}

int InteractionController::destroyHoveredInventoryItem() {
    if (!uiStateRef.isInventoryOpen) return 0;
    if (uiStateRef.hover.kind != HoverTargetKind::InventorySlot) return 0;
    return destroyInventoryItem(uiStateRef.hover.rowIndex);
}

bool InteractionController::clickSortButton(int buttonIndex) {
    // SA27 — spec §Inventory L2254-L2256. 0 = sort by tier, 1 = sort
    // by type, 2 = toggle auto-sort. Buttons 0/1 also update the
    // auto-sort key so a subsequent auto-sort toggle uses the most
    // recently clicked manual sort axis (matches typical inventory-UI
    // expectations).
    switch (buttonIndex) {
        case 0:
            inventoryRef.setAutoSortKey(dof::hubs::InventoryHub::AutoSortKey::Tier);
            inventoryRef.sortByTier();
            return true;
        case 1:
            inventoryRef.setAutoSortKey(dof::hubs::InventoryHub::AutoSortKey::Type);
            inventoryRef.sortByType();
            return true;
        case 2:
            inventoryRef.setAutoSortEnabled(!inventoryRef.isAutoSortEnabled());
            return true;
        default:
            return false;
    }
}

void InteractionController::updateMouseUi(sf::Vector2f cursorUi) {
    uiStateRef.mouseUi = cursorUi;
    if (uiStateRef.drag.isActive()) uiStateRef.drag.cursorUi = cursorUi;
}

void InteractionController::updateHover(const InventoryLayout& inventoryLayout,
                                        const WeaponSlotLayout& weaponSlotLayout,
                                        sf::Vector2f cursorWorld) {
    HoverState next;
    if (uiStateRef.isInventoryOpen) {
        const int sortIndex = inventoryLayout.sortButtonIndexAt(uiStateRef.mouseUi);
        if (sortIndex >= 0) {
            next.kind = HoverTargetKind::SortButton;
            next.rowIndex = sortIndex;
            uiStateRef.hover = next;
            return;
        }
        const int destroyIndex = inventoryLayout.destroyButtonIndexAt(uiStateRef.mouseUi);
        if (destroyIndex >= 0) {
            next.kind = HoverTargetKind::DestroyButton;
            next.rowIndex = destroyIndex;
            uiStateRef.hover = next;
            return;
        }
        const int rawSlot = inventoryLayout.slotIndexAt(uiStateRef.mouseUi);
        const int slot = rawSlot >= 0 ? inventoryRef.resolvePrimarySlot(rawSlot) : rawSlot;
        if (slot >= 0) {
            next.kind = HoverTargetKind::InventorySlot;
            next.rowIndex = slot;
            uiStateRef.hover = next;
            return;
        }
    }
    const int rowHit = weaponSlotLayout.rowIndexAt(uiStateRef.mouseUi);
    if (rowHit >= 0 && weaponSlotRef.isRowUnlocked(rowHit)) {
        const int cells = weaponSlotLayout.diceCellsPerRow();
        // Exact hit-zones (weapon-hover UX fix). The row is sliced into
        // three drawn columns — weapon (left) | dice band (middle) |
        // progress (right). Hover is now tested against each column's
        // EXACT drawn rect, not an inflated dice-cell halo. Previously
        // every dice cell was inflated by ITEM_HOVER_MARGIN (30 px) on
        // each side; cell 0's halo bled ~30 px LEFT across the whole
        // 42 px weapon column, so hovering the drawn weapon icon
        // registered as a DiceCell instead of the weapon. Testing the
        // weapon column first against weaponZoneRect, then mapping the
        // dice band to a full-height column slice, makes each zone match
        // exactly what is painted: the weapon icon is the weapon, the
        // dice band is the dice, with no overlap.
        const auto weaponZone = weaponSlotLayout.weaponZoneRect(rowHit);
        if (weaponZone.contains(uiStateRef.mouseUi)) {
            next.kind = HoverTargetKind::WeaponRow;
            next.rowIndex = rowHit;
            uiStateRef.hover = next;
            return;
        }
        const auto diceZone = weaponSlotLayout.diceZoneRect(rowHit);
        if (cells > 0 && diceZone.contains(uiStateRef.mouseUi)) {
            const float cellWidth = diceZone.size.x / static_cast<float>(cells);
            int cellIndex = static_cast<int>((uiStateRef.mouseUi.x - diceZone.position.x) / cellWidth);
            if (cellIndex < 0) cellIndex = 0;
            if (cellIndex >= cells) cellIndex = cells - 1;
            next.kind = HoverTargetKind::DiceCell;
            next.rowIndex = rowHit;
            next.cellIndex = cellIndex;
            uiStateRef.hover = next;
            return;
        }
        next.kind = HoverTargetKind::WeaponRow;
        next.rowIndex = rowHit;
        uiStateRef.hover = next;
        return;
    }
    // Floor-item hover fallback. UI panels (inventory + sidebar) win
    // when the cursor lands on them; only an otherwise-empty hover
    // state lets a floor item claim the tooltip. Pick the closest
    // non-picked floor item whose centre is within
    // FLOOR_ITEM_HOVER_RADIUS of the world cursor — closest-wins
    // breaks ties when two items overlap on the floor.
    const auto& floorItems = worldRef.floorItems();
    float bestDistance = floorItemHoverRadius;
    const dof::entities::FloorItem* bestItem = nullptr;
    for (const auto& floorItem : floorItems) {
        if (!floorItem) continue;
        if (floorItem->pickupable().isPickedUp) continue;
        const float distance = dof::helpers::distanceBetween(floorItem->position(), cursorWorld);
        if (distance > bestDistance) continue;
        bestDistance = distance;
        bestItem     = floorItem.get();
    }
    if (bestItem) {
        next.kind        = HoverTargetKind::FloorItem;
        next.floorItemId = bestItem->id();
    }
    uiStateRef.hover = next;
}

bool InteractionController::handleLeftClick(const InventoryLayout& inventoryLayout,
                                            const WeaponSlotLayout& weaponSlotLayout) {
    if (uiStateRef.drag.isActive()) return false;
    if (uiStateRef.isInventoryOpen) {
        const int sortIndex = inventoryLayout.sortButtonIndexAt(uiStateRef.mouseUi);
        if (sortIndex >= 0) {
            clickSortButton(sortIndex);
            return true;
        }
        const int destroyIndex = inventoryLayout.destroyButtonIndexAt(uiStateRef.mouseUi);
        if (destroyIndex >= 0) {
            clickDestroyButton(destroyIndex);
            return true;
        }
        const int rawSlot = inventoryLayout.slotIndexAt(uiStateRef.mouseUi);
        const int slot = rawSlot >= 0 ? inventoryRef.resolvePrimarySlot(rawSlot) : rawSlot;
        // Presence, not vacancy: only a slot that actually holds something can
        // start a drag.
        const auto* draggedItem = slot >= 0 ? inventoryRef.peekItem(slot) : nullptr;
        if (draggedItem && !draggedItem->isEmpty()) {
            uiStateRef.drag.source = DragSourceKind::Inventory;
            uiStateRef.drag.sourceRowIndex = slot;
            uiStateRef.drag.sourceCellIndex = -1;
            uiStateRef.drag.payload = inventoryRef.takeItemFrom(slot);
            uiStateRef.drag.cursorUi = uiStateRef.mouseUi;
            return true;
        }
    }
    const int row = weaponSlotLayout.rowIndexAt(uiStateRef.mouseUi);
    if (row >= 0) {
        const int cells = weaponSlotLayout.diceCellsPerRow();
        for (int c = 0; c < cells; ++c) {
            // Presence, not vacancy: `isDiceCellEmpty` is now false for inert
            // and locked cells as well as filled ones, so only `peekDice`
            // still means "there is a die here to pick up". An inert cell
            // falls through to the weapon drag below, as it always has.
            if (weaponSlotLayout.diceCellRect(row, c).contains(uiStateRef.mouseUi)
                && weaponSlotRef.peekDice(row, c) != nullptr) {
                uiStateRef.drag.source = DragSourceKind::DiceCell;
                uiStateRef.drag.sourceRowIndex = row;
                uiStateRef.drag.sourceCellIndex = c;
                uiStateRef.drag.payload = dof::hubs::InventoryItem::makeDice(weaponSlotRef.unslotDice(row, c));
                uiStateRef.drag.cursorUi = uiStateRef.mouseUi;
                return true;
            }
        }
        if (!weaponSlotRef.isRowEmpty(row)) {
            // card-mpkwji9p — `unequipFrom` now drains the row's dice
            // into the outgoing weapon entity; the dice ride along with
            // the weapon through the drag payload and back into any
            // future equip target's cells. No manual drain needed.
            uiStateRef.drag.source = DragSourceKind::WeaponSlot;
            uiStateRef.drag.sourceRowIndex = row;
            uiStateRef.drag.sourceCellIndex = -1;
            uiStateRef.drag.payload = dof::hubs::InventoryItem::makeWeapon(weaponSlotRef.unequipFrom(row));
            uiStateRef.drag.cursorUi = uiStateRef.mouseUi;
            return true;
        }
    }
    return false;
}

bool InteractionController::handleLeftRelease(const InventoryLayout& inventoryLayout,
                                              const WeaponSlotLayout& weaponSlotLayout,
                                              sf::Vector2f cursorWorld) {
    if (!uiStateRef.drag.isActive()) {
        uiStateRef.drag.clear();
        return false;
    }

    if (uiStateRef.isInventoryOpen) {
        const int rawSlot = inventoryLayout.slotIndexAt(uiStateRef.mouseUi);
        const int slot = rawSlot >= 0 ? inventoryRef.resolvePrimarySlot(rawSlot) : rawSlot;
        if (slot >= 0) {
            return releaseToInventorySlot(slot);
        }
        // Released inside the open panel's chrome (powder column, sort
        // strip, title band, inter-cell gaps) rather than on a slot —
        // hand the payload back to its origin instead of falling through
        // to the floor-drop below, which would otherwise eject it into
        // the world at the (possibly unreachable) cursor world position.
        if (inventoryLayout.containsPoint(uiStateRef.mouseUi)) {
            returnPayloadToSource();
            return true;
        }
    }

    const int row = weaponSlotLayout.rowIndexAt(uiStateRef.mouseUi);
    if (row >= 0) {
        const int cells = weaponSlotLayout.diceCellsPerRow();
        for (int c = 0; c < cells; ++c) {
            if (weaponSlotLayout.diceCellRect(row, c).contains(uiStateRef.mouseUi)) {
                return releaseToDiceCell(row, c);
            }
        }
        return releaseToWeaponRow(row);
    }

    auto payload = std::move(uiStateRef.drag.payload);
    uiStateRef.drag.clear();
    return dropItemToFloor(std::move(payload), cursorWorld);
}

bool InteractionController::releaseToInventorySlot(int targetSlot) {
    auto payload = std::move(uiStateRef.drag.payload);
    const DragSourceKind source = uiStateRef.drag.source;
    const int sourceRow = uiStateRef.drag.sourceRowIndex;
    const int sourceCell = uiStateRef.drag.sourceCellIndex;
    uiStateRef.drag.clear();

    if (payload.isWeapon()) {
        // Weapons need a 2-cell same-row pair. Try the drop target first;
        // whatever the grid refuses comes back and goes to the source.
        if (inventoryRef.canPlaceWeaponAt(targetSlot)) {
            payload = inventoryRef.storeAt(targetSlot, std::move(payload));
            if (payload.isEmpty()) return true;
        }
        if (source == DragSourceKind::Inventory
            && inventoryRef.peek(targetSlot) != nullptr
            && targetSlot != sourceRow) {
            auto evicted = inventoryRef.takeItemFrom(targetSlot);
            if (inventoryRef.canPlaceWeaponAt(targetSlot)) {
                payload = inventoryRef.storeAt(targetSlot, std::move(payload));
                storeOrDropItem(std::move(evicted));
                if (payload.isEmpty()) return true;
            } else {
                storeOrDropItem(std::move(evicted));
            }
        }
        // First free pair, or back to the source when the grid has none: the
        // hub hands the weapon back either way, so no pre-flight
        // hasSpaceForWeapon() check is needed to keep it alive.
        payload = inventoryRef.storeItemAtFirstEmpty(std::move(payload));
        if (!payload.isEmpty())
            restorePayloadToSource(std::move(payload), source, sourceRow, sourceCell);
        return true;
    }

    // Dice: single-cell drop. Total by construction — accepted returns,
    // refused goes back to the source — so nothing can fall through into the
    // swap below and evict the slot this just filled.
    if (inventoryRef.isSlotEmpty(targetSlot)) {
        payload = inventoryRef.storeAt(targetSlot, std::move(payload));
        if (!payload.isEmpty())
            restorePayloadToSource(std::move(payload), source, sourceRow, sourceCell);
        return true;
    }
    if (source == DragSourceKind::Inventory && targetSlot != sourceRow) {
        auto evicted = inventoryRef.takeItemFrom(targetSlot);
        payload = inventoryRef.storeAt(targetSlot, std::move(payload));
        if (!payload.isEmpty())
            restorePayloadToSource(std::move(payload), source, sourceRow, sourceCell);
        // The source slot is where the evicted item belongs; a weapon that
        // does not fit that pair simply bounces back and lands in the first
        // pair that does.
        auto rejectedEvicted = inventoryRef.storeAt(sourceRow, std::move(evicted));
        if (!rejectedEvicted.isEmpty()) storeOrDropItem(std::move(rejectedEvicted));
        return true;
    }
    // Target slot occupied and not a same-inventory swap — send the item to the
    // first empty grid slot, or back to its source if the grid is full.
    payload = inventoryRef.storeItemAtFirstEmpty(std::move(payload));
    if (!payload.isEmpty())
        restorePayloadToSource(std::move(payload), source, sourceRow, sourceCell);
    return true;
}

bool InteractionController::releaseToWeaponRow(int targetRow) {
    auto payload = std::move(uiStateRef.drag.payload);
    const DragSourceKind source = uiStateRef.drag.source;
    const int sourceRow = uiStateRef.drag.sourceRowIndex;
    const int sourceCell = uiStateRef.drag.sourceCellIndex;
    uiStateRef.drag.clear();
    if (!weaponSlotRef.isRowUnlocked(targetRow)) {
        restorePayloadToSource(std::move(payload), source, sourceRow, sourceCell);
        return false;
    }
    if (!payload.isWeapon()) {
        // Invalid drop (non-weapon on a weapon row): return it to its source
        // rather than risk losing it to a full grid.
        restorePayloadToSource(std::move(payload), source, sourceRow, sourceCell);
        return false;
    }
    if (weaponSlotRef.isRowEmpty(targetRow)) {
        // The row is unlocked (guarded above) and empty, so the hub keeps the
        // weapon; anything it hands back goes home instead of dying here.
        payload.weapon = weaponSlotRef.equipAt(targetRow, std::move(payload.weapon));
        if (!payload.weapon) return true;
        restorePayloadToSource(std::move(payload), source, sourceRow, sourceCell);
        return false;
    }
    if (source == DragSourceKind::WeaponSlot && targetRow != sourceRow) {
        // card-mpkwji9p — equip/unequip auto-migrate the row's dice
        // through the weapon entity, so two swaps suffice: the evicted
        // weapon picks up its row's dice on the way out, and the
        // payload weapon drops any attached dice into the destination
        // row's cells as it lands.
        auto evicted = weaponSlotRef.unequipFrom(targetRow);
        if (auto rejected = weaponSlotRef.equipAt(targetRow, std::move(payload.weapon)))
            storeOrDropItem(dof::hubs::InventoryItem::makeWeapon(std::move(rejected)));
        if (auto rejected = weaponSlotRef.equipAt(sourceRow, std::move(evicted)))
            storeOrDropItem(dof::hubs::InventoryItem::makeWeapon(std::move(rejected)));
        return true;
    }
    // Destination guard, not an eviction guard: with no room in the grid for
    // the weapon this row is wearing, the swap is refused outright rather than
    // ejecting that weapon onto the floor.
    if (!inventoryRef.hasSpaceForWeapon()) {
        restorePayloadToSource(std::move(payload), source, sourceRow, sourceCell);
        return false;
    }
    auto evicted = weaponSlotRef.unequipFrom(targetRow);
    if (auto rejected = weaponSlotRef.equipAt(targetRow, std::move(payload.weapon)))
        storeOrDropItem(dof::hubs::InventoryItem::makeWeapon(std::move(rejected)));
    if (evicted) storeOrDropItem(dof::hubs::InventoryItem::makeWeapon(std::move(evicted)));
    return true;
}

bool InteractionController::releaseToDiceCell(int targetRow, int targetCell) {
    auto payload = std::move(uiStateRef.drag.payload);
    const DragSourceKind source = uiStateRef.drag.source;
    const int sourceRow = uiStateRef.drag.sourceRowIndex;
    const int sourceCell = uiStateRef.drag.sourceCellIndex;
    uiStateRef.drag.clear();
    if (!weaponSlotRef.isRowUnlocked(targetRow)) {
        restorePayloadToSource(std::move(payload), source, sourceRow, sourceCell);
        return false;
    }
    if (!payload.isDice()) {
        // Invalid drop (non-dice on a dice cell): return to source, never lose it.
        restorePayloadToSource(std::move(payload), source, sourceRow, sourceCell);
        return false;
    }
    // `isDiceCellEmpty` now carries the slot-count gate itself, so the drop
    // target no longer has to re-derive `maxSlotsForRow` to avoid feeding the
    // placer a die it would refuse.
    if (weaponSlotRef.isDiceCellEmpty(targetRow, targetCell)) {
        payload.dice = weaponSlotRef.slotDiceAt(targetRow, targetCell, std::move(payload.dice));
        if (!payload.dice) return true;
        restorePayloadToSource(std::move(payload), source, sourceRow, sourceCell);
        return false;
    }
    if (weaponSlotRef.peekDice(targetRow, targetCell) == nullptr) {
        // Not empty and holding nothing: an inert cell (past the equipped
        // Weapon's slotCount, or a row with no weapon at all). The hit-test
        // walks every physical cell, so these are invisible-but-live drop
        // targets — treat the drop as invalid and hand the die back to where
        // it was dragged from.
        restorePayloadToSource(std::move(payload), source, sourceRow, sourceCell);
        return false;
    }
    if (source == DragSourceKind::DiceCell) {
        auto evicted = weaponSlotRef.unslotDice(targetRow, targetCell);
        payload.dice = weaponSlotRef.slotDiceAt(targetRow, targetCell, std::move(payload.dice));
        if (payload.dice)
            restorePayloadToSource(std::move(payload), source, sourceRow, sourceCell);
        if (auto rejected = weaponSlotRef.slotDiceAt(sourceRow, sourceCell, std::move(evicted)))
            storeOrDropItem(dof::hubs::InventoryItem::makeDice(std::move(rejected)));
        return true;
    }
    // Destination guard, not an eviction guard: with no room in the grid for
    // the die this cell is wearing, the swap is refused outright rather than
    // ejecting that die onto the floor.
    if (!inventoryRef.hasSpace()) {
        restorePayloadToSource(std::move(payload), source, sourceRow, sourceCell);
        return false;
    }
    auto evicted = weaponSlotRef.unslotDice(targetRow, targetCell);
    payload.dice = weaponSlotRef.slotDiceAt(targetRow, targetCell, std::move(payload.dice));
    if (payload.dice)
        restorePayloadToSource(std::move(payload), source, sourceRow, sourceCell);
    if (evicted) storeOrDropItem(dof::hubs::InventoryItem::makeDice(std::move(evicted)));
    return true;
}

void InteractionController::returnPayloadToSource() {
    auto payload = std::move(uiStateRef.drag.payload);
    const DragSourceKind source = uiStateRef.drag.source;
    const int sourceRow = uiStateRef.drag.sourceRowIndex;
    const int sourceCell = uiStateRef.drag.sourceCellIndex;
    uiStateRef.drag.clear();
    restorePayloadToSource(std::move(payload), source, sourceRow, sourceCell);
}

void InteractionController::restorePayloadToSource(dof::hubs::InventoryItem payload,
        DragSourceKind source, int sourceRow, int sourceCell) {
    if (payload.isEmpty()) return;
    // Each step hands the payload straight back when the source cannot take
    // it, so a source that filled up behind the drag falls through to the
    // next option instead of swallowing the item.
    if (source == DragSourceKind::Inventory && inventoryRef.isSlotEmpty(sourceRow)) {
        payload = inventoryRef.storeAt(sourceRow, std::move(payload));
        if (payload.isEmpty()) return;
    }
    if (source == DragSourceKind::WeaponSlot && payload.isWeapon()
        && weaponSlotRef.isRowUnlocked(sourceRow)
        && weaponSlotRef.isRowEmpty(sourceRow)) {
        payload.weapon = weaponSlotRef.equipAt(sourceRow, std::move(payload.weapon));
        if (!payload.weapon) return;
    }
    // `isDiceCellEmpty` now covers the row-unlocked test (and the slot-count
    // one), so the hand-rolled isRowUnlocked companion is gone.
    if (source == DragSourceKind::DiceCell && payload.isDice()
        && weaponSlotRef.isDiceCellEmpty(sourceRow, sourceCell)) {
        payload.dice = weaponSlotRef.slotDiceAt(sourceRow, sourceCell, std::move(payload.dice));
        if (!payload.dice) return;
    }
    storeOrDropItem(std::move(payload));
}

void InteractionController::storeOrDropItem(dof::hubs::InventoryItem item) {
    if (item.isEmpty()) return;
    item = inventoryRef.storeItemAtFirstEmpty(std::move(item));
    if (item.isEmpty()) return;
    // The grid had no room. The floor never refuses, so the item lands next
    // to the hero — visible and pickable — instead of being destroyed by a
    // sink that could not keep it.
    dropItemToFloor(std::move(item), worldRef.hero().moveable().position);
}

bool InteractionController::handleRightClick(const InventoryLayout& inventoryLayout,
                                             const WeaponSlotLayout& weaponSlotLayout) {
    if (uiStateRef.isInventoryOpen) {
        const int rawSlot = inventoryLayout.slotIndexAt(uiStateRef.mouseUi);
        const int slot = rawSlot >= 0 ? inventoryRef.resolvePrimarySlot(rawSlot) : rawSlot;
        // Presence, not vacancy — `peekItem` is null for an out-of-range slot
        // and empty for a free one.
        const auto* item = slot >= 0 ? inventoryRef.peekItem(slot) : nullptr;
        if (item && !item->isEmpty()) {
            if (item->isDice()) return autoSlotDiceFromInventory(slot);
            return autoEquipInventorySlot(slot);
        }
    }
    const int row = weaponSlotLayout.rowIndexAt(uiStateRef.mouseUi);
    if (row >= 0) {
        const int cells = weaponSlotLayout.diceCellsPerRow();
        for (int c = 0; c < cells; ++c) {
            // Presence check — see handleLeftClick: a right-click on an inert
            // cell keeps falling through to the weapon-row unequip below.
            if (weaponSlotLayout.diceCellRect(row, c).contains(uiStateRef.mouseUi)
                && weaponSlotRef.peekDice(row, c) != nullptr) {
                return autoUnslotDiceCell(row, c);
            }
        }
        if (!weaponSlotRef.isRowEmpty(row)) return autoUnequipWeaponRow(row);
    }
    return false;
}

}
