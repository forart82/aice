// ============================================================================
// DogMax — ENEMIES example (SFML 3.0).
//
// Draws every enemy straight from the procedural shader in dogmax_shapes.hpp —
// NO image assets. Shows the base enemy across the three quality tiers (size +
// outline scale with rarity, drawn with a rotated-diamond aura frame), the
// wind-up telegraph state, and the six special enemies in a labelled grid.
//
// Build (desktop GLSL, SFML 3.0):
//   g++ -std=c++17 enemy_example.cpp -o enemies \
//       -lsfml-graphics -lsfml-window -lsfml-system
//   ./enemies        # needs die.frag, weapon.frag, enemy.frag, and a .ttf
// ============================================================================
#include "dogmax_shapes.hpp"
#include <array>
#include <optional>
#include <string>

namespace dogmax {

// rotated-diamond tier frame + soft aura around an enemy body (kit's EnemyBody).
inline void drawTierFrame(sf::RenderTarget& rt, sf::Vector2f pos, float size,
                          sf::Color tier, float auraMult) {
    // aura: a faint additive glow disc
    sf::CircleShape aura(size * 0.6f * auraMult);
    aura.setOrigin({aura.getRadius(), aura.getRadius()});
    aura.setPosition(pos);
    aura.setFillColor({tier.r, tier.g, tier.b, 28});
    rt.draw(aura, sf::RenderStates{sf::BlendAdd});
    // diamond frame
    sf::RectangleShape diamond({size * 0.96f, size * 0.96f});
    diamond.setOrigin({size * 0.48f, size * 0.48f});
    diamond.setPosition(pos);
    diamond.setRotation(sf::degrees(45.f));
    diamond.setFillColor(sf::Color::Transparent);
    diamond.setOutlineThickness(1.f);
    diamond.setOutlineColor({tier.r, tier.g, tier.b, 170});
    rt.draw(diamond);
}

inline void label(sf::RenderTarget& rt, const sf::Font& font, const std::string& s,
                  sf::Vector2f center, unsigned px, sf::Color col) {
    sf::Text t(font, s, px);
    t.setFillColor(col);
    t.setLetterSpacing(1.6f);
    auto b = t.getLocalBounds();
    t.setOrigin({b.position.x + b.size.x * 0.5f, b.position.y + b.size.y * 0.5f});
    t.setPosition(center);
    rt.draw(t);
}

} // namespace dogmax

int main() {
    using namespace dogmax;
    sf::RenderWindow window(sf::VideoMode({900u, 620u}), "DogMax — Enemies");
    window.setFramerateLimit(60);

    ShapeShaders fx;
    if (!fx.load("die.frag", "weapon.frag", "enemy.frag")) return -1;

    sf::Font font;
    if (!font.openFromFile("JetBrainsMono-Bold.ttf")) return -1;

    const sf::Color magenta{200, 40, 100}, dim{120, 110, 130}, cyan{80, 230, 255};
    float t = 0.f;

    while (window.isOpen()) {
        while (const std::optional<sf::Event> e = window.pollEvent())
            if (e->is<sf::Event::Closed>()) window.close();
        t += 1.f / 60.f;
        float pulse = 0.5f + 0.5f * std::sin(t * 3.f);   // wind-up telegraph

        window.clear({10, 7, 13});

        // ---- standard enemy · quality tiers ----
        label(window, font, "STANDARD ENEMY  -  QUALITY TIERS", {220.f, 30.f}, 12, cyan);
        struct TierDef { const char* name; float size; float aura; sf::Color col; };
        std::array<TierDef, 3> tiers = {{
            {"COMMON",   56.f, 1.0f, sf::Color{180,180,200}},
            {"UNCOMMON", 70.f, 1.4f, sf::Color{ 80,200,255}},
            {"RARE",     88.f, 2.0f, sf::Color{255,215, 50}},
        }};
        float tx = 130.f;
        for (auto& td : tiers) {
            sf::Vector2f c{tx, 130.f};
            drawTierFrame(window, c, td.size, td.col, td.aura);
            fx.drawEnemy(window, c, td.size, EnemyId::Base, enemyColor(EnemyId::Base));
            label(window, font, td.name, {tx, 200.f}, 10, td.col);
            tx += 150.f;
        }

        // ---- wind-up state (cyan telegraph) ----
        label(window, font, "WIND-UP", {640.f, 90.f}, 10, cyan);
        fx.drawEnemy(window, {640.f, 130.f}, 70.f, EnemyId::Base, enemyColor(EnemyId::Base), pulse);

        // ---- special enemies grid ----
        label(window, font, "SPECIAL ENEMIES", {180.f, 270.f}, 12, magenta);
        struct Sp { EnemyId id; const char* name; };
        std::array<Sp, 6> specials = {{
            {EnemyId::Shocker,     "SHOCKER"},
            {EnemyId::Glasswraith, "GLASSWRAITH"},
            {EnemyId::Hexarchon,   "HEXARCHON"},
            {EnemyId::Sentinel,    "SENTINEL"},
            {EnemyId::Voidcrawler, "VOIDCRAWLER"},
            {EnemyId::PactWalker,  "PACT-WALKER"},
        }};
        for (int i = 0; i < 6; ++i) {
            float gx = 130.f + (i % 3) * 250.f;
            float gy = 360.f + (i / 3) * 130.f;
            fx.drawEnemy(window, {gx, gy}, 72.f, specials[i].id, enemyColor(specials[i].id));
            label(window, font, specials[i].name, {gx, gy + 58.f}, 9, dim);
        }

        window.display();
    }
    return 0;
}
