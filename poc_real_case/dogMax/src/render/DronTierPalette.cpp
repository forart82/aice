#include "render/DronTierPalette.hpp"

#include "loaders/ConfigLoader.hpp"

namespace dof::render {

namespace {

const char* keyPrefixFor(dof::combat::DronTier tier) {
    switch (tier) {
        case dof::combat::DronTier::Hexadron:     return "DRON_TIER_HEXADRON_COLOR_";
        case dof::combat::DronTier::Pentadron:    return "DRON_TIER_PENTADRON_COLOR_";
        case dof::combat::DronTier::TwinTridron:  return "DRON_TIER_TWIN_TRIDRON_COLOR_";
        case dof::combat::DronTier::QuadDuodron:  return "DRON_TIER_QUAD_DUODRON_COLOR_";
        case dof::combat::DronTier::Omidron:      return "DRON_TIER_OMIDRON_COLOR_";
        case dof::combat::DronTier::Hemidron:     return "DRON_TIER_HEMIDRON_COLOR_";
        case dof::combat::DronTier::TriduoDron:   return "DRON_TIER_TRIDUO_DRON_COLOR_";
        case dof::combat::DronTier::Tetradron:    return "DRON_TIER_TETRADRON_COLOR_";
        case dof::combat::DronTier::Lineadron:    return "DRON_TIER_LINEADRON_COLOR_";
        case dof::combat::DronTier::SplitSeqdron: return "DRON_TIER_SPLIT_SEQDRON_COLOR_";
        case dof::combat::DronTier::Mixdron:      return "DRON_TIER_MIXDRON_COLOR_";
        case dof::combat::DronTier::Minidron:     return "DRON_TIER_MINIDRON_COLOR_";
        case dof::combat::DronTier::Tridron:      return "DRON_TIER_TRIDRON_COLOR_";
        case dof::combat::DronTier::Duodron:      return "DRON_TIER_DUODRON_COLOR_";
        case dof::combat::DronTier::Voidron:      return "DRON_TIER_VOIDRON_COLOR_";
    }
    return "DRON_TIER_VOIDRON_COLOR_";
}

sf::Color colorFromPrefix(const dof::loaders::ConfigLoader& config, const char* prefix) {
    char keyR[64]{};
    char keyG[64]{};
    char keyB[64]{};
    std::snprintf(keyR, sizeof(keyR), "%sR", prefix);
    std::snprintf(keyG, sizeof(keyG), "%sG", prefix);
    std::snprintf(keyB, sizeof(keyB), "%sB", prefix);
    return sf::Color{
        static_cast<std::uint8_t>(config.getInt(keyR)),
        static_cast<std::uint8_t>(config.getInt(keyG)),
        static_cast<std::uint8_t>(config.getInt(keyB))};
}

}

sf::Color tierFloatColor(dof::combat::DronTier tier,
                         const dof::loaders::ConfigLoader& config) {
    return colorFromPrefix(config, keyPrefixFor(tier));
}

}
