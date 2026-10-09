#pragma once

namespace dof::entities { class Hero; }

namespace dof::managers {

class HeroManager {
public:
    void update(dof::entities::Hero& hero, float dt);
    bool consumeLevelUpEvent();

private:
    int lastAppliedLevel{0};
    bool levelUpEventPending{false};
    // P0.4 — last observed WeaponSlotHub epoch. Seeded to -1 so the
    // first observed epoch always syncs once (harmless: the rescale is
    // idempotent and a no-op on an empty slot grid). Any later change
    // signals an equip / unequip and triggers an equip-time weapon
    // rescale to the current hero level.
    int lastSlotEpoch{-1};
};

}
