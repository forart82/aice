// ============================================================================
// DogMax — procedural dice & weapon shapes for SFML 3.0.  NO IMAGE ASSETS.
//
// Pairs with sfml/die.frag and sfml/weapon.frag. Every die and weapon icon is
// drawn by a fragment shader over a plain quad, so there are no PNGs/atlases to
// ship — the silhouettes scale cleanly and light up the bloom pass like the
// rest of the neon UI.
//
// Colours below are lifted verbatim from the game configs:
//   dice.config  (DICE_COLOR_*)      weapon.config (*_OUTLINE_*)
//   quality.config (QUALITY_TIER_*)
//
//   #include "dogmax_shapes.hpp"
//   dogmax::ShapeShaders fx;
//   fx.load("sfml/die.frag", "sfml/weapon.frag");          // once at startup
//   ...
//   fx.drawDie   (window, {x,y}, 48.f, 20, dogmax::diceColor(20));   // a d20
//   fx.drawWeapon(window, {x,y}, 48.f, dogmax::WeaponId::Warhammer,
//                                       dogmax::weaponColor(dogmax::WeaponId::Warhammer));
//
// The VALUE on a die (the rolled face number) is your own sf::Text drawn on
// top — the shader only paints the gem.
// ============================================================================
#pragma once
#include <SFML/Graphics.hpp>
#include <array>
#include <cstdint>

