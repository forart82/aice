// ============================================================================
// DogMax — WEAPON-SLOT SIDEBAR example (SFML 3.0).
//
// Composes the kit's "weapon slot row" 1:1 from the procedural shaders in
// dogmax_shapes.hpp — NO image assets. Each row mirrors the HTML `WeaponRow`
// body, left → right:
//
//   ① tier strip   ② weapon zone (glyph + name + Lv)
//   ③ dice zone (up to SIX dice on a SINGLE row)   + ④ charge bar
//   ⑤ dron / ready flag
//
// Build (desktop GLSL, SFML 3.0):
//   g++ -std=c++17 sidebar_example.cpp -o sidebar \
//       -lsfml-graphics -lsfml-window -lsfml-system
//   ./sidebar        # needs die.frag, weapon.frag, and a .ttf beside it
// ============================================================================
#include "dogmax_shapes.hpp"
#include <optional>
#include <string>
#include <vector>

namespace dogmax {

// ----------------------------------------------------------------- tiers ----
enum class Tier { Common, Uncommon, Rare };
inline sf::Color tierColor(Tier t) {
    switch (t) {
        case Tier::Rare:     return {255, 215, 50};
        case Tier::Uncommon: return { 80, 200, 255};
        default:             return {180, 180, 200};
    }
}

// a slotted die: face count + (optional) rolled value; std::nullopt = empty cell
struct Slot { int faces = 0; std::optional<int> value; bool empty = false; };

// one equipped weapon row
struct SlotRow {
    WeaponId    weapon;
    Tier        tier;
    int         level     = 1;
    std::string name;
    int         slotCount = 6;            // total cells (drawn even when empty)
    std::vector<Slot> dice;               // filled/empty cells, size <= slotCount
    int         dronMult  = 1;            // >1 shows a gold ×mult flag
    std::string dronLabel;                // e.g. "HEXADRON"
    sf::Color   dronColor = {255, 215, 80};
    float       charge    = 0.4f;         // 0..1 cooldown/charge bar
    bool        ready     = false;        // gold highlight + charged dice
    bool        selected  = false;        // cyan selection border
};

// chamfered rectangle (top-left + bottom-right cut) matching the kit clipPath.
inline sf::ConvexShape chamferRect(sf::Vector2f pos, sf::Vector2f size, float c) {
    sf::ConvexShape s;
    s.setPointCount(6);
    s.setPoint(0, {0.f,            0.f});
    s.setPoint(1, {size.x,         0.f});
    s.setPoint(2, {size.x,         size.y});
    s.setPoint(3, {c,              size.y});
    s.setPoint(4, {0.f,            size.y - c});
    s.setPoint(5, {0.f,            0.f});
    s.setPosition(pos);
    return s;
}

// Draw ONE weapon-slot row at `pos`, `width` px wide (height fixed at 78).
inline void drawWeaponSlotRow(sf::RenderTarget& rt, ShapeShaders& fx,
                              const sf::Font& font, sf::Vector2f pos,
                              float width, const SlotRow& row) {
    constexpr float H = 78.f, TIER_W = 6.f, WEAPON_W = 78.f, DRON_W = 56.f;
    constexpr float GAP = 3.f, DPAD = 12.f;
    const sf::Color cyan{80, 230, 255}, gold{255, 215, 80}, ink{210, 215, 235}, dim{120, 135, 150};

    // ---- row body (background + border) ----
    sf::Color bg     = row.selected ? sf::Color{16, 28, 36} : (row.ready ? sf::Color{26, 24, 12} : sf::Color{10, 12, 18});
    sf::Color border = row.selected ? cyan : (row.ready ? gold : sf::Color{36, 70, 82});
    auto body = chamferRect(pos, {width, H}, 10.f);
    body.setFillColor(bg);
    body.setOutlineThickness(1.f);
    body.setOutlineColor(border);
    rt.draw(body);

    // ---- ① tier strip ----
    sf::RectangleShape strip({TIER_W, H});
    strip.setPosition(pos);
    strip.setFillColor(tierColor(row.tier));
    rt.draw(strip);

    // ---- ② weapon zone: glyph + name + level ----
    float wzX = pos.x + TIER_W;
    fx.drawWeapon(rt, {wzX + WEAPON_W * 0.5f, pos.y + 26.f}, 30.f, row.weapon,
                  weaponColor(row.weapon), row.ready ? 1.f : 0.f);
    sf::Text nameTxt(font, row.name, 11);
    nameTxt.setFillColor(ink);
    nameTxt.setPosition({wzX + 6.f, pos.y + 44.f});
    rt.draw(nameTxt);
    sf::Text lvTxt(font, "LV " + std::to_string(row.level), 9);
    lvTxt.setFillColor(dim);
    lvTxt.setPosition({wzX + 6.f, pos.y + 60.f});
    rt.draw(lvTxt);

    // divider after weapon zone
    sf::RectangleShape divL({1.f, H});
    divL.setPosition({wzX + WEAPON_W, pos.y});
    divL.setFillColor({80, 230, 255, 26});
    rt.draw(divL);

    // ---- ③ dice zone: six cells on a SINGLE row ----
    float dzX = wzX + WEAPON_W;
    float dzW = width - TIER_W - WEAPON_W - DRON_W;
    float diceSize = std::max(15.f, std::min(30.f, std::floor((dzW - DPAD - 5.f * GAP) / 6.f)));
    float startX = dzX + 6.f + diceSize * 0.5f;
    float diceY  = pos.y + 30.f;
    for (int i = 0; i < row.slotCount; ++i) {
        float cx = startX + i * (diceSize + GAP);
        bool filled = i < static_cast<int>(row.dice.size()) && !row.dice[i].empty && row.dice[i].faces > 0;
        if (filled) {
            const Slot& s = row.dice[i];
            fx.drawDie(rt, {cx, diceY}, diceSize, s.faces, diceColor(s.faces), row.ready ? 1.f : 0.f);
            if (s.value) {                       // rolled value drawn on top of the gem
                sf::Text v(font, std::to_string(*s.value), static_cast<unsigned>(diceSize * 0.5f));
                v.setFillColor(sf::Color::White);
                auto b = v.getLocalBounds();
                v.setOrigin({b.position.x + b.size.x * 0.5f, b.position.y + b.size.y * 0.5f});
                v.setPosition({cx, diceY});
                rt.draw(v);
            }
        } else {                                  // empty socket
            sf::RectangleShape sock({diceSize - 4.f, diceSize - 4.f});
            sock.setPosition({cx - (diceSize - 4.f) * 0.5f, diceY - (diceSize - 4.f) * 0.5f});
            sock.setFillColor({12, 14, 22});
            sock.setOutlineThickness(1.f);
            sock.setOutlineColor({80, 230, 255, 60});
            rt.draw(sock);
        }
    }

    // ---- ④ charge bar (under the dice) ----
    float barX = dzX + 6.f, barW = dzW - 12.f, barY = pos.y + H - 16.f;
    sf::RectangleShape track({barW, 4.f});
    track.setPosition({barX, barY});
    track.setFillColor({255, 255, 255, 18});
    rt.draw(track);
    sf::RectangleShape fill({barW * std::clamp(row.charge, 0.f, 1.f), 4.f});
    fill.setPosition({barX, barY});
    fill.setFillColor(row.ready ? gold : tierColor(row.tier));
    rt.draw(fill);

    // ---- ⑤ dron / ready flag ----
    float drX = pos.x + width - DRON_W;
    sf::RectangleShape divR({1.f, H});
    divR.setPosition({drX, pos.y});
    divR.setFillColor({80, 230, 255, 26});
    rt.draw(divR);
    if (row.dronMult > 1) {
        sf::Text mult(font, "x" + std::to_string(row.dronMult), 17);
        mult.setFillColor(sf::Color::White);
        auto mb = mult.getLocalBounds();
        mult.setOrigin({mb.position.x + mb.size.x * 0.5f, 0.f});
        mult.setPosition({drX + DRON_W * 0.5f, pos.y + 24.f});
        rt.draw(mult);
        sf::Text lab(font, row.dronLabel, 7);
        lab.setFillColor(row.dronColor);
        auto lb = lab.getLocalBounds();
        lab.setOrigin({lb.position.x + lb.size.x * 0.5f, 0.f});
        lab.setPosition({drX + DRON_W * 0.5f, pos.y + 46.f});
        rt.draw(lab);
    } else {
        sf::Text roll(font, "ROLLING", 7);
        roll.setFillColor(dim);
        roll.setRotation(sf::degrees(90.f));
        roll.setPosition({drX + DRON_W * 0.5f + 4.f, pos.y + 16.f});
        rt.draw(roll);
    }
}

// Draw the full 8-row WEAPON SLOTS sidebar panel at `pos`.
inline void drawWeaponSidebar(sf::RenderTarget& rt, ShapeShaders& fx, const sf::Font& font,
                              sf::Vector2f pos, const std::vector<SlotRow>& rows) {
    constexpr float PANEL_W = 332.f, ROW_W = 300.f, ROW_H = 78.f, GAP = 7.f, PAD = 14.f;
    float panelH = PAD * 2 + 22.f + rows.size() * (ROW_H + GAP);
    auto panel = chamferRect(pos, {PANEL_W, panelH}, 12.f);
    panel.setFillColor({9, 11, 17});
    panel.setOutlineThickness(1.f);
    panel.setOutlineColor({80, 230, 255, 60});
    rt.draw(panel);

    sf::Text title(font, "WEAPON SLOTS", 10);
    title.setFillColor({80, 230, 255});
    title.setLetterSpacing(2.f);
    title.setPosition({pos.x + PAD, pos.y + PAD});
    rt.draw(title);

    float y = pos.y + PAD + 22.f;
    for (const auto& r : rows) {
        drawWeaponSlotRow(rt, fx, font, {pos.x + (PANEL_W - ROW_W) * 0.5f, y}, ROW_W, r);
        y += ROW_H + GAP;
    }
}

} // namespace dogmax

