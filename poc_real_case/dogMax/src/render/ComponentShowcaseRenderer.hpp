#pragma once
#include "render/EnemyShapeCatalog.hpp"
#include "render/ui/UiPanel.hpp"
#include "render/ui/UiTab.hpp"
#include "render/ui/UiTooltip.hpp"
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/System/Vector2.hpp>
#include <array>
#include <memory>
#include <string>
#include <vector>

namespace dof::loaders { class ConfigLoader; class ShaderLoader; }
namespace dof::render  { struct ColorTheme; struct UiState; class EffectsCatalogWindow; class GroupedEffectsCatalog; }

namespace dof::render {
struct ShowcaseDemo { sf::FloatRect rect; std::string tooltipTitle, tooltipBody; };

enum class ShowcaseIcon {
    Inventory = 0,
    LootFilter = 1,
    DiceCrafter = 2,
    Help = 3,
};

constexpr int kGalleryCategoryCount = 4;
constexpr int kShowcaseIconCount = 4;

// Everything the unified Gallery needs to draw all five sub-tabs in one pass.
// Bundled so the GameSession render call passes one struct instead of a long
// argument list (Effects needs the shader loader + ui view + elapsed time;
// Enemies needs the shape catalog; nav/scroll state lives in UiState).
struct GalleryContext {
    sf::Vector2f                        viewSize;
    const sf::View*                     uiView{nullptr};
    UiState*                            uiState{nullptr};
    const dof::loaders::ShaderLoader*   shaders{nullptr};
    float                               elapsed{0.0f};
    const std::vector<EnemyShapeSpec>*  enemyCatalog{nullptr};
    EffectsCatalogWindow*               effects{nullptr};
    GroupedEffectsCatalog*              groupedFx{nullptr};
};

// The unified Gallery window (Ctrl+H). Two-level tab nav:
//   category "Game Art" → Weapons | Enemies | Effects
//   category "UI Kit"   → Components | Fonts
//   category "Icons"    → Utility
// Replaces the former standalone Ctrl+W / Ctrl+E / Ctrl+S windows.
class ComponentShowcaseRenderer {
public:
    ComponentShowcaseRenderer(const dof::loaders::ConfigLoader& config,
                              const ColorTheme& theme, const sf::Font& defaultFont);
    void advance(sf::Vector2f mouseUi);
    void draw(sf::RenderWindow& window, const GalleryContext& ctx);
    // Hit-test the category + sub-tab strips and update nav in `uiState`.
    void handleClick(sf::Vector2f uiPoint, UiState& uiState);
    int  hoveredElement() const { return hoveredElement_; }
    int  fontCount()      const { return static_cast<int>(showcaseFonts_.size()); }
    // Category/sub-tab label tables (shared by draw and hit-test).
    static const std::vector<std::string>& categoryLabels();
    static const std::vector<std::string>& subTabLabels(int category);
    // Usage-slot labels for the Fonts tab "where used" multi-select panel.
    static const std::vector<std::string>& fontUsageLabels();

private:
    sf::FloatRect panelRect(sf::Vector2f viewSize) const;
    sf::FloatRect categoryStripRect(sf::FloatRect panel) const;
    sf::FloatRect subTabStripRect(sf::FloatRect panel) const;
    sf::FloatRect contentRect(sf::FloatRect panel) const;
    void drawComponentsTab(sf::RenderWindow& window, sf::FloatRect content, const sf::Font& font);
    void drawFontsTab(sf::RenderWindow& window, sf::FloatRect content, const sf::Font& font,
                      const GalleryContext& ctx);
    // Returns font-list row index at uiPoint (accounting for scroll), or -1.
    int hitTestFontRow(sf::FloatRect content, float scroll, sf::Vector2f uiPoint) const;
    // Returns usage-slot index at uiPoint in the right panel, or -1.
    int hitTestFontUsage(sf::FloatRect content, sf::Vector2f uiPoint) const;
    void drawWeaponsTab(sf::RenderWindow& window, sf::FloatRect content, const sf::Font& font,
                        UiState& us);
    void drawEnemiesTab(sf::RenderWindow& window, sf::FloatRect content, const sf::Font& font,
                        const std::vector<EnemyShapeSpec>& catalog, UiState& us);
    void drawIconsTab(sf::RenderWindow& window, sf::FloatRect content, const sf::Font& font);
    sf::FloatRect iconCardRect(sf::FloatRect content, int index) const;
    // Inner (third-level) tab strip at the top of the content area.
    sf::FloatRect innerTabRect(sf::FloatRect content) const;
    // Content area below the inner tab strip.
    sf::FloatRect innerContentRect(sf::FloatRect content) const;
    // Labels for the inner tabs (static so hit-test + draw share the same table).
    static const std::vector<std::string>& weaponsInnerLabels();
    static const std::vector<std::string>& enemiesInnerLabels();

    const dof::loaders::ConfigLoader& config_;
    int          hoveredCategory_{-1}, hoveredSubTab_{-1}, hoveredElement_{-1};
    sf::Vector2f mouseUi_, lastViewSize_;
    ui::UiPanel   panel_; ui::UiTab tabs_; ui::UiTooltip tooltip_;
    struct FontEntry { std::string name; std::unique_ptr<sf::Font> font; };
    struct IconCard { std::string icon; std::string title; std::string body; };
    std::vector<FontEntry> showcaseFonts_;
    const sf::Font*        defaultFont_;
    float panelW_{820.f}, panelH_{600.f}, tabHeight_{40.f}, padding_{14.f};
    float demoRows_{2.f}, demoCols_{3.f}, fontRowH_{34.f};
    float iconCardW_{164.f}, iconCardH_{170.f}, iconCardGap_{18.f}, iconBox_{68.f};
    unsigned iconFontSize_{22}, iconTitleFontSize_{13}, iconBodyFontSize_{11};
    std::string iconIntro_;
    std::array<IconCard, kShowcaseIconCount> iconCards_{};
    sf::Color shapeOutline_{120, 230, 245}, shapeFill_{30, 60, 75, 200};
    std::vector<ShowcaseDemo> demosThisFrame_;
    // Gallery-only weapon shapes (not tied to WeaponType gameplay).
    // Loaded from weapon_shapes_gallery.yaml in the constructor.
    std::vector<EnemyShapeSpec> weaponGalleryCatalog_;
};
} // namespace dof::render
