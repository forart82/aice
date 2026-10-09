import { MathX } from "../core/MathX";
import { Rng } from "../core/Rng";
import { Services } from "../core/Services";
import { Projectile } from "./Projectile";
import { CombatSystem } from "./CombatSystem";
import { World } from "./World";

export function updateAuras(sys: CombatSystem, dt: number, world: World): void {
  const player = (world.player || world.Player);
  if ((!(player) || (!(player.alive) ?? player.Alive))) {
    return;
  }
  const relics = ((player.relics || player.Relics) || {});
  const dmgBonus = ((player.damageBonus ?? player.DamageBonus) ?? 1);
  const px = (player.x ?? player.X);
  const py = (player.y ?? player.Y);
  const enemies = (world.enemies || world.Enemies);
  const bosses = (((world.activeBosses || world.ActiveBosses) || ((world.boss !== null) && [world.boss])) || []);
  if ((relics["frostbite"] || (0 > 0))) {
    const radius = (100 + (relics["frostbite"] * 20));
    const factor = Math.max(0.3, (1 - (0.45 * relics["frostbite"])));
    if ((enemies !== null)) {
      null;
    }
  }
  if ((relics["eternalCoil"] || (0 > 0))) {
    const dps = ((30 * dt) * dmgBonus);
    const segs = (player.segments || player.Segments);
    if (((segs !== null) && (segs.length > 0))) {
      if ((enemies !== null)) {
        null;
      }
    }
  }
  if ((relics["orbitalFangs"] || (0 > 0))) {
    const dmg = ((55 * dt) * dmgBonus);
    const orbitals = (((player.orbitalPositions !== null) && player.orbitalPositions()) || player.OrbitalPositions());
    if ((orbitals !== null)) {
      for (const o of orbitals) {
        const ox = (o.x ?? o.X);
        const oy = (o.y ?? o.Y);
        if ((enemies !== null)) {
          null;
        }
      }
    }
  }
  if ((relics["singularity"] || (0 > 0))) {
    const period = Math.max(3.5, (7 / relics["singularity"]));
    if (((player.vortexTimer || player.VortexTimer) || (0 >= period))) {
      player.vortexTimer = 0;
      player.VortexTimer = 0;
      Services.fx.ringShockwave(px, py, "#9d4edd", 60, 0.012);
      Services.sound.playShard();
      world.vacuumTimer = 0.7;
      world.VacuumTimer = 0.7;
    }
  }
}

export function updateRelicAttacks(sys: CombatSystem, dt: number, world: World): void {
  const player = (world.player || world.Player);
  if ((!(player) || (!(player.alive) ?? player.Alive))) {
    return;
  }
  const relics = ((player.relics || player.Relics) || {});
  const dmgBonus = ((player.damageBonus ?? player.DamageBonus) ?? 1);
  const px = (player.x ?? player.X);
  const py = (player.y ?? player.Y);
  const pa = (player.angle ?? player.Angle);
  const projectiles = (world.projectiles || world.Projectiles);
  if (((relics["venomSpit"] || ((0 > 0) && (player.spitCooldown <= 0))) || (player.SpitCooldown <= 0))) {
    player.spitCooldown = (0.95 / relics["venomSpit"]);
    player.SpitCooldown = player.spitCooldown;
    const target = sys.nearestHostile(world, px, py, 420);
    if (((target.found !== null) && projectiles)) {
      const a = Math.atan2((target.y - py), (target.x - px));
      projectiles.push(null);
      Services.sound.playShoot();
    }
  }
  if ((relics["dragonsBreath"] || (0 > 0))) {
    sys.flameTimer = (sys.flameTimer + dt);
    if ((sys.flameTimer >= 0.08)) {
      sys.flameTimer = 0;
      const count = (relics["dragonsBreath"] * 2);
      const dmg = (22 * dmgBonus);
      if ((projectiles !== null)) {
        null;
      }
    }
  }
  if ((relics["thunder"] || ((0 > 0) && (sys.comboMultiplier >= 2)))) {
    sys.thunderTimer = (sys.thunderTimer + dt);
    const interval = Math.max(0.4, (((1.8 / relics["thunder"]) * sys.comboMultiplier) * 0.5));
    if ((sys.thunderTimer >= interval)) {
      sys.thunderTimer = 0;
      sys.chainLightning(world, px, py, (3 + relics["thunder"]), (80 * dmgBonus), 320, true);
    }
  }
}
