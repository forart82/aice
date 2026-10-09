#pragma once

#include <SFML/Graphics/Color.hpp>
#include <string>

namespace dof::loaders { class ConfigLoader; }

namespace dof::render {

struct ColorTheme {
    sf::Color heroOutline;
    sf::Color heroFill;
    sf::Color enemyOutlineCommon;
    sf::Color enemyOutlineUncommon;
    sf::Color enemyOutlineRare;
    sf::Color enemyFill;
    sf::Color pitchforkOutline;
    sf::Color pitchforkFill;

    sf::Color uiText;
    sf::Color uiDim;
    sf::Color hpBarBg;
    sf::Color windowBackground;

    sf::Color tierCommon;
    sf::Color tierUncommon;
    sf::Color tierRare;

    int   haloThickness{4};
    int   haloLayers{3};
    int   haloAlphaBase{110};
    int   haloRadiusStep{4};
};

ColorTheme buildColorTheme(const dof::loaders::ConfigLoader& config);

sf::Color readRgb(const dof::loaders::ConfigLoader& config,
                  const std::string& redKey,
                  const std::string& greenKey,
                  const std::string& blueKey);
sf::Color readRgba(const dof::loaders::ConfigLoader& config,
                   const std::string& redKey,
                   const std::string& greenKey,
                   const std::string& blueKey,
                   const std::string& alphaKey);
sf::Color readRgbPrefixed(const dof::loaders::ConfigLoader& config,
                          const std::string& base,
                          int alpha = 255);
sf::Color readRgba(const dof::loaders::ConfigLoader& config,
                   const std::string& base);

// LIFT PLAN step 7 (G3b) — single source of truth for a framed panel's
// body background. Returns the shared `THEME_PANEL_BG_R/G/B/A` swatch
// from theme.yaml, UNLESS the panel declares an explicit per-panel
// override (`<overridePrefix>_R/G/B` present, with alpha under either
// `<overridePrefix>_A` or `<overridePrefix>_ALPHA`), in which case the
// override wins. Reads straight from the live ConfigLoader — never a
// cached ColorTheme copy — so an in-game `set THEME_PANEL_BG_A=…` or an
// editable-Config-tab commit cascades to every non-overridden window on
// the next applyConfigToRenderers pass (the per-frame live re-apply does
// not rebuild the ColorTheme struct, only the renderers from config).
sf::Color resolvePanelBackground(const dof::loaders::ConfigLoader& config,
                                 const std::string& overridePrefix);

}
