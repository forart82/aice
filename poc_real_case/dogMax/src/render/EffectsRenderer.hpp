#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Texture.hpp>
#include <SFML/System/Vector2.hpp>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace sf { class RenderTarget; class View; }
namespace dof::loaders { class ConfigLoader; class ShaderLoader; }

namespace dof::render {

struct EffectDef {
    std::string shaderName;
    sf::Color   color;
    float       variant{0.f};
    float       speed{1.f};
    float       intensity{1.f};
    float       defaultRadius{50.f};
    float       durationSeconds{0.5f};
    std::string category;
};

struct ActiveEffect {
    EffectDef         def;
    sf::Vector2f      worldPos;
    float             radius{50.f};
    float             progress{0.f};      // 0..1
    float             elapsed{0.f};
    float             progressOffset{0.f}; // start progress (for phase-delayed layers)
    // Per-instance colour override. The catalog entry carries a colour, but a
    // burst has to be tintable at the call site so the same "impact" effect can
    // fire in the hero's orange or an enemy's magenta and stay inside the locked
    // palette. Mirrors how radius and progressOffset already override the def.
    sf::Color         color{sf::Color::White};
};

// Renders named small (50px) effects.
// Each effect maps to one of the 10 base fragment shaders via the effects catalog.
// The catalog is loaded from configs/effects/effects_small.yaml.
class EffectsRenderer {
public:
    EffectsRenderer(const dof::loaders::ConfigLoader& config,
                    const dof::loaders::ShaderLoader& shaders);

    // Trigger a named effect at world position. radiusOverride=0 uses the catalog default.
    // progressOffset shifts the start progress (0=start from beginning, 0.2=start 20% in).
    void play(const std::string& name, sf::Vector2f pos,
              float radiusOverride = 0.f, float progressOffset = 0.f,
              const sf::Color* colorOverride = nullptr);

    // Advance all active effects by dt seconds; removes completed effects.
    void tick(float dt);

    // Draw all active effects into the world-space view.
    void draw(sf::RenderTarget& target, const sf::View& worldView) const;

    // Inspection — count of currently active effects.
    int activeCount() const;

    // Inspection — list of (name, progress) for active effects.
    std::vector<std::pair<std::string, float>> listActive() const;

    // Catalog lookup — returns true if name is a known effect.
    bool hasDef(const std::string& name) const;

private:
    const dof::loaders::ShaderLoader&          shaders_;
    std::unordered_map<std::string, EffectDef> catalog_;
    std::vector<ActiveEffect>                  active_;
    sf::Texture                                white_;

    void loadCatalog(const dof::loaders::ConfigLoader& config);
};

} // namespace dof::render
