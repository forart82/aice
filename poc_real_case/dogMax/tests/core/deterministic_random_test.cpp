// CHARACTERISATION suite for the reproducible RNG (dof::helpers::DeterministicRandom).
//
// HONESTY NOTE on TDD status: DeterministicRandom already existed before the
// protocol was adopted, so these tests are CHARACTERISATION, not
// Red-Green-Refactor. They were written after the implementation and pass on
// first run — the correct treatment for legacy code, pinning current behaviour
// so the determinism contract is enforceable. Rule 1 binds NEW work from the
// adoption date onward; calling these TDD would misrepresent them.
//
// This is the load-bearing primitive of the whole verification workflow. Rule 5
// requires deterministic, isolated tests, and every seeded gameplay test in this
// suite is only meaningful because a seed reproduces a run exactly. If the
// reproducibility case below ever fails, no other seeded test's green means
// anything.
//
// Oracle reference: ORACLE.md §3.1 — Determinism (binding), including the
// binding rule that `bernoulli(p)` ALWAYS draws, even at p <= 0 and p >= 1.
//
// Note on assertions: no expected raw output value is hard-coded anywhere here.
// The properties that matter are relational — same seed reproduces itself, one
// call consumes one draw, results land inside their bounds — and pinning a
// literal like `next32() == 0x1234ABCD` would pin the algorithm's identity
// rather than its contract, and would have to be regenerated rather than
// reasoned about if the engine were ever deliberately replaced.

#include "doctest.h"

#include "helpers/DeterministicRandom.hpp"

#include <array>
#include <cstdint>
#include <stdexcept>
#include <vector>

using dof::helpers::DeterministicRandom;

namespace {

constexpr std::uint64_t kReferenceSeed = 0xD06E1A5FULL;
constexpr int           kSequenceLength = 32;
constexpr int           kSampleCount    = 2000;
constexpr float         kTwoPi          = 6.28318530717958647692f;

std::vector<std::uint32_t> drawSequence(DeterministicRandom& random, int count) {
    std::vector<std::uint32_t> drawn;
    drawn.reserve(static_cast<std::size_t>(count));
    for (int i = 0; i < count; ++i) drawn.push_back(random.next32());
    return drawn;
}

bool areAllElementsEqual(const std::vector<std::uint32_t>& values) {
    for (std::size_t i = 1; i < values.size(); ++i) {
        if (values[i] != values[0]) return false;
    }
    return true;
}

}  // namespace

TEST_CASE("DeterministicRandom: the same seed reproduces the same sequence") {
    SUBCASE("TC-01 two generators on one seed agree draw for draw") {
        DeterministicRandom first(kReferenceSeed);
        DeterministicRandom second(kReferenceSeed);

        const auto firstSequence  = drawSequence(first, kSequenceLength);
        const auto secondSequence = drawSequence(second, kSequenceLength);

        // THE property the verification workflow rests on. `--seed N` must
        // replay a run exactly; the standard library's distributions were
        // dropped precisely because they did not guarantee this across
        // platforms.
        CHECK(firstSequence == secondSequence);
    }

    SUBCASE("TC-02 different seeds diverge") {
        DeterministicRandom oneSeed(1);
        DeterministicRandom otherSeed(2);

        const auto oneSequence   = drawSequence(oneSeed, 8);
        const auto otherSequence = drawSequence(otherSeed, 8);

        // Reproducibility would be trivially satisfied by a constant stream, so
        // the seed must actually select the stream.
        CHECK(oneSequence != otherSequence);
    }

    SUBCASE("TC-03 reseed rewinds an already-advanced generator") {
        DeterministicRandom random(kReferenceSeed);
        const auto beforeReseed = drawSequence(random, kSequenceLength);

        random.reseed(kReferenceSeed);
        const auto afterReseed = drawSequence(random, kSequenceLength);

        CHECK(beforeReseed == afterReseed);
    }

    SUBCASE("TC-04 currentSeed reports the seed it was given, unchanged by draws") {
        DeterministicRandom random(kReferenceSeed);
        CHECK(random.currentSeed() == kReferenceSeed);

        drawSequence(random, 16);
        // The recorded seed is the run's identity for a bug report; advancing
        // the state must not rewrite it.
        CHECK(random.currentSeed() == kReferenceSeed);

        random.reseed(99);
        CHECK(random.currentSeed() == 99u);
    }
}

