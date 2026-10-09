#pragma once

#include "entities/Dice.hpp"
#include "entities/Weapon.hpp"

#include <SFML/Graphics/BlendMode.hpp>
#include <SFML/Graphics/Glsl.hpp>
#include <SFML/Graphics/Texture.hpp>

namespace sf { class RenderTarget; class Shader; }

namespace dof::render {

// Maps DiceFace to the u_sides uniform expected by die.frag.
// 4→3  6→4  8→4  12→5  20→6  24→6  30→7  42→8  60→8  100→0(prism)
float diceSidesForFace(dof::entities::DiceFace face);

// Converts 0..255 sf::Color triple to normalised sf::Glsl::Vec3.
sf::Glsl::Vec3 colorToGlsl(sf::Color c);

// Owns the 1×1 white texture required by the SDF quad trick (SFML's
// default vertex shader fills gl_TexCoord[0] from the drawable's
// texCoords; binding a white texture + a size-matched texRect makes
// UVs run 0..size so the fragment shader can normalise by u_resolution).
// One instance per renderer; pass shader pointers from ShaderLoader
// ("die" / "weapon" keys). If a pointer is null the call is a no-op
// and the caller should fall back to the ConvexShape/rect path.
// Palette inputs for the enemy body shader. These exist because the shader used
// to hard-code white and a cyan wash, which put extra colours outside the locked
// three-hue palette on the most numerous object in the game.
struct EnemyShaderPalette {
    float          coreWhite{0.0f};
    float          peakWhite{0.0f};
    sf::Glsl::Vec3 chargedColor{1.0f, 1.0f, 1.0f};
};

class ShapeShaders {
public:
    ShapeShaders();

    void drawDie(sf::RenderTarget& rt, sf::Shader* dieShader,
                 sf::Vector2f pos, float size,
                 dof::entities::DiceFace face, sf::Glsl::Vec3 color,
                 float charged = 0.f,
                 sf::BlendMode blend = sf::BlendAlpha);

    // enemy.frag: neon ring body + radial inferno corona; identity is carried
    // entirely by u_color + size. u_charged drives the wind-up cyan-pulse
    // telegraph (0=idle, 1=ready).
    // The hero, drawn in the same shader language as the enemies so the
    // protagonist is not the poorest-rendered thing on screen.
    void drawHero(sf::RenderTarget& rt, sf::Shader* heroShader,
                  sf::Vector2f pos, float size, sf::Glsl::Vec3 color,
                  float timeSeconds, float facingRadians, float energy,
                  float pulse, int form,
                  sf::BlendMode blend = sf::BlendAlpha);

    void drawEnemy(sf::RenderTarget& rt, sf::Shader* enemyShader,
                   sf::Vector2f pos, float size,
                   sf::Glsl::Vec3 color,
                   float charged,
                   const EnemyShaderPalette& palette,
                   sf::BlendMode blend = sf::BlendAlpha);

    // effect_*.frag: a per-enemy effect layer from the effect "bibliothek".
    // Bound uniforms follow the shared effect contract (u_resolution,
    // u_color, u_progress, u_variant, u_speed, u_intensity). `size` is the
    // effect quad edge in px. Additive blending by default so neon layers
    // sum visually. Null shader = no-op.
    void drawEffect(sf::RenderTarget& rt, sf::Shader* effectShader,
                    sf::Vector2f pos, float size,
                    sf::Glsl::Vec3 color, float progress,
                    float variant, float speed, float intensity,
                    sf::BlendMode blend = sf::BlendAdd);

private:
    void drawQuad(sf::RenderTarget& rt, sf::Vector2f pos, float size,
                  sf::Shader& shader, sf::BlendMode blend);
    void drawQuadRect(sf::RenderTarget& rt, sf::Vector2f pos, sf::Vector2f size,
                       sf::Shader& shader, sf::BlendMode blend);

    sf::Texture m_white;
};

} // namespace dof::render
