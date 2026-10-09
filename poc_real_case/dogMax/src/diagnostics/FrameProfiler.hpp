#pragma once

namespace dof::diagnostics {

struct FrameTimings {
    float enemyManagerMs{0.0f};
    float weaponManagerMs{0.0f};
    float worldRenderMs{0.0f};
    float gridRebuildMs{0.0f};
    float hubUpdateMs{0.0f};
};

void resetFrameTimings();
void setEnemyManagerMs(float milliseconds);
void setWeaponManagerMs(float milliseconds);
void setWorldRenderMs(float milliseconds);
void addGridRebuildMs(float milliseconds);
void setHubUpdateMs(float milliseconds);
FrameTimings frameTimings();

}  // namespace dof::diagnostics
