import { Rng } from "../core/Rng.js";

export interface HazardOpts {
  Radius: number | null;
  Life: number | null;
  Dps: number | null;
  Owner: string | null;
  Telegraph: number | null;
  ImpactDamage: number | null;
  radius: number | null;
  life: number | null;
  dps: number | null;
  owner: string | null;
  telegraph: number | null;
  impactDamage: number | null;
}

export function HazardOpts(Radius: number | null, Life: number | null, Dps: number | null, Owner: string | null, Telegraph: number | null, ImpactDamage: number | null, radius: number | null, life: number | null, dps: number | null, owner: string | null, telegraph: number | null, impactDamage: number | null): HazardOpts {
  return { Radius, Life, Dps, Owner, Telegraph, ImpactDamage, radius, life, dps, owner, telegraph, impactDamage };
}

export class Hazard {
  X: number;
  Y: number;
  Type: string;
  Radius: number;
  MaxLife: number;
  Life: number;
  Dps: number;
  Owner: string;
  Telegraph: number;
  ImpactDamage: number;
  Detonated: boolean;
  Pulse: number;
  Dead: boolean;
  TelegraphMax = 0;
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
  get_type(): string {
    return this.Type;
  }
  set_type(v: string): void {
    this.Type = v;
  }
  get_radius(): number {
    return this.Radius;
  }
  set_radius(v: number): void {
    this.Radius = v;
  }
  get_maxLife(): number {
    return this.MaxLife;
  }
  set_maxLife(v: number): void {
    this.MaxLife = v;
  }
  get_life(): number {
    return this.Life;
  }
  set_life(v: number): void {
    this.Life = v;
  }
  get_dps(): number {
    return this.Dps;
  }
  set_dps(v: number): void {
    this.Dps = v;
  }
  get_owner(): string {
    return this.Owner;
  }
  set_owner(v: string): void {
    this.Owner = v;
  }
  get_telegraph(): number {
    return this.Telegraph;
  }
  set_telegraph(v: number): void {
    this.Telegraph = v;
  }
  get_impactDamage(): number {
    return this.ImpactDamage;
  }
  set_impactDamage(v: number): void {
    this.ImpactDamage = v;
  }
  get_detonated(): boolean {
    return this.Detonated;
  }
  set_detonated(v: boolean): void {
    this.Detonated = v;
  }
  get_pulse(): number {
    return this.Pulse;
  }
  set_pulse(v: number): void {
    this.Pulse = v;
  }
  get_dead(): boolean {
    return this.Dead;
  }
  set_dead(v: boolean): void {
    this.Dead = v;
  }
  get_telegraphMax(): number {
    return this.TelegraphMax;
  }
  set_telegraphMax(v: number): void {
    this.TelegraphMax = v;
  }
  constructor(xOrOpts: int | unknown, y: unknown = 0, type: unknown = "magma", opts: HazardOpts = {}) {
    if (((typeof (xOrOpts) === "object") && (xOrOpts !== null))) {
      const o = xOrOpts;
      this.X = ((o.X ?? o.x) ?? 0);
      this.Y = ((o.Y ?? o.y) ?? 0);
      this.Type = ((o.Type ?? o.type) ?? "magma");
      this.Radius = Hazard.or((o.Radius ?? o.radius), 26);
      this.MaxLife = Hazard.or((o.Life ?? o.life), 3);
      this.Life = this.MaxLife;
      this.Dps = Hazard.or((o.Dps ?? o.dps), 0);
      const ow = (o.Owner ?? o.owner);
      if (((ow !== null) && (ow.length > 0))) {
        this.Owner = ow;
      } else {
        this.Owner = "enemy";
      }
      this.Telegraph = Hazard.or((o.Telegraph ?? o.telegraph), 0);
      this.TelegraphMax = this.Telegraph;
      this.ImpactDamage = Hazard.or((o.ImpactDamage ?? o.impactDamage), 0);
    } else {
      this.X = xOrOpts;
      this.Y = y;
      this.Type = type;
      this.Radius = Hazard.or((opts.Radius ?? opts.radius), 26);
      this.MaxLife = Hazard.or((opts.Life ?? opts.life), 3);
      this.Life = this.MaxLife;
      this.Dps = Hazard.or((opts.Dps ?? opts.dps), 0);
      const ow = (opts.Owner ?? opts.owner);
      if (((ow !== null) && (ow.length > 0))) {
        this.Owner = ow;
      } else {
        this.Owner = "enemy";
      }
      this.Telegraph = Hazard.or((opts.Telegraph ?? opts.telegraph), 0);
      this.TelegraphMax = this.Telegraph;
      this.ImpactDamage = Hazard.or((opts.ImpactDamage ?? opts.impactDamage), 0);
    }
    this.Detonated = false;
    this.Pulse = Rng.Shared.angle();
    this.Dead = false;
  }
  static or(v: number | null, fallback: number): number {
    if (((v !== undefined) && !(Number.isNaN(v)))) {
      return v;
    } else {
      return fallback;
    }
  }
  get_Armed(): boolean {
    return (this.Telegraph <= 0);
  }
  get_armed(): boolean {
    return this.Armed;
  }
  Update(dt: number): void {
    this.Pulse = (this.Pulse + (dt * 5));
    if ((this.Telegraph > 0)) {
      this.Telegraph = (this.Telegraph - dt);
      if ((this.Telegraph <= 0)) {
        this.Telegraph = 0;
      }
      return;
    }
    this.Life = (this.Life - dt);
    if ((this.Life <= 0)) {
      this.Dead = true;
    }
  }
  update(dt: number): void {
    this.Update(dt);
  }
}
