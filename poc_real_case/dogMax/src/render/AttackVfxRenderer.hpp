#pragma once

#include "render/AttackVfxShapes.hpp"

namespace dof::hubs { class AttackVfxHub; }
namespace dof::loaders { class ConfigLoader; }
namespace sf { class RenderTarget; }

namespace dof::render {

// Consumes AttackVfxHub::events() each frame and dispatches to the
// per-weapon draw helpers in AttackVfxShapes. Stateless apart from the
// config-driven VfxShapeParams loaded at construction.
class AttackVfxRenderer {
public:
    explicit AttackVfxRenderer(const dof::loaders::ConfigLoader& config);

    // currentHeroFeet: live hero position this frame — used to keep
    // hero-anchored VFX glued to a moving hero rather than the
    // fire-time snapshot stored inside each event.
    void drawAll(sf::RenderTarget& window, const dof::hubs::AttackVfxHub& hub,
                 sf::Vector2f currentHeroFeet) const;

private:
    const dof::loaders::ConfigLoader& configRef;
    VfxShapeParams params;
    float weaponSpriteSize{96.0f};
    float weaponSpriteTravel{42.0f};
    float enemyWeaponSpriteSize{180.0f};
    float enemyTraceLifeFraction{0.3f};
    float enemyTraceWidth{6.0f};
    float enemyImpactRadius{24.0f};
    float enemyImpactThickness{4.0f};
    sf::Color enemyTraceColor;
};

}
