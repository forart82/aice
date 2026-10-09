import { MathX } from "../core/MathX.js";
import { Rng } from "../core/Rng.js";
import { Services, Caps, ServiceContainer, IServiceContainer } from "../core/Services.js";
import { IFx, ISound, IInput, ISaveIO, IUiRoot } from "../core/Contracts.js";
import { Vec2 } from "../core/Vec2.js";
import { GameData } from "../data/GameData.js";
import { CardDef, GameModeDef, DailyCapacityState } from "../data/Types.js";
import { generateBossHelmet, formatHelmetStatDescription } from "../data/Helmets.js";
import { MetaProgression } from "../data/MetaProgression.js";
import { CosmicCapacities } from "../data/CosmicCapacities.js";
import { GameState } from "./GameState.js";
import { FoodItem } from "./FoodItem.js";
import { Hazard } from "./Hazard.js";
import { Projectile } from "./Projectile.js";
import { SnakePlayer } from "./SnakePlayer.js";
import { Enemy } from "./Enemy.js";
import { Boss } from "./Boss.js";
import { HelmetDrop } from "./HelmetDrop.js";
import { CombatSystem } from "./CombatSystem.js";
import { World } from "./World.js";
import { AutonomousBotPlayer } from "./ai/AutonomousBotPlayer.js";
import { BossRushGauntlet } from "./BossRushGauntlet.js";

export interface Steering {
  X: number;
  Y: number;
  Active: boolean;
  x: number | null;
  y: number | null;
  active: boolean | null;
}

export function Steering(X: number, Y: number, Active: boolean, x: number | null, y: number | null, active: boolean | null): Steering {
  return { X, Y, Active, x, y, active };
}

export interface GameEngineOptions {
  isolated: boolean | null;
  services: IServiceContainer | null;
  meta: MetaProgression | null;
  fx: IFx | null;
  sound: ISound | null;
  input: IInput | null;
  saveIO: ISaveIO | null;
  headless: boolean | null;
  rng: Rng | null;
}

export function GameEngineOptions(isolated: boolean | null, services: IServiceContainer | null, meta: MetaProgression | null, fx: IFx | null, sound: ISound | null, input: IInput | null, saveIO: ISaveIO | null, headless: boolean | null, rng: Rng | null): GameEngineOptions {
  return { isolated, services, meta, fx, sound, input, saveIO, headless, rng };
}

