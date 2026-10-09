#pragma once

#include <cstdint>
#include <string>

namespace dof::app {

struct AppOptions {
    bool         isHeadless{false};
    // Render every frame into a never-shown (hidden) window so GIF capture and
    // screenshots work without a visible window popping on screen. Still needs
    // a GL display (DISPLAY / Xvfb) like any rendered frame — just no visible UI.
    bool         isOffscreen{false};
    float        selfTestDurationSeconds{0.0f};
    bool         isSelfTestMoving{false};
    bool         isWorldEditorOpen{false};
    bool         isWorldEditorSaveOnStart{false};
    float        cameraZoomOverride{0.0f};
    bool         hasHeroPositionOverride{false};
    float        heroPositionOverrideX{0.0f};
    float        heroPositionOverrideY{0.0f};
    std::uint64_t seed{0};
    bool         isSeedExplicit{false};
    std::string  configDirectory{"configs"};
    std::string   screenshotPath{};
    float         screenshotDelaySeconds{0.5f};
    int           performanceEnemyCount{0};
    std::string   performanceReportPath{};
    std::string   attackShowcaseWeapon{};
};

AppOptions parseAppOptions(int argc, char** argv);

}
