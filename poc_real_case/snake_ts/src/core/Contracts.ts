/**
 * Ouroboros Ascension — Service Contracts & Interfaces (Contracts.ts)
 *
 * Sim-facing service contracts ported from C# Core.Contracts.
 * Enables zero-dependency simulation and headless testing.
 */


/** Sim-facing subset of FX manager. Units are per-1/60s frame. */
export interface IFx {
  readonly OffsetX?: number;
  readonly OffsetY?: number;
  readonly offsetX?: number;
  readonly offsetY?: number;

  AddText(x: number, y: number, text: string, color: string, size?: number, bold?: boolean): void;
  addText(x: number, y: number, text: string, color: string, size?: number, bold?: boolean): void;

  Shake(intensity: number, durationFrames: number): void;
  shake(intensity: number, durationFrames: number): void;

  Burst(x: number, y: number, color: string, count: number, speed: number, size: number, shape?: string): void;
  burst(x: number, y: number, color: string, count: number, speed: number, size: number, shape?: string): void;

  Explosion?(x: number, y: number, color?: string, radius?: number, intensity?: number): void;
  explosion?(x: number, y: number, color?: string, radius?: number, intensity?: number): void;

  RingShockwave(x: number, y: number, color: string, startSize: number, decay?: number): void;
  ringShockwave(x: number, y: number, color: string, startSize: number, decay?: number): void;

  TrailEmbers(x: number, y: number, color: string, size: number): void;
  trailEmbers(x: number, y: number, color: string, size: number): void;

  Beam(x1: number, y1: number, x2: number, y2: number, color: string, width: number, life: number): void;
  beam(x1: number, y1: number, x2: number, y2: number, color: string, width: number, life: number): void;

  Flash(color: string, alpha: number, life: number): void;
  flash(color: string, alpha: number, life: number): void;

  Clear(): void;
  clear(): void;

  /** Advances the FX pools. Called once per FRAME from the engine, not per step. */
  Update(dt: number): void;
  update(dt: number): void;
}

export type IFxManager = IFx;

/** Sim-facing subset of sound engine. Every call is rate-limited and voice-capped. */
export interface ISound {
  PlayEat(combo: number, isGolden: boolean): void;
  playEat(combo?: number | boolean, isGolden?: boolean): void;

  PlayDash(): void;
  playDash(): void;

  PlayHit(intensity?: number): void;
  playHit(intensity?: number): void;

  PlayShoot(freq?: number): void;
  playShoot(freq?: number): void;

  PlayExplosion(intensity?: number): void;
  playExplosion(intensity?: number): void;

  PlayLevelUp(): void;
  playLevelUp(): void;

  PlayFrenzy(): void;
  playFrenzy(): void;

  PlayBossAlert(phase?: number): void;
  playBossAlert(phase?: number): void;


  PlayCrit(): void;
  playCrit(): void;

  PlaySkill(): void;
  playSkill(): void;

  PlayShield(): void;
  playShield(): void;

  PlayShard(): void;
  playShard(): void;
  PlayStar?(): void;
  playStar?(): void;

  PlayUi(): void;
  playUi(): void;

  PlayError(): void;
  playError(): void;

  PlayThunder(): void;
  playThunder(): void;

  PlayFlame(): void;
  playFlame(): void;

  PlayRevive(): void;
  playRevive(): void;

  PlayFloorClear(): void;
  playFloorClear(): void;

  PlayVictory(): void;
  playVictory(): void;

  PlayGameOver(): void;
  playGameOver(): void;

  SetFrenzyState(on: boolean): void;
  setFrenzyState(on: boolean): void;

  SetMusicIntensity(intensity01: number): void;
  setMusicIntensity(intensity01: number): void;

  SetBossMode(on: boolean): void;
  setBossMode(on: boolean): void;

  StartMusic(): void;
  startMusic(): void;

  StopMusic(): void;
  stopMusic(): void;

  SetPaused(paused: boolean): void;
  setPaused(paused: boolean): void;
  readonly paused?: boolean;

