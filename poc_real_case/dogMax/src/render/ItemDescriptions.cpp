#include "render/ItemDescriptions.hpp"

#include "entities/Dice.hpp"
#include "entities/QualityTier.hpp"
#include "entities/Weapon.hpp"
#include "hubs/InventoryHub.hpp"
#include "hubs/InventoryItem.hpp"

#include <cmath>
#include <iomanip>
#include <map>
#include <sstream>
#include <string>

namespace dof::render {

static const char* statGradeTag(int qualityScore) {
    if (qualityScore >= 80) return "S";
    if (qualityScore >= 50) return "A";
    if (qualityScore >= 20) return "B";
    return "D";
}

std::string compactFloat(float value, int decimals) {
    std::ostringstream out;
    out << std::fixed << std::setprecision(decimals) << value;
    std::string text = out.str();
    if (decimals > 0) {
        while (!text.empty() && text.back() == '0') text.pop_back();
        if (!text.empty() && text.back() == '.') text.pop_back();
    }
    if (text == "-0") return "0";
    return text;
}

std::string percent(float value) {
    return std::to_string(static_cast<int>(std::round(value * 100.0f))) + "%";
}

std::string row(const std::string& label, const std::string& value, const std::string& badge = {}) {
    return label + "\t" + value + "\t" + badge;
}

std::vector<std::string> describeWeapon(const dof::entities::Weapon& weapon) {
    using SI = dof::entities::WeaponStatIndex;
    std::vector<std::string> lines;
    const std::string tier = std::string(dof::entities::qualityTierName(weapon.tier()))
                           + "  q " + std::to_string(weapon.qualityScore());
    const std::string slots = std::to_string(weapon.slotCount())
                            + (weapon.slotCount() == 1 ? " dice slot" : " dice slots");
    lines.push_back("# ITEM");
    lines.push_back(row("Level", std::to_string(weapon.itemLevel())));
    lines.push_back(row("Tier", tier, statGradeTag(weapon.qualityScore())));
    lines.push_back(row("Type", dof::entities::weaponTypeName(weapon.type())));
    lines.push_back(row("Attack", dof::entities::weaponAttackName(weapon)));
    lines.push_back(row("Sockets", slots));
    lines.push_back("");
    lines.push_back("# COMBAT");
    lines.push_back(row("Damage", compactFloat(weapon.baseDamage(), 1),
                        statGradeTag(weapon.statQualityScore(SI::Damage))));
    lines.push_back(row("Attack/sec", compactFloat(weapon.attacksPerSecond(), 2),
                        statGradeTag(weapon.statQualityScore(SI::Aps))));
    lines.push_back(row("Range", compactFloat(weapon.rangeable().range, 0),
                        statGradeTag(weapon.statQualityScore(SI::Range))));
    lines.push_back(row("Crit", "x" + compactFloat(weapon.crit(), 2) + " at " + percent(weapon.critChance()),
                        statGradeTag(weapon.statQualityScore(SI::CritMult))));
    return lines;
}

std::vector<std::string> describeDice(const dof::entities::Dice& dice) {
    std::vector<std::string> lines;
    const std::string tier = std::string(dof::entities::qualityTierName(dice.tier()))
                           + "  q " + std::to_string(dice.qualityScore());
    lines.push_back("# ITEM");
    lines.push_back(row("Level", std::to_string(dice.itemLevel())));
    lines.push_back(row("Tier", tier, statGradeTag(dice.qualityScore())));
    lines.push_back(row("Face", dof::entities::diceFaceLabel(dice.face())));
    lines.push_back(row("Showing", std::to_string(dice.faceValue(dice.currentFace()))
                              + " / " + std::to_string(dice.faceCount())));
    if (dice.isCrafted()) lines.push_back(row("Crafted", "Yes"));
    lines.push_back("");
    lines.push_back("# SOCKET");
    lines.push_back(row("Damage mult", "x" + compactFloat(dice.damageMultiplier(), 2)));
    lines.push_back(row("Crit", "x" + compactFloat(dice.crit(), 2) + " at " + percent(dice.critChance())));
    lines.push_back(row("Luck", std::to_string(dice.luck())));
    if (dice.evasionPerSlot() > 0.0f) {
        lines.push_back(row("Evasion", percent(dice.evasionPerSlot())));
    }
    lines.push_back(row("Roll time", compactFloat(dice.countdownable().duration, 1) + "s"));
    return lines;
}

namespace {

dof::entities::QualityTier tierForIndex(int tierIndex) {
    switch (tierIndex) {
        case 0:  return dof::entities::QualityTier::Common;
        case 1:  return dof::entities::QualityTier::Uncommon;
        default: return dof::entities::QualityTier::Rare;
    }
}

}

std::vector<std::string> describeDestroyButton(int tierIndex,
                                                const dof::hubs::InventoryHub& inventoryHub,
                                                const std::array<std::string, 3>& tierLabels) {
    if (tierIndex < 0 || tierIndex > 2) return {};
    const auto tier = tierForIndex(tierIndex);

    std::map<std::string, int> counts;
    int total = 0;
    for (int i = 0; i < inventoryHub.slotCount(); ++i) {
        const auto* item = inventoryHub.peekItem(i);
        if (!item || item->isEmpty()) continue;
        if (item->isWeapon()) {
            if (item->weapon->tier() != tier) continue;
            ++counts[dof::entities::weaponTypeName(item->weapon->type())];
            ++total;
        } else if (item->isDice()) {
            if (item->dice->tier() != tier) continue;
            ++counts[std::string(dof::entities::diceFaceLabel(item->dice->face()))];
            ++total;
        }
    }

    std::vector<std::string> lines;
    lines.reserve(counts.size() + 2);
    const std::string& tierLabel = tierLabels[static_cast<size_t>(tierIndex)];
    if (total == 0) {
        std::ostringstream summary;
        summary << "Tier: " << tierLabel;
        lines.push_back(summary.str());
        lines.push_back("Nothing to destroy");
        return lines;
    }
    std::ostringstream summary;
    summary << "Tier: " << tierLabel;
    lines.push_back(summary.str());
    std::ostringstream totalLine;
    totalLine << total << (total == 1 ? " item" : " items");
    lines.push_back(totalLine.str());
    for (const auto& [label, count] : counts) {
        std::ostringstream line;
        line << label << " x" << count;
        lines.push_back(line.str());
    }
    return lines;
}

}
