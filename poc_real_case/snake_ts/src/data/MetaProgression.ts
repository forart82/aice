/**
 * Ouroboros Ascension — Meta Progression & Persistence (MetaProgression.ts)
 *
 * Implements Sanctuary upgrades, essence shards, class unlocks, lifetime statistics,
 * save schema migrations, deterministic card drafting, and isolated in-memory stores
 * for thread/promise-safe concurrent bot sweeps and simulations matching C# Data.MetaProgression.
 */

import { MathX } from '../core/MathX.js';
import { Rng } from '../core/Rng.js';
import { Services, type IServiceContainer } from '../core/Services.js';
import { GameData } from './GameData.js';
import { CardDef, HelmetDef, HelmetRarity, DailyCapacityState } from './Types.js';
import { SaveIO, type MetaSaveV2, type SaveRecords, createDefaultMetaSave } from '../platform/SaveIO.js';
import {
  UNIQUE_HELMETS,
  CELESTIAL_OUROBOROS_HELMET,
  type UniqueHelmetDef,
  calculateSacrificeScore,
  calculateDetailedSacrificeScore,
  calculatePrestigeMultiplier,
  getUniqueHelmet,
  isUniqueHelmetId,
  getCanonicalHelmetId,
  forgeOmniHelmet,
} from './UniqueHelmetsData.js';

export class Records {
  public HighScore = 0;
  public HighestFloor = 1;
  public HighestCombo = 0;
  public HighestLevel = 1;
  public TotalRuns = 0;
  public Victories = 0;
  public TotalKills = 0;
  public TotalFoods = 0;
  public TotalBosses = 0;
  public TotalShards = 0;
  public PlayTimeSec = 0.0;
  public BestTimeSec = 0.0;

  public get highScore(): number { return this.HighScore; }
  public set highScore(v: number) { this.HighScore = v; }

  public get highestFloor(): number { return this.HighestFloor; }
  public set highestFloor(v: number) { this.HighestFloor = v; }

  public get highestCombo(): number { return this.HighestCombo; }
  public set highestCombo(v: number) { this.HighestCombo = v; }

  public get highestLevel(): number { return this.HighestLevel; }
  public set highestLevel(v: number) { this.HighestLevel = v; }

  public get totalRuns(): number { return this.TotalRuns; }
  public set totalRuns(v: number) { this.TotalRuns = v; }

  public get victories(): number { return this.Victories; }
  public set victories(v: number) { this.Victories = v; }

  public get totalKills(): number { return this.TotalKills; }
  public set totalKills(v: number) { this.TotalKills = v; }

  public get totalFoods(): number { return this.TotalFoods; }
  public set totalFoods(v: number) { this.TotalFoods = v; }

  public get totalBosses(): number { return this.TotalBosses; }
  public set totalBosses(v: number) { this.TotalBosses = v; }

  public get totalShards(): number { return this.TotalShards; }
  public set totalShards(v: number) { this.TotalShards = v; }

  public get playTimeSec(): number { return this.PlayTimeSec; }
  public set playTimeSec(v: number) { this.PlayTimeSec = v; }

  public get bestTimeSec(): number { return this.BestTimeSec; }
  public set bestTimeSec(v: number) { this.BestTimeSec = v; }

  private static readonly KeyList: readonly string[] = [
    'highScore', 'highestFloor', 'highestCombo', 'highestLevel',
    'totalRuns', 'victories', 'totalKills', 'totalFoods',
    'totalBosses', 'totalShards', 'playTimeSec', 'bestTimeSec',
  ];

  public get Keys(): readonly string[] {
    return Records.KeyList;
  }
  public get keys(): readonly string[] {
    return Records.KeyList;
  }

  public Get(key: string): number {
    switch (key) {
      case 'highScore': return this.HighScore;
      case 'highestFloor': return this.HighestFloor;
      case 'highestCombo': return this.HighestCombo;
      case 'highestLevel': return this.HighestLevel;
      case 'totalRuns': return this.TotalRuns;
      case 'victories': return this.Victories;
      case 'totalKills': return this.TotalKills;
      case 'totalFoods': return this.TotalFoods;
      case 'totalBosses': return this.TotalBosses;
      case 'totalShards': return this.TotalShards;
      case 'playTimeSec': return this.PlayTimeSec;
      case 'bestTimeSec': return this.BestTimeSec;
      default: return 0;
    }
  }
  public get(key: string): number { return this.Get(key); }

  public Set(key: string, v: number): void {
    const val = Number.isFinite(v) ? v : 0;
    switch (key) {
      case 'highScore': this.HighScore = Math.floor(val); break;
      case 'highestFloor': this.HighestFloor = Math.floor(val); break;
      case 'highestCombo': this.HighestCombo = Math.floor(val); break;
      case 'highestLevel': this.HighestLevel = Math.floor(val); break;
      case 'totalRuns': this.TotalRuns = Math.floor(val); break;
      case 'victories': this.Victories = Math.floor(val); break;
      case 'totalKills': this.TotalKills = Math.floor(val); break;
      case 'totalFoods': this.TotalFoods = Math.floor(val); break;
      case 'totalBosses': this.TotalBosses = Math.floor(val); break;
      case 'totalShards': this.TotalShards = Math.floor(val); break;
      case 'playTimeSec': this.PlayTimeSec = val; break;
      case 'bestTimeSec': this.BestTimeSec = val; break;
    }
  }
  public set(key: string, v: number): void { this.Set(key, v); }
}

export interface RunSummary {
  Score?: number;
  Floor?: number;
  Combo?: number;
  Level?: number;
  Kills?: number;
  Foods?: number;
  Bosses?: number;
  TimeSec?: number;
  Victory?: boolean;
  Length?: number;
  DefeatedBosses?: string[];
  KillsByType?: Record<string, number>;
  FoodsByType?: Record<string, number>;
  score?: number;
  floor?: number;
  combo?: number;
  level?: number;
  kills?: number;
  foods?: number;
  bosses?: number;
  timeSec?: number;
  victory?: boolean;
  length?: number;
  defeatedBosses?: string[];
  killsByType?: Record<string, number>;
  foodsByType?: Record<string, number>;
  // Specific Bestiary Kill Counts
  swarmlings?: number;
  scarabs?: number;
  spitters?: number;
  phantoms?: number;
  arc_drones?: number;
  drones?: number;
  magma_brutes?: number;
  brutes?: number;
  // Specific Food & Item Harvest Counts
  apples?: number;
  golden_apples?: number;
  golden?: number;
  potions?: number;
  shards?: number;
  prisms?: number;
}

export interface ChallengeContext {
  records?: Records;
  summary?: RunSummary;
  length?: number;
  floor?: number;
  bosses?: number;
  kills?: number;
  foods?: number;
  combo?: number;
  defeatedBosses?: string[];
  bossType?: string;
  arenaW?: number;
  arenaH?: number;
  runTime?: number;
  RunTime?: number;
  timeSec?: number;
  TimeSec?: number;
  killsByType?: Record<string, number>;
  KillsByType?: Record<string, number>;
  foodsByType?: Record<string, number>;
  FoodsByType?: Record<string, number>;
  // Specific Bestiary Kill Counts
  swarmlings?: number;
  scarabs?: number;
  spitters?: number;
  phantoms?: number;
  arc_drones?: number;
  drones?: number;
  magma_brutes?: number;
  brutes?: number;
  // Specific Food & Item Harvest Counts
  apples?: number;
  golden_apples?: number;
  golden?: number;
  potions?: number;
  shards?: number;
  prisms?: number;
}

export interface MetaProgressionOptions {
  isolated?: boolean;
  engine?: any;
  services?: IServiceContainer;
  saveBackend?: {
    read: (key: string) => string | null;
    write: (key: string, value: string) => void;
    delete: (key: string) => void;
  };
  initialData?: Partial<MetaSaveV2>;
  rng?: Rng;
  autoLoad?: boolean;
}

export function normalizeHelmet(h: any): HelmetDef {
  const id = h.id || h.Id || `helm_${Date.now()}`;
  const name = h.name || h.Name || 'Primordial Helm';
  const icon = h.icon || h.Icon || '🪖';
  const rarity = (h.rarity || h.Rarity || 'common') as HelmetRarity;
  const stats = h.stats || h.Stats || {};
  const desc = h.description || h.Description || '';
  const floor = h.floor || h.Floor || 1;
  const bossType = h.bossType || h.BossType || 'centipede';
  return {
    Id: id,
    Name: name,
    Icon: icon,
    Rarity: rarity,
    Stats: stats,
    Description: desc,
    Floor: floor,
    BossType: bossType,
    id,
    name,
    icon,
    rarity,
    stats,
    description: desc,
    floor,
    bossType
  };
}

export class MetaProgression {
  public static get ReadBackend(): ((key: string) => string | null) | null { return SaveIO.readOverride; }
  public static set ReadBackend(v: ((key: string) => string | null) | null) { SaveIO.readOverride = v; }

  public static get WriteBackend(): ((key: string, value: string) => void) | null { return SaveIO.writeOverride; }
  public static set WriteBackend(v: ((key: string, value: string) => void) | null) { SaveIO.writeOverride = v; }

  public static get DeleteBackend(): ((key: string) => void) | null { return SaveIO.deleteOverride; }
  public static set DeleteBackend(v: ((key: string) => void) | null) { SaveIO.deleteOverride = v; }

  public static get readBackend(): ((key: string) => string | null) | null { return SaveIO.readOverride; }
  public static set readBackend(v: ((key: string) => string | null) | null) { SaveIO.readOverride = v; }

  public static get writeBackend(): ((key: string, value: string) => void) | null { return SaveIO.writeOverride; }
  public static set writeBackend(v: ((key: string, value: string) => void) | null) { SaveIO.writeOverride = v; }

  public static get deleteBackend(): ((key: string) => void) | null { return SaveIO.deleteOverride; }
  public static set deleteBackend(v: ((key: string) => void) | null) { SaveIO.deleteOverride = v; }

  private static _instance: MetaProgression | null = null;

  public static get Instance(): MetaProgression {
    if (!MetaProgression._instance) {
      MetaProgression._instance = new MetaProgression();
    }
    return MetaProgression._instance;
  }
  public static set Instance(v: MetaProgression) {
    MetaProgression._instance = v;
  }

  public static get instance(): MetaProgression {
    return MetaProgression.Instance;
  }
  public static set instance(v: MetaProgression) {
    MetaProgression.Instance = v;
  }

  /**
   * Spawns a fully isolated, thread-safe / promise-safe MetaProgression instance
   * backed by an in-memory storage map with zero shared static state mutation.
   */
  public static createIsolated(options?: MetaProgressionOptions): MetaProgression {
    return new MetaProgression({ isolated: true, ...options });
  }

  private _options?: MetaProgressionOptions;
  private _engine?: any;
  private _services?: IServiceContainer;
  private _rng?: Rng;
  private _privateMemoryStore?: Map<string, string>;

  public get engine(): any {
    return this._engine ?? this._services?.engine ?? (typeof Services !== 'undefined' ? Services.Engine : null);
  }
  public set engine(v: any) {
    this._engine = v;
  }

  public get Engine(): any { return this.engine; }
  public set Engine(v: any) { this.engine = v; }

  public get services(): IServiceContainer | undefined {
    return this._services;
  }
  public set services(v: IServiceContainer | undefined) {
    this._services = v;
  }

  public get Services(): IServiceContainer | undefined { return this.services; }
  public set Services(v: IServiceContainer | undefined) { this.services = v; }

  public get rng(): Rng | undefined {
    return this._rng;
  }
  public set rng(v: Rng | undefined) {
    this._rng = v;
  }

  public get Rng(): Rng | undefined { return this.rng; }
  public set Rng(v: Rng | undefined) { this.rng = v; }

