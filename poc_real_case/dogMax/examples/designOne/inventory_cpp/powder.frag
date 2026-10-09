// ============================================================================
// DogMax — procedural POWDER swatch (fragment shader, SFML 3.0 / GLSL).
// The rotated-diamond emissive chip used by the inventory powder stash (one per
// powder colour). NO image assets: a glowing diamond with bright edge + soft
// inner fill, computed in-shader.
//
// Uniforms (see dogmax_shapes.hpp helper drawPowder):
//   u_resolution : vec2  swatch size in px
//   u_color      : vec3  powder hue 0..1 (per item-type, e.g. d4 red, weapon black)
// ============================================================================
uniform vec2  u_resolution;
uniform vec3  u_color;

void main() {
    vec2 uv = gl_TexCoord[0].xy / u_resolution;
    vec2 p  = (uv - 0.5) * 2.0;
    float d = abs(p.x) + abs(p.y) - 0.72;          // L1 (diamond) distance field
    float aa = fwidth(d) + 0.001;
    float fill = 1.0 - smoothstep(-aa, aa, d);
    float edge = 1.0 - smoothstep(0.07 - aa, 0.07 + aa, abs(d));
    float glow = exp(-max(d, 0.0) * 7.0) * 0.6;
    vec3 c = u_color;
    vec3 o = mix(c, vec3(1.0), edge * 0.45) + c * glow;
    float a = clamp(max(edge, glow) + fill * 0.5, 0.0, 1.0);
    gl_FragColor = vec4(o, a);
}
