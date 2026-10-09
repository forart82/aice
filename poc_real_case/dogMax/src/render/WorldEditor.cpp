#include "render/WorldEditor.hpp"

#include "loaders/ConfigLoader.hpp"
#include "render/WorldAssetGallery.hpp"
#include "render/WorldEnvironmentRenderer.hpp"

#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderTarget.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Text.hpp>
#include <SFML/Graphics/VertexArray.hpp>
#include <SFML/Graphics/View.hpp>

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <limits>
#include <sstream>

namespace dof::render {

namespace {

float distanceSquared(sf::Vector2f a, sf::Vector2f b) {
    const auto delta = a - b;
    return delta.x * delta.x + delta.y * delta.y;
}

sf::Vector2f closestPointOnSegment(sf::Vector2f point,
                                   sf::Vector2f start,
                                   sf::Vector2f end) {
    const auto segment = end - start;
    const float lengthSquared = segment.x * segment.x + segment.y * segment.y;
    if (lengthSquared <= 0.0f) return start;
    const auto relative = point - start;
    const float ratio = std::clamp(
        (relative.x * segment.x + relative.y * segment.y) / lengthSquared,
        0.0f, 1.0f);
    return start + segment * ratio;
}

bool isPointInsidePolygon(sf::Vector2f point,
                          const std::vector<sf::Vector2f>& polygon) {
    if (polygon.size() < 3u) return false;
    bool isInside = false;
    for (std::size_t index = 0, previous = polygon.size() - 1u;
         index < polygon.size(); previous = index++) {
        const auto& a = polygon[index];
        const auto& b = polygon[previous];
        const bool crosses = (a.y > point.y) != (b.y > point.y);
        if (crosses && point.x < (b.x - a.x) * (point.y - a.y)
                                 / (b.y - a.y) + a.x) {
            isInside = !isInside;
        }
    }
    return isInside;
}

void drawLineStrip(sf::RenderTarget& target,
                   const std::vector<sf::Vector2f>& points,
                   bool isClosed,
                   sf::Color color) {
    if (points.size() < 2u) return;
    sf::VertexArray vertices(sf::PrimitiveType::LineStrip);
    vertices.resize(points.size() + (isClosed ? 1u : 0u));
    for (std::size_t index = 0; index < points.size(); ++index) {
        vertices[index].position = points[index];
        vertices[index].color = color;
    }
    if (isClosed) {
        vertices[points.size()].position = points.front();
        vertices[points.size()].color = color;
    }
    target.draw(vertices);
}

void drawPolygonCoverage(sf::RenderTarget& target,
                         const std::vector<sf::Vector2f>& points,
                         sf::Color color) {
    const auto indices = dof::core::triangulateWorldPolygon(points);
    if (indices.empty()) return;
    sf::VertexArray triangles(sf::PrimitiveType::Triangles, indices.size());
    for (std::size_t index = 0; index < indices.size(); ++index) {
        triangles[index] = {points[indices[index]], color};
    }
    target.draw(triangles);
}

void drawPathCoverage(sf::RenderTarget& target,
                      const dof::core::WorldPathDefinition& path,
                      const std::vector<sf::Vector2f>& points,
                      sf::Color color) {
    if (points.size() < 2u) return;
    sf::VertexArray triangles(sf::PrimitiveType::Triangles);
    const float halfWidth = path.width * 0.5f;
    for (std::size_t index = 0; index + 1u < points.size(); ++index) {
        const auto delta = points[index + 1u] - points[index];
        const float length = std::sqrt(delta.x * delta.x + delta.y * delta.y);
        if (length <= 0.0f) continue;
        const sf::Vector2f normal{-delta.y / length * halfWidth,
                                   delta.x / length * halfWidth};
        const sf::Vertex vertices[6]{
            {points[index] - normal, color}, {points[index + 1u] - normal, color},
            {points[index + 1u] + normal, color}, {points[index] - normal, color},
            {points[index + 1u] + normal, color}, {points[index] + normal, color}};
        for (const auto& vertex : vertices) {
            const auto output = triangles.getVertexCount();
            triangles.resize(output + 1u);
            triangles[output] = vertex;
        }
    }
    target.draw(triangles);
}

const char* toolName(WorldEditorTool tool) {
    switch (tool) {
        case WorldEditorTool::Select: return "SELECT";
        case WorldEditorTool::Path: return "PATH";
        case WorldEditorTool::Zone: return "ZONE";
        case WorldEditorTool::Stamp: return "STAMP";
        case WorldEditorTool::Enemy: return "ENEMY";
    }
    return "SELECT";
}

constexpr const char* enemyTypeIds[7]{
    "regular", "shocker", "glasswraith", "hexarchon",
    "tassideansentinel", "voidcrawler", "pactwalker"};
constexpr const char* enemyTypeLabels[7]{
    "Regular", "Shocker", "Glasswraith", "Hexarchon",
    "Tassidean Sentinel", "Voidcrawler", "Pact-Walker"};

bool haveSameEnemyDefinitions(
        const std::vector<dof::core::WorldEnemyDefinition>& left,
        const std::vector<dof::core::WorldEnemyDefinition>& right) {
    if (left.size() != right.size()) return false;
    for (std::size_t index = 0; index < left.size(); ++index) {
        if (left[index].name != right[index].name
            || left[index].typeId != right[index].typeId
            || left[index].position != right[index].position
            || left[index].level != right[index].level
            || left[index].tier != right[index].tier) return false;
    }
    return true;
}

struct InlineHelpRow {
    const char* keys;
    const char* action;
    bool isCategory;
};

std::vector<InlineHelpRow> contextualHelpRows(WorldEditorTool tool,
                                              WorldEditorSelectionKind kind,
                                              std::size_t selectedCount,
                                              bool isPointSelected) {
    std::vector<InlineHelpRow> rows;
    if (selectedCount > 1u) {
        rows.insert(rows.end(), {
            {"MULTI-SELECTION", "", true},
            {"LMB drag", "Move the complete group", false},
            {"Alt+D", "Duplicate / Shift: delete all", false},
            {"Alt+A", "Opacity + / Shift: -", false},
            {"Alt+L", "Layer + / Shift: -", false},
            {"Alt+W", "Walkability for compatible items", false},
            {"Alt+C", "Collision for compatible items", false},
            {"Alt+M", "Environment style + / Shift: -", false},
        });
    } else if (kind == WorldEditorSelectionKind::Path) {
        rows.insert(rows.end(), {
            {isPointSelected ? "SELECTED PATH POINT" : "SELECTED PATH", "", true},
            {"LMB drag", isPointSelected ? "Move this control point" : "Move the path", false},
            {"Alt+P", "Continue path / Shift: new path", false},
            {"Alt+E", "Width + / Shift: -", false},
            {"Alt+J", "Feather + / Shift: -", false},
            {"Alt+M", "Environment style next / Shift: previous", false},
            {"Alt+X", "Shift: insert nearest point", false},
            {"Gallery image", "Apply compatible 6x6 atlas", false},
            {"Alt+D", "Duplicate / Shift: delete", false},
        });
    } else if (kind == WorldEditorSelectionKind::Zone) {
        rows.insert(rows.end(), {
            {isPointSelected ? "SELECTED ZONE POINT" : "SELECTED ZONE", "", true},
            {"LMB drag", isPointSelected ? "Move this boundary point" : "Move the complete zone", false},
            {"Alt+Y", "Zone type next / Shift: previous", false},
            {"Alt+M", "Environment style next / Shift: previous", false},
            {"Alt+J", "Feather + / Shift: -", false},
            {"Alt+L", "Z-order + / Shift: -", false},
            {"Alt+A", "Opacity + / Shift: -", false},
            {"Alt+W", "Toggle walkability", false},
            {"Alt+C", "Toggle blocking", false},
            {"Gallery image", "Apply repeating floor", false},
            {"Alt+D", "Duplicate / Shift: delete", false},
        });
    } else if (kind == WorldEditorSelectionKind::Stamp) {
        rows.insert(rows.end(), {
            {"SELECTED STAMP", "", true},
            {"LMB drag", "Move the stamp", false},
            {"Alt+E", "Uniform size + / Shift: -", false},
            {"Alt+J", "Height + / Shift: -", false},
            {"Alt+R", "Rotate right / Shift: left", false},
            {"Alt+X", "Mirror horizontally", false},
            {"Alt+K", "Collision radius + / Shift: -", false},
            {"Alt+L", "Layer + / Shift: -", false},
            {"Alt+A", "Opacity + / Shift: -", false},
            {"Alt+D", "Duplicate / Shift: delete", false},
        });
    } else if (kind == WorldEditorSelectionKind::Enemy) {
        rows.insert(rows.end(), {
            {"SELECTED ENEMY", "", true},
            {"LMB drag", "Move the enemy spawn", false},
            {"Alt+N", "Enemy kind next / Shift: previous", false},
            {"Alt+D", "Duplicate / Shift: delete", false},
        });
    }

    if (tool == WorldEditorTool::Select) {
        rows.insert(rows.end(), {
            {"SELECT TOOL", "", true},
            {"LMB", "Select an object or control point", false},
            {"LMB empty drag", "Marquee-select intersecting items", false},
            {"Alt+Shift+V", "Select every world object", false},
        });
    } else if (tool == WorldEditorTool::Path) {
        rows.insert(rows.end(), {
            {"PATH TOOL", "", true},
            {"LMB", "Add the next path point", false},
            {"RMB / Alt+F", "Finish the path", false},
            {"Alt+Shift+P", "Start a separate new path", false},
        });
    } else if (tool == WorldEditorTool::Zone) {
        rows.insert(rows.end(), {
            {"ZONE TOOL", "", true},
            {"LMB empty", "Start or extend a zone", false},
            {"LMB on zone", "Move its point or complete shape", false},
            {"RMB / Alt+F", "Finish the zone", false},
        });
    } else if (tool == WorldEditorTool::Stamp) {
        rows.insert(rows.end(), {
            {"STAMP TOOL", "", true},
            {"LMB", "Place the current stamp", false},
            {"Alt+N", "Next stamp / Shift: previous", false},
            {"Gallery image", "Choose a persistent image brush", false},
        });
    } else {
        rows.insert(rows.end(), {
            {"ENEMY TOOL", "", true},
            {"LMB", "Place the current enemy kind", false},
            {"Alt+N", "Enemy kind next / Shift: previous", false},
            {"Alt+Shift+T", "Activate enemy placement", false},
        });
    }
    rows.insert(rows.end(), {
        {"WORKFLOW", "", true},
        {"Alt+U", "Undo / Shift: redo", false},
        {"Alt+S", "Save / Shift: restore", false},
        {"Alt+H / F1", "Open complete Help", false},
        {"Alt+Q", "Close WorldEditor", false},
    });
    return rows;
}

sf::Color byteColor(const dof::loaders::ConfigLoader& config,
                    const std::string& prefix) {
    return sf::Color{
        static_cast<std::uint8_t>(config.getInt(prefix + "_R")),
        static_cast<std::uint8_t>(config.getInt(prefix + "_G")),
        static_cast<std::uint8_t>(config.getInt(prefix + "_B")),
        static_cast<std::uint8_t>(config.getInt(prefix + "_A"))};
}

std::string zoneColorPrefix(dof::core::WorldZoneKind kind) {
    switch (kind) {
        case dof::core::WorldZoneKind::Ground: return "WORLD_EDITOR_ZONE_GROUND_COLOR";
        case dof::core::WorldZoneKind::Forest: return "WORLD_EDITOR_ZONE_FOREST_COLOR";
        case dof::core::WorldZoneKind::Water: return "WORLD_EDITOR_ZONE_WATER_COLOR";
        case dof::core::WorldZoneKind::Field: return "WORLD_EDITOR_ZONE_FIELD_COLOR";
        case dof::core::WorldZoneKind::Blocked: return "WORLD_EDITOR_ZONE_BLOCKED_COLOR";
    }
    return "WORLD_EDITOR_ZONE_GROUND_COLOR";
}

}

WorldEditor::WorldEditor(dof::loaders::ConfigLoader& config,
                         dof::core::WorldEnvironment& environment,
                         const WorldEnvironmentRenderer& environmentRenderer,
                         const sf::Font& font,
                         std::function<void()> onEnvironmentChanged)
    : configRef(config), environmentRef(environment),
      environmentRendererRef(environmentRenderer), fontRef(font),
      assetGallery(std::make_unique<WorldAssetGallery>(config, font)),
      onEnvironmentChangedCallback(std::move(onEnvironmentChanged)) {
    savedState = environmentRef.state();
    panelWidth = config.getFloat("WORLD_EDITOR_PANEL_WIDTH");
    panelHeight = config.getFloat("WORLD_EDITOR_PANEL_HEIGHT");
    panelMargin = config.getFloat("WORLD_EDITOR_PANEL_MARGIN");
    panelPadding = config.getFloat("WORLD_EDITOR_PANEL_PADDING");
    galleryStampWorldWidth = config.getFloat("WORLD_EDITOR_GALLERY_STAMP_WORLD_WIDTH");
    galleryFloorWorldSize = config.getFloat("WORLD_EDITOR_GALLERY_FLOOR_WORLD_SIZE");
    enemyMarkerRadius = config.getFloat("WORLD_EDITOR_ENEMY_MARKER_RADIUS");
    currentPathAtlasAssetPath = config.getString(
        "WORLD_EDITOR_DEFAULT_PATH_ATLAS_ASSET");
    cameraMoveSpeed = config.getFloat("WORLD_EDITOR_CAMERA_MOVE_SPEED");
    cameraFastMultiplier = config.getFloat("WORLD_EDITOR_CAMERA_FAST_MULTIPLIER");
    titleFontSize = config.getFloat("WORLD_EDITOR_TITLE_FONT_SIZE");
    textFontSize = config.getFloat("WORLD_EDITOR_TEXT_FONT_SIZE");
    lineSpacing = config.getFloat("WORLD_EDITOR_LINE_SPACING");
    inlineHelpRowHeight = config.getFloat("WORLD_EDITOR_INLINE_HELP_ROW_HEIGHT");
    gridSize = config.getFloat("WORLD_EDITOR_GRID_SIZE");
    magnetSnapPixels = config.getFloat("WORLD_EDITOR_MAGNET_SNAP_PIXELS");
    pickRadiusPixels = config.getFloat("WORLD_EDITOR_PICK_RADIUS_PIXELS");
    handleRadiusPixels = config.getFloat("WORLD_EDITOR_HANDLE_RADIUS_PIXELS");
    pathWidthStep = config.getFloat("WORLD_EDITOR_PATH_WIDTH_STEP");
    featherStep = config.getFloat("WORLD_EDITOR_FEATHER_STEP");
    stampScaleStep = config.getFloat("WORLD_EDITOR_STAMP_SCALE_STEP");
    rotationStepDegrees = config.getFloat("WORLD_EDITOR_ROTATION_STEP_DEGREES");
    collisionStep = config.getFloat("WORLD_EDITOR_COLLISION_STEP");
    alphaStep = config.getInt("WORLD_EDITOR_ALPHA_STEP");
    maximumHistory = config.getInt("WORLD_EDITOR_HISTORY_LIMIT");
    maximumGridLines = config.getInt("WORLD_EDITOR_GRID_LINE_LIMIT");
    isSnapEnabled = config.getInt("WORLD_EDITOR_SNAP_ENABLED_DEFAULT") != 0;
    isGridVisible = config.getInt("WORLD_EDITOR_GRID_VISIBLE_DEFAULT") != 0;
    isWalkabilityLayerVisible =
        config.getInt("WORLD_EDITOR_WALKABILITY_LAYER_VISIBLE_DEFAULT") != 0;
    isCollisionLayerVisible =
        config.getInt("WORLD_EDITOR_COLLISION_LAYER_VISIBLE_DEFAULT") != 0;
    panelColor = byteColor(config, "WORLD_EDITOR_PANEL_COLOR");
    accentColor = byteColor(config, "WORLD_EDITOR_ACCENT_COLOR");
    textColor = byteColor(config, "WORLD_EDITOR_TEXT_COLOR");
    dimColor = byteColor(config, "WORLD_EDITOR_DIM_COLOR");
    selectedColor = byteColor(config, "WORLD_EDITOR_SELECTED_COLOR");
    pathColor = byteColor(config, "WORLD_EDITOR_PATH_COLOR");
    zoneColor = byteColor(config, "WORLD_EDITOR_ZONE_COLOR");
    collisionColor = byteColor(config, "WORLD_EDITOR_COLLISION_COLOR");
    walkableColor = byteColor(config, "WORLD_EDITOR_WALKABLE_COLOR");
    nonWalkableColor = byteColor(config, "WORLD_EDITOR_NON_WALKABLE_COLOR");
    gridColor = byteColor(config, "WORLD_EDITOR_GRID_COLOR");
    for (auto iterator = environmentRef.state().stamps.rbegin();
         iterator != environmentRef.state().stamps.rend(); ++iterator) {
        if (!iterator->assetPath.empty()) assetGallery->markUsed(iterator->assetPath);
    }
}

WorldEditor::~WorldEditor() = default;

void WorldEditor::openAt(sf::Vector2f focus) {
    isOpenValue = true;
    cameraFocusValue = focus;
    cursorWorld = focus;
    selectAt(focus, configRef.getFloat("CAMERA_ZOOM_DEFAULT"));
    status = "World paused for live authoring";
}

void WorldEditor::close() {
    if (isDragging) {
        isDragging = false;
        endChange();
    }
    cancelDraft();
    pendingChange.reset();
    isOpenValue = false;
    isDragging = false;
    isMarqueeSelecting = false;
    isPanning = false;
    isGalleryDragging = false;
    draggedAssetPath.clear();
}

bool WorldEditor::consumeHelpRequest() {
    const bool wasRequested = isHelpRequested;
    isHelpRequested = false;
    return wasRequested;
}

void WorldEditor::activateTool(WorldEditorTool selectedTool) {
    cancelDraft();
    tool = selectedTool;
    inlineHelpScrollRow = 0;
    if (tool == WorldEditorTool::Select) status = "Select, marquee, or drag objects";
    else if (tool == WorldEditorTool::Path) status = "Click to draw a new path";
    else if (tool == WorldEditorTool::Zone) {
        status = "Click empty space to draw; drag an existing zone to move";
    } else if (tool == WorldEditorTool::Stamp) status = "Click to place a scenery stamp";
    else status = "Click to place an authored enemy";
}

bool WorldEditor::handleKey(sf::Keyboard::Key key, bool /*isControlHeld*/,
                            bool isShiftHeld, bool isAltHeld) {
    using K = sf::Keyboard::Key;
    if (!isOpenValue) return false;
    if (assetGallery->isSearchFocused()) {
        return assetGallery->handleSearchKey(static_cast<int>(key));
    }
    if (!isAltHeld) return true;

    // Keyboard commands are allowed while the mouse button is held. Finish the
    // drag transaction first so undo/redo and destructive commands never reuse
    // its snapshot against a different environment state.
    if (isDragging) {
        isDragging = false;
        endChange();
    }

    const auto cancelCurrentAction = [&] {
        if (!activeGalleryAssetPath.empty()) {
            activeGalleryAssetPath.clear();
            isGalleryDragging = false;
            draggedAssetPath.clear();
        } else if (isGalleryDragging) {
            isGalleryDragging = false;
            draggedAssetPath.clear();
        } else if (isDrafting) cancelDraft();
        else clearSelections();
        status = "Cancelled";
    };

    if (key == K::A) { adjustAlpha(isShiftHeld ? -1 : 1); return true; }
    if (key == K::B) {
        if (isShiftHeld) {
            assetGallery->refresh();
            environmentRendererRef.refreshAssetTextures();
            if (!activeGalleryAssetPath.empty()
                && !assetGallery->containsAsset(activeGalleryAssetPath)) {
                activeGalleryAssetPath.clear();
                draggedAssetPath.clear();
                isGalleryDragging = false;
            }
            if (!currentPathAtlasAssetPath.empty()
                && !assetGallery->containsAsset(currentPathAtlasAssetPath)) {
                currentPathAtlasAssetPath = configRef.getString(
                    "WORLD_EDITOR_DEFAULT_PATH_ATLAS_ASSET");
            }
            status = "Asset gallery refreshed";
        } else {
            assetGallery->toggleMode();
            status = assetGallery->mode() == WorldAssetGalleryMode::Large
                ? "Large searchable gallery" : "Small recent-assets gallery";
        }
        return true;
    }
    if (key == K::C) {
        if (isShiftHeld) {
            isCollisionLayerVisible = !isCollisionLayerVisible;
            status = isCollisionLayerVisible ? "Collision layer ON" : "Collision layer OFF";
        } else toggleCollision();
        return true;
    }
    if (key == K::D) {
        if (isShiftHeld) deleteSelection();
        else duplicateSelection();
        return true;
    }
    if (key == K::E) { adjustPrimary(isShiftHeld ? -1.0f : 1.0f, false); return true; }
    if (key == K::F) {
        if (isShiftHeld) cancelCurrentAction();
        else finishDraft();
        return true;
    }
    if (key == K::G) {
        if (isShiftHeld) isGridVisible = !isGridVisible;
        else isSnapEnabled = !isSnapEnabled;
        status = isShiftHeld ? "Grid visibility toggled" : "Snap toggled";
        return true;
    }
    if (key == K::I) {
        gridSize = isShiftHeld
            ? std::max(10.0f, gridSize * 0.5f)
            : std::min(10000.0f, gridSize * 2.0f);
        status = isShiftHeld ? "Grid size reduced" : "Grid size increased";
        return true;
    }
    if (key == K::J) { adjustPrimary(isShiftHeld ? -1.0f : 1.0f, true); return true; }
    if (key == K::K) { adjustCollision(isShiftHeld ? -1.0f : 1.0f); return true; }
    if (key == K::L) { adjustLayer(isShiftHeld ? -1 : 1); return true; }
    if (key == K::M) { cycleMaterial(isShiftHeld ? -1 : 1); return true; }
    if (key == K::N) {
        if (tool == WorldEditorTool::Enemy
            || selection.kind == WorldEditorSelectionKind::Enemy) {
            cycleEnemyKind(isShiftHeld ? -1 : 1);
        } else cycleStampCatalog(isShiftHeld ? -1 : 1);
        return true;
    }
    if (key == K::P) {
        inlineHelpScrollRow = 0;
        if (isShiftHeld) {
            cancelDraft();
            clearSelections();
            tool = WorldEditorTool::Path;
            status = "New path: click the first control point";
        } else if (!isDrafting && selectedObjects().size() == 1u
                   && selection.kind == WorldEditorSelectionKind::Path) {
            draftStartState = environmentRef.state();
            isDrafting = true;
            selection.pointIndex = -1;
            tool = WorldEditorTool::Path;
            const auto& selectedPath = environmentRef.state().paths[
                static_cast<std::size_t>(selection.objectIndex)];
            currentMaterialIndex = selectedPath.materialIndex;
            currentPathAtlasAssetPath = selectedPath.atlasAssetPath;
            status = "Continuing selected path from its last point";
        } else {
            tool = WorldEditorTool::Path;
            status = isDrafting ? "Continue placing path points"
                                 : "Click the first path control point";
        }
        return true;
    }
    if (key == K::R) { adjustRotation(isShiftHeld ? -1.0f : 1.0f); return true; }
    if (key == K::S) {
        if (isShiftHeld) restoreSaved();
        else save();
        return true;
    }
    if (key == K::T) {
        inlineHelpScrollRow = 0;
        if (isShiftHeld) {
            cancelDraft();
            tool = WorldEditorTool::Enemy;
            status = "Click to place an authored enemy";
        }
        else {
            cancelDraft();
            tool = WorldEditorTool::Stamp;
            status = "Click to place a scenery stamp";
        }
        return true;
    }
    if (key == K::U) {
        if (isShiftHeld) redo();
        else undo();
        return true;
    }
    if (key == K::V) {
        inlineHelpScrollRow = 0;
        if (isShiftHeld) selectAllObjects();
        else {
            cancelDraft();
            tool = WorldEditorTool::Select;
            status = "Select and transform";
        }
        return true;
    }
    if (key == K::W) {
        if (isShiftHeld) {
            isWalkabilityLayerVisible = !isWalkabilityLayerVisible;
            status = isWalkabilityLayerVisible ? "Walkability layer ON" : "Walkability layer OFF";
        } else toggleWalkable();
        return true;
    }
    if (key == K::X) {
        if (isShiftHeld) insertPointAtCursor();
        else flipSelection();
        return true;
    }
    if (key == K::Y) { cycleZoneKind(isShiftHeld ? -1 : 1); return true; }
    if (key == K::Z) {
        inlineHelpScrollRow = 0;
        cancelDraft(); tool = WorldEditorTool::Zone; status = "Click an organic zone boundary"; return true;
    }
    return true;
}

bool WorldEditor::handleMousePressed(sf::Mouse::Button button,
                                     sf::Vector2f worldPosition,
                                     sf::Vector2f uiPosition,
                                     float cameraZoom) {
    if (!isOpenValue) return false;
    cursorWorld = worldPosition;
    cursorUi = uiPosition;
    currentCameraZoom = cameraZoom;
    if (button == sf::Mouse::Button::Middle) {
        isPanning = true;
        panAnchorWorld = worldPosition;
        return true;
    }
    if (button == sf::Mouse::Button::Right) {
        if (isDrafting) finishDraft();
        else clearSelections();
        return true;
    }
    if (button != sf::Mouse::Button::Left) return true;
    const sf::Vector2u uiSize{
        static_cast<unsigned>(configRef.getInt("UI_DESIGN_WIDTH")),
        static_cast<unsigned>(configRef.getInt("UI_DESIGN_HEIGHT"))};
    if (openMenuIndex >= 0) {
        const std::size_t itemCount = openMenuIndex == 0 ? 2u
            : openMenuIndex == 1 ? 4u : openMenuIndex == 2 ? 4u : 1u;
        for (std::size_t item = 0; item < itemCount; ++item) {
            if (!menuItemRect(static_cast<std::size_t>(openMenuIndex), item, uiSize)
                     .contains(uiPosition)) continue;
            const int menu = openMenuIndex;
            openMenuIndex = -1;
            if (menu == 0) {
                if (item == 0u) save(); else restoreSaved();
            } else if (menu == 1) {
                if (item == 0u) undo();
                else if (item == 1u) redo();
                else if (item == 2u) duplicateSelection();
                else deleteSelection();
            } else if (menu == 2) {
                if (item == 0u) isSnapEnabled = !isSnapEnabled;
                else if (item == 1u) isGridVisible = !isGridVisible;
                else if (item == 2u) assetGallery->toggleMode();
                else isOverlayVisible = !isOverlayVisible;
                status = "View option updated";
            } else {
                isHelpRequested = true;
                status = "Opening full Help";
            }
            return true;
        }
    }
    for (std::size_t index = 0; index < 4u; ++index) {
        if (!menuHeaderRect(index, uiSize).contains(uiPosition)) continue;
        openMenuIndex = openMenuIndex == static_cast<int>(index)
            ? -1 : static_cast<int>(index);
        return true;
    }
    openMenuIndex = -1;
    for (std::size_t index = 0; index < 6u; ++index) {
        if (!toolButtonRect(index, uiSize).contains(uiPosition)) continue;
        if (index < 5u) {
            constexpr WorldEditorTool tools[5]{WorldEditorTool::Select,
                                                WorldEditorTool::Path,
                                                WorldEditorTool::Zone,
                                                WorldEditorTool::Stamp,
                                                WorldEditorTool::Enemy};
            activateTool(tools[index]);
        } else {
            isHelpRequested = true;
            status = "Opening full Help";
        }
        return true;
    }
    if (assetGallery->windowRect(uiSize).contains(uiPosition)) {
        const auto galleryPress = assetGallery->handlePress(uiPosition, uiSize);
        if (galleryPress.assetPath.has_value()) {
            if (!assetGallery->containsAsset(*galleryPress.assetPath)) {
                assetGallery->refresh();
                activeGalleryAssetPath.clear();
                draggedAssetPath.clear();
                isGalleryDragging = false;
                status = "Asset moved or deleted; Gallery refreshed";
                environmentRendererRef.refreshAssetTextures();
                return true;
            }
            if (activeGalleryAssetPath == *galleryPress.assetPath) {
                activeGalleryAssetPath.clear();
                draggedAssetPath.clear();
                isGalleryDragging = false;
                status = "Asset brush unselected";
            } else {
                activeGalleryAssetPath = *galleryPress.assetPath;
                draggedAssetPath = *galleryPress.assetPath;
                isGalleryDragging = true;
                bool hasCompatibleSelection = false;
                bool hasRejectedPath = false;
                bool hasSelectedPath = false;
                const bool isCompatibleAtlas =
                    environmentRendererRef.isPathAtlasCompatible(activeGalleryAssetPath);
                beginChange();
                for (const auto& item : selectedObjects()) {
                    if (item.kind == WorldEditorSelectionKind::Path) {
                        hasSelectedPath = true;
                        if (!isCompatibleAtlas) {
                            hasRejectedPath = true;
                            continue;
                        }
                        auto& path = environmentRef.state().paths[
                            static_cast<std::size_t>(item.objectIndex)];
                        path.atlasAssetPath = activeGalleryAssetPath;
                        path.materialIndex = -1;
                        hasCompatibleSelection = true;
                    } else if (item.kind == WorldEditorSelectionKind::Zone) {
                        auto& zone = environmentRef.state().zones[
                            static_cast<std::size_t>(item.objectIndex)];
                        zone.assetPath = activeGalleryAssetPath;
                        zone.assetWorldSize = galleryFloorWorldSize;
                        zone.materialIndex = -1;
                        hasCompatibleSelection = true;
                    }
                }
                if (hasCompatibleSelection) {
                    endChange();
                    assetGallery->markUsed(activeGalleryAssetPath);
                    status = hasRejectedPath
                        ? "Floor applied; incompatible path atlas skipped"
                        : "Asset applied to selected paths/zones; brush remains active";
                } else {
                    pendingChange.reset();
                    if (tool == WorldEditorTool::Path && isCompatibleAtlas) {
                        currentMaterialIndex = -1;
                        currentPathAtlasAssetPath = activeGalleryAssetPath;
                        status = "Smart atlas ready for the next path";
                    } else {
                        status = hasRejectedPath || (tool == WorldEditorTool::Path && hasSelectedPath)
                            ? "Path atlas needs a square 6x6 image"
                            : "Asset brush selected; drag or click repeatedly";
                    }
                }
            }
        }
        if (!activeGalleryAssetPath.empty()
            && !assetGallery->containsAsset(activeGalleryAssetPath)) {
            activeGalleryAssetPath.clear();
            draggedAssetPath.clear();
            isGalleryDragging = false;
            status = "Active asset no longer exists";
        }
        if (!currentPathAtlasAssetPath.empty()
            && !assetGallery->containsAsset(currentPathAtlasAssetPath)) {
            currentPathAtlasAssetPath = configRef.getString(
                "WORLD_EDITOR_DEFAULT_PATH_ATLAS_ASSET");
        }
        environmentRendererRef.refreshAssetTextures();
        return true;
    }
    if (isPointerOverEditorUi(uiPosition, uiSize)) return true;
    if (!activeGalleryAssetPath.empty()
        && (tool == WorldEditorTool::Select || tool == WorldEditorTool::Stamp)) {
        addAssetStamp(activeGalleryAssetPath, worldPosition);
        return true;
    }
    switch (tool) {
        case WorldEditorTool::Select:
            {
            const auto previousSelections = selectedObjects();
            selectAt(worldPosition, cameraZoom);
            if (selection.kind != WorldEditorSelectionKind::None) {
                if (selection.pointIndex < 0) {
                    const auto clicked = selection;
                    const auto previous = std::find_if(
                        previousSelections.begin(), previousSelections.end(),
                        [&](const Selection& item) {
                            return item.kind == clicked.kind
                                && item.objectIndex == clicked.objectIndex;
                        });
                    if (previous != previousSelections.end() && previousSelections.size() > 1u) {
                        selection = clicked;
                        additionalSelections.clear();
                        for (const auto& item : previousSelections) {
                            if (item.kind != clicked.kind
                                || item.objectIndex != clicked.objectIndex) {
                                additionalSelections.push_back(item);
                            }
                        }
                    }
                }
                beginChange();
                isDragging = true;
                dragStartWorld = worldPosition;
            } else {
                isMarqueeSelecting = true;
                marqueeStartWorld = worldPosition;
                marqueeEndWorld = worldPosition;
            }
            break;
            }
        case WorldEditorTool::Path: addPathPoint(worldPosition); break;
        case WorldEditorTool::Zone:
            if (!isDrafting) {
                selectAt(worldPosition, cameraZoom);
                if (selection.kind == WorldEditorSelectionKind::Zone) {
                    beginChange();
                    isDragging = true;
                    dragStartWorld = worldPosition;
                    status = selection.pointIndex >= 0
                        ? "Moving zone point" : "Moving zone";
                } else {
                    clearSelections();
                    addZonePoint(worldPosition);
                }
            } else addZonePoint(worldPosition);
            break;
        case WorldEditorTool::Stamp: addStamp(worldPosition); break;
        case WorldEditorTool::Enemy: addEnemy(worldPosition); break;
    }
    return true;
}

bool WorldEditor::handleMouseMoved(sf::Vector2f worldPosition,
                                   sf::Vector2f uiPosition,
                                   float cameraZoom) {
    if (!isOpenValue) return false;
    cursorWorld = worldPosition;
    cursorUi = uiPosition;
    currentCameraZoom = cameraZoom;
    if (isPanning) {
        cameraFocusValue += panAnchorWorld - worldPosition;
        return true;
    }
    if (isMarqueeSelecting) {
        marqueeEndWorld = worldPosition;
        return true;
    }
    if (!isDragging) return true;
    auto& state = environmentRef.state();
    if (selection.kind == WorldEditorSelectionKind::Path
        && selection.objectIndex >= 0 && selection.pointIndex >= 0) {
        const auto object = static_cast<std::size_t>(selection.objectIndex);
        const auto point = static_cast<std::size_t>(selection.pointIndex);
        const sf::Vector2f original = pendingChange->paths[object].points[point];
        state.paths[object].points[point] = snap(
            original + worldPosition - dragStartWorld);
    } else if (selection.pointIndex < 0 && pendingChange.has_value()) {
        const sf::Vector2f delta = snapDragDelta(worldPosition - dragStartWorld, cameraZoom);
        for (const auto& item : selectedObjects()) {
            if (item.kind == WorldEditorSelectionKind::Path) {
                const auto& original = pendingChange->paths[
                    static_cast<std::size_t>(item.objectIndex)].points;
                auto& points = state.paths[static_cast<std::size_t>(item.objectIndex)].points;
                for (std::size_t index = 0; index < points.size(); ++index) {
                    points[index] = original[index] + delta;
                }
            } else if (item.kind == WorldEditorSelectionKind::Zone) {
                const auto& original = pendingChange->zones[
                    static_cast<std::size_t>(item.objectIndex)].points;
                auto& points = state.zones[static_cast<std::size_t>(item.objectIndex)].points;
                for (std::size_t index = 0; index < points.size(); ++index) {
                    points[index] = original[index] + delta;
                }
            } else if (item.kind == WorldEditorSelectionKind::Stamp) {
                state.stamps[static_cast<std::size_t>(item.objectIndex)].position
                    = pendingChange->stamps[static_cast<std::size_t>(item.objectIndex)].position
                    + delta;
            } else if (item.kind == WorldEditorSelectionKind::Enemy) {
                state.enemies[static_cast<std::size_t>(item.objectIndex)].position
                    = pendingChange->enemies[static_cast<std::size_t>(item.objectIndex)].position
                    + delta;
            }
        }
    } else if (selection.kind == WorldEditorSelectionKind::Zone
               && selection.objectIndex >= 0 && selection.pointIndex >= 0) {
        const auto object = static_cast<std::size_t>(selection.objectIndex);
        const auto point = static_cast<std::size_t>(selection.pointIndex);
        const sf::Vector2f original = pendingChange->zones[object].points[point];
        state.zones[object].points[point] = snap(original + worldPosition - dragStartWorld);
    }
    return true;
}

bool WorldEditor::handleMouseReleased(sf::Mouse::Button button) {
    if (!isOpenValue) return false;
    if (button == sf::Mouse::Button::Middle) isPanning = false;
    if (button == sf::Mouse::Button::Left && isMarqueeSelecting) {
        isMarqueeSelecting = false;
        selectInsideMarquee();
        return true;
    }
    if (button == sf::Mouse::Button::Left && isGalleryDragging) {
        const sf::Vector2u uiSize{
            static_cast<unsigned>(configRef.getInt("UI_DESIGN_WIDTH")),
            static_cast<unsigned>(configRef.getInt("UI_DESIGN_HEIGHT"))};
        if (!assetGallery->containsAsset(draggedAssetPath)) {
            activeGalleryAssetPath.clear();
            status = "Asset moved or deleted; brush cleared";
        } else if (!isPointerOverEditorUi(cursorUi, uiSize)) {
            addAssetStamp(draggedAssetPath, cursorWorld);
        } else {
            status = "Asset brush selected";
        }
        isGalleryDragging = false;
        draggedAssetPath.clear();
        return true;
    }
    if (button == sf::Mouse::Button::Left && isDragging) {
        isDragging = false;
        endChange();
        status = "Moved selection";
    }
    return true;
}

bool WorldEditor::handleWheel(float delta, bool /*isControlHeld*/,
                              bool /*isShiftHeld*/, bool /*isAltHeld*/) {
    if (!isOpenValue) return false;
    const sf::Vector2u uiSize{
        static_cast<unsigned>(configRef.getInt("UI_DESIGN_WIDTH")),
        static_cast<unsigned>(configRef.getInt("UI_DESIGN_HEIGHT"))};
    if (assetGallery->handleWheel(delta, cursorUi, uiSize)) return true;
    if (inlineHelpRect(uiSize).contains(cursorUi)) {
        inlineHelpScrollRow = std::clamp(
            inlineHelpScrollRow + (delta > 0.0f ? -1 : 1),
            0, maximumInlineHelpScroll(uiSize));
        return true;
    }
    return false;
}

void WorldEditor::handleTextEntered(char32_t unicode) {
    if (!isOpenValue) return;
    assetGallery->handleTextEntered(unicode);
}

void WorldEditor::updateCamera(float deltaSeconds, float cameraZoom) {
    if (!isOpenValue || assetGallery->isSearchFocused()) return;
    const auto pressed = [](sf::Keyboard::Key key) {
        return sf::Keyboard::isKeyPressed(key);
    };
    if (pressed(sf::Keyboard::Key::LAlt) || pressed(sf::Keyboard::Key::RAlt)) return;
    sf::Vector2f direction{};
    if (pressed(sf::Keyboard::Key::W) || pressed(sf::Keyboard::Key::Up)) direction.y -= 1.0f;
    if (pressed(sf::Keyboard::Key::S) || pressed(sf::Keyboard::Key::Down)) direction.y += 1.0f;
    if (pressed(sf::Keyboard::Key::A) || pressed(sf::Keyboard::Key::Left)) direction.x -= 1.0f;
    if (pressed(sf::Keyboard::Key::D) || pressed(sf::Keyboard::Key::Right)) direction.x += 1.0f;
    const float length = std::sqrt(direction.x * direction.x + direction.y * direction.y);
    if (length <= 0.0f) return;
    direction /= length;
    const bool isFast = pressed(sf::Keyboard::Key::LShift)
                     || pressed(sf::Keyboard::Key::RShift);
    const float speed = cameraMoveSpeed * (isFast ? cameraFastMultiplier : 1.0f)
                      / std::max(0.01f, cameraZoom);
    cameraFocusValue += direction * speed * deltaSeconds;
}

void WorldEditor::selectAt(sf::Vector2f worldPosition, float cameraZoom) {
    inlineHelpScrollRow = 0;
    clearSelections();
    auto& state = environmentRef.state();
    const float radius = pickRadius(cameraZoom);
    const float radiusSquared = radius * radius;
    float best = std::numeric_limits<float>::max();
    for (std::size_t object = 0; object < state.paths.size(); ++object) {
        for (std::size_t point = 0; point < state.paths[object].points.size(); ++point) {
            const float distance = distanceSquared(worldPosition,
                                                    state.paths[object].points[point]);
            if (distance <= radiusSquared && distance < best) {
                best = distance;
                selection = {WorldEditorSelectionKind::Path,
                             static_cast<int>(object), static_cast<int>(point)};
            }
        }
    }
    for (std::size_t object = 0; object < state.zones.size(); ++object) {
        for (std::size_t point = 0; point < state.zones[object].points.size(); ++point) {
            const float distance = distanceSquared(worldPosition,
                                                    state.zones[object].points[point]);
            if (distance <= radiusSquared && distance < best) {
                best = distance;
                selection = {WorldEditorSelectionKind::Zone,
                             static_cast<int>(object), static_cast<int>(point)};
            }
        }
    }
    if (selection.kind != WorldEditorSelectionKind::None) return;
    for (std::size_t object = 0; object < state.enemies.size(); ++object) {
        const float distance = distanceSquared(worldPosition, state.enemies[object].position);
        const float enemyRadius = std::max(radius, enemyMarkerRadius);
        if (distance <= enemyRadius * enemyRadius && distance < best) {
            best = distance;
            selection = {WorldEditorSelectionKind::Enemy,
                         static_cast<int>(object), -1};
        }
    }
    if (selection.kind != WorldEditorSelectionKind::None) return;
    for (std::size_t object = 0; object < state.stamps.size(); ++object) {
        const auto bounds = environmentRendererRef.stampWorldBounds(object);
        const sf::Vector2f center = bounds.position + bounds.size * 0.5f;
        const float distance = distanceSquared(worldPosition, center);
        const float anchorDistance = distanceSquared(
            worldPosition, state.stamps[object].position);
        if ((bounds.contains(worldPosition) || distance <= radiusSquared
             || anchorDistance <= radiusSquared) && distance < best) {
            best = distance;
            selection = {WorldEditorSelectionKind::Stamp,
                         static_cast<int>(object), -1};
        }
    }
    if (selection.kind != WorldEditorSelectionKind::None) return;
    for (std::size_t object = 0; object < state.paths.size(); ++object) {
        const auto points = environmentRendererRef.atlasPathGuidePoints(object);
        for (std::size_t point = 0; point + 1u < points.size(); ++point) {
            const float distance = distanceSquared(worldPosition,
                closestPointOnSegment(worldPosition, points[point], points[point + 1u]));
            const float pathRadius = std::max(radius, state.paths[object].width * 0.5f);
            if (distance <= pathRadius * pathRadius && distance < best) {
                best = distance;
                selection = {WorldEditorSelectionKind::Path,
                             static_cast<int>(object), -1};
            }
        }
    }
    if (selection.kind != WorldEditorSelectionKind::None) return;
    for (std::size_t object = state.zones.size(); object-- > 0u;) {
        if (isPointInsidePolygon(worldPosition, state.zones[object].points)) {
            selection = {WorldEditorSelectionKind::Zone,
                         static_cast<int>(object), -1};
            return;
        }
    }
}

void WorldEditor::clearSelections() {
    inlineHelpScrollRow = 0;
    selection = {};
    additionalSelections.clear();
}

std::vector<WorldEditor::Selection> WorldEditor::selectedObjects() const {
    std::vector<Selection> result;
    const auto append = [&](Selection candidate) {
        if (candidate.kind == WorldEditorSelectionKind::None || candidate.objectIndex < 0) return;
        candidate.pointIndex = -1;
        const bool isDuplicate = std::any_of(result.begin(), result.end(), [&](const Selection& item) {
            return item.kind == candidate.kind && item.objectIndex == candidate.objectIndex;
        });
        if (!isDuplicate) result.push_back(candidate);
    };
    append(selection);
    for (const auto& item : additionalSelections) append(item);
    return result;
}

bool WorldEditor::isObjectSelected(WorldEditorSelectionKind kind, int objectIndex) const {
    const auto objects = selectedObjects();
    return std::any_of(objects.begin(), objects.end(), [&](const Selection& item) {
        return item.kind == kind && item.objectIndex == objectIndex;
    });
}

void WorldEditor::selectAllObjects() {
    inlineHelpScrollRow = 0;
    clearSelections();
    const auto& state = environmentRef.state();
    std::vector<Selection> matches;
    for (std::size_t index = 0; index < state.paths.size(); ++index) {
        matches.push_back({WorldEditorSelectionKind::Path, static_cast<int>(index), -1});
    }
    for (std::size_t index = 0; index < state.zones.size(); ++index) {
        matches.push_back({WorldEditorSelectionKind::Zone, static_cast<int>(index), -1});
    }
    for (std::size_t index = 0; index < state.stamps.size(); ++index) {
        matches.push_back({WorldEditorSelectionKind::Stamp, static_cast<int>(index), -1});
    }
    for (std::size_t index = 0; index < state.enemies.size(); ++index) {
        matches.push_back({WorldEditorSelectionKind::Enemy, static_cast<int>(index), -1});
    }
    if (!matches.empty()) {
        selection = matches.front();
        additionalSelections.assign(matches.begin() + 1, matches.end());
    }
    status = std::to_string(matches.size()) + " objects selected";
}

void WorldEditor::selectInsideMarquee() {
    clearSelections();
    const float left = std::min(marqueeStartWorld.x, marqueeEndWorld.x);
    const float right = std::max(marqueeStartWorld.x, marqueeEndWorld.x);
    const float top = std::min(marqueeStartWorld.y, marqueeEndWorld.y);
    const float bottom = std::max(marqueeStartWorld.y, marqueeEndWorld.y);
    const auto segmentIntersectsRect = [](sf::Vector2f start, sf::Vector2f end,
                                          float rectLeft, float rectTop,
                                          float rectRight, float rectBottom) {
        float minimumTime = 0.0f;
        float maximumTime = 1.0f;
        const sf::Vector2f delta = end - start;
        const auto clip = [&](float origin, float direction,
                              float minimum, float maximum) {
            if (std::abs(direction) <= 0.001f) {
                return origin >= minimum && origin <= maximum;
            }
            float enter = (minimum - origin) / direction;
            float leave = (maximum - origin) / direction;
            if (enter > leave) std::swap(enter, leave);
            minimumTime = std::max(minimumTime, enter);
            maximumTime = std::min(maximumTime, leave);
            return minimumTime <= maximumTime;
        };
        return clip(start.x, delta.x, rectLeft, rectRight)
            && clip(start.y, delta.y, rectTop, rectBottom);
    };
    const auto geometryIntersects = [&](const std::vector<sf::Vector2f>& points,
                                        bool isClosed, float margin) {
        if (points.empty()) return false;
        const float expandedLeft = left - margin;
        const float expandedRight = right + margin;
        const float expandedTop = top - margin;
        const float expandedBottom = bottom + margin;
        for (const auto point : points) {
            if (point.x >= expandedLeft && point.x <= expandedRight
                && point.y >= expandedTop && point.y <= expandedBottom) return true;
        }
        const std::size_t segmentCount = isClosed ? points.size() : points.size() - 1u;
        for (std::size_t index = 0; index < segmentCount; ++index) {
            if (segmentIntersectsRect(points[index], points[(index + 1u) % points.size()],
                                      expandedLeft, expandedTop,
                                      expandedRight, expandedBottom)) return true;
        }
        if (isClosed) {
            const sf::Vector2f corners[4]{{left, top}, {right, top},
                                          {right, bottom}, {left, bottom}};
            return std::any_of(std::begin(corners), std::end(corners),
                [&](sf::Vector2f corner) { return isPointInsidePolygon(corner, points); });
        }
        return false;
    };

    std::vector<Selection> matches;
    const auto& state = environmentRef.state();
    for (std::size_t index = 0; index < state.paths.size(); ++index) {
        if (geometryIntersects(
                environmentRendererRef.atlasPathGuidePoints(index), false,
                               state.paths[index].width * 0.5f)) {
            matches.push_back({WorldEditorSelectionKind::Path, static_cast<int>(index), -1});
        }
    }
    for (std::size_t index = 0; index < state.zones.size(); ++index) {
        if (geometryIntersects(state.zones[index].points, true, 0.0f)) {
            matches.push_back({WorldEditorSelectionKind::Zone, static_cast<int>(index), -1});
        }
    }
    for (std::size_t index = 0; index < state.stamps.size(); ++index) {
        const auto bounds = environmentRendererRef.stampWorldBounds(index);
        const bool intersects = bounds.position.x <= right
            && bounds.position.x + bounds.size.x >= left
            && bounds.position.y <= bottom
            && bounds.position.y + bounds.size.y >= top;
        if (intersects) {
            matches.push_back({WorldEditorSelectionKind::Stamp, static_cast<int>(index), -1});
        }
    }
    for (std::size_t index = 0; index < state.enemies.size(); ++index) {
        const auto position = state.enemies[index].position;
        if (position.x + enemyMarkerRadius >= left
            && position.x - enemyMarkerRadius <= right
            && position.y + enemyMarkerRadius >= top
            && position.y - enemyMarkerRadius <= bottom) {
            matches.push_back({WorldEditorSelectionKind::Enemy,
                               static_cast<int>(index), -1});
        }
    }
    if (!matches.empty()) {
        selection = matches.front();
        additionalSelections.assign(matches.begin() + 1, matches.end());
    }
    status = std::to_string(matches.size()) + " objects selected";
}

void WorldEditor::addPathPoint(sf::Vector2f worldPosition) {
    auto& paths = environmentRef.state().paths;
    if (!isDrafting) {
        clearSelections();
        draftStartState = environmentRef.state();
        dof::core::WorldPathDefinition path;
        path.name = "Path " + std::to_string(paths.size() + 1u);
        path.width = configRef.getFloat("WORLD_EDITOR_DEFAULT_PATH_WIDTH");
        path.feather = configRef.getFloat("WORLD_EDITOR_DEFAULT_PATH_FEATHER");
        path.materialIndex = currentMaterialIndex;
        path.atlasAssetPath = currentPathAtlasAssetPath.empty()
            ? configRef.getString("WORLD_EDITOR_DEFAULT_PATH_ATLAS_ASSET")
            : currentPathAtlasAssetPath;
        path.zIndex = configRef.getInt("WORLD_EDITOR_DEFAULT_PATH_Z_INDEX");
        paths.push_back(std::move(path));
        selection = {WorldEditorSelectionKind::Path,
                     static_cast<int>(paths.size() - 1u), -1};
        isDrafting = true;
    }
    auto& path = paths[static_cast<std::size_t>(selection.objectIndex)];
    path.points.push_back(snap(worldPosition));
    selection.pointIndex = static_cast<int>(path.points.size() - 1u);
    status = path.points.size() == 1u
        ? "Path intention started; second point builds it"
        : "Path rebuilt from intention; RMB finishes";
}

void WorldEditor::addZonePoint(sf::Vector2f worldPosition) {
    auto& zones = environmentRef.state().zones;
    if (!isDrafting) {
        clearSelections();
        draftStartState = environmentRef.state();
        dof::core::WorldZoneDefinition zone;
        zone.name = "Zone " + std::to_string(zones.size() + 1u);
        zone.kind = currentZoneKind;
        zone.materialIndex = activeGalleryAssetPath.empty()
            ? currentMaterialIndex : -1;
        zone.zIndex = configRef.getInt("WORLD_EDITOR_DEFAULT_ZONE_Z_INDEX");
        zone.assetPath = activeGalleryAssetPath;
        zone.assetWorldSize = galleryFloorWorldSize;
        zone.feather = configRef.getFloat("WORLD_EDITOR_DEFAULT_ZONE_FEATHER");
        zone.tint = byteColor(configRef, zoneColorPrefix(currentZoneKind));
        zone.isBlocking = currentZoneKind == dof::core::WorldZoneKind::Blocked
                       || currentZoneKind == dof::core::WorldZoneKind::Water;
        if (!zone.assetPath.empty()) assetGallery->markUsed(zone.assetPath);
        zones.push_back(std::move(zone));
        selection = {WorldEditorSelectionKind::Zone,
                     static_cast<int>(zones.size() - 1u), -1};
        isDrafting = true;
    }
    auto& zone = zones[static_cast<std::size_t>(selection.objectIndex)];
    zone.points.push_back(snap(worldPosition));
    selection.pointIndex = static_cast<int>(zone.points.size() - 1u);
    status = "Zone point added; RMB or Alt+F finishes";
}

void WorldEditor::addStamp(sf::Vector2f worldPosition) {
    if (environmentRendererRef.stampCatalogCount() == 0u) {
        status = "Stamp catalog is empty";
        return;
    }
    clearSelections();
    beginChange();
    auto& stamps = environmentRef.state().stamps;
    dof::core::WorldStampDefinition stamp;
    stamp.catalogIndex = currentStampCatalogIndex;
    stamp.name = environmentRendererRef.stampCatalogName(
        static_cast<std::size_t>(currentStampCatalogIndex)) + " "
        + std::to_string(stamps.size() + 1u);
    stamp.position = snap(worldPosition);
    stamp.collisionRadius = environmentRendererRef.defaultStampCollisionRadius(
        static_cast<std::size_t>(currentStampCatalogIndex));
    stamps.push_back(std::move(stamp));
    selection = {WorldEditorSelectionKind::Stamp,
                 static_cast<int>(stamps.size() - 1u), -1};
    endChange();
    status = "Stamp placed";
}

void WorldEditor::addAssetStamp(const std::string& assetPath,
                                sf::Vector2f worldPosition) {
    if (assetPath.empty() || !assetGallery->containsAsset(assetPath)) {
        activeGalleryAssetPath.clear();
        status = "Asset moved or deleted; brush cleared";
        return;
    }
    clearSelections();
    beginChange();
    auto& stamps = environmentRef.state().stamps;
    dof::core::WorldStampDefinition stamp;
    stamp.assetPath = assetPath;
    stamp.assetWorldWidth = galleryStampWorldWidth;
    stamp.name = std::filesystem::path(assetPath).stem().string() + " "
               + std::to_string(stamps.size() + 1u);
    stamp.position = snap(worldPosition);
    stamps.push_back(std::move(stamp));
    assetGallery->markUsed(assetPath);
    selection = {WorldEditorSelectionKind::Stamp,
                 static_cast<int>(stamps.size() - 1u), -1};
    endChange();
    status = "Asset dropped into world";
}

void WorldEditor::addEnemy(sf::Vector2f worldPosition) {
    clearSelections();
    beginChange();
    auto& enemies = environmentRef.state().enemies;
    dof::core::WorldEnemyDefinition enemy;
    enemy.typeId = enemyTypeIds[currentEnemyKindIndex];
    enemy.name = std::string{enemyTypeLabels[currentEnemyKindIndex]} + " "
               + std::to_string(enemies.size() + 1u);
    enemy.position = snap(worldPosition);
    enemy.level = configRef.getInt("WORLD_EDITOR_DEFAULT_ENEMY_LEVEL");
    enemy.tier = configRef.getInt("WORLD_EDITOR_DEFAULT_ENEMY_TIER");
    enemies.push_back(std::move(enemy));
    selection = {WorldEditorSelectionKind::Enemy,
                 static_cast<int>(enemies.size() - 1u), -1};
    endChange();
    status = std::string{enemyTypeLabels[currentEnemyKindIndex]} + " placed";
}

void WorldEditor::finishDraft() {
    if (!isDrafting || !draftStartState.has_value()) return;
    bool isValid = false;
    if (selection.kind == WorldEditorSelectionKind::Path && selection.objectIndex >= 0) {
        isValid = environmentRef.state().paths[static_cast<std::size_t>(selection.objectIndex)]
                      .points.size() >= 2u;
    } else if (selection.kind == WorldEditorSelectionKind::Zone && selection.objectIndex >= 0) {
        isValid = environmentRef.state().zones[static_cast<std::size_t>(selection.objectIndex)]
                      .points.size() >= 3u;
    }
    if (!isValid) {
        environmentRef.setState(*draftStartState);
        clearSelections();
        status = "Draft discarded: too few points";
    } else {
        undoStates.push_back(*draftStartState);
        if (static_cast<int>(undoStates.size()) > maximumHistory) undoStates.erase(undoStates.begin());
        redoStates.clear();
        selection.pointIndex = -1;
        status = "Shape completed";
    }
    draftStartState.reset();
    isDrafting = false;
}

void WorldEditor::cancelDraft() {
    if (!isDrafting || !draftStartState.has_value()) return;
    environmentRef.setState(*draftStartState);
    draftStartState.reset();
    isDrafting = false;
    clearSelections();
}

void WorldEditor::deleteSelection() {
    if (isDrafting) {
        if (selection.kind == WorldEditorSelectionKind::Path) {
            auto& points = environmentRef.state().paths[
                static_cast<std::size_t>(selection.objectIndex)].points;
            if (!points.empty()) points.pop_back();
            selection.pointIndex = points.empty() ? -1 : static_cast<int>(points.size() - 1u);
        } else if (selection.kind == WorldEditorSelectionKind::Zone) {
            auto& points = environmentRef.state().zones[
                static_cast<std::size_t>(selection.objectIndex)].points;
            if (!points.empty()) points.pop_back();
            selection.pointIndex = points.empty() ? -1 : static_cast<int>(points.size() - 1u);
        }
        return;
    }
    if (selection.kind == WorldEditorSelectionKind::None) return;
    const auto objects = selectedObjects();
    if (objects.size() > 1u || selection.pointIndex < 0) {
        beginChange();
        auto& state = environmentRef.state();
        std::vector<int> paths;
        std::vector<int> zones;
        std::vector<int> stamps;
        std::vector<int> enemies;
        for (const auto& item : objects) {
            if (item.kind == WorldEditorSelectionKind::Path) paths.push_back(item.objectIndex);
            else if (item.kind == WorldEditorSelectionKind::Zone) zones.push_back(item.objectIndex);
            else if (item.kind == WorldEditorSelectionKind::Stamp) stamps.push_back(item.objectIndex);
            else if (item.kind == WorldEditorSelectionKind::Enemy) enemies.push_back(item.objectIndex);
        }
        const auto eraseDescending = [](auto& values, std::vector<int>& indices) {
            std::sort(indices.rbegin(), indices.rend());
            for (const int index : indices) {
                values.erase(values.begin() + index);
            }
        };
        eraseDescending(state.paths, paths);
        eraseDescending(state.zones, zones);
        eraseDescending(state.stamps, stamps);
        eraseDescending(state.enemies, enemies);
        clearSelections();
        endChange();
        status = std::to_string(objects.size()) + " objects deleted";
        return;
    }
    beginChange();
    auto& state = environmentRef.state();
    if (selection.kind == WorldEditorSelectionKind::Path) {
        auto& path = state.paths[static_cast<std::size_t>(selection.objectIndex)];
        if (selection.pointIndex >= 0 && path.points.size() > 2u) {
            path.points.erase(path.points.begin() + selection.pointIndex);
            selection.pointIndex = -1;
        } else {
            state.paths.erase(state.paths.begin() + selection.objectIndex);
            selection = {};
        }
    } else if (selection.kind == WorldEditorSelectionKind::Zone) {
        auto& zone = state.zones[static_cast<std::size_t>(selection.objectIndex)];
        if (selection.pointIndex >= 0 && zone.points.size() > 3u) {
            zone.points.erase(zone.points.begin() + selection.pointIndex);
            selection.pointIndex = -1;
        } else {
            state.zones.erase(state.zones.begin() + selection.objectIndex);
            selection = {};
        }
    } else if (selection.kind == WorldEditorSelectionKind::Stamp) {
        state.stamps.erase(state.stamps.begin() + selection.objectIndex);
        selection = {};
    } else if (selection.kind == WorldEditorSelectionKind::Enemy) {
        state.enemies.erase(state.enemies.begin() + selection.objectIndex);
        selection = {};
    }
    endChange();
    status = "Selection deleted";
}

void WorldEditor::duplicateSelection() {
    if (selection.kind == WorldEditorSelectionKind::None || isDrafting) return;
    beginChange();
    const sf::Vector2f offset{configRef.getFloat("WORLD_EDITOR_DUPLICATE_OFFSET_X"),
                              configRef.getFloat("WORLD_EDITOR_DUPLICATE_OFFSET_Y")};
    auto& state = environmentRef.state();
    const auto originals = selectedObjects();
    std::vector<Selection> duplicates;
    for (const auto& item : originals) {
        if (item.kind == WorldEditorSelectionKind::Path) {
            auto duplicate = state.paths[static_cast<std::size_t>(item.objectIndex)];
            duplicate.name += " copy";
            for (auto& point : duplicate.points) point += offset;
            state.paths.push_back(std::move(duplicate));
            duplicates.push_back({WorldEditorSelectionKind::Path,
                                  static_cast<int>(state.paths.size() - 1u), -1});
        } else if (item.kind == WorldEditorSelectionKind::Zone) {
            auto duplicate = state.zones[static_cast<std::size_t>(item.objectIndex)];
            duplicate.name += " copy";
            for (auto& point : duplicate.points) point += offset;
            state.zones.push_back(std::move(duplicate));
            duplicates.push_back({WorldEditorSelectionKind::Zone,
                                  static_cast<int>(state.zones.size() - 1u), -1});
        } else if (item.kind == WorldEditorSelectionKind::Stamp) {
            auto duplicate = state.stamps[static_cast<std::size_t>(item.objectIndex)];
            duplicate.name += " copy";
            duplicate.position += offset;
            state.stamps.push_back(std::move(duplicate));
            duplicates.push_back({WorldEditorSelectionKind::Stamp,
                                  static_cast<int>(state.stamps.size() - 1u), -1});
        } else if (item.kind == WorldEditorSelectionKind::Enemy) {
            auto duplicate = state.enemies[static_cast<std::size_t>(item.objectIndex)];
            duplicate.name += " copy";
            duplicate.position += offset;
            state.enemies.push_back(std::move(duplicate));
            duplicates.push_back({WorldEditorSelectionKind::Enemy,
                                  static_cast<int>(state.enemies.size() - 1u), -1});
        }
    }
    clearSelections();
    if (!duplicates.empty()) {
        selection = duplicates.front();
        additionalSelections.assign(duplicates.begin() + 1, duplicates.end());
    }
    endChange();
    status = std::to_string(duplicates.size()) + " objects duplicated";
}

void WorldEditor::insertPointAtCursor() {
    if (selectedObjects().size() != 1u) {
        status = "Insert point needs one selected path or zone";
        return;
    }
    if (selection.kind != WorldEditorSelectionKind::Path
        && selection.kind != WorldEditorSelectionKind::Zone) return;
    beginChange();
    auto insertNearest = [&](std::vector<sf::Vector2f>& points, bool isClosed) {
        if (points.size() < 2u) return;
        float best = std::numeric_limits<float>::max();
        std::size_t bestAfter = 1u;
        const std::size_t segments = isClosed ? points.size() : points.size() - 1u;
        sf::Vector2f bestPoint = cursorWorld;
        for (std::size_t index = 0; index < segments; ++index) {
            const auto closest = closestPointOnSegment(
                cursorWorld, points[index], points[(index + 1u) % points.size()]);
            const float distance = distanceSquared(cursorWorld, closest);
            if (distance < best) {
                best = distance;
                bestAfter = index + 1u;
                bestPoint = closest;
            }
        }
        points.insert(points.begin() + static_cast<std::ptrdiff_t>(bestAfter), snap(bestPoint));
        selection.pointIndex = static_cast<int>(bestAfter);
    };
    if (selection.kind == WorldEditorSelectionKind::Path) {
        auto& path = environmentRef.state().paths[static_cast<std::size_t>(selection.objectIndex)];
        insertNearest(path.points, false);
    } else {
        auto& zone = environmentRef.state().zones[static_cast<std::size_t>(selection.objectIndex)];
        insertNearest(zone.points, true);
    }
    endChange();
    status = "Control point inserted";
}

void WorldEditor::cycleMaterial(int direction) {
    const int count = static_cast<int>(environmentRendererRef.materialCount());
    if (count <= 0) return;
    const auto wrap = [count](int value) { return (value % count + count) % count; };
    const auto advanceMaterial = [&](int value) {
        if (value < 0) return direction > 0 ? 0 : count - 1;
        return wrap(value + direction);
    };
    const auto atlasForMaterial = [&](int materialIndex) -> std::string {
        const auto& pairedAtlas =
            environmentRendererRef.materialPathAtlasAssetPath(
                static_cast<std::size_t>(materialIndex));
        return pairedAtlas.empty()
            ? configRef.getString("WORLD_EDITOR_DEFAULT_PATH_ATLAS_ASSET")
            : pairedAtlas;
    };
    const auto objects = selectedObjects();
    const auto selectedPath = std::ranges::find_if(
        objects, [](const Selection& item) {
            return item.kind == WorldEditorSelectionKind::Path;
        });
    const int sharedStyleIndex = selectedPath == objects.end()
        ? -1
        : advanceMaterial(environmentRef.state().paths[
            static_cast<std::size_t>(selectedPath->objectIndex)].materialIndex);
    bool hasChanged = false;
    beginChange();
    for (const auto& item : objects) {
        if (item.kind == WorldEditorSelectionKind::Path) {
            auto& path = environmentRef.state().paths[static_cast<std::size_t>(item.objectIndex)];
            auto& material = path.materialIndex;
            material = sharedStyleIndex;
            path.atlasAssetPath = atlasForMaterial(material);
            currentMaterialIndex = material;
            currentPathAtlasAssetPath = path.atlasAssetPath;
            hasChanged = true;
        } else if (item.kind == WorldEditorSelectionKind::Zone) {
            auto& zone = environmentRef.state().zones[static_cast<std::size_t>(item.objectIndex)];
            if (sharedStyleIndex >= 0) {
                zone.materialIndex = sharedStyleIndex;
            } else {
                const int optionCount = count + 1;
                int encoded = zone.materialIndex + 1;
                encoded = (encoded + direction + optionCount) % optionCount;
                zone.materialIndex = encoded - 1;
            }
            zone.assetPath.clear();
            if (zone.materialIndex >= 0) currentMaterialIndex = zone.materialIndex;
            hasChanged = true;
        }
    }
    if (hasChanged) endChange();
    else {
        pendingChange.reset();
        currentMaterialIndex = advanceMaterial(currentMaterialIndex);
        currentPathAtlasAssetPath = atlasForMaterial(currentMaterialIndex);
    }
    status = hasChanged
        ? "Selected environment style adjusted"
        : "Placement environment style adjusted";
}

void WorldEditor::cycleStampCatalog(int direction) {
    const int count = static_cast<int>(environmentRendererRef.stampCatalogCount());
    if (count <= 0) return;
    const auto wrap = [count](int value) { return (value % count + count) % count; };
    bool hasChanged = false;
    beginChange();
    for (const auto& item : selectedObjects()) {
        if (item.kind != WorldEditorSelectionKind::Stamp) continue;
        auto& stamp = environmentRef.state().stamps[static_cast<std::size_t>(item.objectIndex)];
        const int next = wrap(stamp.catalogIndex + direction);
        stamp.catalogIndex = next;
        stamp.assetPath.clear();
        stamp.collisionRadius = environmentRendererRef.defaultStampCollisionRadius(
            static_cast<std::size_t>(next));
        currentStampCatalogIndex = next;
        hasChanged = true;
    }
    if (hasChanged) endChange();
    else {
        pendingChange.reset();
        currentStampCatalogIndex = wrap(currentStampCatalogIndex + direction);
    }
    status = hasChanged ? "Selected stamps changed" : "Placement stamp changed";
}

void WorldEditor::cycleEnemyKind(int direction) {
    constexpr int count = static_cast<int>(std::size(enemyTypeIds));
    const auto wrap = [](int value) { return (value % count + count) % count; };
    bool hasChanged = false;
    beginChange();
    for (const auto& item : selectedObjects()) {
        if (item.kind != WorldEditorSelectionKind::Enemy) continue;
        auto& enemy = environmentRef.state().enemies[
            static_cast<std::size_t>(item.objectIndex)];
        int current = 0;
        for (int index = 0; index < count; ++index) {
            if (enemy.typeId == enemyTypeIds[index]) { current = index; break; }
        }
        current = wrap(current + direction);
        enemy.typeId = enemyTypeIds[current];
        enemy.name = enemyTypeLabels[current];
        currentEnemyKindIndex = current;
        hasChanged = true;
    }
    if (hasChanged) endChange();
    else {
        pendingChange.reset();
        currentEnemyKindIndex = wrap(currentEnemyKindIndex + direction);
    }
    status = std::string{"Enemy kind: "} + enemyTypeLabels[currentEnemyKindIndex];
}

void WorldEditor::cycleZoneKind(int direction) {
    int value = static_cast<int>(currentZoneKind);
    value = (value + direction + 5) % 5;
    currentZoneKind = static_cast<dof::core::WorldZoneKind>(value);
    bool hasChanged = false;
    beginChange();
    for (const auto& item : selectedObjects()) {
        if (item.kind != WorldEditorSelectionKind::Zone) continue;
        auto& zone = environmentRef.state().zones[static_cast<std::size_t>(item.objectIndex)];
        zone.kind = currentZoneKind;
        zone.tint = byteColor(configRef, zoneColorPrefix(currentZoneKind));
        hasChanged = true;
    }
    if (hasChanged) endChange(); else pendingChange.reset();
    status = std::string{"Zone type: "} + dof::core::worldZoneKindName(currentZoneKind);
}

void WorldEditor::adjustPrimary(float direction, bool adjustsSecondary) {
    bool hasChanged = false;
    beginChange();
    for (const auto& item : selectedObjects()) {
        if (item.kind == WorldEditorSelectionKind::Path) {
            auto& path = environmentRef.state().paths[static_cast<std::size_t>(item.objectIndex)];
            if (adjustsSecondary) path.feather = std::max(0.0f, path.feather + direction * featherStep);
            else path.width = std::max(pathWidthStep, path.width + direction * pathWidthStep);
            hasChanged = true;
        } else if (item.kind == WorldEditorSelectionKind::Zone) {
            auto& zone = environmentRef.state().zones[static_cast<std::size_t>(item.objectIndex)];
            zone.feather = std::max(0.0f, zone.feather + direction * featherStep);
            hasChanged = true;
        } else if (item.kind == WorldEditorSelectionKind::Stamp) {
            auto& stamp = environmentRef.state().stamps[static_cast<std::size_t>(item.objectIndex)];
            const float delta = direction * stampScaleStep;
            if (adjustsSecondary) stamp.scale.y = std::max(0.1f, stamp.scale.y + delta);
            else {
                stamp.scale.x = std::max(0.1f, stamp.scale.x + delta);
                stamp.scale.y = std::max(0.1f, stamp.scale.y + delta);
            }
            hasChanged = true;
        }
    }
    if (hasChanged) endChange(); else pendingChange.reset();
    status = adjustsSecondary ? "Secondary size adjusted" : "Size adjusted";
}

void WorldEditor::adjustAlpha(int direction) {
    bool hasChanged = false;
    beginChange();
    for (const auto& item : selectedObjects()) {
        if (item.kind == WorldEditorSelectionKind::Path) {
            auto& alpha = environmentRef.state().paths[static_cast<std::size_t>(item.objectIndex)].tint.a;
            alpha = static_cast<std::uint8_t>(std::clamp(static_cast<int>(alpha) + direction * alphaStep, 0, 255));
        } else if (item.kind == WorldEditorSelectionKind::Zone) {
            auto& alpha = environmentRef.state().zones[static_cast<std::size_t>(item.objectIndex)].tint.a;
            alpha = static_cast<std::uint8_t>(std::clamp(static_cast<int>(alpha) + direction * alphaStep, 0, 255));
        } else if (item.kind == WorldEditorSelectionKind::Stamp) {
            auto& alpha = environmentRef.state().stamps[static_cast<std::size_t>(item.objectIndex)].alpha;
            alpha = std::clamp(alpha + direction * alphaStep, 0, 255);
        } else {
            // Enemy selections have no alpha. Without this the bare else
            // indexed `stamps` with an ENEMY index — an out-of-bounds vector
            // write whenever the enemy index exceeded the stamp count.
            continue;
        }
        hasChanged = true;
    }
    if (hasChanged) endChange(); else pendingChange.reset();
    status = "Alpha adjusted";
}

void WorldEditor::adjustRotation(float direction) {
    bool hasChanged = false;
    beginChange();
    for (const auto& item : selectedObjects()) {
        if (item.kind != WorldEditorSelectionKind::Stamp) continue;
        auto& rotation = environmentRef.state().stamps[static_cast<std::size_t>(item.objectIndex)].rotationDegrees;
        rotation = std::fmod(rotation + direction * rotationStepDegrees + 360.0f, 360.0f);
        hasChanged = true;
    }
    if (hasChanged) endChange(); else pendingChange.reset();
    status = "Stamp rotated";
}

void WorldEditor::adjustLayer(int direction) {
    bool hasChanged = false;
    beginChange();
    for (const auto& item : selectedObjects()) {
        if (item.kind == WorldEditorSelectionKind::Path) {
            environmentRef.state().paths[static_cast<std::size_t>(item.objectIndex)].zIndex += direction;
        } else if (item.kind == WorldEditorSelectionKind::Zone) {
            environmentRef.state().zones[static_cast<std::size_t>(item.objectIndex)].zIndex += direction;
        } else if (item.kind == WorldEditorSelectionKind::Stamp) {
            environmentRef.state().stamps[static_cast<std::size_t>(item.objectIndex)].layer += direction;
        } else {
            // Same out-of-bounds hazard as adjustAlpha: an Enemy selection fell
            // into the stamp branch and wrote stamps[enemyIndex].
            continue;
        }
        hasChanged = true;
    }
    if (hasChanged) endChange(); else pendingChange.reset();
    status = "Z-index adjusted";
}

void WorldEditor::adjustCollision(float direction) {
    bool hasChanged = false;
    beginChange();
    for (const auto& item : selectedObjects()) {
        if (item.kind != WorldEditorSelectionKind::Stamp) continue;
        auto& radius = environmentRef.state().stamps[static_cast<std::size_t>(item.objectIndex)].collisionRadius;
        radius = std::max(0.0f, radius + direction * collisionStep);
        hasChanged = true;
    }
    if (hasChanged) endChange(); else pendingChange.reset();
    status = "Stamp collision radius adjusted";
}

void WorldEditor::toggleWalkable() {
    bool hasChanged = false;
    beginChange();
    for (const auto& item : selectedObjects()) {
        if (item.kind != WorldEditorSelectionKind::Path
            && item.kind != WorldEditorSelectionKind::Zone) continue;
        auto& value = item.kind == WorldEditorSelectionKind::Path
            ? environmentRef.state().paths[static_cast<std::size_t>(item.objectIndex)].isWalkable
            : environmentRef.state().zones[static_cast<std::size_t>(item.objectIndex)].isWalkable;
        value = !value;
        hasChanged = true;
    }
    if (hasChanged) endChange(); else pendingChange.reset();
    status = "Walkability toggled";
}

void WorldEditor::toggleCollision() {
    bool hasChanged = false;
    beginChange();
    for (const auto& item : selectedObjects()) {
        if (item.kind == WorldEditorSelectionKind::Zone) {
            auto& value = environmentRef.state().zones[
                static_cast<std::size_t>(item.objectIndex)].isBlocking;
            value = !value;
            hasChanged = true;
        } else if (item.kind == WorldEditorSelectionKind::Stamp) {
            auto& stamp = environmentRef.state().stamps[static_cast<std::size_t>(item.objectIndex)];
            auto& radius = stamp.collisionRadius;
            radius = radius > 0.0f ? 0.0f : std::max(collisionStep,
                stamp.assetPath.empty()
                    ? environmentRendererRef.defaultStampCollisionRadius(
                        static_cast<std::size_t>(stamp.catalogIndex))
                    : collisionStep);
            hasChanged = true;
        }
    }
    if (hasChanged) endChange(); else pendingChange.reset();
    status = "Collision toggled";
}

void WorldEditor::flipSelection() {
    bool hasChanged = false;
    beginChange();
    for (const auto& item : selectedObjects()) {
        if (item.kind != WorldEditorSelectionKind::Stamp) continue;
        auto& value = environmentRef.state().stamps[
            static_cast<std::size_t>(item.objectIndex)].isFlippedX;
        value = !value;
        hasChanged = true;
    }
    if (hasChanged) endChange(); else pendingChange.reset();
    status = "Stamp mirrored";
}

void WorldEditor::beginChange() {
    if (!pendingChange.has_value()) pendingChange = environmentRef.state();
}

void WorldEditor::endChange() {
    if (!pendingChange.has_value()) return;
    const bool didEnemiesChange = !haveSameEnemyDefinitions(
        pendingChange->enemies, environmentRef.state().enemies);
    undoStates.push_back(std::move(*pendingChange));
    pendingChange.reset();
    if (static_cast<int>(undoStates.size()) > maximumHistory) undoStates.erase(undoStates.begin());
    redoStates.clear();
    if (didEnemiesChange && onEnvironmentChangedCallback) onEnvironmentChangedCallback();
}

void WorldEditor::undo() {
    cancelDraft();
    if (undoStates.empty()) { status = "Nothing to undo"; return; }
    const auto previousEnemies = environmentRef.state().enemies;
    redoStates.push_back(environmentRef.state());
    environmentRef.setState(std::move(undoStates.back()));
    undoStates.pop_back();
    clearSelectionIfInvalid();
    if (!haveSameEnemyDefinitions(previousEnemies, environmentRef.state().enemies)
        && onEnvironmentChangedCallback) onEnvironmentChangedCallback();
    status = "Undo";
}

void WorldEditor::redo() {
    cancelDraft();
    if (redoStates.empty()) { status = "Nothing to redo"; return; }
    const auto previousEnemies = environmentRef.state().enemies;
    undoStates.push_back(environmentRef.state());
    environmentRef.setState(std::move(redoStates.back()));
    redoStates.pop_back();
    clearSelectionIfInvalid();
    if (!haveSameEnemyDefinitions(previousEnemies, environmentRef.state().enemies)
        && onEnvironmentChangedCallback) onEnvironmentChangedCallback();
    status = "Redo";
}

void WorldEditor::save() {
    finishDraft();
    environmentRef.writeRuntimeValues(configRef);
    if (!writeProjectEnvironmentFile()) {
        status = "SAVE FAILED: could not update configs/world_editor.yaml";
        return;
    }
    configRef.clearUserOverride("WORLD_ENVIRONMENT_PATHS");
    configRef.clearUserOverride("WORLD_ENVIRONMENT_ZONES");
    configRef.clearUserOverride("WORLD_ENVIRONMENT_STAMPS");
    configRef.clearUserOverride("WORLD_ENVIRONMENT_ENEMIES");
    const int written = configRef.saveOverrides();
    if (written < 0) status = "SAVE FAILED: " + configRef.overridesFilePath().string();
    else {
        savedState = environmentRef.state();
        status = "Saved " + std::to_string(written) + " override values";
    }
}

bool WorldEditor::writeProjectEnvironmentFile() {
    namespace fs = std::filesystem;
    const fs::path runtimeDirectory = configRef.overridesFilePath().parent_path();
    fs::path projectDirectory = runtimeDirectory;
    const std::string buildDirectoryName = runtimeDirectory.parent_path().filename().string();
    if (buildDirectoryName == "build" || buildDirectoryName == "build-dev") {
        projectDirectory = runtimeDirectory.parent_path().parent_path() / "configs";
    }
    fs::path sourcePath = projectDirectory / "world_editor.yaml";
    if (!fs::exists(sourcePath)) sourcePath = runtimeDirectory / "world_editor.yaml";

    std::ifstream input(sourcePath);
    if (!input.is_open()) return false;
    std::vector<std::string> lines;
    std::string line;
    while (std::getline(input, line)) lines.push_back(line);
    input.close();
    const std::string paths = "WORLD_ENVIRONMENT_PATHS:"
        + (environmentRef.serializePaths().empty() ? std::string{} : " " + environmentRef.serializePaths());
    const std::string zones = "WORLD_ENVIRONMENT_ZONES:"
        + (environmentRef.serializeZones().empty() ? std::string{} : " " + environmentRef.serializeZones());
    const std::string stamps = "WORLD_ENVIRONMENT_STAMPS:"
        + (environmentRef.serializeStamps().empty() ? std::string{} : " " + environmentRef.serializeStamps());
    const std::string enemies = "WORLD_ENVIRONMENT_ENEMIES:"
        + (environmentRef.serializeEnemies().empty() ? std::string{} : " " + environmentRef.serializeEnemies());
    const auto replace = [&](const std::string& prefix, const std::string& replacement) {
        for (auto& existing : lines) {
            if (existing.starts_with(prefix)) {
                existing = replacement;
                return true;
            }
        }
        return false;
    };
    if (!replace("WORLD_ENVIRONMENT_PATHS:", paths)
        || !replace("WORLD_ENVIRONMENT_ZONES:", zones)
        || !replace("WORLD_ENVIRONMENT_STAMPS:", stamps)
        || !replace("WORLD_ENVIRONMENT_ENEMIES:", enemies)) return false;

    const fs::path temporaryPath = sourcePath.string() + ".tmp";
    std::ofstream output(temporaryPath, std::ios::trunc);
    if (!output.is_open()) return false;
    for (const auto& outputLine : lines) output << outputLine << '\n';
    output.close();
    if (!output) return false;
    std::error_code error;
    fs::rename(temporaryPath, sourcePath, error);
    if (error) {
        fs::remove(temporaryPath);
        return false;
    }
    const fs::path runtimePath = runtimeDirectory / "world_editor.yaml";
    if (fs::weakly_canonical(runtimePath) != fs::weakly_canonical(sourcePath)) {
        fs::copy_file(sourcePath, runtimePath, fs::copy_options::overwrite_existing, error);
        if (error) return false;
    }
    return true;
}

void WorldEditor::restoreSaved() {
    cancelDraft();
    beginChange();
    environmentRef.setState(savedState);
    clearSelections();
    endChange();
    status = "Restored last saved environment";
}

void WorldEditor::clearSelectionIfInvalid() {
    const auto& state = environmentRef.state();
    const auto isValid = [&](const Selection& item) {
        return item.objectIndex >= 0
            && ((item.kind == WorldEditorSelectionKind::Path
                 && static_cast<std::size_t>(item.objectIndex) < state.paths.size())
                || (item.kind == WorldEditorSelectionKind::Zone
                    && static_cast<std::size_t>(item.objectIndex) < state.zones.size())
                || (item.kind == WorldEditorSelectionKind::Stamp
                    && static_cast<std::size_t>(item.objectIndex) < state.stamps.size())
                || (item.kind == WorldEditorSelectionKind::Enemy
                    && static_cast<std::size_t>(item.objectIndex) < state.enemies.size()));
    };
    additionalSelections.erase(std::remove_if(
        additionalSelections.begin(), additionalSelections.end(),
        [&](const Selection& item) { return !isValid(item); }), additionalSelections.end());
    if (!isValid(selection)) {
        if (additionalSelections.empty()) selection = {};
        else {
            selection = additionalSelections.front();
            additionalSelections.erase(additionalSelections.begin());
        }
    }
    if (selection.pointIndex >= 0) {
        const bool isValidPoint = selection.kind == WorldEditorSelectionKind::Path
            ? static_cast<std::size_t>(selection.pointIndex)
                < state.paths[static_cast<std::size_t>(selection.objectIndex)].points.size()
            : selection.kind == WorldEditorSelectionKind::Zone
                && static_cast<std::size_t>(selection.pointIndex)
                    < state.zones[static_cast<std::size_t>(selection.objectIndex)].points.size();
        if (!isValidPoint) selection.pointIndex = -1;
    }
}

sf::Vector2f WorldEditor::snap(sf::Vector2f value) const {
    if (!isSnapEnabled || gridSize <= 0.0f) return value;
    return {std::round(value.x / gridSize) * gridSize,
            std::round(value.y / gridSize) * gridSize};
}

sf::Vector2f WorldEditor::snapDragDelta(sf::Vector2f rawDelta,
                                        float cameraZoom) const {
    if (!isSnapEnabled) return rawDelta;
    sf::Vector2f result = gridSize > 0.0f
        ? sf::Vector2f{std::round(rawDelta.x / gridSize) * gridSize,
                       std::round(rawDelta.y / gridSize) * gridSize}
        : rawDelta;

    std::vector<float> movingX;
    std::vector<float> movingY;
    std::vector<float> targetX;
    std::vector<float> targetY;
    const auto selected = selectedObjects();
    const auto isSelected = [&](WorldEditorSelectionKind kind, int objectIndex) {
        return std::ranges::any_of(selected, [&](const Selection& item) {
            return item.kind == kind && item.objectIndex == objectIndex;
        });
    };
    const auto appendBounds = [](const std::vector<sf::Vector2f>& points,
                                 std::vector<float>& xs, std::vector<float>& ys) {
        if (points.empty()) return;
        float left = points.front().x;
        float right = left;
        float top = points.front().y;
        float bottom = top;
        for (const auto point : points) {
            left = std::min(left, point.x); right = std::max(right, point.x);
            top = std::min(top, point.y); bottom = std::max(bottom, point.y);
        }
        xs.insert(xs.end(), {left, (left + right) * 0.5f, right});
        ys.insert(ys.end(), {top, (top + bottom) * 0.5f, bottom});
    };
    const auto& current = environmentRef.state();
    const auto& original = pendingChange ? *pendingChange : current;
    for (std::size_t index = 0; index < current.paths.size(); ++index) {
        auto& xs = isSelected(WorldEditorSelectionKind::Path, static_cast<int>(index))
            ? movingX : targetX;
        auto& ys = isSelected(WorldEditorSelectionKind::Path, static_cast<int>(index))
            ? movingY : targetY;
        appendBounds(isSelected(WorldEditorSelectionKind::Path, static_cast<int>(index))
            ? original.paths[index].points : current.paths[index].points, xs, ys);
    }
    for (std::size_t index = 0; index < current.zones.size(); ++index) {
        auto& xs = isSelected(WorldEditorSelectionKind::Zone, static_cast<int>(index))
            ? movingX : targetX;
        auto& ys = isSelected(WorldEditorSelectionKind::Zone, static_cast<int>(index))
            ? movingY : targetY;
        appendBounds(isSelected(WorldEditorSelectionKind::Zone, static_cast<int>(index))
            ? original.zones[index].points : current.zones[index].points, xs, ys);
    }
    for (std::size_t index = 0; index < current.stamps.size(); ++index) {
        const bool selectedStamp = isSelected(
            WorldEditorSelectionKind::Stamp, static_cast<int>(index));
        auto bounds = environmentRendererRef.stampWorldBounds(index);
        if (selectedStamp) {
            bounds.position += original.stamps[index].position
                             - current.stamps[index].position;
        }
        auto& xs = selectedStamp ? movingX : targetX;
        auto& ys = selectedStamp ? movingY : targetY;
        xs.insert(xs.end(), {bounds.position.x,
                             bounds.position.x + bounds.size.x * 0.5f,
                             bounds.position.x + bounds.size.x});
        ys.insert(ys.end(), {bounds.position.y,
                             bounds.position.y + bounds.size.y * 0.5f,
                             bounds.position.y + bounds.size.y});
    }
    for (std::size_t index = 0; index < current.enemies.size(); ++index) {
        const bool selectedEnemy = isSelected(
            WorldEditorSelectionKind::Enemy, static_cast<int>(index));
        const auto position = selectedEnemy
            ? original.enemies[index].position : current.enemies[index].position;
        auto& xs = selectedEnemy ? movingX : targetX;
        auto& ys = selectedEnemy ? movingY : targetY;
        xs.push_back(position.x);
        ys.push_back(position.y);
    }

    const float threshold = magnetSnapPixels / std::max(0.01f, cameraZoom);
    const auto magneticCorrection = [threshold](const std::vector<float>& moving,
                                                const std::vector<float>& targets,
                                                float delta) {
        float correction = 0.0f;
        float bestDistance = threshold + 1.0f;
        for (const float source : moving) {
            for (const float target : targets) {
                const float candidate = target - (source + delta);
                const float distance = std::abs(candidate);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    correction = candidate;
                }
            }
        }
        return bestDistance <= threshold ? correction : 0.0f;
    };
    result.x += magneticCorrection(movingX, targetX, result.x);
    result.y += magneticCorrection(movingY, targetY, result.y);
    return result;
}

