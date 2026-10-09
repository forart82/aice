/**
 * Ouroboros Ascension — Autonomous Bot Player AI Controller (AutonomousBotPlayer.ts)
 *
 * Implements:
 * 1. Multi-Step Lookahead & Flood-Fill Space Verification:
 *    - Forward raycasting (3–5 steps ahead, step distance = 25–30px) checking prospective trajectories.
 *    - Spatial verification ensuring accessible maneuvering space > serpent length (L * spacing),
 *      preventing self-entrapment in coils, U-turn pockets, and boundary corners.
 * 2. Human-Like Survival State Machine:
 *    - Emergency Mode (HP < 35%): Prioritizes evasive kiting, dodging hostiles with amplified repulsion,
 *      and seeking health potions and shield orbs with 3x attractive force.
 *    - Tactical Combat Orbit: Orbits active bosses at optimal weapon firing distance (150–250px)
 *      with tangential velocity to maximize DPS while safely avoiding boss collision hulls.
 *    - Normal / Forage Mode: High-value sustenance farming (Prisms, Shards, Golden Apples).
 * 3. Strategic & Synergistic Cranial Mutation Lab Shopper:
 *    - Proactive in-run purchases before boss encounters and whenever Ouro >= 30.
 *    - Class-synergistic build specializations:
 *      * Emerald / Hydra: Defensive armor, carapace shields, and regen bio-organs.
 *      * Stalker / Solar / Storm: Offensive plasma mortars, magma vents, tachyon lasers, and spitters.
 *    - Atomic wallet transactions via player.SpendOuro() and head installations.
 */

import { MathX } from '../../core/MathX.js';
import { ScriptedInput, IInput } from '../../core/Contracts.js';
import { Services } from '../../core/Services.js';
import { GameData } from '../../data/GameData.js';
import { MetaProgression, type ChallengeContext } from '../../data/MetaProgression.js';
import { GameEngine } from '../GameEngine.js';
import { GameState } from '../GameState.js';
import { SnakePlayer } from '../SnakePlayer.js';
import { FoodItem } from '../FoodItem.js';
import { Enemy } from '../Enemy.js';
import { Boss } from '../Boss.js';
import { Hazard } from '../Hazard.js';
import { Projectile } from '../Projectile.js';
import { World } from '../World.js';
import { CardDef } from '../../data/Types.js';
import type { BotTelemetryLogger } from './BotTelemetryLogger.js';

export interface LabPurchaseOption {
  type: 'module' | 'augment';
  id: string;
  name: string;
  category: 'weapon' | 'defense' | 'augment';
  currentLevel: number;
  targetLevel: number;
  cost: number;
  isTierUnlocked: boolean;
  isAffordable: boolean;
  synergyScore?: number;
}

export interface LabEvaluationResult {
  allOptions: LabPurchaseOption[];
  unlockedPurchases: LabPurchaseOption[];
  affordablePurchases: LabPurchaseOption[];
}

export interface LabExecutionResult {
  purchasedCount: number;
  totalSpent: number;
  purchasedItems: LabPurchaseOption[];
}

export class AutonomousBotPlayer {
  public static readonly HeadWeapons: readonly string[] = [
    'turret', 'tesla', 'magma', 'venom', 'tachyon',
    'cryo', 'plasma', 'flak', 'scattershot', 'needler'
  ];

  public static readonly HeadDefenses: readonly string[] = [
    'shield', 'spikes', 'regen', 'magnet', 'chrono', 'nanite'
  ];

  public static readonly HeadAugments: readonly string[] = [
    'fangs', 'maw', 'horns', 'laser', 'crown'
  ];

  public static readonly ModuleNames: Record<string, string> = {
    turret: 'Attack Spitter',
    tesla: 'Bio-Arc Coil',
    magma: 'Magma Vent',
    venom: 'Venom Sprayer',
    tachyon: 'Tachyon Laser',
    cryo: 'Cryo Mortar',
    plasma: 'Plasma Mortar',
    flak: 'Flak Cannon',
    scattershot: 'Scattershot',
    needler: 'Needler',
    shield: 'Carapace Shield',
    spikes: 'Thorny Spikes',
    regen: 'Regen Gland',
    magnet: 'Bio-Magnet',
    chrono: 'Chrono Ward',
    nanite: 'Nanite Swarm',
    fangs: 'Venom Fangs',
    maw: 'Dragon Maw',
    horns: 'Ramming Horns',
    laser: 'Laser Optics',
    crown: 'Solar Crown'
  };

  /** Class synergy preference priority lists (ordered highest to lowest affinity) */
  public static readonly ClassSynergies: Record<string, readonly string[]> = {
    emerald: ['shield', 'regen', 'spikes', 'nanite', 'chrono', 'horns', 'venom', 'turret', 'fangs', 'maw'],
    hydra: ['shield', 'spikes', 'regen', 'nanite', 'horns', 'maw', 'chrono', 'turret', 'magma', 'fangs'],
    stalker: ['plasma', 'tachyon', 'laser', 'magma', 'turret', 'fangs', 'scattershot', 'needler', 'shield', 'chrono'],
    solar: ['magma', 'plasma', 'laser', 'crown', 'turret', 'tesla', 'flak', 'shield', 'horns', 'maw'],
    storm: ['tesla', 'tachyon', 'plasma', 'turret', 'scattershot', 'laser', 'needler', 'shield', 'chrono'],
  };

  /** Cached 28-fusion partner lookup dictionary */
  private static _fusionPartnersMap: Record<string, string[]> | null = null;
  public static get FusionPartnersMap(): Record<string, string[]> {
    if (!AutonomousBotPlayer._fusionPartnersMap) {
      const map: Record<string, string[]> = {};
      const fusions = GameData.AlchemicalFusions ?? [];
      for (let i = 0; i < fusions.length; i++) {
        const f = fusions[i]!;
        const a = f.ModuleA ?? f.moduleA;
        const b = f.ModuleB ?? f.moduleB;
        if (a && b) {
          if (!map[a]) map[a] = [];
          if (!map[b]) map[b] = [];
          map[a]!.push(b);
          map[b]!.push(a);
        }
      }
      AutonomousBotPlayer._fusionPartnersMap = map;
    }
    return AutonomousBotPlayer._fusionPartnersMap;
  }

