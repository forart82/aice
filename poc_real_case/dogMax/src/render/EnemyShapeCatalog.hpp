#pragma once

#include <SFML/System/Vector2.hpp>

#include <string>
#include <vector>

namespace dof::loaders { class ConfigLoader; }

namespace dof::render {

// Minimalist abstract silhouette families. Every form is built from STRAIGHT
// edges and is symmetric by construction — radial forms (Polygon / Star /
// Cross) have exact rotational symmetry; bilateral forms (the rest) are built
// as a right half and mirrored about the vertical axis. No wavy organic
// curves: each shape is a clean, instantly-readable abstract glyph.
enum class ShapeForm {
    Polygon,    // regular N-gon (triangle, diamond, pentagon, hexagon, octagon)
    Star,       // crisp N-point star (outer/inner radius alternation)
    Cross,      // plus / cross (4 arms)
    Arrow,      // arrowhead with a notched tail
    Kite,       // elongated diamond
    Shield,     // flat top, pointed bottom
    Wedge,      // trapezoid
    Hourglass,  // two triangles meeting at a thin neck (bowtie)
    Drop,       // teardrop with straight flanks to a point
    Lens,       // pointed oval / eye
    Gem,        // faceted cut-stone (flat top facet, shoulders, point)
};

// One silhouette spec, loaded from enemy_shapes.yaml. Carries no geometry; the
// builder turns it into a closed polygon. `count` reads as side/point count
// (Polygon/Star). `inner` is the star inner-radius ratio / cross arm thickness.
// `aspect` stretches a bilateral form vertically (1 = none; radial forms ignore
// it so their rotational symmetry stays exact). `coreRadius` draws an accent
// core/eye (0 = none).
struct EnemyShapeSpec {
    std::string name;
    ShapeForm   form{ShapeForm::Polygon};
    int         count{4};
    float       inner{0.45f};
    float       aspect{1.0f};
    float       rotationDegrees{0.0f};
    float       coreRadius{0.0f};
};

// Parse a form name string ("polygon", "star", etc.) into ShapeForm.
// Falls back to Polygon on unknown input.
ShapeForm parseShapeForm(const std::string& name);

// Rotational symmetry order of a radial form (Polygon/Star/Cross), or 0 for
// bilateral forms. Exposed so the unit test can assert symmetry generically.
int shapeRotationalOrder(const EnemyShapeSpec& spec);

// Builds the closed outline for `spec` scaled to `radius`, centred on the
// origin, walking the perimeter once. SINGLE SOURCE OF TRUTH: the gallery and
// the future live-enemy painter both call this. Declared symmetry holds by
// construction (see the .cpp).
std::vector<sf::Vector2f> buildEnemyShapeOutline(const EnemyShapeSpec& spec,
                                                 float radius);

// Loads all ENEMY_SHAPE_COUNT specs (SHAPE_NN_*) from the live config.
std::vector<EnemyShapeSpec> loadEnemyShapeCatalog(const dof::loaders::ConfigLoader& config);

} // namespace dof::render
