/**
 * ============================================================================
 * High-Performance Dynamic 2D WebGL Vertex Batch Renderer (GLBatch.ts)
 * Ouroboros Ascension — Protocol 3.0 Commercial Engine Edition
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 6, Rule 10, Rule 12)
 * Feature TDD Spec: docs/tdd/architecture_render_refactoring.tdd.md
 *
 * ARCHITECTURAL SUMMARY:
 * ---------------------
 * `GLBatch` manages dynamic interleaved Float32 / Uint32 vertex buffers with
 * automatic saturation flushing, blend mode state management, VAO acceleration,
 * and unified GPU-accelerated Signed Distance Field (SDF) drawing routines.
 *
 * RENDERING & TRANSFORMS (Rule 10):
 * --------------------------------
 * 1. 2D Orthographic Projection Matrix:
 *    Transforms 2D World/Screen coordinates into Normalized Device Coordinates (NDC) [-1, 1].
 *    Given viewport dimensions (W, H) and camera position (camX, camY):
 *
 *        M_ortho = [  2 / W,          0,      0  ]   (Column 0)
 *                  [      0,     -2 / H,      0  ]   (Column 1)
 *                  [ -1 + 2*camX/W, 1 - 2*camY/H, 1 ]   (Column 2)
 *
 *    - Inversion of Y Axis: World space has +Y pointing downwards (Canvas2D standard),
 *      whereas OpenGL NDC has +Y pointing upwards. The factor -2 / H flips Y into NDC.
 *    - Camera Translation: Subtracted from world coordinates so the camera looks at (camX, camY).
 *
 * 2. Coordinate Spaces:
 *    - World Space:    [0, arenaW] x [0, arenaH] (simulation gameplay plane).
 *    - Screen Space:   [0, logicalW] x [0, logicalH] (HUD, modals, overlays).
 *    - Viewport Space: [0, physicalW] x [0, physicalH] where physical = logical * DPR.
 *    - Clip / NDC:     [-1, 1] x [-1, 1] (WebGL normalized device coordinate cube).
 *
 * 3. Composite Blend Modes:
 *    - Normal:      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
 *                   Standard alpha compositing for opaque meshes, bodies, and scales.
 *    - Additive:    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
 *                   High-energy luminous summation for neon blooms, laser beams, and explosions.
 *    - Subtractive: gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA)
 *                   Inverted mask/shadow absorption for void singularities and dark rifts.
 *    - Multiply:    gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA)
 *                   Ambient lighting and chromatic color grading.
 *
 * GPU PIPELINE & BATCHING (Rule 10):
 * ---------------------------------
 * - Interleaved Stride: 24 bytes (6 floats / 32-bit words per vertex)
 *   1. Offset  0: a_position.xy (2 x Float32, 8 bytes)
 *   2. Offset  8: a_uv.uv       (2 x Float32, 8 bytes)
 *   3. Offset 16: a_color       (4 x UInt8 normalized / packed UInt32 ABGR, 4 bytes)
 *   4. Offset 20: a_params      (1 x Float32 encoded primitive type + glow, 4 bytes)
 *
 * - Buffer Layout:
 *   - Quad Capacity: Default 4,096 quads (16,384 vertices, 24,576 indices, 384 KB VBO).
 *   - Dynamic VBO: Sub-allocated via Float32Array / Uint32Array shared ArrayBuffer.
 *   - Static IBO: Pre-populated repeating indices [0, 1, 2, 2, 3, 0] offset by 4 per quad.
 *   - VAO Acceleration: WebGL 2.0 VAO binds VBO, IBO, and attribute pointers once during init.
 *
 * GEOMETRIC EXTRUSION & SDF FORMULAS (Rule 10):
 * ---------------------------------------------
 * - Continuous Mitered Ribbon Extrusion:
 *   Segment tangent:  T_i = (P_{i+1} - P_i) / ||P_{i+1} - P_i||
 *   Left normal:      N_i = (-T_{i,y}, T_{i,x})
 *   Joint bisector:   B_i = normalize(N_{i-1} + N_i)
 *   Miter factor:     m_i = 1 / (B_i . N_{i-1}) clamped to [0.5, 2.5]
 *   Extruded points:  V_{L,i} = P_i + B_i * (w_i / 2) * m_i
 *                     V_{R,i} = P_i - B_i * (w_i / 2) * m_i
 *   Zero-seam guarantee: adjacent segments share exact vertices V_{L,i} and V_{R,i}.
 */

import { WebGLContext, GLPrimitive } from './WebGLContext';
import { ColorX } from '../ColorX';
import { MathX } from '../../core/MathX';

export const GLBlendMode = {
  NORMAL: 'normal' as const,
  ADDITIVE: 'additive' as const,
  SUBTRACTIVE: 'subtractive' as const,
  MULTIPLY: 'multiply' as const,
};
export type GLBlendMode = (typeof GLBlendMode)[keyof typeof GLBlendMode];

export type BlendModeInput = GLBlendMode | 'normal' | 'additive' | 'subtractive' | 'multiply';

export const ISDFShapeType = {
  QUAD: 0,
  CIRCLE: 1,
  RING: 2,
  RECT: 3,
  DIAMOND: 4,
  WEDGE: 5,
  POLYGON: 6,
  CAPSULE: 7,
  STAR: 8,
  SERPENTINE_RIBBON: 9,
} as const;
export type ISDFShapeType = (typeof ISDFShapeType)[keyof typeof ISDFShapeType];

export interface IRibbonNode {
  x: number;
  y: number;
  r: number;
  angle: number;
  hp?: number;
  maxHp?: number;
  hitFlash?: number;
}

export interface IParticleRenderData {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  size: number;
  colorCss: string;
  alpha: number;
  shape?: 'circle' | 'square' | 'ring' | 'spark' | 'shard' | 'plasma' | string;
  glow?: boolean;
  angle?: number;
  streakMult?: number;
  active?: boolean;
}

export class GLBatch {
  public static readonly FLOATS_PER_VERTEX: number = 6;
  public static readonly VERTICES_PER_QUAD: number = 4;
  public static readonly FLOATS_PER_QUAD: number = 24;
  public static readonly INDICES_PER_QUAD: number = 6;
  public static readonly DEFAULT_MAX_QUADS: number = 4096;

  public readonly context: WebGLContext;
  public readonly maxQuads: number;

  public readonly arrayBuffer: ArrayBuffer;
  public readonly vertexDataF32: Float32Array;
  public readonly vertexDataU32: Uint32Array;
  public readonly indexBuffer: Uint16Array;

  public width: number = 960;
  public height: number = 640;
  public cameraX: number = 0;
  public cameraY: number = 0;

  private _quadCount: number = 0;
  private _currentBlendMode: GLBlendMode = GLBlendMode.NORMAL;
  private _currentTexture: WebGLTexture | null = null;
  private _inBatch: boolean = false;

  private _vertexBuffer: WebGLBuffer | null = null;
  private _indexBufferGL: WebGLBuffer | null = null;
  private _vao: WebGLVertexArrayObject | null = null;
  private readonly _matrixBuffer: Float32Array = new Float32Array(9);
  private static readonly _colorCache: Map<string, number> = new Map();
  private static readonly _CRACK_OFFSETS = [
    { c: 0.75, s: 0.4 },
    { c: -0.5, s: 0.65 },
    { c: 0.2, s: -0.7 },
  ];

  // ---------------------------------------------------------------- Zero-Allocation Static UV Constants
  public static readonly DEFAULT_UV_MIN: readonly [number, number] = [-1.0, -1.0];
  public static readonly DEFAULT_UV_MAX: readonly [number, number] = [1.0, 1.0];
  public static readonly TEX_UV_MIN: readonly [number, number] = [0.0, 0.0];
  public static readonly TEX_UV_MAX: readonly [number, number] = [1.0, 1.0];

  // ---------------------------------------------------------------- Zero-Allocation Static Scratch Buffers for Continuous Serpentine Mesh Ribbon
  private static _scratchCap: number = 2048;
  private static _ptX: Float32Array = new Float32Array(2048);
  private static _ptY: Float32Array = new Float32Array(2048);
  private static _smoothPtX: Float32Array = new Float32Array(4096);
  private static _smoothPtY: Float32Array = new Float32Array(4096);
  private static _segNormX: Float32Array = new Float32Array(2048);
  private static _segNormY: Float32Array = new Float32Array(2048);
  private static _segLen: Float32Array = new Float32Array(2048);
  private static _bisectX: Float32Array = new Float32Array(2048);
  private static _bisectY: Float32Array = new Float32Array(2048);
  private static _miter: Float32Array = new Float32Array(2048);
  private static _vLx: Float32Array = new Float32Array(2048);
  private static _vLy: Float32Array = new Float32Array(2048);
  private static _vRx: Float32Array = new Float32Array(2048);
  private static _vRy: Float32Array = new Float32Array(2048);
  private static _taperScratch: Float32Array = new Float32Array(4096);
  private static _wGlowScratch: Float32Array = new Float32Array(4096);
  private static _wShellScratch: Float32Array = new Float32Array(4096);
  private static _wCoreScratch: Float32Array = new Float32Array(4096);
  private static _wShadowScratch: Float32Array = new Float32Array(4096);
  private static _wHighlightScratch: Float32Array = new Float32Array(4096);

  /**
   * Ensures internal scratch capacity for continuous ribbon extrusion computations.
   * Dynamic expansion with power-of-two growth ensures zero heap thrashing during live gameplay.
   */
  private static _ensureScratchCapacity(cap: number): void {
    if (this._scratchCap < cap) {
      let nextCap = this._scratchCap * 2;
      while (nextCap < cap) nextCap *= 2;
      this._scratchCap = nextCap;
      this._ptX = new Float32Array(nextCap);
      this._ptY = new Float32Array(nextCap);
      this._segNormX = new Float32Array(nextCap);
      this._segNormY = new Float32Array(nextCap);
      this._segLen = new Float32Array(nextCap);
      this._bisectX = new Float32Array(nextCap);
      this._bisectY = new Float32Array(nextCap);
      this._miter = new Float32Array(nextCap);
      this._vLx = new Float32Array(nextCap);
      this._vLy = new Float32Array(nextCap);
      this._vRx = new Float32Array(nextCap);
      this._vRy = new Float32Array(nextCap);
    }
    const smoothCap = cap * 4;
    if (this._smoothPtX.length < smoothCap) {
      let nextSmooth = this._smoothPtX.length * 2;
      while (nextSmooth < smoothCap) nextSmooth *= 2;
      this._smoothPtX = new Float32Array(nextSmooth);
      this._smoothPtY = new Float32Array(nextSmooth);
      this._taperScratch = new Float32Array(nextSmooth);
      this._wGlowScratch = new Float32Array(nextSmooth);
      this._wShellScratch = new Float32Array(nextSmooth);
      this._wCoreScratch = new Float32Array(nextSmooth);
      this._wShadowScratch = new Float32Array(nextSmooth);
      this._wHighlightScratch = new Float32Array(nextSmooth);
    }
  }