  /**
   * Rounds a length requirement value to the nearest multiple of 10,
   * enforcing a strict minimum of 10.
   *
   * @param val Raw floating-point or integer length requirement
   * @returns Strict integer multiple of 10 >= 10
   */
  public static RoundToTen(val: number): number {
    return Math.max(10, Math.round(val / 10) * 10);
  }
  public static roundToTen(val: number): number {
    return MetaProgression.RoundToTen(val);
  }

  /**
   * Dynamically calculates scaled serpent length challenge requirements based on active arena dimensions.
   * 
   * Reference Desktop Arena: 1600 x 960 (Area = 1,536,000 px^2, Ratio = 1.0).
   * Active Arena Scaling Ratio: R = clamp((ArenaW * ArenaH) / 1,536,000, 0.12, 1.0).
   * 
   * Enforces strict 10ner-step rounding via RoundToTen(baseLength * R).
   *
   * @param baseLength Reference desktop base length (e.g. 250 for T1, 600-800 for T2, 1200-1800 for T3)
   * @param customCtx Optional override context containing arenaW, arenaH
   * @returns Calibrated length requirement rounded to the nearest multiple of 10
   */
  public GetScaledLengthRequirement(baseLength: number, customCtx?: Partial<ChallengeContext>): number {
    let arenaW = customCtx?.arenaW;
    let arenaH = customCtx?.arenaH;
    if (arenaW === undefined || arenaH === undefined) {
      try {
        const engine: any = this.engine;
        if (engine) {
          arenaW = arenaW ?? engine.ArenaW ?? engine.arenaW;
          arenaH = arenaH ?? engine.ArenaH ?? engine.arenaH;
        }
      } catch (e) {}
    }

    const w = (typeof arenaW === 'number' && arenaW > 0) ? arenaW : 1600;
    const h = (typeof arenaH === 'number' && arenaH > 0) ? arenaH : 960;

    const referenceArea = 1600 * 960; // 1,536,000
    const currentArea = w * h;
    const ratio = MathX.clamp(currentArea / referenceArea, 0.12, 1.0);
    if (baseLength < 50) {
      return Math.max(10, Math.round(baseLength * ratio));
    }
    return MetaProgression.RoundToTen(baseLength * ratio);
  }
  public getScaledLengthRequirement(baseLength: number, customCtx?: Partial<ChallengeContext>): number {
    return this.GetScaledLengthRequirement(baseLength, customCtx);
  }

  public Shards = 0;
  public get shards(): number { return this.Shards; }
  public set shards(v: number) { this.Shards = v; }
  public get Stars(): number { return this.Shards; }
  public set Stars(v: number) { this.Shards = v; }
  public get stars(): number { return this.Shards; }
  public set stars(v: number) { this.Shards = v; }

  public Ouro = 0;
  public get ouro(): number { return this.Ouro; }
  public set ouro(v: number) { this.Ouro = v; }

  public PrestigeMultiplier = 1.0;
  public get prestigeMultiplier(): number { return this.PrestigeMultiplier; }
  public set prestigeMultiplier(v: number) { this.PrestigeMultiplier = v; }

  public SpendOuro(cost: number): boolean {
    if (cost <= 0) return true;
    if (this.Ouro >= cost) {
      this.Ouro -= cost;
      this.Save();
      return true;
    }
    return false;
  }
  public spendOuro(cost: number): boolean { return this.SpendOuro(cost); }

  public AddOuro(amount: number): void {
    if (amount > 0) {
      this.Ouro += Math.floor(amount);
      this.Save();
    }
  }
  public addOuro(amount: number): void { this.AddOuro(amount); }

  public UnlockedClasses: Record<string, boolean> = { emerald: true };
  public get unlockedClasses(): Record<string, boolean> { return this.UnlockedClasses; }
  public set unlockedClasses(v: Record<string, boolean>) { this.UnlockedClasses = v; }

  public Records: Records = new Records();
  public get records(): Records { return this.Records; }
  public set records(v: Records) { this.Records = v; }

  public UpgradeLevels: Record<string, number> = {};
  public get upgradeLevels(): Record<string, number> { return this.UpgradeLevels; }
  public set upgradeLevels(v: Record<string, number>) { this.UpgradeLevels = v; }

  public UnlockedModules: Record<string, boolean> = {
    turret: true,
    shield: true
  };
  public get unlockedModules(): Record<string, boolean> { return this.UnlockedModules; }
  public set unlockedModules(v: Record<string, boolean>) { this.UnlockedModules = v; }

  /** Unlocked tier levels for each upgrade / augment (Tier 1 is starter default for turret and shield) */
  public UnlockedTiers: Record<string, number> = {
    turret: 1, // Starter default weapon
    shield: 1, // Starter default defense
  };
  public get unlockedTiers(): Record<string, number> { return this.UnlockedTiers; }
  public set unlockedTiers(v: Record<string, number>) { this.UnlockedTiers = v; }

  public CompletedChallenges: Record<string, boolean> = {};
  public get completedChallenges(): Record<string, boolean> { return this.CompletedChallenges; }
  public set completedChallenges(v: Record<string, boolean>) { this.CompletedChallenges = v; }

  public Helmets: HelmetDef[] = [];
  public get helmets(): HelmetDef[] { return this.Helmets; }
  public set helmets(v: HelmetDef[]) { this.Helmets = v; }

  public UniqueHelmets: string[] = [];
  public get uniqueHelmets(): string[] { return this.UniqueHelmets; }
  public set uniqueHelmets(v: string[]) { this.UniqueHelmets = v; }

  public Has9thHelmet: boolean = false;
  public get has9thHelmet(): boolean { return this.Has9thHelmet; }
  public set has9thHelmet(v: boolean) { this.Has9thHelmet = v; }

  public EquippedHelmetId: string | null = null;
  public get equippedHelmetId(): string | null { return this.EquippedHelmetId; }
  public set equippedHelmetId(v: string | null) { this.EquippedHelmetId = v; }

  public StorageBroken = false;
  public get storageBroken(): boolean { return this.StorageBroken; }
  public set storageBroken(v: boolean) { this.StorageBroken = v; }

  public StorageError: string | null = null;
  public get storageError(): string | null { return this.StorageError; }
  public set storageError(v: string | null) { this.StorageError = v; }

  /** Active Daily Transcendence Special Capacity (persisted for 24 hours). */
  public DailyCapacityState: DailyCapacityState | null = null;
  public get dailyCapacityState(): DailyCapacityState | null { return this.DailyCapacityState; }
  public set dailyCapacityState(v: DailyCapacityState | null) { this.DailyCapacityState = v; }

  /**
   * Checks whether the current daily capacity is unlocked and unexpired.
   * Cleans up expired states automatically.
   */
  public IsDailyCapacityActive(now: number = Date.now()): boolean {
    if (!this.DailyCapacityState) return false;
    const expiry = this.DailyCapacityState.expiresAt ?? this.DailyCapacityState.ExpiresAt ?? 0;
    if (now >= expiry) {
      this.DailyCapacityState = null;
      this.Save();
      return false;
    }
    return true;
  }
  public isDailyCapacityActive(now?: number): boolean { return this.IsDailyCapacityActive(now); }

  /**
   * Retrieves the active Daily Special Capacity if valid and unexpired.
   */
  public GetActiveDailyCapacity(now: number = Date.now()): DailyCapacityState | null {
    return this.IsDailyCapacityActive(now) ? this.DailyCapacityState : null;
  }
  public getActiveDailyCapacity(now?: number): DailyCapacityState | null {
    return this.GetActiveDailyCapacity(now);
  }

  /**
   * Unlocks the Daily Special Capacity with a 24h TTL timestamp.
   */
  public UnlockDailySpecialCapacity(
    capacity: Partial<DailyCapacityState>,
    now: number = Date.now()
  ): DailyCapacityState {
    const id = capacity.id || capacity.Id || 'daily_transcendence';
    const name = capacity.name || capacity.Name || 'Cosmic Transcendence';
    const icon = capacity.icon || capacity.Icon || '✨';
    const desc = capacity.desc || capacity.Desc || 'Cosmic energy surges through the serpent.';
    const stateValues = capacity.stateValues || capacity.StateValues || {};
    const rolledTiers = capacity.rolledTiers || capacity.RolledTiers || {};
    const unlockedAt = now;
    const expiresAt = now + 24 * 60 * 60 * 1000;
    const currentFloorBoost = 1.0;
    const milestoneTier = capacity.milestoneTier ?? capacity.MilestoneTier ?? 1;
    const milestoneLevel = capacity.milestoneLevel ?? capacity.MilestoneLevel ?? 5;
    const milestoneBonus = capacity.milestoneBonus ?? capacity.MilestoneBonus ?? 0.0;
    const milestoneBoost = capacity.milestoneBoost ?? capacity.MilestoneBoost ?? (1.0 + milestoneBonus);

    const state: DailyCapacityState = {
      id,
      name,
      icon,
      desc,
      stateValues: { ...stateValues },
      rolledTiers: { ...rolledTiers },
      unlockedAt,
      expiresAt,
      currentFloorBoost,
      milestoneTier,
      milestoneLevel,
      milestoneBonus,
      milestoneBoost,
      Id: id,
      Name: name,
      Icon: icon,
      Desc: desc,
      StateValues: { ...stateValues },
      RolledTiers: { ...rolledTiers },
      UnlockedAt: unlockedAt,
      ExpiresAt: expiresAt,
      CurrentFloorBoost: currentFloorBoost,
      MilestoneTier: milestoneTier,
      MilestoneLevel: milestoneLevel,
      MilestoneBonus: milestoneBonus,
      MilestoneBoost: milestoneBoost,
    };

    this.DailyCapacityState = state;
    this.Save();
    return state;
  }
  public unlockDailySpecialCapacity(capacity: Partial<DailyCapacityState>, now?: number): DailyCapacityState {
    return this.UnlockDailySpecialCapacity(capacity, now);
  }

  /**
   * Updates the current Daily Challenge milestone tier (1..4) and milestone bonus (+0%, +50%, +100%, +150%).
   */
  public UpdateDailyMilestone(tier: number, level: number, bonus?: number): number {
    if (!this.DailyCapacityState) return 1.0;
    const calculatedBonus = bonus ?? (tier === 1 ? 0.0 : tier === 2 ? 0.50 : tier === 3 ? 1.00 : 1.50);
    const boost = 1.0 + calculatedBonus;

    const curTier = this.DailyCapacityState.milestoneTier ?? this.DailyCapacityState.MilestoneTier ?? 1;
    if (tier >= curTier) {
      this.DailyCapacityState.milestoneTier = tier;
      this.DailyCapacityState.MilestoneTier = tier;
      this.DailyCapacityState.milestoneLevel = level;
      this.DailyCapacityState.MilestoneLevel = level;
      this.DailyCapacityState.milestoneBonus = calculatedBonus;
      this.DailyCapacityState.MilestoneBonus = calculatedBonus;
      this.DailyCapacityState.milestoneBoost = boost;
      this.DailyCapacityState.MilestoneBoost = boost;
      this.Save();
    }
    return boost;
  }
  public updateDailyMilestone(tier: number, level: number, bonus?: number): number {
    return this.UpdateDailyMilestone(tier, level, bonus);
  }

  /**
   * Applies the floor escalation multiplier: 1.0 + (floor - 1) * 0.25 (+25% per floor).
   */
  public EscalateDailyCapacityFloor(floor: number): number {
    const safeFloor = Math.max(1, Math.floor(floor));
    const multiplier = 1.0 + (safeFloor - 1) * 0.25;

    if (this.DailyCapacityState) {
      this.DailyCapacityState.currentFloorBoost = multiplier;
      this.DailyCapacityState.CurrentFloorBoost = multiplier;
      this.Save();
    }
    return multiplier;
  }
  public escalateDailyCapacityFloor(floor: number): number {
    return this.EscalateDailyCapacityFloor(floor);
  }

