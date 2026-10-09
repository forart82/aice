#pragma once

#include "entities/QualityTier.hpp"
#include "entities/SpecialEnemyKind.hpp"

namespace dof::loaders { class ConfigLoader; }

namespace dof::combat {

// Phase 14 — Special Enemy spawn gate parameters. Every entry is the
// "every Nth spawn of the host tier" / "1-in-N per spawn" / "Hero
// level threshold" rule from `GameDesign.md` L607-686.
//
// Defaults match the spec verbatim:
//   Shocker      replaces every  7th Uncommon  after Hero ≥  3
//   Hexarchon    replaces every 50th Rare      after Hero ≥ 15
//   Voidcrawler  replaces every 200th Rare     after Hero ≥ 25
//                                              + must be inside recent exclusion zone
//   Glasswraith  1-in-1000 chance per spawn    after Hero ≥  5
//
// TassideanSentinel + PactWalker are spec-deferred (require ruins
// anchor + NPC behaviour respectively) — left out of the gate
// parameters here; spawn substitution returns `None` for those slots
// until the follow-up cards land.
struct SpecialEnemyGateParams {
    int shockerEveryNthUncommon{7};
    int shockerHeroLevelGate{3};
    int hexarchonEveryNthRare{50};
    int hexarchonHeroLevelGate{15};
    int voidcrawlerEveryNthRare{200};
    int voidcrawlerHeroLevelGate{25};
    int glasswraithOneIn{1000};
    int glasswraithHeroLevelGate{5};

    static SpecialEnemyGateParams loadFromConfig(const dof::loaders::ConfigLoader& config);
};

// Per-tier substitution counters carried by the spawn pipeline. Each
// counter increments AFTER the predicate fires for its tier so the
// "every 7th" / "every 50th" / "every 200th" cadence is anchored on
// the tier's own spawn sequence (not the global spawn counter).
struct SpecialEnemyCounters {
    int uncommonSinceLastShocker{0};
    int rareSinceLastHexarchon{0};
    int rareSinceLastVoidcrawler{0};

    void reset();
};

// Pure predicate — picks the Special kind for the next spawn given
// the rolled tier, the per-tier counters, the Hero's current level,
// and an optional `insideExclusionZone` flag (Voidcrawler only).
//
// The `randomFraction` argument is the [0, 1) draw used for
// Glasswraith's 1-in-1000 roll; pass a deterministic value in tests.
//
// Returns `SpecialEnemyKind::None` when no special should spawn for
// this slot. When a non-None kind fires, the caller is responsible
// for resetting the matching tier counter (see
// `SpecialEnemyCounters::reset`) so the next "every Nth" cycle
// starts at zero.
dof::entities::SpecialEnemyKind pickSpecialKind(dof::entities::QualityTier tier,
                                                 const SpecialEnemyCounters& counters,
                                                 int heroLevel,
                                                 bool insideExclusionZone,
                                                 float randomFraction,
                                                 const SpecialEnemyGateParams& params);

}
