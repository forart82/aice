// ============================================================================
// DogMax — INVENTORY example (SFML 3.0).
//
// Composes the kit's 56-place inventory straight from the procedural shaders —
// NO image assets. A LEFT powder column (three tier "destroy → powder" buttons
// + the 11-colour powder stash) and a unified 7×8 = 56 slot grid where a WEAPON
// fills a tall 2-row slot and a DICE a single slot. Slot plates come from
// slot.frag (drawSlot); their contents from weapon.frag / die.frag.
//
// Build (desktop GLSL, SFML 3.0):
//   g++ -std=c++17 inventory_example.cpp -o inventory \
//       -lsfml-graphics -lsfml-window -lsfml-system
//   ./inventory   # needs die.frag, weapon.frag, enemy.frag, slot.frag + a .ttf
// ============================================================================
#include "dogmax_shapes.hpp"
#include <array>
#include <optional>
#include <string>
#include <vector>

namespace dogmax {

enum class Tier { Common, Uncommon, Rare };
inline sf::Glsl::Vec3 tierVec(Tier t) { return t == Tier::Rare ? tierRare() : t == Tier::Uncommon ? tierUncommon() : tierCommon(); }
inline sf::Color tierCol(Tier t) { auto v = tierVec(t); return sf::Color(uint8_t(v.x * 255), uint8_t(v.y * 255), uint8_t(v.z * 255)); }

// one inventory entry
struct Item {
    enum Kind { Weapon, Dice, Empty } kind;
    WeaponId weapon{}; int faces{}; int count{};
    Tier tier = Tier::Common; bool equipped = false; bool selected = false;
};
inline Item W(WeaponId w, Tier t, bool eq = false, bool sel = false) { return { Item::Weapon, w, 0, 0, t, eq, sel }; }
inline Item D(int f, Tier t, int n) { return { Item::Dice, {}, f, n, t, false, false }; }
inline Item E() { return { Item::Empty, {}, 0, 0, Tier::Common, false, false }; }

inline void text(sf::RenderTarget& rt, const sf::Font& f, const std::string& s, sf::Vector2f p, unsigned px, sf::Color c, bool center = false) {
    sf::Text t(f, s, px); t.setFillColor(c);
    if (center) { auto b = t.getLocalBounds(); t.setOrigin({ b.position.x + b.size.x * 0.5f, b.position.y + b.size.y * 0.5f }); }
    t.setPosition(p); rt.draw(t);
}

} // namespace dogmax

