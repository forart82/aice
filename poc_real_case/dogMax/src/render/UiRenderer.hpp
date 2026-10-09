#pragma once

#include "render/ColorTheme.hpp"
#include "render/UiAccent.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Texture.hpp>
#include <SFML/Graphics/View.hpp>

#include <optional>

namespace dof::core { class World; }
namespace dof::loaders { class ConfigLoader; class ShaderLoader; }
namespace sf { class RenderWindow; }

namespace dof::render {

class UiRenderer {
public:
    UiRenderer(const dof::loaders::ConfigLoader& config,
               const ColorTheme& theme,
               const sf::Font& font,
               const dof::loaders::ShaderLoader* shaders = nullptr);

    void render(sf::RenderWindow& window, float fps);
    void renderHeroDeathOverlay(sf::RenderWindow& window, const dof::core::World& world,
                                const sf::View& worldView);

private:
    void drawFpsLabel(sf::RenderWindow& window, float fps);
    void drawHeroDeathFade(sf::RenderWindow& window, const dof::core::World& world);
    void captureHeroDeathFrame(sf::RenderWindow& window, const dof::core::World& world,
                               const sf::View& worldView);
    void drawHeroDeathPanel(sf::RenderWindow& window, const dof::core::World& world);

    const ColorTheme theme;
    const sf::Font&  font;
    float            fpsFontSize;
    float            smallFontSize;
    float            labelFontSize;
    float            fpsMargin;
    sf::Color        fpsLabelColor;

    float     deathFadeDuration;
    int       deathFadePeakAlpha;
    sf::Color deathFadeTint;
    float     deathPanelWidth;
    float     deathPanelHeight;
    sf::Color deathPanelBg;
    sf::Color deathPanelOutline;
    float     deathPanelOutlineThickness;
    float     deathCaptureWidth;
    float     deathCaptureHeight;
    float     deathCaptureTopMargin;
    float     deathCaptureBorderThickness;
    float     deathKillerMarkerRadius;
    float     deathKillerMarkerThickness;
    float     deathKillerMarkerInset;
    sf::Color deathCaptureBorder;
    sf::Color deathKillerMarker;
    sf::Color deathCaptionBg;
    int       deathCaptionBgAlpha;
    float     deathCaptionHeight;
    std::optional<sf::Texture> deathCaptureTexture;
    sf::Vector2u deathCaptureSourceSize{};
    sf::Vector2i deathKillerPixel{};
    bool deathKillerWasOnScreen{false};
    const dof::loaders::ShaderLoader* shadersPtr{nullptr};
};

}
