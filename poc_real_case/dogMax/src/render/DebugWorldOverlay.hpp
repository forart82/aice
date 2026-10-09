#pragma once

// Spec §Debug Mode §World Overlays L2824-2834 — translucent range
// rings + level zones + spawn-ring outline drawn over the world view
// while the Debug panel is visible. Gated by the caller so the
// overlay disappears the instant Ctrl+O hides the panel.
//
// Lives in its own module rather than inside `WorldRenderer` so the
// gameplay renderer stays unaware of debug state (Single
// Responsibility) and unit tests can exercise the geometry helpers
// without spinning up the full render path.

#include <SFML/Graphics/RenderWindow.hpp>

#include <cstddef>
#include <cstdint>

namespace dof::core     { class World; }
namespace dof::loaders  { class ConfigLoader; }
namespace dof::managers { class EnemyManager; }

namespace dof::render {

// Returns the index from which the last `cap` entries of a deque of
// `count` elements begin. Unit-testable pure helper; used by the
// spawn-exclusion dead-zone pass to cap the overlay at the 50 most
// recent entries.
std::size_t debugExclusionTailStart(std::size_t count, std::size_t cap);

// Paints every overlay listed in spec L2828-2834 plus the exact impassable
// Shattered Furrow scenery polygons in the world view.
// Caller must have `window.setView(worldView)` before calling.
// Reads ranges/radii from the live world entities + config; no caching.
// Also paints semi-transparent spawn-exclusion dead zones from the
// most recent entries in `enemyManager.spawnExclusions()`.
void drawDebugWorldOverlays(sf::RenderTarget& window,
                              const dof::core::World& world,
                              const dof::loaders::ConfigLoader& configLoader,
                              const dof::managers::EnemyManager& enemyManager,
                              float interpolationAlpha,
                              std::uint64_t startupSeed);

}
