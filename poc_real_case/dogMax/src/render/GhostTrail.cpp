#include "render/GhostTrail.hpp"

#include <algorithm>
#include <cmath>

namespace dof::render {

sf::Color computeGhostTrailColor(sf::Color baseOutline,
                                 float ageSeconds,
                                 float durationSeconds,
                                 float initialAlpha) {
    // Spec §Evasion Visual L1412: linear fade from full to zero over the
    // configured duration. Guarding against a zero / negative duration
    // here keeps a misconfigured `GHOST_TRAIL_TRAIL_DURATION` from
    // dividing by zero in the renderer — the helper degrades to a
    // fully-transparent ghost instead of crashing.
    if (durationSeconds <= 0.0f) {
        baseOutline.a = 0;
        return baseOutline;
    }
    if (ageSeconds < 0.0f)  ageSeconds = 0.0f;
    if (initialAlpha < 0.0f) initialAlpha = 0.0f;
    if (initialAlpha > 255.0f) initialAlpha = 255.0f;

    const float normalised = std::clamp(1.0f - ageSeconds / durationSeconds, 0.0f, 1.0f);
    const float scaled     = std::clamp(initialAlpha * normalised, 0.0f, 255.0f);
    baseOutline.a = static_cast<std::uint8_t>(scaled);
    return baseOutline;
}

}
