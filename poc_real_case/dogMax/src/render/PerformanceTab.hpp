#pragma once

// Spec §Debug Mode §Tabs §Performance Tab L2846-2852 — paints the FPS
// history graph + per-system update time + spatial grid counts +
// memory allocation rate.
//
#include "diagnostics/FrameProfiler.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/RenderWindow.hpp>

namespace dof::render {

struct DebugPanelRects;
class  FpsHistory;

int drawPerformanceTab(sf::RenderWindow& window,
                         const DebugPanelRects& rects,
                         const FpsHistory* fpsHistory,
                         dof::diagnostics::FrameTimings frameTimings,
                         int spatialGridCellCount,
                         const sf::Font& font,
                         unsigned textSize,
                         sf::Color textColor,
                         int scrollOffset,
                         float goodFpsThreshold,
                         sf::Color goodFpsColor,
                         sf::Color badFpsColor,
                         sf::Color panelBgColor);

}
