/**
 * Ouroboros Ascension — Core Dependency Injection & Service Registry (Services.ts)
 *
 * Implements decoupled service locator and dependency injection container architecture
 * supporting both ambient global singletons and fully isolated, thread/promise-safe
 * service containers for concurrent bot sweeps, headless simulations, and multi-screen sync.
 */

import { IFx, ISound, IInput, ISaveIO, NullFx, NullSound, MockSound, ScriptedInput } from './Contracts.js';

export { MockSound } from './Contracts.js';

/**
 * Service Container Contract interface providing decoupled references to audio, FX,
 * user input, simulation persistence, engine instances, and meta progression.
 */
export interface IServiceContainer<TEngine = any, TMeta = any> {
  engine: TEngine;
  meta: TMeta;
  fx: IFx;
  sound: ISound;
  input: IInput;
  save: ISaveIO | null;
  saveIO: ISaveIO | null;
  headless: boolean;

  Engine: TEngine;
  Meta: TMeta;
  Fx: IFx;
  Sound: ISound;
  Input: IInput;
  Save: ISaveIO | null;
  SaveIO: ISaveIO | null;
  Headless: boolean;

  registerMetaProvider(provider: () => TMeta): void;
  registerEngineProvider(provider: () => TEngine): void;
  resetToNull(): void;
  ResetToNull(): void;
}

/**
 * Fully isolated Dependency Injection container instance.
 * Ensures concurrent bot simulations or multiple GameEngine instances running in parallel
 * do not clobber or cross-contaminate audio DSP, visual particle pools, scripted inputs, or meta states.
 */
export class ServiceContainer<TEngine = any, TMeta = any> implements IServiceContainer<TEngine, TMeta> {
  private _engine: TEngine = null as unknown as TEngine;
  private _meta: TMeta = null as unknown as TMeta;
  private _engineProvider: (() => TEngine) | null = null;
  private _metaProvider: (() => TMeta) | null = null;

  public fx: IFx = new NullFx();
  public sound: ISound = new NullSound();
  public input: IInput = new ScriptedInput();
  public save: ISaveIO | null = null;
  public saveIO: ISaveIO | null = null;
  public headless = false;

  public get Fx(): IFx { return this.fx; }
  public set Fx(v: IFx) { this.fx = v; }

  public get Sound(): ISound { return this.sound; }
  public set Sound(v: ISound) { this.sound = v; }

  public get Input(): IInput { return this.input; }
  public set Input(v: IInput) { this.input = v; }

  public get Save(): ISaveIO | null { return this.save; }
  public set Save(v: ISaveIO | null) { this.save = v; }

  public get SaveIO(): ISaveIO | null { return this.saveIO; }
  public set SaveIO(v: ISaveIO | null) { this.saveIO = v; }

  public get Headless(): boolean { return this.headless; }
  public set Headless(v: boolean) { this.headless = v; }

  /**
   * Registers a dynamic provider callback for resolving the active MetaProgression instance.
   */
  public registerMetaProvider(provider: () => any): void {
    this._metaProvider = provider;
  }

  /**
   * Registers a dynamic provider callback for resolving the active GameEngine instance.
   */
  public registerEngineProvider(provider: () => any): void {
    this._engineProvider = provider;
  }

  public get Engine(): any {
    if (this._engineProvider) return this._engineProvider();
    return this._engine;
  }
  public set Engine(v: any) {
    this._engine = v;
  }

  public get engine(): any { return this.Engine; }
  public set engine(v: any) { this.Engine = v; }

  public get Meta(): any {
    if (this._metaProvider) return this._metaProvider();
    if (this._meta) return this._meta;
    return null;
  }
  public set Meta(v: any) {
    this._meta = v;
  }

  public get meta(): any { return this.Meta; }
  public set meta(v: any) { this.Meta = v; }

  /**
   * Resets active FX, Sound, and Input handlers to null-object defaults to prevent memory leaks.
   */
  public ResetToNull(): void {
    this.fx = new NullFx();
    this.sound = new NullSound();
    this.input = new ScriptedInput();
  }

