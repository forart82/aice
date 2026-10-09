#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/System/Vector2.hpp>

#include <string>

namespace dof::loaders { class ConfigLoader; }
namespace sf { class RenderWindow; class Font; }

namespace dof::render {

// Pure helpers (unit-tested) ------------------------------------------------

// Compose the on-screen version label, e.g. (0, 1, 5) -> "v0.1.5".
std::string composeVersionString(int major, int minor, int build);

// Top-left position for a text block of `textSize` so it sits flush in the
// bottom-right corner of a `designSize` surface, inset by the given margins.
sf::Vector2f computeBottomRightPosition(sf::Vector2f designSize,
                                        sf::Vector2f textSize,
                                        float marginX, float marginY);

// VERSION_MAJOR/MINOR/BUILD read from config (BUILD falls back to 0 when the
// dest-only version_build.yaml is absent). A free function parses them into a
// plain struct (no SFML) that the overlay reads to draw the label; the same
// struct is available where no overlay is built.
struct VersionNumbers { int major{0}; int minor{0}; int build{0}; };
VersionNumbers readVersionNumbers(const dof::loaders::ConfigLoader& config);

// Bottom-right build-version label, drawn in the UI pass. The BUILD number is
// auto-incremented per relink by the CMake post-build step (see
// cmake/BumpBuildNumber.cmake) so a fresh binary reads as a fresh version.
class VersionOverlay {
public:
    VersionOverlay(const dof::loaders::ConfigLoader& config, const sf::Font& font);

    // Draw `vMAJOR.MINOR.BUILD` + build timestamp at the bottom-right.
    void render(sf::RenderWindow& window, sf::Vector2u designSize) const;

    // Read-back accessors for the parsed version numbers.
    const std::string& versionString() const { return versionLabel; }
    const std::string& timestamp()     const { return timestampLabel; }
    int major() const { return majorValue; }
    int minor() const { return minorValue; }
    int build() const { return buildValue; }

private:
    const sf::Font& font;
    sf::Color       textColor;
    std::string     versionLabel;
    std::string     timestampLabel;
    int             majorValue{0};
    int             minorValue{0};
    int             buildValue{0};
    float           marginX{10.0f};
    float           marginY{8.0f};
    float           fontSize{13.0f};
    float           timestampFontSize{10.0f};
    float           lineSpacing{4.0f};
};

}
