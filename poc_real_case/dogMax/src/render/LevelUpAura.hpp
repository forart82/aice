#pragma once

// card-mpl0vatr — visible "more glory" level-up effect. The Hero
// entity already maintains a `levelUpFlash` ramp that decays over
// time, but no renderer ever read it (partial wiring shipped under
// SA / B-UX without a draw site). This module paints an expanding
// concentric ring burst that decays as the flash ramp fades, so the
// player sees a bright multi-ring pulse the moment the hero levels
// up.
//
// The params struct is config-loaded once per renderer so the live
// `drawHeroLevelUpAura` call needs no ConfigLoader access at frame
// time. All values come from `hero.yaml` keys with `HERO_LEVEL_UP_*`
// prefix — no hard-coded magic numbers.

#include <SFML/Graphics/Color.hpp>

namespace dof::entities { class Hero; }
namespace dof::loaders  { class ConfigLoader; }
namespace sf            { class RenderTarget; }

namespace dof::render {

struct LevelUpAuraParams {
    int       ringCount{3};
    float     ringBaseRadiusMult{1.4f};
    float     ringStepRadiusMult{0.5f};
    float     ringExpansionMult{2.2f};
    float     ringThickness{3.0f};
    float     ringAlphaPeak{220.0f};
    sf::Color ringColor{255, 240, 120, 255};
    // Mirror of `Hero::levelUpFlashInitial` — needed to normalise the
    // live `hero.levelUpFlash()` reading back into [0, 1] so the ring
    // expansion ramp stays well-defined. Loaded from the same config
    // key the entity reads (`HERO_LEVEL_UP_FLASH_INITIAL`).
    float     flashInitial{1.5f};
};

LevelUpAuraParams loadLevelUpAuraParams(const dof::loaders::ConfigLoader& config);

// Paint the level-up aura when the hero's flash ramp is positive.
// No-op when flash is zero, so the call site can fire unconditionally
// every frame without branching first. The ring count + radii come
// from `params`; the live flash value drives ring alpha + outward
// expansion (rings start tight at the body and fan outward as the
// flash decays so the burst reads as a "growing shockwave" instead
// of a static halo).
void drawHeroLevelUpAura(sf::RenderTarget& window,
                          const dof::entities::Hero& hero,
                          float heroRadius,
                          const LevelUpAuraParams& params,
                          float interpolationAlpha);

}
