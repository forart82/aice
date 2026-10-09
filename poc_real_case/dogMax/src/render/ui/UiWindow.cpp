#include "render/ui/UiWindow.hpp"
#include "render/ui/PixelSnap.hpp"

#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Text.hpp>

#include <algorithm>

namespace dof::render::ui {

namespace {

// Content-driven chip width: measured label width plus the chip's own
// horizontal padding on both sides (mirrors the former per-window
// chipWidthFor helpers). Keeps the badge tight to its label at any scale
// without hard-coding a layout proportion.
float measureChipWidth(const sf::Font& font, const std::string& label,
                       const UiChip& chip) {
    if (label.empty() || chip.fontSize == 0u) return 0.0f;
    sf::Text probe(font, label, chip.fontSize);
    return probe.getLocalBounds().size.x + chip.paddingX * 2.0f;
}

} // namespace

void UiWindow::drawFrame(sf::RenderWindow& window, const sf::FloatRect& bounds,
                         const sf::Font& font, const std::string& title) const {
    // Body first: the framed background + border every window shares. When a
    // glow is configured, the frame reads as a neon panel (aligned edge border
    // + outward halo) coherent with the other framed panels.
    if (glowSpread > 0.0f && glowAlpha > 0.0f) {
        drawGlowFrame(window, bounds, panel.background, panel.border,
                      panel.borderThickness, glowLayers, glowSpread, glowAlpha);
    } else {
        panel.draw(window, bounds);
    }

    // Title chip on the top edge, sized to its own label. Skipped when the
    // caller hides the title or passes an empty string (a plain bordered
    // frame). The default (transparent dot) draws the plain title-chip form;
    // a caller wanting a status dot composes titleChip.draw() itself.
    if (showTitle && !title.empty()) {
        titleChip.draw(window, bounds, font, title,
                       measureChipWidth(font, title, titleChip));
    }
}

sf::FloatRect UiWindow::contentRect(const sf::FloatRect& bounds,
                                    const std::string& title) const {
    // Top inset reserves the title bar (only when a title is actually drawn)
    // plus one pad; the other three sides take a pad each. The condition is
    // character-for-character drawFrame()'s, so the reserved band and the
    // painted band can never disagree. Clamp so degenerate bounds never yield a
    // negative-size rect (callers guard on size.x / size.y > 0).
    const float topBand = (showTitle && !title.empty()) ? titleBarHeight : 0.0f;

    const float x = bounds.position.x + contentPadding;
    const float y = bounds.position.y + topBand + contentPadding;
    const float w = std::max(0.0f, bounds.size.x - contentPadding * 2.0f);
    const float h = std::max(0.0f, bounds.size.y - topBand - contentPadding * 2.0f);

    return sf::FloatRect{{x, y}, {w, h}};
}

} // namespace dof::render::ui
