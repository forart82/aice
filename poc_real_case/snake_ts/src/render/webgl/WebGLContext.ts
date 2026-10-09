/**
 * ============================================================================
 * WebGL Context & Unified Signed Distance Field (SDF) Shader Architecture (WebGLContext.ts)
 * Ouroboros Ascension — Protocol 3.0 Commercial Engine Edition
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 6, Rule 10, Rule 12)
 * Feature TDD Spec: docs/tdd/architecture_render_refactoring.tdd.md
 *
 * ARCHITECTURAL SUMMARY:
 * ---------------------
 * `WebGLContext` encapsulates the acquisition, state management, shader
 * compilation, and matrix projection pipelines for WebGL 1.0 and WebGL 2.0.
 *
 * RENDERING & TRANSFORMS (Rule 10):
 * --------------------------------
 * 1. Camera Transformation Pipeline:
 *    Let camera state be C = (x, y), zoom = z, rotation = theta, shake = (sx, sy).
 *    Let logical viewport dimensions be (W, H).
 *    Affine world-to-screen transform:
 *      a = z * cos(theta), b = z * sin(theta)
 *      Screen_X = a * (world_X - x) - b * (world_Y - y) + W/2 + sx
 *      Screen_Y = b * (world_X - x) + a * (world_Y - y) + H/2 + sy
 *    Projected to OpenGL NDC [-1, 1] via 3x3 column-major matrix P:
 *      P_ndc = P * (world_X, world_Y, 1.0)^T
 *
 * 2. DPR Compensation & Viewport Sizing:
 *    Physical canvas dimensions: physicalW = logicalW * DPR, physicalH = logicalH * DPR.
 *    On mobile smartphones, DPR is capped at 1.0 to eliminate fillrate starvation on
 *    Tile-Based Deferred Renderers (TBDR GPUs), while desktop scales up to 2.0.
 *
 * 3. Blend Mode Mapping:
 *    - Normal:      SRC_ALPHA, ONE_MINUS_SRC_ALPHA
 *    - Additive:    SRC_ALPHA, ONE
 *    - Subtractive: ZERO, ONE_MINUS_SRC_ALPHA
 *    - Multiply:    DST_COLOR, ONE_MINUS_SRC_ALPHA
 *
 * GPU PIPELINE & ATTRIBUTE LAYOUT:
 * -------------------------------
 * Interleaved Stride: 24 bytes (6 floats / 32-bit words per vertex)
 *   - Offset  0 (0x00): a_position (vec2 Float32, 8 bytes) -> World/Screen 2D coordinates
 *   - Offset  8 (0x08): a_uv       (vec2 Float32, 8 bytes) -> Local shape UV [-1, 1] or texture UV [0, 1]
 *   - Offset 16 (0x10): a_color    (vec4 UInt8 normalized, 4 bytes) -> Little-endian ABGR / RGBA
 *   - Offset 20 (0x14): a_params   (float Float32, 4 bytes) -> Encoded primitive type + glow factor
 *
 * UNIFIED SIGNED DISTANCE FIELD (SDF) FORMULAS:
 * ---------------------------------------------
 * - Type 0 (Quad): Box distance d = ||max(|uv| - 0.96, 0)|| + min(max(|uv.x| - 0.96, |uv.y| - 0.96), 0)
 *                  with Gaussian outer halo glow: G(d) = exp(-d^2 / (2 * sigma^2)).
 * - Type 1 (Circle): Euclidean radial distance d = ||uv||. Anti-aliased boundary via smoothstep(0.95, 1.0, d).
 * - Type 2 (Ring): Annular distance d_ring = |||uv|| - 0.82|.
 * - Type 3 (Sphere): 2D focal radial gradient simulating Blinn-Phong specular highlight:
 *                    focal = (-0.34, -0.38), d = ||uv - focal||.
 * - Type 4 (Laser): Gaussian cross-sectional beam core + exponential glowing aura.
 * - Type 5 (Texture): Sub-pixel texture2D sampling with vertex color modulation.
 * - Type 6 (Nebula): Dual-harmonic Gaussian volumetric dust with procedural filament waves.
 */

import { ColorX } from '../ColorX';

export interface ICamera {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  shakeX?: number;
  shakeY?: number;
}

/**
 * GPU-supported primitive rendering types mapped directly to SDF shader branches.
 */
export enum GLPrimitive {
  Quad = 0,
  Circle = 1,
  Ring = 2,
  Sphere = 3,
  Laser = 4,
  Texture = 5,
  Nebula = 6,
}

/**
 * Cached attribute locations for the unified batch shader.
 */
export interface IGLAttribLocations {
  a_position: number;
  a_uv: number;
  a_color: number;
  a_params: number;
}

/**
 * Cached uniform locations for the unified batch shader.
 */
export interface IGLUniformLocations {
  u_matrix: WebGLUniformLocation | null;
  u_resolution: WebGLUniformLocation | null;
  u_time: WebGLUniformLocation | null;
  u_texture: WebGLUniformLocation | null;
  u_highlightColor: WebGLUniformLocation | null;
  u_baseColor: WebGLUniformLocation | null;
  u_shadowColor: WebGLUniformLocation | null;
}

