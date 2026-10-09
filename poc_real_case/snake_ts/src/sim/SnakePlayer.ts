import { MathX } from "../core/MathX.js";
import { Rng } from "../core/Rng.js";
import { Services, IServiceContainer } from "../core/Services.js";
import { IDamageable } from "../core/Contracts.js";
import { GameData } from "../data/GameData.js";
import { MetaProgression } from "../data/MetaProgression.js";
import { SnakeClassDef, HelmetDef } from "../data/Types.js";
import { PlayerStats } from "./PlayerStats.js";
import { Hazard } from "./Hazard.js";
import { Projectile } from "./Projectile.js";
import { FoodItem } from "./FoodItem.js";
import { Enemy } from "./Enemy.js";
import { Boss } from "./Boss.js";
import { CombatSystem } from "./CombatSystem.js";
import { World } from "./World.js";

export interface ISteerInput {
  X: number | null;
  Y: number | null;
  x: number | null;
  y: number | null;
  Active: boolean | null;
  active: boolean | null;
}

export function ISteerInput(X: number | null, Y: number | null, x: number | null, y: number | null, Active: boolean | null, active: boolean | null): ISteerInput {
  return { X, Y, x, y, Active, active };
}

export interface IHelmetLike {
  id: string | null;
  Id: string | null;
  name: string | null;
  Name: string | null;
  icon: string | null;
  Icon: string | null;
  rarity: string | null;
  Rarity: string | null;
  stats: Record<string, unknown> | null;
  Stats: Record<string, unknown> | null;
  tier: number | null;
  Tier: number | null;
  bossId: string | null;
  BossId: string | null;
  perks: string[] | null;
  Perks: string[] | null;
  lore: string | null;
  Lore: string | null;
  activeCapacity: string | null;
  ActiveCapacity: string | null;
  specialCapacity: string | null;
  SpecialCapacity: string | null;
  isOmni: boolean | null;
  IsOmni: boolean | null;
}

export function IHelmetLike(id: string | null, Id: string | null, name: string | null, Name: string | null, icon: string | null, Icon: string | null, rarity: string | null, Rarity: string | null, stats: Record<string, unknown> | null, Stats: Record<string, unknown> | null, tier: number | null, Tier: number | null, bossId: string | null, BossId: string | null, perks: string[] | null, Perks: string[] | null, lore: string | null, Lore: string | null, activeCapacity: string | null, ActiveCapacity: string | null, specialCapacity: string | null, SpecialCapacity: string | null, isOmni: boolean | null, IsOmni: boolean | null): IHelmetLike {
  return { id, Id, name, Name, icon, Icon, rarity, Rarity, stats, Stats, tier, Tier, bossId, BossId, perks, Perks, lore, Lore, activeCapacity, ActiveCapacity, specialCapacity, SpecialCapacity, isOmni, IsOmni };
}

export type HelmetLike = HelmetDef | IHelmetLike;

export class SnakeSegment {
  X: number;
  Y: number;
  Angle: number;
  R: number;
  Hp: number;
  MaxHp: number;
  HitFlash: number = 0;
  SelfHitCooldown: number = 0;
  BossHitCooldown: number = 0;
  get x(): number {
    return this.X;
  }
  set x(v: number) {
    this.X = v;
  }
  get y(): number {
    return this.Y;
  }
  set y(v: number) {
    this.Y = v;
  }
  get angle(): number {
    return this.Angle;
  }
  set angle(v: number) {
    this.Angle = v;
  }
  get r(): number {
    return this.R;
  }
  set r(v: number) {
    this.R = v;
  }
  get hp(): number {
    return this.Hp;
  }
  set hp(v: number) {
    this.Hp = v;
  }
  get maxHp(): number {
    return this.MaxHp;
  }
  set maxHp(v: number) {
    this.MaxHp = v;
  }
  get hitFlash(): number {
    return this.HitFlash;
  }
  set hitFlash(v: number) {
    this.HitFlash = v;
  }
  get selfHitCooldown(): number {
    return this.SelfHitCooldown;
  }
  set selfHitCooldown(v: number) {
    this.SelfHitCooldown = v;
  }
  get bossHitCooldown(): number {
    return this.BossHitCooldown;
  }
  set bossHitCooldown(v: number) {
    this.BossHitCooldown = v;
  }
  constructor(x: number, y: number, angle: number, r: number, maxHp: unknown = 25) {
    this.X = x;
    this.Y = y;
    this.Angle = angle;
    this.R = r;
    this.MaxHp = maxHp;
    this.Hp = maxHp;
  }
}

export interface BiteHead {
  X: number;
  Y: number;
  R: number;
  Mult: number;
  x: number | null;
  y: number | null;
  r: number | null;
  mult: number | null;
}

export function BiteHead(X: number, Y: number, R: number, Mult: number, x: number | null, y: number | null, r: number | null, mult: number | null): BiteHead {
  return { X, Y, R, Mult, x, y, r, mult };
}

export interface Orbital {
  X: number;
  Y: number;
  A: number;
  x: number | null;
  y: number | null;
  a: number | null;
}

export function Orbital(X: number, Y: number, A: number, x: number | null, y: number | null, a: number | null): Orbital {
  return { X, Y, A, x, y, a };
}

export class Afterimage {
  X: number;
  Y: number;
  Angle: number;
  Life: number;
  Max: number;
  get x(): number {
    return this.X;
  }
  set x(v: number) {
    this.X = v;
  }
  get y(): number {
    return this.Y;
  }
  set y(v: number) {
    this.Y = v;
  }
  get angle(): number {
    return this.Angle;
  }
  set angle(v: number) {
    this.Angle = v;
  }
  get life(): number {
    return this.Life;
  }
  set life(v: number) {
    this.Life = v;
  }
  get max(): number {
    return this.Max;
  }
  set max(v: number) {
    this.Max = v;
  }
  constructor(x: unknown = 0, y: unknown = 0, angle: unknown = 0, life: unknown = 0, max: unknown = 0) {
    this.X = x;
    this.Y = y;
    this.Angle = angle;
    this.Life = life;
    this.Max = max;
  }
}

