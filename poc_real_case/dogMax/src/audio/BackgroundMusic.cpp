#include "audio/BackgroundMusic.hpp"

#include "loaders/ConfigLoader.hpp"

#include <stdexcept>
#include <string>

namespace dof::audio {

BackgroundMusic::BackgroundMusic(const dof::loaders::ConfigLoader& config) {
    const std::string path = config.getString("BACKGROUND_MUSIC_PATH");
    if (!music.openFromFile(path)) {
        throw std::runtime_error("BackgroundMusic: failed to open music track: " + path);
    }
    music.setVolume(config.getFloat("BACKGROUND_MUSIC_VOLUME"));
    music.setLooping(true);
    music.play();
}

}
