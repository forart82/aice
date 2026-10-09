#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/System/Vector2.hpp>

namespace dof::entities { class Dice; }
namespace dof::loaders { class ShaderLoader; }
namespace dof::render  { class ShapeShaders; }

namespace dof::render::widgets {

// Hex-chip dice cell for the weapon-slot sidebar. Encapsulates both the
// occupied path (shader die or fallback hex + face-value label +
// per-cell countdown strip) and the empty path (dim hex outline).
struct UiDiceCell {
    sf::Color emptyFill;
    sf::Color emptyOutline;
    sf::Color labelColor;
    float     chargedOutlineThickness{3.5f};
    int       chargedFillAlphaBoost{120};
    float     countdownBarThickness{3.0f};
    // Draw-time geometry + fallback scalars — caller-overridable, but no
    // weapon-slot config keys feed them: the weapon-slot sidebar and the
    // component gallery use the defaults below as-is. Only InventoryRenderer
    // overrides faceValueFontSize + fallbackFillAlpha (from its INVENTORY_DICE_*
    // keys); every other field keeps its hard-coded C++ default everywhere.
    float     hexRadiusWidthFactor{0.45f};   // hex radius = min(cellW*W, cellH*H),
    float     hexRadiusHeightFactor{0.55f};  //   floored at hexRadiusMin px
    float     hexRadiusMin{2.0f};
    float     emptyOutlineThickness{1.0f};   // empty-slot hex outline
    float     outlineThickness{2.0f};        // non-charged occupied hex outline
    int       fallbackFillAlpha{80};         // shader-less fallback fill alpha
    unsigned  faceValueFontSize{12};         // rolled face-value label
    float     barPad{1.0f};                  // per-cell countdown-strip inset
    // Caller-suppressible countdown strip. The weapon-slot sidebar leaves this
    // true (an equipped die counts down each cycle). Static contexts — e.g. the
    // inventory grid, where a stored die has no active countdown — set it false
    // so an idle (progress 0) die does not paint a full-height bar.
    bool      showCountdownBar{true};

    // Draw one dice cell at `cellRect`. `dice` null → empty slot. The hex
    // radius + outline thickness come from the fields above (caller-set from
    // config), so no external chrome style object is needed.
    void draw(sf::RenderWindow& window, sf::FloatRect cellRect,
              const dof::entities::Dice* dice,
              sf::Color faceColor,
              bool isCharged,
              sf::Color chargedOutline,
              const sf::Font& font,
              const dof::loaders::ShaderLoader* shaders,
              dof::render::ShapeShaders& shapeShaders) const;

    // Point-in-cell test against the HEXAGON draw() paints, not the square
    // `cellRect` it is handed — the hex covers ~65% of that rect, so a rect
    // test accepts four corner regions where nothing is drawn. Delegates to
    // ui::UiHexCell::hitTest over the same centre and radius draw() uses.
    // `isEnabled` is deliberately NOT defaulted so a cell painted as inert
    // cannot stay droppable.
    bool hitTest(sf::FloatRect cellRect, sf::Vector2f point, bool isEnabled) const;

    // Pure geometry helpers — testable without a render context.
    static sf::Vector2f computeHexCentre(sf::FloatRect cellRect);
    static float computeHexRadius(sf::FloatRect cellRect, float widthFactor,
                                   float heightFactor, float minRadius);
    static sf::FloatRect computeCountdownBarRect(sf::FloatRect cellRect,
                                                  float barThickness, float barPad,
                                                  float progress);
};

} // namespace dof::render::widgets
