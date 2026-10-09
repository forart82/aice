// ============================================================================
// DogMax — procedural DIE gem (fragment shader, SFML 3.0 / desktop GLSL).
// No image assets: the gem is drawn from a signed-distance field so it stays
// crisp at any scale and feeds the bloom pass like the rest of the neon UI.
//
// Draw a quad (RectangleShape) the size you want the die, bind this shader,
// and set the uniforms below. The rolled face VALUE is drawn separately with
// sf::Text on top — this shader only paints the faceted gem + neon glow.
//
// Uniforms (see dogmax_shapes.hpp for a one-call helper that sets them all):
//   u_resolution : vec2  quad size in pixels (so UVs normalise to 0..1)
//   u_color      : vec3  signature hue, 0..1   (dice.config DICE_COLOR_*)
//   u_sides      : float regular-polygon sides; 0 => apex die (d100 prism)
//                        4->3  6->4  8->4  12->5  20->6  24->6  30->7
//                        42->8 60->8 100->0   (mapping in the .hpp)
//   u_rotation   : float radians (point-up tweak per die)
//   u_charged    : float 0 idle .. 1 charged (thicker stroke + hotter glow)
// ============================================================================

uniform vec2  u_resolution;
uniform vec3  u_color;
uniform float u_sides;
uniform float u_rotation;
uniform float u_charged;

// signed distance to a regular n-gon (circumradius r), oriented point-up.
float sdNgon(vec2 p, float r, float n) {
    float an = 6.2831853 / n;
    float he = mod(atan(p.x, p.y), an) - 0.5 * an;   // fold into one wedge
    return length(p) * cos(he) - r * cos(0.5 * an);
}

// the two cyberpunk hues for the apex (d100) prism: cyan x magenta.
vec3 wedgeColor(int i) {
    return (i - (i / 2) * 2 == 0) ? vec3(80.0, 230.0, 255.0) / 255.0
                                  : vec3(255.0, 80.0, 220.0) / 255.0;
}

void main() {
    // gl_TexCoord[0] is filled by SFML's default vertex shader; the .hpp binds
    // a 1x1 white texture with a size-matched texRect so it maps 0..size here.
    vec2 uv = gl_TexCoord[0].xy / u_resolution;      // 0..1 across the quad
    vec2 p  = (uv - 0.5) * 2.0;                       // -1..1, centered
    float s = sin(u_rotation), c = cos(u_rotation);
    p = mat2(c, -s, s, c) * p;
    float R = 0.82;

    // -------- apex die (d100): 9 neon wedges, corner -> centre --------
    if (u_sides < 2.5) {
        float dO  = sdNgon(p, R, 9.0);
        float aa  = fwidth(dO) + 0.001;
        float inside  = 1.0 - smoothstep(0.0, aa, dO);
        float outline = 1.0 - smoothstep(0.045 - aa, 0.045 + aa, abs(dO));
        float deg = mod(degrees(atan(p.y, p.x)) + 90.0, 360.0);
        int   sec = int(floor(deg / 40.0));
        vec3  wc  = wedgeColor(sec);
        float ph  = mod(deg, 40.0);
        float spoke = (1.0 - smoothstep(0.0, 2.2, min(ph, 40.0 - ph))) * inside; // wedge borders
        float dInner = sdNgon(p, R * 0.58, 9.0);
        float innerLine = 1.0 - smoothstep(0.022 - aa, 0.022 + aa, abs(dInner));
        float glow = exp(-max(dO, 0.0) * 9.0) * 0.6;
        vec3 cyan = vec3(80.0, 230.0, 255.0) / 255.0;
        vec3 mag  = vec3(255.0, 80.0, 220.0) / 255.0;
        vec3 col = cyan * 0.12 * inside;                  // translucent body wash
        col = mix(col, wc, spoke);                        // 2-colour neon spokes
        col = mix(col, mag, innerLine * 0.6);             // inner nonagon shape
        col = mix(col, cyan, outline);                    // cyan outer rim
        col += cyan * glow * 0.4;
        float a = clamp(max(inside * 0.14, max(spoke, max(innerLine * 0.6, max(outline, glow * 0.7)))), 0.0, 1.0);
        gl_FragColor = vec4(col, a);
        return;
    }

    // -------- standard polyhedral die --------
    float n = u_sides;

    float dOuter = sdNgon(p, R,        n);
    float dInner = sdNgon(p, R * 0.58, n);

    float intensity = 1.0 + u_charged * 0.8;
    float strokeO = 0.045 * intensity;
    float strokeI = 0.022 * intensity;
    float aa = fwidth(dOuter) + 0.001;

    float outline = 1.0 - smoothstep(strokeO - aa, strokeO + aa, abs(dOuter));
    float inner   = (1.0 - smoothstep(strokeI - aa, strokeI + aa, abs(dInner))) * 0.5;

    float fill = (1.0 - smoothstep(-0.02, 0.0, dOuter)) * 0.12;   // soft body wash
    float glow = exp(-max(dOuter, 0.0) * 9.0) * (0.5 + u_charged * 0.5);

    float a = clamp(max(max(outline, inner), max(fill, glow * 0.7)), 0.0, 1.0);
    vec3 col = mix(u_color, vec3(1.0), outline * 0.55 + u_charged * 0.15);  // hot core
    col += u_color * glow * 0.6;

    gl_FragColor = vec4(col, a);
}
