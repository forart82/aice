#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/System/Vector2.hpp>

#include <string>
#include <vector>

namespace dof::hubs {

// Queue of one-shot effect bursts requested by simulation code and drained by
// the renderer each frame (visual_identity.md Step 11).
//
// The effects library is a render-layer concern, but the moments worth marking
// — a hit landing, an enemy dying — are known only to the managers. Handing
// managers an EffectsRenderer would drag rendering into simulation, so they
// push a request here instead and the render pass drains it. Same shape as the
// existing AttackVfxHub, deliberately: one more event queue is easier to reason
// about than one manager that knows how to draw.
struct EffectBurstRequest {
    std::string  effectName;
    sf::Vector2f position;
    sf::Color    color;
    float        radius{0.0f};
};

class EffectBurstHub {
public:
    void request(const std::string& effectName, sf::Vector2f position,
                 sf::Color color, float radius) {
        if (effectName.empty()) return;
        pending.push_back({effectName, position, color, radius});
    }

    const std::vector<EffectBurstRequest>& drain() const { return pending; }
    void clear() { pending.clear(); }

private:
    std::vector<EffectBurstRequest> pending;
};

} // namespace dof::hubs
