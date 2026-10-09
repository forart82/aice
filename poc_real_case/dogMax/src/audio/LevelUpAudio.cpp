#include "audio/LevelUpAudio.hpp"

#include "loaders/ConfigLoader.hpp"

#include <algorithm>
#include <stdexcept>
#include <string>

namespace dof::audio {

LevelUpAudio::LevelUpAudio(const dof::loaders::ConfigLoader& config) {
    const std::string path = config.getString("LEVEL_UP_SOUND_PATH");
    if (!buffer.loadFromFile(path)) {
        throw std::runtime_error("LevelUpAudio: failed to load level-up sound: " + path);
    }

    sound.emplace(buffer);
    // Non-diegetic UI cue — see PickupAudio: mono sources are spatialized from
    // (0,0,0) by default while the listener follows the hero, so an unpinned
    // cue attenuates to silence away from the world origin.
    sound->setRelativeToListener(true);
    sound->setVolume(std::clamp(config.getFloat("LEVEL_UP_SOUND_VOLUME"), 0.0f, 100.0f));
}

void LevelUpAudio::play() {
    if (!sound) return;
    sound->play();
}

} // namespace dof::audio
