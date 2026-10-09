#pragma once

#include "core/EntityId.hpp"

namespace dof::core { class World; }
namespace dof::hubs { class InventoryHub; class PowderHub; struct LootFilter; }
namespace dof::loaders { class ConfigLoader; }

namespace dof::hubs {

struct PickupResult {
    bool                pickedUp{false};
    dof::core::EntityId pickedFloorItemId{0};
};

class PickupHub {
public:
    // Absorbs a nearby floor item into the inventory. When `filter` is
    // non-null and the item matches it, the item is powder-converted
    // (via `powderHub` + `config`) and discarded instead of stored —
    // this happens BEFORE the `hasSpace` guard so the filter works even
    // when the inventory is full. `powderHub` and `config` are required
    // when `filter` is non-null; both must outlive this call.
    PickupResult tryAutoPickup(dof::core::World& world,
                               InventoryHub& inventory,
                               PowderHub* powderHub = nullptr,
                               const dof::loaders::ConfigLoader* config = nullptr,
                               const LootFilter* filter = nullptr);
    bool         pickupById(dof::core::World& world, InventoryHub& inventory, dof::core::EntityId floorItemId);
};

}
