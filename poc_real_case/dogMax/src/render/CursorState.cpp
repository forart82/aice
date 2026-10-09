#include "render/CursorState.hpp"

namespace dof::render {

sf::Cursor::Type pickCursorType(const UiState& uiState) {
    if (uiState.drag.isActive()) return sf::Cursor::Type::SizeAll;
    switch (uiState.hover.kind) {
        case HoverTargetKind::InventorySlot:
        case HoverTargetKind::WeaponRow:
        case HoverTargetKind::DiceCell:
        case HoverTargetKind::DestroyButton:
        case HoverTargetKind::SortButton:
            return sf::Cursor::Type::Hand;
        case HoverTargetKind::None:
        default:
            return sf::Cursor::Type::Arrow;
    }
}

}
