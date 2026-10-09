#include "hubs/DamageTextHub.hpp"

#include "hubs/EventLifetime.hpp"
#include "helpers/RandomHelper.hpp"
#include "loaders/ConfigLoader.hpp"

#include <sstream>

namespace dof::hubs {

DamageTextHub::DamageTextHub(const dof::loaders::ConfigLoader& config,
                             dof::helpers::RandomHelper& rng)
    : rngRef(rng) {
    durationSeconds        = config.getFloat("DAMAGE_TEXT_DURATION");
    moveSpeedValue         = config.getFloat("DAMAGE_TEXT_MOVE_SPEED");
    normalFontSize         = config.getInt("DAMAGE_TEXT_FONT_SIZE");
    heavyFontSize_         = config.getInt("DAMAGE_TEXT_HEAVY_FONT_SIZE");
    critFontSize_          = config.getInt("DAMAGE_TEXT_CRIT_FONT_SIZE");
    heavyThreshold         = config.getFloat("DAMAGE_TEXT_HEAVY_THRESHOLD");
    criticalThreshold      = config.getFloat("DAMAGE_TEXT_CRITICAL_THRESHOLD");
    horizontalJitterPixels = config.getFloat("DAMAGE_TEXT_HORIZONTAL_JITTER");
    normalColor = sf::Color{
        static_cast<std::uint8_t>(config.getInt("DAMAGE_TEXT_COLOR_R")),
        static_cast<std::uint8_t>(config.getInt("DAMAGE_TEXT_COLOR_G")),
        static_cast<std::uint8_t>(config.getInt("DAMAGE_TEXT_COLOR_B"))};
    heavyColor = sf::Color{
        static_cast<std::uint8_t>(config.getInt("DAMAGE_TEXT_HEAVY_COLOR_R")),
        static_cast<std::uint8_t>(config.getInt("DAMAGE_TEXT_HEAVY_COLOR_G")),
        static_cast<std::uint8_t>(config.getInt("DAMAGE_TEXT_HEAVY_COLOR_B"))};
    critColor = sf::Color{
        static_cast<std::uint8_t>(config.getInt("DAMAGE_TEXT_CRIT_COLOR_R")),
        static_cast<std::uint8_t>(config.getInt("DAMAGE_TEXT_CRIT_COLOR_G")),
        static_cast<std::uint8_t>(config.getInt("DAMAGE_TEXT_CRIT_COLOR_B"))};
}

DamageTextTier DamageTextHub::classifyAmount(float amount) const {
    if (amount >= criticalThreshold) return DamageTextTier::Critical;
    if (amount >= heavyThreshold)    return DamageTextTier::Heavy;
    return DamageTextTier::Normal;
}

void DamageTextHub::spawnDamage(sf::Vector2f worldPosition, float amount, bool isCritical,
                                dof::entities::QualityTier sourceTier) {
    std::ostringstream out;
    out << static_cast<int>(amount);
    if (isCritical) out << "!";
    const DamageTextTier tier = classifyAmount(amount);
    // SA21 / spec §Appendix J L4235 — horizontal jitter so stacked hits
    // on the same enemy don't sit on top of each other. Spec literal is
    // a normalised U[−0.5, 0.5]; we scale by the pixel half-range in
    // `DAMAGE_TEXT_HORIZONTAL_JITTER` so the magnitude is tunable.
    if (horizontalJitterPixels > 0.0f) {
        worldPosition.x += rngRef.uniformFloat(-horizontalJitterPixels, horizontalJitterPixels);
    }
    DamageTextEvent event;
    event.text         = out.str();
    event.worldPosition = worldPosition;
    event.duration     = durationSeconds;
    event.isCritical   = isCritical;
    event.tier         = tier;
    event.sourceTier   = sourceTier;
    switch (tier) {
        case DamageTextTier::Normal:
            event.color    = normalColor;
            event.fontSize = normalFontSize;
            break;
        case DamageTextTier::Heavy:
            event.color    = heavyColor;
            event.fontSize = heavyFontSize_;
            break;
        case DamageTextTier::Critical:
            event.color    = critColor;
            event.fontSize = critFontSize_;
            break;
    }
    activeEvents.push_back(std::move(event));
}

void DamageTextHub::update(float dt) {
    ageAndExpire(activeEvents, dt, [](const DamageTextEvent& event) { return event.duration; });
}

const std::vector<DamageTextEvent>& DamageTextHub::events() const { return activeEvents; }
void DamageTextHub::clear() { activeEvents.clear(); }

float DamageTextHub::duration() const { return durationSeconds; }
float DamageTextHub::moveSpeed() const { return moveSpeedValue; }
int   DamageTextHub::fontSize() const { return normalFontSize; }
int   DamageTextHub::heavyFontSize() const { return heavyFontSize_; }
int   DamageTextHub::critFontSize() const { return critFontSize_; }
float DamageTextHub::horizontalJitter() const { return horizontalJitterPixels; }

}
