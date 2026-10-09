#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/System/Vector2.hpp>

#include <string>
#include <utility>
#include <vector>

namespace dof::loaders { class ConfigLoader; }

namespace dof::core {

enum class WorldZoneKind {
    Ground,
    Forest,
    Water,
    Field,
    Blocked,
};

struct WorldPathDefinition {
    std::string name;
    std::vector<sf::Vector2f> points;
    float width{480.0f};
    float feather{140.0f};
    int materialIndex{0};
    int zIndex{0};
    std::string atlasAssetPath;
    bool isWalkable{true};
    sf::Color tint{sf::Color::White};
};

struct WorldZoneDefinition {
    std::string name;
    std::vector<sf::Vector2f> points;
    WorldZoneKind kind{WorldZoneKind::Ground};
    int materialIndex{-1};
    int zIndex{0};
    std::string assetPath;
    float assetWorldSize{900.0f};
    float feather{0.0f};
    bool isWalkable{false};
    bool isBlocking{false};
    sf::Color tint{70, 90, 80, 170};
};

struct WorldStampDefinition {
    std::string name;
    int catalogIndex{0};
    std::string assetPath;
    float assetWorldWidth{900.0f};
    sf::Vector2f position{};
    sf::Vector2f scale{1.0f, 1.0f};
    float rotationDegrees{0.0f};
    int alpha{255};
    int layer{0};
    bool isFlippedX{false};
    float collisionRadius{0.0f};
    sf::Color tint{sf::Color::White};
    sf::Vector2f originRatio{0.5f, 1.0f};
};

struct WorldEnemyDefinition {
    std::string name;
    std::string typeId{"regular"};
    sf::Vector2f position{};
    int level{1};
    int tier{0};
};

struct WorldEnvironmentState {
    std::vector<WorldPathDefinition> paths;
    std::vector<WorldZoneDefinition> zones;
    std::vector<WorldStampDefinition> stamps;
    std::vector<WorldEnemyDefinition> enemies;
};

class WorldEnvironment {
public:
    explicit WorldEnvironment(const dof::loaders::ConfigLoader& config);

    void load(const dof::loaders::ConfigLoader& config);
    void writeRuntimeValues(dof::loaders::ConfigLoader& config) const;

    WorldEnvironmentState& state() { return stateValue; }
    const WorldEnvironmentState& state() const { return stateValue; }
    void setState(WorldEnvironmentState replacement) { stateValue = std::move(replacement); }

    std::string serializePaths() const;
    std::string serializeZones() const;
    std::string serializeStamps() const;
    std::string serializeEnemies() const;

private:
    WorldEnvironmentState stateValue;
};

std::vector<unsigned> triangulateWorldPolygon(const std::vector<sf::Vector2f>& points);
const char* worldZoneKindName(WorldZoneKind kind);

} // namespace dof::core
