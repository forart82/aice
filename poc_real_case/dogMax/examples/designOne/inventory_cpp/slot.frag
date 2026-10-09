// ============================================================================
// DogMax — procedural INVENTORY SLOT frame (fragment shader, SFML 3.0 / GLSL).
// A chamfered neon slot plate for the inventory grid + powder column. NO image
// assets: tier-tinted fill, glowing chamfered edge and a corner tier-tab are
// computed in-shader so it bloom-matches the rest of the neon UI. Slot CONTENTS
// (a weapon / dice silhouette) are drawn on top with weapon.frag / die.frag.
//
// Uniforms (see dogmax_shapes.hpp helper):
//   u_resolution : vec2  slot size in px
//   u_color      : vec3  tier hue 0..1 (tierCommon / tierUncommon / tierRare)
//   u_selected   : float 0 normal … 1 selected (brighter fill + edge)
//   u_empty      : float 0 filled slot … 1 empty (dashed + dimmer)
// ============================================================================

uniform vec2  u_resolution;
uniform vec3  u_color;
uniform float u_selected;
uniform float u_empty;

// chamfered-rect SDF: top-left + bottom-right corners cut (matches kit clipPath)
float sdChamfer(vec2 p, vec2 b, float c) {
    vec2 d = abs(p) - b;
    float box = min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
    float cutTL = (-p.x - p.y) - (b.x + b.y - c);   // top-left
    float cutBR = ( p.x + p.y) - (b.x + b.y - c);   // bottom-right
    return max(box, max(cutTL, cutBR) * 0.7071);
}

void main() {
    vec2 uv = gl_TexCoord[0].xy / u_resolution;
    vec2 p  = (uv - 0.5) * 2.0;
    float d  = sdChamfer(p, vec2(0.9), 0.34);
    float aa = fwidth(d) + 0.001;
    float sel = u_selected;

    float inside = 1.0 - smoothstep(-aa, aa, d);
    float fillA  = (0.06 + sel * 0.16) * inside;

    float sw   = 0.045 + sel * 0.02;
    float edge = 1.0 - smoothstep(sw - aa, sw + aa, abs(d));
    // dashed edge for empty slots
    if (u_empty > 0.5) {
        float ang = atan(p.y, p.x);
        edge *= step(0.5, fract(ang * 3.8));
    }
    float glow = exp(-max(d, 0.0) * 9.0) * (0.35 + sel * 0.4) * (1.0 - u_empty * 0.6);

    // corner tier-tab: a small bright wedge at the top-left corner
    float tab = smoothstep(0.0, 0.16, (-p.x - p.y) - 1.32);

    vec3 col = u_color;
    vec3 outc = mix(col, vec3(1.0), edge * 0.5);
    outc += col * glow * 0.7;
    outc = mix(outc, col * 1.3 + 0.15, tab * 0.85);

    float a = clamp(max(edge, glow) + fillA, 0.0, 1.0);
    a = max(a, tab * 0.9);
    a *= (u_empty > 0.5 ? 0.7 : 1.0);
    gl_FragColor = vec4(outc, a);
}
