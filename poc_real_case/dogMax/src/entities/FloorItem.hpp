#pragma once

#include "abilities/Pickupable.hpp"
#include "core/EntityId.hpp"
#include "entities/Dice.hpp"
#include "entities/Weapon.hpp"

#include <SFML/System/Vector2.hpp>

#include <memory>

namespace dof::entities {

enum class FloorItemKind { Weapon, Dice };

class FloorItem {
public:
    FloorItem(dof::core::EntityId id, sf::Vector2f position, std::unique_ptr<Weapon> weapon, bool isStarter);
    FloorItem(dof::core::EntityId id, sf::Vector2f position, std::unique_ptr<Dice> dice);

    dof::core::EntityId  id() const;
    sf::Vector2f         position() const;
    FloorItemKind        kind() const;
    bool                 isStarter() const;
    float                ageSeconds() const;

    void                 advance(float dt);
    void                 markPickedUp();

    Weapon*               weapon();
    const Weapon*         weapon() const;
    Dice*                 dice();
    const Dice*           dice() const;
    std::unique_ptr<Weapon> releaseWeapon();
    std::unique_ptr<Dice>   releaseDice();

    dof::abilities::Pickupable&       pickupable();
    const dof::abilities::Pickupable& pickupable() const;

private:
    dof::core::EntityId             identity;
    sf::Vector2f                    floorPosition;
    FloorItemKind                   itemKind;
    bool                            isStarterFloor;
    float                           accumulatedAge;
    std::unique_ptr<Weapon>         heldWeapon;
    std::unique_ptr<Dice>           heldDice;
    dof::abilities::Pickupable      pickupableComponent;
};

}
