import { MathX } from "../core/MathX.js";
import { Rng } from "../core/Rng.js";
import { GameData } from "../data/GameData.js";

export class FoodItem {
  X: number;
  Y: number;
  Type: string;
  Color: string;
  XpValue: number;
  ScoreValue: number;
  Radius: number;
  HealAmount: number;
  Vx: number;
  Vy: number;
  Pulse: number;
  SpawnScale: number;
  Life: number;
  Dead: boolean;
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
  get_color(): string {
    return this.Color;
  }
  set_color(v: string): void {
    this.Color = v;
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
  get_radius(): number {
    return this.Radius;
  }
  set_radius(v: number): void {
    this.Radius = v;
  }
  get_healAmount(): number {
    return this.HealAmount;
  }
  set_healAmount(v: number): void {
    this.HealAmount = v;
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
  get_pulse(): number {
    return this.Pulse;
  }
  set_pulse(v: number): void {
    this.Pulse = v;
  }
  get_spawnScale(): number {
    return this.SpawnScale;
  }
  set_spawnScale(v: number): void {
    this.SpawnScale = v;
  }
  get_life(): number {
    return this.Life;
  }
  set_life(v: number): void {
    this.Life = v;
  }
  get_dead(): boolean {
    return this.Dead;
  }
  set_dead(v: boolean): void {
    this.Dead = v;
  }
  constructor(x: number, y: number, type: string) {
    this.X = x;
    this.Y = y;
    if (GameData.Foods.Has(type)) {
      this.Type = type;
    } else {
      this.Type = "apple";
    }
    const def = (GameData.Foods.Get(this.Type) ?? GameData.Foods.Get("apple"));
    this.Color = def.Color;
    this.XpValue = def.Xp;
    this.ScoreValue = def.Score;
    this.Radius = def.Radius;
    this.HealAmount = def.Heal;
    this.Vx = Rng.Shared.range(-(30), 30);
    this.Vy = Rng.Shared.range(-(30), 30);
    this.Pulse = Rng.Shared.angle();
    this.SpawnScale = 0;
    this.Life = 0;
    this.Dead = false;
  }
  Cook(): boolean {
    if ((this.Type !== "apple")) {
      return false;
    }
    this.Type = "golden";
    const def = GameData.Foods.Get("golden");
    this.Color = def.Color;
    this.XpValue = def.Xp;
    this.ScoreValue = def.Score;
    this.Radius = def.Radius;
    return true;
  }
  cook(): boolean {
    return this.Cook();
  }
  Update(dt: number, px: number, py: number, magnetRadius: number, extraPull: number): void {
    this.Pulse = (this.Pulse + (dt * 4.2));
    this.Life = (this.Life + dt);
    if ((this.SpawnScale < 1)) {
      this.SpawnScale = Math.min(1, (this.SpawnScale + (dt * 5)));
    }
    const dx = (px - this.X);
    const dy = (py - this.Y);
    const dist = MathX.safeLen(dx, dy);
    if ((dist < magnetRadius)) {
      const force = (1 - ((dist / magnetRadius) * 620));
      this.Vx = (this.Vx + (((dx / dist) * force) * dt));
      this.Vy = (this.Vy + (((dy / dist) * force) * dt));
    }
    if ((extraPull > 0)) {
      this.Vx = (this.Vx + (((dx / dist) * extraPull) * dt));
      this.Vy = (this.Vy + (((dy / dist) * extraPull) * dt));
    }
    this.X = (this.X + (this.Vx * dt));
    this.Y = (this.Y + (this.Vy * dt));
    const drag = MathX.decay(0.92, dt);
    this.Vx = (this.Vx * drag);
    this.Vy = (this.Vy * drag);
  }
  update(dt: number, px: number, py: number, magnetRadius: number, extraPull: number): void {
    this.Update(dt, px, py, magnetRadius, extraPull);
  }
}
