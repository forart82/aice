#pragma once

#include <SFML/Graphics/Color.hpp>

namespace dof::loaders { class ConfigLoader; }

namespace dof::render {

struct HealthRamp {
    float     highThreshold{0.5f};
    float     lowThreshold{0.25f};
    sf::Color highColor;
    sf::Color midColor;
    sf::Color lowColor;

    static HealthRamp loadFromConfig(const dof::loaders::ConfigLoader& config);
    sf::Color         colorFor(float ratio) const;
};

}
