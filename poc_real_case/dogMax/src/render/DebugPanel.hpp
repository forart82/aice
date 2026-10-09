#pragma once

// Spec §Debug Mode L2791-2890 — the in-game developer overlay.
//
// Owns the visual layout + SFML rendering of the tabbed panel
// (Entity / Performance / Config). The console used to live inside
// this panel as the first tab; it now renders as an independent
// `ConsoleOverlay` (see `render/ConsoleOverlay.hpp`) so the user can
// summon either component without the other.
//
// The panel supports a minimise state independent of its visibility:
// Ctrl+O hides it entirely; the dedicated minimise button at the top-
// right collapses it to just the tab strip while keeping it on-screen.

#include "render/ColorTheme.hpp"
#include "render/ConfigTab.hpp"
#include "render/EntityInspectorExpand.hpp"
#include "render/ShapeShaders.hpp"
#include "render/ui/UiPanel.hpp"
#include "render/ui/UiLabel.hpp"
#include "render/ui/UiSearchField.hpp"
#include "diagnostics/FrameProfiler.hpp"

#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/System/Vector2.hpp>
#include <SFML/Window/Keyboard.hpp>

#include <cstdint>
#include <string>
#include <vector>

namespace dof::loaders { class ConfigLoader; class ShaderLoader; }
// DebugPanel.hpp already includes <string> transitively; explicit for clarity.
namespace dof::core { class World; }
namespace dof::hubs { class EvasionHub; class InventoryHub; class WeaponSlotHub; class LuckHub; }
namespace dof::render { struct UiState; class FpsHistory; }

namespace dof::render {

// Per-frame context passed to `DebugPanel::render` so each tab body
// can pull live world / config / performance data without coupling
// the panel class to those dependencies. Pointers may be null — the
// tab body falls back to a placeholder string.
struct DebugRenderContext {
    const dof::core::World*           world{nullptr};
    const dof::hubs::EvasionHub*         evasionHub{nullptr};
    const dof::loaders::ConfigLoader* configLoader{nullptr};
    const FpsHistory*                 fpsHistory{nullptr};
    dof::diagnostics::FrameTimings    frameTimings{};
    int                               spatialGridCellCount{0};
    // card-mpl1ldva — Weapons + Dices tabs scan every weapon/dice
    // owned by the player or sitting on the floor; need handles to
    // the inventory + sidebar hubs. World already covers floor items.
    const dof::hubs::InventoryHub*    inventoryHub{nullptr};
    const dof::hubs::WeaponSlotHub*   weaponSlotHub{nullptr};
    // card-mpl1x8l8 — Hero stats panel (Luck + per-slot DPS + total)
    // needs the luck hub + the sidebar to walk equipped weapons. Reuses
    // the same `weaponSlotHub` pointer above so no duplicate plumbing.
    const dof::hubs::LuckHub*         luckHub{nullptr};
};

// Geometry of the panel regions for a given window size. Pure data
// — no SFML pointers — so it can be tested without a render context.
struct DebugPanelRects {
    float panelX{0.0f};
    float panelY{0.0f};
    float panelWidth{0.0f};
    float panelHeight{0.0f};

    float tabStripHeight{0.0f};    // top strip — tab headers + minimise button
    float tabWidth{0.0f};          // width of a single tab header

    // Height reserved for the inline search field (0 when not shown).
    float searchBarHeight{0.0f};

    // Height of the speed-control strip docked at the bottom (0 when none).
    float speedStripHeight{0.0f};

