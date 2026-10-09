import { Boss } from "./Boss.js";
import { GameData } from "../data/GameData.js";
import { MetaProgression } from "../data/MetaProgression.js";
import { HelmetDef, BossArchetypeDef } from "../data/Types.js";
import { GameEngine } from "./GameEngine.js";

export interface BossRushGauntletState {
  active: boolean;
  waveIndex: number;
  waveTimer: number;
  bossesSpawned: number;
  bossesDefeated: number;
  totalBosses: number;
  allSpawned: boolean;
  victory: boolean;
  defeat: boolean;
}

export function BossRushGauntletState(active: boolean, waveIndex: number, waveTimer: number, bossesSpawned: number, bossesDefeated: number, totalBosses: number, allSpawned: boolean, victory: boolean, defeat: boolean): BossRushGauntletState {
  return { active, waveIndex, waveTimer, bossesSpawned, bossesDefeated, totalBosses, allSpawned, victory, defeat };
}

export const GAUNTLET_BOSS_ARCHETYPES: BossArchetypeDef[] = [{ Type: "centipede", type: "centipede", Name: "Centipede Behemoth", name: "Centipede Behemoth", Color: "#ff3366", color: "#ff3366", Accent: "#ff4d6d", accent: "#ff4d6d", BaseHp: 450, baseHp: 450, HpPerFloor: 180, hpPerFloor: 180, Radius: 30, radius: 30, Title: "The rival coil that outgrew its arena", title: "The rival coil that outgrew its arena" }, { Type: "gorgon", type: "gorgon", Name: "Storm Gorgon", name: "Storm Gorgon", Color: "#00f0b5", color: "#00f0b5", Accent: "#38bdf8", accent: "#38bdf8", BaseHp: 650, baseHp: 650, HpPerFloor: 220, hpPerFloor: 220, Radius: 32, radius: 32, Title: "Volt sovereign of atmospheric tempests", title: "Volt sovereign of atmospheric tempests" }, { Type: "quantum_hydra", type: "quantum_hydra", Name: "Hydra Apex", name: "Hydra Apex", Color: "#c084fc", color: "#c084fc", Accent: "#e879f9", accent: "#e879f9", BaseHp: 1200, baseHp: 1200, HpPerFloor: 300, hpPerFloor: 300, Radius: 36, radius: 36, Title: "Multiverse serpent splitting into probabilistic reality coils", title: "Multiverse serpent splitting into probabilistic reality coils" }, { Type: "colossus", type: "colossus", Name: "Infernal Colossus", name: "Infernal Colossus", Color: "#ff9e00", color: "#ff9e00", Accent: "#ffb703", accent: "#ffb703", BaseHp: 900, baseHp: 900, HpPerFloor: 280, hpPerFloor: 280, Radius: 34, radius: 34, Title: "A furnace that learned to walk", title: "A furnace that learned to walk" }, { Type: "leviathan", type: "leviathan", Name: "Astral Leviathan", name: "Astral Leviathan", Color: "#9d4edd", color: "#9d4edd", Accent: "#c77dff", accent: "#c77dff", BaseHp: 1800, baseHp: 1800, HpPerFloor: 400, hpPerFloor: 400, Radius: 35, radius: 35, Title: "It writes spirals in the dark and calls them law", title: "It writes spirals in the dark and calls them law" }, { Type: "chronowyrm", type: "chronowyrm", Name: "Chrono Wyrm", name: "Chrono Wyrm", Color: "#a855f7", color: "#a855f7", Accent: "#e0aaff", accent: "#e0aaff", BaseHp: 1500, baseHp: 1500, HpPerFloor: 400, hpPerFloor: 400, Radius: 33, radius: 33, Title: "Master of temporal dilation and paradox clones", title: "Master of temporal dilation and paradox clones" }, { Type: "void_devourer", type: "void_devourer", Name: "Void Serpent", name: "Void Serpent", Color: "#7928ca", color: "#7928ca", Accent: "#b5179e", accent: "#b5179e", BaseHp: 2200, baseHp: 2200, HpPerFloor: 450, hpPerFloor: 450, Radius: 37, radius: 37, Title: "Abyssal gravity maw consuming arena matter and light", title: "Abyssal gravity maw consuming arena matter and light" }, { Type: "volcanic_chimera", type: "volcanic_chimera", Name: "Solar Chimera", name: "Solar Chimera", Color: "#dc2626", color: "#dc2626", Accent: "#f87171", accent: "#f87171", BaseHp: 2500, baseHp: 2500, HpPerFloor: 500, hpPerFloor: 500, Radius: 37, radius: 37, Title: "Tri-headed subterranean beast erupting magma fountains and solar pyres", title: "Tri-headed subterranean beast erupting magma fountains and solar pyres" }];

