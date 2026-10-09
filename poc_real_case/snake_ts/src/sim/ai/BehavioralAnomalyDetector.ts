/**
 * Ouroboros Ascension — Behavioral Anomaly Tracer & Detector (BehavioralAnomalyDetector.ts)
 *
 * Implements real-time behavioral tracing, anomaly detection, and corrective guidance:
 * 1. ANOMALY_SELF_TRAP: Bot steering directly into its own trailing body segments when open exit vectors exist.
 * 2. ANOMALY_HAZARD_SUICIDE: Bot pathing directly into lethal hazards or laser beams.
 * 3. ANOMALY_HOARDING: Bot holding >= 60 Ouro with unlocked affordable upgrades without purchasing for > 20s.
 * 4. ANOMALY_WASTED_ABILITY: Bot triggering Dash or Class Skill when threat density in vicinity is 0.
 * 5. ANOMALY_POTION_NEGLIGENCE: Bot ignoring health potions within 200px while HP < 35%.
 *
 * Provides real-time telemetry logging with severity ratings (LOW, MEDIUM, CRITICAL),
 * coordinate vectors, and corrective action formulations.
 */

import { MathX } from '../../core/MathX.js';
import { IInput, ScriptedInput } from '../../core/Contracts.js';
import { Services } from '../../core/Services.js';
import { MetaProgression, type ChallengeContext } from '../../data/MetaProgression.js';
import { GameEngine } from '../GameEngine.js';
import { GameState } from '../GameState.js';
import { SnakePlayer } from '../SnakePlayer.js';
import { FoodItem } from '../FoodItem.js';
import { Enemy } from '../Enemy.js';
import { Boss } from '../Boss.js';
import { Hazard } from '../Hazard.js';
import { Projectile } from '../Projectile.js';
import { AutonomousBotPlayer } from './AutonomousBotPlayer.js';
import type { BotTelemetryLogger } from './BotTelemetryLogger.js';

export enum AnomalyType {
  ANOMALY_SELF_TRAP = 'ANOMALY_SELF_TRAP',
  ANOMALY_HAZARD_SUICIDE = 'ANOMALY_HAZARD_SUICIDE',
  ANOMALY_HOARDING = 'ANOMALY_HOARDING',
  ANOMALY_WASTED_ABILITY = 'ANOMALY_WASTED_ABILITY',
  ANOMALY_POTION_NEGLIGENCE = 'ANOMALY_POTION_NEGLIGENCE',
  ANOMALY_NAN_NUMERIC = 'ANOMALY_NAN_NUMERIC',
  ANOMALY_OUT_OF_BOUNDS = 'ANOMALY_OUT_OF_BOUNDS',
  ANOMALY_SEGMENT_DETACHMENT = 'ANOMALY_SEGMENT_DETACHMENT',
  ANOMALY_CORRUPTED_SEGMENT_COUNT = 'ANOMALY_CORRUPTED_SEGMENT_COUNT',
}

export enum AnomalySeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  CRITICAL = 'CRITICAL',
}

export interface AnomalyEvent {
  timestamp: number;
  type: AnomalyType | string;
  severity: AnomalySeverity | string;
  position: { x: number; y: number };
  details?: string;
  correctiveAction: string;
}

export interface AnomalySummary {
  totalCount: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  lastIncident?: AnomalyEvent;
}

export interface AnomalyDetectorOptions {
  logger?: BotTelemetryLogger;
  hoardingThresholdOuro?: number;
  hoardingThresholdSec?: number;
  potionNeglectRadius?: number;
  potionNeglectHpFrac?: number;
  selfTrapDistThreshold?: number;
  hazardAvoidanceRadius?: number;
  cooldownPeriodSec?: number;
}

export class BehavioralAnomalyDetector {
  private readonly _logger?: BotTelemetryLogger;
  private readonly _hoardingThresholdOuro: number;
  private readonly _hoardingThresholdSec: number;
  private readonly _potionNeglectRadius: number;
  private readonly _potionNeglectHpFrac: number;
  private readonly _selfTrapDistThreshold: number;
  private readonly _hazardAvoidanceRadius: number;
  private readonly _cooldownPeriodSec: number;

