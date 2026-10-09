#include "render/EntityInspectorExpand.hpp"

#include "entities/Dice.hpp"
#include "entities/Enemy.hpp"
#include "entities/FloorItem.hpp"
#include "entities/QualityTier.hpp"
#include "entities/Weapon.hpp"

#include <algorithm>
#include <cmath>
#include <sstream>

namespace dof::render {

namespace {

std::string formatPosition(sf::Vector2f position) {
    std::ostringstream out;
    out << "(" << static_cast<int>(position.x) << ", " << static_cast<int>(position.y) << ")";
    return out.str();
}

std::string formatVec(sf::Vector2f v) {
    std::ostringstream out;
    out.setf(std::ios::fixed);
    out.precision(2);
    out << "(" << v.x << ", " << v.y << ")";
    return out.str();
}

}

std::vector<std::string> buildEnemyDrawerLines(const dof::entities::Enemy& enemy) {
    const auto& moveable    = enemy.moveable();
    const auto& huntable    = enemy.huntable();
    const auto& damageable  = enemy.damageable();
    const auto& aimable     = enemy.aimable();
    const auto& deathable   = enemy.deathable();

    std::vector<std::string> lines;
    {
        std::ostringstream s;
        s << "Tier " << dof::entities::qualityTierName(enemy.tier())
          << "   Elite " << (enemy.isElite() ? "yes" : "no")
          << "   Level " << enemy.level();
        lines.push_back(s.str());
    }
    {
        std::ostringstream s;
        s << "HP " << damageable.health << "/" << damageable.maxHealth;
        lines.push_back(s.str());
    }
    {
        std::ostringstream s;
        s << "Position " << formatPosition(moveable.position)
          << "   Spawn " << formatPosition(enemy.spawnPosition());
        lines.push_back(s.str());
    }
    {
        std::ostringstream s;
        s << "Move speed " << moveable.moveSpeed
          << "   Aim " << formatVec(aimable.aimDirection);
        lines.push_back(s.str());
    }
    {
        std::ostringstream s;
        s << "Chase range " << huntable.chaseRange
          << "   Attack range " << huntable.attackRange
          << "   Deadzone x" << huntable.deadzoneFactor;
        lines.push_back(s.str());
    }
    if (deathable.isDead) {
        std::ostringstream s;
        s << "Death timer " << deathable.deathTimer;
        lines.push_back(s.str());
    }
    return lines;
}

std::vector<std::string> buildHeroWeaponRowDrawerLines(int rowIndex,
                                                          const dof::entities::Weapon& weapon) {
    std::vector<std::string> lines;
    {
        std::ostringstream s;
        s << "Row " << rowIndex
          << "  Type " << dof::entities::weaponTypeName(weapon.type())
          << "  Name " << weapon.displayName();
        lines.push_back(s.str());
    }
    {
        std::ostringstream s;
        s << "Tier " << dof::entities::qualityTierName(weapon.tier())
          << "  Quality " << weapon.qualityScore()
          << "  Item Lv " << weapon.itemLevel();
        lines.push_back(s.str());
    }
    {
        std::ostringstream s;
        s.setf(std::ios::fixed);
        s.precision(2);
        s << "Base damage " << weapon.baseDamage()
          << "  APS " << weapon.attacksPerSecond()
          << "  Range " << weapon.rangeable().range;
        lines.push_back(s.str());
    }
    {
        std::ostringstream s;
        s.setf(std::ios::fixed);
        s.precision(2);
        s << "Crit x" << weapon.crit()
          << "  Crit chance " << weapon.critChance();
        lines.push_back(s.str());
    }
    {
        std::ostringstream s;
        s << "Slot count " << weapon.slotCount()
          << "  Countdown " << weapon.countdownable().remaining
          << "/" << weapon.countdownable().duration;
        lines.push_back(s.str());
    }
    return lines;
}

std::vector<std::string> buildWeaponsDrawerLines(const dof::entities::Weapon* weapon) {
    std::vector<std::string> lines;
    if (!weapon) return lines;
    {
        std::ostringstream s;
        s << "Type " << dof::entities::weaponTypeName(weapon->type())
          << "  Name " << weapon->displayName();
        lines.push_back(s.str());
    }
    {
        std::ostringstream s;
        s << "Tier " << dof::entities::qualityTierName(weapon->tier())
          << "  Quality " << weapon->qualityScore()
          << "  Item Lv " << weapon->itemLevel();
        lines.push_back(s.str());
    }
    {
        std::ostringstream s;
        s.setf(std::ios::fixed);
        s.precision(2);
        s << "Base damage " << weapon->baseDamage()
          << "  APS " << weapon->attacksPerSecond()
          << "  Range " << weapon->rangeable().range;
        lines.push_back(s.str());
    }
    {
        std::ostringstream s;
        s.setf(std::ios::fixed);
        s.precision(2);
        s << "Crit x" << weapon->crit()
          << "  Crit chance " << weapon->critChance();
        lines.push_back(s.str());
    }
    {
        std::ostringstream s;
        s << "Slot count " << weapon->slotCount()
          << "  Countdown " << weapon->countdownable().remaining
          << "/" << weapon->countdownable().duration;
        lines.push_back(s.str());
    }
    return lines;
}

std::vector<std::string> buildDicesDrawerLines(const dof::entities::Dice* dice) {
    std::vector<std::string> lines;
    if (!dice) return lines;
    {
        std::ostringstream s;
        s << "Face " << dof::entities::diceFaceLabel(dice->face())
          << "  Name " << dice->displayName();
        lines.push_back(s.str());
    }
    {
        std::ostringstream s;
        s << "Tier " << dof::entities::qualityTierName(dice->tier())
          << "  Quality " << dice->qualityScore()
          << "  Item Lv " << dice->itemLevel();
        lines.push_back(s.str());
    }
    {
        std::ostringstream s;
        s.setf(std::ios::fixed);
        s.precision(2);
        s << "Damage mult x" << dice->damageMultiplier()
          << "  Current face " << dice->currentFace() << "/" << dice->faceCount();
        lines.push_back(s.str());
    }
    {
        std::ostringstream s;
        s.setf(std::ios::fixed);
        s.precision(2);
        s << "Crit x" << dice->crit()
          << "  Crit chance " << dice->critChance()
          << "  Luck " << dice->luck();
        lines.push_back(s.str());
    }
    {
        std::ostringstream s;
        s << "Roll " << dice->countdownable().remaining
          << "/" << dice->countdownable().duration;
        lines.push_back(s.str());
    }
    return lines;
}

std::vector<std::string> buildFloorDrawerLines(const dof::entities::FloorItem* item) {
    std::vector<std::string> lines;
    if (!item) return lines;
    const bool isWeapon = item->kind() == dof::entities::FloorItemKind::Weapon
                          && item->weapon() != nullptr;
    const bool isDice   = item->kind() == dof::entities::FloorItemKind::Dice
                          && item->dice() != nullptr;
    if (!isWeapon && !isDice) return lines;  // hollow floor entry — no drawer.

    {
        std::ostringstream s;
        s << "Position " << formatPosition(item->position())
          << "  Age " << item->ageSeconds() << "s";
        lines.push_back(s.str());
    }
    if (isWeapon) {
        const auto* weapon = item->weapon();
        {
            std::ostringstream s;
            s << "Weapon  Type " << dof::entities::weaponTypeName(weapon->type())
              << "  Name " << weapon->displayName();
            lines.push_back(s.str());
        }
        {
            std::ostringstream s;
            s << "Tier " << dof::entities::qualityTierName(weapon->tier())
              << "  Quality " << weapon->qualityScore()
              << "  Item Lv " << weapon->itemLevel();
            lines.push_back(s.str());
        }
        {
            std::ostringstream s;
            s.setf(std::ios::fixed);
            s.precision(2);
            s << "Base damage " << weapon->baseDamage()
              << "  APS " << weapon->attacksPerSecond()
              << "  Range " << weapon->rangeable().range;
            lines.push_back(s.str());
        }
    } else {
        const auto* dice = item->dice();
        {
            std::ostringstream s;
            s << "Dice  Face " << dof::entities::diceFaceLabel(dice->face())
              << "  Name " << dice->displayName();
            lines.push_back(s.str());
        }
        {
            std::ostringstream s;
            s << "Tier " << dof::entities::qualityTierName(dice->tier())
              << "  Quality " << dice->qualityScore()
              << "  Item Lv " << dice->itemLevel();
            lines.push_back(s.str());
        }
        {
            std::ostringstream s;
            s.setf(std::ios::fixed);
            s.precision(2);
            s << "Damage mult x" << dice->damageMultiplier()
              << "  Luck " << dice->luck();
            lines.push_back(s.str());
        }
    }
    return lines;
}

int entityInspectorRowIndexAt(const std::vector<EntityInspectorRowBand>& bands,
                               sf::Vector2f cursorUi) {
    for (const auto& band : bands) {
        if (cursorUi.y >= band.yTop && cursorUi.y < band.yBottom) return band.rowIndex;
    }
    return -1;
}

float clampDebugExpandAnim(float seconds, float dt, float duration) {
    if (duration <= 0.0f) return 0.0f;
    float next = seconds + dt;
    if (next < 0.0f)        next = 0.0f;
    if (next > duration)    next = duration;
    return next;
}

int revealedDrawerLineCount(float seconds, float duration, int drawerLineCount) {
    if (drawerLineCount <= 0) return 0;
    if (duration <= 0.0f)     return drawerLineCount;
    float ratio = seconds / duration;
    if (ratio < 0.0f) ratio = 0.0f;
    if (ratio > 1.0f) ratio = 1.0f;
    const int revealed = static_cast<int>(std::floor(ratio * static_cast<float>(drawerLineCount)));
    if (revealed < 0)                       return 0;
    if (revealed > drawerLineCount)         return drawerLineCount;
    return revealed;
}

}
