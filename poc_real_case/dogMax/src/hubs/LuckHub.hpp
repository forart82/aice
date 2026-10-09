#pragma once

namespace dof::hubs { class WeaponSlotHub; }
namespace dof::loaders { class ConfigLoader; }

namespace dof::hubs {

class LuckHub {
public:
    LuckHub(const dof::loaders::ConfigLoader& config, const WeaponSlotHub& weaponSlotHub);

    // Forces a full recompute. Normally callers don't need this — the
    // accessors auto-refresh when the WeaponSlotHub epoch advances
    // (i.e. on every equip / unequip / slot-dice / unslot / swap).
    // Kept public for tests and for the rare case where dice luck
    // values themselves change without a slot mutation.
    void refresh();

    int   luckTotal() const;
    int   qualityFloor() const;
    int   effectiveMinFace() const;
    float qualityFloorScale() const;
    float diceFloorScale() const;

private:
    void ensureFresh() const;

    const WeaponSlotHub& weaponSlotRef;
    float                cachedQualityFloorScale;
    float                cachedDiceFloorScale;
    mutable int          lastSeenEpoch{-1};
    mutable int          cachedLuckTotal{0};
    mutable int          cachedQualityFloor{0};
    mutable int          cachedEffectiveMinFace{1};
};

}