  setSfxVolume?(vol: number): void;
  setMusicVolume?(vol: number): void;
  setMuted?(muted: boolean): void;
  init?(): void;
  Init?(): void;

  playBite?(damage?: number, critical?: boolean): void;
  playHurt?(damage?: number): void;
  playDie?(): void;
  playLaserFire?(frequency?: number): void;
  playCardPick?(rarity?: string): void;
  playBossRoar?(phase?: number): void;
  playComboTick?(combo: number): void;
  playFrenzyStart?(): void;
  playShieldBreak?(): void;
  playUiClick?(): void;
  playUiHover?(): void;
  playWarpJump(): void;
  PlayWarpJump?(): void;
  playUniqueHelmetReveal(): void;
  PlayUniqueHelmetReveal?(): void;
  playVoidCollapse?(): void;
  PlayVoidCollapse?(): void;
}

export type ISoundEngine = ISound;

/** Sim-facing subset of input manager: steering vector and edge-triggered actions. */
export interface IInput {
  readonly DirX: number;
  readonly DirY: number;
  readonly HasDirection: boolean;
  readonly dirX?: number;
  readonly dirY?: number;
  readonly hasDirection?: boolean;

  DashHeld: boolean;
  SkillHeld: boolean;
  PointerActive: boolean;
  PointerNormX: number;
  PointerNormY: number;

  readonly GamepadConnected: boolean;

  ConsumeJustConnected(): boolean;
  ConsumeDash(): boolean;
  ConsumeSkill(): boolean;
  ConsumePause(): boolean;
  ConsumeLab(): boolean;
  ConsumeHelp?(): boolean;
  ConsumeStats?(): boolean;
  ConsumeBotToggle?(): boolean;

  consumeJustConnected?(): boolean;
  consumeDash?(): boolean;
  consumeSkill?(): boolean;
  consumePause?(): boolean;
  consumeLab?(): boolean;
  consumeHelp?(): boolean;
  consumeStats?(): boolean;
  consumeBotToggle?(): boolean;

  RequestDash?(): void;
  RequestSkill?(): void;
  RequestPause?(): void;
  RequestLab?(): void;
  RequestHelp?(): void;
  RequestStats?(): void;
  requestDash?(): void;
  requestSkill?(): void;
  requestPause?(): void;
  requestLab?(): void;

  PollGamepad(): void;
  pollGamepad?(): void;

  Reset(): void;
  reset?(): void;

  SetDirection(dx: number, dy: number): void;
  setDirection?(dx: number, dy: number): void;

  Vibrate(msOrPattern: number | readonly number[]): void;
  vibrate?(msOrPattern: number | readonly number[]): void;
}

export type IInputSource = IInput;

/** Storage backend contract for persistent save data. */
export interface ISaveIO {
  read(key: string): string | null;
  write(key: string, value: string): void;
  delete(key: string): void;
}

/** Abstract 2D renderer contract. */
export interface IRenderer {
  draw(): void;
  resize(width: number, height: number, dpr: number): void;
  clear(): void;
}

/**
 * Combat-facing damage recipient contract implemented by enemies, bosses, and destructible entities.
 */
export interface IDamageable {
  takeDamage(amount: number, source?: unknown): number;
  TakeDamage?(amount: number, source?: unknown): number;
  readonly dead?: boolean;
  readonly Dead?: boolean;
  readonly vulnerable?: boolean;
  readonly Vulnerable?: boolean;
  readonly x?: number;
  readonly y?: number;
  readonly X?: number;
  readonly Y?: number;
  readonly radius?: number;
  readonly Radius?: number;
  readonly hp?: number;
  readonly Hp?: number;
}

/**
 * Decoupled simulation engine contract for headless execution and subagent isolation.
 */
export interface ISimEngine {
  readonly arenaW: number;
  readonly arenaH: number;
  readonly currentFloor: number;
  readonly activeBosses?: readonly unknown[];
  readonly world?: unknown;
  [key: string]: unknown;
}