  /** Active cognitive policy skill tier ('novice' | 'intermediate' | 'apex') */
  public skillTier: 'novice' | 'intermediate' | 'apex' = 'apex';

  /** Boundary repulsion margin in pixels */
  public boundaryMargin = 85.0;
  /** Body segment avoidance distance threshold */
  public bodyAvoidanceRadius = 65.0;
  /** Hazard avoidance distance threshold */
  public hazardAvoidanceRadius = 100.0;
  /** Threat avoidance distance threshold */
  public threatAvoidanceRadius = 110.0;

  /** Multi-step lookahead step distance in pixels (~1 full serpent diameter) */
  public lookaheadStepDist = 28.0;
  /** Number of forward lookahead steps to evaluate */
  public lookaheadSteps = 4;

  /**
   * Configures the bot cognitive policy skill tier and adjusts lookahead depth,
   * obstacle safety margins, and standoff distances.
   *
   * - 'novice' (Hour 0–50): Proportional baseline steering, wide conservative standoff (180–240px).
   * - 'intermediate' (Hour 50–150): Optimal food vacuuming, active skill synergy combos, reduced standoff (150–200px).
   * - 'apex' (Hour 150–300): Predictive boss telegraph dodging, 28-fusion builds, tight aggressive standoff (120–160px).
   */
  public setSkillTier(tier: 'novice' | 'intermediate' | 'apex'): void {
    this.skillTier = tier;
    switch (tier) {
      case 'novice':
        this.lookaheadSteps = 2;
        this.boundaryMargin = 95.0;
        this.bodyAvoidanceRadius = 75.0;
        this.threatAvoidanceRadius = 130.0;
        break;
      case 'intermediate':
        this.lookaheadSteps = 4;
        this.boundaryMargin = 85.0;
        this.bodyAvoidanceRadius = 65.0;
        this.threatAvoidanceRadius = 110.0;
        break;
      case 'apex':
      default:
        this.lookaheadSteps = 5;
        this.boundaryMargin = 75.0;
        this.bodyAvoidanceRadius = 55.0;
        this.threatAvoidanceRadius = 95.0;
        break;
    }
  }
  public SetSkillTier(tier: 'novice' | 'intermediate' | 'apex'): void {
    this.setSkillTier(tier);
  }

