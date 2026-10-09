// Characterisation suite for the Oracle's damage and luck formulas.
//
// HONESTY NOTE on TDD status: this code already existed before the protocol was
// adopted, so these tests are CHARACTERISATION, not Red-Green-Refactor. They
// were written after the implementation and pass on first run. That is the
// correct treatment for legacy code — pinning current behaviour so the Oracle's
// formula table is enforceable and future changes cannot drift silently.
//
// Rule 1 (no production code without a failing test first) binds NEW work from
// the adoption date onward. Presenting these as TDD would be a lie about how
// they came to exist.
//
// Oracle reference: ORACLE.md §4 — FORMULA_DAMAGE, FORMULA_CRIT_APPLIED,
// FORMULA_CRIT_CHANCE, FORMULA_QUALITY_FLOOR, FORMULA_MIN_FACE.

#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "doctest.h"

#include "combat/CritClamp.hpp"
#include "combat/DamageFormula.hpp"
#include "combat/LuckCalculator.hpp"

#include <array>
#include <span>

using namespace dof::combat;

namespace {
// The shipped values from configs/combat.yaml. Passed explicitly rather than
// read from a ConfigLoader so a balance edit cannot silently change what these
// tests assert — a test that follows the config would always pass and prove
// nothing about the FORMULA.
constexpr float kDiceProductFloor = 0.1f;
constexpr float kDamageFloor      = 1.0f;
}  // namespace

TEST_CASE("FORMULA_DAMAGE multiplies base by dice sum, product, dron and crit") {
    SUBCASE("TC-01 happy path: every term contributes") {
        const std::array<int, 2>   faces{3, 5};
        const std::array<float, 2> mults{2.0f, 1.5f};

        const auto result = computeDamage(
            /*baseDamage*/ 10.0f, std::span<const int>(faces),
            std::span<const float>(mults), /*dron*/ 2.0f,
            /*critMultiplier*/ 1.0f, /*isCritical*/ false,
            kDiceProductFloor, kDamageFloor);

        // 10 * (3+5) * (2.0*1.5) * 2.0 = 480
        CHECK(result.damage == doctest::Approx(480.0f));
        CHECK(result.sumFaces == 8);
        CHECK(result.productMultipliers == doctest::Approx(3.0f));
        CHECK_FALSE(result.isCritical);
    }

    SUBCASE("TC-02 crit multiplies only when the multiplier exceeds 1.0") {
        const std::array<int, 1>   faces{1};
        const std::array<float, 1> mults{1.0f};

        const auto crit = computeDamage(10.0f, std::span<const int>(faces),
                                        std::span<const float>(mults), 1.0f,
                                        /*critMultiplier*/ 3.0f, true,
                                        kDiceProductFloor, kDamageFloor);
        CHECK(crit.damage == doctest::Approx(30.0f));
        CHECK(crit.isCritical);
    }

    SUBCASE("TC-EDGE-01 a weapon sitting on the crit floor reports NO crit") {
        // Regression guard. An unconditional flag used to paint a "!" crit
        // marker on a hit that dealt exactly base damage, because a weapon at
        // the 1.0 crit floor "critted" for a 1x multiplier.
        const std::array<int, 1>   faces{1};
        const std::array<float, 1> mults{1.0f};

        const auto result = computeDamage(10.0f, std::span<const int>(faces),
                                          std::span<const float>(mults), 1.0f,
                                          /*critMultiplier*/ 1.0f,
                                          /*isCritical*/ true,
                                          kDiceProductFloor, kDamageFloor);
        CHECK(result.damage == doctest::Approx(10.0f));
        CHECK_FALSE(result.isCritical);
    }

    SUBCASE("TC-EDGE-02 empty dice clamp the sum to 1, never to 0") {
        // Without the clamp an unslotted weapon would deal zero damage forever,
        // which reads as a broken weapon rather than an unmodded one.
        const std::array<int, 0>   faces{};
        const std::array<float, 0> mults{};

        const auto result = computeDamage(7.0f, std::span<const int>(faces),
                                          std::span<const float>(mults), 1.0f,
                                          1.0f, false,
                                          kDiceProductFloor, kDamageFloor);
        CHECK(result.damage == doctest::Approx(7.0f));
        CHECK(result.sumFaces == 0);
    }

    SUBCASE("TC-EDGE-03 dron below 1.0 is clamped up, never reducing damage") {
        const std::array<int, 1>   faces{2};
        const std::array<float, 1> mults{1.0f};

        const auto result = computeDamage(10.0f, std::span<const int>(faces),
                                          std::span<const float>(mults),
                                          /*dron*/ 0.25f, 1.0f, false,
                                          kDiceProductFloor, kDamageFloor);
        CHECK(result.damage == doctest::Approx(20.0f));
    }

    SUBCASE("TC-EDGE-04 the damage floor holds against a tiny product") {
        const std::array<int, 1>   faces{1};
        const std::array<float, 1> mults{0.0f};

        const auto result = computeDamage(0.001f, std::span<const int>(faces),
                                          std::span<const float>(mults), 1.0f,
                                          1.0f, false,
                                          kDiceProductFloor, kDamageFloor);
        CHECK(result.damage >= kDamageFloor);
    }
}