  constructor(options?: MetaProgressionOptions) {
    this._options = options;
    if (options) {
      this._engine = options.engine;
      this._services = options.services;
      this._rng = options.rng;
      if (options.isolated && !options.saveBackend) {
        this._privateMemoryStore = new Map<string, string>();
      }
    }

    this.Shards = 0;
    this.UnlockedClasses = { emerald: true };
    this.Records = new Records();
    this.Helmets = [];
    this.UniqueHelmets = [];
    this.Has9thHelmet = false;
    this.EquippedHelmetId = null;

    for (let i = 0; i < GameData.MetaUpgrades.Count; i++) {
      const key = GameData.MetaUpgrades.Keys[i];
      if (key) this.UpgradeLevels[key] = 0;
    }

    if (options?.autoLoad !== false) {
      this.Load();
    }
  }

  public AddHelmet(helmet: HelmetDef): void {
    if (!helmet) return;
    const norm = normalizeHelmet(helmet);
    const existing = this.Helmets.find(h => (h.id || h.Id) === (norm.id || norm.Id));
    if (!existing) {
      this.Helmets.push(norm);
      this.Save();
    }
  }
  public addHelmet(helmet: HelmetDef): void { this.AddHelmet(helmet); }

  public EquipHelmet(id: string | null): void {
    if (!id) {
      this.EquippedHelmetId = null;
      this.Save();
      return;
    }
    const isStandard = this.Helmets.some(h => (h.id || h.Id) === id);
    const isOmni = (id === CELESTIAL_OUROBOROS_HELMET.Id || id === CELESTIAL_OUROBOROS_HELMET.id) && this.Has9thHelmet;
    const isUnique = this.UniqueHelmets.includes(id);

    if (isStandard || isOmni || isUnique) {
      this.EquippedHelmetId = id;
      this.Save();
    }
  }
  public equipHelmet(id: string | null): void { this.EquipHelmet(id); }

  public GetEquippedHelmet(): HelmetDef | null {
    if (!this.EquippedHelmetId) return null;
    if (this.Has9thHelmet && (this.EquippedHelmetId === CELESTIAL_OUROBOROS_HELMET.Id || this.EquippedHelmetId === CELESTIAL_OUROBOROS_HELMET.id)) {
      return CELESTIAL_OUROBOROS_HELMET;
    }
    const unique = UNIQUE_HELMETS.find(h => h.Id === this.EquippedHelmetId || h.id === this.EquippedHelmetId);
    if (unique && this.UniqueHelmets.includes(unique.Id)) {
      return unique;
    }
    const found = this.Helmets.find(h => (h.id || h.Id) === this.EquippedHelmetId);
    return found ? normalizeHelmet(found) : null;
  }
  public getEquippedHelmet(): HelmetDef | null { return this.GetEquippedHelmet(); }

  public DeleteHelmet(id: string): boolean {
    const idx = this.Helmets.findIndex(h => (h.id || h.Id) === id);
    if (idx >= 0) {
      this.Helmets.splice(idx, 1);
      if (this.EquippedHelmetId === id) {
        this.EquippedHelmetId = null;
      }
      this.Save();
      return true;
    }
    return false;
  }
  public deleteHelmet(id: string): boolean { return this.DeleteHelmet(id); }

  /**
   * Performs the Galaxy Jump transcendence ritual.
   * Sacrifices either specified helmets or all standard boss helmets in inventory,
   * calculating a cumulative sacrifice score and rolling for an unowned Unique Helmet
   * based on the probability curve: P = 1 - exp(-score / 800).
   *
   * Formulated per ORACLE.md Section 10.4:
   *  - On failure: Consolation Stardust Bonus (Ouro = floor(S * 2.5), Shards = floor(S / 20)).
   *  - On all 8 collected: Ascendant Crucible Surge (+10,000 Ouro, +500 Shards).
   *  - Updates prestige multiplier: P_mult = 1 + 0.5 * N_helmets + 0.1 * Floor.
   *  - Shards are permanently retained across all galaxy jumps.
   *
   * @param helmetsToSacrifice Optional list of specific helmets to sacrifice. Defaults to all standard helmets.
   * @param currentFloor Optional floor achieved in current or highest run (defaults to highestFloor)
   * @returns Outcome detailing success, awarded unique helmet, sacrifice score, probability, consolation bonus, and prestigeMultiplier.
   */
  public galaxyJump(helmetsToSacrifice?: HelmetDef[], currentFloor?: number): {
    success: boolean;
    awardedHelmet: UniqueHelmetDef | null;
    sacrificeScore: number;
    probability?: number;
    consolationOuro?: number;
    consolationShards?: number;
    prestigeMultiplier?: number;
  } {
    let targets: HelmetDef[];
    if (helmetsToSacrifice) {
      targets = [...helmetsToSacrifice];
      const targetIds = new Set(targets.map(h => (h.id || h.Id)));
      this.Helmets = this.Helmets.filter(h => !targetIds.has(h.id || h.Id));
      if (this.EquippedHelmetId && targetIds.has(this.EquippedHelmetId)) {
        this.EquippedHelmetId = null;
      }
    } else {
      targets = [...this.Helmets];
      this.Helmets = [];
      if (this.EquippedHelmetId && !this.isUniqueHelmetOwned(this.EquippedHelmetId) && this.EquippedHelmetId !== CELESTIAL_OUROBOROS_HELMET.Id) {
        this.EquippedHelmetId = null;
      }
    }

    const sacrificeScore = calculateSacrificeScore(targets);
    const floor = Math.max(1, currentFloor ?? (this.Records?.HighestFloor || 1));
    const prestigeMultiplier = calculatePrestigeMultiplier(this.UniqueHelmets.length, floor);
    this.PrestigeMultiplier = prestigeMultiplier;

    if (targets.length === 0 || sacrificeScore <= 0) {
      this.Save();
      return { success: false, awardedHelmet: null, sacrificeScore: 0, probability: 0, prestigeMultiplier };
    }

    const prob = 1 - Math.exp(-sacrificeScore / 800);
    const rolledSuccess = this._rng ? this._rng.chance(prob) : Math.random() < prob;

    if (!rolledSuccess) {
      // Consolation Stardust Bonus per ORACLE.md Section 10.4.1
      const consolationOuro = Math.floor(sacrificeScore * 2.5);
      const consolationShards = Math.floor(sacrificeScore / 20);
      this.Ouro = (this.Ouro || 0) + consolationOuro;
      this.Shards = (this.Shards || 0) + consolationShards;
      this.Save();
      return {
        success: false,
        awardedHelmet: null,
        sacrificeScore,
        probability: prob,
        consolationOuro,
        consolationShards,
        prestigeMultiplier,
      };
    }

    // Roll for an unowned unique helmet
    const unowned = UNIQUE_HELMETS.filter(h => !this.isUniqueHelmetOwned(h.Id));
    if (unowned.length === 0) {
      // Ascendant Crucible Surge per ORACLE.md Section 10.4.1 (+10,000 Ouro, +500 Shards)
      this.Ouro = (this.Ouro || 0) + 10000;
      this.Shards = (this.Shards || 0) + 500;
      this.Save();
      return {
        success: true,
        awardedHelmet: null,
        sacrificeScore,
        probability: prob,
        consolationOuro: 10000,
        consolationShards: 500,
        prestigeMultiplier,
      };
    }

    const awarded = (this._rng && typeof this._rng.pick === 'function')
      ? this._rng.pick(unowned)
      : unowned[Math.floor((this._rng ? this._rng.rand() : Math.random()) * unowned.length)];

    if (!awarded) {
      this.Save();
      return { success: true, awardedHelmet: null, sacrificeScore, probability: prob, prestigeMultiplier };
    }

    this.UniqueHelmets.push(awarded.Id);
    this.PrestigeMultiplier = calculatePrestigeMultiplier(this.UniqueHelmets.length, floor);
    this.Save();
    return {
      success: true,
      awardedHelmet: awarded,
      sacrificeScore,
      probability: prob,
      prestigeMultiplier: this.PrestigeMultiplier,
    };
  }

  /**
   * Checks whether a specific Unique Helmet is owned (matching Id, CanonicalId, or AliasId).
   */
  public isUniqueHelmetOwned(id: string): boolean {
    if (!id) return false;
    const def = getUniqueHelmet(id);
    if (!def) {
      return this.UniqueHelmets.includes(id);
    }
    return this.UniqueHelmets.some(ownedId => {
      if (ownedId === id) return true;
      if (def.CanonicalId && ownedId === def.CanonicalId) return true;
      if (def.AliasId && ownedId === def.AliasId) return true;
      if (def.Id && ownedId === def.Id) return true;
      return false;
    });
  }

  /**
   * Checks whether all 8 Unique Helmets have been collected to unlock the 9th Omni-Helmet forge ritual.
   */
  public canForge9thHelmet(): boolean {
    const canonicalSet = new Set<string>();
    for (const h of this.UniqueHelmets) {
      const def = getUniqueHelmet(h);
      if (def && !def.IsOmni) {
        canonicalSet.add(def.CanonicalId || def.Id);
      } else {
        canonicalSet.add(h);
      }
    }
    return canonicalSet.size >= 8 || this.UniqueHelmets.length >= 8;
  }

  /**
   * Synthesizes the 9th Omni-Helmet ("The Celestial Crown of the Eternal Ouroboros")
   * combining stats and capacities across all 8 Unique Helmets.
   */
  public forge9thHelmet(): UniqueHelmetDef {
    this.Has9thHelmet = true;
    this.Save();
    return CELESTIAL_OUROBOROS_HELMET;
  }

  /**
   * High-Stakes Permaloss Penalty: Wipes all 8 unique helmets on Boss Rush Gauntlet defeat.
   * Standard helmets and persistent shard/ouro balances remain strictly intact.
   */
  public resetUniqueHelmets(): void {
    this.UniqueHelmets = [];
    this.Has9thHelmet = false;
    if (this.EquippedHelmetId) {
      const def = getUniqueHelmet(this.EquippedHelmetId);
      if (def) {
        this.EquippedHelmetId = null;
      }
    }
    this.Save();
  }

  /**
   * Serializes current meta progression state into a JSON string.
   */
  public serialize(): string {
    return JSON.stringify(this.toSaveData());
  }

  /**
   * Deserializes and restores meta progression from a JSON string with safe schema migration fallback.
   */
  public deserialize(rawJson: string): void {
    try {
      const parsed = JSON.parse(rawJson);
      if (!parsed || typeof parsed !== 'object') return;
      if (parsed.version === 1 || !parsed.version) {
        const migrated = SaveIO.migrateV1toV2(parsed);
        this.applySaveData(migrated);
      } else {
        this.applySaveData(parsed);
      }
    } catch {
      // Non-throwing fallback for corrupt JSON
    }
  }

  public ResetRunUnlocks(): void {
    this.UnlockedTiers = {
      turret: 1,
      shield: 1,
    };
    this.CompletedChallenges = {};
  }
  public resetRunUnlocks(): void { this.ResetRunUnlocks(); }

