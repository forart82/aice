#pragma once

#include <SFML/Graphics/Rect.hpp>

namespace dof::render {

// Spec §Window §Aspect-Letterbox L2742-L2749 — when the actual
// window aspect doesn't match the design aspect, the world view
// letterboxes (black bars on whichever axis has excess pixels) so
// the UI never stretches and the world never crops.
//
// Pure geometry helper — takes the design size + the live window
// size and returns the world-view rect in window-pixel space (the
// rectangle SFML's `sf::View::setViewport` consumes is normalised
// to [0, 1]; the caller does that final divide).
//
// `widerDelta` is positive when the window is wider than the
// design aspect; that case shrinks the world width and centres
// it horizontally. The opposite sign shrinks the height and
// centres vertically.
struct LetterboxRect {
    float originX;   // window-pixel origin of the world rect
    float originY;
    float width;     // window-pixel size of the world rect
    float height;
};

LetterboxRect computeLetterbox(unsigned windowWidth,
                               unsigned windowHeight,
                               unsigned designWidth,
                               unsigned designHeight);

// SFML viewport rect — normalised to the [0, 1] window space.
sf::FloatRect computeLetterboxViewport(unsigned windowWidth,
                                       unsigned windowHeight,
                                       unsigned designWidth,
                                       unsigned designHeight);

}
