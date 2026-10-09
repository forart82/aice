#pragma once

#include <string_view>

namespace dof::entities {

// Phase 14 — Special Enemies (`GameDesign.md` L607-686). Every Enemy
// carries a `SpecialEnemyKind` discriminator so spawners, painters,
// AI, and loot rolls can branch on the unique mechanics. `None` is
// the baseline (no special behaviour, regular tier-driven enemy).
//
// The enum sits in `entities/` because it is part of an Enemy's
// identity; spawn substitution lives in `combat::SpecialEnemyGates`
// (separate header) so the predicate can be unit-tested without
// constructing an Enemy.
enum class SpecialEnemyKind {
    None,
    Shocker,            // spec L615-623
    Glasswraith,        // spec L625-635
    Hexarchon,          // spec L637-646
    TassideanSentinel,  // spec L648-656
    Voidcrawler,        // spec L658-667
    PactWalker,         // spec L669-677
};

// Human-readable label — used by debug panel + log messages. The
// label intentionally mirrors the spec name verbatim so the player
// can grep GameDesign.md for it.
std::string_view specialEnemyKindLabel(SpecialEnemyKind kind);

// T-CHEAT-spawn-type-arg — canonical lowercase token for the
// `SpawnEnemy=N,KIND` console cheat. Strips the spec label's spaces
// and hyphens (`Tassidean Sentinel` -> `tassideansentinel`,
// `Pact-Walker` -> `pactwalker`). Returns "none" for `None` so the
// caller can use it for round-trip checks.
std::string_view specialEnemyKindCanonicalToken(SpecialEnemyKind kind);
// Parse a user-supplied KIND token (any case, spaces / hyphens /
// underscores tolerated) into a SpecialEnemyKind. Returns true on a
// match, false on any other input (including "none") so the parser
// can collapse the whole command to Invalid — no silent fallback.
bool parseSpecialEnemyKindToken(const std::string& token, SpecialEnemyKind& out);

}