  public IsTierUnlocked(upgradeId: string, tier: number, customCtx?: Partial<ChallengeContext>): boolean {
    if (tier <= 0) return true;
    if (this.UpgradeLevels['unlock_' + upgradeId] && this.UpgradeLevels['unlock_' + upgradeId]! >= tier) return true;
    // Starter defaults: Tier 1 of turret and shield are always unlocked
    if (tier === 1 && (upgradeId === 'turret' || upgradeId === 'shield')) {
      return true;
    }
    const currentMax = this.UnlockedTiers[upgradeId] || 0;
    if (currentMax >= tier) return true;

    // Build rich challenge evaluation context from active engine/player/records
    let engine: any = null;
    try {
      engine = this.engine;
    } catch (e) {}

    const player = engine?.player ?? (engine?.Player ?? null);
    const combat = engine?.combat ?? (engine?.Combat ?? null);
    const length = customCtx?.length ?? (player?.length !== undefined ? player.length : (player?.Length !== undefined ? player.Length : ((player?.segments ? player.segments.length : (player?.Segments ? player.Segments.length : 0)) + 1)));
    const floor = customCtx?.floor ?? (engine?.CurrentFloor ?? (engine?.currentFloor ?? 1));
    const bosses = customCtx?.bosses ?? (combat?.BossKills ?? (combat?.bossKills ?? (engine?.Combat?.BossKills ?? (engine?.combat?.BossKills ?? (engine?.Combat?.bossKills ?? (engine?.combat?.bossKills ?? 0))))));
    const kills = customCtx?.kills ?? (combat?.Kills ?? (combat?.kills ?? (engine?.Combat?.Kills ?? (engine?.combat?.Kills ?? (engine?.Combat?.kills ?? (engine?.combat?.kills ?? 0))))));
    const foods = customCtx?.foods ?? (combat?.FoodsEaten ?? (combat?.foodsEaten ?? (engine?.Combat?.FoodsEaten ?? (engine?.combat?.FoodsEaten ?? (engine?.Combat?.foodsEaten ?? (engine?.combat?.foodsEaten ?? 0))))));
    const combo = customCtx?.combo ?? (combat?.HighestRunCombo ?? (combat?.highestRunCombo ?? (combat?.ComboCount ?? (combat?.comboCount ?? (engine?.Combat?.HighestRunCombo ?? (engine?.combat?.HighestRunCombo ?? (engine?.Combat?.highestRunCombo ?? (engine?.combat?.highestRunCombo ?? 0))))))));
    const arenaW = customCtx?.arenaW ?? (engine?.ArenaW ?? (engine?.arenaW ?? undefined));
    const arenaH = customCtx?.arenaH ?? (engine?.ArenaH ?? (engine?.arenaH ?? undefined));

    const killsByType = customCtx?.killsByType ?? (customCtx?.KillsByType ?? (combat?.killsByType ?? (combat?.KillsByType ?? {})));
    const foodsByType = customCtx?.foodsByType ?? (customCtx?.FoodsByType ?? (combat?.foodsByType ?? (combat?.FoodsByType ?? (combat?.foodsEatenByType ?? (combat?.FoodsEatenByType ?? {})))));
    const defeatedBosses = customCtx?.defeatedBosses ?? (combat?.defeatedBosses ?? (combat?.DefeatedBosses ?? (combat?.defeatedBossTypes ?? (combat?.DefeatedBossTypes ?? []))));

    const swarmlings = customCtx?.swarmlings ?? (killsByType['swarmling'] ?? 0);
    const scarabs = customCtx?.scarabs ?? (killsByType['scarab'] ?? 0);
    const spitters = customCtx?.spitters ?? (killsByType['spitter'] ?? 0);
    const phantoms = customCtx?.phantoms ?? (killsByType['phantom'] ?? 0);
    const arc_drones = customCtx?.arc_drones ?? (customCtx?.drones ?? (killsByType['drone'] ?? (killsByType['arc_drone'] ?? 0)));
    const magma_brutes = customCtx?.magma_brutes ?? (customCtx?.brutes ?? (killsByType['brute'] ?? (killsByType['magma_brute'] ?? 0)));

    const apples = customCtx?.apples ?? (foodsByType['apple'] ?? 0);
    const golden_apples = customCtx?.golden_apples ?? (customCtx?.golden ?? (foodsByType['golden'] ?? (foodsByType['golden_apple'] ?? 0)));
    const potions = customCtx?.potions ?? (foodsByType['potion'] ?? 0);
    const shards = customCtx?.shards ?? (foodsByType['shard'] ?? 0);
    const prisms = customCtx?.prisms ?? (foodsByType['prism'] ?? 0);

    const ctx: ChallengeContext = {
      records: this.Records,
      summary: customCtx?.summary,
      length,
      floor,
      bosses,
      kills,
      foods,
      combo,
      arenaW,
      arenaH,
      killsByType,
      KillsByType: killsByType,
      foodsByType,
      FoodsByType: foodsByType,
      defeatedBosses,
      swarmlings,
      scarabs,
      spitters,
      phantoms,
      arc_drones,
      drones: arc_drones,
      magma_brutes,
      brutes: magma_brutes,
      apples,
      golden_apples,
      golden: golden_apples,
      potions,
      shards,
      prisms,
      ...customCtx,
    };

    // Check challenge fulfillment strictly against in-run challenge context
    const challenge = this.getChallengeFor(upgradeId, tier, ctx);
    if (challenge && this.checkChallenge(challenge, ctx)) {
      this.UnlockedTiers[upgradeId] = Math.max(currentMax, tier);
      return true;
    }
    return false;
  }
  public isTierUnlocked(upgradeId: string, tier: number, customCtx?: Partial<ChallengeContext>): boolean { return this.IsTierUnlocked(upgradeId, tier, customCtx); }

  public GetMaxUnlockedTier(upgradeId: string): number {
    let max = 0;
    for (let t = 1; t <= 5; t++) {
      if (this.IsTierUnlocked(upgradeId, t)) {
        max = t;
      } else {
        break;
      }
    }
    return max;
  }
  public getMaxUnlockedTier(upgradeId: string): number { return this.GetMaxUnlockedTier(upgradeId); }

  public UnlockTier(upgradeId: string, tier: number): void {
    if (!upgradeId || tier <= 0) return;
    this.UnlockedTiers[upgradeId] = Math.max(this.UnlockedTiers[upgradeId] || 0, tier);
    this.Save();
  }
  public unlockTier(upgradeId: string, tier: number): void { this.UnlockTier(upgradeId, tier); }

  public GetUpgradeChallengeDescription(upgradeId: string, tier: number, customCtx?: Partial<ChallengeContext>): string {
    const ch = this.getChallengeFor(upgradeId, tier, customCtx);
    return ch ? ch.desc : 'Complete Challenges to Unlock';
  }
  public getUpgradeChallengeDescription(upgradeId: string, tier: number, customCtx?: Partial<ChallengeContext>): string { return this.GetUpgradeChallengeDescription(upgradeId, tier, customCtx); }

  public EvaluateChallenges(summary?: RunSummary): void {
    const modules = [
      'turret', 'tesla', 'venom', 'shield', 'spikes', 'cryo', 'magma', 'plasma', 'chrono', 'tachyon',
      'regen', 'magnet', 'nanite', 'flak', 'scattershot', 'needler', 'fangs', 'maw', 'horns', 'visor', 'laser', 'crown', 'crest'
    ];

    let engine: any = null;
    try {
      engine = this.engine;
    } catch (e) {}

    const killsByType = summary?.killsByType ?? (summary?.KillsByType ?? (engine?.combat?.killsByType ?? (engine?.Combat?.KillsByType ?? {})));
    const foodsByType = summary?.foodsByType ?? (summary?.FoodsByType ?? (engine?.combat?.foodsByType ?? (engine?.Combat?.FoodsByType ?? (engine?.combat?.foodsEatenByType ?? (engine?.Combat?.FoodsEatenByType ?? {})))));
    const defeatedBosses = summary?.defeatedBosses ?? (summary?.DefeatedBosses ?? (engine?.combat?.defeatedBosses ?? (engine?.Combat?.DefeatedBosses ?? [])));

    const swarmlings = summary?.swarmlings ?? (killsByType['swarmling'] ?? 0);
    const scarabs = summary?.scarabs ?? (killsByType['scarab'] ?? 0);
    const spitters = summary?.spitters ?? (killsByType['spitter'] ?? 0);
    const phantoms = summary?.phantoms ?? (killsByType['phantom'] ?? 0);
    const arc_drones = summary?.arc_drones ?? (summary?.drones ?? (killsByType['drone'] ?? (killsByType['arc_drone'] ?? 0)));
    const magma_brutes = summary?.magma_brutes ?? (summary?.brutes ?? (killsByType['brute'] ?? (killsByType['magma_brute'] ?? 0)));

    const apples = summary?.apples ?? (foodsByType['apple'] ?? 0);
    const golden_apples = summary?.golden_apples ?? (summary?.golden ?? (foodsByType['golden'] ?? (foodsByType['golden_apple'] ?? 0)));
    const potions = summary?.potions ?? (foodsByType['potion'] ?? 0);
    const shards = summary?.shards ?? (foodsByType['shard'] ?? 0);
    const prisms = summary?.prisms ?? (foodsByType['prism'] ?? 0);

    const ctx: ChallengeContext = {
      records: this.Records,
      summary,
      length: summary ? (summary.length ?? summary.Length ?? summary.combo ?? summary.Combo ?? 1) : 1,
      floor: summary ? (summary.floor ?? summary.Floor ?? 1) : 1,
      bosses: summary ? (summary.bosses ?? summary.Bosses ?? 0) : 0,
      kills: summary ? (summary.kills ?? summary.Kills ?? 0) : 0,
      foods: summary ? (summary.foods ?? summary.Foods ?? 0) : 0,
      combo: summary ? (summary.combo ?? summary.Combo ?? 0) : 0,
      defeatedBosses,
      killsByType,
      KillsByType: killsByType,
      foodsByType,
      FoodsByType: foodsByType,
      swarmlings,
      scarabs,
      spitters,
      phantoms,
      arc_drones,
      drones: arc_drones,
      magma_brutes,
      brutes: magma_brutes,
      apples,
      golden_apples,
      golden: golden_apples,
      potions,
      shards,
      prisms,
      arenaW: engine?.ArenaW ?? (engine?.arenaW ?? undefined),
      arenaH: engine?.ArenaH ?? (engine?.arenaH ?? undefined),
    };

    for (const mod of modules) {
      for (let t = 1; t <= 3; t++) {
        const ch = this.getChallengeFor(mod, t, ctx);
        if (ch && this.checkChallenge(ch, ctx)) {
          this.CompletedChallenges[ch.id] = true;
          this.UnlockedTiers[mod] = Math.max(this.UnlockedTiers[mod] || 0, t);
        }
      }
    }
    this.Save();
  }
  public evaluateChallenges(summary?: RunSummary): void { this.EvaluateChallenges(summary); }

  private checkChallenge(
    ch: { id: string; desc: string; condition: (rec?: Records, sum?: RunSummary, ctx?: ChallengeContext) => boolean },
    ctx?: ChallengeContext
  ): boolean {
    if (this.CompletedChallenges[ch.id]) return true;
    return ch.condition(undefined, ctx?.summary, ctx);
  }