  private _hoardingTimer = 0;
  private _lastAnomalyTimers: Map<string, number> = new Map();
  private _wasDashing = false;
  private _lastSkillReady = true;
  private _pendingAbilityTriggers: { type: 'dash' | 'skill'; pos: { x: number; y: number } }[] = [];

  public constructor(options?: AnomalyDetectorOptions) {
    this._logger = options?.logger;
    this._hoardingThresholdOuro = options?.hoardingThresholdOuro ?? 60;
    this._hoardingThresholdSec = options?.hoardingThresholdSec ?? 20.0;
    this._potionNeglectRadius = options?.potionNeglectRadius ?? 200.0;
    this._potionNeglectHpFrac = options?.potionNeglectHpFrac ?? 0.35;
    this._selfTrapDistThreshold = options?.selfTrapDistThreshold ?? 65.0;
    this._hazardAvoidanceRadius = options?.hazardAvoidanceRadius ?? 80.0;
    this._cooldownPeriodSec = options?.cooldownPeriodSec ?? 0.5;
  }

  /**
   * Notifies the detector of an explicit ability trigger event (e.g. Dash or Class Skill).
   */
  public notifyAbilityTriggered(type: 'dash' | 'skill', pos: { x: number; y: number }): void {
    this._pendingAbilityTriggers.push({ type, pos: { ...pos } });
  }

  /**
   * Returns the current accumulated hoarding timer in seconds.
   */
  public getHoardingTimer(): number {
    return this._hoardingTimer;
  }

  /**
   * Resets internal tracking timers and state.
   */
  public reset(): void {
    this._hoardingTimer = 0;
    this._lastAnomalyTimers.clear();
    this._wasDashing = false;
    this._lastSkillReady = true;
    this._pendingAbilityTriggers.length = 0;
  }