TEST_CASE("FORMULA_CRIT_CHANCE clamps to the cap and never goes negative") {
    CHECK(clampEffectiveCritChance(0.2f, 0.1f, 0.75f) == doctest::Approx(0.30f));
    CHECK(clampEffectiveCritChance(0.6f, 0.5f, 0.75f) == doctest::Approx(0.75f));
    // A stray negative dice value must not sink the chance below zero.
    CHECK(clampEffectiveCritChance(0.1f, -0.5f, 0.75f) == doctest::Approx(0.0f));
}

TEST_CASE("FORMULA_QUALITY_FLOOR follows a square-root curve") {
    // The curve exists so the FIRST luck dice is very valuable while the late
    // stack saturates smoothly, instead of slamming into the clamp the moment a
    // second Rare luck dice is equipped.
    constexpr float kScale = 9.0f;

    CHECK(qualityFloor(0, kScale) == 0);
    CHECK(qualityFloor(1, kScale) == 9);     // sqrt(1)*9
    CHECK(qualityFloor(25, kScale) == 45);   // sqrt(25)*9
    CHECK(qualityFloor(100, kScale) == 90);  // sqrt(100)*9

    SUBCASE("TC-EDGE-01 the result is clamped at 99") {
        CHECK(qualityFloor(1'000'000, kScale) == 99);
    }
    SUBCASE("TC-EDGE-02 non-positive luck or scale yields zero") {
        CHECK(qualityFloor(-5, kScale) == 0);
        CHECK(qualityFloor(50, 0.0f) == 0);
    }
    SUBCASE("TC-EDGE-03 the curve is monotonic non-decreasing") {
        int previous = 0;
        for (int luck = 0; luck <= 400; ++luck) {
            const int current = qualityFloor(luck, kScale);
            CHECK(current >= previous);
            previous = current;
        }
    }
}

TEST_CASE("FORMULA_MIN_FACE never drops below face 1") {
    constexpr float kScale = 0.05f;
    CHECK(effectiveMinFace(0, kScale) == 1);
    CHECK(effectiveMinFace(100, kScale) == 5);
    // Below the point where the product reaches 1, the floor still guarantees 1.
    CHECK(effectiveMinFace(5, kScale) == 1);
    CHECK(effectiveMinFace(-10, kScale) == 1);
}

TEST_CASE("sumLuck totals the per-dice contributions") {
    const std::array<int, 3> luck{4, 0, 7};
    CHECK(sumLuck(std::span<const int>(luck)) == 11);

    const std::array<int, 0> none{};
    CHECK(sumLuck(std::span<const int>(none)) == 0);
}