export const THE_NINTH_HELMET: unknown = { Id: "helm_ouroboros_ascension_9th", id: "helm_ouroboros_ascension_9th", CanonicalId: "unique_eternal_ouroboros_crown", canonicalId: "unique_eternal_ouroboros_crown", AliasId: "unique_helm_celestial_ouroboros", aliasId: "unique_helm_celestial_ouroboros", Name: "Crown of the Eternal Ouroboros", name: "Crown of the Eternal Ouroboros", Icon: "👑", icon: "👑", Rarity: "mythic", rarity: "mythic", Description: "The 9th cranial singularity forged from 8 conquered apex titan souls. Grants total transcendence.", description: "The 9th cranial singularity forged from 8 conquered apex titan souls. Grants total transcendence.", Floor: 9, floor: 9, BossType: "eternal_ouroboros", bossType: "eternal_ouroboros", Stats: { maxHp: 150, armor: 0.25, speed: 0.35, bitePower: 35, critChance: 0.3, critMult: 2, shield: 150, hpRegen: 8, thorns: 0.75 }, stats: { maxHp: 150, armor: 0.25, speed: 0.35, bitePower: 35, critChance: 0.3, critMult: 2, shield: 150, hpRegen: 8, thorns: 0.75 } };

export class BossRushGauntlet {
  state: BossRushGauntletState;
  trackedBosses: unknown[] = [];
  get_State(): BossRushGauntletState {
    return this.state;
  }
  get_active(): boolean {
    return this.state.active;
  }
  set_active(v: boolean): void {
    this.state.active = v;
  }
  get_Active(): boolean {
    return this.state.active;
  }
  set_Active(v: boolean): void {
    this.state.active = v;
  }
  get_waveIndex(): number {
    return this.state.waveIndex;
  }
  set_waveIndex(v: number): void {
    this.state.waveIndex = v;
  }
  get_WaveIndex(): number {
    return this.state.waveIndex;
  }
  set_WaveIndex(v: number): void {
    this.state.waveIndex = v;
  }
  get_waveTimer(): number {
    return this.state.waveTimer;
  }
  set_waveTimer(v: number): void {
    this.state.waveTimer = v;
  }
  get_WaveTimer(): number {
    return this.state.waveTimer;
  }
  set_WaveTimer(v: number): void {
    this.state.waveTimer = v;
  }
  get_bossesSpawned(): number {
    return this.state.bossesSpawned;
  }
  set_bossesSpawned(v: number): void {
    this.state.bossesSpawned = v;
  }
  get_BossesSpawned(): number {
    return this.state.bossesSpawned;
  }
  set_BossesSpawned(v: number): void {
    this.state.bossesSpawned = v;
  }
  get_bossesDefeated(): number {
    return this.state.bossesDefeated;
  }
  set_bossesDefeated(v: number): void {
    this.state.bossesDefeated = v;
  }
  get_BossesDefeated(): number {
    return this.state.bossesDefeated;
  }
  set_BossesDefeated(v: number): void {
    this.state.bossesDefeated = v;
  }
  get_totalBosses(): number {
    return this.state.totalBosses;
  }
  set_totalBosses(v: number): void {
    this.state.totalBosses = v;
  }
  get_TotalBosses(): number {
    return this.state.totalBosses;
  }
  set_TotalBosses(v: number): void {
    this.state.totalBosses = v;
  }
  get_allSpawned(): boolean {
    return this.state.allSpawned;
  }
  set_allSpawned(v: boolean): void {
    this.state.allSpawned = v;
  }
  get_AllSpawned(): boolean {
    return this.state.allSpawned;
  }
  set_AllSpawned(v: boolean): void {
    this.state.allSpawned = v;
  }
  get_victory(): boolean {
    return this.state.victory;
  }
  set_victory(v: boolean): void {
    this.state.victory = v;
  }
  get_Victory(): boolean {
    return this.state.victory;
  }
  set_Victory(v: boolean): void {
    this.state.victory = v;
  }
  get_defeat(): boolean {
    return this.state.defeat;
  }
  set_defeat(v: boolean): void {
    this.state.defeat = v;
  }
  get_Defeat(): boolean {
    return this.state.defeat;
  }
  set_Defeat(v: boolean): void {
    this.state.defeat = v;
  }
  constructor() {
    this.state = { active: false, waveIndex: 0, waveTimer: 8, bossesSpawned: 0, bossesDefeated: 0, totalBosses: 8, allSpawned: false, victory: false, defeat: false };
  }
  start(engine: GameEngine): void {
    this.state = { active: true, waveIndex: 0, waveTimer: 8, bossesSpawned: 0, bossesDefeated: 0, totalBosses: 8, allSpawned: false, victory: false, defeat: false };
    this.trackedBosses = [];
    if ((engine !== null)) {
      if (Array.isArray(engine.ActiveBosses)) {
        engine.ActiveBosses.length = 0;
      }
      this.spawnBossForWave(0, engine);
      this.state.bossesSpawned = 1;
      this.state.waveIndex = 0;
      this.state.waveTimer = 8;
      if ((typeof (engine.Banner) === "function")) {
        engine.Banner("⚡ ALL-BOSS GAUNTLET: WAVE 1/8 [CENTIPEDE] ⚡", 2.5);
      }
      if ((engine.Sound?.PlayBossAlert !== null)) {
        engine.Sound.PlayBossAlert();
        engine.Sound.SetBossMode(true);
      }
    }
  }
  Start(engine: GameEngine): void {
    this.start(engine);
  }
  spawnBossForWave(waveIdx: number, engine: GameEngine): Boss {
    const safeIdx = Math.max(0, Math.min((GAUNTLET_BOSS_ARCHETYPES.length - 1), waveIdx));
    const arch = GAUNTLET_BOSS_ARCHETYPES[safeIdx];
    const arenaW = ((engine?.ArenaW ?? engine?.arenaW) ?? 1800);
    const arenaH = ((engine?.ArenaH ?? engine?.arenaH) ?? 1800);
    const floor = ((engine?.CurrentFloor ?? engine?.currentFloor) ?? 8);
    const spreadFraction = ((safeIdx + (1 / this.state.totalBosses)) + 1);
    const startX = ((arenaW * 0.15) + (spreadFraction * 0.7));
    const startY = ((arenaH * 0.22) + ((safeIdx % 2) * 0.12));
    const boss = null;
    if (Array.isArray(engine?.ActiveBosses)) {
      engine.ActiveBosses.push(boss);
    }
    this.trackedBosses.push({ boss, dead: false });
    if ((engine?.Fx?.RingShockwave !== null)) {
      engine.Fx.RingShockwave(boss.X, boss.Y, boss.Color, 90, 0.02);
      engine.Fx.Flash(boss.Color, 0.25, 0.35);
    }
    if ((typeof (engine?.Banner) === "function")) {
      engine.Banner(null, 2);
    }
    if ((typeof (engine?.OnBossBox) === "function")) {
      engine.OnBossBox(true, null);
    }
    if ((engine?.Sound?.PlayBossAlert !== null)) {
      engine.Sound.PlayBossAlert();
    }
    return boss;
  }
  update(dt: number, engine: GameEngine): void {
    if (((!(this.state.active) || this.state.victory) || this.state.defeat)) {
      return;
    }
    const player = (engine?.Player ?? engine?.player);
    if ((((((player !== null) && (player.Alive === false)) || (player.alive === false)) || (player.Hp <= 0)) || (player.hp <= 0))) {
      this.triggerDefeat(engine);
      return;
    }
    if ((this.state.bossesSpawned < this.state.totalBosses)) {
      this.state.waveTimer = (this.state.waveTimer - dt);
      if ((this.state.waveTimer <= 0)) {
        const nextIdx = this.state.bossesSpawned;
        this.state.waveIndex = nextIdx;
        this.spawnBossForWave(nextIdx, engine);
        this.state.bossesSpawned = (this.state.bossesSpawned + 1);
        if ((this.state.bossesSpawned >= this.state.totalBosses)) {
          this.state.allSpawned = true;
          this.state.waveTimer = 0;
        } else {
          this.state.waveTimer = 8;
        }
      }
    }
    for (const tracked of this.trackedBosses) {
      if (!(tracked.dead)) {
        if ((((tracked.boss.Dead || tracked.boss.dead) || (tracked.boss.Hp <= 0)) || (tracked.boss.hp <= 0))) {
          tracked.dead = true;
          tracked.boss.Dead = true;
          this.state.bossesDefeated = (this.state.bossesDefeated + 1);
          if ((typeof (engine?.OnBossDefeated) === "function")) {
            engine.OnBossDefeated(tracked.boss);
          }
        }
      }
    }
    if ((this.state.bossesDefeated >= this.state.totalBosses)) {
      this.triggerVictory(engine);
    }
  }
  Update(dt: number, engine: GameEngine): void {
    this.update(dt, engine);
  }
  triggerDefeat(engine: GameEngine): void {
    this.state.defeat = true;
    this.state.active = false;
    const meta = ((engine?.meta ?? engine?.Meta) ?? MetaProgression.instance);
    if (((meta !== null) && (typeof (meta.resetUniqueHelmets) === "function"))) {
      meta.resetUniqueHelmets();
    }
    if ((typeof (engine?.HandleGameOver) === "function")) {
      engine.HandleGameOver(false);
    }
    if ((engine?.Sound?.PlayGameOver !== null)) {
      engine.Sound.PlayGameOver();
    }
    if ((typeof (engine?.Banner) === "function")) {
      engine.Banner("💀 GAUNTLET DEFEAT: ALL 8 HELMETS DESTROYED! RESTART FROM 0 💀", 5);
    }
  }
  TriggerDefeat(engine: GameEngine): void {
    this.triggerDefeat(engine);
  }
  triggerVictory(engine: GameEngine): void {
    this.state.victory = true;
    this.state.active = false;
    const meta = ((engine?.meta ?? engine?.Meta) ?? MetaProgression.instance);
    if ((meta !== null)) {
      meta.Has9thHelmet = true;
      meta.has9thHelmet = true;
      if (Array.isArray(meta.Helmets)) {
        const hasNinth = meta.Helmets.some((h: unknown) => (h.id || (h.Id === THE_NINTH_HELMET.id)));
        if ((!(hasNinth) && (typeof (meta.AddHelmet) === "function"))) {
          meta.AddHelmet(THE_NINTH_HELMET);
        }
      }
      if (Array.isArray(meta.UniqueHelmets)) {
        const hasNinthUnique = meta.UniqueHelmets.some((h: unknown) => ((((typeof (h) === "string") && (h === THE_NINTH_HELMET.id)) || h.id) || (h.Id === THE_NINTH_HELMET.id)));
        if (!(hasNinthUnique)) {
          meta.UniqueHelmets.push(THE_NINTH_HELMET.id);
        }
      }
      if ((typeof (meta.Save) === "function")) {
        meta.Save();
      }
    }
    if ((typeof (engine?.HandleGameOver) === "function")) {
      engine.HandleGameOver(true);
    }
    if ((engine?.Sound?.PlayVictory !== null)) {
      engine.Sound.PlayVictory();
    }
    if ((typeof (engine?.Banner) === "function")) {
      engine.Banner("🌟 ASCENSION ACHIEVED: ALL 8 BOSSES SLAIN! 9TH HELMET FORGED! 🌟", 6);
    }
  }
  TriggerVictory(engine: GameEngine): void {
    this.triggerVictory(engine);
  }
}
