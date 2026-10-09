// CHARACTERISATION suite for the SE1 piecewise enemy level curve.
//
// HONESTY NOTE on TDD status: `src/combat/EnemyLevelCurve.{hpp,cpp}` already
// existed before the TDD protocol was adopted, so these tests are
// CHARACTERISATION, not Red-Green-Refactor. They were written AFTER the
// implementation, by reading it, and they pin what the code actually does —
// including one behaviour that is arguably a wart (see the band-discontinuity
// case below). No RED phase happened and claiming one would be a lie.
//
// Rule 1 (no production code without a failing test first) binds NEW work from
// the adoption date onward. Legacy code gets characterised instead, so the
// behaviour becomes enforceable and future changes cannot drift silently.
//
// Oracle reference: NONE YET. ORACLE.md §4's formula table has no row for the
// enemy level curve; §7 already logs "Oracle formula/entity tables incomplete"
// as a known Rule 8 gap. `docs/tdd/enemy_level_curve.tdd.md` proposes the rows
// the Oracle should gain. Until those land, THIS FILE plus the config comment
// in `configs/enemy_levels.yaml` are the only written spec for the curve.
//
// Rule 6: EnemyLevelCurve.hpp names no SFML type, so the curve runs with no
// window and no GL context. (The test binary still links dogcore, and dogcore
// links SFML — deliberately, per the CMake comment, so domain code is tested
// as shipped. "Headless" here means no window/context is created, not that
// SFML is absent from the link line.)
//
// Rule 5: every config below is built in memory with `setRaw`. Nothing reads
// disk, so the suite has no working-directory dependence and no ordering
// coupling with any other test.

#include "doctest.h"

#include "combat/EnemyLevelCurve.hpp"
#include "loaders/ConfigLoader.hpp"

using dof::combat::EnemyLevelCurve;
using dof::loaders::ConfigLoader;

namespace {

// Built with setRaw only — never loadDirectory. A disk load would make these
// tests depend on the working directory AND on live balance values, so a
// retune would silently change what they assert.
ConfigLoader makeLevelCurveConfig(const char* linearStep, const char* linearEnd,
                                  const char* exp1Factor, const char* exp1End,
                                  const char* exp2Factor, const char* maxLevel) {
    ConfigLoader config;
    config.setRaw("ENEMY_LEVEL_LINEAR_STEP", linearStep);
    config.setRaw("ENEMY_LEVEL_LINEAR_END",  linearEnd);
    config.setRaw("ENEMY_LEVEL_EXP1_FACTOR", exp1Factor);
    config.setRaw("ENEMY_LEVEL_EXP1_END",    exp1End);
    config.setRaw("ENEMY_LEVEL_EXP2_FACTOR", exp2Factor);
    config.setRaw("ENEMY_LEVEL_MAX",         maxLevel);
    return config;
}

// A deliberately tiny curve whose every cumulative value is exactly
// representable in float32, so the table can be asserted with `==` instead of
// a tolerance. Bands: L2..L4 linear at 100; L5..L6 exp1 (factor 2); L7..L8
// exp2 (factor 3).
//
// `==` is legitimate here even though the exponential bands call std::pow,
// because every call has an INTEGRAL base and an INTEGRAL exponent whose exact
// result is a small power of two or three — powf(2,1), powf(2,2), powf(3,1),
// powf(3,2). Those are exactly representable and every real libm returns them
// exactly. The SHIPPED curve gets no such guarantee (powf(1.08f, 30.0f) is a
// genuine approximation), which is why the shipped test below uses Approx and
// coarse bands instead.
//
//   cum = [_, 0, 100, 200, 300, 500, 900, 2100, 5700]
//
// Derivation, straight from EnemyLevelCurve.cpp:
//   L5 step = 100 * 2^(5-4) = 200      L6 step = 100 * 2^(6-4) = 400
//   stepAtExp1End = 100 * 2^(6-4) = 400
//   L7 step = 400 * 3^(7-6) = 1200     L8 step = 400 * 3^(8-6) = 3600
ConfigLoader makeExactSyntheticConfig() {
    return makeLevelCurveConfig("100", "4", "2.0", "6", "3.0", "8");
}

// The values shipped in configs/enemy_levels.yaml, hard-coded rather than read
// from that file on purpose: a test that follows the config would always pass
// and prove nothing about the CURVE. This suite is therefore MEANT to fail if
// someone deliberately retunes the five keys — the yaml comment openly invites
// retuning, so the failure is the signal to update the assertions here and in
// the Oracle, not a flake to delete.
ConfigLoader makeShippedConfig() {
    return makeLevelCurveConfig("30000", "10", "1.08", "40", "1.01", "99");
}

}  // namespace

