#include "render/UiState.hpp"

namespace dof::render {

void DragState::clear() {
    source = DragSourceKind::None;
    sourceRowIndex = -1;
    sourceCellIndex = -1;
    payload = dof::hubs::InventoryItem{};
}

void UiState::cancelDrag() {
    drag.clear();
    hover = HoverState{};
}

}