float WorldEditor::pickRadius(float cameraZoom) const {
    return pickRadiusPixels / std::max(0.01f, cameraZoom);
}

std::string WorldEditor::selectionSummary() const {
    const auto& state = environmentRef.state();
    std::ostringstream out;
    const auto objects = selectedObjects();
    if (objects.size() > 1u) {
        out << objects.size() << " objects selected";
        return out.str();
    }
    if (selection.kind == WorldEditorSelectionKind::Path && selection.objectIndex >= 0) {
        const auto& path = state.paths[static_cast<std::size_t>(selection.objectIndex)];
        out << path.name << " | width " << static_cast<int>(path.width)
            << " feather " << static_cast<int>(path.feather)
            << " z " << path.zIndex;
        if (path.materialIndex >= 0) {
            out << " | style " << environmentRendererRef.materialName(
                static_cast<std::size_t>(path.materialIndex));
        } else if (!path.atlasAssetPath.empty()) {
            out << " | atlas "
                << std::filesystem::path(path.atlasAssetPath).filename().string();
        }
    } else if (selection.kind == WorldEditorSelectionKind::Zone && selection.objectIndex >= 0) {
        const auto& zone = state.zones[static_cast<std::size_t>(selection.objectIndex)];
        out << zone.name << " | " << dof::core::worldZoneKindName(zone.kind)
            << " z " << zone.zIndex
            << " | walk " << (zone.isWalkable ? "yes" : "no")
            << " block " << (zone.isBlocking ? "yes" : "no");
        if (!zone.assetPath.empty()) {
            out << " | floor " << std::filesystem::path(zone.assetPath).filename().string();
        } else if (zone.materialIndex >= 0) {
            out << " | style " << environmentRendererRef.materialName(
                static_cast<std::size_t>(zone.materialIndex));
        }
    } else if (selection.kind == WorldEditorSelectionKind::Stamp && selection.objectIndex >= 0) {
        const auto& stamp = state.stamps[static_cast<std::size_t>(selection.objectIndex)];
        out << stamp.name;
        if (!stamp.assetPath.empty()) {
            out << " | " << std::filesystem::path(stamp.assetPath).filename().string();
        }
        out << " | scale " << stamp.scale.x << ',' << stamp.scale.y
            << " rot " << static_cast<int>(stamp.rotationDegrees)
            << " z " << stamp.layer << " collision " << stamp.collisionRadius;
    } else if (selection.kind == WorldEditorSelectionKind::Enemy && selection.objectIndex >= 0) {
        const auto& enemy = state.enemies[static_cast<std::size_t>(selection.objectIndex)];
        out << enemy.name << " | " << enemy.typeId
            << " | level " << enemy.level << " tier " << enemy.tier;
    } else out << "Nothing selected";
    return out.str();
}

