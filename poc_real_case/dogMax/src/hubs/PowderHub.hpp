#pragma once

#include "entities/PowderColor.hpp"

#include <cstdint>
#include <unordered_map>
#include <vector>

namespace dof::hubs {

struct PowderStack {
    dof::entities::PowderColor color;
    int                        count;
};

class PowderHub {
public:
    PowderHub();

    void  addPowder(dof::entities::PowderColor color, int amount);
    // Atomically deducts `amount` if available. Returns true and deducts;
    // returns false without modifying state if the stack is short.
    bool  spendPowder(dof::entities::PowderColor color, int amount);
    int   peek(dof::entities::PowderColor color) const;
    void  removeStack(dof::entities::PowderColor color);
    int   totalCount() const;
    int   colorsWithStock() const;

    std::vector<PowderStack> allStacks() const;

private:
    std::unordered_map<dof::entities::PowderColor, int> counts;
};

}
