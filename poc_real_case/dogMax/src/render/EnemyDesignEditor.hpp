#pragma once

#include "entities/EnemyTemplate.hpp"
#include "loaders/EnemyTemplateLoader.hpp"
#include "render/EnemyDesignEditorShared.hpp"

#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderTexture.hpp>
#include <SFML/System/Vector2.hpp>

#include <string>
#include <vector>

namespace dof::loaders { class ShaderLoader; class ConfigLoader; }
namespace dof::render  { class WorldRenderer; }
namespace sf           { class RenderWindow; class View; }

namespace dof::render {

struct UiState;

// Ctrl+E Enemy Design Editor. A modal panel that edits one
// entities::EnemyTemplate at a time (body shape/size/colours per tier and
// the stack of effect layers) and pushes every change live to the
// WorldRenderer so on-screen enemies update immediately. Save serialises
// the edited template back to its YAML and syncs the build copy.
//
// All transient panel state (which type/tier/layer is selected, scroll
// offsets, the shader-picker and saved-flash flags) lives in UiState so
// this object stays render-stateless apart from the working copy of the
// template being edited and the per-frame hit-test rects.
class EnemyDesignEditor {
public:
    EnemyDesignEditor(const sf::Font& font,
                      const dof::loaders::ConfigLoader& config,
                      WorldRenderer& worldRenderer,
                      const dof::loaders::ShaderLoader& shaders,
                      const std::string& templateDir,
                      const std::string& buildTemplateDir,
                      float previewSize = 240.f);

    void render(sf::RenderWindow& window, UiState& uiState,
                const sf::View& uiView, sf::Vector2f viewSize, float elapsed);

    void handleClick(sf::Vector2f uiPos, UiState& uiState);
    void handleScroll(float delta, UiState& uiState);

private:
    // Sync currentEdit to the WorldRenderer so live enemies update.
    void pushEdit();
    // Load the template at typeIndex into currentEdit.
    void loadType(int typeIndex);
    // Get the EnemyTierDesign& for the given tier selection (0/1/2).
    dof::entities::EnemyTierDesign& currentTierDesign(int tierIndex);

    // Rendering helpers (renderLayerList/renderShaderPicker live in
    // EnemyDesignEditor_Layers.cpp; renderPreview in
    // EnemyDesignEditor_Preview.cpp) so list/layer/preview responsibilities
    // stay separate.
    void renderTypeList(sf::RenderWindow& window, const sf::View& uiView,
                        UiState& uiState, sf::FloatRect listRect);
    void renderBodyControls(sf::RenderWindow& window, UiState& uiState,
                            sf::FloatRect controlsRect);
    // Draws the live enemy body preview into previewTexture_ and blits it.
    void renderPreview(sf::RenderWindow& window, float elapsed);
    void renderLayerList(sf::RenderWindow& window, const sf::View& uiView,
                         UiState& uiState, sf::FloatRect listRect, float elapsed);
    void renderShaderPicker(sf::RenderWindow& window, UiState& uiState,
                            sf::FloatRect pickerRect);
    // Click handling for the layer column (list items, add/remove, per-layer
    // +/- controls). Implemented in EnemyDesignEditor_Layers.cpp.
    void handleLayerClick(sf::Vector2f uiPos, UiState& uiState);

    const sf::Font&                    fontRef;
    // Canonical editor chrome palette, loaded once in the ctor from config.
    editor::EditorPalette              palette_;
    WorldRenderer&                     worldRendererRef;
    const dof::loaders::ShaderLoader&  shadersRef;
    const std::string                  templateDir;
    const std::string                  buildTemplateDir;
    float                              previewSize_{240.f};
    sf::FloatRect                      previewRect_{};
    sf::RenderTexture                  previewTexture_;

    // The list of type IDs from the registry (sorted alphabetically).
    std::vector<std::string> typeIds;
    // The currently-edited template copy.
    dof::entities::EnemyTemplate currentEdit;
    int currentTypeIndex{-1};  // -1 = not loaded yet
    // Selected tier tab (0 = Common, 1 = Uncommon, 2 = Rare). Owned here
    // (not in UiState) so the editor controls its own tier selection.
    int currentTierIndex{0};

    // Click hit-test rects (rebuilt each render, used by handleClick).
    struct ButtonRects {
        // Type list items.
        std::vector<sf::FloatRect> typeListItems;
        // Tier tabs.
        sf::FloatRect tierCommon;
        sf::FloatRect tierUncommon;
        sf::FloatRect tierRare;
        // Body +/- buttons (indexed as 0=shapeInc, 1=shapeDec, 2=sizeInc,
        //   3=sizeDec, 4=outlineRInc, 5=outlineRDec, 6=outlineGInc,
        //   7=outlineGDec, 8=outlineBInc, 9=outlineBDec, 10=fillRInc,
        //   11=fillRDec, 12=fillGInc, 13=fillGDec, 14=fillBInc, 15=fillBDec).
        std::vector<sf::FloatRect> bodyButtons;
        // Layer list items.
        std::vector<sf::FloatRect> layerItems;
        sf::FloatRect addLayerButton;
        // Per-selected-layer controls (paired inc/dec like bodyButtons).
        std::vector<sf::FloatRect> layerButtons;
        sf::FloatRect removeLayerButton;
        // Shader picker items.
        std::vector<sf::FloatRect> shaderPickerItems;
        sf::FloatRect shaderPickerClose;
        // Save button.
        sf::FloatRect saveButton;
        // Close button.
        sf::FloatRect closeButton;
    };
    ButtonRects rects;

    // Geometry shared by render + handleClick so the two stay in lockstep.
    sf::FloatRect typeListRect_;
    sf::FloatRect layerListRect_;
    // The clipped scroll viewport of the layer list (subset of layerListRect_).
    // Guards layer-item selection so items scrolled out of view aren't clicked.
    sf::FloatRect layerScrollRect_;
};

} // namespace dof::render
