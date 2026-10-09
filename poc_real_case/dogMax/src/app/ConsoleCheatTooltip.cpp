#include "app/ConsoleCheatTooltip.hpp"

#include "helpers/StringHelper.hpp"

namespace dof::app {

namespace {

bool contains(const std::string& haystack, const std::string& needle) {
    return haystack.find(needle) != std::string::npos;
}

}

std::string consoleCheatTooltip(const std::string& input) {
    const auto lower = dof::helpers::toLower(input);
    if (lower.empty()) return {};

    // Specific-cheat tooltip — keyword wins over the generic "spawn" hub.
    if (contains(lower, "weapon")
        || lower == "spawnw" || lower == "spawnwe" || lower == "spawnwea"
        || lower == "spawnweap" || lower == "spawnweapo") {
        return "SpawnWeapon=N[,TYPE]\n"
               "  Spawn a weapon beside the hero. N: itemLevel in\n"
               "  [1, 100]. Quality fixed at 100. Omit TYPE for a\n"
               "  random pick.\n"
               "  TYPE: pitchfork longsword greatsword halberd\n"
               "        quarterstaff knives dagger mace warhammer\n"
               "        bigaxe";
    }
    if (contains(lower, "enemy")
        || lower == "spawne" || lower == "spawnen" || lower == "spawnene"
        || lower == "spawnenem") {
        return "SpawnEnemy=N[,KIND]\n"
               "  Spawn an enemy beside the hero. N: level in\n"
               "  [1, 100]. Omit KIND for a Common-tier enemy; passing\n"
               "  a Special kind bumps the tier accordingly.\n"
               "  KIND: shocker glasswraith hexarchon\n"
               "        tassideansentinel voidcrawler pactwalker";
    }
    if (contains(lower, "dice")
        || lower == "spawnd" || lower == "spawndi" || lower == "spawndic") {
        return "SpawnDice=N[,FACES]\n"
               "  Spawn a dice beside the hero. N: itemLevel in\n"
               "  [1, 100]. Quality fixed at 100. Omit FACES for a\n"
               "  random pick.\n"
               "  FACES: 4 6 8 12 20 24 30 42 60 100";
    }
    // Generic "spawn" hub — covers "s" / "sp" / "spa" / "spaw" / "spawn".
    if (lower == "s" || lower == "sp" || lower == "spa"
        || lower == "spaw" || lower == "spawn") {
        return "Spawn cheats:\n"
               "  SpawnWeapon=N[,TYPE]   weapon, level N\n"
               "  SpawnEnemy=N[,KIND]    enemy,  level N\n"
               "  SpawnDice=N[,FACES]    dice,   level N\n"
               "  N in [1, 100]. Omit the 2nd arg for random.";
    }
    return {};
}

}
