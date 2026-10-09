#pragma once

namespace dof::abilities {

struct Huntable {
    float chaseRange{0.0f};
    float attackRange{0.0f};
    float deadzoneFactor{0.45f};
    float attackFlashTimer{0.0f};
    float spawnAnimTimer{0.0f};
    bool  hasPlayedSpawnPortalCloseSound{false};
};

}
