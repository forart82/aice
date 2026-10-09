#pragma once

#include "entities/QualityTier.hpp"
#include "render/ColorTheme.hpp"

#include <SFML/Graphics/Color.hpp>

namespace dof::render {

// Spec §Quality §Tier Visual L1798 — the damage text spawned by a
// weapon hit gets a small multiplicative tint from the source item's
// quality tier. Stacks on top of the amount-based tier (Normal /
// Heavy / Critical) so the player sees both signals at once: text
// size + base hue from `DamageTextHub::classifyAmount`, with a hint
// of `theme.tier*` mixed in proportional to `blend`.
//
// `blend = 0` returns `base` unchanged. `blend = 1` returns the
// raw tier palette colour. Sensible defaults sit at 0.30.
//
// Pure helper — no SFML render dependencies — so the blend is
// testable without standing up a window.
sf::Color tintByQuality(sf::Color base,
                        dof::entities::QualityTier sourceTier,
                        float blend,
                        const ColorTheme& theme);

}
