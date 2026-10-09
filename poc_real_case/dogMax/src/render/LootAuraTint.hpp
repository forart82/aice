#pragma once

#include "entities/QualityTier.hpp"

namespace dof::loaders { class ConfigLoader; }

namespace dof::render {

// Pure tier->aura mapping used by the floor-item painter. Spec §Loot
// L1985 + §Quality §Aura L1744,L1751: dropped items brighten their
// outline by tier and grow a translucent (Uncommon) / brighter
// (Rare) halo. The values are config-driven so the renderer never
// hard-codes per-tier numbers.
//
// Extracted as a pure helper so the tier-tint computation is
// testable without instantiating the SFML renderer.
struct LootAuraTint {
    float radiusMult;
    float alphaMult;
};

LootAuraTint computeLootAuraTint(dof::entities::QualityTier tier,
                                  const dof::loaders::ConfigLoader& config);

}
