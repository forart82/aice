#pragma once

#include <SFML/System/Vector2.hpp>

namespace dof::loaders { class ConfigLoader; }

namespace dof::render {

// SA36 / spec §Window §Aspect-Letterbox + Phase 8 Window Auto-Fill —
// when the user drags the window to an absurdly small size, none of
// the existing layouts can adapt: the weapon-slot sidebar (210 px
// wide by default) collapses onto the inventory grid, drag/drop hit
// regions overlap, and tooltips render off-screen. Spec doesn't pin
// an exact minimum but L2773 calls for "panels stay legible" — the
// pragmatic floor is whatever keeps the sidebar + a 4-column
// inventory side-by-side without overlap.
//
// `clampWindowSize` is the pure helper: takes a requested size + the
// configured minimums and returns a size that's at least the minimum
// on each axis. Used by the resize event handler to push back when
// the OS reports a too-small dimension.
struct WindowSizeLimits {
    unsigned minWidth;
    unsigned minHeight;
};

WindowSizeLimits loadWindowSizeLimits(const dof::loaders::ConfigLoader& config);

sf::Vector2u clampWindowSize(sf::Vector2u requested, WindowSizeLimits limits);

}