export class WebGLContext {
  public canvas: HTMLCanvasElement | null = null;
  public gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  public isWebGL2: boolean = false;
  public isSupported: boolean = false;

  public program: WebGLProgram | null = null;
  public attribs: IGLAttribLocations = {
    a_position: -1,
    a_uv: -1,
    a_color: -1,
    a_params: -1,
  };
  public uniforms: IGLUniformLocations = {
    u_matrix: null,
    u_resolution: null,
    u_time: null,
    u_texture: null,
    u_highlightColor: null,
    u_baseColor: null,
    u_shadowColor: null,
  };

  public defaultTexture: WebGLTexture | null = null;
  private _textureCache: Map<string, WebGLTexture> = new Map();
  private static readonly _programCache: WeakMap<object, Map<string, WebGLProgram>> = new WeakMap();

  public viewportWidth: number = 1200;
  public viewportHeight: number = 800;
  public dpr: number = 1;

  public currentMatrix: Float32Array = new Float32Array(9);
  private _currentTime: number = 0;

  /**
   * Unified 2D Batch Vertex Shader Source (GLSL ES 1.00 compatible with WebGL1/2).
   *
   * Physical / Mathematical Matrix Pipeline:
   * 1. Vertex Position (a_position) in 2D World/Screen coordinates: P = (x, y, 1.0)^T
   * 2. World-to-NDC Projection Matrix (u_matrix, 3x3):
   *    P_ndc = u_matrix * P
   * 3. Output gl_Position = vec4(P_ndc.x, P_ndc.y, 0.0, 1.0)
   * 4. Decodes a_params into primitive type ID and glow intensity:
   *    v_type = mod(a_params, 10.0)
   *    v_primitive = v_type
   *    v_glow = floor(a_params / 10.0) / 10.0
   */
  public static readonly VERTEX_SHADER_SOURCE: string = `
    precision highp float;

    attribute vec2 a_position;
    attribute vec2 a_uv;
    attribute vec4 a_color;
    attribute float a_params;

    uniform mat3 u_matrix;
    uniform vec2 u_resolution;
    uniform float u_time;

    varying vec2 v_uv;
    varying vec4 v_color;
    varying float v_type;
    varying float v_primitive;
    varying float v_glow;

    void main() {
      // 3x3 Matrix multiplication transforms (x, y, 1.0) into Clip Space / NDC [-1, 1]
      vec3 clipPos = u_matrix * vec3(a_position, 1.0);
      gl_Position = vec4(clipPos.xy, 0.0, 1.0);

      v_uv = a_uv;
      v_color = a_color;

      // Unpack primitive type and glow factor:
      // a_params = type (0..5) + floor(glow * 10.0) * 10.0
      v_type = mod(a_params, 10.0);
      v_primitive = v_type;
      v_glow = floor(a_params / 10.0) / 10.0;
    }
  `;

  /**
   * Unified Signed Distance Field (SDF) Fragment Shader Source.
   *
   * GPU Shader Algorithms & Mathematical Formulations:
   * - Type 0 (Quad): Box signed distance field with Gaussian outer glow falloff:
   *     G(d) = exp(-(d^2) / (2.0 * sigma^2))
   * - Type 1 (Circle): Euclidean distance length(uv) with sub-pixel edge anti-aliasing
   *     and true Gaussian halo glow: exp(-(d^2) / (2.0 * sigma^2)).
   * - Type 2 (Ring): Annulus distance abs(length(uv) - r_mid) with smooth inner/outer boundaries
   *     and radial Gaussian aura.
   * - Type 3 (2D Focal Radial Sphere): Exact 2D focal-point radial gradient equation
   *     matching Native Canvas2D Ctx2D.createSphereGradient:
   *     focal = (-0.34, -0.38), dist = length(v_uv - focal)
   *     Interpolating between highlightColor (ColorX.shade(color, 0.55)), baseColor, and
   *     shadowColor (ColorX.shade(color, -0.62)) with stop at 0.42.
   * - Type 4 (Laser): Dual-core beam with intense white core and Gaussian colored aura.
   * - Type 5 (Textured Quad): Texture sampling from u_texture: texture2D(u_texture, v_uv) * v_color.
   */
  public static readonly FRAGMENT_SHADER_SOURCE: string = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
    #else
      precision mediump float;
    #endif

    uniform sampler2D u_texture;
    uniform vec3 u_highlightColor;
    uniform vec3 u_baseColor;
    uniform vec3 u_shadowColor;

    varying vec2 v_uv;
    varying vec4 v_color;
    varying float v_type;
    varying float v_primitive;
    varying float v_glow;

