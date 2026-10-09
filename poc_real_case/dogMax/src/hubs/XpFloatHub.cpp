#include "hubs/XpFloatHub.hpp"

#include "hubs/EventLifetime.hpp"
#include "loaders/ConfigLoader.hpp"

#include <sstream>

namespace dof::hubs {

XpFloatHub::XpFloatHub(const dof::loaders::ConfigLoader& config) {
    durationSeconds = config.getFloat("XP_FLOAT_DURATION");
    risePixelsValue = config.getFloat("XP_FLOAT_RISE_PIXELS");
    fontSizeValue   = config.getInt("XP_FLOAT_FONT_SIZE");
    colorValue = sf::Color{
        static_cast<std::uint8_t>(config.getInt("XP_FLOAT_COLOR_R")),
        static_cast<std::uint8_t>(config.getInt("XP_FLOAT_COLOR_G")),
        static_cast<std::uint8_t>(config.getInt("XP_FLOAT_COLOR_B"))};
    streakColorValue = sf::Color{
        static_cast<std::uint8_t>(config.getInt("XP_FLOAT_STREAK_COLOR_R")),
        static_cast<std::uint8_t>(config.getInt("XP_FLOAT_STREAK_COLOR_G")),
        static_cast<std::uint8_t>(config.getInt("XP_FLOAT_STREAK_COLOR_B"))};
    streakBump        = config.getInt("XP_FLOAT_STREAK_FONT_SIZE_BUMP_PER_KILL");
    streakMaxFontSize = config.getInt("XP_FLOAT_STREAK_MAX_FONT_SIZE");
}

void XpFloatHub::spawnXp(sf::Vector2f worldPosition, std::int64_t amount, int streakIndex) {
    if (amount <= 0) return;
    if (streakIndex < 1) streakIndex = 1;
    std::ostringstream out;
    out << "+" << amount << " XP";
    if (streakIndex >= 2) {
        // card-mpl8zfv4 — kill-streak suffix so the player reads the
        // multiplier source at a glance. "x3 chain" rides next to the
        // amount so the streak feels like a celebration, not just a
        // colour shift.
        out << " x" << streakIndex;
    }
    XpFloatEvent event;
    event.text = out.str();
    event.worldPosition = worldPosition;
    event.duration = durationSeconds;
    event.streakIndex = streakIndex;
    if (streakIndex >= 2) {
        event.color = streakColorValue;
        const int bumpedSize = fontSizeValue
            + streakBump * (streakIndex - 1);
        event.fontSize = (streakMaxFontSize > 0 && bumpedSize > streakMaxFontSize)
            ? streakMaxFontSize
            : bumpedSize;
    } else {
        event.color    = colorValue;
        event.fontSize = 0;  // renderer falls back to hub default
    }
    activeEvents.push_back(std::move(event));
}

void XpFloatHub::update(float dt) {
    ageAndExpire(activeEvents, dt, [](const XpFloatEvent& event) { return event.duration; });
}

const std::vector<XpFloatEvent>& XpFloatHub::events() const { return activeEvents; }
void XpFloatHub::clear() { activeEvents.clear(); }

float    XpFloatHub::duration() const   { return durationSeconds; }
float    XpFloatHub::risePixels() const { return risePixelsValue; }
int      XpFloatHub::fontSize() const   { return fontSizeValue; }
sf::Color XpFloatHub::textColor() const  { return colorValue; }

}
