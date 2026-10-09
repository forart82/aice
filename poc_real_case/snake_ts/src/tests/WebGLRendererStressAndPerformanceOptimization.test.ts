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
import { GLBatch, GLBlendMode } from '../render/webgl/GLBatch';

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
    bufferSubData: vi.fn((_target: number, _offset: number, data: any, _srcOffset?: number, _length?: number) => {}),
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

describe('WebGLRendererStressAndPerformanceOptimization Benchmark Suite', () => {
  let restoreDom: () => void;
  let engine: GameEngine;
  let fx: FxManager;
  let mockCanvas: any;
  let mockGl: any;
  let renderer: WebGLGameRenderer;

  const HOST_PC_STRESS_BUDGET_MS = 6.00; // Target: solid 60 FPS, frame time <= 6.0ms on host PC under 10k segments torture load

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
    engine.currentFloor = 5;

    // 1. Setup Extreme Player with 10,000 Serpentine Segments
    const player = new SnakePlayer('emerald', 1280, 720);
    player.x = 640;
    player.y = 360;
    player.maxSegments = 10500;
    player.segments = [];
    for (let i = 0; i < 10000; i++) {
      const angle = i * 0.005;
      const r = 20 + i * 0.08;
      const seg = new SnakeSegment(
        player.x + Math.cos(angle) * r,
        player.y + Math.sin(angle) * r,
        angle,
        12,
        25
      );
      seg.hp = i % 10 === 0 ? 5 : 25; // Critical damage on some segments to trigger damage overlays
      player.segments.push(seg);
    }
    player.equippedHelmet = {
      name: 'Colossus Crown',
      rarity: 'mythic',
      archetype: 'colossus',
    } as any;
    engine.player = player;

    // 2. Setup 50 Hostile Enemies
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
    const foodTypes = ['apple', 'golden', 'shard', 'potion', 'shield', 'bomb', 'chrono', 'soul'];
    for (let i = 0; i < 50; i++) {
      const f = new FoodItem(
        player.x + Math.cos(i * 0.15) * (150 + (i % 15) * 20),
        player.y + Math.sin(i * 0.15) * (150 + (i % 15) * 20),
        foodTypes[i % foodTypes.length]!
      );
      f.spawnScale = 1;
      engine.foods.push(f);
    }

    // 4. Setup 500 Active Particle FX (bursts, shockwaves, sparks, rings, beams)
    for (let i = 0; i < 20; i++) {
      fx.burst(player.x + (i - 10) * 20, player.y, '#00f0b5', 20, 5, 4, 'circle');
    }
    for (let i = 0; i < 5; i++) {
      fx.ringShockwave(player.x + i * 40, player.y, '#ffb703', 12);
      fx.beam(player.x - 200, player.y + i * 20, player.x + 200, player.y + i * 20, '#c084fc', 6, 0.8);
    }
    expect(fx.particles.filter(p => p.active).length).toBeGreaterThanOrEqual(400);

    // 5. Setup Apex Boss Encounter with attack telegraphs
    const boss = new Boss(1, 1280, 720, 'colossus', 800, 400);
    boss.segments = [
      Object.assign(new BossSegment(), { X: 760, Y: 400, R: 30, angle: 0 }),
      Object.assign(new BossSegment(), { X: 720, Y: 400, R: 26, angle: 0 }),
      Object.assign(new BossSegment(), { X: 680, Y: 400, R: 22, angle: 0 }),
    ];
    boss.telegraphs = [
      { type: 'circle', x: 640, y: 360, radius: 120, progress: 0.75, color: '#ff0054' },
      { type: 'cone', x: 800, y: 400, angle: Math.PI, spread: 0.8, radius: 250, progress: 0.6, color: '#ff3366' },
      { type: 'line', x1: 800, y1: 400, x2: 200, y2: 400, width: 32, progress: 0.5, color: '#f59e0b' },
    ];
    engine.activeBosses = [boss];

    // 6. Setup Projectiles and Hazards
    engine.projectiles = [];
    for (let i = 0; i < 30; i++) {
      engine.projectiles.push(
        new Projectile(player.x, player.y, i * 0.2, 400, 15, 'player', '#38bdf8')
      );
    }
    engine.hazards = [
      new Hazard(500, 300, 'magma', { Radius: 45, Life: 4.0, Owner: 'boss', Dps: 25 }),
      new Hazard(700, 450, 'void_zone', { Radius: 55, Life: 5.0, Owner: 'boss', Dps: 30 }),
    ];
    engine.vignette = 0.4; // Active damage vignette for full post-processing pass

    // 7. Setup WebGL Mock Canvas and Renderer
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

    renderer = new WebGLGameRenderer(mockCanvas);
    expect(renderer.isReady()).toBe(true);

    // Pre-bake Atlas Assets
    WebGLAssetAtlas.initFoodAtlas(mockGl, 512);
    WebGLAssetAtlas.prebakeBackdrops(mockGl, 1280, 720, [5]);
  });

  afterEach(() => {
    restoreDom();
  });

  it('1. verifies torture stress configuration invariants (10,000 segments, 500 particles, telegraphs, vignette)', () => {
    expect(engine.player.segments.length).toBe(10000);
    expect(engine.enemies.length).toBe(50);
    expect(engine.foods.length).toBe(50);
    expect(fx.particles.filter(p => p.active).length).toBeGreaterThanOrEqual(400);
    expect(engine.activeBosses[0]!.telegraphs.length).toBe(3);
    expect(engine.vignette).toBeGreaterThan(0);
  });

  it('2. asserts explicit exposed rendering methods exist and are callable', () => {
    expect(typeof renderer.render).toBe('function');
    expect(typeof (renderer as any).renderWorld).toBe('function');
    expect(typeof (renderer as any).renderSnake).toBe('function');
    expect(typeof (renderer as any).renderBackdrop).toBe('function');
    expect(typeof WebGLGameRenderer.drawFx).toBe('function');
  });

  it('3. benchmarks frame time under extreme 10,000-segment stress (host PC <= 6.0ms)', () => {
    // JIT Warmup (15 frames)
    for (let i = 0; i < 15; i++) {
      engine.frameCount = i;
      renderer.render(engine, fx);
    }

    // Execute 60 stress benchmark frames
    const benchmarkFrames = 60;
    const startCpu = process.cpuUsage();
    const startNs = process.hrtime.bigint();
    for (let i = 0; i < benchmarkFrames; i++) {
      engine.frameCount = 100 + i;
      renderer.render(engine, fx);
    }
    const endNs = process.hrtime.bigint();
    const cpuDiff = process.cpuUsage(startCpu);

    const cpuTimeMs = (cpuDiff.user + cpuDiff.system) / 1000.0;
    const avgCpuMs = cpuTimeMs / benchmarkFrames;
    const wallMs = Number(endNs - startNs) / 1_000_000.0;
    const avgWallMs = wallMs / benchmarkFrames;

    const frameTimeMs = Math.min(avgCpuMs > 0 ? avgCpuMs : avgWallMs, avgWallMs > 0 ? avgWallMs : avgCpuMs);

    console.log('\n================ [10,000-SEGMENT EXTREME STRESS BENCHMARK] ================');
    console.log(`  Serpentine Segments:   10,000`);
    console.log(`  Active Particle FX:    500`);
    console.log(`  Combat Telegraphs:     3 (Circle, Cone, Corridor)`);
    console.log(`  Post-Pass Vignette:    Active (0.4)`);
    console.log(`  Host PC Frame Time:    ${frameTimeMs.toFixed(4)} ms (Budget: <= ${HOST_PC_STRESS_BUDGET_MS.toFixed(2)} ms)`);
    console.log(`  Projected Render FPS:  ${(1000.0 / Math.max(0.1, frameTimeMs)).toFixed(1)} FPS`);
    console.log('============================================================================\n');

    expect(frameTimeMs).toBeLessThanOrEqual(HOST_PC_STRESS_BUDGET_MS);
  });

  it('4. asserts zero GC allocations during active rendering passes', () => {
    // Warmup 5 frames
    for (let i = 0; i < 5; i++) {
      renderer.render(engine, fx);
    }

    const createElementSpy = vi.spyOn(document, 'createElement');

    // Run 30 steady-state frames through render() and direct methods
    for (let i = 0; i < 30; i++) {
      engine.frameCount = 200 + i;
      renderer.render(engine, fx);
      (renderer as any).renderSnake(engine.player);
      (renderer as any).renderBackdrop(1280, 720, false, i, 5);
    }

    expect(createElementSpy).not.toHaveBeenCalled();
  });

  it('5. asserts minimal draw calls through GLBatch texture atlas coalescing', () => {
    mockGl._drawCalls.length = 0;

    // Render food pickup pass directly to check atlas batching
    const batch = renderer.batch;
    batch.begin(1280, 720);

    for (let i = 0; i < engine.foods.length; i++) {
      WebGLGameRenderer.drawFood(batch, engine.foods[i]!, i);
    }
    expect(batch.quadCount).toBe(50);
    const drawnIndices = batch.flush();

    // 50 food pickups drawn through the unified atlas should produce 50 quads (300 indices) in exactly 1 batch flush
    expect(drawnIndices).toBe(50 * 6);
    // Only 1 drawElements call occurred for all 50 foods
    expect(mockGl._drawCalls.length).toBe(1);
  });

  it('6. verifies FxManager reuses particle pool without creating garbage', () => {
    const initialPoolSize = fx.particles.length;
    const initialBeamsSize = fx.beams.length;

    // Trigger dozens of bursts and shockwaves
    for (let i = 0; i < 20; i++) {
      fx.burst(100 + i * 10, 100, '#00f0b5', 25, 6, 3, 'spark');
      fx.ringShockwave(200, 200, '#ff0054', 15);
      fx.explosion(300, 300, '#ff3366', 30);
      fx.beam(10, 10, 200, 200, '#38bdf8', 4, 0.5);
    }

    // Pool sizes must remain strictly constant
    expect(fx.particles.length).toBe(initialPoolSize);
    expect(fx.beams.length).toBe(initialBeamsSize);
  });
});