/**
 * UI presentation abstraction contract decoupling GameEngine from concrete UI views.
 */
export interface IUiRoot {
  showScreen(id: string, payload?: unknown): void;
  closeAllModals(): void;
  hudView?: {
    setVisible(visible: boolean): void;
    update(): void;
    showBanner(text: string, seconds: number): void;
    hideBanner(): void;
    showToast(message: string, seconds: number): void;
    setVignette(opacity: number): void;
    setBossBox(visible: boolean, name: string | null): void;
    updatePerks(): void;
  };
  getScreen?(id: string): { refresh?(): void } | undefined;
}


// ============================================================================
// No-Op Defaults (Headless / Self-Test / Unit Testing)
// ============================================================================

export class NullFx implements IFx {
  public get OffsetX(): number { return 0; }
  public get OffsetY(): number { return 0; }
  public get offsetX(): number { return 0; }
  public get offsetY(): number { return 0; }

  public AddText(_x: number, _y: number, _text: string, _color: string, _size = 16, _bold = false): void {}
  public addText(x: number, y: number, text: string, color: string, size = 16, bold = false): void {
    this.AddText(x, y, text, color, size, bold);
  }

  public Shake(_intensity: number, _durationFrames: number): void {}
  public shake(intensity: number, durationFrames: number): void {
    this.Shake(intensity, durationFrames);
  }

  public Burst(_x: number, _y: number, _color: string, _count: number, _speed: number, _size: number, _shape = 'circle'): void {}
  public burst(x: number, y: number, color: string, count: number, speed: number, size: number, shape = 'circle'): void {
    this.Burst(x, y, color, count, speed, size, shape);
  }

  public Explosion(_x: number, _y: number, _color?: string, _radius?: number, _intensity?: number): void {}
  public explosion(x: number, y: number, color?: string, radius?: number, intensity?: number): void {
    this.Explosion(x, y, color, radius, intensity);
  }

  public RingShockwave(_x: number, _y: number, _color: string, _startSize: number, _decay = 0.035): void {}
  public ringShockwave(x: number, y: number, color: string, startSize: number, decay = 0.035): void {
    this.RingShockwave(x, y, color, startSize, decay);
  }

  public TrailEmbers(_x: number, _y: number, _color: string, _size: number): void {}
  public trailEmbers(x: number, y: number, color: string, size: number): void {
    this.TrailEmbers(x, y, color, size);
  }

  public Beam(_x1: number, _y1: number, _x2: number, _y2: number, _color: string, _width: number, _life: number): void {}
  public beam(x1: number, y1: number, x2: number, y2: number, color: string, width: number, life: number): void {
    this.Beam(x1, y1, x2, y2, color, width, life);
  }

  public Flash(_color: string, _alpha: number, _life: number): void {}
  public flash(color: string, alpha: number, life: number): void {
    this.Flash(color, alpha, life);
  }

  public Clear(): void {}
  public clear(): void { this.Clear(); }

  public Update(_dt: number): void {}
  public update(dt: number): void { this.Update(dt); }
}

export class NullSound implements ISound {
  public PlayEat(_combo = 1, _isGolden = false): void {}
  public playEat(combo: number | boolean = 1, isGolden = false): void {
    if (typeof combo === 'boolean') this.PlayEat(1, combo);
    else this.PlayEat(combo, isGolden);
  }

  public PlayDash(): void {}
  public playDash(): void { this.PlayDash(); }

  public PlayHit(): void {}
  public playHit(): void { this.PlayHit(); }

  public PlayShoot(): void {}
  public playShoot(): void { this.PlayShoot(); }

  public PlayExplosion(_intensity = 1): void {}
  public playExplosion(intensity = 1): void { this.PlayExplosion(intensity); }

  public PlayLevelUp(): void {}
  public playLevelUp(): void { this.PlayLevelUp(); }

  public PlayFrenzy(): void {}
  public playFrenzy(): void { this.PlayFrenzy(); }

  public PlayBossAlert(): void {}
  public playBossAlert(): void { this.PlayBossAlert(); }

