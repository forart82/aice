#pragma once

#include "render/EnemyShapeCatalog.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Texture.hpp>
#include <SFML/Graphics/Image.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/System/Vector2.hpp>

#include <array>
#include <string>
#include <memory>
#include <unordered_map>
#include <vector>

namespace dof::core { class WorldEnvironment; struct WorldPathDefinition; }
namespace dof::loaders { class ConfigLoader; }
namespace sf { class RenderTarget; }

namespace dof::render {

struct WorldMaterialCatalogEntry {
    std::string name;
    sf::Texture texture;
    float worldSize{1000.0f};
    std::string pathAtlasAssetPath;
};

struct WorldStampCatalogEntry {
    std::string name;
    sf::Texture texture;
    int columns{1};
    int rows{1};
    int cellIndex{0};
    float worldWidth{1000.0f};
    sf::Vector2f originRatio{0.5f, 1.0f};
    float defaultCollisionRadius{0.0f};
    // >= 0 marks this entry as a code-drawn neon prop rather than a sprite: the
    // index selects a silhouette from the shared shape catalog and `texture` is
    // left empty. Lets the existing editor stamp tool place neon props with no
    // editor change, since it only ever picks a catalog entry by index.
    int neonShapeIndex{-1};
};

// Code-drawn neon world geometry. Same glow construction as the actor halos
// (a bright core wrapped in stacked bands falling off as base / (layer + 1)),
// scaled down by subordinateScale so the world never outshines the hero.
struct WorldNeonParams {
    bool      isZoneEdgeEnabled{false};
    sf::Color zoneEdgeColor{sf::Color::White};
    float     zoneEdgeThickness{0.0f};
    int       glowLayers{0};
    float     glowStep{0.0f};
    int       glowAlphaBase{0};
    float     subordinateScale{1.0f};
    sf::Color propRimColor{sf::Color::White};
    sf::Color propFillColor{sf::Color::Black};
    float     propRimRatio{0.0f};
    float     propGlowSpreadRatio{0.0f};
};

struct PathAtlasMetadata {
    std::array<bool, 36> availableCells{};
    std::array<std::vector<sf::Vector2f>, 36> cellPorts;
    std::array<std::vector<float>, 36> cellPortAnglesDegrees;
    float canonicalPortWidth{0.0f};
};

struct ResolvedPathAtlasModule {
    int cellIndex{-1};
    sf::Vector2f entry;
    sf::Vector2f centre;
    sf::Vector2f exit;
    sf::Vector2f incomingDirection;
    sf::Vector2f outgoingDirection;
    float rotationDegrees{0.0f};
};

struct ResolvedPathAtlasLayout {
    std::vector<ResolvedPathAtlasModule> modules;
    std::vector<sf::Vector2f> guidePoints;
    float moduleWorldSize{0.0f};
};

struct CachedPathAtlasLayout {
    std::size_t signature{0u};
    ResolvedPathAtlasLayout layout;
};

class WorldEnvironmentRenderer {
public:
    WorldEnvironmentRenderer(const dof::loaders::ConfigLoader& config,
                             const dof::core::WorldEnvironment& environment);

    void drawGround(sf::RenderTarget& target, int minimumZInclusive,
                    int maximumZExclusive) const;
    void drawStamp(sf::RenderTarget& target, std::size_t stampIndex) const;
    void drawStampPreview(sf::RenderTarget& target, int catalogIndex,
                          sf::Vector2f position) const;
    void drawAssetPreview(sf::RenderTarget& target, const std::string& assetPath,
                          float worldWidth, sf::Vector2f position) const;
    void refreshAssetTextures() const {
        assetTextures.clear();
        pathAtlasMetadata.clear();
        resolvedPathAtlasLayouts.clear();
    }

    std::size_t materialCount() const { return materials.size(); }
    std::size_t stampCatalogCount() const { return stampCatalog.size(); }
    const std::string& materialName(std::size_t index) const;
    const std::string& materialPathAtlasAssetPath(std::size_t index) const;
    const std::string& stampCatalogName(std::size_t index) const;
    float defaultStampCollisionRadius(std::size_t index) const;
    float stampCullRadius(std::size_t stampIndex) const;
    sf::FloatRect stampWorldBounds(std::size_t stampIndex) const;
    bool isPathAtlasCompatible(const std::string& assetPath) const;
    std::vector<sf::Vector2f> atlasPathGuidePoints(std::size_t pathIndex) const;
    const dof::core::WorldEnvironment& environment() const { return environmentRef; }

private:
    const sf::Texture& loadAssetTexture(const std::string& assetPath,
                                        bool removesChroma,
                                        bool isRepeated = false) const;
    const sf::Texture& loadPathAtlasTexture(const std::string& assetPath) const;
    const PathAtlasMetadata& loadPathAtlasMetadata(
        const std::string& assetPath) const;
    const ResolvedPathAtlasLayout& resolvePathAtlasLayout(
        std::size_t pathIndex) const;

    const dof::core::WorldEnvironment& environmentRef;
    std::vector<WorldMaterialCatalogEntry> materials;
    std::vector<WorldStampCatalogEntry> stampCatalog;
    // The shared silhouette glyph set. Named for enemies because that is where
    // it was first used, but it is a plain shape library with no enemy coupling
    // — reused here so props and actors are cut from the same alphabet.
    std::vector<EnemyShapeSpec> shapeCatalog;
    mutable std::unordered_map<std::string, std::unique_ptr<sf::Texture>> assetTextures;
    mutable std::unordered_map<std::string, PathAtlasMetadata> pathAtlasMetadata;
    mutable std::unordered_map<std::size_t, CachedPathAtlasLayout>
        resolvedPathAtlasLayouts;
    WorldNeonParams neon{};
    // Read from the shared THEME_HALO_* keys, not a world-local copy, so a prop's
    // glow stack is the same shape as the actors' by construction. That includes
    // the alpha base: a prop's glow is stacked filled discs exactly like an
    // actor's, so it needs the actor number, NOT the much higher zone-edge one,
    // which is tuned for thin ribbons that barely overlap themselves.
    int   neonPropHaloLayers{0};
    float neonPropHaloRadiusStep{0.0f};
    int   neonPropHaloAlphaBase{0};
    int alphaDilationPasses{0};
    int chromaGreenMinimum{80};
    int chromaDominanceMinimum{12};
    int zoneRepeatVariationTiles{3};
    float zoneRepeatBlendRatio{0.12f};
    float zoneRepeatDetailBlendRatio{0.22f};
    float pathAtlasRoadWidthRatio{0.38f};
    float pathAtlasPortCoverageRatio{0.9f};
    float pathAtlasPortAngleSearchDegrees{35.0f};
    float pathAtlasSeamDepthRatio{0.08f};
    int pathSearchBeamWidth{96};
    int pathSearchExtraModules{3};
    int pathSearchMaximumModules{256};
    int pathGuideSamplesPerModule{12};
    float pathStraightAngleToleranceDegrees{2.0f};
    float pathAtlasOverlapClearanceRatio{1.0f};
    int pathAtlasCellGuardPixels{2};
    int pathAtlasOpaqueAlphaMinimum{240};
};

} // namespace dof::render
