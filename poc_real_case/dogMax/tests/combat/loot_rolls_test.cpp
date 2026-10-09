// CHARACTERISATION suite for the Loot Pipeline Stage 2 rolls.
//
// HONESTY NOTE on TDD status: `src/combat/LootRolls.{hpp,cpp}` predates the TDD
// protocol. These tests are CHARACTERISATION: written after the implementation,
// by reading it, to pin what it currently does. No RED phase occurred, no
// failing test drove this code into existence, and presenting it as
// Red-Green-Refactor would be a lie. Rule 1 binds NEW work from the protocol
// adoption date onward.
//
// HONESTY NOTE on the assertions: this suite was authored under a process
// constraint that forbids building or running the binary, so no literal RNG
// draw is asserted anywhere in this file. Inventing "expected" draws for a
// given seed and calling them verified would be a fabrication. What IS asserted
// is everything provable by reading the code: range containment (guaranteed by
// construction), the clamp arithmetic, and reproducibility asserted
// STRUCTURALLY — two identically-seeded generators must agree with each other,
// which needs no knowledge of the values they produce.
//
// Oracle reference: NONE YET. ORACLE.md §4's formula table has no loot-roll row
// and §7 already logs "Oracle formula/entity tables incomplete" as a known Rule
// 8 gap. The header comment on LootRolls.hpp cites spec §Loot Pipeline, §Quality
// Floor, §Item Level (SA26 / SE10 / L1718 / L1846) in GameDesign.md; those are
// the design source, not an Oracle anchor.
//
// Rule 5: DeterministicRandom is seeded explicitly on every construction. There
// is no wall clock, no default seed and no shared generator, so each TEST_CASE
// is order-independent and idempotent.
//
// Rule 6: LootRolls.hpp names no SFML type — it forward-declares only
// dof::helpers::RandomHelper. No window and no GL context is needed.

#include "doctest.h"

#include "combat/LootRolls.hpp"
#include "helpers/RandomHelper.hpp"

#include <cstdint>
#include <limits>

using dof::combat::rollItemLevel;
using dof::combat::rollQuality;
using dof::combat::rollStatQuality;
using dof::helpers::DeterministicRandom;

namespace {

// Arbitrary but FIXED. Any seed works; what matters is that it never varies
// between runs, so a failure is always reproducible.
constexpr std::uint64_t kSeed = 0xD06'DA7ULL;

// Large enough that missing an endpoint of any range exercised below is
// astronomically improbable (the narrowest range sampled is 2 values wide, the
// widest 100), while still finishing in microseconds.
constexpr int kSampleCount = 20000;

struct SampledBounds {
    int lowest{0};
    int highest{0};
};

// Draws `sampleCount` values and reports the observed extremes. Templated on
// the callable so no std::function allocation creeps into the hot loop.
template <typename RollFunction>
SampledBounds sampleBounds(RollFunction roll, int sampleCount) {
    SampledBounds bounds;
    bounds.lowest  = std::numeric_limits<int>::max();
    bounds.highest = std::numeric_limits<int>::min();
    for (int draw = 0; draw < sampleCount; ++draw) {
        const int value = roll();
        if (value < bounds.lowest) bounds.lowest = value;
        if (value > bounds.highest) bounds.highest = value;
    }
    return bounds;
}

}  // namespace