sf::FloatRect WorldEditor::panelRect(sf::Vector2u uiSize) const {
    const float height = std::min(panelHeight,
        static_cast<float>(uiSize.y) - panelMargin * 2.0f);
    return {{static_cast<float>(uiSize.x) - panelWidth - panelMargin, panelMargin},
            {panelWidth, height}};
}

sf::FloatRect WorldEditor::toolBarRect(sf::Vector2u uiSize) const {
    const auto panel = panelRect(uiSize);
    return {{panel.position.x + panelPadding,
             panel.position.y + panelPadding + titleFontSize + lineSpacing + 34.0f},
            {panel.size.x - panelPadding * 2.0f, 66.0f}};
}

sf::FloatRect WorldEditor::menuBarRect(sf::Vector2u uiSize) const {
    const auto panel = panelRect(uiSize);
    return {{panel.position.x + 2.0f,
             panel.position.y + panelPadding + titleFontSize + lineSpacing},
            {panel.size.x - 4.0f, 30.0f}};
}

sf::FloatRect WorldEditor::menuHeaderRect(std::size_t index,
                                          sf::Vector2u uiSize) const {
    const auto bar = menuBarRect(uiSize);
    constexpr float widths[4]{72.0f, 72.0f, 72.0f, 72.0f};
    float x = bar.position.x + 8.0f;
    for (std::size_t previous = 0; previous < index; ++previous) x += widths[previous];
    return {{x, bar.position.y}, {widths[index], bar.size.y}};
}

