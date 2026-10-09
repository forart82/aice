import { describe, it, expect, beforeEach } from 'vitest';
import { SnakePlayer } from '../sim/SnakePlayer';
import { World } from '../sim/World';
import { Enemy } from '../sim/Enemy';
import { CombatSystem } from '../sim/CombatSystem';
import { updateAuras } from '../sim/CombatAuras';
import { GameData } from '../data/GameData';
import { generateBossHelmet, formatHelmetStatDescription } from '../data/Helmets';
import { CodexData } from '../data/CodexData';
import { Services } from '../core/Services';
import { NullSound, NullFx } from '../core/Contracts';

describe('Game Balance, Bug Fixes & Incoherences Resolution Test Suite', () => {
  beforeEach(() => {
    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
  });

  it('1. verifies Shadow Stalker dash invulnerability is strictly less than DashCooldown', () => {
    const player = new SnakePlayer('stalker', 400, 300, 5);
    player.Stats.DashCooldown = 0.8; // Heavily reduced cooldown with 4 sprint glands
    player.TryDash();

    // Invulnerability must not exceed DashCooldown
    expect(player.InvulnerableTimer).toBeLessThan(player.Stats.DashCooldown);
  });

  it('2. verifies Infinite Devourer scales additively (+5% per 5 combo events)', () => {
    const player = new SnakePlayer('emerald', 400, 300, 5);
    player.Relics['devourer'] = 1;
    player.relics['devourer'] = 1;
    player.Stats.MaxHp = 100;
    player.Hp = 100;

    const combat = new CombatSystem();
    const world = new World();
    world.ArenaW = 1200;
    world.ArenaH = 800;

    // Simulate 3 Devourer procs (15 combo events)
    for (let i = 0; i < 15; i++) {
      combat.incrementCombo(player, world);
    }

    // 3 procs * 0.05 = +15% bonus -> damageBonus should be 1.15, not 1.05^3 = 1.157625
    expect(player.DamageBonus).toBeCloseTo(1.15, 4);
    expect(player.Stats.MaxHp).toBe(130);
  });

  it('3. verifies Orbital Fangs contact damage is exactly 55 * dt * dmgBonus', () => {
    const player = new SnakePlayer('emerald', 400, 300, 5);
    player.Relics['orbitalFangs'] = 1;
    player.relics['orbitalFangs'] = 1;
    player.DamageBonus = 1.0;
    player.damageBonus = 1.0;

    // Player spawns at (200, 150) when arena is 400x300, OrbitDistance is 54
    const enemy = new Enemy(player.X + player.OrbitDistance, player.Y, 'swarmling', 1);
    enemy.SpawnTimer = 0; // Finished spawning, fully vulnerable
    enemy.Hp = 100;
    enemy.MaxHp = 100;

    const world = new World();
    world.ArenaW = 1200;
    world.ArenaH = 800;
    world.player = player;
    world.enemies = [enemy];

    const combat = new CombatSystem();
    const dt = 0.1; // 100ms
    updateAuras(combat, dt, world);

    // At 55 DPS, 0.1s should deal 5.5 damage
    expect(100 - enemy.Hp).toBeCloseTo(5.5, 2);
  });

  it('4. verifies ComboWindow fallback in serpents_focus and combo_surge defaults to 1.0', () => {
    const cardFocus = GameData.CardPool.find(c => c.Id === 'serpents_focus');
    const cardSurge = GameData.CardPool.find(c => c.Id === 'combo_surge');
    expect(cardFocus).toBeDefined();
    expect(cardSurge).toBeDefined();

    const dummyPlayer1: any = { Stats: { ComboWindow: undefined } };
    cardFocus!.Apply(dummyPlayer1);
    expect(dummyPlayer1.Stats.ComboWindow).toBe(1.25);

    const dummyPlayer2: any = { Stats: { ComboWindow: undefined }, Relics: {} };
    cardSurge!.Apply(dummyPlayer2);
    expect(dummyPlayer2.Stats.ComboWindow).toBe(1.5);
  });

  it('5. verifies 3.0s periodic HP regeneration heals exactly 3 * HpRegen', () => {
    const player = new SnakePlayer('emerald', 400, 300, 5);
    player.Stats.HpRegen = 2.0; // Advertised as +2.0 HP/s
    player.Stats.MaxHp = 200;
    player.Hp = 100;

    const world = new World();
    world.ArenaW = 1200;
    world.ArenaH = 800;
    player.UpdatePassives(3.0, world); // Trigger 3-second cycle

    // In 3 seconds, +2.0 HP/s must restore 6 HP
    expect(player.Hp).toBe(106);
  });

  it('6. verifies Helmet Thorns generates fractional percentages and formats correctly', () => {
    const helmet = generateBossHelmet(5, 'centipede');
    if (helmet.Stats.thorns !== undefined) {
      expect(helmet.Stats.thorns).toBeLessThanOrEqual(0.35);
      expect(helmet.Stats.thorns).toBeGreaterThanOrEqual(0.05);
    }

    const formatted = formatHelmetStatDescription({ thorns: 0.15 });
    expect(formatted).toContain('+15% Thorns');
  });

  it('7. verifies Sanctuary blueprint descriptions reference Head weapons and defenses', () => {
    for (const up of GameData.MetaUpgrades.Values) {
      if (up.Key.startsWith('unlock_')) {
        expect(up.Bonus).not.toContain('wing module');
        expect(up.Bonus).not.toContain('spine module');
      }
    }
  });

  it('8. verifies CodexData has updated skill stats and rarity affix numbers', () => {
    const allText = JSON.stringify(CodexData.Entries);
    expect(allText.includes('Emerald Basilisk')).toBe(false);
    expect(allText.includes('Frost Hydra')).toBe(false);
    expect(allText.includes('Toxic Chimera')).toBe(false);
    expect(allText.includes('Spread Drone')).toBe(false);
    expect(allText.includes('Arc Drone')).toBe(true);
  });
});
