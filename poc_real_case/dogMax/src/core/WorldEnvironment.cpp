#include "core/WorldEnvironment.hpp"

#include "loaders/ConfigLoader.hpp"

#include <algorithm>
#include <cmath>
#include <iomanip>
#include <numeric>
#include <sstream>
#include <stdexcept>
#include <string_view>

namespace dof::core {

namespace {

std::vector<std::string> split(const std::string& text, char delimiter) {
    std::vector<std::string> parts;
    std::stringstream stream(text);
    std::string part;
    while (std::getline(stream, part, delimiter)) parts.push_back(part);
    return parts;
}

float parseFloat(const std::string& text, const char* context) {
    try {
        std::size_t consumed = 0;
        const float value = std::stof(text, &consumed);
        if (consumed != text.size() || !std::isfinite(value)) {
            throw std::runtime_error("not finite");
        }
        return value;
    } catch (const std::exception&) {
        throw std::runtime_error(std::string{"Invalid world environment "}
                                 + context + ": " + text);
    }
}

int parseInt(const std::string& text, const char* context) {
    try {
        std::size_t consumed = 0;
        const int value = std::stoi(text, &consumed);
        if (consumed != text.size()) throw std::runtime_error("trailing characters");
        return value;
    } catch (const std::exception&) {
        throw std::runtime_error(std::string{"Invalid world environment "}
                                 + context + ": " + text);
    }
}

sf::Vector2f parseVector(const std::string& text, const char* context) {
    const auto values = split(text, ',');
    if (values.size() != 2u) {
        throw std::runtime_error(std::string{"World environment "} + context
                                 + " requires x,y");
    }
    return {parseFloat(values[0], context), parseFloat(values[1], context)};
}

std::vector<sf::Vector2f> parsePoints(const std::string& text,
                                      std::size_t minimumCount,
                                      const char* context) {
    std::vector<sf::Vector2f> points;
    for (const auto& token : split(text, ';')) {
        if (!token.empty()) points.push_back(parseVector(token, context));
    }
    if (points.size() < minimumCount) {
        throw std::runtime_error(std::string{"World environment "} + context
                                 + " has too few points");
    }
    return points;
}

sf::Color parseColor(const std::string& text, const char* context) {
    const auto values = split(text, ',');
    if (values.size() != 4u) {
        throw std::runtime_error(std::string{"World environment "} + context
                                 + " requires r,g,b,a");
    }
    const auto byte = [&](std::size_t index) {
        return static_cast<std::uint8_t>(std::clamp(
            parseInt(values[index], context), 0, 255));
    };
    return {byte(0), byte(1), byte(2), byte(3)};
}

std::string formatFloat(float value) {
    std::ostringstream out;
    out << std::setprecision(7) << value;
    return out.str();
}

std::string serializeVector(sf::Vector2f value) {
    return formatFloat(value.x) + "," + formatFloat(value.y);
}

std::string serializePoints(const std::vector<sf::Vector2f>& points) {
    std::ostringstream out;
    for (std::size_t index = 0; index < points.size(); ++index) {
        if (index != 0u) out << ';';
        out << serializeVector(points[index]);
    }
    return out.str();
}

std::string serializeColor(sf::Color color) {
    return std::to_string(color.r) + "," + std::to_string(color.g) + ","
         + std::to_string(color.b) + "," + std::to_string(color.a);
}

std::string safeName(std::string name, const char* fallback) {
    if (name.empty()) return fallback;
    std::replace_if(name.begin(), name.end(), [](char value) {
        return value == '|' || value == '~' || value == ':';
    }, '_');
    return name;
}

std::string encodeField(std::string_view value) {
    std::string encoded;
    encoded.reserve(value.size());
    for (const char character : value) {
        if (character == '%') encoded += "%25";
        else if (character == '|') encoded += "%7C";
        else if (character == '~') encoded += "%7E";
        else encoded += character;
    }
    return encoded;
}

std::string decodeField(std::string_view value) {
    std::string decoded;
    decoded.reserve(value.size());
    for (std::size_t index = 0; index < value.size(); ++index) {
        if (value[index] == '%' && index + 2u < value.size()) {
            const auto code = value.substr(index, 3u);
            if (code == "%25") { decoded += '%'; index += 2u; continue; }
            if (code == "%7C") { decoded += '|'; index += 2u; continue; }
            if (code == "%7E") { decoded += '~'; index += 2u; continue; }
        }
        decoded += value[index];
    }
    return decoded;
}

float cross(sf::Vector2f a, sf::Vector2f b, sf::Vector2f c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

bool isPointInTriangle(sf::Vector2f point, sf::Vector2f a,
                       sf::Vector2f b, sf::Vector2f c) {
    const float c1 = cross(a, b, point);
    const float c2 = cross(b, c, point);
    const float c3 = cross(c, a, point);
    const bool hasNegative = c1 < 0.0f || c2 < 0.0f || c3 < 0.0f;
    const bool hasPositive = c1 > 0.0f || c2 > 0.0f || c3 > 0.0f;
    return !(hasNegative && hasPositive);
}

}

WorldEnvironment::WorldEnvironment(const dof::loaders::ConfigLoader& config) {
    load(config);
}

void WorldEnvironment::load(const dof::loaders::ConfigLoader& config) {
    WorldEnvironmentState loaded;
    const std::string pathText = config.getString("WORLD_ENVIRONMENT_PATHS");
    for (const auto& record : split(pathText, '~')) {
        if (record.empty()) continue;
        const auto fields = split(record, '|');
        if (fields.size() < 9u || fields.size() > 11u) {
            throw std::runtime_error("World environment path record requires 9 to 11 fields");
        }
        WorldPathDefinition path;
        path.name = safeName(fields[0], "Path");
        path.width = parseFloat(fields[1], "path width");
        path.feather = parseFloat(fields[2], "path feather");
        path.materialIndex = parseInt(fields[3], "path material");
        parseInt(fields[4], "legacy path smoothing");
        parseInt(fields[5], "legacy path closed");
        path.isWalkable = parseInt(fields[6], "path walkable") != 0;
        path.tint = parseColor(fields[7], "path tint");
        path.points = parsePoints(fields[8], 2u, "path");
        if (fields.size() >= 10u) path.zIndex = parseInt(fields[9], "path z-index");
        if (fields.size() == 11u) path.atlasAssetPath = decodeField(fields[10]);
        if (path.atlasAssetPath.empty()) {
            path.atlasAssetPath = config.getString("WORLD_EDITOR_DEFAULT_PATH_ATLAS_ASSET");
        }
        if (path.width <= 0.0f || path.feather < 0.0f) {
            throw std::runtime_error("World environment path dimensions are invalid");
        }
        loaded.paths.push_back(std::move(path));
    }

    const std::string zoneText = config.getString("WORLD_ENVIRONMENT_ZONES");
    for (const auto& record : split(zoneText, '~')) {
        if (record.empty()) continue;
        const auto fields = split(record, '|');
        if (fields.size() != 8u && fields.size() != 11u) {
            throw std::runtime_error("World environment zone record requires 8 or 11 fields");
        }
        WorldZoneDefinition zone;
        zone.name = safeName(fields[0], "Zone");
        zone.kind = static_cast<WorldZoneKind>(std::clamp(
            parseInt(fields[1], "zone kind"), 0, 4));
        zone.materialIndex = parseInt(fields[2], "zone material");
        zone.feather = std::max(0.0f, parseFloat(fields[3], "zone feather"));
        zone.isWalkable = parseInt(fields[4], "zone walkable") != 0;
        zone.isBlocking = parseInt(fields[5], "zone blocking") != 0;
        zone.tint = parseColor(fields[6], "zone tint");
        zone.points = parsePoints(fields[7], 3u, "zone");
        if (fields.size() == 11u) {
            zone.zIndex = parseInt(fields[8], "zone z-index");
            zone.assetPath = decodeField(fields[9]);
            zone.assetWorldSize = std::max(1.0f,
                parseFloat(fields[10], "zone asset world size"));
        }
        loaded.zones.push_back(std::move(zone));
    }

    const std::string stampText = config.getString("WORLD_ENVIRONMENT_STAMPS");
    for (const auto& record : split(stampText, '~')) {
        if (record.empty()) continue;
        const auto fields = split(record, '|');
        if (fields.size() != 10u && fields.size() != 12u && fields.size() != 13u) {
            throw std::runtime_error(
                "World environment stamp record requires 10, 12, or 13 fields");
        }
        WorldStampDefinition stamp;
        stamp.name = safeName(fields[0], "Stamp");
        stamp.catalogIndex = std::max(0, parseInt(fields[1], "stamp catalog index"));
        stamp.position = parseVector(fields[2], "stamp position");
        stamp.scale = parseVector(fields[3], "stamp scale");
        stamp.rotationDegrees = parseFloat(fields[4], "stamp rotation");
        stamp.alpha = std::clamp(parseInt(fields[5], "stamp alpha"), 0, 255);
        stamp.layer = parseInt(fields[6], "stamp layer");
        stamp.isFlippedX = parseInt(fields[7], "stamp flip") != 0;
        stamp.collisionRadius = std::max(0.0f,
            parseFloat(fields[8], "stamp collision radius"));
        stamp.tint = parseColor(fields[9], "stamp tint");
        if (fields.size() >= 12u) {
            stamp.assetPath = decodeField(fields[10]);
            stamp.assetWorldWidth = std::max(1.0f,
                parseFloat(fields[11], "stamp asset world width"));
        }
        if (fields.size() == 13u) {
            stamp.originRatio = parseVector(fields[12], "stamp origin ratio");
        }
        loaded.stamps.push_back(std::move(stamp));
    }

    const std::string enemyText = config.getString("WORLD_ENVIRONMENT_ENEMIES");
    for (const auto& record : split(enemyText, '~')) {
        if (record.empty()) continue;
        const auto fields = split(record, '|');
        if (fields.size() != 5u) {
            throw std::runtime_error(
                "World environment enemy record requires 5 fields");
        }
        WorldEnemyDefinition enemy;
        enemy.name = safeName(fields[0], "Enemy");
        enemy.typeId = decodeField(fields[1]);
        enemy.position = parseVector(fields[2], "enemy position");
        enemy.level = std::max(1, parseInt(fields[3], "enemy level"));
        enemy.tier = std::clamp(parseInt(fields[4], "enemy tier"), 0, 2);
        if (enemy.typeId.empty()) enemy.typeId = "regular";
        loaded.enemies.push_back(std::move(enemy));
    }
    stateValue = std::move(loaded);
}

void WorldEnvironment::writeRuntimeValues(dof::loaders::ConfigLoader& config) const {
    config.setRaw("WORLD_ENVIRONMENT_PATHS", serializePaths());
    config.setRaw("WORLD_ENVIRONMENT_ZONES", serializeZones());
    config.setRaw("WORLD_ENVIRONMENT_STAMPS", serializeStamps());
    config.setRaw("WORLD_ENVIRONMENT_ENEMIES", serializeEnemies());
}

std::string WorldEnvironment::serializePaths() const {
    std::ostringstream out;
    for (std::size_t index = 0; index < stateValue.paths.size(); ++index) {
        const auto& path = stateValue.paths[index];
        if (index != 0u) out << '~';
        out << safeName(path.name, "Path") << '|'
            << formatFloat(path.width) << '|'
            << formatFloat(path.feather) << '|'
            << path.materialIndex << '|'
            << 0 << '|'
            << 0 << '|'
            << (path.isWalkable ? 1 : 0) << '|'
            << serializeColor(path.tint) << '|'
            << serializePoints(path.points) << '|'
            << path.zIndex << '|'
            << encodeField(path.atlasAssetPath);
    }
    return out.str();
}

std::string WorldEnvironment::serializeZones() const {
    std::ostringstream out;
    for (std::size_t index = 0; index < stateValue.zones.size(); ++index) {
        const auto& zone = stateValue.zones[index];
        if (index != 0u) out << '~';
        out << safeName(zone.name, "Zone") << '|'
            << static_cast<int>(zone.kind) << '|'
            << zone.materialIndex << '|'
            << formatFloat(zone.feather) << '|'
            << (zone.isWalkable ? 1 : 0) << '|'
            << (zone.isBlocking ? 1 : 0) << '|'
            << serializeColor(zone.tint) << '|'
            << serializePoints(zone.points) << '|'
            << zone.zIndex << '|'
            << encodeField(zone.assetPath) << '|'
            << formatFloat(zone.assetWorldSize);
    }
    return out.str();
}

std::string WorldEnvironment::serializeStamps() const {
    std::ostringstream out;
    for (std::size_t index = 0; index < stateValue.stamps.size(); ++index) {
        const auto& stamp = stateValue.stamps[index];
        if (index != 0u) out << '~';
        out << safeName(stamp.name, "Stamp") << '|'
            << stamp.catalogIndex << '|'
            << serializeVector(stamp.position) << '|'
            << serializeVector(stamp.scale) << '|'
            << formatFloat(stamp.rotationDegrees) << '|'
            << stamp.alpha << '|'
            << stamp.layer << '|'
            << (stamp.isFlippedX ? 1 : 0) << '|'
            << formatFloat(stamp.collisionRadius) << '|'
            << serializeColor(stamp.tint) << '|'
            << encodeField(stamp.assetPath) << '|'
            << formatFloat(stamp.assetWorldWidth) << '|'
            << serializeVector(stamp.originRatio);
    }
    return out.str();
}

std::string WorldEnvironment::serializeEnemies() const {
    std::ostringstream out;
    for (std::size_t index = 0; index < stateValue.enemies.size(); ++index) {
        const auto& enemy = stateValue.enemies[index];
        if (index != 0u) out << '~';
        out << safeName(enemy.name, "Enemy") << '|'
            << encodeField(enemy.typeId) << '|'
            << serializeVector(enemy.position) << '|'
            << enemy.level << '|'
            << enemy.tier;
    }
    return out.str();
}

std::vector<unsigned> triangulateWorldPolygon(const std::vector<sf::Vector2f>& points) {
    std::vector<unsigned> result;
    if (points.size() < 3u) return result;
    float signedArea = 0.0f;
    for (std::size_t index = 0; index < points.size(); ++index) {
        const auto& a = points[index];
        const auto& b = points[(index + 1u) % points.size()];
        signedArea += a.x * b.y - b.x * a.y;
    }
    std::vector<unsigned> remaining(points.size());
    std::iota(remaining.begin(), remaining.end(), 0u);
    if (signedArea < 0.0f) std::reverse(remaining.begin(), remaining.end());
    std::size_t guard = points.size() * points.size();
    while (remaining.size() > 3u && guard-- > 0u) {
        bool clipped = false;
        for (std::size_t index = 0; index < remaining.size(); ++index) {
            const unsigned previous = remaining[(index + remaining.size() - 1u)
                                                % remaining.size()];
            const unsigned current = remaining[index];
            const unsigned next = remaining[(index + 1u) % remaining.size()];
            if (cross(points[previous], points[current], points[next]) <= 0.0f) continue;
            bool containsPoint = false;
            for (const unsigned candidate : remaining) {
                if (candidate == previous || candidate == current || candidate == next) continue;
                if (isPointInTriangle(points[candidate], points[previous],
                                      points[current], points[next])) {
                    containsPoint = true;
                    break;
                }
            }
            if (containsPoint) continue;
            result.insert(result.end(), {previous, current, next});
            remaining.erase(remaining.begin() + static_cast<std::ptrdiff_t>(index));
            clipped = true;
            break;
        }
        if (!clipped) break;
    }
    if (remaining.size() == 3u) {
        result.insert(result.end(), {remaining[0], remaining[1], remaining[2]});
    }
    return result;
}

const char* worldZoneKindName(WorldZoneKind kind) {
    switch (kind) {
        case WorldZoneKind::Ground: return "Ground";
        case WorldZoneKind::Forest: return "Forest";
        case WorldZoneKind::Water: return "Water";
        case WorldZoneKind::Field: return "Field";
        case WorldZoneKind::Blocked: return "Blocked";
    }
    return "Ground";
}

} // namespace dof::core