sf::FloatRect WorldEditor::menuItemRect(std::size_t menu, std::size_t item,
                                        sf::Vector2u uiSize) const {
    const auto header = menuHeaderRect(menu, uiSize);
    return {{header.position.x, header.position.y + header.size.y
                + static_cast<float>(item) * 28.0f},
            {menu == 3u ? 170.0f : 220.0f, 28.0f}};
}

sf::FloatRect WorldEditor::toolButtonRect(std::size_t index,
                                          sf::Vector2u uiSize) const {
    const auto bar = toolBarRect(uiSize);
    constexpr float gap = 7.0f;
    const float width = (bar.size.x - gap * 5.0f) / 6.0f;
    return {{bar.position.x + static_cast<float>(index) * (width + gap), bar.position.y},
            {width, bar.size.y}};
}

sf::FloatRect WorldEditor::inlineHelpRect(sf::Vector2u uiSize) const {
    const auto panel = panelRect(uiSize);
    const auto bar = toolBarRect(uiSize);
    const float top = bar.position.y + bar.size.y + 78.0f;
    return {{panel.position.x + panelPadding, top},
            {panel.size.x - panelPadding * 2.0f,
             std::max(1.0f, panel.position.y + panel.size.y - panelPadding - top)}};
}

int WorldEditor::maximumInlineHelpScroll(sf::Vector2u uiSize) const {
    const int visibleRows = std::max(1, static_cast<int>(
        std::floor(inlineHelpRect(uiSize).size.y / std::max(1.0f, inlineHelpRowHeight))));
    const auto rows = contextualHelpRows(tool, selection.kind,
                                         selectedObjects().size(),
                                         selection.pointIndex >= 0);
    return std::max(0, static_cast<int>(rows.size()) - visibleRows);
}

