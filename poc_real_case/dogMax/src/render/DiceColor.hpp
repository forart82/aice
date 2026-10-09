#pragma once

// card-mpl9oh9z — shared per-face palette lookup. WeaponSlotSidebar
// and InventoryRenderer each shipped private duplicates; FloorItem-
// Painter (card-mpkwji9p) reached for the same lookup but composed
// the key via `diceFaceLabel(face)` which returns lower-case (`d6`)
// while `dice.yaml` uses upper-case (`DICE_COLOR_D6_R`). The
// mismatch threw `missing int key` from `ConfigLoader::getInt`,
// which propagated out of the renderer and crashed the game on the
// next floor-paint of a weapon carrying attached dice (drag a
// weapon-with-dice onto the floor). One canonical helper here kills
// the duplication AND the crash.

#include <SFML/Graphics/Color.hpp>

namespace dof::entities { enum class DiceFace; }
namespace dof::loaders  { class ConfigLoader; }

namespace dof::render {

sf::Color diceColorForFace(const dof::loaders::ConfigLoader& config,
                            dof::entities::DiceFace face);

}
