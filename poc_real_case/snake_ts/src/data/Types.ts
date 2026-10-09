/**
 * Ouroboros Ascension — Data Types & Models (Types.ts)
 *
 * Enums, interfaces, and collection wrappers for classes, enemies, bosses,
 * cards, relics, foods, and upgrades ported from C# Data.Types.
 */

export interface SkillDef {
  Name: string;
  Icon: string;
  Cooldown: number;
  Desc: string;
  name: string;
  icon: string;
  cooldown: number;
  desc: string;
}

export interface BaseStatsDef {
  MaxHp: number;
  Speed: number;
  DashCooldown: number;
  BitePower: number;
  MagnetRadius: number;
  CritChance: number;
  CritMult: number;
  Armor: number;
  maxHp: number;
  speed: number;
  dashCooldown: number;
  bitePower: number;
  magnetRadius: number;
  critChance: number;
  critMult: number;
  armor: number;
}

export interface SnakeClassDef {
  Id: string;
  Name: string;
  Icon: string;
  Color: string;
  Accent: string;
  Cost: number;
  Passive: string;
  Desc: string;
  Skill: SkillDef;
  BaseStats: BaseStatsDef;
  id: string;
  name: string;
  icon: string;
  color: string;
  accent: string;
  cost: number;
  passive: string;
  desc: string;
  skill: SkillDef;
  baseStats: BaseStatsDef;
}

export type CardRarity = 'common' | 'rare' | 'epic' | 'legendary';

/**
 * A draft card. `Apply` is the port of the JS `apply(player)` lambda.
 */
export interface CardDef {
  Id: string;
  Title: string;
  Rarity: CardRarity | string;
  Icon: string;
  MaxStacks: number;
  Desc: string;
  Stats: string;
  Apply: (player: any) => void;
  id: string;
  title: string;
  rarity: CardRarity | string;
  icon: string;
  maxStacks: number;
  desc: string;
  stats: string;
  apply: (player: any) => void;
}

export interface EnemyTypeDef {
  Key: string;
  Hp: number;
  HpPerFloor: number;
  Speed: number;
  Radius: number;
  Color: string;
  Dmg: number;
  DmgPerFloor: number;
  Xp: number;
  Score: number;
  MinFloor: number;
  key: string;
  hp: number;
  hpPerFloor: number;
  speed: number;
  radius: number;
  color: string;
  dmg: number;
  dmgPerFloor: number;
  xp: number;
  score: number;
  minFloor: number;
}

export interface BossArchetypeDef {
  Type: string;
  Name: string;
  Color: string;
  Accent: string;
  BaseHp: number;
  HpPerFloor: number;
  Radius: number;
  Title: string;
  type: string;
  name: string;
  color: string;
  accent: string;
  baseHp: number;
  hpPerFloor: number;
  radius: number;
  title: string;
}

export interface FoodTypeDef {
  Key: string;
  Name?: string;
  Color: string;
  Glyph: string;
  Xp: number;
  Score: number;
  Radius: number;
  Heal: number;
  key: string;
  name?: string;
  color: string;
  glyph: string;
  xp: number;
  score: number;
  radius: number;
  heal: number;
}

export interface ComboTierDef {
  At: number;
  Mult: number;
  at: number;
  mult: number;
}

export interface GameModeDef {
  Key: string;
  Label: string;
  Floors: number;
  BossRush: boolean;
  Seeded: boolean;
  key: string;
  label: string;
  floors: number;
  bossRush: boolean;
  seeded: boolean;
}

export interface MetaUpgradeDef {
  Key: string;
  Name: string;
  Icon: string;
  MaxLevel: number;
  BaseCost: number;
  CostMult: number;
  Bonus: string;
  Effect: number;
  key: string;
  name: string;
  icon: string;
  maxLevel: number;
  baseCost: number;
  costMult: number;
  bonus: string;
  effect: number;
}