bool WorldEditor::isPointerOverPanel(sf::Vector2f uiPosition,
                                     sf::Vector2u uiSize) const {
    return panelRect(uiSize).contains(uiPosition);
}

bool WorldEditor::isPointerOverEditorUi(sf::Vector2f uiPosition,
                                        sf::Vector2u uiSize) const {
    return panelRect(uiSize).contains(uiPosition)
        || assetGallery->windowRect(uiSize).contains(uiPosition);
}

void WorldEditor::drawWorldOverlay(sf::RenderTarget& target,
                                   const sf::View& worldView) const {
    if (!isOpenValue || !isOverlayVisible) return;
    const float viewZoom = static_cast<float>(configRef.getInt("GLOBAL_SCREEN_WIDTH"))
                         / std::max(1.0f, worldView.getSize().x);
    if (isGridVisible && gridSize > 0.0f) {
        const auto size = worldView.getSize();
        const auto center = worldView.getCenter();
        const float left = center.x - size.x * 0.5f;
        const float right = center.x + size.x * 0.5f;
        const float top = center.y - size.y * 0.5f;
        const float bottom = center.y + size.y * 0.5f;
        sf::VertexArray grid(sf::PrimitiveType::Lines);
        int verticalLines = 0;
        for (float x = std::floor(left / gridSize) * gridSize;
             x <= right && verticalLines < maximumGridLines;
             x += gridSize, ++verticalLines) {
            const auto count = grid.getVertexCount(); grid.resize(count + 2u);
            grid[count] = {{x, top}, gridColor}; grid[count + 1u] = {{x, bottom}, gridColor};
        }
        int horizontalLines = 0;
        for (float y = std::floor(top / gridSize) * gridSize;
             y <= bottom && horizontalLines < maximumGridLines;
             y += gridSize, ++horizontalLines) {
            const auto count = grid.getVertexCount(); grid.resize(count + 2u);
            grid[count] = {{left, y}, gridColor}; grid[count + 1u] = {{right, y}, gridColor};
        }
        target.draw(grid);
    }
    const auto& state = environmentRef.state();
    if (isWalkabilityLayerVisible) {
        for (std::size_t index = 0; index < state.paths.size(); ++index) {
            const auto& path = state.paths[index];
            drawPathCoverage(target, path,
                environmentRendererRef.atlasPathGuidePoints(index),
                path.isWalkable ? walkableColor : nonWalkableColor);
        }
        for (const auto& zone : state.zones) {
            drawPolygonCoverage(target, zone.points,
                zone.isWalkable ? walkableColor : nonWalkableColor);
        }
    }
    if (isCollisionLayerVisible) {
        for (const auto& zone : state.zones) {
            if (zone.isBlocking) drawPolygonCoverage(target, zone.points, collisionColor);
        }
    }
    for (std::size_t index = 0; index < state.paths.size(); ++index) {
        const bool selected = isObjectSelected(
            WorldEditorSelectionKind::Path, static_cast<int>(index));
        drawLineStrip(target, environmentRendererRef.atlasPathGuidePoints(index),
                      false, selected ? selectedColor : pathColor);
        if (selected) {
            const float radius = handleRadiusPixels
                / std::max(0.01f, viewZoom);
            for (std::size_t point = 0; point < state.paths[index].points.size(); ++point) {
                sf::CircleShape handle(radius, 16);
                handle.setOrigin({radius, radius});
                handle.setPosition(state.paths[index].points[point]);
                handle.setFillColor(selection.pointIndex == static_cast<int>(point)
                    ? selectedColor : pathColor);
                target.draw(handle);
            }
            if (isDrafting && static_cast<int>(index) == selection.objectIndex && !state.paths[index].points.empty()) {
                const std::vector<sf::Vector2f> previewLine{state.paths[index].points.back(), cursorWorld};
                drawLineStrip(target, previewLine, false, accentColor);
            }
        }
    }
    for (std::size_t index = 0; index < state.zones.size(); ++index) {
        const bool selected = isObjectSelected(
            WorldEditorSelectionKind::Zone, static_cast<int>(index));
        drawLineStrip(target, state.zones[index].points, true,
                      selected ? selectedColor : zoneColor);
        if (selected) {
            const float radius = handleRadiusPixels
                / std::max(0.01f, viewZoom);
            for (std::size_t point = 0; point < state.zones[index].points.size(); ++point) {
                sf::CircleShape handle(radius, 16);
                handle.setOrigin({radius, radius});
                handle.setPosition(state.zones[index].points[point]);
                handle.setFillColor(selection.pointIndex == static_cast<int>(point)
                    ? selectedColor : zoneColor);
                target.draw(handle);
            }
        }
    }
    for (std::size_t index = 0; index < state.stamps.size(); ++index) {
        const auto& stamp = state.stamps[index];
        if (isCollisionLayerVisible && stamp.collisionRadius > 0.0f) {
            sf::CircleShape collision(stamp.collisionRadius, 48);
            collision.setOrigin({stamp.collisionRadius, stamp.collisionRadius});
            collision.setPosition(stamp.position);
            collision.setFillColor(sf::Color::Transparent);
            collision.setOutlineThickness(4.0f / std::max(0.01f, viewZoom));
            collision.setOutlineColor(collisionColor);
            target.draw(collision);
        }
        if (isObjectSelected(WorldEditorSelectionKind::Stamp, static_cast<int>(index))) {
            const auto bounds = environmentRendererRef.stampWorldBounds(index);
            const sf::Vector2f center = bounds.position + bounds.size * 0.5f;
            const float radius = std::max(25.0f,
                std::max(bounds.size.x, bounds.size.y) * 0.5f);
            sf::CircleShape selected(radius, 48);
            selected.setOrigin({radius, radius});
            selected.setPosition(center);
            selected.setFillColor(sf::Color::Transparent);
            selected.setOutlineThickness(5.0f / std::max(0.01f, viewZoom));
            selected.setOutlineColor(selectedColor);
            target.draw(selected);
        }
    }
    for (std::size_t index = 0; index < state.enemies.size(); ++index) {
        const auto& definition = state.enemies[index];
        const bool isSelected = isObjectSelected(
            WorldEditorSelectionKind::Enemy, static_cast<int>(index));
        sf::CircleShape marker(enemyMarkerRadius, 6u);
        marker.setOrigin({enemyMarkerRadius, enemyMarkerRadius});
        marker.setPosition(definition.position);
        marker.setFillColor(sf::Color{180, 35, 55, 55});
        marker.setOutlineColor(isSelected ? selectedColor
                                          : sf::Color{255, 75, 95, 220});
        marker.setOutlineThickness((isSelected ? 6.0f : 3.0f)
                                   / std::max(0.01f, viewZoom));
        target.draw(marker);
    }
    if (isMarqueeSelecting) {
        const sf::Vector2f position{
            std::min(marqueeStartWorld.x, marqueeEndWorld.x),
            std::min(marqueeStartWorld.y, marqueeEndWorld.y)};
        const sf::Vector2f size{
            std::abs(marqueeEndWorld.x - marqueeStartWorld.x),
            std::abs(marqueeEndWorld.y - marqueeStartWorld.y)};
        sf::Color fill = selectedColor;
        fill.a = 35u;
        sf::RectangleShape marquee(size);
        marquee.setPosition(position);
        marquee.setFillColor(fill);
        marquee.setOutlineColor(selectedColor);
        marquee.setOutlineThickness(2.0f / std::max(0.01f, viewZoom));
        target.draw(marquee);
    }
    if (!activeGalleryAssetPath.empty()
        && assetGallery->containsAsset(activeGalleryAssetPath)
        && (tool == WorldEditorTool::Select || tool == WorldEditorTool::Stamp)) {
        environmentRendererRef.drawAssetPreview(
            target, activeGalleryAssetPath, galleryStampWorldWidth, snap(cursorWorld));
    } else if (tool == WorldEditorTool::Stamp && !isDrafting) {
        environmentRendererRef.drawStampPreview(
            target, currentStampCatalogIndex, snap(cursorWorld));
    } else if (tool == WorldEditorTool::Enemy) {
        sf::CircleShape preview(enemyMarkerRadius, 6u);
        preview.setOrigin({enemyMarkerRadius, enemyMarkerRadius});
        preview.setPosition(snap(cursorWorld));
        preview.setFillColor(sf::Color{180, 35, 55, 45});
        preview.setOutlineColor(selectedColor);
        preview.setOutlineThickness(3.0f / std::max(0.01f, viewZoom));
        target.draw(preview);
    }
    if (isDrafting && selection.objectIndex >= 0) {
        sf::Vector2f lastPoint{};
        bool hasLastPoint = false;
        if (selection.kind == WorldEditorSelectionKind::Path) {
            const auto& points = state.paths[static_cast<std::size_t>(selection.objectIndex)].points;
            if (!points.empty()) { lastPoint = points.back(); hasLastPoint = true; }
        } else if (selection.kind == WorldEditorSelectionKind::Zone) {
            const auto& points = state.zones[static_cast<std::size_t>(selection.objectIndex)].points;
            if (!points.empty()) { lastPoint = points.back(); hasLastPoint = true; }
        }
        if (hasLastPoint) {
            sf::VertexArray preview(sf::PrimitiveType::Lines, 2u);
            preview[0] = {lastPoint, selectedColor};
            sf::Color faded = selectedColor; faded.a = 100u;
            preview[1] = {snap(cursorWorld), faded};
            target.draw(preview);
        }
    }
    const float crossSize = 18.0f / std::max(0.01f, viewZoom);
    sf::VertexArray crosshair(sf::PrimitiveType::Lines, 4u);
    crosshair[0] = {{cursorWorld.x - crossSize, cursorWorld.y}, accentColor};
    crosshair[1] = {{cursorWorld.x + crossSize, cursorWorld.y}, accentColor};
    crosshair[2] = {{cursorWorld.x, cursorWorld.y - crossSize}, accentColor};
    crosshair[3] = {{cursorWorld.x, cursorWorld.y + crossSize}, accentColor};
    target.draw(crosshair);
}

