import { MathX } from "../core/MathX.js";
import { Vec2 } from "../core/Vec2.js";

export interface ProjectileOpts {
  Radius: number | null;
  Life: number | null;
  Homing: number | null;
  Pierce: number | null;
  Burn: number | null;
  Chill: number | null;
  Trail: boolean | null;
  Wobble: number | null;
  radius: number | null;
  life: number | null;
  homing: number | null;
  pierce: number | null;
  burn: number | null;
  chill: number | null;
  trail: boolean | null;
  wobble: number | null;
}

export function ProjectileOpts(Radius: number | null, Life: number | null, Homing: number | null, Pierce: number | null, Burn: number | null, Chill: number | null, Trail: boolean | null, Wobble: number | null, radius: number | null, life: number | null, homing: number | null, pierce: number | null, burn: number | null, chill: number | null, trail: boolean | null, wobble: number | null): ProjectileOpts {
  return { Radius, Life, Homing, Pierce, Burn, Chill, Trail, Wobble, radius, life, homing, pierce, burn, chill, trail, wobble };
}

export class Projectile {
  static _projectileId = 0;
  static readonly BossHitId = -(1);
  static readonly bossHitId = -(1);
  Id: number;
  X: number;
  Y: number;
  Angle: number;
  Speed: number;
  Vx: number;
  Vy: number;
  Damage: number;
  Source: string;
  Radius: number;
  Color: string;
  Life: number;
  MaxLife: number;
  Homing: number;
  Pierce: number;
  Burn: number;
  Chill: number;
  Trail: boolean;
  Wobble: number;
  Dead: boolean;
  HitIds: Set<number> | null = null;
  get_id(): number {
    return this.Id;
  }
  set_id(v: number): void {
    this.Id = v;
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
  get_speed(): number {
    return this.Speed;
  }
  set_speed(v: number): void {
    this.Speed = v;
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
  get_damage(): number {
    return this.Damage;
  }
  set_damage(v: number): void {
    this.Damage = v;
  }
  get_source(): string {
    return this.Source;
  }
  set_source(v: string): void {
    this.Source = v;
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
  get_life(): number {
    return this.Life;
  }
  set_life(v: number): void {
    this.Life = v;
  }
  get_maxLife(): number {
    return this.MaxLife;
  }
  set_maxLife(v: number): void {
    this.MaxLife = v;
  }
  get_homing(): number {
    return this.Homing;
  }
  set_homing(v: number): void {
    this.Homing = v;
  }
  get_pierce(): number {
    return this.Pierce;
  }
  set_pierce(v: number): void {
    this.Pierce = v;
  }
  get_burn(): number {
    return this.Burn;
  }
  set_burn(v: number): void {
    this.Burn = v;
  }
  get_chill(): number {
    return this.Chill;
  }
  set_chill(v: number): void {
    this.Chill = v;
  }
  get_trail(): boolean {
    return this.Trail;
  }
  set_trail(v: boolean): void {
    this.Trail = v;
  }
  get_wobble(): number {
    return this.Wobble;
  }
  set_wobble(v: number): void {
    this.Wobble = v;
  }
  get_dead(): boolean {
    return this.Dead;
  }
  set_dead(v: boolean): void {
    this.Dead = v;
  }
  get_hitIds(): Set<number> | null {
    return this.HitIds;
  }
  set_hitIds(v: Set<number> | null): void {
    this.HitIds = v;
  }
  constructor(xOrOpts: int | unknown, y: unknown = 0, angle: unknown = 0, speed: unknown = 0, damage: unknown = 0, source: unknown = "player", color: string, opts: ProjectileOpts = {}) {
    this.Id = -(Projectile._projectileId);
    if (((typeof (xOrOpts) === "object") && (xOrOpts !== null))) {
      const o = xOrOpts;
      this.X = ((o.X ?? o.x) ?? 0);
      this.Y = ((o.Y ?? o.y) ?? 0);
      const spd = ((((((o.Speed ?? o.speed) ?? (o.Vx !== undefined)) && (o.Vy !== undefined)) && MathX.hypot(o.Vx, o.Vy)) || (((o.vx !== undefined) && (o.vy !== undefined)) && MathX.hypot(o.vx, o.vy))) || 0);
      this.Speed = spd;
      const ang = ((((((o.Angle ?? o.angle) ?? (o.Vx !== undefined)) && (o.Vy !== undefined)) && Math.atan2(o.Vy, o.Vx)) || (((o.vx !== undefined) && (o.vy !== undefined)) && Math.atan2(o.vy, o.vx))) || 0);
      this.Angle = ang;
      this.Vx = ((o.Vx ?? o.vx) ?? (Math.cos(this.Angle) * this.Speed));
      this.Vy = ((o.Vy ?? o.vy) ?? (Math.sin(this.Angle) * this.Speed));
      this.Damage = ((o.Damage ?? o.damage) ?? 0);
      if ((o.Source ?? (o.source === "player"))) {
        this.Source = "player";
      } else {
        this.Source = "enemy";
      }
      this.Radius = Projectile.or((o.Radius ?? o.radius), (((this.Source === "player") && 5) || 6));
      this.Color = (((o.Color ?? o.color) || ((this.Source === "player") && "#00f0b5")) || "#ff0054");
      this.Life = Projectile.or((o.Life ?? o.life), 4);
      this.MaxLife = this.Life;
      this.Homing = Projectile.or((o.Homing ?? o.homing), 0);
      this.Pierce = Projectile.or((o.Pierce ?? o.pierce), 0);
      this.Burn = Projectile.or((o.Burn ?? o.burn), 0);
      this.Chill = Projectile.or((o.Chill ?? o.chill), 0);
      const tr = (o.Trail ?? o.trail);
      this.Trail = (tr !== false);
      this.Wobble = Projectile.or((o.Wobble ?? o.wobble), 0);
    } else {
      this.X = xOrOpts;
      this.Y = y;
      this.Angle = angle;
      this.Speed = speed;
      this.Vx = (Math.cos(angle) * speed);
      this.Vy = (Math.sin(angle) * speed);
      this.Damage = damage;
      if ((source === "player")) {
        this.Source = "player";
      } else {
        this.Source = "enemy";
      }
      this.Radius = Projectile.or((opts.Radius ?? opts.radius), (((this.Source === "player") && 5) || 6));
      if (((color !== null) && (color.length > 0))) {
        this.Color = color;
      } else if ((this.Source === "player")) {
        this.Color = "#00f0b5";
      }
      this.Life = Projectile.or((opts.Life ?? opts.life), 4);
      this.MaxLife = this.Life;
      this.Homing = Projectile.or((opts.Homing ?? opts.homing), 0);
      this.Pierce = Projectile.or((opts.Pierce ?? opts.pierce), 0);
      this.Burn = Projectile.or((opts.Burn ?? opts.burn), 0);
      this.Chill = Projectile.or((opts.Chill ?? opts.chill), 0);
      const tr = (opts.Trail ?? opts.trail);
      this.Trail = (tr !== false);
      this.Wobble = Projectile.or((opts.Wobble ?? opts.wobble), 0);
    }
    this.Dead = false;
    this.HitIds = null;
  }
  static or(v: number | null, fallback: number): number {
    if (((v !== undefined) && !(Number.isNaN(v)))) {
      return v;
    } else {
      return fallback;
    }
  }
  Update(dt: number, target: Vec2 | null): void {
    if (((this.Homing > 0) && target)) {
      const tx = (target.X ?? target.x);
      const ty = (target.Y ?? target.y);
      if (((((typeof (tx) === "number") && (typeof (ty) === "number")) && Number.isFinite(tx)) && Number.isFinite(ty))) {
        const desired = Math.atan2((ty - this.Y), (tx - this.X));
        this.Angle = (this.Angle + MathX.clamp(MathX.angleDelta(this.Angle, desired), (-(this.Homing) * dt), (this.Homing * dt)));
        this.Vx = (Math.cos(this.Angle) * this.Speed);
        this.Vy = (Math.sin(this.Angle) * this.Speed);
      }
    }
    if ((this.Wobble > 0)) {
      const off = (Math.sin((this.MaxLife - (this.Life * 12))) * this.Wobble);
      this.X = (this.X + ((Math.cos((this.Angle + (Math.PI / 2))) * off) * dt));
      this.Y = (this.Y + ((Math.sin((this.Angle + (Math.PI / 2))) * off) * dt));
    }
    this.X = (this.X + (this.Vx * dt));
    this.Y = (this.Y + (this.Vy * dt));
    this.Life = (this.Life - dt);
    if ((this.Life <= 0)) {
      this.Dead = true;
    }
  }
  update(dt: number, target: Vec2 | null): void {
    this.Update(dt, target);
  }
}
