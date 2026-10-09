// ============================================================================
// DogMax — procedural ENEMY silhouette (fragment shader, SFML 3.0 / GLSL).
// No image assets: every enemy is a union of line-segment + circle SDFs,
// ported 1:1 from the kit's neon enemies (64x64 design space). Rendered as a
// glowing neon stroke (translucent body + bright edge) that bloom amplifies.
//
// Coordinates are in the original 64x64 art space; cv() maps them into the
// shader's centered -1..1 quad (x/32 - 1, y/32 - 1), y-down like the art.
//
// Uniforms (see dogmax_shapes.hpp for the helper):
//   u_resolution : vec2  quad size in px
//   u_color      : vec3  outline hue 0..1  (enemyColor)
//   u_enemy      : float enemy id 0..6 (enum in the .hpp):
//                  0 Base 1 Shocker 2 Glasswraith 3 Hexarchon
//                  4 Sentinel 5 Voidcrawler 6 PactWalker
//   u_charged    : float 0..1 (wind-up: thicker stroke + hotter glow)
// ============================================================================

uniform vec2  u_resolution;
uniform vec3  u_color;
uniform float u_enemy;
uniform float u_charged;

float sdSeg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}
vec2 cv(float x, float y) { return vec2(x / 32.0 - 1.0, y / 32.0 - 1.0); }

#define SEG(ax,ay,bx,by) d = min(d, sdSeg(p, cv(ax,ay), cv(bx,by)))
#define CIR(cx,cy,r)     d = min(d, abs(length(p - cv(cx,cy)) - (r)/32.0))

float enemyDist(vec2 p, int e) {
    float d = 1e9;
    if (e == 0) {                 // Base — faceted crystalline shard
        SEG(32,3,47,21); SEG(47,21,42,44); SEG(42,44,32,61); SEG(32,61,22,44); SEG(22,44,17,21); SEG(17,21,32,3);
        SEG(32,3,22,44); SEG(32,3,42,44); SEG(17,21,47,21); SEG(32,3,32,61);   // facets
        SEG(32,21,38,30); SEG(38,30,32,44); SEG(32,44,26,30); SEG(26,30,32,21); // inner core
    } else if (e == 1) {          // Shocker — AOE ring + hex cell + bolt + discharge
        CIR(32,32,28.0);
        SEG(32,16,45.86,24); SEG(45.86,24,45.86,40); SEG(45.86,40,32,48); SEG(32,48,18.14,40); SEG(18.14,40,18.14,24); SEG(18.14,24,32,16);
        SEG(36,17,27,34); SEG(27,34,33,34); SEG(33,34,28,48); SEG(28,48,41,30); SEG(41,30,35,30); SEG(35,30,36,17);
        SEG(46.72,40.5,54.5,45); SEG(32,49,32,58); SEG(17.28,40.5,9.5,45); SEG(17.28,23.5,9.5,19); SEG(32,15,32,6); SEG(46.72,23.5,54.5,19);
    } else if (e == 2) {          // Glasswraith — drifting phantom + eyes
        SEG(32,8,18,16); SEG(18,16,16,34); SEG(16,34,22,50); SEG(22,50,24,56); SEG(24,56,28,50); SEG(28,50,32,56); SEG(32,56,36,50); SEG(36,50,40,56); SEG(40,56,42,50); SEG(42,50,48,34); SEG(48,34,46,16); SEG(46,16,32,8);
        CIR(27,28,2.0); CIR(37,28,2.0);
    } else if (e == 3) {          // Hexarchon — six-faced sigil: hex + spokes + nodes + core
        SEG(32,9,51.92,20.5); SEG(51.92,20.5,51.92,43.5); SEG(51.92,43.5,32,55); SEG(32,55,12.08,43.5); SEG(12.08,43.5,12.08,20.5); SEG(12.08,20.5,32,9);
        SEG(32,32,32,9); SEG(32,32,51.92,20.5); SEG(32,32,51.92,43.5); SEG(32,32,32,55); SEG(32,32,12.08,43.5); SEG(32,32,12.08,20.5);
        CIR(32,9,3.2); CIR(51.92,20.5,3.2); CIR(51.92,43.5,3.2); CIR(32,55,3.2); CIR(12.08,43.5,3.2); CIR(12.08,20.5,3.2);
        CIR(32,32,6.5); CIR(32,32,2.0);
    } else if (e == 4) {          // Tassidean Sentinel — armoured shield + script
        SEG(32,6,50,18); SEG(50,18,46,50); SEG(46,50,32,58); SEG(32,58,18,50); SEG(18,50,14,18); SEG(14,18,32,6);
        SEG(22,24,42,24); SEG(22,32,42,32); SEG(22,40,42,40);
        SEG(32,20,32,46);
    } else if (e == 5) {          // Voidcrawler — matte body + legs + single eye
        SEG(32,12,44,18); SEG(44,18,48,34); SEG(48,34,44,50); SEG(44,50,32,56); SEG(32,56,20,50); SEG(20,50,16,34); SEG(16,34,20,18); SEG(20,18,32,12);
        SEG(18,28,8,24); SEG(18,37,8,35); SEG(18,46,8,46);
        SEG(46,28,56,24); SEG(46,37,56,35); SEG(46,46,56,46);
        CIR(32,26,3.0); CIR(32,26,7.0);
    } else {                      // Pact-Walker — cloaked neutral figure
        SEG(32,8,22,12); SEG(22,12,18,32); SEG(18,32,18,54); SEG(18,54,26,50); SEG(26,50,32,54); SEG(32,54,38,50); SEG(38,50,46,54); SEG(46,54,46,32); SEG(46,32,42,12); SEG(42,12,32,8);
        CIR(32,20,6.0);
    }
    return d;
}

void main() {
    vec2 uv = gl_TexCoord[0].xy / u_resolution;
    vec2 p  = (uv - 0.5) * 2.0;
    float d = enemyDist(p, int(u_enemy + 0.5));

    float intensity = 1.0 + u_charged * 0.6;
    float sw = 0.045 * intensity;                 // stroke half-width
    float aa = fwidth(d) + 0.001;
    float core = 1.0 - smoothstep(sw - aa, sw + aa, d);
    float glow = exp(-max(d - sw, 0.0) * 10.0) * (0.5 + u_charged * 0.4);

    // wind-up flashes the outline toward cyan, mirroring the kit's telegraph
    vec3 hue = mix(u_color, vec3(0.31, 0.90, 1.0), u_charged * 0.85);
    float a = clamp(max(core, glow * 0.7), 0.0, 1.0);
    vec3 col = mix(hue, vec3(1.0), core * 0.5);
    col += hue * glow * 0.6;

    gl_FragColor = vec4(col, a);
}
