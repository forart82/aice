// ============================================================================
// DogMax — procedural PANEL chrome (fragment shader, SFML 3.0 / GLSL).
// The chamfered neon panel frame used by the Inventory, Sidebar, tooltips, etc.
// NO image assets: chamfered edge (top-left + bottom-right corners cut), faint
// inner fill, a brighter title strip across the top, and L-shaped corner
// brackets — all computed in-shader so it bloom-matches the UI.
//
// Uniforms (see dogmax_shapes.hpp helper drawPanel):
//   u_resolution : vec2  panel size in px
//   u_color      : vec3  accent hue 0..1 (usually cyan tier/accent)
// ============================================================================
uniform vec2  u_resolution;
uniform vec3  u_color;

float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }

void main() {
    vec2 uv = gl_TexCoord[0].xy / u_resolution;
    vec2 P  = (uv - 0.5) * u_resolution;          // centred pixel coords
    vec2 B  = u_resolution * 0.5 - 2.0;
    float ch = 14.0;                              // chamfer size (px)
    float box   = sdBox(P, B);
    float cutTL = (-P.x - P.y) - (B.x + B.y - ch);
    float cutBR = ( P.x + P.y) - (B.x + B.y - ch);
    float d = max(box, max(cutTL, cutBR) * 0.7071);
    float aa = fwidth(d) + 0.001;

    float inside = 1.0 - smoothstep(-aa, aa, d);
    float edge   = 1.0 - smoothstep(1.5 - aa, 1.5 + aa, abs(d));
    float glow   = exp(-max(d, 0.0) * 0.06) * 0.35;

    // title strip across the top ~26px
    float titleBar = inside * smoothstep(0.0, 2.0, (P.y + B.y) ) * (1.0 - smoothstep(24.0, 28.0, P.y + B.y));

    // L-brackets at the two square corners (TR & BL)
    float legLen = 16.0, legTh = 2.0;
    float trH = step(B.x - legLen, P.x) * step(abs(P.y + B.y), legTh);
    float trV = step(abs(P.x - B.x), legTh) * step(P.y, -B.y + legLen);
    float blH = step(P.x, -B.x + legLen) * step(abs(P.y - B.y), legTh);
    float blV = step(abs(P.x + B.x), legTh) * step(B.y - legLen, P.y);
    float bracket = clamp(trH + trV + blH + blV, 0.0, 1.0) * inside;

    vec3 col = u_color;
    vec3 o = mix(col * 0.5, col, edge);
    o += col * glow;
    o = mix(o, col * 1.3 + 0.1, bracket);
    float fillA = inside * 0.05 + titleBar * 0.10;
    float a = clamp(max(max(edge, glow), bracket) + fillA, 0.0, 1.0);
    gl_FragColor = vec4(o, a);
}
