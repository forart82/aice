#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Shader.hpp>
#include <SFML/System/Err.hpp>
#include <SFML/System/Vector2.hpp>

#include <ostream>
#include <streambuf>

namespace dof::render {

// Every effect shader shares one uniform contract (u_resolution, u_color,
// u_progress, u_variant, u_speed, u_intensity), but an individual effect may
// legitimately ignore one of the optional floats — effect_ring, for example,
// is purely u_progress-driven and never reads u_speed. The GLSL compiler
// strips a uniform a shader never reads, and SFML's sf::Shader::setUniform
// then logs "Uniform "<name>" not found in shader" to sf::err() for that
// stripped uniform.
//
// setUniform's ONLY diagnostic output is that not-found warning, so silencing
// sf::err() for exactly the optional-float set — and restoring it immediately
// after — keeps the console clean without hiding any other error and without
// per-shader special-casing at every call site.
inline void setOptionalEffectFloat(sf::Shader& shader, const char* name, float value) {
    std::streambuf* previousBuffer = sf::err().rdbuf(nullptr);
    shader.setUniform(name, value);
    sf::err().rdbuf(previousBuffer);
}

// Push the whole six-uniform contract in one call — the only way any effect
// shader is ever parameterised. Three call sites (EffectsRenderer, the composed
// EffectsCatalogWindow grid, the GroupedEffectsCatalog grid) previously repeated
// this block verbatim, including the const_cast.
//
// The const_cast lives here rather than at each call site: ShaderLoader hands
// out `const sf::Shader*` because callers must not swap the program, but SFML
// models uniform assignment as non-const even though it mutates only GL-side
// state. Confining the cast to this one function keeps that compromise in a
// single, documented place.
inline void applyEffectUniforms(const sf::Shader& shader,
                                sf::Vector2f resolution,
                                sf::Color color,
                                float progress,
                                float variant,
                                float speed,
                                float intensity) {
    sf::Shader& mutableShader = const_cast<sf::Shader&>(shader);
    mutableShader.setUniform("u_resolution", sf::Glsl::Vec2(resolution.x, resolution.y));
    mutableShader.setUniform("u_color", sf::Glsl::Vec3(
        static_cast<float>(color.r) / 255.f,
        static_cast<float>(color.g) / 255.f,
        static_cast<float>(color.b) / 255.f));
    setOptionalEffectFloat(mutableShader, "u_progress",  progress);
    setOptionalEffectFloat(mutableShader, "u_variant",   variant);
    setOptionalEffectFloat(mutableShader, "u_speed",     speed);
    setOptionalEffectFloat(mutableShader, "u_intensity", intensity);
}

} // namespace dof::render
