// CHARACTERISATION suite for the movement primitive (dof::abilities::Moveable).
//
// HONESTY NOTE on TDD status: Moveable already existed before the protocol was
// adopted, so these tests are CHARACTERISATION, not Red-Green-Refactor. They
// were written after the implementation and pass on first run. That is the
// correct treatment for legacy code — pinning current behaviour so the easing
// contract is enforceable and future changes cannot drift silently. Rule 1
// binds NEW work from the adoption date onward; calling these TDD would be a
// lie about how they came to exist.
//
// Every assertion below stands on a real defect. The three easing properties in
// particular are the ones a well-meaning "simplification" would silently undo:
//   * a rate of 0 means INSTANT assignment — that is what keeps every enemy,
//     which configures no rates, moving exactly as it did before easing existed;
//   * the stop epsilon is gated on a ZERO TARGET, not on the current speed — an
//     unconditional snap also fires mid-reversal and makes turning stutter;
//   * `velocity` IS the smoothing state, so hard stops keep working unchanged.
//
// Oracle reference: ORACLE.md §3.3 — Hero movement easing (binding).
//
// Arithmetic note: every expected value here is dyadic (halves, eighths) so the
// float results are exact and the assertions can use `==` rather than Approx.
// A clamp-to-exact (the epsilon snap) is worth pinning exactly; an approximate
// check there would not distinguish "snapped" from "nearly stopped".

#include "doctest.h"

#include "abilities/Moveable.hpp"

#include <SFML/System/Vector2.hpp>

using dof::abilities::Moveable;

namespace {

// A hero-shaped Moveable: separate accelerate/decelerate rates and a stop
// cutoff, matching how configs/hero.yaml drives the only entity that eases.
Moveable makeEasedMoveable() {
    Moveable moveable;
    moveable.moveSpeed          = 100.0f;
    moveable.accelerationRate   = 1.0f;
    moveable.decelerationRate   = 0.25f;
    moveable.stopEpsilon        = 0.0f;
    return moveable;
}

constexpr sf::Vector2f kRight{1.0f, 0.0f};
constexpr sf::Vector2f kLeft{-1.0f, 0.0f};
constexpr sf::Vector2f kStill{0.0f, 0.0f};

}  // namespace

TEST_CASE("Moveable: the simulation-step snapshot feeds render interpolation") {
    Moveable moveable;
    moveable.teleportTo(sf::Vector2f{4.0f, 8.0f});
    moveable.position = sf::Vector2f{12.0f, 8.0f};

    SUBCASE("TC-01 beginSimulationStep copies the current position into previousPosition") {
        moveable.beginSimulationStep();

        CHECK(moveable.previousPosition.x == 12.0f);
        CHECK(moveable.previousPosition.y == 8.0f);
        // The live position is untouched — only the snapshot moves.
        CHECK(moveable.position.x == 12.0f);
    }
}

TEST_CASE("Moveable: teleportTo is a hard stop, not just a reposition") {
    Moveable moveable = makeEasedMoveable();
    moveable.setVelocityFromDirection(kRight);
    moveable.position         = sf::Vector2f{50.0f, 50.0f};
    moveable.previousPosition = sf::Vector2f{40.0f, 40.0f};

    REQUIRE(moveable.velocity.x == 100.0f);

    moveable.teleportTo(sf::Vector2f{-7.0f, 3.0f});

    SUBCASE("TC-02 both position fields land on the target") {
        // previousPosition must follow, or the very next interpolated frame
        // draws a smear across the whole teleport distance.
        CHECK(moveable.position.x == -7.0f);
        CHECK(moveable.position.y == 3.0f);
        CHECK(moveable.previousPosition.x == -7.0f);
        CHECK(moveable.previousPosition.y == 3.0f);
    }

    SUBCASE("TC-03 velocity is zeroed") {
        // This is why easing could be added without touching death, respawn or
        // teleport: `velocity` is the smoothing state, so clearing it clears
        // the easing too. Carried momentum here would fling the hero on arrival.
        CHECK(moveable.velocity.x == 0.0f);
        CHECK(moveable.velocity.y == 0.0f);
    }
}

