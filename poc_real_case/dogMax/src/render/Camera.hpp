#pragma once

#include <SFML/Graphics/View.hpp>
#include <SFML/System/Vector2.hpp>

namespace dof::loaders { class ConfigLoader; }
namespace sf { class RenderWindow; }

namespace dof::render {

class Camera {
public:
    explicit Camera(const dof::loaders::ConfigLoader& config);

    void followTarget(sf::Vector2f targetPosition);
    void setFocus(sf::Vector2f focusPosition);
    void zoomBy(float factor);
    void zoomBy(float factor, float minimumZoom, float maximumZoom);
    void setZoom(float zoom);

    sf::View activeView() const;
    // Screen shake (visual_identity.md Step 10). Trauma accumulates from
    // impacts and decays on its own; advance() is driven from the sim step.
    void addShakeTrauma(float amount);
    void advanceShake(float dt);
    float currentZoom() const;
    sf::Vector2f focusPosition() const;
    sf::Vector2u designSize() const;

private:
    // The world view stays in design-space aspect. WorldRenderSurface maps it
    // to an integer physical-pixel rectangle and letterboxes the remainder.
    sf::Vector2u   designDimensions;
    sf::Vector2f   focus{0.0f, 0.0f};
    float          zoomValue{1.0f};
    float          minZoom{0.25f};
    float          maxZoom{20.0f};
    float          followVisualOffsetY{0.0f};
    // Trauma model rather than a per-hit offset: hits ADD trauma, trauma decays
    // continuously, and amplitude is derived from it. That is what caps a
    // swarm — twenty simultaneous hits raise trauma to its ceiling instead of
    // summing twenty offsets into an unreadable screen.
    float          shakeTrauma{0.0f};
    float          shakeTimeSeconds{0.0f};
    bool           isShakeEnabled{false};
    float          shakeMaxOffsetPixels{0.0f};
    float          shakeFrequencyHz{0.0f};
    float          shakeDecayPerSecond{1.0f};
    float          shakeTraumaCeiling{1.0f};
    float          shakeFrequencyRatioY{1.0f};
    float          shakePhaseOffsetY{0.0f};
    sf::Vector2f   shakeOffsetWorld(float zoom) const;
};

}
