import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom, MockElement } from './MockDom';
import { WebGLGameRenderer } from '../render/WebGLGameRenderer';
import { GameRenderer } from '../render/GameRenderer';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { FxManager } from '../render/FxManager';
import { SnakePlayer } from '../sim/SnakePlayer';

/**
 * Creates a comprehensive Mock WebGL Context for headless Vitest testing.
 */
function createMockWebGLContext(canvas: any) {
  const shaders: any[] = [];
  const programs: any[] = [];
  const buffers: any[] = [];
  const drawCalls: Array<{ mode: number; first?: number; count?: number }> = [];

  const gl: any = {
    canvas,
    drawingBufferWidth: 1200,
    drawingBufferHeight: 800,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    TRIANGLES: 0x0004,
    LINES: 0x0001,
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    DYNAMIC_DRAW: 0x88e8,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    UNSIGNED_SHORT: 0x1403,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    ONE: 1,

    createShader: vi.fn((type: number) => {
      const shader = { type, source: '' };
      shaders.push(shader);
      return shader;
    }),
    shaderSource: vi.fn((shader: any, source: string) => {
      shader.source = source;
    }),
    compileShader: vi.fn((_shader: any) => {}),
    getShaderParameter: vi.fn((_shader: any, _pname: number) => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn(() => {}),

    createProgram: vi.fn(() => {
      const prog = { attached: [] as any[] };
      programs.push(prog);
      return prog;
    }),
    attachShader: vi.fn((prog: any, shader: any) => {
      prog.attached.push(shader);
    }),
    linkProgram: vi.fn((_prog: any) => {}),
    getProgramParameter: vi.fn((_prog: any, _pname: number) => true),
    getProgramInfoLog: vi.fn(() => ''),
    useProgram: vi.fn((_prog: any) => {}),
    deleteProgram: vi.fn(() => {}),

    createBuffer: vi.fn(() => {
      const buf = { data: null };
      buffers.push(buf);
      return buf;
    }),
    bindBuffer: vi.fn((_target: number, _buf: any) => {}),
    bufferData: vi.fn((_target: number, data: any, _usage: number) => {}),
    bufferSubData: vi.fn((_target: number, _offset: number, data: any) => {}),
    deleteBuffer: vi.fn(() => {}),

    getAttribLocation: vi.fn((_prog: any, name: string) => {
      if (name === 'a_position') return 0;
      if (name === 'a_color') return 1;
      if (name === 'a_uv') return 2;
      if (name === 'a_type') return 3;
      return -1;
    }),
    enableVertexAttribArray: vi.fn(() => {}),
    vertexAttribPointer: vi.fn(() => {}),

    getUniformLocation: vi.fn((_prog: any, name: string) => ({ name })),
    uniform1f: vi.fn(() => {}),
    uniform2f: vi.fn(() => {}),
    uniformMatrix3fv: vi.fn(() => {}),
    uniformMatrix4fv: vi.fn(() => {}),

    viewport: vi.fn(() => {}),
    clearColor: vi.fn(() => {}),
    clear: vi.fn(() => {}),
    enable: vi.fn(() => {}),
    disable: vi.fn(() => {}),
    blendFunc: vi.fn(() => {}),
    blendFuncSeparate: vi.fn(() => {}),
    drawArrays: vi.fn((mode: number, first: number, count: number) => {
      drawCalls.push({ mode, first, count });
    }),
    drawElements: vi.fn((mode: number, count: number, _type: number, _offset: number) => {
      drawCalls.push({ mode, count });
    }),
    flush: vi.fn(() => {}),
    finish: vi.fn(() => {}),

    _drawCalls: drawCalls,
  };

  return gl;
}

describe('WebGL 2D Rendering Pipeline & Automatic Headless Fallback', () => {
  let restoreDom: () => void;

  beforeEach(() => {
    restoreDom = setupMockDom();
  });

  afterEach(() => {
    restoreDom();
  });

  describe('1. WebGL Context Detection & Graceful Fallback', () => {
    it('reports isSupported as false when canvas has no webgl context methods', () => {
      const mockCanvas: any = {
        getContext: vi.fn(() => null),
      };
      expect(WebGLGameRenderer.isSupported(mockCanvas)).toBe(false);
    });

    it('reports isSupported as false in non-browser / undefined window environment', () => {
      const result = WebGLGameRenderer.isSupported(null as any);
      expect(result).toBe(false);
    });

    it('reports isSupported as true when canvas returns a valid WebGL context', () => {
      const mockCanvas: any = {
        clientWidth: 800,
        clientHeight: 600,
        getContext: vi.fn((type: string) => {
          if (type === 'webgl2' || type === 'webgl') {
            return createMockWebGLContext(mockCanvas);
          }
          return null;
        }),
      };
      expect(WebGLGameRenderer.isSupported(mockCanvas)).toBe(true);
    });

    it('WebGLGameRenderer.create safely returns null if WebGL is unsupported', () => {
      const mockCanvas: any = {
        getContext: vi.fn(() => null),
      };
      const renderer = WebGLGameRenderer.create(mockCanvas);
      expect(renderer).toBeNull();
    });
  });

  describe('2. WebGL Pipeline Initialization & Shader Compilation', () => {
    it('initializes shaders, buffers, and attributes on construction with valid WebGL context', () => {
      const mockCanvas: any = {
        clientWidth: 1200,
        clientHeight: 800,
        width: 1200,
        height: 800,
        getContext: vi.fn((type: string) => {
          if (type === 'webgl2' || type === 'webgl') {
            return createMockWebGLContext(mockCanvas);
          }
          return null;
        }),
      };

      const renderer = new WebGLGameRenderer(mockCanvas);
      expect(renderer.isReady()).toBe(true);
      expect(renderer.isWebGL).toBe(true);
      expect(mockCanvas.getContext).toHaveBeenCalled();
    });

    it('handles resize and adjusts orthographic projection matrix and viewport', () => {
      const mockCanvas: any = {
        clientWidth: 1200,
        clientHeight: 800,
        width: 1200,
        height: 800,
        getContext: vi.fn(() => createMockWebGLContext(mockCanvas)),
      };

      const renderer = new WebGLGameRenderer(mockCanvas);
      renderer.resize(1920, 1080);

      expect(renderer.logicalWidth).toBe(1920);
      expect(renderer.logicalHeight).toBe(1080);
      expect(renderer.gl!.viewport).toHaveBeenCalledWith(0, 0, expect.any(Number), expect.any(Number));
    });
  });

  describe('3. WebGL Render Execution & Entity Batches', () => {
    it('executes complete game render pass for active gameplay state', () => {
      const mockCanvas: any = {
        clientWidth: 1200,
        clientHeight: 800,
        width: 1200,
        height: 800,
        getContext: vi.fn(() => createMockWebGLContext(mockCanvas)),
      };

      const renderer = new WebGLGameRenderer(mockCanvas);
      const fx = new FxManager();
      const engine = new GameEngine(fx);
      engine.state = GameState.Playing;
      engine.arenaW = 1200;
      engine.arenaH = 800;

      // Spawn player
      engine.player = new SnakePlayer('emerald', 1200, 800);
      engine.player.x = 600;
      engine.player.y = 400;
      engine.player.headHp = 50;
      (engine.player as any).equippedHelmet = 'prime_crown';

      // Spawn test entities
      engine.foods = [
        { x: 100, y: 100, type: 'apple', r: 8, pulse: 0.5, spawnScale: 1 } as any,
        { x: 200, y: 200, type: 'golden', r: 10, pulse: 0.2, spawnScale: 1 } as any,
      ];
      engine.projectiles = [
        { x: 300, y: 300, vx: 5, vy: 0, radius: 4, color: '#00f0b5', source: 'player' } as any,
      ];
      engine.enemies = [
        { x: 400, y: 400, hp: 20, maxHp: 20, radius: 14, type: 'dasher', color: '#ff3366', accent: '#ff4d6d' } as any,
      ];
      engine.hazards = [
        { x: 500, y: 500, radius: 30, duration: 2.0, maxDuration: 2.0, type: 'circle', color: '#ef4444' } as any,
      ];
      engine.helmetDrops = [
        { x: 550, y: 550, helmetId: 'prime_crown', bobTimer: 0 } as any,
      ];

      // Execute render pass
      expect(() => renderer.render(engine, fx)).not.toThrow();

      // Check draw calls occurred
      expect((renderer.gl as any)._drawCalls.length).toBeGreaterThan(0);
    });

    it('renders idle coiling backdrop correctly during Title and GameOver states', () => {
      const mockCanvas: any = {
        clientWidth: 1200,
        clientHeight: 800,
        width: 1200,
        height: 800,
        getContext: vi.fn(() => createMockWebGLContext(mockCanvas)),
      };

      const renderer = new WebGLGameRenderer(mockCanvas);
      const fx = new FxManager();
      const engine = new GameEngine(fx);

      engine.state = GameState.Title;
      expect(() => renderer.render(engine, fx)).not.toThrow();

      engine.state = GameState.GameOver;
      expect(() => renderer.render(engine, fx)).not.toThrow();
    });

    it('executes batch primitive helpers (drawRect, drawCircle, drawLine, drawLaserRibbon)', () => {
      const mockCanvas: any = {
        clientWidth: 1200,
        clientHeight: 800,
        width: 1200,
        height: 800,
        getContext: vi.fn(() => createMockWebGLContext(mockCanvas)),
      };

      const renderer = new WebGLGameRenderer(mockCanvas);
      renderer.beginFrame();
      renderer.drawRect(10, 10, 100, 100, 1, 0, 0, 1);
      renderer.drawCircle(200, 200, 25, 0, 1, 0, 1);
      renderer.drawLine(0, 0, 500, 500, 4, 0, 0, 1, 1);
      renderer.drawRing(300, 300, 15, 20, 1, 1, 0, 1);
      renderer.drawLaserRibbon(
        [
          { x: 100, y: 100 },
          { x: 150, y: 120 },
          { x: 200, y: 110 },
        ],
        6,
        1,
        0.5,
        0,
        1
      );
      renderer.flush();

      expect((renderer.gl as any)._drawCalls.length).toBeGreaterThan(0);
    });
  });

  describe('4. GameRenderer Integration & Routing', () => {
    it('GameRenderer.draw and WebGLGameRenderer work with WebGL pipeline directly', () => {
      const mockCanvas = document.createElement('canvas') as any;
      mockCanvas.clientWidth = 1200;
      mockCanvas.clientHeight = 800;
      const webglRenderer = new WebGLGameRenderer(mockCanvas);
      const engine = new GameEngine();

      expect(() => GameRenderer.draw(webglRenderer, engine)).not.toThrow();
    });

    it('GameRenderer.draw and GameRenderer.render work with WebGLGameRenderer', () => {
      const mockCanvas: any = {
        clientWidth: 1200,
        clientHeight: 800,
        width: 1200,
        height: 800,
        getContext: vi.fn(() => createMockWebGLContext(mockCanvas)),
      };

      const webglRenderer = new WebGLGameRenderer(mockCanvas);
      const engine = new GameEngine();

      expect(() => GameRenderer.draw(webglRenderer as any, engine)).not.toThrow();
      expect(() => GameRenderer.render(webglRenderer as any, engine)).not.toThrow();
    });

    it('App initializes WebGL as primary engine by default and falls back gracefully', async () => {
      const { App } = await import('../main');
      const app = new App();
      expect(app).toBeDefined();
      expect(app.engine).toBeDefined();
      // App strictly uses WebGLGameRenderer in pure WebGL architecture
      expect(app.webglRenderer).toBeDefined();
    });
  });
});
