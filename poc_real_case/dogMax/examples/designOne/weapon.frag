// ============================================================================
// DogMax — procedural WEAPON silhouette (fragment shader, SFML 3.0 / GLSL).
// No image assets: every archetype is a union of line-segment + circle SDFs,
// ported 1:1 from the kit's neon-traced glyphs (48x48 design space). Rendered
// as a glowing neon stroke that the bloom pass amplifies.
//
// Coordinates below are in the original 48x48 art space; cv() maps them into
// the shader's centered -1..1 quad (x/24 - 1, y/24 - 1), y-down like the art.
//
// Uniforms (see dogmax_shapes.hpp for the helper):
//   u_resolution : vec2  quad size in px
//   u_color      : vec3  outline hue 0..1  (weapon.config *_OUTLINE_*)
//   u_weapon     : float archetype id 0..11 (enum in the .hpp):
//                  0 Pitchfork 1 Sword 2 LongSword 3 GreatSword 4 Halberd
//                  5 Quarterstaff 6 Knives 7 Dagger 8 Mace 9 Warhammer
//                  10 SmallAxe 11 BigAxe
//   u_charged    : float 0..1 (thicker stroke + hotter glow when ready)
// ============================================================================

uniform vec2  u_resolution;
uniform vec3  u_color;
uniform float u_weapon;
uniform float u_charged;

float sdSeg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}
vec2 cv(float x, float y) { return vec2(x / 24.0 - 1.0, y / 24.0 - 1.0); }

#define SEG(ax,ay,bx,by) d = min(d, sdSeg(p, cv(ax,ay), cv(bx,by)))
#define CIR(cx,cy,r)     d = min(d, abs(length(p - cv(cx,cy)) - (r)/24.0))

