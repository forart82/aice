#include "audio/PickupAudio.hpp"

#include "loaders/ConfigLoader.hpp"

#include <algorithm>
#include <stdexcept>
#include <string>

namespace dof::audio {

PickupAudio::PickupAudio(const dof::loaders::ConfigLoader& config) {
    const std::string path = config.getString("PICKUP_SOUND_PATH");
    if (!buffer.loadFromFile(path)) {
        throw std::runtime_error("PickupAudio: failed to load pickup sound: " + path);
    }

    sound.emplace(buffer);
    // Non-diegetic UI cue: pin it to the listener. The file is mono, and SFML
    // spatializes mono sources from a default position of (0,0,0) while
    // SpatialAudio moves the listener to the hero's world position every frame
    // — so without this the pickup cue faded out as the hero left the origin.
    sound->setRelativeToListener(true);
    sound->setVolume(std::clamp(config.getFloat("PICKUP_SOUND_VOLUME"), 0.0f, 100.0f));
}

void PickupAudio::play() {
    if (!sound) return;
    sound->play();
}

} // namespace dof::audio
