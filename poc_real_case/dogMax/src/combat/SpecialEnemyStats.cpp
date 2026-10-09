#include "combat/SpecialEnemyStats.hpp"

#include "loaders/ConfigLoader.hpp"

namespace dof::combat {

using dof::entities::SpecialEnemyKind;

SpecialEnemyStatOverride loadSpecialEnemyStatOverride(SpecialEnemyKind kind,
                                                       const dof::loaders::ConfigLoader& config) {
    SpecialEnemyStatOverride o;
    switch (kind) {
        case SpecialEnemyKind::None:
            return o;
        case SpecialEnemyKind::Shocker:
            o.healthMultiplier = config.getFloat("SPECIAL_SHOCKER_HEALTH_MULT");
            return o;
        case SpecialEnemyKind::Glasswraith:
            o.healthMultiplier = config.getFloat("SPECIAL_GLASSWRAITH_HEALTH_MULT");
            return o;
        case SpecialEnemyKind::Hexarchon:
            o.healthMultiplier = config.getFloat("SPECIAL_HEXARCHON_HEALTH_MULT");
            o.deadzoneFactor   = config.getFloat("SPECIAL_HEXARCHON_DEADZONE_FACTOR");
            return o;
        case SpecialEnemyKind::Voidcrawler:
            o.speedMultiplier  = config.getFloat("SPECIAL_VOIDCRAWLER_SPEED_MULT");
            return o;
        case SpecialEnemyKind::TassideanSentinel:
            // Spec-deferred — sentinel uses default multipliers
            // until the 3-phase invuln state machine + push pulse
            // land. The variant still spawns visually (body painter
            // gets a unique branch) but mechanically reads as a
            // baseline Rare for now.
            return o;
        case SpecialEnemyKind::PactWalker:
            // Spec-deferred — NPC behaviour + hostile-on-attack flag
            // land in a follow-up card. Default multipliers keep
            // baseline behaviour until then.
            return o;
    }
    return o;
}

}
