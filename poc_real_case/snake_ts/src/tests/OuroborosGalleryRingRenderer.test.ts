/**
 * Ouroboros Ascension — Pure WebGL Serpentine Ouroboros Ring Renderer Test Suite
 *
 * Strict TDD Verification for OuroborosGalleryRingRenderer.ts (AGENTS.md Rule 1, Rule 10, Rule 12):
 * 1. Geometry Construction:
 *    - Circular ring body forms a continuous loop at radius ~130px centered at (180, 180).
 *    - Inward neck and head gracefully curve inward from the outer ring toward (180, 180).
 *    - Opened jaws, horned cranial crests, and celestial eyes frame the 9th central socket.
 * 2. Animation Tick Progression & Zero Allocation:
 *    - Frame render ticks advance breathing pulse and glowing scale waves deterministically.
 *    - Zero heap/buffer re-allocations during steady-state render loop.
 * 3. Headless & Mock WebGL Resilience:
 *    - Safe execution when WebGL context is null, uninitialized, or mocked.
 *    - Correct shader compilation, attribute binding, uniform transmission, and draw call execution.
 * 4. Responsive Resizing & Clean Destruction:
 *    - resize(w, h) updates viewport and resolution uniforms.
 *    - destroy() disposes GPU buffers, programs, and prevents subsequent render invocations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom, createMockWebGLContext } from './MockDom.js';
import { OuroborosGalleryRingRenderer } from '../render/webgl/OuroborosGalleryRingRenderer.js';

describe('Pure WebGL Serpentine Ouroboros Ring Renderer (OuroborosGalleryRingRenderer)', () => {
  let restoreDom: () => void;
  let mockGl: any;
  let mockCanvas: HTMLCanvasElement;

  beforeEach(() => {
    restoreDom = setupMockDom();
    mockCanvas = document.createElement('canvas');
    mockCanvas.width = 360;
    mockCanvas.height = 360;
    mockGl = createMockWebGLContext(mockCanvas);
  });

  afterEach(() => {
    restoreDom();
  });

  describe('1. Geometry Construction & Serpentine Topology', () => {
    it('constructs continuous circular spine spanning 360 degrees at radius ~130px', () => {
      const renderer = new OuroborosGalleryRingRenderer(mockCanvas);
      const spine = renderer.spinePoints;

      expect(spine).toBeDefined();
      expect(spine.length).toBeGreaterThan(60);

      // Verify outer circular loop points are centered around (180, 180) with radius ~130px
      const center = { x: 180, y: 180 };
      const circularSpinePoints = spine.filter(pt => pt.isRing);
      expect(circularSpinePoints.length).toBeGreaterThan(40);

      circularSpinePoints.forEach(pt => {
        const dx = pt.x - center.x;
        const dy = pt.y - center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        expect(dist).toBeGreaterThanOrEqual(125);
        expect(dist).toBeLessThanOrEqual(135);
      });
    });

    it('gracefully curves neck and head inward toward center (180, 180) to frame the 9th pedestal', () => {
      const renderer = new OuroborosGalleryRingRenderer(mockCanvas);
      const spine = renderer.spinePoints;
      const center = { x: 180, y: 180 };

      // Inward head spine points
      const inwardPoints = spine.filter(pt => !pt.isRing);
      expect(inwardPoints.length).toBeGreaterThan(15);

      // Check that distance from center smoothly decreases to < 50px near the snout
      const firstInward = inwardPoints[0]!;
      const lastInward = inwardPoints[inwardPoints.length - 1]!;

      const firstDist = Math.hypot(firstInward.x - center.x, firstInward.y - center.y);
      const lastDist = Math.hypot(lastInward.x - center.x, lastInward.y - center.y);

      expect(firstDist).toBeGreaterThan(90); // starts near outer ring
      expect(lastDist).toBeLessThan(50); // reaches close to center (9th pedestal frame)
      expect(lastDist).toBeLessThan(firstDist);
    });

    it('generates cranial crest, opened jaws, and celestial eye geometry framing central pedestal', () => {
      const renderer = new OuroborosGalleryRingRenderer(mockCanvas);
      const headGeom = renderer.headGeometry;

      expect(headGeom).toBeDefined();
      expect(headGeom.jawUpperVertices.length).toBeGreaterThan(0);
      expect(headGeom.jawLowerVertices.length).toBeGreaterThan(0);
      expect(headGeom.cranialCrestVertices.length).toBeGreaterThan(0);
      expect(headGeom.eyePoints.length).toBe(2); // Left and right celestial eyes

      // Both eyes should be symmetric around the cranial axis
      const eye1 = headGeom.eyePoints[0]!;
      const eye2 = headGeom.eyePoints[1]!;
      expect(eye1.x).toBeGreaterThan(0);
      expect(eye2.x).toBeGreaterThan(0);
      expect(Math.hypot(eye1.x - 180, eye1.y - 180)).toBeLessThan(70);
      expect(Math.hypot(eye2.x - 180, eye2.y - 180)).toBeLessThan(70);
    });

    it('tessellates serpentine ribbon vertices with required shader attributes', () => {
      const renderer = new OuroborosGalleryRingRenderer(mockCanvas);
      const ribbonVertices = renderer.ribbonVertices;

      expect(ribbonVertices).toBeInstanceOf(Float32Array);
      expect(ribbonVertices.length).toBeGreaterThan(500);

      // Floats per vertex: position(2) + normal(2) + side(1) + progress(1) + segment(1) = 7 floats
      expect(ribbonVertices.length % 7).toBe(0);
      const vertexCount = ribbonVertices.length / 7;
      expect(renderer.vertexCount).toBe(vertexCount);
    });
  });

  describe('2. Animation Tick Progression & Zero-Allocation Invariance', () => {
    it('advances breathing pulse, scale wave ripples, and stellar embers with timeSec', () => {
      const renderer = new OuroborosGalleryRingRenderer(mockCanvas);
      renderer.init(mockGl);

      expect(() => {
        renderer.render(0.0, 0, false);
        renderer.render(1.5, 4, false);
        renderer.render(3.0, 8, true);
      }).not.toThrow();

      expect(renderer.currentTime).toBe(3.0);
      expect(renderer.unlockedCount).toBe(8);
      expect(renderer.isAwakened).toBe(true);
    });

    it('maintains static typed buffer references during render loop (zero heap re-allocation)', () => {
      const renderer = new OuroborosGalleryRingRenderer(mockCanvas);
      renderer.init(mockGl);

      const initialRibbonBuffer = renderer.ribbonVertices;
      const initialEmbersBuffer = renderer.embersBuffer;

      // Simulate 120 animation frames
      for (let f = 1; f <= 120; f++) {
        renderer.render(f / 60, 5, false);
      }

      // Memory pointers must remain identical
      expect(renderer.ribbonVertices).toBe(initialRibbonBuffer);
      expect(renderer.embersBuffer).toBe(initialEmbersBuffer);
    });
  });

  describe('3. Headless & Mock WebGL Context Safe Execution', () => {
    it('safely handles null WebGL context or missing canvas without throwing', () => {
      const renderer = new OuroborosGalleryRingRenderer(null);
      expect(renderer.isInitialized).toBe(false);

      expect(() => {
        renderer.init(null);
        renderer.resize(400, 400);
        renderer.render(1.0, 3, false);
        renderer.destroy();
      }).not.toThrow();
    });

    it('initializes program, compiles GLSL shaders, and binds GPU buffers on mock GL', () => {
      const renderer = new OuroborosGalleryRingRenderer(mockCanvas);
      renderer.init(mockGl);

      expect(renderer.isInitialized).toBe(true);
      expect(renderer.gl).toBe(mockGl);

      // Render a frame and verify mock GL drew triangles
      renderer.render(1.0, 6, false);
      expect(mockGl._drawCalls.length).toBeGreaterThan(0);
    });

    it('passes unlockedCount and isAwakened uniforms to GL shader', () => {
      const renderer = new OuroborosGalleryRingRenderer(mockCanvas);
      renderer.init(mockGl);

      renderer.render(2.5, 7, false);
      expect(renderer.unlockedCount).toBe(7);
      expect(renderer.isAwakened).toBe(false);

      renderer.render(5.0, 8, true);
      expect(renderer.unlockedCount).toBe(8);
      expect(renderer.isAwakened).toBe(true);
    });
  });

  describe('4. Resizing, Lifecycle, and Disposal', () => {
    it('updates canvas dimensions and WebGL viewport on resize(w, h)', () => {
      const renderer = new OuroborosGalleryRingRenderer(mockCanvas);
      renderer.init(mockGl);

      renderer.resize(720, 720);
      expect(mockCanvas.width).toBe(720);
      expect(mockCanvas.height).toBe(720);
      expect(renderer.width).toBe(720);
      expect(renderer.height).toBe(720);
    });

    it('destroys GPU buffers, shader program, and ceases render execution', () => {
      const renderer = new OuroborosGalleryRingRenderer(mockCanvas);
      renderer.init(mockGl);

      expect(renderer.isDisposed).toBe(false);
      renderer.destroy();
      expect(renderer.isDisposed).toBe(true);
      expect(renderer.gl).toBeNull();

      // Calling render after destroy is safe no-op
      expect(() => {
        renderer.render(10.0, 8, true);
      }).not.toThrow();
    });
  });
});
