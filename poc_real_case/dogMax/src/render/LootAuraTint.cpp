#include "render/LootAuraTint.hpp"

#include "loaders/ConfigLoader.hpp"

namespace dof::render {

LootAuraTint computeLootAuraTint(dof::entities::QualityTier tier,
                                  const dof::loaders::ConfigLoader& config) {
    switch (tier) {
        case dof::entities::QualityTier::Uncommon:
            return LootAuraTint{
                config.getFloat("LOOT_AURA_RADIUS_MULT_UNCOMMON"),
                config.getFloat("LOOT_AURA_ALPHA_MULT_UNCOMMON")};
        case dof::entities::QualityTier::Rare:
            return LootAuraTint{
                config.getFloat("LOOT_AURA_RADIUS_MULT_RARE"),
                config.getFloat("LOOT_AURA_ALPHA_MULT_RARE")};
        case dof::entities::QualityTier::Common:
        default:
            return LootAuraTint{
                config.getFloat("LOOT_AURA_RADIUS_MULT_COMMON"),
                config.getFloat("LOOT_AURA_ALPHA_MULT_COMMON")};
    }
}

}