    void main() {
      int primType = int(v_type + 0.5);

      // -------------------------------------------------------------
      // 0. QUAD (Sprite / Bounding Box)
      // -------------------------------------------------------------
      if (primType == 0) {
        vec2 boxDist = abs(v_uv) - vec2(0.96, 0.96);
        float d = length(max(boxDist, vec2(0.0))) + min(max(boxDist.x, boxDist.y), 0.0);
        float alpha = 1.0 - smoothstep(-0.04, 0.04, d);

        float glow = 0.0;
        if (v_glow > 0.0 && d > 0.0) {
          float sigma = 0.22;
          glow = exp(-(d * d) / (2.0 * sigma * sigma)) * v_glow;
        }

        vec4 col = vec4(v_color.rgb, v_color.a * alpha);
        col.rgb += v_color.rgb * glow;
        col.a = max(col.a, glow * v_color.a);
        gl_FragColor = col;
        return;
      }

      // -------------------------------------------------------------
      // 1. CIRCLE (SDF Anti-Aliased Disc & Gaussian Glowing Halo)
      // -------------------------------------------------------------
      if (primType == 1) {
        float dist = length(v_uv);
        if (dist > 1.0) {
          discard;
        }
        float alpha = 1.0 - smoothstep(0.95, 1.0, dist);
        vec4 col = vec4(v_color.rgb, v_color.a * alpha);
        if (v_glow > 0.0) {
          col.rgb += v_color.rgb * (v_glow * 0.15);
        }
        if (col.a <= 0.002) {
          discard;
        }
        gl_FragColor = col;
        return;
      }

      // -------------------------------------------------------------
      // 2. RING (Shield Aura / Shockwave Donut)
      // -------------------------------------------------------------
      if (primType == 2) {
        float dist = length(v_uv);
        if (dist > 1.0 || dist < 0.62) {
          discard;
        }
        float ringDist = abs(dist - 0.82);
        float alpha = 1.0 - smoothstep(0.12, 0.16, ringDist);
        vec4 col = vec4(v_color.rgb, v_color.a * alpha);
        if (v_glow > 0.0) {
          col.rgb += v_color.rgb * (v_glow * 0.15);
        }
        if (col.a <= 0.002) {
          discard;
        }
        gl_FragColor = col;
        return;
      }

      // -------------------------------------------------------------
      // 3. 2D FOCAL RADIAL GRADIENT SPHERE (Cybernetic Pearl / Snake Head & Body)
      // -------------------------------------------------------------
      if (primType == 3) {
        float radialDist = length(v_uv);
        if (radialDist > 1.0) {
          discard;
        }
        float edgeAlpha = 1.0 - smoothstep(0.96, 1.0, radialDist);

        // Exact 2D Focal-Point Radial Gradient matching Ctx2D.createSphereGradient
        vec2 focal = vec2(-0.34, -0.38);
        float dist = length(v_uv - focal);
        float t = clamp((dist - 0.08) / 1.32, 0.0, 1.0);

        // Derive highlight and shadow colors matching ColorX.shade(color, 0.55) and vibrant cosmic occlusion
        vec3 highlightCol = mix(v_color.rgb, vec3(1.0, 1.0, 1.0), 0.55);
        vec3 baseCol = v_color.rgb;
        vec3 shadowCol = mix(v_color.rgb, vec3(10.0 / 255.0, 18.0 / 255.0, 36.0 / 255.0), 0.28);

        // Uniform color overrides if explicitly supplied
        if (length(u_highlightColor) > 0.001) highlightCol = u_highlightColor;
        if (length(u_baseColor) > 0.001) baseCol = u_baseColor;
        if (length(u_shadowColor) > 0.001) shadowCol = u_shadowColor;

        vec3 sphereCol;
        if (t < 0.42) {
          sphereCol = mix(highlightCol, baseCol, t / 0.42);
        } else {
          sphereCol = mix(baseCol, shadowCol, (t - 0.42) / 0.58);
        }

        // Exact smooth 2D radial gradient matching Ctx2D.createSphereGradient without inner rim blowout
        vec4 col = vec4(sphereCol, v_color.a * edgeAlpha);
        if (col.a <= 0.002) {
          discard;
        }
        gl_FragColor = col;
        return;
      }

      // -------------------------------------------------------------
      // 4. LASER BEAM (High-Intensity Core + Gaussian Glowing Aura)
      // -------------------------------------------------------------
      if (primType == 4) {
        float crossDist = abs(v_uv.y);
        if (crossDist > 1.0) {
          discard;
        }
        float core = 1.0 - smoothstep(0.18, 0.28, crossDist);
        float sigma = 0.35;
        float aura = exp(-(crossDist * crossDist) / (2.0 * sigma * sigma)) * (0.5 + 0.5 * v_glow);

        float endFade = 1.0 - smoothstep(0.92, 1.0, abs(v_uv.x));
        vec3 laserColor = mix(v_color.rgb, vec3(1.0, 1.0, 1.0), core * 0.9);
        float totalAlpha = (core * 0.9 + aura * 0.65) * endFade * v_color.a;

        gl_FragColor = vec4(laserColor * totalAlpha, totalAlpha);
        return;
      }

      // -------------------------------------------------------------
      // 5. TEXTURED QUAD (Sprite / Texture Atlas / Render Target)
      // -------------------------------------------------------------
      if (primType == 5) {
        vec4 texCol = texture2D(u_texture, v_uv) * v_color;
        if (texCol.a <= 0.002) discard;
        gl_FragColor = texCol;
        return;
      }

      // -------------------------------------------------------------
      // 6. CONTINUOUS 2D SDF NEBULA SPINE & VOLUMETRIC DUST
      // -------------------------------------------------------------
      if (primType == 6) {
        float crossDist = abs(v_uv.y);
        if (crossDist > 1.0) {
          discard;
        }

        // Longitudinal edge falloff (smooth taper at ends of galactic spine)
        float longDist = abs(v_uv.x);
        float endFade = 1.0 - smoothstep(0.65, 1.0, longDist);

        // Exponential Gaussian transversal falloff (zero hard parallel boundaries)
        // Dual-harmonic Gaussian distribution: broad soft mantle (sigma 0.46) + luminous core (sigma 0.20)
        float mantle = exp(-(crossDist * crossDist) / (2.0 * 0.46 * 0.46));
        float core = exp(-(crossDist * crossDist) / (2.0 * 0.20 * 0.20));

        // Smooth boundary anti-aliased edge clamp (guaranteed 0 at boundaries)
        float edgeDamp = 1.0 - smoothstep(0.80, 1.0, crossDist);

        // Procedural celestial gas filaments along galactic spine
        float filament = 1.0 + 0.18 * sin(v_uv.x * 12.0 + v_uv.y * 4.0);

        vec3 mantleCol = v_color.rgb;
        vec3 coreCol = mix(v_color.rgb, vec3(1.0, 1.0, 1.0), core * 0.35);
        vec3 nebulaColor = mix(mantleCol, coreCol, core * 0.6);

        float totalAlpha = (mantle * 0.65 + core * 0.35) * edgeDamp * endFade * v_color.a * filament;
        if (totalAlpha <= 0.002) {
          discard;
        }

        // Unmultiplied color output for additive blending (SRC_ALPHA, ONE)
        gl_FragColor = vec4(nebulaColor, totalAlpha);
        return;
      }

      // Fallback: pass-through color
      gl_FragColor = v_color;
    }
  `;

  constructor(canvas?: HTMLCanvasElement) {
    if (canvas) {
      this.init(canvas);
    }
  }

  /**
   * Initializes the WebGL context on the target canvas, creates and links
   * shader programs, and binds standard pipeline states.
   *
   * @param canvas The target HTMLCanvasElement
   * @returns true if initialization succeeded; false in headless / unsupported environments.
   */
  public init(canvas: HTMLCanvasElement): boolean {
    if (!canvas || typeof canvas.getContext !== 'function') {
      this.isSupported = false;
      return false;
    }

    this.canvas = canvas;
    const contextOptions: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
    };

    // Attempt WebGL2 first, fallback to WebGL1
    try {
      this.gl = canvas.getContext('webgl2', contextOptions) as WebGL2RenderingContext | null;
      if (this.gl) {
        this.isWebGL2 = true;
      } else {
        this.gl = (canvas.getContext('webgl', contextOptions) ||
          canvas.getContext('experimental-webgl', contextOptions)) as WebGLRenderingContext | null;
        this.isWebGL2 = false;
      }
    } catch {
      this.gl = null;
    }

    if (!this.gl || typeof this.gl.createShader !== 'function') {
      this.gl = null;
      this.isSupported = false;
      return false;
    }

    // Compile and link unified Shader Program
    this.program = this.createProgram(
      WebGLContext.VERTEX_SHADER_SOURCE,
      WebGLContext.FRAGMENT_SHADER_SOURCE
    );

    if (!this.program) {
      this.isSupported = false;
      return false;
    }

    const gl = this.gl;
    gl.useProgram(this.program);

    // Cache Attribute Locations
    this.attribs.a_position = gl.getAttribLocation(this.program, 'a_position');
    this.attribs.a_uv = gl.getAttribLocation(this.program, 'a_uv');
    this.attribs.a_color = gl.getAttribLocation(this.program, 'a_color');
    this.attribs.a_params = gl.getAttribLocation(this.program, 'a_params');

    // Cache Uniform Locations
    this.uniforms.u_matrix = gl.getUniformLocation(this.program, 'u_matrix');
    this.uniforms.u_resolution = gl.getUniformLocation(this.program, 'u_resolution');
    this.uniforms.u_time = gl.getUniformLocation(this.program, 'u_time');
    this.uniforms.u_texture = gl.getUniformLocation(this.program, 'u_texture');
    this.uniforms.u_highlightColor = gl.getUniformLocation(this.program, 'u_highlightColor');
    this.uniforms.u_baseColor = gl.getUniformLocation(this.program, 'u_baseColor');
    this.uniforms.u_shadowColor = gl.getUniformLocation(this.program, 'u_shadowColor');

    // Configure Default Render States
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    this.isSupported = true;

    // Initialize 1x1 default white texture for fallback / untextured quads if supported
    if (typeof gl.createTexture === 'function') {
      this.defaultTexture = this.createSolidTexture(255, 255, 255, 255);
      if (this.defaultTexture) {
        this.bindTexture(this.defaultTexture, 0);
      }
    }

    this.isSupported = true;
    this.resize(canvas.width || 1200, canvas.height || 800);
    return true;
  }

  /**
   * Resizes the WebGL viewport and synchronizes resolution uniforms.
   */
  public resize(width: number, height: number, dpr: number = 1): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.dpr = dpr;

    if (!this.gl || !this.isSupported) return;

    const physicalW = Math.max(1, Math.round(width * dpr));
    const physicalH = Math.max(1, Math.round(height * dpr));

    this.gl.viewport(0, 0, physicalW, physicalH);

    if (this.uniforms.u_resolution) {
      this.gl.uniform2f(this.uniforms.u_resolution, width, height);
    }
  }

  /**
   * Clears the framebuffer with RGBA color.
   */
  public clear(r: number = 0.02, g: number = 0.03, b: number = 0.06, a: number = 1.0): void {
    if (!this.gl || !this.isSupported) return;
    this.gl.clearColor(r, g, b, a);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  /**
   * Sets the active alpha blending equation.
   *
   * @param mode 'normal' (standard alpha blending), 'additive' (neon glow accumulation), 'subtractive', or 'multiply'
   */
  public setBlendMode(mode: 'normal' | 'additive' | 'subtractive' | 'multiply' | string): void {
    if (!this.gl || !this.isSupported) return;
    const gl = this.gl;
    if (mode === 'additive') {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    } else if (mode === 'subtractive') {
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    } else if (mode === 'multiply') {
      gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  /**
   * Derives the 3x3 World-to-NDC Transformation Matrix for a Camera 2D.
   *
   * Physical / Mathematical Derivation:
   * ----------------------------------
   * Let camera center = (x, y), zoom = z, rotation = θ, shake = (sx, sy).
   * Viewport dimensions = (W, H).
   *
   * 1. World-to-Screen Affine Transform:
   *    a = z * cos(θ),  b = z * sin(θ)
   *    m00 = a,   m01 = -b,  m02 = (W/2 + sx) - (a * x - b * y)
   *    m10 = b,   m11 =  a,  m12 = (H/2 + sy) - (b * x + a * y)
   *
   * 2. Screen-to-NDC Transform:
   *    nx = (2 / W) * sx - 1
   *    ny = (-2 / H) * sy + 1
   *
   * 3. Combined Column-Major 3x3 Matrix P:
   *    P[0] =  2a / W           (col 0, row 0)
   *    P[1] = -2b / H           (col 0, row 1)
   *    P[2] =  0                (col 0, row 2)
   *    P[3] = -2b / W           (col 1, row 0)
   *    P[4] = -2a / H           (col 1, row 1)
   *    P[5] =  0                (col 1, row 2)
   *    P[6] = (2 * sx - 2 * (a * x - b * y)) / W   (col 2, row 0)
   *    P[7] = (-2 * sy + 2 * (b * x + a * y)) / H  (col 2, row 1)
   *    P[8] =  1                                   (col 2, row 2)
   */
  public computeCameraMatrix(
    camera: ICamera,
    width: number = this.viewportWidth,
    height: number = this.viewportHeight
  ): Float32Array {
    const W = Math.max(1, width);
    const H = Math.max(1, height);
    const z = camera.zoom || 1.0;
    const rot = camera.rotation || 0.0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const a = z * cos;
    const b = z * sin;
    const cx = camera.x || 0;
    const cy = camera.y || 0;
    const sx = camera.shakeX || 0;
    const sy = camera.shakeY || 0;

    const out = new Float32Array(9);
    // Col 0
    out[0] = (2.0 * a) / W;
    out[1] = (-2.0 * b) / H;
    out[2] = 0.0;

    // Col 1
    out[3] = (-2.0 * b) / W;
    out[4] = (-2.0 * a) / H;
    out[5] = 0.0;

    // Col 2
    out[6] = (2.0 * sx - 2.0 * (a * cx - b * cy)) / W;
    out[7] = (-2.0 * sy + 2.0 * (b * cx + a * cy)) / H;
    out[8] = 1.0;

    return out;
  }

  /**
   * Computes Screen-Space (UI) Orthographic Projection Matrix.
   */
  public computeScreenMatrix(
    width: number = this.viewportWidth,
    height: number = this.viewportHeight
  ): Float32Array {
    const W = Math.max(1, width);
    const H = Math.max(1, height);
    const out = new Float32Array(9);

    // Col 0
    out[0] = 2.0 / W;
    out[1] = 0.0;
    out[2] = 0.0;

    // Col 1
    out[3] = 0.0;
    out[4] = -2.0 / H;
    out[5] = 0.0;

    // Col 2
    out[6] = -1.0;
    out[7] = 1.0;
    out[8] = 1.0;

    return out;
  }

  /**
   * Uploads camera transformation matrix to the active GPU shader uniform.
   */
  public setCamera(
    camera: ICamera,
    width: number = this.viewportWidth,
    height: number = this.viewportHeight
  ): void {
    const mat = this.computeCameraMatrix(camera, width, height);
    this.setMatrix(mat);
  }

  /**
   * Sets Screen-Space projection for UI rendering.
   */
  public setScreenSpace(
    width: number = this.viewportWidth,
    height: number = this.viewportHeight
  ): void {
    const mat = this.computeScreenMatrix(width, height);
    this.setMatrix(mat);
  }

  /**
   * Uploads a 3x3 matrix to the `u_matrix` uniform.
   */
  public setMatrix(matrix3x3: Float32Array | number[]): void {
    for (let i = 0; i < 9; i++) {
      this.currentMatrix[i] = matrix3x3[i]!;
    }
    if (!this.gl || !this.isSupported || !this.uniforms.u_matrix) return;
    this.gl.uniformMatrix3fv(this.uniforms.u_matrix, false, this.currentMatrix);
  }

  /**
   * Updates the simulation timestamp uniform `u_time`.
   */
  public updateTime(time: number): void {
    this._currentTime = time;
    if (!this.gl || !this.isSupported || !this.uniforms.u_time) return;
    this.gl.uniform1f(this.uniforms.u_time, time);
  }

  /**
   * Activates and configures vertex attribute pointers for dynamic batch drawing.
   *
   * Interleaved Stride (24 bytes):
   * - Offset 0:  a_position (vec2 float, 8 bytes)
   * - Offset 8:  a_uv       (vec2 float, 8 bytes)
   * - Offset 16: a_color    (vec4 unsigned byte normalized, 4 bytes)
   * - Offset 20: a_params   (float, 4 bytes)
   */
  public setupVertexAttributes(): void {
    if (!this.gl || !this.isSupported) return;
    const gl = this.gl;
    if (this.program) {
      gl.useProgram(this.program);
    }
    const stride = 24; // 6 floats * 4 bytes

    if (this.attribs.a_position !== -1) {
      gl.enableVertexAttribArray(this.attribs.a_position);
      gl.vertexAttribPointer(this.attribs.a_position, 2, gl.FLOAT, false, stride, 0);
    }
    if (this.attribs.a_uv !== -1) {
      gl.enableVertexAttribArray(this.attribs.a_uv);
      gl.vertexAttribPointer(this.attribs.a_uv, 2, gl.FLOAT, false, stride, 8);
    }
    if (this.attribs.a_color !== -1) {
      gl.enableVertexAttribArray(this.attribs.a_color);
      gl.vertexAttribPointer(this.attribs.a_color, 4, gl.UNSIGNED_BYTE, true, stride, 16);
    }
    if (this.attribs.a_params !== -1) {
      gl.enableVertexAttribArray(this.attribs.a_params);
      gl.vertexAttribPointer(this.attribs.a_params, 1, gl.FLOAT, false, stride, 20);
    }
  }

  /**
   * Compiles an individual WebGL shader from source string.
   * Single Source of Truth for GPU shader compilation across all render pipelines.
   */
  public static compileShader(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    type: number,
    source: string
  ): WebGLShader | null {
    if (!gl || typeof gl.createShader !== 'function') return null;
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (!success) {
      const log = gl.getShaderInfoLog(shader);
      console.warn(`[WebGLContext] Shader compile error: ${log}`);
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  /**
   * Compiles and links Vertex and Fragment shaders into a WebGLProgram.
   */
  public static compileAndLinkProgram(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    vsSource: string,
    fsSource: string
  ): WebGLProgram | null {
    if (!gl || typeof gl.createProgram !== 'function') return null;

    const vs = WebGLContext.compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = WebGLContext.compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    const success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!success) {
      const log = gl.getProgramInfoLog(program);
      console.warn(`[WebGLContext] Program link error: ${log}`);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }

    return program;
  }

  /**
   * Retrieves or compiles and links a cached WebGLProgram for the specified context and shader sources.
   * Scoped per WebGLRenderingContext via WeakMap to prevent cross-context resource leaks or invalid handles (AGENTS.md Rule 10).
   */
  public static getCachedProgram(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    vsSource: string,
    fsSource: string
  ): WebGLProgram | null {
    if (!gl || typeof gl.createProgram !== 'function') return null;
    const cacheKey = `${vsSource}###${fsSource}`;
    let ctxCache = WebGLContext._programCache.get(gl);
    if (!ctxCache) {
      ctxCache = new Map<string, WebGLProgram>();
      WebGLContext._programCache.set(gl, ctxCache);
    }
    const cached = ctxCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const prog = WebGLContext.compileAndLinkProgram(gl, vsSource, fsSource);
    if (prog) {
      ctxCache.set(cacheKey, prog);
    }
    return prog;
  }

  /**
   * Clears the static shader program cache and deletes GPU programs for a given context.
   */
  public static clearProgramCache(gl?: WebGLRenderingContext | WebGL2RenderingContext | null): void {
    if (gl) {
      const ctxCache = WebGLContext._programCache.get(gl);
      if (ctxCache) {
        if (typeof gl.deleteProgram === 'function') {
          for (const prog of ctxCache.values()) {
            try {
              gl.deleteProgram(prog);
            } catch {}
          }
        }
        ctxCache.clear();
        WebGLContext._programCache.delete(gl);
      }
    }
  }

  /**
   * Compiles an individual WebGL shader on this context.
   */
  public createShader(type: number, source: string): WebGLShader | null {
    if (!this.gl) return null;
    return WebGLContext.compileShader(this.gl, type, source);
  }

  /**
   * Compiles and links Vertex and Fragment shaders into a WebGLProgram on this context.
   */
  public createProgram(vsSource: string, fsSource: string): WebGLProgram | null {
    if (!this.gl) return null;
    return WebGLContext.getCachedProgram(this.gl, vsSource, fsSource) ||
      WebGLContext.compileAndLinkProgram(this.gl, vsSource, fsSource);
  }

  /**
   * Creates a WebGL 2.0 Vertex Array Object (VAO) or falls back to OES_vertex_array_object extension.
   * Caches vertex attribute pointer bindings on the GPU driver for optimal draw call throughput.
   */
  public createVertexArray(): WebGLVertexArrayObject | null {
    if (!this.gl || !this.isSupported) return null;
    const gl = this.gl as any;
    if (typeof gl.createVertexArray === 'function') {
      return gl.createVertexArray();
    }
    const ext = typeof gl.getExtension === 'function' ? gl.getExtension('OES_vertex_array_object') : null;
    if (ext && typeof ext.createVertexArrayOES === 'function') {
      return ext.createVertexArrayOES();
    }
    return null;
  }

  /**
   * Binds the specified Vertex Array Object (VAO).
   */
  public bindVertexArray(vao: WebGLVertexArrayObject | null): void {
    if (!this.gl || !this.isSupported) return;
    const gl = this.gl as any;
    if (typeof gl.bindVertexArray === 'function') {
      gl.bindVertexArray(vao);
      return;
    }
    const ext = typeof gl.getExtension === 'function' ? gl.getExtension('OES_vertex_array_object') : null;
    if (ext && typeof ext.bindVertexArrayOES === 'function') {
      ext.bindVertexArrayOES(vao);
    }
  }

  /**
   * Deletes the specified Vertex Array Object (VAO).
   */
  public deleteVertexArray(vao: WebGLVertexArrayObject | null): void {
    if (!this.gl || !this.isSupported || !vao) return;
    const gl = this.gl as any;
    if (typeof gl.deleteVertexArray === 'function') {
      gl.deleteVertexArray(vao);
      return;
    }
    const ext = typeof gl.getExtension === 'function' ? gl.getExtension('OES_vertex_array_object') : null;
    if (ext && typeof ext.deleteVertexArrayOES === 'function') {
      ext.deleteVertexArrayOES(vao);
    }
  }

  /**
   * Creates a 1x1 solid RGBA pixel texture for fallback or default untextured operations.
   */
  public createSolidTexture(r: number, g: number, b: number, a: number): WebGLTexture | null {
    if (!this.gl || !this.isSupported || typeof this.gl.createTexture !== 'function') return null;
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) return null;

    if (typeof gl.bindTexture === 'function') {
      gl.bindTexture(gl.TEXTURE_2D || 3553, texture);
    }
    if (typeof gl.texParameteri === 'function') {
      gl.texParameteri(gl.TEXTURE_2D || 3553, gl.TEXTURE_WRAP_S || 10242, gl.CLAMP_TO_EDGE || 33071);
      gl.texParameteri(gl.TEXTURE_2D || 3553, gl.TEXTURE_WRAP_T || 10243, gl.CLAMP_TO_EDGE || 33071);
      gl.texParameteri(gl.TEXTURE_2D || 3553, gl.TEXTURE_MIN_FILTER || 10241, gl.NEAREST || 9728);
      gl.texParameteri(gl.TEXTURE_2D || 3553, gl.TEXTURE_MAG_FILTER || 10240, gl.NEAREST || 9728);
    }

    const pixel = new Uint8Array([r, g, b, a]);
    try {
      if (typeof gl.texImage2D === 'function') {
        gl.texImage2D(
          gl.TEXTURE_2D || 3553,
          0,
          gl.RGBA || 6408,
          1,
          1,
          0,
          gl.RGBA || 6408,
          gl.UNSIGNED_BYTE || 5121,
          pixel
        );
      }
    } catch {
      // Fallback
    }

    return texture;
  }

  /**
   * Creates a dynamic GPU WebGLTexture from an HTMLCanvasElement or OffscreenCanvas.
   *
   * Configuration Standard:
   * - Wrap S/T: CLAMP_TO_EDGE (supports non-power-of-two (NPOT) canvas dimensions)
   * - Min/Mag Filter: LINEAR (smooth bilinear scaling for high-DPI stamps)
   * - UNPACK_PREMULTIPLY_ALPHA_WEBGL: true (matches Canvas2D alpha compositing)
   */
  public createTextureFromCanvas(canvas: HTMLCanvasElement | OffscreenCanvas | any): WebGLTexture | null {
    if (!this.gl || !this.isSupported || !canvas) return null;
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) return null;

    gl.bindTexture(gl.TEXTURE_2D || 3553, texture);
    gl.texParameteri(gl.TEXTURE_2D || 3553, gl.TEXTURE_WRAP_S || 10242, gl.CLAMP_TO_EDGE || 33071);
    gl.texParameteri(gl.TEXTURE_2D || 3553, gl.TEXTURE_WRAP_T || 10243, gl.CLAMP_TO_EDGE || 33071);
    gl.texParameteri(gl.TEXTURE_2D || 3553, gl.TEXTURE_MIN_FILTER || 10241, gl.LINEAR || 9729);
    gl.texParameteri(gl.TEXTURE_2D || 3553, gl.TEXTURE_MAG_FILTER || 10240, gl.LINEAR || 9729);

    try {
      if (typeof gl.pixelStorei === 'function') {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL || 37441, true);
      }
      gl.texImage2D(
        gl.TEXTURE_2D || 3553,
        0,
        gl.RGBA || 6408,
        gl.RGBA || 6408,
        gl.UNSIGNED_BYTE || 5121,
        canvas
      );
    } catch {
      // Fallback in headless mock environments
    }

    return texture;
  }

  /**
   * Re-uploads / updates existing texture content from a canvas.
   */
  public updateTextureFromCanvas(texture: WebGLTexture, canvas: HTMLCanvasElement | OffscreenCanvas | any): void {
    if (!this.gl || !this.isSupported || !texture || !canvas) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D || 3553, texture);
    try {
      if (typeof gl.texSubImage2D === 'function') {
        gl.texSubImage2D(gl.TEXTURE_2D || 3553, 0, 0, 0, gl.RGBA || 6408, gl.UNSIGNED_BYTE || 5121, canvas);
      } else {
        gl.texImage2D(gl.TEXTURE_2D || 3553, 0, gl.RGBA || 6408, gl.RGBA || 6408, gl.UNSIGNED_BYTE || 5121, canvas);
      }
    } catch {
      // Fallback
    }
  }

  /**
   * Retrieves an existing cached WebGLTexture by identifier key, or creates and caches
   * a new texture from the provided canvas.
   */
  public getOrCreateTexture(key: string, canvas: HTMLCanvasElement | OffscreenCanvas | any): WebGLTexture | null {
    if (!key || !canvas) return null;
    const existing = this._textureCache.get(key);
    if (existing) return existing;

    const texture = this.createTextureFromCanvas(canvas);
    if (texture) {
      this._textureCache.set(key, texture);
    }
    return texture;
  }

  /**
   * Disposes and clears all cached GPU textures.
   */
  public clearTextureCache(): void {
    if (this.gl && this.isSupported) {
      for (const texture of this._textureCache.values()) {
        try {
          this.gl.deleteTexture(texture);
        } catch {}
      }
    }
    this._textureCache.clear();
  }

  /**
   * Binds a WebGLTexture to a specified GPU texture unit and sets the `u_texture` uniform.
   */
  public bindTexture(texture: WebGLTexture | null, unit: number = 0): void {
    if (!this.gl || !this.isSupported) return;
    const gl = this.gl;
    const texToBind = texture || this.defaultTexture;
    const textureUnitConst = (gl.TEXTURE0 || 33984) + unit;

    gl.activeTexture(textureUnitConst);
    gl.bindTexture(gl.TEXTURE_2D || 3553, texToBind);

    if (this.uniforms.u_texture) {
      gl.uniform1i(this.uniforms.u_texture, unit);
    }
  }

  /**
   * Alias for bindTexture to set the active texture unit and uniform.
   */
  public setTexture(texture: WebGLTexture | null, unit: number = 0): void {
    this.bindTexture(texture, unit);
  }

  /**
   * Sets uniform overrides for 2D focal radial gradient sphere colors.
   */
  public setSphereColors(
    highlight: [number, number, number] | string | null = null,
    base: [number, number, number] | string | null = null,
    shadow: [number, number, number] | string | null = null
  ): void {
    if (!this.gl || !this.isSupported) return;
    const gl = this.gl;

    const parseCol = (c: [number, number, number] | string | null): [number, number, number] => {
      if (!c) return [0, 0, 0];
      if (Array.isArray(c)) return c;
      const [r, g, b] = ColorX.parseCss(c);
      return [r / 255, g / 255, b / 255];
    };

    if (this.uniforms.u_highlightColor) {
      const h = parseCol(highlight);
      gl.uniform3f(this.uniforms.u_highlightColor, h[0], h[1], h[2]);
    }
    if (this.uniforms.u_baseColor) {
      const b = parseCol(base);
      gl.uniform3f(this.uniforms.u_baseColor, b[0], b[1], b[2]);
    }
    if (this.uniforms.u_shadowColor) {
      const s = parseCol(shadow);
      gl.uniform3f(this.uniforms.u_shadowColor, s[0], s[1], s[2]);
    }
  }

  /**
   * Safely deletes a GPU WebGLTexture.
   */
  public deleteTexture(texture: WebGLTexture | null): void {
    if (!this.gl || !this.isSupported || !texture) return;
    try {
      this.gl.deleteTexture(texture);
    } catch {}
  }

  /**
   * Releases WebGL GPU resources and resets context state.
   */
  public dispose(): void {
    this.clearTextureCache();
    if (this.gl) {
      if (this.defaultTexture) {
        try {
          this.gl.deleteTexture(this.defaultTexture);
        } catch {}
        this.defaultTexture = null;
      }
      if (this.program) {
        try {
          this.gl.deleteProgram(this.program);
        } catch {}
        this.program = null;
      }
      WebGLContext.clearProgramCache(this.gl);
    }
    this.gl = null;
    this.canvas = null;
    this.isSupported = false;
  }
}
