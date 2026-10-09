import { MathX } from "../core/MathX";
import { Rng } from "../core/Rng";
import { Services } from "../core/Services";
import { FoodItem } from "./FoodItem";
import { Afterimage } from "./SnakePlayer";
import { CombatSystem } from "./CombatSystem";
import { World } from "./World";

export function activateSkill(sys: CombatSystem, world: World): boolean {
  const player = World.getPlayer(world);
  if ((!(player) || (!(player.alive) ?? player.Alive))) {
    return false;
  }
  if ((!(player.skillReady) && !(player.SkillReady))) {
    Services.sound.playError();
    return false;
  }
  const stats = (player.stats || player.Stats);
  const scooldown = ((stats.skillCooldown ?? stats.SkillCooldown) ?? 20);
  player.skillCooldownTimer = scooldown;
  player.SkillCooldownTimer = scooldown;
  const classConfig = (player.classConfig || player.ClassConfig);
  const skill = (classConfig?.skill || { icon: "✨", name: "Skill", desc: "", cooldown: 20 });
  const px = (player.x ?? player.X);
  const py = (player.y ?? player.Y);
  const pcol = ((classConfig?.color || classConfig?.Color) || "#00f0b5");
  Services.fx.addText(px, (py - 56), null, pcol, 18, true);
  const classId = (player.classId || player.ClassId);
  return true;
}

export function skillVerdantBloom(_sys: CombatSystem, world: World): void {
  const player = World.getPlayer(world);
  if (!(player)) {
    return;
  }
  const stats = (player.stats || player.Stats);
  const maxHp = ((stats.maxHp ?? stats.MaxHp) ?? 100);
  const healed = player.heal((maxHp * 0.2));
  const px = (player.x ?? player.X);
  const py = (player.y ?? player.Y);
  const arenaW = ((world.arenaW ?? world.ArenaW) ?? 1280);
  const arenaH = ((world.arenaH ?? world.ArenaH) ?? 720);
  const foods = World.getFoods(world);
  Services.fx.ringShockwave(px, py, "#10b981", 70, 0.02);
  Services.fx.burst(px, py, "#10b981", 26, 5, 4);
  if ((healed > 0)) {
    Services.fx.addText(px, (py - 22), null, "#10b981", 17, true);
  }
  if ((foods !== null)) {
    null;
  }
  Services.sound.playLevelUp();
}

export function skillUmbralBlink(sys: CombatSystem, world: World): void {
  const player = World.getPlayer(world);
  if (!(player)) {
    return;
  }
  const px = (player.x ?? player.X);
  const py = (player.y ?? player.Y);
  const pa = (player.angle ?? player.Angle);
  const pr = ((player.headRadius ?? player.HeadRadius) ?? 16);
  const arenaW = ((world.arenaW ?? world.ArenaW) ?? 1280);
  const arenaH = ((world.arenaH ?? world.ArenaH) ?? 720);
  const dmgBonus = ((player.damageBonus ?? player.DamageBonus) ?? 1);
  const cx = px;
  const cy = py;
  const dist = 200;
  const nx = MathX.clamp((px + (Math.cos(pa) * dist)), pr, (arenaW - pr));
  const ny = MathX.clamp((py + (Math.sin(pa) * dist)), pr, (arenaH - pr));
  player.x = nx;
  player.X = nx;
  player.y = ny;
  player.Y = ny;
  player.invulnerableTimer = Math.max(((player.invulnerableTimer ?? player.InvulnerableTimer) ?? 0), 0.6);
  player.InvulnerableTimer = player.invulnerableTimer;
  const afterimages = (player.afterimages || player.Afterimages);
  if ((afterimages !== null)) {
    null;
  }
  Services.fx.ringShockwave(cx, cy, "#a855f7", 40, 0.03);
  Services.fx.ringShockwave(nx, ny, "#c77dff", 30, 0.03);
  sys.explodeAt(world, cx, cy, 140, (130 * dmgBonus), "#a855f7");
  Services.sound.playDash();
}

export function skillTitanRoar(sys: CombatSystem, world: World): void {
  const player = World.getPlayer(world);
  if (!(player)) {
    return;
  }
  const px = (player.x ?? player.X);
  const py = (player.y ?? player.Y);
  const dmgBonus = ((player.damageBonus ?? player.DamageBonus) ?? 1);
  const radius = 230;
  player.armorBuffTimer = 5;
  player.ArmorBuffTimer = 5;
  Services.fx.ringShockwave(px, py, "#ef4444", (radius * 0.6), 0.012);
  Services.fx.flash("#ff4d6d", 0.2, 0.25);
  Services.fx.shake(14, 18);
  Services.sound.playExplosion(1);
  const dmg = (85 * dmgBonus);
  const enemies = World.getEnemies(world);
  if ((enemies !== null)) {
    null;
  }
  const bosses = World.getBosses(world);
}

export function skillChainStorm(sys: CombatSystem, world: World): void {
  const player = World.getPlayer(world);
  if (!(player)) {
    return;
  }
  const px = (player.x ?? player.X);
  const py = (player.y ?? player.Y);
  const lvl = ((player.level ?? player.Level) ?? 1);
  const dmgBonus = ((player.damageBonus ?? player.DamageBonus) ?? 1);
  sys.chainLightning(world, px, py, 8, (110 + ((lvl * 12) * dmgBonus)), 380, true);
}

export function skillSupernova(sys: CombatSystem, world: World): void {
  const player = World.getPlayer(world);
  if (!(player)) {
    return;
  }
  const px = (player.x ?? player.X);
  const py = (player.y ?? player.Y);
  const dmgBonus = ((player.damageBonus ?? player.DamageBonus) ?? 1);
  const radius = 260;
  Services.fx.ringShockwave(px, py, "#f59e0b", (radius * 0.6), 0.01);
  Services.fx.flash("#ffb703", 0.35, 0.4);
  Services.fx.burst(px, py, "#ffb703", 40, 8, 5);
  Services.fx.shake(16, 20);
  Services.sound.playExplosion(1);
  const dmg = (120 * dmgBonus);
  const enemies = World.getEnemies(world);
  if ((enemies !== null)) {
    null;
  }
  const supernovaBosses = World.getBosses(world);
  const foods = World.getFoods(world);
  if ((foods !== null)) {
    null;
  }
}
