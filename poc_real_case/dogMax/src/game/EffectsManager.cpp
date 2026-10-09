#include "game/EffectsManager.hpp"

#include "render/EffectsRenderer.hpp"

#include <SFML/Graphics/RenderTarget.hpp>
#include <SFML/Graphics/View.hpp>

namespace dof::game {

// Only the small renderer is pumped each frame. A medium/large
// EffectsComposer pair was previously accepted here as scaffolding for
// deferred VFX hooks, but it was never consumed and has been removed.
EffectsManager::EffectsManager(dof::render::EffectsRenderer& small)
    : small_(small) {}

void EffectsManager::tick(float dt) {
    small_.tick(dt);
}

void EffectsManager::draw(sf::RenderTarget& target, const sf::View& worldView) const {
    small_.draw(target, worldView);
}

} // namespace dof::game