    // Convenience for the "body" area below the tab strip (and search bar):
    float bodyY() const  { return panelY + tabStripHeight + searchBarHeight; }
    float bodyHeight() const {
        const float h = panelHeight - tabStripHeight - searchBarHeight - speedStripHeight;
        return h > 0.0f ? h : 0.0f;
    }
    float bodyBottom() const { return bodyY() + bodyHeight(); }
    float searchBarY()  const { return panelY + tabStripHeight; }
    float speedStripY() const { return panelY + panelHeight - speedStripHeight; }
};

// Compute the panel geometry from a window size + the config-driven
// width/height fractions and the configured tab-strip height. The
// panel anchors at (offsetX, offsetY) within the UI design canvas;
// pass {0,0} for the spec-default top-left position or the live
// user-drag offset carried by `UiState`. Pure helper — testable.
DebugPanelRects computeDebugPanelRects(sf::Vector2u windowSize,
                                        float widthFrac,
                                        float heightFrac,
                                        float tabStripHeight,
                                        float offsetX,
                                        float offsetY);

// Tab strip when the panel is minimised — only the tab strip stays
// visible (acts as a title bar) so the user can click the restore
// button without the body chrome eating the screen. Same anchor
// semantics as `computeDebugPanelRects`. Pure helper.
DebugPanelRects computeDebugPanelMinimisedRects(sf::Vector2u windowSize,
                                                  float widthFrac,
                                                  float tabStripHeight,
                                                  float offsetX,
                                                  float offsetY);

// Hit-test the tab strip. Returns the 0-based tab index when `cursorUi`
// falls on a tab header (spec §Tabs §Tab Switch L2862), or -1 when the
// cursor is outside the strip (including when it lands on the drag
// handle or the minimise button square). Pure helper — testable
// without an SFML render context.
int debugPanelTabIndexAt(const DebugPanelRects& rects, sf::Vector2f cursorUi);

// The square button at the right edge of the tab strip that minimises
// (or, in the minimised state, restores) the panel. Same square is
// re-used for both states; the glyph + behaviour switch on the
// `isMinimised` flag carried by `UiState`. Pure helper.
sf::FloatRect computeDebugPanelMinimiseButtonRect(const DebugPanelRects& rects);

// The square handle at the left edge of the tab strip the player
// click-and-drags to move the panel. Same side length as the
// minimise button so the chrome stays symmetric. Pure helper.
sf::FloatRect computeDebugPanelDragHandleRect(const DebugPanelRects& rects);

// `true` when `cursorUi` falls on the minimise / restore button square.
// Pure — uses `computeDebugPanelMinimiseButtonRect` under the hood.
bool debugPanelMinimiseButtonContains(const DebugPanelRects& rects, sf::Vector2f cursorUi);

// `true` when `cursorUi` falls on the drag-handle square at the left
// edge of the tab strip. Pure — uses `computeDebugPanelDragHandleRect`.
bool debugPanelDragHandleContains(const DebugPanelRects& rects, sf::Vector2f cursorUi);

// Clamp a candidate (offsetX, offsetY) so the panel stays fully
// on-screen for the given UI design size. Width and height are the
// panel's own dimensions (panelWidth / panelHeight) — at minimised
// height pass the minimised panelHeight so the strip is still
// clampable. Pure helper.
sf::Vector2f clampDebugPanelOffset(sf::Vector2f desired,
                                    sf::Vector2u uiDesignSize,
                                    float panelWidth,
                                    float panelHeight);

// Speed-control strip (bottom of panel). Dec button on the left, inc on the right.
// Both are square with side = speedStripHeight. Pure helpers — testable without render.
sf::FloatRect computeSpeedDecButtonRect(const DebugPanelRects& rects);
sf::FloatRect computeSpeedIncButtonRect(const DebugPanelRects& rects);

// Draw the inline search field strip between the tab bar and the body.
// Only called on filterable tabs. Updates no state — caller owns query.
void drawDebugSearchField(sf::RenderWindow& window,
                           const DebugPanelRects& rects,
                           const std::string& query,
                           bool isFocused,
                           const dof::loaders::ConfigLoader& config,
                           const sf::Font& font,
                           unsigned textSize);

// Tabs (by index) that display the inline search bar.
bool debugTabHasSearchBar(int tabIndex);

// Number of tab headers rendered along the panel top edge. Has grown
// over time: 4 in the original Console-as-tab-0 layout, 3 after
// Console moved out, 5 with Weapons+Dices (card-mpl1ldva), 6 with
// Floor (card-mpl1zaar), and 8 now that card-mpl9it01 split the
// omnibus Entity tab into General / Hero / Enemies.
constexpr int kDebugPanelTabCount = 8;

// card-mpkwdbzn — clamp a candidate body-scroll offset against the
// currently-rendered tab. Offset 0 anchors the first line at the top
// of the body; positive values shift the visible window further down
// into the line list. Clamped against [0, max(0, totalLines -
// visibleLines)] so the user can never scroll past the last line.
// Pure helper — testable without an SFML render context.
int clampDebugPanelScroll(int desiredOffset, int totalLines, int visibleLines);

class DebugPanel {
public:
    DebugPanel(const dof::loaders::ConfigLoader& config, const sf::Font& font,
               const dof::loaders::ShaderLoader* shaders = nullptr);

    // Paint the entire overlay. Caller must already have set the UI
    // view on the window. No-op when `uiState.isDebugPanelVisible` is
    // false. When `uiState.isDebugPanelMinimised` is true, only the
    // tab strip + minimise button are drawn (body is skipped). The
    // `context` argument is optional and lets the non-Console tabs
    // render live data (default-constructed context falls back to
    // placeholders).
    void render(sf::RenderWindow& window,
                 const UiState& uiState,
                 const DebugRenderContext& context = {});

    // Pure layout accessor — used by tests + the click handler.
    // `offsetX`/`offsetY` come from `UiState::debugPanelOffset` (the
    // live user-drag position). Tests can pass {0,0} for the default
    // top-left anchor.
    DebugPanelRects computeRects(sf::Vector2u windowSize, sf::Vector2f offset) const;
    DebugPanelRects computeMinimisedRects(sf::Vector2u windowSize, sf::Vector2f offset) const;