namespace dogmax {

// ---- helper: 0..255 triple -> sf::Glsl::Vec3 (0..1) ----
inline sf::Glsl::Vec3 rgb(float r, float g, float b) { return {r / 255.f, g / 255.f, b / 255.f}; }

// ---------------------------------------------------------------- dice ------
// face counts in drop order (dice.config)
inline constexpr std::array<int, 10> kDiceFaces = {4, 6, 8, 12, 20, 24, 30, 42, 60, 100};

// signature hue per die (dice.config DICE_COLOR_*)
inline sf::Glsl::Vec3 diceColor(int faces) {
    switch (faces) {
        case 4:   return rgb(255,  70,  70);
        case 6:   return rgb(240, 200,  70);
        case 8:   return rgb( 80, 220, 240);
        case 12:  return rgb( 80, 240, 120);
        case 20:  return rgb( 80, 140, 255);
        case 24:  return rgb(255,  80, 220);
        case 30:  return rgb(180,  80, 240);
        case 42:  return rgb(255, 160,  40);
        case 60:  return rgb(255, 130, 200);
        case 100: return rgb(240, 240, 240);  // apex die ignores u_color (2-tone in-shader)
        default:  return rgb(200, 200, 220);
    }
}

// face count -> u_sides for die.frag (polygon sides; 0 = d100 prism)
inline float diceSides(int faces) {
    switch (faces) {
        case 4:   return 3.f;
        case 6:   return 4.f;
        case 8:   return 4.f;   // diamond
        case 12:  return 5.f;
        case 20:  return 6.f;
        case 24:  return 6.f;
        case 30:  return 7.f;
        case 42:  return 8.f;
        case 60:  return 8.f;
        case 100: return 0.f;   // apex prism
        default:  return 6.f;
    }
}

// per-die point-up rotation tweak (radians). 0 is fine for all; the diamond
// (d8) reads nicer with a vertex up, handled by the polygon fold already.
inline float diceRotation(int /*faces*/) { return 0.f; }

// ---------------------------------------------------------------- weapons ---
enum class WeaponId : int {
    Pitchfork = 0, Sword, LongSword, GreatSword, Halberd, Quarterstaff,
    Knives, Dagger, Mace, Warhammer, SmallAxe, BigAxe
};

// outline hue per archetype (weapon.config *_OUTLINE_*)
inline sf::Glsl::Vec3 weaponColor(WeaponId w) {
    switch (w) {
        case WeaponId::Pitchfork:    return rgb(255,  70,  10);
        case WeaponId::Sword:        return rgb(240, 220,  70);
        case WeaponId::LongSword:    return rgb( 80, 220, 240);
        case WeaponId::GreatSword:   return rgb(180,  80, 240);
        case WeaponId::Halberd:      return rgb(255, 170,  50);
        case WeaponId::Quarterstaff: return rgb( 80, 180, 255);
        case WeaponId::Knives:       return rgb(255, 240,  80);
        case WeaponId::Dagger:       return rgb(240,  40,  70);
        case WeaponId::Mace:         return rgb(200, 130,  60);
        case WeaponId::Warhammer:    return rgb(220, 220, 235);
        case WeaponId::SmallAxe:     return rgb( 80, 220, 120);
        case WeaponId::BigAxe:       return rgb(220,  40,  40);
    }
    return rgb(220, 220, 235);
}

// ---------------------------------------------------------------- tiers -----
// quality.config QUALITY_TIER_* — use for slot frames / auras around an icon.
inline sf::Glsl::Vec3 tierCommon()   { return rgb(180, 180, 200); }
inline sf::Glsl::Vec3 tierUncommon() { return rgb( 80, 200, 255); }
inline sf::Glsl::Vec3 tierRare()     { return rgb(255, 215,  50); }

// ---------------------------------------------------------------- enemies ---
enum class EnemyId : int {
    Base = 0, Shocker, Glasswraith, Hexarchon, Sentinel, Voidcrawler, PactWalker
};

// outline hue per enemy (enemy.config / special-enemy visuals)
inline sf::Glsl::Vec3 enemyColor(EnemyId e) {
    switch (e) {
        case EnemyId::Base:        return rgb(200,  40, 100);   // magenta shard
        case EnemyId::Shocker:     return rgb(200, 245, 255);   // white-cyan
        case EnemyId::Glasswraith: return rgb( 80, 220, 255);   // glass cyan
        case EnemyId::Hexarchon:   return rgb(180,  80, 240);   // violet sigil
        case EnemyId::Sentinel:    return rgb( 80, 230, 255);   // guardian cyan
        case EnemyId::Voidcrawler: return rgb( 80, 230, 255);   // cyan eye
        case EnemyId::PactWalker:  return rgb(255, 215,  80);   // gold filigree
    }
    return rgb(200, 40, 100);
}

// ============================================================================
// ShapeShaders — loads the two fragment shaders and draws them over a quad.
//
// The "no image" trick: SFML's default vertex shader writes gl_TexCoord[0]
// from the drawable's texCoords. We bind a 1x1 white texture and a texRect
// equal to the quad's pixel size, so gl_TexCoord[0].xy runs 0..size and the
// shaders normalise it by u_resolution. The texture's RGBA is never sampled.
// ============================================================================
class ShapeShaders {
public:
    bool load(const std::string& dieFrag, const std::string& weaponFrag,
              const std::string& enemyFrag = "", const std::string& slotFrag = "") {
        // 1x1 white pixel — only used to make SFML emit texCoords.
        sf::Image px;
        px.resize({1, 1}, sf::Color::White);
        if (!m_white.loadFromImage(px)) return false;
        m_white.setRepeated(true);
        if (!m_die.loadFromFile(dieFrag, sf::Shader::Type::Fragment)) return false;
        if (!m_weapon.loadFromFile(weaponFrag, sf::Shader::Type::Fragment)) return false;
        if (!enemyFrag.empty()) {
            if (!m_enemy.loadFromFile(enemyFrag, sf::Shader::Type::Fragment)) return false;
            m_hasEnemy = true;
        }
        if (!slotFrag.empty()) {
            if (!m_slot.loadFromFile(slotFrag, sf::Shader::Type::Fragment)) return false;
            m_hasSlot = true;
        }
        return true;
    }

    // Draw a die gem centred at `pos`, `size` px wide/tall.
    void drawDie(sf::RenderTarget& rt, sf::Vector2f pos, float size, int faces,
                 sf::Glsl::Vec3 color, float charged = 0.f,
                 sf::BlendMode blend = sf::BlendAlpha) {
        m_die.setUniform("u_resolution", sf::Glsl::Vec2(size, size));
        m_die.setUniform("u_color", color);
        m_die.setUniform("u_sides", diceSides(faces));
        m_die.setUniform("u_rotation", diceRotation(faces));
        m_die.setUniform("u_charged", charged);
        drawQuad(rt, pos, size, m_die, blend);
    }

