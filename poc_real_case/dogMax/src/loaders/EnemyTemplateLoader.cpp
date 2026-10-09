#include "loaders/EnemyTemplateLoader.hpp"

#include "loaders/ConfigLoader.hpp"

#include <stdexcept>

namespace dof::loaders {
namespace {

using entities::EffectMotion;
using entities::EnemyEffectLayer;
using entities::EnemyTemplate;
using entities::EnemyTierDesign;
using entities::SpecialEnemyKind;

// Two-digit zero-padded layer index, matching the SHAPE_NN_ / GEF_NNN_
// flat-key convention already used across configs/.
std::string layerIndexToken(int index) {
    std::string token = std::to_string(index);
    if (token.size() < 2) token.insert(token.begin(), '0');
    return token;
}

SpecialEnemyKind parseSpecialKind(const std::string& token) {
    if (token == "None")              return SpecialEnemyKind::None;
    if (token == "Shocker")           return SpecialEnemyKind::Shocker;
    if (token == "Glasswraith")       return SpecialEnemyKind::Glasswraith;
    if (token == "Hexarchon")         return SpecialEnemyKind::Hexarchon;
    if (token == "TassideanSentinel") return SpecialEnemyKind::TassideanSentinel;
    if (token == "Voidcrawler")       return SpecialEnemyKind::Voidcrawler;
    if (token == "PactWalker")        return SpecialEnemyKind::PactWalker;
    throw std::runtime_error("EnemyTemplateLoader: unknown ENEMY_SPECIAL_KIND '" + token + "'");
}

// Reads one effect layer at the resolved key prefix `layerKey`
// (e.g. "ENEMY_LAYER_00_" or "ENEMY_RARE_LAYER_01_"). Common fields are
// required; per-motion fields are required only for the active mode.
EnemyEffectLayer readLayer(const ConfigLoader& cfg, const std::string& layerKey) {
    EnemyEffectLayer layer;
    layer.shaderName = cfg.getString(layerKey + "SHADER");
    layer.motion     = entities::parseEffectMotion(cfg.getString(layerKey + "MOTION"));
    layer.color      = sf::Color(static_cast<std::uint8_t>(cfg.getInt(layerKey + "COLOR_R")),
                                 static_cast<std::uint8_t>(cfg.getInt(layerKey + "COLOR_G")),
                                 static_cast<std::uint8_t>(cfg.getInt(layerKey + "COLOR_B")));
    layer.size       = cfg.getFloat(layerKey + "SIZE");
    if (cfg.hasKey(layerKey + "Z"))         layer.z         = cfg.getInt(layerKey + "Z");
    if (cfg.hasKey(layerKey + "VARIANT"))   layer.variant   = cfg.getInt(layerKey + "VARIANT");
    if (cfg.hasKey(layerKey + "SPEED"))     layer.speed     = cfg.getFloat(layerKey + "SPEED");
    if (cfg.hasKey(layerKey + "INTENSITY")) layer.intensity = cfg.getFloat(layerKey + "INTENSITY");
    switch (layer.motion) {
        case EffectMotion::Static:
            layer.offsetX = cfg.getFloat(layerKey + "OFFSET_X");
            layer.offsetY = cfg.getFloat(layerKey + "OFFSET_Y");
            break;
        case EffectMotion::Orbit:
            layer.orbitRadius   = cfg.getFloat(layerKey + "ORBIT_RADIUS");
            layer.orbitSpeedDeg = cfg.getFloat(layerKey + "ORBIT_SPEED_DEG");
            if (cfg.hasKey(layerKey + "ORBIT_PHASE_DEG"))
                layer.orbitPhaseDeg = cfg.getFloat(layerKey + "ORBIT_PHASE_DEG");
            break;
        case EffectMotion::Popup:
            layer.popupRadius   = cfg.getFloat(layerKey + "POPUP_RADIUS");
            layer.popupInterval = cfg.getFloat(layerKey + "POPUP_INTERVAL");
            layer.popupLifetime = cfg.getFloat(layerKey + "POPUP_LIFETIME");
            break;
    }
    return layer;
}

// Reads a scalar field for a tier, falling back to the base key when the
// tier-prefixed override is absent. `tierPrefix` is "" (Common, reads
// base directly), "UNCOMMON_", or "RARE_".
int getTierInt(const ConfigLoader& cfg, const std::string& tierPrefix, const std::string& field) {
    const std::string tierKey = "ENEMY_" + tierPrefix + field;
    if (!tierPrefix.empty() && cfg.hasKey(tierKey)) return cfg.getInt(tierKey);
    return cfg.getInt("ENEMY_" + field);
}

float getTierFloat(const ConfigLoader& cfg, const std::string& tierPrefix, const std::string& field) {
    const std::string tierKey = "ENEMY_" + tierPrefix + field;
    if (!tierPrefix.empty() && cfg.hasKey(tierKey)) return cfg.getFloat(tierKey);
    return cfg.getFloat("ENEMY_" + field);
}

// Resolves one tier's full design. Scalars inherit the base unless a
// tier override exists. The layer SET is taken from the tier when it
// declares its own `ENEMY_<tier>LAYER_COUNT`; otherwise the base layer
// set is inherited wholesale (a tier either re-defines all its layers
// or shares the base — no per-layer merging, matching the editor model).
EnemyTierDesign resolveTier(const ConfigLoader& cfg, const std::string& tierPrefix) {
    EnemyTierDesign design;
    design.bodyShape = getTierInt(cfg, tierPrefix, "BODY_SHAPE");
    design.bodySize  = getTierFloat(cfg, tierPrefix, "BODY_SIZE");
    design.outline   = sf::Color(static_cast<std::uint8_t>(getTierInt(cfg, tierPrefix, "OUTLINE_R")),
                                 static_cast<std::uint8_t>(getTierInt(cfg, tierPrefix, "OUTLINE_G")),
                                 static_cast<std::uint8_t>(getTierInt(cfg, tierPrefix, "OUTLINE_B")));
    design.fill      = sf::Color(static_cast<std::uint8_t>(getTierInt(cfg, tierPrefix, "FILL_R")),
                                 static_cast<std::uint8_t>(getTierInt(cfg, tierPrefix, "FILL_G")),
                                 static_cast<std::uint8_t>(getTierInt(cfg, tierPrefix, "FILL_B")));

    std::string layerPrefix = tierPrefix;
    const std::string tierCountKey = "ENEMY_" + tierPrefix + "LAYER_COUNT";
    if (tierPrefix.empty() || !cfg.hasKey(tierCountKey)) layerPrefix.clear();
    const std::string countKey = "ENEMY_" + layerPrefix + "LAYER_COUNT";
    const int count = cfg.hasKey(countKey) ? cfg.getInt(countKey) : 0;
    for (int i = 0; i < count; ++i) {
        const std::string layerKey = "ENEMY_" + layerPrefix + "LAYER_" + layerIndexToken(i) + "_";
        design.layers.push_back(readLayer(cfg, layerKey));
    }
    return design;
}

}  // namespace

EnemyTemplate loadEnemyTemplateFile(const std::filesystem::path& filePath) {
    ConfigLoader cfg;
    cfg.loadFile(filePath);

    EnemyTemplate tmpl;
    tmpl.id   = cfg.hasKey("ENEMY_TYPE_ID") ? cfg.getString("ENEMY_TYPE_ID")
                                            : filePath.stem().string();
    tmpl.name = cfg.hasKey("ENEMY_TYPE_NAME") ? cfg.getString("ENEMY_TYPE_NAME") : tmpl.id;
    tmpl.specialKind = cfg.hasKey("ENEMY_SPECIAL_KIND")
                           ? parseSpecialKind(cfg.getString("ENEMY_SPECIAL_KIND"))
                           : SpecialEnemyKind::None;
    tmpl.common   = resolveTier(cfg, "");
    tmpl.uncommon = resolveTier(cfg, "UNCOMMON_");
    tmpl.rare     = resolveTier(cfg, "RARE_");
    return tmpl;
}

void EnemyTemplateRegistry::loadDirectory(const std::filesystem::path& directory) {
    if (!std::filesystem::exists(directory) || !std::filesystem::is_directory(directory)) {
        throw std::runtime_error("EnemyTemplateRegistry: directory not found: " + directory.string());
    }
    templates.clear();
    for (const auto& entry : std::filesystem::directory_iterator(directory)) {
        if (entry.is_regular_file() && entry.path().extension() == ".yaml") {
            EnemyTemplate tmpl = loadEnemyTemplateFile(entry.path());
            templates[tmpl.id] = std::move(tmpl);
        }
    }
}

void EnemyTemplateRegistry::put(const entities::EnemyTemplate& tmpl) {
    templates[tmpl.id] = tmpl;
}

bool EnemyTemplateRegistry::has(const std::string& id) const {
    return templates.find(id) != templates.end();
}

const EnemyTemplate& EnemyTemplateRegistry::get(const std::string& id) const {
    const auto it = templates.find(id);
    if (it == templates.end()) {
        throw std::runtime_error("EnemyTemplateRegistry: no template with id '" + id + "'");
    }
    return it->second;
}

const EnemyTemplate* EnemyTemplateRegistry::findBySpecialKind(SpecialEnemyKind kind) const {
    for (const auto& [id, tmpl] : templates) {
        if (tmpl.specialKind == kind) return &tmpl;
    }
    return nullptr;
}

std::vector<std::string> EnemyTemplateRegistry::ids() const {
    std::vector<std::string> out;
    out.reserve(templates.size());
    for (const auto& [id, tmpl] : templates) out.push_back(id);
    return out;
}

}  // namespace dof::loaders
