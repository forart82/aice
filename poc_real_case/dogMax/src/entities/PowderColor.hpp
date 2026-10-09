#pragma once

#include "entities/Dice.hpp"
#include "entities/Weapon.hpp"

namespace dof::entities {

enum class PowderColor {
    Red,
    Yellow,
    Cyan,
    Green,
    Blue,
    Magenta,
    Purple,
    Orange,
    Pink,
    White,
    Black,
};

PowderColor powderColorForWeapon(WeaponType type);
PowderColor powderColorForDice(DiceFace face);

const char* powderColorName(PowderColor color);
int         powderColorCount();
PowderColor powderColorAtIndex(int index);

}
