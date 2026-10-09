#include "combat/SpecialEnemyGates.hpp"

#include "loaders/ConfigLoader.hpp"

namespace dof::combat {

SpecialEnemyGateParams SpecialEnemyGateParams::loadFromConfig(const dof::loaders::ConfigLoader& config) {
    SpecialEnemyGateParams params;
    params.shockerEveryNthUncommon    = config.getInt("SPECIAL_SHOCKER_EVERY_NTH_UNCOMMON");
    params.shockerHeroLevelGate       = config.getInt("SPECIAL_SHOCKER_HERO_LEVEL_GATE");
    params.hexarchonEveryNthRare      = config.getInt("SPECIAL_HEXARCHON_EVERY_NTH_RARE");
    params.hexarchonHeroLevelGate     = config.getInt("SPECIAL_HEXARCHON_HERO_LEVEL_GATE");
    params.voidcrawlerEveryNthRare    = config.getInt("SPECIAL_VOIDCRAWLER_EVERY_NTH_RARE");
    params.voidcrawlerHeroLevelGate   = config.getInt("SPECIAL_VOIDCRAWLER_HERO_LEVEL_GATE");
    params.glasswraithOneIn           = config.getInt("SPECIAL_GLASSWRAITH_ONE_IN");
    params.glasswraithHeroLevelGate   = config.getInt("SPECIAL_GLASSWRAITH_HERO_LEVEL_GATE");
    return params;
}

void SpecialEnemyCounters::reset() {
    uncommonSinceLastShocker = 0;
    rareSinceLastHexarchon = 0;
    rareSinceLastVoidcrawler = 0;
}

dof::entities::SpecialEnemyKind pickSpecialKind(dof::entities::QualityTier tier,
                                                 const SpecialEnemyCounters& counters,
                                                 int heroLevel,
                                                 bool insideExclusionZone,
                                                 float randomFraction,
                                                 const SpecialEnemyGateParams& params) {
    using dof::entities::QualityTier;
    using dof::entities::SpecialEnemyKind;

    // Glasswraith first — per-spawn dice roll independent of tier.
    // Spec L635: "1-in-1000 chance per spawn after Hero level 5".
    if (heroLevel >= params.glasswraithHeroLevelGate
        && params.glasswraithOneIn > 0
        && randomFraction < 1.0f / static_cast<float>(params.glasswraithOneIn)) {
        return SpecialEnemyKind::Glasswraith;
    }

    if (tier == QualityTier::Uncommon) {
        // Shocker — every 7th Uncommon after Hero ≥ 3.
        if (heroLevel >= params.shockerHeroLevelGate
            && params.shockerEveryNthUncommon > 0
            && (counters.uncommonSinceLastShocker + 1) >= params.shockerEveryNthUncommon) {
            return SpecialEnemyKind::Shocker;
        }
    }

    if (tier == QualityTier::Rare) {
        // Voidcrawler checked BEFORE Hexarchon because its threshold
        // is higher AND it has the extra exclusion-zone constraint;
        // when both gates are open Voidcrawler wins the slot.
        if (heroLevel >= params.voidcrawlerHeroLevelGate
            && insideExclusionZone
            && params.voidcrawlerEveryNthRare > 0
            && (counters.rareSinceLastVoidcrawler + 1) >= params.voidcrawlerEveryNthRare) {
            return SpecialEnemyKind::Voidcrawler;
        }
        if (heroLevel >= params.hexarchonHeroLevelGate
            && params.hexarchonEveryNthRare > 0
            && (counters.rareSinceLastHexarchon + 1) >= params.hexarchonEveryNthRare) {
            return SpecialEnemyKind::Hexarchon;
        }
    }
    return SpecialEnemyKind::None;
}

}