export class GameEngine {
  static readonly FixedStep = (1 / 120);
  static readonly fixedStep = (1 / 120);
  static readonly MaxStepsPerFrame = 6;
  static readonly maxStepsPerFrame = 6;
  static readonly BaseArenaArea = (960 * 640);
  static readonly baseArenaArea = (960 * 640);
  OnShowScreen: (string, unknown) => void;
  OnHideModals: () => void;
  OnHudVisible: (boolean) => void;
  OnUpdateHud: () => void;
  OnBanner: (string, number) => void;
  OnBannerHide: () => void;
  OnToast: (string, number) => void;
  OnVignette: (number) => void;
  OnBossBox: (boolean, any) => void;
  OnPerksChanged: () => void;
  OnDraftChanged: () => void;
  OnRunSummary: (boolean, number) => void;
  onRunSummary: (boolean, number) => void;
  OnClearTransientUi: () => void;
  OnApplySettings: () => void;
  OnSaveSettings: () => void;
  OnSteered: (boolean) => void;
  OnCanvasResized: () => void;
  OnMenuNavigate: () => void;
  OnDraw: () => void;
  DailyKeyProvider: () => void;
  ArenaW = 960;
  ArenaH = 640;
  Dpr = 1;
  CssWidth = 960;
  CssHeight = 640;
  BackingWidth = 960;
  BackingHeight = 640;
  State: GameState = GameState.Menu;
  GameMode = "rogue";
  SelectedClass = "emerald";
  RunSeed = 0;
  CurrentFloor = 1;
  MaxFloors = 20;
  FoodTarget = 15;
  FloorFoodProgress = 0;
  FloorClearTimer = 0;
  InitialSegments = 2;
  GrowthOnEat = false;
  LabIntroSeen = false;
  RecoveryPityCounter = 0;
  Player: SnakePlayer;
  Foods: FoodItem[] = [];
  Enemies: Enemy[] = [];
  Projectiles: Projectile[] = [];
  Hazards: Hazard[] = [];
  ActiveBosses: Boss[] = [];
  HelmetDrops: HelmetDrop[] = [];
  Combat: CombatSystem = CombatSystem();
  RerollsRemaining = 1;
  CurrentDraftCards: CardDef[] = [];
  ActivePerks: CardDef[] = [];
  FoodSpawnTimer = 0;
  WaveTimer = 3;
  VacuumTimer = 0;
  ChronoTimer = 0;
  TimeScale = 1;
  BannerTimer = 0;
  Vignette = 0;
  Accumulator = 0;
  Fps = 60;
  FpsSamples = 0;
  FpsAccum = 0;
  FrameCount = 0;
  SettingsReturnState: GameState = GameState.Menu;
  TouchScheme = "stick";
  IsTouchDevice = false;
  HasSteered = false;
  RunActive = false;
  DailyMilestoneReached = 0;
  Gauntlet: BossRushGauntlet | null = null;
  isBotEnabled = false;
  botPlayer = AutonomousBotPlayer();
  _botDraftTimer = 0;
  _botFloorClearTimer = 0;
  _botGameOverTimer = 0;
  _floorBaseFloor = -(1);
  _floorBaseEaten = 0;
  _storageWarned = false;
  readonly _world = World();
  readonly _eligibleEnemies: string[] = [];
  readonly _reusableSteering: Steering = { X: 0, Y: 0, Active: false, x: 0, y: 0, active: false };
  static readonly SkillHaptic: number[] = [12, 30, 24];
  backdrop = {};
  _services: IServiceContainer | null = null;
  _meta: MetaProgression | null = null;
  static CalculateFoodTarget(floor: number, bossRush: unknown = false): number {
    if ((bossRush !== null)) {
      return 0;
    }
    return Math.min(42, (16 + Math.floor(Math)));
  }
  static calculateFoodTarget(floor: number, bossRush: unknown = false): number {
    return GameEngine.CalculateFoodTarget(floor, bossRush);
  }
  get Bosses(): Boss[] {
    return this.ActiveBosses;
  }
  set Bosses(v: Boss[]) {
    this.ActiveBosses = (v ?? []);
  }
  get bosses(): Boss[] {
    return this.ActiveBosses;
  }
  set bosses(v: Boss[]) {
    this.ActiveBosses = (v ?? []);
  }
  get activeBosses(): Boss[] {
    return this.ActiveBosses;
  }
  set activeBosses(v: Boss[]) {
    this.ActiveBosses = (v ?? []);
  }
  get Boss(): Boss | null {
    return (((this.ActiveBosses.length > 0) && this.ActiveBosses[0]) || null);
  }
  set Boss(v: Boss | null) {
    if (!(v)) {
      this.ActiveBosses.length = 0;
    } else {
      this.ActiveBosses = [v];
    }
  }
  get arenaW(): number {
    return this.ArenaW;
  }
  set arenaW(v: number) {
    this.ArenaW = v;
  }
  get arenaH(): number {
    return this.ArenaH;
  }
  set arenaH(v: number) {
    this.ArenaH = v;
  }
  get dpr(): number {
    return this.Dpr;
  }
  set dpr(v: number) {
    this.Dpr = v;
  }
  get cssWidth(): number {
    return this.CssWidth;
  }
  set cssWidth(v: number) {
    this.CssWidth = v;
  }
  get cssHeight(): number {
    return this.CssHeight;
  }
  set cssHeight(v: number) {
    this.CssHeight = v;
  }
  get backingWidth(): number {
    return this.BackingWidth;
  }
  set backingWidth(v: number) {
    this.BackingWidth = v;
  }
  get backingHeight(): number {
    return this.BackingHeight;
  }
  set backingHeight(v: number) {
    this.BackingHeight = v;
  }
  get state(): GameState {
    return this.State;
  }
  set state(v: GameState) {
    this.State = v;
  }
  get gameMode(): string {
    return this.GameMode;
  }
  set gameMode(v: string) {
    this.GameMode = v;
  }
  get selectedClass(): string {
    return this.SelectedClass;
  }
  set selectedClass(v: string) {
    this.SelectedClass = v;
  }
  get runSeed(): number {
    return this.RunSeed;
  }
  set runSeed(v: number) {
    this.RunSeed = v;
  }
  get currentFloor(): number {
    return this.CurrentFloor;
  }
  set currentFloor(v: number) {
    this.CurrentFloor = v;
  }
  get maxFloors(): number {
    return this.MaxFloors;
  }
  set maxFloors(v: number) {
    this.MaxFloors = v;
  }
  get foodTarget(): number {
    return this.FoodTarget;
  }
  set foodTarget(v: number) {
    this.FoodTarget = v;
  }
  get recoveryPityCounter(): number {
    return this.RecoveryPityCounter;
  }
  set recoveryPityCounter(v: number) {
    this.RecoveryPityCounter = v;
  }
  get floorFoodProgress(): number {
    return this.FloorFoodProgress;
  }
  set floorFoodProgress(v: number) {
    this.FloorFoodProgress = v;
  }
  get floorClearTimer(): number {
    return this.FloorClearTimer;
  }
  set floorClearTimer(v: number) {
    this.FloorClearTimer = v;
  }
  get initialSegments(): number {
    return this.InitialSegments;
  }
  set initialSegments(v: number) {
    this.InitialSegments = v;
  }
  get growthOnEat(): boolean {
    return this.GrowthOnEat;
  }
  set growthOnEat(v: boolean) {
    this.GrowthOnEat = v;
  }
  get labIntroSeen(): boolean {
    return this.LabIntroSeen;
  }
  set labIntroSeen(v: boolean) {
    this.LabIntroSeen = v;
  }
  get player(): SnakePlayer {
    return this.Player;
  }
  set player(v: SnakePlayer) {
    this.Player = v;
  }
  get foods(): FoodItem[] {
    return this.Foods;
  }
  set foods(v: FoodItem[]) {
    this.Foods = v;
  }
  get foodItems(): FoodItem[] {
    return this.Foods;
  }
  set foodItems(v: FoodItem[]) {
    this.Foods = v;
  }
  get enemies(): Enemy[] {
    return this.Enemies;
  }
  set enemies(v: Enemy[]) {
    this.Enemies = v;
  }
  get projectiles(): Projectile[] {
    return this.Projectiles;
  }
  set projectiles(v: Projectile[]) {
    this.Projectiles = v;
  }
  get hazards(): Hazard[] {
    return this.Hazards;
  }
  set hazards(v: Hazard[]) {
    this.Hazards = v;
  }
  get boss(): Boss | null {
    return this.Boss;
  }
  set boss(v: Boss | null) {
    this.Boss = v;
  }
  get helmetDrops(): HelmetDrop[] {
    return this.HelmetDrops;
  }
  set helmetDrops(v: HelmetDrop[]) {
    this.HelmetDrops = v;
  }
  get combat(): CombatSystem {
    return this.Combat;
  }
  set combat(v: CombatSystem) {
    this.Combat = v;
  }
  get rerollsRemaining(): number {
    return this.RerollsRemaining;
  }
  set rerollsRemaining(v: number) {
    this.RerollsRemaining = v;
  }
  get currentDraftCards(): CardDef[] {
    return this.CurrentDraftCards;
  }
  set currentDraftCards(v: CardDef[]) {
    this.CurrentDraftCards = v;
  }
  get activePerks(): CardDef[] {
    return this.ActivePerks;
  }
  set activePerks(v: CardDef[]) {
    this.ActivePerks = v;
  }
  get foodSpawnTimer(): number {
    return this.FoodSpawnTimer;
  }
  set foodSpawnTimer(v: number) {
    this.FoodSpawnTimer = v;
  }
  get waveTimer(): number {
    return this.WaveTimer;
  }
  set waveTimer(v: number) {
    this.WaveTimer = v;
  }
  get vacuumTimer(): number {
    return this.VacuumTimer;
  }
  set vacuumTimer(v: number) {
    this.VacuumTimer = v;
  }
  get chronoTimer(): number {
    return this.ChronoTimer;
  }
  set chronoTimer(v: number) {
    this.ChronoTimer = v;
  }
  get timeScale(): number {
    return this.TimeScale;
  }
  set timeScale(v: number) {
    this.TimeScale = v;
  }
  get bannerTimer(): number {
    return this.BannerTimer;
  }
  set bannerTimer(v: number) {
    this.BannerTimer = v;
  }
  get vignette(): number {
    return this.Vignette;
  }
  set vignette(v: number) {
    this.Vignette = v;
  }
  get accumulator(): number {
    return this.Accumulator;
  }
  set accumulator(v: number) {
    this.Accumulator = v;
  }
  get fps(): number {
    return this.Fps;
  }
  set fps(v: number) {
    this.Fps = v;
  }
  get frameCount(): number {
    return this.FrameCount;
  }
  set frameCount(v: number) {
    this.FrameCount = v;
  }
  get hasSteered(): boolean {
    return this.HasSteered;
  }
  set hasSteered(v: boolean) {
    this.HasSteered = v;
  }
  get runActive(): boolean {
    return this.RunActive;
  }
  set runActive(v: boolean) {
    this.RunActive = v;
  }
  get dailyMilestoneReached(): number {
    return this.DailyMilestoneReached;
  }
  set dailyMilestoneReached(v: number) {
    this.DailyMilestoneReached = v;
  }
  get gauntlet(): BossRushGauntlet | null {
    return this.Gauntlet;
  }
  set gauntlet(v: BossRushGauntlet | null) {
    this.Gauntlet = v;
  }
  StartBossRushGauntlet(): BossRushGauntlet {
    this.Gauntlet = BossRushGauntlet();
    this.Gauntlet.Start(this);
    return this.Gauntlet;
  }
  startBossRushGauntlet(): BossRushGauntlet {
    return this.StartBossRushGauntlet();
  }
  toggleBot(): boolean {
    this.isBotEnabled = !(this.isBotEnabled);
    if ((this.isBotEnabled !== null)) {
      this.Banner("🤖 SPECTATOR BOT: ENGAGED", 1.8);
    } else {
      this.Banner("🎮 MANUAL CONTROL: RESTORED", 1.8);
    }
    return this.isBotEnabled;
  }
  setUiRoot(uiRoot: IUiRoot | null): void {
    if (!(uiRoot)) {
      return;
    }
    this.OnShowScreen = (id: string, payload: unknown) => uiRoot.showScreen(id, payload);
    this.OnHideModals = () => uiRoot.closeAllModals();
    this.OnHudVisible = (visible: boolean) => uiRoot.hudView.setVisible(visible);
    this.OnUpdateHud = () => uiRoot.hudView.update();
    this.OnBanner = (text: string, seconds: number) => uiRoot.hudView.showBanner(text, seconds);
    this.OnBannerHide = () => uiRoot.hudView.hideBanner();
    this.OnToast = (message: string, seconds: number) => uiRoot.hudView.showToast(message, seconds);
    this.OnVignette = (opacity: number) => uiRoot.hudView.setVignette(opacity);
    this.OnBossBox = (visible: boolean, name: string | null) => uiRoot.hudView.setBossBox(visible, name);
    this.OnPerksChanged = () => uiRoot.hudView.updatePerks();
    this.OnDraftChanged = () => null;
  }
  draw(_ctx: unknown): void {
    this.OnDraw();
  }
  get services(): IServiceContainer {
    return (((this._services ?? (typeof (Services) !== "undefined")) && (Services.defaultContainer ?? Services)) || null);
  }
  set services(v: IServiceContainer) {
    this._services = v;
  }
  get Services(): IServiceContainer {
    return this.services;
  }
  set Services(v: IServiceContainer) {
    this.services = v;
  }
  get meta(): MetaProgression {
    return ((((this._meta ?? this.services?.Meta) ?? (typeof (MetaProgression) !== "undefined")) && MetaProgression.Instance) || null);
  }
  set meta(v: MetaProgression) {
    this._meta = v;
  }
  get Meta(): MetaProgression {
    return this.meta;
  }
  set Meta(v: MetaProgression) {
    this.meta = v;
  }
  get sound(): ISound {
    return (this.services?.Sound ?? Services.Sound);
  }
  get Sound(): ISound {
    return this.sound;
  }
  get fx(): IFx {
    return (this.services?.Fx ?? Services.Fx);
  }
  get Fx(): IFx {
    return this.fx;
  }
  get input(): IInput {
    return (this.services?.Input ?? Services.Input);
  }
  get Input(): IInput {
    return this.input;
  }
  constructor(fxOrOptions: int | GameEngineOptions | unknown, options: int | GameEngineOptions | unknown) {
    if ((typeof (fxOrOptions) === "number")) {
      this.ArenaW = fxOrOptions;
    }
    if ((typeof (options) === "number")) {
      this.ArenaH = options;
    }
    let opts: GameEngineOptions | null = ((((options !== null) && (typeof (options) === "object")) && options) || undefined);
    const isOptionsObject = (((((((((((fxOrOptions !== null) && (typeof (fxOrOptions) === "object")) && ("isolated" === fxOrOptions)) || ("services" === fxOrOptions)) || ("meta" === fxOrOptions)) || ("headless" === fxOrOptions)) || ("fx" === fxOrOptions)) || ("sound" === fxOrOptions)) || ("input" === fxOrOptions)) || ("saveIO" === fxOrOptions)) || ("rng" === fxOrOptions));
    if ((isOptionsObject !== null)) {
      opts = fxOrOptions;
    }
    if ((((opts?.isolated || opts?.services) || opts?.meta) || opts?.headless)) {
      this._services = (opts?.services ?? Services.createIsolated());
      this._meta = (opts?.meta ?? MetaProgression.createIsolated({ engine: this, services: this._services }));
      this._services.engine = this;
      this._services.meta = this._meta;
      this._meta.engine = this;
      if ((opts?.fx !== null)) {
        this._services.Fx = opts.fx;
      }
      if ((opts?.sound !== null)) {
        this._services.Sound = opts.sound;
      }
      if ((opts?.input !== null)) {
        this._services.Input = opts.input;
      }
      if ((opts?.headless !== undefined)) {
        this._services.Headless = opts.headless;
      }
    } else {
      this._services = null;
      this._meta = null;
      Services.registerEngineProvider(() => this);
      const potentialFx = fxOrOptions;
      if (((((potentialFx !== null) && !((potentialFx === ServiceContainer))) && !(isOptionsObject)) && (typeof (potentialFx.burst) === "function"))) {
        Services.Fx = potentialFx;
      }
    }
    this.Combat.Engine = this;
    this.Combat.Meta = this.meta;
    this.Combat.Services = this.services;
  }
  get Cfg(): GameModeDef {
    return (GameData.Modes.Get(this.GameMode) ?? GameData.Modes.Get("rogue"));
  }
  SetupCanvas(cssWidth: number, cssHeight: number, dpr: number): void {
    let w = cssWidth;
    let h = cssHeight;
    if ((!((w > 0)) || !((h > 0)))) {
      w = 960;
      h = 640;
    }
    w = Math.max(240, w);
    h = Math.max(240, h);
    const aspect = (w / h);
    let arenaH = Math.sqrt((GameEngine.BaseArenaArea / aspect));
    let arenaW = (arenaH * aspect);
    arenaW = MathX.clamp(arenaW, 520, 1600);
    arenaH = MathX.clamp(arenaH, 420, 1400);
    const oldW = this.ArenaW;
    const oldH = this.ArenaH;
    this.ArenaW = MathX.roundJs(arenaW);
    this.ArenaH = MathX.roundJs(arenaH);
    this.CssWidth = w;
    this.CssHeight = h;
    this.Dpr = (MathX.clamp((((dpr > 0) && dpr) || 1), 1, 2.5) * Math.min(1, (w / arenaW)));
    this.BackingWidth = MathX.roundJs((this.ArenaW * this.Dpr));
    this.BackingHeight = MathX.roundJs((this.ArenaH * this.Dpr));
    if ((((((this.Player !== null) && (oldW > 0)) && (oldH > 0)) && (oldW !== this.ArenaW)) || (oldH !== this.ArenaH))) {
      this.RescaleWorld((this.ArenaW / oldW), (this.ArenaH / oldH));
    }
    this.OnCanvasResized();
  }
  setupCanvas(cssWidth: number, cssHeight: number, dpr: number): void {
    this.SetupCanvas(cssWidth, cssHeight, dpr);
  }
  RescaleWorld(sx: number, sy: number): void {
    const hiX = (this.ArenaW - 4);
    const hiY = (this.ArenaH - 4);
    if ((this.Player !== null)) {
      this.Player.X = MathX.clamp((this.Player.X * sx), 4, hiX);
      this.Player.Y = MathX.clamp((this.Player.Y * sy), 4, hiY);
    }
  }
  rescaleWorld(sx: number, sy: number): void {
    this.RescaleWorld(sx, sy);
  }
  ScreenToWorld(normX: number, normY: number): Vec2 {
    return Vec2((MathX.clamp(normX, 0, 1) * this.ArenaW), (MathX.clamp(normY, 0, 1) * this.ArenaH));
  }
  screenToWorld(normX: number, normY: number): Vec2 {
    return this.ScreenToWorld(normX, normY);
  }
  ShowMenu(): void {
    this.AbandonRun();
    this.State = GameState.Menu;
    this.ClearTransientUi();
    this.SetHudVisible(false);
    this.OnShowScreen("modal-main-menu");
    this.Sound.StopMusic();
    this.Sound.SetBossMode(false);
  }
  showMenu(): void {
    this.ShowMenu();
  }
  SetHudVisible(visible: boolean): void {
    this.OnHudVisible(visible);
  }
  setHudVisible(visible: boolean): void {
    this.SetHudVisible(visible);
  }
  ChooseMode(mode: string): void {
    if (GameData.Modes.Has(mode)) {
      this.GameMode = mode;
    } else {
      this.GameMode = "rogue";
    }
    this.ShowClassSelect();
  }
  chooseMode(mode: string): void {
    this.ChooseMode(mode);
  }
  ShowClassSelect(): void {
    this.State = GameState.ClassSelect;
    this.SetHudVisible(false);
    this.OnShowScreen("modal-class-select");
  }
  showClassSelect(): void {
    this.ShowClassSelect();
  }
  ShowSanctuary(): void {
    this.State = GameState.Sanctuary;
    this.SetHudVisible(false);
    this.OnShowScreen("modal-sanctuary");
  }
  showSanctuary(): void {
    this.ShowSanctuary();
  }
  ShowRecords(): void {
    this.State = GameState.Records;
    this.SetHudVisible(false);
    this.OnShowScreen("modal-records");
  }
  showRecords(): void {
    this.ShowRecords();
  }
  ShowStats(tab: "run" | "global" = "run"): void {
    if ((this.State === GameState.Playing)) {
      this.State = GameState.Paused;
      this.Sound.SetPaused(true);
    }
    if ((tab === "run")) {
      this.OnShowScreen("modal-snake-lab", { tab: "telemetry" });
    } else {
      this.OnShowScreen("modal-stats", { mode: tab });
    }
  }
  showStats(tab: "run" | "global" = "run"): void {
    this.ShowStats(tab);
  }
  ToggleStats(): void {
    if ((this.State === GameState.Playing)) {
      this.ShowStats("run");
    } else if ((this.State === GameState.Paused)) {
      this.Resume();
    }
  }
  toggleStats(): void {
    this.ToggleStats();
  }
  ShowHelp(): void {
    if ((this.State === GameState.Playing)) {
      this.State = GameState.Paused;
      this.Sound.SetPaused(true);
    } else if ((this.State !== GameState.Paused)) {
      this.State = GameState.Help;
    }
    this.OnShowScreen("modal-help");
  }
  showHelp(): void {
    this.ShowHelp();
  }
  ToggleHelp(): void {
    if ((this.State === GameState.Playing)) {
      this.ShowHelp();
    } else if (((this.State === GameState.Paused) || (this.State === GameState.Help))) {
      this.Resume();
    }
  }
  toggleHelp(): void {
    this.ToggleHelp();
  }
  OpenSnakeLab(tab: "lab" | "telemetry" = "lab"): void {
    if ((this.State === GameState.Playing)) {
      this.State = GameState.Paused;
      this.Sound.SetPaused(true);
    }
    this.OnShowScreen("modal-snake-lab", { tab });
  }
  openSnakeLab(tab: "lab" | "telemetry" = "lab"): void {
    this.OpenSnakeLab(tab);
  }
  ShowSnakeLab(tab: "lab" | "telemetry" = "lab"): void {
    this.OpenSnakeLab(tab);
  }
  showSnakeLab(tab: "lab" | "telemetry" = "lab"): void {
    this.OpenSnakeLab(tab);
  }
  CloseSnakeLab(): void {
    if (((((this.State === GameState.Paused) && this.RunActive) && this.Player) && this.Player.Alive)) {
      this.Resume();
    }
    this.OnHideModals();
  }
  closeSnakeLab(): void {
    this.CloseSnakeLab();
  }
  ShowSettings(returnState: GameState): void {
    this.SettingsReturnState = returnState;
    this.State = GameState.Settings;
    this.SetHudVisible(false);
    this.OnShowScreen("modal-settings");
  }
  showSettings(returnState: GameState): void {
    this.ShowSettings(returnState);
  }
  CloseSettings(): void {
    this.OnSaveSettings();
    if ((this.SettingsReturnState === GameState.Paused)) {
      this.State = GameState.Paused;
      this.OnShowScreen("modal-pause");
    } else {
      this.ShowMenu();
    }
  }
  closeSettings(): void {
    this.CloseSettings();
  }
  TogglePause(): void {
    if ((this.State === GameState.Playing)) {
      this.State = GameState.Paused;
      this.OnShowScreen("modal-pause");
      this.Sound.SetPaused(true);
    } else if ((this.State === GameState.Paused)) {
      if (((!(this.RunActive) || !(this.Player)) || !(this.Player.Alive))) {
        return;
      }
      this.State = GameState.Playing;
      this.OnHideModals();
      this.SetHudVisible(true);
      this.Accumulator = 0;
      this.Sound.SetPaused(false);
    }
  }
  Resume(): void {
    if (((((!(this.RunActive) || !(this.Player)) || !(this.Player.Alive)) || (this.State === GameState.GameOver)) || (this.State === GameState.Victory))) {
      return;
    }
    this.State = GameState.Playing;
    this.OnHideModals();
    this.SetHudVisible(true);
    this.Accumulator = 0;
    this.Sound.SetPaused(false);
  }
  resume(): void {
    this.Resume();
  }
  get paused(): boolean {
    return (this.State === GameState.Paused);
  }
  get isPaused(): boolean {
    return (this.State === GameState.Paused);
  }
  togglePause(): void {
    this.TogglePause();
  }
  OnVisibilityRestored(): void {
    this.Accumulator = 0;
  }
  onVisibilityRestored(): void {
    this.OnVisibilityRestored();
  }
  Banner(text: string, seconds: unknown = 0): void {
    if ((seconds > 0)) {
      this.BannerTimer = seconds;
    } else {
      this.BannerTimer = 1.5;
    }
    this.OnBanner(text, this.BannerTimer);
  }
  banner(text: string, seconds: unknown = 0): void {
    this.Banner(text, seconds);
  }
  Toast(message: string, seconds: unknown = 0): void {
    this.OnToast(message, (((seconds > 0) && seconds) || 2.6));
  }
  toast(message: string, seconds: unknown = 0): void {
    this.Toast(message, seconds);
  }
  UpdateBanner(dt: number): void {
    if ((this.BannerTimer <= 0)) {
      return;
    }
    this.BannerTimer = (this.BannerTimer - dt);
    if ((this.BannerTimer > 0)) {
      return;
    }
    this.OnBannerHide();
  }
  updateBanner(dt: number): void {
    this.UpdateBanner(dt);
  }
  UpdateVignette(dt: number): void {
    if ((this.Vignette <= 0)) {
      return;
    }
    this.Vignette = Math.max(0, (this.Vignette - (dt * 1.6)));
    this.OnVignette(((MathX.roundJs((this.Vignette * 100)) / 100) * 0.75));
  }
  updateVignette(dt: number): void {
    this.UpdateVignette(dt);
  }
  ClearTransientUi(): void {
    this.BannerTimer = 0;
    this.Vignette = 0;
    this.OnClearTransientUi();
  }
  clearTransientUi(): void {
    this.ClearTransientUi();
  }
  StartRun(seed: number): void {
    this.AbandonRun();
    const cfg = this.Cfg;
    if ((seed !== undefined)) {
      this.RunSeed = seed;
      Rng.Shared.setSeed(seed);
    } else if ((cfg.Seeded !== null)) {
      const key = (((this.DailyKeyProvider !== null) && this.DailyKeyProvider()) || GameEngine.defaultDailyKey());
      this.RunSeed = Rng.hash(("ouroboros-" + String(key)));
      Rng.Shared.setSeed(this.RunSeed);
    }
    const meta = this.meta;
    if ((meta !== null)) {
      if ((typeof (meta.ResetRunUnlocks) === "function")) {
        meta.ResetRunUnlocks();
      }
      if (!(meta.IsUnlocked(this.SelectedClass))) {
        this.SelectedClass = "emerald";
      }
    }
    this.State = GameState.Playing;
    this.OnHideModals();
    this.SetHudVisible(true);
    this.MaxFloors = cfg.Floors;
    this.CurrentFloor = 1;
    this.FloorFoodProgress = 0;
    this.FoodTarget = GameEngine.CalculateFoodTarget(this.CurrentFloor, cfg.BossRush);
    this.RecoveryPityCounter = 0;
    this.FloorClearTimer = 0;
    this.LabIntroSeen = false;
    this.DailyMilestoneReached = 0;
    this.Player = SnakePlayer(this.SelectedClass, this.ArenaW, this.ArenaH, this.InitialSegments, { meta: this.meta, services: this.services });
    this.Foods = [];
    this.Enemies = [];
    this.Projectiles = [];
    this.Hazards = [];
    this.HelmetDrops = [];
    this.Boss = null;
    this.ActiveBosses = [];
    this.ActivePerks = [];
    this.CurrentDraftCards = [];
    this.Combat.Reset();
    this.Combat.Engine = this;
    this.Combat.Meta = this.meta;
    this.Combat.Services = this.services;
    this.FoodSpawnTimer = 0;
    this.WaveTimer = 3;
    this.VacuumTimer = 0;
    this.ChronoTimer = 0;
    this.TimeScale = 1;
    this.Vignette = 0;
    this.HasSteered = false;
    this.OnSteered(false);
    this.RunActive = true;
    this._floorBaseFloor = -(1);
    this._floorBaseEaten = 0;
    this.FloorFoodProgress = 0;
    this.Gauntlet = null;
    this.ClearTransientUi();
    this.OnPerksChanged();
    this.Fx.Clear();
    this.Input.Reset();
    this.RerollsRemaining = (((1 + meta) && meta.Level("rerolls")) || 0);
    this.OnApplySettings();
    if ((typeof (this.Sound.init) === "function")) {
      this.Sound.init();
    } else if ((typeof (this.Sound.Init) === "function")) {
      this.Sound.Init();
    }
    this.Sound.StopMusic();
    this.Sound.SetBossMode(false);
    this.Sound.SetFrenzyState(false);
    this.Sound.SetMusicIntensity(0);
    this.Sound.SetPaused(false);
    this.Sound.StartMusic();
    this.Banner((("" + String(cfg.Label)) + " — FLOOR 1"), 1.8);
    if ((cfg.BossRush !== null)) {
      this.SpawnBoss();
    }
    this.Accumulator = 0;
  }
  startRun(seed: number): void {
    this.StartRun(seed);
  }
  restartRun(seed: number): void {
    this.StartRun(seed);
  }
  StartGame(classIdOrSeed: str | int, seed: number): void {
    if ((typeof (classIdOrSeed) === "string")) {
      this.SelectedClass = classIdOrSeed;
      this.StartRun(seed);
    } else {
      this.StartRun(classIdOrSeed);
    }
  }
  startGame(classIdOrSeed: str | int, seed: number): void {
    this.StartGame(classIdOrSeed, seed);
  }
  Reset(): void {
    this.StartRun();
  }
  reset(): void {
    this.StartRun();
  }
  Init(): void {
    this.StartRun();
  }
  init(): void {
    this.StartRun();
  }
  static defaultDailyKey(): string {
    const d = new Date();
    return ((((("" + String(d.getUTCFullYear())) + "-") + String((d.getUTCMonth() + 1))) + "-") + String(d.getUTCDate()));
  }
  get RunInProgress(): boolean {
    return (((this.RunActive !== null) && (this.Player !== null)) && (this.Player !== undefined));
  }
  get runInProgress(): boolean {
    return this.RunInProgress;
  }
  CommitRun(victory: boolean): number {
    if ((!(this.RunActive) || !(this.Player))) {
      return 0;
    }
    this.RunActive = false;
    const meta = this.meta;
    if (!(meta)) {
      return 0;
    }
    const banked = meta.AddShards(this.Combat.ShardsEarned);
    meta.CommitRun({ Score: Math.floor(Math), Floor: this.CurrentFloor, Combo: this.Combat.HighestRunCombo, Level: this.Player.Level, Kills: this.Combat.Kills, Foods: this.Combat.FoodsEaten, Bosses: this.Combat.BossKills, TimeSec: this.Combat.RunTime, Victory: victory });
    meta.Save();
    return banked;
  }
  commitRun(victory: boolean): number {
    return this.CommitRun(victory);
  }
  AbandonRun(): void {
    if (!(this.RunInProgress)) {
      return;
    }
    const banked = this.CommitRun(false);
    if ((banked > 0)) {
      this.Toast((("Run abandoned — banked " + String(banked)) + " ⭐"));
    }
  }
  abandonRun(): void {
    this.AbandonRun();
  }
  WarnIfStorageBroken(): void {
    const meta = this.meta;
    if (((!(meta) || !(meta.StorageBroken)) || this._storageWarned)) {
      return;
    }
    this._storageWarned = true;
    this.Toast("⚠️ Progress cannot be saved on this browser — stars will not persist.", 6);
  }
  warnIfStorageBroken(): void {
    this.WarnIfStorageBroken();
  }
  HandleGameOver(victory: boolean): void {
    if (((this.State === GameState.GameOver) || (this.State === GameState.Victory))) {
      return;
    }
    if (((!(victory) && this.Gauntlet) && this.Gauntlet.Active)) {
      this.Gauntlet.TriggerDefeat(this);
    }
    if ((victory !== null)) {
      this.State = GameState.Victory;
    } else {
      this.State = GameState.GameOver;
    }
    this.ClearTransientUi();
    this.SetHudVisible(false);
    this.Sound.StopMusic();
    this.Sound.SetBossMode(false);
    if ((victory !== null)) {
      this.Sound.PlayVictory();
    } else {
      this.Sound.PlayGameOver();
    }
    for (const drop of this.HelmetDrops) {
      if (!(drop.Dead)) {
        this.CollectHelmetDrop(drop);
      }
    }
    this.HelmetDrops.length = 0;
    const banked = this.CommitRun(victory);
    this.OnRunSummary(victory, banked);
    this.OnShowScreen("modal-summary");
    this.WarnIfStorageBroken();
  }
  handleGameOver(victory: boolean): void {
    this.HandleGameOver(victory);
  }
  EndRun(victory: boolean = false): void {
    this.HandleGameOver(victory);
  }
  endRun(victory: boolean = false): void {
    this.HandleGameOver(victory);
  }
  TriggerLevelUp(): void {
    this.State = GameState.LevelUp;
    this.Sound.PlayLevelUp();
    this.Sound.SetPaused(true);
    const meta = this.meta;
    if ((meta !== null)) {
      this.CurrentDraftCards = meta.GetRandomCardDraft(3, this.Player);
    } else {
      this.CurrentDraftCards = [];
    }
    if ((this.Player !== null)) {
      this.Player.MutationPoints = (this.Player.MutationPoints + 1);
      this.Fx.Burst(this.Player.X, this.Player.Y, "#ffd166", 26, 6, 4);
    }
    this.OnDraftChanged();
    this.OnShowScreen("modal-snake-lab");
  }
  triggerLevelUp(): void {
    this.TriggerLevelUp();
  }
  ToggleLab(): void {
    if ((this.State === GameState.Playing)) {
      this.TriggerLevelUp();
    } else if ((this.State === GameState.LevelUp)) {
      this.CompleteLevelUp();
    }
  }
  toggleLab(): void {
    this.ToggleLab();
  }
  CompleteLevelUp(): void {
    this.OnHideModals();
    if ((((this.GrowthOnEat !== null) && this.Player) && (this.Player.PendingLevelUps > 0))) {
      this.Player.PendingLevelUps = (this.Player.PendingLevelUps - 1);
      this.TriggerLevelUp();
      return;
    }
    this.State = GameState.Playing;
    this.Accumulator = 0;
    this.Sound.SetPaused(false);
  }
  completeLevelUp(): void {
    this.CompleteLevelUp();
  }
  RerollDraft(): void {
    if ((this.RerollsRemaining <= 0)) {
      this.Sound.PlayError();
      return;
    }
    this.RerollsRemaining = (this.RerollsRemaining - 1);
    const meta = this.meta;
    if ((meta !== null)) {
      this.CurrentDraftCards = meta.GetRandomCardDraft(3, this.Player);
    } else {
      this.CurrentDraftCards = [];
    }
    this.OnDraftChanged();
    this.OnShowScreen("modal-level-up");
  }
  rerollDraft(): void {
    this.RerollDraft();
  }
  SkipDraft(): void {
    this.Player.Stats.MaxHp = (this.Player.Stats.MaxHp + 25);
    this.Player.Heal(25);
    this.Fx.AddText(this.Player.X, (this.Player.Y - 30), "+25 MAX HP", "#10b981", 17, true);
    this.ResumeFromDraft();
  }
  skipDraft(): void {
    this.SkipDraft();
  }
  SelectUpgradeCard(card: CardDef): void {
    if ((!(card) || !(this.Player))) {
      return;
    }
    const cardId = (card.Id || card.id);
    if (!(cardId)) {
      return;
    }
    if ((this.CurrentDraftCards.length > 0)) {
      const isOffered = this.CurrentDraftCards.some((c: unknown) => (c.Id || (c.id === cardId)));
      if (!(isOffered)) {
        Services.Sound.PlayError();
        return;
      }
    }
    const owned = (this.Player.CardStacks[cardId] ?? 0);
    const max = (card.MaxStacks || (card.maxStacks ?? 1));
    if ((owned >= max)) {
      Services.Sound.PlayError();
      return;
    }
    this.Player.CardStacks[cardId] = (owned + 1);
    if ((typeof (card.Apply) === "function")) {
      card.Apply(this.Player);
    } else if ((typeof (card.apply) === "function")) {
      card.apply(this.Player);
    }
    this.ActivePerks.push(card);
    this.Sound.PlayEat(10, true);
    const cardIcon = ((card.Icon || card.icon) || "🧬");
    const cardTitle = ((((card.Title || card.title) || card.Name) || card.name) || "Mutation");
    this.Fx.AddText(this.Player.X, (this.Player.Y - 34), ((("" + String(cardIcon)) + " ") + String(cardTitle)), "#00f0b5", 18, true);
    this.OnPerksChanged();
    this.ResumeFromDraft();
  }
  selectUpgradeCard(card: CardDef): void {
    this.SelectUpgradeCard(card);
  }
  ResumeFromDraft(): void {
    this.CurrentDraftCards = [];
    this.OnHideModals();
    this.State = GameState.Playing;
    this.Accumulator = 0;
    this.Sound.SetPaused(false);
  }
  resumeFromDraft(): void {
    this.ResumeFromDraft();
  }
  RandomArenaPoint(margin: unknown = 0): Vec2 {
    const m = (((margin > 0) && margin) || 50);
    const minX = Math.min(m, (this.ArenaW * 0.5));
    const maxX = Math.max(minX, (this.ArenaW - minX));
    const minY = Math.min(m, (this.ArenaH * 0.5));
    const maxY = Math.max(minY, (this.ArenaH - minY));
    return Vec2(Rng.Shared.range(minX, maxX), Rng.Shared.range(minY, maxY));
  }
  randomArenaPoint(margin: unknown = 0): Vec2 {
    return this.RandomArenaPoint(margin);
  }
  SpawnFood(type: string | null = null): void {
    let p = Vec2(0, 0);
    let chosen = type;
    if (!(chosen)) {
      const player = this.Player;
      const isLowHp = (((player !== null) && (player.MaxHp > 0)) && ((player.Hp / player.MaxHp) < 0.35));
      if ((isLowHp !== null)) {
        if ((this.RecoveryPityCounter >= 7)) {
          const rPity = Rng.Shared.rand();
          if ((rPity < (0.22 / 0.34))) {
            chosen = "potion";
          } else {
            chosen = "shield";
          }
          this.RecoveryPityCounter = 0;
        } else {
          const r = Rng.Shared.rand();
          if ((r < 0.22)) {
            chosen = "potion";
            this.RecoveryPityCounter = 0;
          } else if ((r < 0.34)) {
            chosen = "shield";
            this.RecoveryPityCounter = 0;
          }
        }
      } else {
        this.RecoveryPityCounter = 0;
        const r = Rng.Shared.rand();
        if ((r < 0.6)) {
          chosen = "apple";
        } else if ((r < 0.75)) {
          chosen = "golden";
        }
      }
    }
    this.Foods.push(FoodItem(p.X, p.Y, chosen));
  }
  spawnFood(type: string | null = null): void {
    this.SpawnFood(type);
  }
  SpawnEnemy(type: string | null = null): void {
    const margin = 26;
    let x = 0;
    let y = 0;
    let chosen = type;
    if (!(chosen)) {
      this._eligibleEnemies.length = 0;
      const keys = GameData.Enemies.Keys;
      chosen = (Rng.Shared.pick(this._eligibleEnemies) ?? "scarab");
    }
    this.Enemies.push(Enemy(x, y, chosen, this.CurrentFloor));
  }
  spawnEnemy(type: string | null = null): void {
    this.SpawnEnemy(type);
  }
  EnemyBudget(): number {
    return Math.min(24, (3 + MathX.roundJs((this.CurrentFloor * 2.5))));
  }
  enemyBudget(): number {
    return this.EnemyBudget();
  }
  SpawnBoss(specificType: str | unknown, count: number): void {
    let spawnCount = 1;
    if ((count !== undefined)) {
      spawnCount = Math.max(1, count);
    } else if (Array.isArray(specificType)) {
      spawnCount = Math.max(1, specificType.length);
    }
    const multiBossScale = (((spawnCount > 1) && 0.75) || 1);
    this.ActiveBosses.length = 0;
    this.Sound.PlayBossAlert();
    this.Sound.SetBossMode(true);
    if ((this.ActiveBosses.length === 1)) {
      this.Banner((("⚠️ " + String(this.ActiveBosses[0].Name.toUpperCase())) + " ⚠️"), 2.2);
      this.OnBossBox(true, this.ActiveBosses[0].Name);
    } else if ((this.ActiveBosses.length === 2)) {
      this.Banner((((("⚠️ DUAL APEX THREAT: " + String(this.ActiveBosses[0].Name.toUpperCase())) + " & ") + String(this.ActiveBosses[1].Name.toUpperCase())) + " ⚠️"), 2.5);
      this.OnBossBox(true, ((("" + String(this.ActiveBosses[0].Name)) + " + ") + String(this.ActiveBosses[1].Name)));
    }
    this.Projectiles.length = 0;
    if ((this.Player !== null)) {
      this.Player.InvulnerableTimer = Math.max(this.Player.InvulnerableTimer, 1.2);
    }
  }
  spawnBoss(specificType: str | unknown, count: number): void {
    this.SpawnBoss(specificType, count);
  }
  OnBossDefeated(defeatedBoss: Boss | null): void {
    const boss = (defeatedBoss || this.Boss);
    if (!(boss)) {
      return;
    }
    this.Combat.BossKills = (this.Combat.BossKills + 1);
    this.Combat.Score = (this.Combat.Score + (2500 * this.CurrentFloor));
    if (!(this.Combat.DefeatedBossTypes)) {
      this.Combat.DefeatedBossTypes = [];
    }
    const bossType = ((boss.Type || boss.type) || "centipede");
    this.Combat.DefeatedBossTypes.push(bossType);
    if (!(this.Combat.BossKillsByType)) {
      this.Combat.BossKillsByType = {};
    }
    this.Combat.BossKillsByType[bossType] = (this.Combat.BossKillsByType[bossType] || (0 + 1));
    if ((this.Player !== null)) {
      const relics = ((this.Player.Relics || this.Player.relics) || {});
      const bossOuro = ((boss.XpValue ?? ((GameData.BossDefeatOuro * 1) + (0.6 * relics["soulHarvest"]))) || 0);
      this.Player.GainOuro(bossOuro);
    }
    this.Sound.PlayExplosion(1.6);
    this.Fx.RingShockwave(boss.X, boss.Y, "#ffd166", 140, 0.01);
    this.Fx.Burst(boss.X, boss.Y, "#ffb703", 46, 9, 6);
    this.Fx.Flash("#ffd166", 0.35, 0.45);
    this.Fx.Shake(18, 24);
    const helmet = generateBossHelmet(this.CurrentFloor, bossType);
    const drop = HelmetDrop(boss.X, boss.Y, helmet);
    this.HelmetDrops.push(drop);
    const rName = ((helmet.Rarity || helmet.rarity) || "common".toUpperCase());
    const hIcon = ((helmet.Icon || helmet.icon) || "🪖");
    const hName = ((helmet.Name || helmet.name) || "Helmet");
    const statSummary = formatHelmetStatDescription(((helmet.Stats || helmet.stats) || {}));
    this.Banner((((((((("🏆 " + String(hIcon)) + " ") + String(hName)) + " [") + String(rName)) + "] DROPPED! (") + String(statSummary)) + ")"), 3.5);
    const idx = this.ActiveBosses.indexOf(boss);
    if ((idx >= 0)) {
      this.ActiveBosses.splice(idx, 1);
    } else {
      this.ActiveBosses = this.ActiveBosses.filter((b: unknown) => (!(b.Dead) && (b !== boss)));
    }
    if ((this.ActiveBosses.length > 0)) {
      const nextBoss = this.ActiveBosses[0];
      this.OnBossBox(true, nextBoss.Name);
      return;
    }
    if (((this.Gauntlet !== null) && this.Gauntlet.Active)) {
      return;
    }
    this.Sound.SetBossMode(false);
    this.OnBossBox(false, null);
    if ((this.CurrentFloor >= this.MaxFloors)) {
      this.HandleGameOver(true);
      return;
    }
    this.State = GameState.FloorClear;
    this.FloorClearTimer = 2.6;
    this.Sound.PlayFloorClear();
  }
  onBossDefeated(defeatedBoss: Boss | null): void {
    this.OnBossDefeated(defeatedBoss);
  }
  CollectHelmetDrop(drop: HelmetDrop): void {
    if ((drop.Dead !== null)) {
      return;
    }
    drop.Dead = true;
    if (((this.Player !== null) && (typeof (this.Player.EquipHelmet) === "function"))) {
      this.Player.EquipHelmet(drop.Helmet);
    }
    this.meta.AddHelmet(drop.Helmet);
    this.Sound.PlayEat(10, true);
    this.Sound.PlayLevelUp();
    this.Fx.RingShockwave(drop.X, drop.Y, drop.Color, 90, 0.02);
    this.Fx.Burst(drop.X, drop.Y, drop.Color, 32, 7.5, 5);
    this.Fx.AddText(drop.X, (drop.Y - 26), (("🪖 LOOTED: " + String(drop.Helmet.Name)) + "!"), drop.Color, 16, true);
    const rName = ((drop.Helmet.Rarity || drop.Helmet.rarity) || "common".toUpperCase());
    const hIcon = ((drop.Helmet.Icon || drop.Helmet.icon) || "🪖");
    const hName = ((drop.Helmet.Name || drop.Helmet.name) || "Helmet");
    const statSummary = formatHelmetStatDescription(((drop.Helmet.Stats || drop.Helmet.stats) || {}));
    this.Banner((((((((("🏆 " + String(hIcon)) + " ") + String(hName)) + " [") + String(rName)) + "] LOOTED! (") + String(statSummary)) + ")"), 3.5);
  }
  collectHelmetDrop(drop: HelmetDrop): void {
    this.CollectHelmetDrop(drop);
  }
  AdvanceFloor(): void {
    for (const drop of this.HelmetDrops) {
      if (!(drop.Dead)) {
        this.CollectHelmetDrop(drop);
      }
    }
    this.HelmetDrops.length = 0;
    this.CurrentFloor = (this.CurrentFloor + 1);
    this.FloorFoodProgress = 0;
    const cfg = this.Cfg;
    this.FoodTarget = GameEngine.CalculateFoodTarget(this.CurrentFloor, cfg.BossRush);
    this.RecoveryPityCounter = 0;
    this.Enemies.length = 0;
    this.Projectiles.length = 0;
    this.Hazards.length = 0;
    if ((this.Player !== null)) {
      this.Player.IsDashing = false;
      this.Player.DashTimer = 0;
      this.Player.DashHitIds.clear();
      this.Player.AgilitySurgeTimer = 0;
      const healed = this.Player.Heal((this.Player.Stats.MaxHp * 0.5));
      if ((healed > 0)) {
        this.Fx.AddText(this.Player.X, (this.Player.Y - 30), (("+" + String(MathX.roundJs(healed))) + " HP"), "#10b981", 16, true);
      }
      this.Player.Shield = this.Player.Stats.MaxShield;
    }
    this.State = GameState.Playing;
    this.WaveTimer = 2.5;
    if ((this.GameMode === "daily")) {
      const meta = this.meta;
      if (((meta !== null) && meta.IsDailyCapacityActive())) {
        const mult = meta.EscalateDailyCapacityFloor(this.CurrentFloor);
        const powerPercent = Math.round(Math);
        const capName = (meta.DailyCapacityState?.name || "Cosmic Transcendence");
        this.Banner((((((("⚡ " + String(capName)) + " ESCALATED TO FLOOR ") + String(this.CurrentFloor)) + " (+") + String(powerPercent)) + "% Power)!"), 2.8);
        this.Sound.PlayLevelUp();
      } else {
        this.Banner(("FLOOR " + String(this.CurrentFloor)), 1.8);
      }
    } else {
      this.Banner(("FLOOR " + String(this.CurrentFloor)), 1.8);
    }
    this.Sound.SetMusicIntensity(Math.min(1, (this.CurrentFloor - (1 / 6))));
    if ((cfg.BossRush !== null)) {
      this.SpawnBoss();
    }
    this.Accumulator = 0;
  }
  advanceFloor(): void {
    this.AdvanceFloor();
  }
  nextFloor(): void {
    this.AdvanceFloor();
  }
  GetTodaySpecialCapacity(): Partial<DailyCapacityState> {
    const key = (((this.DailyKeyProvider !== null) && this.DailyKeyProvider()) || GameEngine.defaultDailyKey());
    const rolled = CosmicCapacities.rollDailyCapacity(key, this.CurrentFloor);
    return { id: rolled.Def.Id, name: rolled.Def.Name, icon: rolled.Def.Icon, desc: rolled.Def.Description, stateValues: {}, rolledTiers: {}, Id: rolled.Def.Id, Name: rolled.Def.Name, Icon: rolled.Def.Icon, Desc: rolled.Def.Description, StateValues: {}, RolledTiers: {} };
  }
  getTodaySpecialCapacity(): Partial<DailyCapacityState> {
    return this.GetTodaySpecialCapacity();
  }
  CheckDailyMilestones(): boolean {
    if (((this.GameMode !== "daily") || !(this.Player))) {
      return false;
    }
    const level = this.Player.Level;
    if ((level < 5)) {
      return false;
    }
    const meta = this.meta;
    if (!(meta)) {
      return false;
    }
    let triggered = false;
    if (((level >= 5) && (this.DailyMilestoneReached < 5))) {
      this.DailyMilestoneReached = 5;
      if (!(meta.IsDailyCapacityActive())) {
        const template = this.GetTodaySpecialCapacity();
        meta.UnlockDailySpecialCapacity(template);
      }
      meta.UpdateDailyMilestone(1, 5, 0);
      meta.EscalateDailyCapacityFloor(this.CurrentFloor);
      const capName = (meta.DailyCapacityState?.name || "Cosmic Transcendence");
      this.Banner((("✨ COSMIC TRANSCENDENCE UNLOCKED: " + String(capName.toUpperCase())) + " (Tier 1 — Active for 24h)!"), 4);
      this.Sound.PlayLevelUp();
      if ((this.Player !== null)) {
        this.Fx.RingShockwave(this.Player.X, this.Player.Y, "#ffd166", 140, 0.03);
        this.Fx.Burst(this.Player.X, this.Player.Y, "#ffd166", 45, 9, 6);
        this.Fx.AddText(this.Player.X, (this.Player.Y - 36), (("✨ " + String(capName.toUpperCase())) + "!"), "#ffd166", 20, true);
      }
      triggered = true;
    }
    if (((level >= 10) && (this.DailyMilestoneReached < 10))) {
      this.DailyMilestoneReached = 10;
      meta.UpdateDailyMilestone(2, 10, 0.5);
      const capName = (meta.DailyCapacityState?.name || "Cosmic Transcendence");
      this.Banner((("⚡ MILESTONE ASCENSION: TIER 2 — " + String(capName.toUpperCase())) + " (+50% Bonus)!"), 3.5);
      this.Sound.PlayLevelUp();
      if ((this.Player !== null)) {
        this.Fx.RingShockwave(this.Player.X, this.Player.Y, "#38bdf8", 180, 0.025);
        this.Fx.Burst(this.Player.X, this.Player.Y, "#38bdf8", 60, 11, 7);
        this.Fx.AddText(this.Player.X, (this.Player.Y - 40), "⚡ TIER 2: +50% POWER!", "#38bdf8", 22, true);
      }
      triggered = true;
    }
    if (((level >= 15) && (this.DailyMilestoneReached < 15))) {
      this.DailyMilestoneReached = 15;
      meta.UpdateDailyMilestone(3, 15, 1);
      const capName = (meta.DailyCapacityState?.name || "Cosmic Transcendence");
      this.Banner((("🌟 MILESTONE ASCENSION: TIER 3 — " + String(capName.toUpperCase())) + " (+100% Bonus)!"), 4);
      this.Sound.PlayLevelUp();
      if ((this.Player !== null)) {
        this.Fx.RingShockwave(this.Player.X, this.Player.Y, "#f59e0b", 220, 0.02);
        this.Fx.Burst(this.Player.X, this.Player.Y, "#f59e0b", 80, 13, 8);
        this.Fx.AddText(this.Player.X, (this.Player.Y - 44), "🌟 TIER 3: +100% POWER!", "#f59e0b", 24, true);
      }
      triggered = true;
    }
    if (((level >= 20) && (this.DailyMilestoneReached < 20))) {
      this.DailyMilestoneReached = 20;
      meta.UpdateDailyMilestone(4, 20, 1.5);
      const capName = (meta.DailyCapacityState?.name || "Cosmic Transcendence");
      this.Banner((("👑 APEX SINGULARITY: TIER 4 — " + String(capName.toUpperCase())) + " (+150% Bonus)!"), 5);
      this.Sound.PlayLevelUp();
      if ((this.Player !== null)) {
        this.Fx.RingShockwave(this.Player.X, this.Player.Y, "#ff0054", 260, 0.015);
        this.Fx.RingShockwave(this.Player.X, this.Player.Y, "#ffd166", 180, 0.02);
        this.Fx.Burst(this.Player.X, this.Player.Y, "#ff0054", 120, 15, 10);
        this.Fx.AddText(this.Player.X, (this.Player.Y - 48), "👑 APEX SINGULARITY (+150%)!", "#ff0054", 26, true);
      }
      triggered = true;
    }
    return triggered;
  }
  checkDailyMilestones(): boolean {
    return this.CheckDailyMilestones();
  }
  CheckDailyLevel5CapacityUnlock(): boolean {
    return this.CheckDailyMilestones();
  }
  checkDailyLevel5CapacityUnlock(): boolean {
    return this.CheckDailyLevel5CapacityUnlock();
  }
  RequestDash(): void {
    if (((this.State !== GameState.Playing) || !(this.Player))) {
      return;
    }
    if (this.Player.TryDash()) {
      Services.Input.Vibrate(18);
    }
  }
  requestDash(): void {
    this.RequestDash();
  }
  RequestSkill(): void {
    if (((this.State !== GameState.Playing) || !(this.Player))) {
      return;
    }
    if (this.Combat.ActivateSkill(this.WorldBag())) {
      Services.Input.Vibrate(GameEngine.SkillHaptic);
    }
  }
  requestSkill(): void {
    this.RequestSkill();
  }
  RequestAutotomy(): number {
    if (((this.State !== GameState.Playing) || !(this.Player))) {
      return 0;
    }
    const severed = this.Player.Autotomy(this.WorldBag());
    if ((severed > 0)) {
      Services.Input.Vibrate(GameEngine.SkillHaptic);
      this.Banner("💥 TACTICAL AUTOTOMY! 💥", 1.2);
    }
    return severed;
  }
  requestAutotomy(): number {
    return this.RequestAutotomy();
  }
  ResolveSteering(): Steering {
    const im = Services.Input;
    const steer = this._reusableSteering;
    const pointerActive = (im.PointerActive ?? im.PointerActive);
    const pointerSteers = (((pointerActive !== null) && (this.TouchScheme === "follow")) || !(this.IsTouchDevice));
    if (((pointerSteers !== null) && this.Player)) {
      const p = this.ScreenToWorld(im.PointerNormX, im.PointerNormY);
      const dx = (p.X - this.Player.X);
      const dy = (p.Y - this.Player.Y);
      const d = MathX.hypot(dx, dy);
      if ((d > 18)) {
        const nx = (dx / d);
        const ny = (dy / d);
        steer.X = nx;
        steer.Y = ny;
        steer.Active = true;
        steer.x = nx;
        steer.y = ny;
        steer.active = true;
        return steer;
      }
      steer.X = 0;
      steer.Y = 0;
      steer.Active = false;
      steer.x = 0;
      steer.y = 0;
      steer.active = false;
      return steer;
    }
    const dx = ((im.DirX ?? im.dirX) ?? 0);
    const dy = ((im.DirY ?? im.dirY) ?? 0);
    const hasDir = (((im.HasDirection ?? im.hasDirection) ?? (dx !== 0)) || (dy !== 0));
    steer.X = dx;
    steer.Y = dy;
    steer.Active = hasDir;
    steer.x = dx;
    steer.y = dy;
    steer.active = hasDir;
    return steer;
  }
  resolveSteering(): Steering {
    return this.ResolveSteering();
  }
  WorldBag(): World {
    this._world.Player = this.Player;
    this._world.Foods = this.Foods;
    this._world.Enemies = this.Enemies;
    this._world.Projectiles = this.Projectiles;
    this._world.Hazards = this.Hazards;
    this._world.Boss = this.Boss;
    this._world.ActiveBosses = this.ActiveBosses;
    this._world.Bosses = this.ActiveBosses;
    this._world.HelmetDrops = this.HelmetDrops;
    this._world.ArenaW = this.ArenaW;
    this._world.ArenaH = this.ArenaH;
    this._world.TimeScale = this.TimeScale;
    this._world.VacuumTimer = this.VacuumTimer;
    this._world.ChronoTimer = this.ChronoTimer;
    this._world.NearestFood = null;
    this._world.ChronoScale = 1;
    this._world.Game = this;
    return this._world;
  }
  worldBag(): World {
    return this.WorldBag();
  }
  get World(): World {
    return this.WorldBag();
  }
  get world(): World {
    return this.WorldBag();
  }
  ReplaceProjectiles(list: Projectile[]): void {
    this.Projectiles = list;
  }
  replaceProjectiles(list: Projectile[]): void {
    this.ReplaceProjectiles(list);
  }
  OnPlayerHurt(dealt: number): void {
    this.Vignette = Math.min(1, ((this.Vignette + (dealt / 60)) + 0.25));
    Services.Input.Vibrate(Math.min(90, (25 + dealt)));
  }
  onPlayerHurt(dealt: number): void {
    this.OnPlayerHurt(dealt);
  }
  Step(dt: number): void {
    const player = this.Player;
    if (!(player)) {
      return;
    }
    if (((this.GameMode === "daily") && (player.Level >= 5))) {
      this.CheckDailyMilestones();
    }
    if ((this.isBotEnabled !== null)) {
      this.botPlayer.stepPolicy(this, this.Input);
    }
    Services.Input.PollGamepad();
    if (Services.Input.ConsumeJustConnected()) {
      this.Banner("🎮 GAMEPAD CONNECTED", 1.6);
      Services.Sound.PlayUi();
    }
    if (Services.Input.ConsumeDash()) {
      this.RequestDash();
    }
    if (Services.Input.ConsumeSkill()) {
      this.RequestSkill();
    }
    if (((!(this.HasSteered) && Services.Input.HasDirection) || this.isBotEnabled)) {
      this.HasSteered = true;
      this.OnSteered(true);
    }
    if ((this.ChronoTimer > 0)) {
      this.ChronoTimer = Math.max(0, (this.ChronoTimer - dt));
    }
    const chronoScale = (((this.ChronoTimer > 0) && 0.55) || 1);
    let nearestFood: FoodItem | null = null;
    let nearestDist = Number.POSITIVE_INFINITY;
    const w = this.WorldBag();
    w.NearestFood = nearestFood;
    w.ChronoScale = chronoScale;
    w.TimeScale = (this.Combat.DilationScale(player) * chronoScale);
    this.TimeScale = w.TimeScale;
    player.Update(dt, this.ResolveSteering(), this.ArenaW, this.ArenaH, w);
    const vacuumPull = (((this.VacuumTimer > 0) && 900) || 0);
    this.Combat.Update(dt, w);
    this.VacuumTimer = w.VacuumTimer;
    this.ChronoTimer = Math.max(this.ChronoTimer, w.ChronoTimer);
    if ((w.Projectiles !== this.Projectiles)) {
      this.Projectiles = w.Projectiles;
    }
    if (((this.Gauntlet !== null) && this.Gauntlet.Active)) {
      this.Gauntlet.Update(dt, this);
    }
    if ((!(player.Alive) || (player.Hp <= 0))) {
      if (((this.Gauntlet !== null) && this.Gauntlet.Active)) {
        this.Gauntlet.TriggerDefeat(this);
      }
      this.HandleGameOver(false);
      return;
    }
    if (((!(this.GrowthOnEat) && !(this.LabIntroSeen)) && (player.Xp >= 50))) {
      this.LabIntroSeen = true;
      this.TriggerLevelUp();
      return;
    }
    if (((this.GrowthOnEat !== null) && (player.PendingLevelUps > 0))) {
      player.PendingLevelUps = (player.PendingLevelUps - 1);
      this.TriggerLevelUp();
      return;
    }
    this.UpdateSpawning(dt);
    const cfg = this.Cfg;
    this.FloorFoodProgress = (this.Combat.FoodsEaten - this.FloorFoodBase());
    if (((!(cfg.BossRush) && (this.ActiveBosses.length === 0)) && (this.FloorFoodProgress >= this.FoodTarget))) {
      this.SpawnBoss();
    }
    Services.Fx.Update(dt);
  }
  step(dt: number): void {
    this.Step(dt);
  }
  FloorFoodBase(): number {
    if ((this._floorBaseFloor !== this.CurrentFloor)) {
      this._floorBaseFloor = this.CurrentFloor;
      this._floorBaseEaten = this.Combat.FoodsEaten;
    }
    return this._floorBaseEaten;
  }
  floorFoodBase(): number {
    return this.FloorFoodBase();
  }
  UpdateSpawning(dt: number): void {
    this.FoodSpawnTimer = (this.FoodSpawnTimer + dt);
    const foodCap = (9 + Math.min(6, this.CurrentFloor));
    if (((this.FoodSpawnTimer >= 1.35) && (this.Foods.length < foodCap))) {
      this.FoodSpawnTimer = 0;
      this.SpawnFood();
    }
    if ((this.Foods.length === 0)) {
      this.SpawnFood("apple");
    }
    const budget = this.EnemyBudget();
    this.WaveTimer = (this.WaveTimer - dt);
    if (((this.WaveTimer <= 0) && (this.Enemies.length < budget))) {
      const packSize = (((this.Boss !== null) && 1) || MathX.clamp((1 + Math.floor(Math)), 1, 4));
      this.WaveTimer = Math.max(1.1, (((this.Boss !== null) && 5.5) || (3.6 - (this.CurrentFloor * 0.28))));
    }
    if ((this.Projectiles.length > Caps.Projectiles)) {
      this.Projectiles.splice(0, (this.Projectiles.length - Caps.Projectiles));
    }
    if ((this.Hazards.length > Caps.Hazards)) {
      this.Hazards.splice(0, (this.Hazards.length - Caps.Hazards));
    }
    if ((this.Foods.length > Caps.Foods)) {
      this.Foods.splice(0, (this.Foods.length - Caps.Foods));
    }
  }
  updateSpawning(dt: number): void {
    this.UpdateSpawning(dt);
  }
  Tick(frameDt: number): void {
    const dt = Math.min(0.25, Math.max(0, frameDt));
    this.FrameCount = (this.FrameCount + 1);
    this.FpsAccum = (this.FpsAccum + dt);
    this.FpsSamples = (this.FpsSamples + 1);
    if ((this.FpsAccum >= 0.5)) {
      this.Fps = (this.FpsSamples / this.FpsAccum);
      this.FpsAccum = 0;
      this.FpsSamples = 0;
    }
    if (Services.Input.ConsumePause()) {
      if (((this.State === GameState.Playing) || (this.State === GameState.Paused))) {
        this.TogglePause();
      } else if ((this.State === GameState.Settings)) {
        this.CloseSettings();
      }
    }
    if (Services.Input.ConsumeLab()) {
      this.ToggleLab();
    }
    if (Services.Input.ConsumeHelp()) {
      this.ToggleHelp();
    }
    if (Services.Input.ConsumeStats()) {
      this.ToggleStats();
    }
    if (Services.Input.ConsumeBotToggle()) {
      this.toggleBot();
    }
    this.UpdateBanner(dt);
    this.UpdateVignette(dt);
    if ((this.State === GameState.FloorClear)) {
      this.FloorClearTimer = (this.FloorClearTimer - dt);
      Services.Fx.Update(dt);
      Services.Input.PollGamepad();
      Services.Input.ConsumeDash();
      Services.Input.ConsumeSkill();
      if ((this.isBotEnabled !== null)) {
        this._botFloorClearTimer = (this._botFloorClearTimer + dt);
        if ((this._botFloorClearTimer >= 0.6)) {
          this._botFloorClearTimer = 0;
          this.AdvanceFloor();
        }
      } else if ((this.FloorClearTimer <= 0)) {
        this.AdvanceFloor();
      }
    } else if ((this.State === GameState.LevelUp)) {
      this.Fx.Update(dt);
      if ((this.isBotEnabled !== null)) {
        this._botDraftTimer = (this._botDraftTimer + dt);
        if ((this._botDraftTimer >= 0.2)) {
          this._botDraftTimer = 0;
          this.botPlayer.handleLevelUp(this);
        }
      }
    }
    this.OnDraw();
  }
  tick(frameDt: number): void {
    this.Tick(frameDt);
  }
  update(frameDt: number): void {
    this.Tick(frameDt);
  }
  Update(frameDt: number): void {
    this.Tick(frameDt);
  }
}
