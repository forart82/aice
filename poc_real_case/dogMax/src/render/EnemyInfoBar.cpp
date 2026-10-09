#include "render/EnemyInfoBar.hpp"

#include "combat/WeaponFiring.hpp"
#include "entities/Enemy.hpp"
#include "entities/Weapon.hpp"
#include "loaders/ConfigLoader.hpp"
#include "render/WeaponColors.hpp"
#include "render/WeaponSprite.hpp"
#include "render/ui/QuadBatch.hpp"
#include <SFML/Graphics/RenderWindow.hpp>

#include <algorithm>
#include <span>

namespace dof::render {

namespace {

sf::Color withAlpha(sf::Color color, float alphaScalar) {
    color.a = static_cast<std::uint8_t>(
        std::clamp(static_cast<float>(color.a) * alphaScalar, 0.0f, 255.0f));
    return color;
}

}

EnemyInfoBar::EnemyInfoBar(const dof::loaders::ConfigLoader& config)
    : configRef(config) {
    offsetY = config.getFloat("ENEMY_INFO_BAR_OFFSET_Y");
    indicatorSize = config.getFloat("ENEMY_INFO_INDICATOR_SIZE");
    indicatorGap = config.getFloat("ENEMY_INFO_INDICATOR_GAP");
    readinessHeight = config.getFloat("ENEMY_INFO_READINESS_HEIGHT");
    readinessColor = sf::Color{
        static_cast<std::uint8_t>(config.getInt("ENEMY_INFO_READINESS_R")),
        static_cast<std::uint8_t>(config.getInt("ENEMY_INFO_READINESS_G")),
        static_cast<std::uint8_t>(config.getInt("ENEMY_INFO_READINESS_B"))};
    diceColor = sf::Color{
        static_cast<std::uint8_t>(config.getInt("ENEMY_INFO_DICE_R")),
        static_cast<std::uint8_t>(config.getInt("ENEMY_INFO_DICE_G")),
        static_cast<std::uint8_t>(config.getInt("ENEMY_INFO_DICE_B"))};
    chargeWidth = config.getFloat("ENEMY_INFO_UNARMED_CHARGE_WIDTH");
    chargeHeight = config.getFloat("ENEMY_INFO_UNARMED_CHARGE_HEIGHT");
    chargeTrackColor = sf::Color{
        static_cast<std::uint8_t>(config.getInt("ENEMY_INFO_UNARMED_CHARGE_TRACK_R")),
        static_cast<std::uint8_t>(config.getInt("ENEMY_INFO_UNARMED_CHARGE_TRACK_G")),
        static_cast<std::uint8_t>(config.getInt("ENEMY_INFO_UNARMED_CHARGE_TRACK_B"))};
    chargeFillColor = sf::Color{
        static_cast<std::uint8_t>(config.getInt("ENEMY_INFO_UNARMED_CHARGE_FILL_R")),
        static_cast<std::uint8_t>(config.getInt("ENEMY_INFO_UNARMED_CHARGE_FILL_G")),
        static_cast<std::uint8_t>(config.getInt("ENEMY_INFO_UNARMED_CHARGE_FILL_B"))};
}

void EnemyInfoBar::appendChrome(sf::RenderTarget&,
                                ui::QuadBatch& batch,
                                const dof::entities::Enemy& enemy,
                                sf::FloatRect barRect,
                                float scale,
                                float alphaScalar) const {
    if (alphaScalar <= 0.0f) return;

    if (!enemy.loadout().isArmed()) {
        if (enemy.loadout().chargePhase() != dof::abilities::ChargePhase::WindUp) return;
        const float width = chargeWidth * scale;
        const float height = chargeHeight * scale;
        const float left = barRect.position.x + (barRect.size.x - width) * 0.5f;
        const float top = barRect.position.y + barRect.size.y + offsetY * scale;
        batch.addRect({{left, top}, {width, height}},
                      withAlpha(chargeTrackColor, alphaScalar));
        batch.addRect({{left, top},
                       {width * std::clamp(enemy.loadout().bodyCharge().progress(), 0.0f, 1.0f),
                        height}},
                      withAlpha(chargeFillColor, alphaScalar));
        return;
    }

    const float size = indicatorSize * scale;
    const float gap = indicatorGap * scale;
    const float totalWidth = size * 2.0f + gap;
    const float left = barRect.position.x + (barRect.size.x - totalWidth) * 0.5f;
    const float top = barRect.position.y + barRect.size.y + offsetY * scale;

    // One square says "this enemy is armed". One diamond says "at least one
    // die is socketed". Counts and item details belong in the inspector, not
    // in the swarm view.
    batch.addRect({{left, top}, {size, size}}, withAlpha(sf::Color{18, 14, 20}, alphaScalar));

    bool hasDice = false;
    int readyWeaponCount = 0;
    for (int index = 0; index < enemy.loadout().weaponCount(); ++index) {
        const auto* weapon = enemy.loadout().weaponAt(index);
        if (!weapon) continue;
        auto dice = enemy.loadout().weaponDice(index);
        hasDice = hasDice || !dice.empty();
        const std::span<dof::entities::Dice* const> diceSpan(dice);
        if (dof::combat::isWeaponCharged(*weapon, diceSpan)) ++readyWeaponCount;
    }

    if (hasDice) {
        const float diamondLeft = left + size + gap;
        batch.addRect({{diamondLeft, top}, {size, size}}, withAlpha(diceColor, alphaScalar));
        const float inset = size * 0.28f;
        batch.addRect({{diamondLeft + inset, top + inset}, {size - inset * 2.0f, size - inset * 2.0f}},
                      withAlpha(sf::Color{22, 12, 30}, alphaScalar));
    }

    // Readiness is intentionally a small yellow underline. It appears only
    // while a weapon can begin an attack; the red wind-up marker replaces it
    // once the enemy commits.
    if (readyWeaponCount > 0) {
        const float pipWidth = (totalWidth - gap * static_cast<float>(readyWeaponCount - 1))
                             / static_cast<float>(readyWeaponCount);
        for (int pip = 0; pip < readyWeaponCount; ++pip) {
            sf::Color color = readinessColor;
            if (enemy.loadout().isArmedAttackWindingUp() && pip == 0) {
                color = sf::Color{255, 55, 30};
            }
            batch.addRect({{left + static_cast<float>(pip) * (pipWidth + gap), top + size + gap},
                           {pipWidth, readinessHeight * scale}},
                          withAlpha(color, alphaScalar));
        }
    }
}

void EnemyInfoBar::drawForeground(sf::RenderTarget& window,
                                  const dof::entities::Enemy& enemy,
                                  sf::FloatRect barRect,
                                  float scale,
                                  float alphaScalar) const {
    if (alphaScalar <= 0.0f || !enemy.loadout().isArmed()) return;
    const auto* weapon = enemy.loadout().weaponAt(0);
    if (!weapon) return;

    const float size = indicatorSize * scale;
    const float gap = indicatorGap * scale;
    const float totalWidth = size * 2.0f + gap;
    const float left = barRect.position.x + (barRect.size.x - totalWidth) * 0.5f;
    const float top = barRect.position.y + barRect.size.y + offsetY * scale;
    drawWeaponSprite(window, {{left, top}, {size, size}}, weapon->type(), configRef,
                     withAlpha(weaponOutlineColor(configRef, weapon->type()), alphaScalar));
}

}