    sf::Vector2f initialOffset()   const { return {initialOffsetX, initialOffsetY}; }
    float        searchBarHeight() const { return searchBarHeightPx; }
    float        speedStripHeight() const { return speedStripHeightPx; }

    // card-mpkwdbzn — scrollback for the active tab body. Mirrors the
    // Console pattern (`Console::scrollBy` / `scrollToBottom`): 0 = top
    // of the line list (default), positive = scrolled further into the
    // list. `scrollBy` accumulates the delta and clamps on the next
    // render pass against the rendered line count. `scrollToTop`
    // snaps back to the first line. The offset is shared across tabs
    // and resets to 0 whenever the active tab changes (handled by the
    // session input layer).
    int  scrollOffset() const { return bodyScrollOffset; }
    void scrollBy(int lineDelta);
    void scrollToTop();

    // card-mpmzs1j5 — previous-frame enemy row bands. The Enemies-tab
    // renderer writes one band per visible alive enemy on every paint;
    // the GameSession click handler reads back to hit-test the click
    // (1-frame-stale layout is invisible to the user). Empty between
    // renders that do not run the Enemies tab.
    const std::vector<EntityInspectorRowBand>& lastEnemyRowBands() const {
        return enemyRowBands;
    }

    // card-mpoa5j47 — same accessor for the Hero tab. Each band tags
    // the WeaponSlotHub row index (not a roster index) so the click
    // handler can hit-test directly against the row the user clicked.
    const std::vector<EntityInspectorRowBand>& lastHeroRowBands() const {
        return heroRowBands;
    }

    // Click-to-expand row bands for the Weapons / Dices / Floor tabs.
    // Each accessor returns one band per *item-bearing* row painted on
    // the most recent frame the matching tab rendered. Empty between
    // frames that ran any other tab.
    const std::vector<EntityInspectorRowBand>& lastWeaponsRowBands() const {
        return weaponsRowBands;
    }
    const std::vector<EntityInspectorRowBand>& lastDicesRowBands() const {
        return dicesRowBands;
    }
    const std::vector<EntityInspectorRowBand>& lastFloorRowBands() const {
        return floorRowBands;
    }

    // Phase G5 — editable Config tab (index 7). The panel owns the edit +
    // toolbar state; GameSession focuses a row, feeds edit keystrokes, and
    // reads back the clickable value bands + the Save button rect (both
    // captured on the previous Config-tab paint, 1 frame stale — invisible
    // to the user, mirroring the enemy/hero row-band click flow).
    bool isConfigEditActive() const { return configEditActive; }
    const std::string& configEditKeyName() const { return configEditKeyName_; }
    const std::string& configEditText()    const { return configEditText_; }
    int  configEditCaret() const { return configEditCaret_; }
    // Focus `key` for editing, seeding the buffer with its current value and
    // parking the caret at the end. Clears any prior edit + status banner.
    void beginConfigEdit(const std::string& key, const std::string& seedValue) {
        configEditActive = true;
        configEditKeyName_ = key;
        configEditText_ = seedValue;
        configEditCaret_ = static_cast<int>(seedValue.size());
        configStatusText.clear();
    }
    void cancelConfigEdit() {
        configEditActive = false;
        configEditKeyName_.clear();
        configEditText_.clear();
        configEditCaret_ = 0;
    }
    // Apply one Backspace/Delete/arrow/Home/End or printable char to the edit
    // buffer via the shared ui::UiTextInput helper. Returns true when the
    // buffer text changed. No-op when no row is focused.
    bool applyConfigEditKey(std::uint32_t unicode, sf::Keyboard::Key key);
    void setConfigStatus(const std::string& message) { configStatusText = message; }
    const std::vector<ConfigRowBand>& lastConfigRowBands() const { return configRowBands; }
    sf::FloatRect configSaveButtonRect() const { return configSaveButtonRect_; }

    // card-mpmzs1j5 — animation duration (seconds) for the expand
    // drawer reveal. Loaded from `DEBUG_PANEL_ROW_EXPAND_ANIM_SECONDS`
    // so the renderer + GameSession's per-step timer advance read the
    // same value from the same source.
    float rowExpandAnimDuration() const { return rowExpandAnimDurationSeconds; }

private:
    void drawBackground(sf::RenderWindow& window, const DebugPanelRects& rects) const;
    void drawTabStrip(sf::RenderWindow& window,
                       const DebugPanelRects& rects,
                       int activeTabIndex,
                       int hoveredTabIndex,
                       bool isMinimised) const;
    void drawPlaceholderBody(sf::RenderWindow& window,
                              const DebugPanelRects& rects,
                              const std::string& label) const;
    void drawMinimiseButton(sf::RenderWindow& window,
                             const DebugPanelRects& rects,
                             bool isMinimised) const;
    void drawDragHandle(sf::RenderWindow& window,
                         const DebugPanelRects& rects) const;
    void drawSpeedStrip(sf::RenderWindow& window,
                         const DebugPanelRects& rects,
                         float timeScale) const;

