#pragma once

#include "core/EntityId.hpp"
#include "entities/Dice.hpp"

#include <memory>

namespace dof::loaders { class ConfigLoader; }
namespace dof::helpers { class DeterministicRandom; using RandomHelper = DeterministicRandom; }
namespace dof::makers  { class NameMaker; }

namespace dof::makers {

class DiceMaker {
public:
    DiceMaker(const dof::loaders::ConfigLoader& config,
              dof::helpers::RandomHelper& rng,
              NameMaker* nameMaker);
    void refreshConfig();

    // Spec-compliant loot drop. Rolls q ~ U[qFloor, 100],
    // itemLevel rises with enemy level, then scales the dice from a playable
    // configured quality baseline. Luck is left untouched because it drives
    // qFloor and amplifying it would feed back into itself.
    std::unique_ptr<dof::entities::Dice> makeLoot(dof::core::EntityId id,
                                                   dof::entities::DiceFace face,
                                                   int enemyLevel,
                                                   int qFloor);
    std::unique_ptr<dof::entities::Dice> makeLootRandom(dof::core::EntityId id,
                                                        int enemyLevel,
                                                        int qFloor);

    // Cheat path: pins itemLevel to `level` with q=100 (max quality).
    // Mirrors WeaponMaker::makeAtLevel.
    std::unique_ptr<dof::entities::Dice> makeAtLevel(dof::core::EntityId id,
                                                     dof::entities::DiceFace face,
                                                     int level);

    // Ungated overload — returns any face per configured weights.
    // Used by cheat/test paths that want all faces available.
    dof::entities::DiceFace pickWeightedFace();

    // Level-gated overload — excludes faces whose DICE_LEVEL_GATE_Dxx > level.
    // D4 and D6 are always available (no gate). Falls back to D4/D6 if
    // the given level cannot unlock any gated face.
    dof::entities::DiceFace pickWeightedFace(int level);

    // Returns true when the given face may drop at the supplied level.
    // D4 and D6 always return true. Exposed for deterministic unit tests.
    bool isFaceUnlocked(dof::entities::DiceFace face, int level) const;

    // Pick a roll duration in [DICE_ROLL_DURATION_MIN,
    // DICE_ROLL_DURATION_MAX]. Face count does not influence time.
    float rollDuration();

private:
    std::unique_ptr<dof::entities::Dice> buildDice(dof::core::EntityId id,
                                                    dof::entities::DiceFace face,
                                                    int itemLevel,
                                                    int qualityFloor);

    const dof::loaders::ConfigLoader& configRef;
    dof::helpers::RandomHelper&       rngRef;
    NameMaker*                        nameMakerPtr;
    int                               weightD4;
    int                               weightD6;
    int                               weightD8;
    int                               weightD12;
    int                               weightD20;
    int                               weightD24;
    int                               weightD30;
    int                               weightD42;
    int                               weightD60;
    int                               weightD100;
    // Level gate thresholds refreshed from dice.yaml after a config reload.
    int                               gateLevelD8;
    int                               gateLevelD12;
    int                               gateLevelD20;
    int                               gateLevelD24;
    int                               gateLevelD30;
    int                               gateLevelD42;
    int                               gateLevelD60;
    int                               gateLevelD100;
};

}
