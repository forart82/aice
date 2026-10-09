#pragma once

#include "render/ui/UiChip.hpp"
#include "render/ui/UiPanel.hpp"

#include <SFML/Graphics/Rect.hpp>

#include <string>

namespace sf { class Font; class RenderWindow; }

namespace dof::render::ui {

// Frame-container primitive: the shared "window" shape. ~9 windows hand-compose
// the same thing — a bordered body panel plus a title/status chip on the top
// edge, optionally wrapping a scroll region. UiWindow makes a window pure
// composition: it owns no state and reads no config; the caller styles the
// sub-widgets once (typically from config) and, each frame, calls drawFrame()
// then lays content out inside contentRect().
//
// Contract matches every other ui:: widget: a value struct of public style
// fields plus const draw methods. The font is passed to draw() (never held as a
// member) — exactly like ui::UiChip / ui::UiLabel / ui::UiTab / ui::UiButton.
// (This is why drawFrame takes a `const sf::Font&`: a title chip cannot render
// its label without one, and holding a font would break the value-struct
// contract.)
//
// Scroll region (optional, deliberately not owned): contentRect() IS the
// viewport rect — a caller wanting a scrollable body passes it straight to
// ui::UiScrollPanel::applyClipView / drawScrollbar as the clip rect. UiWindow
// does not depend on UiScrollPanel; composing one is the caller's choice, so
// the plain body+title frame stays the whole cost for windows that don't scroll.
struct UiWindow {
    // Body background + border — the framed panel behind everything.
    UiPanel panel;

    // Title/status badge anchored on the panel's top edge. Styled by the
    // caller (typically ui::UiChip::loadFromConfig). Drawn only when showTitle
    // is true and drawFrame() receives a non-empty title.
    UiChip  titleChip;

    // Interior band reserved at the top of the body for the title area and
    // kept clear of content by contentRect(). Independent of the chip's own
    // overhang height (the chip straddles the top edge) — this is how much
    // interior the title region steals from content layout.
    float   titleBarHeight{0.0f};

    // Uniform inset from the body edges (and below the reserved title bar) to
    // the content area; contentRect() applies it on all four sides.
    float   contentPadding{0.0f};

    // When false, no title chip is drawn and contentRect() reclaims the
    // title-bar band — a plain bordered frame (e.g. a tooltip body).
    bool    showTitle{true};

    // Neon glow for the window frame — a crisp accent border on the edge + an
    // outward halo (ui::drawGlowFrame), so every UiWindow reads as a glowing
    // cyberpunk panel coherent with the inventory / dice-crafter frames.
    // glowSpread <= 0 draws the flat panel border instead. Styled by the caller
    // (typically from UI_GLOW_* config).
    float   glowSpread{0.0f};
    int     glowLayers{5};
    float   glowAlpha{70.0f};

    // Draw the body panel, then — when showTitle is set and title is non-empty
    // — the title chip on the top edge, sized to its own label. Immediate
    // mode: call every frame; the caller owns the title text and all content.
    void drawFrame(sf::RenderWindow& window, const sf::FloatRect& bounds,
                   const sf::Font& font, const std::string& title) const;

    // Inner content area: bounds minus the reserved title bar (when shown)
    // minus contentPadding on every side. Pure geometry (no font/window), so
    // callers lay out — or clip a UiScrollPanel to — this rect. Never returns
    // a negative size; degenerate bounds clamp to zero.
    //
    // Takes the SAME title drawFrame() is given, and reserves the band on the
    // same condition drawFrame() paints it on (showTitle && !title.empty()).
    // It used to key on showTitle alone, so an empty title pushed content down
    // past a band that was never drawn.
    sf::FloatRect contentRect(const sf::FloatRect& bounds, const std::string& title) const;
};

} // namespace dof::render::ui
