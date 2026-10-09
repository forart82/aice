import { MathX } from "../core/MathX.js";
import { Rng } from "../core/Rng.js";
import { Services } from "../core/Services.js";
import { Vec2 } from "../core/Vec2.js";
import { GameData } from "../data/GameData.js";
import { BossArchetypeDef } from "../data/Types.js";
import { StatusSet } from "./StatusSet.js";
import { Hazard } from "./Hazard.js";
import { Projectile } from "./Projectile.js";
import { SnakePlayer } from "./SnakePlayer.js";
import { World } from "./World.js";

export class BossSegment {
  X = 0;
  Y = 0;
  Angle = 0;
  R = 15;
  Hp = 25;
  MaxHp = 25;
  HitFlash = 0;
  get_x(): number {
    return this.X;
  }
  set_x(v: number): void {
    this.X = v;
  }
  get_y(): number {
    return this.Y;
  }
  set_y(v: number): void {
    this.Y = v;
  }
  get_angle(): number {
    return this.Angle;
  }
  set_angle(v: number): void {
    this.Angle = v;
  }
  get_r(): number {
    return this.R;
  }
  set_r(v: number): void {
    this.R = v;
  }
  get_hp(): number {
    return this.Hp;
  }
  set_hp(v: number): void {
    this.Hp = v;
  }
  get_maxHp(): number {
    return this.MaxHp;
  }
  set_maxHp(v: number): void {
    this.MaxHp = v;
  }
  get_hitFlash(): number {
    return this.HitFlash;
  }
  set_hitFlash(v: number): void {
    this.HitFlash = v;
  }
}

export interface ITelegraphAttack {
  type: "circle" | "cone" | "line" | "hazard" | "ring" | str;
  x: number | null;
  y: number | null;
  x1: number | null;
  y1: number | null;
  x2: number | null;
  y2: number | null;
  width: number | null;
  radius: number | null;
  length: number | null;
  spread: number | null;
  angle: number | null;
  progress: number;
  color: string | null;
  maxRadius: number | null;
  innerRadius: number | null;
}

export function ITelegraphAttack(type: "circle" | "cone" | "line" | "hazard" | "ring" | str, x: number | null, y: number | null, x1: number | null, y1: number | null, x2: number | null, y2: number | null, width: number | null, radius: number | null, length: number | null, spread: number | null, angle: number | null, progress: number, color: string | null, maxRadius: number | null, innerRadius: number | null): ITelegraphAttack {
  return { type, x, y, x1, y1, x2, y2, width, radius, length, spread, angle, progress, color, maxRadius, innerRadius };
}

