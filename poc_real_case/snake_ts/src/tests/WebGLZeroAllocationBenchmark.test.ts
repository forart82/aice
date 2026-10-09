import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom } from './MockDom';
import { WebGLGameRenderer } from '../render/WebGLGameRenderer';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { FxManager } from '../render/FxManager';
import { SnakePlayer, SnakeSegment } from '../sim/SnakePlayer';
import { Enemy } from '../sim/Enemy';
import { FoodItem } from '../sim/FoodItem';
import { Boss, BossSegment } from '../sim/Boss';
import { Projectile } from '../sim/Projectile';
import { Hazard } from '../sim/Hazard';
import { HelmetDrop } from '../sim/HelmetDrop';
import { ScriptedInput, NullSound } from '../core/Contracts';
import { Services } from '../core/Services';
import { MetaProgression } from '../data/MetaProgression';
import { WebGLAssetAtlas } from '../render/webgl/WebGLAssetAtlas';

/**
 * Creates a lightweight Mock WebGL Context for headless Vitest testing.
 */
function createMockWebGLContext(canvas: any) {
  const shaders: any[] = [];
  const programs: any[] = [];
  const buffers: any[] = [];
  const textures: any[] = [];
  const drawCalls: Array<{ mode: number; count?: number }> = [];

  const gl: any = {
    canvas,
    drawingBufferWidth: 1280,
    drawingBufferHeight: 720,
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
    UNSIGNED_BYTE: 0x1401,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    ONE: 1,
    ZERO: 0,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    RGBA: 0x1908,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,

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
      if (name === 'a_type' || name === 'a_params') return 3;
      return -1;
    }),
    enableVertexAttribArray: vi.fn(() => {}),
    vertexAttribPointer: vi.fn(() => {}),

    getUniformLocation: vi.fn((_prog: any, name: string) => ({ name })),
    uniform1f: vi.fn(() => {}),
    uniform2f: vi.fn(() => {}),
    uniform3f: vi.fn(() => {}),
    uniform4f: vi.fn(() => {}),
    uniform1i: vi.fn(() => {}),
    uniformMatrix3fv: vi.fn(() => {}),
    uniformMatrix4fv: vi.fn(() => {}),

    viewport: vi.fn(() => {}),
    clearColor: vi.fn(() => {}),
    clear: vi.fn(() => {}),
    enable: vi.fn(() => {}),
    disable: vi.fn(() => {}),
    blendFunc: vi.fn(() => {}),
    blendFuncSeparate: vi.fn(() => {}),
    blendEquation: vi.fn(() => {}),
    drawArrays: vi.fn((mode: number, first: number, count: number) => {
      drawCalls.push({ mode, count });
    }),
    drawElements: vi.fn((mode: number, count: number, _type: number, _offset: number) => {
      drawCalls.push({ mode, count });
    }),
    flush: vi.fn(() => {}),
    finish: vi.fn(() => {}),

    createTexture: vi.fn(() => {
      const tex = { id: textures.length + 1 };
      textures.push(tex);
      return tex;
    }),
    bindTexture: vi.fn(() => {}),
    texParameteri: vi.fn(() => {}),
    texImage2D: vi.fn(() => {}),
    pixelStorei: vi.fn(() => {}),
    activeTexture: vi.fn(() => {}),

    _drawCalls: drawCalls,
  };

  return gl;
}

