// CHARACTERISATION suite for the rolling-window kill-streak XP multiplier.
//
// HONESTY NOTE on TDD status: `src/combat/KillStreak.{hpp,cpp}` (card-mpl0eo9k)
// predates the TDD protocol. These tests are CHARACTERISATION: written after
// the implementation, by reading it, to pin current behaviour. There was no RED
// phase and no failing test drove this code into existence — saying otherwise
// would be a lie about how it came to exist. Rule 1 binds NEW work from the
// protocol adoption date onward.
//
// Oracle reference: NONE YET. ORACLE.md §4's formula table has no kill-streak
// row, and §7 already logs "Oracle formula/entity tables incomplete" as a known
// Rule 8 gap. Until a `FORMULA_KILL_STREAK` row lands, the header comment on
// KillStreak.hpp and this file are the whole written spec.
//
// Rule 6: KillStreak.hpp names no SFML type and the function is pure — no
// window, no GL context, no global state, no clock. Rule 5 is satisfied for
// free: `simTime` is a caller-supplied fixed-timestep value, so nothing here
// can read a wall clock.
//
// The reference implementation, for reading alongside the assertions:
//   if (lastKillSimTime < 0 || windowSeconds <= 0)  -> {1, 1.0}
//   dt = simTime - lastKillSimTime
//   if (dt > windowSeconds)                         -> {1, 1.0}
//   boosted = currentStreak + 1
//   raw     = 1 + (boosted - 1) * bonusPerKill
//   result  = {boosted, clamp(raw, 1.0, max(1.0, maxMultiplier))}

#include "doctest.h"

#include "combat/KillStreak.hpp"

using dof::combat::computeKillStreakMultiplier;

namespace {
// Representative tuning, passed explicitly rather than read from a config so a
// balance edit cannot silently change what these tests assert.
constexpr float kWindowSeconds = 2.0f;
constexpr float kBonusPerKill  = 0.10f;
constexpr float kMaxMultiplier = 3.0f;
}  // namespace

TEST_CASE("computeKillStreakMultiplier grows the multiplier inside the window") {
    SUBCASE("TC-01 happy path: a kill inside the window extends the streak") {
        const auto out = computeKillStreakMultiplier(
            /*simTime*/ 10.0, /*lastKillSimTime*/ 9.5, /*currentStreak*/ 3,
            kWindowSeconds, kBonusPerKill, kMaxMultiplier);
        CHECK(out.newStreak == 4);
        // 1 + (4 - 1) * 0.10
        CHECK(out.multiplier == doctest::Approx(1.30f));
    }

    SUBCASE("TC-02 the bonus is linear in the streak, not compounding") {
        const auto second = computeKillStreakMultiplier(1.0, 0.5, 1, kWindowSeconds,
                                                        kBonusPerKill, kMaxMultiplier);
        const auto sixth  = computeKillStreakMultiplier(1.0, 0.5, 5, kWindowSeconds,
                                                        kBonusPerKill, kMaxMultiplier);
        CHECK(second.newStreak == 2);
        CHECK(second.multiplier == doctest::Approx(1.10f));
        CHECK(sixth.newStreak == 6);
        CHECK(sixth.multiplier == doctest::Approx(1.50f));
    }

    SUBCASE("TC-03 the multiplier saturates at maxMultiplier and stops there") {
        // raw would be 1 + 49 * 0.10 = 5.9, well past the 3.0 cap.
        const auto out = computeKillStreakMultiplier(1.0, 0.5, 49, kWindowSeconds,
                                                     kBonusPerKill, kMaxMultiplier);
        CHECK(out.newStreak == 50);          // the COUNT keeps climbing past the cap
        CHECK(out.multiplier == doctest::Approx(kMaxMultiplier));
    }
}

TEST_CASE("computeKillStreakMultiplier resets the streak outside the window") {
    SUBCASE("TC-01 a kill after the window lapses restarts at 1") {
        const auto out = computeKillStreakMultiplier(20.0, 10.0, 7, kWindowSeconds,
                                                     kBonusPerKill, kMaxMultiplier);
        CHECK(out.newStreak == 1);
        CHECK(out.multiplier == 1.0f);
    }

    SUBCASE("TC-BOUNDARY-01 dt EXACTLY equal to the window is still inside it") {
        // The gate is `dt > windowSeconds`, not `>=`, so the last possible
        // instant still counts. Pinned because flipping the comparison would be
        // an easy, invisible one-character regression.
        const auto onEdge = computeKillStreakMultiplier(12.0, 10.0, 4, kWindowSeconds,
                                                        kBonusPerKill, kMaxMultiplier);
        CHECK(onEdge.newStreak == 5);
        CHECK(onEdge.multiplier == doctest::Approx(1.40f));

        const auto justPast = computeKillStreakMultiplier(12.001, 10.0, 4, kWindowSeconds,
                                                          kBonusPerKill, kMaxMultiplier);
        CHECK(justPast.newStreak == 1);
        CHECK(justPast.multiplier == 1.0f);
    }
}

