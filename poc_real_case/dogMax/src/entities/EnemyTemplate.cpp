#include "entities/EnemyTemplate.hpp"

#include <stdexcept>

namespace dof::entities {

const EnemyTierDesign& EnemyTemplate::forTier(QualityTier tier) const {
    switch (tier) {
        case QualityTier::Common:   return common;
        case QualityTier::Uncommon: return uncommon;
        case QualityTier::Rare:     return rare;
    }
    return common;
}

EffectMotion parseEffectMotion(const std::string& token) {
    if (token == "static") return EffectMotion::Static;
    if (token == "orbit")  return EffectMotion::Orbit;
    if (token == "popup")  return EffectMotion::Popup;
    throw std::runtime_error("EnemyTemplate: unknown effect motion '" + token + "'");
}

std::string effectMotionToken(EffectMotion motion) {
    switch (motion) {
        case EffectMotion::Static: return "static";
        case EffectMotion::Orbit:  return "orbit";
        case EffectMotion::Popup:  return "popup";
    }
    return "static";
}

}
