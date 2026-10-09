#pragma once

#include <array>
#include <string>
#include <vector>

namespace dof::entities { class Weapon; class Dice; }
namespace dof::hubs { class InventoryHub; }

namespace dof::render {

// Pure formatters consumed by the TooltipRenderer.
// Weapon lines include the player-facing attack name so the same label can
// appear in combat feedback and death-screen final-hit reporting.
std::vector<std::string> describeWeapon(const dof::entities::Weapon& weapon);
std::vector<std::string> describeDice(const dof::entities::Dice& dice);

// T-P5-destroy-buttons-hover-flash — tooltip body for the three powder
// destroy buttons (Common / Uncommon / Rare). Walks the live inventory,
// counts every item whose tier matches `tierIndex` (0=Common, 1=Uncommon,
// 2=Rare), and groups them by underlying type / face. The first line
// summarises the total count; subsequent lines list "<type> x<n>".
// When nothing in the inventory matches the tier, the body is a single
// "Nothing to destroy" line so the player still gets explicit feedback.
// Out-of-range tier indices return an empty vector (caller short-circuits).
std::vector<std::string> describeDestroyButton(int tierIndex,
                                                const dof::hubs::InventoryHub& inventoryHub,
                                                const std::array<std::string, 3>& tierLabels);

}
