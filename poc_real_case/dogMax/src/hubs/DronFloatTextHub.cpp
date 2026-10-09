#include "hubs/DronFloatTextHub.hpp"

#include "hubs/EventLifetime.hpp"
#include "loaders/ConfigLoader.hpp"

#include <sstream>

namespace dof::hubs {

namespace {

dof::combat::DronTier parseTierName(const std::string& token) {
    using T = dof::combat::DronTier;
    if (token == "Hexadron")     return T::Hexadron;
    if (token == "Pentadron")    return T::Pentadron;
    if (token == "TwinTridron")  return T::TwinTridron;
    if (token == "QuadDuodron")  return T::QuadDuodron;
    if (token == "Omidron")      return T::Omidron;
    if (token == "Hemidron")     return T::Hemidron;
    if (token == "TriduoDron")   return T::TriduoDron;
    if (token == "Tetradron")    return T::Tetradron;
    if (token == "Lineadron")    return T::Lineadron;
    if (token == "SplitSeqdron") return T::SplitSeqdron;
    if (token == "Mixdron")      return T::Mixdron;
    if (token == "Minidron")     return T::Minidron;
    if (token == "Tridron")      return T::Tridron;
    if (token == "Duodron")      return T::Duodron;
    return T::Voidron;
}

}

DronFloatTextHub::DronFloatTextHub(const dof::loaders::ConfigLoader& config) {
    durationSeconds  = config.getFloat("DRON_FLOAT_TEXT_DURATION");
    fadeInSeconds    = config.getFloat("DRON_FLOAT_FADE_IN");
    fadeOutSeconds   = config.getFloat("DRON_FLOAT_FADE_OUT");
    risePixelsValue  = config.getFloat("DRON_FLOAT_RISE_PIXELS");
    fontSizeName_    = config.getInt("DRON_FLOAT_FONT_SIZE_NAME");
    fontSizeMult_    = config.getInt("DRON_FLOAT_FONT_SIZE_MULT");
    textColor = sf::Color{
        static_cast<std::uint8_t>(config.getInt("DRON_FLOAT_COLOR_R")),
        static_cast<std::uint8_t>(config.getInt("DRON_FLOAT_COLOR_G")),
        static_cast<std::uint8_t>(config.getInt("DRON_FLOAT_COLOR_B"))};
    // B-UX-6 / SE5 — parse the comma-separated whitelist of tier
    // names from `DRON_FLOAT_ALWAYS_SHOW_TIERS`. Lower tiers stay
    // silent in the sidebar; the multiplier still applies to damage.
    std::stringstream stream(config.getString("DRON_FLOAT_ALWAYS_SHOW_TIERS"));
    std::string token;
    while (std::getline(stream, token, ',')) {
        if (!token.empty()) alwaysShowTiers.insert(parseTierName(token));
    }
}

bool DronFloatTextHub::isTierFloatAllowed(dof::combat::DronTier tier) const {
    return alwaysShowTiers.count(tier) > 0;
}

void DronFloatTextHub::spawn(int weaponRowIndex, sf::Vector2f anchorUi, const dof::combat::DronResult& result) {
    // Voidron is silent via DronResult::isSilent; every other tier
    // updates the `lastNonSilent` accessor (used by tooltip/inspector
    // code that wants the last fired tier irrespective of float
    // visibility). The float LABEL is then additionally gated on the
    // B-UX-6 always-show whitelist so the sidebar doesn't spam
    // low-tier names; the multiplier still applies to damage at
    // WeaponManager regardless.
    if (result.isSilent) return;
    lastNonSilentResult = result;
    hasLastNonSilent = true;
    if (!isTierFloatAllowed(result.tier)) return;

    // SE5 / spec L1347-1366 — per-WeaponSlot single-active-label
    // dedup. Lower enum index = higher rank (Hexadron=0 is the
    // top). For an existing active event on this row:
    //   - new tier higher-ranked → REPLACE (count resets to 1).
    //   - new tier equal         → bump existing count.
    //   - new tier lower-ranked  → silently drop the new event.
    for (auto& existing : activeEvents) {
        if (existing.weaponRowIndex != weaponRowIndex) continue;
        const int newRank      = static_cast<int>(result.tier);
        const int existingRank = static_cast<int>(existing.tier);
        if (newRank < existingRank) {           // higher-ranked replaces lower
            existing.tier       = result.tier;
            existing.name       = result.name;
            existing.multiplier = result.multiplier;
            existing.anchorUi   = anchorUi;
            existing.age        = 0.0f;
            existing.count      = 1;
            return;
        }
        if (newRank == existingRank) {          // same tier bumps the counter
            existing.count     += 1;
            existing.multiplier = result.multiplier;  // refresh in case of jitter
            existing.anchorUi   = anchorUi;
            existing.age        = 0.0f;
            return;
        }
        // newRank > existingRank → lower-ranked event silently dropped.
        return;
    }

    // No active event for this row — push a fresh one.
    DronFloatTextEvent event;
    event.weaponRowIndex = weaponRowIndex;
    event.anchorUi = anchorUi;
    event.name = result.name;
    event.multiplier = result.multiplier;
    event.tier = result.tier;
    event.count = 1;
    activeEvents.push_back(std::move(event));
}

void DronFloatTextHub::update(float dt) {
    ageAndExpire(activeEvents, dt, [this](const DronFloatTextEvent&) { return durationSeconds; });
}

const std::vector<DronFloatTextEvent>& DronFloatTextHub::events() const { return activeEvents; }
void DronFloatTextHub::clear() { activeEvents.clear(); }

float DronFloatTextHub::duration() const { return durationSeconds; }
float DronFloatTextHub::fadeIn()   const { return fadeInSeconds; }
float DronFloatTextHub::fadeOut()  const { return fadeOutSeconds; }
float DronFloatTextHub::risePixels() const { return risePixelsValue; }
int   DronFloatTextHub::fontSizeName() const { return fontSizeName_; }
int   DronFloatTextHub::fontSizeMult() const { return fontSizeMult_; }
sf::Color DronFloatTextHub::color() const { return textColor; }
const dof::combat::DronResult* DronFloatTextHub::lastNonSilent() const {
    return hasLastNonSilent ? &lastNonSilentResult : nullptr;
}

}
