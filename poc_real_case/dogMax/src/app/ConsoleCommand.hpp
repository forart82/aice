#pragma once

// Spec §Console L2912-2952 — command grammar parser.
//
// Pure (no I/O, no SFML, no ConfigLoader). Takes a raw input line and
// classifies it into one of six kinds. The dispatch / mutation layer
// lives in `Console` (a separate module); this header exists so the
// grammar can be unit-tested in isolation.

#include <string>

namespace dof::app {

enum class ConsoleCommandKind {
    Empty,             // ""                              — no-op
    ListAll,           // "all"                           — dump every key
    ListSection,       // "config:NAME"                   — dump every key in file NAME
    GetKey,            // "KEY" or "NAME.KEY"             — read one value
    SetKey,            // "KEY=value" or "NAME.KEY=val"   — write one value
    Save,              // "save"                          — persist console overrides to disk
    // Cheats: `SpawnWeapon=N[,TYPE]`, `SpawnEnemy=N[,KIND]`,
    // `SpawnDice=N[,FACES]` (case-insensitive lhs, N integer
    // 1..maxSpawnLevel, see parseConsoleCommand's parameter).
    // Parser stores N in `spawnLevel`; the optional 2nd arg lands in
    // `spawnTypeName` as a canonical lowercase token (see field doc).
    // Unknown TYPE/KIND/FACES collapses the command to Invalid — there
    // is NO silent fallback to random.
    SpawnWeapon,
    SpawnEnemy,
    SpawnDice,
    Invalid            // garbage we can't recognise      — graceful fallback
};

struct ConsoleCommand {
    ConsoleCommandKind kind{ConsoleCommandKind::Empty};
    std::string        section;        // populated for ListSection + qualified Get/Set
    std::string        key;            // populated for Get/Set
    std::string        value;          // populated for Set
    std::string        raw;            // original (trimmed) input — for echo + errors
    int                spawnLevel{0};  // populated for SpawnWeapon/SpawnEnemy/SpawnDice (1..100)
    // T-CHEAT-spawn-type-arg — optional 2nd arg of the spawn cheats.
    // Empty when the user wrote `SpawnXxx=N` (random path). When
    // populated, holds the canonical lowercase token of the parsed
    // type / special-enemy kind / face count. Unknown tokens collapse
    // the command to Invalid, so a non-empty value here ALWAYS names
    // a real entity.
    //   SpawnWeapon  pitchfork longsword greatsword halberd
    //                quarterstaff knives dagger mace warhammer
    //                bigaxe
    //   SpawnEnemy   shocker glasswraith hexarchon
    //                tassideansentinel voidcrawler pactwalker
    //   SpawnDice    4 6 8 12 20 24 30 42 60 100
    std::string        spawnTypeName;
};

// Parse a single line of console input. Always returns a ConsoleCommand —
// `Invalid` for unparseable junk, `Empty` for blank/whitespace input.
// `maxSpawnLevel` is the upper bound accepted for the SpawnWeapon/SpawnEnemy/
// SpawnDice `N` argument (the caller resolves this from HERO_MAX_LEVEL via
// ConfigLoader — this module stays pure, no ConfigLoader dependency here).
ConsoleCommand parseConsoleCommand(const std::string& line, int maxSpawnLevel);

}
