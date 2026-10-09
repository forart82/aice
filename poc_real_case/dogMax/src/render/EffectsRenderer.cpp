#include "render/EffectsRenderer.hpp"

#include "render/EffectUniforms.hpp"

#include "loaders/ConfigLoader.hpp"
#include "loaders/ShaderLoader.hpp"

#include <SFML/Graphics/Image.hpp>
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderStates.hpp>
#include <SFML/Graphics/RenderTarget.hpp>
#include <SFML/Graphics/Shader.hpp>
#include <SFML/Graphics/View.hpp>

#include <algorithm>
#include <sstream>
#include <stdexcept>

namespace dof::render {

namespace {

// Parse "R G B" float string into sf::Color
sf::Color parseColor(float r, float g, float b) {
    auto c = [](float v) { return static_cast<uint8_t>(std::clamp(v, 0.f, 1.f) * 255.f); };
    return sf::Color(c(r), c(g), c(b));
}

// Parse EFX_NNN_DATA: "<shader> <cr> <cg> <cb> <variant> <speed> <intensity> <dur> <category>"
EffectDef parseDef(const std::string& data, const std::string& name) {
    std::istringstream ss(data);
    EffectDef d;
    float cr{1.f}, cg{1.f}, cb{1.f};
    ss >> d.shaderName >> cr >> cg >> cb >> d.variant
       >> d.speed >> d.intensity >> d.durationSeconds >> d.category;
    d.color = parseColor(cr, cg, cb);
    d.defaultRadius = 50.f;
    (void)name;
    return d;
}

} // namespace

EffectsRenderer::EffectsRenderer(const dof::loaders::ConfigLoader& config,
                                 const dof::loaders::ShaderLoader& shaders)
    : shaders_(shaders)
{
    // A quad with no bound texture (and no explicit texture rect) leaves
    // SFML's texcoords at the default {0,0,0,0} rect, so every effect
    // shader's `gl_TexCoord[0].xy / u_resolution` UV computation would read
    // (0,0) everywhere — a flat, spatially-uniform blob instead of the
    // authored ring/glow/spark pattern. Bind a 1x1 white texture + explicit
    // rect (same pattern as ShapeShaders::drawQuadRect) so texcoords
    // interpolate correctly across the quad.
    sf::Image px;
    px.resize({1, 1}, sf::Color::White);
    static_cast<void>(white_.loadFromImage(px));
    loadCatalog(config);
}

void EffectsRenderer::loadCatalog(const dof::loaders::ConfigLoader& config) {
    int count = config.hasKey("EFX_COUNT") ? config.getInt("EFX_COUNT") : 100;
    for (int i = 1; i <= count; ++i) {
        char idx[16];
        std::snprintf(idx, sizeof(idx), "%03d", i);
        std::string nameKey = std::string("EFX_") + idx + "_NAME";
        std::string dataKey = std::string("EFX_") + idx + "_DATA";
        if (!config.hasKey(nameKey) || !config.hasKey(dataKey)) continue;
        const std::string& name = config.getString(nameKey);
        const std::string& data = config.getString(dataKey);
        catalog_[name] = parseDef(data, name);
    }
}

void EffectsRenderer::play(const std::string& name, sf::Vector2f pos,
                            float radiusOverride, float progressOffset,
                            const sf::Color* colorOverride)
{
    auto it = catalog_.find(name);
    if (it == catalog_.end()) return;
    ActiveEffect ae;
    ae.def           = it->second;
    ae.worldPos      = pos;
    ae.radius        = (radiusOverride > 0.f) ? radiusOverride : ae.def.defaultRadius;
    ae.progress      = std::clamp(progressOffset, 0.f, 1.f);
    ae.elapsed       = ae.progress * ae.def.durationSeconds;
    ae.progressOffset = progressOffset;
    ae.color         = colorOverride ? *colorOverride : ae.def.color;
    active_.push_back(ae);
}

void EffectsRenderer::tick(float dt) {
    for (auto& ae : active_) {
        ae.elapsed  += dt;
        ae.progress  = std::min(ae.elapsed / ae.def.durationSeconds, 1.f);
    }
    active_.erase(
        std::remove_if(active_.begin(), active_.end(),
                       [](const ActiveEffect& ae) { return ae.progress >= 1.f; }),
        active_.end());
}

void EffectsRenderer::draw(sf::RenderTarget& target, const sf::View& worldView) const {
    if (active_.empty()) return;
    target.setView(worldView);

    sf::RectangleShape quad;
    for (const auto& ae : active_) {
        const sf::Shader* sh = shaders_.getShader(ae.def.shaderName);
        if (!sh) continue;

        const float side = ae.radius * 2.f;
        quad.setSize({side, side});
        quad.setOrigin({ae.radius, ae.radius});
        quad.setPosition(ae.worldPos);
        quad.setTexture(&white_);
        quad.setTextureRect(sf::IntRect({0, 0},
            {static_cast<int>(side), static_cast<int>(side)}));

        sf::RenderStates states;
        states.shader    = sh;
        states.blendMode = sf::BlendAdd;

        applyEffectUniforms(*sh, {side, side}, ae.color, ae.progress,
                            ae.def.variant, ae.def.speed, ae.def.intensity);

        target.draw(quad, states);
    }
}

int EffectsRenderer::activeCount() const {
    return static_cast<int>(active_.size());
}

std::vector<std::pair<std::string, float>> EffectsRenderer::listActive() const {
    std::vector<std::pair<std::string, float>> out;
    out.reserve(active_.size());
    for (const auto& ae : active_)
        out.emplace_back(ae.def.category, ae.progress);
    return out;
}

bool EffectsRenderer::hasDef(const std::string& name) const {
    return catalog_.count(name) > 0;
}

} // namespace dof::render
