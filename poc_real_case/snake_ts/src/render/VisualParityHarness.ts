/**
 * ============================================================================
 * Visual Parity Test Harness & Deterministic Scene Generator (VisualParityHarness.ts)
 * Protocol 3.0 Commercial Engine Edition — 100% Non-Regression Parity
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 6, Rule 10, Rule 12)
 * Feature TDD Spec: docs/tdd/architecture_render_refactoring.tdd.md
 *
 * ARCHITECTURAL SUMMARY:
 * ---------------------
 * `VisualParityHarness` provides the authoritative, deterministic scene configuration
 * engine for comparing headless gold standard visual traces against WebGL (`WebGLGameRenderer`).
 *
 * IT ENFORCES:
 * 1. Zero Temporal Drift: Freezes animation loops and fixes `frameCount` to 60.
 * 2. Exact Entity Positioning: Explicit world-space coordinates, angles, and HP states.
 * 3. Exact 14 Scene Definitions: Covering menus, serpents, damage rings, cranial arcs,
 *    all 8 food pickups, all 6 enemy archetypes, Centipede Behemoth with danger telegraphs,
 *    and cosmic backdrops.
 * 4. High-Contrast Pixel Diff Engine: Compares RGBA buffers and generates difference
 *    buffers highlighting mismatched pixels in bright magenta (#ff00ff).
 */

import { GameState } from '../sim/GameState';
import { SnakePlayer, SnakeSegment } from '../sim/SnakePlayer';
import { FoodItem } from '../sim/FoodItem';
import { Enemy } from '../sim/Enemy';
import { Boss, BossSegment } from '../sim/Boss';
import { Hazard } from '../sim/Hazard';
import { GameData } from '../data/GameData';

export interface IVisualParityScene {
  readonly name: string;
  readonly description: string;
  readonly setup: (app: any) => void;
}

export interface IPixelDiffResult {
  readonly totalPixels: number;
  readonly diffCount: number;
  readonly diffPercentage: number;
  readonly diffBuffer: Buffer;
}

export class VisualParityHarness {
  private static readonly _scenes: Map<string, IVisualParityScene> = new Map();

  static {
    VisualParityHarness._registerAllScenes();
  }

  /**
   * Retrieves all registered scene identifiers in canonical sequence.
   */
  public static getSceneNames(): string[] {
    return Array.from(this._scenes.keys());
  }

  /**
   * Retrieves a scene descriptor by name.
   */
  public static getScene(name: string): IVisualParityScene | undefined {
    return this._scenes.get(name);
  }

  /**
   * Cleans the active engine state and resets camera, entities, and UI overlays.
   */
  public static resetEngineState(app: any): void {
    if (!app || !app.engine) return;
    const engine = app.engine;

    // 1. Freeze execution to prevent temporal jitter
    app._running = false;
    engine.frameCount = 60;
    engine.tickCount = 60;

    // 2. Clear all transient world entities
    if (engine.foods) engine.foods.length = 0;
    if (engine.enemies) engine.enemies.length = 0;
    if (engine.hazards) engine.hazards.length = 0;
    if (engine.helmetDrops) engine.helmetDrops.length = 0;
    if (engine.projectiles) engine.projectiles.length = 0;
    if (engine.activeBosses) engine.activeBosses.length = 0;
    if (engine.bosses) engine.bosses.length = 0;
    (engine as any).boss = null;

    // 3. Clear FX and screen-shake offsets
    if (app.fx) {
      if (typeof app.fx.clear === 'function') app.fx.clear();
      app.fx.offsetX = 0;
      app.fx.offsetY = 0;
      app.fx.shake = 0;
    }

    // 4. Hide all active modal screens and HUD elements
    if (app.uiRoot) {
      if (typeof app.uiRoot.hideActiveScreen === 'function') app.uiRoot.hideActiveScreen();
      if (typeof app.uiRoot.hideScreen === 'function') app.uiRoot.hideScreen();
      if (app.uiRoot.hudView && typeof app.uiRoot.hudView.hide === 'function') {
        app.uiRoot.hudView.hide();
      }
    }
  }

