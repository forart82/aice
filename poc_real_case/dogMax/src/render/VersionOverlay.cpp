#include "render/VersionOverlay.hpp"

#include "loaders/ConfigLoader.hpp"

#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Text.hpp>

#include <cstdint>

namespace dof::render {

std::string composeVersionString(int major, int minor, int build) {
    return "v" + std::to_string(major) + "." + std::to_string(minor) + "."
         + std::to_string(build);
}

sf::Vector2f computeBottomRightPosition(sf::Vector2f designSize,
                                        sf::Vector2f textSize,
                                        float marginX, float marginY) {
    return sf::Vector2f{designSize.x - marginX - textSize.x,
                        designSize.y - marginY - textSize.y};
}

VersionNumbers readVersionNumbers(const dof::loaders::ConfigLoader& config) {
    // The dest-only version_build.yaml is absent on a fresh/headless build
    // before the first dogmax relink; fall back to 0 there (getInt throws on a
    // missing key, mirroring HelpOverlay's hasKey guard).
    return VersionNumbers{
        config.getInt("VERSION_MAJOR"),
        config.getInt("VERSION_MINOR"),
        config.hasKey("VERSION_BUILD") ? config.getInt("VERSION_BUILD") : 0};
}

VersionOverlay::VersionOverlay(const dof::loaders::ConfigLoader& config,
                               const sf::Font& fontInit)
    : font(fontInit) {
    const VersionNumbers numbers = readVersionNumbers(config);
    majorValue     = numbers.major;
    minorValue     = numbers.minor;
    buildValue     = numbers.build;
    versionLabel   = composeVersionString(majorValue, minorValue, buildValue);
    timestampLabel = config.hasKey("VERSION_BUILD_TIME")
                   ? config.getString("VERSION_BUILD_TIME") : "";
    marginX           = config.getFloat("VERSION_HUD_MARGIN_X");
    marginY           = config.getFloat("VERSION_HUD_MARGIN_Y");
    fontSize          = config.getFloat("VERSION_HUD_FONT_SIZE");
    timestampFontSize = config.getFloat("VERSION_HUD_TIMESTAMP_FONT_SIZE");
    lineSpacing       = config.getFloat("VERSION_HUD_LINE_SPACING");
    textColor    = sf::Color{
        static_cast<std::uint8_t>(config.getInt("VERSION_HUD_COLOR_R")),
        static_cast<std::uint8_t>(config.getInt("VERSION_HUD_COLOR_G")),
        static_cast<std::uint8_t>(config.getInt("VERSION_HUD_COLOR_B")),
        static_cast<std::uint8_t>(config.getInt("VERSION_HUD_COLOR_ALPHA"))};
}

void VersionOverlay::render(sf::RenderWindow& window, sf::Vector2u designSize) const {
    const sf::Vector2f ds{static_cast<float>(designSize.x),
                          static_cast<float>(designSize.y)};

    sf::Text vText(font, versionLabel, static_cast<unsigned>(fontSize));
    vText.setFillColor(textColor);
    const auto vb = vText.getLocalBounds();

    // Combined block height: version line + optional timestamp line below.
    const float tsHeight = timestampLabel.empty() ? 0.0f : lineSpacing + timestampFontSize;
    const float blockH = vb.size.y + tsHeight;
    const float blockW = vb.size.x;

    // computeBottomRightPosition aligns the visible top-left of the block to
    // sit flush in the bottom-right corner, inset by the configured margins.
    const sf::Vector2f corner = computeBottomRightPosition(ds, {blockW, blockH},
                                                           marginX, marginY);
    vText.setPosition({corner.x - vb.position.x, corner.y - vb.position.y});
    window.draw(vText);

    if (!timestampLabel.empty()) {
        sf::Text tsText(font, timestampLabel, static_cast<unsigned>(timestampFontSize));
        tsText.setFillColor(textColor);
        const auto tb = tsText.getLocalBounds();
        // Right-align timestamp under version; Y advances past the version block.
        const float tsX = corner.x + blockW - tb.size.x - tb.position.x;
        const float tsY = corner.y + vb.size.y + lineSpacing - tb.position.y;
        tsText.setPosition({tsX, tsY});
        window.draw(tsText);
    }
}

}