    const sf::Font& font;

    // All cached from `debug.yaml` (no hard-coded values).
    float       widthFrac;
    float       heightFrac;
    float       tabStripHeight;
    float       initialOffsetX;
    float       initialOffsetY;
    unsigned    textSize;

    sf::Color   panelBg;
    sf::Color   panelBorder;
    float       panelBorderThickness;

    // Dark-cyberpunk neon frame: when UI_GLOW_ENABLE is set and the "panel"
    // shader compiled, drawBackground draws the dark fill then the in-shader
    // panel.frag glow edge on top; otherwise it falls back to the flat
    // UiPanel frame. `shapeShaders` is mutable because drawBackground is const
    // but the shader draw binds uniforms through the non-const ShapeShaders.
    const dof::loaders::ShaderLoader* shadersPtr{nullptr};
    mutable ShapeShaders              shapeShaders;
    bool                              isGlowEnabled{false};
    float                             glowSpread{10.0f};
    int                               glowLayers{5};
    float                             glowAlpha{70.0f};
    // Low-emphasis accent band (UiAccent::dim()) — the single dim-accent
    // token every debug-chrome surface uses for hover/highlight/divider
    // states, so the panel reads as one accent instead of drifting hues.
    sf::Color   accentDim;
    sf::Color   tabBg;
    sf::Color   tabActive;
    sf::Color   tabHover;
    sf::Color   tabLabel;
    // Inactive-tab label (theme.uiDim) — the text-dim token paired with
    // tabLabel (theme.uiText) so active/inactive tabs separate by text
    // luminance, not hue.
    sf::Color   tabLabelDim;

    sf::Color   outputBg;
    sf::Color   outputText;

    sf::Color   minimiseButtonBg;
    sf::Color   minimiseButtonLabel;

    // card-mpkwdbzn — body scroll state, mutated by `scrollBy` /
    // `scrollToTop` and re-clamped on every `render` against the
    // currently-rendered line count.
    int         bodyScrollOffset{0};

    // card-mpmzs1j5 — row bands captured on the most recent Enemies-
    // tab paint. Cleared each frame the Enemies tab renders.
    std::vector<EntityInspectorRowBand> enemyRowBands;

    // card-mpoa5j47 — row bands captured on the most recent Hero-tab
    // paint. One band per equipped weapon row; cleared each frame the
    // Hero tab renders.
    std::vector<EntityInspectorRowBand> heroRowBands;

    // Row bands captured on the most recent Weapons / Dices / Floor
    // tab paint. Each cleared on tab-switch in render() so the click
    // handler ignores stale layouts from a different tab.
    std::vector<EntityInspectorRowBand> weaponsRowBands;
    std::vector<EntityInspectorRowBand> dicesRowBands;
    std::vector<EntityInspectorRowBand> floorRowBands;

    // Phase G5 — editable Config tab state. `configEditActive` gates keyboard
    // capture (GameSession suppresses hero movement + hotkeys while it is
    // set); the buffer/caret back the focused row's ui::UiTextInput.
    // `configStatusText` is the transient Save/validation banner. The bands +
    // Save rect are rewritten every Config-tab paint for click hit-testing.
    bool                          configEditActive{false};
    std::string                   configEditKeyName_;
    std::string                   configEditText_;
    int                           configEditCaret_{0};
    std::string                   configStatusText;
    std::vector<ConfigRowBand>    configRowBands;
    sf::FloatRect                 configSaveButtonRect_{};

    // card-mpmzs1j5 — animation duration (seconds) for the Enemies
    // click-to-expand drawer. Loaded from `debug.yaml`.
    float       rowExpandAnimDurationSeconds{0.0f};

    // Height of the inline search bar strip. Loaded once from
    // DEBUG_SEARCH_BAR_HEIGHT; 0 on tabs without a search bar.
    float       searchBarHeightPx{0.0f};

    // Height of the always-visible speed-control strip at the panel bottom.
    float       speedStripHeightPx{0.0f};

    // Performance tab FPS-graph bar colours (card converting the raw
    // sf::RectangleShape bars to `ui::UiBarChart`) + the FPS threshold
    // that switches a bar between them. Loaded once from debug.yaml.
    float       perfGraphGoodFpsThreshold;
    sf::Color   perfGraphGoodColor;
    sf::Color   perfGraphBadColor;
};

}
