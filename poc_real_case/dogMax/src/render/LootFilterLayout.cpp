#include "render/LootFilterLayout.hpp"

#include "loaders/ConfigLoader.hpp"

namespace dof::render {

const std::array<dof::entities::WeaponType, kWeaponChipCount> kWeaponChipTypes = {
    dof::entities::WeaponType::Pitchfork,
    dof::entities::WeaponType::LongSword,
    dof::entities::WeaponType::GreatSword,
    dof::entities::WeaponType::Halberd,
    dof::entities::WeaponType::Quarterstaff,
    dof::entities::WeaponType::Knives,
    dof::entities::WeaponType::Dagger,
    dof::entities::WeaponType::Mace,
    dof::entities::WeaponType::Warhammer,
    dof::entities::WeaponType::BigAxe,
};

const std::array<dof::entities::DiceFace, kDiceChipCount> kDiceChipFaces = {
    dof::entities::DiceFace::D4,
    dof::entities::DiceFace::D6,
    dof::entities::DiceFace::D8,
    dof::entities::DiceFace::D12,
    dof::entities::DiceFace::D20,
    dof::entities::DiceFace::D24,
    dof::entities::DiceFace::D30,
    dof::entities::DiceFace::D42,
    dof::entities::DiceFace::D60,
    dof::entities::DiceFace::D100,
};

LootFilterLayout::LootFilterLayout(const dof::loaders::ConfigLoader& config) {
    popupX    = config.getFloat("LOOT_FILTER_POPUP_X");
    popupY    = config.getFloat("LOOT_FILTER_POPUP_Y");
    popupW    = config.getFloat("LOOT_FILTER_POPUP_WIDTH");
    popupH    = config.getFloat("LOOT_FILTER_POPUP_HEIGHT");
    chipW     = config.getFloat("LOOT_FILTER_CHIP_W");
    chipH     = config.getFloat("LOOT_FILTER_CHIP_H");
    chipGap   = config.getFloat("LOOT_FILTER_CHIP_GAP");
    padding   = config.getFloat("LOOT_FILTER_PADDING");
    sectionGap = config.getFloat("LOOT_FILTER_SECTION_GAP");
    inputW    = config.getFloat("LOOT_FILTER_INPUT_W");
    inputH    = config.getFloat("LOOT_FILTER_INPUT_H");
    levelFieldXOffset = config.getFloat("LOOT_FILTER_LEVEL_FIELD_X_OFFSET");
    unsetW    = config.getFloat("LOOT_FILTER_UNSET_W");
    unsetH    = config.getFloat("LOOT_FILTER_UNSET_H");
    unsetMargin = config.getFloat("LOOT_FILTER_UNSET_MARGIN");

    // Title row height + section header height approximated from font sizes.
    const float titleH   = static_cast<float>(config.getInt("LOOT_FILTER_TITLE_SIZE"))
                           + config.getFloat("LOOT_FILTER_TITLE_HEIGHT_PAD");
    const float sectionH = static_cast<float>(config.getInt("LOOT_FILTER_SECTION_SIZE"))
                           + config.getFloat("LOOT_FILTER_SECTION_HEIGHT_PAD");

    // Weapon chips: two rows of 6 (indices 0-5 / 6-11).
    weaponRowY = padding + titleH + sectionGap + sectionH;

    const float weaponRowsH = 2.0f * chipH + chipGap;

    // Dice chips: two rows of 6 (indices 0-5 / 6-9) — same column grid as
    // the weapon rows so both sections align on identical columns.
    diceRowY = weaponRowY + weaponRowsH + sectionGap + sectionH;

    const float diceRowsH = 2.0f * chipH + chipGap;

    // Extra gap before the input row so its section header clears the
    // per-field "MAX QUALITY" / "MAX LEVEL" labels drawn above the fields.
    inputRowY = diceRowY + diceRowsH + sectionGap + sectionH
                + config.getFloat("LOOT_FILTER_INPUT_ROW_EXTRA_GAP");
}

sf::FloatRect LootFilterLayout::popupRect() const {
    return {{popupX, popupY}, {popupW, popupH}};
}

sf::FloatRect LootFilterLayout::weaponChipRect(int index) const {
    const int col = index % 6;
    const int row = index / 6;
    const float x = popupX + padding + static_cast<float>(col) * (chipW + chipGap);
    const float y = popupY + weaponRowY + static_cast<float>(row) * (chipH + chipGap);
    return {{x, y}, {chipW, chipH}};
}

sf::FloatRect LootFilterLayout::diceChipRect(int index) const {
    const int col = index % 6;
    const int row = index / 6;
    const float x = popupX + padding + static_cast<float>(col) * (chipW + chipGap);
    const float y = popupY + diceRowY + static_cast<float>(row) * (chipH + chipGap);
    return {{x, y}, {chipW, chipH}};
}

sf::FloatRect LootFilterLayout::qualityFieldRect() const {
    const float x = popupX + padding;
    const float y = popupY + inputRowY;
    return {{x, y}, {inputW, inputH}};
}

sf::FloatRect LootFilterLayout::levelFieldRect() const {
    const float x = popupX + padding + inputW + chipGap * 4.0f + levelFieldXOffset;
    const float y = popupY + inputRowY;
    return {{x, y}, {inputW, inputH}};
}

sf::FloatRect LootFilterLayout::unsetButtonRect() const {
    // Bottom-RIGHT corner. The quality-tier swatches draw under the MAX
    // QUALITY field at the bottom-left, so the button lives on the opposite
    // side to keep both clear of each other.
    const float x = popupX + popupW - unsetW - unsetMargin;
    const float y = popupY + popupH - unsetH - unsetMargin;
    return {{x, y}, {unsetW, unsetH}};
}

bool LootFilterLayout::unsetButtonContains(sf::Vector2f cursor) const {
    return unsetButtonRect().contains(cursor);
}

int LootFilterLayout::weaponChipIndexAt(sf::Vector2f cursor) const {
    for (int i = 0; i < kWeaponChipCount; ++i) {
        if (weaponChipRect(i).contains(cursor)) return i;
    }
    return -1;
}

int LootFilterLayout::diceChipIndexAt(sf::Vector2f cursor) const {
    for (int i = 0; i < kDiceChipCount; ++i) {
        if (diceChipRect(i).contains(cursor)) return i;
    }
    return -1;
}

} // namespace dof::render