  /**
   * Configures the application into the specified deterministic test scene.
   */
  public static setupScene(app: any, sceneName: string): void {
    const scene = this._scenes.get(sceneName);
    if (!scene) {
      throw new Error(`VisualParityHarness: Unknown scene identifier "${sceneName}". Available: ${this.getSceneNames().join(', ')}`);
    }

    // Common baseline reset
    this.resetEngineState(app);

    // Apply scene-specific configuration
    scene.setup(app);

    // Render one single frozen deterministic frame
    if (typeof app.renderFrame === 'function') {
      app.renderFrame();
    }
  }

  /**
   * Pure pixel-diff comparison routine operating directly on raw RGBA Uint8 buffers.
   *
   * @param bufA Raw RGBA buffer of image A
   * @param bufB Raw RGBA buffer of image B
   * @param width Image width in pixels
   * @param height Image height in pixels
   * @param threshold Color difference tolerance threshold (0..255)
   */
  public static comparePixelBuffers(
    bufA: Buffer | Uint8Array,
    bufB: Buffer | Uint8Array,
    width: number,
    height: number,
    threshold: number = 8
  ): IPixelDiffResult {
    const totalPixels = width * height;
    const diffBuffer = Buffer.alloc(totalPixels * 4);
    let diffCount = 0;

    for (let p = 0; p < totalPixels; p++) {
      const idx = p * 4;
      const r1 = bufA[idx] ?? 0;
      const g1 = bufA[idx + 1] ?? 0;
      const b1 = bufA[idx + 2] ?? 0;
      const a1 = bufA[idx + 3] ?? 255;

      const r2 = bufB[idx] ?? 0;
      const g2 = bufB[idx + 1] ?? 0;
      const b2 = bufB[idx + 2] ?? 0;
      const a2 = bufB[idx + 3] ?? 255;

      const dr = Math.abs(r1 - r2);
      const dg = Math.abs(g1 - g2);
      const db = Math.abs(b1 - b2);
      const da = Math.abs(a1 - a2);

      // Max absolute channel difference
      const maxDiff = Math.max(dr, dg, db, da);

      if (maxDiff > threshold) {
        diffCount++;
        // Bright Magenta (#ff00ff) highlight for mismatched pixels
        diffBuffer[idx] = 255;     // R
        diffBuffer[idx + 1] = 0;   // G
        diffBuffer[idx + 2] = 255; // B
        diffBuffer[idx + 3] = 255; // A
      } else {
        // Dimmed monochrome background for matched pixels
        const gray = Math.round((r1 * 0.299 + g1 * 0.587 + b1 * 0.114) * 0.25);
        diffBuffer[idx] = gray;
        diffBuffer[idx + 1] = gray;
        diffBuffer[idx + 2] = gray;
        diffBuffer[idx + 3] = 255;
      }
    }

    const diffPercentage = totalPixels > 0 ? (diffCount / totalPixels) * 100 : 0;
    return {
      totalPixels,
      diffCount,
      diffPercentage,
      diffBuffer
    };
  }

  // ---------------------------------------------------------------- Scene Registrations

