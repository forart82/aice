#include "render/EnemyTemplateWriter.hpp"

#include <fstream>
#include <iomanip>
#include <sstream>
#include <stdexcept>

namespace dof::render {
namespace {

using entities::EffectMotion;
using entities::EnemyEffectLayer;
using entities::EnemyTemplate;
using entities::EnemyTierDesign;
using entities::SpecialEnemyKind;

std::string specialKindToken(SpecialEnemyKind kind) {
    switch (kind) {
        case SpecialEnemyKind::None:              return "None";
        case SpecialEnemyKind::Shocker:           return "Shocker";
        case SpecialEnemyKind::Glasswraith:       return "Glasswraith";
        case SpecialEnemyKind::Hexarchon:         return "Hexarchon";
        case SpecialEnemyKind::TassideanSentinel: return "TassideanSentinel";
        case SpecialEnemyKind::Voidcrawler:       return "Voidcrawler";
        case SpecialEnemyKind::PactWalker:        return "PactWalker";
    }
    return "None";
}

std::string layerIndexToken(int index) {
    std::ostringstream out;
    out << std::setw(2) << std::setfill('0') << index;
    return out.str();
}

std::string formatFloat(float value) {
    std::ostringstream out;
    out << std::fixed << std::setprecision(2) << value;
    return out.str();
}

void writeLayer(std::ostream& out, const std::string& prefix, const EnemyEffectLayer& layer) {
    out << prefix << "SHADER: " << layer.shaderName << "\n";
    out << prefix << "MOTION: " << entities::effectMotionToken(layer.motion) << "\n";
    out << prefix << "Z: " << layer.z << "\n";
    out << prefix << "COLOR_R: " << static_cast<int>(layer.color.r) << "\n";
    out << prefix << "COLOR_G: " << static_cast<int>(layer.color.g) << "\n";
    out << prefix << "COLOR_B: " << static_cast<int>(layer.color.b) << "\n";
    out << prefix << "SIZE: " << formatFloat(layer.size) << "\n";
    out << prefix << "VARIANT: " << layer.variant << "\n";
    out << prefix << "SPEED: " << formatFloat(layer.speed) << "\n";
    out << prefix << "INTENSITY: " << formatFloat(layer.intensity) << "\n";
    switch (layer.motion) {
        case EffectMotion::Static:
            out << prefix << "OFFSET_X: " << formatFloat(layer.offsetX) << "\n";
            out << prefix << "OFFSET_Y: " << formatFloat(layer.offsetY) << "\n";
            break;
        case EffectMotion::Orbit:
            out << prefix << "ORBIT_RADIUS: " << formatFloat(layer.orbitRadius) << "\n";
            out << prefix << "ORBIT_SPEED_DEG: " << formatFloat(layer.orbitSpeedDeg) << "\n";
            out << prefix << "ORBIT_PHASE_DEG: " << formatFloat(layer.orbitPhaseDeg) << "\n";
            break;
        case EffectMotion::Popup:
            out << prefix << "POPUP_RADIUS: " << formatFloat(layer.popupRadius) << "\n";
            out << prefix << "POPUP_INTERVAL: " << formatFloat(layer.popupInterval) << "\n";
            out << prefix << "POPUP_LIFETIME: " << formatFloat(layer.popupLifetime) << "\n";
            break;
    }
}

void writeLayerBlock(std::ostream& out, const std::string& keyPrefix,
                     const std::vector<EnemyEffectLayer>& layers) {
    out << keyPrefix << "LAYER_COUNT: " << layers.size() << "\n";
    for (std::size_t i = 0; i < layers.size(); ++i) {
        out << "\n";
        const std::string prefix = keyPrefix + "LAYER_" + layerIndexToken(static_cast<int>(i)) + "_";
        writeLayer(out, prefix, layers[i]);
    }
}

// Compare two layer vectors by their serialized data (prefix-independent), so a
// per-tier layer set is written as an override only when it truly differs from
// the common/base layers.
std::string layersDataString(const std::vector<EnemyEffectLayer>& layers) {
    std::ostringstream out;
    writeLayerBlock(out, "", layers);
    return out.str();
}

bool layersDiffer(const std::vector<EnemyEffectLayer>& a,
                  const std::vector<EnemyEffectLayer>& b) {
    return layersDataString(a) != layersDataString(b);
}

// A tier override is emitted when ANY field diverges from the common base. The
// loader (EnemyTemplateLoader::resolveTier) reads per-tier BODY_SHAPE, BODY_SIZE,
// OUTLINE_*, FILL_*, and a tier-prefixed LAYER_COUNT/layer block — so the writer
// must round-trip every one of those, not just size + outline (else Ctrl+E edits
// to a tier's shape/fill/effect-layers are silently lost on reload).
bool tierDiffers(const EnemyTierDesign& tier, const EnemyTierDesign& base) {
    return tier.bodyShape != base.bodyShape || tier.bodySize != base.bodySize
        || tier.outline != base.outline || tier.fill != base.fill
        || layersDiffer(tier.layers, base.layers);
}

void writeTierOverride(std::ostream& out, const std::string& tierPrefix,
                       const EnemyTierDesign& tier, const EnemyTierDesign& base) {
    if (!tierDiffers(tier, base)) return;
    out << "\n";
    if (tier.bodyShape != base.bodyShape) {
        out << "ENEMY_" << tierPrefix << "BODY_SHAPE: " << tier.bodyShape << "\n";
    }
    if (tier.bodySize != base.bodySize) {
        out << "ENEMY_" << tierPrefix << "BODY_SIZE: " << formatFloat(tier.bodySize) << "\n";
    }
    if (tier.outline != base.outline) {
        out << "ENEMY_" << tierPrefix << "OUTLINE_R: " << static_cast<int>(tier.outline.r) << "\n";
        out << "ENEMY_" << tierPrefix << "OUTLINE_G: " << static_cast<int>(tier.outline.g) << "\n";
        out << "ENEMY_" << tierPrefix << "OUTLINE_B: " << static_cast<int>(tier.outline.b) << "\n";
    }
    if (tier.fill != base.fill) {
        out << "ENEMY_" << tierPrefix << "FILL_R: " << static_cast<int>(tier.fill.r) << "\n";
        out << "ENEMY_" << tierPrefix << "FILL_G: " << static_cast<int>(tier.fill.g) << "\n";
        out << "ENEMY_" << tierPrefix << "FILL_B: " << static_cast<int>(tier.fill.b) << "\n";
    }
    if (layersDiffer(tier.layers, base.layers)) {
        out << "\n";
        writeLayerBlock(out, "ENEMY_" + tierPrefix, tier.layers);
    }
}

}  // namespace

void writeEnemyTemplate(const EnemyTemplate& tmpl, const std::filesystem::path& path) {
    std::ofstream out(path, std::ios::trunc);
    if (!out) {
        throw std::runtime_error("EnemyTemplateWriter: cannot write '" + path.string() + "'");
    }

    const EnemyTierDesign& base = tmpl.common;

    out << "ENEMY_TYPE_ID: " << tmpl.id << "\n";
    out << "ENEMY_TYPE_NAME: " << tmpl.name << "\n";
    out << "ENEMY_SPECIAL_KIND: " << specialKindToken(tmpl.specialKind) << "\n";
    out << "\n";

    out << "ENEMY_BODY_SHAPE: " << base.bodyShape << "\n";
    out << "ENEMY_BODY_SIZE: " << formatFloat(base.bodySize) << "\n";
    out << "ENEMY_OUTLINE_R: " << static_cast<int>(base.outline.r) << "\n";
    out << "ENEMY_OUTLINE_G: " << static_cast<int>(base.outline.g) << "\n";
    out << "ENEMY_OUTLINE_B: " << static_cast<int>(base.outline.b) << "\n";
    out << "ENEMY_FILL_R: " << static_cast<int>(base.fill.r) << "\n";
    out << "ENEMY_FILL_G: " << static_cast<int>(base.fill.g) << "\n";
    out << "ENEMY_FILL_B: " << static_cast<int>(base.fill.b) << "\n";
    out << "\n";

    writeLayerBlock(out, "ENEMY_", base.layers);

    writeTierOverride(out, "UNCOMMON_", tmpl.uncommon, base);
    writeTierOverride(out, "RARE_", tmpl.rare, base);

    if (!out) {
        throw std::runtime_error("EnemyTemplateWriter: write failed for '" + path.string() + "'");
    }
}

void writeEnemyTemplateAndSync(const EnemyTemplate& tmpl,
                               const std::filesystem::path& sourcePath,
                               const std::filesystem::path& buildPath) {
    writeEnemyTemplate(tmpl, sourcePath);
    if (std::filesystem::exists(buildPath.parent_path())) {
        std::filesystem::copy_file(sourcePath, buildPath,
                                   std::filesystem::copy_options::overwrite_existing);
    }
}

}  // namespace dof::render