  public PlayCrit(): void {}
  public playCrit(): void { this.PlayCrit(); }

  public PlaySkill(): void {}
  public playSkill(): void { this.PlaySkill(); }

  public PlayShield(): void {}
  public playShield(): void { this.PlayShield(); }

  public PlayShard(): void {}
  public playShard(): void { this.PlayShard(); }
  public PlayStar(): void {}
  public playStar(): void { this.PlayStar(); }

  public PlayUi(): void {}
  public playUi(): void { this.PlayUi(); }

  public PlayError(): void {}
  public playError(): void { this.PlayError(); }

  public PlayThunder(): void {}
  public playThunder(): void { this.PlayThunder(); }

  public PlayFlame(): void {}
  public playFlame(): void { this.PlayFlame(); }

  public PlayRevive(): void {}
  public playRevive(): void { this.PlayRevive(); }

  public PlayFloorClear(): void {}
  public playFloorClear(): void { this.PlayFloorClear(); }

  public PlayVictory(): void {}
  public playVictory(): void { this.PlayVictory(); }

  public PlayGameOver(): void {}
  public playGameOver(): void { this.PlayGameOver(); }

  public SetFrenzyState(_on: boolean): void {}
  public setFrenzyState(on: boolean): void { this.SetFrenzyState(on); }

  public SetMusicIntensity(_intensity01: number): void {}
  public setMusicIntensity(intensity01: number): void { this.SetMusicIntensity(intensity01); }

  public SetBossMode(_on: boolean): void {}
  public setBossMode(on: boolean): void { this.SetBossMode(on); }

  public StartMusic(): void {}
  public startMusic(): void { this.StartMusic(); }

  public StopMusic(): void {}
  public stopMusic(): void { this.StopMusic(); }

  public paused: boolean = false;
  public SetPaused(paused: boolean): void { this.paused = paused; }
  public setPaused(paused: boolean): void { this.SetPaused(paused); }

  public setSfxVolume(_vol: number): void {}
  public setMusicVolume(_vol: number): void {}
  public setMuted(_muted: boolean): void {}
  public init(): void {}
  public Init(): void {}

  public playBite(_damage?: number, _critical?: boolean): void {}
  public playHurt(_damage?: number): void {}
  public playDie(): void {}
  public playLaserFire(_frequency?: number): void {}
  public playCardPick(_rarity?: string): void {}
  public playBossRoar(_phase?: number): void {}
  public playComboTick(_combo: number): void {}
  public playFrenzyStart(): void {}
  public playShieldBreak(): void {}
  public playUiClick(): void {}
  public playUiHover(): void {}
  public PlayWarpJump(): void {}
  public playWarpJump(): void { this.PlayWarpJump(); }
  public PlayUniqueHelmetReveal(): void { this.PlayLevelUp(); }
  public playUniqueHelmetReveal(): void { this.PlayUniqueHelmetReveal(); }
  public PlayVoidCollapse(): void { this.PlayGameOver(); }
  public playVoidCollapse(): void { this.PlayVoidCollapse(); }
}

/**
 * Headless test and mock sound implementation supporting call inspection,
 * invocation tracking, and deterministic headless simulation execution.
 */
export class MockSound extends NullSound implements ISound {
  public warpJumpCalls = 0;
  public uniqueHelmetRevealCalls = 0;
  public voidCollapseCalls = 0;

  public override PlayWarpJump(): void {
    this.warpJumpCalls++;
    super.PlayWarpJump();
  }
  public override playWarpJump(): void {
    this.PlayWarpJump();
  }

  public override PlayUniqueHelmetReveal(): void {
    this.uniqueHelmetRevealCalls++;
    super.PlayUniqueHelmetReveal();
  }
  public override playUniqueHelmetReveal(): void {
    this.PlayUniqueHelmetReveal();
  }

  public override PlayVoidCollapse(): void {
    this.voidCollapseCalls++;
    super.PlayVoidCollapse();
  }
  public override playVoidCollapse(): void {
    this.PlayVoidCollapse();
  }
}

