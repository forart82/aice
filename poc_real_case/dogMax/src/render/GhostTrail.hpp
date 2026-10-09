#pragma once

#include <SFML/Graphics/Color.hpp>

namespace dof::render {

// Spec §Evasion Visual L1412 — on a successful evade, a short trailing
// copy of the hero sprite renders behind the live hero and fades out
// over `GHOST_TRAIL_TRAIL_DURATION` (0.15 s by default). The fade is a
// pure function of (age, duration) plus the initial alpha:
//
//   normalised = clamp(1 - age/duration, 0, 1)
//   ghost.a    = initialAlpha * normalised
//
// `age` is measured in seconds since the evade event, `duration` is
// the spec-configured fade window, and `initialAlpha` is the 0..255
// alpha the ghost outline starts at. Returning `sf::Color` directly
// (rather than a float alpha) keeps the renderer call site one line
// long: copy the base outline, swap in the computed alpha, draw.
//
// Pure helper — no globals, no SFML render state, no EvasionHub
// reference. Owned by the renderer module so the unit test can pin
// the alpha curve without instantiating a window.

sf::Color computeGhostTrailColor(sf::Color baseOutline,
                                 float ageSeconds,
                                 float durationSeconds,
                                 float initialAlpha);

}