    // Draw a weapon silhouette centred at `pos`, `size` px wide/tall.
    void drawWeapon(sf::RenderTarget& rt, sf::Vector2f pos, float size, WeaponId w,
                    sf::Glsl::Vec3 color, float charged = 0.f,
                    sf::BlendMode blend = sf::BlendAlpha) {
        m_weapon.setUniform("u_resolution", sf::Glsl::Vec2(size, size));
        m_weapon.setUniform("u_color", color);
        m_weapon.setUniform("u_weapon", static_cast<float>(static_cast<int>(w)));
        m_weapon.setUniform("u_charged", charged);
        drawQuad(rt, pos, size, m_weapon, blend);
    }

    sf::Shader& dieShader()    { return m_die; }
    sf::Shader& weaponShader() { return m_weapon; }
    sf::Shader& enemyShader()  { return m_enemy; }
    sf::Shader& slotShader()   { return m_slot; }

    // Draw an inventory slot plate (chamfered tier-frame) centred at `pos`.
    // For a tall weapon slot pass a non-square `size`.
    void drawSlot(sf::RenderTarget& rt, sf::Vector2f pos, sf::Vector2f size,
                  sf::Glsl::Vec3 tier, bool selected = false, bool empty = false,
                  sf::BlendMode blend = sf::BlendAlpha) {
        m_slot.setUniform("u_resolution", sf::Glsl::Vec2(size.x, size.y));
        m_slot.setUniform("u_color", tier);
        m_slot.setUniform("u_selected", selected ? 1.f : 0.f);
        m_slot.setUniform("u_empty", empty ? 1.f : 0.f);
        sf::RectangleShape quad(size);
        quad.setOrigin({size.x * 0.5f, size.y * 0.5f});
        quad.setPosition(pos);
        quad.setTexture(&m_white);
        quad.setTextureRect(sf::IntRect({0, 0}, {static_cast<int>(size.x), static_cast<int>(size.y)}));
        sf::RenderStates st; st.shader = &m_slot; st.blendMode = blend;
        rt.draw(quad, st);
    }

    // Draw an enemy silhouette centred at `pos`, `size` px wide/tall.
    // `charged` (0..1) drives the wind-up cyan-flash + thicker stroke.
    void drawEnemy(sf::RenderTarget& rt, sf::Vector2f pos, float size, EnemyId e,
                   sf::Glsl::Vec3 color, float charged = 0.f,
                   sf::BlendMode blend = sf::BlendAlpha) {
        m_enemy.setUniform("u_resolution", sf::Glsl::Vec2(size, size));
        m_enemy.setUniform("u_color", color);
        m_enemy.setUniform("u_enemy", static_cast<float>(static_cast<int>(e)));
        m_enemy.setUniform("u_charged", charged);
        drawQuad(rt, pos, size, m_enemy, blend);
    }

private:
    void drawQuad(sf::RenderTarget& rt, sf::Vector2f pos, float size,
                  sf::Shader& shader, sf::BlendMode blend) {
        sf::RectangleShape quad({size, size});
        quad.setOrigin({size * 0.5f, size * 0.5f});   // centre on pos
        quad.setPosition(pos);
        quad.setTexture(&m_white);
        quad.setTextureRect(sf::IntRect({0, 0}, {static_cast<int>(size), static_cast<int>(size)}));
        sf::RenderStates states;
        states.shader = &shader;
        states.blendMode = blend;   // BlendAlpha (default) or sf::BlendAdd for hotter neon
        rt.draw(quad, states);
    }

    sf::Texture m_white;
    sf::Shader  m_die;
    sf::Shader  m_weapon;
    sf::Shader  m_enemy;
    sf::Shader  m_slot;
    bool        m_hasEnemy = false;
    bool        m_hasSlot = false;
};

} // namespace dogmax
