import { MathX } from "../core/MathX.js";
import { Rng } from "../core/Rng.js";
import { Services } from "../core/Services.js";
import { GameData } from "../data/GameData.js";
import { StatusSet } from "./StatusSet.js";
import { Projectile } from "./Projectile.js";
import { SnakePlayer } from "./SnakePlayer.js";
import { World } from "./World.js";

export class Enemy {
  static _enemyId = 0;
  static readonly DroneSpread: number = [-(0.26), 0, 0.26];
  static readonly droneSpread = Enemy.DroneSpread;
  Id: number;
  Type: string;
  Floor: number;
  X: number;
  Y: number;
  Vx = 0;
  Vy = 0;
  Radius: number;
  Color: string;
  MaxHp: number;
  Hp: number;
  Speed: number;
  ContactDamage: number;
  XpValue: number;
  ScoreValue: number;
  Status: StatusSet;
  ShootTimer: number;
  StateTimer = 0;
  ChargeTimer = 0;
  Charging = false;
  ChargeAngle = 0;
  WobblePhase: number;
  SpawnTimer = 0.45;
  HitFlash = 0;
  StasisTimer = 0;
  Dead = false;
  Angle = 0;
  get_stasisTimer(): number {
    return this.StasisTimer;
  }
  set_stasisTimer(v: number): void {
    this.StasisTimer = v;
  }
  get_id(): number {
    return this.Id;
  }
  set_id(v: number): void {
    this.Id = v;
  }
  get_type(): string {
    return this.Type;
  }
  set_type(v: string): void {
    this.Type = v;
  }
  get_floor(): number {
    return this.Floor;
  }
  set_floor(v: number): void {
    this.Floor = v;
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
  get_vx(): number {
    return this.Vx;
  }
  set_vx(v: number): void {
    this.Vx = v;
  }
  get_vy(): number {
    return this.Vy;
  }
  set_vy(v: number): void {
    this.Vy = v;
  }
  get_radius(): number {
    return this.Radius;
  }
  set_radius(v: number): void {
    this.Radius = v;
  }
  get_color(): string {
    return this.Color;
  }
  set_color(v: string): void {
    this.Color = v;
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
  get_speed(): number {
    return this.Speed;
  }
  set_speed(v: number): void {
    this.Speed = v;
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
  get_scoreValue(): number {
    return this.ScoreValue;
  }
  set_scoreValue(v: number): void {
    this.ScoreValue = v;
  }
  get_status(): StatusSet {
    return this.Status;
  }
  set_status(v: StatusSet): void {
    this.Status = v;
  }
  get_shootTimer(): number {
    return this.ShootTimer;
  }
  set_shootTimer(v: number): void {
    this.ShootTimer = v;
  }
  get_stateTimer(): number {
    return this.StateTimer;
  }
  set_stateTimer(v: number): void {
    this.StateTimer = v;
  }
  get_chargeTimer(): number {
    return this.ChargeTimer;
  }
  set_chargeTimer(v: number): void {
    this.ChargeTimer = v;
  }
  get_charging(): boolean {
    return this.Charging;
  }
  set_charging(v: boolean): void {
    this.Charging = v;
  }
  get_chargeAngle(): number {
    return this.ChargeAngle;
  }
  set_chargeAngle(v: number): void {
    this.ChargeAngle = v;
  }
  get_wobblePhase(): number {
    return this.WobblePhase;
  }
  set_wobblePhase(v: number): void {
    this.WobblePhase = v;
  }
  get_spawnTimer(): number {
    return this.SpawnTimer;
  }
  set_spawnTimer(v: number): void {
    this.SpawnTimer = v;
  }
  get_hitFlash(): number {
    return this.HitFlash;
  }
  set_hitFlash(v: number): void {
    this.HitFlash = v;
  }
  get_dead(): boolean {
    return this.Dead;
  }
  set_dead(v: boolean): void {
    this.Dead = v;
  }
  get_angle(): number {
    return this.Angle;
  }
  set_angle(v: number): void {
    this.Angle = v;
  }
  constructor(x: number, y: number, type: string | null = "scarab", floor: unknown = 1) {
    this.Id = -(Enemy._enemyId);
    if (((type !== null) && GameData.Enemies.Has(type))) {
      this.Type = type;
    } else {
      this.Type = "scarab";
    }
    const def = (GameData.Enemies.Get(this.Type) ?? GameData.Enemies.Get("scarab"));
    if ((floor > 0)) {
      this.Floor = floor;
    } else {
      this.Floor = 1;
    }
    this.X = x;
    this.Y = y;
    this.Radius = def.Radius;
    this.Color = def.Color;
    this.MaxHp = ((def.Hp + (def.HpPerFloor * this.Floor)) - 1);
    this.Hp = this.MaxHp;
    this.Speed = def.Speed;
    this.ContactDamage = ((def.Dmg + (def.DmgPerFloor * this.Floor)) - 1);
    this.XpValue = def.Xp;
    this.ScoreValue = def.Score;
    this.Status = null;
    this.ShootTimer = Rng.Shared.range(0.8, 2.6);
    this.WobblePhase = Rng.Shared.angle();
  }
  get_Vulnerable(): boolean {
    return ((this.SpawnTimer <= 0) && !(this.Dead));
  }
  get_vulnerable(): boolean {
    return this.Vulnerable;
  }
  Update(dt: number, target: SnakePlayer, world: World): void {
    if ((!(target) || !(world))) {
      return;
    }
    if ((this.SpawnTimer > 0)) {
      this.SpawnTimer = (this.SpawnTimer - dt);
      return;
    }
    if ((this.HitFlash > 0)) {
      this.HitFlash = Math.max(0, (this.HitFlash - (dt * 6)));
    }
    const burn = this.Status.Update(dt);
    if ((burn > 0)) {
      this.ApplyDamage(burn, false);
    }
    if ((this.Dead !== null)) {
      return;
    }
    if ((this.Status.Immobile !== null)) {
      return;
    }
    if ((this.StasisTimer > 0)) {
      this.StasisTimer = Math.max(0, (this.StasisTimer - dt));
    }
    const stasisMult = (((this.StasisTimer > 0) && 0.2) || 1);
    const speedMult = (((((this.Status.SpeedMult * stasisMult) * world.TimeScale) !== 0) && world.TimeScale) || 1);
    const tx = (target.X ?? target.x);
    const ty = (target.Y ?? target.y);
    const dx = (tx - this.X);
    const dy = (ty - this.Y);
    const dist = MathX.safeLen(dx, dy);
    const ux = (dx / dist);
    const uy = (dy / dist);
    this.Angle = Math.atan2(dy, dx);
    const pad = this.Radius;
    const aw = (world.ArenaW ?? world.arenaW);
    const ah = (world.ArenaH ?? world.arenaH);
    this.X = MathX.clamp(this.X, pad, (aw - pad));
    this.Y = MathX.clamp(this.Y, pad, (ah - pad));
  }
  update(dt: number, target: SnakePlayer, world: World): void {
    this.Update(dt, target, world);
  }
  ApplyDamage(amount: number, showFlash: unknown = true): boolean {
    if ((this.Dead || (this.SpawnTimer > 0))) {
      return false;
    }
    const dmg = (amount * this.Status.DamageTakenMult);
    this.Hp = (this.Hp - dmg);
    if ((showFlash !== null)) {
      this.HitFlash = 1;
    }
    if ((this.Hp <= 0)) {
      this.Hp = 0;
      this.Dead = true;
      return true;
    }
    return false;
  }
  applyDamage(amount: number, showFlash: unknown = true): boolean {
    return this.ApplyDamage(amount, showFlash);
  }
  TakeDamage(amount: number, _source: unknown): number {
    this.SpawnTimer = 0;
    const before = this.Hp;
    this.ApplyDamage(amount, true);
    return (before - this.Hp);
  }
  takeDamage(amount: number, source: unknown): number {
    return this.TakeDamage(amount, source);
  }
}