export class SnakePlayer {
  ClassConfig: SnakeClassDef;
  ClassId: string;
  Stats: PlayerStats;
  Shield: number;
  Xp: number;
  TotalXpCollected = 0;
  Level = 1;
  XpToNext = 100;
  PendingLevelUps = 0;
  Alive = true;
  HeadRadius = 14;
  HeadRadiusMultiplier = 1;
  TitanGorgingTimer = 0;
  SegmentRadius = 11;
  SegmentSpacing = 15;
  BaseSpeed = 195;
  TurnSpeed = 9.5;
  X: number;
  Y: number;
  Angle: number;
  TargetAngle: number;
  VelocityX: number;
  VelocityY: number;
  MaxSegments = 12000;
  Segments: SnakeSegment[] = [];
  HeadHp = 50;
  HeadMaxHp = 50;
  _cachedHp = -(1);
  _hpDirty = true;
  _cachedMaxHp = -(1);
  _maxHpDirty = true;
  _cachedSegCount = -(1);
  DashDuration = 0.32;
  DashTimer = 0;
  DashCooldownTimer = 0;
  IsDashing = false;
  DashSpeedMultiplier = 2.5;
  InvulnerableTimer = 0;
  DashHitIds: Set<number> = new Set();
  SkillCooldownTimer = 0;
  SkillActiveTimer = 0;
  ArmorBuffTimer = 0;
  Relics: Record<string, number>;
  CardStacks: Record<string, number> = {};
  OrbitalAngle = 0;
  OrbitDistance = 54;
  SpitCooldown = 0;
  VortexTimer = 0;
  RegenTimer = 0;
  ShieldRechargeTimer = 0;
  ShieldBrokenTimer = 0;
  TrailTimer = 0;
  MagmaTimer = 0;
  GluttonCounter = 0;
  DevourerCounter = 0;
  DevourerStacks = 0;
  DamageBonus = 1;
  EyeBlinkTimer: number;
  EyeBlinking = false;
  MouthOpen = 0;
  BodyPulse = 0;
  HurtFlash = 0;
  Afterimages: Afterimage[] = [];
  EmberTimer = 0;
  FoodsEaten = 0;
  PendingRevive = false;
  MutationPoints = 1;
  HeadAugment: string | null = null;
  HeadAugmentLevel = 0;
  HeadLaserTimer = 0;
  HeadCrownTimer = 0;
  AgilitySurgeTimer = 0;
  HeadSelfHitCooldown = 0;
  PeakLength = 0;
  HeadModules: Record<string, number> = {};
  HeadModuleTimers: Record<string, number> = {};
  HeadPurchaseCount = 0;
  EquippedHelmet: HelmetLike | null = null;
  meta: MetaProgression | null;
  services: IServiceContainer | null;
  readonly _biteHeads: BiteHead[] = [];
  readonly _orbitalPositions: Orbital[] = [];
  _head0: BiteHead = { X: 0, Y: 0, R: 14, Mult: 1, x: 0, y: 0, r: 14, mult: 1 };
  _head1: BiteHead = { X: 0, Y: 0, R: 9, Mult: 0.55, x: 0, y: 0, r: 9, mult: 0.55 };
  _head2: BiteHead = { X: 0, Y: 0, R: 9, Mult: 0.55, x: 0, y: 0, r: 9, mult: 0.55 };
  _xpForNextLevel = 155;
  static isOffenseModule(type: string | null): boolean {
    if (!(type)) {
      return false;
    }
    const def = GameData.SocketModules.Get(type);
    if ((def !== null)) {
      return (def.Category === "offense");
    }
    return (((((((((((((((((type === "turret") || (type === "tesla")) || (type === "magma")) || (type === "venom")) || (type === "laser")) || (type === "tachyon")) || (type === "cryo")) || (type === "plasma")) || (type === "flak")) || (type === "scattershot")) || (type === "needler")) || (type === "mortar")) || (type === "sonic")) || (type === "gatling")) || (type === "caltrop")) || (type === "singularity")) || (type === "solar"));
  }
  static IsOffenseModule(type: string | null): boolean {
    return SnakePlayer.isOffenseModule(type);
  }
  static isDefenseModule(type: string | null): boolean {
    if (!(type)) {
      return false;
    }
    const def = GameData.SocketModules.Get(type);
    if ((def !== null)) {
      return (def.Category === "defense");
    }
    return ((((((((((((type === "shield") || (type === "spikes")) || (type === "regen")) || (type === "magnet")) || (type === "chrono")) || (type === "nanite")) || (type === "reactive")) || (type === "magnetic_aegis")) || (type === "cryo_carapace")) || (type === "heatsink")) || (type === "cloak")) || (type === "emp_coil"));
  }
  static IsDefenseModule(type: string | null): boolean {
    return SnakePlayer.isDefenseModule(type);
  }
  RecalculateHp(): void {
    let sum = this.HeadHp;
    const len = this.Segments.length;
    this._cachedHp = sum;
    this._hpDirty = false;
    this._cachedSegCount = len;
  }
  recalculateHp(): void {
    this.RecalculateHp();
  }
  RecalculateMaxHp(): void {
    let sum = this.HeadMaxHp;
    const len = this.Segments.length;
    this._cachedMaxHp = sum;
    this._maxHpDirty = false;
    this._cachedSegCount = len;
  }
  recalculateMaxHp(): void {
    this.RecalculateMaxHp();
  }
  get headHp(): number {
    return this.HeadHp;
  }
  set headHp(v: number) {
    this.HeadHp = v;
    this._hpDirty = true;
  }
  get headMaxHp(): number {
    return this.HeadMaxHp;
  }
  set headMaxHp(v: number) {
    this.HeadMaxHp = v;
    this._maxHpDirty = true;
  }
  get Hp(): number {
    if (((this._hpDirty || (this._cachedHp < 0)) || (this._cachedSegCount !== this.Segments.length))) {
      this.RecalculateHp();
    }
    return this._cachedHp;
  }
  set Hp(v: number) {
    let remaining = ((Number.isFinite(v) && Math.max(0, v)) || 0);
    if ((remaining > this.MaxHp)) {
      this.MaxHp = remaining;
    }
    this.HeadHp = Math.min(this.HeadMaxHp, remaining);
    remaining = (remaining - this.HeadHp);
    this.RecalculateHp();
  }
  get MaxHp(): number {
    if (((this._maxHpDirty || (this._cachedMaxHp < 0)) || (this._cachedSegCount !== this.Segments.length))) {
      this.RecalculateMaxHp();
    }
    return this._cachedMaxHp;
  }
  set MaxHp(v: number) {
    if ((!(Number.isFinite(v)) || (v <= 0))) {
      return;
    }
    this.Stats.MaxHp = v;
    if ((this.Segments.length > 0)) {
      const totalUnits = (2 + this.Segments.length);
      const unitHp = Math.max(10, Math.round(Math));
      this.HeadMaxHp = (unitHp * 2);
      this.HeadHp = Math.min(this.HeadHp, this.HeadMaxHp);
    } else {
      this.HeadMaxHp = v;
      this.HeadHp = Math.min(this.HeadHp, this.HeadMaxHp);
    }
    this.RecalculateMaxHp();
    this.RecalculateHp();
  }
  get classConfig(): SnakeClassDef {
    return this.ClassConfig;
  }
  set classConfig(v: SnakeClassDef) {
    this.ClassConfig = v;
  }
  get classId(): string {
    return this.ClassId;
  }
  set classId(v: string) {
    this.ClassId = v;
  }
  get stats(): PlayerStats {
    return this.Stats;
  }
  set stats(v: PlayerStats) {
    this.Stats = v;
  }
  get hp(): number {
    return this.Hp;
  }
  set hp(v: number) {
    this.Hp = v;
  }
  get maxHp(): number {
    return this.MaxHp;
  }
  set maxHp(v: number) {
    this.MaxHp = v;
  }
  get totalXpCollected(): number {
    return this.TotalXpCollected;
  }
  set totalXpCollected(v: number) {
    this.TotalXpCollected = v;
  }
  get ouro(): number {
    return this.Xp;
  }
  set ouro(v: number) {
    this.Xp = v;
  }
  get Ouro(): number {
    return this.Xp;
  }
  set Ouro(v: number) {
    this.Xp = v;
  }
  get totalOuroCollected(): number {
    return this.TotalXpCollected;
  }
  set totalOuroCollected(v: number) {
    this.TotalXpCollected = v;
  }
  get TotalOuroCollected(): number {
    return this.TotalXpCollected;
  }
  set TotalOuroCollected(v: number) {
    this.TotalXpCollected = v;
  }
  get Length(): number {
    return (this.Segments.length + 1);
  }
  get length(): number {
    return this.Length;
  }
  get TotalLength(): number {
    return (this.Segments.length + 1);
  }
  get totalLength(): number {
    return this.TotalLength;
  }
  get shield(): number {
    return this.Shield;
  }
  set shield(v: number) {
    this.Shield = v;
  }
  get xp(): number {
    return this.Xp;
  }
  set xp(v: number) {
    this.Xp = v;
  }
  get level(): number {
    return this.Level;
  }
  set level(v: number) {
    this.Level = v;
  }
  get xpToNext(): number {
    return this.XpToNext;
  }
  set xpToNext(v: number) {
    this.XpToNext = v;
  }
  get pendingLevelUps(): number {
    return this.PendingLevelUps;
  }
  set pendingLevelUps(v: number) {
    this.PendingLevelUps = v;
  }
  get alive(): boolean {
    return this.Alive;
  }
  set alive(v: boolean) {
    this.Alive = v;
  }
  get headRadius(): number {
    return (this.HeadRadius * this.HeadRadiusMultiplier);
  }
  set headRadius(v: number) {
    this.HeadRadius = v;
  }
  get headRadiusMultiplier(): number {
    return this.HeadRadiusMultiplier;
  }
  set headRadiusMultiplier(v: number) {
    this.HeadRadiusMultiplier = v;
  }
  get titanGorgingTimer(): number {
    return this.TitanGorgingTimer;
  }
  set titanGorgingTimer(v: number) {
    this.TitanGorgingTimer = v;
  }
  get segmentRadius(): number {
    return this.SegmentRadius;
  }
  set segmentRadius(v: number) {
    this.SegmentRadius = v;
  }
  get segmentSpacing(): number {
    return this.SegmentSpacing;
  }
  set segmentSpacing(v: number) {
    this.SegmentSpacing = v;
  }
  get baseSpeed(): number {
    return this.BaseSpeed;
  }
  set baseSpeed(v: number) {
    this.BaseSpeed = v;
  }
  get turnSpeed(): number {
    return this.TurnSpeed;
  }
  set turnSpeed(v: number) {
    this.TurnSpeed = v;
  }
  get agilitySurgeTimer(): number {
    return this.AgilitySurgeTimer;
  }
  set agilitySurgeTimer(v: number) {
    this.AgilitySurgeTimer = v;
  }
  get headSelfHitCooldown(): number {
    return this.HeadSelfHitCooldown;
  }
  set headSelfHitCooldown(v: number) {
    this.HeadSelfHitCooldown = v;
  }
  get EffectiveTurnSpeed(): number {
    return (((this.AgilitySurgeTimer > 0) && (this.TurnSpeed * 1.45)) || this.TurnSpeed);
  }
  get effectiveTurnSpeed(): number {
    return this.EffectiveTurnSpeed;
  }
  get x(): number {
    return this.X;
  }
  set x(v: number) {
    this.X = v;
  }
  get y(): number {
    return this.Y;
  }
  set y(v: number) {
    this.Y = v;
  }
  get angle(): number {
    return this.Angle;
  }
  set angle(v: number) {
    this.Angle = v;
  }
  get targetAngle(): number {
    return this.TargetAngle;
  }
  set targetAngle(v: number) {
    this.TargetAngle = v;
  }
  get velocityX(): number {
    return this.VelocityX;
  }
  set velocityX(v: number) {
    this.VelocityX = v;
  }
  get velocityY(): number {
    return this.VelocityY;
  }
  set velocityY(v: number) {
    this.VelocityY = v;
  }
  get maxSegments(): number {
    return this.MaxSegments;
  }
  set maxSegments(v: number) {
    this.MaxSegments = v;
  }
  get segments(): SnakeSegment[] {
    return this.Segments;
  }
  set segments(v: SnakeSegment[]) {
    this.Segments = v;
  }
  get dashDuration(): number {
    return this.DashDuration;
  }
  set dashDuration(v: number) {
    this.DashDuration = v;
  }
  get dashTimer(): number {
    return this.DashTimer;
  }
  set dashTimer(v: number) {
    this.DashTimer = v;
  }
  get dashDurationTimer(): number {
    return this.DashTimer;
  }
  set dashDurationTimer(v: number) {
    this.DashTimer = v;
  }
  get dashCooldownTimer(): number {
    return this.DashCooldownTimer;
  }
  set dashCooldownTimer(v: number) {
    this.DashCooldownTimer = v;
  }
  get isDashing(): boolean {
    return this.IsDashing;
  }
  set isDashing(v: boolean) {
    this.IsDashing = v;
  }
  get dashSpeedMultiplier(): number {
    return this.DashSpeedMultiplier;
  }
  set dashSpeedMultiplier(v: number) {
    this.DashSpeedMultiplier = v;
  }
  get invulnerableTimer(): number {
    return this.InvulnerableTimer;
  }
  set invulnerableTimer(v: number) {
    this.InvulnerableTimer = v;
  }
  get dashHitIds(): Set<number> {
    return this.DashHitIds;
  }
  set dashHitIds(v: Set<number>) {
    this.DashHitIds = v;
  }
  get skillCooldownTimer(): number {
    return this.SkillCooldownTimer;
  }
  set skillCooldownTimer(v: number) {
    this.SkillCooldownTimer = v;
  }
  get skillActiveTimer(): number {
    return this.SkillActiveTimer;
  }
  set skillActiveTimer(v: number) {
    this.SkillActiveTimer = v;
  }
  get armorBuffTimer(): number {
    return this.ArmorBuffTimer;
  }
  set armorBuffTimer(v: number) {
    this.ArmorBuffTimer = v;
  }
  get relics(): Record<string, number> {
    return this.Relics;
  }
  set relics(v: Record<string, number>) {
    this.Relics = v;
  }
  get cardStacks(): Record<string, number> {
    return this.CardStacks;
  }
  set cardStacks(v: Record<string, number>) {
    this.CardStacks = v;
  }
  get orbitalAngle(): number {
    return this.OrbitalAngle;
  }
  set orbitalAngle(v: number) {
    this.OrbitalAngle = v;
  }
  get orbitDistance(): number {
    return this.OrbitDistance;
  }
  set orbitDistance(v: number) {
    this.OrbitDistance = v;
  }
  get spitCooldown(): number {
    return this.SpitCooldown;
  }
  set spitCooldown(v: number) {
    this.SpitCooldown = v;
  }
  get vortexTimer(): number {
    return this.VortexTimer;
  }
  set vortexTimer(v: number) {
    this.VortexTimer = v;
  }
  get regenTimer(): number {
    return this.RegenTimer;
  }
  set regenTimer(v: number) {
    this.RegenTimer = v;
  }
  get shieldRechargeTimer(): number {
    return this.ShieldRechargeTimer;
  }
  set shieldRechargeTimer(v: number) {
    this.ShieldRechargeTimer = v;
  }
  get shieldBrokenTimer(): number {
    return this.ShieldBrokenTimer;
  }
  set shieldBrokenTimer(v: number) {
    this.ShieldBrokenTimer = v;
  }
  get trailTimer(): number {
    return this.TrailTimer;
  }
  set trailTimer(v: number) {
    this.TrailTimer = v;
  }
  get magmaTimer(): number {
    return this.MagmaTimer;
  }
  set magmaTimer(v: number) {
    this.MagmaTimer = v;
  }
  get gluttonCounter(): number {
    return this.GluttonCounter;
  }
  set gluttonCounter(v: number) {
    this.GluttonCounter = v;
  }
  get devourerCounter(): number {
    return this.DevourerCounter;
  }
  set devourerCounter(v: number) {
    this.DevourerCounter = v;
  }
  get devourerStacks(): number {
    return this.DevourerStacks;
  }
  set devourerStacks(v: number) {
    this.DevourerStacks = v;
  }
  get damageBonus(): number {
    return this.DamageBonus;
  }
  set damageBonus(v: number) {
    this.DamageBonus = v;
  }
  get eyeBlinkTimer(): number {
    return this.EyeBlinkTimer;
  }
  set eyeBlinkTimer(v: number) {
    this.EyeBlinkTimer = v;
  }
  get eyeBlinking(): boolean {
    return this.EyeBlinking;
  }
  set eyeBlinking(v: boolean) {
    this.EyeBlinking = v;
  }
  get mouthOpen(): number {
    return this.MouthOpen;
  }
  set mouthOpen(v: number) {
    this.MouthOpen = v;
  }
  get bodyPulse(): number {
    return this.BodyPulse;
  }
  set bodyPulse(v: number) {
    this.BodyPulse = v;
  }
  get hurtFlash(): number {
    return this.HurtFlash;
  }
  set hurtFlash(v: number) {
    this.HurtFlash = v;
  }
  get afterimages(): Afterimage[] {
    return this.Afterimages;
  }
  set afterimages(v: Afterimage[]) {
    this.Afterimages = v;
  }
  get emberTimer(): number {
    return this.EmberTimer;
  }
  set emberTimer(v: number) {
    this.EmberTimer = v;
  }
  get foodsEaten(): number {
    return this.FoodsEaten;
  }
  set foodsEaten(v: number) {
    this.FoodsEaten = v;
  }
  get pendingRevive(): boolean {
    return this.PendingRevive;
  }
  set pendingRevive(v: boolean) {
    this.PendingRevive = v;
  }
  get mutationPoints(): number {
    return this.MutationPoints;
  }
  set mutationPoints(v: number) {
    this.MutationPoints = v;
  }
  get peakLength(): number {
    return this.PeakLength;
  }
  set peakLength(v: number) {
    this.PeakLength = v;
  }
  get headAugment(): string | null {
    return this.HeadAugment;
  }
  set headAugment(v: string | null) {
    this.HeadAugment = v;
  }
  get headAugmentLevel(): number {
    return this.HeadAugmentLevel;
  }
  set headAugmentLevel(v: number) {
    this.HeadAugmentLevel = v;
  }
  get headLaserTimer(): number {
    return this.HeadLaserTimer;
  }
  set headLaserTimer(v: number) {
    this.HeadLaserTimer = v;
  }
  get headCrownTimer(): number {
    return this.HeadCrownTimer;
  }
  set headCrownTimer(v: number) {
    this.HeadCrownTimer = v;
  }
  get headModules(): Record<string, number> {
    return this.HeadModules;
  }
  set headModules(v: Record<string, number>) {
    this.HeadModules = v;
  }
  get headModuleTimers(): Record<string, number> {
    return this.HeadModuleTimers;
  }
  set headModuleTimers(v: Record<string, number>) {
    this.HeadModuleTimers = v;
  }
  get headPurchaseCount(): number {
    return this.HeadPurchaseCount;
  }
  set headPurchaseCount(v: number) {
    this.HeadPurchaseCount = v;
  }
  get equippedHelmet(): HelmetLike | null {
    return this.EquippedHelmet;
  }
  set equippedHelmet(v: HelmetLike | null) {
    this.EquippedHelmet = (v ?? null);
  }
  get helmet(): HelmetLike | null {
    return this.EquippedHelmet;
  }
  set helmet(v: HelmetLike | null) {
    this.EquippedHelmet = (v ?? null);
  }
  EquipHelmet(v: HelmetLike | null): void {
    this.EquippedHelmet = (v ?? null);
  }
  equipHelmet(v: HelmetLike | null): void {
    this.EquipHelmet(v);
  }
  triggerTitanGorging(duration: number = 3): void {
    this.HeadRadiusMultiplier = 2;
    this.TitanGorgingTimer = duration;
  }
  TriggerTitanGorging(duration: number = 3): void {
    this.triggerTitanGorging(duration);
  }
  GetHeadModuleLevel(key: string): number {
    return (this.HeadModules[key] || 0);
  }
  getHeadModuleLevel(key: string): number {
    return this.GetHeadModuleLevel(key);
  }
  SetHeadModuleLevel(key: string, level: number): void {
    this.HeadModules[key] = Math.max(0, level);
  }
  setHeadModuleLevel(key: string, level: number): void {
    this.SetHeadModuleLevel(key, level);
  }
  GetHeadAugmentLevel(key: string): number {
    return ((((this.HeadAugment === key) && this.HeadAugmentLevel) || 0) || 0);
  }
  getHeadAugmentLevel(key: string): number {
    return this.GetHeadAugmentLevel(key);
  }
  GetHeadModuleCost(key: string, targetLvl: number): number {
    const lvl = (((targetLvl !== undefined) && targetLvl) || (this.GetHeadModuleLevel(key) + 1));
    return ((30 * lvl) + (this.HeadPurchaseCount * 15));
  }
  getHeadModuleCost(key: string, targetLvl: number): number {
    return this.GetHeadModuleCost(key, targetLvl);
  }
  GetHeadAugmentCost(key: string, targetLvl: number): number {
    const cur = (((this.HeadAugment === key) && this.HeadAugmentLevel) || 0);
    const lvl = (((targetLvl !== undefined) && targetLvl) || (cur + 1));
    return ((40 * lvl) + (this.HeadPurchaseCount * 20));
  }
  getHeadAugmentCost(key: string, targetLvl: number): number {
    return this.GetHeadAugmentCost(key, targetLvl);
  }
  InstallHeadModule(key: string): number {
    const cur = this.GetHeadModuleLevel(key);
    if ((cur >= 3)) {
      return cur;
    }
    const next = (cur + 1);
    this.HeadModules[key] = next;
    this.HeadPurchaseCount = (this.HeadPurchaseCount + 1);
    if ((key === "shield")) {
      const shieldBonus = 25;
      this.Stats.MaxShield = (this.Stats.MaxShield + shieldBonus);
      this.Shield = Math.min(this.Stats.MaxShield, (this.Shield + shieldBonus));
    } else if ((key === "spikes")) {
      this.Stats.Thorns = (this.Stats.Thorns + 0.2);
    }
    return next;
  }
  installHeadModule(key: string): number {
    return this.InstallHeadModule(key);
  }
  UninstallHeadModule(key: string): void {
    null;
  }
  uninstallHeadModule(key: string): void {
    this.UninstallHeadModule(key);
  }
  InstallHeadAugment(key: string): number {
    const cur = (((this.HeadAugment === key) && this.HeadAugmentLevel) || 0);
    if ((cur >= 3)) {
      return cur;
    }
    const next = (cur + 1);
    this.SetHeadAugment(key, next);
    this.HeadPurchaseCount = (this.HeadPurchaseCount + 1);
    return next;
  }
  installHeadAugment(key: string): number {
    return this.InstallHeadAugment(key);
  }
  get Meta(): MetaProgression | null {
    return this.meta;
  }
  set Meta(v: MetaProgression | null) {
    this.meta = v;
  }
  get Services(): IServiceContainer | null {
    return this.services;
  }
  set Services(v: IServiceContainer | null) {
    this.services = v;
  }
  constructor(classId: string | null = "emerald", arenaW: unknown = 0, arenaH: unknown = 0, initialSegments: unknown = 2, metaOrOptions: MetaProgression | unknown) {
    if ((metaOrOptions === MetaProgression)) {
      this.meta = metaOrOptions;
    } else if (((metaOrOptions !== null) && (typeof (metaOrOptions) === "object"))) {
      this.meta = metaOrOptions.meta;
      this.services = metaOrOptions.services;
    }
    const cfg = (((classId !== null) && GameData.Classes.Get(classId)) || (null ?? GameData.Classes.Get("emerald")));
    this.ClassConfig = cfg;
    this.ClassId = this.ClassConfig.Id;
    if ((arenaW > 0)) {
      this.X = (arenaW * 0.5);
    } else {
      this.X = 480;
    }
    if ((arenaH > 0)) {
      this.Y = (arenaH * 0.5);
    } else {
      this.Y = 320;
    }
    this.Angle = 0;
    this.TargetAngle = 0;
    this.VelocityX = this.BaseSpeed;
    this.VelocityY = 0;
    const meta = (((((this.meta ?? this.services?.meta) ?? (typeof (Services) !== "undefined")) && Services.Meta) && Services.Meta) || MetaProgression.Instance);
    const b = this.ClassConfig.BaseStats;
    this.Stats = PlayerStats();
    this.Stats.MaxHp = (((b.MaxHp + meta) && (meta.Level("vitality") * 10)) || 0);
    this.Stats.Speed = ((((b.Speed * 1) + meta) && (meta.Level("agility") * 0.04)) || 0);
    this.Stats.DashCooldown = Math.max(0.8, (((b.DashCooldown - meta) && (meta.Level("swiftness") * 0.15)) || 0));
    this.Stats.BitePower = ((((b.BitePower * 1) + meta) && (meta.Level("ferocity") * 0.06)) || 0);
    this.Stats.MagnetRadius = ((((b.MagnetRadius * 1) + meta) && (meta.Level("magnet") * 0.15)) || 0);
    this.Stats.CritChance = b.CritChance;
    this.Stats.CritMult = b.CritMult;
    this.Stats.Armor = Math.min(0.8, (((b.Armor + meta) && (meta.Level("resilience") * 0.03)) || 0));
    this.Stats.MaxShield = 0;
    this.Stats.XpGain = 1;
    this.Stats.ShardGain = 1;
    this.Stats.ComboWindow = 1;
    this.Stats.Thorns = 0;
    this.Stats.SkillCooldown = this.ClassConfig.Skill.Cooldown;
    if ((this.ClassId === "emerald")) {
      this.Stats.MagnetRadius = (this.Stats.MagnetRadius * 1.3);
    }
    const segCount = ((((initialSegments !== undefined) && (initialSegments >= 0)) && initialSegments) || 2);
    const baseSegHp = this.BaseSegmentHp;
    this.HeadMaxHp = (2 * baseSegHp);
    this.HeadHp = this.HeadMaxHp;
    this.PeakLength = this.Segments.length;
    this.RecalculateMaxHp();
    this.RecalculateHp();
    this.Stats.MaxHp = this.MaxHp;
    const equippedHelmet = ((((meta !== null) && meta.GetEquippedHelmet) && meta.GetEquippedHelmet()) || null);
    this.EquippedHelmet = equippedHelmet;
    if ((((this.EquippedHelmet !== null) && this.EquippedHelmet.Stats) || this.EquippedHelmet.stats)) {
      const hs = (this.EquippedHelmet.Stats || this.EquippedHelmet.stats);
      const hHp = ((hs.MaxHp || hs.maxHp) || 0);
      if ((hHp > 0)) {
        this.Stats.MaxHp = (this.Stats.MaxHp + hHp);
        const extraPerPart = Math.round(Math);
        this.HeadMaxHp = (this.HeadMaxHp + (2 * extraPerPart));
        this.HeadHp = this.HeadMaxHp;
        for (const seg of this.Segments) {
          seg.MaxHp = (seg.MaxHp + extraPerPart);
          seg.Hp = seg.MaxHp;
        }
        this.RecalculateMaxHp();
        this.RecalculateHp();
      }
      if ((hs.Armor || hs.armor)) {
        this.Stats.Armor = Math.min(0.85, (((this.Stats.Armor + hs.Armor) || hs.armor) || 0));
      }
      if ((hs.Speed || hs.speed)) {
        this.Stats.Speed = (((this.Stats.Speed + hs.Speed) || hs.speed) || 0);
      }
      if ((hs.BitePower || hs.bitePower)) {
        this.Stats.BitePower = (((this.Stats.BitePower + hs.BitePower) || hs.bitePower) || 0);
      }
      if ((hs.MagnetRadius || hs.magnetRadius)) {
        this.Stats.MagnetRadius = (((this.Stats.MagnetRadius + hs.MagnetRadius) || hs.magnetRadius) || 0);
      }
      if ((hs.CritChance || hs.critChance)) {
        this.Stats.CritChance = Math.min(1, (((this.Stats.CritChance + hs.CritChance) || hs.critChance) || 0));
      }
      if ((hs.CritMult || hs.critMult)) {
        this.Stats.CritMult = (((this.Stats.CritMult + hs.CritMult) || hs.critMult) || 0);
      }
      if ((hs.DashCooldown || hs.dashCooldown)) {
        this.Stats.DashCooldown = Math.max(0.6, (((this.Stats.DashCooldown - hs.DashCooldown) || hs.dashCooldown) || 0));
      }
      if ((hs.Thorns || hs.thorns)) {
        this.Stats.Thorns = (((this.Stats.Thorns + hs.Thorns) || hs.thorns) || 0);
      }
      if ((hs.XpMultiplier || hs.xpMultiplier)) {
        this.Stats.XpGain = (((this.Stats.XpGain + hs.XpMultiplier) || hs.xpMultiplier) || 0);
      }
      if ((hs.ShardMultiplier || hs.shardMultiplier)) {
        this.Stats.ShardGain = (((this.Stats.ShardGain + hs.ShardMultiplier) || hs.shardMultiplier) || 0);
      }
      if ((hs.HpRegen || hs.hpRegen)) {
        this.Stats.HpRegen = (((this.Stats.HpRegen + hs.HpRegen) || hs.hpRegen) || 0);
      }
      if ((hs.Shield || hs.shield)) {
        const sVal = ((hs.Shield || hs.shield) || 0);
        this.Shield = (this.Shield || (0 + sVal));
        this.Stats.MaxShield = (this.Stats.MaxShield || (0 + sVal));
      }
    }
    this.Shield = (this.Shield || 0);
    this.Xp = 0;
    this.Level = 1;
    this.XpToNext = 155;
    this._xpForNextLevel = 155;
    this.PendingLevelUps = 0;
    this.Alive = true;
    this.Relics = GameData.newRelics();
    this.EyeBlinkTimer = Rng.Shared.range(2, 5);
  }
  get BitePower(): number {
    let p = (this.Stats.BitePower * this.DamageBonus);
    const adrenal = (this.Relics["adrenal"] ?? 0);
    if (((adrenal > 0) && (this.Hp < (this.Stats.MaxHp * 0.4)))) {
      p = ((p * 1) + (0.2 * adrenal));
    }
    return p;
  }
  get bitePower(): number {
    return this.BitePower;
  }
  get MoveSpeed(): number {
    let s = (this.BaseSpeed * this.Stats.Speed);
    const adrenal = (this.Relics["adrenal"] ?? 0);
    if (((adrenal > 0) && (this.Hp < (this.Stats.MaxHp * 0.4)))) {
      s = ((s * 1) + (0.35 * adrenal));
    }
    if ((this.IsDashing !== null)) {
      s = (s * this.DashSpeedMultiplier);
    }
    return s;
  }
  get moveSpeed(): number {
    return this.MoveSpeed;
  }
  get EffectiveArmor(): number {
    let a = (this.Stats.Armor + this.SegmentArmorBonus);
    if ((this.ArmorBuffTimer > 0)) {
      a = (a + 0.25);
    }
    if (this.HeadModules["spikes"]) {
      a = (a + (0.04 * this.HeadModules["spikes"]));
    }
    return MathX.clamp(a, 0, 0.85);
  }
  get effectiveArmor(): number {
    return this.EffectiveArmor;
  }
  get SkillReady(): boolean {
    return (this.SkillCooldownTimer <= 0);
  }
  get skillReady(): boolean {
    return this.SkillReady;
  }
  get DashReady(): boolean {
    return ((this.DashCooldownTimer <= 0) && !(this.IsDashing));
  }
  get dashReady(): boolean {
    return this.DashReady;
  }
  BiteHeads(): BiteHead[] {
    this._biteHeads.length = 0;
    const currentR = this.headRadius;
    this._head0.X = this.X;
    this._head0.Y = this.Y;
    this._head0.R = currentR;
    this._head0.x = this.X;
    this._head0.y = this.Y;
    this._head0.r = currentR;
    this._head0.Mult = 1;
    this._head0.mult = 1;
    this._biteHeads.push(this._head0);
    if ((this.ClassId === "hydra")) {
      const nx = Math.cos((this.Angle + (Math.PI / 2)));
      const ny = Math.sin((this.Angle + (Math.PI / 2)));
      const back = 6;
      const bx = (this.X - (Math.cos(this.Angle) * back));
      const by = (this.Y - (Math.sin(this.Angle) * back));
      const h1x = (bx + (nx * 15));
      const h1y = (by + (ny * 15));
      this._head1.X = h1x;
      this._head1.Y = h1y;
      this._head1.x = h1x;
      this._head1.y = h1y;
      this._biteHeads.push(this._head1);
      const h2x = (bx - (nx * 15));
      const h2y = (by - (ny * 15));
      this._head2.X = h2x;
      this._head2.Y = h2y;
      this._head2.x = h2x;
      this._head2.y = h2y;
      this._biteHeads.push(this._head2);
    }
    return this._biteHeads;
  }
  biteHeads(): BiteHead[] {
    return this.BiteHeads();
  }
  OrbitalPositions(): Orbital[] {
    const n = (this.Relics["orbitalFangs"] ?? 0);
    while ((this._orbitalPositions.length < n)) {
      this._orbitalPositions.push({ X: 0, Y: 0, A: 0, x: 0, y: 0, a: 0 });
    }
    this._orbitalPositions.length = n;
    return this._orbitalPositions;
  }
  orbitalPositions(): Orbital[] {
    return this.OrbitalPositions();
  }
  Update(dt: number, steer: ISteerInput, arenaW: number, arenaH: number, world: World): void {
    if ((!(Number.isFinite(dt)) || (dt <= 0))) {
      return;
    }
    if (!(Number.isFinite(this.X))) {
      if ((arenaW > 0)) {
        this.X = (arenaW * 0.5);
      } else {
        this.X = 480;
      }
    }
    if (!(Number.isFinite(this.Y))) {
      if ((arenaH > 0)) {
        this.Y = (arenaH * 0.5);
      } else {
        this.Y = 320;
      }
    }
    if (!(Number.isFinite(this.Angle))) {
      this.Angle = 0;
    }
    if (!(Number.isFinite(this.TargetAngle))) {
      this.TargetAngle = this.Angle;
    }
    this.DashCooldownTimer = MathX.decayTimer(this.DashCooldownTimer, dt);
    this.SkillCooldownTimer = MathX.decayTimer(this.SkillCooldownTimer, dt);
    this.InvulnerableTimer = MathX.decayTimer(this.InvulnerableTimer, dt);
    this.ArmorBuffTimer = MathX.decayTimer(this.ArmorBuffTimer, dt);
    this.AgilitySurgeTimer = MathX.decayTimer(this.AgilitySurgeTimer, dt);
    this.HeadSelfHitCooldown = MathX.decayTimer(this.HeadSelfHitCooldown, dt);
    this.HurtFlash = MathX.decayTimer(this.HurtFlash, (dt * 3));
    if ((this.TitanGorgingTimer > 0)) {
      this.TitanGorgingTimer = MathX.decayTimer(this.TitanGorgingTimer, dt);
      if ((this.TitanGorgingTimer <= 0)) {
        this.HeadRadiusMultiplier = 1;
      }
    }
    if ((this.IsDashing !== null)) {
      this.DashTimer = (this.DashTimer - dt);
      if ((this.DashTimer <= 0)) {
        this.IsDashing = false;
        this.DashHitIds.clear();
      }
    }
    const steerActive = (((steer !== null) && ((steer.Active ?? steer.active) ?? false)) || false);
    const steerX = (((steer !== null) && ((steer.X ?? steer.x) ?? 0)) || 0);
    const steerY = (((steer !== null) && ((steer.Y ?? steer.y) ?? 0)) || 0);
    if ((steerActive !== null)) {
      const len = Math.sqrt(((steerX * steerX) + (steerY * steerY)));
      if (((len > 0.001) && Number.isFinite(len))) {
        this.TargetAngle = Math.atan2(steerY, steerX);
      }
    }
    const turn = (((this.EffectiveTurnSpeed * this.IsDashing) && 0.65) || 1);
    const diff = MathX.angleDelta(this.Angle, this.TargetAngle);
    this.Angle = (this.Angle + (diff * MathX.clamp((turn * dt), 0, 1)));
    if ((this.Angle > Math.PI)) {
      this.Angle = (this.Angle - MathX.Tau);
    }
    if ((this.Angle < -(Math.PI))) {
      this.Angle = (this.Angle + MathX.Tau);
    }
    const speed = this.MoveSpeed;
    this.VelocityX = (Math.cos(this.Angle) * speed);
    this.VelocityY = (Math.sin(this.Angle) * speed);
    this.X = (this.X + (this.VelocityX * dt));
    this.Y = (this.Y + (this.VelocityY * dt));
    const m = this.HeadRadius;
    const hitLeft = (this.X < m);
    const hitRight = (this.X > (arenaW - m));
    const hitTop = (this.Y < m);
    const hitBottom = (this.Y > (arenaH - m));
    if (((hitLeft || ((hitRight !== null) && hitTop)) || hitBottom)) {
      const nx = (((hitLeft !== null) && 1) || -(1));
      const ny = (((hitTop !== null) && 1) || -(1));
      if ((hitLeft !== null)) {
        this.X = (m + 1);
      } else {
        this.X = ((arenaW - m) - 1);
      }
      if ((hitTop !== null)) {
        this.Y = (m + 1);
      } else {
        this.Y = ((arenaH - m) - 1);
      }
      this.Deflect((nx * Math.SQRT1_2), (ny * Math.SQRT1_2));
    } else {
      if ((hitLeft !== null)) {
        this.X = m;
        this.Deflect(1, 0);
      } else if ((hitRight !== null)) {
        this.X = (arenaW - m);
        this.Deflect(-(1), 0);
      }
      if ((hitTop !== null)) {
        this.Y = m;
        this.Deflect(0, 1);
      } else if ((hitBottom !== null)) {
        this.Y = (arenaH - m);
        this.Deflect(0, -(1));
      }
    }
    this.UpdateSegments(dt);
    if ((world !== null)) {
      this.UpdatePassives(dt, world);
      this.UpdateCosmetics(dt, world);
    }
  }
  update(dt: number, steer: ISteerInput, arenaW: number, arenaH: number, world: World): void {
    this.Update(dt, steer, arenaW, arenaH, world);
  }
  Deflect(nx: number, ny: number): void {
    if ((!(Number.isFinite(nx)) || !(Number.isFinite(ny)))) {
      return;
    }
    const nLen = Math.hypot(nx, ny);
    if ((!(Number.isFinite(nLen)) || (nLen < 0.0001))) {
      return;
    }
    nx = (nx / nLen);
    ny = (ny / nLen);
    const dot = ((Math.cos(this.Angle) * nx) + (Math.sin(this.Angle) * ny));
    if ((dot >= 0)) {
      return;
    }
    const tx = (Math.cos(this.Angle) - (dot * nx));
    const ty = (Math.sin(this.Angle) - (dot * ny));
    const len = Math.sqrt(((tx * tx) + (ty * ty)));
    if ((len > 0.01)) {
      this.Angle = Math.atan2((ty / len), (tx / len));
      const tdot = ((Math.cos(this.TargetAngle) * nx) + (Math.sin(this.TargetAngle) * ny));
      if ((tdot < 0)) {
        this.TargetAngle = this.Angle;
      }
    } else {
      const tangentX = -(ny);
      const tangentY = nx;
      this.Angle = Math.atan2(tangentY, tangentX);
      const tdot = ((Math.cos(this.TargetAngle) * nx) + (Math.sin(this.TargetAngle) * ny));
      if ((tdot < 0)) {
        this.TargetAngle = this.Angle;
      }
    }
  }
  deflect(nx: number, ny: number): void {
    this.Deflect(nx, ny);
  }
  UpdateSegments(_dt: number): void {
    let px = ((Number.isFinite(this.X) && this.X) || 480);
    let py = ((Number.isFinite(this.Y) && this.Y) || 320);
    const spacing = this.SegmentSpacing;
    const spacingSq = (spacing * spacing);
    const n = this.Segments.length;
    const segRadius = this.SegmentRadius;
    const invN = (((n > 0) && (0.4 / n)) || 0);
  }
  updateSegments(dt: number): void {
    this.UpdateSegments(dt);
  }
  stepIK(dt: number): void {
    this.UpdateSegments(dt);
  }
  stepIk(dt: number): void {
    this.UpdateSegments(dt);
  }
  UpdatePassives(dt: number, world: World): void {
    if ((this.Stats.HpRegen > 0)) {
      this.RegenTimer = (this.RegenTimer + dt);
      if ((this.RegenTimer >= 3)) {
        this.RegenTimer = (this.RegenTimer - 3);
        const healAmt = Math.max(1, Math.round(Math));
        if ((this.Hp < this.Stats.MaxHp)) {
          this.Heal(healAmt);
          Services.Fx.AddText(this.X, (this.Y - 18), ("+" + String(healAmt)), "#10b981", 12, false);
        }
      }
    } else if ((this.ClassId === "emerald")) {
      this.RegenTimer = (this.RegenTimer + dt);
      if ((this.RegenTimer >= 6)) {
        this.RegenTimer = (this.RegenTimer - 6);
        if ((this.Hp < this.Stats.MaxHp)) {
          this.Heal(1);
          Services.Fx.AddText(this.X, (this.Y - 18), "+1", "#10b981", 12, false);
        }
      }
    }
    const magmaStacks = (((this.ClassId === "solar") && 1) || ((0 + this.Relics["moltenWake"]) ?? 0));
    const hazards = ((((world !== null) && world.Hazards) || world.hazards) || null);
    if (((magmaStacks > 0) && hazards)) {
      this.MagmaTimer = (this.MagmaTimer + dt);
      const interval = (0.34 / magmaStacks);
      if ((this.MagmaTimer >= interval)) {
        this.MagmaTimer = 0;
        if ((hazards.length < 90)) {
          const tail = (((this.Segments.length > 0) && this.Segments[Math.min(3, (this.Segments.length - 1))]) || null);
          const tx = (((tail !== null) && tail.X) || this.X);
          const ty = (((tail !== null) && tail.Y) || this.Y);
          hazards.push(Hazard(tx, ty, "magma", { Radius: 22, Life: 3.2, Dps: ((26 * magmaStacks) * this.DamageBonus), Owner: "player" }));
        }
      }
    }
    if ((this.Stats.MaxShield > 0)) {
      if ((this.ShieldBrokenTimer > 0)) {
        this.ShieldBrokenTimer = Math.max(0, (this.ShieldBrokenTimer - dt));
      }
      if (((this.Shield < this.Stats.MaxShield) && (this.ShieldBrokenTimer <= 0))) {
        this.ShieldRechargeTimer = (this.ShieldRechargeTimer + dt);
        if ((this.ShieldRechargeTimer >= 8)) {
          this.ShieldRechargeTimer = 0;
          this.Shield = this.Stats.MaxShield;
          Services.Fx.RingShockwave(this.X, this.Y, "#3a86ff", 18, 0.035);
          Services.Sound.PlayShield();
        }
      }
    }
    if ((this.Relics["orbitalFangs"] ?? (0 > 0))) {
      this.OrbitalAngle = (this.OrbitalAngle + ((dt * 3.4) % MathX.Tau));
    }
    if ((this.Relics["singularity"] ?? (0 > 0))) {
      this.VortexTimer = (this.VortexTimer + dt);
    }
    if ((this.SpitCooldown > 0)) {
      this.SpitCooldown = (this.SpitCooldown - dt);
    }
  }
  updatePassives(dt: number, world: World): void {
    this.UpdatePassives(dt, world);
  }
  UpdateCosmetics(dt: number, world: World): void {
    this.BodyPulse = (this.BodyPulse + ((dt * 2.4) % MathX.Tau));
    this.EyeBlinkTimer = (this.EyeBlinkTimer - dt);
    if ((this.EyeBlinkTimer <= 0)) {
      this.EyeBlinking = !(this.EyeBlinking);
      if ((this.EyeBlinking !== null)) {
        this.EyeBlinkTimer = 0.12;
      } else {
        this.EyeBlinkTimer = Rng.Shared.range(2, 5);
      }
    }
    const nearest: FoodItem | null = (((((world !== null) && world.NearestFood) || world.nearestFood) || null) || null);
    if ((nearest !== null)) {
      const nx = ((nearest.X ?? nearest.x) ?? 0);
      const ny = ((nearest.Y ?? nearest.y) ?? 0);
      const d = MathX.safeLen((nx - this.X), (ny - this.Y));
      if ((d < 80)) {
        this.MouthOpen = MathX.clamp((80 - (d / 55)), 0, 1);
      } else {
        this.MouthOpen = 0;
      }
    } else {
      this.MouthOpen = (this.MouthOpen * Math.max(0, (1 - (dt * 6))));
    }
    this.EmberTimer = (this.EmberTimer + dt);
    const emberInterval = (((this.IsDashing !== null) && 0.016) || 0.07);
    while ((this.EmberTimer >= emberInterval)) {
      this.EmberTimer = (this.EmberTimer - emberInterval);
      Services.Fx.TrailEmbers((this.X + Rng.Shared.range(-(5), 5)), (this.Y + Rng.Shared.range(-(5), 5)), this.ClassConfig.Color, (((this.IsDashing !== null) && 4) || 2));
    }
    if ((((this.IsDashing !== null) && (this.ClassId === "stalker")) && (this.Afterimages.length < 14))) {
      this.Afterimages.push(new Afterimage(this.X, this.Y, this.Angle, 0.35, 0.35));
    }
  }
  updateCosmetics(dt: number, world: World): void {
    this.UpdateCosmetics(dt, world);
  }
  TryDash(): boolean {
    if (!(this.DashReady)) {
      return false;
    }
    this.IsDashing = true;
    this.DashTimer = this.DashDuration;
    this.DashCooldownTimer = this.Stats.DashCooldown;
    this.DashHitIds.clear();
    const invulnWindow = (((this.ClassId === "stalker") && Math.min(0.4, Math.max(0.05, ((this.Stats.DashCooldown * 0.5) - this.DashDuration)))) || 0.12);
    this.InvulnerableTimer = Math.max(this.InvulnerableTimer, (this.DashDuration + invulnWindow));
    Services.Sound.PlayDash();
    Services.Fx.RingShockwave(this.X, this.Y, this.ClassConfig.Color, 14, 0.05);
    return true;
  }
  tryDash(): boolean {
    return this.TryDash();
  }
  TriggerDash(): boolean {
    return this.TryDash();
  }
  triggerDash(): boolean {
    return this.TryDash();
  }
  TriggerSkill(world: World, combat: CombatSystem): boolean {
    if (!(this.SkillReady)) {
      return false;
    }
    if ((((combat !== null) && world) && (typeof (combat.ActivateSkill) === "function"))) {
      return combat.ActivateSkill(world);
    }
    if (((world !== null) && world.Game?.Combat)) {
      return world.Game.Combat.ActivateSkill(world);
    }
    const stats = this.Stats;
    const scooldown = (stats.SkillCooldown ?? 20);
    this.SkillCooldownTimer = scooldown;
    Services.Sound.PlaySkill();
    const pcol = (this.ClassConfig?.Color || "#00f0b5");
    Services.Fx.RingShockwave(this.X, this.Y, pcol, 24, 0.05);
    return true;
  }
  triggerSkill(world: World, combat: CombatSystem): boolean {
    return this.TriggerSkill(world, combat);
  }
  get BaseSegmentHp(): number {
    const meta = (((((this.meta ?? this.services?.meta) ?? (typeof (Services) !== "undefined")) && Services.Meta) && Services.Meta) || MetaProgression.Instance);
    const base = (((this.ClassConfig !== null) && this.ClassConfig.BaseStats.MaxHp) || 100);
    return Math.max(15, (((Math.round(Math) + meta) && (meta.Level("vitality") * 5)) || 0));
  }
  get baseSegmentHp(): number {
    return this.BaseSegmentHp;
  }
  AddGrowth(count: number): void {
    let lx = this.X;
    let ly = this.Y;
    let la = this.Angle;
    if ((this.Segments.length > 0)) {
      const last = this.Segments[(this.Segments.length - 1)];
      lx = last.X;
      ly = last.Y;
      la = last.Angle;
    }
    const segHp = this.BaseSegmentHp;
    this.PeakLength = Math.max(this.PeakLength, this.Segments.length);
    this.RecalculateMaxHp();
    this.RecalculateHp();
    this.Stats.MaxHp = this.MaxHp;
  }
  addGrowth(count: number): void {
    this.AddGrowth(count);
  }
  SetHeadAugment(augmentId: string, level: number): void {
    this.HeadAugment = augmentId;
    this.HeadAugmentLevel = Math.max(0, level);
    if (((augmentId === "fangs") && (level > 0))) {
      this.Stats.BitePower = ((this.ClassConfig.BaseStats.BitePower * 1) + (0.15 * level));
    }
  }
  setHeadAugment(augmentId: string, level: number): void {
    this.SetHeadAugment(augmentId, level);
  }
  SetHeadAugmentLevel(augmentId: string, level: number): void {
    this.SetHeadAugment(augmentId, level);
  }
  setHeadAugmentLevel(augmentId: string, level: number): void {
    this.SetHeadAugment(augmentId, level);
  }
  get SegmentArmorBonus(): number {
    return Math.min(0.5, (this.Segments.length * 0.03));
  }
  get segmentArmorBonus(): number {
    return this.SegmentArmorBonus;
  }
  AddBodySegment(): void {
    if ((this.Segments.length >= this.MaxSegments)) {
      return;
    }
    this.AddGrowth(1);
  }
  addBodySegment(): void {
    this.AddBodySegment();
  }
  DamageHead(amount: number, applyArmor: unknown = true, setInvulnerable: unknown = true, silent: unknown = false): number {
    if ((((!(this.Alive) || ((setInvulnerable !== null) && (this.InvulnerableTimer > 0))) || !((amount > 0))) || !(Number.isFinite(amount)))) {
      return 0;
    }
    const dealt = (((applyArmor !== null) && Math.max(1, MathX.roundJs(((amount * 1) - this.EffectiveArmor)))) || amount);
    let toHp = dealt;
    if ((this.Shield > 0)) {
      const toShield = Math.min(this.Shield, dealt);
      this.Shield = (this.Shield - toShield);
      toHp = (dealt - toShield);
      if ((this.Shield <= 0)) {
        this.ShieldBrokenTimer = 2.5;
      }
      this.ShieldRechargeTimer = 0;
    }
    while (((toHp > 0) && (this.Segments.length > 0))) {
      const lastIdx = (this.Segments.length - 1);
      const lastSeg = this.Segments[lastIdx];
      if ((lastSeg.Hp > toHp)) {
        lastSeg.Hp = (lastSeg.Hp - toHp);
        lastSeg.HitFlash = 1;
        if (!(silent)) {
          Services.Fx.Burst(lastSeg.X, lastSeg.Y, "#ff3366", 6, 2, 2);
        }
        toHp = 0;
      } else {
        toHp = (toHp - lastSeg.Hp);
        if (!(silent)) {
          Services.Fx.Burst(lastSeg.X, lastSeg.Y, "#ff5400", 10, 4, 3);
          Services.Fx.AddText(lastSeg.X, (lastSeg.Y - 20), "⚡ LIFE SOURCED", "#ffb703", 14, true);
        }
        this.Segments.pop();
        this.RecalculateHp();
        this.RecalculateMaxHp();
        this.Stats.MaxHp = this.MaxHp;
      }
    }
    if ((toHp > 0)) {
      this.HeadHp = Math.max(0, (this.HeadHp - toHp));
    }
    if ((setInvulnerable !== null)) {
      this.InvulnerableTimer = 0.6;
    }
    this.HurtFlash = 1;
    if (!(silent)) {
      Services.Fx.Burst(this.X, this.Y, "#ff3366", 8, 3, 2);
      Services.Fx.AddText(this.X, (this.Y - 18), ("-" + String(Math.floor(Math))), "#ff3366", 16, true);
      Services.Sound.PlayHit();
    }
    if (((this.Segments.length === 0) && (this.HeadHp <= 0))) {
      this.HeadHp = 0;
      const charges = (this.Relics["phoenixCharges"] ?? 0);
      if ((charges > 0)) {
        this.Relics["phoenixCharges"] = (charges - 1);
        this.HeadHp = this.HeadMaxHp;
        if ((this.Segments.length === 0)) {
          this.AddGrowth(2);
        }
        this.InvulnerableTimer = 3;
        this.PendingRevive = true;
        Services.Fx.AddText(this.X, (this.Y - 46), "🔥 PHOENIX REBIRTH 🔥", "#ffb703", 22, true);
        Services.Sound.PlayRevive();
        this.RecalculateHp();
        return dealt;
      }
      this.Alive = false;
    }
    this.RecalculateHp();
    return dealt;
  }
  damageHead(amount: number, applyArmor: unknown = true, setInvulnerable: unknown = true, silent: unknown = false): number {
    return this.DamageHead(amount, applyArmor, setInvulnerable, silent);
  }
  DamageSegment(segmentIndex: number, amount: number, applyArmor: unknown = true, setInvulnerable: unknown = true, silent: unknown = false): number {
    if ((((!(this.Alive) || ((setInvulnerable !== null) && (this.InvulnerableTimer > 0))) || !((amount > 0))) || !(Number.isFinite(amount)))) {
      return 0;
    }
    if (((((typeof (segmentIndex) !== "number") || !(Number.isInteger(segmentIndex))) || (segmentIndex < 0)) || (segmentIndex >= this.Segments.length))) {
      return 0;
    }
    const seg = this.Segments[segmentIndex];
    const dealt = (((applyArmor !== null) && Math.max(1, MathX.roundJs(((amount * 1) - this.EffectiveArmor)))) || amount);
    let toHp = dealt;
    if (((toHp > 0) && (this.Shield > 0))) {
      const toShield = Math.min(this.Shield, toHp);
      this.Shield = (this.Shield - toShield);
      toHp = (toHp - toShield);
      if ((this.Shield <= 0)) {
        this.ShieldBrokenTimer = 2.5;
      }
      this.ShieldRechargeTimer = 0;
    }
    seg.Hp = (seg.Hp - toHp);
    seg.HitFlash = 1;
    if ((setInvulnerable !== null)) {
      this.InvulnerableTimer = 0.6;
    }
    this.HurtFlash = 1;
    if (!(silent)) {
      Services.Fx.Burst(seg.X, seg.Y, "#ff3366", 8, 3, 2);
      Services.Fx.AddText(seg.X, (seg.Y - 18), ("-" + String(Math.floor(Math))), "#ff3366", 16, true);
      Services.Sound.PlayHit();
    }
    if ((seg.Hp <= 0)) {
      this.SeverFrom(segmentIndex);
    } else {
      this.RecalculateHp();
    }
    return dealt;
  }
  damageSegment(segmentIndex: number, amount: number, applyArmor: unknown = true, setInvulnerable: unknown = true, silent: unknown = false): number {
    return this.DamageSegment(segmentIndex, amount, applyArmor, setInvulnerable, silent);
  }
  SeverFrom(index: number): void {
    if (((((typeof (index) !== "number") || !(Number.isInteger(index))) || (index < 0)) || (index >= this.Segments.length))) {
      return;
    }
    const severCount = (this.Segments.length - index);
    if ((severCount > 10)) {
      const step = Math.max(1, Math.floor(Math));
      if (this.Segments[index]) {
        Services.Fx.AddText(this.Segments[index].X, (this.Segments[index].Y - 24), (("⚡ SEVERED (-" + String(severCount)) + ")!"), "#ff5400", 16, true);
      }
    } else {
      null;
    }
    if (this.Segments[index]) {
      Services.Fx.RingShockwave(this.Segments[index].X, this.Segments[index].Y, "#ff3366", 22, 0.08);
    }
    Services.Sound.PlayExplosion();
    this.Segments.splice(index);
    this.RecalculateHp();
    this.RecalculateMaxHp();
    this.Stats.MaxHp = this.MaxHp;
    if (((this.Segments.length === 0) && (this.HeadHp <= 0))) {
      const charges = (this.Relics["phoenixCharges"] ?? 0);
      if ((charges > 0)) {
        this.Relics["phoenixCharges"] = (charges - 1);
        this.HeadHp = this.HeadMaxHp;
        this.AddGrowth(2);
        this.InvulnerableTimer = 3;
        this.PendingRevive = true;
        Services.Fx.AddText(this.X, (this.Y - 46), "🔥 PHOENIX REBIRTH 🔥", "#ffb703", 22, true);
        Services.Sound.PlayRevive();
        this.RecalculateHp();
        return;
      }
      this.Alive = false;
    }
  }
  severFrom(index: number): void {
    this.SeverFrom(index);
  }
  SwapSegments(i: number, j: number): void {
    if (((((typeof (i) !== "number") || !(Number.isInteger(i))) || (typeof (j) !== "number")) || !(Number.isInteger(j)))) {
      return;
    }
    if ((((((i < 0) || (i >= this.Segments.length)) || (j < 0)) || (j >= this.Segments.length)) || (i === j))) {
      return;
    }
    const temp = this.Segments[i];
    this.Segments[i] = this.Segments[j];
    this.Segments[j] = temp;
  }
  swapSegments(i: number, j: number): void {
    this.SwapSegments(i, j);
  }
  ReorderSegment(fromIndex: number, toIndex: number): void {
    if (((((typeof (fromIndex) !== "number") || !(Number.isInteger(fromIndex))) || (typeof (toIndex) !== "number")) || !(Number.isInteger(toIndex)))) {
      return;
    }
    if ((((((fromIndex < 0) || (fromIndex >= this.Segments.length)) || (toIndex < 0)) || (toIndex >= this.Segments.length)) || (fromIndex === toIndex))) {
      return;
    }
    const item = this.Segments.splice(fromIndex, 1)[0];
    this.Segments.splice(toIndex, 0, item);
  }
  reorderSegment(fromIndex: number, toIndex: number): void {
    this.ReorderSegment(fromIndex, toIndex);
  }
  static GetAddSegmentCost(currentSegmentCount: number): number {
    return (35 + (Math.max(0, (currentSegmentCount - 2)) * 15));
  }
  static getAddSegmentCost(currentSegmentCount: number): number {
    return SnakePlayer.GetAddSegmentCost(currentSegmentCount);
  }
  Heal(amount: number): number {
    if (((!(this.Alive) || !((amount > 0))) || !(Number.isFinite(amount)))) {
      return 0;
    }
    let remaining = amount;
    let totalHealed = 0;
    const headMissing = (this.HeadMaxHp - this.HeadHp);
    if ((headMissing > 0)) {
      const headAdd = Math.min(headMissing, remaining);
      this.HeadHp = (this.HeadHp + headAdd);
      remaining = (remaining - headAdd);
      totalHealed = (totalHealed + headAdd);
    }
    this.RecalculateHp();
    return totalHealed;
  }
  heal(amount: number): number {
    return this.Heal(amount);
  }
  static CalibratedXpThreshold(level: number): number {
    if ((!(Number.isFinite(level)) || (level <= 1))) {
      return 0;
    }
    return Math.floor(Math);
  }
  static calibratedXpThreshold(level: number): number {
    return SnakePlayer.CalibratedXpThreshold(level);
  }
  GainXp(amount: number): boolean {
    if (!((amount > 0))) {
      return false;
    }
    const earned = ((amount * this.Stats?.XpGain) ?? 1);
    this.Xp = (this.Xp + earned);
    this.TotalXpCollected = (this.TotalXpCollected + earned);
    let levelled = false;
    let guard = 0;
    while (((this.TotalXpCollected >= this._xpForNextLevel) && (guard < 50))) {
      this.Level = (this.Level + 1);
      this._xpForNextLevel = SnakePlayer.CalibratedXpThreshold((this.Level + 1));
      this.XpToNext = Math.max(1, (this._xpForNextLevel - SnakePlayer.CalibratedXpThreshold(this.Level)));
      this.PendingLevelUps = (this.PendingLevelUps + 1);
      levelled = true;
    }
    return levelled;
  }
  gainXp(amount: number): boolean {
    return this.GainXp(amount);
  }
  GainOuro(amount: number): boolean {
    return this.GainXp(amount);
  }
  gainOuro(amount: number): boolean {
    return this.GainXp(amount);
  }
  SpendOuro(cost: number): boolean {
    if (!(Number.isFinite(cost))) {
      return false;
    }
    if ((cost <= 0)) {
      return true;
    }
    if ((this.Xp < cost)) {
      return false;
    }
    this.Xp = (this.Xp - cost);
    return true;
  }
  spendOuro(cost: number): boolean {
    return this.SpendOuro(cost);
  }
  AddOuro(amount: number): void {
    if ((Number.isFinite(amount) && (amount > 0))) {
      this.Xp = (this.Xp + amount);
      this.TotalXpCollected = (this.TotalXpCollected + amount);
    }
  }
  addOuro(amount: number): void {
    this.AddOuro(amount);
  }
  TakeDamage(amount: number, _source: string | null = null): number {
    if (((!(this.Alive) || (this.InvulnerableTimer > 0)) || !((amount > 0)))) {
      return 0;
    }
    if ((this.HeadModules["cloak"] && (this.HeadModules["cloak"] > 0))) {
      if ((Math.random() < (0.15 * this.HeadModules["cloak"]))) {
        Services.Fx.AddText(this.X, (this.Y - 24), "💨 EVADED!", "#a855f7", 15, true);
        this.InvulnerableTimer = 0.8;
        return 0;
      }
    }
    if ((this.HeadModules["reactive"] && (this.HeadModules["reactive"] > 0))) {
      Services.Fx.RingShockwave(this.X, this.Y, "#f97316", 36, 0.06);
      Services.Sound.PlayExplosion();
    }
    const dealt = Math.max(1, MathX.roundJs(((amount * 1) - this.EffectiveArmor)));
    let toShield = 0;
    let toHp = dealt;
    if ((this.Shield > 0)) {
      toShield = Math.min(this.Shield, dealt);
      this.Shield = (this.Shield - toShield);
      toHp = (dealt - toShield);
      if ((this.Shield <= 0)) {
        this.ShieldBrokenTimer = 2.5;
      }
      this.ShieldRechargeTimer = 0;
    }
    while (((toHp > 0) && (this.Segments.length > 0))) {
      const lastIdx = (this.Segments.length - 1);
      const lastSeg = this.Segments[lastIdx];
      if ((lastSeg.Hp > toHp)) {
        lastSeg.Hp = (lastSeg.Hp - toHp);
        lastSeg.HitFlash = 1;
        Services.Fx.Burst(lastSeg.X, lastSeg.Y, "#ff3366", 8, 3, 2);
        toHp = 0;
      } else {
        toHp = (toHp - lastSeg.Hp);
        Services.Fx.Burst(lastSeg.X, lastSeg.Y, "#ff5400", 10, 4, 3);
        Services.Fx.AddText(lastSeg.X, (lastSeg.Y - 20), "⚡ LIFE SOURCED", "#ffb703", 14, true);
        this.Segments.pop();
        this.RecalculateHp();
        this.RecalculateMaxHp();
        this.Stats.MaxHp = this.MaxHp;
      }
    }
    if ((toHp > 0)) {
      this.HeadHp = Math.max(0, (this.HeadHp - toHp));
    }
    this.InvulnerableTimer = 0.6;
    this.HurtFlash = 1;
    if (((toShield > 0) && (toHp === 0))) {
      Services.Fx.AddText(this.X, (this.Y - 22), (("-" + String(Math.floor(Math))) + " 🛡️"), "#3a86ff", 14, true);
      Services.Sound.PlayShield();
    } else {
      Services.Fx.AddText(this.X, (this.Y - 22), ("-" + String(Math.floor(Math))), "#ff3366", 17, true);
      Services.Fx.Shake(9, 12);
      Services.Sound.PlayHit();
    }
    if (((this.Segments.length === 0) && (this.HeadHp <= 0))) {
      const charges = (this.Relics["phoenixCharges"] ?? 0);
      if ((charges > 0)) {
        this.Relics["phoenixCharges"] = (charges - 1);
        this.HeadHp = this.HeadMaxHp;
        this.AddGrowth(2);
        this.InvulnerableTimer = 3;
        this.PendingRevive = true;
        Services.Fx.AddText(this.X, (this.Y - 46), "🔥 PHOENIX REBIRTH 🔥", "#ffb703", 22, true);
        Services.Sound.PlayRevive();
        return 0;
      }
      this.Alive = false;
    }
    return dealt;
  }
  takeDamage(amount: number, source: string | null = null): number {
    return this.TakeDamage(amount, source);
  }
  Autotomy(world: World): number {
    if ((!(this.Alive) || (this.Segments.length <= 1))) {
      return 0;
    }
    const cutIndex = Math.max(1, Math.floor(Math));
    const severedCount = (this.Segments.length - cutIndex);
    const cutSegment = this.Segments[cutIndex];
    if ((cutSegment !== null)) {
      Services.Fx.RingShockwave(cutSegment.X, cutSegment.Y, "#ff5400", 32, 0.06);
      const combat = (((world !== null) && (((world.combat ?? world.Combat) ?? world.game?.combat) ?? world.Game?.Combat)) || null);
      if ((((world !== null) && combat) && (typeof (combat.explodeAt) === "function"))) {
        combat.explodeAt(world, cutSegment.X, cutSegment.Y, 140, (80 * this.DamageBonus), "#ff5400");
      }
    }
    Services.Sound.PlayExplosion(1.5);
    Services.Fx.Shake(12, 16);
    this.Segments.splice(cutIndex);
    this.RecalculateHp();
    this.RecalculateMaxHp();
    this.Stats.MaxHp = this.MaxHp;
    this.InvulnerableTimer = 1.2;
    this.AgilitySurgeTimer = 4;
    return severedCount;
  }
  autotomy(world: World): number {
    return this.Autotomy(world);
  }
  GetSegmentTangentialSpeed(segmentIndex: number): number {
    if (((((typeof (segmentIndex) !== "number") || !(Number.isInteger(segmentIndex))) || (segmentIndex < 0)) || (segmentIndex >= this.Segments.length))) {
      return this.BaseSpeed;
    }
    return (this.BaseSpeed + ((this.EffectiveTurnSpeed * segmentIndex) * this.SegmentSpacing));
  }
  getSegmentTangentialSpeed(segmentIndex: number): number {
    return this.GetSegmentTangentialSpeed(segmentIndex);
  }
  GetTailWhipDamageMultiplier(segmentIndex: number): number {
    const v = this.GetSegmentTangentialSpeed(segmentIndex);
    const ratio = (v / Math.max(1, this.BaseSpeed));
    return (1 + (0.85 * Math.pow(ratio, 2)));
  }
  getTailWhipDamageMultiplier(segmentIndex: number): number {
    return this.GetTailWhipDamageMultiplier(segmentIndex);
  }
  ResolveTailWhipCollision(segmentIndex: number, enemy: Enemy | IDamageable | unknown | Record | null): number {
    if (((((typeof (segmentIndex) !== "number") || !(Number.isInteger(segmentIndex))) || (segmentIndex < 0)) || (segmentIndex >= this.Segments.length))) {
      return 0;
    }
    if ((!(enemy) || (typeof (enemy.takeDamage) !== "function"))) {
      return 0;
    }
    const mult = this.GetTailWhipDamageMultiplier(segmentIndex);
    const rawDmg = Math.round(Math);
    const dealt = enemy.takeDamage(rawDmg, this);
    const seg = this.Segments[segmentIndex];
    if (((((seg !== null) && ("x" === enemy)) && (typeof (enemy.x) === "number")) || (("X" === enemy) && (typeof (enemy.X) === "number")))) {
      const ex = ((((("X" === enemy) && (typeof (enemy.X) === "number")) && enemy.X) || ((("x" === enemy) && (typeof (enemy.x) === "number")) && enemy.x)) || 0);
      const ey = ((((("Y" === enemy) && (typeof (enemy.Y) === "number")) && enemy.Y) || ((("y" === enemy) && (typeof (enemy.y) === "number")) && enemy.y)) || 0);
      const dx = (ex - seg.X);
      const dy = (ey - seg.Y);
      const dist = Math.hypot(dx, dy);
      const nx = ((((dist > 0.001) && Number.isFinite(dist)) && (dx / dist)) || Math.cos(this.Angle));
      const ny = ((((dist > 0.001) && Number.isFinite(dist)) && (dy / dist)) || Math.sin(this.Angle));
      if ((Number.isFinite(nx) && Number.isFinite(ny))) {
        if ((("X" === enemy) && (typeof (enemy.X) === "number"))) {
          enemy.X = (enemy.X + (nx * 180));
        }
        if ((("Y" === enemy) && (typeof (enemy.Y) === "number"))) {
          enemy.Y = (enemy.Y + (ny * 180));
        }
        if ((("x" === enemy) && (typeof (enemy.x) === "number"))) {
          enemy.x = (enemy.X ?? (enemy.x + (nx * 180)));
        }
        if ((("y" === enemy) && (typeof (enemy.y) === "number"))) {
          enemy.y = (enemy.Y ?? (enemy.y + (ny * 180)));
        }
      }
    }
    const enemyCoordX = ((((("X" === enemy) && (typeof (enemy.X) === "number")) && enemy.X) || ((("x" === enemy) && (typeof (enemy.x) === "number")) && enemy.x)) || 0);
    const enemyCoordY = ((((("Y" === enemy) && (typeof (enemy.Y) === "number")) && enemy.Y) || ((("y" === enemy) && (typeof (enemy.y) === "number")) && enemy.y)) || 0);
    Services.Fx.Burst(enemyCoordX, enemyCoordY, "#38bdf8", 12, 4, 3);
    Services.Fx.AddText(enemyCoordX, (enemyCoordY - 20), ("WHIP! -" + String(Math.floor(Math))), "#38bdf8", 17, true);
    Services.Sound.PlayHit(1.2);
    Services.Fx.Shake(6, 8);
    return dealt;
  }
  resolveTailWhipCollision(segmentIndex: number, enemy: Enemy | IDamageable | unknown): number {
    return this.ResolveTailWhipCollision(segmentIndex, enemy);
  }
  GetActiveAlchemicalFusions(): string[] {
    const installed = new Set();
    if ((this.HeadModules !== null)) {
      for (const [k, lvl] of Object.entries(this.HeadModules)) {
        if ((lvl > 0)) {
          installed.add(k.toLowerCase());
        }
      }
    }
    const active: string[] = [];
    for (const fusion of GameData.AlchemicalFusions) {
      if ((installed.has(fusion.ModuleA.toLowerCase()) && installed.has(fusion.ModuleB.toLowerCase()))) {
        active.push(fusion.Id);
      }
    }
    return active;
  }
  getActiveAlchemicalFusions(): string[] {
    return this.GetActiveAlchemicalFusions();
  }
}
