#pragma once

// Spec §Console L2912-2989 — the in-game developer console rendered as
// an independent overlay. Was previously a tab inside `DebugPanel`; the
// user explicitly requested two separate components so the player can
// summon the console without dragging the full tabbed debug panel onto
// the screen (and vice-versa).
//
// State (input line, history, output log, suggestion list) lives in
// `app::Console`. This module owns the layout + SFML rendering of the
// translucent strip at the top of the screen, the input line + caret,
// the scrollback log, and the typing-time autocomplete dropdown.

#include "render/ColorTheme.hpp"
#include "render/UiAccent.hpp"
#include "render/ui/UiChip.hpp"

#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/System/Vector2.hpp>

#include <string>

namespace dof::loaders { class ConfigLoader; }
namespace dof::app { class Console; }
namespace dof::render { struct UiState; }

namespace dof::render {

// Geometry of the console overlay regions for a given window size.
// Pure data — no SFML pointers — so tests can drive it without a
// render context.
struct ConsoleOverlayRects {
    float panelX{0.0f};
    float panelY{0.0f};
    float panelWidth{0.0f};
    float panelHeight{0.0f};

    float inputLineHeight{0.0f};
    float outputHeight{0.0f};      // panelHeight - inputLineHeight

    // The dropdown floats below the input line. Height is rebuilt
    // each frame from `suggestionCount * dropdownRowHeight`.
    float dropdownRowHeight{0.0f};

    float inputY() const     { return panelY + outputHeight; }
    float inputBottom() const{ return inputY() + inputLineHeight; }
    float dropdownHeight(int suggestionCount) const {
        if (suggestionCount <= 0 || dropdownRowHeight <= 0.0f) return 0.0f;
        return dropdownRowHeight * static_cast<float>(suggestionCount);
    }
};

// Pure helper — compute the overlay geometry from window size + the
// configured fractions / heights. Centred horizontally; pinned to the
// top edge of the window per spec L2919 ("translucent overlay at the
// top of the screen, Counter-Strike style").
ConsoleOverlayRects computeConsoleOverlayRects(sf::Vector2u windowSize,
                                                 float widthFrac,
                                                 float heightFrac,
                                                 float inputLineHeight,
                                                 float dropdownRowHeight);

class ConsoleOverlay {
public:
    explicit ConsoleOverlay(const dof::loaders::ConfigLoader& config, const sf::Font& font);

    // Paint the overlay. No-op when `uiState.isConsoleVisible` is false.
    // Caller must already have set the UI view on the window. Takes a
    // RenderWindow (not RenderTarget) because the shared ui/* components
    // it composes draw onto a window (screen-pixel snapping needs it).
    void render(sf::RenderWindow& window,
                 const UiState& uiState,
                 const dof::app::Console& console);

    // Pure layout accessor — used by tests + future click handlers
    // (e.g. clicking a dropdown row to accept the suggestion).
    ConsoleOverlayRects computeRects(sf::Vector2u windowSize) const;

private:
    void drawOutputArea(sf::RenderWindow& window,
                         const ConsoleOverlayRects& rects,
                         const dof::app::Console& console) const;
    void drawInputLine(sf::RenderWindow& window,
                        const ConsoleOverlayRects& rects,
                        const dof::app::Console& console) const;
    void drawDropdown(sf::RenderWindow& window,
                       const ConsoleOverlayRects& rects,
                       const dof::app::Console& console) const;
    // Floating help panel painted below the dropdown when the live
    // input matches a known cheat keyword (see `consoleCheatTooltip`).
    void drawCheatTooltip(sf::RenderWindow& window,
                            const ConsoleOverlayRects& rects,
                            const dof::app::Console& console) const;

    const sf::Font& font;

    // All cached from `debug.yaml` (no hard-coded values).
    float       widthFrac;
    float       heightFrac;
    float       inputLineHeight;
    float       dropdownRowHeight;
    unsigned    textSize;

    sf::Color   panelBg;
    sf::Color   panelBorder;
    float       panelBorderThickness;
    sf::Color   inputBg;
    sf::Color   inputText;
    sf::Color   caretColor;
    sf::Color   outputBg;
    sf::Color   outputText;
    sf::Color   errorText;
    sf::Color   successText;
    sf::Color   dropdownBg;
    sf::Color   dropdownRowHighlight;
    sf::Color   dropdownText;

    std::string inputPrefix;
    std::string outputPrefix;

    // Shared ui/* design tokens, loaded once from theme.yaml so every
    // console paint matches the rest of the UI set. `accent` drives the
    // dropdown neon hover edge + cheat-tooltip outline; the two chips are
    // the top-left title badge + top-right status badge composed from
    // ui::UiChip (formerly the PanelChromeV2 drawTitleChip/drawStatusChip
    // free functions).
    UiAccent    accent{};
    ui::UiChip  titleChip{};
    ui::UiChip  statusChip{};
};

}
