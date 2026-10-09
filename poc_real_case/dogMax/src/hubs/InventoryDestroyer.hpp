#pragma once

#include "entities/QualityTier.hpp"

namespace dof::hubs {

class InventoryHub;
class PowderHub;

}
namespace dof::loaders { class ConfigLoader; }

namespace dof::hubs {

// Sweeps every inventory slot whose item tier matches `tier`, computes
// powder via PowderCalculator + powderColorFor*, accumulates into the
// PowderHub and clears the slot. Equipped items are not touched (they
// live on WeaponSlotHub, not InventoryHub). Returns the number of slots
// destroyed.
//
// The ConfigLoader is forwarded to PowderCalculator so the scaling
// constants for range / critChance stay data-driven (configs/powder.yaml).
int destroyTierFromInventory(InventoryHub& inventory,
                             PowderHub& powderHub,
                             dof::entities::QualityTier tier,
                             const dof::loaders::ConfigLoader& config);

// Destroys the single item occupying `slot` (must be the resolved primary
// slot — a 2-cell weapon's shadow cell is cleared by takeItemFrom), routing
// its powder into the PowderHub via the same PowderCalculator path as
// destroyTierFromInventory. Returns 1 when an item was destroyed, else 0.
// This is the core powder-conversion step; destroyTierFromInventory sweeps
// the grid and delegates to it for every tier-matching slot.
int destroyItemAtSlot(InventoryHub& inventory,
                      PowderHub& powderHub,
                      int slot,
                      const dof::loaders::ConfigLoader& config);

}
