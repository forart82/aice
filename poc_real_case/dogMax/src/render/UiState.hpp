#pragma once

#include "core/EntityId.hpp"
#include "hubs/InventoryItem.hpp"

#include <SFML/System/Vector2.hpp>
#include <cstdint>
#include <string>
#include <vector>

namespace dof::render {

enum class DragSourceKind : std::uint8_t { None, Inventory, WeaponSlot, DiceCell };
enum class HoverTargetKind : std::uint8_t {
    None,
    InventorySlot,
    WeaponRow,
    DiceCell,
    DestroyButton,
    SortButton,
    FloorItem,
};

struct DragState {
    DragSourceKind            source{DragSourceKind::None};
    int                       sourceRowIndex{-1};
    int                       sourceCellIndex{-1};
    dof::hubs::InventoryItem  payload;
    sf::Vector2f              cursorUi{0.0f, 0.0f};

    bool isActive() const { return source != DragSourceKind::None && !payload.isEmpty(); }
    void clear();
};

struct HoverState {
    HoverTargetKind     kind{HoverTargetKind::None};
    int                 rowIndex{-1};
    int                 cellIndex{-1};
    dof::core::EntityId floorItemId{0};
};

struct UiState {
    // Inventory (I) — component-based pixel-perfect panel
    // rendered by render::InventoryRenderer. Reuses InventoryLayout
    // geometry and InteractionController for all gestures (drag/drop, sort,
    // destroy).
    bool         isInventoryOpen{false};
    // Pickup feedback for the infobar inventory icon.
    float        inventoryPickupPulseSeconds{0.0f};
    // Ctrl+W All-Weapons catalog — read-only component panel rendered by
    // render::AllWeaponsWindow. Lists every WeaponType with its base stats.
    // Independent flag; coexists with any inventory panel.
    bool         isAllWeaponsOpen{false};
    sf::Vector2f mouseUi{0.0f, 0.0f};
    HoverState   hover;
    DragState    drag;

    // Spec §Debug Mode L2791-2890 — Ctrl+O toggles the overlay panel.
    // Console + DebugPanel are now independent components: the debug
    // panel hosts the Entity / Performance / Config tabs, while the
    // Console is a separate top-of-screen overlay (spec L2919). Each
    // owns its own visibility flag so a power user can run one without
    // the other.
    //
    // Tab index 0..2 → Entity / Performance / Config (Console moved
    // out of the panel; the old "tab 0 = Console" coupling is gone).
    //
    // `isConsoleVisible` gates the new `ConsoleOverlay` render +
    // input-routing. `isConsoleFocused` is kept as the boolean the
    // hero-input / WASD gate already consumes; it shadows
    // `isConsoleVisible` while the overlay is up so existing callers
    // (CommandDispatcher) don't need to change.
    //
    // `isDebugPanelMinimised` is independent of `isDebugPanelVisible`:
    // Ctrl+O hides the panel entirely; the dedicated minimise button
    // in the panel's top-right collapses it to just the tab strip
    // while keeping it visible.
    bool         isDebugPanelVisible{false};
    bool         isDebugPanelMinimised{false};
    int          debugActiveTabIndex{0};
    int          hoveredDebugTabIndex{-1};
    // User-drag offset for the panel (UI design coords). The panel
    // anchors top-left + this offset; minimising preserves it so the
    // strip stays where the user parked the full panel. Updated by
    // the drag-handle interaction in GameSession.
    sf::Vector2f debugPanelOffset{0.0f, 0.0f};
    bool         isDraggingDebugPanel{false};
    sf::Vector2f debugPanelDragStartMouse{0.0f, 0.0f};
    sf::Vector2f debugPanelDragStartOffset{0.0f, 0.0f};
    bool         isConsoleVisible{false};
    bool         isConsoleFocused{false};

    // Debug-panel inline search field. `debugSearchQuery` is the live
    // filter string; `isDebugSearchFocused` gates keyboard input so
    // typing into the field does not move the hero. Resets to empty
    // on tab-switch (mirrors the scroll-offset reset convention).
    std::string  debugSearchQuery;
    bool         isDebugSearchFocused{false};

    // SA33 / spec §Debug Mode L2873-L2880 — F1 toggles a translucent
    // overlay listing every live keybinding. Independent of the debug
    // panel (the help panel exists so the player can discover the
    // bindings without first opening the dev tools).
    bool isHelpVisible{false};

    // Ctrl+H opens the unified Gallery window (render::ComponentShowcaseRenderer):
    // a single modal with a two-level tab nav —
    //   category "Game Art" → sub-tabs Weapons | Enemies | Effects
    //   category "UI Kit"   → sub-tabs Components | Fonts
    //   category "Grouped FX" → sub-tabs 200px | 500px | 1000px
    //   category "Icons" → sub-tab Utility
    // It replaces the former standalone Ctrl+W (weapons), Ctrl+E (enemies) and
    // Ctrl+S (effects) windows, which are removed. Second Ctrl+H closes it.
    bool isShowcaseOpen{false};
    int  showcaseActiveTab{0};      // active sub-tab index within the active category
    int  galleryCategory{0};        // 0=Game Art, 1=UI Kit, 2=Grouped FX, 3=Icons
    int  gallerySubTab[4]{0, 0, 0, 0}; // remembered active sub-tab per category
    float galleryFontsScroll{0.0f}; // scroll offset for the Fonts sub-tab list
    int   galleryFontClickedIndex{-1};         // -1 = none; index of clicked font row
    std::vector<std::uint32_t> galleryFontUsageMasks; // per-font bitmask of selected usage slots
    int   groupedFxTabIndex{0};
    float groupedFxScrollOffset[3]{0.f, 0.f, 0.f};
    // Inner (third-level) sub-tabs within Game Art → Weapons / Enemies
    int  weaponsSubTab{0};   // 0=Classic  1=Cyber  2=Void
    int  enemiesSubTab{0};   // 0=Primordial  1=Mech  2=Cosmic

