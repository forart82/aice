#include "abilities/EnemyLoadout.hpp"

#include "entities/Dice.hpp"
#include "entities/Weapon.hpp"

namespace dof::abilities {

EnemyLoadout::EnemyLoadout() = default;
EnemyLoadout::~EnemyLoadout() = default;
EnemyLoadout::EnemyLoadout(EnemyLoadout&&) noexcept = default;
EnemyLoadout& EnemyLoadout::operator=(EnemyLoadout&&) noexcept = default;

bool EnemyLoadout::isArmed() const { return !weapons.empty(); }

int EnemyLoadout::weaponCount() const { return static_cast<int>(weapons.size()); }

dof::entities::Weapon* EnemyLoadout::weaponAt(int index) {
    if (index < 0 || index >= weaponCount()) return nullptr;
    return weapons[static_cast<size_t>(index)].get();
}

const dof::entities::Weapon* EnemyLoadout::weaponAt(int index) const {
    if (index < 0 || index >= weaponCount()) return nullptr;
    return weapons[static_cast<size_t>(index)].get();
}

void EnemyLoadout::addWeapon(std::unique_ptr<dof::entities::Weapon> weapon) {
    if (weapon) weapons.push_back(std::move(weapon));
}

std::vector<std::unique_ptr<dof::entities::Weapon>> EnemyLoadout::takeWeapons() {
    clearArmedAttackWindup();
    return std::move(weapons);
}

std::vector<dof::entities::Dice*> EnemyLoadout::weaponDice(int index) const {
    std::vector<dof::entities::Dice*> dice;
    const auto* weapon = weaponAt(index);
    if (!weapon) return dice;
    for (const auto& die : weapon->attachedDicePeek()) {
        if (die) dice.push_back(die.get());
    }
    return dice;
}

Countdownable&       EnemyLoadout::bodyCharge()       { return bodyChargeCountdown; }
const Countdownable& EnemyLoadout::bodyCharge() const { return bodyChargeCountdown; }

ChargePhase EnemyLoadout::chargePhase() const { return chargePhaseValue; }
void        EnemyLoadout::setChargePhase(ChargePhase phase) { chargePhaseValue = phase; }

bool EnemyLoadout::isArmedAttackWindingUp() const {
    return armedAttackWeaponIndexValue >= 0;
}

int EnemyLoadout::armedAttackWeaponIndex() const { return armedAttackWeaponIndexValue; }

void EnemyLoadout::startArmedAttackWindup(int weaponIndex, float seconds, float attackRange) {
    armedAttackWeaponIndexValue = weaponIndex;
    armedAttackWindupCountdown.setDuration(seconds);
    armedAttackRangeValue = attackRange;
}

void EnemyLoadout::advanceArmedAttackWindup(float dt) {
    armedAttackWindupCountdown.advance(dt);
}

void EnemyLoadout::clearArmedAttackWindup() {
    armedAttackWeaponIndexValue = -1;
    armedAttackRangeValue = 0.0f;
}

float EnemyLoadout::armedAttackWindupProgress() const {
    return armedAttackWindupCountdown.progress();
}

float EnemyLoadout::armedAttackRange() const { return armedAttackRangeValue; }

}