  /**
   * Evaluates the situational potential vector field and applies normalized steering
   * to the provided input manager while triggering tactical combat actions.
   */
  public stepPolicy(engine: GameEngine, input: IInput | ScriptedInput): void {
    const state = engine.State ?? (engine as any).state;
    if (state !== GameState.Playing) return;
    const p = engine.Player ?? (engine as any).player;
    if (!p) return;

    const px = p.X ?? p.x ?? 0;
    const py = p.Y ?? p.y ?? 0;
    const php = p.Hp ?? p.hp ?? 100;
    const pstats = p.Stats ?? p.stats;
    const pmaxHp = pstats ? (pstats.MaxHp ?? pstats.maxHp ?? 100) : 100;
    const hpFrac = php / Math.max(1, pmaxHp);
    const arenaW = engine.ArenaW ?? (engine as any).arenaW ?? 1280;
    const arenaH = engine.ArenaH ?? (engine as any).arenaH ?? 800;

    // =========================================================================
    // 0. PROACTIVE CRANIAL LAB SHOPPING (Pre-Boss & High Ouro In-Run Purchases)
    // =========================================================================
    const ouroVal = Math.floor(p.Ouro ?? p.ouro ?? p.Xp ?? p.xp ?? 0);
    const activeBosses: Boss[] = engine.ActiveBosses ?? (engine as any).activeBosses ?? [];
    const singleBoss: Boss | null = engine.Boss ?? (engine as any).boss ?? null;
    const bosses = activeBosses.length > 0 ? activeBosses : (singleBoss ? [singleBoss] : []);
    const primaryBoss = bosses.length > 0 ? bosses[0]! : null;

    if (ouroVal >= 30 && (primaryBoss !== null || ouroVal >= 60)) {
      const curFloor = engine.CurrentFloor ?? (engine as any).currentFloor ?? 1;
      const combat = engine.Combat ?? (engine as any).combat;
      const kills = combat ? (combat.Kills ?? combat.kills ?? 0) : 0;
      const foods = combat ? (combat.FoodsEaten ?? combat.foodsEaten ?? 0) : 0;
      const bossesKilled = combat ? (combat.BossKills ?? combat.bossKills ?? 0) : 0;
      const segCount = (p.Segments ? p.Segments.length : (p.segments ? p.segments.length : 0)) + 1;
      const rTime = combat ? (combat.RunTime ?? combat.runTime ?? 0) : 0;

      const meta = (engine as any).meta ?? (engine as any).Meta ?? (Services.Meta ? Services.Meta : MetaProgression.Instance);
      this.performLabPurchases(p, meta, undefined, {
        floor: curFloor,
        kills,
        foods,
        bosses: bossesKilled,
        length: segCount,
        runTime: rTime,
      });
    }

    // =========================================================================
    // 1. COMBAT TARGET & HOSTILE THREAT ANALYSIS
    // =========================================================================
    const enemies: Enemy[] = engine.Enemies ?? (engine as any).enemies ?? [];
    const hazards: Hazard[] = engine.Hazards ?? (engine as any).hazards ?? [];
    const projectiles: Projectile[] = engine.Projectiles ?? (engine as any).projectiles ?? [];
    const foods: FoodItem[] = engine.Foods ?? (engine as any).foods ?? [];

    let nearestThreatDist = 1e9;
    let threatX = 0;
    let threatY = 0;
    let hasThreat = false;
    let closeThreatCount = 0;

    // Track active enemies
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i]!;
      const isDead = e.Dead ?? e.dead ?? false;
      if (isDead) continue;
      const ex = e.X ?? e.x ?? 0;
      const ey = e.Y ?? e.y ?? 0;
      const d = MathX.hypot(ex - px, ey - py);
      if (d < 80) closeThreatCount++;
      if (d < nearestThreatDist) {
        nearestThreatDist = d;
        hasThreat = true;
        threatX = ex;
        threatY = ey;
      }
    }

    // Track active hazards & telegraphs
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i]!;
      const isDead = h.Dead ?? h.dead ?? false;
      if (isDead) continue;
      const hx = h.X ?? h.x ?? 0;
      const hy = h.Y ?? h.y ?? 0;
      const d = MathX.hypot(hx - px, hy - py);
      if (d < 80) closeThreatCount++;
      if (d < nearestThreatDist) {
        nearestThreatDist = d;
        hasThreat = true;
        threatX = hx;
        threatY = hy;
      }
    }

    // Track incoming enemy projectiles
    for (let i = 0; i < projectiles.length; i++) {
      const pr = projectiles[i]!;
      const source = pr.Source ?? pr.source;
      if (source !== 'enemy') continue;
      const prx = pr.X ?? pr.x ?? 0;
      const pry = pr.Y ?? pr.y ?? 0;
      const d = MathX.hypot(prx - px, pry - py);
      if (d < 70) closeThreatCount++;
      if (d < nearestThreatDist) {
        nearestThreatDist = d;
        hasThreat = true;
        threatX = prx;
        threatY = pry;
      }
    }

    // =========================================================================
    // 2. SURVIVAL STATE MACHINE (Emergency Mode vs Tactical Orbit vs Forage)
    // =========================================================================
    const isEmergency = hpFrac < 0.35;
    const isFrenzy = engine.Combat?.FrenzyActive ?? (engine.Combat as any)?.frenzyActive ?? false;
    const bossVuln = primaryBoss ? (primaryBoss.Vulnerable ?? primaryBoss.vulnerable ?? true) : false;
    const bossX = primaryBoss ? (primaryBoss.X ?? primaryBoss.x ?? 0) : 0;
    const bossY = primaryBoss ? (primaryBoss.Y ?? primaryBoss.y ?? 0) : 0;
    const bossDist = primaryBoss ? MathX.hypot(bossX - px, bossY - py) : 1e9;

    let bestFood: FoodItem | null = null;
    let bestFoodScore = -1e9;

    for (let i = 0; i < foods.length; i++) {
      const f = foods[i]!;
      const isDead = f.Dead ?? f.dead ?? false;
      if (isDead) continue;
      const fx = f.X ?? f.x ?? 0;
      const fy = f.Y ?? f.y ?? 0;
      const ftype = f.Type ?? f.type ?? 'apple';
      const d = Math.max(1, MathX.hypot(fx - px, fy - py));

      // Compute food priority weight with 3x Emergency Boost for Potions and Shields,
      // and dynamic Frenzy Multipliers for Prisms, Shards, and Golden Apples
      let weight = 1.0;
      switch (ftype) {
        case 'potion':
          weight = isEmergency ? 45.0 : (hpFrac < 0.4 ? 15.0 : (hpFrac < 0.75 ? 8.0 : 1.2));
          break;
        case 'shield':
          weight = isEmergency ? 10.5 : 3.5;
          break;
        case 'prism':
          weight = isEmergency ? 3.0 : (isFrenzy ? 28.0 : 10.0);
          break;
        case 'shard':
          weight = isEmergency ? 2.5 : (isFrenzy ? 22.0 : 8.0);
          break;
        case 'golden':
          weight = isEmergency ? 2.0 : (isFrenzy ? 18.0 : 6.0);
          break;
        case 'soul':
          weight = isFrenzy ? 10.0 : 5.0;
          break;
        case 'chrono':
          weight = 4.0;
          break;
        case 'bomb':
          weight = isEmergency ? 1.0 : 3.0;
          break;
        case 'apple':
          weight = isEmergency ? 0.8 : 2.0;
          break;
        default:
          weight = 1.0;
          break;
      }

      // Distance attenuation: score = weight / (d^0.85)
      const score = weight / Math.pow(d, 0.85);
      if (score > bestFoodScore) {
        bestFoodScore = score;
        bestFood = f;
      }
    }

    // Determine target attraction coordinate and primary vector
    let dirX = 0;
    let dirY = 0;

    if (isEmergency) {
      // -----------------------------------------------------------------------
      // STATE A: EMERGENCY EVASION & KITING (HP < 35%)
      // -----------------------------------------------------------------------
      if (bestFood && (bestFood.Type === 'potion' || bestFood.Type === 'shield')) {
        // Direct rush towards healing/shielding item
        dirX = (bestFood.X ?? bestFood.x) - px;
        dirY = (bestFood.Y ?? bestFood.y) - py;
      } else if (hasThreat && nearestThreatDist < 250) {
        // Flee away from nearest threat
        dirX = px - threatX;
        dirY = py - threatY;
      } else if (bestFood) {
        dirX = (bestFood.X ?? bestFood.x) - px;
        dirY = (bestFood.Y ?? bestFood.y) - py;
      } else {
        // Head toward arena center safe zone
        dirX = (arenaW * 0.5) - px;
        dirY = (arenaH * 0.5) - py;
      }
    } else if (primaryBoss && bossVuln) {
      // -----------------------------------------------------------------------
      // STATE B: TACTICAL COMBAT ORBIT (150–220px Standoff Ring)
      // -----------------------------------------------------------------------
      // Vector from player to boss
      const toBossX = bossX - px;
      const toBossY = bossY - py;
      const bLen = Math.max(0.001, bossDist);
      const radX = toBossX / bLen;
      const radY = toBossY / bLen;

      // Tangential orbital velocity: orthogonal unit vector (-radY, radX)
      const tangX = -radY;
      const tangY = radX;

      const minStandoff = this.skillTier === 'apex' ? 120 : (this.skillTier === 'intermediate' ? 150 : 180);
      const maxStandoff = this.skillTier === 'apex' ? 170 : (this.skillTier === 'intermediate' ? 210 : 250);

      if (bossDist < minStandoff) {
        // Too close: Push radially OUTWARD (-rad) to avoid boss collision hull
        const repelWeight = (1.0 - (bossDist / minStandoff)) * 2.5;
        dirX = -radX * repelWeight + tangX * 0.4;
        dirY = -radY * repelWeight + tangY * 0.4;
      } else if (bossDist > maxStandoff) {
        // Too far: Pull radially INWARD (+rad) to close in to weapon range
        const closeWeight = Math.min(2.5, (bossDist - maxStandoff) / 60.0) * 1.5;
        dirX = radX * closeWeight + tangX * 0.35;
        dirY = radY * closeWeight + tangY * 0.35;
      } else {
        // In the sweet spot: Balanced radial weapon arc + tangential orbital circling
        const sweetRadial = this.skillTier === 'apex' ? 1.45 : 1.25;
        const sweetOrbit = this.skillTier === 'apex' ? 0.75 : 0.55;
        dirX = radX * sweetRadial + tangX * sweetOrbit;
        dirY = radY * sweetRadial + tangY * sweetOrbit;
      }
    } else if (bestFood) {
      // -----------------------------------------------------------------------
      // STATE C: SUSTENANCE & FORAGING
      // -----------------------------------------------------------------------
      dirX = (bestFood.X ?? bestFood.x) - px;
      dirY = (bestFood.Y ?? bestFood.y) - py;
    } else if (primaryBoss && !bossVuln) {
      // Perimeter standoff while boss is invulnerable
      dirX = (arenaW - bossX) - px;
      dirY = (arenaH - bossY) - py;
    } else {
      // Default center patrol
      dirX = (arenaW * 0.5) - px;
      dirY = (arenaH * 0.5) - py;
    }

    const dirLen = Math.max(0.0001, MathX.hypot(dirX, dirY));
    dirX /= dirLen;
    dirY /= dirLen;

    // =========================================================================
    // 3. REPULSIVE FORCE FIELDS
    // =========================================================================

    // A. Arena Boundary Repulsion
    const margin = this.boundaryMargin;
    if (px < margin) {
      const w = 1.0 - px / margin;
      dirX += w * 2.2;
    } else if (px > arenaW - margin) {
      const w = 1.0 - (arenaW - px) / margin;
      dirX -= w * 2.2;
    }
    if (py < margin) {
      const w = 1.0 - py / margin;
      dirY += w * 2.2;
    } else if (py > arenaH - margin) {
      const w = 1.0 - (arenaH - py) / margin;
      dirY -= w * 2.2;
    }

    // B. Self-Body Segment Avoidance (Prevent self-trapping / knotting)
    const segs = p.Segments ?? p.segments ?? [];
    if (segs.length > 3) {
      for (let i = 3; i < segs.length; i++) {
        const seg = segs[i]!;
        const sx = seg.X ?? seg.x ?? 0;
        const sy = seg.Y ?? seg.y ?? 0;
        const d = MathX.hypot(px - sx, py - sy);
        if (d < this.bodyAvoidanceRadius && d > 0.001) {
          const w = 1.0 - (d / this.bodyAvoidanceRadius);
          const rx = (px - sx) / d;
          const ry = (py - sy) / d;
          dirX += rx * w * 1.8;
          dirY += ry * w * 1.8;
        }
      }
    }

    // C. Hazard Beams, Magma Tiles, and Telegraph Evasion
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i]!;
      const isDead = h.Dead ?? h.dead ?? false;
      if (isDead) continue;
      const hx = h.X ?? h.x ?? 0;
      const hy = h.Y ?? h.y ?? 0;
      const d = MathX.hypot(px - hx, py - hy);
      const hazRadius = (h.Radius ?? h.radius ?? 26) + 45.0;
      if (d < hazRadius && d > 0.001) {
        const w = 1.0 - (d / hazRadius);
        const rx = (px - hx) / d;
        const ry = (py - hy) / d;
        dirX += rx * w * 2.5;
        dirY += ry * w * 2.5;
      }
    }

    // D. Enemy Projectile Evasion
    for (let i = 0; i < projectiles.length; i++) {
      const pr = projectiles[i]!;
      const source = pr.Source ?? pr.source;
      if (source !== 'enemy') continue;
      const prx = pr.X ?? pr.x ?? 0;
      const pry = pr.Y ?? pr.y ?? 0;
      const d = MathX.hypot(px - prx, pry - py);
      if (d < 85.0 && d > 0.001) {
        const w = 1.0 - (d / 85.0);
        const rx = (px - prx) / d;
        const ry = (py - pry) / d;
        dirX += rx * w * 2.0;
        dirY += ry * w * 2.0;
      }
    }

    // E. General Hostile Threat Repulsion (Amplified in Emergency Mode)
    if (hasThreat && nearestThreatDist < (isEmergency ? 180 : this.threatAvoidanceRadius)) {
      const repLen = Math.max(0.001, MathX.hypot(px - threatX, py - threatY));
      const rx = (px - threatX) / repLen;
      const ry = (py - threatY) / repLen;
      const maxRange = isEmergency ? 180 : this.threatAvoidanceRadius;
      const w = 1.0 - (nearestThreatDist / maxRange);
      const mult = isEmergency ? 2.8 : 1.4;
      dirX = dirX * (1 - w * 0.5) + rx * w * mult;
      dirY = dirY * (1 - w * 0.5) + ry * w * mult;
    }

    // F. Boss Charge / Telegraph Trajectory Prediction & Orthogonal Evasion
    if (primaryBoss && ((primaryBoss.Telegraph ?? (primaryBoss as any).telegraph ?? 0) > 0 || (primaryBoss.MoveTimer ?? (primaryBoss as any).moveTimer ?? 0) > 0)) {
      const bAng = primaryBoss.Angle ?? (primaryBoss as any).angle ?? 0;
      const fwdX = Math.cos(bAng);
      const fwdY = Math.sin(bAng);
      const relX = px - bossX;
      const relY = py - bossY;
      const proj = relX * fwdX + relY * fwdY;
      if (proj > 0 && proj < 320) {
        const perpX = relX - proj * fwdX;
        const perpY = relY - proj * fwdY;
        const perpDist = MathX.hypot(perpX, perpY);
        if (perpDist < 80.0) {
          const w = 1.0 - (perpDist / 80.0);
          const sideX = perpDist > 0.001 ? perpX / perpDist : -fwdY;
          const sideY = perpDist > 0.001 ? perpY / perpDist : fwdX;
          dirX += sideX * w * 2.6;
          dirY += sideY * w * 2.6;
        }
      }
    }

    // =========================================================================
    // 4. MULTI-STEP LOOKAHEAD & FLOOD-FILL SPACE VERIFICATION
    // =========================================================================
    const initialMag = Math.max(0.0001, MathX.hypot(dirX, dirY));
    const primaryCandidateX = dirX / initialMag;
    const primaryCandidateY = dirY / initialMag;

    const refinedDir = this.evaluateLookaheadAndSpace(
      px, py, primaryCandidateX, primaryCandidateY,
      p, engine, arenaW, arenaH, hazards
    );

    const finalDirX = refinedDir.x;
    const finalDirY = refinedDir.y;

    if (typeof (input as any).SetDirection === 'function') {
      (input as any).SetDirection(finalDirX, finalDirY);
    } else if (typeof (input as any).setDirection === 'function') {
      (input as any).setDirection(finalDirX, finalDirY);
    }

    // =========================================================================
    // 5. TACTICAL TRIGGERS (DASH & CLASS SKILL)
    // =========================================================================
    const dashReady = p.DashReady ?? p.dashReady ?? false;
    if (dashReady) {
      // Condition 1: Surrounded by >= 2 hostiles or emergency threat
      if (closeThreatCount >= 2 || (hasThreat && nearestThreatDist < 60) || (isEmergency && nearestThreatDist < 90)) {
        if (input) {
          if (typeof (input as any).RequestDash === 'function') (input as any).RequestDash();
          else if (typeof (input as any).requestDash === 'function') (input as any).requestDash();
          else (input as any).DashQueued = true;
        }
        if (engine && typeof engine.RequestDash === 'function') {
          engine.RequestDash();
        } else if (typeof p.TryDash === 'function') {
          p.TryDash();
        }
      }
      // Condition 2: Closing in to strike a vulnerable boss
      else if (primaryBoss && bossVuln && hpFrac > 0.5) {
        const bDist = MathX.hypot(bossX - px, bossY - py);
        if (bDist < 180 && bDist > 80) {
          if (input) {
            if (typeof (input as any).RequestDash === 'function') (input as any).RequestDash();
            else if (typeof (input as any).requestDash === 'function') (input as any).requestDash();
            else (input as any).DashQueued = true;
          }
          if (engine && typeof engine.RequestDash === 'function') {
            engine.RequestDash();
          } else if (typeof p.TryDash === 'function') {
            p.TryDash();
          }
        }
      }
    }

    // Tactical Skill Trigger
    const skillReady = p.SkillReady ?? p.skillReady ?? false;
    if (skillReady) {
      if (hasThreat || primaryBoss || hpFrac < 0.5) {
        if (input) {
          if (typeof (input as any).RequestSkill === 'function') (input as any).RequestSkill();
          else if (typeof (input as any).requestSkill === 'function') (input as any).requestSkill();
          else (input as any).SkillQueued = true;
        }
        if (engine && typeof engine.RequestSkill === 'function') {
          engine.RequestSkill();
        } else if (typeof p.TriggerSkill === 'function') {
          p.TriggerSkill(engine?.WorldBag ? engine.WorldBag() : (engine as any)?.worldBag(), engine?.Combat);
        }
      }
    }
  }

  /**
   * Forward Multi-Step Raycasting and Flood-Fill Open Space Verification.
   * Evaluates a radial fan of 16 candidate steering directions, computes collision risks
   * across 3-5 forward steps, and measures accessible maneuvering space against serpent length.
   */
  private evaluateLookaheadAndSpace(
    px: number,
    py: number,
    desiredDirX: number,
    desiredDirY: number,
    player: SnakePlayer,
    engine: GameEngine,
    arenaW: number,
    arenaH: number,
    hazards: Hazard[]
  ): { x: number; y: number } {
    const baseAngle = Math.atan2(desiredDirY, desiredDirX);
    const candidateAngles: number[] = [
      baseAngle,
      baseAngle + 0.3927,  // +22.5 deg
      baseAngle - 0.3927,  // -22.5 deg
      baseAngle + 0.7854,  // +45 deg
      baseAngle - 0.7854,  // -45 deg
      baseAngle + 1.1781,  // +67.5 deg
      baseAngle - 1.1781,  // -67.5 deg
      baseAngle + 1.5708,  // +90 deg
      baseAngle - 1.5708,  // -90 deg
      baseAngle + 2.0944,  // +120 deg
      baseAngle - 2.0944,  // -120 deg
      baseAngle + 2.6179,  // +150 deg
      baseAngle - 2.6179,  // -150 deg
      baseAngle + Math.PI, // 180 deg
    ];

    const segs = player.Segments ?? (player as any).segments ?? [];
    const segCount = segs.length + 1;
    const requiredSpaceThreshold = Math.max(120, segCount * 14.0);
    const wallMargin = 40.0;
    const stepDist = this.lookaheadStepDist;
    const steps = this.lookaheadSteps;

    let bestScore = -1e9;
    let bestX = desiredDirX;
    let bestY = desiredDirY;

    for (let c = 0; c < candidateAngles.length; c++) {
      const ang = candidateAngles[c]!;
      const cdirX = Math.cos(ang);
      const cdirY = Math.sin(ang);

      // Alignment score with primary desired steering direction: [-1, +1]
      const alignScore = cdirX * desiredDirX + cdirY * desiredDirY;

      // 1. Multi-Step Forward Raycasting (3-5 steps ahead)
      let rayCollisionPenalty = 0;
      let blockedStep = steps + 1;

      for (let k = 1; k <= steps; k++) {
        const stepX = px + cdirX * (k * stepDist);
        const stepY = py + cdirY * (k * stepDist);

        // A. Check Arena Boundary
        if (
          stepX < wallMargin ||
          stepX > arenaW - wallMargin ||
          stepY < wallMargin ||
          stepY > arenaH - wallMargin
        ) {
          rayCollisionPenalty += (steps - k + 1) * 35.0;
          if (blockedStep > k) blockedStep = k;
          break;
        }

        // B. Check Body Segment Collisions (i >= 3)
        if (segs.length > 3) {
          let hitBody = false;
          for (let s = 3; s < segs.length; s++) {
            const seg = segs[s]!;
            const sx = seg.X ?? seg.x ?? 0;
            const sy = seg.Y ?? seg.y ?? 0;
            const dist = MathX.hypot(stepX - sx, stepY - sy);
            if (dist < 32.0) {
              rayCollisionPenalty += (steps - k + 1) * 45.0;
              hitBody = true;
              if (blockedStep > k) blockedStep = k;
              break;
            }
          }
          if (hitBody) break;
        }

        // C. Check Hazard Intersections
        for (let h = 0; h < hazards.length; h++) {
          const haz = hazards[h]!;
          const isDead = haz.Dead ?? haz.dead ?? false;
          if (isDead) continue;
          const hx = haz.X ?? haz.x ?? 0;
          const hy = haz.Y ?? haz.y ?? 0;
          const hRadius = (haz.Radius ?? haz.radius ?? 26) + 20.0;
          const dist = MathX.hypot(stepX - hx, stepY - hy);
          if (dist < hRadius) {
            rayCollisionPenalty += (steps - k + 1) * 40.0;
            if (blockedStep > k) blockedStep = k;
            break;
          }
        }
      }

      // 2. Flood-Fill / Maneuvering Space Verification from Predicted Endpoint
      const endStepK = Math.min(steps, Math.max(1, blockedStep - 1));
      const endX = px + cdirX * (endStepK * stepDist);
      const endY = py + cdirY * (endStepK * stepDist);

      const reachableSpace = this.sampleAccessibleSpace(
        endX, endY, segs, hazards, arenaW, arenaH, requiredSpaceThreshold * 1.5
      );

      let spacePenalty = 0;
      if (reachableSpace < requiredSpaceThreshold) {
        // Enclosed trap / coil loop / wall dead-end
        const deficit = (requiredSpaceThreshold - reachableSpace) / requiredSpaceThreshold;
        spacePenalty = deficit * 80.0;
      }

      // Total composite cognitive candidate score
      const totalScore = alignScore * 150.0 - rayCollisionPenalty - spacePenalty;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestX = cdirX;
        bestY = cdirY;
      }
    }

    return { x: bestX, y: bestY };
  }

  /**
   * Samples accessible free maneuvering space radiating outward from candidate endpoint.
   */
  private sampleAccessibleSpace(
    ox: number,
    oy: number,
    segs: readonly any[],
    hazards: readonly Hazard[],
    arenaW: number,
    arenaH: number,
    maxSearchDist: number
  ): number {
    let totalClearance = 0;
    const probeDirections = 8;
    const angleStep = MathX.Tau / probeDirections;

    for (let p = 0; p < probeDirections; p++) {
      const probeAngle = p * angleStep;
      const pdx = Math.cos(probeAngle);
      const pdy = Math.sin(probeAngle);

      let probeDist = maxSearchDist;

      // Check wall boundary intercept
      if (pdx < -0.001) {
        probeDist = Math.min(probeDist, (ox - 30.0) / -pdx);
      } else if (pdx > 0.001) {
        probeDist = Math.min(probeDist, (arenaW - 30.0 - ox) / pdx);
      }
      if (pdy < -0.001) {
        probeDist = Math.min(probeDist, (oy - 30.0) / -pdy);
      } else if (pdy > 0.001) {
        probeDist = Math.min(probeDist, (arenaH - 30.0 - oy) / pdy);
      }

      // Check segment intercepts
      if (segs.length > 3) {
        for (let s = 3; s < segs.length; s++) {
          const seg = segs[s]!;
          const sx = seg.X ?? seg.x ?? 0;
          const sy = seg.Y ?? seg.y ?? 0;
          const sdx = sx - ox;
          const sdy = sy - oy;
          const proj = sdx * pdx + sdy * pdy;
          if (proj > 0 && proj < probeDist) {
            const perpDistSq = (sdx * sdx + sdy * sdy) - (proj * proj);
            if (perpDistSq < 28.0 * 28.0) {
              probeDist = proj;
            }
          }
        }
      }

      totalClearance += Math.max(0, probeDist);
    }

    // Average clearance span in pixels
    return totalClearance / probeDirections;
  }

  /**
   * Evaluates all available Head Modules and Cranial Augments against the player's
   * current Ouro balance, unlocked challenge tiers, and class build synergies.
   */
  public evaluateLabPurchases(
    player: SnakePlayer,
    meta: MetaProgression,
    context?: Partial<ChallengeContext>
  ): LabEvaluationResult {
    const allOptions: LabPurchaseOption[] = [];
    const unlockedPurchases: LabPurchaseOption[] = [];
    const affordablePurchases: LabPurchaseOption[] = [];

    const ouro = Math.floor(player.Ouro ?? player.ouro ?? player.Xp ?? player.xp ?? 0);
    const classId = (player.ClassId ?? player.classId ?? 'emerald').toLowerCase();
    const synergyList = AutonomousBotPlayer.ClassSynergies[classId] || AutonomousBotPlayer.ClassSynergies['emerald']!;

    const installedModules = player.HeadModules ?? (player as any).headModules ?? {};
    const fusionBonusPerPair = this.skillTier === 'apex' ? 55 : (this.skillTier === 'intermediate' ? 25 : 0);
    const partnerMap = AutonomousBotPlayer.FusionPartnersMap;

    // Fast helper to evaluate alchemical fusion bonus for a module candidate
    const calcFusionBonus = (modId: string): number => {
      if (fusionBonusPerPair <= 0 || !partnerMap) return 0;
      const partners = partnerMap[modId];
      if (!partners) return 0;
      let bonus = 0;
      for (let i = 0; i < partners.length; i++) {
        if (installedModules[partners[i]!]) {
          bonus += fusionBonusPerPair;
        }
      }
      return bonus;
    };

    // 1. Offensive Weapons (Head Mounted)
    for (const w of AutonomousBotPlayer.HeadWeapons) {
      const curLvl = player.GetHeadModuleLevel ? player.GetHeadModuleLevel(w) : (player.getHeadModuleLevel ? player.getHeadModuleLevel(w) : 0);
      if (curLvl >= 3) continue;
      const nextLvl = curLvl + 1;
      const isUnlocked = meta.IsTierUnlocked(w, nextLvl, context);
      const cost = player.GetHeadModuleCost ? player.GetHeadModuleCost(w, nextLvl) : (player.getHeadModuleCost ? player.getHeadModuleCost(w, nextLvl) : 30);
      const isAffordable = ouro >= cost;

      const synIdx = synergyList.indexOf(w);
      const baseSynergyScore = synIdx >= 0 ? (100 - synIdx * 5) : 10;
      const synergyScore = baseSynergyScore + calcFusionBonus(w);

      const opt: LabPurchaseOption = {
        type: 'module',
        id: w,
        name: AutonomousBotPlayer.ModuleNames[w] || w,
        category: 'weapon',
        currentLevel: curLvl,
        targetLevel: nextLvl,
        cost,
        isTierUnlocked: isUnlocked,
        isAffordable,
        synergyScore,
      };

      allOptions.push(opt);
      if (isUnlocked) unlockedPurchases.push(opt);
      if (isUnlocked && isAffordable) affordablePurchases.push(opt);
    }

    // 2. Defensive Bio-Organs (Head Mounted)
    for (const d of AutonomousBotPlayer.HeadDefenses) {
      const curLvl = player.GetHeadModuleLevel ? player.GetHeadModuleLevel(d) : (player.getHeadModuleLevel ? player.getHeadModuleLevel(d) : 0);
      if (curLvl >= 3) continue;
      const nextLvl = curLvl + 1;
      const isUnlocked = meta.IsTierUnlocked(d, nextLvl, context);
      const cost = player.GetHeadModuleCost ? player.GetHeadModuleCost(d, nextLvl) : (player.getHeadModuleCost ? player.getHeadModuleCost(d, nextLvl) : 30);
      const isAffordable = ouro >= cost;

      const synIdx = synergyList.indexOf(d);
      const baseSynergyScore = synIdx >= 0 ? (100 - synIdx * 5) : 15;
      const synergyScore = baseSynergyScore + calcFusionBonus(d);

      const opt: LabPurchaseOption = {
        type: 'module',
        id: d,
        name: AutonomousBotPlayer.ModuleNames[d] || d,
        category: 'defense',
        currentLevel: curLvl,
        targetLevel: nextLvl,
        cost,
        isTierUnlocked: isUnlocked,
        isAffordable,
        synergyScore,
      };

      allOptions.push(opt);
      if (isUnlocked) unlockedPurchases.push(opt);
      if (isUnlocked && isAffordable) affordablePurchases.push(opt);
    }

    // 3. Cranial Bio-Augmentations
    for (const a of AutonomousBotPlayer.HeadAugments) {
      const curLvl = player.GetHeadAugmentLevel ? player.GetHeadAugmentLevel(a) : (player.getHeadAugmentLevel ? player.getHeadAugmentLevel(a) : 0);
      if (curLvl >= 3) continue;
      const nextLvl = curLvl + 1;
      const isUnlocked = meta.IsTierUnlocked(a, nextLvl, context);
      const cost = player.GetHeadAugmentCost ? player.GetHeadAugmentCost(a, nextLvl) : (player.getHeadAugmentCost ? player.getHeadAugmentCost(a, nextLvl) : 40);
      const isAffordable = ouro >= cost;

      const synIdx = synergyList.indexOf(a);
      const synergyScore = synIdx >= 0 ? (90 - synIdx * 5) : 10;

      const opt: LabPurchaseOption = {
        type: 'augment',
        id: a,
        name: AutonomousBotPlayer.ModuleNames[a] || a,
        category: 'augment',
        currentLevel: curLvl,
        targetLevel: nextLvl,
        cost,
        isTierUnlocked: isUnlocked,
        isAffordable,
        synergyScore,
      };

      allOptions.push(opt);
      if (isUnlocked) unlockedPurchases.push(opt);
      if (isUnlocked && isAffordable) affordablePurchases.push(opt);
    }

    // Sort unlocked and affordable options descending by synergyScore so best builds are picked first
    unlockedPurchases.sort((a, b) => (b.synergyScore ?? 0) - (a.synergyScore ?? 0));
    affordablePurchases.sort((a, b) => (b.synergyScore ?? 0) - (a.synergyScore ?? 0));

    return {
      allOptions,
      unlockedPurchases,
      affordablePurchases,
    };
  }

  /**
   * Executes strategic in-run Cranial Mutation Lab purchases up to the player's Ouro balance,
   * prioritizing synergistic upgrades according to serpent class.
   */
  public performLabPurchases(
    player: SnakePlayer,
    meta: MetaProgression,
    logger?: BotTelemetryLogger,
    context?: Partial<ChallengeContext>
  ): LabExecutionResult {
    let purchasedCount = 0;
    let totalSpent = 0;
    const purchasedItems: LabPurchaseOption[] = [];

    const ouro = Math.floor(player.Ouro ?? player.ouro ?? player.Xp ?? player.xp ?? 0);
    if (ouro < 30) {
      return { purchasedCount, totalSpent, purchasedItems };
    }

    const evaluation = this.evaluateLabPurchases(player, meta, context);
    const installedModules = player.HeadModules ?? (player as any).headModules ?? {};
    const maxInstalledModuleSlots = this.skillTier === 'apex' ? 6 : (this.skillTier === 'intermediate' ? 4 : 2);
    let maxPurchases = this.skillTier === 'apex' ? 4 : (this.skillTier === 'intermediate' ? 2 : 1);

    for (let i = 0; i < evaluation.affordablePurchases.length && maxPurchases > 0; i++) {
      const choice = evaluation.affordablePurchases[i]!;
      if (choice.type === 'module' && !installedModules[choice.id] && Object.keys(installedModules).length >= maxInstalledModuleSlots) {
        continue;
      }

      const curOuro = Math.floor(player.Ouro ?? player.ouro ?? 0);
      if (curOuro < choice.cost) continue;

      const spent = typeof player.SpendOuro === 'function' ? player.SpendOuro(choice.cost) : player.spendOuro(choice.cost);
      if (!spent) continue;

      totalSpent += choice.cost;
      purchasedCount++;
      purchasedItems.push(choice);
      maxPurchases--;

      // Install Head Module or Augment
      if (choice.type === 'module') {
        if (typeof player.InstallHeadModule === 'function') {
          player.InstallHeadModule(choice.id);
        } else {
          player.installHeadModule(choice.id);
        }
      } else {
        if (typeof player.InstallHeadAugment === 'function') {
          player.InstallHeadAugment(choice.id);
        } else {
          player.installHeadAugment(choice.id);
        }
      }

      // Record in Telemetry Logger if provided
      if (logger) {
        logger.RecordUpgrade({
          type: choice.type,
          id: choice.id,
          name: choice.name,
          level: choice.targetLevel,
          cost: choice.cost,
          floor: context?.floor ?? 1,
          timestamp: context?.runTime ?? 0,
        });
        logger.RecordOuroSpent(choice.cost);
      }
    }

    return {
      purchasedCount,
      totalSpent,
      purchasedItems,
    };
  }

  /**
   * Handles draft selection, Cranial Lab purchasing, and helmet equipping during LevelUp state.
   */
  public handleLevelUp(engine: GameEngine, logger?: BotTelemetryLogger): void {
    const state = engine.State ?? (engine as any).state;
    if (state !== GameState.LevelUp) return;

    const draftCards: CardDef[] = engine.CurrentDraftCards ?? (engine as any).currentDraftCards ?? [];
    const player = engine.Player ?? (engine as any).player;

    // 1. Pick Rarest Draft Card
    if (draftCards.length > 0) {
      let bestCard = draftCards[0]!;
      let bestWeight = this.cardRarityWeight(bestCard.Rarity ?? bestCard.rarity);

      for (let i = 1; i < draftCards.length; i++) {
        const card = draftCards[i]!;
        const weight = this.cardRarityWeight(card.Rarity ?? card.rarity);
        if (weight > bestWeight) {
          bestWeight = weight;
          bestCard = card;
        }
      }
      if (typeof engine.SelectUpgradeCard === 'function') {
        engine.SelectUpgradeCard(bestCard);
      } else {
        (engine as any).selectUpgradeCard(bestCard);
      }

      if (logger) {
        const cname = bestCard.Title ?? bestCard.title ?? 'Card';
        const cid = bestCard.Id ?? bestCard.id ?? cname;
        const curFloor = engine.CurrentFloor ?? (engine as any).currentFloor ?? 1;
        const combat = engine.Combat ?? (engine as any).combat;
        const rTime = combat ? (combat.RunTime ?? combat.runTime ?? 0) : 0;
        logger.RecordUpgrade({
          type: 'card',
          id: cid,
          name: cname,
          level: 1,
          cost: 0,
          floor: curFloor,
          timestamp: rTime,
        });
      }
    }

    // 2. Perform Legitimate Cranial Lab Purchases with Available Ouro
    const meta = (engine as any).meta ?? Services.Meta ?? MetaProgression.Instance;
    if (player && meta) {
      this.performLabPurchases(player, meta, logger, {
        floor: engine.CurrentFloor ?? (engine as any).currentFloor ?? 1,
        kills: engine.Combat?.Kills ?? (engine.Combat as any)?.kills ?? 0,
        foods: engine.Combat?.FoodsEaten ?? (engine.Combat as any)?.foodsEaten ?? 0,
        bosses: engine.Combat?.BossKills ?? (engine.Combat as any)?.bossKills ?? 0,
        length: (player.Segments?.length ?? 0) + 1,
        runTime: engine.Combat?.RunTime ?? (engine.Combat as any)?.runTime ?? 0,
      });

      // 3. Equip Best Unlocked Helmet in Vault
      this.equipBestHelmet(player, meta, logger);
    }
  }

  /**
   * Equips the highest rarity helmet currently owned in the MetaProgression vault.
   */
  public equipBestHelmet(player: SnakePlayer, meta: MetaProgression, _logger?: BotTelemetryLogger): void {
    if (!player || !meta || !meta.Helmets || meta.Helmets.length === 0) return;
    const rarityWeight = (r: string) => (r === 'legendary' ? 4 : r === 'epic' ? 3 : r === 'rare' ? 2 : 1);
    let bestHelm = meta.Helmets[0]!;
    let bestScore = rarityWeight((bestHelm.Rarity ?? bestHelm.rarity ?? 'common').toLowerCase());

    for (let i = 1; i < meta.Helmets.length; i++) {
      const h = meta.Helmets[i]!;
      const score = rarityWeight((h.Rarity ?? h.rarity ?? 'common').toLowerCase());
      if (score > bestScore) {
        bestScore = score;
        bestHelm = h;
      }
    }

    const helmId = bestHelm.Id ?? bestHelm.id;
    if (helmId) {
      meta.EquipHelmet(helmId);
    }
    player.EquippedHelmet = bestHelm;
    player.equippedHelmet = bestHelm;
  }

  /**
   * Navigates Main Menu and Class Select screens legitimately:
   * Selects game mode, validates unlocked class with meta vault, and launches standard gameplay.
   */
  public navigateFromMenu(
    engine: GameEngine,
    mode: string = 'rogue',
    classId: string = 'emerald'
  ): void {
    const meta = (engine as any).meta ?? Services.Meta ?? MetaProgression.Instance;
    const resolvedClass = meta && !meta.IsUnlocked(classId) ? 'emerald' : classId;

    if (typeof engine.ChooseMode === 'function') {
      engine.ChooseMode(mode);
    } else if (typeof (engine as any).chooseMode === 'function') {
      (engine as any).chooseMode(mode);
    } else {
      engine.GameMode = mode;
      engine.State = GameState.ClassSelect;
    }

    engine.SelectedClass = resolvedClass;

    if (typeof engine.StartRun === 'function') {
      engine.StartRun();
    } else if (typeof (engine as any).startRun === 'function') {
      (engine as any).startRun();
    }
  }

  private cardRarityWeight(rarity?: string): number {
    switch (rarity ?? 'common') {
      case 'legendary': return 4;
      case 'epic': return 3;
      case 'rare': return 2;
      default: return 1;
    }
  }
}
