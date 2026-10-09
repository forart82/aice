#pragma once

#include "render/ColorTheme.hpp"
#include "render/UiAccent.hpp"
#include "render/ui/UiChip.hpp"

#include <SFML/Graphics/Font.hpp>
#include <SFML/System/Vector2.hpp>

#include <string>
#include <vector>

namespace dof::loaders { class ConfigLoader; }
namespace sf { class RenderWindow; }

namespace dof::render {

// Spec §Debug Mode L2873-L2880 + SA33 — the context's Help command toggles a
// translucent panel that renders `assets/help.md` so the player can read the
// keybindings + brief usage notes. The overlay supports basic
// Markdown-style headings (one `#` for major, two `##` for minor),
// a body paragraph for every other non-blank line, and mouse-wheel
// scrolling so the content stays accessible at any window size.
//
// Pure layout + rendering; the input handler in GameSession owns the
// visibility flag in `UiState::isHelpVisible` and feeds wheel deltas
// into `scrollBy` while the overlay is on.

class HelpOverlay {
public:
    HelpOverlay(const dof::loaders::ConfigLoader& config, const ColorTheme& theme, const sf::Font& font);

    void render(sf::RenderWindow& window, sf::Vector2u windowSize) const;

    // card-mpmzs1j5/SA33 — mouse-wheel routing from GameSession.
    // Positive delta scrolls up (smaller offset); negative delta
    // scrolls down (larger offset). The overlay clamps the result
    // to `[0, max(0, totalRows - visibleRows)]` so the panel never
    // scrolls past the last line.
    void scrollBy(int delta);

    // card-mpmzs1j5/SA33 — parsed `assets/help.md` view. Heading
    // lines render at a larger font + accent colour; `keys :: action`
    // lines render as aligned shortcut rows; Spacer rows leave a blank line.
    enum class LineKind { Heading1, Heading2, Shortcut, Body, Spacer };
    struct DocLine { LineKind kind; std::string text; };
    const std::vector<DocLine>& docLines() const;

    // Test/inspection seam — the current clamped scroll offset (rows from
    // the top). `scrollBy` guarantees this never drops below 0, so a unit
    // test can drive it negative and assert the clamp held. Read-only.
    int scrollOffset() const { return scrollOffsetLines; }

private:
    void loadHelpMarkdown(const std::string& assetsRoot);

    const ColorTheme       theme;
    const sf::Font&        font;
    sf::Color              panelBg;
    sf::Color              panelOutline;
    sf::Color              headingColor;
    float                  widthFraction{0.6f};
    float                  heightFraction{0.7f};
    float                  paddingX{16.0f};
    float                  paddingY{14.0f};
    float                  titleFontSize{20.0f};
    float                  heading1FontSize{22.0f};
    float                  heading2FontSize{18.0f};
    float                  lineFontSize{14.0f};
    float                  lineSpacing{4.0f};
    float                  shortcutKeyWidth{220.0f};
    float                  scrollbarWidth{2.0f};
    std::vector<DocLine>   docLineStorage;
    mutable int            scrollOffsetLines{0};
    // card-mpl9hhw6 v2 T-UIR-help — accent outline + title/status chip
    // components loaded once from theme.yaml; the F1 overlay adopts the
    // same v2 visual vocabulary as the other framed UI surfaces
    // (sidebar, inventory, tooltip, healthbars).
    UiAccent               accent{};
    ui::UiChip             chip{};
};

// card-mpmzs1j5/SA33 — pure helper. Parses a Markdown-flavoured
// text blob into HelpOverlay::DocLine entries:
// - `# heading` (exactly one leading `#`) → Heading1
// - `## subheading` (exactly two leading `#`) → Heading2
// - `keys :: action` → Shortcut
// - blank line → Spacer
// - anything else → Body (text stripped of trailing whitespace).
// Keeps the parser stateless + library-free so it can be exercised
// without an SFML window.
std::vector<HelpOverlay::DocLine> parseHelpMarkdown(const std::string& markdownText);

}