export interface SocketModuleDef {
  Key: string;
  Name: string;
  Icon: string;
  Category: 'offense' | 'defense';
  Desc?: string;
  Description?: string;
  UnlockCost?: number;
  UnlockFloor?: number;
  BaseCost?: number;
  CostPerTier?: number;
  key: string;
  name: string;
  icon: string;
  category: 'offense' | 'defense';
  desc?: string;
  description?: string;
  unlockCost?: number;
  unlockFloor?: number;
  baseCost?: number;
  costPerTier?: number;
}

export type HelmetRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

export interface HelmetStats {
  MaxHp?: number;
  Armor?: number;
  Speed?: number;
  BitePower?: number;
  CritChance?: number;
  CritMult?: number;
  HpRegen?: number;
  Shield?: number;
  MagnetRadius?: number;
  DashCooldown?: number;
  XpMultiplier?: number;
  ShardMultiplier?: number;
  Thorns?: number;
  StunDuration?: number;

  maxHp?: number;
  armor?: number;
  speed?: number;
  bitePower?: number;
  critChance?: number;
  critMult?: number;
  hpRegen?: number;
  shield?: number;
  magnetRadius?: number;
  dashCooldown?: number;
  xpMultiplier?: number;
  shardMultiplier?: number;
  thorns?: number;
  stunDuration?: number;
}

export interface HelmetDef {
  Id: string;
  Name: string;
  Icon: string;
  Rarity: HelmetRarity;
  Stats: HelmetStats;
  Description?: string;
  Floor?: number;
  BossType?: string;
  BossId?: string;
  Color?: string;
  GlowColor?: string;
  BorderColor?: string;
  Image?: string;
  image?: string;

  id?: string;
  name?: string;
  icon?: string;
  rarity?: HelmetRarity;
  stats?: HelmetStats;
  description?: string;
  floor?: number;
  bossType?: string;
  bossId?: string;
  color?: string;
  glowColor?: string;
  borderColor?: string;
}

export interface AlchemicalFusionDef {
  Id: string;
  Name: string;
  Icon: string;
  ModuleA: string;
  ModuleB: string;
  Desc: string;

  id?: string;
  name?: string;
  icon?: string;
  moduleA?: string;
  moduleB?: string;
  desc?: string;
}





/**
 * Keyed table preserving deterministic declaration order.
 * Dual PascalCase/camelCase API.
 */
export class OrderedTable<T> {
  private readonly _keys: string[] = [];
  private readonly _values: T[] = [];
  private readonly _map = new Map<string, T>();

  public Add(key: string, value: T): void {
    if (this._map.has(key)) {
      const idx = this._keys.indexOf(key);
      this._values[idx] = value;
      this._map.set(key, value);
      return;
    }
    this._keys.push(key);
    this._values.push(value);
    this._map.set(key, value);
  }
  public add(key: string, value: T): void { this.Add(key, value); }

  public Get(key: string): T | undefined {
    return this._map.get(key);
  }
  public get(key: string): T | undefined { return this.Get(key); }

  public Has(key: string): boolean {
    return this._map.has(key);
  }
  public has(key: string): boolean { return this.Has(key); }

  public At(index: number): T | undefined {
    if (index < 0 || index >= this._values.length) return undefined;
    return this._values[index];
  }
  public at(index: number): T | undefined { return this.At(index); }

  public KeyAt(index: number): string | undefined {
    if (index < 0 || index >= this._keys.length) return undefined;
    return this._keys[index];
  }
  public keyAt(index: number): string | undefined { return this.KeyAt(index); }

  public get Count(): number {
    return this._keys.length;
  }
  public get count(): number { return this.Count; }

  public get length(): number {
    return this._keys.length;
  }

  public get Keys(): readonly string[] {
    return this._keys;
  }
  public get keys(): readonly string[] { return this.Keys; }

  public get Values(): readonly T[] {
    return this._values;
  }
  public get values(): readonly T[] { return this.Values; }

  public [Symbol.iterator](): Iterator<T> {
    return this._values[Symbol.iterator]();
  }

  public forEach(callback: (value: T, index: number, array: T[]) => void): void {
    this._values.forEach(callback);
  }