  /**
   * Challenge Definition Registry (Dynamic Gameboard-to-Length Scaling & Thematic Matrix):
   * 
   * Specific Bestiary Hunts:
   * - Magma Vent [Tier 1]: Slay 15 Swarmlings in a run
   * - Ramming Horns [Tier 1]: Slay 10 Armored Scarabs in a run
   * - Laser Optics [Tier 1]: Slay 8 Venom Spitters in a run
   * - Scattershot [Tier 1]: Slay 25 Enemies in a run
   * - Thorny Spikes [Tier 2]: Slay 12 Phase Phantoms in a run
   * - Venom Sprayer [Tier 2]: Slay 15 Arc Drones in a run
   * - Venom Fangs [Tier 3]: Slay 10 Magma Brutes in a run
   * 
   * Specific Food & Item Harvests:
   * - Regen Gland [Tier 1]: Eat 30 Crimson Apples in a run
   * - Bio-Magnet [Tier 1]: Collect 2 Golden Apples in a run
   * - Cryo Mortar [Tier 1]: Drink 2 Health Potions in a run
   * - Nanite Swarm [Tier 1]: Collect 5 Astral Shards / Prisms in a run
   * - Solar Crown [Tier 1]: Collect 45 Food items in a run
   * - Needler [Tier 2]: Collect 80 Food items in a run
   * 
   * Combat Feats & Combos:
   * - Tachyon Laser [Tier 1]: Maintain a Combo Streak of 10x
   * - Plasma Mortar [Tier 1]: Reach Serpent Length 35 (scaled)
   * - Bio-Arc Coil [Tier 2]: Maintain a Combo Streak of 20x
   * - Flak Cannon [Tier 2]: Maintain a Combo Streak of 25x
   * - Bio-Magnet [Tier 2]: Maintain a Combo Streak of 18x
   * - Tesla Coil [Tier 3]: Maintain a Combo Streak of 40x
   * 
   * Boss Guardians Defeats:
   * - Dragon Maw [Tier 1]: Defeat Centipede Behemoth (Floor 1)
   * - Flak Cannon [Tier 1]: Defeat Storm Gorgon (Floor 2)
   * - Needler [Tier 1]: Defeat Infernal Colossus (Floor 3)
   * - Chrono Ward [Tier 1]: Defeat Chrono Wyrm (Floor 5)
   * - Turret [Tier 2]: Defeat Apex Superconductor (Floor 7)
   * - Magma Vent [Tier 2]: Defeat Astral Leviathan (Floor 8)
   * - Cryo Mortar [Tier 2]: Defeat Shadow Doppelgänger (Floor 10)
   * - Tachyon Laser [Tier 2]: Defeat Nanite Hive Titan (Floor 17)
   * - Turret [Tier 3]: Defeat Prismatic Arachnid (Floor 15)
   * - Cryo Mortar [Tier 3]: Defeat The Eternal Ouroboros (Floor 20)
   */
  private getChallengeFor(upgradeId: string, tier: number, ctx?: Partial<ChallengeContext>): { id: string; desc: string; condition: (rec?: Records, sum?: RunSummary, ctx?: ChallengeContext) => boolean } | null {
    if (tier === 1) {
      if (upgradeId === 'turret' || upgradeId === 'shield') return null; // Starter defaults

      // Bio-Arc Coil (Tesla) [Tier 1]: Maintain a Combo Streak of 8x
      if (upgradeId === 'tesla') {
        return {
          id: 'ch_tesla_1',
          desc: 'Maintain a Combo Streak of 8x',
          condition: (r, s, c) => {
            const val = c?.combo ?? (s?.combo ?? (s?.Combo ?? 0));
            return val >= 8;
          }
        };
      }

      // Venom Sprayer (Venom) [Tier 1]: Slay 20 Enemies in a run
      if (upgradeId === 'venom') {
        return {
          id: 'ch_venom_1',
          desc: 'Slay 20 Enemies in a run',
          condition: (r, s, c) => {
            const val = c?.kills ?? (s?.kills ?? (s?.Kills ?? 0));
            return val >= 20;
          }
        };
      }

      // Thorny Spikes (Spikes) [Tier 1]: Slay 10 Armored Scarabs in a run
      if (upgradeId === 'spikes') {
        return {
          id: 'ch_spikes_1',
          desc: 'Slay 10 Armored Scarabs in a run',
          condition: (r, s, c) => {
            const scarabs = c?.scarabs ?? (c?.killsByType?.['scarab'] ?? (s?.scarabs ?? (s?.KillsByType?.['scarab'] ?? (s?.killsByType?.['scarab'] ?? 0))));
            const totalKills = c?.kills ?? (s?.kills ?? (s?.Kills ?? 0));
            return scarabs >= 10 || totalKills >= 10;
          }
        };
      }

      // Venom Fangs (Fangs) [Tier 1]: Maintain a Combo Streak of 15x
      if (upgradeId === 'fangs') {
        return {
          id: 'ch_fangs_1',
          desc: 'Maintain a Combo Streak of 15x',
          condition: (r, s, c) => {
            const val = c?.combo ?? (s?.combo ?? (s?.Combo ?? 0));
            return val >= 15;
          }
        };
      }

      // Specific Bestiary Hunts
      if (upgradeId === 'magma') {
        return {
          id: 'ch_magma_1',
          desc: 'Slay 15 Swarmlings in a run',
          condition: (r, s, c) => {
            const val = c?.swarmlings ?? (c?.killsByType?.['swarmling'] ?? (s?.swarmlings ?? (s?.KillsByType?.['swarmling'] ?? (s?.killsByType?.['swarmling'] ?? 0))));
            return val >= 15;
          }
        };
      }
      if (upgradeId === 'horns') {
        return {
          id: 'ch_horns_1',
          desc: 'Slay 10 Armored Scarabs in a run',
          condition: (r, s, c) => {
            const val = c?.scarabs ?? (c?.killsByType?.['scarab'] ?? (s?.scarabs ?? (s?.KillsByType?.['scarab'] ?? (s?.killsByType?.['scarab'] ?? 0))));
            return val >= 10;
          }
        };
      }
      if (upgradeId === 'laser' || upgradeId === 'visor') {
        return {
          id: `ch_${upgradeId}_1`,
          desc: 'Slay 8 Venom Spitters in a run',
          condition: (r, s, c) => {
            const val = c?.spitters ?? (c?.killsByType?.['spitter'] ?? (s?.spitters ?? (s?.KillsByType?.['spitter'] ?? (s?.killsByType?.['spitter'] ?? 0))));
            return val >= 8;
          }
        };
      }
      if (upgradeId === 'scattershot') {
        return {
          id: 'ch_scattershot_1',
          desc: 'Slay 25 Enemies in a run',
          condition: (r, s, c) => {
            const val = c?.kills ?? (s?.kills ?? (s?.Kills ?? 0));
            return val >= 25;
          }
        };
      }

      // Specific Food & Item Harvests
      if (upgradeId === 'regen') {
        return {
          id: 'ch_regen_1',
          desc: 'Eat 30 Crimson Apples in a run',
          condition: (r, s, c) => {
            const val = c?.apples ?? (c?.foodsByType?.['apple'] ?? (s?.apples ?? (s?.FoodsByType?.['apple'] ?? (s?.foodsByType?.['apple'] ?? 0))));
            return val >= 30;
          }
        };
      }
      if (upgradeId === 'magnet') {
        return {
          id: 'ch_magnet_1',
          desc: 'Collect 2 Golden Apples in a run',
          condition: (r, s, c) => {
            const val = c?.golden_apples ?? (c?.golden ?? (c?.foodsByType?.['golden'] ?? (c?.foodsByType?.['golden_apple'] ?? (s?.golden_apples ?? (s?.golden ?? (s?.FoodsByType?.['golden'] ?? (s?.foodsByType?.['golden'] ?? 0)))))));
            return val >= 2;
          }
        };
      }
      if (upgradeId === 'cryo') {
        return {
          id: 'ch_cryo_1',
          desc: 'Drink 2 Health Potions in a run',
          condition: (r, s, c) => {
            const val = c?.potions ?? (c?.foodsByType?.['potion'] ?? (s?.potions ?? (s?.FoodsByType?.['potion'] ?? (s?.foodsByType?.['potion'] ?? 0))));
            return val >= 2;
          }
        };
      }
      if (upgradeId === 'nanite') {
        return {
          id: 'ch_nanite_1',
          desc: 'Collect 5 Astral Shards / Prisms in a run',
          condition: (r, s, c) => {
            const shards = c?.shards ?? (c?.foodsByType?.['shard'] ?? (s?.shards ?? (s?.FoodsByType?.['shard'] ?? (s?.foodsByType?.['shard'] ?? 0))));
            const prisms = c?.prisms ?? (c?.foodsByType?.['prism'] ?? (s?.prisms ?? (s?.FoodsByType?.['prism'] ?? (s?.foodsByType?.['prism'] ?? 0))));
            return (shards + prisms) >= 5;
          }
        };
      }
      if (upgradeId === 'crown' || upgradeId === 'crest') {
        return {
          id: `ch_${upgradeId}_1`,
          desc: 'Collect 45 Food items in a run',
          condition: (r, s, c) => {
            const val = c?.foods ?? (s?.foods ?? (s?.Foods ?? 0));
            return val >= 45;
          }
        };
      }

      // Combat Feats & Combos
      if (upgradeId === 'tachyon') {
        return {
          id: 'ch_tachyon_1',
          desc: 'Maintain a Combo Streak of 10x',
          condition: (r, s, c) => {
            const val = c?.combo ?? (s?.combo ?? (s?.Combo ?? 0));
            return val >= 10;
          }
        };
      }
      if (upgradeId === 'plasma') {
        const req = this.GetScaledLengthRequirement(35, ctx);
        return {
          id: 'ch_plasma_1',
          desc: `Reach Serpent Length ${req} (scaled)`,
          condition: (r, s, c) => {
            const len = c ? (c.length ?? 1) : (s ? (s.length ?? (s.Length ?? 1)) : 1);
            return len >= req;
          }
        };
      }

      // Boss Guardians Defeats
      if (upgradeId === 'maw') {
        return {
          id: 'ch_maw_1',
          desc: 'Defeat Centipede Behemoth (Floor 1)',
          condition: (r, s, c) => {
            const fl = c ? (c.floor ?? 1) : (s ? (s.floor ?? (s.Floor ?? 1)) : 1);
            const b = c ? (c.bosses ?? 0) : (s ? (s.bosses ?? (s.Bosses ?? 0)) : 0);
            const bossesList = c?.defeatedBosses ?? (s?.defeatedBosses ?? (s?.DefeatedBosses ?? []));
            return fl > 1 || b >= 1 || bossesList.includes('centipede') || bossesList.includes('colossus_prime');
          }
        };
      }
      if (upgradeId === 'flak') {
        return {
          id: 'ch_flak_1',
          desc: 'Defeat Storm Gorgon (Floor 2)',
          condition: (r, s, c) => {
            const fl = c ? (c.floor ?? 1) : (s ? (s.floor ?? (s.Floor ?? 1)) : 1);
            const b = c ? (c.bosses ?? 0) : (s ? (s.bosses ?? (s.Bosses ?? 0)) : 0);
            const bossesList = c?.defeatedBosses ?? (s?.defeatedBosses ?? (s?.DefeatedBosses ?? []));
            return fl > 2 || b >= 2 || bossesList.includes('gorgon');
          }
        };
      }
      if (upgradeId === 'needler') {
        return {
          id: 'ch_needler_1',
          desc: 'Defeat Infernal Colossus (Floor 3)',
          condition: (r, s, c) => {
            const fl = c ? (c.floor ?? 1) : (s ? (s.floor ?? (s.Floor ?? 1)) : 1);
            const b = c ? (c.bosses ?? 0) : (s ? (s.bosses ?? (s.Bosses ?? 0)) : 0);
            const bossesList = c?.defeatedBosses ?? (s?.defeatedBosses ?? (s?.DefeatedBosses ?? []));
            return fl > 3 || b >= 3 || bossesList.includes('colossus');
          }
        };
      }
      if (upgradeId === 'chrono') {
        return {
          id: 'ch_chrono_1',
          desc: 'Defeat Chrono Wyrm (Floor 5)',
          condition: (r, s, c) => {
            const fl = c ? (c.floor ?? 1) : (s ? (s.floor ?? (s.Floor ?? 1)) : 1);
            const b = c ? (c.bosses ?? 0) : (s ? (s.bosses ?? (s.Bosses ?? 0)) : 0);
            const bossesList = c?.defeatedBosses ?? (s?.defeatedBosses ?? (s?.DefeatedBosses ?? []));
            return fl > 5 || b >= 5 || bossesList.includes('chronowyrm') || bossesList.includes('chrono_wyrm');
          }
        };
      }
    } else if (tier === 2) {
      // Boss Defeats
      if (upgradeId === 'turret') {
        return {
          id: 'ch_turret_2',
          desc: 'Defeat Apex Superconductor (Floor 7)',
          condition: (r, s, c) => {
            const fl = c ? (c.floor ?? 1) : (s ? (s.floor ?? (s.Floor ?? 1)) : 1);
            const b = c ? (c.bosses ?? 0) : (s ? (s.bosses ?? (s.Bosses ?? 0)) : 0);
            const bossesList = c?.defeatedBosses ?? (s?.defeatedBosses ?? (s?.DefeatedBosses ?? []));
            return fl > 7 || b >= 7 || bossesList.includes('superconductor_boss') || bossesList.includes('superconductor');
          }
        };
      }
      if (upgradeId === 'magma') {
        return {
          id: 'ch_magma_2',
          desc: 'Defeat Astral Leviathan (Floor 8)',
          condition: (r, s, c) => {
            const fl = c ? (c.floor ?? 1) : (s ? (s.floor ?? (s.Floor ?? 1)) : 1);
            const b = c ? (c.bosses ?? 0) : (s ? (s.bosses ?? (s.Bosses ?? 0)) : 0);
            const bossesList = c?.defeatedBosses ?? (s?.defeatedBosses ?? (s?.DefeatedBosses ?? []));
            return fl > 8 || b >= 8 || bossesList.includes('leviathan');
          }
        };
      }
      if (upgradeId === 'cryo') {
        return {
          id: 'ch_cryo_2',
          desc: 'Defeat Shadow Doppelgänger (Floor 10)',
          condition: (r, s, c) => {
            const fl = c ? (c.floor ?? 1) : (s ? (s.floor ?? (s.Floor ?? 1)) : 1);
            const b = c ? (c.bosses ?? 0) : (s ? (s.bosses ?? (s.Bosses ?? 0)) : 0);
            const bossesList = c?.defeatedBosses ?? (s?.defeatedBosses ?? (s?.DefeatedBosses ?? []));
            return fl > 10 || b >= 10 || bossesList.includes('mirror_wyrm') || bossesList.includes('doppelganger');
          }
        };
      }
      if (upgradeId === 'tachyon') {
        return {
          id: 'ch_tachyon_2',
          desc: 'Defeat Nanite Hive Titan (Floor 17)',
          condition: (r, s, c) => {
            const fl = c ? (c.floor ?? 1) : (s ? (s.floor ?? (s.Floor ?? 1)) : 1);
            const b = c ? (c.bosses ?? 0) : (s ? (s.bosses ?? (s.Bosses ?? 0)) : 0);
            const bossesList = c?.defeatedBosses ?? (s?.defeatedBosses ?? (s?.DefeatedBosses ?? []));
            return fl > 17 || b >= 17 || bossesList.includes('nanite_titan');
          }
        };
      }
      if (upgradeId === 'chrono' || upgradeId === 'horns') {
        return {
          id: `ch_${upgradeId}_2`,
          desc: 'Defeat 8 Boss Guardians',
          condition: (r, s, c) => {
            const b = c ? (c.bosses ?? 0) : (s ? (s.bosses ?? (s.Bosses ?? 0)) : 0);
            return b >= 8;
          }
        };
      }

      // Combos & Feats
      if (upgradeId === 'tesla') {
        return {
          id: 'ch_tesla_2',
          desc: 'Maintain a Combo Streak of 20x',
          condition: (r, s, c) => {
            const val = c?.combo ?? (s?.combo ?? (s?.Combo ?? 0));
            return val >= 20;
          }
        };
      }
      if (upgradeId === 'flak') {
        return {
          id: 'ch_flak_2',
          desc: 'Maintain a Combo Streak of 25x',
          condition: (r, s, c) => {
            const val = c?.combo ?? (s?.combo ?? (s?.Combo ?? 0));
            return val >= 25;
          }
        };
      }
      if (upgradeId === 'magnet') {
        return {
          id: 'ch_magnet_2',
          desc: 'Maintain a Combo Streak of 18x',
          condition: (r, s, c) => {
            const val = c?.combo ?? (s?.combo ?? (s?.Combo ?? 0));
            return val >= 18;
          }
        };
      }
      if (upgradeId === 'fangs') {
        return {
          id: 'ch_fangs_2',
          desc: 'Maintain a Combo Streak of 20x',
          condition: (r, s, c) => {
            const val = c?.combo ?? (s?.combo ?? (s?.Combo ?? 0));
            return val >= 20;
          }
        };
      }

      // Bestiary Hunts
      if (upgradeId === 'spikes') {
        return {
          id: 'ch_spikes_2',
          desc: 'Slay 12 Phase Phantoms in a run',
          condition: (r, s, c) => {
            const val = c?.phantoms ?? (c?.killsByType?.['phantom'] ?? (s?.phantoms ?? (s?.KillsByType?.['phantom'] ?? (s?.killsByType?.['phantom'] ?? 0))));
            return val >= 12;
          }
        };
      }
      if (upgradeId === 'venom') {
        return {
          id: 'ch_venom_2',
          desc: 'Slay 15 Arc Drones in a run',
          condition: (r, s, c) => {
            const val = c?.arc_drones ?? (c?.drones ?? (c?.killsByType?.['drone'] ?? (c?.killsByType?.['arc_drone'] ?? (s?.arc_drones ?? (s?.drones ?? (s?.KillsByType?.['drone'] ?? (s?.killsByType?.['drone'] ?? 0)))))));
            return val >= 15;
          }
        };
      }
      if (upgradeId === 'visor' || upgradeId === 'laser') {
        return {
          id: `ch_${upgradeId}_2`,
          desc: 'Slay 110 Enemies in a run',
          condition: (r, s, c) => {
            const val = c?.kills ?? (s?.kills ?? (s?.Kills ?? 0));
            return val >= 110;
          }
        };
      }

      // Length
      if (upgradeId === 'shield' || upgradeId === 'maw') {
        const req = this.GetScaledLengthRequirement(600, ctx);
        return {
          id: `ch_${upgradeId}_2`,
          desc: `Grow Serpent to Length ${req}`,
          condition: (r, s, c) => (c ? (c.length ?? 1) >= req : false) || (s ? (s.length ?? (s.Length ?? 0)) >= req : false)
        };
      }
      if (upgradeId === 'scattershot') {
        const req = this.GetScaledLengthRequirement(650, ctx);
        return {
          id: 'ch_scattershot_2',
          desc: `Grow Serpent to Length ${req}`,
          condition: (r, s, c) => (c ? (c.length ?? 1) >= req : false) || (s ? (s.length ?? (s.Length ?? 0)) >= req : false)
        };
      }
      if (upgradeId === 'plasma' || upgradeId === 'nanite') {
        const req = this.GetScaledLengthRequirement(800, ctx);
        return {
          id: `ch_${upgradeId}_2`,
          desc: `Grow Serpent to Length ${req}`,
          condition: (r, s, c) => (c ? (c.length ?? 1) >= req : false) || (s ? (s.length ?? (s.Length ?? 0)) >= req : false)
        };
      }

      // Food
      if (upgradeId === 'needler') {
        return {
          id: 'ch_needler_2',
          desc: 'Collect 80 Food items in a run',
          condition: (r, s, c) => {
            const val = c?.foods ?? (s?.foods ?? (s?.Foods ?? 0));
            return val >= 80;
          }
        };
      }
      if (upgradeId === 'regen') {
        return {
          id: 'ch_regen_2',
          desc: 'Collect 120 Food items in a run',
          condition: (r, s, c) => {
            const val = c?.foods ?? (s?.foods ?? (s?.Foods ?? 0));
            return val >= 120;
          }
        };
      }
      if (upgradeId === 'crown' || upgradeId === 'crest') {
        return {
          id: `ch_${upgradeId}_2`,
          desc: 'Collect 150 Food items in a run',
          condition: (r, s, c) => {
            const val = c?.foods ?? (s?.foods ?? (s?.Foods ?? 0));
            return val >= 150;
          }
        };
      }
    } else if (tier === 3) {
      // Bestiary Hunts
      if (upgradeId === 'fangs') {
        return {
          id: 'ch_fangs_3',
          desc: 'Slay 10 Magma Brutes in a run',
          condition: (r, s, c) => {
            const val = c?.magma_brutes ?? (c?.brutes ?? (c?.killsByType?.['brute'] ?? (c?.killsByType?.['magma_brute'] ?? (s?.magma_brutes ?? (s?.brutes ?? (s?.KillsByType?.['brute'] ?? (s?.killsByType?.['brute'] ?? 0)))))));
            return val >= 10;
          }
        };
      }
      if (upgradeId === 'venom') {
        return {
          id: 'ch_venom_3',
          desc: 'Slay 200 Enemies in a run',
          condition: (r, s, c) => {
            const val = c?.kills ?? (s?.kills ?? (s?.Kills ?? 0));
            return val >= 200;
          }
        };
      }

      // Combos
      if (upgradeId === 'tesla') {
        return {
          id: 'ch_tesla_3',
          desc: 'Maintain a Combo Streak of 40x',
          condition: (r, s, c) => {
            const val = c?.combo ?? (s?.combo ?? (s?.Combo ?? 0));
            return val >= 40;
          }
        };
      }
      if (upgradeId === 'magnet') {
        return {
          id: 'ch_magnet_3',
          desc: 'Maintain a Combo Streak of 35x',
          condition: (r, s, c) => {
            const val = c?.combo ?? (s?.combo ?? (s?.Combo ?? 0));
            return val >= 35;
          }
        };
      }

      // Boss Guardians
      if (upgradeId === 'turret') {
        return {
          id: 'ch_turret_3',
          desc: 'Defeat Prismatic Arachnid (Floor 15)',
          condition: (r, s, c) => {
            const fl = c ? (c.floor ?? 1) : (s ? (s.floor ?? (s.Floor ?? 1)) : 1);
            const b = c ? (c.bosses ?? 0) : (s ? (s.bosses ?? (s.Bosses ?? 0)) : 0);
            const bossesList = c?.defeatedBosses ?? (s?.defeatedBosses ?? (s?.DefeatedBosses ?? []));
            return fl > 15 || b >= 15 || bossesList.includes('crystal_monolith') || bossesList.includes('arachnid');
          }
        };
      }
      if (upgradeId === 'cryo') {
        return {
          id: 'ch_cryo_3',
          desc: 'Defeat The Eternal Ouroboros (Floor 20)',
          condition: (r, s, c) => {
            const fl = c ? (c.floor ?? 1) : (s ? (s.floor ?? (s.Floor ?? 1)) : 1);
            const b = c ? (c.bosses ?? 0) : (s ? (s.bosses ?? (s.Bosses ?? 0)) : 0);
            const vic = !!c?.summary?.Victory || !!c?.summary?.victory || !!s?.Victory || !!s?.victory;
            const bossesList = c?.defeatedBosses ?? (s?.defeatedBosses ?? (s?.DefeatedBosses ?? []));
            return fl > 20 || b >= 20 || vic || bossesList.includes('eternal_ouroboros');
          }
        };
      }
      if (upgradeId === 'flak') {
        return {
          id: 'ch_flak_3',
          desc: 'Defeat 15 Boss Guardians',
          condition: (r, s, c) => {
            const b = c ? (c.bosses ?? 0) : (s ? (s.bosses ?? (s.Bosses ?? 0)) : 0);
            return b >= 15;
          }
        };
      }
      if (upgradeId === 'horns') {
        return {
          id: 'ch_horns_3',
          desc: 'Defeat 16 Boss Guardians',
          condition: (r, s, c) => {
            const b = c ? (c.bosses ?? 0) : (s ? (s.bosses ?? (s.Bosses ?? 0)) : 0);
            return b >= 16;
          }
        };
      }
      if (upgradeId === 'spikes' || upgradeId === 'nanite') {
        return {
          id: `ch_${upgradeId}_3`,
          desc: 'Defeat 18 Boss Guardians',
          condition: (r, s, c) => {
            const b = c ? (c.bosses ?? 0) : (s ? (s.bosses ?? (s.Bosses ?? 0)) : 0);
            return b >= 18;
          }
        };
      }

      // Food
      if (upgradeId === 'needler') {
        return {
          id: 'ch_needler_3',
          desc: 'Collect 220 Food items in a run',
          condition: (r, s, c) => {
            const val = c?.foods ?? (s?.foods ?? (s?.Foods ?? 0));
            return val >= 220;
          }
        };
      }
      if (upgradeId === 'regen') {
        return {
          id: 'ch_regen_3',
          desc: 'Collect 250 Food items in a run',
          condition: (r, s, c) => {
            const val = c?.foods ?? (s?.foods ?? (s?.Foods ?? 0));
            return val >= 250;
          }
        };
      }
      if (upgradeId === 'crown' || upgradeId === 'crest') {
        return {
          id: `ch_${upgradeId}_3`,
          desc: 'Collect 300 Food items in a run',
          condition: (r, s, c) => {
            const val = c?.foods ?? (s?.foods ?? (s?.Foods ?? 0));
            return val >= 300;
          }
        };
      }

      // Length
      if (upgradeId === 'scattershot' || upgradeId === 'shield') {
        const req = this.GetScaledLengthRequirement(1200, ctx);
        return {
          id: `ch_${upgradeId}_3`,
          desc: `Grow Serpent to Length ${req}`,
          condition: (r, s, c) => (c ? (c.length ?? 1) >= req : false) || (s ? (s.length ?? (s.Length ?? 0)) >= req : false)
        };
      }
      if (upgradeId === 'magma') {
        const req = this.GetScaledLengthRequirement(1350, ctx);
        return {
          id: 'ch_magma_3',
          desc: `Grow Serpent to Length ${req}`,
          condition: (r, s, c) => (c ? (c.length ?? 1) >= req : false) || (s ? (s.length ?? (s.Length ?? 0)) >= req : false)
        };
      }
      if (upgradeId === 'plasma' || upgradeId === 'tachyon' || upgradeId === 'chrono' || upgradeId === 'maw') {
        const req = this.GetScaledLengthRequirement(1500, ctx);
        return {
          id: `ch_${upgradeId}_3`,
          desc: `Grow Serpent to Length ${req}`,
          condition: (r, s, c) => (c ? (c.length ?? 1) >= req : false) || (s ? (s.length ?? (s.Length ?? 0)) >= req : false)
        };
      }
      if (upgradeId === 'visor' || upgradeId === 'laser') {
        const req = this.GetScaledLengthRequirement(1800, ctx);
        return {
          id: `ch_${upgradeId}_3`,
          desc: `Grow Serpent to Length ${req}`,
          condition: (r, s, c) => (c ? (c.length ?? 1) >= req : false) || (s ? (s.length ?? (s.Length ?? 0)) >= req : false)
        };
      }
    }
    return null;
  }

