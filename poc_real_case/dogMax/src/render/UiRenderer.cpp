#include "render/UiRenderer.hpp"

#include "core/World.hpp"
#include "entities/Hero.hpp"
#include "entities/QualityTier.hpp"
#include "entities/SpecialEnemyKind.hpp"
#include "loaders/ConfigLoader.hpp"
#include "loaders/ShaderLoader.hpp"
#include "render/BarLayout.hpp"
#include "render/ColorTheme.hpp"
#include "render/UiAccent.hpp"
#include "render/ui/UiPanel.hpp"
#include "render/ui/PixelSnap.hpp"

#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Text.hpp>
#include <SFML/Graphics/Shader.hpp>
#include <SFML/Graphics/Texture.hpp>
#include <SFML/Graphics/Sprite.hpp>

#include <algorithm>
#include <sstream>

namespace dof::render {

UiRenderer::UiRenderer(const dof::loaders::ConfigLoader& config,
                       const ColorTheme& themeInit,
                       const sf::Font& fontInit,
                       const dof::loaders::ShaderLoader* shaders)
    : theme(themeInit), font(fontInit), shadersPtr(shaders) {
    fpsFontSize       = config.getFloat("UI_FONT_SIZE_FPS");
    smallFontSize     = config.getFloat("UI_FONT_SIZE_SMALL");
    labelFontSize     = config.getFloat("UI_FONT_SIZE_LABEL");
    fpsMargin         = config.getFloat("UI_FPS_MARGIN");
    fpsLabelColor = UiAccent::loadFromConfig(config).full();

    deathFadeDuration   = config.getFloat("HERO_DEATH_FADE_DURATION");
    deathFadePeakAlpha  = config.getInt("HERO_DEATH_FADE_PEAK_ALPHA");
    deathFadeTint       = readRgb(config, "HERO_DEATH_FADE_TINT_R",
                                            "HERO_DEATH_FADE_TINT_G",
                                            "HERO_DEATH_FADE_TINT_B");
    deathPanelWidth     = config.getFloat("HERO_DEATH_PANEL_WIDTH");
    deathPanelHeight    = config.getFloat("HERO_DEATH_PANEL_HEIGHT");
    deathPanelBg        = readRgba(config, "HERO_DEATH_PANEL_BG_R", "HERO_DEATH_PANEL_BG_G",
                                            "HERO_DEATH_PANEL_BG_B", "HERO_DEATH_PANEL_BG_A");
    deathPanelOutline   = readRgb(config, "HERO_DEATH_PANEL_OUTLINE_R",
                                            "HERO_DEATH_PANEL_OUTLINE_G",
                                            "HERO_DEATH_PANEL_OUTLINE_B");
    deathPanelOutlineThickness = config.getFloat("HERO_DEATH_PANEL_OUTLINE_THICKNESS");
    deathCaptureWidth = config.getFloat("HERO_DEATH_CAPTURE_WIDTH");
    deathCaptureHeight = config.getFloat("HERO_DEATH_CAPTURE_HEIGHT");
    deathCaptureTopMargin = config.getFloat("HERO_DEATH_CAPTURE_TOP_MARGIN");
    deathCaptureBorderThickness = config.getFloat("HERO_DEATH_CAPTURE_BORDER_THICKNESS");
    deathCaptureBorder = readRgb(config, "HERO_DEATH_CAPTURE_BORDER_R",
                                         "HERO_DEATH_CAPTURE_BORDER_G",
                                         "HERO_DEATH_CAPTURE_BORDER_B");
    deathKillerMarkerRadius = config.getFloat("HERO_DEATH_KILLER_MARKER_RADIUS");
    deathKillerMarkerThickness = config.getFloat("HERO_DEATH_KILLER_MARKER_THICKNESS");
    deathKillerMarkerInset = config.getFloat("HERO_DEATH_KILLER_MARKER_INSET");
    deathKillerMarker = readRgb(config, "HERO_DEATH_KILLER_MARKER_R",
                                        "HERO_DEATH_KILLER_MARKER_G",
                                        "HERO_DEATH_KILLER_MARKER_B");
    deathCaptionBg = readRgb(config, "HERO_DEATH_CAPTION_BG_R",
                                    "HERO_DEATH_CAPTION_BG_G",
                                    "HERO_DEATH_CAPTION_BG_B");
    deathCaptionBgAlpha = config.getInt("HERO_DEATH_CAPTION_BG_ALPHA");
    deathCaptionHeight = config.getFloat("HERO_DEATH_CAPTION_HEIGHT");
}

void UiRenderer::render(sf::RenderWindow& window, float fps) {
    // Part 2 — runs under the design-sized UI view installed by
    // `GameSession::renderFrame`. We intentionally do NOT install our
    // own view here so every UI element shares the same letterbox
    // viewport (uniform scale). `window.getView().getSize()` returns
    // the design dimensions, not raw window pixels.
    drawFpsLabel(window, fps);
    // XP / level now live in the bottom info bar (WeaponSlotSidebar), not a
    // standalone bottom-center bar.
}

void UiRenderer::renderHeroDeathOverlay(sf::RenderWindow& window,
                                        const dof::core::World& world,
                                        const sf::View& worldView) {
    // Capture the complete fatal gameplay frame after all ordinary HUD layers,
    // then keep the death fade and recap above every interactive panel.
    captureHeroDeathFrame(window, world, worldView);
    drawHeroDeathFade(window, world);
    drawHeroDeathPanel(window, world);
}

void UiRenderer::captureHeroDeathFrame(sf::RenderWindow& window,
                                       const dof::core::World& world,
                                       const sf::View& worldView) {
    const auto& hero = world.hero();
    if (!hero.damageable().isDead()) {
        deathCaptureTexture.reset();
        deathCaptureSourceSize = {};
        deathKillerPixel = {};
        deathKillerWasOnScreen = false;
        return;
    }
    if (deathCaptureTexture.has_value()) return;

    deathCaptureSourceSize = window.getSize();
    if (deathCaptureSourceSize.x == 0 || deathCaptureSourceSize.y == 0) return;
    deathCaptureTexture.emplace(deathCaptureSourceSize);
    deathCaptureTexture->update(window);

    if (!hero.deathRecap().has_value()) return;
    deathKillerPixel = window.mapCoordsToPixel(hero.deathRecap()->enemyPosition, worldView);
    const sf::FloatRect viewport = worldView.getViewport();
    const int viewportLeft = static_cast<int>(viewport.position.x * deathCaptureSourceSize.x);
    const int viewportTop = static_cast<int>(viewport.position.y * deathCaptureSourceSize.y);
    const int viewportRight = static_cast<int>((viewport.position.x + viewport.size.x)
                                                * deathCaptureSourceSize.x);
    const int viewportBottom = static_cast<int>((viewport.position.y + viewport.size.y)
                                                 * deathCaptureSourceSize.y);
    deathKillerWasOnScreen = deathKillerPixel.x >= viewportLeft
                          && deathKillerPixel.x < viewportRight
                          && deathKillerPixel.y >= viewportTop
                          && deathKillerPixel.y < viewportBottom;
}

void UiRenderer::drawFpsLabel(sf::RenderWindow& window, float fps) {
    sf::Text label(font, "", static_cast<unsigned>(fpsFontSize));
    std::ostringstream out;
    out.setf(std::ios::fixed);
    out.precision(1);
    out << "FPS " << fps;
    label.setString(out.str());
    label.setFillColor(fpsLabelColor);
    const auto viewSize = window.getView().getSize();
    label.setPosition({viewSize.x - fpsMargin - 80.0f, fpsMargin});
    window.draw(label);
}

void UiRenderer::drawHeroDeathFade(sf::RenderWindow& window, const dof::core::World& world) {
    const auto& hero = world.hero();
    if (!hero.damageable().isDead()) return;
    const float timer = hero.deathable().deathTimer;
    const float duration = deathFadeDuration > 0.0f ? deathFadeDuration : 1.0f;
    const float progress = std::clamp(timer / duration, 0.0f, 1.0f);
    const int alpha = static_cast<int>(static_cast<float>(deathFadePeakAlpha) * progress);
    sf::Color tint = deathFadeTint;
    tint.a = static_cast<std::uint8_t>(std::clamp(alpha, 0, 255));

    const sf::Shader* desatShader = shadersPtr ? shadersPtr->getShader("desaturation") : nullptr;
    bool shaderSucceeded = false;
    if (desatShader) {
        try {
            sf::Texture screenTex(window.getSize());
            screenTex.update(window);
            sf::Sprite screenSprite(screenTex);

            sf::Shader* mutableShader = const_cast<sf::Shader*>(desatShader);
            mutableShader->setUniform("u_desaturation", progress);

            sf::RenderStates states;
            states.shader = desatShader;
            // screenSprite's local bounds are window.getSize() (raw pixels),
            // but the caller's active view (uiView) is in UI-design-space
            // units, not window pixels — drawing it there under-covers the
            // frame whenever the window isn't exactly the design resolution
            // (only the top-left design-sized region gets stretched across
            // the whole window). Draw under the default (pixel-space) view,
            // where the sprite's pixel-sized bounds match 1:1, then restore.
            const sf::View savedView = window.getView();
            window.setView(window.getDefaultView());
            window.draw(screenSprite, states);
            window.setView(savedView);
            shaderSucceeded = true;
        } catch (const std::exception&) {
            // CPU fallback is handled below
        }
    }

    // Only draw the CPU tint overlay when the shader path did not succeed
    // (shader + tint would double-composite and over-darken the frame).
    if (!shaderSucceeded) {
        const auto overlaySize = window.getView().getSize();
        sf::RectangleShape overlay({overlaySize.x, overlaySize.y});
        overlay.setFillColor(tint);
        window.draw(overlay);
    }
}

void UiRenderer::drawHeroDeathPanel(sf::RenderWindow& window, const dof::core::World& world) {
    const auto& hero = world.hero();
    if (!hero.damageable().isDead()) return;
    const sf::Vector2f windowSize = window.getView().getSize();
    ui::UiPanel panel;
    panel.background      = deathPanelBg;
    panel.border          = deathPanelOutline;
    panel.borderThickness = deathPanelOutlineThickness;
    const sf::FloatRect panelRect{{(windowSize.x - deathPanelWidth) / 2.0f,
                                   (windowSize.y - deathPanelHeight) / 2.0f},
                                  {deathPanelWidth, deathPanelHeight}};
    panel.draw(window, panelRect);

    auto drawCentered = [&](const std::string& text, float fontSize, float yPosition,
                             const sf::Color& fill) {
        const float maxTextWidth = std::max(80.0f, deathPanelWidth - 56.0f);
        unsigned characterSize = static_cast<unsigned>(fontSize);
        sf::Text label(font, text, characterSize);
        label.setFillColor(fill);
        label.setOutlineColor(sf::Color::Black);
        label.setOutlineThickness(1.0f);
        while (characterSize > 10u && label.getLocalBounds().size.x > maxTextWidth) {
            --characterSize;
            label.setCharacterSize(characterSize);
        }
        ui::centerOriginOf(label);
        label.setPosition({windowSize.x / 2.0f, yPosition});
        window.draw(label);
    };

    const auto& levelable = hero.levelable();
    const float titleSize = labelFontSize * 1.8f;
    drawCentered("DEATH RECAP", titleSize,
                 panelRect.position.y + deathCaptureTopMargin * 0.45f, deathPanelOutline);

    const sf::FloatRect captureRect{
        {windowSize.x / 2.0f - deathCaptureWidth / 2.0f,
         panelRect.position.y + deathCaptureTopMargin},
        {deathCaptureWidth, deathCaptureHeight}};
    sf::RectangleShape captureBorder(captureRect.size);
    captureBorder.setPosition(captureRect.position);
    captureBorder.setFillColor(sf::Color::Transparent);
    captureBorder.setOutlineColor(deathCaptureBorder);
    captureBorder.setOutlineThickness(deathCaptureBorderThickness);

    if (deathCaptureTexture.has_value()
        && deathCaptureSourceSize.x > 0 && deathCaptureSourceSize.y > 0) {
        sf::Sprite captureSprite(*deathCaptureTexture);
        captureSprite.setPosition(captureRect.position);
        captureSprite.setScale({captureRect.size.x / static_cast<float>(deathCaptureSourceSize.x),
                                captureRect.size.y / static_cast<float>(deathCaptureSourceSize.y)});
        window.draw(captureSprite);
    }
    window.draw(captureBorder);

    std::string killerName = "Unknown enemy";
    std::string attackName = hero.damageable().lastDamageAttackName().empty()
        ? std::string("Unknown Attack")
        : hero.damageable().lastDamageAttackName();
    float fatalDamage = hero.damageable().lastDamageAmount();
    if (hero.deathRecap().has_value()) {
        const auto& recap = *hero.deathRecap();
        std::ostringstream killer;
        if (recap.enemySpecialKind != dof::entities::SpecialEnemyKind::None) {
            killer << dof::entities::specialEnemyKindLabel(recap.enemySpecialKind);
        } else {
            killer << dof::entities::qualityTierName(recap.enemyTier) << " Enemy";
        }
        killer << " #" << recap.enemyId.value << "  Level " << recap.enemyLevel;
        killerName = killer.str();
        attackName = recap.attackName;
        fatalDamage = recap.damage;

        if (deathCaptureSourceSize.x > 0 && deathCaptureSourceSize.y > 0) {
            sf::Vector2f markerPosition{
                captureRect.position.x + captureRect.size.x
                    * static_cast<float>(deathKillerPixel.x)
                    / static_cast<float>(deathCaptureSourceSize.x),
                captureRect.position.y + captureRect.size.y
                    * static_cast<float>(deathKillerPixel.y)
                    / static_cast<float>(deathCaptureSourceSize.y)};
            markerPosition.x = std::clamp(markerPosition.x,
                captureRect.position.x + deathKillerMarkerInset,
                captureRect.position.x + captureRect.size.x - deathKillerMarkerInset);
            markerPosition.y = std::clamp(markerPosition.y,
                captureRect.position.y + deathKillerMarkerInset,
                captureRect.position.y + captureRect.size.y - deathKillerMarkerInset
                    - deathCaptionHeight);

            sf::CircleShape marker(deathKillerMarkerRadius);
            marker.setOrigin({deathKillerMarkerRadius, deathKillerMarkerRadius});
            marker.setPosition(markerPosition);
            marker.setFillColor(sf::Color::Transparent);
            marker.setOutlineColor(deathKillerMarker);
            marker.setOutlineThickness(deathKillerMarkerThickness);
            window.draw(marker);

            sf::RectangleShape horizontal({deathKillerMarkerRadius * 2.0f,
                                           deathKillerMarkerThickness});
            horizontal.setOrigin({deathKillerMarkerRadius,
                                  deathKillerMarkerThickness / 2.0f});
            horizontal.setPosition(markerPosition);
            horizontal.setFillColor(deathKillerMarker);
            window.draw(horizontal);
            sf::RectangleShape vertical({deathKillerMarkerThickness,
                                         deathKillerMarkerRadius * 2.0f});
            vertical.setOrigin({deathKillerMarkerThickness / 2.0f,
                                deathKillerMarkerRadius});
            vertical.setPosition(markerPosition);
            vertical.setFillColor(deathKillerMarker);
            window.draw(vertical);
        }
    }

    sf::RectangleShape caption({captureRect.size.x, deathCaptionHeight});
    caption.setPosition({captureRect.position.x,
                         captureRect.position.y + captureRect.size.y - deathCaptionHeight});
    sf::Color captionColor = deathCaptionBg;
    captionColor.a = static_cast<std::uint8_t>(std::clamp(deathCaptionBgAlpha, 0, 255));
    caption.setFillColor(captionColor);
    window.draw(caption);
    std::ostringstream captionLine;
    captionLine << (deathKillerWasOnScreen ? "FATAL ENEMY  " : "FATAL ENEMY OFF-SCREEN  ")
                << killerName << "   |   " << attackName
                << "   |   " << static_cast<int>(fatalDamage) << " damage";
    drawCentered(captionLine.str(), smallFontSize,
                 caption.getPosition().y + deathCaptionHeight / 2.0f, theme.uiText);

    const float detailsTop = captureRect.position.y + captureRect.size.y
                           + smallFontSize * 1.5f;
    std::ostringstream runLine;
    runLine << "Hero Level " << levelable.level << "   |   Run XP " << levelable.experience;
    drawCentered(runLine.str(), smallFontSize, detailsTop, theme.uiText);
    drawCentered("Press Enter to restart", smallFontSize,
                 detailsTop + smallFontSize * 2.0f, deathPanelOutline);
}

}