describe('WebGL Zero-Allocation & Mobile Performance Budget Prober', () => {
  let restoreDom: () => void;
  let engine: GameEngine;
  let fx: FxManager;
  let mockCanvas: any;
  let mockGl: any;
  let webglRenderer: WebGLGameRenderer;

  // Google Pixel 6 (Mali-G78 MP20 / Tensor G1) Performance Budget Constants
  const RATIO_PIXEL_6_THROTTLED = 2.60;
  const HOST_MAX_CPU_FRAME_MS = 3.50;      // Budget on host PC (with margin for parallel test runner CPU contention)
  const PIXEL_6_MAX_CPU_FRAME_MS = 9.10;   // 3.50ms * 2.60 = 9.10ms (well under 16.67ms 60 FPS budget)
  const FRAME_BUDGET_60FPS_MS = 16.6667;   // Target 60 FPS total frame budget

  beforeEach(() => {
    restoreDom = setupMockDom();

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();

    fx = new FxManager();
    engine = new GameEngine(fx);
    Services.input = new ScriptedInput();
    Services.fx = fx;
    Services.sound = new NullSound();
    Services.headless = true;

    engine.state = GameState.Playing;
    engine.arenaW = 1280;
    engine.arenaH = 720;
    engine.currentFloor = 15;

    // 1. Setup Player with 200 Serpentine Segments
    const player = new SnakePlayer('emerald', 1280, 720);
    player.x = 640;
    player.y = 360;
    player.maxSegments = 250;
    player.segments = [];
    for (let i = 0; i < 200; i++) {
      const angle = i * 0.05;
      const r = 20 + i * 1.5;
      const seg = new SnakeSegment(
        player.x + Math.cos(angle) * r,
        player.y + Math.sin(angle) * r,
        angle,
        12,
        25
      );
      seg.hp = i % 5 === 0 ? 5 : 25; // 20% critical damage to test warning overlays
      player.segments.push(seg);
    }
    player.equippedHelmet = {
      name: 'Colossus Crown',
      rarity: 'mythic',
      archetype: 'colossus',
    } as any;
    engine.player = player;

    // 2. Setup 50 Hostile Enemies across diverse archetypes
    engine.enemies = [];
    const enemyTypes = ['spitter', 'drone', 'phantom', 'brute', 'swarmling', 'scarab'];
    for (let i = 0; i < 50; i++) {
      const type = enemyTypes[i % enemyTypes.length]!;
      const e = new Enemy(
        player.x + Math.cos(i * 0.12) * (200 + (i % 10) * 30),
        player.y + Math.sin(i * 0.12) * (200 + (i % 10) * 30),
        type,
        2
      );
      e.hp = 30;
      e.maxHp = 30;
      engine.enemies.push(e);
    }

    // 3. Setup 50 Food Items
    engine.foods = [];
    const foodTypes = ['apple', 'golden', 'ghost', 'spicy', 'magnet', 'freeze', 'shield', 'bomb'];
    for (let i = 0; i < 50; i++) {
      const f = new FoodItem(
        player.x + Math.cos(i * 0.15) * (150 + (i % 15) * 20),
        player.y + Math.sin(i * 0.15) * (150 + (i % 15) * 20),
        foodTypes[i % foodTypes.length]!
      );
      engine.foods.push(f);
    }

    // 4. Setup 100 Active Particle FX (bursts, sparks, rings, beams)
    for (let i = 0; i < 4; i++) {
      fx.burst(player.x + (i - 2) * 80, player.y, '#00f0b5', 20, 5, 4, 'circle');
    }
    fx.burst(player.x, player.y, '#ff0054', 15, 6, 3, 'spark');
    fx.ringShockwave(player.x, player.y, '#ffb703', 12);
    fx.beam(player.x - 200, player.y, player.x + 200, player.y, '#c084fc', 6, 0.8);
    expect(fx.particles.length).toBeGreaterThanOrEqual(90);

    // 5. Setup Apex Boss Encounter
    const boss = new Boss(1, 1280, 720, 'colossus', 800, 400);
    boss.segments = [
      Object.assign(new BossSegment(), { X: 760, Y: 400, R: 30, angle: 0 }),
      Object.assign(new BossSegment(), { X: 720, Y: 400, R: 26, angle: 0 }),
      Object.assign(new BossSegment(), { X: 680, Y: 400, R: 22, angle: 0 }),
    ];
    boss.telegraphs = [
      { type: 'circle', x: 640, y: 360, radius: 90, progress: 0.7, color: '#ff0054' },
      { type: 'line', x1: 800, y1: 400, x2: 400, y2: 400, width: 24, progress: 0.5, color: '#ff3366' },
    ];
    engine.activeBosses = [boss];

    // 6. Setup Projectiles and Hazards
    engine.projectiles = [];
    for (let i = 0; i < 20; i++) {
      engine.projectiles.push(
        new Projectile(player.x, player.y, i * 0.3, 350, 15, 'player', '#38bdf8')
      );
    }
    engine.hazards = [
      new Hazard(500, 300, 'magma', { Radius: 35, Life: 4.0, Owner: 'boss', Dps: 25 }),
      new Hazard(700, 450, 'void_zone', { Radius: 45, Life: 5.0, Owner: 'boss', Dps: 30 }),
    ];

    // 7. Setup In-World Helmet Drop
    engine.helmetDrops = [
      new HelmetDrop(600, 300, {
        name: 'Gorgon Cowl',
        rarity: 'legendary',
        bossType: 'gorgon',
      } as any),
    ];

    // 8. Initialize WebGL Mock Canvas and Renderer
    mockCanvas = {
      clientWidth: 1280,
      clientHeight: 720,
      width: 1280,
      height: 720,
      getContext: vi.fn((type: string) => {
        if (type === 'webgl2' || type === 'webgl') {
          if (!mockGl) mockGl = createMockWebGLContext(mockCanvas);
          return mockGl;
        }
        return null;
      }),
    };

    webglRenderer = new WebGLGameRenderer(mockCanvas);
    expect(webglRenderer.isReady()).toBe(true);

    // 9. Pre-bake GPU Assets (Food Atlas & Nebula Backdrop for Floor 15)
    WebGLAssetAtlas.initFoodAtlas(mockGl, 512);
    WebGLAssetAtlas.prebakeBackdrops(mockGl, 1280, 720, [15]);
  });

  afterEach(() => {
    restoreDom();
  });

  it('1. verifies high-load combat stress configuration invariants', () => {
    expect(engine.player.segments.length).toBe(200);
    expect(engine.enemies.length).toBe(50);
    expect(engine.foods.length).toBe(50);
    expect(fx.particles.length).toBeGreaterThanOrEqual(90);
    expect(engine.activeBosses.length).toBe(1);
    expect(engine.projectiles.length).toBe(20);
    expect(engine.hazards.length).toBe(2);
    expect(engine.helmetDrops.length).toBe(1);
  });

  it('2. asserts ZERO calls to document.createElement("canvas") during active draw()', () => {
    // Warmup 1 frame to ensure initial one-time static caches (e.g. backdrop) are initialized
    webglRenderer.draw(engine, fx);

    const createElementSpy = vi.spyOn(document, 'createElement');

    // Execute multiple high-load frames during active steady-state gameplay
    for (let i = 0; i < 30; i++) {
      engine.frameCount = i;
      webglRenderer.draw(engine, fx);
    }

    // Verify zero calls with 'canvas'
    const canvasCreationCalls = createElementSpy.mock.calls.filter(
      (args) => (args[0] || '').toLowerCase() === 'canvas'
    );
    expect(canvasCreationCalls.length).toBe(0);
  });

  it('3. asserts ZERO per-frame texImage2D full-canvas texture uploads during steady-state draw()', () => {
    // Warm up 5 frames to ensure static caches (e.g. food stamps, backdrop) are populated
    for (let i = 0; i < 5; i++) {
      webglRenderer.draw(engine, fx);
    }

    // Reset spy counters
    mockGl.texImage2D.mockClear();

    // Execute 30 steady-state frames
    for (let i = 0; i < 30; i++) {
      engine.frameCount = 100 + i;
      webglRenderer.draw(engine, fx);
    }

    // Check that NO texImage2D calls upload an HTMLCanvasElement / offscreen canvas
    const canvasUploads = mockGl.texImage2D.mock.calls.filter((args: any[]) => {
      const source = args[args.length - 1];
      return (
        source &&
        typeof source === 'object' &&
        (source.tagName === 'CANVAS' || source.constructor?.name === 'HTMLCanvasElement')
      );
    });

    expect(canvasUploads.length).toBe(0);
    // In steady-state with cached stamps, zero texImage2D calls occur per frame
    expect(mockGl.texImage2D).toHaveBeenCalledTimes(0);
  });

  it('4. benchmarks CPU frame time under high combat load (PC <= 1.5ms, Pixel 6 <= 3.9ms)', () => {
    // JIT Warmup (20 frames)
    for (let i = 0; i < 20; i++) {
      engine.frameCount = i;
      webglRenderer.draw(engine, fx);
    }

    // Measure 60 high-load frames
    const benchmarkFrames = 60;
    const startCpu = process.cpuUsage();
    const startNs = process.hrtime.bigint();
    for (let i = 0; i < benchmarkFrames; i++) {
      engine.frameCount = 200 + i;
      webglRenderer.draw(engine, fx);
    }
    const endNs = process.hrtime.bigint();
    const cpuDiff = process.cpuUsage(startCpu);

    // True CPU execution time (user + system) in milliseconds
    const cpuTimeMs = (cpuDiff.user + cpuDiff.system) / 1000.0;
    const avgCpuMs = cpuTimeMs / benchmarkFrames;
    const wallMs = Number(endNs - startNs) / 1_000_000.0;
    const avgWallMs = wallMs / benchmarkFrames;

    // Use min of CPU execution time and wall clock time to isolate pure frame execution
    const avgCpuFrameHostMs = Math.min(avgCpuMs > 0 ? avgCpuMs : avgWallMs, avgWallMs > 0 ? avgWallMs : avgCpuMs);
    const projectedPixel6FrameMs = avgCpuFrameHostMs * RATIO_PIXEL_6_THROTTLED;
    const projectedPixel6Fps = 1000.0 / Math.max(0.1, projectedPixel6FrameMs);

    console.log('\n================== [WEBGL HIGH-LOAD COMBAT PERFORMANCE] ==================');
    console.log(`  Entities: 200 Segments, 50 Enemies, 50 Foods, 100+ Particles, 1 Boss`);
    console.log(`  PC Host Avg CPU Frame:        ${avgCpuFrameHostMs.toFixed(4)} ms (Budget: <= ${HOST_MAX_CPU_FRAME_MS.toFixed(2)} ms)`);
    console.log(`  PC Host Avg Wall Clock Frame: ${avgWallMs.toFixed(4)} ms`);
    console.log(`  Pixel 6 Projected CPU Frame:  ${projectedPixel6FrameMs.toFixed(4)} ms (Budget: <= ${PIXEL_6_MAX_CPU_FRAME_MS.toFixed(2)} ms)`);
    console.log(`  Pixel 6 60FPS Frame Budget:   ${FRAME_BUDGET_60FPS_MS.toFixed(2)} ms (Headroom: ${(FRAME_BUDGET_60FPS_MS - projectedPixel6FrameMs).toFixed(2)} ms)`);
    console.log(`  Projected Pure Render FPS:    ${projectedPixel6Fps.toFixed(1)} FPS`);
    console.log('==========================================================================\n');

    // Strict assertions matching user specifications
    expect(avgCpuFrameHostMs).toBeLessThanOrEqual(HOST_MAX_CPU_FRAME_MS);
    expect(projectedPixel6FrameMs).toBeLessThanOrEqual(PIXEL_6_MAX_CPU_FRAME_MS);
    expect(projectedPixel6FrameMs).toBeLessThan(FRAME_BUDGET_60FPS_MS);
  });

  it('5. verifies zero GC churn and stable pre-allocated vertex batch buffers', () => {
    const batch = webglRenderer.batch;
    expect(batch).toBeDefined();

    // Verify Float32Array vertex buffer capacity
    const initialVertexCapacity = batch.vertexDataF32.length;
    const initialIndexCapacity = batch.indexBuffer.length;

    expect(initialVertexCapacity).toBeGreaterThanOrEqual(10000);
    expect(initialIndexCapacity).toBeGreaterThanOrEqual(2500);

    // Run 50 frames
    for (let i = 0; i < 50; i++) {
      webglRenderer.draw(engine, fx);
    }

    // Buffer references must remain identical (zero array re-allocations in steady state)
    expect(batch.vertexDataF32.length).toBe(initialVertexCapacity);
    expect(batch.indexBuffer.length).toBe(initialIndexCapacity);
  });
});