TEST_CASE("DeterministicRandom: a zero seed still produces a usable stream") {
    SUBCASE("TC-05 seed 0 is reproducible and not degenerate") {
        DeterministicRandom first(0);
        DeterministicRandom second(0);

        const auto firstSequence  = drawSequence(first, kSequenceLength);
        const auto secondSequence = drawSequence(second, kSequenceLength);

        CHECK(firstSequence == secondSequence);
        // 0 is the default a caller gets from an unset config key, so it must
        // not collapse the state to all-zero (which xoshiro cannot escape).
        // SplitMix64 scrambles it away from zero before the state is filled.
        CHECK_FALSE(areAllElementsEqual(firstSequence));
        CHECK(first.currentSeed() == 0u);
    }
}

TEST_CASE("DeterministicRandom: bernoulli ALWAYS consumes exactly one draw") {
    // Verified by STREAM POSITION rather than by return value, because the
    // return value is the part that was already correct. The bug was that
    // early-returning at p <= 0 and p >= 1 consumed zero draws while every
    // other probability consumed one — so toggling a config chance between 0.0
    // and 0.001 shifted every subsequent draw in the run and broke --seed
    // reproducibility for reasons entirely unrelated to the change.
    const std::array<float, 6> probabilities{-1.0f, 0.0f, 0.25f, 0.5f, 1.0f, 2.0f};

    SUBCASE("TC-06 after any probability the stream sits one draw along") {
        for (const float probability : probabilities) {
            DeterministicRandom viaBernoulli(kReferenceSeed);
            viaBernoulli.bernoulli(probability);
            const std::uint32_t afterBernoulli = viaBernoulli.next32();

            DeterministicRandom viaSingleDraw(kReferenceSeed);
            viaSingleDraw.next32();  // stand in for the one draw bernoulli owes
            const std::uint32_t afterSingleDraw = viaSingleDraw.next32();

            CHECK(afterBernoulli == afterSingleDraw);
        }
    }

    SUBCASE("TC-07 the boundaries cost the same as the middle") {
        DeterministicRandom neverTrue(kReferenceSeed);
        DeterministicRandom alwaysTrue(kReferenceSeed);
        DeterministicRandom sometimesTrue(kReferenceSeed);

        CHECK_FALSE(neverTrue.bernoulli(0.0f));
        CHECK(alwaysTrue.bernoulli(1.0f));
        sometimesTrue.bernoulli(0.5f);

        const std::uint32_t afterNever     = neverTrue.next32();
        const std::uint32_t afterAlways    = alwaysTrue.next32();
        const std::uint32_t afterSometimes = sometimesTrue.next32();

        // Two known-different answers and one unpredictable one, all leaving
        // the stream at the same position. This is the regression guard: an
        // `if (p <= 0) return false;` placed before the draw makes these
        // three diverge.
        CHECK(afterNever == afterAlways);
        CHECK(afterNever == afterSometimes);
    }

    SUBCASE("TC-08 a run of bernoulli calls costs one draw each") {
        DeterministicRandom viaBernoulli(kReferenceSeed);
        DeterministicRandom viaRawDraws(kReferenceSeed);

        for (int i = 0; i < 10; ++i) {
            viaBernoulli.bernoulli(0.0f);
            viaRawDraws.next32();
        }

        CHECK(viaBernoulli.next32() == viaRawDraws.next32());
    }
}

TEST_CASE("DeterministicRandom: bernoulli's boundary answers are roll-independent") {
    DeterministicRandom random(kReferenceSeed);

    SUBCASE("TC-09 p <= 0 is always false and p >= 1 is always true") {
        // Only the boundaries are asserted on return value. At p = 0.5 the
        // answer depends on the draw and predicting it here would pin the
        // engine's output rather than the contract — TC-06 covers that case on
        // the property that actually matters.
        for (int i = 0; i < 100; ++i) {
            CHECK_FALSE(random.bernoulli(0.0f));
            CHECK_FALSE(random.bernoulli(-0.5f));
            CHECK(random.bernoulli(1.0f));
            CHECK(random.bernoulli(2.0f));
        }
    }
}

