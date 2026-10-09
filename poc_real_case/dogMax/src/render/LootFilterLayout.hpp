#pragma once

#include "entities/Dice.hpp"
#include "entities/Weapon.hpp"

#include <SFML/Graphics/Rect.hpp>
#include <SFML/System/Vector2.hpp>

#include <array>

namespace dof::loaders { class ConfigLoader; }

namespace dof::render {

// All chip and field counts are fixed at compile-time so callers can
// iterate [0, kWeaponChipCount) and [0, kDiceChipCount) without calling
// into the layout at all.
inline constexpr int kWeaponChipCount = 10;
inline constexpr int kDiceChipCount   = 10;

// Maps chip indices to weapon types and dice faces in a stable order.
// Indices align 1:1 with the rendered chips so hit-test results
// round-trip to the correct enum value.
extern const std::array<dof::entities::WeaponType, kWeaponChipCount> kWeaponChipTypes;
extern const std::array<dof::entities::DiceFace,   kDiceChipCount>   kDiceChipFaces;

struct LootFilterLayout {
    explicit LootFilterLayout(const dof::loaders::ConfigLoader& config);

    // Outer popup panel.
    sf::FloatRect popupRect() const;

    // Per-chip rects (weapon row(s), then dice row(s)).
    sf::FloatRect weaponChipRect(int index) const;
    sf::FloatRect diceChipRect(int index) const;

    // Quality / level numeric input fields.
    sf::FloatRect qualityFieldRect() const;
    sf::FloatRect levelFieldRect() const;

    // "UNSET" button — clears the whole filter. Anchored to the popup's
    // bottom-left corner.
    sf::FloatRect unsetButtonRect() const;
    // True when `cursor` falls inside the unset button.
    bool unsetButtonContains(sf::Vector2f cursor) const;

    // Returns the weapon chip index [0, kWeaponChipCount) whose rect
    // contains the cursor, or -1 if none.
    int weaponChipIndexAt(sf::Vector2f cursor) const;
    // Returns the dice chip index [0, kDiceChipCount) whose rect
    // contains the cursor, or -1 if none.
    int diceChipIndexAt(sf::Vector2f cursor) const;

private:
    float popupX{0}, popupY{0}, popupW{0}, popupH{0};
    float chipW{0}, chipH{0}, chipGap{0}, padding{0}, sectionGap{0};
    float inputW{0}, inputH{0};
    float levelFieldXOffset{0};
    float unsetW{0}, unsetH{0}, unsetMargin{0};

    // Weapon chips start y offset (relative to popupY).
    float weaponRowY{0};
    // Dice chips start y offset (relative to popupY).
    float diceRowY{0};
    // Input fields start y offset (relative to popupY).
    float inputRowY{0};
};

} // namespace dof::render
