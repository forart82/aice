#include "hubs/PowderHub.hpp"

namespace dof::hubs {

PowderHub::PowderHub() = default;

void PowderHub::addPowder(dof::entities::PowderColor color, int amount) {
    if (amount <= 0) return;
    counts[color] += amount;
}

bool PowderHub::spendPowder(dof::entities::PowderColor color, int amount) {
    if (amount <= 0) return true;
    auto it = counts.find(color);
    if (it == counts.end() || it->second < amount) return false;
    it->second -= amount;
    if (it->second == 0) counts.erase(it);
    return true;
}

int PowderHub::peek(dof::entities::PowderColor color) const {
    auto it = counts.find(color);
    if (it == counts.end()) return 0;
    return it->second;
}

void PowderHub::removeStack(dof::entities::PowderColor color) {
    counts.erase(color);
}

int PowderHub::totalCount() const {
    int total = 0;
    for (const auto& [_, count] : counts) total += count;
    return total;
}

int PowderHub::colorsWithStock() const {
    int n = 0;
    for (const auto& [_, count] : counts) if (count > 0) ++n;
    return n;
}

std::vector<PowderStack> PowderHub::allStacks() const {
    std::vector<PowderStack> out;
    out.reserve(counts.size());
    for (int i = 0; i < dof::entities::powderColorCount(); ++i) {
        const auto color = dof::entities::powderColorAtIndex(i);
        const int count = peek(color);
        if (count > 0) out.push_back({color, count});
    }
    return out;
}

}