void WorldEditor::drawPanel(sf::RenderWindow& window, sf::Vector2u uiSize) const {
    if (!isOpenValue) return;
    const auto rect = panelRect(uiSize);
    sf::RectangleShape panel(rect.size);
    panel.setPosition(rect.position);
    panel.setFillColor(panelColor);
    panel.setOutlineColor(accentColor);
    panel.setOutlineThickness(2.0f);
    window.draw(panel);

    const float x = rect.position.x + panelPadding;
    float y = rect.position.y + panelPadding;
    const auto drawLine = [&](const std::string& value, sf::Vector2f position,
                              sf::Color color, float size) {
        sf::Text text(fontRef, value, static_cast<unsigned>(size));
        text.setPosition(position);
        text.setFillColor(color);
        window.draw(text);
    };
    drawLine("WORLD EDITOR", {x, y}, accentColor, titleFontSize);

    const auto menuBar = menuBarRect(uiSize);
    sf::RectangleShape menuBackground(menuBar.size);
    menuBackground.setPosition(menuBar.position);
    menuBackground.setFillColor(sf::Color{18, 28, 36, 250});
    window.draw(menuBackground);
    constexpr const char* menuNames[4]{"FILE", "EDIT", "VIEW", "HELP"};
    for (std::size_t index = 0; index < 4u; ++index) {
        const auto header = menuHeaderRect(index, uiSize);
        if (openMenuIndex == static_cast<int>(index)) {
            sf::RectangleShape active(header.size);
            active.setPosition(header.position);
            active.setFillColor(sf::Color{22, 70, 82, 250});
            window.draw(active);
        }
        drawLine(menuNames[index], {header.position.x + 9.0f, header.position.y + 6.0f},
                 textColor, textFontSize);
    }

    constexpr WorldEditorTool tools[5]{WorldEditorTool::Select, WorldEditorTool::Path,
                                        WorldEditorTool::Zone, WorldEditorTool::Stamp,
                                        WorldEditorTool::Enemy};
    constexpr const char* labels[6]{"SELECT", "PATH", "ZONE", "STAMP", "ENEMY", "HELP"};
    constexpr const char* hints[6]{
        "Select, marquee, and move one or many objects (Alt+V)",
        "Draw or continue smart paths (Alt+P)",
        "Draw zones; drag an existing zone or point to move it (Alt+Z)",
        "Place scenery from the catalog or Gallery (Alt+T)",
        "Place any configured enemy kind (Alt+Shift+T)",
        "Open the categorized shortcut reference (Alt+H / F1)"};
    int hoveredTool = -1;
    for (std::size_t index = 0; index < 6u; ++index) {
        const auto button = toolButtonRect(index, uiSize);
        const bool isActive = index < 5u && tool == tools[index];
        const bool isHovered = button.contains(cursorUi);
        if (isHovered) hoveredTool = static_cast<int>(index);
        sf::RectangleShape background(button.size);
        background.setPosition(button.position);
        background.setFillColor(isActive ? sf::Color{22, 70, 82, 250}
                                         : sf::Color{18, 28, 36, 245});
        background.setOutlineColor(isActive ? selectedColor
                                            : (isHovered ? accentColor : dimColor));
        background.setOutlineThickness(isActive ? 2.0f : 1.0f);
        window.draw(background);

        const sf::Vector2f center{button.position.x + button.size.x * 0.5f,
                                  button.position.y + 22.0f};
        if (index == 0u) {
            sf::VertexArray pointer(sf::PrimitiveType::LineStrip, 4u);
            pointer[0] = {{center.x - 9.0f, center.y - 11.0f}, accentColor};
            pointer[1] = {{center.x + 8.0f, center.y}, accentColor};
            pointer[2] = {{center.x - 1.0f, center.y + 3.0f}, accentColor};
            pointer[3] = {{center.x + 5.0f, center.y + 12.0f}, accentColor};
            window.draw(pointer);
        } else if (index == 1u) {
            sf::VertexArray path(sf::PrimitiveType::LineStrip, 3u);
            path[0] = {{center.x - 12.0f, center.y + 7.0f}, accentColor};
            path[1] = {{center.x, center.y - 8.0f}, accentColor};
            path[2] = {{center.x + 12.0f, center.y + 4.0f}, accentColor};
            window.draw(path);
        } else if (index == 2u) {
            sf::VertexArray zone(sf::PrimitiveType::LineStrip, 5u);
            zone[0] = {{center.x - 12.0f, center.y + 5.0f}, accentColor};
            zone[1] = {{center.x - 5.0f, center.y - 9.0f}, accentColor};
            zone[2] = {{center.x + 11.0f, center.y - 5.0f}, accentColor};
            zone[3] = {{center.x + 8.0f, center.y + 9.0f}, accentColor};
            zone[4] = zone[0];
            window.draw(zone);
        } else if (index == 3u) {
            sf::RectangleShape stamp({24.0f, 20.0f});
            stamp.setOrigin({12.0f, 10.0f});
            stamp.setPosition(center);
            stamp.setFillColor(sf::Color::Transparent);
            stamp.setOutlineColor(accentColor);
            stamp.setOutlineThickness(2.0f);
            window.draw(stamp);
        } else if (index == 4u) {
            sf::CircleShape enemy(11.0f, 6u);
            enemy.setOrigin({11.0f, 11.0f});
            enemy.setPosition(center);
            enemy.setFillColor(sf::Color::Transparent);
            enemy.setOutlineColor(accentColor);
            enemy.setOutlineThickness(2.0f);
            window.draw(enemy);
        } else {
            drawLine("?", {center.x - 5.0f, center.y - 14.0f}, selectedColor, 24.0f);
        }
        drawLine(labels[index], {button.position.x + 8.0f,
                 button.position.y + button.size.y - 20.0f},
                 isActive ? selectedColor : textColor, 12.0f);
    }

    y = toolBarRect(uiSize).position.y + toolBarRect(uiSize).size.y + 12.0f;
    drawLine(std::string{"ACTIVE  "} + toolName(tool), {x, y}, accentColor, 13.0f);
    const auto fitLine = [](std::string value, std::size_t maximum) {
        if (value.size() <= maximum) return value;
        value.resize(maximum > 3u ? maximum - 3u : maximum);
        if (maximum > 3u) value += "...";
        return value;
    };
    y += textFontSize + lineSpacing;
    drawLine(fitLine(selectionSummary(), 52u), {x, y}, selectedColor, 13.0f);
    y += textFontSize + lineSpacing;
    drawLine(fitLine(hoveredTool >= 0 ? hints[static_cast<std::size_t>(hoveredTool)]
                                     : status, 58u),
             {x, y}, hoveredTool >= 0 ? dimColor : textColor, 12.0f);

    const auto helpRect = inlineHelpRect(uiSize);
    drawLine("WORLD EDITOR HELP  (wheel to scroll)",
             {helpRect.position.x, helpRect.position.y - 18.0f}, accentColor, 12.0f);
    sf::RectangleShape helpBackground(helpRect.size);
    helpBackground.setPosition(helpRect.position);
    helpBackground.setFillColor(sf::Color{10, 17, 23, 245});
    helpBackground.setOutlineColor(dimColor);
    helpBackground.setOutlineThickness(1.0f);
    window.draw(helpBackground);
    const int visibleRows = std::max(1, static_cast<int>(
        std::floor(helpRect.size.y / std::max(1.0f, inlineHelpRowHeight))));
    const auto helpRows = contextualHelpRows(tool, selection.kind,
                                             selectedObjects().size(),
                                             selection.pointIndex >= 0);
    const int maximumScroll = maximumInlineHelpScroll(uiSize);
    const std::size_t firstRow = std::min(helpRows.size(),
        static_cast<std::size_t>(std::clamp(inlineHelpScrollRow, 0, maximumScroll)));
    const std::size_t lastRow = std::min(helpRows.size(),
        firstRow + static_cast<std::size_t>(visibleRows));
    for (std::size_t row = firstRow; row < lastRow; ++row) {
        const float rowY = helpRect.position.y
            + static_cast<float>(row - firstRow) * inlineHelpRowHeight;
        if (helpRows[row].isCategory) {
            sf::RectangleShape category({helpRect.size.x - 6.0f, inlineHelpRowHeight});
            category.setPosition({helpRect.position.x, rowY});
            category.setFillColor(sf::Color{22, 70, 82, 220});
            window.draw(category);
            drawLine(helpRows[row].keys, {helpRect.position.x + 6.0f, rowY + 2.0f},
                     accentColor, 11.0f);
        } else {
            drawLine(helpRows[row].keys, {helpRect.position.x + 6.0f, rowY + 2.0f},
                     selectedColor, 11.0f);
            drawLine(helpRows[row].action, {helpRect.position.x + 112.0f, rowY + 2.0f},
                     textColor, 11.0f);
        }
    }
    if (maximumScroll > 0) {
        constexpr float scrollWidth = 4.0f;
        const float thumbHeight = std::max(18.0f,
            helpRect.size.y * static_cast<float>(visibleRows)
                / static_cast<float>(helpRows.size()));
        const float travel = std::max(0.0f, helpRect.size.y - thumbHeight);
        const float thumbY = helpRect.position.y + travel
            * static_cast<float>(std::clamp(inlineHelpScrollRow, 0, maximumScroll))
                / static_cast<float>(maximumScroll);
        sf::RectangleShape thumb({scrollWidth, thumbHeight});
        thumb.setPosition({helpRect.position.x + helpRect.size.x - scrollWidth - 2.0f,
                           thumbY});
        thumb.setFillColor(accentColor);
        window.draw(thumb);
    }

    if (openMenuIndex >= 0) {
        constexpr const char* fileItems[2]{"Save                 Alt+S",
                                           "Restore saved   Alt+Shift+S"};
        constexpr const char* editItems[4]{"Undo                 Alt+U",
                                           "Redo           Alt+Shift+U",
                                           "Duplicate            Alt+D",
                                           "Delete         Alt+Shift+D"};
        constexpr const char* viewItems[4]{"Toggle snap           Alt+G",
                                           "Toggle grid     Alt+Shift+G",
                                           "Gallery size          Alt+B",
                                           "Toggle guides   Alt+Shift+T"};
        const std::size_t count = openMenuIndex == 0 ? 2u
            : openMenuIndex == 1 ? 4u : openMenuIndex == 2 ? 4u : 1u;
        for (std::size_t item = 0; item < count; ++item) {
            const auto itemRect = menuItemRect(static_cast<std::size_t>(openMenuIndex),
                                               item, uiSize);
            sf::RectangleShape itemBackground(itemRect.size);
            itemBackground.setPosition(itemRect.position);
            itemBackground.setFillColor(itemRect.contains(cursorUi)
                ? sf::Color{22, 70, 82, 255} : sf::Color{10, 17, 23, 255});
            itemBackground.setOutlineColor(dimColor);
            itemBackground.setOutlineThickness(1.0f);
            window.draw(itemBackground);
            const char* label = openMenuIndex == 0 ? fileItems[item]
                : openMenuIndex == 1 ? editItems[item]
                : openMenuIndex == 2 ? viewItems[item] : "Full Help       Alt+H / F1";
            drawLine(label, {itemRect.position.x + 8.0f, itemRect.position.y + 5.0f},
                     textColor, 13.0f);
        }
    }
    assetGallery->draw(window, uiSize, activeGalleryAssetPath);
}

} // namespace dof::render
