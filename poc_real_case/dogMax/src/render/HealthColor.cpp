#include "render/HealthColor.hpp"

#include "loaders/ConfigLoader.hpp"
#include "render/ColorTheme.hpp"

namespace dof::render {

HealthRamp HealthRamp::loadFromConfig(const dof::loaders::ConfigLoader& config) {
    HealthRamp ramp{};
    ramp.highThreshold = config.getFloat("HP_RAMP_HIGH_THRESHOLD");
    ramp.lowThreshold  = config.getFloat("HP_RAMP_LOW_THRESHOLD");
    ramp.highColor = readRgb(config, "HP_RAMP_GREEN_R",  "HP_RAMP_GREEN_G",  "HP_RAMP_GREEN_B");
    ramp.midColor  = readRgb(config, "HP_RAMP_YELLOW_R", "HP_RAMP_YELLOW_G", "HP_RAMP_YELLOW_B");
    ramp.lowColor  = readRgb(config, "HP_RAMP_RED_R",    "HP_RAMP_RED_G",    "HP_RAMP_RED_B");
    return ramp;
}

sf::Color HealthRamp::colorFor(float ratio) const {
    if (ratio > highThreshold) return highColor;
    if (ratio > lowThreshold)  return midColor;
    return lowColor;
}

}
