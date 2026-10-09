#pragma once

#include <SFML/Audio/Music.hpp>

namespace dof::loaders { class ConfigLoader; }

namespace dof::audio {

class BackgroundMusic {
public:
    explicit BackgroundMusic(const dof::loaders::ConfigLoader& config);

private:
    sf::Music music;
};

}
