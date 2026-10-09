#pragma once

#include "entities/QualityTier.hpp"

namespace dof::loaders { class ConfigLoader; }

namespace dof::render {

// Spec §Outline Intensity L298-303 + §Tier Multiplier Reference L1772.
// Per-entity emissive multiplier applied to outline thickness before
// the bloom post-process picks up neon strokes. Tier supplies the
// base mult (Common 1.0 / Uncommon 1.4 / Rare 2.0); the Charged state
// adds a flat +0.5 transient until the next fire.
//
// Pure helper so the (tier, isCharged) -> mult mapping is unit-
// testable without instantiating any SFML state.
struct OutlineIntensityParams {
    float multCommon;
    float multUncommon;
    float multRare;
    float chargedBonus;
};

OutlineIntensityParams loadOutlineIntensityParams(const dof::loaders::ConfigLoader& config);

float computeOutlineIntensityMult(dof::entities::QualityTier tier,
                                   bool isCharged,
                                   const OutlineIntensityParams& params);

}
