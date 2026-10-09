#pragma once

#include "entities/PowderColor.hpp"
#include "hubs/DiceCrafterHub.hpp"
#include "render/ui/UiPanel.hpp"
#include "render/ui/UiButton.hpp"
#include "render/ui/UiCell.hpp"
#include "render/ui/UiChip.hpp"
#include "render/ui/UiLabel.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/System/Vector2.hpp>

#include <string>
#include <vector>

namespace dof::loaders  { class ConfigLoader; }
namespace dof::hubs     { class PowderHub; }
namespace dof::helpers { class DeterministicRandom; using RandomHelper = DeterministicRandom; }
namespace sf            { class RenderWindow; }

namespace dof::render {

// Clickable button descriptor used by DiceCrafterPanel hit-testing.
struct DiceCrafterButton {
    sf::FloatRect              rect;
    bool                       isEnabled{false};
    std::string                label;
    dof::entities::PowderColor powderColor{dof::entities::PowderColor::Red};
};

// Geometry computed once from config each frame; owned by DiceCrafterPanel.
struct DiceCrafterLayout {
    sf::FloatRect panelRect;
    sf::FloatRect titleRect;
    sf::FloatRect slotRect;
    // Bounded region the face cells are laid out within and clipped to. Cells
    // never leave this rect, so they can never draw over the buttons below it.
    sf::FloatRect faceGridClipRect;
    // Face-value cells (up to 100; only faceCount() are valid). Sized/columnized
    // to fit faceGridClipRect (a d100 shrinks cells and adds columns as needed).
    std::vector<sf::FloatRect> faceCells;
    // One REFACE button per available powder tier (native + higher).
    std::vector<DiceCrafterButton> refaceButtons;
    // One EVOLVE button (requires next-tier powder).
    DiceCrafterButton evolveButton;
    sf::FloatRect resultRect;
    sf::FloatRect footerRect;
};

struct UiState;

class DiceCrafterPanel {
public:
    explicit DiceCrafterPanel(const dof::loaders::ConfigLoader& config,
                        const sf::Font& font);

    // `selectedFaceIndex`: 1-based face the player has selected (-1 = none).
    // REFACE buttons render dimmed and are hit-test-blocked when -1.
    // Receives `uiState` to enable mouse hover hit-testing on the panel's internal components,
    // bringing dynamic feedback states (hover highlights) inline with the core UI kit design principles.
    void render(sf::RenderWindow& window,
                const dof::hubs::DiceCrafterHub& DiceCrafter,
                const dof::hubs::PowderHub& powder,
                const std::string& lastResultText,
                const UiState& uiState,
                int selectedFaceIndex = -1) const;

    // Hit-test a cursor position (UI design coords).
    // Returns index into the reface powder order, or -1.
    int  refaceButtonIndexAt(sf::Vector2f cursor) const;
    bool evolveButtonHit(sf::Vector2f cursor) const;
    bool slotHit(sf::Vector2f cursor) const;
    // Returns 1-based face cell index under cursor, or -1.
    int  faceCellIndexAt(sf::Vector2f cursor) const;

    // Rebuild layout from config (call once after construction or config reload).
    void buildLayout(const dof::hubs::DiceCrafterHub& DiceCrafter);

    sf::FloatRect panelRect() const { return layout.panelRect; }

private:
    const dof::loaders::ConfigLoader& configRef;
    const sf::Font&                   fontRef;
    mutable DiceCrafterLayout          layout;

    // Single-accent chrome tokens, resolved ONCE from config in the ctor and
    // reused by every draw method so the panel chrome reads as one accent set.
    sf::Color accentColor;
    sf::Color accentDimColor;
    sf::Color panelBgColor;
    sf::Color textColor;
    sf::Color textDimColor;

    // -------------------------------------------------------------------------------------
    // Reusable UI Kit components matching those showcased in the Ctrl+H window.
    // Replaces the old procedural drawRect/drawText helpers with standard styling.
    // - panel: hosts the outer container boundary using configured border/background theme values.
    // - slotCell: renders the central drag-and-drop dice slot with active border feedback.
    // - faceCell: renders the individual numeric face grid cells, highlighting selected targets.
    // - button: handles both REFACE option rows and the EVOLVE action buttons.
    // - titleLabel / textLabel / resultLabel: manage structured typography alignment.
    // -------------------------------------------------------------------------------------
    ui::UiPanel  panel;
    ui::UiChip   titleChip;
    ui::UiCell   slotCell;
    ui::UiCell   faceCell;
    ui::UiButton button;
    ui::UiLabel  titleLabel;
    bool         glowEnabled{true};
    float        glowSpread{10.0f};
    int          glowLayers{5};
    float        glowAlpha{70.0f};
    ui::UiLabel  textLabel;
    ui::UiLabel  resultLabel;

    void drawBackground(sf::RenderWindow& window) const;
    void drawSlot(sf::RenderWindow& window,
                  const dof::hubs::DiceCrafterHub& DiceCrafter,
                  const UiState& uiState) const;
    void drawFaceCells(sf::RenderWindow& window,
                       const dof::hubs::DiceCrafterHub& DiceCrafter,
                       const UiState& uiState,
                       int selectedFaceIndex) const;
    void drawRefaceButtons(sf::RenderWindow& window,
                           const dof::hubs::PowderHub& powder,
                           const UiState& uiState,
                           bool hasSelection) const;
    void drawEvolveButton(sf::RenderWindow& window,
                          const dof::hubs::DiceCrafterHub& DiceCrafter,
                          const dof::hubs::PowderHub& powder,
                          const UiState& uiState) const;
    void drawResultText(sf::RenderWindow& window,
                        const std::string& text) const;
    void drawActionFooter(sf::RenderWindow& window) const;
};

}
