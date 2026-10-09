#pragma once

#include "hubs/InventoryItem.hpp"
#include "render/UiState.hpp"

#include <SFML/Graphics/Rect.hpp>
#include <SFML/System/Vector2.hpp>

namespace dof::core { class World; }
namespace dof::hubs { class InventoryHub; class WeaponSlotHub; class PowderHub; }
namespace dof::loaders { class ConfigLoader; }

namespace dof::render {

class InventoryLayout;
class WeaponSlotLayout;
class InventoryRenderer;

class InteractionController {
public:
    InteractionController(dof::core::World& world,
                          dof::hubs::InventoryHub& inventoryHub,
                          dof::hubs::WeaponSlotHub& weaponSlotHub,
                          UiState& uiState,
                          const dof::loaders::ConfigLoader& config);

    void updateMouseUi(sf::Vector2f cursorUi);
    void updateHover(const InventoryLayout& inventoryLayout,
                     const WeaponSlotLayout& weaponSlotLayout,
                     sf::Vector2f cursorWorld);

    bool handleLeftClick(const InventoryLayout& inventoryLayout, const WeaponSlotLayout& weaponSlotLayout);
    bool handleLeftRelease(const InventoryLayout& inventoryLayout,
                           const WeaponSlotLayout& weaponSlotLayout,
                           sf::Vector2f cursorWorld);
    bool handleRightClick(const InventoryLayout& inventoryLayout, const WeaponSlotLayout& weaponSlotLayout);

    bool autoEquipInventorySlot(int slotIndex);
    bool autoUnequipWeaponRow(int rowIndex);
    bool autoUnslotDiceCell(int rowIndex, int cellIndex);
    void setPowderHub(dof::hubs::PowderHub& powderHub);
    void setInventoryRenderer(InventoryRenderer& inventoryRenderer);
    int  clickDestroyButton(int tierIndex);
    // Destroys exactly the single item at `slotIndex` (resolving the
    // primary slot of a 2-cell weapon) into powder via destroyItemAtSlot.
    // Flashes the destroyed item's tier button for feedback. Returns the
    // number destroyed (0 or 1). Destroys the item at a given slot
    // index directly.
    int  destroyInventoryItem(int slotIndex);
    // Destroys the inventory item currently under the cursor — reads
    // uiState.hover (InventorySlot) and delegates to destroyInventoryItem.
    // This is the X-key player path. Returns the number destroyed (0/1).
    int  destroyHoveredInventoryItem();
    // SA27 — sort button click. buttonIndex 0=tier, 1=type, 2=auto.
    // Returns true if the click landed on a button (so callers can
    // short-circuit further hit-tests on the same press).
    bool clickSortButton(int buttonIndex);
    bool autoSlotDiceFromInventory(int slotIndex);
    bool moveBetweenInventorySlots(int fromSlot, int toSlot);
    bool moveInventoryToWeaponRow(int fromSlot, int toRow);
    bool moveWeaponRowToInventoryFirstEmpty(int fromRow);
    bool slotDiceFromInventoryToCell(int fromSlot, int toRow, int toCell);
    bool dropItemToFloor(dof::hubs::InventoryItem item, sf::Vector2f worldPosition);

private:
    bool releaseToInventorySlot(int targetSlot);
    bool releaseToWeaponRow(int targetRow);
    bool releaseToDiceCell(int targetRow, int targetCell);
    void returnPayloadToSource();
    // Restore a moved-out drag payload to the cell/row/slot it came from. A drag
    // vacates its source, so the source is empty and this always succeeds even
    // when the inventory grid is full — the guard against permanent item loss on
    // a failed drop. Falls back to first-empty only if the source is somehow
    // occupied. Called by returnPayloadToSource and by every release fallback
    // that would otherwise hand the payload to a store that destroys on a full grid.
    void restorePayloadToSource(dof::hubs::InventoryItem payload,
                                DragSourceKind source, int sourceRow, int sourceCell);
    // Terminal sink for an item a hub handed back: put it in the first free
    // grid slot, and when the grid cannot take it drop it on the floor next
    // to the hero. The floor never refuses, so this call cannot lose the
    // item — every hand-back with nowhere better to go ends here.
    void storeOrDropItem(dof::hubs::InventoryItem item);

    dof::core::World&                 worldRef;
    dof::hubs::InventoryHub&          inventoryRef;
    dof::hubs::WeaponSlotHub&         weaponSlotRef;
    UiState&                          uiStateRef;
    const dof::loaders::ConfigLoader& configRef;
    dof::hubs::PowderHub*             powderHubPtr{nullptr};
    InventoryRenderer*           inventoryRendererPtr{nullptr};
    float                             floorPickupRadius;
    float                             floorItemHoverRadius;
};

}
