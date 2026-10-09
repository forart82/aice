#include "render/ui/UiTooltip.hpp"
#include "render/ui/PixelSnap.hpp"
#include "render/ShapeShaders.hpp"
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Text.hpp>
#include <algorithm>
#include <cmath>
#include <sstream>
#include <vector>

namespace dof::render::ui {
namespace {

std::vector<std::string> splitLines(const std::string& text) {
    std::vector<std::string> lines;
    std::stringstream stream(text);
    std::string line;
    while (std::getline(stream, line)) lines.push_back(line);
    if (!text.empty() && text.back() == '\n') lines.emplace_back();
    return lines;
}

std::vector<std::string> splitColumns(const std::string& text) {
    std::vector<std::string> columns;
    std::string current;
    for (char c : text) {
        if (c == '\t') {
            columns.push_back(current);
            current.clear();
        } else {
            current.push_back(c);
        }
    }
    columns.push_back(current);
    return columns;
}

bool isSectionLine(const std::string& line) {
    return line.size() > 2 && line[0] == '#' && line[1] == ' ';
}

std::string fitText(const sf::Font& font, const std::string& text, unsigned size, float maxWidth) {
    if (maxWidth <= 0.0f) return {};
    sf::Text probe(font, text, size);
    if (probe.getLocalBounds().size.x <= maxWidth) return text;
    if (text.size() <= 3) return text;
    std::string shortened = text;
    while (shortened.size() > 3) {
        shortened.pop_back();
        const std::string candidate = shortened + "...";
        probe.setString(candidate);
        if (probe.getLocalBounds().size.x <= maxWidth) return candidate;
    }
    return "...";
}

void drawText(sf::RenderWindow& window,
              const sf::Font& font,
              const std::string& text,
              unsigned size,
              sf::Vector2f position,
              sf::Color color,
              float maxWidth) {
    sf::Text label(font, fitText(font, text, size, maxWidth), size);
    label.setFillColor(color);
    label.setPosition(pixelSnap(position));
    window.draw(label);
}

float bodyHeightFor(const std::vector<std::string>& lines,
                    float lineHeight,
                    float emptyLineHeight,
                    float sectionGap) {
    float height = 0.0f;
    for (const auto& line : lines) {
        if (line.empty()) {
            height += emptyLineHeight;
        } else if (isSectionLine(line)) {
            height += lineHeight + sectionGap;
        } else {
            height += lineHeight;
        }
    }
    return height;
}

}

void UiTooltip::draw(sf::RenderWindow& window, sf::Vector2f anchorPoint,
                     const sf::Font& font, const std::string& title,
                     const std::string& body, sf::Vector2f viewSize,
                     bool useGlow, sf::Color glowColor,
                     float glowSpread, int glowLayers, float glowAlpha) const {
    const auto bodyLines = splitLines(body);
    const float bodyHeight = body.empty() ? 0.0f
                           : bodyHeightFor(bodyLines, lineHeight, emptyLineHeight, sectionGap);
    const float h = padding + titleFontSize
                  + (body.empty() ? 0.0f : titleBodyGap + bodyHeight)
                  + padding;
    const float width = std::min(maxWidth, std::max(120.0f, viewSize.x - 8.0f));
    float tx = anchorPoint.x + 12.f, ty = anchorPoint.y - h - 12.f;
    if (tx + width > viewSize.x) tx = anchorPoint.x - width - 12.f;
    // One clamp, not two sequential ones: the old bottom-fit ran AFTER the
    // top-fit and recomputed ty negative whenever the tooltip was taller than
    // the view, pushing it off the top of the screen entirely.
    ty = std::clamp(ty, 4.f, std::max(4.f, viewSize.y - h - 4.f));
    const sf::FloatRect rect = pixelSnap({{tx, ty}, {width, h}});
    if (useGlow) {
        // Aligned glow: crisp border on the rect edge (matching the tooltip
        // text layout) + an outward additive halo.
        drawGlowFrame(window, rect, panel.background, glowColor,
                      panel.borderThickness, glowLayers, glowSpread, glowAlpha);
    } else {
        panel.draw(window, rect);
    }
    const unsigned titleSize = static_cast<unsigned>(titleFontSize);
    const unsigned bodySize = static_cast<unsigned>(bodyFontSize);
    const float contentX = rect.position.x + padding;
    const float contentRight = rect.position.x + rect.size.x - padding;
    const float contentWidth = contentRight - contentX;

    sf::Text titleText(font, fitText(font, title, titleSize, contentWidth), titleSize);
    titleText.setFillColor(titleColor);
    titleText.setPosition(pixelSnap({contentX, rect.position.y + padding}));
    window.draw(titleText);

    if (body.empty()) return;

    float y = rect.position.y + padding + titleFontSize + titleBodyGap;
    const float valueX = contentX + rowLabelWidth;
    const float badgeX = contentRight - badgeWidth;
    for (const auto& line : bodyLines) {
        if (line.empty()) {
            y += emptyLineHeight;
            continue;
        }

        if (isSectionLine(line)) {
            const std::string section = line.substr(2);
            drawText(window, font, section, bodySize, {contentX, y}, sectionColor, contentWidth);

            sf::Text measure(font, section, bodySize);
            const float ruleX = contentX + measure.getLocalBounds().size.x + 8.0f;
            if (ruleX < contentRight) {
                sf::RectangleShape rule({contentRight - ruleX, 1.0f});
                rule.setPosition(pixelSnap({ruleX, y + lineHeight * 0.5f}));
                rule.setFillColor(ruleColor);
                window.draw(rule);
            }
            y += lineHeight + sectionGap;
            continue;
        }

        const auto columns = splitColumns(line);
        if (columns.size() >= 2) {
            drawText(window, font, columns[0], bodySize, {contentX, y}, labelColor,
                     std::max(0.0f, rowLabelWidth - 8.0f));
            const bool hasBadge = columns.size() >= 3 && !columns[2].empty();
            const float valueWidth = hasBadge
                ? std::max(0.0f, badgeX - valueX - 8.0f)
                : std::max(0.0f, contentRight - valueX);
            drawText(window, font, columns[1], bodySize, {valueX, y}, valueColor, valueWidth);

            if (hasBadge) {
                sf::RectangleShape badge({badgeWidth, std::max(1.0f, lineHeight - 4.0f)});
                badge.setPosition(pixelSnap({badgeX, y + 1.0f}));
                badge.setFillColor(badgeBgColor);
                badge.setOutlineColor(ruleColor);
                badge.setOutlineThickness(1.0f);
                window.draw(badge);

                sf::Text badgeText(font, fitText(font, columns[2], bodySize, badgeWidth - 4.0f), bodySize);
                badgeText.setFillColor(badgeTextColor);
                const auto bounds = badgeText.getLocalBounds();
                badgeText.setOrigin({bounds.position.x + bounds.size.x / 2.0f,
                                     bounds.position.y + bounds.size.y / 2.0f});
                badgeText.setPosition(pixelSnap({badgeX + badgeWidth * 0.5f,
                                                 y + lineHeight * 0.5f}));
                window.draw(badgeText);
            }
        } else {
            drawText(window, font, line, bodySize, {contentX, y}, bodyColor, contentWidth);
        }
        y += lineHeight;
    }
}
} // namespace dof::render::ui
