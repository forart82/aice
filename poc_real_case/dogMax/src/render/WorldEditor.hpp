#pragma once

#include "core/WorldEnvironment.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/System/Vector2.hpp>
#include <SFML/Window/Keyboard.hpp>
#include <SFML/Window/Mouse.hpp>

#include <optional>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace dof::loaders { class ConfigLoader; }
namespace sf { class Font; class RenderTarget; class RenderWindow; class View; }

namespace dof::render {

class WorldEnvironmentRenderer;
class WorldAssetGallery;

enum class WorldEditorTool {
    Select,
    Path,
    Zone,
    Stamp,
    Enemy,
};

enum class WorldEditorSelectionKind {
    None,
    Path,
    Zone,
    Stamp,
    Enemy,
};

class WorldEditor {
public:
    WorldEditor(dof::loaders::ConfigLoader& config,
                dof::core::WorldEnvironment& environment,
                const WorldEnvironmentRenderer& environmentRenderer,
                const sf::Font& font,
                std::function<void()> onEnvironmentChanged = {});
    ~WorldEditor();

    void openAt(sf::Vector2f focus);
    void close();
    bool isOpen() const { return isOpenValue; }
    void save();

    bool handleKey(sf::Keyboard::Key key, bool isControlHeld,
                   bool isShiftHeld, bool isAltHeld);
    bool handleMousePressed(sf::Mouse::Button button, sf::Vector2f worldPosition,
                            sf::Vector2f uiPosition, float cameraZoom);
    bool handleMouseMoved(sf::Vector2f worldPosition, sf::Vector2f uiPosition,
                          float cameraZoom);
    bool handleMouseReleased(sf::Mouse::Button button);
    bool handleWheel(float delta, bool isControlHeld,
                     bool isShiftHeld, bool isAltHeld);
    void handleTextEntered(char32_t unicode);
    void updateCamera(float deltaSeconds, float cameraZoom);

    void drawWorldOverlay(sf::RenderTarget& target, const sf::View& worldView) const;
    void drawPanel(sf::RenderWindow& window, sf::Vector2u uiSize) const;
    bool consumeHelpRequest();

    sf::Vector2f cameraFocus() const { return cameraFocusValue; }
    bool isPointerOverPanel(sf::Vector2f uiPosition, sf::Vector2u uiSize) const;
    bool isPointerOverEditorUi(sf::Vector2f uiPosition, sf::Vector2u uiSize) const;

private:
    struct Selection {
        WorldEditorSelectionKind kind{WorldEditorSelectionKind::None};
        int objectIndex{-1};
        int pointIndex{-1};
    };

    void selectAt(sf::Vector2f worldPosition, float cameraZoom);
    void selectAllObjects();
    void selectInsideMarquee();
    void clearSelections();
    bool isObjectSelected(WorldEditorSelectionKind kind, int objectIndex) const;
    std::vector<Selection> selectedObjects() const;
    void addPathPoint(sf::Vector2f worldPosition);
    void addZonePoint(sf::Vector2f worldPosition);
    void addStamp(sf::Vector2f worldPosition);
    void addAssetStamp(const std::string& assetPath, sf::Vector2f worldPosition);
    void addEnemy(sf::Vector2f worldPosition);
    void finishDraft();
    void cancelDraft();
    void deleteSelection();
    void duplicateSelection();
    void insertPointAtCursor();
    void cycleMaterial(int direction);
    void cycleStampCatalog(int direction);
    void cycleZoneKind(int direction);
    void cycleEnemyKind(int direction);
    void adjustPrimary(float direction, bool adjustsSecondary);
    void adjustAlpha(int direction);
    void adjustRotation(float direction);
    void adjustLayer(int direction);
    void adjustCollision(float direction);
    void toggleWalkable();
    void toggleCollision();
    void flipSelection();

    void beginChange();
    void endChange();
    void undo();
    void redo();
    bool writeProjectEnvironmentFile();
    void restoreSaved();
    void clearSelectionIfInvalid();