  private static _registerAllScenes(): void {
    // 1. Title Screen
    this._scenes.set('01_title', {
      name: '01_title',
      description: 'Title screen with coiling Ouroboros knot idle backdrop and title modal',
      setup: (app) => {
        app.engine.state = GameState.Title;
        app.engine.frameCount = 60;
        if (app.uiRoot) app.uiRoot.showScreen('modal-main-menu');
      }
    });

    // 2. Class Select Screen
    this._scenes.set('02_class', {
      name: '02_class',
      description: 'Class selection screen displaying all 5 cybernetic serpent classes',
      setup: (app) => {
        app.engine.state = GameState.ClassSelect;
        app.engine.frameCount = 60;
        if (app.uiRoot) app.uiRoot.showScreen('modal-class-select');
      }
    });

    // 3. Emerald Healthy Serpent
    this._scenes.set('03_emerald_healthy', {
      name: '03_emerald_healthy',
      description: 'Healthy Emerald Serpent with 12 segments moving right at 0 degrees',
      setup: (app) => {
        this._setupSerpentScene(app, 'emerald', 50, 50, 25, 25, 12);
      }
    });

    // 4. Emerald Damaged Serpent
    this._scenes.set('04_emerald_damaged', {
      name: '04_emerald_damaged',
      description: 'Damaged Emerald Serpent (headHp 30/50, bodyHp 12/25) with cranial arc and crack lines',
      setup: (app) => {
        this._setupSerpentScene(app, 'emerald', 30, 50, 12, 25, 12);
      }
    });

    // 5. Shadow Stalker Serpent
    this._scenes.set('05_stalker', {
      name: '05_stalker',
      description: 'Shadow Stalker phantom serpent with cyan/violet cybernetic aesthetic',
      setup: (app) => {
        this._setupSerpentScene(app, 'stalker', 50, 50, 25, 25, 12);
      }
    });

    // 6. Hydra Tri-Skull Serpent
    this._scenes.set('06_hydra', {
      name: '06_hydra',
      description: 'Hydra tri-skull serpent with secondary flanking skulls and multi-head silhouette',
      setup: (app) => {
        this._setupSerpentScene(app, 'hydra', 50, 50, 25, 25, 12);
      }
    });

    // 7. Storm Serpent
    this._scenes.set('07_storm', {
      name: '07_storm',
      description: 'Storm serpent charged with atmospheric voltage and electrical blue accents',
      setup: (app) => {
        this._setupSerpentScene(app, 'storm', 50, 50, 25, 25, 12);
      }
    });

    // 8. Solar Serpent
    this._scenes.set('08_solar', {
      name: '08_solar',
      description: 'Solar serpent with searing nuclear starfire carapace and golden solar crests',
      setup: (app) => {
        this._setupSerpentScene(app, 'solar', 50, 50, 25, 25, 12);
      }
    });

    // 9. Food Grid
    this._scenes.set('09_food_grid', {
      name: '09_food_grid',
      description: 'All 8 primary food pickups arranged in an isolated plate in the center arena',
      setup: (app) => {
        app.engine.state = GameState.Playing;
        app.engine.currentFloor = 1;
        app.engine.frameCount = 60;
        this._parkPlayer(app);

        // 8 Food varieties in 2 rows of 4 centered at x=640, y=360
        const foods = [
          { type: 'apple',  x: 430, y: 300 },
          { type: 'golden', x: 570, y: 300 },
          { type: 'shard',  x: 710, y: 300 },
          { type: 'potion', x: 850, y: 300 },
          { type: 'shield', x: 430, y: 420 },
          { type: 'bomb',   x: 570, y: 420 },
          { type: 'chrono', x: 710, y: 420 },
          { type: 'magnet', x: 850, y: 420 }
        ];

        for (const f of foods) {
          const item = new FoodItem(f.x, f.y, f.type);
          item.spawnScale = 1;
          item.pulse = 0;
          item.vx = 0;
          item.vy = 0;
          app.engine.foods.push(item);
        }
      }
    });

    // 10. Enemy Bestiary Grid
    this._scenes.set('10_enemy_grid', {
      name: '10_enemy_grid',
      description: 'All 6 hostile enemy archetypes: spitter, drone, phantom, bruiser, swarmling, scarab',
      setup: (app) => {
        app.engine.state = GameState.Playing;
        app.engine.currentFloor = 1;
        app.engine.frameCount = 60;
        this._parkPlayer(app);

        // 6 enemies in 2 rows of 3 centered at x=640, y=360
        const enemies = [
          { type: 'spitter',   x: 460, y: 300 },
          { type: 'drone',     x: 640, y: 300 },
          { type: 'phantom',   x: 820, y: 300 },
          { type: 'brute',     x: 460, y: 420 }, // Magma Brute / Bruiser
          { type: 'swarmling', x: 640, y: 420 },
          { type: 'scarab',    x: 820, y: 420 }
        ];

        for (const enm of enemies) {
          const e = new Enemy(enm.x, enm.y, enm.type, 1);
          e.spawnTimer = 0;
          e.StateTimer = 0;
          e.vx = 0;
          e.vy = 0;
          e.angle = 0;
          e.hitFlash = 0;
          app.engine.enemies.push(e);
        }
      }
    });

    // 11. Apex Boss Centipede
    this._scenes.set('11_boss_centipede', {
      name: '11_boss_centipede',
      description: 'Centipede Behemoth boss with multi-segment body and circular danger telegraph',
      setup: (app) => {
        app.engine.state = GameState.Playing;
        app.engine.currentFloor = 1;
        app.engine.frameCount = 60;
        this._parkPlayer(app);

        const boss = new Boss(1, 1280, 720, 'centipede', 640, 360);
        boss.x = 640;
        boss.y = 360;
        boss.angle = 0;
        boss.entranceTimer = 0;
        boss.hitFlash = 0;

        // 8 Centipede segments spaced along horizontal spine
        boss.segments = [];
        for (let i = 1; i <= 8; i++) {
          const seg = new BossSegment();
          seg.x = 640 - i * 26;
          seg.y = 360;
          seg.angle = 0;
          seg.r = 20;
          boss.segments.push(seg);
        }

        // Danger telegraph attack zone
        boss.telegraphs = [
          { type: 'circle', x: 640, y: 360, radius: 140, progress: 0.65, color: '#ff3366' }
        ];

        // Also add equivalent in-world hazard telegraph for universal rendering
        const hz = new Hazard({ x: 640, y: 360, radius: 140, type: 'boss_warning', telegraphProgress: 0.65 } as any);
        app.engine.hazards.push(hz);

        app.engine.activeBosses = [boss];
        app.engine.bosses = [boss];
      }
    });

    // 12. Floor 1 Cosmic Backdrop
    this._scenes.set('12_backdrop_floor1', {
      name: '12_backdrop_floor1',
      description: 'Pure Floor 1 cosmic backdrop displaying nebula dust, celestial grid, and 3-tier stars',
      setup: (app) => {
        app.engine.state = GameState.Playing;
        app.engine.currentFloor = 1;
        app.engine.frameCount = 60;
        this._parkPlayer(app);
      }
    });

    // 13. Sanctuary Screen
    this._scenes.set('13_sanctuary', {
      name: '13_sanctuary',
      description: 'Sanctuary meta-upgrade shrine with shard balances and permanent blessings',
      setup: (app) => {
        app.engine.state = GameState.Sanctuary;
        app.engine.frameCount = 60;
        if (app.uiRoot) app.uiRoot.showScreen('modal-sanctuary');
      }
    });

    // 14. Cranial Mutation Lab
    this._scenes.set('14_lab', {
      name: '14_lab',
      description: 'Cranial Mutation Lab interface for head socket augments and alchemical fusions',
      setup: (app) => {
        app.engine.frameCount = 60;
        if (app.uiRoot) app.uiRoot.showScreen('modal-snake-lab');
      }
    });
  }

