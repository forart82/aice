#pragma once

#include "render/UiState.hpp"

#include <SFML/Window/Cursor.hpp>

namespace dof::render {

// Spec §Mouse L2660-2667 — pointer changes shape based on what the
// cursor is over. Three states are surfaced to the platform layer:
//
//   - SizeAll  while a drag is active (the payload follows the
//                cursor; the four-way arrow communicates "you can
//                drop this somewhere").
//   - Hand     while hovering an interactable region (a non-empty
//                inventory slot, a weapon row, a dice cell, a
//                destroy button) and no drag is active.
//   - Arrow    every other time.
//
// The mapping is a pure function of the UiState so it can be unit
// tested without standing up an `sf::RenderWindow`.
sf::Cursor::Type pickCursorType(const UiState& uiState);

}
