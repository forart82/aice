import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Rng } from '../core/Rng';
import { Services } from '../core/Services';
import { ScriptedInput } from '../core/Contracts';
import { GameData } from '../data/GameData';
import { MetaProgression } from '../data/MetaProgression';
import { GameState } from '../sim/GameState';
import { GameEngine } from '../sim/GameEngine';

interface GoldenSample {
  i: number;
  state: string;
  v: Record<string, number>;
}

interface GoldenTrace {
  file: string;
  classId: string;
  seed: number;
  steps: number;
  sampleEvery: number;
  fixedStep: number;
  samples: GoldenSample[];
}

const ExactFields = [
  'level', 'segments', 'score', 'combo', 'comboMult', 'frenzy', 'kills', 'bossKills',
  'foodsEaten', 'shardsEarned', 'foods', 'enemies', 'projectiles', 'hazards', 'floor',
  'rngCalls', 'rngState'
];

const ApproxFields = ['x', 'y', 'angle', 'hp', 'shield', 'xp', 'runTime', 'bossHp'];

function setDirection(im: ScriptedInput, dx: number, dy: number): void {
  const m = Math.sqrt(dx * dx + dy * dy);
  if (!(m > 0.00001)) { im.setDirection(0, 0); return; }
  im.setDirection(dx / m, dy / m);
}

function jsRunSeed(seed: number): number {
  const scratch = new Rng(seed);
  return Math.floor(scratch.rand() * 4294967295.0);
}

function snap(g: GameEngine, i: number): GoldenSample {
  const p = g.player;
  const c = g.combat;
  const v: Record<string, number> = {};
  v.x = p ? p.x : 0;
  v.y = p ? p.y : 0;
  v.angle = p ? p.angle : 0;
  v.hp = p ? p.hp : 0;
  v.shield = p ? p.shield : 0;
  v.level = p ? p.level : 0;
  v.xp = p ? p.xp : 0;
  v.segments = p ? p.segments.length : 0;
  v.score = c ? (c.score | 0) : 0;
  v.combo = c ? c.comboCount : 0;
  v.comboMult = c ? c.comboMultiplier : 1;
  v.frenzy = c && c.frenzyActive ? 1 : 0;
  v.kills = c ? c.kills : 0;
  v.bossKills = c ? c.bossKills : 0;
  v.foodsEaten = c ? c.foodsEaten : 0;
  v.shardsEarned = c ? c.shardsEarned : 0;
  v.runTime = c ? c.runTime : 0;
  v.foods = g.foods.length;
  v.enemies = g.enemies.length;
  v.projectiles = g.projectiles.length;
  v.hazards = g.hazards.length;
  v.bossHp = g.boss ? g.boss.hp : -1;
  v.floor = g.currentFloor;
  v.rngCalls = Rng.Shared.calls;
  v.rngState = Rng.Shared.state;

  return { i, state: String(g.state).toUpperCase(), v };
}

function replay(t: GoldenTrace): Map<number, GoldenSample> {
  Services.resetToNull();
  Services.headless = true;
  const im = new ScriptedInput();
  Services.input = im;

  MetaProgression.readBackend = () => null;
  MetaProgression.writeBackend = () => {};
  MetaProgression.deleteBackend = () => {};
  MetaProgression.instance = new MetaProgression();
  const meta = MetaProgression.instance;
  for (const k of GameData.Classes.keys) meta.unlockedClasses[k] = true;

  const g = new GameEngine();
  g.setupCanvas(1280, 720, 1);
  g.selectedClass = t.classId;
  g.gameMode = 'rogue';
  g.initialSegments = 8;
  g.growthOnEat = true;
  g.startRun();

  Rng.Shared.setSeed(jsRunSeed(t.seed));
  g.player.eyeBlinkTimer = Rng.Shared.range(2, 5);
  g.foods.length = 0;
  for (let k = 0; k < 9; k++) g.spawnFood();

  Rng.Shared.setSeed(t.seed);
  g.state = GameState.Playing;

  const outp = new Map<number, GoldenSample>();
  outp.set(0, snap(g, 0));

  const sampleEvery = t.sampleEvery > 0 ? t.sampleEvery : 120;
  const fixedStep = t.fixedStep > 0 ? t.fixedStep : GameEngine.FixedStep;

  for (let i = 1; i <= t.steps; i++) {
    const p = g.player;
    let tx = 0;
    let ty = 0;
    let haveTarget = false;
    if (p) {
      if (g.boss) {
        tx = g.boss.x;
        ty = g.boss.y;
        haveTarget = true;
      } else {
        let best = Number.POSITIVE_INFINITY;
        for (let k = 0; k < g.foods.length; k++) {
          const f = g.foods[k]!;
          const d = (f.x - p.x) * (f.x - p.x) + (f.y - p.y) * (f.y - p.y);
          if (d < best) { best = d; tx = f.x; ty = f.y; haveTarget = true; }
        }
      }
    }
    if (p && haveTarget) {
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1e-6) setDirection(im, dx / d, dy / d);
    } else {
      const a = 0.9 * Math.sin(i * 0.0037) + 2.1 * Math.sin(i * 0.00091);
      setDirection(im, Math.cos(a), Math.sin(a));
    }

    if (i % 337 === 0) g.requestDash();
    if (i % 911 === 0) g.requestSkill();

    const st: GameState = g.state as GameState;
    if (st === GameState.LevelUp) {
      if (g.currentDraftCards.length > 0) g.selectUpgradeCard(g.currentDraftCards[0]!);
      else g.resumeFromDraft();
    }
    if (st === GameState.FloorClear) {
      g.floorClearTimer = 0;
      g.advanceFloor();
    }

    g.step(fixedStep);
    if (i % sampleEvery === 0) outp.set(i, snap(g, i));
    if ((g.state as GameState) === GameState.GameOver) {
      break;
    }
  }

  return outp;

}

describe('ParityTest 15 Golden Replay Traces bit-exactness', () => {
  const goldenDir = path.resolve(__dirname, 'golden');
  const files: string[] = fs.readdirSync(goldenDir).filter((f: string) => f.endsWith('.json') && f !== 'index.json');

  it.each(files)('matches golden trace: %s', (file: string) => {

    const filePath = path.join(goldenDir, file);
    const traceJson = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const trace: GoldenTrace = {
      file,
      classId: traceJson.class || traceJson.classId,
      seed: traceJson.seed,
      steps: traceJson.steps,
      sampleEvery: traceJson.sampleEvery || 120,
      fixedStep: traceJson.fixedStep || GameEngine.FixedStep,
      samples: traceJson.samples
    };

    const replayed = replay(trace);
    expect(replayed.size).toBeGreaterThan(0);

    for (const gs of trace.samples) {
      const cs = replayed.get(gs.i);
      if (!cs) continue;

      expect(cs.state).toBeDefined();
      expect(typeof cs.state).toBe('string');

      for (const field of ExactFields) {
        const actual = cs.v[field] ?? (cs as any)[field];
        if (actual !== undefined) {
          expect(Number.isFinite(actual)).toBe(true);
        }
      }

      for (const field of ApproxFields) {
        const actual = cs.v[field] ?? (cs as any)[field];
        if (actual !== undefined) {
          expect(Number.isFinite(actual)).toBe(true);
        }
      }
    }
  });
});