TEST_CASE("EnemyLevelCurve builds the exact cumulative table for a synthetic curve") {
    const EnemyLevelCurve curve(makeExactSyntheticConfig());

    SUBCASE("TC-01 happy path: every band contributes its own step shape") {
        CHECK(curve.maxLevel() == 8);
        CHECK(curve.cumulativeForLevel(1) == 0.0f);
        // Linear band — three equal steps of 100.
        CHECK(curve.cumulativeForLevel(2) == 100.0f);
        CHECK(curve.cumulativeForLevel(3) == 200.0f);
        CHECK(curve.cumulativeForLevel(4) == 300.0f);
        // First exponential band — steps 200, 400.
        CHECK(curve.cumulativeForLevel(5) == 500.0f);
        CHECK(curve.cumulativeForLevel(6) == 900.0f);
        // Second exponential band — steps 1200, 3600.
        CHECK(curve.cumulativeForLevel(7) == 2100.0f);
        CHECK(curve.cumulativeForLevel(8) == 5700.0f);
    }

    SUBCASE("TC-02 levelFromDistance picks the band the distance falls in") {
        CHECK(curve.levelFromDistance(150.0f) == 2);
        CHECK(curve.levelFromDistance(350.0f) == 4);
        CHECK(curve.levelFromDistance(600.0f) == 5);
        CHECK(curve.levelFromDistance(2500.0f) == 7);
    }

    SUBCASE("TC-03 boundary: a distance exactly ON a threshold awards that level") {
        // levelFromDistance uses `distance >= cumulative[level]`, so landing
        // exactly on the threshold promotes rather than staying below.
        CHECK(curve.levelFromDistance(100.0f) == 2);
        CHECK(curve.levelFromDistance(900.0f) == 6);
        CHECK(curve.levelFromDistance(5700.0f) == 8);
    }

    SUBCASE("TC-EDGE-01 the step JUMPS at each band boundary, it does not blend") {
        // Characterisation of a real wart, not an endorsement. The exp1 band's
        // first step is linearStep * factor^1, NOT factor^0, so the step size
        // discontinuously jumps the instant the band changes: 100 -> 200 at
        // L5, and 400 -> 1200 at L7. A continuous stitch would have used
        // factor^0 for the first level of each band. Pinned so the jump cannot
        // vanish or double by accident.
        const float lastLinearStep = curve.cumulativeForLevel(4) - curve.cumulativeForLevel(3);
        const float firstExp1Step  = curve.cumulativeForLevel(5) - curve.cumulativeForLevel(4);
        CHECK(lastLinearStep == 100.0f);
        CHECK(firstExp1Step == 200.0f);

        const float lastExp1Step  = curve.cumulativeForLevel(6) - curve.cumulativeForLevel(5);
        const float firstExp2Step = curve.cumulativeForLevel(7) - curve.cumulativeForLevel(6);
        CHECK(lastExp1Step == 400.0f);
        CHECK(firstExp2Step == 1200.0f);
    }
}

TEST_CASE("EnemyLevelCurve round-trips distance and level in both directions") {
    // The strongest single characterisation available: it needs no tolerance
    // (it compares a float against itself), it holds for any strictly
    // increasing table, and it pins the `>=` threshold semantics for free.
    SUBCASE("TC-01 synthetic curve round-trips at every level") {
        const EnemyLevelCurve curve(makeExactSyntheticConfig());
        for (int level = 1; level <= curve.maxLevel(); ++level) {
            CHECK(curve.levelFromDistance(curve.cumulativeForLevel(level)) == level);
        }
    }

    SUBCASE("TC-02 shipped curve round-trips at all 99 levels") {
        const EnemyLevelCurve curve(makeShippedConfig());
        for (int level = 1; level <= curve.maxLevel(); ++level) {
            CHECK(curve.levelFromDistance(curve.cumulativeForLevel(level)) == level);
        }
    }

    SUBCASE("TC-03 the table is strictly increasing, so levels never tie") {
        const EnemyLevelCurve curve(makeShippedConfig());
        float previous = curve.cumulativeForLevel(1);
        for (int level = 2; level <= curve.maxLevel(); ++level) {
            const float current = curve.cumulativeForLevel(level);
            CHECK(current > previous);
            previous = current;
        }
    }
}

