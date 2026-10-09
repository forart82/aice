#include "render/OutlineIntensity.hpp"

#include "loaders/ConfigLoader.hpp"

namespace dof::render {

OutlineIntensityParams loadOutlineIntensityParams(const dof::loaders::ConfigLoader& config) {
    return OutlineIntensityParams{
        config.getFloat("OUTLINE_INTENSITY_MULT_COMMON"),
        config.getFloat("OUTLINE_INTENSITY_MULT_UNCOMMON"),
        config.getFloat("OUTLINE_INTENSITY_MULT_RARE"),
        config.getFloat("OUTLINE_INTENSITY_CHARGED_BONUS")};
}

float computeOutlineIntensityMult(dof::entities::QualityTier tier,
                                   bool isCharged,
                                   const OutlineIntensityParams& params) {
    float base = params.multCommon;
    switch (tier) {
        case dof::entities::QualityTier::Uncommon: base = params.multUncommon; break;
        case dof::entities::QualityTier::Rare:     base = params.multRare;     break;
        case dof::entities::QualityTier::Common:
        default:                                   base = params.multCommon;   break;
    }
    if (isCharged) base += params.chargedBonus;
    return base;
}

}