  public IsModuleUnlocked(type: string): boolean {
    if (!type) return false;
    if (this.UpgradeLevels['unlock_' + type] && this.UpgradeLevels['unlock_' + type]! > 0) return true;
    if (type in this.UnlockedModules && this.UnlockedModules[type]) return true;
    return this.IsTierUnlocked(type, 1);
  }
  public isModuleUnlocked(type: string): boolean { return this.IsModuleUnlocked(type); }

  public UnlockModule(type: string): boolean {
    return this.UnlockTier(type, 1), true;
  }
  public unlockModule(type: string): boolean { return this.UnlockModule(type); }

  public ForceUnlockTier(id: string, tier: number): void {
    this.UnlockTier(id, tier);
  }
  public forceUnlockTier(id: string, tier: number): void {
    this.ForceUnlockTier(id, tier);
  }

  /* -------------------------- persistence -------------------------- */

  public Load(): void {
    try {
      if (this._options?.saveBackend) {
        const raw = this._options.saveBackend.read('ouroboros_meta_v2');
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            this.applySaveData(SaveIO.validateAndNormalizeV2(parsed));
          } catch {
            this.applySaveData(this._options.initialData ? SaveIO.validateAndNormalizeV2(this._options.initialData) : createDefaultMetaSave());
          }
        } else if (this._options.initialData) {
          this.applySaveData(SaveIO.validateAndNormalizeV2(this._options.initialData));
        } else {
          this.applySaveData(createDefaultMetaSave());
        }
        this.StorageBroken = false;
        return;
      }

