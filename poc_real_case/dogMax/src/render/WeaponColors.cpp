#include "render/WeaponColors.hpp"

#include "loaders/ConfigLoader.hpp"

namespace dof::render {

namespace {

struct ColorKeys {
    const char* outlineR;
    const char* outlineG;
    const char* outlineB;
    const char* fillR;
    const char* fillG;
    const char* fillB;
};

ColorKeys keysFor(dof::entities::WeaponType type) {
    switch (type) {
        case dof::entities::WeaponType::Pitchfork:
            return {"PITCHFORK_OUTLINE_R","PITCHFORK_OUTLINE_G","PITCHFORK_OUTLINE_B",
                    "PITCHFORK_FILL_R","PITCHFORK_FILL_G","PITCHFORK_FILL_B"};
        case dof::entities::WeaponType::LongSword:
            return {"LONG_SWORD_OUTLINE_R","LONG_SWORD_OUTLINE_G","LONG_SWORD_OUTLINE_B",
                    "LONG_SWORD_FILL_R","LONG_SWORD_FILL_G","LONG_SWORD_FILL_B"};
        case dof::entities::WeaponType::GreatSword:
            return {"GREAT_SWORD_OUTLINE_R","GREAT_SWORD_OUTLINE_G","GREAT_SWORD_OUTLINE_B",
                    "GREAT_SWORD_FILL_R","GREAT_SWORD_FILL_G","GREAT_SWORD_FILL_B"};
        case dof::entities::WeaponType::Halberd:
            return {"HALBERD_OUTLINE_R","HALBERD_OUTLINE_G","HALBERD_OUTLINE_B",
                    "HALBERD_FILL_R","HALBERD_FILL_G","HALBERD_FILL_B"};
        case dof::entities::WeaponType::Quarterstaff:
            return {"QUARTERSTAFF_OUTLINE_R","QUARTERSTAFF_OUTLINE_G","QUARTERSTAFF_OUTLINE_B",
                    "QUARTERSTAFF_FILL_R","QUARTERSTAFF_FILL_G","QUARTERSTAFF_FILL_B"};
        case dof::entities::WeaponType::Knives:
            return {"KNIVES_OUTLINE_R","KNIVES_OUTLINE_G","KNIVES_OUTLINE_B",
                    "KNIVES_FILL_R","KNIVES_FILL_G","KNIVES_FILL_B"};
        case dof::entities::WeaponType::Dagger:
            return {"DAGGER_OUTLINE_R","DAGGER_OUTLINE_G","DAGGER_OUTLINE_B",
                    "DAGGER_FILL_R","DAGGER_FILL_G","DAGGER_FILL_B"};
        case dof::entities::WeaponType::Mace:
            return {"MACE_OUTLINE_R","MACE_OUTLINE_G","MACE_OUTLINE_B",
                    "MACE_FILL_R","MACE_FILL_G","MACE_FILL_B"};
        case dof::entities::WeaponType::Warhammer:
            return {"WARHAMMER_OUTLINE_R","WARHAMMER_OUTLINE_G","WARHAMMER_OUTLINE_B",
                    "WARHAMMER_FILL_R","WARHAMMER_FILL_G","WARHAMMER_FILL_B"};
        case dof::entities::WeaponType::BigAxe:
            return {"BIG_AXE_OUTLINE_R","BIG_AXE_OUTLINE_G","BIG_AXE_OUTLINE_B",
                    "BIG_AXE_FILL_R","BIG_AXE_FILL_G","BIG_AXE_FILL_B"};
    }
    return {"PITCHFORK_OUTLINE_R","PITCHFORK_OUTLINE_G","PITCHFORK_OUTLINE_B",
            "PITCHFORK_FILL_R","PITCHFORK_FILL_G","PITCHFORK_FILL_B"};
}

}

sf::Color weaponOutlineColor(const dof::loaders::ConfigLoader& config, dof::entities::WeaponType type) {
    const auto keys = keysFor(type);
    return sf::Color{
        static_cast<std::uint8_t>(config.getInt(keys.outlineR)),
        static_cast<std::uint8_t>(config.getInt(keys.outlineG)),
        static_cast<std::uint8_t>(config.getInt(keys.outlineB))};
}

sf::Color weaponFillColor(const dof::loaders::ConfigLoader& config, dof::entities::WeaponType type) {
    const auto keys = keysFor(type);
    return sf::Color{
        static_cast<std::uint8_t>(config.getInt(keys.fillR)),
        static_cast<std::uint8_t>(config.getInt(keys.fillG)),
        static_cast<std::uint8_t>(config.getInt(keys.fillB))};
}

}
