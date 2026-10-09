import { describe, it, expect } from 'vitest';
import { Rng } from '../core/Rng';
import { MathX } from '../core/MathX';
import { Services } from '../core/Services';
import { ScriptedInput } from '../core/Contracts';
import { GameData } from '../data/GameData';
import { MetaProgression } from '../data/MetaProgression';
import type { CardDef } from '../data/Types';
import { GameState } from '../sim/GameState';
import { GameEngine } from '../sim/GameEngine';
import type { SnakePlayer } from '../sim/SnakePlayer';
import type { Enemy } from '../sim/Enemy';
import type { FoodItem } from '../sim/FoodItem';
import type { Projectile } from '../sim/Projectile';
import type { Boss } from '../sim/Boss';

interface RunResult {
  seed: number;
  survivedSec: number;
  floor: number;
  level: number;
  kills: number;
  ate: number;
  bossKills: number;
  maxCombo: number;
  reachedBoss: boolean;
  victory: boolean;
}

function or1(v: number): number {
  return v !== 0 && !Number.isNaN(v) ? v : 1.0;
}

function setDirection(im: ScriptedInput, dx: number, dy: number): void {
  const mm = Math.sqrt(dx * dx + dy * dy);
  if (!(mm > 0.00001)) { im.setDirection(0, 0); return; }
  im.setDirection(dx / mm, dy / mm);
}

function rarityRank(rarity?: string): number {
  switch (rarity ?? 'common') {
    case 'legendary': return 0;
    case 'epic': return 1;
    case 'rare': return 2;
    default: return 3;
  }
}


function stableRarestFirst(cards: CardDef[]): CardDef {
  let best = cards[0]!;
  let bestRank = rarityRank(best.rarity);
  for (let i = 1; i < cards.length; i++) {
    const r = rarityRank(cards[i]!.rarity);
    if (r < bestRank) {
      bestRank = r;
      best = cards[i]!;
    }
  }
  return best;
}

function jsRunSeed(seed: number): number {
  let sd = (seed >>> 0) || 1;
  sd ^= sd << 13;
  sd >>>= 0;
  sd ^= sd >>> 17;
  sd ^= sd << 5;
  sd >>>= 0;
  const r = sd / 4294967296.0;
  return Math.floor(r * 4294967295.0);
}

function policy(g: GameEngine, im: ScriptedInput): void {
  if (g.state !== GameState.Playing || !g.player) return;
  const p = g.player;
  const hpFrac = p.hp / p.stats.maxHp;

  let hasThreat = false;
  let td = 1e9;
  let thx = 0;
  let thy = 0;

  for (let i = 0; i < g.enemies.length; i++) {
    const e = g.enemies[i]!;
    if (e.dead || !e.vulnerable) continue;
    const d = MathX.hypot(e.x - p.x, e.y - p.y);
    if (d < td) { td = d; hasThreat = true; thx = e.x; thy = e.y; }
  }
  for (let i = 0; i < g.projectiles.length; i++) {
    const pr = g.projectiles[i]!;
    if (pr.source !== 'enemy') continue;
    const d = MathX.hypot(pr.x - p.x, pr.y - p.y);
    if (d < td) { td = d; hasThreat = true; thx = pr.x; thy = pr.y; }
  }

  const boss = g.boss;
  const wantHeal = hpFrac < 0.55;
  let food: FoodItem | null = null;
  let fd = 1e9;
  for (let i = 0; i < g.foods.length; i++) {
    const f = g.foods[i]!;
    if (wantHeal && f.type !== 'potion' && f.type !== 'apple' && f.type !== 'golden') continue;
    const d = MathX.hypot(f.x - p.x, f.y - p.y);
    if (d < fd) { fd = d; food = f; }
  }

  let gx: number, gy: number;
  if (boss && boss.vulnerable && hpFrac > 0.5) { gx = boss.x; gy = boss.y; }
  else if (food) { gx = food.x; gy = food.y; }
  else if (boss && boss.vulnerable) { gx = g.arenaW - boss.x; gy = g.arenaH - boss.y; }
  else { gx = g.arenaW / 2; gy = g.arenaH / 2; }

  let vx = gx - p.x;
  let vy = gy - p.y;
  const vl = or1(MathX.hypot(vx, vy));
  vx /= vl;
  vy /= vl;

  if (hasThreat && td < 110) {
    let ax = p.x - thx;
    let ay = p.y - thy;
    const al = or1(MathX.hypot(ax, ay));
    ax /= al;
    ay /= al;
    const w = 1 - td / 110;
    vx = vx * (1 - w) + ax * w;
    vy = vy * (1 - w) + ay * w;
  }

  const m = 70;
  if (p.x < m) vx += 1; else if (p.x > g.arenaW - m) vx -= 1;
  if (p.y < m) vy += 1; else if (p.y > g.arenaH - m) vy -= 1;

  const l = or1(MathX.hypot(vx, vy));
  setDirection(im, vx / l, vy / l);

  if (p.dashReady) {
    if (hasThreat && td < 90) g.requestDash();
    else if (boss && hpFrac > 0.6 && MathX.hypot(boss.x - p.x, boss.y - p.y) < 160) g.requestDash();
  }
  if (p.skillReady) g.requestSkill();
}

