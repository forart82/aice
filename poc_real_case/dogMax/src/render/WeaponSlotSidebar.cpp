#include "render/WeaponSlotSidebar.hpp"

#include "combat/DodgeSystem.hpp"
#include "combat/DronDetector.hpp"
#include "entities/Dice.hpp"
#include "entities/Hero.hpp"
#include "entities/Weapon.hpp"
#include "hubs/LuckHub.hpp"
#include "hubs/PowderHub.hpp"
#include "hubs/WeaponSlotHub.hpp"
#include "loaders/ConfigLoader.hpp"
#include "loaders/ShaderLoader.hpp"
#include "render/DiceColor.hpp"
#include "render/Letterbox.hpp"
#include "render/OutlineIntensity.hpp"
#include "render/UiAccent.hpp"
#include "render/UiState.hpp"
#include "render/WeaponColors.hpp"
#include "render/WeaponSprite.hpp"
#include "render/WeaponSlotLayout.hpp"
#include "render/ui/PixelSnap.hpp"
#include "render/ui/UiChip.hpp"
#include "render/ui/UiLabel.hpp"
#include "render/ui/UiPanel.hpp"
#include "render/widgets/UiDronCell.hpp"

#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/ConvexShape.hpp>
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Shader.hpp>
#include <SFML/Graphics/Sprite.hpp>
#include <SFML/Graphics/Text.hpp>
#include <SFML/Graphics/VertexArray.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <string_view>

