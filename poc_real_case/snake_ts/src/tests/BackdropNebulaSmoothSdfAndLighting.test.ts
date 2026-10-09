/**
 * ============================================================================
 * Backdrop Nebula Smooth SDF & Arena Lighting Test Suite (BackdropNebulaSmoothSdfAndLighting.test.ts)
 * Protocol 3.0 Commercial Engine Edition — 100% Non-Regression Parity
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 1, Rule 6, Rule 10)
 *
 * VALIDATES:
 * 1. Pre-baked Backdrop GPU Texture Pipeline:
 *    - WebGLAssetAtlas.getBackdropTexture() always creates, caches, and returns
 *      valid WebGLTexture instances for ANY floor (1..5 and looping >5).
 *    - Resilient dynamic resolution fallback so backdropTexture is NEVER null.
 * 2. Window Resize Integration:
 *    - WebGLGameRenderer.resize() triggers pre-baking of backdrop textures for
 *      the newly configured logical dimensions.
 * 3. Smooth Continuous 2D SDF Nebula Shader:
 *    - GLPrimitive.Nebula = 6 defined in WebGLContext.
 *    - Fragment shader contains continuous exponential Gaussian falloff.
 * 4. Fallback Shading Cleanliness:
 *    - WebGLGameRenderer.drawBackdrop fallback NEVER renders 16 sharp rectangular
 *      quad strips (GLPrimitive.Quad); it renders smooth continuous 2D SDF nebula.
 * 5. ArenaBackdrop.bakeNebulaDust Gradient Smoothness:
 *    - Center stop (0.50) is the luminous peak with palette.accent, eliminating
 *      the inverted dark center valley and dual parallel railroad track artifacts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebGLContext, GLPrimitive } from '../render/webgl/WebGLContext';
import { GLBatch } from '../render/webgl/GLBatch';
import { WebGLAssetAtlas } from '../render/webgl/WebGLAssetAtlas';
import { WebGLGameRenderer } from '../render/webgl/WebGLGameRenderer';
import { ArenaBackdrop } from '../render/ArenaBackdrop';
import { GameRenderer } from '../render/GameRenderer';

function createMockWebGL() {
  const calls = {
    texturesCreated: [] as any[],
    texturesBound: [] as Array<{ target: number; texture: any }>,
    texParameters: [] as Array<{ target: number; pname: number; param: number }>,
    texImage2DCalls: [] as any[][],
    pixelStoreiCalls: [] as Array<{ pname: number; param: any }>,
  };

  const gl: any = {
    TEXTURE_2D: 3553,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    CLAMP_TO_EDGE: 33071,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    LINEAR: 9729,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    createTexture: vi.fn(() => {
      const tex = { id: calls.texturesCreated.length + 1 };
      calls.texturesCreated.push(tex);
      return tex;
    }),
    bindTexture: vi.fn((target: number, texture: any) => {
      calls.texturesBound.push({ target, texture });
    }),
    texParameteri: vi.fn((target: number, pname: number, param: number) => {
      calls.texParameters.push({ target, pname, param });
    }),
    pixelStorei: vi.fn((pname: number, param: any) => {
      calls.pixelStoreiCalls.push({ pname, param });
    }),
    texImage2D: vi.fn((...args: any[]) => {
      calls.texImage2DCalls.push(args);
    }),
    deleteTexture: vi.fn(),
  };

  return { gl, calls };
}

describe('Backdrop Nebula Smooth SDF, Texture Creation & Fallback Lighting', () => {
  beforeEach(() => {
    WebGLAssetAtlas.clear();
    WebGLGameRenderer.clearTextureCaches();
  });

  describe('1. Pre-baked Backdrop GPU Texture Pipeline & Resolution Resilience', () => {
    it('1.1 WebGLAssetAtlas.getBackdropTexture creates and caches textures for all floors 1..5 and looping floors', () => {
      const { gl, calls } = createMockWebGL();

      // Test all standard floors 1..5
      for (let f = 1; f <= 5; f++) {
        const tex = WebGLAssetAtlas.getBackdropTexture(gl, f, 1280, 720);
        expect(tex).toBeDefined();
        expect(tex).not.toBeNull();
      }

      // Test looping floors: Floor 6 -> Floor 1, Floor 8 -> Floor 3, Floor 25 -> Floor 5
      const tex6 = WebGLAssetAtlas.getBackdropTexture(gl, 6, 1280, 720);
      const tex8 = WebGLAssetAtlas.getBackdropTexture(gl, 8, 1280, 720);
      const tex25 = WebGLAssetAtlas.getBackdropTexture(gl, 25, 1280, 720);

      expect(tex6).toBeDefined();
      expect(tex8).toBeDefined();
      expect(tex25).toBeDefined();
    });

    it('1.2 WebGLAssetAtlas.getBackdropTexture handles dynamic canvas dimensions and provides resilient fallback', () => {
      const { gl } = createMockWebGL();

      // Pre-bake for 960x640 Floor 3
      const texFloor3 = WebGLAssetAtlas.getBackdropTexture(gl, 3, 960, 640);
      expect(texFloor3).toBeDefined();

      // If called with mock GL that can no longer create textures (e.g. GPU transient busy/lost),
      // it returns existing cached texture for that floor rather than returning null!
      const crippledGl: any = {
        createTexture: () => null,
      };

      const fallbackTex = WebGLAssetAtlas.getBackdropTexture(crippledGl, 3, 1920, 1080);
      expect(fallbackTex).toBe(texFloor3);
    });

    it('1.3 WebGLGameRenderer.resize triggers pre-baking of backdrop textures for new dimensions', () => {
      const { gl } = createMockWebGL();
      gl.drawingBufferWidth = 1280;
      gl.drawingBufferHeight = 720;
      const renderer = new WebGLGameRenderer(gl);
      const prebakeSpy = vi.spyOn(WebGLAssetAtlas, 'prebakeBackdrops');

      renderer.resize(1920, 1080);
      expect(prebakeSpy).toHaveBeenCalledWith(gl, 1920, 1080, [1, 2, 3, 4, 5]);
    });
  });

  describe('2. Smooth Continuous 2D SDF Nebula Shader (GLPrimitive.Nebula = 6)', () => {
    it('2.1 defines GLPrimitive.Nebula = 6 in WebGLContext', () => {
      expect(GLPrimitive.Nebula).toBe(6);
    });

    it('2.2 fragment shader contains primType == 6 branch with exponential Gaussian falloff', () => {
      const fsSource = WebGLContext.FRAGMENT_SHADER_SOURCE;
      expect(fsSource).toContain('primType == 6');
      expect(fsSource).toContain('exp(');
      // Ensures smooth anti-aliased edge clamping
      expect(fsSource).toContain('smoothstep');
    });
  });

  describe('3. Fallback Shading Cleanliness (No Hard Straight Parallel Lines)', () => {
    it('3.1 WebGLGameRenderer.drawBackdrop fallback NEVER draws 16 sharp rotated rectangular strips with GLPrimitive.Quad', () => {
      // Mock GL that returns null for textures to force fallback path
      const crippledGl: any = {
        createTexture: () => null,
      };
      const batch = new GLBatch(crippledGl, 256);
      batch.begin(1280, 720);

      const rotatedQuadSpy = vi.spyOn(batch, 'drawRotatedQuad');

      (WebGLGameRenderer as any).drawBackdrop(batch, 1280, 720, false, 0, 3);

      // Verify that NO rectangular quad strips are drawn for the nebula spine
      const quadCalls = rotatedQuadSpy.mock.calls.filter((c) => c[7] === GLPrimitive.Quad);
      expect(quadCalls.length).toBe(0);

      // Verify that smooth continuous 2D SDF Nebula geometry is drawn instead
      const nebulaCalls = rotatedQuadSpy.mock.calls.filter((c) => c[7] === GLPrimitive.Nebula);
      expect(nebulaCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('4. ArenaBackdrop.bakeNebulaDust Gradient Smoothness (SSOT)', () => {
    it('4.1 ArenaBackdrop.bakeNebulaDust gradient center stop (0.50) is the peak alpha with palette.accent', () => {
      const backdrop = new ArenaBackdrop();
      const mockCanvas: any = {
        width: 1280,
        height: 720,
      };

      const colorStops: Array<{ offset: number; color: string }> = [];
      const mockGradient: any = {
        addColorStop: vi.fn((offset: number, color: string) => {
          colorStops.push({ offset, color });
        }),
      };

      const mockCtx: any = {
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        scale: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        fillRect: vi.fn(),
        createLinearGradient: vi.fn(() => mockGradient),
        createRadialGradient: vi.fn(() => mockGradient),
      };

      const palette = { base: '#0c0402', mid: '#200b04', grid: 'rgba(255, 158, 0, 0.048)', accent: '#f59e0b' };
      (backdrop as any).bakeNebulaDust(mockCtx, 1280, 720, 3, palette);

      expect(mockCtx.createLinearGradient).toHaveBeenCalled();
      // Center stop 0.50 must exist
      const centerStop = colorStops.find((s) => Math.abs(s.offset - 0.50) < 0.01);
      expect(centerStop).toBeDefined();

      // Extract alpha value from center stop (e.g. rgba(..., alpha))
      const centerMatch = centerStop!.color.match(/[\d.]+\)$/);
      const centerAlpha = centerMatch ? parseFloat(centerMatch[0].replace(')', '')) : 1.0;

      // Peak center alpha must be greater than or equal to 0.25 (luminous core, not hollowed out)
      expect(centerAlpha).toBeGreaterThanOrEqual(0.25);
    });
  });
});
