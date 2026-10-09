#include "render/ColorTheme.hpp"

#include "loaders/ConfigLoader.hpp"

#include <cstdint>
#include <string>

namespace dof::render {

namespace {

std::uint8_t byteValue(const dof::loaders::ConfigLoader& config, const std::string& key) {
    return static_cast<std::uint8_t>(config.getInt(key));
}

}

sf::Color readRgb(const dof::loaders::ConfigLoader& config,
                  const std::string& redKey,
                  const std::string& greenKey,
                  const std::string& blueKey) {
    return sf::Color{byteValue(config, redKey),
                     byteValue(config, greenKey),
                     byteValue(config, blueKey)};
}

sf::Color readRgba(const dof::loaders::ConfigLoader& config,
                   const std::string& redKey,
                   const std::string& greenKey,
                   const std::string& blueKey,
                   const std::string& alphaKey) {
    return sf::Color{byteValue(config, redKey),
                     byteValue(config, greenKey),
                     byteValue(config, blueKey),
                     byteValue(config, alphaKey)};
}

sf::Color readRgbPrefixed(const dof::loaders::ConfigLoader& config,
                          const std::string& base,
                          int alpha) {
    return sf::Color{byteValue(config, base + "_R"),
                     byteValue(config, base + "_G"),
                     byteValue(config, base + "_B"),
                     static_cast<std::uint8_t>(alpha)};
}

sf::Color readRgba(const dof::loaders::ConfigLoader& config,
                   const std::string& base) {
    return readRgba(config, base + "_R", base + "_G", base + "_B", base + "_ALPHA");
}

ColorTheme buildColorTheme(const dof::loaders::ConfigLoader& config) {
    ColorTheme theme{};
    theme.heroOutline = readRgb(config, "HERO_OUTLINE_R", "HERO_OUTLINE_G", "HERO_OUTLINE_B");
    theme.heroFill    = readRgb(config, "HERO_FILL_R",    "HERO_FILL_G",    "HERO_FILL_B");

    theme.enemyOutlineCommon   = readRgb(config, "ENEMY_OUTLINE_R",          "ENEMY_OUTLINE_G",          "ENEMY_OUTLINE_B");
    theme.enemyOutlineUncommon = readRgb(config, "ENEMY_OUTLINE_R_UNCOMMON", "ENEMY_OUTLINE_G_UNCOMMON", "ENEMY_OUTLINE_B_UNCOMMON");
    theme.enemyOutlineRare     = readRgb(config, "ENEMY_OUTLINE_R_RARE",     "ENEMY_OUTLINE_G_RARE",     "ENEMY_OUTLINE_B_RARE");
    theme.enemyFill            = readRgb(config, "ENEMY_FILL_R", "ENEMY_FILL_G", "ENEMY_FILL_B");

    theme.pitchforkOutline = readRgb(config, "PITCHFORK_OUTLINE_R", "PITCHFORK_OUTLINE_G", "PITCHFORK_OUTLINE_B");
    theme.pitchforkFill    = readRgb(config, "PITCHFORK_FILL_R",    "PITCHFORK_FILL_G",    "PITCHFORK_FILL_B");

    theme.uiText = readRgb(config, "THEME_UI_TEXT_R", "THEME_UI_TEXT_G", "THEME_UI_TEXT_B");
    theme.uiDim  = readRgb(config, "THEME_UI_DIM_R",  "THEME_UI_DIM_G",  "THEME_UI_DIM_B");
    theme.hpBarBg   = readRgb(config, "THEME_HP_BAR_BG_R",   "THEME_HP_BAR_BG_G",   "THEME_HP_BAR_BG_B");
    theme.windowBackground = readRgb(config, "WINDOW_BG_R", "WINDOW_BG_G", "WINDOW_BG_B");

    theme.tierCommon   = readRgb(config, "QUALITY_TIER_COMMON_R",   "QUALITY_TIER_COMMON_G",   "QUALITY_TIER_COMMON_B");
    theme.tierUncommon = readRgb(config, "QUALITY_TIER_UNCOMMON_R", "QUALITY_TIER_UNCOMMON_G", "QUALITY_TIER_UNCOMMON_B");
    theme.tierRare     = readRgb(config, "QUALITY_TIER_RARE_R",     "QUALITY_TIER_RARE_G",     "QUALITY_TIER_RARE_B");

    theme.haloThickness = config.getInt("THEME_HALO_OUTLINE_THICKNESS");
    theme.haloLayers    = config.getInt("THEME_HALO_GLOW_LAYERS");
    theme.haloAlphaBase = config.getInt("THEME_HALO_GLOW_ALPHA_BASE");
    theme.haloRadiusStep = config.getInt("THEME_HALO_GLOW_RADIUS_STEP");

    return theme;
}

sf::Color resolvePanelBackground(const dof::loaders::ConfigLoader& config,
                                 const std::string& overridePrefix) {
    // A per-panel override is present when its `_R` component key exists.
    // Its alpha may be spelled `_A` (newer keys) or `_ALPHA` (older ones);
    // accept whichever the panel declared so no override needs renaming.
    if (config.hasKey(overridePrefix + "_R")) {
        const std::string alphaKey = config.hasKey(overridePrefix + "_A")
                                         ? overridePrefix + "_A"
                                         : overridePrefix + "_ALPHA";
        return readRgba(config,
                        overridePrefix + "_R",
                        overridePrefix + "_G",
                        overridePrefix + "_B",
                        alphaKey);
    }
    return readRgba(config,
                    "THEME_PANEL_BG_R",
                    "THEME_PANEL_BG_G",
                    "THEME_PANEL_BG_B",
                    "THEME_PANEL_BG_A");
}

}