// ----------------------------------------------------------------- demo -----
int main() {
    using namespace dogmax;
    sf::RenderWindow window(sf::VideoMode({420u, 760u}), "DogMax — Weapon Sidebar");
    window.setFramerateLimit(60);

    ShapeShaders fx;
    if (!fx.load("die.frag", "weapon.frag")) return -1;

    sf::Font font;
    if (!font.openFromFile("JetBrainsMono-Bold.ttf")) return -1;   // any mono .ttf

    auto F = [](int f, int v) { return Slot{f, v, false}; };
    auto E = [] { return Slot{0, std::nullopt, true}; };

    std::vector<SlotRow> rows = {
        {WeaponId::Warhammer,    Tier::Rare,     6, "Warhammer",    6, {F(6,5),F(6,5),F(6,5),F(6,5),F(6,5),F(6,5)}, 40, "HEXADRON", {255,215,80},  1.00f, true,  true},
        {WeaponId::BigAxe,       Tier::Uncommon, 4, "Big Axe",      6, {F(8,4),F(8,4),F(8,4),F(12,9),F(12,7),F(20,11)}, 6, "TRIDRON", {240,200,120}, 0.66f, false, false},
        {WeaponId::LongSword,    Tier::Uncommon, 3, "Long Sword",   3, {F(4,3),F(4,3),E()}, 1, "", {}, 0.30f, false, false},
        {WeaponId::Knives,       Tier::Common,   2, "Knives",       5, {F(4,3),F(6,3),F(8,7),F(4,1),F(6,5)}, 2, "DUODRON", {220,150,90}, 0.50f, false, false},
        {WeaponId::Halberd,      Tier::Common,   2, "Halberd",      4, {F(20,14),E(),E(),E()}, 1, "", {}, 0.15f, false, false},
        {WeaponId::Quarterstaff, Tier::Common,   1, "Quarterstaff", 3, {F(20,7),E(),E()}, 1, "", {}, 0.80f, false, false},
        {WeaponId::Dagger,       Tier::Uncommon, 1, "Dagger",       5, {F(4,2),F(4,2),E(),E(),E()}, 1, "", {}, 0.40f, false, false},
        {WeaponId::Pitchfork,    Tier::Common,   1, "Pitchfork",    2, {F(4,3),E()}, 1, "", {}, 0.60f, false, false},
    };

    while (window.isOpen()) {
        while (const std::optional<sf::Event> e = window.pollEvent())
            if (e->is<sf::Event::Closed>()) window.close();

        window.clear({5, 6, 10});
        drawWeaponSidebar(window, fx, font, {44.f, 20.f}, rows);
        window.display();
    }
    return 0;
}