  public map<U>(callback: (value: T, index: number, array: T[]) => U): U[] {
    return this._values.map(callback);
  }

  public filter(predicate: (value: T, index: number, array: T[]) => boolean): T[] {
    return this._values.filter(predicate);
  }

  public find(predicate: (value: T, index: number, array: T[]) => boolean): T | undefined {
    return this._values.find(predicate);
  }
}

/** Rolling range bracket for a single capacity parameter tier. */
export interface CapacityRangeBracket {
  Min: number;
  Max: number;
  IsInteger?: boolean;
  Unit?: string;

  min?: number;
  max?: number;
  isInteger?: boolean;
  unit?: string;
}

/** Definition of a single parameter state across its 3 tier brackets. */
export interface CapacityParamDef {
  Key: string;
  Name: string;
  Description: string;
  Unit: string;
  IsInteger?: boolean;
  HigherIsBetter?: boolean;
  Tier1: CapacityRangeBracket;
  Tier2: CapacityRangeBracket;
  Tier3: CapacityRangeBracket;

  key?: string;
  name?: string;
  description?: string;
  unit?: string;
  isInteger?: boolean;
  higherIsBetter?: boolean;
  tier1?: CapacityRangeBracket;
  tier2?: CapacityRangeBracket;
  tier3?: CapacityRangeBracket;
}

/** Authoritative Static Cosmic Capacity Definition (1 of 12). */
export interface CosmicCapacityDef {
  Id: string;
  Name: string;
  Icon: string;
  Color: string;
  Accent: string;
  Description: string;
  StateA: CapacityParamDef;
  StateB: CapacityParamDef;
  StateC: CapacityParamDef;
  FloorScalingRate: number;

  id?: string;
  name?: string;
  icon?: string;
  color?: string;
  accent?: string;
  description?: string;
  desc?: string;
  stateA?: CapacityParamDef;
  stateB?: CapacityParamDef;
  stateC?: CapacityParamDef;
  floorScalingRate?: number;
}

/** Active rolled state for an individual parameter at a specific floor. */
export interface RolledCapacityState {
  Key: string;
  Name: string;
  Tier: 1 | 2 | 3;
  RawValue: number;
  ScaledValue: number;
  Unit: string;
  Description: string;

  key?: string;
  name?: string;
  tier?: 1 | 2 | 3;
  rawValue?: number;
  scaledValue?: number;
  unit?: string;
  description?: string;
}

/** Complete active instance of a Cosmic Capacity rolled for a daily run and floor. */
export interface RolledCosmicCapacity {
  Def: CosmicCapacityDef;
  Seed: number;
  Floor: number;
  OverallTier: 1 | 2 | 3;
  StateA: RolledCapacityState;
  StateB: RolledCapacityState;
  StateC: RolledCapacityState;
  PowerRating: number;

  def: CosmicCapacityDef;
  seed: number;
  floor: number;
  overallTier: 1 | 2 | 3;
  stateA: RolledCapacityState;
  stateB: RolledCapacityState;
  stateC: RolledCapacityState;
  powerRating: number;
}

/** Daily Special Capacity state model persisted across runs for 24 hours. */
export interface DailyCapacityState {
  id: string;
  name: string;
  icon: string;
  desc: string;
  stateValues: Record<string, number>;
  rolledTiers: Record<string, number>;
  unlockedAt: number;
  expiresAt: number;
  currentFloorBoost: number;
  milestoneTier?: number;
  milestoneLevel?: number;
  milestoneBonus?: number;
  milestoneBoost?: number;

  Id?: string;
  Name?: string;
  Icon?: string;
  Desc?: string;
  StateValues?: Record<string, number>;
  RolledTiers?: Record<string, number>;
  UnlockedAt?: number;
  ExpiresAt?: number;
  CurrentFloorBoost?: number;
  MilestoneTier?: number;
  MilestoneLevel?: number;
  MilestoneBonus?: number;
  MilestoneBoost?: number;
}

export interface ChallengeContext {
  records?: any;
  summary?: any;
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
}