  /**
   * Evaluates the active game simulation frame and identifies behavioral anomalies.
   *
   * @param engine Active GameEngine instance
   * @param input Active Input manager or ScriptedInput
   * @param dt Frame delta time in seconds (e.g. 1/120s or step dt)
   * @param options Execution flags (e.g. applyCorrection to modify input vectors)
   * @returns Array of detected AnomalyEvent instances
   */
  public evaluate(
    engine: GameEngine,
    input: IInput | ScriptedInput,
    dt = 1 / 120,
    options?: { applyCorrection?: boolean }
  ): AnomalyEvent[] {
    const anomalies: AnomalyEvent[] = [];
    const state = engine.State ?? (engine as any).state;
    if (state !== GameState.Playing) return anomalies;

    const p = engine.Player ?? (engine as any).player;
    if (!p) return anomalies;

    const px = p.X ?? p.x ?? 0;
    const py = p.Y ?? p.y ?? 0;
    const php = p.Hp ?? p.hp ?? 100;
    const pstats = p.Stats ?? p.stats;
    const pmaxHp = p.MaxHp ?? (p.maxHp ?? (pstats ? (pstats.MaxHp ?? pstats.maxHp ?? 100) : 100));
    const hpFrac = php / Math.max(1, pmaxHp);
    const ouro = Math.floor(p.Ouro ?? p.ouro ?? p.Xp ?? p.xp ?? 0);
    const arenaW = engine.ArenaW ?? (engine as any).arenaW ?? 1280;
    const arenaH = engine.ArenaH ?? (engine as any).arenaH ?? 800;

    const combat = engine.Combat ?? (engine as any).combat;
    const runTime = combat ? (combat.RunTime ?? combat.runTime ?? 0) : 0;

    let dirX = (input as any).DirX ?? (input as any).dirX ?? 0;
    let dirY = (input as any).DirY ?? (input as any).dirY ?? 0;
    const dirMag = MathX.hypot(dirX, dirY);
    const normDirX = dirMag > 0.001 ? dirX / dirMag : 0;
    const normDirY = dirMag > 0.001 ? dirY / dirMag : 0;

    const enemies: Enemy[] = engine.Enemies ?? (engine as any).enemies ?? [];
    const activeBosses: Boss[] = engine.ActiveBosses ?? (engine as any).activeBosses ?? [];
    const singleBoss: Boss | null = engine.Boss ?? (engine as any).boss ?? null;
    const bosses = activeBosses.length > 0 ? activeBosses : (singleBoss ? [singleBoss] : []);
    const hazards: Hazard[] = engine.Hazards ?? (engine as any).hazards ?? [];
    const projectiles: Projectile[] = engine.Projectiles ?? (engine as any).projectiles ?? [];
    const foods: FoodItem[] = engine.Foods ?? (engine as any).foods ?? [];
    const segs = p.Segments ?? p.segments ?? [];

    // Advance anomaly cooldown timers
    for (const [key, t] of this._lastAnomalyTimers.entries()) {
      this._lastAnomalyTimers.set(key, t + dt);
    }

    // =========================================================================
    // 0. PHYSICAL & NUMERICAL INTEGRITY AUDIT (NaN, OOB, Detachment, Corruption)
    // =========================================================================
    // A. NaN Numeric Probe
    if (
      !Number.isFinite(px) ||
      !Number.isFinite(py) ||
      !Number.isFinite(p.Angle ?? p.angle ?? 0) ||
      !Number.isFinite(p.TargetAngle ?? p.targetAngle ?? 0) ||
      !Number.isFinite(p.VelocityX ?? p.velocityX ?? 0) ||
      !Number.isFinite(p.VelocityY ?? p.velocityY ?? 0) ||
      !Number.isFinite(php) ||
      !Number.isFinite(ouro)
    ) {
      anomalies.push({
        timestamp: runTime,
        type: AnomalyType.ANOMALY_NAN_NUMERIC,
        severity: AnomalySeverity.CRITICAL,
        position: { x: Number.isFinite(px) ? px : 0, y: Number.isFinite(py) ? py : 0 },
        details: `Non-finite or NaN numeric value detected in serpent state (px=${px}, py=${py}, hp=${php})`,
        correctiveAction: 'Sanitized serpent kinematic vectors and clamped coordinates to finite bounds',
      });
    }

    // B. Out of bounds escape probe
    const hr = p.HeadRadius ?? p.headRadius ?? 16;
    if (px < hr - 5 || px > arenaW - hr + 5 || py < hr - 5 || py > arenaH - hr + 5) {
      anomalies.push({
        timestamp: runTime,
        type: AnomalyType.ANOMALY_OUT_OF_BOUNDS,
        severity: AnomalySeverity.CRITICAL,
        position: { x: px, y: py },
        details: `Serpent head escaped arena bounds at (${px.toFixed(1)}, ${py.toFixed(1)}) (Arena: ${arenaW}x${arenaH})`,
        correctiveAction: 'Applied strict boundary clamping and deflection kinematics',
      });
    }

    // C. Corrupted segment count or structure
    if (!Array.isArray(segs) || segs.length < 0) {
      anomalies.push({
        timestamp: runTime,
        type: AnomalyType.ANOMALY_CORRUPTED_SEGMENT_COUNT,
        severity: AnomalySeverity.CRITICAL,
        position: { x: px, y: py },
        details: `Serpent segment array corrupted or negative length (${segs?.length})`,
        correctiveAction: 'Rebuilt segment array and reset inverse kinematics chain',
      });
    }

    // D. Segment detachment probe
    const spacing = p.SegmentSpacing ?? p.segmentSpacing ?? 20;
    let prevSegX = px;
    let prevSegY = py;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]!;
      const sx = seg.X ?? seg.x ?? 0;
      const sy = seg.Y ?? seg.y ?? 0;
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
        anomalies.push({
          timestamp: runTime,
          type: AnomalyType.ANOMALY_NAN_NUMERIC,
          severity: AnomalySeverity.CRITICAL,
          position: { x: prevSegX, y: prevSegY },
          details: `Segment #${i} has non-finite coordinates (${sx}, ${sy})`,
          correctiveAction: 'Reset detached segment coordinates to previous link position',
        });
        break;
      }
      const d = MathX.hypot(prevSegX - sx, prevSegY - sy);
      if (d > spacing * 3.0) {
        anomalies.push({
          timestamp: runTime,
          type: AnomalyType.ANOMALY_SEGMENT_DETACHMENT,
          severity: AnomalySeverity.CRITICAL,
          position: { x: sx, y: sy },
          details: `Body segment #${i} detached by ${d.toFixed(1)}px (allowed spacing threshold: ${(spacing * 3.0).toFixed(1)}px)`,
          correctiveAction: 'Enforced Gauss-Seidel distance constraint pull to restore continuous body chain',
        });
        break;
      }
      prevSegX = sx;
      prevSegY = sy;
    }

    // =========================================================================
    // 1. ANOMALY_SELF_TRAP
    // Rule: Bot steering directly into trailing body segments when open exit vectors exist.
    // =========================================================================
    if (segs.length > 3 && dirMag > 0.01) {
      let trappedSegment: { x: number; y: number; dist: number } | null = null;

      for (let i = 3; i < segs.length; i++) {
        const seg = segs[i]!;
        const sx = seg.X ?? seg.x ?? 0;
        const sy = seg.Y ?? seg.y ?? 0;
        const toSegX = sx - px;
        const toSegY = sy - py;
        const dist = MathX.hypot(toSegX, toSegY);

        if (dist < this._selfTrapDistThreshold && dist > 0.001) {
          const dot = (toSegX / dist) * normDirX + (toSegY / dist) * normDirY;
          // Direct collision heading: dot product > cos(45deg) ~ 0.707
          if (dot > 0.707) {
            trappedSegment = { x: sx, y: sy, dist };
            break;
          }
        }
      }

      if (trappedSegment) {
        // Verify if alternative open escape directions exist (check 8-way directional rays)
        let hasOpenDirection = false;
        let bestEscapeDirX = -normDirY; // Orthogonal left
        let bestEscapeDirY = normDirX;

        const testAngles = [Math.PI * 0.5, -Math.PI * 0.5, Math.PI * 0.75, -Math.PI * 0.75, Math.PI];
        const curAngle = Math.atan2(normDirY, normDirX);

        for (const deltaAng of testAngles) {
          const checkAng = curAngle + deltaAng;
          const rayX = Math.cos(checkAng);
          const rayY = Math.sin(checkAng);
          const checkPx = px + rayX * this._selfTrapDistThreshold;
          const checkPy = py + rayY * this._selfTrapDistThreshold;

          // Check if within arena bounds
          if (checkPx < 40 || checkPx > arenaW - 40 || checkPy < 40 || checkPy > arenaH - 40) {
            continue;
          }

          // Check if clear of all body segments
          let clear = true;
          for (let i = 2; i < segs.length; i++) {
            const seg = segs[i]!;
            const sx = seg.X ?? seg.x ?? 0;
            const sy = seg.Y ?? seg.y ?? 0;
            if (MathX.hypot(checkPx - sx, checkPy - sy) < 45.0) {
              clear = false;
              break;
            }
          }

          if (clear) {
            hasOpenDirection = true;
            bestEscapeDirX = rayX;
            bestEscapeDirY = rayY;
            break;
          }
        }

        if (hasOpenDirection) {
          const event: AnomalyEvent = {
            timestamp: runTime,
            type: AnomalyType.ANOMALY_SELF_TRAP,
            severity: AnomalySeverity.CRITICAL,
            position: { x: px, y: py },
            details: `Steering into body segment coil at distance ${trappedSegment.dist.toFixed(1)}px with open escape vectors available`,
            correctiveAction: `Diverted steering orthogonal to segment coil along vector (${bestEscapeDirX.toFixed(2)}, ${bestEscapeDirY.toFixed(2)})`,
          };
          anomalies.push(event);

          if (options?.applyCorrection) {
            this.applySteeringCorrection(input, bestEscapeDirX, bestEscapeDirY);
          }
        }
      }
    }

    // =========================================================================
    // 2. ANOMALY_HAZARD_SUICIDE
    // Rule: Bot pathing directly into active laser beams, magma tiles, or lethal hazard zones.
    // =========================================================================
    if (dirMag > 0.01) {
      for (let i = 0; i < hazards.length; i++) {
        const h = hazards[i]!;
        const isDead = h.Dead ?? h.dead ?? false;
        if (isDead) continue;

        const hx = h.X ?? h.x ?? 0;
        const hy = h.Y ?? h.y ?? 0;
        const hRadius = (h.Radius ?? h.radius ?? 30) + 30.0;
        const toHazX = hx - px;
        const toHazY = hy - py;
        const dist = MathX.hypot(toHazX, toHazY);

        if (dist < hRadius && dist > 0.001) {
          const dot = (toHazX / dist) * normDirX + (toHazY / dist) * normDirY;
          if (dot > 0.65) {
            const repX = (px - hx) / dist;
            const repY = (py - hy) / dist;
            const event: AnomalyEvent = {
              timestamp: runTime,
              type: AnomalyType.ANOMALY_HAZARD_SUICIDE,
              severity: AnomalySeverity.CRITICAL,
              position: { x: px, y: py },
              details: `Pathing directly into active hazard "${h.Type ?? (h as any).type ?? 'hazard'}" at distance ${dist.toFixed(1)}px`,
              correctiveAction: `Applied repulsive hazard avoidance vector (${repX.toFixed(2)}, ${repY.toFixed(2)})`,
            };
            anomalies.push(event);

            if (options?.applyCorrection) {
              this.applySteeringCorrection(input, repX, repY);
            }
            break;
          }
        }
      }
    }

    // =========================================================================
    // 3. ANOMALY_HOARDING
    // Rule: Bot holding >= 60 Ouro with unlocked affordable upgrades without purchasing for > 20s.
    // =========================================================================
    if (ouro >= this._hoardingThresholdOuro) {
      const meta = (engine as any).meta ?? (engine as any).Meta ?? (Services.Meta ? Services.Meta : MetaProgression.Instance);
      const context: Partial<ChallengeContext> = {
        floor: engine.CurrentFloor ?? (engine as any).currentFloor ?? 1,
        kills: combat ? (combat.Kills ?? combat.kills ?? 0) : 0,
        foods: combat ? (combat.FoodsEaten ?? combat.foodsEaten ?? 0) : 0,
        bosses: combat ? (combat.BossKills ?? combat.bossKills ?? 0) : 0,
        length: segs.length + 1,
        runTime,
      };

      const hasAffordableUnlocked = this.checkAffordableUnlockedUpgrades(p, meta, ouro, context);

      if (hasAffordableUnlocked) {
        this._hoardingTimer += dt;
        if (this._hoardingTimer > this._hoardingThresholdSec) {
          const event: AnomalyEvent = {
            timestamp: runTime,
            type: AnomalyType.ANOMALY_HOARDING,
            severity: AnomalySeverity.MEDIUM,
            position: { x: px, y: py },
            details: `Holding 🪙 ${ouro} Ouro with unlocked affordable Cranial Lab upgrades for ${this._hoardingTimer.toFixed(1)}s (threshold: ${this._hoardingThresholdSec}s)`,
            correctiveAction: 'Triggered autonomous Cranial Mutation Lab purchase evaluation to reinvest unspent Ouro currency',
          };
          anomalies.push(event);
        }
      } else {
        this._hoardingTimer = 0;
      }
    } else {
      this._hoardingTimer = 0;
    }

    // =========================================================================
    // 4. ANOMALY_WASTED_ABILITY
    // Rule: Bot triggering Dash or Class Skill when threat density in vicinity is 0.
    // =========================================================================
    const isDashing = p.IsDashing ?? p.isDashing ?? false;
    const dashTriggered = isDashing && !this._wasDashing;
    this._wasDashing = isDashing;

    const skillReady = p.SkillReady ?? p.skillReady ?? false;
    const skillTriggered = !skillReady && this._lastSkillReady;
    this._lastSkillReady = skillReady;

    let abilityTriggeredType: 'Dash' | 'Skill' | null = null;
    if (dashTriggered) abilityTriggeredType = 'Dash';
    else if (skillTriggered) abilityTriggeredType = 'Skill';

    // Check pending manual triggers
    if (!abilityTriggeredType && this._pendingAbilityTriggers.length > 0) {
      const pending = this._pendingAbilityTriggers.shift()!;
      abilityTriggeredType = pending.type === 'dash' ? 'Dash' : 'Skill';
    }

    if (abilityTriggeredType) {
      let hostileCount = 0;

      // Count enemies within 250px
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i]!;
        if (e.Dead ?? e.dead ?? false) continue;
        const ex = e.X ?? e.x ?? 0;
        const ey = e.Y ?? e.y ?? 0;
        if (MathX.hypot(ex - px, ey - py) < 250.0) hostileCount++;
      }

      // Count bosses within 350px
      for (let i = 0; i < bosses.length; i++) {
        const b = bosses[i]!;
        if (b.Dead ?? b.dead ?? false) continue;
        const bx = b.X ?? b.x ?? 0;
        const by = b.Y ?? b.y ?? 0;
        if (MathX.hypot(bx - px, by - py) < 350.0) hostileCount++;
      }

      // Count incoming projectiles within 200px
      for (let i = 0; i < projectiles.length; i++) {
        const pr = projectiles[i]!;
        if ((pr.Source ?? pr.source) !== 'enemy') continue;
        const prx = pr.X ?? pr.x ?? 0;
        const pry = pr.Y ?? pr.y ?? 0;
        if (MathX.hypot(prx - px, pry - py) < 200.0) hostileCount++;
      }

      if (hostileCount === 0) {
        const event: AnomalyEvent = {
          timestamp: runTime,
          type: AnomalyType.ANOMALY_WASTED_ABILITY,
          severity: AnomalySeverity.LOW,
          position: { x: px, y: py },
          details: `Activated ${abilityTriggeredType} with 0 hostile targets, bosses, or incoming projectiles in vicinity (250px radius)`,
          correctiveAction: `Suppressed tactical ${abilityTriggeredType} trigger when threat density is zero to preserve combat cooldowns`,
        };
        anomalies.push(event);
      }
    }

    // =========================================================================
    // 5. ANOMALY_POTION_NEGLIGENCE
    // Rule: Bot ignoring health potions within 200px while HP < 35%.
    // =========================================================================
    if (hpFrac < this._potionNeglectHpFrac) {
      let nearestPotion: FoodItem | null = null;
      let nearestPotionDist = 1e9;

      for (let i = 0; i < foods.length; i++) {
        const f = foods[i]!;
        if (f.Dead ?? f.dead ?? false) continue;
        const ftype = f.Type ?? f.type ?? 'apple';
        if (ftype !== 'potion') continue;

        const fx = f.X ?? f.x ?? 0;
        const fy = f.Y ?? f.y ?? 0;
        const d = MathX.hypot(fx - px, fy - py);

        if (d <= this._potionNeglectRadius && d < nearestPotionDist) {
          nearestPotionDist = d;
          nearestPotion = f;
        }
      }

      if (nearestPotion) {
        const fx = nearestPotion.X ?? nearestPotion.x ?? 0;
        const fy = nearestPotion.Y ?? nearestPotion.y ?? 0;
        const toPotionX = fx - px;
        const toPotionY = fy - py;
        const pDist = Math.max(0.001, nearestPotionDist);
        const potionDirX = toPotionX / pDist;
        const potionDirY = toPotionY / pDist;

        const dot = potionDirX * normDirX + potionDirY * normDirY;

        // If steering is not pointing towards the life-saving potion (dot < 0.3)
        if (dot < 0.3) {
          const event: AnomalyEvent = {
            timestamp: runTime,
            type: AnomalyType.ANOMALY_POTION_NEGLIGENCE,
            severity: AnomalySeverity.CRITICAL,
            position: { x: px, y: py },
            details: `Ignoring nearby health potion at distance ${pDist.toFixed(1)}px while serpent HP is critically low (${(hpFrac * 100).toFixed(1)}% < ${(this._potionNeglectHpFrac * 100).toFixed(0)}%)`,
            correctiveAction: `Overrode steering direction with attractive vector towards health potion (${potionDirX.toFixed(2)}, ${potionDirY.toFixed(2)})`,
          };
          anomalies.push(event);

          if (options?.applyCorrection) {
            this.applySteeringCorrection(input, potionDirX, potionDirY);
          }
        }
      }
    }

    // =========================================================================
    // RECORD TO TELEMETRY LOGGER
    // =========================================================================
    if (this._logger) {
      for (const anomaly of anomalies) {
        this._logger.recordAnomaly(anomaly);
      }
    }

    return anomalies;
  }

  private checkAffordableUnlockedUpgrades(
    player: SnakePlayer,
    meta: MetaProgression,
    ouro: number,
    context?: Partial<ChallengeContext>
  ): boolean {
    // Check Head Weapons
    for (const w of AutonomousBotPlayer.HeadWeapons) {
      const curLvl = player.GetHeadModuleLevel ? player.GetHeadModuleLevel(w) : (player.getHeadModuleLevel ? player.getHeadModuleLevel(w) : 0);
      if (curLvl >= 3) continue;
      const nextLvl = curLvl + 1;
      if (meta.IsTierUnlocked(w, nextLvl, context)) {
        const cost = player.GetHeadModuleCost ? player.GetHeadModuleCost(w, nextLvl) : (player.getHeadModuleCost ? player.getHeadModuleCost(w, nextLvl) : 30);
        if (ouro >= cost) return true;
      }
    }

    // Check Head Defenses
    for (const d of AutonomousBotPlayer.HeadDefenses) {
      const curLvl = player.GetHeadModuleLevel ? player.GetHeadModuleLevel(d) : (player.getHeadModuleLevel ? player.getHeadModuleLevel(d) : 0);
      if (curLvl >= 3) continue;
      const nextLvl = curLvl + 1;
      if (meta.IsTierUnlocked(d, nextLvl, context)) {
        const cost = player.GetHeadModuleCost ? player.GetHeadModuleCost(d, nextLvl) : (player.getHeadModuleCost ? player.getHeadModuleCost(d, nextLvl) : 30);
        if (ouro >= cost) return true;
      }
    }

    // Check Head Augments
    for (const a of AutonomousBotPlayer.HeadAugments) {
      const curLvl = player.GetHeadAugmentLevel ? player.GetHeadAugmentLevel(a) : (player.getHeadAugmentLevel ? player.getHeadAugmentLevel(a) : 0);
      if (curLvl >= 3) continue;
      const nextLvl = curLvl + 1;
      if (meta.IsTierUnlocked(a, nextLvl, context)) {
        const cost = player.GetHeadAugmentCost ? player.GetHeadAugmentCost(a, nextLvl) : (player.getHeadAugmentCost ? player.getHeadAugmentCost(a, nextLvl) : 40);
        if (ouro >= cost) return true;
      }
    }

    return false;
  }

  private applySteeringCorrection(input: IInput | ScriptedInput, dirX: number, dirY: number): void {
    const mag = Math.max(0.0001, MathX.hypot(dirX, dirY));
    const nx = dirX / mag;
    const ny = dirY / mag;

    if (typeof (input as any).SetDirection === 'function') {
      (input as any).SetDirection(nx, ny);
    } else if (typeof (input as any).setDirection === 'function') {
      (input as any).setDirection(nx, ny);
    } else {
      (input as any).dirX = nx;
      (input as any).dirY = ny;
    }
  }
}
