#pragma once

namespace sf { class RenderTarget; class View; }
namespace dof::render { class EffectsRenderer; }

namespace dof::game {

// Thin per-frame facade over EffectsRenderer. `tick`/`draw` pump the
// small-effects renderer each frame; that is the only effects work wired
// today. A medium/large EffectsComposer pair was once handed in here as
// scaffolding for deferred gameplay-VFX hooks, but it was never consumed
// and has been removed as dead code.
class EffectsManager {
public:
    explicit EffectsManager(dof::render::EffectsRenderer& small);

    // Tick + draw delegated to the small renderer; call each frame.
    void tick(float dt);
    void draw(sf::RenderTarget& target, const sf::View& worldView) const;

private:
    dof::render::EffectsRenderer& small_;
};

} // namespace dof::game
