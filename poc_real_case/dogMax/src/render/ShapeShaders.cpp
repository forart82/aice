#include "render/ShapeShaders.hpp"

#include "render/EffectUniforms.hpp"

#include <SFML/Graphics/Image.hpp>
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderTarget.hpp>
#include <SFML/Graphics/RenderStates.hpp>
#include <SFML/Graphics/Shader.hpp>
#include <SFML/System/Clock.hpp>
#include <SFML/System/Time.hpp>

namespace dof::render {

float diceSidesForFace(dof::entities::DiceFace face) {
    using F = dof::entities::DiceFace;
    switch (face) {
        case F::D4:          return 3.f;
        case F::D6: case F::D8:   return 4.f;
        case F::D12:         return 5.f;
        case F::D20: case F::D24: return 6.f;
        case F::D30:         return 7.f;
        case F::D42: case F::D60: return 8.f;
        case F::D100:        return 0.f;
    }
    return 6.f;
}

sf::Glsl::Vec3 colorToGlsl(sf::Color c) {
    return {static_cast<float>(c.r) / 255.f,
            static_cast<float>(c.g) / 255.f,
            static_cast<float>(c.b) / 255.f};
}

ShapeShaders::ShapeShaders() {
    sf::Image px;
    px.resize({1, 1}, sf::Color::White);
    static_cast<void>(m_white.loadFromImage(px));
    m_white.setRepeated(true);
}

void ShapeShaders::drawQuad(sf::RenderTarget& rt, sf::Vector2f pos, float size,
                            sf::Shader& shader, sf::BlendMode blend) {
    drawQuadRect(rt, pos, {size, size}, shader, blend);
}

void ShapeShaders::drawQuadRect(sf::RenderTarget& rt, sf::Vector2f pos, sf::Vector2f size,
                                  sf::Shader& shader, sf::BlendMode blend) {
    sf::RectangleShape quad(size);
    quad.setOrigin({size.x * 0.5f, size.y * 0.5f});
    quad.setPosition(pos);
    quad.setTexture(&m_white);
    quad.setTextureRect(sf::IntRect({0, 0},
                                     {static_cast<int>(size.x), static_cast<int>(size.y)}));
    sf::RenderStates states;
    states.shader    = &shader;
    states.blendMode = blend;
    rt.draw(quad, states);
}

void ShapeShaders::drawDie(sf::RenderTarget& rt, sf::Shader* dieShader,
                           sf::Vector2f pos, float size,
                           dof::entities::DiceFace face, sf::Glsl::Vec3 color,
                           float charged, sf::BlendMode blend) {
    if (!dieShader) return;
    dieShader->setUniform("u_resolution", sf::Glsl::Vec2(size, size));
    dieShader->setUniform("u_color",      color);
    dieShader->setUniform("u_sides",      diceSidesForFace(face));
    dieShader->setUniform("u_rotation",   0.f);
    dieShader->setUniform("u_charged",    charged);
    drawQuad(rt, pos, size, *dieShader, blend);
}

void ShapeShaders::drawHero(sf::RenderTarget& rt, sf::Shader* heroShader,
                            sf::Vector2f pos, float size, sf::Glsl::Vec3 color,
                            float timeSeconds, float facingRadians, float energy,
                            float pulse, int form, sf::BlendMode blend) {
    if (!heroShader) return;
    heroShader->setUniform("u_resolution", sf::Glsl::Vec2(size, size));
    heroShader->setUniform("u_color",  color);
    heroShader->setUniform("u_time",   timeSeconds);
    heroShader->setUniform("u_facing", facingRadians);
    heroShader->setUniform("u_energy", energy);
    heroShader->setUniform("u_pulse",  pulse);
    heroShader->setUniform("u_form",   form);
    drawQuad(rt, pos, size, *heroShader, blend);
}

void ShapeShaders::drawEnemy(sf::RenderTarget& rt, sf::Shader* enemyShader,
                             sf::Vector2f pos, float size,
                             sf::Glsl::Vec3 color, float charged,
                             const EnemyShaderPalette& palette,
                             sf::BlendMode blend) {
    if (!enemyShader) return;
    enemyShader->setUniform("u_resolution", sf::Glsl::Vec2(size, size));
    enemyShader->setUniform("u_color",      color);
    enemyShader->setUniform("u_charged",    charged);
    enemyShader->setUniform("u_core_white",    palette.coreWhite);
    enemyShader->setUniform("u_peak_white",    palette.peakWhite);
    enemyShader->setUniform("u_charged_color", palette.chargedColor);
    static sf::Clock fogClock;
    enemyShader->setUniform("u_time",       fogClock.getElapsedTime().asSeconds());
    drawQuad(rt, pos, size, *enemyShader, blend);
}



void ShapeShaders::drawEffect(sf::RenderTarget& rt, sf::Shader* effectShader,
                              sf::Vector2f pos, float size,
                              sf::Glsl::Vec3 color, float progress,
                              float variant, float speed, float intensity,
                              sf::BlendMode blend) {
    if (!effectShader) return;
    effectShader->setUniform("u_resolution", sf::Glsl::Vec2(size, size));
    effectShader->setUniform("u_color",      color);
    setOptionalEffectFloat(*effectShader, "u_progress",  progress);
    setOptionalEffectFloat(*effectShader, "u_variant",   variant);
    setOptionalEffectFloat(*effectShader, "u_speed",     speed);
    setOptionalEffectFloat(*effectShader, "u_intensity", intensity);
    drawQuad(rt, pos, size, *effectShader, blend);
}


} // namespace dof::render