TEST_CASE("rollQuality draws inside [max(1, clamp(qFloor, 0, 99)), 100]") {
    SUBCASE("TC-01 happy path: a luck-driven floor lifts the lower bound") {
        DeterministicRandom rng(kSeed);
        const auto bounds = sampleBounds([&] { return rollQuality(rng, 50); }, kSampleCount);
        CHECK(bounds.lowest == 50);
        CHECK(bounds.highest == 100);
    }

    SUBCASE("TC-02 a luck-less roll still starts at 1, never 0") {
        // The std::max(1, …) exists precisely so qFloor = 0 does not open the
        // range at 0 — spec §Quality L1718 pins q to [1, 100].
        DeterministicRandom rng(kSeed);
        const auto bounds = sampleBounds([&] { return rollQuality(rng, 0); }, kSampleCount * 2);
        CHECK(bounds.lowest == 1);
        CHECK(bounds.highest == 100);
    }

    SUBCASE("TC-BOUNDARY-01 the floor saturates at 99, leaving a two-value range") {
        DeterministicRandom rng(kSeed);
        const auto bounds = sampleBounds([&] { return rollQuality(rng, 99); }, kSampleCount);
        CHECK(bounds.lowest == 99);
        CHECK(bounds.highest == 100);
    }

    SUBCASE("TC-EDGE-01 an absurd floor clamps to 99 instead of inverting the range") {
        // Without the clamp, uniformInt(500, 100) would throw std::invalid_argument.
        DeterministicRandom rng(kSeed);
        const auto bounds = sampleBounds([&] { return rollQuality(rng, 500); }, kSampleCount);
        CHECK(bounds.lowest == 99);
        CHECK(bounds.highest == 100);
    }

    SUBCASE("TC-EDGE-02 a negative floor is lifted to the [1, 100] full range") {
        // Callers may pass an un-clipped luck delta; the clamp absorbs it.
        DeterministicRandom rng(kSeed);
        const auto bounds = sampleBounds([&] { return rollQuality(rng, -250); }, kSampleCount * 2);
        CHECK(bounds.lowest == 1);
        CHECK(bounds.highest == 100);
    }

    SUBCASE("TC-EDGE-03 the integer extremes are handled, not merely survived") {
        // std::clamp runs BEFORE any arithmetic here, so both extremes are safe
        // — unlike rollItemLevel below, which does arithmetic first.
        DeterministicRandom rng(kSeed);
        const int atMin = rollQuality(rng, std::numeric_limits<int>::min());
        CHECK(atMin >= 1);
        CHECK(atMin <= 100);
        const int atMax = rollQuality(rng, std::numeric_limits<int>::max());
        CHECK(atMax >= 99);
        CHECK(atMax <= 100);
    }
}

TEST_CASE("rollItemLevel draws inside [ceil(enemyLevel / 2), enemyLevel]") {
    SUBCASE("TC-01 happy path: a mid-game kill cannot drop a level-1 item") {
        // SE10 / spec L1846 — the whole point of the raised lower bound.
        DeterministicRandom rng(kSeed);
        const auto bounds = sampleBounds([&] { return rollItemLevel(rng, 10); }, kSampleCount);
        CHECK(bounds.lowest == 5);
        CHECK(bounds.highest == 10);
    }

    SUBCASE("TC-02 the lower bound rounds UP on an odd enemy level") {
        // ceil(9 / 2) == 5, expressed as (9 + 1) / 2 in integer arithmetic.
        DeterministicRandom rng(kSeed);
        const auto bounds = sampleBounds([&] { return rollItemLevel(rng, 9); }, kSampleCount);
        CHECK(bounds.lowest == 5);
        CHECK(bounds.highest == 9);
    }

    SUBCASE("TC-03 at the shipped ENEMY_LEVEL_MAX the floor is half the cap") {
        DeterministicRandom rng(kSeed);
        const auto bounds = sampleBounds([&] { return rollItemLevel(rng, 99); }, kSampleCount);
        CHECK(bounds.lowest == 50);
        CHECK(bounds.highest == 99);
    }

    SUBCASE("TC-BOUNDARY-01 level 2 and 3 straddle the rounding") {
        DeterministicRandom rng(kSeed);
        const auto atTwo = sampleBounds([&] { return rollItemLevel(rng, 2); }, kSampleCount);
        CHECK(atTwo.lowest == 1);    // (2 + 1) / 2 == 1
        CHECK(atTwo.highest == 2);

        const auto atThree = sampleBounds([&] { return rollItemLevel(rng, 3); }, kSampleCount);
        CHECK(atThree.lowest == 2);  // (3 + 1) / 2 == 2
        CHECK(atThree.highest == 3);
    }

    SUBCASE("TC-EDGE-01 the range degenerates to exactly {1} at and below level 1") {
        DeterministicRandom rng(kSeed);
        for (int enemyLevel = -5; enemyLevel <= 1; ++enemyLevel) {
            CHECK(rollItemLevel(rng, enemyLevel) == 1);
        }
    }

    SUBCASE("TC-EDGE-02 INT_MIN degenerates to {1} rather than inverting the range") {
        // Safe because INT_MIN + 1 does not overflow: the lower bound computes
        // to a large negative number and std::max lifts it to 1, while the upper
        // bound is likewise lifted to 1.
        //
        // INT_MAX is deliberately NOT tested here. `(enemyLevel + 1) / 2`
        // overflows signed int at INT_MAX, which is undefined behaviour — a
        // test that invokes UB cannot be deterministic and would violate Rule 5.
        // It is LATENT rather than live: every production caller receives
        // enemyLevel from EnemyManager's `levelCurve->levelFromDistance(...)`,
        // which clamps to [1, ENEMY_LEVEL_MAX] = [1, 99]. Reported as a finding
        // rather than pinned, because pinning UB is not possible honestly.
        DeterministicRandom rng(kSeed);
        CHECK(rollItemLevel(rng, std::numeric_limits<int>::min()) == 1);
    }

    SUBCASE("TC-EDGE-03 a level far above the shipped cap still holds the invariant") {
        DeterministicRandom rng(kSeed);
        const auto bounds = sampleBounds([&] { return rollItemLevel(rng, 1000); }, kSampleCount);
        CHECK(bounds.lowest >= 500);
        CHECK(bounds.highest <= 1000);
    }
}