    // card-mpmzs1j5 — click-to-expand drawer for the Enemies debug
    // tab. `debugExpandedRowIndex` is the rowIndex of the enemy whose
    // detail drawer is currently revealed (or -1 when nothing is
    // expanded). Resets to -1 on tab change, on minimise toggle, and
    // on a second click of the same row (toggle-close).
    // `debugExpandAnimSeconds` is the monotone-clamped reveal timer
    // (advances per fixed sim step, snaps to 0 on every state
    // transition); the renderer uses
    // `seconds / DEBUG_PANEL_ROW_EXPAND_ANIM_SECONDS` to compute the
    // ratio of drawer lines to paint this frame.
    int   debugExpandedRowIndex{-1};
    float debugExpandAnimSeconds{0.0f};

    // card-mpoa5j47 — same drawer mechanism on the Hero tab. The
    // rowIndex here is the WeaponSlotHub row (0..rowCount-1); the
    // animation timer is independent of the Enemies-tab timer so
    // toggling rows on either tab does not bleed across.
    int   debugHeroExpandedRowIndex{-1};
    float debugHeroExpandAnimSeconds{0.0f};

    // Click-to-expand drawer mirrors for the Weapons / Dices / Floor
    // debug tabs. Each tab keeps its own pair so toggling rows on one
    // tab does not bleed into another, and per-tab close-on-tab-switch
    // resets stay independent. The rowIndex is a flat paint-order
    // ordinal over *item-bearing* rows only (sections without an
    // entity do not push a band, so the index always maps back to a
    // backed row), matching the Hero-tab convention.
    int   debugWeaponsExpandedRowIndex{-1};
    float debugWeaponsExpandAnimSeconds{0.0f};
    int   debugDicesExpandedRowIndex{-1};
    float debugDicesExpandAnimSeconds{0.0f};
    int   debugFloorExpandedRowIndex{-1};
    float debugFloorExpandAnimSeconds{0.0f};

    // DiceCrafter panel (G key). True while the DiceCrafter window is visible.
    // selectedDiceCrafterFace: 1-based index of the face cell the player clicked to
    // reface (-1 = nothing selected; REFACE buttons are disabled until set).
    bool        isDiceCrafterOpen{false};
    int         selectedDiceCrafterFace{-1};

    // Phase G (G-misc) — player-facing Settings / Theme panel (P key),
    // rendered by render::SettingsPanel. `isSettingsOpen` toggles it (Esc
    // also closes) and, while true, suppresses WASD (see
    // GameSession::applyKeyboardInputsToHero) exactly like a focused Config
    // row does. `settingsDragRow` is the slider row index currently being
    // dragged (-1 = none); it lives here (not in the panel) so it survives
    // the panel rebuild the per-frame live-apply performs on every edit.
    // `settingsStatus` is the transient Save-confirmation banner (empty =
    // hidden), likewise kept out of the rebuilt panel.
    bool        isSettingsOpen{false};
    int         settingsDragRow{-1};
    std::string settingsStatus;

    // Ctrl+S Effects Catalog — three-tab scrollable window (Small / Medium /
    // Large) showing all 300 named effects with live shader previews.
    // `effectsCatalogTabIndex` 0=Small, 1=Medium, 2=Large.
    // `effectsCatalogScrollOffset[i]` holds the per-tab scroll position
    // (pixels from the top of the content), preserved across tab switches.
    bool  isEffectsCatalogOpen{false};
    int   effectsCatalogTabIndex{0};
    float effectsCatalogScrollOffset[3]{0.f, 0.f, 0.f};

    // Debug-panel game speed scale (0 = frozen, 1 = normal, 4 = 4×).
    // Stepped by 0.2 via the [−]/[+] buttons in the speed control strip.
    float gameTimeScale{1.0f};

    // Loot-filter popup (F key). Quality/level edit buffers hold the
    // live text while the user types; parsed into LootFilter on change.
    bool        isLootFilterOpen{false};
    bool        isLootFilterQualityFocused{false};
    bool        isLootFilterLevelFocused{false};
    std::string lootFilterQualityInput{"0"};
    std::string lootFilterLevelInput{"0"};

    // Ctrl+E Enemy Design Editor — full-screen design tool for per-type
    // enemy YAML templates. `enemyEditorTypeIndex` indexes into the sorted
    // type-ID list from the registry; `enemyEditorTierIndex` selects the
    // tier tab (0=Common, 1=Uncommon, 2=Rare).
    bool  isEnemyEditorOpen{false};
    int   enemyEditorTypeIndex{0};
    int   enemyEditorTierIndex{0};       // 0=Common 1=Uncommon 2=Rare
    int   enemyEditorLayerIndex{-1};     // selected layer (-1=none)
    bool  enemyEditorShaderPickerOpen{false};
    float enemyEditorTypeScroll{0.f};
    float enemyEditorLayerScroll{0.f};
    float enemyEditorSavedFlash{0.f};    // countdown timer for "Saved!" indicator

    void cancelDrag();
};

}
