#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/System/Vector2.hpp>

#include <cstdint>
#include <string>
#include <vector>

namespace dof::loaders { class ConfigLoader; }

namespace dof::hubs {

struct XpFloatEvent {
    std::string  text;
    sf::Vector2f worldPosition;
    float        age{0.0f};
    float        duration{1.0f};
    sf::Color    color{255, 255, 255, 255};
    // card-mpl8zfv4 — per-event font size override. 0 means "use the
    // hub default"; non-zero overrides so kill-streak floats can
    // scale up visibly. `streakIndex` is the streak count at spawn
    // time (1 = first kill, 2+ = chained); the spawn helper uses it
    // to derive both the colour and the font-size bump.
    int          fontSize{0};
    int          streakIndex{1};
};

// Floating "+N XP" feedback that drifts up from the dying enemy
// (card-mpl8zfv4 moved it off the hero so the player sees XP at the
// kill site instead of always above their own sprite). Driven by
// `xp.yaml` keys: XP_FLOAT_DURATION, XP_FLOAT_RISE_PIXELS,
// XP_FLOAT_FONT_SIZE, XP_FLOAT_COLOR_R/G/B plus the streak visuals
// (`XP_FLOAT_STREAK_*`).
class XpFloatHub {
public:
    explicit XpFloatHub(const dof::loaders::ConfigLoader& config);

    // card-mpl8zfv4 — `streakIndex` >= 2 colours the float with the
    // streak palette and bumps the font size by `streakBump` per
    // chained kill, capped at `streakMaxFontSize`. The default
    // (`streakIndex = 1`) keeps existing call-sites at the baseline
    // visual.
    void spawnXp(sf::Vector2f worldPosition, std::int64_t amount, int streakIndex = 1);
    void update(float dt);
    const std::vector<XpFloatEvent>& events() const;
    void clear();

    float    duration() const;
    float    risePixels() const;
    int      fontSize() const;
    sf::Color textColor() const;

private:
    std::vector<XpFloatEvent> activeEvents;
    float     durationSeconds;
    float     risePixelsValue;
    int       fontSizeValue;
    sf::Color colorValue;
    sf::Color streakColorValue;
    int       streakBump;
    int       streakMaxFontSize;
};

}