export class Boss {
  static readonly RomanNumerals = ["", "II", "III", "IV", "V"];
  static readonly SpreadPhase1 = [-(0.28), 0, 0.28];
  static readonly SpreadPhase2 = [-(0.5), -(0.25), 0, 0.25, 0.5];
  static readonly NoParts: BossSegment[] = [];
  Floor: number;
  ArenaW: number;
  ArenaH: number;
  Type: string;
  Name: string;
  Title: string;
  Color: string;
  Accent: string;
  Radius: number;
  HeadHp = 50;
  HeadMaxHp = 50;
  _targetTotalMaxHp = 0;
  X: number;
  Y: number;
  Angle = 0;
  SpiralAngle = 0;
  Phase = 1;
  AttackTimer = 2.2;
  MoveTimer = 0;
  Telegraph = 0;
  HitFlash = 0;
  StasisTimer = 0;
  Status: StatusSet;
  Dead = false;
  ContactDamage: number;
  XpValue: number = GameData.BossDefeatOuro;
  EntranceTimer = 1.4;
  WanderTarget: Vec2;
  Segments: BossSegment[] = [];
  Telegraphs: ITelegraphAttack[] = [];
  SegmentSpacing = 20;
  OnPhaseChange = false;
  MultiBossScale = 1;
  get_headHp(): number {
    return this.HeadHp;
  }
  set_headHp(v: number): void {
    this.HeadHp = v;
  }
  get_headMaxHp(): number {
    return this.HeadMaxHp;
  }
  set_headMaxHp(v: number): void {
    this.HeadMaxHp = v;
  }
  get_MaxHp(): number {
    if ((this._targetTotalMaxHp > 0)) {
      return this._targetTotalMaxHp;
    }
    let sum = this.HeadMaxHp;
    return sum;
  }
  set_MaxHp(v: number): void {
    this._targetTotalMaxHp = v;
    this.InitSegmentHealth();
  }
  get_Hp(): number {
    let sum = this.HeadHp;
    return sum;
  }
  set_Hp(v: number): void {
    if ((!(Number.isFinite(v)) || (v <= 0))) {
      this.HeadHp = 0;
      for (const s of this.Segments) {
        null;
      }
      this.Segments.length = 0;
      this.Dead = true;
      return;
    }
    let remaining = v;
    this.HeadHp = Math.min(this.HeadMaxHp, remaining);
    remaining = (remaining - this.HeadHp);
  }
  get_segmentSpacing(): number {
    return this.SegmentSpacing;
  }
  set_segmentSpacing(v: number): void {
    this.SegmentSpacing = v;
  }
  get_multiBossScale(): number {
    return this.MultiBossScale;
  }
  set_multiBossScale(v: number): void {
    this.MultiBossScale = v;
  }
  get_floor(): number {
    return this.Floor;
  }
  set_floor(v: number): void {
    this.Floor = v;
  }
  get_arenaW(): number {
    return this.ArenaW;
  }
  set_arenaW(v: number): void {
    this.ArenaW = v;
  }
  get_arenaH(): number {
    return this.ArenaH;
  }
  set_arenaH(v: number): void {
    this.ArenaH = v;
  }
  get_type(): string {
    return this.Type;
  }
  set_type(v: string): void {
    this.Type = v;
  }
  get_name(): string {
    return this.Name;
  }
  set_name(v: string): void {
    this.Name = v;
  }
  get_title(): string {
    return this.Title;
  }
  set_title(v: string): void {
    this.Title = v;
  }
  get_color(): string {
    return this.Color;
  }
  set_color(v: string): void {
    this.Color = v;
  }
  get_accent(): string {
    return this.Accent;
  }
  set_accent(v: string): void {
    this.Accent = v;
  }
  get_radius(): number {
    return this.Radius;
  }
  set_radius(v: number): void {
    this.Radius = v;
  }
  get_maxHp(): number {
    return this.MaxHp;
  }
  set_maxHp(v: number): void {
    this.MaxHp = v;
  }
  get_hp(): number {
    return this.Hp;
  }
  set_hp(v: number): void {
    this.Hp = v;
  }
  get_x(): number {
    return this.X;
  }
  set_x(v: number): void {
    this.X = v;
  }
  get_y(): number {
    return this.Y;
  }
  set_y(v: number): void {
    this.Y = v;
  }
  get_angle(): number {
    return this.Angle;
  }
  set_angle(v: number): void {
    this.Angle = v;
  }
  get_spiralAngle(): number {
    return this.SpiralAngle;
  }
  set_spiralAngle(v: number): void {
    this.SpiralAngle = v;
  }
  get_phase(): number {
    return this.Phase;
  }
  set_phase(v: number): void {
    this.Phase = v;
  }
  get_attackTimer(): number {
    return this.AttackTimer;
  }
  set_attackTimer(v: number): void {
    this.AttackTimer = v;
  }
  get_moveTimer(): number {
    return this.MoveTimer;
  }
  set_moveTimer(v: number): void {
    this.MoveTimer = v;
  }
  get_telegraph(): number {
    return this.Telegraph;
  }
  set_telegraph(v: number): void {
    this.Telegraph = v;
  }
  get_telegraphs(): ITelegraphAttack[] {
    return this.Telegraphs;
  }
  set_telegraphs(v: ITelegraphAttack[]): void {
    this.Telegraphs = v;
  }
  get_hitFlash(): number {
    return this.HitFlash;
  }
  set_hitFlash(v: number): void {
    this.HitFlash = v;
  }
  get_stasisTimer(): number {
    return this.StasisTimer;
  }
  set_stasisTimer(v: number): void {
    this.StasisTimer = v;
  }
  get_status(): StatusSet {
    return this.Status;
  }
  set_status(v: StatusSet): void {
    this.Status = v;
  }
  get_dead(): boolean {
    return this.Dead;
  }
  set_dead(v: boolean): void {
    this.Dead = v;
  }
  get_Alive(): boolean {
    return (!(this.Dead) && (this.Hp > 0));
  }
  get_alive(): boolean {
    return this.Alive;
  }
  get_contactDamage(): number {
    return this.ContactDamage;
  }
  set_contactDamage(v: number): void {
    this.ContactDamage = v;
  }
  get_xpValue(): number {
    return this.XpValue;
  }
  set_xpValue(v: number): void {
    this.XpValue = v;
  }
  get_entranceTimer(): number {
    return this.EntranceTimer;
  }
  set_entranceTimer(v: number): void {
    this.EntranceTimer = v;
  }
  get_wanderTarget(): Vec2 {
    return this.WanderTarget;
  }
  set_wanderTarget(v: Vec2): void {
    this.WanderTarget = v;
  }
  get_segments(): BossSegment[] {
    return this.Segments;
  }
  set_segments(v: BossSegment[]): void {
    this.Segments = v;
  }
  get_onPhaseChange(): boolean {
    return this.OnPhaseChange;
  }
  set_onPhaseChange(v: boolean): void {
    this.OnPhaseChange = v;
  }
  constructor(floor: number, arenaW: number, arenaH: number, specificTypeOrArchetype: str | BossArchetypeDef, startX: number, startY: number, multiBossScale: unknown = 1) {
    this.Floor = Math.max(1, floor);
    this.ArenaW = arenaW;
    this.ArenaH = arenaH;
    this.MultiBossScale = multiBossScale;
    let arch = GameData.Bosses[(this.Floor - (1 % GameData.Bosses.length))];
    if ((specificTypeOrArchetype !== null)) {
      if (((typeof (specificTypeOrArchetype) === "object") && (specificTypeOrArchetype !== null))) {
        arch = specificTypeOrArchetype;
      } else if ((typeof (specificTypeOrArchetype) === "string")) {
        const str = specificTypeOrArchetype.toLowerCase();
        const found = GameData.Bosses.find((b: unknown) => ((((b.Type.toLowerCase() === str) || (b.type.toLowerCase() === str)) || (b.Name.toLowerCase() === str)) || (b.name.toLowerCase() === str)));
        if ((found !== null)) {
          arch = found;
        }
      }
    }
    const cycle = Math.floor(Math);
    const cycleFloor = (cycle * GameData.Bosses.length);
    this.Type = arch.Type;
    if ((cycle > 0)) {
      this.Name = ((("" + String(arch.Name)) + " ") + String(Boss.RomanNumerals[Math.min(cycle, 4)]).trim());
    } else {
      this.Name = arch.Name;
    }
    this.Title = arch.Title;
    this.Color = arch.Color;
    this.Accent = arch.Accent;
    this.Radius = arch.Radius;
    const unscaledHp = MathX.roundJs(((arch.BaseHp + ((arch.HpPerFloor * cycleFloor) * 1)) + (cycle * 0.35)));
    if ((this.MultiBossScale !== 1)) {
      this._targetTotalMaxHp = MathX.roundJs((unscaledHp * this.MultiBossScale));
    } else {
      this._targetTotalMaxHp = unscaledHp;
    }
    if ((startX !== undefined)) {
      this.X = startX;
    } else {
      this.X = (arenaW * 0.5);
    }
    if ((startY !== undefined)) {
      this.Y = startY;
    } else {
      this.Y = (arenaH * 0.28);
    }
    this.Status = StatusSet();
    this.ContactDamage = (16 + (this.Floor * 3));
    this.WanderTarget = Vec2(this.X, (arenaH * 0.3));
    let segCount = 14;
    let baseRad = 15;
    let spacing = 20;
    if ((this.Type === "centipede")) {
      segCount = (14 + Math.min(10, (this.Floor * 2)));
      baseRad = 15;
      spacing = 21;
    } else if ((this.Type === "gorgon")) {
      segCount = (12 + Math.min(8, (this.Floor * 2)));
      baseRad = 14;
      spacing = 20;
    }
    this.SegmentSpacing = spacing;
    return this.InitSegmentHealth();
  }
  InitSegmentHealth(): void {
    const total = this._targetTotalMaxHp;
    const n = this.Segments.length;
    if ((n === 0)) {
      this.HeadMaxHp = total;
      this.HeadHp = total;
      return;
    }
    const totalWeights = (n + 2);
    const unitHp = Math.max(1, Math.floor(Math));
    const headHp = (total - (unitHp * n));
    this.HeadMaxHp = headHp;
    this.HeadHp = headHp;
  }
  get_Vulnerable(): boolean {
    return ((this.EntranceTimer <= 0) && !(this.Dead));
  }
  set_Vulnerable(v: boolean): void {
    if ((v !== null)) {
      this.EntranceTimer = 0;
    } else {
      this.EntranceTimer = 999;
    }
  }
  get_vulnerable(): boolean {
    return this.Vulnerable;
  }
  set_vulnerable(v: boolean): void {
    this.Vulnerable = v;
  }
  get_HpPct(): number {
    return MathX.clamp((this.Hp / this.MaxHp), 0, 1);
  }
  get_hpPct(): number {
    return this.HpPct;
  }
  ApplyDamage(amount: number): boolean {
    if ((!(this.Vulnerable) || !((amount > 0)))) {
      return false;
    }
    const effectiveDmg = (amount * this.Status.DamageTakenMult);
    let toHp = effectiveDmg;
    this.HitFlash = 1;
    while (((toHp > 0) && (this.Segments.length > 0))) {
      const lastIdx = (this.Segments.length - 1);
      const lastSeg = this.Segments[lastIdx];
      if ((lastSeg.Hp > toHp)) {
        lastSeg.Hp = (lastSeg.Hp - toHp);
        lastSeg.HitFlash = 1;
        toHp = 0;
      } else {
        toHp = (toHp - lastSeg.Hp);
        Services.Fx.Burst(lastSeg.X, lastSeg.Y, this.Color, 8, 3, 2);
        this.Segments.pop();
      }
    }
    if ((toHp > 0)) {
      this.HeadHp = Math.max(0, (this.HeadHp - toHp));
    }
    if ((((this.Hp > 0) && (this.Hp <= (this.MaxHp * 0.5))) && (this.Phase === 1))) {
      this.Phase = 2;
      this.AttackTimer = 0.9;
      this.OnPhaseChange = true;
    }
    if (((this.Segments.length === 0) && (this.HeadHp <= 0))) {
      this.HeadHp = 0;
      this.Dead = true;
      return true;
    }
    return false;
  }
  applyDamage(amount: number): boolean {
    return this.ApplyDamage(amount);
  }
  DamageHead(amount: number): boolean {
    return this.ApplyDamage(amount);
  }
  damageHead(amount: number): boolean {
    return this.DamageHead(amount);
  }
  DamageSegment(index: number, amount: number): boolean {
    if (((((typeof (index) !== "number") || !(Number.isInteger(index))) || (index < 0)) || (index >= this.Segments.length))) {
      return false;
    }
    if (((!(this.Vulnerable) || !((amount > 0))) || !(Number.isFinite(amount)))) {
      return false;
    }
    const effectiveDmg = (amount * this.Status.DamageTakenMult);
    const seg = this.Segments[index];
    seg.Hp = (seg.Hp - effectiveDmg);
    seg.HitFlash = 1;
    this.HitFlash = 0.6;
    if ((seg.Hp <= 0)) {
      this.SeverFrom(index);
    }
    if ((((this.Hp > 0) && (this.Hp <= (this.MaxHp * 0.5))) && (this.Phase === 1))) {
      this.Phase = 2;
      this.AttackTimer = 0.9;
      this.OnPhaseChange = true;
    }
    if (((this.Segments.length === 0) && (this.HeadHp <= 0))) {
      this.HeadHp = 0;
      this.Dead = true;
      return true;
    }
    return false;
  }
  damageSegment(index: number, amount: number): boolean {
    return this.DamageSegment(index, amount);
  }
  SeverFrom(index: number): void {
    if (((((typeof (index) !== "number") || !(Number.isInteger(index))) || (index < 0)) || (index >= this.Segments.length))) {
      return;
    }
    Services.Sound.PlayExplosion();
    this.Segments.splice(index);
    if (((this.Segments.length === 0) && (this.HeadHp <= 0))) {
      this.HeadHp = 0;
      this.Dead = true;
    }
  }
  severFrom(index: number): void {
    this.SeverFrom(index);
  }
  Update(dt: number, target: SnakePlayer, world: World): void {
    if ((((!(Number.isFinite(dt)) || (dt <= 0)) || !(target)) || !(world))) {
      return;
    }
    if (!(Number.isFinite(this.X))) {
      this.X = (this.ArenaW * 0.5);
    }
    if (!(Number.isFinite(this.Y))) {
      this.Y = (this.ArenaH * 0.3);
    }
    if (!(Number.isFinite(this.Angle))) {
      this.Angle = 0;
    }
    if ((this.HitFlash > 0)) {
      this.HitFlash = Math.max(0, (this.HitFlash - (dt * 5)));
    }
    const burn = this.Status.Update(dt);
    if ((burn > 0)) {
      this.ApplyDamage(burn);
    }
    if ((this.EntranceTimer > 0)) {
      this.EntranceTimer = (this.EntranceTimer - dt);
      return;
    }
    if ((this.Status.Immobile !== null)) {
      return;
    }
    if ((this.StasisTimer > 0)) {
      this.StasisTimer = Math.max(0, (this.StasisTimer - dt));
    }
    const stasisMult = (((this.StasisTimer > 0) && 0.2) || 1);
    const worldScale = ((((world !== null) && (world.TimeScale !== undefined)) && world.TimeScale) || 1);
    const scale = (((((this.Status.SpeedMult * stasisMult) * worldScale) !== 0) && worldScale) || 1);
    const tx = (target.X ?? target.x);
    const ty = (target.Y ?? target.y);
    const dx = (tx - this.X);
    const dy = (ty - this.Y);
    const dist = MathX.safeLen(dx, dy);
    this.AttackTimer = (this.AttackTimer - (dt * scale));
    if ((this.Type === "centipede")) {
      this.UpdateCentipede((dt * scale), dx, dy, dist, world);
    } else if ((this.Type === "gorgon")) {
      this.UpdateGorgon((dt * scale), dx, dy, dist, target, world);
    }
    this.UpdateSegments((dt * scale));
    const aw = ((this.ArenaW || world.ArenaW) || world.arenaW);
    const ah = ((this.ArenaH || world.ArenaH) || world.arenaH);
    this.X = MathX.clamp(this.X, this.Radius, (aw - this.Radius));
    this.Y = MathX.clamp(this.Y, this.Radius, (ah - this.Radius));
  }
  update(dt: number, target: SnakePlayer, world: World): void {
    this.Update(dt, target, world);
  }
  UpdateSegments(_dt: number): void {
    let px = ((Number.isFinite(this.X) && this.X) || (this.ArenaW * 0.5));
    let py = ((Number.isFinite(this.Y) && this.Y) || (this.ArenaH * 0.5));
    const spacing = this.SegmentSpacing;
    const n = this.Segments.length;
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
  UpdateCentipede(dt: number, dx: number, dy: number, _dist: number, world: World): void {
    const targetAngle = Math.atan2(dy, dx);
    const maxTurnRate = (((this.Phase === 2) && 6.5) || (4.5 * dt));
    const diff = MathX.angleDelta(this.Angle, targetAngle);
    this.Angle = (this.Angle + (Math.sign(diff) * Math.min(Math.abs(diff), maxTurnRate)));
    const speed = (((this.Phase === 2) && 185) || 130);
    this.X = (this.X + ((Math.cos(this.Angle) * speed) * dt));
    this.Y = (this.Y + ((Math.sin(this.Angle) * speed) * dt));
    if ((this.AttackTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.AttackTimer = 1.4;
      } else {
        this.AttackTimer = 2.2;
      }
      const spread = (((this.Phase === 2) && Boss.SpreadPhase2) || Boss.SpreadPhase1);
      Services.Sound.PlayShoot();
    }
  }
  UpdateGorgon(dt: number, dx: number, dy: number, _dist: number, target: SnakePlayer, world: World): void {
    const targetAngle = Math.atan2(dy, dx);
    const maxTurnRate = (((this.Phase === 2) && 6) || (4 * dt));
    const diff = MathX.angleDelta(this.Angle, targetAngle);
    this.Angle = (this.Angle + (Math.sign(diff) * Math.min(Math.abs(diff), maxTurnRate)));
    const speed = (((this.Phase === 2) && 145) || 92);
    this.X = (this.X + ((Math.cos(this.Angle) * speed) * dt));
    this.Y = (this.Y + ((Math.sin(this.Angle) * speed) * dt));
    if ((this.AttackTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.AttackTimer = 1.3;
      } else {
        this.AttackTimer = 2;
      }
      const count = (((this.Phase === 2) && 8) || 4);
      const baseAng = this.Angle;
      Services.Fx.RingShockwave(this.X, this.Y, "#00f0b5", 28, 0.04);
      Services.Sound.PlayThunder();
      if (((this.Phase === 2) && (world.Hazards.length < 70))) {
        const tx = (target.X ?? target.x);
        const ty = (target.Y ?? target.y);
        world.Hazards.push(Hazard(MathX.clamp((tx + Rng.Shared.range(-(120), 120)), 40, (this.ArenaW - 40)), MathX.clamp((ty + Rng.Shared.range(-(120), 120)), 40, (this.ArenaH - 40)), "laser", { Radius: 40, Life: 1.2, ImpactDamage: (24 + (this.Floor * 3)), Telegraph: 0.9, Owner: "enemy" }));
      }
    }
  }
  UpdateColossus(dt: number, target: SnakePlayer, _dist: number, world: World): void {
    this.MoveTimer = (this.MoveTimer - dt);
    if (((this.MoveTimer <= 0) || !(this.WanderTarget))) {
      this.MoveTimer = Rng.Shared.range(2.4, 4.2);
      this.WanderTarget = Vec2(Rng.Shared.range((this.ArenaW * 0.2), (this.ArenaW * 0.8)), Rng.Shared.range((this.ArenaH * 0.18), (this.ArenaH * 0.6)));
    }
    if ((this.WanderTarget !== null)) {
      const wdx = (this.WanderTarget.X - this.X);
      const wdy = (this.WanderTarget.Y - this.Y);
      const wd = MathX.safeLen(wdx, wdy);
      if ((wd > 8)) {
        this.X = (this.X + (((wdx / wd) * 62) * dt));
        this.Y = (this.Y + (((wdy / wd) * 62) * dt));
      }
    }
    if ((this.AttackTimer <= 0)) {
      const ringPhase = (this.Phase === 2);
      if ((ringPhase !== null)) {
        this.AttackTimer = 1.6;
      } else {
        this.AttackTimer = 2.3;
      }
      const count = (((ringPhase !== null) && 22) || 15);
      const baseAngle = Rng.Shared.angle();
      Services.Fx.RingShockwave(this.X, this.Y, this.Accent, 34, 0.035);
      Services.Sound.PlayExplosion(0.8);
      if (((ringPhase !== null) && (world.Hazards.length < 70))) {
        const tx = (target.X ?? target.x);
        const ty = (target.Y ?? target.y);
      }
    }
  }
  UpdateFrostwyrm(dt: number, dx: number, dy: number, _dist: number, target: SnakePlayer, world: World): void {
    const targetAngle = Math.atan2(dy, dx);
    const maxTurnRate = (((this.Phase === 2) && 5.5) || (3.8 * dt));
    const diff = MathX.angleDelta(this.Angle, targetAngle);
    this.Angle = (this.Angle + (Math.sign(diff) * Math.min(Math.abs(diff), maxTurnRate)));
    const speed = (((this.Phase === 2) && 138) || 78);
    this.X = (this.X + ((Math.cos(this.Angle) * speed) * dt));
    this.Y = (this.Y + ((Math.sin(this.Angle) * speed) * dt));
    if ((this.AttackTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.AttackTimer = 1.4;
      } else {
        this.AttackTimer = 2.2;
      }
      const count = (((this.Phase === 2) && 12) || 8);
      const baseAng = Rng.Shared.angle();
      Services.Fx.RingShockwave(this.X, this.Y, "#38bdf8", 32, 0.03);
      Services.Sound.PlayShoot();
      if (((this.Phase === 2) && (world.Hazards.length < 70))) {
        const tx = (target.X ?? target.x);
        const ty = (target.Y ?? target.y);
      }
    }
  }
  UpdateLeviathan(dt: number, target: SnakePlayer, _dist: number, world: World): void {
    this.SpiralAngle = ((((this.SpiralAngle + (dt * this.Phase)) === 2) && 3.4) || 2.4);
    this.MoveTimer = (this.MoveTimer - dt);
    const cx = (this.ArenaW * 0.5);
    const cy = (this.ArenaH * 0.42);
    const orbitR = (Math.min(this.ArenaW, this.ArenaH) * 0.22);
    const ox = (cx + (Math.cos((this.SpiralAngle * 0.35)) * orbitR));
    const oy = (cy + ((Math.sin((this.SpiralAngle * 0.55)) * orbitR) * 0.6));
    this.X = ((this.X + ox) - (this.X * Math.min(1, (dt * 1.4))));
    this.Y = ((this.Y + oy) - (this.Y * Math.min(1, (dt * 1.4))));
    if ((this.AttackTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.AttackTimer = 0.1;
      } else {
        this.AttackTimer = 0.16;
      }
      const arms = (((this.Phase === 2) && 3) || 2);
    }
    if ((this.MoveTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.MoveTimer = 3.4;
      } else {
        this.MoveTimer = 5;
      }
      const n = (((this.Phase === 2) && 3) || 2);
      const tx = (target.X ?? target.x);
      const ty = (target.Y ?? target.y);
      Services.Sound.PlayBossAlert();
    }
  }
  UpdateChronoWyrm(dt: number, dx: number, dy: number, _dist: number, target: SnakePlayer, world: World): void {
    const targetAngle = Math.atan2(dy, dx);
    const maxTurnRate = (((this.Phase === 2) && 6.2) || (4.2 * dt));
    const diff = MathX.angleDelta(this.Angle, targetAngle);
    this.Angle = (this.Angle + (Math.sign(diff) * Math.min(Math.abs(diff), maxTurnRate)));
    const speed = (((this.Phase === 2) && 160) || 110);
    this.X = (this.X + ((Math.cos(this.Angle) * speed) * dt));
    this.Y = (this.Y + ((Math.sin(this.Angle) * speed) * dt));
    if ((this.AttackTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.AttackTimer = 1.2;
      } else {
        this.AttackTimer = 1.9;
      }
      const count = (((this.Phase === 2) && 8) || 5);
      Services.Fx.RingShockwave(this.X, this.Y, "#a855f7", 30, 0.04);
      Services.Sound.PlayBossAlert();
      if (((this.Phase === 2) && (world.Hazards.length < 70))) {
        const tx = (target.X ?? target.x);
        const ty = (target.Y ?? target.y);
        world.Hazards.push(Hazard(MathX.clamp((tx + Rng.Shared.range(-(100), 100)), 40, (this.ArenaW - 40)), MathX.clamp((ty + Rng.Shared.range(-(100), 100)), 40, (this.ArenaH - 40)), "chrono", { Radius: 45, Life: 2.5, ImpactDamage: (18 + (this.Floor * 2)), Telegraph: 0.8, Owner: "enemy" }));
      }
    }
  }
  UpdateHivemind(dt: number, dx: number, dy: number, _dist: number, target: SnakePlayer, world: World): void {
    const targetAngle = Math.atan2(dy, dx);
    const maxTurnRate = (((this.Phase === 2) && 5.8) || (3.9 * dt));
    const diff = MathX.angleDelta(this.Angle, targetAngle);
    this.Angle = (this.Angle + (Math.sign(diff) * Math.min(Math.abs(diff), maxTurnRate)));
    const speed = (((this.Phase === 2) && 130) || 85);
    this.X = (this.X + ((Math.cos(this.Angle) * speed) * dt));
    this.Y = (this.Y + ((Math.sin(this.Angle) * speed) * dt));
    if ((this.AttackTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.AttackTimer = 1.1;
      } else {
        this.AttackTimer = 1.8;
      }
      const count = (((this.Phase === 2) && 10) || 6);
      Services.Fx.RingShockwave(this.X, this.Y, "#84cc16", 28, 0.05);
      Services.Sound.PlayShoot();
      if (((this.Phase === 2) && (world.Hazards.length < 70))) {
        const tx = (target.X ?? target.x);
        const ty = (target.Y ?? target.y);
        world.Hazards.push(Hazard(MathX.clamp((tx + Rng.Shared.range(-(120), 120)), 40, (this.ArenaW - 40)), MathX.clamp((ty + Rng.Shared.range(-(120), 120)), 40, (this.ArenaH - 40)), "poison", { Radius: 50, Life: 3.5, Dps: (15 + (this.Floor * 2)), Telegraph: 0.85, Owner: "enemy" }));
      }
    }
  }
  UpdateSuperconductor(dt: number, dx: number, dy: number, _dist: number, target: SnakePlayer, world: World): void {
    const targetAngle = Math.atan2(dy, dx);
    const maxTurnRate = (((this.Phase === 2) && 6.8) || (4.6 * dt));
    const diff = MathX.angleDelta(this.Angle, targetAngle);
    this.Angle = (this.Angle + (Math.sign(diff) * Math.min(Math.abs(diff), maxTurnRate)));
    const speed = (((this.Phase === 2) && 180) || 125);
    this.X = (this.X + ((Math.cos(this.Angle) * speed) * dt));
    this.Y = (this.Y + ((Math.sin(this.Angle) * speed) * dt));
    if ((this.AttackTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.AttackTimer = 1;
      } else {
        this.AttackTimer = 1.6;
      }
      const count = (((this.Phase === 2) && 12) || 8);
      Services.Fx.RingShockwave(this.X, this.Y, "#06d6a0", 36, 0.03);
      Services.Sound.PlayThunder();
      if (((this.Phase === 2) && (world.Hazards.length < 70))) {
        const tx = (target.X ?? target.x);
        const ty = (target.Y ?? target.y);
        world.Hazards.push(Hazard(MathX.clamp((tx + Rng.Shared.range(-(90), 90)), 40, (this.ArenaW - 40)), MathX.clamp((ty + Rng.Shared.range(-(90), 90)), 40, (this.ArenaH - 40)), "laser", { Radius: 42, Life: 1.5, ImpactDamage: (28 + (this.Floor * 3)), Telegraph: 0.75, Owner: "enemy" }));
      }
    }
  }
  UpdateQuantumHydra(dt: number, dx: number, dy: number, _dist: number, target: SnakePlayer, world: World): void {
    const targetAngle = Math.atan2(dy, dx);
    const maxTurnRate = (((this.Phase === 2) && 7.2) || (5 * dt));
    const diff = MathX.angleDelta(this.Angle, targetAngle);
    this.Angle = (this.Angle + (Math.sign(diff) * Math.min(Math.abs(diff), maxTurnRate)));
    const speed = (((this.Phase === 2) && 190) || 135);
    this.X = (this.X + ((Math.cos(this.Angle) * speed) * dt));
    this.Y = (this.Y + ((Math.sin(this.Angle) * speed) * dt));
    if ((this.AttackTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.AttackTimer = 1;
      } else {
        this.AttackTimer = 1.7;
      }
      const count = (((this.Phase === 2) && 10) || 5);
      Services.Fx.RingShockwave(this.X, this.Y, "#c084fc", 34, 0.035);
      Services.Sound.PlayShoot();
      if (((this.Phase === 2) && (world.Hazards.length < 70))) {
        const tx = (target.X ?? target.x);
        const ty = (target.Y ?? target.y);
        world.Hazards.push(Hazard(MathX.clamp((tx + Rng.Shared.range(-(110), 110)), 40, (this.ArenaW - 40)), MathX.clamp((ty + Rng.Shared.range(-(110), 110)), 40, (this.ArenaH - 40)), "laser", { Radius: 44, Life: 1.4, ImpactDamage: (26 + (this.Floor * 3)), Telegraph: 0.8, Owner: "enemy" }));
      }
    }
  }
  UpdateMirrorWyrm(dt: number, dx: number, dy: number, _dist: number, target: SnakePlayer, world: World): void {
    const targetAngle = Math.atan2(dy, dx);
    const maxTurnRate = (((this.Phase === 2) && 7.5) || (5.2 * dt));
    const diff = MathX.angleDelta(this.Angle, targetAngle);
    this.Angle = (this.Angle + (Math.sign(diff) * Math.min(Math.abs(diff), maxTurnRate)));
    const speed = (((this.Phase === 2) && 195) || 140);
    this.X = (this.X + ((Math.cos(this.Angle) * speed) * dt));
    this.Y = (this.Y + ((Math.sin(this.Angle) * speed) * dt));
    if ((this.AttackTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.AttackTimer = 0.95;
      } else {
        this.AttackTimer = 1.6;
      }
      const count = (((this.Phase === 2) && 6) || 3);
      Services.Fx.RingShockwave(this.X, this.Y, "#f43f5e", 30, 0.04);
      Services.Sound.PlayShoot();
      if (((this.Phase === 2) && (world.Hazards.length < 70))) {
        const tx = (target.X ?? target.x);
        const ty = (target.Y ?? target.y);
        world.Hazards.push(Hazard(MathX.clamp((tx + Rng.Shared.range(-(100), 100)), 40, (this.ArenaW - 40)), MathX.clamp((ty + Rng.Shared.range(-(100), 100)), 40, (this.ArenaH - 40)), "poison", { Radius: 42, Life: 2.8, Dps: (18 + (this.Floor * 2)), Telegraph: 0.7, Owner: "enemy" }));
      }
    }
  }
  UpdateVoidDevourer(dt: number, target: SnakePlayer, _dist: number, world: World): void {
    this.SpiralAngle = ((((this.SpiralAngle + (dt * this.Phase)) === 2) && 3.8) || 2.6);
    this.MoveTimer = (this.MoveTimer - dt);
    const cx = (this.ArenaW * 0.5);
    const cy = (this.ArenaH * 0.45);
    const orbitR = (Math.min(this.ArenaW, this.ArenaH) * 0.24);
    const ox = (cx + (Math.cos((this.SpiralAngle * 0.4)) * orbitR));
    const oy = (cy + ((Math.sin((this.SpiralAngle * 0.6)) * orbitR) * 0.65));
    this.X = ((this.X + ox) - (this.X * Math.min(1, (dt * 1.5))));
    this.Y = ((this.Y + oy) - (this.Y * Math.min(1, (dt * 1.5))));
    if ((this.AttackTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.AttackTimer = 0.12;
      } else {
        this.AttackTimer = 0.18;
      }
      const arms = (((this.Phase === 2) && 4) || 3);
    }
    if ((this.MoveTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.MoveTimer = 3;
      } else {
        this.MoveTimer = 4.5;
      }
      const tx = (target.X ?? target.x);
      const ty = (target.Y ?? target.y);
      Services.Fx.RingShockwave(this.X, this.Y, "#7928ca", 45, 0.04);
      Services.Sound.PlayBossAlert();
    }
  }
  UpdateOrbitalDreadnought(dt: number, dx: number, dy: number, _dist: number, target: SnakePlayer, world: World): void {
    const targetAngle = Math.atan2(dy, dx);
    const maxTurnRate = (((this.Phase === 2) && 5.2) || (3.6 * dt));
    const diff = MathX.angleDelta(this.Angle, targetAngle);
    this.Angle = (this.Angle + (Math.sign(diff) * Math.min(Math.abs(diff), maxTurnRate)));
    const speed = (((this.Phase === 2) && 140) || 95);
    this.X = (this.X + ((Math.cos(this.Angle) * speed) * dt));
    this.Y = (this.Y + ((Math.sin(this.Angle) * speed) * dt));
    if ((this.AttackTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.AttackTimer = 1.1;
      } else {
        this.AttackTimer = 1.8;
      }
      world.Projectiles.push(Projectile(this.X, this.Y, (this.Angle - 0.15), 310, (26 + (this.Floor * 2)), "enemy", "#06b6d4", { life: 2.8 }), Projectile(this.X, this.Y, (this.Angle + 0.15), 310, (26 + (this.Floor * 2)), "enemy", "#06b6d4", { life: 2.8 }));
      if ((this.Phase === 2)) {
        null;
      }
      Services.Fx.RingShockwave(this.X, this.Y, "#06b6d4", 38, 0.03);
      Services.Sound.PlayShoot();
      if (((this.Phase === 2) && (world.Hazards.length < 70))) {
        const tx = (target.X ?? target.x);
        const ty = (target.Y ?? target.y);
        world.Hazards.push(Hazard(MathX.clamp((tx + Rng.Shared.range(-(120), 120)), 40, (this.ArenaW - 40)), MathX.clamp((ty + Rng.Shared.range(-(120), 120)), 40, (this.ArenaH - 40)), "laser", { Radius: 45, Life: 1.3, ImpactDamage: (28 + (this.Floor * 3)), Telegraph: 0.75, Owner: "enemy" }));
      }
    }
  }
  UpdateIronJuggernaut(dt: number, target: SnakePlayer, _dist: number, world: World): void {
    this.MoveTimer = (this.MoveTimer - dt);
    if (((this.MoveTimer <= 0) || !(this.WanderTarget))) {
      this.MoveTimer = Rng.Shared.range(2, 3.8);
      this.WanderTarget = Vec2(Rng.Shared.range((this.ArenaW * 0.2), (this.ArenaW * 0.8)), Rng.Shared.range((this.ArenaH * 0.2), (this.ArenaH * 0.6)));
    }
    if ((this.WanderTarget !== null)) {
      const wdx = (this.WanderTarget.X - this.X);
      const wdy = (this.WanderTarget.Y - this.Y);
      const wd = MathX.safeLen(wdx, wdy);
      if ((wd > 8)) {
        this.X = (this.X + (((wdx / wd) * 80) * dt));
        this.Y = (this.Y + (((wdy / wd) * 80) * dt));
      }
    }
    if ((this.AttackTimer <= 0)) {
      const ringPhase = (this.Phase === 2);
      if ((ringPhase !== null)) {
        this.AttackTimer = 1.5;
      } else {
        this.AttackTimer = 2.2;
      }
      const count = (((ringPhase !== null) && 24) || 16);
      const baseAngle = Rng.Shared.angle();
      Services.Fx.RingShockwave(this.X, this.Y, "#64748b", 42, 0.04);
      Services.Sound.PlayExplosion(0.9);
      if (((ringPhase !== null) && (world.Hazards.length < 70))) {
        const tx = (target.X ?? target.x);
        const ty = (target.Y ?? target.y);
      }
    }
  }
  UpdateSolarArchon(dt: number, dx: number, dy: number, _dist: number, target: SnakePlayer, world: World): void {
    const targetAngle = Math.atan2(dy, dx);
    const maxTurnRate = (((this.Phase === 2) && 6.2) || (4.4 * dt));
    const diff = MathX.angleDelta(this.Angle, targetAngle);
    this.Angle = (this.Angle + (Math.sign(diff) * Math.min(Math.abs(diff), maxTurnRate)));
    const speed = (((this.Phase === 2) && 165) || 115);
    this.X = (this.X + ((Math.cos(this.Angle) * speed) * dt));
    this.Y = (this.Y + ((Math.sin(this.Angle) * speed) * dt));
    if ((this.AttackTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.AttackTimer = 1;
      } else {
        this.AttackTimer = 1.7;
      }
      const count = (((this.Phase === 2) && 14) || 8);
      const baseAng = Rng.Shared.angle();
      Services.Fx.RingShockwave(this.X, this.Y, "#f97316", 36, 0.035);
      Services.Sound.PlayShoot();
      if (((this.Phase === 2) && (world.Hazards.length < 70))) {
        const tx = (target.X ?? target.x);
        const ty = (target.Y ?? target.y);
        world.Hazards.push(Hazard(MathX.clamp((tx + Rng.Shared.range(-(130), 130)), 40, (this.ArenaW - 40)), MathX.clamp((ty + Rng.Shared.range(-(130), 130)), 40, (this.ArenaH - 40)), "laser", { Radius: 48, Life: 1.6, ImpactDamage: (30 + (this.Floor * 3)), Telegraph: 0.7, Owner: "enemy" }));
      }
    }
  }
  UpdateCrystalMonolith(dt: number, target: SnakePlayer, _dist: number, world: World): void {
    this.SpiralAngle = ((((this.SpiralAngle + (dt * this.Phase)) === 2) && 3) || 2);
    this.MoveTimer = (this.MoveTimer - dt);
    const cx = (this.ArenaW * 0.5);
    const cy = (this.ArenaH * 0.4);
    const orbitR = (Math.min(this.ArenaW, this.ArenaH) * 0.22);
    this.X = (((this.X + cx) + (Math.cos((this.SpiralAngle * 0.5)) * orbitR)) - (this.X * Math.min(1, (dt * 1.2))));
    this.Y = (((this.Y + cy) + ((Math.sin((this.SpiralAngle * 0.5)) * orbitR) * 0.7)) - (this.Y * Math.min(1, (dt * 1.2))));
    if ((this.AttackTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.AttackTimer = 1.1;
      } else {
        this.AttackTimer = 1.9;
      }
      const count = (((this.Phase === 2) && 12) || 6);
      Services.Fx.RingShockwave(this.X, this.Y, "#f472b6", 32, 0.03);
      Services.Sound.PlayShoot();
      if (((this.Phase === 2) && (world.Hazards.length < 70))) {
        const tx = (target.X ?? target.x);
        const ty = (target.Y ?? target.y);
        world.Hazards.push(Hazard(MathX.clamp((tx + Rng.Shared.range(-(100), 100)), 40, (this.ArenaW - 40)), MathX.clamp((ty + Rng.Shared.range(-(100), 100)), 40, (this.ArenaH - 40)), "laser", { Radius: 40, Life: 1.4, ImpactDamage: (26 + (this.Floor * 2)), Telegraph: 0.8, Owner: "enemy" }));
      }
    }
  }
  UpdateTempestSiren(dt: number, dx: number, dy: number, _dist: number, target: SnakePlayer, world: World): void {
    const targetAngle = Math.atan2(dy, dx);
    const maxTurnRate = (((this.Phase === 2) && 6.5) || (4.5 * dt));
    const diff = MathX.angleDelta(this.Angle, targetAngle);
    this.Angle = (this.Angle + (Math.sign(diff) * Math.min(Math.abs(diff), maxTurnRate)));
    const speed = (((this.Phase === 2) && 175) || 120);
    this.X = (this.X + ((Math.cos(this.Angle) * speed) * dt));
    this.Y = (this.Y + ((Math.sin(this.Angle) * speed) * dt));
    if ((this.AttackTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.AttackTimer = 1;
      } else {
        this.AttackTimer = 1.6;
      }
      const count = (((this.Phase === 2) && 12) || 8);
      Services.Fx.RingShockwave(this.X, this.Y, "#67e8f9", 35, 0.03);
      Services.Sound.PlayThunder();
      if (((this.Phase === 2) && (world.Hazards.length < 70))) {
        const tx = (target.X ?? target.x);
        const ty = (target.Y ?? target.y);
        world.Hazards.push(Hazard(MathX.clamp((tx + Rng.Shared.range(-(110), 110)), 40, (this.ArenaW - 40)), MathX.clamp((ty + Rng.Shared.range(-(110), 110)), 40, (this.ArenaH - 40)), "laser", { Radius: 46, Life: 1.5, ImpactDamage: (28 + (this.Floor * 3)), Telegraph: 0.75, Owner: "enemy" }));
      }
    }
  }
  UpdateNaniteTitan(dt: number, dx: number, dy: number, _dist: number, target: SnakePlayer, world: World): void {
    const targetAngle = Math.atan2(dy, dx);
    const maxTurnRate = (((this.Phase === 2) && 5.8) || (4 * dt));
    const diff = MathX.angleDelta(this.Angle, targetAngle);
    this.Angle = (this.Angle + (Math.sign(diff) * Math.min(Math.abs(diff), maxTurnRate)));
    const speed = (((this.Phase === 2) && 145) || 100);
    this.X = (this.X + ((Math.cos(this.Angle) * speed) * dt));
    this.Y = (this.Y + ((Math.sin(this.Angle) * speed) * dt));
    if ((this.AttackTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.AttackTimer = 1;
      } else {
        this.AttackTimer = 1.7;
      }
      const count = (((this.Phase === 2) && 10) || 6);
      Services.Fx.RingShockwave(this.X, this.Y, "#34d399", 32, 0.04);
      Services.Sound.PlayShoot();
      if ((((this.Phase === 2) && (this.Segments.length < 24)) && Rng.Shared.chance(0.35))) {
        const lastSeg = this.Segments[(this.Segments.length - 1)];
        const newSeg = new BossSegment();
        if ((lastSeg !== null)) {
          newSeg.X = lastSeg.X;
        } else {
          newSeg.X = this.X;
        }
        if ((lastSeg !== null)) {
          newSeg.Y = (lastSeg.Y + this.SegmentSpacing);
        } else {
          newSeg.Y = this.Y;
        }
        newSeg.R = 12;
        newSeg.MaxHp = 30;
        newSeg.Hp = 30;
        this.Segments.push(newSeg);
        Services.Fx.Burst(newSeg.X, newSeg.Y, "#10b981", 8, 3, 2);
      }
      if (((this.Phase === 2) && (world.Hazards.length < 70))) {
        const tx = (target.X ?? target.x);
        const ty = (target.Y ?? target.y);
        world.Hazards.push(Hazard(MathX.clamp((tx + Rng.Shared.range(-(120), 120)), 40, (this.ArenaW - 40)), MathX.clamp((ty + Rng.Shared.range(-(120), 120)), 40, (this.ArenaH - 40)), "poison", { Radius: 48, Life: 3, Dps: (18 + (this.Floor * 2)), Telegraph: 0.8, Owner: "enemy" }));
      }
    }
  }
  UpdatePhaseSpecter(dt: number, dx: number, dy: number, _dist: number, target: SnakePlayer, world: World): void {
    const targetAngle = Math.atan2(dy, dx);
    const maxTurnRate = (((this.Phase === 2) && 7) || (4.8 * dt));
    const diff = MathX.angleDelta(this.Angle, targetAngle);
    this.Angle = (this.Angle + (Math.sign(diff) * Math.min(Math.abs(diff), maxTurnRate)));
    const speed = (((this.Phase === 2) && 185) || 130);
    this.X = (this.X + ((Math.cos(this.Angle) * speed) * dt));
    this.Y = (this.Y + ((Math.sin(this.Angle) * speed) * dt));
    if ((this.AttackTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.AttackTimer = 1;
      } else {
        this.AttackTimer = 1.7;
      }
      const count = (((this.Phase === 2) && 12) || 6);
      Services.Fx.RingShockwave(this.X, this.Y, "#a78bfa", 32, 0.035);
      Services.Sound.PlayShoot();
      if (((this.Phase === 2) && (world.Hazards.length < 70))) {
        const tx = (target.X ?? target.x);
        const ty = (target.Y ?? target.y);
        world.Hazards.push(Hazard(MathX.clamp((tx + Rng.Shared.range(-(100), 100)), 40, (this.ArenaW - 40)), MathX.clamp((ty + Rng.Shared.range(-(100), 100)), 40, (this.ArenaH - 40)), "laser", { Radius: 42, Life: 1.4, ImpactDamage: (26 + (this.Floor * 3)), Telegraph: 0.75, Owner: "enemy" }));
      }
    }
  }
  UpdateVolcanicChimera(dt: number, target: SnakePlayer, _dist: number, world: World): void {
    this.MoveTimer = (this.MoveTimer - dt);
    if (((this.MoveTimer <= 0) || !(this.WanderTarget))) {
      this.MoveTimer = Rng.Shared.range(2.2, 3.8);
      this.WanderTarget = Vec2(Rng.Shared.range((this.ArenaW * 0.25), (this.ArenaW * 0.75)), Rng.Shared.range((this.ArenaH * 0.2), (this.ArenaH * 0.6)));
    }
    if ((this.WanderTarget !== null)) {
      const wdx = (this.WanderTarget.X - this.X);
      const wdy = (this.WanderTarget.Y - this.Y);
      const wd = MathX.safeLen(wdx, wdy);
      if ((wd > 8)) {
        this.X = (this.X + (((wdx / wd) * 85) * dt));
        this.Y = (this.Y + (((wdy / wd) * 85) * dt));
      }
    }
    if ((this.AttackTimer <= 0)) {
      const ringPhase = (this.Phase === 2);
      if ((ringPhase !== null)) {
        this.AttackTimer = 1.4;
      } else {
        this.AttackTimer = 2;
      }
      const tx = (target.X ?? target.x);
      const ty = (target.Y ?? target.y);
      const mainAng = Math.atan2((ty - this.Y), (tx - this.X));
      const angles = [(mainAng - 0.45), mainAng, (mainAng + 0.45)];
      for (const base of angles) {
        null;
      }
      Services.Fx.RingShockwave(this.X, this.Y, "#f87171", 38, 0.04);
      Services.Sound.PlayExplosion(0.85);
      if (((ringPhase !== null) && (world.Hazards.length < 70))) {
        null;
      }
    }
  }
  UpdateEternalOuroboros(dt: number, target: SnakePlayer, _dist: number, world: World): void {
    this.SpiralAngle = ((((this.SpiralAngle + (dt * this.Phase)) === 2) && 4.2) || 3);
    this.MoveTimer = (this.MoveTimer - dt);
    const cx = (this.ArenaW * 0.5);
    const cy = (this.ArenaH * 0.45);
    const orbitR = (Math.min(this.ArenaW, this.ArenaH) * 0.25);
    this.X = (((this.X + cx) + (Math.cos((this.SpiralAngle * 0.45)) * orbitR)) - (this.X * Math.min(1, (dt * 1.5))));
    this.Y = (((this.Y + cy) + ((Math.sin((this.SpiralAngle * 0.45)) * orbitR) * 0.75)) - (this.Y * Math.min(1, (dt * 1.5))));
    if ((this.AttackTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.AttackTimer = 0.12;
      } else {
        this.AttackTimer = 0.18;
      }
      const arms = (((this.Phase === 2) && 4) || 3);
    }
    if ((this.MoveTimer <= 0)) {
      if ((this.Phase === 2)) {
        this.MoveTimer = 2.8;
      } else {
        this.MoveTimer = 4;
      }
      const novaCount = (((this.Phase === 2) && 24) || 16);
      const tx = (target.X ?? target.x);
      const ty = (target.Y ?? target.y);
      Services.Fx.RingShockwave(this.X, this.Y, "#ffd166", 50, 0.035);
      Services.Sound.PlayBossAlert();
      if (((this.Phase === 2) && (world.Hazards.length < 70))) {
        world.Hazards.push(Hazard(MathX.clamp((tx + Rng.Shared.range(-(100), 100)), 40, (this.ArenaW - 40)), MathX.clamp((ty + Rng.Shared.range(-(100), 100)), 40, (this.ArenaH - 40)), "laser", { Radius: 50, Life: 1.5, ImpactDamage: (32 + (this.Floor * 3)), Telegraph: 0.7, Owner: "enemy" }));
      }
    }
  }
  Parts(): BossSegment[] {
    return this.Segments;
  }
  parts(): BossSegment[] {
    return this.Parts();
  }
}