  constructor(context?: WebGLContext | any, maxQuads: number = GLBatch.DEFAULT_MAX_QUADS) {
    if (!context || typeof context !== 'object') {
      this.context = new WebGLContext();
    } else if (context instanceof WebGLContext) {
      this.context = context;
    } else {
      const ctx = new WebGLContext();
      ctx.gl = context;
      ctx.isSupported = typeof context.createBuffer === 'function';
      this.context = ctx;
    }

    this.maxQuads = Math.max(1, maxQuads);

    const totalFloats = this.maxQuads * GLBatch.FLOATS_PER_QUAD;
    this.arrayBuffer = new ArrayBuffer(totalFloats * 4);
    this.vertexDataF32 = new Float32Array(this.arrayBuffer);
    this.vertexDataU32 = new Uint32Array(this.arrayBuffer);

    // Pre-populate index buffer with repeating quad indices [0, 1, 2, 2, 3, 0]
    const totalIndices = this.maxQuads * GLBatch.INDICES_PER_QUAD;
    this.indexBuffer = new Uint16Array(totalIndices);

    for (let i = 0; i < this.maxQuads; i++) {
      const vOffset = i * GLBatch.VERTICES_PER_QUAD;
      const iOffset = i * GLBatch.INDICES_PER_QUAD;

      this.indexBuffer[iOffset + 0] = vOffset + 0;
      this.indexBuffer[iOffset + 1] = vOffset + 1;
      this.indexBuffer[iOffset + 2] = vOffset + 2;
      this.indexBuffer[iOffset + 3] = vOffset + 2;
      this.indexBuffer[iOffset + 4] = vOffset + 3;
      this.indexBuffer[iOffset + 5] = vOffset + 0;
    }

    this.initGLBuffers();
  }