namespace dof::render {

namespace {

sf::Color diceColor(const dof::loaders::ConfigLoader& config, dof::entities::DiceFace face) {
    return diceColorForFace(config, face);
}

float pickupGlowAmount(float phase) {
    phase = std::clamp(phase, 0.0f, 1.0f);
    constexpr float kAttackPortion = 0.22f;
    if (phase <= kAttackPortion) {
        const float t = phase / kAttackPortion;
        return 1.0f - std::pow(1.0f - t, 3.0f);
    }
    const float t = (phase - kAttackPortion) / (1.0f - kAttackPortion);
    const float remaining = 1.0f - t;
    return remaining * remaining;
}

sf::Color mixColor(sf::Color from, sf::Color to, float amount) {
    amount = std::clamp(amount, 0.0f, 1.0f);
    auto mix = [amount](std::uint8_t a, std::uint8_t b) {
        return static_cast<std::uint8_t>(
            std::clamp(static_cast<float>(a)
                       + (static_cast<float>(b) - static_cast<float>(a)) * amount,
                       0.0f, 255.0f));
    };
    return {mix(from.r, to.r), mix(from.g, to.g), mix(from.b, to.b), mix(from.a, to.a)};
}

sf::FloatRect insetRect(sf::FloatRect rect, float inset) {
    const float safeInset = std::max(0.0f, inset);
    return sf::FloatRect{{rect.position.x + safeInset, rect.position.y + safeInset},
                         {std::max(0.0f, rect.size.x - safeInset * 2.0f),
                          std::max(0.0f, rect.size.y - safeInset * 2.0f)}};
}

sf::ConvexShape makeChamferedBox(sf::FloatRect rect, float chamfer) {
    const float c = std::clamp(chamfer, 0.0f, std::min(rect.size.x, rect.size.y) * 0.5f);
    sf::ConvexShape shape(6);
    shape.setPoint(0, {rect.position.x + c, rect.position.y});
    shape.setPoint(1, {rect.position.x + rect.size.x - c, rect.position.y});
    shape.setPoint(2, {rect.position.x + rect.size.x, rect.position.y + rect.size.y * 0.5f});
    shape.setPoint(3, {rect.position.x + rect.size.x - c, rect.position.y + rect.size.y});
    shape.setPoint(4, {rect.position.x + c, rect.position.y + rect.size.y});
    shape.setPoint(5, {rect.position.x, rect.position.y + rect.size.y * 0.5f});
    return shape;
}

void drawChamferedBox(sf::RenderWindow& window,
                      sf::FloatRect rect,
                      float chamfer,
                      sf::Color color,
                      sf::BlendMode blend = sf::BlendAlpha) {
    if (rect.size.x <= 0.0f || rect.size.y <= 0.0f || color.a == 0) return;
    sf::ConvexShape shape = makeChamferedBox(rect, chamfer);
    shape.setFillColor(color);
    window.draw(shape, blend);
}

void drawOval(sf::RenderWindow& window,
              sf::FloatRect rect,
              sf::Color color,
              sf::BlendMode blend = sf::BlendAlpha) {
    if (rect.size.x <= 0.0f || rect.size.y <= 0.0f || color.a == 0) return;
    sf::CircleShape oval(1.0f, 40);
    oval.setOrigin({1.0f, 1.0f});
    oval.setPosition({rect.position.x + rect.size.x * 0.5f,
                      rect.position.y + rect.size.y * 0.5f});
    oval.setScale({rect.size.x * 0.5f, rect.size.y * 0.5f});
    oval.setFillColor(color);
    window.draw(oval, blend);
}

void drawHorizontalCapsule(sf::RenderWindow& window,
                           sf::FloatRect rect,
                           sf::Color color,
                           sf::BlendMode blend = sf::BlendAlpha) {
    if (rect.size.x <= 0.0f || rect.size.y <= 0.0f || color.a == 0) return;
    if (rect.size.x <= rect.size.y) {
        drawOval(window, rect, color, blend);
        return;
    }
    const float radius = rect.size.y * 0.5f;
    sf::RectangleShape body({std::max(0.0f, rect.size.x - radius * 2.0f), rect.size.y});
    body.setPosition({rect.position.x + radius, rect.position.y});
    body.setFillColor(color);
    body.setOutlineThickness(0.0f);
    window.draw(body, blend);
    drawOval(window,
             sf::FloatRect{{rect.position.x, rect.position.y}, {rect.size.y, rect.size.y}},
             color,
             blend);
    drawOval(window,
             sf::FloatRect{{rect.position.x + rect.size.x - rect.size.y, rect.position.y},
                           {rect.size.y, rect.size.y}},
             color,
             blend);
}

sf::FloatRect fractionRect(sf::FloatRect area,
                           float x,
                           float y,
                           float width,
                           float height) {
    return sf::FloatRect{{area.position.x + area.size.x * x,
                          area.position.y + area.size.y * y},
                         {area.size.x * std::max(0.0f, width),
                          area.size.y * std::max(0.0f, height)}};
}

void drawXpRail(sf::RenderWindow& window,
                sf::FloatRect rect,
                float ratio,
                sf::Color accent,
                const dof::loaders::ConfigLoader& config) {
    const float railH = std::clamp(config.getFloat("INFOBAR_XP_RAIL_HEIGHT"),
                                   2.0f,
                                   std::max(2.0f, rect.size.y));
    const float y = rect.position.y + (rect.size.y - railH) * 0.5f;
    const sf::FloatRect rail{{rect.position.x, y}, {rect.size.x, railH}};
    const float border = std::max(0.0f, config.getFloat("INFOBAR_XP_RAIL_BORDER"));

    const sf::Color shadow = readRgba(config,
                                      "INFOBAR_XP_RAIL_SHADOW_R",
                                      "INFOBAR_XP_RAIL_SHADOW_G",
                                      "INFOBAR_XP_RAIL_SHADOW_B",
                                      "INFOBAR_XP_RAIL_SHADOW_A");
    const sf::Color shell = readRgba(config,
                                     "INFOBAR_XP_RAIL_SHELL_R",
                                     "INFOBAR_XP_RAIL_SHELL_G",
                                     "INFOBAR_XP_RAIL_SHELL_B",
                                     "INFOBAR_XP_RAIL_SHELL_A");
    const sf::Color glass = readRgba(config,
                                     "INFOBAR_XP_RAIL_GLASS_R",
                                     "INFOBAR_XP_RAIL_GLASS_G",
                                     "INFOBAR_XP_RAIL_GLASS_B",
                                     "INFOBAR_XP_RAIL_GLASS_A");
    const sf::Color highlight = readRgba(config,
                                         "INFOBAR_XP_RAIL_HIGHLIGHT_R",
                                         "INFOBAR_XP_RAIL_HIGHLIGHT_G",
                                         "INFOBAR_XP_RAIL_HIGHLIGHT_B",
                                         "INFOBAR_XP_RAIL_HIGHLIGHT_A");
    sf::Color fillColor = accent;
    fillColor.a = static_cast<std::uint8_t>(
        std::clamp(config.getInt("INFOBAR_XP_RAIL_FILL_A"), 0, 255));

    drawHorizontalCapsule(window,
                          sf::FloatRect{{rail.position.x - 3.0f, rail.position.y - 2.0f},
                                        {rail.size.x + 6.0f, rail.size.y + 4.0f}},
                          shadow);
    drawHorizontalCapsule(window, rail, shell);
    const sf::FloatRect inner = insetRect(rail, border);
    drawHorizontalCapsule(window, inner, glass);

    const float progress = std::clamp(ratio, 0.0f, 1.0f);
    if (progress > 0.0f) {
        sf::FloatRect fill = insetRect(inner, 1.1f);
        fill.size.x *= progress;
        drawHorizontalCapsule(window, fill, fillColor);
    }

    const float highlightY = inner.position.y + inner.size.y * 0.25f;
    ui::drawThinQuad(window,
                     sf::FloatRect{{inner.position.x + inner.size.y * 0.55f, highlightY},
                                   {std::max(0.0f, inner.size.x - inner.size.y * 1.1f), 1.0f}},
                     highlight);
}

void drawHealthTankState(sf::RenderWindow& window,
                         sf::FloatRect area,
                         float ratio,
                         sf::Color fillColor,
                         const dof::loaders::ConfigLoader& config) {
    const sf::FloatRect tank = fractionRect(
        area,
        config.getFloat("INFOBAR_HEALTH_TANK_X_FRACTION"),
        config.getFloat("INFOBAR_HEALTH_TANK_Y_FRACTION"),
        config.getFloat("INFOBAR_HEALTH_TANK_WIDTH_FRACTION"),
        config.getFloat("INFOBAR_HEALTH_TANK_HEIGHT_FRACTION"));
    const float chamfer = config.getFloat("INFOBAR_HEALTH_TANK_CHAMFER");
    const float progress = std::clamp(ratio, 0.0f, 1.0f);

    if (progress > 0.0f) {
        sf::FloatRect live = tank;
        live.position.y += live.size.y * (1.0f - progress);
        live.size.y *= progress;
        const int glowAlphaKey = progress <= config.getFloat("HP_RAMP_LOW_THRESHOLD")
            ? config.getInt("INFOBAR_HEALTH_DANGER_GLOW_A")
            : config.getInt("INFOBAR_HEALTH_FILL_GLOW_A");
        fillColor.a = static_cast<std::uint8_t>(std::clamp(glowAlphaKey, 0, 255));
        drawChamferedBox(window, live, chamfer, fillColor, sf::BlendAdd);
    }

    if (progress >= 1.0f) return;
    sf::FloatRect empty = tank;
    empty.size.y *= (1.0f - progress);
    const sf::Color emptyColor = readRgba(config,
                                          "INFOBAR_HEALTH_EMPTY_R",
                                          "INFOBAR_HEALTH_EMPTY_G",
                                          "INFOBAR_HEALTH_EMPTY_B",
                                          "INFOBAR_HEALTH_EMPTY_A");
    drawChamferedBox(window, empty, chamfer, emptyColor);
}

void drawHealthCoreMonitor(sf::RenderWindow& window,
                           sf::FloatRect rect,
                           const dof::loaders::ConfigLoader& config) {
    const sf::Color border = readRgba(config,
                                      "INFOBAR_HEALTH_MONITOR_BORDER_R",
                                      "INFOBAR_HEALTH_MONITOR_BORDER_G",
                                      "INFOBAR_HEALTH_MONITOR_BORDER_B",
                                      "INFOBAR_HEALTH_MONITOR_BORDER_A");
    const sf::Color fill = readRgba(config,
                                    "INFOBAR_HEALTH_MONITOR_R",
                                    "INFOBAR_HEALTH_MONITOR_G",
                                    "INFOBAR_HEALTH_MONITOR_B",
                                    "INFOBAR_HEALTH_MONITOR_A");
    drawOval(window, rect, border);
    const sf::FloatRect inner = insetRect(rect, 1.7f);
    drawOval(window, inner, fill);

    sf::Color scanline = border;
    scanline.a = static_cast<std::uint8_t>(std::min(90, static_cast<int>(scanline.a)));
    ui::drawThinQuad(window,
                     sf::FloatRect{{inner.position.x + 2.0f,
                                    inner.position.y + inner.size.y * 0.54f},
                                   {std::max(0.0f, inner.size.x - 4.0f), 1.0f}},
                     scanline);
}

std::array<std::uint8_t, 5> pixelGlyphRows(char c) {
    switch (c) {
    case '0': return {0b111, 0b101, 0b101, 0b101, 0b111};
    case '1': return {0b010, 0b110, 0b010, 0b010, 0b111};
    case '2': return {0b111, 0b001, 0b111, 0b100, 0b111};
    case '3': return {0b111, 0b001, 0b111, 0b001, 0b111};
    case '4': return {0b101, 0b101, 0b111, 0b001, 0b001};
    case '5': return {0b111, 0b100, 0b111, 0b001, 0b111};
    case '6': return {0b111, 0b100, 0b111, 0b101, 0b111};
    case '7': return {0b111, 0b001, 0b010, 0b010, 0b010};
    case '8': return {0b111, 0b101, 0b111, 0b101, 0b111};
    case '9': return {0b111, 0b101, 0b111, 0b001, 0b111};
    case '%': return {0b101, 0b001, 0b010, 0b100, 0b101};
    default: return {0b000, 0b000, 0b000, 0b000, 0b000};
    }
}

void drawPixelReadout(sf::RenderWindow& window,
                      sf::FloatRect rect,
                      std::string_view text,
                      sf::Color color) {
    constexpr int kGlyphCols = 3;
    constexpr int kGlyphRows = 5;
    constexpr int kGlyphGap = 1;
    if (rect.size.x <= 0.0f || rect.size.y <= 0.0f || text.empty() || color.a == 0) return;

    const float padX = std::max(1.0f, rect.size.x * 0.13f);
    const float padY = std::max(1.0f, rect.size.y * 0.20f);
    const float columns = static_cast<float>(text.size() * kGlyphCols
                         + (text.size() - 1) * kGlyphGap);
    const float pixel = std::max(
        1.0f,
        std::min((rect.size.x - padX * 2.0f) / columns,
                 (rect.size.y - padY * 2.0f) / static_cast<float>(kGlyphRows)));
    const float lit = std::max(1.0f, pixel * 0.76f);
    const float totalW = columns * pixel;
    const float totalH = static_cast<float>(kGlyphRows) * pixel;
    const float startX = std::floor(rect.position.x + (rect.size.x - totalW) * 0.5f);
    const float startY = std::floor(rect.position.y + (rect.size.y - totalH) * 0.5f);

    auto drawPass = [&](sf::Color passColor, sf::Vector2f offset) {
        float cursorX = startX + offset.x;
        for (const char c : text) {
            const auto rows = pixelGlyphRows(c);
            for (int y = 0; y < kGlyphRows; ++y) {
                for (int x = 0; x < kGlyphCols; ++x) {
                    const bool on = (rows[static_cast<std::size_t>(y)] & (1u << (kGlyphCols - 1 - x))) != 0;
                    if (!on) continue;
                    ui::drawThinQuad(window,
                                     sf::FloatRect{{cursorX + static_cast<float>(x) * pixel,
                                                    startY + offset.y + static_cast<float>(y) * pixel},
                                                   {lit, lit}},
                                     passColor);
                }
            }
            cursorX += static_cast<float>(kGlyphCols + kGlyphGap) * pixel;
        }
    };

    drawPass(sf::Color{28, 0, 0, 210}, {1.0f, 1.0f});
    drawPass(color, {0.0f, 0.0f});
}

sf::Vector2f rightHalfTubePoint(sf::FloatRect rect, float radiusInset, float angle) {
    const float rx = std::max(0.0f, rect.size.x - radiusInset);
    const float ry = std::max(0.0f, rect.size.y * 0.5f - radiusInset);
    return {rect.position.x + std::cos(angle) * rx,
            rect.position.y + rect.size.y * 0.5f + std::sin(angle) * ry};
}

void appendTubeQuad(sf::VertexArray& vertices,
                    sf::Vector2f outerA,
                    sf::Vector2f outerB,
                    sf::Vector2f innerB,
                    sf::Vector2f innerA,
                    sf::Color color) {
    const std::size_t base = vertices.getVertexCount();
    vertices.resize(base + 6);
    vertices[base + 0].position = outerA;
    vertices[base + 1].position = outerB;
    vertices[base + 2].position = innerB;
    vertices[base + 3].position = outerA;
    vertices[base + 4].position = innerB;
    vertices[base + 5].position = innerA;
    for (std::size_t i = base; i < base + 6; ++i) {
        vertices[i].color = color;
    }
}

void drawRightHalfTubeSegment(sf::RenderWindow& window,
                              sf::FloatRect rect,
                              float tubeThickness,
                              float startAngle,
                              float endAngle,
                              sf::Color color,
                              sf::BlendMode blend = sf::BlendAlpha) {
    if (rect.size.x <= 0.0f || rect.size.y <= 0.0f || color.a == 0 || endAngle <= startAngle) return;
    const float maxThickness = std::max(1.0f, std::min(rect.size.x, rect.size.y * 0.5f) - 0.75f);
    const float safeThickness = std::clamp(tubeThickness, 1.0f, maxThickness);
    const int segments = std::max(
        3,
        static_cast<int>(std::ceil((endAngle - startAngle) / 3.14159265358979323846f * 30.0f)));
    sf::VertexArray vertices(sf::PrimitiveType::Triangles);
    for (int i = 0; i < segments; ++i) {
        const float t0 = static_cast<float>(i) / static_cast<float>(segments);
        const float t1 = static_cast<float>(i + 1) / static_cast<float>(segments);
        const float a0 = startAngle + (endAngle - startAngle) * t0;
        const float a1 = startAngle + (endAngle - startAngle) * t1;
        appendTubeQuad(vertices,
                       rightHalfTubePoint(rect, 0.0f, a0),
                       rightHalfTubePoint(rect, 0.0f, a1),
                       rightHalfTubePoint(rect, safeThickness, a1),
                       rightHalfTubePoint(rect, safeThickness, a0),
                       color);
    }
    window.draw(vertices, blend);
}

void drawTubeRadialLine(sf::RenderWindow& window,
                        sf::FloatRect rect,
                        float tubeThickness,
                        float angle,
                        sf::Color color) {
    if (rect.size.x <= 0.0f || rect.size.y <= 0.0f || color.a == 0) return;
    const float maxThickness = std::max(1.0f, std::min(rect.size.x, rect.size.y * 0.5f) - 0.75f);
    const float safeThickness = std::clamp(tubeThickness, 1.0f, maxThickness);
    sf::VertexArray line(sf::PrimitiveType::Lines, 2);
    line[0].position = rightHalfTubePoint(rect, safeThickness, angle);
    line[1].position = rightHalfTubePoint(rect, 0.0f, angle);
    line[0].color = color;
    line[1].color = color;
    window.draw(line);
}

void drawDashReservoirHardware(sf::RenderWindow& window,
                               sf::FloatRect rect,
                               float tubeThickness,
                               const dof::loaders::ConfigLoader& config) {
    constexpr float kPi = 3.14159265358979323846f;
    constexpr float kHalfPi = kPi * 0.5f;
    const sf::Color shell = readRgba(config,
                                     "INFOBAR_DASH_RESERVOIR_SHELL_R",
                                     "INFOBAR_DASH_RESERVOIR_SHELL_G",
                                     "INFOBAR_DASH_RESERVOIR_SHELL_B",
                                     "INFOBAR_DASH_RESERVOIR_SHELL_A");
    const sf::Color shellEdge = readRgba(config,
                                         "INFOBAR_DASH_RESERVOIR_SHELL_EDGE_R",
                                         "INFOBAR_DASH_RESERVOIR_SHELL_EDGE_G",
                                         "INFOBAR_DASH_RESERVOIR_SHELL_EDGE_B",
                                         "INFOBAR_DASH_RESERVOIR_SHELL_EDGE_A");
    const sf::Color shellShadow = readRgba(config,
                                           "INFOBAR_DASH_RESERVOIR_SHELL_SHADOW_R",
                                           "INFOBAR_DASH_RESERVOIR_SHELL_SHADOW_G",
                                           "INFOBAR_DASH_RESERVOIR_SHELL_SHADOW_B",
                                           "INFOBAR_DASH_RESERVOIR_SHELL_SHADOW_A");
    const float shellThickness = std::max(
        tubeThickness + 2.0f,
        config.getFloat("INFOBAR_DASH_RESERVOIR_SHELL_THICKNESS"));
    const float mountWidth = std::max(
        0.0f,
        config.getFloat("INFOBAR_DASH_RESERVOIR_MOUNT_WIDTH"));

    const sf::FloatRect backing{{rect.position.x - mountWidth * 1.48f,
                                 rect.position.y - 3.0f},
                                {rect.size.x + mountWidth * 1.52f,
                                 rect.size.y + 6.0f}};
    drawChamferedBox(window, backing, 8.0f, shellShadow);
    sf::Color backingFill = shell;
    backingFill.a = static_cast<std::uint8_t>(
        std::max(0, static_cast<int>(backingFill.a) - 64));
    drawChamferedBox(window, insetRect(backing, 1.5f), 7.0f, backingFill);
    sf::Color railLine = shellEdge;
    railLine.a = static_cast<std::uint8_t>(std::min(150, static_cast<int>(railLine.a) + 22));
    ui::drawThinQuad(window,
                     sf::FloatRect{{backing.position.x + 6.0f, backing.position.y + 3.0f},
                                   {std::max(0.0f, backing.size.x - 12.0f), 1.0f}},
                     railLine);
    ui::drawThinQuad(window,
                     sf::FloatRect{{backing.position.x + 6.0f,
                                    backing.position.y + backing.size.y - 4.0f},
                                   {std::max(0.0f, backing.size.x - 12.0f), 1.0f}},
                     railLine);

    const sf::FloatRect shellRect{{rect.position.x - mountWidth * 0.35f,
                                   rect.position.y - 3.0f},
                                  {rect.size.x + mountWidth * 0.25f,
                                   rect.size.y + 6.0f}};
    drawRightHalfTubeSegment(window, shellRect, shellThickness + 2.0f, -kHalfPi, kHalfPi, shellShadow);
    drawRightHalfTubeSegment(window, shellRect, shellThickness, -kHalfPi, kHalfPi, shell);
    drawRightHalfTubeSegment(window, shellRect, 1.5f, -kHalfPi, kHalfPi, shellEdge);

    const sf::FloatRect socket{{rect.position.x - mountWidth,
                                rect.position.y + rect.size.y * 0.16f},
                               {mountWidth + tubeThickness * 0.80f,
                                rect.size.y * 0.68f}};
    drawChamferedBox(window, socket, std::min(5.0f, socket.size.y * 0.30f), shellShadow);
    drawChamferedBox(window, insetRect(socket, 1.2f), std::min(4.0f, socket.size.y * 0.24f), shell);

    const float clampH = std::max(2.0f, config.getFloat("INFOBAR_DASH_RESERVOIR_CLAMP_HEIGHT"));
    const sf::FloatRect topClamp{{rect.position.x - mountWidth * 0.65f,
                                  rect.position.y + rect.size.y * 0.08f},
                                 {mountWidth + tubeThickness * 0.75f, clampH}};
    const sf::FloatRect bottomClamp{{topClamp.position.x,
                                     rect.position.y + rect.size.y * 0.92f - clampH},
                                    topClamp.size};
    drawChamferedBox(window, topClamp, clampH * 0.5f, shellEdge);
    drawChamferedBox(window, bottomClamp, clampH * 0.5f, shellEdge);

    const float boltR = std::max(0.0f, config.getFloat("INFOBAR_DASH_RESERVOIR_BOLT_RADIUS"));
    if (boltR > 0.0f) {
        const sf::Color bolt = readRgba(config,
                                        "INFOBAR_DASH_RESERVOIR_BOLT_R",
                                        "INFOBAR_DASH_RESERVOIR_BOLT_G",
                                        "INFOBAR_DASH_RESERVOIR_BOLT_B",
                                        "INFOBAR_DASH_RESERVOIR_BOLT_A");
        drawOval(window,
                 sf::FloatRect{{socket.position.x + mountWidth * 0.22f,
                                socket.position.y + socket.size.y * 0.18f},
                               {boltR * 2.0f, boltR * 2.0f}},
                 bolt);
        drawOval(window,
                 sf::FloatRect{{socket.position.x + mountWidth * 0.22f,
                                socket.position.y + socket.size.y * 0.72f},
                               {boltR * 2.0f, boltR * 2.0f}},
                 bolt);
    }
}

float dashReservoirRatio(const dof::combat::DodgeSystem& dodgeSystem) {
    const int maxCharges = dodgeSystem.maxCharges();
    if (maxCharges <= 0) return 0.0f;
    const int available = std::clamp(dodgeSystem.chargesAvailable(), 0, maxCharges);
    float fillingCharge = 0.0f;
    if (available < maxCharges) {
        fillingCharge = dodgeSystem.cooldownSeconds() > 0.0f
            ? std::clamp(1.0f - dodgeSystem.cooldownRemaining() / dodgeSystem.cooldownSeconds(),
                         0.0f,
                         1.0f)
            : 1.0f;
    }
    return std::clamp((static_cast<float>(available) + fillingCharge)
                      / static_cast<float>(maxCharges),
                      0.0f,
                      1.0f);
}

void drawDashReservoir(sf::RenderWindow& window,
                       sf::FloatRect area,
                       const dof::combat::DodgeSystem& dodgeSystem,
                       float readyEffectAmount,
                       const dof::loaders::ConfigLoader& config) {
    const sf::FloatRect rect = fractionRect(
        area,
        config.getFloat("INFOBAR_DASH_RESERVOIR_X_FRACTION"),
        config.getFloat("INFOBAR_DASH_RESERVOIR_Y_FRACTION"),
        config.getFloat("INFOBAR_DASH_RESERVOIR_WIDTH_FRACTION"),
        config.getFloat("INFOBAR_DASH_RESERVOIR_HEIGHT_FRACTION"));
    const sf::Color border = readRgba(config,
                                      "INFOBAR_DASH_RESERVOIR_BORDER_R",
                                      "INFOBAR_DASH_RESERVOIR_BORDER_G",
                                      "INFOBAR_DASH_RESERVOIR_BORDER_B",
                                      "INFOBAR_DASH_RESERVOIR_BORDER_A");
    const sf::Color track = readRgba(config,
                                     "INFOBAR_DASH_RESERVOIR_TRACK_R",
                                     "INFOBAR_DASH_RESERVOIR_TRACK_G",
                                     "INFOBAR_DASH_RESERVOIR_TRACK_B",
                                     "INFOBAR_DASH_RESERVOIR_TRACK_A");
    sf::Color fill = readRgba(config,
                              "INFOBAR_DASH_RESERVOIR_FILL_R",
                              "INFOBAR_DASH_RESERVOIR_FILL_G",
                              "INFOBAR_DASH_RESERVOIR_FILL_B",
                              "INFOBAR_DASH_RESERVOIR_FILL_A");
    const float borderThickness = std::max(
        0.0f,
        config.getFloat("INFOBAR_DASH_RESERVOIR_BORDER_THICKNESS"));
    const float tubeThickness = std::max(
        1.0f,
        config.getFloat("INFOBAR_DASH_RESERVOIR_TUBE_THICKNESS"));
    const float ratio = dashReservoirRatio(dodgeSystem);
    fill.a = static_cast<std::uint8_t>(std::clamp(
        static_cast<float>(fill.a) * ratio, 0.0f, 255.0f));
    constexpr float kPi = 3.14159265358979323846f;
    constexpr float kHalfPi = kPi * 0.5f;

    if (config.getInt("INFOBAR_DASH_RESERVOIR_DRAW_HARDWARE") != 0) {
        drawDashReservoirHardware(window, rect, tubeThickness, config);
    }
    const sf::FloatRect secondaryRect = fractionRect(
        area,
        config.getFloat("INFOBAR_DASH_SECONDARY_X_FRACTION"),
        config.getFloat("INFOBAR_DASH_SECONDARY_Y_FRACTION"),
        config.getFloat("INFOBAR_DASH_SECONDARY_WIDTH_FRACTION"),
        config.getFloat("INFOBAR_DASH_SECONDARY_HEIGHT_FRACTION"));
    const float secondaryThickness = std::max(
        1.0f, config.getFloat("INFOBAR_DASH_SECONDARY_TUBE_THICKNESS"));
    const float fillStartAngle = kHalfPi - kPi * std::clamp(ratio, 0.0f, 1.0f);

    // The bitmap contains a second outer cyan crescent. Paint an opaque track
    // over it first, then restore only the available dash portion so both
    // concentric arcs visibly drain together.
    drawRightHalfTubeSegment(window, secondaryRect, secondaryThickness,
                             -kHalfPi, kHalfPi, track);
    drawRightHalfTubeSegment(window, secondaryRect, secondaryThickness,
                             fillStartAngle, kHalfPi, fill);
    if (ratio > 0.04f && ratio < 0.98f) {
        sf::Color secondaryMeniscus = fill;
        secondaryMeniscus.a = static_cast<std::uint8_t>(
            std::clamp(config.getInt("INFOBAR_DASH_RESERVOIR_MENISCUS_A"), 0, 255));
        drawTubeRadialLine(window, secondaryRect, secondaryThickness,
                           fillStartAngle, secondaryMeniscus);
    }

    drawRightHalfTubeSegment(window, rect, tubeThickness, -kHalfPi, kHalfPi, border);
    sf::FloatRect inner{{rect.position.x,
                         rect.position.y + borderThickness},
                        {std::max(0.0f, rect.size.x - borderThickness),
                         std::max(0.0f, rect.size.y - borderThickness * 2.0f)}};
    const float innerTubeThickness = std::max(1.0f, tubeThickness - borderThickness * 2.0f);
    drawRightHalfTubeSegment(window, inner, innerTubeThickness, -kHalfPi, kHalfPi, track);

    drawRightHalfTubeSegment(window, inner, innerTubeThickness, fillStartAngle, kHalfPi, fill);
    if (ratio > 0.04f && ratio < 0.98f) {
        sf::Color meniscus = fill;
        meniscus.a = static_cast<std::uint8_t>(
            std::clamp(config.getInt("INFOBAR_DASH_RESERVOIR_MENISCUS_A"), 0, 255));
        drawTubeRadialLine(window, inner, innerTubeThickness, fillStartAngle, meniscus);
    }
    sf::Color rib = border;
    rib.a = static_cast<std::uint8_t>(
        std::min(82, std::max(0, static_cast<int>(border.a) - 40)));
    drawTubeRadialLine(window, inner, innerTubeThickness, -0.42f, rib);
    drawTubeRadialLine(window, inner, innerTubeThickness, 0.42f, rib);

    if (readyEffectAmount > 0.0f) {
        const float minimumAlpha = static_cast<float>(
            std::clamp(config.getInt("INFOBAR_DASH_READY_PULSE_MIN_A"), 0, 255));
        const float maximumAlpha = static_cast<float>(
            std::clamp(config.getInt("INFOBAR_DASH_READY_PULSE_MAX_A"), 0, 255));
        fill.a = static_cast<std::uint8_t>(std::clamp(
            minimumAlpha + (maximumAlpha - minimumAlpha) * readyEffectAmount, 0.0f, 255.0f));

        const int glowLayers = std::max(1, config.getInt("INFOBAR_DASH_READY_PULSE_LAYERS"));
        const float glowSpread = std::max(
            0.0f, config.getFloat("INFOBAR_DASH_READY_PULSE_SPREAD"));
        for (int layer = glowLayers; layer >= 1; --layer) {
            const float layerRatio = static_cast<float>(layer) / static_cast<float>(glowLayers);
            sf::Color glow = fill;
            glow.a = static_cast<std::uint8_t>(
                static_cast<float>(fill.a) * (1.0f - layerRatio * 0.72f));
            drawRightHalfTubeSegment(window, rect,
                                     tubeThickness + glowSpread * layerRatio,
                                     -kHalfPi, kHalfPi, glow, sf::BlendAdd);
            drawRightHalfTubeSegment(window, secondaryRect,
                                     secondaryThickness + glowSpread * layerRatio,
                                     -kHalfPi, kHalfPi, glow, sf::BlendAdd);
        }
        drawRightHalfTubeSegment(window, rect, tubeThickness,
                                 -kHalfPi, kHalfPi, fill, sf::BlendAdd);
        drawRightHalfTubeSegment(window, secondaryRect, secondaryThickness,
                                 -kHalfPi, kHalfPi, fill, sf::BlendAdd);
    }
}

} // namespace

WeaponSlotSidebar::WeaponSlotSidebar(const dof::loaders::ConfigLoader& config,
                                     const ColorTheme& themeInit,
                                     const sf::Font& fontInit,
                                     const dof::loaders::ShaderLoader* shaders)
    : theme(themeInit), font(fontInit), configRef(config), shadersPtr(shaders),
      dronDetector(config) {
    rowBackground = resolvePanelBackground(config, "WEAPONSLOT_ROW_BG");
    chargedOutline = sf::Color{
        static_cast<std::uint8_t>(config.getInt("WEAPONSLOT_CHARGED_OUTLINE_R")),
        static_cast<std::uint8_t>(config.getInt("WEAPONSLOT_CHARGED_OUTLINE_G")),
        static_cast<std::uint8_t>(config.getInt("WEAPONSLOT_CHARGED_OUTLINE_B"))};
    progressBarHeight    = config.getFloat("WEAPONSLOT_PROGRESS_BAR_HEIGHT");

    accent = UiAccent::loadFromConfig(config);
    healthRamp = HealthRamp::loadFromConfig(config);
    glowEnabled = config.getInt("UI_GLOW_ENABLE") != 0;
    glowSpread  = config.getFloat("UI_GLOW_SPREAD");
    glowLayers  = config.getInt("UI_GLOW_LAYERS");
    glowAlpha   = config.getFloat("UI_GLOW_ALPHA");
    statLabelFontSize = static_cast<unsigned>(config.getInt("INFOBAR_STAT_LABEL_FONT_SIZE"));
    statValueFontSize = static_cast<unsigned>(config.getInt("INFOBAR_STAT_VALUE_FONT_SIZE"));
    dashPipRadius = config.getFloat("INFOBAR_DASH_PIP_RADIUS");
    dashPipGap    = config.getFloat("INFOBAR_DASH_PIP_GAP");
    actionLabelFontSize = static_cast<unsigned>(config.getInt("INFOBAR_ACTION_LABEL_FONT_SIZE"));
    actionTooltipFontSize = static_cast<unsigned>(config.getInt("INFOBAR_ACTION_TOOLTIP_FONT_SIZE"));
    actionTooltipPaddingX = config.getFloat("INFOBAR_ACTION_TOOLTIP_PADDING_X");
    actionTooltipPaddingY = config.getFloat("INFOBAR_ACTION_TOOLTIP_PADDING_Y");
    actionTooltipOffset = config.getFloat("INFOBAR_ACTION_TOOLTIP_OFFSET");
    actionIconStroke = config.getFloat("INFOBAR_ACTION_ICON_STROKE");
    actionGlyphScale = config.getFloat("INFOBAR_ACTION_GLYPH_SCALE");
    actionPickupPulseSeconds = config.getFloat("INFOBAR_ACTION_PICKUP_PULSE_SECONDS");
    if (config.getInt("VISUAL_SPIKE_TEXTURES_ENABLED") != 0) {
        hudFrameAlpha = config.getInt("VISUAL_SPIKE_HUD_FRAME_ALPHA");
        const std::string hudFramePath = config.getString("VISUAL_SPIKE_HUD_FRAME_TEXTURE");
        if (!hudFramePath.empty()) {
            if (!hudFrameTexture.loadFromFile(hudFramePath)) {
                throw std::runtime_error("Failed to load visual spike HUD frame texture: " + hudFramePath);
            }
            hudFrameTexture.setSmooth(true);
            hasHudFrameTexture = true;
        }
    }
    const std::string vitalityTankEmptyPath =
        config.getString("VISUAL_SPIKE_VITAL_TANK_EMPTY_TEXTURE");
    const std::string vitalityTankFluidPath =
        config.getString("VISUAL_SPIKE_VITAL_TANK_FLUID_TEXTURE");
    if (!vitalityTankEmptyTexture.loadFromFile(vitalityTankEmptyPath)) {
        throw std::runtime_error("Failed to load Vital Tank empty-glass texture: "
                                 + vitalityTankEmptyPath);
    }
    if (!vitalityTankFluidTexture.loadFromFile(vitalityTankFluidPath)) {
        throw std::runtime_error("Failed to load Vital Tank fluid texture: "
                                 + vitalityTankFluidPath);
    }
    const sf::IntRect vitalityFluidInterior{
        {config.getInt("INFOBAR_VITAL_TANK_FLUID_INTERIOR_X"),
         config.getInt("INFOBAR_VITAL_TANK_FLUID_INTERIOR_Y")},
        {config.getInt("INFOBAR_VITAL_TANK_FLUID_INTERIOR_WIDTH"),
         config.getInt("INFOBAR_VITAL_TANK_FLUID_INTERIOR_HEIGHT")}};
    const auto vitalityFluidSize = vitalityTankFluidTexture.getSize();
    const int vitalityFluidDisplayY =
        config.getInt("INFOBAR_VITAL_TANK_FLUID_DISPLAY_Y");
    const int vitalityFluidDisplayHeight =
        config.getInt("INFOBAR_VITAL_TANK_FLUID_DISPLAY_HEIGHT");
    if (vitalityFluidInterior.position.x < 0
        || vitalityFluidInterior.position.y < 0
        || vitalityFluidInterior.size.x <= 0
        || vitalityFluidInterior.size.y <= 0
        || vitalityFluidInterior.position.x + vitalityFluidInterior.size.x
            > static_cast<int>(vitalityFluidSize.x)
        || vitalityFluidInterior.position.y + vitalityFluidInterior.size.y
            > static_cast<int>(vitalityFluidSize.y)
        || vitalityFluidDisplayY < 0
        || vitalityFluidDisplayHeight <= 0
        || vitalityFluidDisplayY + vitalityFluidDisplayHeight
            > static_cast<int>(vitalityFluidSize.y)) {
        throw std::runtime_error("Vital Tank fluid interior lies outside its texture");
    }
    vitalityTankEmptyTexture.setSmooth(true);
    vitalityTankFluidTexture.setSmooth(true);
    actionLabels[static_cast<std::size_t>(InfoBarAction::Inventory)] =
        config.getString("INFOBAR_ACTION_INVENTORY_LABEL");
    actionLabels[static_cast<std::size_t>(InfoBarAction::LootFilter)] =
        config.getString("INFOBAR_ACTION_FILTER_LABEL");
    actionLabels[static_cast<std::size_t>(InfoBarAction::DiceCrafter)] =
        config.getString("INFOBAR_ACTION_CRAFT_LABEL");
    actionLabels[static_cast<std::size_t>(InfoBarAction::Help)] =
        config.getString("INFOBAR_ACTION_HELP_LABEL");
    actionNames[static_cast<std::size_t>(InfoBarAction::Inventory)] =
        config.getString("INFOBAR_ACTION_INVENTORY_NAME");
    actionNames[static_cast<std::size_t>(InfoBarAction::LootFilter)] =
        config.getString("INFOBAR_ACTION_FILTER_NAME");
    actionNames[static_cast<std::size_t>(InfoBarAction::DiceCrafter)] =
        config.getString("INFOBAR_ACTION_CRAFT_NAME");
    actionNames[static_cast<std::size_t>(InfoBarAction::Help)] =
        config.getString("INFOBAR_ACTION_HELP_NAME");

    // UiDiceCell — hex+shader dice chips.
    diceCell.emptyFill = sf::Color{
        static_cast<std::uint8_t>(config.getInt("WEAPONSLOT_EMPTY_DICE_CELL_R")),
        static_cast<std::uint8_t>(config.getInt("WEAPONSLOT_EMPTY_DICE_CELL_G")),
        static_cast<std::uint8_t>(config.getInt("WEAPONSLOT_EMPTY_DICE_CELL_B"))};
    diceCell.emptyOutline            = accent.dim();
    diceCell.labelColor              = theme.uiText;
    diceCell.chargedOutlineThickness = config.getFloat("WEAPONSLOT_CHARGED_DICE_OUTLINE_THICKNESS");
    diceCell.chargedFillAlphaBoost   = config.getInt("WEAPONSLOT_CHARGED_DICE_FILL_ALPHA_BOOST");
    diceCell.countdownBarThickness   = config.getFloat("WEAPONSLOT_DICE_COUNTDOWN_BAR_HEIGHT");

    // UiDronCell — dron pattern indicator (divider + ROLLING/multiplier).
    dronCell.multiplierColor  = chargedOutline;
    dronCell.nameColor        = sf::Color{120, 135, 150};
    dronCell.dividerColor     = sf::Color{80, 230, 255, 26};
    dronCell.dividerThickness = 1.0f;

    // chargeBar colors set per-row at draw time (lit colour depends on charged state).
}

void WeaponSlotSidebar::render(sf::RenderWindow& window,
                               const dof::hubs::WeaponSlotHub& weaponSlotHub,
                               const WeaponSlotLayout& layout,
                               const UiState& uiState,
                               const dof::entities::Hero& hero,
                               const dof::hubs::LuckHub& luckHub,
                               const dof::hubs::PowderHub& powderHub,
                               const dof::combat::DodgeSystem& dodgeSystem,
                               float vitalityReserveRatio) {
    const float effectDuration = std::max(
        0.01f, configRef.getFloat("INFOBAR_DASH_READY_EFFECT_SECONDS"));
    const float elapsedSeconds = dashReadyEffectClock.restart().asSeconds();
    const int currentDashCharges = dodgeSystem.chargesAvailable();
    if (previousDashChargesAvailable >= 0
        && currentDashCharges > previousDashChargesAvailable) {
        dashReadyEffectRemainingSeconds = effectDuration;
    } else {
        dashReadyEffectRemainingSeconds = std::max(
            0.0f, dashReadyEffectRemainingSeconds - elapsedSeconds);
    }
    previousDashChargesAvailable = currentDashCharges;
    renderProbe.assign(static_cast<size_t>(weaponSlotHub.rowCount()), WeaponSlotRowRenderProbe{});
    const sf::Vector2u win    = window.getSize();
    const sf::Vector2u design = layout.windowSize();
    const LetterboxRect lb = computeLetterbox(win.x, win.y, design.x, design.y);
    const float scaleX = design.x > 0 ? lb.width  / static_cast<float>(design.x) : 1.0f;
    const float scaleY = design.y > 0 ? lb.height / static_cast<float>(design.y) : 1.0f;

    // Always-on: the info bar carries HP/XP/luck/powder/dash, so it can never
    // hide. Only the weapon-slot tiles show empty drop targets when unarmed.
    drawBarFrame(window, layout);

    for (int i = 0; i < weaponSlotHub.rowCount(); ++i) {
        if (!weaponSlotHub.isRowUnlocked(i)) continue;
        const auto rowRect = layout.rowRect(i);
        auto& probe = renderProbe[static_cast<size_t>(i)];
        probe.rectX = lb.originX + rowRect.position.x * scaleX;
        probe.rectY = lb.originY + rowRect.position.y * scaleY;
        probe.rectW = rowRect.size.x * scaleX;
        probe.rectH = rowRect.size.y * scaleY;
        drawRow(window, i, weaponSlotHub, layout, uiState);
    }

    // Merged hero readouts in their bar sub-sections.
    drawXpReadout(window, layout.xpAreaRect(), hero);
    drawHealthReadout(window, layout.healthAreaRect(), hero, dodgeSystem);
    drawVitalTankReadout(window, layout, vitalityReserveRatio);
    drawLuckReadout(window, layout.luckAreaRect(), luckHub);
    drawPowderReadout(window, layout.powderAreaRect(), powderHub);
    drawDashReadout(window, layout.dashAreaRect(), dodgeSystem);
    drawActionButtons(window, layout, uiState);
}

void WeaponSlotSidebar::drawVitalTankReadout(sf::RenderWindow& window,
                                             const WeaponSlotLayout& layout,
                                             float vitalityReserveRatio) {
    const sf::FloatRect bar = layout.sidebarRect();
    const auto frameSize = hudFrameTexture.getSize();
    if (!hasHudFrameTexture || frameSize.x == 0u || frameSize.y == 0u) return;

    const float scale = std::min(bar.size.x / static_cast<float>(frameSize.x),
                                 bar.size.y / static_cast<float>(frameSize.y));
    const sf::Vector2f framePosition{
        bar.position.x + (bar.size.x - static_cast<float>(frameSize.x) * scale) * 0.5f,
        bar.position.y + (bar.size.y - static_cast<float>(frameSize.y) * scale) * 0.5f};
    const sf::Vector2f glassPosition{
        framePosition.x + configRef.getFloat("INFOBAR_VITAL_TANK_GLASS_TEXTURE_X") * scale,
        framePosition.y + configRef.getFloat("INFOBAR_VITAL_TANK_GLASS_TEXTURE_Y") * scale};

    sf::Sprite emptyGlass(vitalityTankEmptyTexture);
    emptyGlass.setPosition(glassPosition);
    emptyGlass.setScale({scale, scale});
    window.draw(emptyGlass);

    const float ratio = std::clamp(vitalityReserveRatio, 0.0f, 1.0f);
    const auto fluidSize = vitalityTankFluidTexture.getSize();
    if (ratio <= 0.0f || fluidSize.y == 0u) return;

    if (ratio >= 1.0f) {
        sf::Sprite fullFluid(vitalityTankFluidTexture);
        fullFluid.setPosition(glassPosition);
        fullFluid.setScale({scale, scale});
        window.draw(fullFluid);
        return;
    }

    const sf::Vector2i interiorPosition{
        configRef.getInt("INFOBAR_VITAL_TANK_FLUID_INTERIOR_X"),
        configRef.getInt("INFOBAR_VITAL_TANK_FLUID_INTERIOR_Y")};
    const sf::Vector2i interiorSize{
        configRef.getInt("INFOBAR_VITAL_TANK_FLUID_INTERIOR_WIDTH"),
        configRef.getInt("INFOBAR_VITAL_TANK_FLUID_INTERIOR_HEIGHT")};
    const int displayY = configRef.getInt("INFOBAR_VITAL_TANK_FLUID_DISPLAY_Y");
    const int displayHeight =
        configRef.getInt("INFOBAR_VITAL_TANK_FLUID_DISPLAY_HEIGHT");
    const int visibleWidth = static_cast<int>(
        std::round(static_cast<float>(interiorSize.x) * ratio));
    if (visibleWidth <= 0) return;

    sf::Sprite fluid(vitalityTankFluidTexture,
                     sf::IntRect{interiorPosition,
                                 {visibleWidth, interiorSize.y}});
    fluid.setPosition({glassPosition.x + static_cast<float>(interiorPosition.x) * scale,
                       glassPosition.y + static_cast<float>(displayY) * scale});
    fluid.setScale({scale,
                    scale * static_cast<float>(displayHeight)
                        / static_cast<float>(interiorSize.y)});
    window.draw(fluid);
}

void WeaponSlotSidebar::drawBarFrame(sf::RenderWindow& window, const WeaponSlotLayout& layout) {
    const auto bar = layout.sidebarRect();
    if (hasHudFrameTexture) {
        sf::Sprite frame(hudFrameTexture);
        const auto textureSize = hudFrameTexture.getSize();
        if (textureSize.x > 0u && textureSize.y > 0u) {
            const float scale = std::min(bar.size.x / static_cast<float>(textureSize.x),
                                         bar.size.y / static_cast<float>(textureSize.y));
            const sf::Vector2f drawSize{static_cast<float>(textureSize.x) * scale,
                                        static_cast<float>(textureSize.y) * scale};
            frame.setPosition({bar.position.x + (bar.size.x - drawSize.x) * 0.5f,
                               bar.position.y + (bar.size.y - drawSize.y) * 0.5f});
            frame.setScale({scale, scale});
            frame.setColor(sf::Color{
                255, 255, 255,
                static_cast<std::uint8_t>(std::clamp(hudFrameAlpha, 0, 255))});
            window.draw(frame);
            return;
        }
    }

    if (glowEnabled) {
        ui::drawGlowFrame(window, bar, rowBackground, accent.full(),
                          accent.thicknessOutline, glowLayers, glowSpread, glowAlpha);
    } else {
        ui::UiPanel panel;
        panel.background = rowBackground;
        panel.border = accent.full();
        panel.borderThickness = accent.thicknessOutline;
        panel.draw(window, bar);
    }
}

void WeaponSlotSidebar::drawRow(sf::RenderWindow& window, int rowIndex,
                                const dof::hubs::WeaponSlotHub& weaponSlotHub,
                                const WeaponSlotLayout& layout, const UiState& uiState) {
    if (!weaponSlotHub.isRowUnlocked(rowIndex)) return;
    auto row = layout.rowRect(rowIndex);
    const auto* weapon = weaponSlotHub.peek(rowIndex);
    if (!weapon) {
        drawEmptySlot(window, rowIndex, layout, uiState);
        return;
    }

    const bool isCharged = weaponSlotHub.isRowCharged(rowIndex);

    // ② Weapon zone — silhouette + UiLabel name + UiLabel level.
    auto weaponZone = layout.weaponZoneRect(rowIndex);
    {
        const float padding = 6.0f;
        const sf::FloatRect innerRect{
            {weaponZone.position.x + padding, weaponZone.position.y + padding + 14.0f},
            {weaponZone.size.x - padding * 2.0f, weaponZone.size.y - padding * 2.0f - 14.0f}};
        drawWeaponSprite(window, innerRect, weapon->type(), configRef,
                         isCharged ? sf::Color{255, 245, 205} : sf::Color::White);

        const sf::FloatRect nameRect{
            {weaponZone.position.x + padding, weaponZone.position.y + 2.0f},
            {weaponZone.size.x - padding, 14.0f}};
        ui::UiLabel{theme.uiText, 12, ui::TextAlign::Left}
            .draw(window, nameRect, font, weapon->displayName().substr(0, 16));

        const sf::FloatRect lvRect{
            {weaponZone.position.x + padding,
             weaponZone.position.y + weaponZone.size.y - 16.0f},
            {weaponZone.size.x - padding, 12.0f}};
        ui::UiLabel{sf::Color{120, 135, 150}, 9, ui::TextAlign::Left}
            .draw(window, lvRect, font, "LV " + std::to_string(weapon->itemLevel()));
    }

    // ③ Dice cells — UiDiceCell (hex+shader, preserves fidelity).
    const int maxSlots = weaponSlotHub.maxSlotsForRow(rowIndex);
    if (rowIndex >= 0 && rowIndex < static_cast<int>(renderProbe.size())) {
        auto& probe      = renderProbe[static_cast<size_t>(rowIndex)];
        probe.wasDrawn   = true;
        probe.cellsDrawn = maxSlots;
    }
    for (int c = 0; c < maxSlots; ++c) {
        const auto  cellRect = layout.diceCellRect(rowIndex, c);
        const auto* dice     = weaponSlotHub.peekDice(rowIndex, c);
        const sf::Color faceCol = dice ? diceColor(configRef, dice->face()) : sf::Color{};
        diceCell.draw(window, cellRect, dice, faceCol,
                      isCharged, chargedOutline, font,
                      shadersPtr, shapeShaders);
    }

    // ④ Charge bar — UiProgressBar at the bottom of the dice zone.
    const auto diceZone = layout.diceZoneRect(rowIndex);
    {
        const float barPad = 6.0f;
        const sf::FloatRect barRect{
            {diceZone.position.x + barPad,
             diceZone.position.y + diceZone.size.y - progressBarHeight - 4.0f},
            {diceZone.size.x - barPad * 2.0f, progressBarHeight}};
        const float progress  = weaponSlotHub.rowProgress(rowIndex);
        const sf::Color litColor = isCharged ? chargedOutline : theme.heroOutline;
        ui::UiProgressBar{sf::Color{255, 255, 255, 18}, litColor}
            .drawHorizontal(window, barRect, progress);
    }

    // ⑤ Dron column — UiDronCell (divider + ROLLING/multiplier pattern).
    const auto progressZone = layout.progressZoneRect(rowIndex);
    {
        std::vector<int> faces;
        faces.reserve(maxSlots);
        for (int c = 0; c < maxSlots; ++c) {
            const auto* d = weaponSlotHub.peekDice(rowIndex, c);
            if (d) faces.push_back(d->faceCount());
        }
        const dof::combat::DronResult dron = faces.empty()
            ? dof::combat::DronResult{}
            : dronDetector.classify(faces);
        dronCell.draw(window, progressZone, row.size.y, font, dron);
    }
}

void WeaponSlotSidebar::drawEmptySlot(sf::RenderWindow& window, int rowIndex,
                                       const WeaponSlotLayout& layout, const UiState& uiState) {
    const auto row = layout.rowRect(rowIndex);
    (void)uiState;

    ui::UiLabel{sf::Color{120, 135, 150}, 11, ui::TextAlign::Center}
        .draw(window, row, font, "EMPTY SLOT");
}

namespace {

// A stat sub-section: a dim caption row at the top, the rest returned as the
// value region below it. Keeps every readout visually aligned.
sf::FloatRect drawStatCaption(sf::RenderWindow& window, const sf::Font& font,
                              sf::FloatRect area, const std::string& caption,
                              sf::Color dim, unsigned labelSize) {
    const float capH = static_cast<float>(labelSize) + 6.0f;
    ui::UiLabel{dim, labelSize, ui::TextAlign::Center}
        .draw(window, {{area.position.x, area.position.y}, {area.size.x, capH}}, font, caption);
    return sf::FloatRect{{area.position.x, area.position.y + capH},
                         {area.size.x, area.size.y - capH}};
}

} // namespace

void WeaponSlotSidebar::drawXpReadout(sf::RenderWindow& window, sf::FloatRect area,
                                      const dof::entities::Hero& hero) {
    if (area.size.x <= 0.0f || area.size.y <= 0.0f) return;
    const auto& lvl = hero.levelable();
    const float ratio = lvl.experienceForNextLevel > 0
        ? std::clamp(static_cast<float>(lvl.experience)
                     / static_cast<float>(lvl.experienceForNextLevel), 0.0f, 1.0f)
        : 0.0f;

    const float xFraction = std::clamp(configRef.getFloat("INFOBAR_XP_RAIL_X_FRACTION"), 0.0f, 1.0f);
    const float wFraction = std::clamp(configRef.getFloat("INFOBAR_XP_RAIL_WIDTH_FRACTION"), 0.0f, 1.0f);
    const float barW = area.size.x * wFraction;
    const sf::FloatRect barRect{{area.position.x + area.size.x * xFraction,
                                 area.position.y},
                                {std::min(barW, std::max(0.0f, area.position.x + area.size.x
                                                          - (area.position.x + area.size.x * xFraction))),
                                 area.size.y}};
    drawXpRail(window, barRect, ratio, accent.full(), configRef);
}

void WeaponSlotSidebar::drawHealthReadout(sf::RenderWindow& window, sf::FloatRect area,
                                          const dof::entities::Hero& hero,
                                          const dof::combat::DodgeSystem& dodgeSystem) {
    const auto& dmg = hero.damageable();
    const float ratio = std::clamp(dmg.healthRatio(), 0.0f, 1.0f);
    if (area.size.x <= 0.0f || area.size.y <= 0.0f) return;

    sf::Color fillColor = readRgba(configRef,
                                   "INFOBAR_HEALTH_FILL_R",
                                   "INFOBAR_HEALTH_FILL_G",
                                   "INFOBAR_HEALTH_FILL_B",
                                   "INFOBAR_HEALTH_FILL_A");
    if (ratio <= configRef.getFloat("HP_RAMP_LOW_THRESHOLD")) {
        fillColor = readRgbPrefixed(configRef, "INFOBAR_HEALTH_DANGER", fillColor.a);
    }

    drawHealthTankState(window, area, ratio, fillColor, configRef);
    const float effectDuration = std::max(
        0.01f, configRef.getFloat("INFOBAR_DASH_READY_EFFECT_SECONDS"));
    const float effectProgress = 1.0f - dashReadyEffectRemainingSeconds / effectDuration;
    const float effectAmount = dashReadyEffectRemainingSeconds > 0.0f
        ? std::sin(std::clamp(effectProgress, 0.0f, 1.0f) * 3.14159265358979323846f)
        : 0.0f;
    drawDashReservoir(window, area, dodgeSystem, effectAmount, configRef);

    const int pct = static_cast<int>(std::round(ratio * 100.0f));
    const sf::FloatRect pctRect = fractionRect(
        area,
        configRef.getFloat("INFOBAR_HEALTH_PERCENT_X_FRACTION"),
        configRef.getFloat("INFOBAR_HEALTH_PERCENT_Y_FRACTION"),
        configRef.getFloat("INFOBAR_HEALTH_PERCENT_WIDTH_FRACTION"),
        configRef.getFloat("INFOBAR_HEALTH_PERCENT_HEIGHT_FRACTION"));
    drawHealthCoreMonitor(window, pctRect, configRef);
    const sf::Color textColor = readRgba(configRef,
                                         "INFOBAR_HEALTH_MONITOR_TEXT_R",
                                         "INFOBAR_HEALTH_MONITOR_TEXT_G",
                                         "INFOBAR_HEALTH_MONITOR_TEXT_B",
                                         "INFOBAR_HEALTH_MONITOR_TEXT_A");
    drawPixelReadout(window, pctRect, std::to_string(pct) + "%", textColor);
}

void WeaponSlotSidebar::drawLuckReadout(sf::RenderWindow& window, sf::FloatRect area,
                                        const dof::hubs::LuckHub& luckHub) {
    const sf::FloatRect body = drawStatCaption(window, font, area, "LUCK", theme.uiDim, statLabelFontSize);
    ui::UiLabel{accent.full(), statValueFontSize, ui::TextAlign::Center}
        .draw(window, body, font, std::to_string(luckHub.luckTotal()));
}

void WeaponSlotSidebar::drawPowderReadout(sf::RenderWindow& window, sf::FloatRect area,
                                          const dof::hubs::PowderHub& powderHub) {
    const sf::FloatRect body = drawStatCaption(window, font, area, "POWDER", theme.uiDim, statLabelFontSize);
    ui::UiLabel{accent.full(), statValueFontSize, ui::TextAlign::Center}
        .draw(window, body, font, std::to_string(powderHub.totalCount()));
}

void WeaponSlotSidebar::drawDashReadout(sf::RenderWindow& window, sf::FloatRect area,
                                        const dof::combat::DodgeSystem& dodgeSystem) {
    (void)window;
    (void)area;
    (void)dodgeSystem;
}

void WeaponSlotSidebar::drawActionButtons(sf::RenderWindow& window,
                                          const WeaponSlotLayout& layout,
                                          const UiState& uiState) {
    const InfoBarAction actions[kInfoBarActionCount] = {
        InfoBarAction::Inventory,
        InfoBarAction::LootFilter,
        InfoBarAction::DiceCrafter,
        InfoBarAction::Help,
    };
    const sf::Color engravedIcon = readRgba(configRef,
                                             "INFOBAR_ACTION_ICON_R",
                                             "INFOBAR_ACTION_ICON_G",
                                             "INFOBAR_ACTION_ICON_B",
                                             "INFOBAR_ACTION_ICON_A");
    const int futureSlots[] = {1, 3, 4, 5, 7};
    for (const int slotIndex : futureSlots) {
        const sf::FloatRect rect = layout.actionSlotRect(slotIndex);
        sf::FloatRect cutRect = rect;
        cutRect.position += sf::Vector2f{0.8f, 0.8f};
        drawFutureActionIcon(window, cutRect, slotIndex, sf::Color{2, 4, 6, 235});
        sf::Color futureColor = engravedIcon;
        futureColor.a = 145;
        sf::FloatRect bevelRect = rect;
        bevelRect.position -= sf::Vector2f{0.35f, 0.35f};
        drawFutureActionIcon(window, bevelRect, slotIndex, futureColor);
    }

    InfoBarAction hoveredAction = InfoBarAction::None;
    for (int actionIndex = 0; actionIndex < kInfoBarActionCount; ++actionIndex) {
        const auto action = actions[actionIndex];
        const auto rect = layout.actionButtonRect(action);
        if (rect.size.x <= 0.0f || rect.size.y <= 0.0f) continue;

        const bool isActive =
            (action == InfoBarAction::Inventory && uiState.isInventoryOpen)
            || (action == InfoBarAction::LootFilter && uiState.isLootFilterOpen)
            || (action == InfoBarAction::DiceCrafter && uiState.isDiceCrafterOpen)
            || (action == InfoBarAction::Help && uiState.isHelpVisible);
        const bool isHovered = rect.contains(uiState.mouseUi);
        if (isHovered) hoveredAction = action;

        float pickupGlow = 0.0f;
        if (action == InfoBarAction::Inventory
            && uiState.inventoryPickupPulseSeconds > 0.0f
            && actionPickupPulseSeconds > 0.0f) {
            const float phase = std::clamp(
                1.0f - uiState.inventoryPickupPulseSeconds / actionPickupPulseSeconds,
                0.0f,
                1.0f);
            pickupGlow = pickupGlowAmount(phase);
        }

        sf::Color iconColor = isActive || isHovered ? accent.full() : engravedIcon;
        if (!isActive && !isHovered && pickupGlow > 0.001f) {
            iconColor = mixColor(engravedIcon, accent.full(), pickupGlow);
        }
        sf::FloatRect cutRect = rect;
        cutRect.position += sf::Vector2f{0.8f, 0.8f};
        drawActionIcon(window, cutRect, action, sf::Color{2, 4, 6, 235});
        sf::FloatRect bevelRect = rect;
        bevelRect.position -= sf::Vector2f{0.35f, 0.35f};
        drawActionIcon(window, bevelRect, action, iconColor);
    }

    if (hoveredAction != InfoBarAction::None) drawActionTooltip(window, layout, hoveredAction);
}

void WeaponSlotSidebar::drawFutureActionIcon(sf::RenderWindow& window,
                                              sf::FloatRect rect,
                                              int slotIndex,
                                              sf::Color color) {
    const float stroke = std::max(1.0f, actionIconStroke);
    const float cx = rect.position.x + rect.size.x * 0.5f;
    const float cy = rect.position.y + rect.size.y * 0.5f;
    auto line = [&](sf::Vector2f from, sf::Vector2f to) {
        const sf::Vector2f center{cx, cy};
        from = center + (from - center) * actionGlyphScale;
        to   = center + (to - center) * actionGlyphScale;
        const sf::Vector2f delta = to - from;
        const float length = std::sqrt(delta.x * delta.x + delta.y * delta.y);
        if (length <= 0.0f) return;
        sf::RectangleShape segment({length, stroke});
        segment.setOrigin({0.0f, stroke * 0.5f});
        segment.setPosition(from);
        segment.setRotation(sf::radians(std::atan2(delta.y, delta.x)));
        segment.setFillColor(color);
        window.draw(segment);
    };
    auto ring = [&](float radius, int sides) {
        radius *= actionGlyphScale;
        sf::CircleShape shape(radius, static_cast<std::size_t>(sides));
        shape.setOrigin({radius, radius});
        shape.setPosition({cx, cy});
        shape.setFillColor(sf::Color::Transparent);
        shape.setOutlineThickness(stroke);
        shape.setOutlineColor(color);
        window.draw(shape);
    };

    if (slotIndex == 1) {
        line({cx - 6.0f, cy - 5.0f}, {cx - 2.0f, cy - 3.0f});
        line({cx - 2.0f, cy - 3.0f}, {cx + 2.0f, cy - 5.0f});
        line({cx + 2.0f, cy - 5.0f}, {cx + 6.0f, cy - 3.0f});
        line({cx - 6.0f, cy - 5.0f}, {cx - 6.0f, cy + 5.0f});
        line({cx - 2.0f, cy - 3.0f}, {cx - 2.0f, cy + 6.0f});
        line({cx + 2.0f, cy - 5.0f}, {cx + 2.0f, cy + 4.0f});
        line({cx + 6.0f, cy - 3.0f}, {cx + 6.0f, cy + 5.0f});
        line({cx - 6.0f, cy + 5.0f}, {cx - 2.0f, cy + 6.0f});
        line({cx - 2.0f, cy + 6.0f}, {cx + 2.0f, cy + 4.0f});
        line({cx + 2.0f, cy + 4.0f}, {cx + 6.0f, cy + 5.0f});
    } else if (slotIndex == 3) {
        line({cx + 1.0f, cy - 7.0f}, {cx - 4.0f, cy + 1.0f});
        line({cx - 4.0f, cy + 1.0f}, {cx, cy + 1.0f});
        line({cx, cy + 1.0f}, {cx - 1.0f, cy + 7.0f});
        line({cx - 1.0f, cy + 7.0f}, {cx + 5.0f, cy - 2.0f});
        line({cx + 5.0f, cy - 2.0f}, {cx + 1.0f, cy - 2.0f});
        line({cx + 1.0f, cy - 2.0f}, {cx + 1.0f, cy - 7.0f});
    } else if (slotIndex == 4) {
        ring(4.5f, 12);
        line({cx - 7.0f, cy}, {cx - 3.0f, cy});
        line({cx + 3.0f, cy}, {cx + 7.0f, cy});
        line({cx, cy - 7.0f}, {cx, cy - 3.0f});
        line({cx, cy + 3.0f}, {cx, cy + 7.0f});
    } else if (slotIndex == 5) {
        ring(4.0f, 8);
        for (int i = 0; i < 4; ++i) {
            const float angle = static_cast<float>(i) * 1.5707963f;
            const sf::Vector2f dir{std::cos(angle), std::sin(angle)};
            line({cx + dir.x * 4.5f, cy + dir.y * 4.5f},
                 {cx + dir.x * 7.0f, cy + dir.y * 7.0f});
        }
    } else if (slotIndex == 7) {
        line({cx - 5.0f, cy + 6.0f}, {cx - 5.0f, cy - 3.0f});
        line({cx - 5.0f, cy - 3.0f}, {cx, cy - 7.0f});
        line({cx, cy - 7.0f}, {cx + 5.0f, cy - 3.0f});
        line({cx + 5.0f, cy - 3.0f}, {cx + 5.0f, cy + 6.0f});
        line({cx - 5.0f, cy + 6.0f}, {cx + 5.0f, cy + 6.0f});
    }
}

void WeaponSlotSidebar::drawActionIcon(sf::RenderWindow& window,
                                       sf::FloatRect rect,
                                       InfoBarAction action,
                                       sf::Color color) {
    const float stroke = std::max(1.0f, actionIconStroke);
    const float cx = rect.position.x + rect.size.x * 0.5f;
    const float cy = rect.position.y + rect.size.y * 0.5f;
    auto line = [&](sf::Vector2f from, sf::Vector2f to) {
        const sf::Vector2f center{cx, cy};
        from = center + (from - center) * actionGlyphScale;
        to   = center + (to - center) * actionGlyphScale;
        const sf::Vector2f delta = to - from;
        const float length = std::sqrt(delta.x * delta.x + delta.y * delta.y);
        if (length <= 0.0f) return;
        sf::RectangleShape segment({length, stroke});
        segment.setOrigin({0.0f, stroke * 0.5f});
        segment.setPosition(from);
        segment.setRotation(sf::radians(std::atan2(delta.y, delta.x)));
        segment.setFillColor(color);
        window.draw(segment);
    };
    auto oval = [&](sf::FloatRect ovalRect) {
        const sf::Vector2f center{cx, cy};
        ovalRect.position = center + (ovalRect.position - center) * actionGlyphScale;
        ovalRect.size *= actionGlyphScale;
        drawOval(window, ovalRect, color);
    };

    if (action == InfoBarAction::Inventory) {
        line({cx - 6.0f, cy - 2.0f}, {cx - 4.0f, cy + 5.0f});
        line({cx - 4.0f, cy + 5.0f}, {cx + 5.0f, cy + 5.0f});
        line({cx + 5.0f, cy + 5.0f}, {cx + 6.0f, cy - 2.0f});
        line({cx - 6.0f, cy - 2.0f}, {cx - 2.0f, cy - 2.0f});
        line({cx + 2.0f, cy - 2.0f}, {cx + 6.0f, cy - 2.0f});
        line({cx - 2.0f, cy - 5.0f}, {cx + 2.0f, cy - 5.0f});
        line({cx, cy - 5.0f}, {cx, cy + 1.0f});
    } else if (action == InfoBarAction::LootFilter) {
        line({cx - 6.0f, cy - 5.0f}, {cx + 6.0f, cy - 5.0f});
        line({cx - 6.0f, cy - 5.0f}, {cx - 1.5f, cy});
        line({cx + 6.0f, cy - 5.0f}, {cx + 1.5f, cy});
        line({cx - 1.5f, cy}, {cx + 1.5f, cy});
        line({cx + 1.5f, cy}, {cx + 1.5f, cy + 5.0f});
        line({cx + 1.5f, cy + 5.0f}, {cx - 1.0f, cy + 3.0f});
    } else if (action == InfoBarAction::DiceCrafter) {
        line({cx, cy - 7.0f}, {cx + 6.0f, cy - 3.0f});
        line({cx + 6.0f, cy - 3.0f}, {cx + 4.0f, cy + 5.0f});
        line({cx + 4.0f, cy + 5.0f}, {cx - 4.0f, cy + 5.0f});
        line({cx - 4.0f, cy + 5.0f}, {cx - 6.0f, cy - 3.0f});
        line({cx - 6.0f, cy - 3.0f}, {cx, cy - 7.0f});
        oval({{cx - 1.25f, cy - 2.0f}, {2.5f, 2.5f}});
        oval({{cx - 3.8f, cy + 1.8f}, {2.5f, 2.5f}});
        oval({{cx + 1.3f, cy + 1.8f}, {2.5f, 2.5f}});
    } else if (action == InfoBarAction::Help) {
        line({cx - 4.0f, cy - 3.0f}, {cx - 2.0f, cy - 6.0f});
        line({cx - 2.0f, cy - 6.0f}, {cx + 3.0f, cy - 6.0f});
        line({cx + 3.0f, cy - 6.0f}, {cx + 5.0f, cy - 3.0f});
        line({cx + 5.0f, cy - 3.0f}, {cx, cy + 1.0f});
        line({cx, cy + 1.0f}, {cx, cy + 3.0f});
        oval({{cx - 1.0f, cy + 5.0f}, {2.0f, 2.0f}});
    }
}

void WeaponSlotSidebar::drawActionTooltip(sf::RenderWindow& window,
                                          const WeaponSlotLayout& layout,
                                          InfoBarAction action) {
    const auto button = layout.actionButtonRect(action);
    const std::string& name = nameForAction(action);
    sf::Text text{font, name, actionTooltipFontSize};
    text.setFillColor(theme.uiText);
    const auto bounds = text.getLocalBounds();
    const float width = bounds.size.x + actionTooltipPaddingX * 2.0f;
    const float height = static_cast<float>(actionTooltipFontSize) + actionTooltipPaddingY * 2.0f;
    const auto bar = layout.sidebarRect();
    float x = button.position.x + button.size.x * 0.5f - width * 0.5f;
    x = std::clamp(x, bar.position.x + 4.0f, bar.position.x + bar.size.x - width - 4.0f);
    const float y = button.position.y - height - actionTooltipOffset;
    const sf::FloatRect tipRect{{x, y}, {width, height}};

    ui::UiPanel panel;
    panel.background = rowBackground;
    panel.border = accent.full();
    panel.borderThickness = accent.thicknessHairline;
    panel.draw(window, tipRect);

    text.setPosition({tipRect.position.x + actionTooltipPaddingX - bounds.position.x,
                      tipRect.position.y + (tipRect.size.y - bounds.size.y) * 0.5f - bounds.position.y});
    window.draw(text);
}

const std::string& WeaponSlotSidebar::labelForAction(InfoBarAction action) const {
    const int index = static_cast<int>(action);
    if (index < 0 || index >= kInfoBarActionCount) return actionLabels[0];
    return actionLabels[static_cast<std::size_t>(index)];
}

const std::string& WeaponSlotSidebar::nameForAction(InfoBarAction action) const {
    const int index = static_cast<int>(action);
    if (index < 0 || index >= kInfoBarActionCount) return actionNames[0];
    return actionNames[static_cast<std::size_t>(index)];
}

} // namespace dof::render
