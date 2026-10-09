#pragma once

#include "abilities/Countdownable.hpp"

#include <memory>
#include <vector>

namespace dof::entities { class Weapon; class Dice; }

namespace dof::abilities {

// Per-enemy combat equipment. An armed enemy carries up to two weapons,
// each holding its own slotted dice inside `Weapon::attachedDiceStorage`
// (the same off-sidebar storage the hero's weapons use while unequipped),
// so no WeaponSlotHub is needed. Each weapon fires on its own cooldown via
// the shared `dof::combat` firing helpers.
//
// An empty loadout means the enemy is UNARMED: it attacks by charging the
// hero. `bodyChargeCountdown` drives that wind-up (the telegraph + the
// charge bar on the info bar); when it finishes the enemy dashes into the
// hero for collision damage.
//
// The 2-weapon cap is a config value enforced by the spawn roller, not a
// constant here — this component only stores whatever it is given.
// Unarmed-charge state machine. Idle: chasing / free to lunge. WindUp: the
// enemy freezes and its charge bar fills (the telegraph). Recover: post-dash
// cooldown before it can wind up again. The dash itself is driven by the
// shared Dashable arc, so it is not a phase here.
enum class ChargePhase { Idle, WindUp, Recover };

class EnemyLoadout {
public:
    // Out-of-line so the vector<unique_ptr<Weapon>> destructor is
    // instantiated in the .cpp where Weapon is a complete type; the
    // Enemy header only forward-declares Weapon. Move ops stay enabled
    // for the same reason (Enemy owns this component by value).
    EnemyLoadout();
    ~EnemyLoadout();
    EnemyLoadout(EnemyLoadout&&) noexcept;
    EnemyLoadout& operator=(EnemyLoadout&&) noexcept;
    EnemyLoadout(const EnemyLoadout&) = delete;
    EnemyLoadout& operator=(const EnemyLoadout&) = delete;

    bool isArmed() const;
    int  weaponCount() const;
    dof::entities::Weapon*       weaponAt(int index);
    const dof::entities::Weapon* weaponAt(int index) const;

    void addWeapon(std::unique_ptr<dof::entities::Weapon> weapon);
    // Transfer ownership of every weapon out (used at death so the
    // enemy's real gear becomes the drop). Leaves the loadout empty.
    std::vector<std::unique_ptr<dof::entities::Weapon>> takeWeapons();

    // Non-owning raw-pointer view of the dice slotted into weapon
    // `index`, for the shared firing helpers' `std::span<Dice*>`.
    std::vector<dof::entities::Dice*> weaponDice(int index) const;

    // Unarmed body-charge wind-up timer (drives the telegraph + charge bar).
    Countdownable&       bodyCharge();
    const Countdownable& bodyCharge() const;

    ChargePhase chargePhase() const;
    void        setChargePhase(ChargePhase phase);

    bool isArmedAttackWindingUp() const;
    int armedAttackWeaponIndex() const;
    void startArmedAttackWindup(int weaponIndex, float seconds, float attackRange);
    void advanceArmedAttackWindup(float dt);
    void clearArmedAttackWindup();
    float armedAttackWindupProgress() const;
    float armedAttackRange() const;

private:
    std::vector<std::unique_ptr<dof::entities::Weapon>> weapons;  // 0..cap
    Countdownable bodyChargeCountdown;
    ChargePhase   chargePhaseValue{ChargePhase::Idle};
    Countdownable armedAttackWindupCountdown;
    int           armedAttackWeaponIndexValue{-1};
    float         armedAttackRangeValue{0.0f};
};

}
