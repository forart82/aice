import { MathX } from "../core/MathX.js";
import { Rng } from "../core/Rng.js";
import { HelmetDef, HelmetRarity, HELMET_RARITY_COLORS } from "../data/Helmets.js";

export class HelmetDrop {
  X: number;
  Y: number;
  Vx: number;
  Vy: number;
  Radius = 22;
  Helmet: HelmetDef;
  Rarity: HelmetRarity;
  Color: string;
  Pulse: number;
  SpawnScale = 0;
  Life = 0;
  Dead = false;
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
  get_radius(): number {
    return this.Radius;
  }
  set_radius(v: number): void {
    this.Radius = v;
  }
  get_helmet(): HelmetDef {
    return this.Helmet;
  }
  set_helmet(v: HelmetDef): void {
    this.Helmet = v;
  }
  get_rarity(): HelmetRarity {
    return this.Rarity;
  }
  set_rarity(v: HelmetRarity): void {
    this.Rarity = v;
  }
  get_color(): string {
    return this.Color;
  }
  set_color(v: string): void {
    this.Color = v;
  }
  get_dead(): boolean {
    return this.Dead;
  }
  set_dead(v: boolean): void {
    this.Dead = v;
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
  constructor(x: number, y: number, helmet: HelmetDef) {
    this.X = x;
    this.Y = y;
    this.Helmet = helmet;
    this.Rarity = ((helmet.Rarity || helmet.rarity) || "common".toLowerCase());
    this.Color = (HELMET_RARITY_COLORS[this.Rarity] || "#ffd166");
    this.Vx = Rng.Shared.range(-(35), 35);
    this.Vy = Rng.Shared.range(-(35), 35);
    this.Pulse = Rng.Shared.angle();
  }
  Update(dt: number): void {
    this.Pulse = (this.Pulse + (dt * 3.6));
    this.Life = (this.Life + dt);
    if ((this.SpawnScale < 1)) {
      this.SpawnScale = Math.min(1, (this.SpawnScale + (dt * 4)));
    }
    this.X = (this.X + (this.Vx * dt));
    this.Y = (this.Y + (this.Vy * dt));
    const drag = MathX.decay(0.9, dt);
    this.Vx = (this.Vx * drag);
    this.Vy = (this.Vy * drag);
  }
  update(dt: number): void {
    this.Update(dt);
  }
}