function runOne(seed: number, classId: string, biteInterval = 0.20): RunResult {
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
  let victory = false;
  g.onRunSummary = (won: boolean) => { if (won) victory = true; };
  g.OnRunSummary = (won: boolean) => { if (won) victory = true; };

  g.setupCanvas(1280, 800, 1);
  g.gameMode = 'rogue';
  g.selectedClass = classId;
  g.startRun();

  Rng.Shared.setSeed(jsRunSeed(seed));
  g.player.eyeBlinkTimer = Rng.Shared.range(2, 5);
  g.foods.length = 0;
  for (let k = 0; k < 9; k++) g.spawnFood();

  if (biteInterval > 0) g.combat.biteInterval = biteInterval;

  let bossSeenAt: number | null = null;
  let maxFloor = 1;
  const maxFrames = 120000;
  const frameMs = 16.67;

  let now = 0;
  let lastTime = 0;

  for (let i = 0; i < maxFrames && g.state !== GameState.GameOver; i++) {
    if (g.state === GameState.LevelUp && g.currentDraftCards.length > 0) {
      const pick = stableRarestFirst(g.currentDraftCards);
      g.selectUpgradeCard(pick);
    }

    policy(g, im);

    if (g.boss && bossSeenAt === null) bossSeenAt = g.combat.runTime;
    if (g.currentFloor > maxFloor) maxFloor = g.currentFloor;

    now += frameMs;
    const frameDt = (now - lastTime) / 1000.0;
    lastTime = now;
    g.tick(frameDt);
  }

  return {
    seed,
    survivedSec: Math.round(g.combat.runTime * 10) / 10.0,
    floor: maxFloor,
    level: g.player ? g.player.level : 0,
    kills: g.combat.kills,
    ate: g.combat.foodsEaten,
    bossKills: g.combat.bossKills,
    maxCombo: g.combat.highestRunCombo,
    reachedBoss: bossSeenAt !== null,
    victory
  };
}

describe('PlayTest Automated Balance Probe (20-seed sweeps)', () => {
  const classes = ['emerald', 'stalker', 'hydra', 'storm', 'solar'];

  it.each(classes)('evaluates 20 seeds for class: %s', (classId) => {
    const results: RunResult[] = [];
    for (let s = 0; s < 20; s++) {
      const seed = 1000 + s * 7919;
      const res = runOne(seed, classId, 0.20);
      results.push(res);
    }

    expect(results.length).toBe(20);

    let reachedBossCount = 0;
    let boss1Kills = 0;
    let totalSurvival = 0;

    for (const r of results) {
      if (r.reachedBoss || r.bossKills > 0) reachedBossCount++;
      if (r.bossKills >= 1) boss1Kills++;
      totalSurvival += r.survivedSec;
    }

    const avgSurvival = totalSurvival / results.length;
    const reachedPct = (reachedBossCount / results.length) * 100;
    const b1Pct = (boss1Kills / results.length) * 100;

    // Conformance metrics for baseline
    expect(reachedPct).toBeGreaterThanOrEqual(60);
    expect(b1Pct).toBeGreaterThanOrEqual(50);
    expect(avgSurvival).toBeGreaterThanOrEqual(40.0);
  });
});