TEST_CASE("DeterministicRandom: uniformInt respects its inclusive bounds") {
    DeterministicRandom random(kReferenceSeed);

    SUBCASE("TC-10 every draw lands inside [lo, hi] and both ends are reachable") {
        bool hasSeenLow  = false;
        bool hasSeenHigh = false;

        for (int i = 0; i < kSampleCount; ++i) {
            const int value = random.uniformInt(-3, 7);
            REQUIRE(value >= -3);
            REQUIRE(value <= 7);
            if (value == -3) hasSeenLow = true;
            if (value == 7) hasSeenHigh = true;
        }

        // Inclusive at BOTH ends — an off-by-one here silently makes the top
        // die face or the last loot entry unreachable.
        CHECK(hasSeenLow);
        CHECK(hasSeenHigh);
    }

    SUBCASE("TC-11 a degenerate range returns its single value") {
        for (int i = 0; i < 16; ++i) {
            CHECK(random.uniformInt(5, 5) == 5);
        }
    }

    SUBCASE("TC-12 a degenerate range still consumes exactly one draw") {
        DeterministicRandom viaUniformInt(kReferenceSeed);
        DeterministicRandom viaRawDraw(kReferenceSeed);

        viaUniformInt.uniformInt(5, 5);
        viaRawDraw.next32();

        // Same reasoning as bernoulli: a shortcut that skipped the draw for a
        // one-wide range would desynchronise the stream.
        CHECK(viaUniformInt.next32() == viaRawDraw.next32());
    }

    SUBCASE("TC-13 an inverted range is a caller bug and throws") {
        // Crash-early: silently swapping the bounds would hide the real defect
        // at the call site.
        CHECK_THROWS_AS(random.uniformInt(5, 4), std::invalid_argument);
    }
}

TEST_CASE("DeterministicRandom: uniformFloat stays inside its range") {
    DeterministicRandom random(kReferenceSeed);

    SUBCASE("TC-14 every draw lands within [lo, hi]") {
        for (int i = 0; i < kSampleCount; ++i) {
            const float value = random.uniformFloat(-2.0f, 3.0f);
            REQUIRE(value >= -2.0f);
            REQUIRE(value <= 3.0f);
        }
    }

    SUBCASE("TC-15 the unit range is half-open — 1.0 is never returned") {
        // The 24-bit mantissa scale is 1/16777216, so the largest possible
        // result is 16777215/16777216. Callers index tables with the result, so
        // an inclusive 1.0 would run one past the end.
        for (int i = 0; i < kSampleCount; ++i) {
            const float value = random.uniformFloat(0.0f, 1.0f);
            REQUIRE(value >= 0.0f);
            REQUIRE(value < 1.0f);
        }
    }

    SUBCASE("TC-16 a degenerate range returns the endpoint") {
        for (int i = 0; i < 16; ++i) {
            CHECK(random.uniformFloat(2.5f, 2.5f) == doctest::Approx(2.5f));
        }
    }

    SUBCASE("TC-17 an inverted range throws") {
        CHECK_THROWS_AS(random.uniformFloat(1.0f, 0.0f), std::invalid_argument);
    }
}

TEST_CASE("DeterministicRandom: angleRadians covers one full turn") {
    DeterministicRandom random(kReferenceSeed);

    SUBCASE("TC-18 every angle lands in [0, 2pi)") {
        for (int i = 0; i < kSampleCount; ++i) {
            const float angle = random.angleRadians();
            REQUIRE(angle >= 0.0f);
            // Half-open so 0 and 2pi are not both emitted for the same
            // direction, which would bias scatter patterns at one bearing.
            REQUIRE(angle < kTwoPi);
        }
    }

    SUBCASE("TC-19 angleRadians is one draw, so it replays with the seed") {
        DeterministicRandom first(kReferenceSeed);
        DeterministicRandom second(kReferenceSeed);

        for (int i = 0; i < 16; ++i) {
            const float fromFirst  = first.angleRadians();
            const float fromSecond = second.angleRadians();
            // Bit-identical, not merely close: reproducibility is exact or it
            // is not reproducibility.
            CHECK(fromFirst == fromSecond);
        }
    }
}
