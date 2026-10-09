import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { SnakePlayer } from '../sim/SnakePlayer';
import { Enemy } from '../sim/Enemy';
import { FoodItem } from '../sim/FoodItem';
import { Boss } from '../sim/Boss';
import { GameData } from '../data/GameData';
import { MetaProgression } from '../data/MetaProgression';
import { ScriptedInput, NullFx, NullSound } from '../core/Contracts';
import { Services } from '../core/Services';
import { MathX } from '../core/MathX';

describe('Cards, Relics, and Class Passives Integrity Test Suite', () => {
  let g: GameEngine;
  let im: ScriptedInput;

  beforeEach(() => {
    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = new MetaProgression();
    MetaProgression.instance.unlockedClasses = {
      emerald: true,
      stalker: true,
      hydra: true,
      storm: true,
      solar: true
    };

    g = new GameEngine();
    im = new ScriptedInput();
    Services.input = im;
    Services.fx = new NullFx();
    Services.sound = new NullSound();
    Services.headless = true;
    g.setupCanvas(1280, 720, 1);
  });

  /* ========================================================================= *
   * 1. AUTHORITATIVE 36-CARD CATALOG & MATHEMATICAL APPLICATION MATRIX
   * ========================================================================= */
  describe('1. Authoritative 36-Card Catalog & Mathematical Application Matrix', () => {
    it('1.1 verifies all 36 cards have valid metadata, descriptions, icons, and apply functions', () => {
      expect(GameData.CardPool.length).toBe(36);
      const ids = new Set<string>();

      for (const card of GameData.CardPool) {
        expect(card.id).toBeDefined();
        expect(card.title).toBeDefined();
        expect(card.icon).toBeDefined();
        expect(card.rarity).toBeDefined();
        expect(card.maxStacks).toBeGreaterThanOrEqual(1);
        expect(typeof card.apply).toBe('function');
        expect(GameData.RarityOrder[card.rarity!]).toBeDefined();

        expect(ids.has(card.id!)).toBe(false);
        ids.add(card.id!);
      }
    });

    it('1.2 verifies exact mathematical stat and relic modifications for all 36 cards', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 4);

      // --- Common Cards (10) ---
      // 1. swift_scales (+12% Speed)
      const prevSpeed = p.stats.speed;
      GameData.CardPool.find(c => c.id === 'swift_scales')!.apply!(p);
      expect(p.stats.speed).toBeCloseTo(prevSpeed * 1.12, 5);

      // 2. iron_belly (+25 Max HP, heal 25)
      const prevMaxHp = p.stats.maxHp;
      GameData.CardPool.find(c => c.id === 'iron_belly')!.apply!(p);
      expect(p.stats.maxHp).toBe(prevMaxHp + 25);

      // 3. magnetic_coil (+40% Magnet Range)
      const prevMag = p.stats.magnetRadius;
      GameData.CardPool.find(c => c.id === 'magnetic_coil')!.apply!(p);
      expect(p.stats.magnetRadius).toBeCloseTo(prevMag * 1.4, 5);

      // 4. razor_fangs (+15 Bite Power, +5% Crit)
      const prevBite = p.stats.bitePower;
      const prevCrit = p.stats.critChance;
      GameData.CardPool.find(c => c.id === 'razor_fangs')!.apply!(p);
      expect(p.stats.bitePower).toBe(prevBite + 15);
      expect(p.stats.critChance).toBeCloseTo(prevCrit + 0.05, 5);

      // 5. sprint_gland (-18% Dash Cooldown)
      const prevCd = p.stats.dashCooldown;
      GameData.CardPool.find(c => c.id === 'sprint_gland')!.apply!(p);
      expect(p.stats.dashCooldown).toBeCloseTo(Math.max(0.5, prevCd * 0.82), 5);

      // 6. hardened_carapace (+8% Damage Reduction)
      const prevArmor = p.stats.armor;
      GameData.CardPool.find(c => c.id === 'hardened_carapace')!.apply!(p);
      expect(p.stats.armor).toBeCloseTo(Math.min(0.75, prevArmor + 0.08), 5);

      // 7. keen_eye (+30% Critical Damage)
      const prevCritMult = p.stats.critMult;
      GameData.CardPool.find(c => c.id === 'keen_eye')!.apply!(p);
      expect(p.stats.critMult).toBeCloseTo(prevCritMult + 0.3, 5);

      // 8. gourmand (+20% XP Gained)
      const prevXpGain = p.stats.xpGain;
      GameData.CardPool.find(c => c.id === 'gourmand')!.apply!(p);
      expect(p.stats.xpGain).toBeCloseTo(prevXpGain + 0.2, 5);

      // 9. serpents_focus (+25% Combo Window)
      const prevWin = p.stats.comboWindow;
      GameData.CardPool.find(c => c.id === 'serpents_focus')!.apply!(p);
      expect(p.stats.comboWindow).toBeCloseTo(prevWin + 0.25, 5);

      // 10. shard_lust (+30% Shard Drops)
      const prevShard = p.stats.shardGain;
      GameData.CardPool.find(c => c.id === 'shard_lust')!.apply!(p);
      expect(p.stats.shardGain).toBeCloseTo(prevShard + 0.3, 5);

      // --- Rare Cards (10) ---
      // 11. venom_spit (+1 venomSpit relic)
      GameData.CardPool.find(c => c.id === 'venom_spit')!.apply!(p);
      expect(p.relics['venomSpit']).toBe(1);

      // 12. frostbite_aura (+1 frostbite relic)
      GameData.CardPool.find(c => c.id === 'frostbite_aura')!.apply!(p);
      expect(p.relics['frostbite']).toBe(1);

      // 13. shield_matrix (+45 Shield)
      const prevMaxShield = p.stats.maxShield;
      GameData.CardPool.find(c => c.id === 'shield_matrix')!.apply!(p);
      expect(p.stats.maxShield).toBe(prevMaxShield + 45);
      expect(p.shield).toBe(p.stats.maxShield);

      // 14. vampiric_feast (+3 vampiric, +15% bite power)
      const biteBeforeVamp = p.stats.bitePower;
      GameData.CardPool.find(c => c.id === 'vampiric_feast')!.apply!(p);
      expect(p.relics['vampiric']).toBe(3);
      expect(p.stats.bitePower).toBeCloseTo(biteBeforeVamp * 1.15, 5);

      // 15. explosive_appetite (+1 explosiveAppetite)
      GameData.CardPool.find(c => c.id === 'explosive_appetite')!.apply!(p);
      expect(p.relics['explosiveAppetite']).toBe(1);

      // 16. combo_surge (+1 comboSurge, +0.5 comboWindow, +0.15 xpGain)
      const winBefore = p.stats.comboWindow;
      const xpBefore = p.stats.xpGain;
      GameData.CardPool.find(c => c.id === 'combo_surge')!.apply!(p);
      expect(p.relics['comboSurge']).toBe(1);
      expect(p.stats.comboWindow).toBeCloseTo(winBefore + 0.5, 5);
      expect(p.stats.xpGain).toBeCloseTo(xpBefore + 0.15, 5);

      // 17. barbed_scales (+1 thorns relic, +0.4 thorns stat)
      const thornsBefore = p.stats.thorns;
      GameData.CardPool.find(c => c.id === 'barbed_scales')!.apply!(p);
      expect(p.relics['thorns']).toBe(1);
      expect(p.stats.thorns).toBeCloseTo(thornsBefore + 0.4, 5);

      // 18. adrenal_surge (+1 adrenal)
      GameData.CardPool.find(c => c.id === 'adrenal_surge')!.apply!(p);
      expect(p.relics['adrenal']).toBe(1);

      // 19. seeker_venom (+1 homing)
      GameData.CardPool.find(c => c.id === 'seeker_venom')!.apply!(p);
      expect(p.relics['homing']).toBe(1);

      // 20. glutton_growth (+1 gluttonGrowth)
      GameData.CardPool.find(c => c.id === 'glutton_growth')!.apply!(p);
      expect(p.relics['gluttonGrowth']).toBe(1);

      // --- Epic Cards (9) ---
      // 21. orbital_fangs (+2 orbitalFangs)
      GameData.CardPool.find(c => c.id === 'orbital_fangs')!.apply!(p);
      expect(p.relics['orbitalFangs']).toBe(2);

      // 22. chain_reaction (+1 chainReaction)
      GameData.CardPool.find(c => c.id === 'chain_reaction')!.apply!(p);
      expect(p.relics['chainReaction']).toBe(1);

      // 23. quantum_phase (quantumPhase = 1)
      GameData.CardPool.find(c => c.id === 'quantum_phase')!.apply!(p);
      expect(p.relics['quantumPhase']).toBe(1);

      // 24. singularity_core (+1 singularity)
      GameData.CardPool.find(c => c.id === 'singularity_core')!.apply!(p);
      expect(p.relics['singularity']).toBe(1);

      // 25. overdrive_capacitor (+1 overdrive)
      GameData.CardPool.find(c => c.id === 'overdrive_capacitor')!.apply!(p);
      expect(p.relics['overdrive']).toBe(1);

      // 26. molten_wake (+1 moltenWake)
      GameData.CardPool.find(c => c.id === 'molten_wake')!.apply!(p);
      expect(p.relics['moltenWake']).toBe(1);

      // 27. cryo_nova (+1 cryoNova)
      GameData.CardPool.find(c => c.id === 'cryo_nova')!.apply!(p);
      expect(p.relics['cryoNova']).toBe(1);

      // 28. echo_strike (+1 echoStrike)
      GameData.CardPool.find(c => c.id === 'echo_strike')!.apply!(p);
      expect(p.relics['echoStrike']).toBe(1);

      // 29. soul_harvest (+1 soulHarvest)
      GameData.CardPool.find(c => c.id === 'soul_harvest')!.apply!(p);
      expect(p.relics['soulHarvest']).toBe(1);

      // --- Legendary Cards (7) ---
      // 30. dragons_breath (+1 dragonsBreath)
      GameData.CardPool.find(c => c.id === 'dragons_breath')!.apply!(p);
      expect(p.relics['dragonsBreath']).toBe(1);

      // 31. god_of_thunder (+1 thunder)
      GameData.CardPool.find(c => c.id === 'god_of_thunder')!.apply!(p);
      expect(p.relics['thunder']).toBe(1);

      // 32. phoenix_rebirth (+1 phoenix, +1 phoenixCharges)
      GameData.CardPool.find(c => c.id === 'phoenix_rebirth')!.apply!(p);
      expect(p.relics['phoenix']).toBe(1);
      expect(p.relics['phoenixCharges']).toBe(1);

      // 33. infinite_devourer (devourer = 1)
      GameData.CardPool.find(c => c.id === 'infinite_devourer')!.apply!(p);
      expect(p.relics['devourer']).toBe(1);

      // 34. eternal_coil (eternalCoil = 1)
      GameData.CardPool.find(c => c.id === 'eternal_coil')!.apply!(p);
      expect(p.relics['eternalCoil']).toBe(1);

      // 35. time_dilation (timeDilation = 1)
      GameData.CardPool.find(c => c.id === 'time_dilation')!.apply!(p);
      expect(p.relics['timeDilation']).toBe(1);

      // 36. apex_predator (apexPredator = 1, bitePower * 2, maxHp * 0.75)
      const apexBiteBefore = p.stats.bitePower;
      const apexHpBefore = p.stats.maxHp;
      GameData.CardPool.find(c => c.id === 'apex_predator')!.apply!(p);
      expect(p.relics['apexPredator']).toBe(1);
      expect(p.stats.bitePower).toBeCloseTo(apexBiteBefore * 2, 5);
      expect(p.stats.maxHp).toBe(Math.max(30, MathX.roundJs(apexHpBefore * 0.75)));
    });

    it('1.3 enforces stack limits (MaxStacks) in GameEngine draft selection and MetaProgression draft pool', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const card = GameData.CardPool.find(c => c.id === 'quantum_phase')!;
      expect(card.maxStacks).toBe(1);

      // Pick stack 1
      g.selectUpgradeCard(card);
      expect(g.player.cardStacks['quantum_phase']).toBe(1);
      expect(g.player.relics['quantumPhase']).toBe(1);

      // Pick stack 2 (must be rejected due to MaxStacks)
      g.selectUpgradeCard(card);
      expect(g.player.cardStacks['quantum_phase']).toBe(1);

      // Test draft pool filtering in MetaProgression
      const meta = MetaProgression.instance;
      const playerWithMaxed: any = { cardStacks: { quantum_phase: 1, apex_predator: 1 } };
      for (let i = 0; i < 20; i++) {
        const draft = meta.getRandomCardDraft(3, playerWithMaxed);
        expect(draft.some(c => c.id === 'quantum_phase')).toBe(false);
        expect(draft.some(c => c.id === 'apex_predator')).toBe(false);
      }
    });
  });

  /* ========================================================================= *
   * 2. COMPLETE 26-RELIC BEHAVIOR & IN-ENGINE PROC VERIFICATION MATRIX
   * ========================================================================= */
  describe('2. Complete 26-Relic Behavior & In-Engine Proc Verification Matrix', () => {
    it('2.1 Phoenix Rebirth: cheat death on fatal head damage and full segment severing', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 2);
      p.relics['phoenix'] = 1;
      p.relics['phoenixCharges'] = 1;

      // Fatal damage to head
      p.damageHead(9999);
      expect(p.alive).toBe(true);
      expect(p.pendingRevive).toBe(true);
      expect(p.invulnerableTimer).toBe(3);
      expect(p.headHp).toBe(p.headMaxHp);
      expect(p.relics['phoenixCharges']).toBe(0);

      // Next fatal blow with 0 charges kills player
      p.invulnerableTimer = 0;
      p.damageHead(9999);
      expect(p.alive).toBe(false);
    });

    it('2.2 God of Thunder: lightning strikes on 2x+ combo', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      p.relics['thunder'] = 2;
      g.combat.comboMultiplier = 2.0;

      const enemy = new Enemy(p.x + 100, p.y + 100, 'scarab', 1);
      enemy.spawnTimer = 0;
      g.enemies.push(enemy);
      const hpBefore = enemy.hp;

      // Update relic attacks with sufficient dt to trigger thunder timer
      g.combat.updateRelicAttacks(1.0, g.worldBag());
      expect(enemy.hp).toBeLessThan(hpBefore);

      // At combo multiplier < 2, thunder must not strike
      g.combat.comboMultiplier = 1.0;
      g.combat.thunderTimer = 0;
      const enemy2 = new Enemy(p.x + 100, p.y + 100, 'scarab', 1);
      enemy2.spawnTimer = 0;
      g.enemies.push(enemy2);
      const hp2Before = enemy2.hp;
      g.combat.updateRelicAttacks(1.0, g.worldBag());
      expect(enemy2.hp).toBe(hp2Before);
    });

    it('2.3 Infinite Devourer: +10 MaxHP and +5% damage every 5 combo increments', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      p.relics['devourer'] = 1;
      const hpBefore = p.stats.maxHp;
      const dmgBefore = p.damageBonus;

      for (let i = 0; i < 5; i++) {
        g.combat.incrementCombo(p, g.worldBag());
      }

      expect(p.stats.maxHp).toBe(hpBefore + 10);
      expect(p.damageBonus).toBeCloseTo(dmgBefore * 1.05, 5);
    });

    it('2.4 Overdrive Capacitor: lowers frenzy threshold to 8x combo and extends duration', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      p.relics['overdrive'] = 1;

      // Build 8 combo
      for (let i = 0; i < 8; i++) {
        g.combat.incrementCombo(p, g.worldBag());
      }

      expect(g.combat.frenzyActive).toBe(true);
      expect(g.combat.frenzyTimer).toBeGreaterThanOrEqual(10.0); // 6s base + 4s overdrive
    });

    it('2.5 Molten Wake: leaves burning magma hazards along movement trail', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      p.relics['moltenWake'] = 1;
      expect(g.hazards.length).toBe(0);

      p.updatePassives(0.4, g.worldBag());
      expect(g.hazards.length).toBeGreaterThan(0);
      expect(g.hazards[0]!.type).toBe('magma');
      expect(g.hazards[0]!.owner).toBe('player');
    });

    it('2.6 Cryo Nova: freezes and damages surrounding hostiles on player hurt', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      p.relics['cryoNova'] = 1;

      const enemy = new Enemy(p.x + 50, p.y + 50, 'scarab', 1);
      enemy.spawnTimer = 0;
      g.enemies.push(enemy);
      const hpBefore = enemy.hp;

      g.combat.onPlayerHurt(g.worldBag(), 15);
      expect(enemy.hp).toBeLessThan(hpBefore);
      expect(enemy.status.isFrozen).toBe(true);
    });

    it('2.7 Vampiric Feast: heals on eating food and killing enemies', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      p.relics['vampiric'] = 3;
      p.hp = 50; // Missing HP

      // Food heal: 50 + 28 (food heal) + 3 (vampiric) = 81
      const food = new FoodItem(p.x, p.y, 'apple');
      g.combat.eatFood(food, g.worldBag());
      expect(p.hp).toBeGreaterThanOrEqual(53);

      // Kill heal
      const hpMid = p.hp;
      const enemy = new Enemy(p.x + 20, p.y + 20, 'scarab', 1);
      enemy.spawnTimer = 0;
      g.combat.damageEnemy(enemy, 9999, g.worldBag());
      expect(p.hp).toBe(hpMid + 3);
    });

    it('2.8 Explosive Appetite: eating food detonates AoE blast', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      p.relics['explosiveAppetite'] = 1;

      const enemy = new Enemy(p.x + 40, p.y + 40, 'scarab', 1);
      enemy.spawnTimer = 0;
      g.enemies.push(enemy);
      const hpBefore = enemy.hp;

      const food = new FoodItem(p.x, p.y, 'apple');
      g.combat.eatFood(food, g.worldBag());
      expect(enemy.hp).toBe(hpBefore - 45);
    });

    it('2.9 Chain Reaction: enemy death triggers AoE blast damaging neighbors', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      p.relics['chainReaction'] = 1;

      const enemy1 = new Enemy(p.x + 50, p.y + 50, 'scarab', 1);
      const enemy2 = new Enemy(p.x + 80, p.y + 50, 'scarab', 1);
      enemy1.spawnTimer = 0;
      enemy2.spawnTimer = 0;
      g.enemies.push(enemy1, enemy2);

      const hp2Before = enemy2.hp;
      g.combat.damageEnemy(enemy1, 9999, g.worldBag());
      expect(enemy2.hp).toBeLessThan(hp2Before);
    });

    it('2.10 Orbital Fangs: spawns orbiters that deal contact DPS', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      p.relics['orbitalFangs'] = 2;
      const positions = p.orbitalPositions();
      expect(positions.length).toBe(2);

      const pos = positions[0]!;
      const enemy = new Enemy(pos.x ?? (pos as any).X ?? 0, pos.y ?? (pos as any).Y ?? 0, 'scarab', 1);
      enemy.spawnTimer = 0;
      g.enemies.push(enemy);
      const hpBefore = enemy.hp;

      g.combat.updateAuras(0.1, g.worldBag());
      expect(enemy.hp).toBeLessThan(hpBefore);
    });

    it('2.11 Venom Spit & Homing: fires tracking venom darts at nearest hostiles', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      p.relics['venomSpit'] = 1;
      p.relics['homing'] = 1;
      p.spitCooldown = 0;

      const enemy = new Enemy(p.x + 200, p.y, 'scarab', 1);
      enemy.spawnTimer = 0;
      g.enemies.push(enemy);

      g.combat.updateRelicAttacks(0.1, g.worldBag());
      expect(g.projectiles.length).toBeGreaterThan(0);
      const proj = g.projectiles[0]!;
      expect(proj.source).toBe('player');
      expect(proj.damage).toBe(45);
      expect(proj.homing).toBe(2.5);
    });

    it('2.12 Dragon Breath: discharges continuous flame cone projectiles', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      p.relics['dragonsBreath'] = 1;

      g.combat.updateRelicAttacks(0.1, g.worldBag());
      expect(g.projectiles.length).toBeGreaterThan(0);
      const flame = g.projectiles[0]!;
      expect(flame.source).toBe('player');
      expect(flame.damage).toBe(22);
    });

    it('2.13 Thorns / Barbed Scales: reflects contact damage back to attackers', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      p.invulnerableTimer = 0;
      p.stats.thorns = 0.5;

      const enemy = new Enemy(p.x, p.y, 'scarab', 1);
      enemy.spawnTimer = 0;
      const hpBefore = enemy.hp;

      g.combat.enemyTouchesPlayer(enemy, g.worldBag(), 1.0);
      expect(enemy.hp).toBeLessThan(hpBefore);
    });

    it('2.14 Adrenal Surge: activates speed and bite power boost below 40% HP', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 2);
      p.relics['adrenal'] = 1;

      const fullHpBite = p.bitePower;
      const fullHpSpeed = p.moveSpeed;

      // Drop HP to 30% (< 40% maxHp)
      p.hp = p.stats.maxHp * 0.3;
      expect(p.bitePower).toBeCloseTo(fullHpBite * 1.2, 5);
      expect(p.moveSpeed).toBeCloseTo(fullHpSpeed * 1.35, 5);

      // Heal back to 100%
      p.hp = p.stats.maxHp;
      expect(p.bitePower).toBe(fullHpBite);
      expect(p.moveSpeed).toBe(fullHpSpeed);
    });

    it('2.15 Glutton Growth: increases and heals MaxHP every 8 meals', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      p.relics['gluttonGrowth'] = 1;
      const hpBefore = p.stats.maxHp;

      for (let i = 0; i < 8; i++) {
        g.combat.eatFood(new FoodItem(p.x, p.y, 'apple'), g.worldBag());
      }

      expect(p.stats.maxHp).toBeGreaterThan(hpBefore);
    });

    it('2.16 Eternal Coil: body segments deal contact damage to enemies', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      p.relics['eternalCoil'] = 1;
      p.addGrowth(4);

      const targetSeg = p.segments[1]!;
      const enemy = new Enemy(targetSeg.x, targetSeg.y, 'scarab', 1);
      enemy.spawnTimer = 0;
      g.enemies.push(enemy);
      const hpBefore = enemy.hp;

      g.combat.ensureGrid(g.worldBag());
      g.combat.updateAuras(0.1, g.worldBag());
      expect(enemy.hp).toBeLessThan(hpBefore);
    });

    it('2.17 Time Dilation: slows simulation speed to 0.55 below 30% HP', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      p.relics['timeDilation'] = 1;

      expect(g.combat.dilationScale(p)).toBe(1.0);

      // Drop below 30% HP
      p.hp = p.stats.maxHp * 0.2;
      expect(g.combat.dilationScale(p)).toBe(0.55);
    });

    it('2.18 Singularity Core: periodically activates vacuum effect', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      p.relics['singularity'] = 1;
      p.vortexTimer = 7.0;

      g.combat.updateAuras(0.1, g.worldBag());
      expect(g.worldBag().vacuumTimer).toBeGreaterThan(0);
    });

    it('2.19 Soul Harvest: grants +60% kill XP per stack and drops soul items', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      p.relics['soulHarvest'] = 1;
      const xpBefore = p.xp;

      const enemy = new Enemy(p.x, p.y, 'scarab', 1);
      enemy.spawnTimer = 0;
      const baseExp = enemy.xpValue;
      g.combat.damageEnemy(enemy, 9999, g.worldBag());

      expect(p.xp).toBeCloseTo(xpBefore + baseExp * 1.6, 5);
    });
  });

  /* ========================================================================= *
   * 3. ALL 5 SERPENT CLASSES PASSIVES & ACTIVE SKILLS MATRIX
   * ========================================================================= */
  describe('3. All 5 Serpent Classes Passives & Active Skills Matrix', () => {
    it('3.1 Emerald Viper: Photosynthesis regen + Verdant Bloom healing and fruit bloom', () => {
      g.selectedClass = 'emerald';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      expect(p.classId).toBe('emerald');
      expect(p.stats.magnetRadius).toBeCloseTo(78 * 1.3, 5);

      // Photosynthesis regen: 1 HP every 6s
      p.hp = p.stats.maxHp - 10;
      p.updatePassives(6.1, g.worldBag());
      expect(p.hp).toBe(p.stats.maxHp - 9);

      // Verdant Bloom active skill
      const foodCountBefore = g.foods.length;
      const fired = g.combat.activateSkill(g.worldBag());
      expect(fired).toBe(true);
      expect(p.skillCooldownTimer).toBe(22);
      expect(g.foods.length).toBe(foodCountBefore + 5);
    });

    it('3.2 Shadow Stalker: Phantom Shift crit & dash invulnerability + Umbral Blink', () => {
      g.selectedClass = 'stalker';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      expect(p.classId).toBe('stalker');
      expect(p.stats.critChance).toBe(0.25);
      expect(p.stats.critMult).toBe(2.0);

      // Dash grants stealth invulnerability strictly below cooldown (0.72s)
      p.tryDash();
      expect(p.invulnerableTimer).toBeCloseTo(0.72, 2);

      // Umbral Blink active skill
      const px = p.x;
      const py = p.y;
      const enemy = new Enemy(px + 10, py + 10, 'scarab', 1);
      enemy.spawnTimer = 0;
      g.enemies.push(enemy);

      g.combat.activateSkill(g.worldBag());
      expect(p.skillCooldownTimer).toBe(13);
      expect(p.afterimages.length).toBeGreaterThan(0);
      expect(enemy.hp).toBeLessThan(enemy.maxHp);
    });

    it('3.3 Hydra Behemoth: Titan Shell multi-head bites and armor + Titan Roar', () => {
      g.selectedClass = 'hydra';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      expect(p.classId).toBe('hydra');
      expect(p.stats.armor).toBe(0.25);
      expect(p.biteHeads().length).toBe(3);

      // Titan Roar active skill
      const enemy = new Enemy(p.x + 50, p.y + 50, 'scarab', 1);
      enemy.spawnTimer = 0;
      g.enemies.push(enemy);

      g.combat.activateSkill(g.worldBag());
      expect(p.armorBuffTimer).toBe(5);
      expect(p.effectiveArmor).toBeGreaterThanOrEqual(0.5);
      expect(enemy.status.isStunned).toBe(true);
    });

    it('3.4 Storm Wyrm: Static Coil arc on 5th combo + Chain Storm skill', () => {
      g.selectedClass = 'storm';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      expect(p.classId).toBe('storm');
      expect(p.stats.speed).toBe(1.22);

      const enemy = new Enemy(p.x + 50, p.y + 50, 'scarab', 1);
      enemy.spawnTimer = 0;
      g.enemies.push(enemy);
      const hpBefore = enemy.hp;

      // 5 combo steps trigger Static Coil lightning arc
      for (let i = 0; i < 5; i++) {
        g.combat.incrementCombo(p, g.worldBag());
      }
      expect(enemy.hp).toBeLessThan(hpBefore);

      // Chain Storm active skill
      const enemy2 = new Enemy(p.x + 70, p.y + 70, 'scarab', 1);
      enemy2.spawnTimer = 0;
      g.enemies.push(enemy2);
      const hp2Before = enemy2.hp;

      g.combat.activateSkill(g.worldBag());
      expect(p.skillCooldownTimer).toBe(15);
      expect(enemy2.hp).toBeLessThan(hp2Before);
    });

    it('3.5 Solar Drake: Magma Trail cooking & hazards + Supernova blast', () => {
      g.selectedClass = 'solar';
      g.gameMode = 'rogue';
      g.startRun();

      const p = g.player;
      expect(p.classId).toBe('solar');

      // Passive: naturally spawns magma hazards
      p.updatePassives(0.35, g.worldBag());
      expect(g.hazards.some(h => h.type === 'magma')).toBe(true);

      // Food cooking
      const plainApple = new FoodItem(p.x + 20, p.y + 20, 'apple');
      g.foods.push(plainApple);
      plainApple.cook();
      expect(plainApple.type).toBe('golden');

      // Supernova active skill
      const enemy = new Enemy(p.x + 50, p.y + 50, 'scarab', 1);
      enemy.spawnTimer = 0;
      g.enemies.push(enemy);

      g.combat.activateSkill(g.worldBag());
      expect(p.skillCooldownTimer).toBe(21);
      expect(enemy.hp).toBeLessThan(enemy.maxHp);
      expect(enemy.status.isBurning).toBe(true);
    });
  });
});
