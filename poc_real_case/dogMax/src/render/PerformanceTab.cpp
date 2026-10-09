#include "render/PerformanceTab.hpp"

#include "render/DebugPanel.hpp"
#include "render/FpsHistory.hpp"
#include "render/ui/UiBarChart.hpp"
#include "render/ui/UiLabel.hpp"
#include "render/ui/UiPanel.hpp"

#include <algorithm>
#include <iomanip>
#include <sstream>
#include <vector>

namespace dof::render {

namespace {

std::string formatFloat(float value, int precision) {
    std::ostringstream out;
    out << std::fixed << std::setprecision(precision) << value;
    return out.str();
}

}

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
                         sf::Color panelBgColor) {
    // Single-accent collapse: body + graph backgrounds read the shared
    // panel-bg token (passed in by DebugPanel) instead of per-tab dark
    // swatches. The FPS bars keep their good/bad semantic colours.
    ui::UiPanel{panelBgColor, sf::Color::Transparent, 0.0f}
        .draw(window, {{rects.panelX, rects.bodyY()},
                       {rects.panelWidth, rects.bodyHeight()}});

    const float lineHeight = static_cast<float>(textSize) + 4.0f;
    const float padX = 12.0f;
    const float padY = 8.0f;
    float y = rects.bodyY() + padY;
    int totalLineCount = 0;

    auto drawLine = [&](const std::string& text) -> bool {
        const int idx = totalLineCount++;
        if (idx < scrollOffset) return false;
        if (y + lineHeight > rects.bodyBottom()) return false;
        const sf::FloatRect textRect{
            {rects.panelX + padX, y},
            {rects.panelWidth - padX * 2.0f, lineHeight}};
        ui::UiLabel{textColor, textSize, ui::TextAlign::Left}
            .draw(window, textRect, font, text);
        y += lineHeight;
        return true;
    };

    // Spec L2848 — FPS history graph (last 120 frames).
    if (fpsHistory && fpsHistory->size() > 0) {
        const float minFps = fpsHistory->min();
        const float maxFps = fpsHistory->max();
        const float avgFps = fpsHistory->average();
        std::ostringstream stat;
        stat << "FPS  min " << formatFloat(minFps, 1)
             << "   max " << formatFloat(maxFps, 1)
             << "   avg " << formatFloat(avgFps, 1)
             << "   samples " << fpsHistory->size() << "/" << fpsHistory->capacity();
        const bool summaryDrawn = drawLine(stat.str());

        if (summaryDrawn) {
            const float graphX      = rects.panelX + padX;
            const float graphY      = y;
            const float graphWidth  = rects.panelWidth - 2.0f * padX;
            const float graphHeight = lineHeight * 4.0f;
            if (graphY + graphHeight <= rects.bodyBottom()) {
                // Graph background — UiPanel (flat, no border). Same shared
                // panel-bg token as the body; bars supply their own colour.
                ui::UiPanel{panelBgColor, sf::Color::Transparent, 0.0f}
                    .draw(window, {{graphX, graphY}, {graphWidth, graphHeight}});

                // FPS bar columns — ui::UiBarChart, per-bar coloured by
                // the good/bad FPS threshold (card converting the perf
                // graph off raw sf::RectangleShape bars).
                const auto samples = fpsHistory->samples();
                const float scaleMax = std::max(60.0f, maxFps);
                std::vector<float> normalisedSamples;
                std::vector<sf::Color> sampleColors;
                normalisedSamples.reserve(samples.size());
                sampleColors.reserve(samples.size());
                for (float sample : samples) {
                    normalisedSamples.push_back(std::min(sample / scaleMax, 1.0f));
                    sampleColors.push_back(sample >= goodFpsThreshold ? goodFpsColor : badFpsColor);
                }
                // Track left fully transparent — the graph background panel
                // drawn above already fills the space behind each bar; no
                // adjacent gap so the columns read as one continuous strip
                // (matches the original raw-shape layout).
                ui::UiBarChart{goodFpsColor, sf::Color::Transparent, 0.0f}
                    .draw(window, {{graphX, graphY}, {graphWidth, graphHeight}},
                          normalisedSamples, sampleColors);
                y += graphHeight + 4.0f;
            }
        }
    } else {
        drawLine("FPS history not yet wired — render the panel for a few frames.");
    }

    drawLine("");
    // Spec L2849 — per-system update time. Simulation values are from the
    // fixed step consumed this rendered frame; zero means no sim step ran.
    std::ostringstream timeLine;
    timeLine << "Sim-step ms: Enemy "
             << formatFloat(frameTimings.enemyManagerMs, 3)
             << "  Weapon " << formatFloat(frameTimings.weaponManagerMs, 3)
             << "  Hubs " << formatFloat(frameTimings.hubUpdateMs, 3);
    drawLine(timeLine.str());
    std::ostringstream renderLine;
    renderLine << "Render ms: World "
               << formatFloat(frameTimings.worldRenderMs, 3)
               << "  Grid subset " << formatFloat(frameTimings.gridRebuildMs, 3);
    drawLine(renderLine.str());
    // Spec L2850 — spatial grid cell counts.
    std::ostringstream gridLine;
    gridLine << "Spatial grid cells:      " << spatialGridCellCount;
    drawLine(gridLine.str());
    // Spec L2851 — memory allocation rate. No cross-platform meter.
    drawLine("Memory allocation rate:  not instrumented");
    return totalLineCount;
}

}
