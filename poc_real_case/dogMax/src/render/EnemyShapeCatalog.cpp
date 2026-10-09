#include "render/EnemyShapeCatalog.hpp"

#include "loaders/ConfigLoader.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <unordered_map>

namespace dof::render {

namespace {
constexpr float kPi = 3.14159265358979f;
} // namespace

ShapeForm parseShapeForm(const std::string& name) {
    static const std::unordered_map<std::string, ShapeForm> table = {
        {"polygon", ShapeForm::Polygon}, {"star", ShapeForm::Star},
        {"cross", ShapeForm::Cross},     {"arrow", ShapeForm::Arrow},
        {"kite", ShapeForm::Kite},       {"shield", ShapeForm::Shield},
        {"wedge", ShapeForm::Wedge},     {"hourglass", ShapeForm::Hourglass},
        {"drop", ShapeForm::Drop},       {"lens", ShapeForm::Lens},
        {"gem", ShapeForm::Gem},
    };
    const auto it = table.find(name);
    return it == table.end() ? ShapeForm::Polygon : it->second;
}

namespace {

sf::Vector2f rotate(sf::Vector2f p, float radians) {
    const float c = std::cos(radians);
    const float s = std::sin(radians);
    return {p.x * c - p.y * s, p.x * s + p.y * c};
}

// Mirror a right-half vertex list (first & last points on the x=0 axis,
// interior points with x>=0) about the vertical axis and append, producing an
// exactly bilaterally-symmetric closed outline.
std::vector<sf::Vector2f> mirrorRight(const std::vector<sf::Vector2f>& right) {
    std::vector<sf::Vector2f> out = right;
    for (int i = static_cast<int>(right.size()) - 2; i >= 1; --i) {
        out.push_back({-right[static_cast<std::size_t>(i)].x,
                        right[static_cast<std::size_t>(i)].y});
    }
    return out;
}

// Unit-radius right-half profile for each bilateral form, top axis -> bottom
// axis. y is positive downward (screen space); aspect stretches y.
std::vector<sf::Vector2f> bilateralRightHalf(ShapeForm form) {
    switch (form) {
        case ShapeForm::Arrow:     return {{0.f,-1.0f},{0.85f,0.25f},{0.f,-0.05f}};
        case ShapeForm::Kite:      return {{0.f,-1.0f},{0.6f,-0.1f},{0.f,1.0f}};
        case ShapeForm::Shield:    return {{0.f,-0.85f},{0.8f,-0.7f},{0.7f,0.1f},{0.f,1.0f}};
        case ShapeForm::Wedge:     return {{0.f,-0.7f},{0.5f,-0.7f},{0.95f,0.7f},{0.f,0.7f}};
        case ShapeForm::Hourglass: return {{0.f,-0.95f},{0.75f,-0.95f},{0.12f,0.0f},{0.75f,0.95f},{0.f,0.95f}};
        case ShapeForm::Drop:      return {{0.f,-0.6f},{0.7f,-0.4f},{0.5f,0.2f},{0.f,1.0f}};
        case ShapeForm::Lens:      return {{0.f,-0.5f},{0.6f,-0.32f},{1.0f,0.0f},{0.6f,0.32f},{0.f,0.5f}};
        case ShapeForm::Gem:       return {{0.f,-0.7f},{0.45f,-0.7f},{0.85f,-0.15f},{0.f,1.0f}};
        default:                   return {{0.f,-1.0f},{0.6f,0.0f},{0.f,1.0f}};
    }
}

} // namespace

int shapeRotationalOrder(const EnemyShapeSpec& spec) {
    switch (spec.form) {
        case ShapeForm::Polygon: return std::max(3, spec.count);
        case ShapeForm::Star:    return std::max(2, spec.count);
        case ShapeForm::Cross:   return 4;
        default:                 return 0;  // bilateral forms
    }
}

std::vector<sf::Vector2f> buildEnemyShapeOutline(const EnemyShapeSpec& spec, float radius) {
    const float rot = spec.rotationDegrees * kPi / 180.0f;
    const float R   = radius;
    std::vector<sf::Vector2f> pts;

    switch (spec.form) {
        case ShapeForm::Polygon: {
            const int n = std::max(3, spec.count);
            pts.reserve(static_cast<std::size_t>(n));
            for (int i = 0; i < n; ++i) {
                const float a = rot + 2.0f * kPi * static_cast<float>(i) / static_cast<float>(n);
                pts.push_back({R * std::cos(a), R * std::sin(a)});
            }
            return pts;
        }
        case ShapeForm::Star: {
            const int n = std::max(2, spec.count);
            const float ri = std::clamp(spec.inner, 0.05f, 0.95f) * R;
            pts.reserve(static_cast<std::size_t>(2 * n));
            for (int i = 0; i < 2 * n; ++i) {
                const float a = rot + kPi * static_cast<float>(i) / static_cast<float>(n);
                const float r = (i % 2 == 0) ? R : ri;
                pts.push_back({r * std::cos(a), r * std::sin(a)});
            }
            return pts;
        }
        case ShapeForm::Cross: {
            const float t = std::clamp(spec.inner, 0.1f, 0.6f);
            const sf::Vector2f unit[12] = {
                {1.f,-t},{1.f,t},{t,t},{t,1.f},{-t,1.f},{-t,t},
                {-1.f,t},{-1.f,-t},{-t,-t},{-t,-1.f},{t,-1.f},{t,-t}};
            pts.reserve(12);
            for (const auto& p : unit) pts.push_back(rotate({p.x * R, p.y * R}, rot));
            return pts;
        }
        default:
            break;  // bilateral forms below
    }

    std::vector<sf::Vector2f> right = bilateralRightHalf(spec.form);
    for (auto& p : right) {
        p.y *= spec.aspect;
        p.x *= R;
        p.y *= R;
    }
    return mirrorRight(right);
}

std::vector<EnemyShapeSpec> loadEnemyShapeCatalog(const dof::loaders::ConfigLoader& config) {
    const int count = config.getInt("ENEMY_SHAPE_COUNT");
    std::vector<EnemyShapeSpec> catalog;
    catalog.reserve(static_cast<std::size_t>(std::max(0, count)));
    for (int i = 0; i < count; ++i) {
        char prefix[32];
        std::snprintf(prefix, sizeof(prefix), "SHAPE_%02d_", i);
        const std::string base = prefix;
        EnemyShapeSpec spec;
        spec.name            = config.getString(base + "NAME");
        spec.form            = parseShapeForm(config.getString(base + "FORM"));
        spec.count           = config.getInt(base + "N");
        spec.inner           = config.getFloat(base + "INNER");
        spec.aspect          = config.getFloat(base + "ASPECT");
        spec.rotationDegrees = config.getFloat(base + "ROTATION_DEG");
        spec.coreRadius      = config.getFloat(base + "CORE");
        catalog.push_back(std::move(spec));
    }
    return catalog;
}

} // namespace dof::render