  public resetToNull(): void {
    this.ResetToNull();
  }
}

/**
 * Ambient Service Locator registry.
 * Maintains global static properties for backwards compatibility while delegating
 * to an internal default container, alongside factory methods for spawning isolated containers.
 */
export class Services {
  private static readonly _defaultContainer: ServiceContainer = new ServiceContainer();

  /**
   * Spawns a brand-new, isolated ServiceContainer instance with decoupled Null audio,
   * Null FX, and ScriptedInput handlers for concurrent simulation runs.
   */
  public static createIsolated(): ServiceContainer {
    return new ServiceContainer();
  }

  /**
   * Returns the ambient default service container.
   */
  public static get defaultContainer(): ServiceContainer {
    return Services._defaultContainer;
  }

  public static registerMetaProvider(provider: () => any): void {
    Services._defaultContainer.registerMetaProvider(provider);
  }

  public static registerEngineProvider(provider: () => any): void {
    Services._defaultContainer.registerEngineProvider(provider);
  }

  public static get Engine(): any {
    return Services._defaultContainer.Engine;
  }
  public static set Engine(v: any) {
    Services._defaultContainer.Engine = v;
  }

  public static get engine(): any {
    return Services.Engine;
  }
  public static set engine(v: any) {
    Services.Engine = v;
  }

  public static get Meta(): any {
    const m = Services._defaultContainer.Meta;
    if (!m) {
      throw new Error('MetaProgression provider not registered');
    }
    return m;
  }
  public static set Meta(v: any) {
    Services._defaultContainer.Meta = v;
  }

  public static get meta(): any {
    return Services.Meta;
  }
  public static set meta(v: any) {
    Services.Meta = v;
  }

  public static get Fx(): IFx { return Services._defaultContainer.Fx; }
  public static set Fx(v: IFx) { Services._defaultContainer.Fx = v; }
  public static get fx(): IFx { return Services._defaultContainer.fx; }
  public static set fx(v: IFx) { Services._defaultContainer.fx = v; }

  public static get Sound(): ISound { return Services._defaultContainer.Sound; }
  public static set Sound(v: ISound) { Services._defaultContainer.Sound = v; }
  public static get sound(): ISound { return Services._defaultContainer.sound; }
  public static set sound(v: ISound) { Services._defaultContainer.sound = v; }

  public static get Input(): IInput { return Services._defaultContainer.Input; }
  public static set Input(v: IInput) { Services._defaultContainer.Input = v; }
  public static get input(): IInput { return Services._defaultContainer.input; }
  public static set input(v: IInput) { Services._defaultContainer.input = v; }

  public static get Save(): ISaveIO | null { return Services._defaultContainer.Save; }
  public static set Save(v: ISaveIO | null) { Services._defaultContainer.Save = v; }
  public static get save(): ISaveIO | null { return Services._defaultContainer.save; }
  public static set save(v: ISaveIO | null) { Services._defaultContainer.save = v; }

  public static get SaveIO(): ISaveIO | null { return Services._defaultContainer.SaveIO; }
  public static set SaveIO(v: ISaveIO | null) { Services._defaultContainer.SaveIO = v; }
  public static get saveIO(): ISaveIO | null { return Services._defaultContainer.saveIO; }
  public static set saveIO(v: ISaveIO | null) { Services._defaultContainer.saveIO = v; }

  public static get Headless(): boolean { return Services._defaultContainer.Headless; }
  public static set Headless(v: boolean) { Services._defaultContainer.Headless = v; }
  public static get headless(): boolean { return Services._defaultContainer.headless; }
  public static set headless(v: boolean) { Services._defaultContainer.headless = v; }

  public static ResetToNull(): void {
    Services._defaultContainer.ResetToNull();
  }

  public static resetToNull(): void {
    Services.ResetToNull();
  }
}

/**
 * Hard caps for simulation entity pools and rendering caches.
 */
export const Caps = {
  Projectiles: 900,
  Hazards: 120,
  Foods: 90,
  Segments: 260,
  FxParticles: 700,
  FxTexts: 80,
  FxBeams: 24,
  GradCache: 512,
} as const;
