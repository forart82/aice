import { Rng } from "../core/Rng.js";
import { MathX } from "../core/MathX.js";
import { Vec2 } from "../core/Vec2.js";
import { Services, IServiceContainer } from "../core/Services.js";
import { GameData } from "../data/GameData.js";
import { MetaProgression } from "../data/MetaProgression.js";
import { FoodItem } from "./FoodItem";
import { Hazard } from "./Hazard";
import { Projectile } from "./Projectile";
import { Afterimage, SnakePlayer } from "./SnakePlayer";
import { SegmentSpatialGrid, SpatialLayerMask } from "./SpatialHashGrid";
import { executeHeadModules } from "./CombatModules";
import { updateAuras, updateRelicAttacks } from "./CombatAuras";
import { activateSkill, skillVerdantBloom, skillUmbralBlink, skillTitanRoar, skillChainStorm, skillSupernova } from "./CombatSkills";
import { Enemy } from "./Enemy";
import { Boss } from "./Boss";
import { World } from "./World";
import { GameEngine } from "./GameEngine";

export function getActiveBosses(world: World | null): Boss[] {
  return World.getBosses(world);
}

export interface BurnSpec {
  time: number | null;
  dps: number | null;
  Time: number | null;
  Dps: number | null;
}

export function BurnSpec(time: number | null, dps: number | null, Time: number | null, Dps: number | null): BurnSpec {
  return { time, dps, Time, Dps };
}

export interface ChillSpec {
  time: number | null;
  factor: number | null;
  Time: number | null;
  Factor: number | null;
}

export function ChillSpec(time: number | null, factor: number | null, Time: number | null, Factor: number | null): ChillSpec {
  return { time, factor, Time, Factor };
}

export interface DamageOpts {
  crit: boolean | null;
  Crit: boolean | null;
  silent: boolean | null;
  Silent: boolean | null;
  color: string | null;
  Color: string | null;
  burn: BurnSpec | null;
  Burn: BurnSpec | null;
  chill: ChillSpec | null;
  Chill: ChillSpec | null;
  freeze: number | null;
  Freeze: number | null;
  stun: number | null;
  Stun: number | null;
}

export function DamageOpts(crit: boolean | null, Crit: boolean | null, silent: boolean | null, Silent: boolean | null, color: string | null, Color: string | null, burn: BurnSpec | null, Burn: BurnSpec | null, chill: ChillSpec | null, Chill: ChillSpec | null, freeze: number | null, Freeze: number | null, stun: number | null, Stun: number | null): DamageOpts {
  return { crit, Crit, silent, Silent, color, Color, burn, Burn, chill, Chill, freeze, Freeze, stun, Stun };
}

export interface BiteRoll {
  damage: number;
  crit: boolean;
  Damage: number | null;
  Crit: boolean | null;
}

export function BiteRoll(damage: number, crit: boolean, Damage: number | null, Crit: boolean | null): BiteRoll {
  return { damage, crit, Damage, Crit };
}

export interface HostileTarget {
  Found: boolean;
  IsBoss: boolean;
  Enemy: Enemy | null;
  X: number;
  Y: number;
  found: boolean;
  isBoss: boolean;
  enemy: Enemy | null;
  x: number;
  y: number;
}

export function HostileTarget(Found: boolean, IsBoss: boolean, Enemy: Enemy | null, X: number, Y: number, found: boolean, isBoss: boolean, enemy: Enemy | null, x: number, y: number): HostileTarget {
  return { Found, IsBoss, Enemy, X, Y, found, isBoss, enemy, x, y };
}