TEST_CASE("computeKillStreakMultiplier treats a negative lastKillSimTime as 'no prior kill'") {
    SUBCASE("TC-01 the sentinel restarts the streak") {
        const auto out = computeKillStreakMultiplier(5.0, -1.0, 9, kWindowSeconds,
                                                     kBonusPerKill, kMaxMultiplier);
        CHECK(out.newStreak == 1);
        CHECK(out.multiplier == 1.0f);
    }

    SUBCASE("TC-BOUNDARY-01 sim time ZERO is a real kill, not the sentinel") {
        // The gate is `lastKillSimTime < 0.0`. A kill logged at sim time 0.0 is
        // therefore an ordinary prior kill and DOES extend the streak. Only a
        // strictly negative value means "none yet".
        const auto out = computeKillStreakMultiplier(0.5, 0.0, 2, kWindowSeconds,
                                                     kBonusPerKill, kMaxMultiplier);
        CHECK(out.newStreak == 3);
        CHECK(out.multiplier == doctest::Approx(1.20f));
    }

    SUBCASE("TC-BOUNDARY-02 negative zero is not negative, so it also counts") {
        // IEEE-754: -0.0 < 0.0 is false. Pinned so nobody 'fixes' the sentinel
        // check into something that treats a signed zero as "no prior kill".
        const auto out = computeKillStreakMultiplier(0.5, -0.0, 2, kWindowSeconds,
                                                     kBonusPerKill, kMaxMultiplier);
        CHECK(out.newStreak == 3);
        CHECK(out.multiplier == doctest::Approx(1.20f));
    }
}

TEST_CASE("computeKillStreakMultiplier never turns the XP bonus into a penalty") {
    SUBCASE("TC-EDGE-01 a non-positive window disables streaks entirely") {
        const auto zeroWindow = computeKillStreakMultiplier(10.0, 9.9, 5, 0.0f,
                                                            kBonusPerKill, kMaxMultiplier);
        CHECK(zeroWindow.newStreak == 1);
        CHECK(zeroWindow.multiplier == 1.0f);

        const auto negativeWindow = computeKillStreakMultiplier(10.0, 9.9, 5, -4.0f,
                                                                kBonusPerKill, kMaxMultiplier);
        CHECK(negativeWindow.newStreak == 1);
        CHECK(negativeWindow.multiplier == 1.0f);
    }

    SUBCASE("TC-EDGE-02 a maxMultiplier below 1.0 is lifted to 1.0") {
        // ceilMult = std::max(1.0f, maxMultiplier), so a mis-tuned cap of 0.5
        // cannot make a kill streak REDUCE the XP a kill awards.
        const auto out = computeKillStreakMultiplier(1.0, 0.5, 10, kWindowSeconds,
                                                     kBonusPerKill, /*maxMultiplier*/ 0.5f);
        CHECK(out.newStreak == 11);
        CHECK(out.multiplier == doctest::Approx(1.0f));
    }

    SUBCASE("TC-EDGE-03 a negative bonus per kill is clamped away at the 1.0 floor") {
        const auto out = computeKillStreakMultiplier(1.0, 0.5, 5, kWindowSeconds,
                                                     /*bonusPerKill*/ -0.5f, kMaxMultiplier);
        CHECK(out.newStreak == 6);
        CHECK(out.multiplier == doctest::Approx(1.0f));
    }

    SUBCASE("TC-EDGE-04 a zero bonus keeps the multiplier flat while the streak counts") {
        const auto out = computeKillStreakMultiplier(1.0, 0.5, 20, kWindowSeconds,
                                                     /*bonusPerKill*/ 0.0f, kMaxMultiplier);
        CHECK(out.newStreak == 21);
        CHECK(out.multiplier == doctest::Approx(1.0f));
    }

    SUBCASE("TC-EDGE-05 a zero current streak yields the first kill of a chain") {
        const auto out = computeKillStreakMultiplier(1.0, 0.5, 0, kWindowSeconds,
                                                     kBonusPerKill, kMaxMultiplier);
        CHECK(out.newStreak == 1);
        CHECK(out.multiplier == doctest::Approx(1.0f));
    }
}

TEST_CASE("computeKillStreakMultiplier passes malformed caller state straight through") {
    // Two quirks that are NOT defended against. Pinned as characterisation, not
    // endorsed: if either is ever considered a bug, these are the tests to flip.
    SUBCASE("TC-EDGE-01 a negative currentStreak survives into newStreak") {
        // The multiplier is still safe (the 1.0 floor catches the negative raw
        // value), but the returned COUNT is garbage that the caller will store
        // back and keep incrementing from.
        const auto out = computeKillStreakMultiplier(1.0, 0.5, -5, kWindowSeconds,
                                                     kBonusPerKill, kMaxMultiplier);
        CHECK(out.newStreak == -4);
        CHECK(out.multiplier == doctest::Approx(1.0f));
    }

    SUBCASE("TC-EDGE-02 a backwards sim time counts as inside the window") {
        // dt is negative, and the only rejection is `dt > windowSeconds`, so a
        // rewound clock reads as an instantaneous kill and EXTENDS the streak.
        // Harmless under the fixed timestep (sim time is monotonic there); it
        // would matter the moment anything replays or rewinds simulation time.
        const auto out = computeKillStreakMultiplier(5.0, 500.0, 3, kWindowSeconds,
                                                     kBonusPerKill, kMaxMultiplier);
        CHECK(out.newStreak == 4);
        CHECK(out.multiplier == doctest::Approx(1.30f));
    }
}