TEST_CASE("rollStatQuality behaves identically to rollQuality for the same floor") {
    // These two functions are byte-for-byte the same computation today. That is
    // only TWO occurrences, so CLAUDE.md's Rule-of-Three DRY guidance does not
    // yet call for merging them — but the equivalence is undocumented, and a
    // caller could reasonably assume the per-stat roll is biased differently.
    // Pinned so that if they ever diverge, it is a deliberate change with a
    // failing test attached rather than a silent one.
    SUBCASE("TC-01 the two roll the same value from the same generator state") {
        DeterministicRandom qualityRng(kSeed);
        DeterministicRandom statRng(kSeed);
        for (int draw = 0; draw < 500; ++draw) {
            CHECK(rollQuality(qualityRng, 40) == rollStatQuality(statRng, 40));
        }
    }

    SUBCASE("TC-02 the bias floor lifts the lower bound the same way") {
        DeterministicRandom rng(kSeed);
        const auto bounds = sampleBounds([&] { return rollStatQuality(rng, 75); }, kSampleCount);
        CHECK(bounds.lowest == 75);
        CHECK(bounds.highest == 100);
    }

    SUBCASE("TC-EDGE-01 negative and over-cap bias floors clamp identically") {
        DeterministicRandom rng(kSeed);
        const auto negative = sampleBounds([&] { return rollStatQuality(rng, -30); },
                                           kSampleCount * 2);
        CHECK(negative.lowest == 1);
        CHECK(negative.highest == 100);

        const auto overCap = sampleBounds([&] { return rollStatQuality(rng, 12345); },
                                          kSampleCount);
        CHECK(overCap.lowest == 99);
        CHECK(overCap.highest == 100);
    }
}

TEST_CASE("Loot rolls are bit-reproducible from a seed") {
    // Rule 5's central guarantee: the same seed must replay the same run. The
    // literal draws are NOT asserted (see the honesty note at the top of this
    // file) — reproducibility is asserted structurally, by requiring two
    // independently constructed generators to agree draw for draw.
    SUBCASE("TC-01 two generators on one seed produce one sequence") {
        DeterministicRandom first(kSeed);
        DeterministicRandom second(kSeed);
        for (int draw = 0; draw < 300; ++draw) {
            CHECK(rollQuality(first, 10) == rollQuality(second, 10));
            CHECK(rollItemLevel(first, 42) == rollItemLevel(second, 42));
            CHECK(rollStatQuality(first, 25) == rollStatQuality(second, 25));
        }
    }

    SUBCASE("TC-02 reseeding rewinds the stream exactly") {
        DeterministicRandom rng(kSeed);
        int firstPass[64] = {};
        for (int draw = 0; draw < 64; ++draw) firstPass[draw] = rollQuality(rng, 20);

        rng.reseed(kSeed);
        CHECK(rng.currentSeed() == kSeed);
        for (int draw = 0; draw < 64; ++draw) CHECK(rollQuality(rng, 20) == firstPass[draw]);
    }

    SUBCASE("TC-03 a different seed yields a different sequence") {
        // Not a distribution claim — just proof the seed is actually consumed.
        // Two 64-draw sequences agreeing entirely by chance across a 100-wide
        // range would be a 100^-64 coincidence.
        DeterministicRandom original(kSeed);
        DeterministicRandom altered(kSeed + 1u);
        bool hasAnyDifference = false;
        for (int draw = 0; draw < 64; ++draw) {
            if (rollQuality(original, 1) != rollQuality(altered, 1)) hasAnyDifference = true;
        }
        CHECK(hasAnyDifference);
    }
}