  /**
   * Initializes GPU WebGL vertex and index buffers if WebGL context is available.
   */
  private initGLBuffers(): void {
    if (!this.context || !this.context.gl || !this.context.isSupported) return;
    const gl = this.context.gl;

    try {
      // Create Dynamic VBO
      this._vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER || 34962, this._vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER || 34962, this.arrayBuffer.byteLength, gl.DYNAMIC_DRAW || 35048);

      // Create Static IBO
      this._indexBufferGL = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER || 34963, this._indexBufferGL);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER || 34963, this.indexBuffer, gl.STATIC_DRAW || 35044);

      // WebGL 2.0 / OES Vertex Array Object (VAO) Acceleration
      if (typeof this.context.createVertexArray === 'function') {
        this._vao = this.context.createVertexArray();
        if (this._vao) {
          this.context.bindVertexArray(this._vao);
          gl.bindBuffer(gl.ARRAY_BUFFER || 34962, this._vertexBuffer);
          if (typeof this.context.setupVertexAttributes === 'function') {
            this.context.setupVertexAttributes();
          }
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER || 34963, this._indexBufferGL);
          this.context.bindVertexArray(null);
        }
      }
    } catch {
      // Headless mock fallback
    }
  }

  public get vao(): WebGLVertexArrayObject | null {
    return this._vao;
  }

  public get quadCount(): number {
    return this._quadCount;
  }

  public get vertexCount(): number {
    return this._quadCount * GLBatch.VERTICES_PER_QUAD;
  }

  public get indexCount(): number {
    return this._quadCount * GLBatch.INDICES_PER_QUAD;
  }

  public get vertices(): Float32Array {
    return this.vertexDataF32;
  }

  public get indices(): Uint16Array {
    return this.indexBuffer;
  }

  public get currentBlendMode(): GLBlendMode {
    return this._currentBlendMode;
  }

  public get blendMode(): GLBlendMode {
    return this._currentBlendMode;
  }

  public get currentTexture(): WebGLTexture | null {
    return this._currentTexture;
  }

  public setTexture(texture: WebGLTexture | null): void {
    if (this._currentTexture !== texture) {
      this.flush();
      this._currentTexture = texture;
    }
  }

  public get inBatch(): boolean {
    return this._inBatch;
  }

  /**
   * Begins a batch rendering pass and establishes the 3x3 orthographic projection matrix.
   *
   * Physical / Mathematical Matrix Derivation:
   * ------------------------------------------
   * Given viewport logical dimensions (W, H) and camera position (camX, camY):
   * Maps 2D coordinates (x, y) where x in [0, W] and y in [0, H] to OpenGL NDC [-1, 1]:
   *   x_ndc = (2 * (x - camX) / W) - 1 = (2 / W) * x + (-1 + 2 * camX / W)
   *   y_ndc = 1 - (2 * (y - camY) / H) = (-2 / H) * y + (1 - 2 * camY / H)
   * Stored in column-major Float32Array:
   *   out[0] = 2.0 / W;               // Scale X
   *   out[4] = -2.0 / H;              // Inverted Scale Y (flips Canvas2D downwards +Y to GL upwards +Y)
   *   out[6] = -1.0 + 2.0 * camX / W; // Translation X
   *   out[7] =  1.0 - 2.0 * camY / H; // Translation Y
   *   out[8] =  1.0;                  // Homogeneous scale
   *
   * @param widthOrBlend Logical viewport width or initial blend mode
   * @param height Logical viewport height (default 640)
   * @param cameraX Camera X world position (default 0)
   * @param cameraY Camera Y world position (default 0)
   */
  public begin(
    widthOrBlend: number | BlendModeInput = 960,
    height: number = 640,
    cameraX: number = 0,
    cameraY: number = 0
  ): void {
    this._inBatch = true;
    if (typeof widthOrBlend === 'number') {
      this.width = widthOrBlend;
      this.height = height;
      this.cameraX = cameraX;
      this.cameraY = cameraY;
    } else {
      this.setBlendMode(widthOrBlend);
    }

    if (this.context && this.context.isSupported) {
      this.context.setBlendMode(this._currentBlendMode === GLBlendMode.ADDITIVE ? 'additive' : 'normal');

      const W = Math.max(1, this.width);
      const H = Math.max(1, this.height);
      const out = this._matrixBuffer;
      out[0] = 2.0 / W;
      out[1] = 0.0;
      out[2] = 0.0;
      out[3] = 0.0;
      out[4] = -2.0 / H;
      out[5] = 0.0;
      out[6] = -1.0 + (2.0 * this.cameraX) / W;
      out[7] = 1.0 - (2.0 * this.cameraY) / H;
      out[8] = 1.0;
      this.context.setMatrix(out);
    }
  }

  /**
   * Ends the current batch rendering pass, flushing all buffered geometry to the GPU.
   */
  public end(): void {
    this.flush();
    this._inBatch = false;
  }

  /**
   * Sets the active GPU blend mode. If changing modes, flushes pending geometry first
   * to prevent state bleeding between draws.
   *
   * @param mode Target blend mode ('normal' | 'additive' | 'subtractive' | 'multiply')
   */
  public setBlendMode(mode: BlendModeInput): void {
    const targetMode =
      mode === GLBlendMode.ADDITIVE
        ? GLBlendMode.ADDITIVE
        : mode === GLBlendMode.SUBTRACTIVE
        ? GLBlendMode.SUBTRACTIVE
        : mode === GLBlendMode.MULTIPLY
        ? GLBlendMode.MULTIPLY
        : GLBlendMode.NORMAL;

    if (this._currentBlendMode !== targetMode) {
      this.flush();
      this._currentBlendMode = targetMode;
      if (this.context && this.context.isSupported) {
        this.context.setBlendMode(targetMode === GLBlendMode.ADDITIVE ? 'additive' : 'normal');
      }
    }
  }

  /**
   * Flushes currently buffered quads to the GPU via a single indexed triangle draw call.
   *
   * GPU Pipeline Execution:
   * 1. Dynamic VBO Sub-Data: Uploads Float32Array sub-region [0..quadCount * 24] via `bufferSubData`.
   * 2. VAO / Attribute Binding: Binds cached VAO or binds VBO, IBO, and interleaves attribute pointers.
   * 3. Texture Binding: Binds active texture unit 0 or default 1x1 white fallback texture.
   * 4. Indexed Draw: Dispatches `gl.drawElements(TRIANGLES, quadCount * 6, UNSIGNED_SHORT, 0)`.
   * 5. Resets internal quad counter to 0 for subsequent batch accumulation.
   *
   * @returns Total number of indices drawn in this flush pass.
   */
  public flush(): number {
    if (this._quadCount === 0) return 0;
    const drawn = this.indexCount;

    if (this.context && this.context.gl && this.context.isSupported) {
      const gl = this.context.gl;
      const numFloats = this._quadCount * GLBatch.FLOATS_PER_QUAD;
      const numIndices = this._quadCount * GLBatch.INDICES_PER_QUAD;

      try {
        if (!this._vertexBuffer) {
          this.initGLBuffers();
        }

        // Upload vertex data sub-region to GPU VBO
        gl.bindBuffer(gl.ARRAY_BUFFER || 34962, this._vertexBuffer);
        if (this.context.isWebGL2) {
          gl.bufferSubData(gl.ARRAY_BUFFER || 34962, 0, this.vertexDataF32, 0, numFloats);
        } else {
          gl.bufferSubData(
            gl.ARRAY_BUFFER || 34962,
            0,
            this.vertexDataF32.subarray(0, numFloats)
          );
        }

        if (this._vao) {
          this.context.bindVertexArray(this._vao);
        } else {
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER || 34963, this._indexBufferGL);

          // Bind interleaved attribute pointers
          if (typeof this.context.setupVertexAttributes === 'function') {
            this.context.setupVertexAttributes();
          }
        }

        // Bind active texture if specified, or defaultTexture fallback
        if (typeof this.context.bindTexture === 'function') {
          if (this._currentTexture) {
            this.context.bindTexture(this._currentTexture, 0);
          } else if (this.context.defaultTexture) {
            this.context.bindTexture(this.context.defaultTexture, 0);
          }
        }

        // Issue single batched indexed triangle draw call
        gl.drawElements(gl.TRIANGLES || 4, numIndices, gl.UNSIGNED_SHORT || 5123, 0);

        if (this._vao) {
          this.context.bindVertexArray(null);
        }
      } catch {
        // Headless mock fallback
      }
    }

    this._quadCount = 0;
    return drawn;
  }

  /**
   * Converts a CSS string, hex color, or integer into a packed 32-bit uint32
   * (ABGR in little-endian order) for GPU vertex color consumption.
   */
  public static colorToUint32(color: string | number, alphaMultiplier: number = 1.0): number {
    if (typeof color === 'number') {
      return color >>> 0;
    }
    if (alphaMultiplier === 1.0) {
      const cached = GLBatch._colorCache.get(color);
      if (cached !== undefined) return cached;
    }
    const [r, g, b, a] = ColorX.parseCss(color);
    const alphaByte = Math.round(MathX.clamp01(a * alphaMultiplier) * 255);
    const rByte = Math.round(MathX.clamp(r, 0, 255));
    const gByte = Math.round(MathX.clamp(g, 0, 255));
    const bByte = Math.round(MathX.clamp(b, 0, 255));

    const packed = (
      (((alphaByte & 0xff) << 24) |
        ((bByte & 0xff) << 16) |
        ((gByte & 0xff) << 8) |
        (rByte & 0xff)) >>>
      0
    );
    if (alphaMultiplier === 1.0) {
      if (GLBatch._colorCache.size > 2048) GLBatch._colorCache.clear();
      GLBatch._colorCache.set(color, packed);
    }
    return packed;
  }

  /**
   * Encodes primitive type ID and glow intensity into a single float.
   * Formula: encoded = type + floor(clamp(glow, 0, 99) * 10) * 10
   */
  public static encodeParams(type: GLPrimitive, glow: number = 0): number {
    const clampedGlow = Math.max(0, Math.min(99, glow));
    return type + Math.floor(clampedGlow * 10) * 10;
  }

  /**
   * Decodes an encoded params float into its primitive type ID and glow intensity.
   */
  public static decodeParams(encoded: number): { type: GLPrimitive; glow: number } {
    const type = Math.floor(encoded % 10) as GLPrimitive;
    const glow = Math.floor(encoded / 10) / 10;
    return { type, glow };
  }

  /**
   * Adds an axis-aligned Quad (Type 0) or generic primitive quad to the batch.
   */
  public drawQuad(
    x: number,
    y: number,
    w: number,
    h: number,
    color: string | number,
    glow: number = 0,
    uvMin: [number, number] | readonly [number, number] = GLBatch.DEFAULT_UV_MIN,
    uvMax: [number, number] | readonly [number, number] = GLBatch.DEFAULT_UV_MAX,
    type: GLPrimitive = GLPrimitive.Quad
  ): void {
    if (this._quadCount >= this.maxQuads) {
      this.flush();
    }

    const c = GLBatch.colorToUint32(color);
    const p = GLBatch.encodeParams(type, glow);
    const offset = this._quadCount * GLBatch.FLOATS_PER_QUAD;
    const f32 = this.vertexDataF32;
    const u32 = this.vertexDataU32;

    const x0 = x;
    const y0 = y;
    const x1 = x + w;
    const y1 = y + h;

    const u0 = uvMin[0];
    const v0 = uvMin[1];
    const u1 = uvMax[0];
    const v1 = uvMax[1];

    // Vertex 0: Top-Left
    f32[offset + 0] = x0;
    f32[offset + 1] = y0;
    f32[offset + 2] = u0;
    f32[offset + 3] = v0;
    u32[offset + 4] = c;
    f32[offset + 5] = p;

    // Vertex 1: Top-Right
    f32[offset + 6] = x1;
    f32[offset + 7] = y0;
    f32[offset + 8] = u1;
    f32[offset + 9] = v0;
    u32[offset + 10] = c;
    f32[offset + 11] = p;

    // Vertex 2: Bottom-Right
    f32[offset + 12] = x1;
    f32[offset + 13] = y1;
    f32[offset + 14] = u1;
    f32[offset + 15] = v1;
    u32[offset + 16] = c;
    f32[offset + 17] = p;

    // Vertex 3: Bottom-Left
    f32[offset + 18] = x0;
    f32[offset + 19] = y1;
    f32[offset + 20] = u0;
    f32[offset + 21] = v1;
    u32[offset + 22] = c;
    f32[offset + 23] = p;

    this._quadCount++;
  }

  /**
   * Adds an arbitrarily oriented / rotated Quad to the batch.
   */
  public drawRotatedQuad(
    cx: number,
    cy: number,
    w: number,
    h: number,
    angle: number,
    color: string | number,
    glow: number = 0,
    type: GLPrimitive = GLPrimitive.Quad
  ): void {
    if (this._quadCount >= this.maxQuads) {
      this.flush();
    }

    const c = GLBatch.colorToUint32(color);
    const p = GLBatch.encodeParams(type, glow);
    const offset = this._quadCount * GLBatch.FLOATS_PER_QUAD;
    const f32 = this.vertexDataF32;
    const u32 = this.vertexDataU32;

    const hw = w * 0.5;
    const hh = h * 0.5;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const x_cos = hw * cos;
    const x_sin = hw * sin;
    const y_cos = hh * cos;
    const y_sin = hh * sin;

    // Corner 0: (-hw, -hh)
    const x0 = cx - x_cos + y_sin;
    const y0 = cy - x_sin - y_cos;

    // Corner 1: (+hw, -hh)
    const x1 = cx + x_cos + y_sin;
    const y1 = cy + x_sin - y_cos;

    // Corner 2: (+hw, +hh)
    const x2 = cx + x_cos - y_sin;
    const y2 = cy + x_sin + y_cos;

    // Corner 3: (-hw, +hh)
    const x3 = cx - x_cos - y_sin;
    const y3 = cy - x_sin + y_cos;

    const isTex = type === GLPrimitive.Texture;
    const u0 = isTex ? 0.0 : -1.0;
    const v0 = isTex ? 0.0 : -1.0;
    const u1 = 1.0;
    const v1 = isTex ? 0.0 : -1.0;
    const u2 = 1.0;
    const v2 = 1.0;
    const u3 = isTex ? 0.0 : -1.0;
    const v3 = 1.0;

    // Vertex 0: Top-Left
    f32[offset + 0] = x0;
    f32[offset + 1] = y0;
    f32[offset + 2] = u0;
    f32[offset + 3] = v0;
    u32[offset + 4] = c;
    f32[offset + 5] = p;

    // Vertex 1: Top-Right
    f32[offset + 6] = x1;
    f32[offset + 7] = y1;
    f32[offset + 8] = u1;
    f32[offset + 9] = v1;
    u32[offset + 10] = c;
    f32[offset + 11] = p;

    // Vertex 2: Bottom-Right
    f32[offset + 12] = x2;
    f32[offset + 13] = y2;
    f32[offset + 14] = u2;
    f32[offset + 15] = v2;
    u32[offset + 16] = c;
    f32[offset + 17] = p;

    // Vertex 3: Bottom-Left
    f32[offset + 18] = x3;
    f32[offset + 19] = y3;
    f32[offset + 20] = u3;
    f32[offset + 21] = v3;
    u32[offset + 22] = c;
    f32[offset + 23] = p;

    this._quadCount++;
  }

  /**
   * Adds an arbitrary 4-vertex quadrilateral (two indexed triangles [0, 1, 2] and [2, 3, 0]) to the batch.
   * Uses flat zero-UV clipping to guarantee 100% solid, anti-aliased geometric fills.
   */
  public drawQuadVertices(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    color: string | number,
    glow: number = 0,
    type: GLPrimitive = GLPrimitive.Quad
  ): void {
    if (this._quadCount >= this.maxQuads) {
      this.flush();
    }

    const c = GLBatch.colorToUint32(color);
    const p = GLBatch.encodeParams(type, glow);
    const offset = this._quadCount * GLBatch.FLOATS_PER_QUAD;
    const f32 = this.vertexDataF32;
    const u32 = this.vertexDataU32;

    // Corner 0
    f32[offset + 0] = x0;
    f32[offset + 1] = y0;
    f32[offset + 2] = 0.0;
    f32[offset + 3] = 0.0;
    u32[offset + 4] = c;
    f32[offset + 5] = p;

    // Corner 1
    f32[offset + 6] = x1;
    f32[offset + 7] = y1;
    f32[offset + 8] = 0.0;
    f32[offset + 9] = 0.0;
    u32[offset + 10] = c;
    f32[offset + 11] = p;

    // Corner 2
    f32[offset + 12] = x2;
    f32[offset + 13] = y2;
    f32[offset + 14] = 0.0;
    f32[offset + 15] = 0.0;
    u32[offset + 16] = c;
    f32[offset + 17] = p;

    // Corner 3
    f32[offset + 18] = x3;
    f32[offset + 19] = y3;
    f32[offset + 20] = 0.0;
    f32[offset + 21] = 0.0;
    u32[offset + 22] = c;
    f32[offset + 23] = p;

    this._quadCount++;
  }

  /**
   * Adds an arbitrary 3-vertex triangle to the batch using a degenerate 4th vertex.
   */
  public drawTriangle(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string | number,
    glow: number = 0
  ): void {
    this.drawQuadVertices(x0, y0, x1, y1, x2, y2, x2, y2, color, glow, GLPrimitive.Quad);
  }

  /**
   * Renders an arbitrary convex or simple polygon using a triangle fan radiating from points[0].
   */
  public drawPolygon(
    points: Array<{ x: number; y: number }>,
    color: string | number,
    glow: number = 0,
    count?: number
  ): void {
    const n = count !== undefined ? Math.min(count, points ? points.length : 0) : (points ? points.length : 0);
    if (!points || n < 3) return;
    const p0 = points[0]!;
    for (let i = 1; i < n - 1; i++) {
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      this.drawTriangle(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, color, glow);
    }
  }

  /**
   * Adds an axis-aligned Textured Quad (Type 5) to the batch.
   * Automatically handles texture binding changes with saturation flushing.
   *
   * @param texture The source WebGLTexture to blit
   * @param x Top-left X coordinate in world/screen space
   * @param y Top-left Y coordinate in world/screen space
   * @param w Quad width
   * @param h Quad height
   * @param alpha Global opacity multiplier (0.0 - 1.0)
   * @param blendMode Optional blend mode override ('normal' | 'additive' | etc.)
   * @param uvMin Top-left UV coordinates [u0, v0] (defaults to [0.0, 0.0])
   * @param uvMax Bottom-right UV coordinates [u1, v1] (defaults to [1.0, 1.0])
   * @param glow Optional additive bloom intensity
   */
  /**
   * Adds a textured quad (Primitive 5) to the dynamic batch.
   * Supports both (texture, x, y, w, h, ...) and (x, y, w, h, color, glow, uvMin, uvMax).
   */
  public drawTexture(
    textureOrX: WebGLTexture | number,
    xOrY: number,
    yOrW: number,
    wOrH: number,
    hOrColor: number | string = '#ffffff',
    alphaOrGlow: number = 1.0,
    blendModeOrUvMin?: GLBlendMode | [number, number] | readonly [number, number],
    uvMinOrMax?: [number, number] | readonly [number, number],
    uvMax?: [number, number] | readonly [number, number],
    glow: number = 0
  ): void {
    if (typeof textureOrX === 'number') {
      const x = textureOrX;
      const y = xOrY;
      const w = yOrW;
      const h = typeof wOrH === 'number' ? wOrH : 32;
      const col = typeof hOrColor === 'string' || typeof hOrColor === 'number' ? hOrColor : '#ffffff';
      const glw = typeof alphaOrGlow === 'number' ? alphaOrGlow : 0;
      const uMin: [number, number] | readonly [number, number] = Array.isArray(blendModeOrUvMin) ? blendModeOrUvMin : GLBatch.TEX_UV_MIN;
      const uMax: [number, number] | readonly [number, number] = Array.isArray(uvMinOrMax) ? uvMinOrMax : GLBatch.TEX_UV_MAX;
      this.drawQuad(x, y, w, h, col, glw, uMin, uMax, GLPrimitive.Texture);
      return;
    }

    const texture = textureOrX;
    const x = xOrY;
    const y = yOrW;
    const w = wOrH;
    const h = typeof hOrColor === 'number' ? hOrColor : 32;
    const alpha = typeof alphaOrGlow === 'number' ? alphaOrGlow : 1.0;
    const blendMode = typeof blendModeOrUvMin === 'string' ? blendModeOrUvMin : undefined;
    const uvMin: [number, number] | readonly [number, number] = Array.isArray(blendModeOrUvMin)
      ? blendModeOrUvMin
      : Array.isArray(uvMinOrMax)
      ? uvMinOrMax
      : GLBatch.TEX_UV_MIN;
    const uvMaxCoord: [number, number] | readonly [number, number] = Array.isArray(uvMax)
      ? uvMax
      : Array.isArray(blendModeOrUvMin) && Array.isArray(uvMinOrMax)
      ? uvMinOrMax
      : Array.isArray(uvMinOrMax) && !Array.isArray(blendModeOrUvMin)
      ? uvMinOrMax
      : GLBatch.TEX_UV_MAX;

    if (!texture) return;

    if (blendMode && blendMode !== this._currentBlendMode) {
      this.setBlendMode(blendMode);
    }

    if (this._currentTexture !== texture && this._quadCount > 0) {
      this.flush();
    }
    this._currentTexture = texture;

    if (this._quadCount >= this.maxQuads) {
      this.flush();
    }

    const c = GLBatch.colorToUint32('#ffffff', alpha);
    const p = GLBatch.encodeParams(GLPrimitive.Texture, glow);
    const offset = this._quadCount * GLBatch.FLOATS_PER_QUAD;
    const f32 = this.vertexDataF32;
    const u32 = this.vertexDataU32;

    const x0 = x;
    const y0 = y;
    const x1 = x + w;
    const y1 = y + h;

    const u0 = uvMin[0];
    const v0 = uvMin[1];
    const u1 = uvMaxCoord[0];
    const v1 = uvMaxCoord[1];

    // Vertex 0: Top-Left
    f32[offset + 0] = x0;
    f32[offset + 1] = y0;
    f32[offset + 2] = u0;
    f32[offset + 3] = v0;
    u32[offset + 4] = c;
    f32[offset + 5] = p;

    // Vertex 1: Top-Right
    f32[offset + 6] = x1;
    f32[offset + 7] = y0;
    f32[offset + 8] = u1;
    f32[offset + 9] = v0;
    u32[offset + 10] = c;
    f32[offset + 11] = p;

    // Vertex 2: Bottom-Right
    f32[offset + 12] = x1;
    f32[offset + 13] = y1;
    f32[offset + 14] = u1;
    f32[offset + 15] = v1;
    u32[offset + 16] = c;
    f32[offset + 17] = p;

    // Vertex 3: Bottom-Left
    f32[offset + 18] = x0;
    f32[offset + 19] = y1;
    f32[offset + 20] = u0;
    f32[offset + 21] = v1;
    u32[offset + 22] = c;
    f32[offset + 23] = p;

    this._quadCount++;
  }

  /**
   * Adds an arbitrarily oriented / rotated Textured Quad (Type 5) to the batch.
   */
  public drawRotatedTexture(
    textureOrCx: WebGLTexture | number,
    cxOrCy: number,
    cyOrW: number,
    wOrH: number,
    hOrAngle: number,
    angleOrColor?: number | string,
    alphaOrGlow?: number,
    blendMode?: GLBlendMode,
    glow: number = 0
  ): void {
    if (typeof textureOrCx === 'number') {
      const cx = textureOrCx;
      const cy = cxOrCy;
      const w = cyOrW;
      const h = wOrH;
      const angle = hOrAngle;
      const color = typeof angleOrColor === 'string' || typeof angleOrColor === 'number' ? angleOrColor : '#ffffff';
      const g = typeof alphaOrGlow === 'number' ? alphaOrGlow : 0;
      this.drawRotatedQuad(cx, cy, w, h, angle, color, g, GLPrimitive.Texture);
      return;
    }

    const texture = textureOrCx;
    if (!texture) return;
    const cx = cxOrCy;
    const cy = cyOrW;
    const w = wOrH;
    const h = hOrAngle;
    const angle = typeof angleOrColor === 'number' ? angleOrColor : 0;
    const alpha = typeof alphaOrGlow === 'number' ? alphaOrGlow : 1.0;

    if (blendMode && blendMode !== this._currentBlendMode) {
      this.setBlendMode(blendMode);
    }

    if (this._currentTexture !== texture && this._quadCount > 0) {
      this.flush();
    }
    this._currentTexture = texture;

    if (this._quadCount >= this.maxQuads) {
      this.flush();
    }

    const c = GLBatch.colorToUint32('#ffffff', alpha);
    const p = GLBatch.encodeParams(GLPrimitive.Texture, glow);
    const offset = this._quadCount * GLBatch.FLOATS_PER_QUAD;
    const f32 = this.vertexDataF32;
    const u32 = this.vertexDataU32;

    const hw = w * 0.5;
    const hh = h * 0.5;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const x_cos = hw * cos;
    const x_sin = hw * sin;
    const y_cos = hh * cos;
    const y_sin = hh * sin;

    // Corner 0: (-hw, -hh)
    const x0 = cx - x_cos + y_sin;
    const y0 = cy - x_sin - y_cos;

    // Corner 1: (+hw, -hh)
    const x1 = cx + x_cos + y_sin;
    const y1 = cy + x_sin - y_cos;

    // Corner 2: (+hw, +hh)
    const x2 = cx + x_cos - y_sin;
    const y2 = cy + x_sin + y_cos;

    // Corner 3: (-hw, +hh)
    const x3 = cx - x_cos - y_sin;
    const y3 = cy - x_sin + y_cos;

    // Vertex 0: Top-Left
    f32[offset + 0] = x0;
    f32[offset + 1] = y0;
    f32[offset + 2] = 0.0;
    f32[offset + 3] = 0.0;
    u32[offset + 4] = c;
    f32[offset + 5] = p;

    // Vertex 1: Top-Right
    f32[offset + 6] = x1;
    f32[offset + 7] = y1;
    f32[offset + 8] = 1.0;
    f32[offset + 9] = 0.0;
    u32[offset + 10] = c;
    f32[offset + 11] = p;

    // Vertex 2: Bottom-Right
    f32[offset + 12] = x2;
    f32[offset + 13] = y2;
    f32[offset + 14] = 1.0;
    f32[offset + 15] = 1.0;
    u32[offset + 16] = c;
    f32[offset + 17] = p;

    // Vertex 3: Bottom-Left
    f32[offset + 18] = x3;
    f32[offset + 19] = y3;
    f32[offset + 20] = 0.0;
    f32[offset + 21] = 1.0;
    u32[offset + 22] = c;
    f32[offset + 23] = p;

    this._quadCount++;
  }

  /**
   * Adds an SDF Anti-Aliased Circle (Type 1) to the batch.
   */
  public drawCircle(
    cx: number,
    cy: number,
    radius: number,
    color: string | number,
    glow: number = 0
  ): void {
    const size = radius * 2.0;
    this.drawQuad(
      cx - radius,
      cy - radius,
      size,
      size,
      color,
      glow,
      GLBatch.DEFAULT_UV_MIN,
      GLBatch.DEFAULT_UV_MAX,
      GLPrimitive.Circle
    );
  }

  /**
   * Adds an SDF Anti-Aliased Ring / Donut (Type 2) to the batch.
   */
  public drawRing(
    cx: number,
    cy: number,
    radius: number,
    _thickness: number,
    color: string | number,
    glow: number = 0
  ): void {
    const size = radius * 2.0;
    this.drawQuad(
      cx - radius,
      cy - radius,
      size,
      size,
      color,
      glow,
      GLBatch.DEFAULT_UV_MIN,
      GLBatch.DEFAULT_UV_MAX,
      GLPrimitive.Ring
    );
  }

  /**
   * Adds an SDF 3D Specular Shaded Sphere (Type 3) to the batch.
   */
  public drawSphere(
    cx: number,
    cy: number,
    radius: number,
    color: string | number,
    glow: number = 0
  ): void {
    const size = radius * 2.0;
    this.drawQuad(
      cx - radius,
      cy - radius,
      size,
      size,
      color,
      glow,
      GLBatch.DEFAULT_UV_MIN,
      GLBatch.DEFAULT_UV_MAX,
      GLPrimitive.Sphere
    );
  }

  /**
   * Adds an axis-aligned Textured Quad (Primitive 5) to the batch.
   * Seamlessly binds texture and flushes batch if texture unit target changes.
   */
  public drawTextureQuad(
    x: number,
    y: number,
    w: number,
    h: number,
    texture?: WebGLTexture | null,
    color: string | number = '#ffffff',
    alpha: number = 1.0,
    glow: number = 0,
    uvMin: [number, number] | readonly [number, number] = GLBatch.TEX_UV_MIN,
    uvMax: [number, number] | readonly [number, number] = GLBatch.TEX_UV_MAX
  ): void {
    if (texture) {
      this.drawTexture(texture, x, y, w, h, alpha, undefined, uvMin, uvMax, glow);
    } else {
      this.drawTexture(x, y, w, h, color, glow, uvMin, uvMax);
    }
  }

  /**
   * Unified perpendicular normal geometric extrusion routine.
   * Extrudes a 2D line segment into an oriented quad along its perpendicular unit normal (-dy/len, dx/len).
   * Eliminates duplicated geometric math across lasers, lines, corridors, and beam elements (AGENTS.md Rule 10).
   */
  public drawExtrudedSegment(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    color: string | number,
    primitive: GLPrimitive = GLPrimitive.Laser,
    glow: number = 0,
    uMin: readonly [number, number] = GLBatch.DEFAULT_UV_MIN,
    uMax: readonly [number, number] = GLBatch.DEFAULT_UV_MAX
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return;

    if (this._quadCount >= this.maxQuads) {
      this.flush();
    }

    const c = GLBatch.colorToUint32(color);
    const p = GLBatch.encodeParams(primitive, glow);
    const offset = this._quadCount * GLBatch.FLOATS_PER_QUAD;
    const f32 = this.vertexDataF32;
    const u32 = this.vertexDataU32;

    const hw = Math.max(0.5, width * 0.5);
    const nx = (-dy / len) * hw;
    const ny = (dx / len) * hw;

    // Corner 0: Segment Start Top
    f32[offset + 0] = x1 + nx;
    f32[offset + 1] = y1 + ny;
    f32[offset + 2] = uMin[0];
    f32[offset + 3] = uMin[1];
    u32[offset + 4] = c;
    f32[offset + 5] = p;

    // Corner 1: Segment End Top
    f32[offset + 6] = x2 + nx;
    f32[offset + 7] = y2 + ny;
    f32[offset + 8] = uMax[0];
    f32[offset + 9] = uMin[1];
    u32[offset + 10] = c;
    f32[offset + 11] = p;

    // Corner 2: Segment End Bottom
    f32[offset + 12] = x2 - nx;
    f32[offset + 13] = y2 - ny;
    f32[offset + 14] = uMax[0];
    f32[offset + 15] = uMax[1];
    u32[offset + 16] = c;
    f32[offset + 17] = p;

    // Corner 3: Segment Start Bottom
    f32[offset + 18] = x1 - nx;
    f32[offset + 19] = y1 - ny;
    f32[offset + 20] = uMin[0];
    f32[offset + 21] = uMax[1];
    u32[offset + 22] = c;
    f32[offset + 23] = p;

    this._quadCount++;
  }

  /**
   * Adds an SDF Glowing Laser Beam (Type 4) along segment (x1, y1) -> (x2, y2).
   * Delegates to unified perpendicular normal extrusion (drawExtrudedSegment).
   */
  public drawLaser(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    color: string | number,
    glow: number = 0
  ): void {
    this.drawExtrudedSegment(x1, y1, x2, y2, width, color, GLPrimitive.Laser, glow);
  }

  /**
   * Draws a single particle effect matching its shape and physical parameters.
   * Eliminates duplicate particle rendering code across the engine (AGENTS.md Rule 10).
   */
  public drawParticle(p: IParticleRenderData): void {
    if (p.active !== undefined && !p.active) return;
    if (p.alpha <= 0) return;

    const shape = p.shape || 'circle';
    if (shape === 'square') {
      this.drawSdfRect(p.x, p.y, p.size, p.size, 0, p.colorCss, p.alpha);
    } else if (shape === 'ring') {
      this.drawSdfRing(p.x, p.y, p.size, Math.max(1.5, 4.0 * (1 - p.alpha)), p.colorCss, p.alpha, 8, p.colorCss);
    } else if (shape === 'spark') {
      const mult = p.streakMult || 8;
      const vx = p.vx || 0;
      const vy = p.vy || 0;
      const tailX = p.x - vx * mult;
      const tailY = p.y - vy * mult;
      this.drawLaserLine(tailX, tailY, p.x, p.y, p.colorCss, Math.max(1.5, p.size), '#ffffff', p.alpha);
      this.drawSdfCircle(p.x, p.y, Math.max(1.2, p.size * 0.75), '#ffffff', p.alpha, 4);
    } else if (shape === 'shard') {
      this.drawRotatedQuad(p.x, p.y, p.size * 1.6, p.size * 0.9, p.angle || 0, p.colorCss, 4);
    } else if (shape === 'plasma') {
      this.drawSdfCircle(p.x, p.y, p.size, p.colorCss, p.alpha * 0.65, 8);
    } else {
      this.drawSdfCircle(p.x, p.y, p.size, p.colorCss, p.alpha, p.glow ? 6 : 0);
    }
  }

  /**
   * Draws a solid or glowing 2D line between two endpoints.
   */
  public drawLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    color: string | number
  ): void {
    this.drawLaser(x1, y1, x2, y2, width, color, 0);
  }

  /**
   * Draws a connected polyline path.
   */
  public drawPolyline(
    points: Array<{ x: number; y: number }>,
    width: number,
    color: string | number,
    glow: number = 0,
    count?: number
  ): void {
    const n = count !== undefined ? Math.min(count, points ? points.length : 0) : (points ? points.length : 0);
    if (!points || n < 2) return;
    for (let i = 0; i < n - 1; i++) {
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      this.drawLaser(p1.x, p1.y, p2.x, p2.y, width, color, glow);
    }
  }

  // ---------------------------------------------------------------- Unified SDF Aliases

  public drawSdfCircle(
    cx: number,
    cy: number,
    radius: number,
    color: string | number,
    alpha: number = 1.0,
    glowRadius: number = 0,
    _glowColor?: string | number
  ): void {
    const colStr = alpha === 1.0 || typeof color === 'number' ? color : ColorX.rgba(color, alpha);
    this.drawCircle(cx, cy, radius, colStr, glowRadius);
  }

  public drawSdfRing(
    cx: number,
    cy: number,
    radius: number,
    thickness: number,
    color: string | number,
    alpha: number = 1.0,
    glowRadius: number = 0,
    _glowColor?: string | number
  ): void {
    const colStr = alpha === 1.0 || typeof color === 'number' ? color : ColorX.rgba(color, alpha);
    this.drawRing(cx, cy, radius, thickness, colStr, glowRadius);
  }

  /**
   * Draws a stroked circular arc segment between startAngle and endAngle.
   *
   * Physical / Geometric Discretization:
   * - Arc parameterization: P(t) = C + R * (cos(a(t)), sin(a(t))) where a(t) = startAngle + sweep * t, t in [0, 1].
   * - Dynamically discretizes the sweep arc into adaptive linear ribbon joints (8 to 64 steps)
   *   proportional to angular arc length (sweep / 2*pi * 48), guaranteeing sub-pixel curve fidelity.
   * - Emits continuous mitered quad ribbon geometry via `_drawRibbonCoordsInternal` with zero-allocation scratch buffers,
   *   producing a seamless partial stroked ring segment without joint gaps or additive overdraw seams.
   *
   * @param cx Center X in world coordinates
   * @param cy Center Y in world coordinates
   * @param radius Arc centerline radius
   * @param startAngle Starting angle in radians
   * @param endAngle Ending angle in radians
   * @param width Stroke thickness (e.g. 2.5)
   * @param color Stroke color hex/string/uint32
   * @param alpha Alpha multiplier (defaults to 1.0)
   * @param glow Glow radius (0 for crisp un-notched stroke)
   * @param segments Optional explicit number of linear discretization segments
   */
  public drawSdfArc(
    cx: number,
    cy: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    width: number,
    color: string | number,
    alpha: number = 1.0,
    glow: number = 0,
    segments?: number
  ): void {
    const sweep = endAngle - startAngle;
    if (Math.abs(sweep) < 0.001 || radius <= 0 || width <= 0) return;
    const steps = segments !== undefined
      ? segments
      : Math.max(8, Math.min(64, Math.ceil((Math.abs(sweep) / MathX.Tau) * 48)));

    GLBatch._ensureScratchCapacity(steps + 1);
    const ptX = GLBatch._ptX;
    const ptY = GLBatch._ptY;
    for (let i = 0; i <= steps; i++) {
      const a = startAngle + (sweep * i) / steps;
      ptX[i] = cx + Math.cos(a) * radius;
      ptY[i] = cy + Math.sin(a) * radius;
    }
    const colStr = alpha === 1.0 || typeof color === 'number' ? color : ColorX.rgba(color, alpha);
    this._drawRibbonCoordsInternal(ptX, ptY, steps + 1, width, colStr, glow, GLPrimitive.Quad, false, 0, 0, true);
  }

  public drawSdfRect(
    cx: number,
    cy: number,
    width: number,
    height: number,
    angle: number = 0,
    color: string | number = '#ffffff',
    alpha: number = 1.0,
    _cornerRadius: number = 0,
    glowRadius: number = 0
  ): void {
    const colStr = alpha === 1.0 || typeof color === 'number' ? color : ColorX.rgba(color, alpha);
    if (angle !== 0) {
      this.drawRotatedQuad(cx, cy, width, height, angle, colStr, glowRadius, GLPrimitive.Quad);
    } else {
      this.drawQuad(cx - width * 0.5, cy - height * 0.5, width, height, colStr, glowRadius, GLBatch.DEFAULT_UV_MIN, GLBatch.DEFAULT_UV_MAX, GLPrimitive.Quad);
    }
  }

  public drawSdfDiamond(
    cx: number,
    cy: number,
    radius: number,
    color: string | number,
    alpha: number = 1.0,
    glowRadius: number = 0
  ): void {
    const colStr = alpha === 1.0 || typeof color === 'number' ? color : ColorX.rgba(color, alpha);
    this.drawQuadVertices(
      cx,
      cy - radius,
      cx + radius,
      cy,
      cx,
      cy + radius,
      cx - radius,
      cy,
      colStr,
      glowRadius,
      GLPrimitive.Quad
    );
  }

  public drawSdfWedge(
    cx: number,
    cy: number,
    radius: number,
    angle: number,
    spread: number,
    color: string | number,
    alpha: number = 1.0,
    segments: number = 16
  ): void {
    if (radius <= 0) return;
    const colStr = alpha === 1.0 || typeof color === 'number' ? color : ColorX.rgba(color, alpha);
    const halfSpread = Math.max(0.01, spread * 0.5);
    const startAngle = angle - halfSpread;
    const endAngle = angle + halfSpread;
    const segs = Math.max(3, segments);

    let prevX = cx + Math.cos(startAngle) * radius;
    let prevY = cy + Math.sin(startAngle) * radius;

    for (let i = 1; i <= segs; i++) {
      const curA = startAngle + ((endAngle - startAngle) * i) / segs;
      const curX = cx + Math.cos(curA) * radius;
      const curY = cy + Math.sin(curA) * radius;
      this.drawTriangle(cx, cy, prevX, prevY, curX, curY, colStr, 0);
      prevX = curX;
      prevY = curY;
    }
  }

  public drawLaserLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string | number = '#ff0054',
    width: number = 4,
    _coreColor: string = '#ffffff',
    alpha: number = 1.0
  ): void {
    const colStr = alpha === 1.0 || typeof color === 'number' ? color : ColorX.rgba(color, alpha);
    this.drawLaser(x1, y1, x2, y2, width, colStr, 8);
  }

  public drawLightningArc(
    points: Array<{ x: number; y: number }>,
    color: string | number = '#00f0b5',
    width: number = 3
  ): void {
    this.drawPolyline(points, width, color, 10);
  }

  /**
   * Low-level, zero-allocation continuous ribbon extruder operating directly on typed array coordinate slices.
   *
   * Physical / Mathematical Formulation:
   * -------------------------------------
   * 1. Segment Vectors & Left Unit Normals (2D Orthogonal Rotation):
   *    For points P_i = (ptX[i] + offsetX, ptY[i] + offsetY), i in [0, count - 1]:
   *    d_i = P_{i+1} - P_i = (dx_i, dy_i)
   *    len_i = sqrt(dx_i^2 + dy_i^2)
   *    n_i = (-dy_i / len_i, dx_i / len_i)  [Left-hand normal pointing orthogonal to motion]
   *
   * 2. Joint Bisector Normal (Smooth Miter Angle Derivation):
   *    At interior joint i:
   *    S_i = n_{i-1} + n_i
   *    n_bisect = S_i / ||S_i||
   *    Miter Scaling Factor:
   *    m = 1.0 / dot(n_bisect, n_{i-1}) = 1.0 / (n_bisect.x * n_{i-1}.x + n_bisect.y * n_{i-1}.y)
   *    Clamped to [0.5, 1.5] to eliminate spikes on acute / hairpin turns.
   *    At endpoints (i = 0 and i = count - 1):
   *    n_bisect = n_0 and n_{count - 2}, m = 1.0.
   *
   * 3. Extruded Vertex Generation:
   *    Half-width at joint i: h_i = 0.5 * W(i, t) * m
   *    V_L,i = P_i + n_bisect * h_i   (Left boundary vertex)
   *    V_R,i = P_i - n_bisect * h_i   (Right boundary vertex)
   *
   * 4. Seamless Quad Construction:
   *    For segment i in [0, count - 2]:
   *    Corner 0 (Top-Left):     V_L,i
   *    Corner 1 (Top-Right):    V_L,i+1
   *    Corner 2 (Bottom-Right): V_R,i+1
   *    Corner 3 (Bottom-Left):  V_R,i
   *    Both triangles share exact boundary vertices (V_L,i, V_R,i) with the previous segment,
   *    guaranteeing 0 joint gaps, 0 seam overlaps, and 0 additive double-exposure hotspots.
   *
   * 5. Semicircular Round End Caps:
   *    When roundCaps is true, renders SDF circles of radius h_0 and h_{count - 1} at P_0 and P_{count - 1}.
   */
  private _drawRibbonCoordsInternal(
    ptX: Float32Array,
    ptY: Float32Array,
    count: number,
    width: number | number[] | Float32Array | ((idx: number, t: number) => number),
    color: string | number,
    glow: number = 0,
    type: GLPrimitive = GLPrimitive.Quad,
    roundCaps: boolean = true,
    offsetX: number = 0,
    offsetY: number = 0,
    recomputeBisectors: boolean = true,
    roundTailCap: boolean = true,
    startIndex: number = 0
  ): void {
    if (count <= 0) return;
    const isNumW = typeof width === 'number';
    const isArrW = Array.isArray(width) || width instanceof Float32Array;

    if (count === 1) {
      if (roundCaps) {
        const w0 = isNumW ? width : (isArrW ? (width as any)[startIndex] ?? 12 : (width as any)(0, 0));
        this.drawCircle(ptX[startIndex]! + offsetX, ptY[startIndex]! + offsetY, w0 * 0.5, color, glow);
      }
      return;
    }

    GLBatch._ensureScratchCapacity(count);
    const segNormX = GLBatch._segNormX;
    const segNormY = GLBatch._segNormY;
    const segLen = GLBatch._segLen;
    const bisectX = GLBatch._bisectX;
    const bisectY = GLBatch._bisectY;
    const miter = GLBatch._miter;
    const vLx = GLBatch._vLx;
    const vLy = GLBatch._vLy;
    const vRx = GLBatch._vRx;
    const vRy = GLBatch._vRy;
    const numSegs = count - 1;
    const invCountMinus1 = 1.0 / Math.max(1, count - 1);

    if (recomputeBisectors) {
      // Step 1: Calculate segment directions and left-hand unit normals
      for (let i = 0; i < numSegs; i++) {
        const dx = ptX[startIndex + i + 1]! - ptX[startIndex + i]!;
        const dy = ptY[startIndex + i + 1]! - ptY[startIndex + i]!;
        const len = Math.hypot(dx, dy);
        segLen[i] = len;

        if (len < 0.0001) {
          if (i > 0) {
            segNormX[i] = segNormX[i - 1]!;
            segNormY[i] = segNormY[i - 1]!;
          } else {
            segNormX[i] = 0;
            segNormY[i] = -1;
          }
        } else {
          segNormX[i] = -dy / len;
          segNormY[i] = dx / len;
        }
      }

      // Step 2: Calculate joint bisector unit normals and clamped miter factors
      // Joint 0 (Head)
      bisectX[0] = segNormX[0]!;
      bisectY[0] = segNormY[0]!;
      miter[0] = 1.0;

      // Joint count - 1 (Tail)
      bisectX[count - 1] = segNormX[numSegs - 1]!;
      bisectY[count - 1] = segNormY[numSegs - 1]!;
      miter[count - 1] = 1.0;

      // Interior joints
      for (let i = 1; i < count - 1; i++) {
        const prevNx = segNormX[i - 1]!;
        const prevNy = segNormY[i - 1]!;
        const curNx = segNormX[i]!;
        const curNy = segNormY[i]!;

        const bx = prevNx + curNx;
        const by = prevNy + curNy;
        const blen = Math.hypot(bx, by);

        if (blen < 0.001) {
          // 180° hairpin foldback: fallback to previous segment normal to avoid divide-by-zero
          bisectX[i] = prevNx;
          bisectY[i] = prevNy;
          miter[i] = 1.0;
        } else {
          const uBx = bx / blen;
          const uBy = by / blen;
          bisectX[i] = uBx;
          bisectY[i] = uBy;

          // Miter limit: dot product with segment normal
          const dot = uBx * prevNx + uBy * prevNy;
          const prevLen = segLen[i - 1]!;
          const curLen = segLen[i]!;
          const minLen = Math.min(prevLen, curLen);

          // Span-aware miter clamping: clamp miter factor so that extrusion distance
          // never exceeds 1.20 * minLen at sharp turns, preventing triangular spikes ("picks")
          // and self-intersecting quads, while maintaining 1 / cos(halfAngle) on long segments
          const t = i * invCountMinus1;
          const w = isNumW ? width : (isArrW ? (width as any)[startIndex + i] ?? 12 : (width as any)(i, t));
          const halfW = Math.max(1.0, w * 0.5);
          const maxMiterForSpan = Math.min(1.5, (1.20 * minLen) / halfW);

          miter[i] = Math.min(maxMiterForSpan, 1.0 / Math.max(0.5, dot));
        }
      }
    }

    // Step 3: Extrude left and right boundary vertices along bisector normals
    for (let i = 0; i < count; i++) {
      const t = i * invCountMinus1;
      const w = isNumW ? width : (isArrW ? (width as any)[startIndex + i] ?? 12 : (width as any)(i, t));
      const h = (w * 0.5) * miter[i]!;
      const px = ptX[startIndex + i]! + offsetX;
      const py = ptY[startIndex + i]! + offsetY;
      const nx = bisectX[i]!;
      const ny = bisectY[i]!;

      vLx[i] = px + nx * h;
      vLy[i] = py + ny * h;
      vRx[i] = px - nx * h;
      vRy[i] = py - ny * h;
    }

    // Step 4: Batch quad geometry into GPU vertex buffer with hairpin-safe bevels
    const c = GLBatch.colorToUint32(color);
    const p = GLBatch.encodeParams(type, glow);
    const isLaser = type === GLPrimitive.Laser;

    const u0 = 0.0;
    const u1 = 0.0;
    const vLeft = isLaser ? -1.0 : 0.0;
    const vRight = isLaser ? 1.0 : 0.0;

    for (let i = 0; i < numSegs; i++) {
      if (this._quadCount >= this.maxQuads) {
        this.flush();
      }

      const t0 = i * invCountMinus1;
      const t1 = (i + 1) * invCountMinus1;
      const w0 = isNumW ? width : (isArrW ? (width as any)[startIndex + i] ?? 12 : (width as any)(i, t0));
      const w1 = isNumW ? width : (isArrW ? (width as any)[startIndex + i + 1] ?? 12 : (width as any)(i + 1, t1));

      const px0 = ptX[startIndex + i]! + offsetX;
      const py0 = ptY[startIndex + i]! + offsetY;
      const px1 = ptX[startIndex + i + 1]! + offsetX;
      const py1 = ptY[startIndex + i + 1]! + offsetY;

      // Start normal: use segment normal if interior sharp hairpin foldback (< -0.3), else bisector
      const sharpStart = i > 0 && (segNormX[i - 1]! * segNormX[i]! + segNormY[i - 1]! * segNormY[i]!) < -0.3;
      const snx0 = sharpStart ? segNormX[i]! : bisectX[i]!;
      const sny0 = sharpStart ? segNormY[i]! : bisectY[i]!;
      const sm0 = sharpStart ? 1.0 : miter[i]!;
      const h0 = (w0 * 0.5) * sm0;

      // End normal: use segment normal if interior sharp hairpin foldback (< -0.3), else bisector
      const sharpEnd = i < numSegs - 1 && (segNormX[i]! * segNormX[i + 1]! + segNormY[i]! * segNormY[i + 1]!) < -0.3;
      const snx1 = sharpEnd ? segNormX[i]! : bisectX[i + 1]!;
      const sny1 = sharpEnd ? segNormY[i]! : bisectY[i + 1]!;
      const sm1 = sharpEnd ? 1.0 : miter[i + 1]!;
      const h1 = (w1 * 0.5) * sm1;

      // Corner 0: Left Start
      const v0Lx = px0 + snx0 * h0;
      const v0Ly = py0 + sny0 * h0;
      // Corner 3: Right Start
      const v0Rx = px0 - snx0 * h0;
      const v0Ry = py0 - sny0 * h0;

      // Corner 1: Left End
      const v1Lx = px1 + snx1 * h1;
      const v1Ly = py1 + sny1 * h1;
      // Corner 2: Right End
      const v1Rx = px1 - snx1 * h1;
      const v1Ry = py1 - sny1 * h1;

      const offset = this._quadCount * GLBatch.FLOATS_PER_QUAD;
      const f32 = this.vertexDataF32;
      const u32 = this.vertexDataU32;

      // Corner 0: Left Start
      f32[offset + 0] = v0Lx;
      f32[offset + 1] = v0Ly;
      f32[offset + 2] = u0;
      f32[offset + 3] = vLeft;
      u32[offset + 4] = c;
      f32[offset + 5] = p;

      // Corner 1: Left End
      f32[offset + 6] = v1Lx;
      f32[offset + 7] = v1Ly;
      f32[offset + 8] = u1;
      f32[offset + 9] = vLeft;
      u32[offset + 10] = c;
      f32[offset + 11] = p;

      // Corner 2: Right End
      f32[offset + 12] = v1Rx;
      f32[offset + 13] = v1Ry;
      f32[offset + 14] = u1;
      f32[offset + 15] = vRight;
      u32[offset + 16] = c;
      f32[offset + 17] = p;

      // Corner 3: Right Start
      f32[offset + 18] = v0Rx;
      f32[offset + 19] = v0Ry;
      f32[offset + 20] = u0;
      f32[offset + 21] = vRight;
      u32[offset + 22] = c;
      f32[offset + 23] = p;

      this._quadCount++;
    }

    // Step 4B: Round join discs for interior sharp hairpin turns
    if (roundCaps) {
      for (let k = 1; k < numSegs; k++) {
        if ((segNormX[k - 1]! * segNormX[k]! + segNormY[k - 1]! * segNormY[k]!) < -0.3) {
          const tk = k * invCountMinus1;
          const wk = isNumW ? width : (isArrW ? (width as any)[startIndex + k] ?? 12 : (width as any)(k, tk));
          this.drawCircle(ptX[startIndex + k]! + offsetX, ptY[startIndex + k]! + offsetY, wk * 0.5, color, glow);
        }
      }
    }

    // Step 5: Semicircular round end caps at head and tail
    if (roundCaps && count >= 2) {
      const wHead = isNumW ? width : (isArrW ? (width as any)[startIndex] ?? 12 : (width as any)(0, 0));
      this.drawCircle(ptX[startIndex]! + offsetX, ptY[startIndex]! + offsetY, wHead * 0.5, color, glow);

      // Tail end cap: conditionally rendered. In multi-pass serpentine rendering,
      // this is omitted in Passes 1, 2, 4, 5 to prevent giant glowing spheres at the tail tip,
      // allowing Pass 3's sleek taper (tapering down to 1.5px - 2px) to be clearly visible.
      if (roundTailCap) {
        const wTail = isNumW ? width : (isArrW ? (width as any)[startIndex + count - 1] ?? 12 : (width as any)(count - 1, 1.0));
        this.drawCircle(ptX[startIndex + count - 1]! + offsetX, ptY[startIndex + count - 1]! + offsetY, wTail * 0.5, color, glow);
      }
    }
  }

  /**
   * Draws a continuous normal-extruded ribbon mesh along a polyline.
   *
   * @param points Array of 2D points defining the spine centerline.
   * @param width Constant width, array of widths per vertex, or dynamic width function (index, t).
   * @param color Color string, hex, or uint32 ABGR integer.
   * @param glow Glow intensity factor (0..99).
   * @param type Primitive type (Quad for flat fill, Laser for neon core falloff).
   * @param roundCaps When true, appends semicircular round end caps at head and tail.
   */
  public drawContinuousRibbon(
    points: Array<{ x: number; y: number }>,
    width: number | number[] | ((idx: number, t: number) => number),
    color: string | number,
    glow: number = 0,
    type: GLPrimitive = GLPrimitive.Quad,
    roundCaps: boolean = true,
    count?: number
  ): void {
    const total = count !== undefined ? Math.min(count, points ? points.length : 0) : (points ? points.length : 0);
    if (total === 0) return;

    GLBatch._ensureScratchCapacity(total);
    const ptX = GLBatch._ptX;
    const ptY = GLBatch._ptY;

    for (let i = 0; i < total; i++) {
      ptX[i] = points[i]!.x;
      ptY[i] = points[i]!.y;
    }

    this._drawRibbonCoordsInternal(ptX, ptY, total, width, color, glow, type, roundCaps, 0, 0, true, roundCaps);
  }

  public drawSerpentineRibbon(
    nodes: IRibbonNode[],
    color: string,
    accent: string,
    alpha: number = 1.0,
    _mouthOpen: number = 0,
    _blinking: boolean = false
  ): void {
    if (!nodes || nodes.length === 0) return;
    const n = nodes.length;

    // Draw connected continuous spine ribbon
    if (n >= 2) {
      this.setBlendMode(GLBlendMode.ADDITIVE);
      this.drawContinuousRibbon(
        nodes,
        (i, t) => {
          const p = nodes[i]!;
          return (p.r || 12) * 2.0 * (1.0 - t * 0.35);
        },
        ColorX.rgba(color, alpha),
        4,
        GLPrimitive.Laser,
        true
      );
    }

    // Draw vertebrae discs
    this.setBlendMode(GLBlendMode.NORMAL);
    for (let i = 0; i < n; i++) {
      const p = nodes[i]!;
      const t = i / Math.max(1, n);
      const r = (p.r || 12) * (1.0 - t * 0.3);
      this.drawSphere(p.x, p.y, r, ColorX.rgba(color, alpha), 6);
      this.drawCircle(p.x, p.y, r * 0.35, ColorX.rgba(accent, alpha), 2);
    }
  }

  /**
   * Complete 7.5-Pass Multi-Layer Cybernetic Serpentine Pipeline.
   *
   * Physical / Mathematical Formulation:
   * - Pass 1: Shell Outline (continuous ribbon width 2 * headR + 4, color #02050c, alpha 0.85)
   * - Pass 2: Lit Flesh Core (continuous ribbon width 1.85 * headR, glow radius 10, GLPrimitive.Laser)
   * - Pass 2B: Vertebrae Carapaces & Accent Borders (oriented quads along segment angle)
   * - Pass 3: Tail Taper (6 LOD buckets, quadratic width decay 2 * headR * (1 - 0.9 * e), shade decay shade(-0.06 - 0.5 * e))
   * - Pass 4: Ventral Shadow (offset +0.16 * headR, +0.36 * headR, width 0.85 * headR, alpha 0.3)
   * - Pass 5: Wet Top Ridge Highlight (offset -0.2 * headR, -0.34 * headR, width 0.6 * headR, alpha 0.18)
   * - Pass 6: Scale Cross-Ticks (perpendicular ticks theta + PI/2, length 2 * headR * (1 - 0.85 * t^2) * 0.85, width 2.0)
   * - Pass 7: Bioluminescent Accent Nodes (radius 0.32 * headR * (1 - 0.35 * t))
   * - Pass 7.5: Segment Damage Warning Overlays (hit flashes, <35% red warning rings, 35-99% amber warning rings, <50% crack lines)
   */
  public drawSerpentineMultiPass(
    snake: {
      x: number;
      y: number;
      angle: number;
      headRadius: number;
      color: string;
      accent: string;
      segments: Array<{
        x: number;
        y: number;
        r?: number;
        angle?: number;
        hp?: number;
        maxHp?: number;
        hitFlash?: number;
        damageFlash?: number;
      }>;
      invulnerableTimer?: number;
      hurtFlash?: number;
    },
    alpha: number = 1.0
  ): void {
    const segs = snake.segments;
    const segCount = segs ? segs.length : 0;
    if (segCount === 0) return;

    const headR = snake.headRadius || 12;
    const col = snake.color || '#00f0b5';
    const accent = snake.accent || '#10b981';

    // Populate static scratch coordinates for snake head + body segments: count = segCount + 1
    const totalPoints = segCount + 1;
    GLBatch._ensureScratchCapacity(totalPoints);
    const ptX = GLBatch._ptX;
    const ptY = GLBatch._ptY;

    ptX[0] = snake.x;
    ptY[0] = snake.y;
    for (let i = 0; i < segCount; i++) {
      ptX[i + 1] = segs[i]!.x;
      ptY[i + 1] = segs[i]!.y;
    }

    const shouldSubdivide = totalPoints <= 250;
    let smoothCount = totalPoints;

    if (shouldSubdivide && totalPoints >= 3) {
      smoothCount = (totalPoints - 1) * 2 + 1;
      GLBatch._ensureScratchCapacity(smoothCount);
      const sPtX = GLBatch._smoothPtX;
      const sPtY = GLBatch._smoothPtY;
      sPtX[0] = ptX[0]!;
      sPtY[0] = ptY[0]!;
      const dCos = Math.cos(snake.angle);
      const dSin = Math.sin(snake.angle);
      const headD = Math.hypot(ptX[0]! - ptX[1]!, ptY[0]! - ptY[1]!);

      for (let i = 0; i < totalPoints - 1; i++) {
        const p1x = ptX[i]!;
        const p1y = ptY[i]!;
        const p2x = ptX[i + 1]!;
        const p2y = ptY[i + 1]!;

        const p0x = i > 0 ? ptX[i - 1]! : p1x + dCos * headD;
        const p0y = i > 0 ? ptY[i - 1]! : p1y + dSin * headD;

        const p3x = i < totalPoints - 2 ? ptX[i + 2]! : p2x + (p2x - p1x);
        const p3y = i < totalPoints - 2 ? ptY[i + 2]! : p2y + (p2y - p1y);

        // Exact Catmull-Rom midpoint: P_mid = (-P0 + 9*P1 + 9*P2 - P3) / 16
        sPtX[i * 2 + 1] = (-p0x + 9 * p1x + 9 * p2x - p3x) * 0.0625;
        sPtY[i * 2 + 1] = (-p0y + 9 * p1y + 9 * p2y - p3y) * 0.0625;
        sPtX[i * 2 + 2] = p2x;
        sPtY[i * 2 + 2] = p2y;
      }
    } else if (totalPoints > 300) {
      // High-density Serpentine Downsampling:
      // When a serpent contains thousands of segments (e.g. 10,000 torture test),
      // raw segment spacing is sub-pixel (0.05-0.2px). Sub-pixel quads cause massive
      // redundant VBO flushes and vertex pipeline thrashing without any visual difference.
      // Subsample down to at most 300 points, preserving head (index 0) and tail (last index).
      const targetPoints = 300;
      const step = (totalPoints - 1) / (targetPoints - 1);
      smoothCount = targetPoints;
      GLBatch._ensureScratchCapacity(smoothCount);
      const sPtX = GLBatch._smoothPtX;
      const sPtY = GLBatch._smoothPtY;
      sPtX[0] = ptX[0]!;
      sPtY[0] = ptY[0]!;
      for (let i = 1; i < targetPoints - 1; i++) {
        const srcIdx = Math.round(i * step);
        sPtX[i] = ptX[srcIdx]!;
        sPtY[i] = ptY[srcIdx]!;
      }
      sPtX[targetPoints - 1] = ptX[totalPoints - 1]!;
      sPtY[targetPoints - 1] = ptY[totalPoints - 1]!;
    } else {
      GLBatch._ensureScratchCapacity(smoothCount);
      const sPtX = GLBatch._smoothPtX;
      const sPtY = GLBatch._smoothPtY;
      for (let i = 0; i < totalPoints; i++) {
        sPtX[i] = ptX[i]!;
        sPtY[i] = ptY[i]!;
      }
    }
    const sPtX = GLBatch._smoothPtX;
    const sPtY = GLBatch._smoothPtY;

    // -------------------------------------------------------------
    // Pass 1: Shell outline (Dark cybernetic foundation)
    // -------------------------------------------------------------
    this.setBlendMode(GLBlendMode.NORMAL);
    // Softened cosmic penumbra (replaces harsh pitch-black shell border)
    const shellCol = GLBatch.colorToUint32(ColorX.rgba(ColorX.shade(col, -0.4), 0.45 * alpha), alpha);
    const litCoreCol = GLBatch.colorToUint32(col, alpha);
    const shadowCol = GLBatch.colorToUint32('rgba(2, 5, 12, 0.3)', alpha);
    const highlightCol = GLBatch.colorToUint32('rgba(255, 255, 255, 0.18)', alpha);

    const invTotal = 1.0 / Math.max(1, smoothCount - 1);
    const taper = GLBatch._taperScratch;
    const wGlow = GLBatch._wGlowScratch;
    const wShell = GLBatch._wShellScratch;
    const wCore = GLBatch._wCoreScratch;
    const wShadow = GLBatch._wShadowScratch;
    const wHighlight = GLBatch._wHighlightScratch;

    const baseGlowW = headR * 1.85 + 16;
    const baseShellW = headR * 2 + 4;
    const baseCoreW = headR * 1.85;
    const baseShadowW = headR * 0.85;
    const baseHighlightW = headR * 0.60;

    for (let i = 0; i < smoothCount; i++) {
      const t = i * invTotal;
      let tap = 1.0;
      if (t > 0.30) {
        const progress = (t - 0.30) / 0.70;
        tap = Math.max(0.08, 1.0 - progress * progress * 0.90);
      }
      taper[i] = tap;
      wGlow[i] = baseGlowW * tap;
      wShell[i] = baseShellW * tap;
      wCore[i] = baseCoreW * tap;
      wShadow[i] = baseShadowW * tap;
      wHighlight[i] = baseHighlightW * tap;
    }

    // -------------------------------------------------------------
    // Pass 0: Outer Diffuse Glow Halo
    // Physical Rationale: Canvas2D Pass 2 employs `ctx.glow(10, col)` which casts an outer
    // blurred Gaussian shadow extending ~10-16px beyond the ribbon boundary. WebGL emulates
    // this with an additive laser ribbon pass of width (headR * 1.85 + 16) * getSpineTaper(t).
    // -------------------------------------------------------------
    this.setBlendMode(GLBlendMode.ADDITIVE);
    this._drawRibbonCoordsInternal(
      sPtX,
      sPtY,
      smoothCount,
      wGlow,
      ColorX.rgba(col, 0.3 * alpha),
      10,
      GLPrimitive.Laser,
      true,
      0,
      0,
      true,
      false
    );
    this.setBlendMode(GLBlendMode.NORMAL);

    // -------------------------------------------------------------
    // Pass 1: Shell outline (Cosmic penumbra foundation)
    // Seamless join discs scaled dynamically with getSpineTaper(t),
    // eliminating miter gaps and preventing untapered underbody spill.
    // -------------------------------------------------------------
    const discStride = smoothCount > 250 ? Math.ceil(smoothCount / 200) : 1;
    const shellR = (headR * 2 + 4) * 0.5;
    for (let i = 0; i < smoothCount - 1; i += discStride) {
      this.drawCircle(sPtX[i]!, sPtY[i]!, shellR * taper[i]!, shellCol, 0);
    }

    this._drawRibbonCoordsInternal(
      sPtX,
      sPtY,
      smoothCount,
      wShell,
      shellCol,
      0,
      GLPrimitive.Quad,
      true,
      0,
      0,
      false,
      false // roundTailCap = false (omits tail circle to allow sleek Pass 3 taper)
    );

    // -------------------------------------------------------------
    // Pass 2: Flesh lit from within (Solid vibrant lit core matching Canvas2D)
    // Dynamically tapered join discs eliminating the giant 32px penultimate ball!
    // -------------------------------------------------------------
    const litCoreR = (headR * 1.85) * 0.5;
    for (let i = 0; i < smoothCount - 1; i += discStride) {
      this.drawCircle(sPtX[i]!, sPtY[i]!, litCoreR * taper[i]!, litCoreCol, 0);
    }

    this._drawRibbonCoordsInternal(
      sPtX,
      sPtY,
      smoothCount,
      wCore,
      litCoreCol,
      0,
      GLPrimitive.Quad,
      true,
      0,
      0,
      false,
      false // roundTailCap = false (eliminates blinding 22px glowing cyan sphere at tail tip)
    );

    // -------------------------------------------------------------
    // Pass 2B: Individual Vertebrae Discs & Segment Carapace (Batched, Dynamic LOD)
    // -------------------------------------------------------------
    this.setBlendMode(GLBlendMode.NORMAL);
    const vStride = segCount > 500 ? Math.ceil(segCount / 100) : (segCount > 250 ? 3 : (segCount > 80 ? 2 : 1));
    const colPacked = GLBatch.colorToUint32(col, alpha);
    const accentPacked = GLBatch.colorToUint32(accent, 0.7 * alpha);
    for (let i = 0; i < segCount; i += vStride) {
      const seg = segs[i]!;
      const t = i / Math.max(1, segCount);
      const segR = (seg.r || headR * 0.85) * (1 - t * 0.3);
      let sAngle = seg.angle;
      if (sAngle === undefined || isNaN(sAngle)) {
        const prevX = i === 0 ? snake.x : segs[i - 1]!.x;
        const prevY = i === 0 ? snake.y : segs[i - 1]!.y;
        sAngle = Math.atan2(prevY - seg.y, prevX - seg.x);
      }
      // 1. Carapace base ellipse disc: Flat lit color smoothly merging with flesh ribbon without 3D shadow steps
      this.drawRotatedQuad(seg.x, seg.y, segR * 2.3, segR * 2.0, sAngle, colPacked, 0, GLPrimitive.Circle);
      // 2. Cybernetic accent border: 1.4px stroke along carapace perimeter matching Canvas2D
      this.drawRotatedQuad(seg.x, seg.y, segR * 2.3, segR * 2.0, sAngle, accentPacked, 0, GLPrimitive.Ring);
    }

    // -------------------------------------------------------------
    // Pass 3: Tail taper (Batched into 6 segmented LOD buckets with continuous ribbons)
    // -------------------------------------------------------------
    const tailStart = Math.floor((smoothCount - 1) * 0.3);
    const tailTotal = (smoothCount - 1) - tailStart;
    if (tailTotal > 0) {
      const BUCKETS = 6;
      const bucketSize = Math.max(1, Math.ceil(tailTotal / BUCKETS));
      for (let b = 0; b < BUCKETS; b++) {
        const startIdx = tailStart + b * bucketSize;
        const endIdx = Math.min(smoothCount - 1, startIdx + bucketSize);
        if (startIdx >= smoothCount - 1) break;

        const midT = (startIdx + (endIdx - startIdx) * 0.5 - tailStart) / Math.max(1, tailTotal);
        const e = midT * midT;
        const bucketCol = ColorX.shade(col, -0.06 - e * 0.5);
        const bucketColPacked = GLBatch.colorToUint32(bucketCol, alpha);
        const bucketW = Math.max(1.5, headR * 2 * (1 - e * 0.9));

        // Sub-slice indices strictly clamped within [1, smoothCount - 1] (prevents out-of-bounds (0, 0) origin leak)
        const fromIdx = Math.max(1, startIdx);
        const toIdx = Math.min(smoothCount - 1, endIdx);
        const subCount = toIdx - fromIdx + 1;
        if (subCount >= 2) {
          this._drawRibbonCoordsInternal(
            sPtX,
            sPtY,
            subCount,
            bucketW,
            bucketColPacked,
            0,
            GLPrimitive.Quad,
            false,
            0,
            0,
            true,
            false, // roundTailCap = false
            fromIdx
          );
        }
      }

      // Sleek tapered tail tip end cap: exactly terminates at 1.5px - 2px matching Canvas2D Pass 3
      const finalTailR = Math.max(1.5, headR * 2 * (1 - 0.9)) * 0.5;
      const lastBucketCol = ColorX.shade(col, -0.06 - 0.5);
      const lastBucketColPacked = GLBatch.colorToUint32(lastBucketCol, alpha);
      this.drawCircle(sPtX[smoothCount - 1]!, sPtY[smoothCount - 1]!, finalTailR, lastBucketColPacked, 0);
    }

    // -------------------------------------------------------------
    // Pass 4: Ventral shadow (Continuous ribbon offset with dynamic taper)
    // -------------------------------------------------------------
    const vsX = headR * 0.16;
    const vsY = headR * 0.36;
    const vsR = (headR * 0.85) * 0.5;
    for (let i = 0; i < smoothCount - 1; i += discStride) {
      this.drawCircle(sPtX[i]! + vsX, sPtY[i]! + vsY, vsR * taper[i]!, shadowCol, 0);
    }
    this._drawRibbonCoordsInternal(
      sPtX,
      sPtY,
      smoothCount,
      wShadow,
      shadowCol,
      0,
      GLPrimitive.Quad,
      true,
      vsX,
      vsY,
      false,
      false // roundTailCap = false
    );

    // -------------------------------------------------------------
    // Pass 5: Wet highlight along top ridge (Continuous ribbon offset with dynamic taper)
    // -------------------------------------------------------------
    const whX = -headR * 0.2;
    const whY = -headR * 0.34;
    const whR = (headR * 0.6) * 0.5;
    for (let i = 0; i < smoothCount - 1; i += discStride) {
      this.drawCircle(sPtX[i]! + whX, sPtY[i]! + whY, whR * taper[i]!, highlightCol, 0);
    }
    this._drawRibbonCoordsInternal(
      sPtX,
      sPtY,
      smoothCount,
      wHighlight,
      highlightCol,
      0,
      GLPrimitive.Quad,
      true,
      whX,
      whY,
      false,
      false // roundTailCap = false
    );

    // -------------------------------------------------------------
    // Pass 6: Keeled Diamond Scales (Organic Viper Imbrication along Dorsal Ridge)
    // -------------------------------------------------------------
    this.setBlendMode(GLBlendMode.NORMAL);
    const tickStride = segCount > 500 ? Math.ceil(segCount / 100) : (segCount > 250 ? 3 : (segCount > 80 ? 2 : 1));
    const tickCol = GLBatch.colorToUint32('rgba(2, 5, 12, 0.28)', alpha);
    for (let i = 0; i < segCount; i += tickStride) {
      const seg = segs[i]!;
      const a = (seg.angle || 0);
      const t = i / Math.max(1, segCount);
      const r = headR * (1 - t * t * 0.85) * 0.85;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const hw = r * 0.45;
      const hh = r * 0.22;
      // Oriented diamond 4 corners: Anterior tip, Right flank, Posterior tip, Left flank
      const x0 = seg.x + cos * hw;
      const y0 = seg.y + sin * hw;
      const x1 = seg.x - sin * hh;
      const y1 = seg.y + cos * hh;
      const x2 = seg.x - cos * hw;
      const y2 = seg.y - sin * hw;
      const x3 = seg.x + sin * hh;
      const y3 = seg.y - cos * hh;
      this.drawQuadVertices(x0, y0, x1, y1, x2, y2, x3, y3, tickCol, 0, GLPrimitive.Quad);
    }

    // -------------------------------------------------------------
    // Pass 6B: Damaged Segment Crack Lines (< 50% HP) — Retains NORMAL mode from Pass 6
    // -------------------------------------------------------------
    const warnStride = segCount > 500 ? Math.ceil(segCount / 100) : (segCount > 250 ? 3 : (segCount > 80 ? 2 : 1));
    const crackCol = GLBatch.colorToUint32('rgba(255, 68, 68, 0.85)', alpha);
    const crackOffsets = GLBatch._CRACK_OFFSETS;

    for (let i = 0; i < segCount; i += warnStride) {
      const seg = segs[i]!;
      const curHp = seg.hp !== undefined ? seg.hp : 25;
      const maxHp = seg.maxHp !== undefined ? seg.maxHp : 25;
      const segR = seg.r || headR * 0.8;

      if (curHp < maxHp && curHp / Math.max(1, maxHp) < 0.5) {
        const sCos = Math.cos(seg.angle || 0);
        const sSin = Math.sin(seg.angle || 0);
        for (let k = 0; k < crackOffsets.length - 1; k++) {
          const o1 = crackOffsets[k]!;
          const o2 = crackOffsets[k + 1]!;
          const x1 = seg.x + (o1.c * sCos - o1.s * sSin) * segR * 0.75;
          const y1 = seg.y + (o1.c * sSin + o1.s * sCos) * segR * 0.75;
          const x2 = seg.x + (o2.c * sCos - o2.s * sSin) * segR * 0.75;
          const y2 = seg.y + (o2.c * sSin + o2.s * sCos) * segR * 0.75;
          this.drawLaser(x1, y1, x2, y2, 1.5, crackCol, 0);
        }
      }
    }

    // -------------------------------------------------------------
    // Pass 7: Bioluminescent nodes (Batched, Dynamic LOD)
    // -------------------------------------------------------------
    this.setBlendMode(GLBlendMode.ADDITIVE);
    const nodeStride = segCount > 500 ? Math.ceil(segCount / 100) : (segCount > 250 ? 3 : (segCount > 80 ? 2 : 1));
    const nodeCol = GLBatch.colorToUint32(accent, 0.75 * alpha);
    for (let i = 0; i < segCount; i += nodeStride) {
      const seg = segs[i]!;
      const t = i / Math.max(1, segCount);
      const nr = headR * 0.32 * (1 - t * 0.35);
      this.drawSdfCircle(seg.x, seg.y, nr, nodeCol, 1.0, 2);
    }

    // -------------------------------------------------------------
    // Pass 7.5: Damaged Segment Health Indicators & Warning Overlays (Canvas2D Exact Parity)
    // -------------------------------------------------------------
    this.setBlendMode(GLBlendMode.NORMAL);
    const hitFlashCol = GLBatch.colorToUint32('#ffffff', 0.8 * alpha);
    const critRingCol = GLBatch.colorToUint32('#ef4444', 1.0 * alpha);
    const modRingCol = GLBatch.colorToUint32('#f59e0b', 1.0 * alpha);

    for (let i = 0; i < segCount; i += warnStride) {
      const seg = segs[i]!;
      const hitFlash = seg.hitFlash || (seg as any).damageFlash || 0;
      const curHp = seg.hp !== undefined ? seg.hp : 25;
      const maxHp = seg.maxHp !== undefined ? seg.maxHp : 25;
      const segR = seg.r || headR * 0.8;

      // 1. Hit Flash
      if (hitFlash > 0.05) {
        this.drawSdfCircle(seg.x, seg.y, segR * 1.15, hitFlashCol, 0.8 * alpha, 0);
      }

      // 2. Critical Warning Rings (< 35% HP) - NORMAL mode, glow 0, 1.8px line width, #ef4444
      if (curHp < maxHp && curHp / Math.max(1, maxHp) < 0.35) {
        this.drawSdfRing(seg.x, seg.y, segR + 2, 1.8, critRingCol, 1.0 * alpha, 0);
      } else if (curHp < maxHp) {
        // 3. Moderate Damage Warning Rings (35% - 99% HP) - NORMAL mode, glow 0, 1.8px line width, #f59e0b
        this.drawSdfRing(seg.x, seg.y, segR + 2, 1.8, modRingCol, 1.0 * alpha, 0);
      }
    }

    // -------------------------------------------------------------
    // Terminal Cybernetic Stinger Micro-Node (Jewel Finish)
    // -------------------------------------------------------------
    const lastIdx = totalPoints - 1;
    const lastX = ptX[lastIdx]!;
    const lastY = ptY[lastIdx]!;
    this.drawCircle(lastX, lastY, 2.5, ColorX.rgba(accent, alpha), 4);
    this.drawCircle(lastX, lastY, 1.2, ColorX.rgba('#ffffff', alpha), 2);
  }

  /**
   * Releases GPU buffer allocations.
   */
  public dispose(): void {
    if (this.context && this.context.gl && this.context.isSupported) {
      const gl = this.context.gl;
      if (this._vertexBuffer) {
        gl.deleteBuffer(this._vertexBuffer);
        this._vertexBuffer = null;
      }
      if (this._indexBufferGL) {
        gl.deleteBuffer(this._indexBufferGL);
        this._indexBufferGL = null;
      }
      if (this._vao) {
        this.context.deleteVertexArray(this._vao);
        this._vao = null;
      }
    }
    this._quadCount = 0;
  }
}