    sf::Vector2f snap(sf::Vector2f value) const;
    sf::Vector2f snapDragDelta(sf::Vector2f rawDelta, float cameraZoom) const;
    float pickRadius(float cameraZoom) const;
    std::string selectionSummary() const;
    sf::FloatRect panelRect(sf::Vector2u uiSize) const;
    sf::FloatRect menuBarRect(sf::Vector2u uiSize) const;
    sf::FloatRect menuHeaderRect(std::size_t index, sf::Vector2u uiSize) const;
    sf::FloatRect menuItemRect(std::size_t menu, std::size_t item,
                               sf::Vector2u uiSize) const;
    sf::FloatRect toolBarRect(sf::Vector2u uiSize) const;
    sf::FloatRect toolButtonRect(std::size_t index, sf::Vector2u uiSize) const;
    sf::FloatRect inlineHelpRect(sf::Vector2u uiSize) const;
    int maximumInlineHelpScroll(sf::Vector2u uiSize) const;
    void activateTool(WorldEditorTool selectedTool);

    dof::loaders::ConfigLoader& configRef;
    dof::core::WorldEnvironment& environmentRef;
    const WorldEnvironmentRenderer& environmentRendererRef;
    const sf::Font& fontRef;
    std::unique_ptr<WorldAssetGallery> assetGallery;
    std::function<void()> onEnvironmentChangedCallback;

    bool isOpenValue{false};
    WorldEditorTool tool{WorldEditorTool::Select};
    Selection selection;
    std::vector<Selection> additionalSelections;
    bool isDragging{false};
    bool isMarqueeSelecting{false};
    bool isPanning{false};
    bool isDrafting{false};
    bool isSnapEnabled{false};
    bool isGridVisible{true};
    bool isOverlayVisible{true};
    bool isGalleryDragging{false};
    bool isWalkabilityLayerVisible{false};
    bool isCollisionLayerVisible{false};
    bool isHelpRequested{false};
    int openMenuIndex{-1};
    int inlineHelpScrollRow{0};
    int currentMaterialIndex{0};
    int currentStampCatalogIndex{0};
    int currentEnemyKindIndex{0};
    dof::core::WorldZoneKind currentZoneKind{dof::core::WorldZoneKind::Ground};
    sf::Vector2f cursorWorld{};
    sf::Vector2f cursorUi{};
    sf::Vector2f cameraFocusValue{};
    sf::Vector2f panAnchorWorld{};
    sf::Vector2f dragStartWorld{};
    sf::Vector2f marqueeStartWorld{};
    sf::Vector2f marqueeEndWorld{};
    float currentCameraZoom{1.0f};
    std::optional<dof::core::WorldEnvironmentState> pendingChange;
    std::optional<dof::core::WorldEnvironmentState> draftStartState;
    dof::core::WorldEnvironmentState savedState;
    std::vector<dof::core::WorldEnvironmentState> undoStates;
    std::vector<dof::core::WorldEnvironmentState> redoStates;
    std::string status{"Ready"};
    std::string draggedAssetPath;
    std::string activeGalleryAssetPath;
    std::string currentPathAtlasAssetPath;

    float panelWidth{520.0f};
    float panelHeight{300.0f};
    float panelMargin{18.0f};
    float panelPadding{18.0f};
    float galleryStampWorldWidth{900.0f};
    float galleryFloorWorldSize{900.0f};
    float enemyMarkerRadius{85.0f};
    float cameraMoveSpeed{1400.0f};
    float cameraFastMultiplier{3.0f};
    float titleFontSize{22.0f};
    float textFontSize{15.0f};
    float lineSpacing{5.0f};
    float inlineHelpRowHeight{19.0f};
    float gridSize{250.0f};
    float magnetSnapPixels{12.0f};
    float pickRadiusPixels{16.0f};
    float handleRadiusPixels{7.0f};
    float pathWidthStep{40.0f};
    float featherStep{20.0f};
    float stampScaleStep{0.1f};
    float rotationStepDegrees{15.0f};
    float collisionStep{25.0f};
    int alphaStep{16};
    int maximumHistory{64};
    int maximumGridLines{160};
    sf::Color panelColor{8, 12, 18, 235};
    sf::Color accentColor{0, 220, 255, 255};
    sf::Color textColor{220, 235, 240, 255};
    sf::Color dimColor{120, 145, 155, 255};
    sf::Color selectedColor{255, 190, 50, 255};
    sf::Color pathColor{80, 220, 255, 220};
    sf::Color zoneColor{80, 255, 150, 190};
    sf::Color collisionColor{255, 70, 80, 180};
    sf::Color walkableColor{50, 255, 125, 105};
    sf::Color nonWalkableColor{255, 115, 45, 105};
    sf::Color gridColor{65, 90, 100, 65};
};

} // namespace dof::render
