#include "render/DiceColor.hpp"

#include "entities/Dice.hpp"
#include "loaders/ConfigLoader.hpp"

#include <cstdint>

namespace dof::render {

sf::Color diceColorForFace(const dof::loaders::ConfigLoader& config,
                            dof::entities::DiceFace face) {
    const char* keyR = "DICE_COLOR_D6_R";
    const char* keyG = "DICE_COLOR_D6_G";
    const char* keyB = "DICE_COLOR_D6_B";
    switch (face) {
        case dof::entities::DiceFace::D4:
            keyR = "DICE_COLOR_D4_R";   keyG = "DICE_COLOR_D4_G";   keyB = "DICE_COLOR_D4_B";   break;
        case dof::entities::DiceFace::D6:
            keyR = "DICE_COLOR_D6_R";   keyG = "DICE_COLOR_D6_G";   keyB = "DICE_COLOR_D6_B";   break;
        case dof::entities::DiceFace::D8:
            keyR = "DICE_COLOR_D8_R";   keyG = "DICE_COLOR_D8_G";   keyB = "DICE_COLOR_D8_B";   break;
        case dof::entities::DiceFace::D12:
            keyR = "DICE_COLOR_D12_R";  keyG = "DICE_COLOR_D12_G";  keyB = "DICE_COLOR_D12_B";  break;
        case dof::entities::DiceFace::D20:
            keyR = "DICE_COLOR_D20_R";  keyG = "DICE_COLOR_D20_G";  keyB = "DICE_COLOR_D20_B";  break;
        case dof::entities::DiceFace::D24:
            keyR = "DICE_COLOR_D24_R";  keyG = "DICE_COLOR_D24_G";  keyB = "DICE_COLOR_D24_B";  break;
        case dof::entities::DiceFace::D30:
            keyR = "DICE_COLOR_D30_R";  keyG = "DICE_COLOR_D30_G";  keyB = "DICE_COLOR_D30_B";  break;
        case dof::entities::DiceFace::D42:
            keyR = "DICE_COLOR_D42_R";  keyG = "DICE_COLOR_D42_G";  keyB = "DICE_COLOR_D42_B";  break;
        case dof::entities::DiceFace::D60:
            keyR = "DICE_COLOR_D60_R";  keyG = "DICE_COLOR_D60_G";  keyB = "DICE_COLOR_D60_B";  break;
        case dof::entities::DiceFace::D100:
            keyR = "DICE_COLOR_D100_R"; keyG = "DICE_COLOR_D100_G"; keyB = "DICE_COLOR_D100_B"; break;
    }
    return sf::Color{
        static_cast<std::uint8_t>(config.getInt(keyR)),
        static_cast<std::uint8_t>(config.getInt(keyG)),
        static_cast<std::uint8_t>(config.getInt(keyB))};
}

}