TEST_CASE("Moveable: advance integrates velocity over the timestep") {
    Moveable moveable;
    moveable.position = sf::Vector2f{1.0f, 2.0f};
    moveable.velocity = sf::Vector2f{10.0f, -4.0f};

    SUBCASE("TC-04 position moves by velocity * dt and nothing else changes") {
        moveable.advance(0.5f);

        CHECK(moveable.position.x == 6.0f);
        CHECK(moveable.position.y == 0.0f);
        // advance integrates; it never eases. Velocity is the caller's business.
        CHECK(moveable.velocity.x == 10.0f);
        CHECK(moveable.velocity.y == -4.0f);
    }
}

TEST_CASE("Moveable: setVelocityFromDirection assigns full speed with no easing") {
    Moveable moveable = makeEasedMoveable();
    moveable.velocity = sf::Vector2f{-100.0f, 0.0f};

    SUBCASE("TC-05 the easing rates are ignored on the direct setter") {
        moveable.setVelocityFromDirection(kRight);

        // A full reversal in one call, despite accelerationRate being set. The
        // eased path is opt-in per call site, not a property of the struct.
        CHECK(moveable.velocity.x == 100.0f);
        CHECK(moveable.velocity.y == 0.0f);
    }
}

TEST_CASE("Moveable: a rate of zero means INSTANT — this is the enemy default") {
    SUBCASE("TC-06 a default-constructed Moveable carries no easing at all") {
        Moveable enemy;
        enemy.moveSpeed = 100.0f;

        REQUIRE(enemy.accelerationRate == 0.0f);
        REQUIRE(enemy.decelerationRate == 0.0f);

        enemy.approachVelocityFromDirection(kRight, 0.5f);

        // Full speed on the first call. Every enemy takes this branch, so their
        // attack wind-ups still plant on the exact frame they always did.
        CHECK(enemy.velocity.x == 100.0f);
        CHECK(enemy.velocity.y == 0.0f);
    }

    SUBCASE("TC-07 a zero deceleration rate stops instantly too") {
        Moveable enemy;
        enemy.moveSpeed = 100.0f;
        enemy.velocity  = sf::Vector2f{100.0f, 0.0f};

        enemy.approachVelocityFromDirection(kStill, 0.5f);

        CHECK(enemy.velocity.x == 0.0f);
        CHECK(enemy.velocity.y == 0.0f);
    }

    SUBCASE("TC-08 a non-positive dt also assigns instantly") {
        Moveable moveable = makeEasedMoveable();

        moveable.approachVelocityFromDirection(kRight, 0.0f);
        CHECK(moveable.velocity.x == 100.0f);

        moveable.velocity = sf::Vector2f{0.0f, 0.0f};
        moveable.approachVelocityFromDirection(kRight, -1.0f);
        CHECK(moveable.velocity.x == 100.0f);
    }
}

TEST_CASE("Moveable: accelerating and stopping use their own separate rates") {
    SUBCASE("TC-09 a non-zero target eases at accelerationRate") {
        Moveable moveable = makeEasedMoveable();  // accel 1.0, decel 0.25

        moveable.approachVelocityFromDirection(kRight, 0.5f);

        // t = clamp(1.0 * 0.5) = 0.5 → lerp(0, 100, 0.5) = 50.
        CHECK(moveable.velocity.x == 50.0f);
    }

    SUBCASE("TC-10 a zero target eases at the slower decelerationRate") {
        Moveable moveable = makeEasedMoveable();
        moveable.velocity = sf::Vector2f{100.0f, 0.0f};

        moveable.approachVelocityFromDirection(kStill, 0.5f);

        // t = clamp(0.25 * 0.5) = 0.125 → lerp(100, 0, 0.125) = 87.5.
        // Had it reused accelerationRate the answer would be 50: a responsive
        // launch and a heavy glide to rest are deliberately different feels.
        CHECK(moveable.velocity.x == 87.5f);
    }

    SUBCASE("TC-11 the branch keys on the TARGET, not on the direction") {
        // moveSpeed 0 with a live direction still produces a zero target, so it
        // must take the deceleration branch. A refactor that tests
        // `unitDirection` instead would pick accelerationRate — which is 0 here
        // and would therefore snap to 0 rather than easing to 5.
        Moveable moveable;
        moveable.moveSpeed        = 0.0f;
        moveable.accelerationRate = 0.0f;
        moveable.decelerationRate = 1.0f;
        moveable.stopEpsilon      = 0.0f;
        moveable.velocity         = sf::Vector2f{10.0f, 0.0f};

        moveable.approachVelocityFromDirection(kRight, 0.5f);

        CHECK(moveable.velocity.x == 5.0f);
    }

    SUBCASE("TC-12 rate * dt above 1 clamps — the target is never overshot") {
        Moveable moveable = makeEasedMoveable();
        moveable.accelerationRate = 10.0f;

        moveable.approachVelocityFromDirection(kRight, 1.0f);

        // clamp(10.0 * 1.0, 0, 1) = 1.0 → exactly the target. Without the clamp
        // the lerp would sail past it and oscillate.
        CHECK(moveable.velocity.x == 100.0f);
        CHECK(moveable.velocity.y == 0.0f);
    }
}

