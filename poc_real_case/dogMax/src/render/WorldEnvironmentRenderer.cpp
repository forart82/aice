#include "render/WorldEnvironmentRenderer.hpp"

#include "core/WorldEnvironment.hpp"
#include "loaders/ConfigLoader.hpp"
#include "render/TexturePreparation.hpp"

#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/ConvexShape.hpp>
#include <SFML/Graphics/Image.hpp>
#include <SFML/Graphics/RenderStates.hpp>
#include <SFML/Graphics/RenderTarget.hpp>
#include <SFML/Graphics/Sprite.hpp>
#include <SFML/Graphics/VertexArray.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <deque>
#include <functional>
#include <numeric>
#include <numbers>
#include <iterator>
#include <limits>
#include <optional>
#include <sstream>
#include <stdexcept>

namespace dof::render {

namespace {

std::vector<std::string> split(const std::string& text, char delimiter) {
    std::vector<std::string> parts;
    std::stringstream stream(text);
    std::string part;
    while (std::getline(stream, part, delimiter)) parts.push_back(part);
    return parts;
}

int parseInt(const std::string& text, const char* context) {
    try { return std::stoi(text); }
    catch (...) { throw std::runtime_error(std::string{"Invalid "} + context + ": " + text); }
}

float parseFloat(const std::string& text, const char* context) {
    try {
        const float value = std::stof(text);
        if (!std::isfinite(value)) throw std::runtime_error("not finite");
        return value;
    } catch (...) {
        throw std::runtime_error(std::string{"Invalid "} + context + ": " + text);
    }
}

void removeGreenChromaKey(sf::Image& image, int greenMinimum, int dominanceMinimum) {
    const auto size = image.getSize();
    for (unsigned y = 0; y < size.y; ++y) {
        for (unsigned x = 0; x < size.x; ++x) {
            sf::Color pixel = image.getPixel({x, y});
            const int strongestOther = std::max(static_cast<int>(pixel.r),
                                                static_cast<int>(pixel.b));
            const int dominance = static_cast<int>(pixel.g) - strongestOther;
            if (static_cast<int>(pixel.g) >= greenMinimum && dominance >= dominanceMinimum) {
                pixel.a = 0u;
            } else if (dominance > 0) {
                pixel.g = static_cast<std::uint8_t>(strongestOther);
            }
            image.setPixel({x, y}, pixel);
        }
    }
}

bool isGreenChromaPixel(sf::Color pixel, int greenMinimum, int dominanceMinimum) {
    const int strongestOther = std::max(static_cast<int>(pixel.r),
                                        static_cast<int>(pixel.b));
    return static_cast<int>(pixel.g) >= greenMinimum
        && static_cast<int>(pixel.g) - strongestOther >= dominanceMinimum;
}

bool hasGreenChromaCorners(const sf::Image& image, int greenMinimum,
                           int dominanceMinimum) {
    const auto size = image.getSize();
    if (size.x == 0u || size.y == 0u) return false;
    const sf::Vector2u corners[4]{{0u, 0u}, {size.x - 1u, 0u},
                                 {0u, size.y - 1u}, {size.x - 1u, size.y - 1u}};
    return std::count_if(std::begin(corners), std::end(corners), [&](sf::Vector2u point) {
        return isGreenChromaPixel(image.getPixel(point), greenMinimum, dominanceMinimum);
    }) >= 3;
}

std::uint32_t repeatTileHash(int tileX, int tileY) {
    std::uint32_t value = static_cast<std::uint32_t>(tileX + 1) * 0x9e3779b9u;
    value ^= static_cast<std::uint32_t>(tileY + 1) * 0x85ebca6bu;
    value ^= value >> 16u;
    value *= 0x7feb352du;
    value ^= value >> 15u;
    return value;
}

sf::Color blendColor(sf::Color from, sf::Color to, float ratio) {
    const auto blend = [ratio](std::uint8_t left, std::uint8_t right) {
        return static_cast<std::uint8_t>(std::lround(
            static_cast<float>(left) * (1.0f - ratio)
            + static_cast<float>(right) * ratio));
    };
    return {
        blend(from.r, to.r),
        blend(from.g, to.g),
        blend(from.b, to.b),
        blend(from.a, to.a)};
}

float smoothStep(float ratio) {
    const float clamped = std::clamp(ratio, 0.0f, 1.0f);
    return clamped * clamped * (3.0f - 2.0f * clamped);
}

sf::Image makeVariedRepeatImage(
        const sf::Image& source, int tileCount, float blendRatio,
        float detailBlendRatio) {
    const auto sourceSize = source.getSize();
    if (tileCount <= 1 || sourceSize.x == 0u || sourceSize.y == 0u) {
        return source;
    }
    sf::Image output({sourceSize.x * static_cast<unsigned>(tileCount),
                      sourceSize.y * static_cast<unsigned>(tileCount)},
                     sf::Color::Transparent);
    const auto wrapTile = [tileCount](int index) {
        const int wrapped = index % tileCount;
        return wrapped < 0 ? wrapped + tileCount : wrapped;
    };
    const auto sampleTile = [&](int tileX, int tileY,
                                unsigned localX, unsigned localY) {
        const std::uint32_t hash = repeatTileHash(
            wrapTile(tileX), wrapTile(tileY));
        const unsigned offsetX = hash % sourceSize.x;
        const unsigned offsetY = (hash >> 12u) % sourceSize.y;
        const bool isFlippedX = (hash & 0x40000000u) != 0u;
        const bool isFlippedY = (hash & 0x80000000u) != 0u;
        const unsigned orientedX = isFlippedX
            ? sourceSize.x - 1u - localX : localX;
        const unsigned orientedY = isFlippedY
            ? sourceSize.y - 1u - localY : localY;
        const auto primary = source.getPixel({
            (orientedX + offsetX) % sourceSize.x,
            (orientedY + offsetY) % sourceSize.y});
        const std::uint32_t secondaryHash = hash ^ 0xa511e9b3u;
        const unsigned secondaryOffsetX = secondaryHash % sourceSize.x;
        const unsigned secondaryOffsetY =
            (secondaryHash >> 11u) % sourceSize.y;
        const auto secondary = source.getPixel({
            (localX + secondaryOffsetX) % sourceSize.x,
            (localY + secondaryOffsetY) % sourceSize.y});
        return blendColor(primary, secondary, detailBlendRatio);
    };
    const unsigned blendWidth = std::max(1u, static_cast<unsigned>(std::lround(
        static_cast<float>(std::min(sourceSize.x, sourceSize.y))
        * blendRatio)));
    const auto outputSize = output.getSize();
    for (unsigned y = 0; y < outputSize.y; ++y) {
        const int tileY = static_cast<int>(y / sourceSize.y);
        const unsigned withinY = y % sourceSize.y;
        for (unsigned x = 0; x < outputSize.x; ++x) {
            const int tileX = static_cast<int>(x / sourceSize.x);
            const unsigned withinX = x % sourceSize.x;

            int horizontalNeighbour = tileX;
            float horizontalRatio = 1.0f;
            if (withinX < blendWidth) {
                horizontalNeighbour = tileX - 1;
                horizontalRatio = smoothStep(
                    0.5f + 0.5f * static_cast<float>(withinX)
                        / static_cast<float>(blendWidth));
            } else if (withinX + blendWidth >= sourceSize.x) {
                horizontalNeighbour = tileX + 1;
                horizontalRatio = smoothStep(
                    0.5f + 0.5f * static_cast<float>(
                        sourceSize.x - 1u - withinX)
                        / static_cast<float>(blendWidth));
            }
            const auto sampleRow = [&](int row) {
                const auto current = sampleTile(
                    tileX, row, withinX, withinY);
                if (horizontalNeighbour == tileX) return current;
                const auto neighbour = sampleTile(
                    horizontalNeighbour, row, withinX, withinY);
                return blendColor(neighbour, current, horizontalRatio);
            };

            sf::Color resolved = sampleRow(tileY);
            if (withinY < blendWidth) {
                const float ratio = smoothStep(
                    0.5f + 0.5f * static_cast<float>(withinY)
                        / static_cast<float>(blendWidth));
                resolved = blendColor(sampleRow(tileY - 1), resolved, ratio);
            } else if (withinY + blendWidth >= sourceSize.y) {
                const float ratio = smoothStep(
                    0.5f + 0.5f * static_cast<float>(
                        sourceSize.y - 1u - withinY)
                        / static_cast<float>(blendWidth));
                resolved = blendColor(sampleRow(tileY + 1), resolved, ratio);
            }
            output.setPixel({x, y}, resolved);
        }
    }
    for (unsigned y = 0; y < outputSize.y; ++y) {
        output.setPixel(
            {outputSize.x - 1u, y}, output.getPixel({0u, y}));
    }
    for (unsigned x = 0; x < outputSize.x; ++x) {
        output.setPixel(
            {x, outputSize.y - 1u}, output.getPixel({x, 0u}));
    }
    return output;
}

void drawZone(sf::RenderTarget& target,
              const dof::core::WorldZoneDefinition& zone,
              const std::vector<WorldMaterialCatalogEntry>& materials,
              const sf::Texture* assetTexture,
              float assetWorldSizeMultiplier) {
    const auto indices = dof::core::triangulateWorldPolygon(zone.points);
    if (indices.empty()) return;
    const WorldMaterialCatalogEntry* material = nullptr;
    if (!assetTexture && zone.materialIndex >= 0
        && static_cast<std::size_t>(zone.materialIndex) < materials.size()) {
        material = &materials[static_cast<std::size_t>(zone.materialIndex)];
    }
    sf::VertexArray triangles(sf::PrimitiveType::Triangles);
    triangles.resize(indices.size());
    for (std::size_t index = 0; index < indices.size(); ++index) {
        const sf::Vector2f point = zone.points[indices[index]];
        triangles[index].position = point;
        triangles[index].color = zone.tint;
        const sf::Texture* texture = assetTexture
            ? assetTexture : (material ? &material->texture : nullptr);
        if (texture) {
            const auto textureSize = texture->getSize();
            const float worldSize = assetTexture
                ? zone.assetWorldSize * assetWorldSizeMultiplier
                : material->worldSize;
            triangles[index].texCoords = {
                point.x / worldSize * static_cast<float>(textureSize.x),
                point.y / worldSize * static_cast<float>(textureSize.y)};
        }
    }
    sf::RenderStates states;
    if (assetTexture) states.texture = assetTexture;
    else if (material) states.texture = &material->texture;
    target.draw(triangles, states);

    if (zone.feather <= 0.0f) return;
    float signedArea = 0.0f;
    for (std::size_t index = 0; index < zone.points.size(); ++index) {
        const auto& a = zone.points[index];
        const auto& b = zone.points[(index + 1u) % zone.points.size()];
        signedArea += a.x * b.y - b.x * a.y;
    }
    const float outwardSign = signedArea >= 0.0f ? -1.0f : 1.0f;
    sf::VertexArray edgeFade(sf::PrimitiveType::Triangles);
    for (std::size_t index = 0; index < zone.points.size(); ++index) {
        const sf::Vector2f a = zone.points[index];
        const sf::Vector2f b = zone.points[(index + 1u) % zone.points.size()];
        const sf::Vector2f delta = b - a;
        const float length = std::sqrt(delta.x * delta.x + delta.y * delta.y);
        if (length <= 0.0f) continue;
        const sf::Vector2f normal{-delta.y / length * outwardSign,
                                   delta.x / length * outwardSign};
        sf::Color transparent = zone.tint;
        transparent.a = 0u;
        const sf::Vertex vertices[6]{
            {a, zone.tint}, {b, zone.tint}, {b + normal * zone.feather, transparent},
            {a, zone.tint}, {b + normal * zone.feather, transparent},
            {a + normal * zone.feather, transparent}};
        for (const auto& vertex : vertices) {
            const auto output = edgeFade.getVertexCount();
            edgeFade.resize(output + 1u);
            edgeFade[output] = vertex;
        }
    }
    target.draw(edgeFade);
}

// Stroke a zone's boundary as a neon line: one bright core band wrapped in
// stacked translucent bands. Kept separate from drawZone because the two answer
// different questions — drawZone fills the zone's interior, this states where
// the zone ends. The alpha falloff mirrors the actor halos so the world reads as
// the same visual system, and every band is scaled by subordinateScale so a zone
// boundary stays behind the hero rather than competing with it.
// Stroke a polyline as a neon line: one bright core band wrapped in stacked
// translucent bands. Used for BOTH zone boundaries (closed) and paths (open) —
// they are the same drawing, so they are the same function. The alpha falloff
// mirrors the actor halos so the world reads as one visual system, and every
// band is scaled by subordinateScale so world lines stay behind the hero.
void drawNeonPolyline(sf::RenderTarget& target,
                      const std::vector<sf::Vector2f>& points,
                      float coreHalfWidth,
                      sf::Color lineColor,
                      const WorldNeonParams& neon,
                      bool isClosed) {
    const std::size_t minimumPoints = isClosed ? 3u : 2u;
    if (points.size() < minimumPoints || coreHalfWidth <= 0.0f) return;
    const std::size_t segmentCount = isClosed ? points.size() : points.size() - 1u;

    // Widest band first so the faint outer glow lies under the bright core
    // instead of washing over it.
    const auto drawBand = [&](float halfWidth, float alphaScalar) {
        sf::Color color = lineColor;
        color.a = static_cast<std::uint8_t>(std::clamp(
            255.0f * alphaScalar * neon.subordinateScale, 0.0f, 255.0f));
        sf::VertexArray band(sf::PrimitiveType::Triangles);
        for (std::size_t index = 0; index < segmentCount; ++index) {
            const sf::Vector2f a = points[index];
            const sf::Vector2f b = points[(index + 1u) % points.size()];
            const sf::Vector2f delta = b - a;
            const float length = std::sqrt(delta.x * delta.x + delta.y * delta.y);
            if (length <= 0.0f) continue;
            const sf::Vector2f normal{-delta.y / length * halfWidth,
                                       delta.x / length * halfWidth};
            const sf::Vertex quad[6]{
                {a - normal, color}, {b - normal, color}, {b + normal, color},
                {a - normal, color}, {b + normal, color}, {a + normal, color}};
            for (const auto& vertex : quad) {
                const auto next = band.getVertexCount();
                band.resize(next + 1u);
                band[next] = vertex;
            }
        }
        // Joint discs close the wedge a mitre would otherwise leave between two
        // segment quads; without them every vertex reads as a nick in the
        // stroke. On an open polyline they also round the two end caps.
        for (const auto& point : points) {
            sf::CircleShape joint(halfWidth, 12u);
            joint.setOrigin({halfWidth, halfWidth});
            joint.setPosition(point);
            joint.setFillColor(color);
            target.draw(joint);
        }
        target.draw(band);
    };

    for (int layer = neon.glowLayers; layer >= 1; --layer) {
        drawBand(coreHalfWidth + static_cast<float>(layer) * neon.glowStep,
                 static_cast<float>(neon.glowAlphaBase)
                     / static_cast<float>(layer + 1) / 255.0f);
    }
    drawBand(coreHalfWidth, 1.0f);
}

// A path is a CORRIDOR, drawn as its two glowing edges with dark ground between
// them — not as a filled neon stroke. A path is authored hundreds of world
// units wide (the shipped one is 480), so stroking it solid produced a giant
// light-tube that read as an object rather than as a route, and drowned
// everything near it. Two thin edges say "walk between these" and leave the
// interior readable, which is also exactly how a zone reads, so routes and
// regions share one visual grammar.
void drawNeonPath(sf::RenderTarget& target,
                  const std::vector<sf::Vector2f>& points,
                  float halfWidth,
                  sf::Color lineColor,
                  const WorldNeonParams& neon) {
    if (points.size() < 2u || halfWidth <= 0.0f) return;
    // Offset each vertex along the average of its adjacent segment normals, so
    // the two edges stay parallel to the route through a corner instead of
    // pinching in and crossing over.
    const auto offsetSide = [&](float sign) {
        std::vector<sf::Vector2f> side;
        side.reserve(points.size());
        for (std::size_t index = 0; index < points.size(); ++index) {
            sf::Vector2f accumulated{0.0f, 0.0f};
            int contributions = 0;
            const auto addNormal = [&](sf::Vector2f from, sf::Vector2f to) {
                const sf::Vector2f delta = to - from;
                const float length = std::sqrt(delta.x * delta.x + delta.y * delta.y);
                if (length <= 0.0f) return;
                accumulated += sf::Vector2f{-delta.y / length, delta.x / length};
                ++contributions;
            };
            if (index > 0u) addNormal(points[index - 1u], points[index]);
            if (index + 1u < points.size()) addNormal(points[index], points[index + 1u]);
            if (contributions == 0) { side.push_back(points[index]); continue; }
            const float length = std::sqrt(accumulated.x * accumulated.x
                                         + accumulated.y * accumulated.y);
            if (length <= 0.0f) { side.push_back(points[index]); continue; }
            const sf::Vector2f normal{accumulated.x / length, accumulated.y / length};
            side.push_back(points[index] + normal * (halfWidth * sign));
        }
        return side;
    };
    const float edgeHalfWidth = neon.zoneEdgeThickness * 0.5f;
    drawNeonPolyline(target, offsetSide(1.0f), edgeHalfWidth, lineColor, neon, false);
    drawNeonPolyline(target, offsetSide(-1.0f), edgeHalfWidth, lineColor, neon, false);
}

// Draw a prop as code-drawn neon: glow stack, dark body, inward neon rim, and
// an optional bright core. This is deliberately the same five-step recipe
// EnemyBodyPainter uses for an enemy body, reusing the same silhouette
// primitive, so a prop is visibly the same species of object as the actors.
// What separates them is hue and intensity, never construction: props are the
// world's cyan and every alpha is scaled by subordinateScale, so a prop can
// never out-shout a hero or an enemy.
void drawNeonProp(sf::RenderTarget& target,
                  const EnemyShapeSpec& spec,
                  sf::Vector2f position,
                  float radius,
                  float rotationDegrees,
                  const WorldNeonParams& neon,
                  int haloLayers,
                  int haloAlphaBase) {
    if (radius <= 0.0f) return;

    const auto scaledAlpha = [&](float alpha) {
        return static_cast<std::uint8_t>(
            std::clamp(alpha * neon.subordinateScale, 0.0f, 255.0f));
    };
    // The primitive returns origin-centred points, so rotation is a plain
    // rotation about the origin before translating to the prop's world position.
    const float radians = rotationDegrees * std::numbers::pi_v<float> / 180.0f;
    const float cosine = std::cos(radians);
    const float sine = std::sin(radians);
    const auto buildPlaced = [&](float atRadius) {
        const std::vector<sf::Vector2f> points =
            buildEnemyShapeOutline(spec, atRadius);
        sf::ConvexShape shape(points.size());
        for (std::size_t index = 0; index < points.size(); ++index) {
            const sf::Vector2f point = points[index];
            shape.setPoint(index,
                {position.x + point.x * cosine - point.y * sine,
                 position.y + point.x * sine + point.y * cosine});
        }
        return shape;
    };

    // Glow follows the SILHOUETTE, not a bounding circle. Enemies get away with
    // circular halos because their bodies are small and roughly round; a prop is
    // large and strongly shaped, and a circular halo around it reads as a flat
    // teal disc with a hole rather than as the object glowing.
    //
    // Spread is a FRACTION of the prop's own radius for the same reason the
    // actors' fixed pixel step cannot be reused: 5 px per layer is a wide, soft
    // gradient on a 40 px enemy and an invisible hairline on a 260 px prop.
    // Proportional spread keeps the falloff looking identical at every size.
    if (haloLayers > 0 && neon.propGlowSpreadRatio > 0.0f) {
        for (int layer = haloLayers; layer >= 1; --layer) {
            const float reach = neon.propGlowSpreadRatio
                * static_cast<float>(layer) / static_cast<float>(haloLayers);
            sf::ConvexShape glow = buildPlaced(radius * (1.0f + reach));
            sf::Color glowColor = neon.propRimColor;
            glowColor.a = scaledAlpha(static_cast<float>(haloAlphaBase)
                                      / static_cast<float>(layer + 1));
            glow.setFillColor(glowColor);
            target.draw(glow);
        }
    }

    sf::ConvexShape body = buildPlaced(radius);
    if (body.getPointCount() == 0u) return;
    sf::Color fill = neon.propFillColor;
    fill.a = 255u;
    body.setFillColor(fill);
    sf::Color rim = neon.propRimColor;
    rim.a = scaledAlpha(255.0f);
    body.setOutlineColor(rim);
    // Negative: the rim grows inward, so the silhouette stays exactly the
    // authored shape rather than swelling by the stroke width. Thickness is a
    // fraction of radius so a small prop and a large one read as the same
    // drawing style rather than the large one looking hairline-thin.
    body.setOutlineThickness(-radius * neon.propRimRatio);
    target.draw(body);

    if (spec.coreRadius > 0.0f) {
        const float coreRadius = radius * spec.coreRadius;
        sf::CircleShape core(coreRadius, 24u);
        core.setOrigin({coreRadius, coreRadius});
        core.setPosition(position);
        core.setFillColor(rim);
        target.draw(core);
    }
}

float vectorLength(sf::Vector2f value) {
    return std::sqrt(value.x * value.x + value.y * value.y);
}

sf::Vector2f normalized(sf::Vector2f value) {
    const float length = vectorLength(value);
    return length > 0.001f ? value / length : sf::Vector2f{};
}

float directionDegrees(sf::Vector2f direction) {
    return std::atan2(direction.y, direction.x) * 180.0f
        / std::numbers::pi_v<float>;
}

struct AtlasModuleTemplate {
    int cellIndex{-1};
    std::size_t expectedPortCount{0u};
    std::optional<float> singlePortAngleDegrees;
};

const std::vector<AtlasModuleTemplate>& atlasModuleTemplates() {
    static const std::vector<AtlasModuleTemplate> templates{
    {0, 2u, std::nullopt}, {1, 1u, 90.0f},
    {2, 2u, std::nullopt}, {3, 2u, std::nullopt},
    {4, 2u, std::nullopt}, {5, 2u, std::nullopt},
    {6, 2u, std::nullopt}, {7, 2u, std::nullopt},
    {8, 2u, std::nullopt}, {9, 2u, std::nullopt},
    {10, 2u, std::nullopt}, {11, 2u, std::nullopt}
    };
    return templates;
}

bool hasCompatibleAtlasModule(const PathAtlasMetadata& metadata) {
    return std::ranges::any_of(
        atlasModuleTemplates(), [&](const AtlasModuleTemplate& module) {
            if (module.cellIndex < 0
                || module.expectedPortCount != 2u) return false;
            const auto cellIndex = static_cast<std::size_t>(module.cellIndex);
            return metadata.availableCells[cellIndex]
                && metadata.cellPorts[cellIndex].size() == 2u
                && metadata.cellPortAnglesDegrees[cellIndex].size() == 2u;
        });
}

const std::vector<sf::Vector2f>& atlasCellPorts(
        int cellIndex, const PathAtlasMetadata& metadata) {
    static const std::vector<sf::Vector2f> noPorts;
    if (cellIndex < 0 || cellIndex >= 36) return noPorts;
    return metadata.cellPorts[static_cast<std::size_t>(cellIndex)];
}

sf::Vector2f rotateVector(sf::Vector2f vector, float rotationDegrees) {
    const float radians = rotationDegrees * std::numbers::pi_v<float> / 180.0f;
    return {vector.x * std::cos(radians) - vector.y * std::sin(radians),
            vector.x * std::sin(radians) + vector.y * std::cos(radians)};
}

struct IntendedPolyline {
    std::vector<sf::Vector2f> points;
    std::vector<float> cumulativeLengths;
    float totalLength{0.0f};
};

IntendedPolyline makeIntendedPolyline(const std::vector<sf::Vector2f>& source) {
    IntendedPolyline result;
    for (const auto point : source) {
        if (!result.points.empty()
            && vectorLength(point - result.points.back()) <= 0.001f) continue;
        result.points.push_back(point);
    }
    if (result.points.empty()) return result;
    result.cumulativeLengths.push_back(0.0f);
    for (std::size_t index = 1; index < result.points.size(); ++index) {
        result.totalLength += vectorLength(
            result.points[index] - result.points[index - 1u]);
        result.cumulativeLengths.push_back(result.totalLength);
    }
    return result;
}

std::size_t intendedSegmentIndex(const IntendedPolyline& line, float distance) {
    if (line.points.size() < 2u) return 0u;
    const auto upper = std::upper_bound(
        line.cumulativeLengths.begin(), line.cumulativeLengths.end(),
        std::clamp(distance, 0.0f, line.totalLength));
    const std::size_t endIndex = std::clamp<std::size_t>(
        static_cast<std::size_t>(std::distance(
            line.cumulativeLengths.begin(), upper)), 1u, line.points.size() - 1u);
    return endIndex - 1u;
}

sf::Vector2f pointAlongPolyline(const IntendedPolyline& line, float distance) {
    if (line.points.empty()) return {};
    if (line.points.size() == 1u || distance <= 0.0f) return line.points.front();
    if (distance >= line.totalLength) return line.points.back();
    const std::size_t startIndex = intendedSegmentIndex(line, distance);
    const std::size_t endIndex = startIndex + 1u;
    const float segmentLength = line.cumulativeLengths[endIndex]
                              - line.cumulativeLengths[startIndex];
    const float ratio = segmentLength > 0.001f
        ? (distance - line.cumulativeLengths[startIndex]) / segmentLength : 0.0f;
    return line.points[startIndex]
         + (line.points[endIndex] - line.points[startIndex]) * ratio;
}

sf::Vector2f directionAlongPolyline(const IntendedPolyline& line, float distance) {
    if (line.points.size() < 2u) return {1.0f, 0.0f};
    const std::size_t startIndex = intendedSegmentIndex(line, distance);
    return normalized(line.points[startIndex + 1u] - line.points[startIndex]);
}

bool isStraightIntention(
        const IntendedPolyline& line, float angleToleranceDegrees) {
    if (line.points.size() <= 2u) return true;
    const auto referenceDirection = normalized(
        line.points[1] - line.points.front());
    const float minimumDirectionDot = std::cos(angleToleranceDegrees
        * std::numbers::pi_v<float> / 180.0f);
    for (std::size_t index = 1u; index < line.points.size(); ++index) {
        const auto segmentDirection = normalized(
            line.points[index] - line.points[index - 1u]);
        const float directionDot = referenceDirection.x * segmentDirection.x
                                 + referenceDirection.y * segmentDirection.y;
        if (directionDot < minimumDirectionDot) return false;
    }
    return true;
}

ResolvedPathAtlasModule placeIntentAtlasModule(
        const AtlasModuleTemplate& module,
        std::size_t entryPortIndex,
        sf::Vector2f entry,
        sf::Vector2f incomingDirection,
        float cellSize,
        float moduleWorldSize,
        const PathAtlasMetadata& metadata) {
    ResolvedPathAtlasModule placement;
    const auto& ports = atlasCellPorts(module.cellIndex, metadata);
    const auto& portAngles = metadata.cellPortAnglesDegrees[
        static_cast<std::size_t>(module.cellIndex)];
    if (ports.size() != 2u || portAngles.size() != 2u) return placement;
    const sf::Vector2f cellCentre{cellSize * 0.5f, cellSize * 0.5f};
    const auto localEntry = ports[entryPortIndex] - cellCentre;
    const auto localExit = ports[1u - entryPortIndex] - cellCentre;
    const float entryAngle = portAngles[entryPortIndex];
    const float exitAngle = portAngles[1u - entryPortIndex];
    const float exitRadians = exitAngle
        * std::numbers::pi_v<float> / 180.0f;
    const sf::Vector2f localExitDirection{
        std::cos(exitRadians), std::sin(exitRadians)};
    placement.entry = entry;
    placement.rotationDegrees = directionDegrees(-incomingDirection)
                              - entryAngle;
    const float scale = moduleWorldSize / cellSize;
    placement.centre = entry - rotateVector(
        localEntry * scale, placement.rotationDegrees);
    placement.exit = placement.centre + rotateVector(
        localExit * scale, placement.rotationDegrees);
    placement.incomingDirection = incomingDirection;
    placement.outgoingDirection = normalized(
        rotateVector(localExitDirection, placement.rotationDegrees));
    placement.cellIndex = module.cellIndex;
    return placement;
}

struct ResolvedModuleCurve {
    sf::Vector2f start;
    sf::Vector2f firstControl;
    sf::Vector2f secondControl;
    sf::Vector2f end;
};

float vectorCross(sf::Vector2f left, sf::Vector2f right) {
    return left.x * right.y - left.y * right.x;
}

ResolvedModuleCurve makeResolvedModuleCurve(
        const ResolvedPathAtlasModule& module) {
    ResolvedModuleCurve curve;
    curve.start = module.entry;
    curve.end = module.exit;
    const auto chord = module.exit - module.entry;
    const float chordLength = vectorLength(chord);
    const sf::Vector2f reverseExitDirection = -module.outgoingDirection;
    const float denominator = vectorCross(
        module.incomingDirection, reverseExitDirection);
    if (std::abs(denominator) > 0.0001f) {
        const float entryDistance = vectorCross(
            chord, reverseExitDirection) / denominator;
        const float exitDistance = vectorCross(
            module.incomingDirection, chord) / denominator;
        if (entryDistance > 0.0f && exitDistance > 0.0f
            && entryDistance < chordLength * 0.9f
            && exitDistance < chordLength * 0.9f) {
            const auto tangentIntersection = module.entry
                + module.incomingDirection * entryDistance;
            curve.firstControl = module.entry
                + (tangentIntersection - module.entry) * (2.0f / 3.0f);
            curve.secondControl = module.exit
                + (tangentIntersection - module.exit) * (2.0f / 3.0f);
            return curve;
        }
    }
    const float handleLength = chordLength / 3.0f;
    curve.firstControl = module.entry
        + module.incomingDirection * handleLength;
    curve.secondControl = module.exit
        - module.outgoingDirection * handleLength;
    return curve;
}

sf::Vector2f pointOnResolvedModule(
        const ResolvedPathAtlasModule& module, float ratio) {
    const auto curve = makeResolvedModuleCurve(module);
    const float t = std::clamp(ratio, 0.0f, 1.0f);
    const float inverse = 1.0f - t;
    return curve.start * (inverse * inverse * inverse)
         + curve.firstControl * (3.0f * inverse * inverse * t)
         + curve.secondControl * (3.0f * inverse * t * t)
         + curve.end * (t * t * t);
}

struct IntentAtlasSearchState {
    std::size_t parentNodeIndex{std::numeric_limits<std::size_t>::max()};
    ResolvedPathAtlasModule placement;
    std::array<sf::Vector2f, 7> collisionGuide{};
    sf::Vector2f collisionMinimum;
    sf::Vector2f collisionMaximum;
    sf::Vector2f cursor;
    sf::Vector2f incomingDirection;
    float fitError{0.0f};
};

std::array<sf::Vector2f, 7> makeCollisionGuide(
        const ResolvedPathAtlasModule& module) {
    std::array<sf::Vector2f, 7> guide;
    for (std::size_t index = 0; index < guide.size(); ++index) {
        guide[index] = pointOnResolvedModule(module,
            static_cast<float>(index)
                / static_cast<float>(guide.size() - 1u));
    }
    return guide;
}

std::pair<sf::Vector2f, sf::Vector2f> collisionGuideBounds(
        const std::array<sf::Vector2f, 7>& guide) {
    sf::Vector2f minimum = guide.front();
    sf::Vector2f maximum = guide.front();
    for (const auto point : guide) {
        minimum.x = std::min(minimum.x, point.x);
        minimum.y = std::min(minimum.y, point.y);
        maximum.x = std::max(maximum.x, point.x);
        maximum.y = std::max(maximum.y, point.y);
    }
    return {minimum, maximum};
}

float squaredLength(sf::Vector2f value) {
    return value.x * value.x + value.y * value.y;
}

float squaredDistanceToSegment(
        sf::Vector2f point, sf::Vector2f start, sf::Vector2f end) {
    const auto segment = end - start;
    const float segmentLengthSquared = squaredLength(segment);
    if (segmentLengthSquared <= 0.0001f) return squaredLength(point - start);
    const float ratio = std::clamp(
        ((point.x - start.x) * segment.x
       + (point.y - start.y) * segment.y) / segmentLengthSquared,
        0.0f, 1.0f);
    return squaredLength(point - (start + segment * ratio));
}

float squaredDistanceBetweenSegments(
        sf::Vector2f firstStart, sf::Vector2f firstEnd,
        sf::Vector2f secondStart, sf::Vector2f secondEnd) {
    const auto first = firstEnd - firstStart;
    const auto second = secondEnd - secondStart;
    const auto betweenStarts = secondStart - firstStart;
    const float denominator = vectorCross(first, second);
    if (std::abs(denominator) > 0.0001f) {
        const float firstRatio = vectorCross(betweenStarts, second)
                               / denominator;
        const float secondRatio = vectorCross(betweenStarts, first)
                                / denominator;
        if (firstRatio >= 0.0f && firstRatio <= 1.0f
            && secondRatio >= 0.0f && secondRatio <= 1.0f) {
            return 0.0f;
        }
    }
    return std::min({
        squaredDistanceToSegment(firstStart, secondStart, secondEnd),
        squaredDistanceToSegment(firstEnd, secondStart, secondEnd),
        squaredDistanceToSegment(secondStart, firstStart, firstEnd),
        squaredDistanceToSegment(secondEnd, firstStart, firstEnd)});
}

bool doCollisionGuidesOverlap(
        const std::array<sf::Vector2f, 7>& first,
        const std::array<sf::Vector2f, 7>& second,
        float clearance) {
    const float clearanceSquared = clearance * clearance;
    for (std::size_t firstIndex = 1u; firstIndex < first.size();
         ++firstIndex) {
        for (std::size_t secondIndex = 1u; secondIndex < second.size();
             ++secondIndex) {
            if (squaredDistanceBetweenSegments(
                    first[firstIndex - 1u], first[firstIndex],
                    second[secondIndex - 1u], second[secondIndex])
                < clearanceSquared) {
                return true;
            }
        }
    }
    return false;
}

bool overlapsEarlierAtlasModule(
        const std::array<sf::Vector2f, 7>& candidateGuide,
        sf::Vector2f candidateMinimum, sf::Vector2f candidateMaximum,
        std::size_t previousNodeIndex,
        const std::vector<IntentAtlasSearchState>& searchNodes,
        float clearance) {
    constexpr std::size_t noNode = std::numeric_limits<std::size_t>::max();
    if (previousNodeIndex == noNode) return false;
    // The direct neighbor owns the other side of the same clipped port plane,
    // so only non-neighbor modules can illegally overlap this piece.
    std::size_t ancestorIndex = searchNodes[previousNodeIndex].parentNodeIndex;
    while (ancestorIndex != noNode
           && searchNodes[ancestorIndex].parentNodeIndex != noNode) {
        const auto& ancestor = searchNodes[ancestorIndex];
        const bool canBoundsOverlap =
            candidateMaximum.x + clearance > ancestor.collisionMinimum.x
            && ancestor.collisionMaximum.x + clearance > candidateMinimum.x
            && candidateMaximum.y + clearance > ancestor.collisionMinimum.y
            && ancestor.collisionMaximum.y + clearance > candidateMinimum.y;
        if (canBoundsOverlap && doCollisionGuidesOverlap(
                candidateGuide, searchNodes[ancestorIndex].collisionGuide,
                clearance)) {
            return true;
        }
        ancestorIndex = searchNodes[ancestorIndex].parentNodeIndex;
    }
    return false;
}

std::size_t pathLayoutSignature(
        const dof::core::WorldPathDefinition& path) {
    std::size_t signature = std::hash<std::string>{}(path.atlasAssetPath);
    const auto combine = [&](std::size_t value) {
        signature ^= value + 0x9e3779b9u + (signature << 6u) + (signature >> 2u);
    };
    combine(std::hash<float>{}(path.width));
    combine(path.points.size());
    for (const auto point : path.points) {
        combine(std::hash<float>{}(point.x));
        combine(std::hash<float>{}(point.y));
    }
    return signature;
}

ResolvedPathAtlasLayout resolveIntentAtlasPath(
        const dof::core::WorldPathDefinition& path,
        const PathAtlasMetadata& metadata,
        float roadWidthRatio, float cellSize,
        int beamWidth, int extraModuleCount, int maximumAllowedModuleCount,
        int guideSamplesPerModule, float straightAngleToleranceDegrees,
        float overlapClearanceRatio) {
    ResolvedPathAtlasLayout bestLayout;
    bestLayout.moduleWorldSize = path.width / std::max(0.05f, roadWidthRatio);
    const auto intention = makeIntendedPolyline(path.points);
    if (intention.points.size() < 2u || intention.totalLength <= 0.001f) {
        return bestLayout;
    }

    float intendedProgressPerModule = bestLayout.moduleWorldSize;
    const auto& straightPorts = atlasCellPorts(0, metadata);
    if (straightPorts.size() == 2u) {
        intendedProgressPerModule = vectorLength(
            straightPorts[1] - straightPorts[0])
            * bestLayout.moduleWorldSize / cellSize;
    }
    if (intendedProgressPerModule <= 0.001f) return bestLayout;
    const bool shouldUseOnlyStraightModules = metadata.availableCells[0]
        && straightPorts.size() == 2u
        && isStraightIntention(intention, straightAngleToleranceDegrees);
    const double intendedModuleCount = static_cast<double>(
        intention.totalLength) / static_cast<double>(intendedProgressPerModule);
    const int maximumModuleCount = static_cast<int>(std::clamp(
        std::ceil(intendedModuleCount) + static_cast<double>(extraModuleCount),
        1.0, static_cast<double>(maximumAllowedModuleCount)));
    const int minimumCompletionCount = static_cast<int>(std::clamp(
        std::floor(intendedModuleCount) - static_cast<double>(extraModuleCount),
        1.0, static_cast<double>(maximumModuleCount)));
    std::vector<IntentAtlasSearchState> searchNodes;
    searchNodes.reserve(1u + static_cast<std::size_t>(maximumModuleCount)
        * static_cast<std::size_t>(beamWidth)
        * atlasModuleTemplates().size() * 2u);
    IntentAtlasSearchState root;
    root.cursor = intention.points.front();
    root.incomingDirection = directionAlongPolyline(intention, 0.0f);
    searchNodes.push_back(root);
    std::vector<std::size_t> frontier{0u};
    float smallestEndpointError = std::numeric_limits<float>::max();
    float smallestAverageFitError = std::numeric_limits<float>::max();
    std::size_t bestNodeIndex = std::numeric_limits<std::size_t>::max();
    const float inverseModuleSizeSquared = 1.0f
        / (bestLayout.moduleWorldSize * bestLayout.moduleWorldSize);

    for (int moduleIndex = 0; moduleIndex < maximumModuleCount; ++moduleIndex) {
        const float middleTargetDistance = std::min(
            intention.totalLength,
            (static_cast<float>(moduleIndex) + 0.5f)
                * intendedProgressPerModule);
        const float exitTargetDistance = std::min(
            intention.totalLength,
            static_cast<float>(moduleIndex + 1) * intendedProgressPerModule);
        const auto intendedMiddle = pointAlongPolyline(
            intention, middleTargetDistance);
        const auto intendedExit = pointAlongPolyline(
            intention, exitTargetDistance);
        const auto intendedDirection = directionAlongPolyline(
            intention, exitTargetDistance);
        std::vector<std::size_t> candidates;
        candidates.reserve(frontier.size() * atlasModuleTemplates().size() * 2u);

        for (const std::size_t stateNodeIndex : frontier) {
            const auto state = searchNodes[stateNodeIndex];
            for (const auto& module : atlasModuleTemplates()) {
                if (shouldUseOnlyStraightModules && module.cellIndex != 0) {
                    continue;
                }
                if (module.expectedPortCount != 2u
                    || module.cellIndex < 0
                    || !metadata.availableCells[
                        static_cast<std::size_t>(module.cellIndex)]
                    || atlasCellPorts(module.cellIndex, metadata).size() != 2u) {
                    continue;
                }
                const std::size_t entryPortCount = module.cellIndex == 0 ? 1u : 2u;
                for (std::size_t entryPortIndex = 0;
                     entryPortIndex < entryPortCount;
                     ++entryPortIndex) {
                    const auto placement = placeIntentAtlasModule(
                        module, entryPortIndex, state.cursor,
                        state.incomingDirection, cellSize,
                        bestLayout.moduleWorldSize, metadata);
                    if (placement.cellIndex < 0) continue;
                    const auto collisionGuide = makeCollisionGuide(placement);
                    const auto [collisionMinimum, collisionMaximum] =
                        collisionGuideBounds(collisionGuide);
                    if (overlapsEarlierAtlasModule(
                            collisionGuide, collisionMinimum, collisionMaximum,
                            stateNodeIndex, searchNodes,
                            path.width * overlapClearanceRatio)) {
                        continue;
                    }
                    const auto placedMiddle = pointOnResolvedModule(
                        placement, 0.5f);
                    const float positionError = (
                        squaredLength(placedMiddle - intendedMiddle)
                      + squaredLength(placement.exit - intendedExit))
                        * inverseModuleSizeSquared;
                    const float directionDot = std::clamp(
                        placement.outgoingDirection.x * intendedDirection.x
                      + placement.outgoingDirection.y * intendedDirection.y,
                        -1.0f, 1.0f);
                    const float directionError = std::acos(directionDot);
                    IntentAtlasSearchState next;
                    next.parentNodeIndex = stateNodeIndex;
                    next.placement = placement;
                    next.collisionGuide = collisionGuide;
                    next.collisionMinimum = collisionMinimum;
                    next.collisionMaximum = collisionMaximum;
                    next.cursor = placement.exit;
                    next.incomingDirection = placement.outgoingDirection;
                    next.fitError = state.fitError + positionError
                        + directionError * directionError;
                    searchNodes.push_back(std::move(next));
                    candidates.push_back(searchNodes.size() - 1u);
                }
            }
        }
        if (candidates.empty()) break;
        std::stable_sort(candidates.begin(), candidates.end(),
            [&](std::size_t leftNodeIndex, std::size_t rightNodeIndex) {
                return searchNodes[leftNodeIndex].fitError
                     < searchNodes[rightNodeIndex].fitError;
            });
        if (candidates.size() > static_cast<std::size_t>(beamWidth)) {
            candidates.resize(static_cast<std::size_t>(beamWidth));
        }
        frontier = std::move(candidates);

        if (moduleIndex + 1 < minimumCompletionCount) continue;
        for (const std::size_t stateNodeIndex : frontier) {
            const auto& state = searchNodes[stateNodeIndex];
            const float endpointError = squaredLength(
                state.cursor - intention.points.back());
            const float averageFitError = state.fitError
                / static_cast<float>(moduleIndex + 1);
            if (endpointError < smallestEndpointError
                || (std::abs(endpointError - smallestEndpointError) <= 0.001f
                    && averageFitError < smallestAverageFitError)) {
                smallestEndpointError = endpointError;
                smallestAverageFitError = averageFitError;
                bestNodeIndex = stateNodeIndex;
            }
        }
    }
    if (bestNodeIndex == std::numeric_limits<std::size_t>::max()
        && !frontier.empty()) {
        bestNodeIndex = *std::ranges::min_element(
            frontier, {}, [&](std::size_t stateNodeIndex) {
                return squaredLength(
                    searchNodes[stateNodeIndex].cursor
                    - intention.points.back());
            });
    }
    while (bestNodeIndex != std::numeric_limits<std::size_t>::max()
           && searchNodes[bestNodeIndex].parentNodeIndex
                != std::numeric_limits<std::size_t>::max()) {
        bestLayout.modules.push_back(searchNodes[bestNodeIndex].placement);
        bestNodeIndex = searchNodes[bestNodeIndex].parentNodeIndex;
    }
    std::reverse(bestLayout.modules.begin(), bestLayout.modules.end());
    bestLayout.guidePoints.push_back(intention.points.front());
    for (const auto& module : bestLayout.modules) {
        for (int sample = 1; sample <= guideSamplesPerModule; ++sample) {
            bestLayout.guidePoints.push_back(pointOnResolvedModule(
                module, static_cast<float>(sample)
                    / static_cast<float>(guideSamplesPerModule)));
        }
    }
    return bestLayout;
}

}

WorldEnvironmentRenderer::WorldEnvironmentRenderer(
    const dof::loaders::ConfigLoader& config,
    const dof::core::WorldEnvironment& environment)
    : environmentRef(environment) {
    neon.isZoneEdgeEnabled = config.getInt("WORLD_NEON_ZONE_EDGE_ENABLE") != 0;
    neon.zoneEdgeColor = sf::Color(
        static_cast<std::uint8_t>(config.getInt("WORLD_NEON_ZONE_EDGE_R")),
        static_cast<std::uint8_t>(config.getInt("WORLD_NEON_ZONE_EDGE_G")),
        static_cast<std::uint8_t>(config.getInt("WORLD_NEON_ZONE_EDGE_B")));
    neon.zoneEdgeThickness = config.getFloat("WORLD_NEON_ZONE_EDGE_THICKNESS");
    neon.glowLayers = config.getInt("WORLD_NEON_ZONE_GLOW_LAYERS");
    neon.glowStep = config.getFloat("WORLD_NEON_ZONE_GLOW_STEP");
    neon.glowAlphaBase = config.getInt("WORLD_NEON_ZONE_GLOW_ALPHA_BASE");
    neon.subordinateScale = config.getFloat("WORLD_NEON_SUBORDINATE_SCALE");
    neon.propRimColor = sf::Color(
        static_cast<std::uint8_t>(config.getInt("WORLD_NEON_PROP_R")),
        static_cast<std::uint8_t>(config.getInt("WORLD_NEON_PROP_G")),
        static_cast<std::uint8_t>(config.getInt("WORLD_NEON_PROP_B")));
    neon.propFillColor = sf::Color(
        static_cast<std::uint8_t>(config.getInt("WORLD_NEON_PROP_FILL_R")),
        static_cast<std::uint8_t>(config.getInt("WORLD_NEON_PROP_FILL_G")),
        static_cast<std::uint8_t>(config.getInt("WORLD_NEON_PROP_FILL_B")));
    neon.propRimRatio = config.getFloat("WORLD_NEON_PROP_RIM_RATIO");
    neon.propGlowSpreadRatio = config.getFloat("WORLD_NEON_PROP_GLOW_SPREAD_RATIO");
    neonPropHaloLayers = config.getInt("THEME_HALO_GLOW_LAYERS");
    neonPropHaloRadiusStep = config.getFloat("THEME_HALO_GLOW_RADIUS_STEP");
    neonPropHaloAlphaBase = config.getInt("THEME_HALO_GLOW_ALPHA_BASE");
    shapeCatalog = loadEnemyShapeCatalog(config);
    alphaDilationPasses = config.getInt("WORLD_TEXTURE_ALPHA_DILATION_PASSES");
    chromaGreenMinimum = config.getInt("WORLD_EDITOR_CHROMA_GREEN_MIN");
    chromaDominanceMinimum = config.getInt("WORLD_EDITOR_CHROMA_DOMINANCE_MIN");
    zoneRepeatVariationTiles = config.getInt(
        "WORLD_EDITOR_ZONE_REPEAT_VARIATION_TILES");
    zoneRepeatBlendRatio = config.getFloat(
        "WORLD_EDITOR_ZONE_REPEAT_BLEND_RATIO");
    zoneRepeatDetailBlendRatio = config.getFloat(
        "WORLD_EDITOR_ZONE_REPEAT_DETAIL_BLEND_RATIO");
    pathAtlasRoadWidthRatio = config.getFloat("WORLD_EDITOR_PATH_ATLAS_ROAD_WIDTH_RATIO");
    pathAtlasPortCoverageRatio = config.getFloat(
        "WORLD_EDITOR_PATH_ATLAS_PORT_COVERAGE_RATIO");
    pathAtlasPortAngleSearchDegrees = config.getFloat(
        "WORLD_EDITOR_PATH_ATLAS_PORT_ANGLE_SEARCH_DEGREES");
    pathAtlasSeamDepthRatio = config.getFloat(
        "WORLD_EDITOR_PATH_ATLAS_SEAM_DEPTH_RATIO");
    pathSearchBeamWidth = config.getInt("WORLD_EDITOR_PATH_SEARCH_BEAM_WIDTH");
    pathSearchExtraModules = config.getInt(
        "WORLD_EDITOR_PATH_SEARCH_EXTRA_MODULES");
    pathSearchMaximumModules = config.getInt(
        "WORLD_EDITOR_PATH_SEARCH_MAX_MODULES");
    pathGuideSamplesPerModule = config.getInt(
        "WORLD_EDITOR_PATH_ATLAS_GUIDE_SAMPLES_PER_MODULE");
    pathStraightAngleToleranceDegrees = config.getFloat(
        "WORLD_EDITOR_PATH_STRAIGHT_ANGLE_TOLERANCE_DEGREES");
    pathAtlasOverlapClearanceRatio = config.getFloat(
        "WORLD_EDITOR_PATH_ATLAS_OVERLAP_CLEARANCE_RATIO");
    pathAtlasCellGuardPixels = config.getInt(
        "WORLD_EDITOR_PATH_ATLAS_CELL_GUARD_PIXELS");
    pathAtlasOpaqueAlphaMinimum = config.getInt(
        "WORLD_EDITOR_PATH_ATLAS_OPAQUE_ALPHA_MINIMUM");
    if (zoneRepeatVariationTiles < 1 || zoneRepeatVariationTiles > 4
        || zoneRepeatBlendRatio <= 0.0f || zoneRepeatBlendRatio >= 0.5f
        || zoneRepeatDetailBlendRatio < 0.0f
        || zoneRepeatDetailBlendRatio > 0.5f
        || pathAtlasRoadWidthRatio <= 0.0f
        || pathAtlasPortCoverageRatio <= 0.0f
        || pathAtlasPortCoverageRatio > 1.0f
        || pathAtlasPortAngleSearchDegrees <= 0.0f
        || pathAtlasPortAngleSearchDegrees >= 90.0f
        || pathAtlasSeamDepthRatio <= 0.0f
        || pathAtlasSeamDepthRatio >= 0.5f
        || pathSearchBeamWidth <= 0 || pathSearchBeamWidth > 256
        || pathSearchExtraModules < 1
        || pathSearchMaximumModules < pathSearchExtraModules
        || pathSearchMaximumModules > 256
        || pathGuideSamplesPerModule < 2 || pathGuideSamplesPerModule > 64
        || pathStraightAngleToleranceDegrees < 0.0f
        || pathStraightAngleToleranceDegrees >= 90.0f
        || pathAtlasOverlapClearanceRatio <= 0.0f
        || pathAtlasCellGuardPixels < 1 || pathAtlasCellGuardPixels > 16
        || pathAtlasOpaqueAlphaMinimum < 0
        || pathAtlasOpaqueAlphaMinimum >= 255) {
        throw std::runtime_error("World path atlas tuning is invalid");
    }
    for (const auto& record : split(config.getString("WORLD_ENVIRONMENT_MATERIAL_CATALOG"), '~')) {
        if (record.empty()) continue;
        const auto fields = split(record, '|');
        if (fields.size() != 3u && fields.size() != 4u) {
            throw std::runtime_error(
                "World material catalog entry requires "
                "name|ground-path|world-size[|path-atlas]");
        }
        WorldMaterialCatalogEntry entry;
        entry.name = fields[0];
        entry.worldSize = parseFloat(fields[2], "world material size");
        if (entry.worldSize <= 0.0f || !entry.texture.loadFromFile(fields[1])) {
            throw std::runtime_error("Failed to load world material: " + fields[1]);
        }
        if (fields.size() == 4u) {
            entry.pathAtlasAssetPath = fields[3];
            if (!isPathAtlasCompatible(entry.pathAtlasAssetPath)) {
                throw std::runtime_error(
                    "World material path atlas is incompatible: " + entry.name);
            }
        }
        prepareWorldTexture(entry.texture, true, fields[1]);
        materials.push_back(std::move(entry));
    }
    for (const auto& record : split(config.getString("WORLD_ENVIRONMENT_STAMP_CATALOG"), '~')) {
        if (record.empty()) continue;
        const auto fields = split(record, '|');
        if (fields.size() != 10u) {
            throw std::runtime_error(
                "World stamp catalog entry requires name|path|columns|rows|cell|world-width|origin-x|origin-y|chroma|collision-radius");
        }
        WorldStampCatalogEntry entry;
        entry.name = fields[0];
        entry.columns = parseInt(fields[2], "stamp columns");
        entry.rows = parseInt(fields[3], "stamp rows");
        entry.cellIndex = parseInt(fields[4], "stamp cell");
        entry.worldWidth = parseFloat(fields[5], "stamp world width");
        entry.originRatio = {parseFloat(fields[6], "stamp origin x"),
                             parseFloat(fields[7], "stamp origin y")};
        const bool usesChroma = parseInt(fields[8], "stamp chroma") != 0;
        entry.defaultCollisionRadius = std::max(
            0.0f, parseFloat(fields[9], "stamp collision radius"));
        // `shape:<index>` in the texture slot marks a code-drawn neon prop. The
        // entry then carries no image at all, so skip every texture step below;
        // worldWidth still sets its on-screen size, and the editor keeps placing
        // it like any other catalog entry.
        static constexpr std::string_view kShapePrefix = "shape:";
        if (fields[1].rfind(kShapePrefix, 0u) == 0u) {
            entry.neonShapeIndex = parseInt(
                fields[1].substr(kShapePrefix.size()), "neon prop shape index");
            if (entry.neonShapeIndex < 0 || entry.worldWidth <= 0.0f) {
                throw std::runtime_error(
                    "Neon prop catalog entry is invalid: " + entry.name);
            }
            stampCatalog.push_back(std::move(entry));
            continue;
        }
        sf::Image image;
        if (entry.columns <= 0 || entry.rows <= 0 || entry.worldWidth <= 0.0f
            || !image.loadFromFile(fields[1])) {
            throw std::runtime_error("Failed to load world stamp: " + fields[1]);
        }
        const auto size = image.getSize();
        if (size.x % static_cast<unsigned>(entry.columns) != 0u
            || size.y % static_cast<unsigned>(entry.rows) != 0u
            || entry.cellIndex < 0 || entry.cellIndex >= entry.columns * entry.rows) {
            throw std::runtime_error("World stamp catalog grid is invalid: " + entry.name);
        }
        if (usesChroma) {
            removeGreenChromaKey(image,
                chromaGreenMinimum, chromaDominanceMinimum);
        }
        dilateTransparentRgb(image, alphaDilationPasses);
        if (!entry.texture.loadFromImage(image)) {
            throw std::runtime_error("Failed to upload world stamp: " + fields[1]);
        }
        prepareWorldTexture(entry.texture, false, fields[1]);
        stampCatalog.push_back(std::move(entry));
    }
}

const ResolvedPathAtlasLayout&
WorldEnvironmentRenderer::resolvePathAtlasLayout(std::size_t pathIndex) const {
    static const ResolvedPathAtlasLayout emptyLayout;
    const auto& paths = environmentRef.state().paths;
    if (pathIndex >= paths.size()) return emptyLayout;
    const auto& path = paths[pathIndex];
    const std::size_t signature = pathLayoutSignature(path);
    if (const auto cached = resolvedPathAtlasLayouts.find(pathIndex);
        cached != resolvedPathAtlasLayouts.end()
        && cached->second.signature == signature) {
        return cached->second.layout;
    }

    ResolvedPathAtlasLayout layout;
    if (path.points.size() >= 2u) {
        if (path.atlasAssetPath.empty()) {
            throw std::runtime_error("World path requires an atlas: " + path.name);
        }
        const auto& atlas = loadPathAtlasTexture(path.atlasAssetPath);
        const auto size = atlas.getSize();
        if (size.x == 0u || size.x != size.y || size.x % 6u != 0u) {
            throw std::runtime_error(
                "World path atlas must be a square 6x6 image: "
                + path.atlasAssetPath);
        }
        const auto& metadata = loadPathAtlasMetadata(path.atlasAssetPath);
        if (!hasCompatibleAtlasModule(metadata)) {
            throw std::runtime_error(
                "World path atlas has no detectable two-port module: "
                + path.atlasAssetPath);
        }
        layout = resolveIntentAtlasPath(
            path, metadata,
            pathAtlasRoadWidthRatio, static_cast<float>(size.x / 6u),
            pathSearchBeamWidth, pathSearchExtraModules,
            pathSearchMaximumModules,
            pathGuideSamplesPerModule, pathStraightAngleToleranceDegrees,
            pathAtlasOverlapClearanceRatio);
    }
    const auto [cached, _] = resolvedPathAtlasLayouts.insert_or_assign(
        pathIndex, CachedPathAtlasLayout{signature, std::move(layout)});
    return cached->second.layout;
}

void WorldEnvironmentRenderer::drawGround(sf::RenderTarget& target,
                                          int minimumZInclusive,
                                          int maximumZExclusive) const {
    struct GroundItem { int zIndex; int kind; std::size_t index; };
    std::vector<GroundItem> items;
    const auto& state = environmentRef.state();
    for (std::size_t index = 0; index < state.zones.size(); ++index) {
        const int zIndex = state.zones[index].zIndex;
        if (zIndex >= minimumZInclusive && zIndex < maximumZExclusive) {
            items.push_back({zIndex, 0, index});
        }
    }
    for (std::size_t index = 0; index < state.paths.size(); ++index) {
        const int zIndex = state.paths[index].zIndex;
        if (zIndex >= minimumZInclusive && zIndex < maximumZExclusive) {
            items.push_back({zIndex, 1, index});
        }
    }
    for (std::size_t index = 0; index < state.stamps.size(); ++index) {
        const int zIndex = state.stamps[index].layer;
        if (zIndex < 0 && zIndex >= minimumZInclusive && zIndex < maximumZExclusive) {
            items.push_back({zIndex, 2, index});
        }
    }
    std::stable_sort(items.begin(), items.end(), [](const GroundItem& left,
                                                     const GroundItem& right) {
        return left.zIndex < right.zIndex;
    });
    for (const auto& item : items) {
        if (item.kind == 0) {
            const auto& zone = state.zones[item.index];
            const sf::Texture* texture = zone.assetPath.empty() ? nullptr
                : &loadAssetTexture(zone.assetPath, false, true);
            drawZone(target, zone, materials, texture,
                     static_cast<float>(zoneRepeatVariationTiles));
            if (neon.isZoneEdgeEnabled) {
                drawNeonPolyline(target, zone.points,
                                 neon.zoneEdgeThickness * 0.5f,
                                 neon.zoneEdgeColor, neon, /*isClosed*/ true);
            }
        } else if (item.kind == 1) {
            const auto& path = state.paths[item.index];
            // Code-drawn path. This used to demand a 6x6 atlas image and THROW
            // without one, which made a texture mandatory to draw a world at
            // all — the single hardest blocker to a texture-free game. A path
            // already carries everything a neon stroke needs: a polyline, a
            // width and a tint. It is the same drawing as a zone boundary, only
            // open instead of closed, so it goes through the same function
            // rather than getting a second stroking routine.
            drawNeonPath(target, path.points, path.width * 0.5f,
                         path.tint, neon);
        } else {
            drawStamp(target, item.index);
        }
    }
}

bool WorldEnvironmentRenderer::isPathAtlasCompatible(
        const std::string& assetPath) const {
    if (assetPath.empty()) return false;
    sf::Image image;
    if (!image.loadFromFile(assetPath)) return false;
    const auto size = image.getSize();
    if (size.x == 0u || size.x != size.y || size.x % 6u != 0u) return false;
    return hasCompatibleAtlasModule(loadPathAtlasMetadata(assetPath));
}

std::vector<sf::Vector2f> WorldEnvironmentRenderer::atlasPathGuidePoints(
        std::size_t pathIndex) const {
    const auto& paths = environmentRef.state().paths;
    if (pathIndex >= paths.size()) return {};
    if (paths[pathIndex].points.size() < 2u) return {};
    return resolvePathAtlasLayout(pathIndex).guidePoints;
}

void WorldEnvironmentRenderer::drawStamp(sf::RenderTarget& target,
                                         std::size_t stampIndex) const {
    if (stampIndex >= environmentRef.state().stamps.size()) return;
    const auto& stamp = environmentRef.state().stamps[stampIndex];
    if (!stamp.assetPath.empty()) {
        const auto& texture = loadAssetTexture(stamp.assetPath, true);
        const auto size = texture.getSize();
        sf::Sprite sprite(texture);
        sprite.setOrigin({static_cast<float>(size.x) * stamp.originRatio.x,
                          static_cast<float>(size.y) * stamp.originRatio.y});
        sprite.setPosition(stamp.position);
        sprite.setRotation(sf::degrees(stamp.rotationDegrees));
        const float baseScale = stamp.assetWorldWidth
                              / std::max(1.0f, static_cast<float>(size.x));
        sprite.setScale({baseScale * stamp.scale.x * (stamp.isFlippedX ? -1.0f : 1.0f),
                         baseScale * stamp.scale.y});
        sf::Color color = stamp.tint;
        color.a = static_cast<std::uint8_t>(std::clamp(stamp.alpha, 0, 255));
        sprite.setColor(color);
        target.draw(sprite);
        return;
    }
    if (stampCatalog.empty()) return;
    const auto& entry = stampCatalog[static_cast<std::size_t>(
        std::clamp(stamp.catalogIndex, 0, static_cast<int>(stampCatalog.size()) - 1))];
    if (entry.neonShapeIndex >= 0) {
        if (shapeCatalog.empty()) return;
        const auto& spec = shapeCatalog[static_cast<std::size_t>(std::clamp(
            entry.neonShapeIndex, 0, static_cast<int>(shapeCatalog.size()) - 1))];
        // worldWidth is a diameter, and the stamp's own scale still applies so a
        // single catalog glyph can be placed at many sizes.
        const float radius = entry.worldWidth * 0.5f
                           * std::max(stamp.scale.x, stamp.scale.y);
        drawNeonProp(target, spec, stamp.position, radius, stamp.rotationDegrees,
                     neon, neonPropHaloLayers, neonPropHaloAlphaBase);
        return;
    }
    const auto textureSize = entry.texture.getSize();
    const int cellWidth = static_cast<int>(textureSize.x) / entry.columns;
    const int cellHeight = static_cast<int>(textureSize.y) / entry.rows;
    const int column = entry.cellIndex % entry.columns;
    const int row = entry.cellIndex / entry.columns;
    sf::Sprite sprite(entry.texture,
        {{column * cellWidth, row * cellHeight}, {cellWidth, cellHeight}});
    sprite.setOrigin({static_cast<float>(cellWidth) * entry.originRatio.x,
                      static_cast<float>(cellHeight) * entry.originRatio.y});
    sprite.setPosition(stamp.position);
    sprite.setRotation(sf::degrees(stamp.rotationDegrees));
    const float baseScale = entry.worldWidth / static_cast<float>(cellWidth);
    sprite.setScale({baseScale * stamp.scale.x * (stamp.isFlippedX ? -1.0f : 1.0f),
                     baseScale * stamp.scale.y});
    sf::Color color = stamp.tint;
    color.a = static_cast<std::uint8_t>(std::clamp(stamp.alpha, 0, 255));
    sprite.setColor(color);
    target.draw(sprite);
}

void WorldEnvironmentRenderer::drawStampPreview(sf::RenderTarget& target,
                                                 int catalogIndex,
                                                 sf::Vector2f position) const {
    if (stampCatalog.empty()) return;
    const auto& entry = stampCatalog[static_cast<std::size_t>(
        std::clamp(catalogIndex, 0, static_cast<int>(stampCatalog.size()) - 1))];
    if (entry.neonShapeIndex >= 0) {
        // Neon entries carry no texture, so the sprite path below would divide
        // by a zero-sized cell. Without this branch the editor's placement
        // preview showed nothing for a neon prop and the author was placing
        // blind — the same zero-texture trap that made props invisible in
        // stampWorldBounds.
        if (shapeCatalog.empty()) return;
        const auto& spec = shapeCatalog[static_cast<std::size_t>(std::clamp(
            entry.neonShapeIndex, 0, static_cast<int>(shapeCatalog.size()) - 1))];
        drawNeonProp(target, spec, position, entry.worldWidth * 0.5f, 0.0f,
                     neon, neonPropHaloLayers, neonPropHaloAlphaBase);
        return;
    }
    const auto textureSize = entry.texture.getSize();
    const int cellWidth = static_cast<int>(textureSize.x) / entry.columns;
    const int cellHeight = static_cast<int>(textureSize.y) / entry.rows;
    const int column = entry.cellIndex % entry.columns;
    const int row = entry.cellIndex / entry.columns;
    sf::Sprite sprite(entry.texture,
        {{column * cellWidth, row * cellHeight}, {cellWidth, cellHeight}});
    sprite.setOrigin({static_cast<float>(cellWidth) * entry.originRatio.x,
                      static_cast<float>(cellHeight) * entry.originRatio.y});
    sprite.setPosition(position);
    const float scale = entry.worldWidth / static_cast<float>(cellWidth);
    sprite.setScale({scale, scale});
    sprite.setColor(sf::Color{255, 255, 255, 150});
    target.draw(sprite);
}

void WorldEnvironmentRenderer::drawAssetPreview(sf::RenderTarget& target,
                                                 const std::string& assetPath,
                                                 float worldWidth,
                                                 sf::Vector2f position) const {
    const auto& texture = loadAssetTexture(assetPath, true);
    const auto size = texture.getSize();
    sf::Sprite sprite(texture);
    sprite.setOrigin({static_cast<float>(size.x) * 0.5f,
                      static_cast<float>(size.y)});
    sprite.setPosition(position);
    const float scale = worldWidth / std::max(1.0f, static_cast<float>(size.x));
    sprite.setScale({scale, scale});
    sprite.setColor(sf::Color{255, 255, 255, 170});
    target.draw(sprite);
}

const sf::Texture& WorldEnvironmentRenderer::loadAssetTexture(
    const std::string& assetPath, bool removesChroma, bool isRepeated) const {
    const std::string cacheKey = (removesChroma ? "chroma:" : "raw:")
                               + std::string{isRepeated ? "repeat:" : "clamp:"}
                               + assetPath;
    if (const auto found = assetTextures.find(cacheKey); found != assetTextures.end()) {
        return *found->second;
    }
    sf::Image image;
    if (!image.loadFromFile(assetPath)) {
        throw std::runtime_error("Failed to load gallery stamp: " + assetPath);
    }
    if (removesChroma
        && hasGreenChromaCorners(image, chromaGreenMinimum, chromaDominanceMinimum)) {
        removeGreenChromaKey(image, chromaGreenMinimum, chromaDominanceMinimum);
    }
    if (isRepeated && zoneRepeatVariationTiles > 1) {
        image = makeVariedRepeatImage(
            image, zoneRepeatVariationTiles, zoneRepeatBlendRatio,
            zoneRepeatDetailBlendRatio);
    }
    dilateTransparentRgb(image, alphaDilationPasses);
    auto texture = std::make_unique<sf::Texture>();
    if (!texture->loadFromImage(image)) {
        throw std::runtime_error("Failed to upload gallery stamp: " + assetPath);
    }
    prepareWorldTexture(*texture, isRepeated, assetPath);
    const auto [inserted, _] = assetTextures.emplace(cacheKey, std::move(texture));
    return *inserted->second;
}

namespace {

struct AtlasEndpointEstimate {
    sf::Vector2f coreCentre;
    sf::Vector2f outwardDirection;
};

struct AtlasPortDetection {
    sf::Vector2f position;
    float angleDegrees{0.0f};
    int recession{0};
    int runLength{0};
};

std::vector<std::uint8_t> makeAtlasCellMask(
        const sf::Image& image, unsigned left, unsigned top,
        unsigned cellSize, int alphaThreshold) {
    std::vector<std::uint8_t> mask(
        static_cast<std::size_t>(cellSize * cellSize), 0u);
    for (unsigned y = 0; y < cellSize; ++y) {
        for (unsigned x = 0; x < cellSize; ++x) {
            mask[static_cast<std::size_t>(y * cellSize + x)] =
                image.getPixel({left + x, top + y}).a
                    > static_cast<std::uint8_t>(alphaThreshold)
                ? 1u : 0u;
        }
    }
    return mask;
}

std::vector<AtlasEndpointEstimate> estimateAtlasCellEndpoints(
        const std::vector<std::uint8_t>& sourceMask,
        unsigned cellSize, float portWidth) {
    const int size = static_cast<int>(cellSize);
    const int erosionPasses = std::max(
        2, static_cast<int>(std::lround(portWidth * 0.22f)));
    auto coreMask = sourceMask;
    std::vector<std::uint8_t> nextMask(coreMask.size(), 0u);
    for (int pass = 0; pass < erosionPasses; ++pass) {
        std::fill(nextMask.begin(), nextMask.end(), 0u);
        for (int y = 1; y + 1 < size; ++y) {
            for (int x = 1; x + 1 < size; ++x) {
                const int index = y * size + x;
                if (coreMask[static_cast<std::size_t>(index)] == 0u) continue;
                bool isInterior = true;
                for (int offsetY = -1; offsetY <= 1 && isInterior; ++offsetY) {
                    for (int offsetX = -1; offsetX <= 1; ++offsetX) {
                        if (coreMask[static_cast<std::size_t>(
                                index + offsetY * size + offsetX)] == 0u) {
                            isInterior = false;
                            break;
                        }
                    }
                }
                if (isInterior) {
                    nextMask[static_cast<std::size_t>(index)] = 1u;
                }
            }
        }
        coreMask.swap(nextMask);
    }

    std::vector<std::uint8_t> visited(coreMask.size(), 0u);
    std::vector<int> largestComponent;
    std::deque<int> queue;
    for (int start = 0; start < size * size; ++start) {
        if (coreMask[static_cast<std::size_t>(start)] == 0u
            || visited[static_cast<std::size_t>(start)] != 0u) continue;
        std::vector<int> component;
        visited[static_cast<std::size_t>(start)] = 1u;
        queue.push_back(start);
        while (!queue.empty()) {
            const int index = queue.front();
            queue.pop_front();
            component.push_back(index);
            const int x = index % size;
            const int y = index / size;
            for (int offsetY = -1; offsetY <= 1; ++offsetY) {
                for (int offsetX = -1; offsetX <= 1; ++offsetX) {
                    if (offsetX == 0 && offsetY == 0) continue;
                    const int nextX = x + offsetX;
                    const int nextY = y + offsetY;
                    if (nextX < 0 || nextY < 0
                        || nextX >= size || nextY >= size) continue;
                    const int next = nextY * size + nextX;
                    if (coreMask[static_cast<std::size_t>(next)] == 0u
                        || visited[static_cast<std::size_t>(next)] != 0u) {
                        continue;
                    }
                    visited[static_cast<std::size_t>(next)] = 1u;
                    queue.push_back(next);
                }
            }
        }
        if (component.size() > largestComponent.size()) {
            largestComponent = std::move(component);
        }
    }
    if (largestComponent.size() < 2u) return {};

    std::vector<std::uint8_t> isCore(coreMask.size(), 0u);
    for (const int index : largestComponent) {
        isCore[static_cast<std::size_t>(index)] = 1u;
    }
    const auto findDistances = [&](int start) {
        std::vector<int> distances(coreMask.size(), -1);
        distances[static_cast<std::size_t>(start)] = 0;
        queue.push_back(start);
        int farthest = start;
        while (!queue.empty()) {
            const int index = queue.front();
            queue.pop_front();
            if (distances[static_cast<std::size_t>(index)]
                > distances[static_cast<std::size_t>(farthest)]) {
                farthest = index;
            }
            const int x = index % size;
            const int y = index / size;
            for (int offsetY = -1; offsetY <= 1; ++offsetY) {
                for (int offsetX = -1; offsetX <= 1; ++offsetX) {
                    if (offsetX == 0 && offsetY == 0) continue;
                    const int nextX = x + offsetX;
                    const int nextY = y + offsetY;
                    if (nextX < 0 || nextY < 0
                        || nextX >= size || nextY >= size) continue;
                    const int next = nextY * size + nextX;
                    if (isCore[static_cast<std::size_t>(next)] == 0u
                        || distances[static_cast<std::size_t>(next)] >= 0) {
                        continue;
                    }
                    distances[static_cast<std::size_t>(next)] =
                        distances[static_cast<std::size_t>(index)] + 1;
                    queue.push_back(next);
                }
            }
        }
        return std::pair{farthest, std::move(distances)};
    };

    const int firstEnd = findDistances(largestComponent.front()).first;
    auto [secondEnd, distancesFromFirst] = findDistances(firstEnd);
    auto [unusedEnd, distancesFromSecond] = findDistances(secondEnd);
    static_cast<void>(unusedEnd);
    const int pathDistance = distancesFromFirst[
        static_cast<std::size_t>(secondEnd)];
    if (pathDistance <= erosionPasses * 2) return {};

    const auto averageWhere = [&](const auto& predicate)
            -> std::optional<sf::Vector2f> {
        sf::Vector2f total;
        int count = 0;
        for (const int index : largestComponent) {
            const int firstDistance = distancesFromFirst[
                static_cast<std::size_t>(index)];
            const int secondDistance = distancesFromSecond[
                static_cast<std::size_t>(index)];
            const int twiceProgress = firstDistance - secondDistance
                                    + pathDistance;
            if (!predicate(twiceProgress)) continue;
            total += sf::Vector2f{
                static_cast<float>(index % size) + 0.5f,
                static_cast<float>(index / size) + 0.5f};
            ++count;
        }
        if (count == 0) return std::nullopt;
        return total / static_cast<float>(count);
    };
    const int centreBand = erosionPasses;
    const int innerMinimum = erosionPasses * 2;
    const int innerMaximum = erosionPasses * 3;
    const int twicePathDistance = pathDistance * 2;
    const auto firstCentre = averageWhere(
        [&](int progress) { return progress >= 0 && progress <= centreBand; });
    const auto firstInner = averageWhere(
        [&](int progress) {
            return progress >= innerMinimum && progress <= innerMaximum;
        });
    const auto secondCentre = averageWhere(
        [&](int progress) {
            return progress >= twicePathDistance - centreBand
                && progress <= twicePathDistance;
        });
    const auto secondInner = averageWhere(
        [&](int progress) {
            return progress >= twicePathDistance - innerMaximum
                && progress <= twicePathDistance - innerMinimum;
        });
    if (!firstCentre || !firstInner || !secondCentre || !secondInner) {
        return {};
    }
    const sf::Vector2f componentCentre = std::accumulate(
        largestComponent.begin(), largestComponent.end(), sf::Vector2f{},
        [size](sf::Vector2f total, int index) {
            return total + sf::Vector2f{
                static_cast<float>(index % size) + 0.5f,
                static_cast<float>(index / size) + 0.5f};
        }) / static_cast<float>(largestComponent.size());
    const auto makeEstimate = [&](sf::Vector2f centre, sf::Vector2f inner) {
        auto outward = normalized(centre - inner);
        if (vectorLength(outward) <= 0.001f) {
            outward = normalized(centre - componentCentre);
        }
        return AtlasEndpointEstimate{centre, outward};
    };
    const auto firstEstimate = makeEstimate(*firstCentre, *firstInner);
    const auto secondEstimate = makeEstimate(*secondCentre, *secondInner);
    if (vectorLength(firstEstimate.outwardDirection) <= 0.001f
        || vectorLength(secondEstimate.outwardDirection) <= 0.001f) {
        return {};
    }
    return {firstEstimate, secondEstimate};
}

AtlasPortDetection detectAtlasPortAtAngle(
        const std::vector<sf::Vector2f>& occupiedPoints,
        unsigned cellSize, float portWidth, float portCoverageRatio,
        float angleDegrees, std::vector<std::uint8_t>& occupiedBins) {
    AtlasPortDetection detection;
    detection.angleDegrees = angleDegrees;
    const float radians = angleDegrees
        * std::numbers::pi_v<float> / 180.0f;
    const sf::Vector2f direction{std::cos(radians), std::sin(radians)};
    const sf::Vector2f lateralBasis{direction.y, -direction.x};
    const sf::Vector2f cellCentre{
        static_cast<float>(cellSize) * 0.5f,
        static_cast<float>(cellSize) * 0.5f};
    const int coordinateRadius = static_cast<int>(std::ceil(
        static_cast<float>(cellSize) * 0.75f)) + 2;
    const int binCount = coordinateRadius * 2 + 1;
    occupiedBins.assign(static_cast<std::size_t>(binCount * binCount), 0u);
    int maximumProjectionBin = 0;
    for (const auto point : occupiedPoints) {
        const auto fromCentre = point - cellCentre;
        const int projectionBin = std::clamp(
            static_cast<int>(std::lround(
                fromCentre.x * direction.x + fromCentre.y * direction.y))
                + coordinateRadius,
            0, binCount - 1);
        const int lateralBin = std::clamp(
            static_cast<int>(std::lround(
                fromCentre.x * lateralBasis.x
              + fromCentre.y * lateralBasis.y)) + coordinateRadius,
            0, binCount - 1);
        occupiedBins[static_cast<std::size_t>(
            projectionBin * binCount + lateralBin)] = 1u;
        maximumProjectionBin = std::max(maximumProjectionBin, projectionBin);
    }
    const int minimumRunLength = std::max(1, static_cast<int>(std::floor(
        portWidth * portCoverageRatio)));
    const int maximumRunLength = std::max(minimumRunLength,
        static_cast<int>(std::ceil(portWidth / portCoverageRatio)));
    for (int projectionBin = maximumProjectionBin;
         projectionBin >= 0; --projectionBin) {
        int bestStart = 0;
        int bestLength = 0;
        int runStart = 0;
        int runLength = 0;
        for (int lateralBin = 0; lateralBin <= binCount; ++lateralBin) {
            const bool isOccupied = lateralBin < binCount
                && occupiedBins[static_cast<std::size_t>(
                    projectionBin * binCount + lateralBin)] != 0u;
            if (isOccupied) {
                if (runLength == 0) runStart = lateralBin;
                ++runLength;
            } else {
                if (runLength > bestLength) {
                    bestStart = runStart;
                    bestLength = runLength;
                }
                runLength = 0;
            }
        }
        if (bestLength < minimumRunLength
            || bestLength > maximumRunLength) continue;
        const float projection = static_cast<float>(
            projectionBin - coordinateRadius);
        const float lateral = static_cast<float>(
            bestStart - coordinateRadius)
            + static_cast<float>(bestLength - 1) * 0.5f;
        detection.position = cellCentre + direction * projection
                           + lateralBasis * lateral;
        detection.recession = maximumProjectionBin - projectionBin;
        detection.runLength = bestLength;
        return detection;
    }
    detection.runLength = 0;
    return detection;
}

std::optional<AtlasPortDetection> measureAtlasPort(
        const AtlasEndpointEstimate& endpoint,
        const std::vector<sf::Vector2f>& occupiedPoints,
        unsigned cellSize, float portWidth, float portCoverageRatio,
        float maximumAngleDeviationDegrees) {
    std::optional<AtlasPortDetection> best;
    float bestScore = std::numeric_limits<float>::max();
    std::vector<std::uint8_t> occupiedBins;
    const auto consider = [&](float angleDegrees) {
        const auto detection = detectAtlasPortAtAngle(
            occupiedPoints, cellSize, portWidth, portCoverageRatio,
            angleDegrees, occupiedBins);
        if (detection.runLength == 0) return;
        const float radians = angleDegrees
            * std::numbers::pi_v<float> / 180.0f;
        const sf::Vector2f direction{std::cos(radians), std::sin(radians)};
        const auto delta = detection.position - endpoint.coreCentre;
        const float outwardDistance = delta.x * direction.x
                                    + delta.y * direction.y;
        if (outwardDistance <= 0.0f
            || outwardDistance > portWidth * 1.25f) return;
        const float lateralError = std::abs(vectorCross(delta, direction));
        const float directionDot = endpoint.outwardDirection.x * direction.x
                                 + endpoint.outwardDirection.y * direction.y;
        const float score = lateralError
            + static_cast<float>(detection.recession) * 0.35f
            + std::abs(static_cast<float>(detection.runLength) - portWidth)
                * 0.05f
            + (1.0f - directionDot) * portWidth * 0.15f;
        if (score < bestScore) {
            bestScore = score;
            best = detection;
        }
    };
    const float approximateAngle = directionDegrees(endpoint.outwardDirection);
    for (float offset = -maximumAngleDeviationDegrees;
         offset <= maximumAngleDeviationDegrees; offset += 0.5f) {
        consider(approximateAngle + offset);
    }
    return best;
}

}

const PathAtlasMetadata& WorldEnvironmentRenderer::loadPathAtlasMetadata(
        const std::string& assetPath) const {
    static const PathAtlasMetadata noMetadata;
    if (const auto found = pathAtlasMetadata.find(assetPath);
        found != pathAtlasMetadata.end()) return found->second;
    sf::Image image;
    if (!image.loadFromFile(assetPath)) return noMetadata;
    const auto imageSize = image.getSize();
    if (imageSize.x == 0u || imageSize.x != imageSize.y
        || imageSize.x % 6u != 0u) return noMetadata;
    const unsigned cellSize = imageSize.x / 6u;
    PathAtlasMetadata metadata;
    metadata.canonicalPortWidth = static_cast<float>(cellSize)
                                * pathAtlasRoadWidthRatio;
    for (std::size_t cellIndex = 0; cellIndex < metadata.availableCells.size();
         ++cellIndex) {
        const unsigned left = static_cast<unsigned>(cellIndex % 6u) * cellSize;
        const unsigned top = static_cast<unsigned>(cellIndex / 6u) * cellSize;
        for (unsigned y = top;
            y < top + cellSize && !metadata.availableCells[cellIndex]; ++y) {
            for (unsigned x = left; x < left + cellSize; ++x) {
                if (image.getPixel({x, y}).a
                    > static_cast<std::uint8_t>(pathAtlasOpaqueAlphaMinimum)) {
                    metadata.availableCells[cellIndex] = true;
                    break;
                }
            }
        }
    }

    for (const auto& module : atlasModuleTemplates()) {
        if (module.cellIndex < 0
            || !metadata.availableCells[
                static_cast<std::size_t>(module.cellIndex)]) continue;
        const unsigned left = static_cast<unsigned>(module.cellIndex % 6) * cellSize;
        const unsigned top = static_cast<unsigned>(module.cellIndex / 6) * cellSize;
        auto& ports = metadata.cellPorts[
            static_cast<std::size_t>(module.cellIndex)];
        auto& portAngles = metadata.cellPortAnglesDegrees[
            static_cast<std::size_t>(module.cellIndex)];
        const auto mask = makeAtlasCellMask(
            image, left, top, cellSize, pathAtlasOpaqueAlphaMinimum);
        bool hasCellGuardViolation = false;
        for (unsigned y = 0u; y < cellSize && !hasCellGuardViolation; ++y) {
            for (unsigned x = 0u; x < cellSize; ++x) {
                const bool isInsideGuard =
                    x < static_cast<unsigned>(pathAtlasCellGuardPixels)
                    || y < static_cast<unsigned>(pathAtlasCellGuardPixels)
                    || x + static_cast<unsigned>(pathAtlasCellGuardPixels)
                        >= cellSize
                    || y + static_cast<unsigned>(pathAtlasCellGuardPixels)
                        >= cellSize;
                if (isInsideGuard
                    && mask[static_cast<std::size_t>(y * cellSize + x)] != 0u) {
                    hasCellGuardViolation = true;
                    break;
                }
            }
        }
        if (hasCellGuardViolation) {
            metadata.availableCells[
                static_cast<std::size_t>(module.cellIndex)] = false;
            continue;
        }
        std::vector<sf::Vector2f> occupiedPoints;
        occupiedPoints.reserve(mask.size());
        for (unsigned y = 0; y < cellSize; ++y) {
            for (unsigned x = 0; x < cellSize; ++x) {
                if (mask[static_cast<std::size_t>(y * cellSize + x)] != 0u) {
                    occupiedPoints.push_back({static_cast<float>(x) + 0.5f,
                                              static_cast<float>(y) + 0.5f});
                }
            }
        }
        if (module.expectedPortCount == 2u) {
            const auto endpoints = estimateAtlasCellEndpoints(
                mask, cellSize, metadata.canonicalPortWidth);
            for (const auto& endpoint : endpoints) {
                const auto port = measureAtlasPort(
                    endpoint, occupiedPoints, cellSize,
                    metadata.canonicalPortWidth,
                    pathAtlasPortCoverageRatio,
                    pathAtlasPortAngleSearchDegrees);
                if (!port.has_value()) break;
                ports.push_back(port->position);
                portAngles.push_back(port->angleDegrees);
            }
        } else if (module.expectedPortCount == 1u
                   && module.singlePortAngleDegrees.has_value()) {
            std::vector<std::uint8_t> occupiedBins;
            const auto port = detectAtlasPortAtAngle(
                occupiedPoints, cellSize, metadata.canonicalPortWidth,
                pathAtlasPortCoverageRatio,
                *module.singlePortAngleDegrees, occupiedBins);
            if (port.runLength != 0) {
                ports.push_back(port.position);
                portAngles.push_back(port.angleDegrees);
            }
        }
        if (module.cellIndex == 0 && ports.size() == 2u
            && portAngles.size() == 2u) {
            const auto straightDirection = normalized(ports[1] - ports[0]);
            portAngles[0] = directionDegrees(-straightDirection);
            portAngles[1] = directionDegrees(straightDirection);
        }
        bool hasExpectedPorts = ports.size()
            == module.expectedPortCount
            && portAngles.size() == module.expectedPortCount
            && (ports.size() < 2u || vectorLength(ports[1] - ports[0])
                > metadata.canonicalPortWidth * 0.5f);
        if (hasExpectedPorts && ports.size() == 2u) {
            const auto chordDirection = normalized(ports[1] - ports[0]);
            const float firstRadians = portAngles[0]
                * std::numbers::pi_v<float> / 180.0f;
            const float secondRadians = portAngles[1]
                * std::numbers::pi_v<float> / 180.0f;
            const sf::Vector2f firstOutward{
                std::cos(firstRadians), std::sin(firstRadians)};
            const sf::Vector2f secondOutward{
                std::cos(secondRadians), std::sin(secondRadians)};
            const float firstForward = -firstOutward.x * chordDirection.x
                                     - firstOutward.y * chordDirection.y;
            const float secondForward = secondOutward.x * chordDirection.x
                                      + secondOutward.y * chordDirection.y;
            hasExpectedPorts = firstForward > 0.05f
                && secondForward > 0.05f;
        }
        if (!hasExpectedPorts) {
            ports.clear();
            portAngles.clear();
            metadata.availableCells[
                static_cast<std::size_t>(module.cellIndex)] = false;
        }
    }
    const auto [inserted, _] = pathAtlasMetadata.emplace(assetPath, std::move(metadata));
    return inserted->second;
}

const sf::Texture& WorldEnvironmentRenderer::loadPathAtlasTexture(
        const std::string& assetPath) const {
    static const sf::Texture emptyTexture;
    const std::string key = "clean-atlas:" + assetPath;
    if (const auto found = assetTextures.find(key); found != assetTextures.end()) {
        return *found->second;
    }
    sf::Image image;
    if (!image.loadFromFile(assetPath)) return emptyTexture;
    const auto imageSize = image.getSize();
    if (imageSize.x == 0u || imageSize.x != imageSize.y
        || imageSize.x % 6u != 0u) return emptyTexture;
    const auto& metadata = loadPathAtlasMetadata(assetPath);
    const unsigned cellSize = imageSize.x / 6u;
    const sf::Vector2f cellCentre{
        static_cast<float>(cellSize) * 0.5f,
        static_cast<float>(cellSize) * 0.5f};
    const float portHalfWidth = metadata.canonicalPortWidth * 0.5f;
    const float seamDepth = static_cast<float>(cellSize)
                          * pathAtlasSeamDepthRatio;
    const int profileRadius = static_cast<int>(std::ceil(portHalfWidth)) + 2;
    std::vector<std::uint8_t> canonicalPortAlpha(
        static_cast<std::size_t>(profileRadius * 2 + 1), 0u);
    std::vector<sf::Color> canonicalPortColor(
        canonicalPortAlpha.size(), sf::Color::Transparent);
    const auto& straightPorts = metadata.cellPorts[0];
    if (straightPorts.size() == 2u) {
        std::array<std::vector<std::uint8_t>, 2> sampledAlpha{
            std::vector<std::uint8_t>(canonicalPortAlpha.size(), 0u),
            std::vector<std::uint8_t>(canonicalPortAlpha.size(), 0u)};
        std::array<std::vector<sf::Color>, 2> sampledColor{
            std::vector<sf::Color>(
                canonicalPortColor.size(), sf::Color::Transparent),
            std::vector<sf::Color>(
                canonicalPortColor.size(), sf::Color::Transparent)};
        const auto& straightAngles = metadata.cellPortAnglesDegrees[0];
        for (std::size_t portIndex = 0; portIndex < straightPorts.size();
             ++portIndex) {
            const float radians = straightAngles[portIndex]
                * std::numbers::pi_v<float> / 180.0f;
            const sf::Vector2f direction{std::cos(radians), std::sin(radians)};
            const sf::Vector2f lateralBasis{direction.y, -direction.x};
            for (int lateral = -profileRadius; lateral <= profileRadius;
                 ++lateral) {
                const sf::Vector2f samplePosition = straightPorts[portIndex]
                    - direction * (seamDepth * 1.5f)
                    + lateralBasis * static_cast<float>(lateral);
                const int sampleX = static_cast<int>(std::floor(samplePosition.x));
                const int sampleY = static_cast<int>(std::floor(samplePosition.y));
                if (sampleX < 0 || sampleY < 0
                    || sampleX >= static_cast<int>(cellSize)
                    || sampleY >= static_cast<int>(cellSize)) continue;
                const auto profileIndex = static_cast<std::size_t>(
                    lateral + profileRadius);
                const auto sample = image.getPixel({
                    static_cast<unsigned>(sampleX),
                    static_cast<unsigned>(sampleY)});
                sampledAlpha[portIndex][profileIndex] = sample.a;
                sampledColor[portIndex][profileIndex] = sample;
            }
        }
        for (int distance = 0; distance <= profileRadius; ++distance) {
            const auto leftIndex = static_cast<std::size_t>(
                profileRadius - distance);
            const auto rightIndex = static_cast<std::size_t>(
                profileRadius + distance);
            const unsigned alphaSum = sampledAlpha[0][leftIndex]
                + sampledAlpha[0][rightIndex]
                + sampledAlpha[1][leftIndex]
                + sampledAlpha[1][rightIndex];
            const std::uint8_t alpha = static_cast<std::uint8_t>(
                alphaSum / 4u);
            canonicalPortAlpha[leftIndex] = alpha;
            canonicalPortAlpha[rightIndex] = alpha;
            const std::array<sf::Color, 4> samples{
                sampledColor[0][leftIndex], sampledColor[0][rightIndex],
                sampledColor[1][leftIndex], sampledColor[1][rightIndex]};
            unsigned red = 0u;
            unsigned green = 0u;
            unsigned blue = 0u;
            unsigned sampleCount = 0u;
            for (const auto sample : samples) {
                if (sample.a == 0u) continue;
                red += sample.r;
                green += sample.g;
                blue += sample.b;
                ++sampleCount;
            }
            if (sampleCount > 0u) {
                const sf::Color color{
                    static_cast<std::uint8_t>(red / sampleCount),
                    static_cast<std::uint8_t>(green / sampleCount),
                    static_cast<std::uint8_t>(blue / sampleCount),
                    alpha};
                canonicalPortColor[leftIndex] = color;
                canonicalPortColor[rightIndex] = color;
            }
        }
    }
    if (std::ranges::none_of(canonicalPortAlpha,
            [](std::uint8_t alpha) { return alpha != 0u; })) {
        const float edgeBlendWidth = std::max(
            1.0f, metadata.canonicalPortWidth * 0.04f);
        for (int lateral = -profileRadius; lateral <= profileRadius;
             ++lateral) {
            const float alphaRatio = std::clamp(
                (portHalfWidth - std::abs(static_cast<float>(lateral)))
                    / edgeBlendWidth,
                0.0f, 1.0f);
            canonicalPortAlpha[static_cast<std::size_t>(
                lateral + profileRadius)] = static_cast<std::uint8_t>(
                    std::lround(255.0f * alphaRatio));
        }
    }
    for (const auto& module : atlasModuleTemplates()) {
        if (module.cellIndex < 0) continue;
        const auto& ports = metadata.cellPorts[
            static_cast<std::size_t>(module.cellIndex)];
        const auto& portAngles = metadata.cellPortAnglesDegrees[
            static_cast<std::size_t>(module.cellIndex)];
        if (ports.size() != module.expectedPortCount
            || portAngles.size() != ports.size()) continue;
        const unsigned left = static_cast<unsigned>(module.cellIndex % 6) * cellSize;
        const unsigned top = static_cast<unsigned>(module.cellIndex / 6) * cellSize;
        for (std::size_t portIndex = 0; portIndex < ports.size(); ++portIndex) {
            const float radians = portAngles[portIndex]
                * std::numbers::pi_v<float> / 180.0f;
            const sf::Vector2f direction{std::cos(radians), std::sin(radians)};
            const sf::Vector2f lateralBasis{direction.y, -direction.x};
            const auto portFromCentre = ports[portIndex] - cellCentre;
            const float portProjection = portFromCentre.x * direction.x
                                       + portFromCentre.y * direction.y;
            const float portLateral = portFromCentre.x * lateralBasis.x
                                    + portFromCentre.y * lateralBasis.y;
            for (unsigned y = 0; y < cellSize; ++y) {
                for (unsigned x = 0; x < cellSize; ++x) {
                    const sf::Vector2f fromCentre{
                        static_cast<float>(x) + 0.5f - cellCentre.x,
                        static_cast<float>(y) + 0.5f - cellCentre.y};
                    const float projection = fromCentre.x * direction.x
                                           + fromCentre.y * direction.y;
                    if (projection <= portProjection + 0.25f) continue;
                    auto pixel = image.getPixel({left + x, top + y});
                    pixel.a = 0u;
                    image.setPixel({left + x, top + y}, pixel);
                }
            }
            for (unsigned y = 0; y < cellSize; ++y) {
                for (unsigned x = 0; x < cellSize; ++x) {
                    const sf::Vector2f fromCentre{
                        static_cast<float>(x) + 0.5f - cellCentre.x,
                        static_cast<float>(y) + 0.5f - cellCentre.y};
                    const float projection = fromCentre.x * direction.x
                                           + fromCentre.y * direction.y;
                    if (projection < portProjection - seamDepth
                        || projection > portProjection + 0.5f) continue;
                    const float lateral = fromCentre.x * lateralBasis.x
                                        + fromCentre.y * lateralBasis.y;
                    const float lateralFromPort = lateral - portLateral;
                    auto output = image.getPixel({left + x, top + y});
                    if (std::abs(lateralFromPort)
                        > static_cast<float>(profileRadius)) {
                        output.a = 0u;
                        image.setPixel({left + x, top + y}, output);
                        continue;
                    }
                    const int profileIndex =
                        static_cast<int>(std::lround(lateralFromPort))
                            + profileRadius;
                    const std::uint8_t profileAlpha = canonicalPortAlpha[
                        static_cast<std::size_t>(profileIndex)];
                    if (profileAlpha == 0u) {
                        output.a = 0u;
                        image.setPixel({left + x, top + y}, output);
                        continue;
                    }

                    const float sampleHalfWidth = std::max(
                        1.0f, portHalfWidth * pathAtlasPortCoverageRatio - 2.0f);
                    const float sampleLateral = portLateral + std::clamp(
                        lateralFromPort, -sampleHalfWidth, sampleHalfWidth);
                    sf::Color sample = output;
                    bool hasSample = sample.a > static_cast<std::uint8_t>(
                        pathAtlasOpaqueAlphaMinimum);
                    const int maximumSampleDepth = std::max(
                        1, static_cast<int>(std::ceil(seamDepth * 3.0f)));
                    for (int step = 1; step <= maximumSampleDepth && !hasSample;
                         ++step) {
                        const sf::Vector2f samplePosition = cellCentre
                            + direction * (portProjection - seamDepth
                                - static_cast<float>(step))
                            + lateralBasis * sampleLateral;
                        const int sampleX = static_cast<int>(std::floor(samplePosition.x));
                        const int sampleY = static_cast<int>(std::floor(samplePosition.y));
                        if (sampleX < 0 || sampleY < 0
                            || sampleX >= static_cast<int>(cellSize)
                            || sampleY >= static_cast<int>(cellSize)) continue;
                        sample = image.getPixel({
                            left + static_cast<unsigned>(sampleX),
                            top + static_cast<unsigned>(sampleY)});
                        hasSample = sample.a > static_cast<std::uint8_t>(
                            pathAtlasOpaqueAlphaMinimum);
                    }
                    if (!hasSample) {
                        output.a = 0u;
                        image.setPixel({left + x, top + y}, output);
                        continue;
                    }
                    const float seamBlendRatio = smoothStep(
                        (projection - (portProjection - seamDepth))
                        / std::max(0.5f, seamDepth));
                    const auto canonicalColor = canonicalPortColor[
                        static_cast<std::size_t>(profileIndex)];
                    if (canonicalColor.a != 0u) {
                        sample = blendColor(
                            sample, canonicalColor, seamBlendRatio);
                    }
                    sample.a = profileAlpha;
                    image.setPixel({left + x, top + y}, sample);
                }
            }
        }
    }
    dilateTransparentRgb(image, alphaDilationPasses);
    auto texture = std::make_unique<sf::Texture>();
    if (!texture->loadFromImage(image)) return emptyTexture;
    prepareWorldTexture(*texture, false, assetPath);
    const auto [inserted, _] = assetTextures.emplace(key, std::move(texture));
    return *inserted->second;
}

const std::string& WorldEnvironmentRenderer::materialName(std::size_t index) const {
    static const std::string none{"Color only"};
    return index < materials.size() ? materials[index].name : none;
}

const std::string& WorldEnvironmentRenderer::materialPathAtlasAssetPath(
        std::size_t index) const {
    static const std::string none;
    return index < materials.size() ? materials[index].pathAtlasAssetPath : none;
}

const std::string& WorldEnvironmentRenderer::stampCatalogName(std::size_t index) const {
    static const std::string none{"No stamps"};
    return index < stampCatalog.size() ? stampCatalog[index].name : none;
}

float WorldEnvironmentRenderer::defaultStampCollisionRadius(std::size_t index) const {
    return index < stampCatalog.size() ? stampCatalog[index].defaultCollisionRadius : 0.0f;
}

float WorldEnvironmentRenderer::stampCullRadius(std::size_t stampIndex) const {
    if (stampIndex >= environmentRef.state().stamps.size()) return 0.0f;
    const auto& stamp = environmentRef.state().stamps[stampIndex];
    const auto bounds = stampWorldBounds(stampIndex);
    const float maximumX = std::max(std::abs(bounds.position.x - stamp.position.x),
        std::abs(bounds.position.x + bounds.size.x - stamp.position.x));
    const float maximumY = std::max(std::abs(bounds.position.y - stamp.position.y),
        std::abs(bounds.position.y + bounds.size.y - stamp.position.y));
    return std::sqrt(maximumX * maximumX + maximumY * maximumY);
}

sf::FloatRect WorldEnvironmentRenderer::stampWorldBounds(std::size_t stampIndex) const {
    if (stampIndex >= environmentRef.state().stamps.size()) return {};
    const auto& stamp = environmentRef.state().stamps[stampIndex];
    if (!stamp.assetPath.empty()) {
        const auto& texture = loadAssetTexture(stamp.assetPath, true);
        const auto size = texture.getSize();
        sf::Sprite sprite(texture);
        sprite.setOrigin({static_cast<float>(size.x) * stamp.originRatio.x,
                          static_cast<float>(size.y) * stamp.originRatio.y});
        sprite.setPosition(stamp.position);
        sprite.setRotation(sf::degrees(stamp.rotationDegrees));
        const float baseScale = stamp.assetWorldWidth
                              / std::max(1.0f, static_cast<float>(size.x));
        sprite.setScale({baseScale * stamp.scale.x * (stamp.isFlippedX ? -1.0f : 1.0f),
                         baseScale * stamp.scale.y});
        return sprite.getGlobalBounds();
    }
    if (stampCatalog.empty()) return {stamp.position, {0.0f, 0.0f}};
    const auto& entry = stampCatalog[static_cast<std::size_t>(
        std::clamp(stamp.catalogIndex, 0, static_cast<int>(stampCatalog.size()) - 1))];
    if (entry.neonShapeIndex >= 0) {
        // A neon prop carries no texture, so the sprite-based path below would
        // divide by a zero-sized cell and produce infinite bounds — which the
        // view-rect cull then rejects, making every prop silently invisible.
        // Bounds are the silhouette's bounding box grown by the glow stack, so
        // a prop is not culled while its glow is still on screen.
        const float radius = entry.worldWidth * 0.5f
                           * std::max(stamp.scale.x, stamp.scale.y);
        const float reach = radius
            + static_cast<float>(neonPropHaloLayers) * neonPropHaloRadiusStep;
        return {{stamp.position.x - reach, stamp.position.y - reach},
                {reach * 2.0f, reach * 2.0f}};
    }
    const auto textureSize = entry.texture.getSize();
    const int cellWidth = static_cast<int>(textureSize.x) / entry.columns;
    const int cellHeight = static_cast<int>(textureSize.y) / entry.rows;
    const int column = entry.cellIndex % entry.columns;
    const int row = entry.cellIndex / entry.columns;
    sf::Sprite sprite(entry.texture,
        {{column * cellWidth, row * cellHeight}, {cellWidth, cellHeight}});
    sprite.setOrigin({static_cast<float>(cellWidth) * entry.originRatio.x,
                      static_cast<float>(cellHeight) * entry.originRatio.y});
    sprite.setPosition(stamp.position);
    sprite.setRotation(sf::degrees(stamp.rotationDegrees));
    const float baseScale = entry.worldWidth / static_cast<float>(cellWidth);
    sprite.setScale({baseScale * stamp.scale.x * (stamp.isFlippedX ? -1.0f : 1.0f),
                     baseScale * stamp.scale.y});
    return sprite.getGlobalBounds();
}

} // namespace dof::render