/** Headless / scripted input. Tests drive the game by writing DirX/DirY and the action flags. */
export class ScriptedInput implements IInput {
  public dirX = 0;
  public dirY = 0;

  public get DirX(): number { return this.dirX; }
  public set DirX(v: number) { this.dirX = v; }
  public get DirY(): number { return this.dirY; }
  public set DirY(v: number) { this.dirY = v; }
  public get HasDirection(): boolean { return this.dirX !== 0 || this.dirY !== 0; }
  public get hasDirection(): boolean { return this.HasDirection; }

  public DashHeld = false;
  public SkillHeld = false;
  public PointerActive = false;
  public PointerNormX = 0;
  public PointerNormY = 0;

  public DashQueued = false;
  public SkillQueued = false;
  public PauseQueued = false;
  public LabQueued = false;
  public HelpQueued = false;
  public StatsQueued = false;
  public BotToggleQueued = false;

  public get GamepadConnected(): boolean { return false; }
  public ConsumeJustConnected(): boolean { return false; }
  public consumeJustConnected(): boolean { return this.ConsumeJustConnected(); }

  public PollGamepad(): void {}
  public pollGamepad(): void { this.PollGamepad(); }

  public ConsumeDash(): boolean {
    const v = this.DashQueued;
    this.DashQueued = false;
    return v;
  }
  public consumeDash(): boolean { return this.ConsumeDash(); }

  public ConsumeSkill(): boolean {
    const v = this.SkillQueued;
    this.SkillQueued = false;
    return v;
  }
  public consumeSkill(): boolean { return this.ConsumeSkill(); }

  public ConsumePause(): boolean {
    const v = this.PauseQueued;
    this.PauseQueued = false;
    return v;
  }
  public consumePause(): boolean { return this.ConsumePause(); }

  public ConsumeLab(): boolean {
    const v = this.LabQueued;
    this.LabQueued = false;
    return v;
  }
  public consumeLab(): boolean { return this.ConsumeLab(); }

  public ConsumeHelp(): boolean {
    const v = this.HelpQueued;
    this.HelpQueued = false;
    return v;
  }
  public consumeHelp(): boolean { return this.ConsumeHelp(); }

  public ConsumeStats(): boolean {
    const v = this.StatsQueued;
    this.StatsQueued = false;
    return v;
  }
  public consumeStats(): boolean { return this.ConsumeStats(); }

  public ConsumeBotToggle(): boolean {
    const v = this.BotToggleQueued;
    this.BotToggleQueued = false;
    return v;
  }
  public consumeBotToggle(): boolean { return this.ConsumeBotToggle(); }

  public RequestDash(): void { this.DashQueued = true; }
  public requestDash(): void { this.RequestDash(); }
  public RequestSkill(): void { this.SkillQueued = true; }
  public requestSkill(): void { this.RequestSkill(); }
  public RequestPause(): void { this.PauseQueued = true; }
  public requestPause(): void { this.RequestPause(); }
  public RequestLab(): void { this.LabQueued = true; }
  public requestLab(): void { this.RequestLab(); }
  public RequestHelp(): void { this.HelpQueued = true; }
  public RequestStats(): void { this.StatsQueued = true; }

  public Reset(): void {
    this.dirX = 0;
    this.dirY = 0;
    this.DashHeld = false;
    this.SkillHeld = false;
    this.DashQueued = false;
    this.SkillQueued = false;
    this.PauseQueued = false;
    this.LabQueued = false;
    this.HelpQueued = false;
    this.StatsQueued = false;
  }
  public reset(): void { this.Reset(); }

  public SetDirection(dx: number, dy: number): void {
    this.dirX = dx;
    this.dirY = dy;
  }
  public setDirection(dx: number, dy: number): void { this.SetDirection(dx, dy); }

  public Vibrate(_msOrPattern: number | readonly number[]): void {}
  public vibrate(msOrPattern: number | readonly number[]): void { this.Vibrate(msOrPattern); }
}