TEST_CASE("Moveable: the stop epsilon fires ONLY on a zero target") {
    // Both subcases below land on a velocity of magnitude 45 with the same
    // stopEpsilon of 50. The ONLY difference is whether the target is zero —
    // which is exactly the distinction the guard exists to make.

    SUBCASE("TC-13 stopping inside the epsilon snaps to exact zero") {
        Moveable moveable = makeEasedMoveable();
        moveable.decelerationRate = 1.0f;
        moveable.stopEpsilon      = 50.0f;
        moveable.velocity         = sf::Vector2f{90.0f, 0.0f};

        moveable.approachVelocityFromDirection(kStill, 0.5f);

        // lerp(90, 0, 0.5) = 45, and 45 <= 50 → snap. Exponential approach never
        // actually reaches zero, so without this cutoff the hero drifts forever
        // at sub-pixel speed and the walk animation never settles.
        CHECK(moveable.velocity.x == 0.0f);
        CHECK(moveable.velocity.y == 0.0f);
    }

    SUBCASE("TC-14 a REVERSAL through the epsilon does NOT snap") {
        Moveable moveable = makeEasedMoveable();
        moveable.accelerationRate = 1.0f;
        moveable.stopEpsilon      = 50.0f;
        moveable.velocity         = sf::Vector2f{10.0f, 0.0f};

        moveable.approachVelocityFromDirection(kLeft, 0.5f);

        // lerp(10, -100, 0.5) = -45. Magnitude 45 is inside the 50 epsilon, but
        // the target is -100, not zero: velocity is legitimately passing through
        // zero on its way from +x to -x. An unconditional snap would kill it
        // here and turning around would stutter. THIS is the regression guard.
        CHECK(moveable.velocity.x == -45.0f);
        CHECK(moveable.velocity.y == 0.0f);
    }

    SUBCASE("TC-15 stopping outside the epsilon is left alone") {
        Moveable moveable = makeEasedMoveable();
        moveable.decelerationRate = 1.0f;
        moveable.stopEpsilon      = 50.0f;
        moveable.velocity         = sf::Vector2f{200.0f, 0.0f};

        moveable.approachVelocityFromDirection(kStill, 0.5f);

        // lerp(200, 0, 0.5) = 100 > 50 → the glide continues. The epsilon is a
        // cutoff at the tail of the stop, not a shortcut through it.
        CHECK(moveable.velocity.x == 100.0f);
    }
}

TEST_CASE("Moveable: interpolatedPosition clamps alpha at both ends") {
    Moveable moveable;
    moveable.previousPosition = sf::Vector2f{0.0f, 0.0f};
    moveable.position         = sf::Vector2f{10.0f, 20.0f};

    SUBCASE("TC-16 alpha inside [0,1] blends the two snapshots") {
        const sf::Vector2f midpoint = moveable.interpolatedPosition(0.5f);
        CHECK(midpoint.x == 5.0f);
        CHECK(midpoint.y == 10.0f);

        const sf::Vector2f atStart = moveable.interpolatedPosition(0.0f);
        CHECK(atStart.x == 0.0f);
        CHECK(atStart.y == 0.0f);
    }

    SUBCASE("TC-17 alpha below 0 clamps to the previous position") {
        // A frame that arrives before the tick it interpolates must not
        // extrapolate backwards past the last simulated position.
        const sf::Vector2f behind = moveable.interpolatedPosition(-1.0f);
        CHECK(behind.x == 0.0f);
        CHECK(behind.y == 0.0f);
    }

    SUBCASE("TC-18 alpha above 1 clamps to the current position") {
        // A long frame must not extrapolate ahead of the simulation, or the
        // render position outruns collision and hits land visually early.
        const sf::Vector2f ahead = moveable.interpolatedPosition(2.0f);
        CHECK(ahead.x == 10.0f);
        CHECK(ahead.y == 20.0f);
    }
}
