#include "app/ConsoleCommand.hpp"

#include "entities/Dice.hpp"
#include "entities/SpecialEnemyKind.hpp"
#include "entities/Weapon.hpp"
#include "helpers/StringHelper.hpp"

namespace dof::app {

namespace {

// A "key" is alphanumeric + underscore. Sections (config file stems)
// follow the same rule. Keeping this conservative avoids parsing values
// that happen to contain dots / colons as if they were qualifiers.
bool isKeyChar(char c) {
    return (c >= 'A' && c <= 'Z') ||
           (c >= 'a' && c <= 'z') ||
           (c >= '0' && c <= '9') ||
            c == '_';
}

bool isValidIdentifier(const std::string& s) {
    if (s.empty()) return false;
    for (char c : s) if (!isKeyChar(c)) return false;
    return true;
}

// `SpawnWeapon=N` / `SpawnEnemy=N` / `SpawnDice=N` cheats. Case-insensitive
// keyword match on lhs; rhs must be a base-10 integer in [1,maxSpawnLevel].
// `keyword` is always passed already lowercased, so an ASCII-fold of `lhs`
// compared for equality is exactly the per-character case-insensitive match.
bool matchKeywordCi(const std::string& lhs, const std::string& keyword) {
    return dof::helpers::toLower(lhs) == keyword;
}

// T-CHEAT-spawn-type-arg — rhs grammar is `N[,TYPE]`. Split on the
// optional ',' so the integer parse stays unchanged. Both halves are
// trimmed of incidental whitespace (`SpawnWeapon=10 , Long Sword`).
void splitSpawnRhs(const std::string& rhs, std::string& levelPart,
                    std::string& typePart) {
    const auto commaPos = rhs.find(',');
    if (commaPos == std::string::npos) {
        levelPart = rhs;
        typePart.clear();
        return;
    }
    levelPart = dof::helpers::trim(rhs.substr(0, commaPos));
    typePart  = dof::helpers::trim(rhs.substr(commaPos + 1));
}

bool tryParseSpawnLevel(const std::string& lhs, const std::string& rhs,
                       const std::string& keyword, int maxSpawnLevel,
                       int& levelOut, std::string& typeRawOut) {
    if (!matchKeywordCi(lhs, keyword)) return false;
    if (rhs.empty()) return false;
    std::string levelPart;
    std::string typePart;
    splitSpawnRhs(rhs, levelPart, typePart);
    if (levelPart.empty()) return false;
    int value = 0;
    for (char c : levelPart) {
        if (c < '0' || c > '9') return false;
        value = value * 10 + (c - '0');
        if (value > 1000) return false;
    }
    if (value < 1 || value > maxSpawnLevel) return false;
    levelOut   = value;
    typeRawOut = typePart;
    return true;
}

}

ConsoleCommand parseConsoleCommand(const std::string& line, int maxSpawnLevel) {
    ConsoleCommand out;
    out.raw = dof::helpers::trim(line);

    if (out.raw.empty()) {
        out.kind = ConsoleCommandKind::Empty;
        return out;
    }

    // 1. "all" — full dump.
    if (out.raw == "all") {
        out.kind = ConsoleCommandKind::ListAll;
        return out;
    }

    // 1b. "save" — persist the current console overrides to the
    // `_overrides.yaml` sidecar (Phase G4). Exact-lowercase match, like
    // "all"; autocomplete carries the canonical spelling.
    if (out.raw == "save") {
        out.kind = ConsoleCommandKind::Save;
        return out;
    }

    // 2. "config:NAME" — section dump. Reject if NAME is empty or non-identifier.
    if (out.raw.rfind("config:", 0) == 0) {
        const std::string section = out.raw.substr(7);
        if (!isValidIdentifier(section)) {
            out.kind = ConsoleCommandKind::Invalid;
            return out;
        }
        out.kind = ConsoleCommandKind::ListSection;
        out.section = section;
        return out;
    }

    // Split on '=' first so we can distinguish Set from Get.
    std::string lhs = out.raw;
    std::string rhs;
    const auto eqPos = out.raw.find('=');
    const bool isSet = (eqPos != std::string::npos);
    if (isSet) {
        lhs = dof::helpers::trim(out.raw.substr(0, eqPos));
        rhs = dof::helpers::trim(out.raw.substr(eqPos + 1));
    }

    // 2b. `SpawnWeapon=N[,TYPE]` / `SpawnEnemy=N[,KIND]` /
    // `SpawnDice=N[,FACES]` cheats. Detected after the `=` split so
    // spaces around `=` are handled by the trim above. An empty 2nd
    // arg keeps the historical random-pick behaviour; a non-empty
    // 2nd arg that fails to parse collapses the whole command to
    // Invalid (no silent fallback to random).
    if (isSet) {
        int level = 0;
        std::string typeRaw;
        if (tryParseSpawnLevel(lhs, rhs, "spawnweapon", maxSpawnLevel, level, typeRaw)) {
            out.kind       = ConsoleCommandKind::SpawnWeapon;
            out.spawnLevel = level;
            if (!typeRaw.empty()) {
                dof::entities::WeaponType wt{};
                if (!dof::entities::parseWeaponTypeToken(typeRaw, wt)) {
                    out.kind = ConsoleCommandKind::Invalid;
                    return out;
                }
                out.spawnTypeName = dof::entities::weaponTypeCanonicalToken(wt);
            }
            return out;
        }
        if (tryParseSpawnLevel(lhs, rhs, "spawnenemy", maxSpawnLevel, level, typeRaw)) {
            out.kind       = ConsoleCommandKind::SpawnEnemy;
            out.spawnLevel = level;
            if (!typeRaw.empty()) {
                dof::entities::SpecialEnemyKind sk{};
                if (!dof::entities::parseSpecialEnemyKindToken(typeRaw, sk)) {
                    out.kind = ConsoleCommandKind::Invalid;
                    return out;
                }
                out.spawnTypeName =
                    std::string(dof::entities::specialEnemyKindCanonicalToken(sk));
            }
            return out;
        }
        if (tryParseSpawnLevel(lhs, rhs, "spawndice", maxSpawnLevel, level, typeRaw)) {
            out.kind       = ConsoleCommandKind::SpawnDice;
            out.spawnLevel = level;
            if (!typeRaw.empty()) {
                dof::entities::DiceFace face{};
                if (!dof::entities::parseDiceFaceCountToken(typeRaw, face)) {
                    out.kind = ConsoleCommandKind::Invalid;
                    return out;
                }
                out.spawnTypeName = std::to_string(dof::entities::diceFaceCount(face));
            }
            return out;
        }
    }

    // 3. Optional NAME.KEY qualifier on the LHS.
    std::string section;
    std::string key = lhs;
    const auto dotPos = lhs.find('.');
    if (dotPos != std::string::npos) {
        section = lhs.substr(0, dotPos);
        key     = lhs.substr(dotPos + 1);
        if (!isValidIdentifier(section)) {
            out.kind = ConsoleCommandKind::Invalid;
            return out;
        }
    }

    if (!isValidIdentifier(key)) {
        out.kind = ConsoleCommandKind::Invalid;
        return out;
    }

    out.section = section;
    out.key     = key;
    if (isSet) {
        out.kind  = ConsoleCommandKind::SetKey;
        out.value = rhs;
    } else {
        out.kind  = ConsoleCommandKind::GetKey;
    }
    return out;
}

}
