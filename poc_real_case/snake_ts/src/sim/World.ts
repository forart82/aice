import { SnakePlayer } from "./SnakePlayer.js";
import { FoodItem } from "./FoodItem.js";
import { Enemy } from "./Enemy.js";
import { Projectile } from "./Projectile.js";
import { Hazard } from "./Hazard.js";
import { Boss } from "./Boss.js";
import { GameEngine } from "./GameEngine.js";
import { HelmetDrop } from "./HelmetDrop.js";
import { CombatSystem } from "./CombatSystem.js";

export class World {
  Player: SnakePlayer;
  Foods: FoodItem[] = [];
  Enemies: Enemy[] = [];
  Projectiles: Projectile[] = [];
  Hazards: Hazard[] = [];
  ActiveBosses: Boss[] = [];
  HelmetDrops: HelmetDrop[] = [];
  ArenaW = 960;
  ArenaH = 640;
  TimeScale = 1;
  _vacuumTimer = 0;
  ChronoTimer = 0;
  NearestFood: FoodItem | null = null;
  ChronoScale = 1;
  Game: GameEngine;
  _combat: CombatSystem | null;
  get_Boss(): Boss | null {
    return (this.ActiveBosses[0] || null);
  }
  set_Boss(v: Boss | null): void {
    if ((v !== null)) {
      this.ActiveBosses = [v];
    } else {
      this.ActiveBosses = [];
    }
  }
  get_Bosses(): Boss[] {
    return this.ActiveBosses;
  }
  set_Bosses(v: Boss[]): void {
    this.ActiveBosses = v;
  }
  get_VacuumTimer(): number {
    return this._vacuumTimer;
  }
  set_VacuumTimer(v: number): void {
    this._vacuumTimer = v;
    if ((this.Game !== null)) {
      this.Game.VacuumTimer = v;
    }
  }
  get_player(): SnakePlayer {
    return this.Player;
  }
  set_player(v: SnakePlayer): void {
    this.Player = v;
  }
  get_foods(): FoodItem[] {
    return this.Foods;
  }
  set_foods(v: FoodItem[]): void {
    this.Foods = v;
  }
  get_enemies(): Enemy[] {
    return this.Enemies;
  }
  set_enemies(v: Enemy[]): void {
    this.Enemies = v;
  }
  get_projectiles(): Projectile[] {
    return this.Projectiles;
  }
  set_projectiles(v: Projectile[]): void {
    this.Projectiles = v;
  }
  get_hazards(): Hazard[] {
    return this.Hazards;
  }
  set_hazards(v: Hazard[]): void {
    this.Hazards = v;
  }
  get_boss(): Boss | null {
    return this.Boss;
  }
  set_boss(v: Boss | null): void {
    this.Boss = v;
  }
  get_activeBosses(): Boss[] {
    return this.ActiveBosses;
  }
  set_activeBosses(v: Boss[]): void {
    this.ActiveBosses = v;
  }
  get_bosses(): Boss[] {
    return this.Bosses;
  }
  set_bosses(v: Boss[]): void {
    this.Bosses = v;
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
  get_timeScale(): number {
    return this.TimeScale;
  }
  set_timeScale(v: number): void {
    this.TimeScale = v;
  }
  get_vacuumTimer(): number {
    return this.VacuumTimer;
  }
  set_vacuumTimer(v: number): void {
    this.VacuumTimer = v;
  }
  get_chronoTimer(): number {
    return this.ChronoTimer;
  }
  set_chronoTimer(v: number): void {
    this.ChronoTimer = v;
  }
  get_nearestFood(): FoodItem | null {
    return this.NearestFood;
  }
  set_nearestFood(v: FoodItem | null): void {
    this.NearestFood = v;
  }
  get_chronoScale(): number {
    return this.ChronoScale;
  }
  set_chronoScale(v: number): void {
    this.ChronoScale = v;
  }
  get_game(): GameEngine {
    return this.Game;
  }
  set_game(v: GameEngine): void {
    this.Game = v;
  }
  get_helmetDrops(): HelmetDrop[] {
    return this.HelmetDrops;
  }
  set_helmetDrops(v: HelmetDrop[]): void {
    this.HelmetDrops = v;
  }
  get_combat(): CombatSystem {
    return (this._combat || this.Game?.Combat);
  }
  set_combat(v: CombatSystem): void {
    this._combat = v;
  }
  get_Combat(): CombatSystem {
    return (this._combat || this.Game?.Combat);
  }
  set_Combat(v: CombatSystem): void {
    this._combat = v;
  }
  static getPlayer(w: World | null): SnakePlayer {
    if (!(w)) {
      return null;
    }
    return (w.Player ?? w.player);
  }
  static GetPlayer(w: World | null): SnakePlayer {
    return World.getPlayer(w);
  }
  static getFoods(w: World | null): FoodItem[] {
    if (!(w)) {
      return [];
    }
    return ((w.Foods ?? w.foods) ?? []);
  }
  static GetFoods(w: World | null): FoodItem[] {
    return World.getFoods(w);
  }
  static getEnemies(w: World | null): Enemy[] {
    if (!(w)) {
      return [];
    }
    return ((w.Enemies ?? w.enemies) ?? []);
  }
  static GetEnemies(w: World | null): Enemy[] {
    return World.getEnemies(w);
  }
  static getProjectiles(w: World | null): Projectile[] {
    if (!(w)) {
      return [];
    }
    return ((w.Projectiles ?? w.projectiles) ?? []);
  }
  static GetProjectiles(w: World | null): Projectile[] {
    return World.getProjectiles(w);
  }
  static getHazards(w: World | null): Hazard[] {
    if (!(w)) {
      return [];
    }
    return ((w.Hazards ?? w.hazards) ?? []);
  }
  static GetHazards(w: World | null): Hazard[] {
    return World.getHazards(w);
  }
  static getBosses(w: World | null): Boss[] {
    if (!(w)) {
      return [];
    }
    if (((w.ActiveBosses !== null) && (w.ActiveBosses.length > 0))) {
      return w.ActiveBosses;
    }
    if (((w.activeBosses !== null) && (w.activeBosses.length > 0))) {
      return w.activeBosses;
    }
    if (((w.Bosses !== null) && (w.Bosses.length > 0))) {
      return w.Bosses;
    }
    if (((w.bosses !== null) && (w.bosses.length > 0))) {
      return w.bosses;
    }
    if ((w.Boss !== null)) {
      return [w.Boss];
    }
    if ((w.boss !== null)) {
      return [w.boss];
    }
    return [];
  }
  static GetBosses(w: World | null): Boss[] {
    return World.getBosses(w);
  }
  static getNearestFood(w: World | null): FoodItem | null {
    if (!(w)) {
      return null;
    }
    return ((w.NearestFood ?? w.nearestFood) ?? null);
  }
  static GetNearestFood(w: World | null): FoodItem | null {
    return World.getNearestFood(w);
  }
}
