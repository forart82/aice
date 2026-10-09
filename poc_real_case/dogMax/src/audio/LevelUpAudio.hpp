#pragma once

#include <SFML/Audio/Sound.hpp>
#include <SFML/Audio/SoundBuffer.hpp>

#include <optional>

namespace dof::loaders { class ConfigLoader; }

namespace dof::audio {

class LevelUpAudio {
public:
    explicit LevelUpAudio(const dof::loaders::ConfigLoader& config);

    void play();

private:
    sf::SoundBuffer          buffer;
    std::optional<sf::Sound> sound;
};

} // namespace dof::audio
