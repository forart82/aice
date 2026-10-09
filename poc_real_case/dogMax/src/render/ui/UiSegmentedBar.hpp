#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>

namespace dof::loaders { class ConfigLoader; }
namespace sf { class RenderTarget; }

namespace dof::render::ui {

class QuadBatch;

// Segmented fill bar — N discrete cells lit left-to-right by a [0,1]
// ratio (health / XP / charge read-outs). Plain style-holder ported
// from the former free functions drawSegmentedBar/litSegmentCount.
struct UiSegmentedBar {
    int   segmentCount{0};
    float segmentGap{0.0f};

    // Load the canonical segment count + gap from config
    // (UIR_SEGMENT_COUNT / UIR_SEGMENT_GAP).
    static UiSegmentedBar loadFromConfig(const dof::loaders::ConfigLoader& config);

    // Pure helper — how many cells light for `ratio`. Any non-zero ratio
    // lights at least one cell so the bar never reads empty with a sliver
    // of value left. Static + render-free so it stays testable.
    static int litSegmentCount(float ratio, int segmentCount);

    // Draw the bar filling `rect`: lit cells use `fillLit`, the rest
    // `fillEmpty`.
    void draw(sf::RenderTarget& window, sf::FloatRect rect, float ratio,
              sf::Color fillLit, sf::Color fillEmpty) const;
    void appendTo(sf::RenderTarget& window, QuadBatch& batch, sf::FloatRect rect,
                  float ratio, sf::Color fillLit, sf::Color fillEmpty) const;
};

} // namespace dof::render::ui
