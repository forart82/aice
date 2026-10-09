// CHARACTERISATION suite for the timer primitive (dof::abilities::Countdownable).
//
// HONESTY NOTE on TDD status: Countdownable already existed before the protocol
// was adopted, so these tests are CHARACTERISATION, not Red-Green-Refactor.
// They were written after the implementation and pass on first run — the
// correct treatment for legacy code, pinning current behaviour so the timer
// contract is enforceable. Rule 1 binds NEW work from the adoption date onward;
// presenting these as TDD would misrepresent how they came to exist.
//
// Countdownable is the shared clock behind hit-stop, attack cooldowns and
// telegraph wind-ups, so its edge cases are correctness rather than taste: a
// countdown that goes negative, or that a negative dt can wind backwards, shows
// up as an ability that fires twice or never fires at all.
//
// Oracle reference: ORACLE.md §3.2 — hit-stop runs on a real-time countdown.
//
// Arithmetic note: every step below is dyadic (halves, quarters) so the float
// results are exact. Accumulating ten steps of 0.1f would leave a tiny positive
// residue and `isFinished()` (`remaining <= 0`) would read false — that is a
// property of 0.1f, not of this class, and it does not belong in the assertions.

#include "doctest.h"

#include "abilities/Countdownable.hpp"

using dof::abilities::Countdownable;

TEST_CASE("Countdownable: a fresh timer starts fully armed") {
    Countdownable timer;

    SUBCASE("TC-01 duration and remaining agree out of the box") {
        CHECK(timer.duration == 1.0f);
        CHECK(timer.remaining == 1.0f);
        CHECK_FALSE(timer.isFinished());
        CHECK(timer.progress() == doctest::Approx(0.0f));
    }
}

TEST_CASE("Countdownable: setDuration re-arms and floors negatives at zero") {
    Countdownable timer;

    SUBCASE("TC-02 a positive duration sets both fields") {
        timer.setDuration(2.0f);

        CHECK(timer.duration == 2.0f);
        CHECK(timer.remaining == 2.0f);
    }

    SUBCASE("TC-03 setDuration re-arms a timer that was already running down") {
        timer.setDuration(2.0f);
        timer.advance(1.5f);
        REQUIRE(timer.remaining == 0.5f);

        timer.setDuration(4.0f);

        // Not just a duration change — the countdown restarts. Retuning a
        // cooldown mid-run must not leave `remaining` above the new duration,
        // which would make progress() report a negative fraction.
        CHECK(timer.remaining == 4.0f);
    }

    SUBCASE("TC-04 a negative duration is clamped to zero, not stored") {
        timer.setDuration(-5.0f);

        CHECK(timer.duration == 0.0f);
        CHECK(timer.remaining == 0.0f);
        // A negative duration would make progress() report a value above 1 and
        // isFinished() flip on sign rather than on elapsed time.
        CHECK(timer.isFinished());
    }
}

TEST_CASE("Countdownable: reset restores the full duration") {
    Countdownable timer;
    timer.setDuration(2.0f);
    timer.advance(1.5f);
    REQUIRE(timer.remaining == 0.5f);

    SUBCASE("TC-05 reset re-arms without touching duration") {
        timer.reset();

        CHECK(timer.remaining == 2.0f);
        CHECK(timer.duration == 2.0f);
        CHECK_FALSE(timer.isFinished());
    }

    SUBCASE("TC-06 reset works after the countdown has already expired") {
        timer.advance(10.0f);
        REQUIRE(timer.isFinished());

        timer.reset();

        CHECK(timer.remaining == 2.0f);
        CHECK_FALSE(timer.isFinished());
    }
}

TEST_CASE("Countdownable: advance only ever moves time forward") {
    Countdownable timer;
    timer.setDuration(2.0f);

    SUBCASE("TC-07 a positive dt subtracts exactly that much") {
        timer.advance(0.5f);
        CHECK(timer.remaining == 1.5f);

        timer.advance(0.25f);
        CHECK(timer.remaining == 1.25f);
    }

    SUBCASE("TC-08 a zero dt is a no-op") {
        timer.advance(0.0f);

        CHECK(timer.remaining == 2.0f);
    }

    SUBCASE("TC-09 a negative dt does NOT add time back") {
        timer.advance(0.5f);
        REQUIRE(timer.remaining == 1.5f);

        timer.advance(-1.0f);

        // The early return is the guard. Without it a negative dt — which a
        // clock that jumps backwards can produce — would extend the countdown
        // instead of ignoring the tick, and a hit-stop could never expire.
        CHECK(timer.remaining == 1.5f);
    }
}

TEST_CASE("Countdownable: the countdown clamps at zero and never goes negative") {
    Countdownable timer;
    timer.setDuration(1.0f);

    SUBCASE("TC-10 overshooting lands on exactly zero") {
        timer.advance(1.5f);

        // Exactly zero, not -0.5: consumers compare against 0 and a negative
        // remaining would let progress() report more than 1.
        CHECK(timer.remaining == 0.0f);
        CHECK(timer.isFinished());
    }

    SUBCASE("TC-11 further advances keep it pinned at zero") {
        timer.advance(1.5f);
        timer.advance(100.0f);

        CHECK(timer.remaining == 0.0f);
        CHECK(timer.isFinished());
    }

    SUBCASE("TC-12 isFinished is inclusive of exactly zero") {
        timer.advance(1.0f);

        CHECK(timer.remaining == 0.0f);
        // `remaining <= 0`, not `< 0` — a timer that lands precisely on its
        // duration boundary has expired, otherwise it needs one extra tick.
        CHECK(timer.isFinished());
    }
}

TEST_CASE("Countdownable: progress reports elapsed fraction, not remaining") {
    Countdownable timer;
    timer.setDuration(2.0f);

    SUBCASE("TC-13 progress runs 0 → 1 as the countdown drains") {
        CHECK(timer.progress() == doctest::Approx(0.0f));

        timer.advance(0.5f);
        CHECK(timer.progress() == doctest::Approx(0.25f));

        timer.advance(0.5f);
        CHECK(timer.progress() == doctest::Approx(0.5f));

        timer.advance(1.0f);
        CHECK(timer.progress() == doctest::Approx(1.0f));
    }

    SUBCASE("TC-14 a zero duration reports fully elapsed instead of dividing") {
        timer.setDuration(0.0f);

        // The `duration <= 0` guard is a divide-by-zero shield. An instant
        // timer is meaningfully "already done", so 1.0 is the right answer and
        // NaN would poison every wind-up progress bar that reads it.
        CHECK(timer.progress() == doctest::Approx(1.0f));
        CHECK(timer.isFinished());
    }
}
