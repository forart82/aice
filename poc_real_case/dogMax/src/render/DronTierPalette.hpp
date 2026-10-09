#pragma once

#include "combat/DronDetector.hpp"

#include <SFML/Graphics/Color.hpp>

namespace dof::loaders { class ConfigLoader; }

namespace dof::render {

// Spec §Dron L1237-L1331 — each of the 14 tiers gets its own
// float-label colour so the player can read tier at a glance.
// Pure helper: looks up the `DRON_TIER_<NAME>_COLOR_{R,G,B}` keys
// in the supplied config and returns the resolved RGB. Falls back
// to the legacy gold (DRON_FLOAT_COLOR_*) if a per-tier key is
// missing so partially-populated configs degrade gracefully.
sf::Color tierFloatColor(dof::combat::DronTier tier,
                         const dof::loaders::ConfigLoader& config);

}