      if (this._privateMemoryStore) {
        const raw = this._privateMemoryStore.get('ouroboros_meta_v2');
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            this.applySaveData(SaveIO.validateAndNormalizeV2(parsed));
          } catch {
            this.applySaveData(this._options?.initialData ? SaveIO.validateAndNormalizeV2(this._options.initialData) : createDefaultMetaSave());
          }
        } else if (this._options?.initialData) {
          this.applySaveData(SaveIO.validateAndNormalizeV2(this._options.initialData));
        } else {
          this.applySaveData(createDefaultMetaSave());
        }
        this.StorageBroken = false;
        return;
      }

      const data = SaveIO.loadMeta();
      this.applySaveData(data);
      this.StorageBroken = false;
    } catch (e: any) {
      this.applySaveData(createDefaultMetaSave());
      if (!this.StorageBroken) {
        this.StorageBroken = true;
        this.StorageError = e && e.message ? String(e.message) : String(e);
        console.warn(`OUROBOROS: progress cannot be loaded — ${this.StorageError}`);
      }
    }
  }
  public load(): void { this.Load(); }

  public Save(): void {
    try {
      const data = this.toSaveData();
      if (this._options?.saveBackend) {
        this._options.saveBackend.write('ouroboros_meta_v2', JSON.stringify(data));
        this.StorageBroken = false;
        return;
      }

      if (this._privateMemoryStore) {
        this._privateMemoryStore.set('ouroboros_meta_v2', JSON.stringify(data));
        this.StorageBroken = false;
        return;
      }

      const ok = SaveIO.saveMeta(data);
      if (!ok && SaveIO.lastError) {
        throw new Error(SaveIO.lastError);
      }
      this.StorageBroken = false;
    } catch (e: any) {
      if (!this.StorageBroken) {
        this.StorageBroken = true;
        this.StorageError = e && e.message ? String(e.message) : String(e);
        console.warn(`OUROBOROS: progress cannot be saved — ${this.StorageError}`);
      }
    }
  }
  public save(): void { this.Save(); }

  public Reset(): void {
    try {
      if (this._options?.saveBackend) {
        this._options.saveBackend.delete('ouroboros_meta_v2');
        this.applySaveData(createDefaultMetaSave());
        this.StorageBroken = false;
        return;
      }

      if (this._privateMemoryStore) {
        this._privateMemoryStore.delete('ouroboros_meta_v2');
        this.applySaveData(createDefaultMetaSave());
        this.StorageBroken = false;
        return;
      }

      const clean = SaveIO.resetMeta();
      this.applySaveData(clean);
      this.StorageBroken = false;
    } catch (e: any) {
      this.StorageBroken = true;
      this.StorageError = e && e.message ? String(e.message) : String(e);
    }
  }
  public reset(): void { this.Reset(); }
  public resetProgress(): void { this.Reset(); }

  private applySaveData(data: Partial<MetaSaveV2> | MetaSaveV2): void {
    this.Shards = typeof data.shards === 'number' && Number.isFinite(data.shards) ? Math.max(0, Math.floor(data.shards)) : 0;
    this.Ouro = typeof (data as any).ouro === 'number' && Number.isFinite((data as any).ouro) ? (data as any).ouro : 0;
    this.PrestigeMultiplier = typeof (data as any).prestigeMultiplier === 'number' && Number.isFinite((data as any).prestigeMultiplier)
      ? (data as any).prestigeMultiplier
      : 1.0;
    this.UnlockedClasses = { ...(data.unlockedClasses ?? { emerald: true }) };
    if (!this.UnlockedClasses.emerald) this.UnlockedClasses.emerald = true;

    this.UnlockedModules = { ...(data.unlockedModules ?? { turret: true, shield: true }) };
    this.UnlockedTiers = { ...(data.unlockedTiers ?? { turret: 1, shield: 1 }) };
    // Always guarantee starter defaults: turret and shield
    this.UnlockedTiers.turret = Math.max(1, this.UnlockedTiers.turret || 1);
    this.UnlockedTiers.shield = Math.max(1, this.UnlockedTiers.shield || 1);

    this.CompletedChallenges = { ...(data.completedChallenges ?? {}) };

    if (data.records) {
      for (const k of this.Records.Keys) {
        const val = (data.records as any)[k];
        if (typeof val === 'number' && Number.isFinite(val)) {
          this.Records.Set(k, Math.max(0, val));
        }
      }
      if (this.Records.HighestFloor < 1) this.Records.HighestFloor = 1;
      if (this.Records.HighestLevel < 1) this.Records.HighestLevel = 1;
    }

    if (data.helmets && Array.isArray(data.helmets)) {
      this.Helmets = data.helmets
        .filter((h: any) => h && typeof h === 'object' && (h.id || h.Id))
        .map((h: any) => normalizeHelmet(h));
    } else {
      this.Helmets = [];
    }
    this.EquippedHelmetId = data.equippedHelmetId ?? null;

    if (data.uniqueHelmets && Array.isArray(data.uniqueHelmets)) {
      this.UniqueHelmets = data.uniqueHelmets
        .map((h: any) => typeof h === 'string' ? h : (h?.id || h?.Id))
        .filter(Boolean);
    } else {
      this.UniqueHelmets = [];
    }
    this.Has9thHelmet = !!data.has9thHelmet;

    for (let i = 0; i < GameData.MetaUpgrades.Count; i++) {
      const key = GameData.MetaUpgrades.Keys[i]!;
      const def = GameData.MetaUpgrades.At(i);
      this.UpgradeLevels[key] = 0;
      if (data.upgrades) {
        const saved = data.upgrades[key];
        if (def && saved !== undefined) {
          const lvl = typeof saved === 'number' ? saved : (typeof saved === 'object' && typeof (saved as any).level === 'number' ? (saved as any).level : 0);
          if (Number.isFinite(lvl)) {
            this.UpgradeLevels[key] = Math.max(0, Math.min(def.MaxLevel, Math.floor(lvl)));
          }
        }
      }
    }

    if (data.dailyCapacityState && typeof data.dailyCapacityState === 'object') {
      this.DailyCapacityState = data.dailyCapacityState;
    } else {
      this.DailyCapacityState = null;
    }
  }

  private toSaveData(): MetaSaveV2 {
    const unlocked: Record<string, boolean> = {};
    for (let i = 0; i < GameData.Classes.Count; i++) {
      const id = GameData.Classes.Keys[i];
      if (id && this.UnlockedClasses[id]) unlocked[id] = true;
    }

    const levels: Record<string, { level: number }> = {};
    for (let i = 0; i < GameData.MetaUpgrades.Count; i++) {
      const key = GameData.MetaUpgrades.Keys[i]!;
      levels[key] = { level: this.Level(key) };
    }

    const recs: SaveRecords = {
      highScore: this.Records.HighScore,
      highestFloor: this.Records.HighestFloor,
      highestCombo: this.Records.HighestCombo,
      highestLevel: this.Records.HighestLevel,
      totalRuns: this.Records.TotalRuns,
      victories: this.Records.Victories,
      totalKills: this.Records.TotalKills,
      totalFoods: this.Records.TotalFoods,
      totalBosses: this.Records.TotalBosses,
      totalShards: this.Records.TotalShards,
      playTimeSec: this.Records.PlayTimeSec,
      bestTimeSec: this.Records.BestTimeSec,
    };

    return {
      version: 2,
      shards: this.Shards,
      ouro: this.Ouro,
      prestigeMultiplier: this.PrestigeMultiplier,
      unlockedClasses: unlocked,
      records: recs,
      upgrades: levels,
      unlockedModules: { ...this.UnlockedModules },
      unlockedTiers: { ...this.UnlockedTiers },
      completedChallenges: { ...this.CompletedChallenges },
      helmets: [...this.Helmets],
      uniqueHelmets: [...this.UniqueHelmets],
      has9thHelmet: this.Has9thHelmet,
      equippedHelmetId: this.EquippedHelmetId,
      dailyCapacityState: this.DailyCapacityState,
    };
  }

  /* --------------------------- shop logic --------------------------- */

  /**
   * Retrieves the current purchased level for a meta-upgrade blessing.
   *
   * @param key Upgrade identifier key (e.g. 'vitality', 'ferocity', 'resilience').
   * @returns Current level integer $\ge 0$.
   */
  public Level(key: string | null | undefined): number {
    if (!key) return 0;
    return this.UpgradeLevels[key] ?? 0;
  }
  public level(key: string | null | undefined): number { return this.Level(key); }
  public getUpgradeLevel(key: string | null | undefined): number { return this.Level(key); }

  /**
   * Computes the Essence Shard cost to purchase the next tier of a Sanctuary meta-upgrade:
   *
   * Mathematical Progression Formula (ORACLE.md §10.2):
   *   $$C(L) = \left\lfloor C_0 \cdot (M_{\text{cost}})^L + 0.5 \right\rfloor$$
   *
   * ASCII:
   *   cost = roundJs(BaseCost * (CostMult ^ currentLevel))
   *
   * Where:
   * - $C_0 = \text{BaseCost}$: Initial tier cost.
   * - $M_{\text{cost}} = \text{CostMult}$: Exponential cost multiplier per tier ($1.5$ to $2.1$).
   * - $L = \text{currentLevel}$: Current level in $[0, \text{MaxLevel}]$.
   *
   * @param key Upgrade identifier.
   * @returns Essence Shard cost, or $\infty$ if key is invalid or already at MaxLevel.
   */
  public GetUpgradeCost(key: string | null | undefined): number {
    if (!key || !GameData.MetaUpgrades.Has(key)) return Number.POSITIVE_INFINITY;
    const up = GameData.MetaUpgrades.Get(key)!;
    const lvl = this.Level(key);
    if (lvl >= up.MaxLevel) return Number.POSITIVE_INFINITY;
    return MathX.roundJs(up.BaseCost * Math.pow(up.CostMult, lvl));
  }
  public getUpgradeCost(key: string | null | undefined): number { return this.GetUpgradeCost(key); }

  /**
   * Purchases the next level of a Sanctuary upgrade, deducting the cost atomically from the Shards balance:
   *
   * Invariants:
   * - Level must be strictly less than `MaxLevel`.
   * - Wallet balance must satisfy: $\text{Shards} \ge C(L)$.
   * - On success, updates $\text{UpgradeLevels}[key] \leftarrow L + 1$, persists save, returns `true`.
   *
   * @param key Upgrade identifier.
   * @returns True if successfully purchased and saved, false otherwise.
   */
  public BuyUpgrade(key: string | null | undefined): boolean {
    if (!key || !GameData.MetaUpgrades.Has(key)) return false;
    const up = GameData.MetaUpgrades.Get(key)!;
    const lvl = this.Level(key);
    if (lvl >= up.MaxLevel) return false;
    const cost = this.GetUpgradeCost(key);
    if (this.Shards < cost) return false;
    this.Shards -= cost;
    this.UpgradeLevels[key] = lvl + 1;
    this.Save();
    return true;
  }
  public buyUpgrade(key: string | null | undefined): boolean { return this.BuyUpgrade(key); }

  /**
   * Verifies whether a playable serpent class is currently unlocked:
   *
   * Unlock Criteria:
   * - Primordial class ('emerald') has $\text{Cost} = 0$ and is unlocked by default.
   * - Advanced classes ('stalker', 'hydra', 'storm', 'solar') require explicit unlock purchase.
   *
   * @param classId Serpent class identifier.
   * @returns True if unlocked and selectable.
   */
  public IsUnlocked(classId: string | null | undefined): boolean {
    if (!classId) return false;
    const cls = GameData.Classes.Get(classId);
    if (!cls) return false;
    return cls.Cost === 0 || !!this.UnlockedClasses[classId];
  }
  public isUnlocked(classId: string | null | undefined): boolean { return this.IsUnlocked(classId); }

  /**
   * Purchases and unlocks an advanced serpent class using persistent Essence Shards:
   *
   * Invariants:
   * - Returns `true` immediately if already unlocked.
   * - Deducts $\text{cls.Cost}$ from $\text{Shards}$ and sets $\text{UnlockedClasses}[classId] = \text{true}$.
   * - Automatically saves state to persistent storage.
   *
   * @param classId Serpent class identifier.
   * @returns True if successfully unlocked or already owned, false if insufficient shards.
   */
  public UnlockClass(classId: string | null | undefined): boolean {
    if (!classId) return false;
    const cls = GameData.Classes.Get(classId);
    if (!cls) return false;
    if (this.IsUnlocked(classId)) return true;
    if (this.Shards < cls.Cost) return false;
    this.Shards -= cls.Cost;
    this.UnlockedClasses[classId] = true;
    this.Save();
    return true;
  }
  public unlockClass(classId: string | null | undefined): boolean { return this.UnlockClass(classId); }

  /**
   * Atomically credits persistent Essence Shards to the player vault and updates lifetime records:
   *
   * Formula:
   *   $$\text{Shards}_{\text{vault}} \leftarrow \text{Shards}_{\text{vault}} + \lfloor n \rfloor$$
   *   $$\text{TotalShards}_{\text{lifetime}} \leftarrow \text{TotalShards}_{\text{lifetime}} + \lfloor n \rfloor$$
   *
   * @param n Positive shard quantity to add.
   * @returns Integer shards successfully credited.
   */
  public AddShards(n: number): number {
    if (!Number.isFinite(n) || n <= 0) return 0;
    const added = Math.floor(n);
    this.Shards += added;
    this.Records.TotalShards += added;
    return added;
  }
  public addShards(n: number): number { return this.AddShards(n); }
  public AddStars(n: number): number { return this.AddShards(n); }
  public addStars(n: number): number { return this.AddShards(n); }

  /* ---------------------------- the draft ---------------------------- */

  private static readonly RarityNames = ['common', 'rare', 'epic', 'legendary'] as const;

  /**
   * Generates a random card draft selection obeying rarity probability weights and Gilded Fate luck tiers:
   *
   * Probability Distribution Formulation (ORACLE.md §4.2):
   * Given player's Gilded Fate luck level $F \in [0, 3]$:
   *   $$W_{\text{common}} = \max(18, 54 - 7F)$$
   *   $$W_{\text{rare}} = 28 + 2F$$
   *   $$W_{\text{epic}} = 13 + 3F$$
   *   $$W_{\text{legendary}} = 5 + 2F$$
   *
   * Normalized Tier Selection:
   * For available pool $P$:
   *   $$W_{\text{total}} = \sum_{r \in \text{Present}(P)} W_r$$
   *   $$P(\text{Rarity} = r) = \frac{W_r}{W_{\text{total}}}$$
   *
   * Invariants:
   * - Cards already at MaxStacks for the player are excluded from the draft pool.
   * - Duplicate cards are never offered in the same draft roll.
   * - Results are sorted ascending by rarity rank (Common $\to$ Legendary).
   *
   * @param count Number of draft options to offer (nominal: 3).
   * @param player Optional active player reference to query card stacks.
   * @returns Array of unique offered CardDef items.
   */
  public GetRandomCardDraft(count: number, player?: any): CardDef[] {
    const draftCount = count > 0 ? count : 3;
    const luck = this.Level('fortune');

    const taken: Record<string, number> | undefined = player?.cardStacks ?? player?.CardStacks;
    const available: CardDef[] = [];
    const pool0 = GameData.CardPool;

    for (let i = 0; i < pool0.length; i++) {
      const c = pool0[i]!;
      const stacks = taken?.[c.Id] ?? 0;
      const max = c.MaxStacks > 0 ? c.MaxStacks : 1;
      if (stacks < max) available.push(c);
    }

    const selected: CardDef[] = [];
    if (available.length === 0) return selected;

    const weights = [
      Math.max(18, 54 - luck * 7),
      28 + luck * 2,
      13 + luck * 3,
      5 + luck * 2,
    ];

    const pool = available.slice();
    const rng = this._rng ?? this._services?.Engine?.rng ?? Rng.Shared;

    for (let i = 0; i < draftCount && pool.length > 0; i++) {
      const present = [false, false, false, false];
      for (let j = 0; j < pool.length; j++) {
        const ri = this.rarityIndex(pool[j]!.Rarity);
        if (ri >= 0 && ri < 4) present[ri] = true;
      }

      let total = 0;
      for (let r = 0; r < 4; r++) {
        if (present[r]) total += weights[r]!;
      }

      let roll = rng.rand() * total;
      let chosen: string | null = null;
      for (let r = 0; r < 4; r++) {
        if (!present[r]) continue;
        roll -= weights[r]!;
        if (roll <= 0) {
          chosen = MetaProgression.RarityNames[r]!;
          break;
        }
      }
      if (!chosen) chosen = pool[pool.length - 1]!.Rarity;

      const matching: CardDef[] = [];
      for (let j = 0; j < pool.length; j++) {
        if (pool[j]!.Rarity === chosen) matching.push(pool[j]!);
      }

      const idx = Math.floor(rng.rand() * matching.length);
      const card = matching[idx] ?? pool[0]!;
      selected.push(card);
      const rmIdx = pool.indexOf(card);
      if (rmIdx >= 0) pool.splice(rmIdx, 1);
    }

    return selected.sort((a, b) => this.rarityRank(a.Rarity) - this.rarityRank(b.Rarity));
  }
  public getRandomCardDraft(count: number, player?: any): CardDef[] {
    return this.GetRandomCardDraft(count, player);
  }

  private rarityIndex(rarity: string): number {
    for (let i = 0; i < MetaProgression.RarityNames.length; i++) {
      if (MetaProgression.RarityNames[i] === rarity) return i;
    }
    return -1;
  }

  private rarityRank(rarity: string): number {
    return (rarity && GameData.RarityOrder[rarity] !== undefined) ? GameData.RarityOrder[rarity]! : 0;
  }

  /* ---------------------------- run results ---------------------------- */

  public CommitRun(summary?: RunSummary | null): void {
    if (!summary) return;
    const r = this.Records;
    r.TotalRuns++;
    r.TotalKills += summary.Kills ?? summary.kills ?? 0;
    r.TotalFoods += summary.Foods ?? summary.foods ?? 0;
    r.TotalBosses += summary.Bosses ?? summary.bosses ?? 0;
    const time = Number.isFinite(summary.TimeSec ?? summary.timeSec) ? (summary.TimeSec ?? summary.timeSec ?? 0) : 0;
    r.PlayTimeSec += time;
    if (summary.Victory ?? summary.victory) r.Victories++;
    const sc = summary.Score ?? summary.score ?? 0;
    if (sc > r.HighScore) r.HighScore = sc;
    const fl = (summary.Floor ?? summary.floor ?? 1) > 0 ? (summary.Floor ?? summary.floor ?? 1) : 1;
    if (fl > r.HighestFloor) r.HighestFloor = fl;
    const cb = summary.Combo ?? summary.combo ?? 0;
    if (cb > r.HighestCombo) r.HighestCombo = cb;
    const lvl = (summary.Level ?? summary.level ?? 1) > 0 ? (summary.Level ?? summary.level ?? 1) : 1;
    if (lvl > r.HighestLevel) r.HighestLevel = lvl;
    if (time > r.BestTimeSec) r.BestTimeSec = time;

    this.EvaluateChallenges(summary);
    this.Save();
  }
  public commitRun(summary?: RunSummary | null): void { this.CommitRun(summary); }
}

// Wire the Meta provider into ambient Services
Services.registerMetaProvider(() => MetaProgression.Instance);
