#pragma once

#include "entities/QualityTier.hpp"
#include "entities/SpecialEnemyKind.hpp"

#include <SFML/Graphics/Color.hpp>

#include <string>
#include <vector>

namespace dof::entities {

// How an attached effect layer is placed/animated relative to its
// owning enemy. The three modes the design tool exposes:
//  - Static: pinned at a fixed offset from the enemy centre.
//  - Orbit:  circles the enemy at a radius with an angular speed.
//  - Popup:  spawns at random offsets within a radius on an interval,
//            each pop living for a short lifetime.
enum class EffectMotion { Static, Orbit, Popup };

// One effect layer attached to an enemy: a shader picked from the
// effect "bibliothek" (loaders::ShaderLoader keys, e.g. "effect_glow")
// drawn relative to the enemy and animated by `motion`. `z` orders the
// layer against the body — z < 0 draws behind the body, z >= 0 in
// front — so the editor can stack layers at different "effect layer
// levels". Every field is authored in the per-enemy YAML; the member
// initialisers here are inert identities for a default-constructed
// struct, never a tuning source (loaders::EnemyTemplateLoader fills
// them from config).
struct EnemyEffectLayer {
    std::string  shaderName;
    EffectMotion motion = EffectMotion::Static;
    int          z       = 0;
    sf::Color    color   = sf::Color::White;
    float        size    = 0.f;  // effect quad radius (px)
    int          variant = 0;
    float        speed   = 1.f;  // shader animation rate (neutral 1)
    float        intensity = 1.f;
    // Static placement.
    float offsetX = 0.f;
    float offsetY = 0.f;
    // Orbit placement.
    float orbitRadius   = 0.f;
    float orbitSpeedDeg = 0.f;  // degrees/second
    float orbitPhaseDeg = 0.f;  // starting angle
    // Popup placement.
    float popupRadius   = 0.f;
    float popupInterval = 1.f;  // seconds between pops
    float popupLifetime = 0.5f; // seconds each pop is alive
};

// A fully-resolved enemy appearance for one quality tier: body shape
// (index into the 60-shape catalog, configs/enemy_shapes.yaml), body
// size (radius px), outline + fill colours, and the stack of attached
// effect layers.
struct EnemyTierDesign {
    int       bodyShape = 0;
    float     bodySize  = 50.f;
    sf::Color outline   = sf::Color::White;
    sf::Color fill      = sf::Color::Black;
    std::vector<EnemyEffectLayer> layers;
};

// A per-type enemy template: stable identity plus one resolved design
// per tier. The loader bakes per-tier override + base inheritance into
// the three EnemyTierDesign members, so `forTier` is a trivial O(1)
// lookup at render time.
struct EnemyTemplate {
    std::string      id;    // stable, matches the file stem
    std::string      name;  // display label for the editor
    SpecialEnemyKind specialKind = SpecialEnemyKind::None;
    EnemyTierDesign  common;
    EnemyTierDesign  uncommon;
    EnemyTierDesign  rare;

    const EnemyTierDesign& forTier(QualityTier tier) const;
};

// Parses the YAML token for an effect motion mode. Throws on an
// unrecognised token so a malformed file fails loudly at load.
EffectMotion parseEffectMotion(const std::string& token);

// Inverse of parseEffectMotion — the canonical YAML token for a mode.
std::string effectMotionToken(EffectMotion motion);

}
