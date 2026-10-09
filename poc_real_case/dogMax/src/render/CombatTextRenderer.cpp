#include "render/CombatTextRenderer.hpp"

#include "combat/DronDetector.hpp"
#include "hubs/DamageTextHub.hpp"
#include "hubs/DronFloatTextHub.hpp"
#include "hubs/XpFloatHub.hpp"
#include "loaders/ConfigLoader.hpp"
#include "render/DamageTextQualityTint.hpp"
#include "render/DronTierPalette.hpp"
#include "render/WeaponSlotLayout.hpp"

#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Text.hpp>

#include <algorithm>
#include <sstream>

namespace dof::render {

CombatTextRenderer::CombatTextRenderer(const dof::loaders::ConfigLoader& config, const ColorTheme& themeInit, const sf::Font& fontInit)
    : theme(themeInit), font(fontInit) {
    qualityTintBlend = config.getFloat("DAMAGE_TEXT_QUALITY_TINT_BLEND");
    // SA25 — pre-bake the 15 per-tier float-label colours so the hot
    // render path doesn't reformat config keys per event. Indexed by
    // the `DronTier` enum value.
    const dof::combat::DronTier tiers[15] = {
        dof::combat::DronTier::Hexadron, dof::combat::DronTier::Pentadron,
        dof::combat::DronTier::TwinTridron, dof::combat::DronTier::QuadDuodron,
        dof::combat::DronTier::Omidron, dof::combat::DronTier::Hemidron,
        dof::combat::DronTier::TriduoDron, dof::combat::DronTier::Tetradron,
        dof::combat::DronTier::Lineadron, dof::combat::DronTier::SplitSeqdron,
        dof::combat::DronTier::Mixdron, dof::combat::DronTier::Minidron,
        dof::combat::DronTier::Tridron,
        dof::combat::DronTier::Duodron, dof::combat::DronTier::Voidron};
    for (int i = 0; i < 15; ++i) dronTierPalette[i] = tierFloatColor(tiers[i], config);
}

void CombatTextRenderer::drawWorldDamageText(sf::RenderTarget& window, const dof::hubs::DamageTextHub& damageTextHub) {
    for (const auto& event : damageTextHub.events()) {
        const float lifeRatio = std::clamp(event.age / std::max(0.001f, event.duration), 0.0f, 1.0f);
        // SA46 / spec §Appendix J L4234 — vertical drift is `MOVE_SPEED *
        // age`, NOT `RISE_PIXELS * lifeRatio`. At the default duration
        // of 1.0 s the visual is identical (80 px traveled by end of
        // life), but a longer duration no longer slows the float.
        const float rise = damageTextHub.moveSpeed() * event.age;
        sf::Text label(font, event.text, static_cast<unsigned>(event.fontSize));
        // SA19 / spec §Quality §Tier Visual L1798: blend the source
        // item's tier palette into the amount-tier base before the
        // life-ratio alpha drop. The blend factor is config-driven so
        // the hue mix stays tuneable without a rebuild.
        sf::Color color = tintByQuality(event.color, event.sourceTier, qualityTintBlend, theme);
        color.a = static_cast<std::uint8_t>(std::clamp(255.0f * (1.0f - lifeRatio), 0.0f, 255.0f));
        label.setFillColor(color);
        // Spec §Appendix J §Damage Text — 1 px black outline so the
        // tinted text stays readable against bright enemy bodies.
        label.setOutlineColor(sf::Color::Black);
        label.setOutlineThickness(1.0f);
        auto bounds = label.getLocalBounds();
        label.setOrigin({bounds.size.x * 0.5f, bounds.size.y});
        label.setPosition({event.worldPosition.x,
                            event.worldPosition.y - 40.0f - rise});
        window.draw(label);
    }
}

void CombatTextRenderer::drawWorldXpFloats(sf::RenderTarget& window, const dof::hubs::XpFloatHub& xpFloatHub) {
    for (const auto& event : xpFloatHub.events()) {
        const float lifeRatio = std::clamp(event.age / std::max(0.001f, event.duration), 0.0f, 1.0f);
        const float rise = xpFloatHub.risePixels() * lifeRatio;
        // card-mpl8zfv4 — per-event font size override. 0 means "use
        // the hub default"; non-zero (set by the streak path) scales
        // the label up so chained kills read bigger than a single
        // kill, matching the gold streak palette.
        const unsigned size = event.fontSize > 0
            ? static_cast<unsigned>(event.fontSize)
            : static_cast<unsigned>(xpFloatHub.fontSize());
        sf::Text label(font, event.text, size);
        sf::Color color = event.color;
        color.a = static_cast<std::uint8_t>(std::clamp(255.0f * (1.0f - lifeRatio), 0.0f, 255.0f));
        label.setFillColor(color);
        label.setOutlineColor(sf::Color::Black);
        label.setOutlineThickness(1.0f);
        const auto bounds = label.getLocalBounds();
        label.setOrigin({bounds.size.x * 0.5f, bounds.size.y});
        label.setPosition({event.worldPosition.x,
                            event.worldPosition.y - 60.0f - rise});
        window.draw(label);
    }
}

void CombatTextRenderer::drawUiDronLabels(sf::RenderTarget& window,
                                          const dof::hubs::DronFloatTextHub& dronFloatTextHub,
                                          const WeaponSlotLayout& weaponSlotLayout) {
    for (const auto& event : dronFloatTextHub.events()) {
        const float duration = dronFloatTextHub.duration();
        const float fadeIn = dronFloatTextHub.fadeIn();
        const float fadeOut = dronFloatTextHub.fadeOut();
        float alpha = 1.0f;
        if (event.age < fadeIn) alpha = event.age / std::max(0.01f, fadeIn);
        else if (event.age > duration - fadeOut) alpha = std::max(0.0f, (duration - event.age) / std::max(0.01f, fadeOut));
        // SA25 — per-tier palette overrides the global gold so the
        // player can read the dron tier at a glance. Falls back to the
        // hub's default if the tier index is somehow out of range.
        const int tierIndex = static_cast<int>(event.tier);
        sf::Color color = (tierIndex >= 0 && tierIndex < static_cast<int>(dronTierPalette.size()))
                            ? dronTierPalette[tierIndex]
                            : dronFloatTextHub.color();
        color.a = static_cast<std::uint8_t>(std::clamp(alpha * 255.0f, 0.0f, 255.0f));

        auto rowRect = weaponSlotLayout.rowRect(event.weaponRowIndex);
        const float safeDuration = std::max(0.001f, duration);
        const float rise = dronFloatTextHub.risePixels() * (event.age / safeDuration);
        const sf::Vector2f anchor{rowRect.position.x + rowRect.size.x * 0.5f,
                                    rowRect.position.y - 4.0f - rise};

        // SE5 / spec L1347-1366 — when the same tier has repeated on
        // this slot inside the active label's lifetime, render the
        // dedup counter inline as `Tier (×N)`.
        std::string displayName = event.name;
        if (event.count > 1) {
            std::ostringstream nameStream;
            nameStream << event.name << " (\xc3\x97" << event.count << ")";
            displayName = nameStream.str();
        }
        sf::Text nameLabel(font, displayName, static_cast<unsigned>(dronFloatTextHub.fontSizeName()));
        auto nameBounds = nameLabel.getLocalBounds();
        nameLabel.setOrigin({nameBounds.size.x * 0.5f, nameBounds.size.y});
        nameLabel.setPosition({anchor.x, anchor.y});
        nameLabel.setFillColor(color);
        window.draw(nameLabel);

        std::ostringstream multText;
        multText << "x" << event.multiplier;
        sf::Text multLabel(font, multText.str(), static_cast<unsigned>(dronFloatTextHub.fontSizeMult()));
        auto multBounds = multLabel.getLocalBounds();
        multLabel.setOrigin({multBounds.size.x * 0.5f, 0.0f});
        multLabel.setPosition({anchor.x, anchor.y + 2.0f});
        multLabel.setFillColor(color);
        window.draw(multLabel);
    }
}

}
