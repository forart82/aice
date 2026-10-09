#include "diagnostics/FrameProfiler.hpp"

namespace dof::diagnostics {

namespace {

FrameTimings gFrameTimings;

}

void resetFrameTimings() {
    gFrameTimings = FrameTimings{};
}

void setEnemyManagerMs(float milliseconds) {
    gFrameTimings.enemyManagerMs = milliseconds;
}

void setWeaponManagerMs(float milliseconds) {
    gFrameTimings.weaponManagerMs = milliseconds;
}

void setWorldRenderMs(float milliseconds) {
    gFrameTimings.worldRenderMs = milliseconds;
}

void addGridRebuildMs(float milliseconds) {
    gFrameTimings.gridRebuildMs += milliseconds;
}

void setHubUpdateMs(float milliseconds) {
    gFrameTimings.hubUpdateMs = milliseconds;
}

FrameTimings frameTimings() {
    return gFrameTimings;
}

}  // namespace dof::diagnostics