float weaponDist(vec2 p, int w) {
    float d = 1e9;
    if (w == 0) {                 // Pitchfork — five-prong crown + haft
        SEG(13,16,13,4); SEG(13,4,15,4); SEG(15,4,15,14); SEG(15,14,18,14);
        SEG(18,14,18,4); SEG(18,4,20,4); SEG(20,4,20,14); SEG(20,14,23,14);
        SEG(23,14,23,3); SEG(23,3,25,3); SEG(25,3,25,14); SEG(25,14,28,14);
        SEG(28,14,28,4); SEG(28,4,30,4); SEG(30,4,30,14); SEG(30,14,33,14);
        SEG(33,14,33,4); SEG(33,4,35,4); SEG(35,4,35,16); SEG(35,16,13,16);
        SEG(24,16,24,44);
    } else if (w == 1) {          // Sword — Roman gladius leaf blade + pommel
        SEG(24,5,26.5,11); SEG(26.5,11,27.5,18); SEG(27.5,18,27,24); SEG(27,24,25,30);
        SEG(25,30,23,30); SEG(23,30,21,24); SEG(21,24,20.5,18); SEG(20.5,18,21.5,11); SEG(21.5,11,24,5);
        SEG(17.5,30,30.5,30); SEG(17.5,30,17.5,32.5); SEG(30.5,30,30.5,32.5); SEG(17.5,32.5,30.5,32.5);
        SEG(24,32.5,24,40); CIR(24,42,2.6); SEG(24,9,24,29);
    } else if (w == 2) {          // Long Sword — extra-long slender blade
        SEG(24,2,25.6,9); SEG(25.6,9,25.6,31); SEG(25.6,31,24,35); SEG(24,35,22.4,31); SEG(22.4,31,22.4,9); SEG(22.4,9,24,2);
        SEG(18,35,30,35); SEG(18,35,18,37); SEG(30,35,30,37); SEG(18,37,30,37);
        SEG(24,37,24,45); SEG(24,6,24,31);
    } else if (w == 3) {          // Great Sword — broad blade, wide guard
        SEG(24,3,30,12); SEG(30,12,30,29); SEG(30,29,24,34); SEG(24,34,18,29); SEG(18,29,18,12); SEG(18,12,24,3);
        SEG(13,34,35,34); SEG(13,34,13,37.5); SEG(35,34,35,37.5); SEG(13,37.5,35,37.5);
        SEG(24,37.5,24,45); SEG(24,7,24,29);
    } else if (w == 4) {          // Halberd — top spike, axe blade, back hook
        SEG(24,8,24,46);
        SEG(24,2,26.2,8); SEG(26.2,8,21.8,8); SEG(21.8,8,24,2);
        SEG(25.4,11,33,12); SEG(33,12,38,16); SEG(38,16,37,21); SEG(37,21,36,24); SEG(36,24,25.4,21); SEG(25.4,21,25.4,11);
        SEG(22.6,13,17,11.5); SEG(17,11.5,22.6,18); SEG(22.6,18,22.6,13);
    } else if (w == 5) {          // Quarterstaff — diagonal pole + caps
        SEG(10.8,39.1,13.2,40.9); SEG(13.2,40.9,37.2,8.9); SEG(37.2,8.9,34.8,7.1); SEG(34.8,7.1,10.8,39.1);
        CIR(12,40,2.4); CIR(36,8,2.4);
    } else if (w == 6) {          // Knives — three knives in a thrown spread
        // center (translate 0,-5)
        SEG(24,3,25.1,8); SEG(25.1,8,25,17); SEG(25,17,24,19.5); SEG(24,19.5,23,17); SEG(23,17,22.9,8); SEG(22.9,8,24,3);
        SEG(21.8,20.25,26.2,20.25); SEG(24,21,24,27.5); CIR(24,28.7,1.2);
        // left (rotate -30 about 24,20 then translate -10,6)
        SEG(8,15.6,11.5,19.4); SEG(11.5,19.4,15.9,27.2); SEG(15.9,27.2,16.3,29.9); SEG(16.3,29.9,14.1,28.2); SEG(14.1,28.2,9.6,20.5); SEG(9.6,20.5,8,15.6);
        SEG(14.7,31.7,18.5,29.5); SEG(17,31.2,20.3,36.8); CIR(20.9,37.9,1.2);
        // right (rotate +30 about 24,20 then translate +10,6)
        SEG(40,15.6,38.5,20.5); SEG(38.5,20.5,33.9,28.2); SEG(33.9,28.2,31.8,29.9); SEG(31.8,29.9,32.1,27.2); SEG(32.1,27.2,36.6,19.4); SEG(36.6,19.4,40,15.6);
        SEG(31.5,29.5,35.3,31.7); SEG(31,31.2,27.8,36.8); CIR(27.2,37.9,1.2);
    } else if (w == 7) {          // Dagger — compact leaf blade
        SEG(24,7,26,15); SEG(26,15,25.2,27); SEG(25.2,27,24,30); SEG(24,30,22.8,27); SEG(22.8,27,22,15); SEG(22,15,24,7);
        SEG(19,30,29,30); SEG(19,30,19,32.5); SEG(29,30,29,32.5); SEG(19,32.5,29,32.5);
        SEG(24,32.5,24,40); CIR(24,41.4,1.7);
    } else if (w == 8) {          // Mace — spiked ball on haft
        SEG(24,20,24,44); CIR(24,13,6.5); CIR(24,13,2.6);
        SEG(30,13,34,13); SEG(28.24,17.24,31.07,20.07); SEG(24,19,24,23); SEG(19.76,17.24,16.93,20.07);
        SEG(18,13,14,13); SEG(19.76,8.76,16.93,5.93); SEG(24,7,24,3); SEG(28.24,8.76,31.07,5.93);
    } else if (w == 9) {          // Warhammer — block head on haft
        SEG(24,16,24,44);
        SEG(12,8,36,8); SEG(36,8,36,19); SEG(36,19,12,19); SEG(12,19,12,8);
        SEG(14.5,9,14.5,18); SEG(33.5,9,33.5,18);
    } else if (w == 10) {         // Small Axe — single horned hatchet head
        SEG(24,9,24,42);
        SEG(25,12,31.5,14.5); SEG(31.5,14.5,37,14); SEG(37,14,38.5,19); SEG(38.5,19,37,24); SEG(37,24,31.5,23.5); SEG(31.5,23.5,25,26); SEG(25,26,25,12);
    } else {                      // Big Axe — double horned bits
        SEG(24,7,24,44); CIR(24,6,2.0);
        SEG(25,12,31.6,14.5); SEG(31.6,14.5,37.5,14); SEG(37.5,14,39,19.25); SEG(39,19.25,37.5,25); SEG(37.5,25,31.6,23.75); SEG(31.6,23.75,25,26); SEG(25,26,25,12);
        SEG(23,12,16.4,14.5); SEG(16.4,14.5,10.5,14); SEG(10.5,14,9,19.25); SEG(9,19.25,10.5,25); SEG(10.5,25,16.4,23.75); SEG(16.4,23.75,23,26); SEG(23,26,23,12);
    }
    return d;
}

void main() {
    vec2 uv = gl_TexCoord[0].xy / u_resolution;
    vec2 p  = (uv - 0.5) * 2.0;
    float d = weaponDist(p, int(u_weapon + 0.5));

    float intensity = 1.0 + u_charged * 0.6;
    float sw = 0.05 * intensity;                  // stroke half-width
    float aa = fwidth(d) + 0.001;
    float core = 1.0 - smoothstep(sw - aa, sw + aa, d);
    float glow = exp(-max(d - sw, 0.0) * 10.0) * (0.5 + u_charged * 0.4);

    float a = clamp(max(core, glow * 0.7), 0.0, 1.0);
    vec3 col = mix(u_color, vec3(1.0), core * 0.5);
    col += u_color * glow * 0.6;

    gl_FragColor = vec4(col, a);
}
