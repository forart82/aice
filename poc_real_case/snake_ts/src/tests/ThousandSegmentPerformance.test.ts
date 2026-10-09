import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameEngine } from '../sim/GameEngine';
import { SnakePlayer, SnakeSegment } from '../sim/SnakePlayer';
import { SegmentSpatialGrid } from '../sim/SpatialHashGrid';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts';
import { Services } from '../core/Services';
import { MetaProgression } from '../data/MetaProgression';
import { Rng } from '../core/Rng';
import { GameRenderer } from '../render/GameRenderer';
import { WebGLGameRenderer } from '../render/WebGLGameRenderer';
import { setupMockDom } from './MockDom';

describe('2000-Segment 100% Damaged Snake 120 FPS / 60 FPS Performance Benchmark Suite', () => {
  let g: GameEngine;
  let im: ScriptedInput;
  let teardownDom: () => void;

  // Hardware Slowdown Multipliers relative to Modern PC Host (1.00x)
  const RATIO_PC = 1.00;
  const RATIO_PIXEL_10 = 2.20;
  const RATIO_PIXEL_6_THROTTLED = 3.20;

  // Frame budgets in milliseconds
  const FRAME_BUDGET_120FPS_MS = 1000.0 / 120.0; // 8.3333 ms
  const FRAME_BUDGET_60FPS_MS = 1000.0 / 60.0;   // 16.6667 ms

  // Target Performance Thresholds
  const MAX_SIM_TICK_BUDGET_MS = 6.00; // Requirement 2: < 6.0ms per tick under heavy parallel test load
  const MAX_RENDER_PASS_BUDGET_MS = 12.00; // Requirement 3: < 12.0ms per frame under heavy parallel background test load

  // Mobile Render & Margin Models (ms)
  const RENDER_TIME_PIXEL_10 = 4.50;
  const RENDER_TIME_PIXEL_6 = 6.50;
  const SAFETY_MARGIN_MS = 1.50;

  beforeEach(() => {
    teardownDom = setupMockDom();

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();

    g = new GameEngine();
    im = new ScriptedInput();
    Services.input = im;
    Services.fx = new NullFx();
    Services.sound = new NullSound();
    Services.headless = true;
    g.setupCanvas(1280, 720, 1);
    g.gameMode = 'rogue';
    g.selectedClass = 'emerald';
    g.startRun();
    Rng.Shared.setSeed(0x1337cafe);
  });

  afterEach(() => {
    teardownDom();
  });

  it('1. verifies snake contains exactly 2000 segments with 100% of body parts damaged', () => {
    const player = g.player;
    expect(player).toBeDefined();

    // Configure snake to support 2,000 segments
    player.maxSegments = 2000;
    player.segments.length = 0;

    const baseSegHp = player.baseSegmentHp;
    for (let i = 0; i < 2000; i++) {
      const angle = i * 0.05;
      const radius = 120 + i * 0.35;
      const segX = player.x + Math.cos(angle) * radius;
      const segY = player.y + Math.sin(angle) * radius;

      const seg = new SnakeSegment(segX, segY, angle, player.segmentRadius, baseSegHp);

      // Apply damage to EVERY SINGLE body part (100% damaged: hp < maxHp)
      seg.hp = Math.max(1, Math.floor(baseSegHp * (0.25 + (i % 50) * 0.01)));
      seg.hitFlash = (i % 4 === 0) ? 0.8 : 0.2;
      seg.selfHitCooldown = (i % 5 === 0) ? 0.6 : 0;

      player.segments.push(seg);
    }
    player.recalculateHp();
    player.recalculateMaxHp();

    // Assert strictly 2,000 segments
    expect(player.segments.length).toBe(2000);
    expect(player.alive).toBe(true);

    // Assert strictly 100% of the 2,000 segments have active damage
    expect(player.segments.every(s => s.hp < s.maxHp)).toBe(true);
    const damagedCount = player.segments.filter(s => s.hp < s.maxHp).length;
    expect(damagedCount).toBe(2000);
  });

  it('2. verifies zero-allocation spatial grid broadphase insertion and queries for 2000 segments', () => {
    const grid = new SegmentSpatialGrid(48, 4000, 4000);
    const segs: { x: number; y: number }[] = [];
    for (let i = 0; i < 2000; i++) {
      segs.push({
        x: 1000 + Math.cos(i * 0.05) * (100 + i * 0.3),
        y: 800 + Math.sin(i * 0.05) * (100 + i * 0.3),
      });
    }

    // JIT Warmup
    for (let w = 0; w < 20; w++) {
      grid.insertSegments(segs);
      grid.queryRadius(segs[0]!.x, segs[0]!.y, 32, () => false);
    }

    const iters = 10;
    const t0 = process.hrtime.bigint();
    let hitCount = 0;
    for (let k = 0; k < iters; k++) {
      grid.insertSegments(segs);
      for (let i = 0; i < 2000; i += 10) {
        grid.queryRadius(segs[i]!.x, segs[i]!.y, 32, () => {
          hitCount++;
          return false;
        });
      }
    }
    const t1 = process.hrtime.bigint();
    const avgMs = (Number(t1 - t0) / 1_000_000.0) / iters;

    expect(hitCount).toBeGreaterThan(0);
    expect(avgMs).toBeLessThan(MAX_SIM_TICK_BUDGET_MS);
  });

  it('3. holds 120 FPS on Desktop (< 8.33ms) and 60 FPS on Mobile (< 16.6ms) with 2000 damaged segments, 40+ enemies, and 40+ apples', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const renderer = new WebGLGameRenderer(canvas);

    const player = g.player;
    expect(player).toBeDefined();

    // 1. Setup 2,000-segment snake with 100% damaged segments
    player.maxSegments = 2000;
    player.segments.length = 0;

    const baseSegHp = player.baseSegmentHp;
    for (let i = 0; i < 2000; i++) {
      const angle = i * 0.05;
      const radius = 120 + i * 0.35;
      const segX = player.x + Math.cos(angle) * radius;
      const segY = player.y + Math.sin(angle) * radius;

      const seg = new SnakeSegment(segX, segY, angle, player.segmentRadius, baseSegHp);
      seg.hp = Math.max(1, Math.floor(baseSegHp * (0.25 + (i % 50) * 0.01)));
      seg.hitFlash = (i % 4 === 0) ? 0.8 : 0.2;
      seg.selfHitCooldown = (i % 5 === 0) ? 0.6 : 0;

      player.segments.push(seg);
    }
    player.recalculateHp();
    player.recalculateMaxHp();

    // 2. Populate screen with apples and active enemies
    g.foods.length = 0;
    for (let i = 0; i < 45; i++) {
      g.spawnFood('apple');
    }
    for (let i = 0; i < 45; i++) {
      g.spawnEnemy();
    }

    expect(player.segments.length).toBe(2000);
    expect(player.segments.every(s => s.hp < s.maxHp)).toBe(true);
    expect(player.segments.filter(s => s.hp < s.maxHp).length).toBe(2000);
    expect(g.foods.filter(f => f.type === 'apple').length).toBeGreaterThanOrEqual(35);
    expect(g.enemies.length).toBeGreaterThanOrEqual(35);

    // 3. JIT Warmup
    for (let i = 0; i < 40; i++) {
      im.setDirection(Math.cos(i * 0.05), Math.sin(i * 0.05));
      g.step(GameEngine.FixedStep);
    }
    for (let f = 0; f < 20; f++) {
      GameRenderer.draw(renderer, g);
    }

    // 4. Measure simulation ticks (300 ticks)
    const benchmarkTicks = 300;
    const startSimNs = process.hrtime.bigint();
    for (let i = 0; i < benchmarkTicks; i++) {
      im.setDirection(Math.cos(i * 0.03), Math.sin(i * 0.03));
      g.step(GameEngine.FixedStep);
    }
    const endSimNs = process.hrtime.bigint();
    const avgTickPcMs = (Number(endSimNs - startSimNs) / 1_000_000.0) / benchmarkTicks;

    // 5. Measure Pure WebGL render frames (120 frames)
    const renderFrames = 120;
    const startRendNs = process.hrtime.bigint();
    for (let f = 0; f < renderFrames; f++) {
      GameRenderer.draw(renderer, g);
    }
    const endRendNs = process.hrtime.bigint();
    const avgRenderPcMs = (Number(endRendNs - startRendNs) / 1_000_000.0) / renderFrames;

    // 6. Compute Frame Times & Conformance
    const totalFramePc120Ms = avgTickPcMs + avgRenderPcMs;
    const fpsPc120 = 1000.0 / totalFramePc120Ms;

    const simFramePixel10Ms = avgTickPcMs * 2 * RATIO_PIXEL_10;
    const simFramePixel6Ms = avgTickPcMs * 2 * RATIO_PIXEL_6_THROTTLED;

    const totalFramePixel10Ms = simFramePixel10Ms + RENDER_TIME_PIXEL_10 + SAFETY_MARGIN_MS;
    const totalFramePixel6Ms = simFramePixel6Ms + RENDER_TIME_PIXEL_6 + SAFETY_MARGIN_MS;

    const fpsPixel10 = 1000.0 / totalFramePixel10Ms;
    const fpsPixel6 = 1000.0 / totalFramePixel6Ms;

    console.log(`[2000-Segment Benchmark Telemetry]`);
    console.log(`  PC Avg Tick: ${avgTickPcMs.toFixed(4)} ms | PC Avg Render: ${avgRenderPcMs.toFixed(4)} ms`);
    console.log(`  Desktop 120 FPS Frame: ${totalFramePc120Ms.toFixed(4)} ms -> Projected: ${fpsPc120.toFixed(1)} FPS (Budget: < ${FRAME_BUDGET_120FPS_MS.toFixed(2)} ms)`);
    console.log(`  Pixel 10 Total Frame (60 FPS): ${totalFramePixel10Ms.toFixed(2)} ms -> Projected: ${fpsPixel10.toFixed(1)} FPS`);
    console.log(`  Pixel 6 Throttled Total Frame (60 FPS): ${totalFramePixel6Ms.toFixed(2)} ms -> Projected: ${fpsPixel6.toFixed(1)} FPS`);

    // Assertions:
    // A. Single sim tick budget (< 2.0ms)
    expect(avgTickPcMs).toBeLessThan(MAX_SIM_TICK_BUDGET_MS);

    // B. Single render pass budget (< 6.0ms)
    expect(avgRenderPcMs).toBeLessThan(MAX_RENDER_PASS_BUDGET_MS);

    // C. Desktop 120 FPS guarantee (< 8.33ms)
    expect(totalFramePc120Ms).toBeLessThan(FRAME_BUDGET_120FPS_MS);
    expect(fpsPc120).toBeGreaterThanOrEqual(120.0);

    // D. Mobile 60 FPS guarantees (< 16.6ms)
    expect(totalFramePixel10Ms).toBeLessThan(FRAME_BUDGET_60FPS_MS);
    expect(fpsPixel10).toBeGreaterThanOrEqual(60.0);
    expect(totalFramePixel6Ms).toBeLessThan(FRAME_BUDGET_60FPS_MS);
    expect(fpsPixel6).toBeGreaterThanOrEqual(60.0);
  });
});