int main() {
    using namespace dogmax;
    sf::RenderWindow window(sf::VideoMode({ 620u, 560u }), "DogMax — Inventory");
    window.setFramerateLimit(60);

    ShapeShaders fx;
    if (!fx.load("die.frag", "weapon.frag", "enemy.frag", "slot.frag")) return -1;
    sf::Font font;
    if (!font.openFromFile("JetBrainsMono-Bold.ttf")) return -1;

    using WI = WeaponId;
    // column-major: each column = 1 weapon (rows 1-2) + 6 single cells (8 rows)
    auto col = [](Item w, std::vector<Item> rest) { std::vector<Item> c{ w }; for (auto& r : rest) c.push_back(r); while (c.size() < 7) c.push_back(E()); return c; };
    std::vector<std::vector<Item>> cols = {
        col(W(WI::Warhammer, Tier::Rare, true, true), { D(20, Tier::Rare, 3), D(6, Tier::Common, 7), D(4, Tier::Common, 9), D(8, Tier::Uncommon, 5), D(12, Tier::Uncommon, 4), D(24, Tier::Rare, 2) }),
        col(W(WI::BigAxe, Tier::Uncommon, true), { D(30, Tier::Uncommon, 2), D(42, Tier::Rare, 1), D(60, Tier::Uncommon, 1), D(100, Tier::Rare, 1) }),
        col(W(WI::GreatSword, Tier::Uncommon), {}),
        col(W(WI::LongSword, Tier::Rare, true), {}),
        col(W(WI::Mace, Tier::Common), {}),
        col(W(WI::Dagger, Tier::Uncommon), {}),
        col(W(WI::Halberd, Tier::Common), {}),
    };

    // powder stash — all 11 powders (10 dice colours + black weapon powder)
    struct Pow { sf::Color c; const char* name; int n; };
    std::array<Pow, 11> stash = {{
        {{255,70,70},"RED",240}, {{240,200,70},"YELLOW",180}, {{80,220,240},"CYAN",70}, {{80,240,120},"GREEN",60},
        {{80,140,255},"BLUE",95}, {{255,80,220},"MAGENTA",45}, {{180,80,240},"PURPLE",30}, {{255,160,40},"ORANGE",18},
        {{255,130,200},"PINK",22}, {{240,240,240},"WHITE",12}, {{44,44,52},"BLACK",31},
    }};

    const float PX = 18, PY = 64, COLW = 50, ROWH = 50, GAP = 6, LEFTW = 150;
    const float gridX = PX + LEFTW + 14;

    while (window.isOpen()) {
        while (const std::optional<sf::Event> e = window.pollEvent())
            if (e->is<sf::Event::Closed>()) window.close();

        window.clear({ 9, 11, 17 });
        text(window, font, "INVENTORY", { PX, 22 }, 14, sf::Color(80, 230, 255));

        // ---- powder column ----
        text(window, font, "DESTROY -> POWDER", { PX, PY }, 8, sf::Color(110, 130, 150));
        const char* tn[3] = { "COMMON", "UNCOMMON", "RARE" };
        Tier tt[3] = { Tier::Common, Tier::Uncommon, Tier::Rare };
        int dcount[3] = { 3, 6, 4 };
        for (int i = 0; i < 3; ++i) {
            float by = PY + 16 + i * 34;
            fx.drawSlot(window, { PX + LEFTW / 2, by + 13 }, { LEFTW, 28 }, tierVec(tt[i]), false, false);
            text(window, font, tn[i], { PX + 12, by + 4 }, 9, tierCol(tt[i]));
            text(window, font, "x" + std::to_string(dcount[i]), { PX + LEFTW - 30, by + 6 }, 9, sf::Color(150, 165, 180));
        }
        int total = 0; for (auto& p : stash) total += p.n;
        text(window, font, "POWDER", { PX, PY + 126 }, 8, sf::Color(150, 165, 180));
        text(window, font, std::to_string(total), { PX + LEFTW - 34, PY + 124 }, 9, sf::Color::White);
        for (size_t i = 0; i < stash.size(); ++i) {
            float ry = PY + 142 + i * 16;
            sf::CircleShape dot(5, 4); dot.setOrigin({ 5, 5 }); dot.setRotation(sf::degrees(45));
            dot.setPosition({ PX + 7, ry + 5 }); dot.setFillColor(stash[i].c); window.draw(dot);
            text(window, font, stash[i].name, { PX + 18, ry }, 7, sf::Color(150, 165, 180));
            text(window, font, std::to_string(stash[i].n), { PX + LEFTW - 30, ry }, 8, sf::Color(210, 216, 230));
        }

        // ---- 7×8 grid ----
        for (size_t c = 0; c < cols.size(); ++c) {
            float cx = gridX + c * (COLW + GAP) + COLW / 2;
            int row = 0;
            for (auto& it : cols[c]) {
                bool weap = it.kind == Item::Weapon;
                float h = weap ? (ROWH * 2 + GAP) : ROWH;
                float cy = PY + row * (ROWH + GAP) + h / 2;
                if (it.kind == Item::Empty) {
                    fx.drawSlot(window, { cx, cy }, { COLW, ROWH }, tierCol(Tier::Common) == sf::Color() ? tierVec(Tier::Common) : tierVec(Tier::Common), false, true);
                } else {
                    fx.drawSlot(window, { cx, cy }, { COLW, h }, tierVec(it.tier), it.selected, false);
                    if (weap) fx.drawWeapon(window, { cx, cy }, 34, it.weapon, weaponColor(it.weapon));
                    else {
                        fx.drawDie(window, { cx, cy }, 34, it.faces, diceColor(it.faces));
                        text(window, font, "x" + std::to_string(it.count), { cx + COLW / 2 - 16, cy + ROWH / 2 - 14 }, 8, sf::Color::White);
                    }
                }
                row += weap ? 2 : 1;
            }
        }
        window.display();
    }
    return 0;
}
