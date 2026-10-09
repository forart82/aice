#include "entities/PowderColor.hpp"

#include <stdexcept>

namespace dof::entities {

PowderColor powderColorForWeapon(WeaponType /*type*/) {
    return PowderColor::Black;
}

PowderColor powderColorForDice(DiceFace face) {
    switch (face) {
        case DiceFace::D4:   return PowderColor::Red;
        case DiceFace::D6:   return PowderColor::Yellow;
        case DiceFace::D8:   return PowderColor::Cyan;
        case DiceFace::D12:  return PowderColor::Green;
        case DiceFace::D20:  return PowderColor::Blue;
        case DiceFace::D24:  return PowderColor::Magenta;
        case DiceFace::D30:  return PowderColor::Purple;
        case DiceFace::D42:  return PowderColor::Orange;
        case DiceFace::D60:  return PowderColor::Pink;
        case DiceFace::D100: return PowderColor::White;
    }
    return PowderColor::Yellow;
}

const char* powderColorName(PowderColor color) {
    switch (color) {
        case PowderColor::Red:     return "red";
        case PowderColor::Yellow:  return "yellow";
        case PowderColor::Cyan:    return "cyan";
        case PowderColor::Green:   return "green";
        case PowderColor::Blue:    return "blue";
        case PowderColor::Magenta: return "magenta";
        case PowderColor::Purple:  return "purple";
        case PowderColor::Orange:  return "orange";
        case PowderColor::Pink:    return "pink";
        case PowderColor::White:   return "white";
        case PowderColor::Black:   return "black";
    }
    return "unknown";
}

int powderColorCount() { return 11; }

PowderColor powderColorAtIndex(int index) {
    switch (index) {
        case 0:  return PowderColor::Red;
        case 1:  return PowderColor::Yellow;
        case 2:  return PowderColor::Cyan;
        case 3:  return PowderColor::Green;
        case 4:  return PowderColor::Blue;
        case 5:  return PowderColor::Magenta;
        case 6:  return PowderColor::Purple;
        case 7:  return PowderColor::Orange;
        case 8:  return PowderColor::Pink;
        case 9:  return PowderColor::White;
        case 10: return PowderColor::Black;
        default: throw std::out_of_range("powderColorAtIndex");
    }
}

}