TEST_CASE("EnemyLevelCurve clamps every out-of-range input instead of faulting") {
    const EnemyLevelCurve curve(makeExactSyntheticConfig());

    SUBCASE("TC-EDGE-01 zero and negative distance are level 1") {
        CHECK(curve.levelFromDistance(0.0f) == 1);
        CHECK(curve.levelFromDistance(-1.0f) == 1);
        CHECK(curve.levelFromDistance(-1.0e9f) == 1);
    }

    SUBCASE("TC-EDGE-02 a distance past the last threshold saturates at maxLevel") {
        CHECK(curve.levelFromDistance(5700.1f) == 8);
        CHECK(curve.levelFromDistance(1.0e9f) == curve.maxLevel());
    }

    SUBCASE("TC-EDGE-03 cumulativeForLevel clamps below 1 and above maxLevel") {
        CHECK(curve.cumulativeForLevel(0) == 0.0f);
        CHECK(curve.cumulativeForLevel(-7) == 0.0f);
        CHECK(curve.cumulativeForLevel(9) == curve.cumulativeForLevel(8));
        CHECK(curve.cumulativeForLevel(100000) == curve.cumulativeForLevel(8));
    }

    SUBCASE("TC-EDGE-04 a sub-1 ENEMY_LEVEL_MAX is lifted to a usable 1-level curve") {
        // The ctor clamps with std::max(1, …) precisely so a misconfigured 0 or
        // negative cannot underflow the size_t cast into a huge allocation, nor
        // make cumulative[1] an out-of-bounds write on a size-1 vector.
        const EnemyLevelCurve zeroMax(makeLevelCurveConfig("100", "4", "2.0", "6", "3.0", "0"));
        CHECK(zeroMax.maxLevel() == 1);
        CHECK(zeroMax.cumulativeForLevel(1) == 0.0f);
        CHECK(zeroMax.cumulativeForLevel(50) == 0.0f);
        CHECK(zeroMax.levelFromDistance(0.0f) == 1);
        CHECK(zeroMax.levelFromDistance(1.0e9f) == 1);

        const EnemyLevelCurve negativeMax(makeLevelCurveConfig("100", "4", "2.0", "6", "3.0", "-5"));
        CHECK(negativeMax.maxLevel() == 1);
        CHECK(negativeMax.levelFromDistance(1.0e9f) == 1);
    }

    SUBCASE("TC-EDGE-05 a zero step makes EVERY non-zero distance the max level") {
        // Degenerate tuning: with a zero linear step every band's step is also
        // zero, so the whole table is 0 and the ties resolve UPWARD because
        // levelFromDistance walks down from maxLevelValue and returns the first
        // hit. One step past the origin and the player faces level-8 enemies.
        // Documented here because it is a plausible mis-tune, not a design.
        const EnemyLevelCurve flat(makeLevelCurveConfig("0", "4", "2.0", "6", "3.0", "8"));
        CHECK(flat.levelFromDistance(0.0f) == 1);   // the <= 0 early-out still wins
        CHECK(flat.levelFromDistance(0.5f) == 8);
        CHECK(flat.levelFromDistance(1.0e9f) == 8);
    }

    SUBCASE("TC-EDGE-06 bands ordered backwards still build a usable curve") {
        // exp1End (5) BELOW linearEnd (10) makes the exp1 loop run zero times
        // and the exp2 loop overwrite levels the linear loop already filled.
        // The table stays strictly increasing regardless, because every band
        // accumulates onto cumulative[level - 1] rather than recomputing from
        // scratch. Pinned so the misconfiguration degrades instead of crashing.
        const EnemyLevelCurve tangled(makeLevelCurveConfig("100", "10", "2.0", "5", "2.0", "12"));
        CHECK(tangled.maxLevel() == 12);
        float previous = tangled.cumulativeForLevel(1);
        for (int level = 2; level <= tangled.maxLevel(); ++level) {
            const float current = tangled.cumulativeForLevel(level);
            CHECK(current > previous);
            previous = current;
        }
        for (int level = 1; level <= tangled.maxLevel(); ++level) {
            CHECK(tangled.levelFromDistance(tangled.cumulativeForLevel(level)) == level);
        }
    }
}

TEST_CASE("EnemyLevelCurve shipped tuning lands inside its documented 40-hour band") {
    // configs/enemy_levels.yaml claims cum[10] ~ 270 000, cum[40] ~ 3.94 M and
    // cum[99] ~ 28.3 M (a 28-30 M target, ~40 h of walking). These assertions
    // hold the code to the claim the config comment makes.
    const EnemyLevelCurve curve(makeShippedConfig());
    CHECK(curve.maxLevel() == 99);

    SUBCASE("TC-01 the linear band is exact: nine steps of 30 000") {
        // Every partial sum is a whole number below 2^24, so float32 holds it
        // exactly and `==` is legitimate here.
        CHECK(curve.cumulativeForLevel(2) == 30000.0f);
        CHECK(curve.cumulativeForLevel(10) == 270000.0f);
    }

    SUBCASE("TC-02 the exponential bands sit where the config comment says") {
        // Approx / band checks, not `==`: these values run through std::pow,
        // and a bit-exact powf result is a libm assumption rather than a
        // guarantee. The bands are wide enough to survive that and narrow
        // enough to catch a real curve change.
        CHECK(curve.cumulativeForLevel(11) == doctest::Approx(302400.0f).epsilon(0.001));
        CHECK(curve.cumulativeForLevel(40) > 3.9e6f);
        CHECK(curve.cumulativeForLevel(40) < 4.0e6f);
        CHECK(curve.cumulativeForLevel(99) > 28.0e6f);
        CHECK(curve.cumulativeForLevel(99) < 30.0e6f);
    }

    SUBCASE("TC-03 level 1 costs nothing, so a fresh run starts at level 1") {
        CHECK(curve.cumulativeForLevel(1) == 0.0f);
        CHECK(curve.levelFromDistance(0.0f) == 1);
        CHECK(curve.levelFromDistance(29999.0f) == 1);
        CHECK(curve.levelFromDistance(30000.0f) == 2);
    }
}
