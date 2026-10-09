#include "hubs/LuckHub.hpp"

#include "combat/LuckCalculator.hpp"
#include "entities/Dice.hpp"
#include "hubs/WeaponSlotHub.hpp"
#include "loaders/ConfigLoader.hpp"

#include <vector>

namespace dof::hubs {

LuckHub::LuckHub(const dof::loaders::ConfigLoader& config, const WeaponSlotHub& weaponSlotHub)
    : weaponSlotRef(weaponSlotHub) {
    cachedQualityFloorScale = config.getFloat("LUCK_QUALITY_FLOOR_SCALE");
    cachedDiceFloorScale    = config.getFloat("LUCK_DICE_FLOOR_SCALE");
}

void LuckHub::refresh() {
    std::vector<int> luckPerDice;
    luckPerDice.reserve(static_cast<std::size_t>(weaponSlotRef.rowCount() * weaponSlotRef.diceCellsPerRow()));
    for (int row = 0; row < weaponSlotRef.rowCount(); ++row) {
        for (int cell = 0; cell < weaponSlotRef.diceCellsPerRow(); ++cell) {
            const auto* dice = weaponSlotRef.peekDice(row, cell);
            if (!dice) continue;
            luckPerDice.push_back(dice->luck());
        }
    }
    cachedLuckTotal        = dof::combat::sumLuck(luckPerDice);
    cachedQualityFloor     = dof::combat::qualityFloor(cachedLuckTotal, cachedQualityFloorScale);
    cachedEffectiveMinFace = dof::combat::effectiveMinFace(cachedLuckTotal, cachedDiceFloorScale);
    lastSeenEpoch          = weaponSlotRef.epoch();
}

void LuckHub::ensureFresh() const {
    if (lastSeenEpoch == weaponSlotRef.epoch()) return;
    const_cast<LuckHub*>(this)->refresh();
}

int   LuckHub::luckTotal()         const { ensureFresh(); return cachedLuckTotal; }
int   LuckHub::qualityFloor()      const { ensureFresh(); return cachedQualityFloor; }
int   LuckHub::effectiveMinFace()  const { ensureFresh(); return cachedEffectiveMinFace; }
float LuckHub::qualityFloorScale() const { return cachedQualityFloorScale; }
float LuckHub::diceFloorScale()    const { return cachedDiceFloorScale; }

}