export class CombatSystem {
  comboCount = 0;
  comboMultiplier = 1;
  comboTimer = 0;
  meta: MetaProgression | null;
  services: IServiceContainer | null;
  engine: GameEngine | null;
  comboBaseWindow = 4;
  comboMaxTime = 4;
  frenzyActive = false;
  frenzyTimer = 0;
  frenzyMaxDuration = 8;
  score = 0;
  shardsEarned = 0;
  kills = 0;
  bossKills = 0;
  DefeatedBossTypes: string[] = [];
  BossKillsByType: Record<string, number> = {};
  KillsByType: Record<string, number> = {};
  FoodsEatenByType: Record<string, number> = {};
  foodsEaten = 0;
  highestRunCombo = 0;
  ClutchCatchCount = 0;
  TotalClutchBonusScore = 0;
  damageDealt = 0;
  runTime = 0;
  flameTimer = 0;
  thunderTimer = 0;
  frenzySparkTimer = 0;
  staticCoilCounter = 0;
  biteCooldowns: Map<string, number> = new Map();
  _staleBiteKeys: string[] = [];
  timeScale = 1;
  biteInterval = GameData.BiteInterval;
  static readonly BossHitId = -(1);
  static readonly BossKey = "boss";
  static readonly BossTailKey = "boss-tail";
  _segmentGrid: SegmentSpatialGrid = SegmentSpatialGrid();
  _polyX: Float64Array = new Float64Array(2048);
  _polyY: Float64Array = new Float64Array(2048);
  _homingTarget: Vec2 = Vec2(0, 0);
  _gridBuiltThisTick = false;
  _lastGridSegCount = -(1);
  _scratchSegBuffer = new Int32Array(128);
  readonly _cachedHostileTarget: HostileTarget = { found: false, isBoss: false, enemy: null, x: 0, y: 0, Found: false, IsBoss: false, Enemy: null, X: 0, Y: 0 };
  readonly _cachedBiteRoll: BiteRoll = { damage: 0, crit: false, Damage: 0, Crit: false };
  _lastSelfHitFxTime: number = 0;
  _constrictionCooldown = 0;
  get ComboCount(): number {
    return this.comboCount;
  }
  set ComboCount(v: number) {
    this.comboCount = v;
  }
  get ComboMultiplier(): number {
    return this.comboMultiplier;
  }
  set ComboMultiplier(v: number) {
    this.comboMultiplier = v;
  }
  get ComboTimer(): number {
    return this.comboTimer;
  }
  set ComboTimer(v: number) {
    this.comboTimer = v;
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
  get Engine(): GameEngine | null {
    return this.engine;
  }
  set Engine(v: GameEngine | null) {
    this.engine = v;
  }
  get ComboBaseWindow(): number {
    return this.comboBaseWindow;
  }
  set ComboBaseWindow(v: number) {
    this.comboBaseWindow = v;
  }
  get ComboMaxTime(): number {
    return this.comboMaxTime;
  }
  set ComboMaxTime(v: number) {
    this.comboMaxTime = v;
  }
  get FrenzyActive(): boolean {
    return this.frenzyActive;
  }
  set FrenzyActive(v: boolean) {
    this.frenzyActive = v;
  }
  get FrenzyTimer(): number {
    return this.frenzyTimer;
  }
  set FrenzyTimer(v: number) {
    this.frenzyTimer = v;
  }
  get FrenzyMaxDuration(): number {
    return this.frenzyMaxDuration;
  }
  set FrenzyMaxDuration(v: number) {
    this.frenzyMaxDuration = v;
  }
  get Score(): number {
    return this.score;
  }
  set Score(v: number) {
    this.score = v;
  }
  get ShardsEarned(): number {
    return this.shardsEarned;
  }
  set ShardsEarned(v: number) {
    this.shardsEarned = v;
  }
  get Kills(): number {
    return this.kills;
  }
  set Kills(v: number) {
    this.kills = v;
  }
  get BossKills(): number {
    return this.bossKills;
  }
  set BossKills(v: number) {
    this.bossKills = v;
  }
  get defeatedBossTypes(): string[] {
    return this.DefeatedBossTypes;
  }
  set defeatedBossTypes(v: string[]) {
    this.DefeatedBossTypes = v;
  }
  get bossKillsByType(): Record<string, number> {
    return this.BossKillsByType;
  }
  set bossKillsByType(v: Record<string, number>) {
    this.BossKillsByType = v;
  }
  get killsByType(): Record<string, number> {
    return this.KillsByType;
  }
  set killsByType(v: Record<string, number>) {
    this.KillsByType = v;
  }
  get foodsEatenByType(): Record<string, number> {
    return this.FoodsEatenByType;
  }
  set foodsEatenByType(v: Record<string, number>) {
    this.FoodsEatenByType = v;
  }
  get FoodsEaten(): number {
    return this.foodsEaten;
  }
  set FoodsEaten(v: number) {
    this.foodsEaten = v;
  }
  get HighestRunCombo(): number {
    return this.highestRunCombo;
  }
  set HighestRunCombo(v: number) {
    this.highestRunCombo = v;
  }
  get highestCombo(): number {
    return this.highestRunCombo;
  }
  set highestCombo(v: number) {
    this.highestRunCombo = v;
  }
  get floorShardsEarned(): number {
    return this.shardsEarned;
  }
  set floorShardsEarned(v: number) {
    this.shardsEarned = v;
  }
  get clutchCatchCount(): number {
    return this.ClutchCatchCount;
  }
  set clutchCatchCount(v: number) {
    this.ClutchCatchCount = v;
  }
  get totalClutchBonusScore(): number {
    return this.TotalClutchBonusScore;
  }
  set totalClutchBonusScore(v: number) {
    this.TotalClutchBonusScore = v;
  }
  get DamageDealt(): number {
    return this.damageDealt;
  }
  set DamageDealt(v: number) {
    this.damageDealt = v;
  }
  get RunTime(): number {
    return this.runTime;
  }
  set RunTime(v: number) {
    this.runTime = v;
  }
  get FlameTimer(): number {
    return this.flameTimer;
  }
  set FlameTimer(v: number) {
    this.flameTimer = v;
  }
  get ThunderTimer(): number {
    return this.thunderTimer;
  }
  set ThunderTimer(v: number) {
    this.thunderTimer = v;
  }
  get FrenzySparkTimer(): number {
    return this.frenzySparkTimer;
  }
  set FrenzySparkTimer(v: number) {
    this.frenzySparkTimer = v;
  }
  get StaticCoilCounter(): number {
    return this.staticCoilCounter;
  }
  set StaticCoilCounter(v: number) {
    this.staticCoilCounter = v;
  }
  get BiteCooldowns(): Map<string, number> {
    return this.biteCooldowns;
  }
  get TimeScale(): number {
    return this.timeScale;
  }
  set TimeScale(v: number) {
    this.timeScale = v;
  }
  get BiteInterval(): number {
    return this.biteInterval;
  }
  set BiteInterval(v: number) {
    this.biteInterval = v;
  }
  _ensurePolyCapacity(capacity: number): void {
    if ((capacity > this._polyX.length)) {
      const nextCap = Math.max((capacity * 2), (this._polyX.length * 2));
      this._polyX = new Float64Array(nextCap);
      this._polyY = new Float64Array(nextCap);
    }
  }
  constructor() {
    return this.reset();
  }
  reset(): void {
    this.comboCount = 0;
    this.comboMultiplier = 1;
    this.comboTimer = 0;
    this.comboBaseWindow = 4;
    this.comboMaxTime = 4;
    this.frenzyActive = false;
    this.frenzyTimer = 0;
    this.frenzyMaxDuration = 8;
    this.score = 0;
    this.shardsEarned = 0;
    this.kills = 0;
    this.bossKills = 0;
    this.foodsEaten = 0;
    this.highestRunCombo = 0;
    this.clutchCatchCount = 0;
    this.totalClutchBonusScore = 0;
    this.damageDealt = 0;
    this.runTime = 0;
    this.DefeatedBossTypes = [];
    this.BossKillsByType = {};
    this.KillsByType = {};
    this.FoodsEatenByType = {};
    this.flameTimer = 0;
    this.thunderTimer = 0;
    this.frenzySparkTimer = 0;
    this.staticCoilCounter = 0;
    this.biteCooldowns.clear();
    this.timeScale = 1;
    this.biteInterval = GameData.BiteInterval;
    this._gridBuiltThisTick = false;
    this._lastGridSegCount = -(1);
    this._segmentGrid.clear();
    Services.sound.setFrenzyState(false);
  }
  Reset(): void {
    this.reset();
  }
  ensureGrid(world: World, force: unknown = false): void {
    const player = ((((world !== null) && world.player) || world.Player) || null);
    if ((player !== null)) {
      const segs = (player.segments || player.Segments);
      if (((segs !== null) && (segs.length > 0))) {
        if (((!(force) && this._gridBuiltThisTick) && (segs.length === this._lastGridSegCount))) {
          return;
        }
        this._gridBuiltThisTick = true;
        this._lastGridSegCount = segs.length;
        this._segmentGrid.insertSegments(segs);
        return;
      }
    }
    this._gridBuiltThisTick = false;
    this._lastGridSegCount = -(1);
    this._segmentGrid.clear();
  }
  resolveBites(dt: number, world: World): void {
    this.resolveEnemies(dt, world);
    this.resolveBoss(dt, world);
  }
  ResolveBites(dt: number, world: World): void {
    this.resolveBites(dt, world);
  }
  update(dt: number, world: World): void {
    const player = (world.player || world.Player);
    this.runTime = (this.runTime + dt);
    this._gridBuiltThisTick = false;
    this.ensureGrid(world);
    const ts = (world.timeScale || world.TimeScale);
    if (((ts !== 0) && !(Number.isNaN(ts)))) {
      this.timeScale = ts;
    } else {
      this.timeScale = 1;
    }
    this.updateCombo(dt, player);
    this.updateFrenzy(dt, player);
    this.updateAuras(dt, world);
    this.updateRelicAttacks(dt, world);
    this.updateSegmentModules(dt, world);
    this.updateHazards(dt, world);
    this.updateProjectiles(dt, world);
    this.resolveFood(world);
    this.resolveEnemies(dt, world);
    this.resolveBoss(dt, world);
    this.resolveSelfCollision(world);
    this.checkConstriction(world);
    if ((((player !== null) && player.pendingRevive) || player.PendingRevive)) {
      player.pendingRevive = false;
      player.PendingRevive = false;
      this.phoenixNova(world);
    }
  }
  Update(dt: number, world: World): void {
    this.update(dt, world);
  }
  dilationScale(player: SnakePlayer): number {
    const relics = ((player.relics || player.Relics) || {});
    const stats = (player.stats || player.Stats);
    const hp = (player.hp ?? player.Hp);
    const maxHp = (stats.maxHp ?? stats.MaxHp);
    if ((relics["timeDilation"] || ((0 > 0) && (hp < (maxHp * 0.3))))) {
      return 0.55;
    } else {
      return 1;
    }
  }
  DilationScale(player: SnakePlayer): number {
    return this.dilationScale(player);
  }
  updateCombo(dt: number, player: SnakePlayer): void {
    if ((this.comboTimer > 0)) {
      this.comboTimer = (this.comboTimer - dt);
      if ((this.comboTimer <= 0)) {
        this.breakCombo(player);
      }
    }
  }
  UpdateCombo(dt: number, player: SnakePlayer): void {
    this.updateCombo(dt, player);
  }
  updateFrenzy(dt: number, player: SnakePlayer): void {
    if (!(this.frenzyActive)) {
      return;
    }
    this.frenzyTimer = (this.frenzyTimer - dt);
    this.frenzySparkTimer = (this.frenzySparkTimer + dt);
    if ((this.frenzySparkTimer >= 0.06)) {
      this.frenzySparkTimer = 0;
      const px = (player.x ?? player.X);
      const py = (player.y ?? player.Y);
      Services.fx.burst(px, py, "#ff0054", 3, 3, 3);
    }
    if ((this.frenzyTimer <= 0)) {
      this.frenzyActive = false;
      Services.sound.setFrenzyState(false);
      const px = (player.x ?? player.X);
      const py = (player.y ?? player.Y);
      Services.fx.addText(px, (py - 34), "FRENZY ENDED", "#94a3b8", 14);
    }
  }
  UpdateFrenzy(dt: number, player: SnakePlayer): void {
    this.updateFrenzy(dt, player);
  }
  incrementCombo(player: SnakePlayer, world: World): void {
    this.comboCount = (this.comboCount + 1);
    if ((this.comboCount > this.highestRunCombo)) {
      this.highestRunCombo = this.comboCount;
    }
    this.comboMultiplier = 1;
    for (const tier of GameData.ComboTiers) {
      if ((this.comboCount >= tier.at)) {
        this.comboMultiplier = tier.mult;
      }
    }
    const stats = (player.stats || player.Stats);
    const comboWin = ((stats.comboWindow ?? stats.ComboWindow) ?? 1);
    const shrink = Math.min(1.9, (this.comboCount * 0.045));
    this.comboMaxTime = Math.max(1.9, (this.comboBaseWindow - (shrink * comboWin)));
    this.comboTimer = this.comboMaxTime;
    const classId = (player.classId || player.ClassId);
    const px = (player.x ?? player.X);
    const py = (player.y ?? player.Y);
    const dmgBonus = ((player.damageBonus ?? player.DamageBonus) ?? 1);
    const lvl = ((player.level ?? player.Level) ?? 1);
    if ((classId === "storm")) {
      this.staticCoilCounter = (this.staticCoilCounter + 1);
      if ((this.staticCoilCounter >= 5)) {
        this.staticCoilCounter = 0;
        this.chainLightning(world, px, py, 3, (46 + ((lvl * 4) * dmgBonus)), 240, false);
      }
    }
    const relics = ((player.relics || player.Relics) || {});
    if ((relics["devourer"] || (0 > 0))) {
      player.devourerCounter = ((player.devourerCounter ?? player.DevourerCounter) ?? (0 + 1));
      player.DevourerCounter = player.devourerCounter;
      if ((player.devourerCounter >= 5)) {
        player.devourerCounter = 0;
        player.DevourerCounter = 0;
        stats.maxHp = ((stats.maxHp ?? stats.MaxHp) ?? (100 + 10));
        stats.MaxHp = stats.maxHp;
        player.heal(10);
        player.devourerStacks = (player.devourerStacks ?? (0 + 1));
        player.damageBonus = (1 + (player.devourerStacks * 0.05));
        player.DamageBonus = player.damageBonus;
        Services.fx.addText(px, (py - 46), "👑 DEVOURED", "#ffd166", 16, true);
      }
    }
    const frenzyThreshold = ((relics["overdrive"] || ((0 > 0) && 8)) || 10);
    if (((this.comboCount >= frenzyThreshold) && !(this.frenzyActive))) {
      this.frenzyActive = true;
      this.frenzyTimer = ((this.frenzyMaxDuration + relics["overdrive"]) || (0 * 4));
      Services.sound.setFrenzyState(true);
      Services.sound.playFrenzy();
      Services.fx.addText(px, (py - 52), "⚡ HYPER FRENZY ⚡", "#ff0054", 24, true);
      Services.fx.ringShockwave(px, py, "#ff0054", 72, 0.035);
      Services.fx.flash("#ff0054", 0.22, 0.25);
      if ((world.game !== null)) {
        world.game.banner("⚡ HYPER FRENZY OVERDRIVE ⚡", 1.4);
      }
    } else if ((this.frenzyActive !== null)) {
      this.frenzyTimer = Math.min((this.frenzyTimer + 0.35), ((this.frenzyMaxDuration + relics["overdrive"]) || (0 * 4)));
    }
    if ((this.comboCount === 5)) {
      Services.fx.addText(px, (py - 30), "🔥 5x STREAK", "#ffb703", 16);
    } else if ((this.comboCount === 15)) {
      Services.fx.addText(px, (py - 30), "⚡ 15x MEGA", "#00f0b5", 18, true);
    }
  }
  IncrementCombo(player: SnakePlayer, world: World): void {
    this.incrementCombo(player, world);
  }
  breakCombo(player: SnakePlayer | null): void {
    if (((this.comboCount >= 5) && player)) {
      const px = (player.x ?? player.X);
      const py = (player.y ?? player.Y);
      Services.fx.addText(px, (py - 40), "COMBO LOST", "#64748b", 15);
    }
    this.comboCount = 0;
    this.comboMultiplier = 1;
    this.comboTimer = 0;
    this.staticCoilCounter = 0;
  }
  BreakCombo(player: SnakePlayer | null): void {
    this.breakCombo(player);
  }
  static enemyKey(id: number): string {
    return String(id);
  }
  canBite(key: string): boolean {
    const next = (this.biteCooldowns.at(key) ?? null);
    return ((next === undefined) || (next <= this.runTime));
  }
  CanBite(key: string): boolean {
    return this.canBite(key);
  }
  markBite(key: string): void {
    this.biteCooldowns.set(key, (this.runTime + this.biteInterval));
    if ((this.biteCooldowns.size > 64)) {
      this._staleBiteKeys.length = 0;
      for (const [k, v] of this.biteCooldowns.entries()) {
        if ((v <= this.runTime)) {
          this._staleBiteKeys.push(k);
        }
      }
    }
  }
  MarkBite(key: string): void {
    this.markBite(key);
  }
  rollBite(player: SnakePlayer, multiplier: unknown = 1): BiteRoll {
    const stats = (player.stats || player.Stats);
    const critChance = ((stats.critChance ?? stats.CritChance) ?? 0.05);
    const critMult = ((stats.critMult ?? stats.CritMult) ?? 1.5);
    const power = (player.bitePower ?? player.BitePower);
    const crit = (Rng.Shared.rand() < critChance);
    let dmg = ((((power * multiplier) !== 0) && multiplier) || 1);
    if ((crit !== null)) {
      dmg = (dmg * critMult);
    }
    if ((this.frenzyActive !== null)) {
      dmg = (dmg * 2);
    }
    return { damage: dmg, crit, Damage: dmg, Crit: crit };
  }
  RollBite(player: SnakePlayer, multiplier: unknown = 1): BiteRoll {
    return this.rollBite(player, multiplier);
  }
  damageEnemy(enemy: Enemy | null, amount: number, world: World, opts: DamageOpts = {}): boolean {
    if ((((!(enemy) || enemy.dead) || enemy.Dead) || (!(enemy.vulnerable) && !(enemy.Vulnerable)))) {
      return false;
    }
    const isCrit = ((opts.crit ?? opts.Crit) ?? false);
    const isSilent = ((opts.silent ?? opts.Silent) ?? false);
    const col = ((opts.color ?? opts.Color) ?? "#ffffff");
    const burn = (opts.burn ?? opts.Burn);
    const chill = (opts.chill ?? opts.Chill);
    const freeze = (opts.freeze ?? opts.Freeze);
    const stun = (opts.stun ?? opts.Stun);
    const killed = (((enemy.applyDamage !== null) && enemy.applyDamage(amount)) || enemy.ApplyDamage(amount));
    this.damageDealt = (this.damageDealt + amount);
    const ex = (enemy.x ?? enemy.X);
    const ey = (enemy.y ?? enemy.Y);
    const er = (enemy.radius ?? enemy.Radius);
    if (!(isSilent)) {
      Services.fx.addText(ex, ((ey - er) - 8), (((MathX.roundJs(amount) + isCrit) && " CRIT!") || ""), (((isCrit !== null) && "#ffb703") || col), (((isCrit !== null) && 18) || 14), isCrit);
      if ((isCrit !== null)) {
        Services.sound.playCrit();
      }
    }
    const st = (enemy.status || enemy.Status);
    if ((burn !== null)) {
      st.burn(((burn.time ?? burn.Time) ?? 1), ((burn.dps ?? burn.Dps) ?? 10));
    }
    if ((chill !== null)) {
      st.chill(((chill.time ?? chill.Time) ?? 1), ((chill.factor ?? chill.Factor) ?? 0.5));
    }
    if ((freeze !== null)) {
      st.freeze(freeze);
    }
    if ((stun !== null)) {
      st.stun(stun);
    }
    if ((killed !== null)) {
      this.handleEnemyKill(enemy, world);
    }
    return killed;
  }
  DamageEnemy(enemy: Enemy | null, amount: number, world: World, opts: DamageOpts = {}): boolean {
    return this.damageEnemy(enemy, amount, world, opts);
  }
  damageBoss(boss: Boss | null, amount: number, world: World, opts: DamageOpts = {}): boolean {
    if ((!(boss) || (!(boss.vulnerable) && !(boss.Vulnerable)))) {
      return false;
    }
    const wasPhase = (boss.phase ?? boss.Phase);
    const isCrit = ((opts.crit ?? opts.Crit) ?? false);
    const isSilent = ((opts.silent ?? opts.Silent) ?? false);
    const burn = (opts.burn ?? opts.Burn);
    const chill = (opts.chill ?? opts.Chill);
    const killed = (((boss.applyDamage !== null) && boss.applyDamage(amount)) || boss.ApplyDamage(amount));
    this.damageDealt = (this.damageDealt + amount);
    const bx = (boss.x ?? boss.X);
    const by = (boss.y ?? boss.Y);
    const br = (boss.radius ?? boss.Radius);
    if (!(isSilent)) {
      Services.fx.addText(bx, ((by - br) - 12), (((MathX.roundJs(amount) + isCrit) && " CRIT!") || ""), (((isCrit !== null) && "#ffb703") || "#ffe08a"), (((isCrit !== null) && 19) || 15), true);
      if ((isCrit !== null)) {
        Services.sound.playCrit();
      }
    }
    const st = (boss.status || boss.Status);
    if ((burn !== null)) {
      st.burn(((burn.time ?? burn.Time) ?? 1), ((burn.dps ?? burn.Dps) ?? 10));
    }
    if ((chill !== null)) {
      st.chill(((chill.time ?? chill.Time) ?? 1), ((chill.factor ?? chill.Factor) ?? 0.5));
    }
    const curPhase = (boss.phase ?? boss.Phase);
    if (((curPhase === 2) && (wasPhase === 1))) {
      Services.fx.ringShockwave(bx, by, "#ff0054", 90, 0.02);
      Services.fx.flash("#ff0054", 0.25, 0.3);
      Services.sound.playBossAlert();
      const bname = (boss.name || boss.Name);
      if ((world.game !== null)) {
        world.game.banner((bname + " — PHASE 2"), 1.6);
      }
    }
    return killed;
  }
  DamageBoss(boss: Boss | null, amount: number, world: World, opts: DamageOpts = {}): boolean {
    return this.damageBoss(boss, amount, world, opts);
  }
  handleEnemyKill(enemy: Enemy, world: World): void {
    if ((enemy._killHandled !== null)) {
      return;
    }
    enemy._killHandled = true;
    const player = (world.player || world.Player);
    this.kills = (this.kills + 1);
    const ekey = (((enemy.type || enemy.key) || enemy.Key) || "swarmling");
    this.KillsByType[ekey] = (this.KillsByType[ekey] || (0 + 1));
    const scoreVal = (enemy.scoreValue ?? enemy.ScoreValue);
    this.score = (this.score + MathX.roundJs((scoreVal * this.comboMultiplier)));
    const ex = (enemy.x ?? enemy.X);
    const ey = (enemy.y ?? enemy.Y);
    const ecol = (enemy.color || enemy.Color);
    const expVal = (enemy.xpValue ?? enemy.XpValue);
    const isSwarmling = (((ekey === "swarmling") || (enemy.color === "#fb7185")) || (enemy.Color === "#fb7185"));
    if ((isSwarmling !== null)) {
      Services.sound.playEat(this.comboCount, false);
      Services.fx.burst(ex, ey, ecol, 14, 4, 3);
    } else {
      Services.sound.playExplosion(0.55);
      const enemyR = ((enemy.radius ?? enemy.Radius) ?? 16);
      if ((typeof (Services.fx.explosion) === "function")) {
        Services.fx.explosion(ex, ey, ecol, (enemyR * 1.5), 1);
      } else if ((typeof (Services.fx.Explosion) === "function")) {
        Services.fx.Explosion(ex, ey, ecol, (enemyR * 1.5), 1);
      }
      Services.fx.shake(4, 6);
    }
    const relics = ((player.relics || player.Relics) || {});
    const killXp = (((expVal * 1) + (0.6 * relics["soulHarvest"])) || 0);
    player.gainXp(killXp);
    const foods = (world.foods || world.Foods);
    foods.push(FoodItem(ex, ey, ((Rng.Shared.chance(0.28) && "golden") || "apple")));
    const killHelm = ((player.equippedHelmet ?? player.EquippedHelmet) ?? player.helmet);
    if ((killHelm !== null)) {
      const isHivequeen = ((killHelm.id === "unique_helm_nanite_hivequeen") || (killHelm.Id === "unique_helm_nanite_hivequeen"));
      const isOmni = Boolean((((killHelm.isOmni || killHelm.IsOmni) || (killHelm.id === "unique_helm_celestial_ouroboros")) || (killHelm.Id === "unique_helm_celestial_ouroboros")));
      const spec = ((killHelm.specialCapacity || killHelm.SpecialCapacity) || "");
      const hasHarvestFeast = spec.includes("Harvest Feast");
      if (((isHivequeen || isOmni) || hasHarvestFeast)) {
        const extraApples = Rng.Shared.int(2, 3);
      }
    }
    if ((relics["soulHarvest"] || ((0 > 0) && Rng.Shared.chance(0.5)))) {
      foods.push(FoodItem((ex + Rng.Shared.range(-(14), 14)), (ey + Rng.Shared.range(-(14), 14)), "soul"));
    }
    if (Rng.Shared.chance(0.3)) {
      foods.push(FoodItem((ex + Rng.Shared.range(-(16), 16)), (ey + Rng.Shared.range(-(16), 16)), "shard"));
    }
    if ((relics["vampiric"] || (0 > 0))) {
      player.heal(relics["vampiric"]);
    }
    if ((relics["chainReaction"] || (0 > 0))) {
      const radius = 95;
      const dmgBonus = ((player.damageBonus ?? player.DamageBonus) ?? 1);
      const dmg = ((60 * relics["chainReaction"]) * dmgBonus);
      Services.fx.ringShockwave(ex, ey, "#ff0054", (radius * 0.55), 0.03);
      Services.sound.playExplosion(0.4);
      const enemies = (world.enemies || world.Enemies);
      const bosses = getActiveBosses(world);
    }
    this.incrementCombo(player, world);
  }
  HandleEnemyKill(enemy: Enemy, world: World): void {
    this.handleEnemyKill(enemy, world);
  }
  onEnemyKilled(enemy: Enemy, world: World): void {
    this.handleEnemyKill(enemy, world);
  }
  OnEnemyKilled(enemy: Enemy, world: World): void {
    this.handleEnemyKill(enemy, world);
  }
  updateSegmentModules(dt: number, world: World): void {
    const player = (world.player || world.Player);
    if (((!(player) || !((player.alive ?? player.Alive))) || !((player.segments || player.Segments)))) {
      return;
    }
    const dmgBonus = ((player.damageBonus ?? player.DamageBonus) ?? 1);
    const px = (player.x ?? player.X);
    const py = (player.y ?? player.Y);
    const pa = (player.angle ?? player.Angle);
    const projectiles = (world.projectiles || world.Projectiles);
    const enemies = (world.enemies || world.Enemies);
    if (((player.headAugment === "laser") && (player.headAugmentLevel > 0))) {
      player.headLaserTimer = (player.headLaserTimer + dt);
      if ((player.headLaserTimer >= 1.2)) {
        player.headLaserTimer = (player.headLaserTimer - 1.2);
        const spd = 500;
        const dmg = ((25 * player.headAugmentLevel) * dmgBonus);
        if ((projectiles !== null)) {
          projectiles.push(Projectile(px, py, pa, spd, dmg, "player", "#00f0b5", { radius: 7, life: 1.5 }));
        }
        Services.sound.playShoot();
      }
    } else if ((((player.headAugment === "crown") && (player.headAugmentLevel > 0)) && enemies)) {
      const crownDmg = (((15 * player.headAugmentLevel) * dmgBonus) * dt);
    }
    executeHeadModules(this, dt, world);
  }
  updateAuras(dt: number, world: World): void {
    updateAuras(this, dt, world);
  }
  UpdateAuras(dt: number, world: World): void {
    this.updateAuras(dt, world);
  }
  updateRelicAttacks(dt: number, world: World): void {
    updateRelicAttacks(this, dt, world);
  }
  UpdateRelicAttacks(dt: number, world: World): void {
    this.updateRelicAttacks(dt, world);
  }
  updateHazards(dt: number, world: World): void {
    const player = (world.player || world.Player);
    const px = (player.x ?? player.X);
    const py = (player.y ?? player.Y);
    const pr = (player.headRadius ?? player.HeadRadius);
    const hazards = (world.hazards || world.Hazards);
    const enemies = (world.enemies || world.Enemies);
    const boss = (world.boss || world.Boss);
  }
  UpdateHazards(dt: number, world: World): void {
    this.updateHazards(dt, world);
  }
  updateProjectiles(dt: number, world: World): void {
    this.ensureGrid(world);
    const player = (world.player || world.Player);
    const arenaW = (world.arenaW || world.ArenaW);
    const arenaH = (world.arenaH || world.ArenaH);
    const px = (player.x ?? player.X);
    const py = (player.y ?? player.Y);
    const pr = (player.headRadius ?? player.HeadRadius);
    const projectiles = (world.projectiles || world.Projectiles);
    const enemies = (world.enemies || world.Enemies);
    const boss = (world.boss || world.Boss);
    if ((!(projectiles) || (projectiles.length === 0))) {
      return;
    }
    let writeIdx = 0;
    const pCount = projectiles.length;
    projectiles.length = writeIdx;
  }
  UpdateProjectiles(dt: number, world: World): void {
    this.updateProjectiles(dt, world);
  }
  cookNearbyFood(world: World): void {
    const player = (world.player || world.Player);
    const cid = (player.classId || player.ClassId);
    if ((cid !== "solar")) {
      return;
    }
    const px = (player.x ?? player.X);
    const py = (player.y ?? player.Y);
    const foods = (world.foods || world.Foods);
    const rr = (92 * 92);
  }
  resolveFood(world: World): void {
    const player = (world.player || world.Player);
    const px = (player.x ?? player.X);
    const py = (player.y ?? player.Y);
    const pr = (player.headRadius ?? player.HeadRadius);
    const foods = (world.foods || world.Foods);
    this.cookNearbyFood(world);
    const baseReach = (pr + 2);
  }
  ResolveFood(world: World): void {
    this.resolveFood(world);
  }
  eatFood(food: FoodItem, world: World): void {
    food.dead = true;
    food.Dead = true;
    const player = (world.player || world.Player);
    const px = (player.x ?? player.X);
    const py = (player.y ?? player.Y);
    const pcol = ((((player.classConfig !== null) && player.classConfig.color) || ((player.ClassConfig !== null) && player.ClassConfig.Color)) || "#00f0b5");
    const dmgBonus = ((player.damageBonus ?? player.DamageBonus) ?? 1);
    const stats = (player.stats || player.Stats);
    const relics = ((player.relics || player.Relics) || {});
    this.foodsEaten = (this.foodsEaten + 1);
    const ftype = (food.type || "apple");
    this.FoodsEatenByType[ftype] = (this.FoodsEatenByType[ftype] || (0 + 1));
    player.foodsEaten = ((player.foodsEaten ?? player.FoodsEaten) ?? (0 + 1));
    player.FoodsEaten = player.foodsEaten;
    const isClutchCatch = ((this.comboTimer > 0) && (this.comboTimer <= 0.6));
    this.incrementCombo(player, world);
    player.gainXp(food.xpValue);
    if ((isClutchCatch !== null)) {
      this.ClutchCatchCount = (this.ClutchCatchCount + 1);
      const baseScore = MathX.roundJs((food.scoreValue * this.comboMultiplier));
      const bonusScore = MathX.roundJs((baseScore * 0.5));
      this.TotalClutchBonusScore = (this.TotalClutchBonusScore + bonusScore);
      this.score = ((this.score + baseScore) + bonusScore);
      Services.fx.addText(food.x, (food.y - 24), "⚡ CLUTCH CATCH! +50%", "#ffd166", 15, true);
    } else {
      this.score = (this.score + MathX.roundJs((food.scoreValue * this.comboMultiplier)));
    }
    player.addGrowth(1);
    const equippedHelm = ((player.equippedHelmet ?? player.EquippedHelmet) ?? player.helmet);
    if ((equippedHelm !== null)) {
      const isLeviathan = ((equippedHelm.id === "unique_helm_abyssal_leviathan") || (equippedHelm.Id === "unique_helm_abyssal_leviathan"));
      const isOmni = Boolean((((equippedHelm.isOmni || equippedHelm.IsOmni) || (equippedHelm.id === "unique_helm_celestial_ouroboros")) || (equippedHelm.Id === "unique_helm_celestial_ouroboros")));
      const spec = ((equippedHelm.specialCapacity || equippedHelm.SpecialCapacity) || "");
      const hasTitanGorging = spec.includes("Titan Gorging");
      if (((isLeviathan || isOmni) || hasTitanGorging)) {
        if ((typeof (player.triggerTitanGorging) === "function")) {
          player.triggerTitanGorging(3);
        } else if ((typeof (player.TriggerTitanGorging) === "function")) {
          player.TriggerTitanGorging(3);
        }
        Services.fx.addText(px, (py - 20), "TITAN GORGING! 2X SIZE", "#ffd166", 16, true);
      }
    }
    Services.sound.playEat(this.comboCount, (food.type === "golden"));
    Services.fx.burst(food.x, food.y, food.color, 9, 3, 2.5);
    if ((relics["vampiric"] || (0 > 0))) {
      player.heal(relics["vampiric"]);
    }
    if ((relics["gluttonGrowth"] || (0 > 0))) {
      player.gluttonCounter = ((player.gluttonCounter ?? player.GluttonCounter) ?? (0 + 1));
      player.GluttonCounter = player.gluttonCounter;
      if ((player.gluttonCounter >= 8)) {
        player.gluttonCounter = 0;
        player.GluttonCounter = 0;
        stats.maxHp = ((stats.maxHp ?? stats.MaxHp) ?? (100 + (10 * relics["gluttonGrowth"])));
        stats.MaxHp = stats.maxHp;
        player.heal((10 * relics["gluttonGrowth"]));
        Services.fx.addText(px, (py - 40), "+MAX HP", "#10b981", 15, true);
      }
    }
    if ((relics["explosiveAppetite"] || (0 > 0))) {
      this.explodeAt(world, px, py, 90, ((45 * relics["explosiveAppetite"]) * dmgBonus), pcol);
    }
  }
  EatFood(food: FoodItem, world: World): void {
    this.eatFood(food, world);
  }
  resolveEnemies(_dt: number, world: World): void {
    this.ensureGrid(world);
    const player = (world.player || world.Player);
    const heads = (((player.biteHeads !== null) && player.biteHeads()) || player.BiteHeads());
    const enemies = (world.enemies || world.Enemies);
    const isDashing = (player.isDashing ?? player.IsDashing);
    const relics = ((player.relics || player.Relics) || {});
    const segs = (player.segments || player.Segments);
  }
  ResolveEnemies(dt: number, world: World): void {
    this.resolveEnemies(dt, world);
  }
  enemyTouchesPlayer(enemy: Enemy, world: World, scale: number): void {
    const player = (world.player || world.Player);
    const stats = (player.stats || player.Stats);
    const thorns = ((stats.thorns ?? stats.Thorns) ?? 0);
    const cdam = (enemy.contactDamage ?? enemy.ContactDamage);
    const dealt = player.takeDamage((cdam * scale), "contact");
    if ((dealt <= 0)) {
      return;
    }
    this.onPlayerHurt(world, dealt);
    if ((thorns > 0)) {
      this.damageEnemy(enemy, (dealt * thorns), world, { color: "#84cc16" });
    }
  }
  EnemyTouchesPlayer(enemy: Enemy, world: World, scale: number): void {
    this.enemyTouchesPlayer(enemy, world, scale);
  }
  onPlayerHurt(world: World, dealt: number): void {
    const player = (world.player || world.Player);
    const relics = ((player.relics || player.Relics) || {});
    const dmgBonus = ((player.damageBonus ?? player.DamageBonus) ?? 1);
    const px = (player.x ?? player.X);
    const py = (player.y ?? player.Y);
    if ((world.game !== null)) {
      world.game.onPlayerHurt(dealt);
    }
    if ((relics["cryoNova"] || (0 > 0))) {
      const radius = 160;
      Services.fx.ringShockwave(px, py, "#7dd3fc", (radius * 0.5), 0.03);
      const enemies = (world.enemies || world.Enemies);
      const cryoBosses = getActiveBosses(world);
    }
  }
  OnPlayerHurt(world: World, dealt: number): void {
    this.onPlayerHurt(world, dealt);
  }
  resolveBoss(_dt: number, world: World): void {
    this.ensureGrid(world);
    const bosses = getActiveBosses(world);
    if ((!(bosses) || (bosses.length === 0))) {
      return;
    }
    const player = (world.player || world.Player);
    if (!(player)) {
      return;
    }
  }
  ResolveBoss(dt: number, world: World): void {
    this.resolveBoss(dt, world);
  }
  resolveSelfCollision(world: World): void {
    this.ensureGrid(world);
    const player = (world.player || world.Player);
    if ((!(player) || !((player.alive ?? player.Alive)))) {
      return;
    }
    const relics = ((player.relics || player.Relics) || {});
    const isDashing = (player.isDashing ?? player.IsDashing);
    const segs = (player.segments || player.Segments);
    const px = (player.x ?? player.X);
    const py = (player.y ?? player.Y);
    const pr = ((player.headRadius ?? player.HeadRadius) ?? 14);
    if (((relics["quantumPhase"] || (0 > 0)) || isDashing)) {
      return;
    }
    if ((!(segs) || (segs.length < 4))) {
      return;
    }
    const damageAmount = 8;
    let anyHit = false;
    const now = (((world.runTime || world.RunTime) || this.runTime) || 0);
    const s = this._segmentGrid.findFirstSegment(px, py, pr, 3);
    if (((s >= 3) && (s < segs.length))) {
      const seg = segs[s];
      if ((seg !== null)) {
        const sx = (seg.x ?? seg.X);
        const sy = (seg.y ?? seg.Y);
        const sr = ((seg.r ?? seg.R) ?? 11);
        const dx = (px - sx);
        const dy = (py - sy);
        const rr = (pr + sr);
        if ((((dx * dx) + (dy * dy)) < (rr * rr))) {
          const selfCd = ((seg.selfHitCooldown ?? seg.SelfHitCooldown) ?? 0);
          if ((selfCd <= 0)) {
            seg.selfHitCooldown = 0.8;
            seg.SelfHitCooldown = 0.8;
            const dealtSeg = (((player.damageSegment !== null) && player.damageSegment(s, damageAmount, false, false, true)) || player.DamageSegment(s, damageAmount, false, false, true));
            const headCd = ((player.headSelfHitCooldown ?? player.HeadSelfHitCooldown) ?? 0);
            if ((headCd <= 0)) {
              player.headSelfHitCooldown = 0.8;
              player.HeadSelfHitCooldown = 0.8;
              const dealtHead = (((player.damageHead !== null) && player.damageHead((damageAmount * 0.5), false, false, true)) || player.DamageHead((damageAmount * 0.5), false, false, true));
              if ((dealtHead > 0)) {
                anyHit = true;
              }
            }
            if ((dealtSeg > 0)) {
              anyHit = true;
              if (((now - this._lastSelfHitFxTime) >= 0.12)) {
                this._lastSelfHitFxTime = now;
                Services.fx.addText(sx, (sy - 22), ("SELF-BITE! -" + String(Math.floor(Math))), "#ff0054", 16, true);
                Services.fx.burst(sx, sy, "#ff0054", 8, 3, 2);
                Services.sound.playHit();
                this.onPlayerHurt(world, dealtSeg);
              }
            }
          }
        }
      }
    }
    const segCount = segs.length;
    const stride = ((((segCount > 500) && Math.ceil(Math)) || ((segCount > 150) && 2)) || 1);
    if ((anyHit !== null)) {
      this.breakCombo(player);
    }
  }
  ResolveSelfCollision(world: World): void {
    this.resolveSelfCollision(world);
  }
  _isPointInPoly(x: number, y: number, polyLen: number, minX: number, maxX: number, minY: number, maxY: number): boolean {
    if (((((x < minX) || (x > maxX)) || (y < minY)) || (y > maxY))) {
      return false;
    }
    let inside = false;
    return inside;
  }
  checkConstriction(world: World): void {
    if ((this._constrictionCooldown > 0)) {
      this._constrictionCooldown = (this._constrictionCooldown - (1 / 120));
      return;
    }
    const player = (world.player || world.Player);
    if ((!(player) || !((player.alive ?? player.Alive)))) {
      return;
    }
    const segs = (player.segments || player.Segments);
    if ((!(segs) || (segs.length < 4))) {
      return;
    }
    const px = (player.x ?? player.X);
    const py = (player.y ?? player.Y);
    const pr = ((player.headRadius ?? player.HeadRadius) ?? 14);
    let loopEndIndex = this._segmentGrid.findFirstSegment(px, py, ((pr + 11) + 16), 3);
    if (((loopEndIndex < 3) || (loopEndIndex >= segs.length))) {
      if ((this._segmentGrid.getItemCount(SpatialLayerMask.Segments) === 0)) {
        const snapDistSq = Math.pow(((pr + 11) + 16), 2);
      }
    }
    if (((loopEndIndex < 3) || (loopEndIndex >= segs.length))) {
      return;
    }
    const polyLen = (loopEndIndex + 2);
    this._ensurePolyCapacity(polyLen);
    this._polyX[0] = px;
    this._polyY[0] = py;
    let cx = px;
    let cy = py;
    let minX = this._polyX[0];
    let maxX = minX;
    let minY = this._polyY[0];
    let maxY = minY;
    cx = (cx / polyLen);
    cy = (cy / polyLen);
    let maxR = 0;
    const dmgBonus = ((player.damageBonus ?? player.DamageBonus) ?? 1);
    const crushDmg = (120 + ((segs.length * 15) * dmgBonus));
    const enemies = (world.enemies || world.Enemies);
    let trapped = 0;
    if ((enemies !== null)) {
      null;
    }
    const bosses = getActiveBosses(world);
    this.fuseEncircledFoodIntoPrism(player, world, polyLen, minX, maxX, minY, maxY);
    if ((trapped > 0)) {
      this._constrictionCooldown = 0.5;
      Services.fx.ringShockwave(cx, cy, "#ffd166", Math.max(30, (maxR * 0.85)), 0.04);
      Services.fx.addText(cx, (cy - 20), "🐍 OUROBOROS CONSTRICTION! 🐍", "#ffd166", 16, true);
      Services.sound.playExplosion(1);
    }
  }
  CheckConstriction(world: World): void {
    this.checkConstriction(world);
  }
  checkEncirclement(player: SnakePlayer, px: number, py: number): boolean {
    if (!(player)) {
      return false;
    }
    const segs = (player.segments || player.Segments);
    if ((!(segs) || (segs.length < 3))) {
      return false;
    }
    const count = (segs.length + 1);
    this._ensurePolyCapacity(count);
    this._polyX[0] = (player.x ?? player.X);
    this._polyY[0] = (player.y ?? player.Y);
    let minX = this._polyX[0];
    let maxX = minX;
    let minY = this._polyY[0];
    let maxY = minY;
    if (((((px < minX) || (px > maxX)) || (py < minY)) || (py > maxY))) {
      return false;
    }
    let inside = false;
    return inside;
  }
  CheckEncirclement(player: SnakePlayer, px: number, py: number): boolean {
    return this.checkEncirclement(player, px, py);
  }
  applyConstrictionDamage(player: SnakePlayer, world: World): void {
    const enemies = World.getEnemies(world);
    if ((enemies !== null)) {
      for (const en of enemies) {
        if ((en.dead || en.Dead)) {
          null;
        }
        const ex = (en.x ?? en.X);
        const ey = (en.y ?? en.Y);
        if (this.checkEncirclement(player, ex, ey)) {
          en.takeDamage(60, player);
          en.stasisTimer = 2;
          en.StasisTimer = 2;
          Services.fx.burst(ex, ey, "#ffd166", 8, 4, 3);
        }
      }
    }
  }
  ApplyConstrictionDamage(player: SnakePlayer, world: World): void {
    this.applyConstrictionDamage(player, world);
  }
  fuseEncircledFoodIntoPrism(player: SnakePlayer, world: World, polyLen: number, minX: number, maxX: number, minY: number, maxY: number): void {
    const foods = World.getFoods(world);
    if ((!(foods) || (foods.length === 0))) {
      return;
    }
    let trappedCount = 0;
    let sumX = 0;
    let sumY = 0;
    const hasPoly = (((((polyLen !== undefined) && (minX !== undefined)) && (maxX !== undefined)) && (minY !== undefined)) && (maxY !== undefined));
    if ((trappedCount >= 2)) {
      const cx = (sumX / trappedCount);
      const cy = (sumY / trappedCount);
      let writeIdx = 0;
      foods.length = writeIdx;
      const prism = FoodItem(cx, cy, "prism");
      foods.push(prism);
      Services.fx.burst(cx, cy, "#ffffff", 24, 6, 4);
      Services.fx.addText(cx, (cy - 24), "🔮 ASTRAL PRISM FUSION! 🔮", "#ffffff", 18, true);
      Services.sound.playLevelUp();
    } else if ((trappedCount === 1)) {
      null;
    }
  }
  FuseEncircledFoodIntoPrism(player: unknown, world: unknown): void {
    this.fuseEncircledFoodIntoPrism(player, world);
  }
  phoenixNova(world: World): void {
    const player = World.getPlayer(world);
    const px = (player.x ?? player.X);
    const py = (player.y ?? player.Y);
    const dmgBonus = ((player.damageBonus ?? player.DamageBonus) ?? 1);
    const enemies = World.getEnemies(world);
    Services.fx.ringShockwave(px, py, "#ffb703", 130, 0.008);
    Services.fx.burst(px, py, "#ffd166", 48, 9, 6);
    Services.fx.flash("#ffb703", 0.45, 0.5);
    Services.fx.shake(22, 26);
    world.projectiles = World.getProjectiles(world).filter((p: Projectile) => (p.source !== "enemy"));
    if ((world.game !== null)) {
      world.game.replaceProjectiles(world.projectiles);
    }
    const phoenixBosses = getActiveBosses(world);
    if ((world.game !== null)) {
      world.game.banner("🔥 PHOENIX REBIRTH 🔥", 1.8);
    }
  }
  PhoenixNova(world: World): void {
    this.phoenixNova(world);
  }
  explodeAt(world: World, x: number, y: number, radius: number, damage: number, color: string): void {
    if ((((((!(Number.isFinite(damage)) || (damage <= 0)) || !(Number.isFinite(x))) || !(Number.isFinite(y))) || !(Number.isFinite(radius))) || (radius <= 0))) {
      return;
    }
    if ((typeof (Services.fx?.explosion) === "function")) {
      Services.fx.explosion(x, y, color, radius, 1.2);
    } else if ((typeof (Services.fx?.Explosion) === "function")) {
      Services.fx.Explosion(x, y, color, radius, 1.2);
    }
    Services.sound.playExplosion(0.7);
    const enemies = (world.enemies || world.Enemies);
    const bosses = getActiveBosses(world);
    if ((enemies !== null)) {
      null;
    }
  }
  ExplodeAt(world: World, x: number, y: number, radius: number, damage: number, color: string): void {
    this.explodeAt(world, x, y, radius, damage, color);
  }
  chainLightning(world: World, x: number, y: number, jumps: number, damage: number, range: number, escalating: unknown = false): void {
    if (((((((!(Number.isFinite(damage)) || (damage <= 0)) || !(Number.isFinite(x))) || !(Number.isFinite(y))) || !(Number.isFinite(range))) || (range <= 0)) || (jumps <= 0))) {
      return;
    }
    const hit = new Set();
    let fromX = x;
    let fromY = y;
    let dmg = damage;
    const enemies = (world.enemies || world.Enemies);
    const bosses = getActiveBosses(world);
    Services.sound.playThunder();
  }
  ChainLightning(world: World, x: number, y: number, jumps: number, damage: number, range: number, escalating: unknown = false): void {
    this.chainLightning(world, x, y, jumps, damage, range, escalating);
  }
  nearestHostile(world: World, x: number, y: number, maxDist: number): HostileTarget {
    let bestEnemy: Enemy | null = null;
    let bestBoss: Boss | null = null;
    let bestD = maxDist;
    const enemies = (world.enemies || world.Enemies);
    const bosses = getActiveBosses(world);
    if ((enemies !== null)) {
      null;
    }
    const res = this._cachedHostileTarget;
    if ((bestEnemy !== null)) {
      const bx = (bestEnemy.x ?? bestEnemy.X);
      const by = (bestEnemy.y ?? bestEnemy.Y);
      res.found = true;
      res.isBoss = false;
      res.enemy = bestEnemy;
      res.x = bx;
      res.y = by;
      res.Found = true;
      res.IsBoss = false;
      res.Enemy = bestEnemy;
      res.X = bx;
      res.Y = by;
      return res;
    }
    if ((bestBoss !== null)) {
      const bx = (bestBoss.x ?? bestBoss.X);
      const by = (bestBoss.y ?? bestBoss.Y);
      res.found = true;
      res.isBoss = true;
      res.enemy = null;
      res.x = bx;
      res.y = by;
      res.Found = true;
      res.IsBoss = true;
      res.Enemy = null;
      res.X = bx;
      res.Y = by;
      return res;
    }
    res.found = false;
    res.isBoss = false;
    res.enemy = null;
    res.x = 0;
    res.y = 0;
    res.Found = false;
    res.IsBoss = false;
    res.Enemy = null;
    res.X = 0;
    res.Y = 0;
    return res;
  }
  NearestHostile(world: World, x: number, y: number, maxDist: number): HostileTarget {
    return this.nearestHostile(world, x, y, maxDist);
  }
  activateSkill(world: World): boolean {
    return activateSkill(this, world);
  }
  ActivateSkill(world: World): boolean {
    return this.activateSkill(world);
  }
  skillVerdantBloom(world: World): void {
    skillVerdantBloom(this, world);
  }
  skillUmbralBlink(world: World): void {
    skillUmbralBlink(this, world);
  }
  skillTitanRoar(world: World): void {
    skillTitanRoar(this, world);
  }
  skillChainStorm(world: World): void {
    skillChainStorm(this, world);
  }
  skillSupernova(world: World): void {
    skillSupernova(this, world);
  }
}
