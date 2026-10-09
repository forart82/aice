#include "render/EntityInspectorTab.hpp"

#include "core/World.hpp"
#include "entities/Dice.hpp"
#include "entities/Enemy.hpp"
#include "entities/FloorItem.hpp"
#include "entities/Hero.hpp"
#include "entities/QualityTier.hpp"
#include "entities/Weapon.hpp"
#include "hubs/WeaponSlotHub.hpp"

#include <algorithm>
#include <sstream>

// Pure, render-free formatters and roster/DPS math for the debug Entity
// inspector. Every function here returns a std::string or plain value from
// primitive/entity inputs so it can be unit-tested without an SFML render
// context. The SFML table painting and the drawGeneralTab/drawHeroTab/
// drawEnemiesTab entry points live in EntityInspectorTab_Render.cpp.

namespace dof::render {

namespace {

std::string formatPosition(sf::Vector2f position) {
    std::ostringstream out;
    out << "(" << static_cast<int>(position.x) << ", " << static_cast<int>(position.y) << ")";
    return out.str();
}

}

std::string formatHeroLine(const dof::entities::Hero& hero, float evasionChancePercent) {
    const auto& damageable = hero.damageable();
    const auto& levelable  = hero.levelable();
    const auto& moveable   = hero.moveable();
    std::ostringstream out;
    out << "Hero  HP " << static_cast<int>(damageable.health)
        << "/" << static_cast<int>(damageable.maxHealth)
        << "  Lv " << levelable.level
        << "  XP " << levelable.experience << "/" << levelable.experienceForNextLevel
        << "  Evasion " << static_cast<int>(evasionChancePercent + 0.5f) << "%"
        << "  Pos " << formatPosition(moveable.position);
    return out.str();
}

std::string formatEnemyLine(const dof::entities::Enemy& enemy) {
    const auto& damageable = enemy.damageable();
    const auto& moveable   = enemy.moveable();
    std::ostringstream out;
    out << "Enemy#" << enemy.id().value
        << "  HP " << static_cast<int>(damageable.health)
        << "/" << static_cast<int>(damageable.maxHealth)
        << "  Lv " << enemy.level()
        << "  Tier " << dof::entities::qualityTierName(enemy.tier())
        << "  Pos " << formatPosition(moveable.position);
    return out.str();
}

EnemyRosterSummary summariseEnemyRoster(const dof::core::World& world) {
    EnemyRosterSummary s;
    for (const auto& enemyPtr : world.enemies()) {
        if (!enemyPtr) continue;
        if (enemyPtr->deathable().isDead) continue;
        switch (enemyPtr->tier()) {
            case dof::entities::QualityTier::Common:   ++s.common;   break;
            case dof::entities::QualityTier::Uncommon: ++s.uncommon; break;
            case dof::entities::QualityTier::Rare:     ++s.rare;     break;
        }
        const int level = enemyPtr->level();
        // Band breakpoints mirror the default ENEMY_POLYGON_LEVEL_THRESHOLDS
        // table. If the player retunes that table, the visual breakdown
        // ideally tracks — but loading the live thresholds here would
        // couple the summariser to the renderer. KISS: keep the bands
        // hard-coded at the spec defaults; if a future card adds a
        // config table for them, this summariser updates in lockstep.
        if      (level < 20) ++s.bandLow;
        else if (level < 40) ++s.bandLowMid;
        else if (level < 60) ++s.bandMid;
        else if (level < 80) ++s.bandHighMid;
        else                 ++s.bandHigh;
        ++s.total;
    }
    return s;
}

std::string formatEnemySummaryTierLine(const EnemyRosterSummary& summary) {
    std::ostringstream out;
    out << "By Tier:  Common " << summary.common
        << "   Uncommon "      << summary.uncommon
        << "   Rare "          << summary.rare
        << "   Total "         << summary.total;
    return out.str();
}

std::string formatEnemySummaryBandLine(const EnemyRosterSummary& summary) {
    std::ostringstream out;
    out << "By Level:  L1-19 "  << summary.bandLow
        << "   L20-39 "         << summary.bandLowMid
        << "   L40-59 "         << summary.bandMid
        << "   L60-79 "         << summary.bandHighMid
        << "   L80+ "           << summary.bandHigh;
    return out.str();
}

std::vector<std::string> wrapTextByCharCount(const std::string& text,
                                              int maxCharsPerLine) {
    if (maxCharsPerLine <= 0) return {text};
    if (text.empty()) return {std::string{}};
    std::vector<std::string> out;
    std::string current;
    std::size_t pos = 0;
    while (pos < text.size()) {
        const std::size_t nextSpace = text.find(' ', pos);
        const std::size_t end       = (nextSpace == std::string::npos) ? text.size() : nextSpace;
        const std::string word      = text.substr(pos, end - pos);
        // Hard-break words that themselves exceed the limit so the
        // line never overshoots.
        if (static_cast<int>(word.size()) > maxCharsPerLine) {
            if (!current.empty()) {
                out.push_back(current);
                current.clear();
            }
            std::size_t wordPos = 0;
            while (wordPos < word.size()) {
                const std::size_t chunkLen =
                    std::min<std::size_t>(maxCharsPerLine, word.size() - wordPos);
                out.push_back(word.substr(wordPos, chunkLen));
                wordPos += chunkLen;
            }
        } else {
            const std::string candidate = current.empty()
                ? word
                : current + " " + word;
            if (static_cast<int>(candidate.size()) > maxCharsPerLine) {
                out.push_back(current);
                current = word;
            } else {
                current = candidate;
            }
        }
        pos = end + 1;  // skip the space
        if (nextSpace == std::string::npos) break;
    }
    if (!current.empty()) out.push_back(current);
    if (out.empty()) out.push_back(std::string{});
    return out;
}

float computeRowDps(int rowIndex, const dof::hubs::WeaponSlotHub& weaponSlotHub) {
    // card-mpl1x8l8 — baseline DPS for the equipped row. Dice present:
    // pacing is the SLOWEST dice's roll duration (spec §Effective APS,
    // mirrors `WeaponManager::tickWeaponRow`). No dice: weapon paces
    // itself at `attacksPerSecond`. Skip Dron multiplier + crit
    // (random per-fire) so the number reads as a guaranteed lower
    // bound the player can compare across loadouts.
    const auto* weapon = weaponSlotHub.peek(rowIndex);
    if (!weapon) return 0.0f;
    const int diceCells = weaponSlotHub.diceCellsPerRow();
    float slowestDiceRoll = 0.0f;
    bool  anyDice = false;
    for (int cell = 0; cell < diceCells; ++cell) {
        const auto* dice = weaponSlotHub.peekDice(rowIndex, cell);
        if (!dice) continue;
        anyDice = true;
        slowestDiceRoll = std::max(slowestDiceRoll, dice->countdownable().duration);
    }
    float effectiveAps = weapon->attacksPerSecond();
    if (anyDice && slowestDiceRoll > 0.0f) effectiveAps = 1.0f / slowestDiceRoll;
    if (effectiveAps < 0.0f) effectiveAps = 0.0f;
    return weapon->baseDamage() * effectiveAps;
}

std::string formatHeroLuckLine(int luckTotal) {
    std::ostringstream out;
    out << "Luck " << luckTotal;
    return out.str();
}

std::string formatHeroRowDpsLine(int rowIndex,
                                  float baseDamage,
                                  float effectiveAps,
                                  float dps) {
    std::ostringstream out;
    out << "Slot " << rowIndex << ": "
        << baseDamage << " dmg * " << effectiveAps << " aps = " << dps << " dps";
    return out.str();
}

std::string formatHeroTotalDpsLine(float totalDps) {
    std::ostringstream out;
    out << "Total DPS " << totalDps;
    return out.str();
}

std::string formatFloorItemLine(const dof::entities::FloorItem& item) {
    std::ostringstream out;
    out << "Item#" << item.id().value << "  ";
    if (item.kind() == dof::entities::FloorItemKind::Weapon && item.weapon()) {
        const auto* weapon = item.weapon();
        out << "Weapon \"" << weapon->displayName() << "\""
            << "  Lv " << weapon->itemLevel()
            << "  Q " << dof::entities::qualityTierName(weapon->tier());
    } else if (item.kind() == dof::entities::FloorItemKind::Dice && item.dice()) {
        const auto* dice = item.dice();
        out << "Dice \"" << dice->displayName() << "\""
            << "  Lv " << dice->itemLevel()
            << "  Q " << dof::entities::qualityTierName(dice->tier());
    } else {
        out << "Empty";
    }
    out << "  Pos " << formatPosition(item.position());
    return out.str();
}

}
