import { MathX } from "../core/MathX";
import { Services } from "../core/Services";
import { Projectile } from "./Projectile";
import { Hazard } from "./Hazard";
import { Enemy } from "./Enemy";
import { Boss } from "./Boss";
import { SnakePlayer } from "./SnakePlayer";
import { CombatSystem } from "./CombatSystem";
import { World } from "./World";

export interface ModuleActionContext {
  sys: CombatSystem;
  dt: number;
  world: World;
  player: SnakePlayer;
  moduleType: string;
  level: number;
  isHead: boolean;
  originX: number;
  originY: number;
  angle: number;
  dmgBonus: number;
  getTimer: () => number;
  setTimer: (number) => void;
  socket: unknown | null;
  slotIndex: number | null;
}

export function ModuleActionContext(sys: CombatSystem, dt: number, world: World, player: SnakePlayer, moduleType: string, level: number, isHead: boolean, originX: number, originY: number, angle: number, dmgBonus: number, getTimer: () => number, setTimer: (number) => void, socket: unknown | null, slotIndex: number | null): ModuleActionContext {
  return { sys, dt, world, player, moduleType, level, isHead, originX, originY, angle, dmgBonus, getTimer, setTimer, socket, slotIndex };
}

export type ModuleActionHandler = (ModuleActionContext) => void;

const _cachedNearestTarget: unknown = { x: 0, y: 0 };

export function findNearestTarget(ctx: ModuleActionContext, maxRange: number): unknown | null {
  const enemies = World.getEnemies(ctx.world);
  let found = false;
  let bestX = 0;
  let bestY = 0;
  let minDist = maxRange;
  if ((enemies !== null)) {
    null;
  }
  const bosses = World.getBosses(ctx.world);
  if ((found !== null)) {
    _cachedNearestTarget.x = bestX;
    _cachedNearestTarget.y = bestY;
    return _cachedNearestTarget;
  }
  return null;
}

export class ModuleActionRegistry {
  static readonly _handlers: Map<string, ModuleActionHandler> = new Map();
  static register(key: string, handler: ModuleActionHandler): void {
    this._handlers.set(key, handler);
  }
  static get(key: string): ModuleActionHandler | null {
    return (this._handlers.at(key) ?? null);
  }
  static has(key: string): boolean {
    return this._handlers.has(key);
  }
  static getRegisteredKeys(): string[] {
    return Array.from(this._handlers.keys());
  }
  static execute(ctx: ModuleActionContext): void {
    const handler = (this._handlers.at(ctx.moduleType) ?? null);
    if ((handler !== null)) {
      handler(ctx);
    }
  }
}

export function executeHeadModules(sys: CombatSystem, dt: number, world: World): void {
  const player = World.getPlayer(world);
  if ((!(player) || !((player.alive ?? player.Alive)))) {
    return;
  }
  const dmgBonus = ((player.damageBonus ?? player.DamageBonus) ?? 1);
  const px = (player.x ?? player.X);
  const py = (player.y ?? player.Y);
  const pa = (player.angle ?? player.Angle);
  const headMods = (player.headModules || player.HeadModules);
  if (((headMods !== null) && (typeof (headMods) === "object"))) {
    if (!(player.headModuleTimers)) {
      player.headModuleTimers = {};
    }
    const timers = player.headModuleTimers;
    for (const [mType, mLvl] of Object.entries(headMods)) {
      if (((!(mType) || (typeof (mLvl) !== "number")) || (mLvl <= 0))) {
        null;
      }
      const ctx: ModuleActionContext = { sys, dt, world, player, moduleType: mType, level: mLvl, isHead: true, originX: px, originY: py, angle: pa, dmgBonus, getTimer: () => (timers[mType] || 0), setTimer: (val: unknown) => null };
      ModuleActionRegistry.execute(ctx);
    }
  }
}