  // ---------------------------------------------------------------- Helper Routines

  private static _setupSerpentScene(
    app: any,
    classId: string,
    headHp: number,
    headMaxHp: number,
    bodyHp: number,
    bodyMaxHp: number,
    segmentCount: number
  ): void {
    const engine = app.engine;
    engine.state = GameState.Playing;
    engine.currentFloor = 1;
    engine.frameCount = 60;
    engine.selectedClass = classId;

    if (!engine.player) {
      engine.player = new SnakePlayer(classId, engine.arenaW || 1280, engine.arenaH || 720, segmentCount);
    }
    const p = engine.player;

    p.classId = classId;
    p.x = 640;
    p.y = 360;
    p.angle = 0;
    p.headHp = headHp;
    p.headMaxHp = headMaxHp;
    p.hurtFlash = 0;
    p.invulnerableTimer = 0;
    p.mouthOpen = 0;
    p.eyeBlinking = false;
    p.shield = 0;

    // Line up body segments horizontally to the left behind the serpent head
    p.Segments = [];
    for (let i = 1; i <= segmentCount; i++) {
      const seg = new SnakeSegment(640 - i * 16, 360, 0, 11, bodyMaxHp);
      seg.MaxHp = bodyMaxHp;
      seg.Hp = bodyHp;
      p.Segments.push(seg);
    }
  }

  private static _parkPlayer(app: any): void {
    if (!app.engine.player) {
      app.engine.player = new SnakePlayer('emerald', app.engine.arenaW || 1280, app.engine.arenaH || 720, 0);
    }
    const p = app.engine.player;
    p.x = -5000;
    p.y = -5000;
    p.Segments = [];
  }
}
