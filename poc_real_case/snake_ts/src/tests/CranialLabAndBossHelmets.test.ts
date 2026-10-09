import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateBossHelmet, HelmetRarity, HelmetDef, HelmetStats } from '../data/Helmets';
import { MetaProgression } from '../data/MetaProgression';
import { GameEngine } from '../sim/GameEngine';
import { GameState } from '../sim/GameState';
import { SnakePlayer } from '../sim/SnakePlayer';
import { CombatSystem } from '../sim/CombatSystem';
import { Boss } from '../sim/Boss';
import { FoodItem } from '../sim/FoodItem';
import { Enemy } from '../sim/Enemy';
import { Services } from '../core/Services';
import { ScriptedInput, NullFx, NullSound, ISound } from '../core/Contracts';
import { setupMockDom } from './MockDom';
import { UiRoot } from '../ui/UiRoot';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen';
import { ClassSelectScreen } from '../ui/screens/ClassSelectScreen';
import { SaveIO } from '../platform/SaveIO';



class TestSoundSpy extends NullSound implements ISound {
  public uiCount = 0;
  public levelUpCount = 0;
  public lootCount = 0;
  public errorCount = 0;

  public override playUi(): void { this.uiCount++; }
  public override playLevelUp(): void { this.levelUpCount++; }
  public override playFloorClear(): void { this.lootCount++; }
  public override playError(): void { this.errorCount++; }
}

describe('Cranial Lab Refactor & Boss Helmet Equipment Test Suite', () => {
  let g: GameEngine;
  let im: ScriptedInput;
  let teardownDom: () => void;
  let soundSpy: TestSoundSpy;

  beforeEach(() => {
    teardownDom = setupMockDom();
    soundSpy = new TestSoundSpy();

    const memStore = new Map<string, string>();
    MetaProgression.readBackend = (key) => memStore.get(key) ?? null;
    MetaProgression.writeBackend = (key, val) => { memStore.set(key, val); };
    MetaProgression.deleteBackend = (key) => { memStore.delete(key); };
    MetaProgression.instance = new MetaProgression();

    g = new GameEngine();
    im = new ScriptedInput();
    Services.input = im;
    Services.fx = new NullFx();
    Services.sound = soundSpy;
    Services.headless = true;
    g.setupCanvas(1280, 720, 1);
  });

  afterEach(() => {
    teardownDom();
  });

  /* -------------------------------------------------------------------------
   * 1. HELMET GENERATOR & STAT ROLLS
   * ------------------------------------------------------------------------- */
  describe('1. Procedural Helmet Generator & Rarity Curves', () => {
    it('generates valid helmets with distinct IDs, names, icons, and rarities', () => {
      const h1 = generateBossHelmet(1, 'centipede');
      expect(h1.id).toBeDefined();
      expect(h1.name?.length).toBeGreaterThan(3);
      expect(h1.icon).toBeDefined();
      expect(['common', 'uncommon', 'rare', 'epic', 'mythic']).toContain(h1.rarity);
      expect(Object.keys(h1.stats || {}).length).toBeGreaterThanOrEqual(1);
    });

    it('scales stat affix counts strictly with rarity (Common=1, Uncommon=2, Rare=3, Epic=4, Mythic=5)', () => {
      const rarities: HelmetRarity[] = ['common', 'uncommon', 'rare', 'epic', 'mythic'];
      const expectedAffixes = [1, 2, 3, 4, 5];

      for (let i = 0; i < rarities.length; i++) {
        const r = rarities[i]!;
        const helm = generateBossHelmet(i + 1, 'colossus', r);
        const affixCount = Object.keys(helm.stats || {}).length;
        expect(affixCount).toBe(expectedAffixes[i]);
      }
    });

    it('shifts rarity odds towards higher tiers on higher floors', () => {
      let f1CommonOrUncommon = 0;
      let f3RareOrHigher = 0;
      const samples = 100;

      for (let i = 0; i < samples; i++) {
        const hF1 = generateBossHelmet(1);
        if (hF1.rarity === 'common' || hF1.rarity === 'uncommon') f1CommonOrUncommon++;

        const hF3 = generateBossHelmet(3);
        if (hF3.rarity === 'rare' || hF3.rarity === 'epic' || hF3.rarity === 'mythic') f3RareOrHigher++;
      }

      expect(f1CommonOrUncommon).toBeGreaterThan(70);
      expect(f3RareOrHigher).toBeGreaterThan(70);
    });
  });

  /* -------------------------------------------------------------------------
   * 2. META-PROGRESSION INVENTORY & PERSISTENCE
   * ------------------------------------------------------------------------- */
  describe('2. MetaProgression Persistent Helmet Inventory & Loadout', () => {
    it('adds, equips, retrieves, and unequips helmets in MetaProgression', () => {
      const meta = MetaProgression.instance;
      expect(meta.helmets.length).toBe(0);
      expect(meta.equippedHelmetId).toBeNull();
      expect(meta.getEquippedHelmet()).toBeNull();

      const testHelm: HelmetDef = {
        Id: 'test-helm-1',
        Name: 'Crown of the Leviathan',
        Icon: '👑',
        Rarity: 'epic',
        Stats: { maxHp: 35, armor: 0.1, speed: 0.08 },
        id: 'test-helm-1',
        name: 'Crown of the Leviathan',
        icon: '👑',
        rarity: 'epic',
        stats: { maxHp: 35, armor: 0.1, speed: 0.08 }
      };

      meta.addHelmet(testHelm);
      expect(meta.helmets.length).toBe(1);
      expect(meta.helmets[0]!.id).toBe('test-helm-1');

      // Equip helmet
      meta.equipHelmet('test-helm-1');
      expect(meta.equippedHelmetId).toBe('test-helm-1');
      expect(meta.getEquippedHelmet()?.name).toBe('Crown of the Leviathan');

      // Unequip
      meta.equipHelmet(null);
      expect(meta.equippedHelmetId).toBeNull();
      expect(meta.getEquippedHelmet()).toBeNull();
    });

    it('serializes and deserializes helmets inventory and equipped helmet in save schema', () => {
      let savedData: string | null = null;
      MetaProgression.writeBackend = (_key, val) => { savedData = val; };
      MetaProgression.readBackend = () => savedData;

      const meta = new MetaProgression();
      const helm: HelmetDef = {
        Id: 'saved-helm-99',
        Name: 'Mythic Sun Crest',
        Icon: '☀️',
        Rarity: 'mythic',
        Stats: { bitePower: 15, critChance: 0.12, maxHp: 50, thorns: 20, shield: 30 },
        id: 'saved-helm-99',
        name: 'Mythic Sun Crest',
        icon: '☀️',
        rarity: 'mythic',
        stats: { bitePower: 15, critChance: 0.12, maxHp: 50, thorns: 20, shield: 30 }
      };

      meta.addHelmet(helm);
      meta.equipHelmet('saved-helm-99');
      meta.save();

      expect(savedData).toBeTruthy();
      const parsed = JSON.parse(savedData!);
      expect(parsed.helmets?.length).toBe(1);
      expect(parsed.equippedHelmetId).toBe('saved-helm-99');

      // Create new instance and load
      const meta2 = new MetaProgression();
      expect(meta2.helmets.length).toBe(1);
      expect(meta2.equippedHelmetId).toBe('saved-helm-99');
      expect(meta2.getEquippedHelmet()?.stats?.bitePower).toBe(15);
    });

    it('helmets persist across player deaths and run completions', () => {
      const meta = MetaProgression.instance;
      const helm = generateBossHelmet(1, 'centipede', 'rare');
      meta.addHelmet(helm);
      meta.equipHelmet(helm.id || helm.Id);

      // Commit a failed run
      meta.commitRun({
        score: 1200,
        floor: 2,
        combo: 8,
        level: 4,
        kills: 30,
        foods: 15,
        bosses: 1,
        timeSec: 45,
        victory: false
      });


      expect(meta.helmets.length).toBe(1);
      expect(meta.equippedHelmetId).toBe(helm.id);
    });
  });

  /* -------------------------------------------------------------------------
   * 3. BOSS DEFEAT HELMET LOOT DROP
   * ------------------------------------------------------------------------- */
  describe('3. Boss Defeat Helmet Loot Drops', () => {
    it('spawns in-world physical helmet drop on boss defeat and registers into MetaProgression when collected', () => {
      const meta = MetaProgression.instance;
      expect(meta.helmets.length).toBe(0);

      g.spawnBoss();
      expect(g.boss).not.toBeNull();

      g.onBossDefeated();
      expect(g.boss).toBeNull();
      expect(g.helmetDrops.length).toBe(1);

      const drop = g.helmetDrops[0]!;
      expect(drop.helmet).toBeDefined();
      expect(drop.helmet.stats).toBeDefined();

      // Collect drop
      g.collectHelmetDrop(drop);
      expect(meta.helmets.length).toBe(1);
      expect(meta.helmets[0]!.id).toBeDefined();
      expect(meta.helmets[0]!.stats).toBeDefined();
    });
  });

  /* -------------------------------------------------------------------------
   * 4. SNAKE PLAYER EQUIPPED HELMET STAT BINDINGS
   * ------------------------------------------------------------------------- */
  describe('4. SnakePlayer Equipped Helmet Stat Modifiers', () => {
    it('applies equipped helmet stats to PlayerStats at initialization', () => {
      const helm: HelmetDef = {
        Id: 'helm-atk',
        Name: 'War Crown',
        Icon: '🪖',
        Rarity: 'rare',
        Stats: {
          maxHp: 40,
          armor: 0.12,
          speed: 0.15,
          bitePower: 12,
          critChance: 0.10,
          critMult: 0.5,
          magnetRadius: 30,
          thorns: 15,
          shield: 25
        },
        id: 'helm-atk',
        name: 'War Crown',
        icon: '🪖',
        rarity: 'rare',
        stats: {
          maxHp: 40,
          armor: 0.12,
          speed: 0.15,
          bitePower: 12,
          critChance: 0.10,
          critMult: 0.5,
          magnetRadius: 30,
          thorns: 15,
          shield: 25
        }
      };

      MetaProgression.instance.addHelmet(helm);
      MetaProgression.instance.equipHelmet(helm.id || helm.Id);


      const p = new SnakePlayer('emerald', 1280, 720, 2);
      expect(p.equippedHelmet?.id).toBe('helm-atk');


      // Base emerald Max HP is 110. With +40, MaxHp is higher
      expect(p.maxHp).toBeGreaterThanOrEqual(150);
      expect(p.stats.armor).toBeGreaterThanOrEqual(0.12);
      expect(p.stats.critChance).toBeGreaterThanOrEqual(0.18); // 8% base + 10%
      expect(p.stats.thorns).toBeGreaterThanOrEqual(15);
      expect(p.shield).toBeGreaterThanOrEqual(25);
    });
  });

  /* -------------------------------------------------------------------------
   * 5. HEAD-ONLY LAB MECHANICS & PRICE SCALING
   * ------------------------------------------------------------------------- */
  describe('5. Head-Only Mutation Lab & Escalating Price Tradeoff', () => {
    it('allows installing and leveling multiple weapons and defenses directly on the Head', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 3);
      expect(p.headModules).toBeDefined();
      expect(p.headPurchaseCount).toBe(0);

      // Install Turret on Head
      p.installHeadModule('turret');
      expect(p.getHeadModuleLevel('turret')).toBe(1);
      expect(p.headPurchaseCount).toBe(1);

      // Install Tesla on Head (unlimited capacity)
      p.installHeadModule('tesla');
      expect(p.getHeadModuleLevel('tesla')).toBe(1);
      expect(p.headPurchaseCount).toBe(2);

      // Install Shield on Head
      p.installHeadModule('shield');
      expect(p.getHeadModuleLevel('shield')).toBe(1);
      expect(p.headPurchaseCount).toBe(3);

      // Level up Turret to Lv2
      p.installHeadModule('turret');
      expect(p.getHeadModuleLevel('turret')).toBe(2);
      expect(p.headPurchaseCount).toBe(4);
    });

    it('calculates escalated upgrade costs on Head based on total purchases made', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 2);

      // 0 purchases: Lv1 module cost = 30 * 1 + 0 * 15 = 30 Ouro
      expect(p.getHeadModuleCost('turret')).toBe(30);

      p.installHeadModule('turret'); // purchase #1
      // 1 purchase: Lv1 tesla cost = 30 * 1 + 1 * 15 = 45 Ouro
      expect(p.getHeadModuleCost('tesla')).toBe(45);

      // Lv2 turret cost = 30 * 2 + 1 * 15 = 75 Ouro
      expect(p.getHeadModuleCost('turret')).toBe(75);

      p.installHeadModule('turret'); // purchase #2 (now Turret is Lv2)
      // 2 purchases: Lv1 shield cost = 30 * 1 + 2 * 15 = 60 Ouro
      expect(p.getHeadModuleCost('shield')).toBe(60);

      // Cranial Augment cost: Base 40 * nextLevel + purchases * 20
      // 2 purchases: Lv1 fangs cost = 40 * 1 + 2 * 20 = 80 Ouro
      expect(p.getHeadAugmentCost('fangs')).toBe(80);
    });
  });

  /* -------------------------------------------------------------------------
   * 6. COMBAT EXECUTION OF HEAD MODULES
   * ------------------------------------------------------------------------- */
  describe('6. CombatSystem Head-Installed Modules Simulation', () => {
    it('executes head-installed weapon modules from player head position', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 2);
      p.x = 200;
      p.y = 200;
      p.installHeadModule('turret');
      p.installHeadModule('tesla');

      g.player = p;
      const combat = new CombatSystem();
      const enemy = new Enemy(240, 200, 'scarab', 1);
      g.enemies = [enemy];


      const initialProjCount = g.projectiles.length;
      const initialEnemyHp = enemy.hp;

      // Update for 0.7s to trigger turret action timer (0.6s)
      combat.updateSegmentModules(0.7, g as any);

      // Turret projectile should have spawned near player head (x: 200, y: 200)
      expect(g.projectiles.length).toBeGreaterThan(initialProjCount);
      const proj = g.projectiles[g.projectiles.length - 1]!;
      expect(proj.x).toBeCloseTo(200, -1);
      expect(proj.y).toBeCloseTo(200, -1);
    });

    it('executes head-installed defense modules protecting the head', () => {
      const p = new SnakePlayer('emerald', 1280, 720, 2);
      p.headHp = 30;
      p.installHeadModule('regen');

      g.player = p;
      const combat = new CombatSystem();

      // Trigger regen timer (3.5s)
      combat.updateSegmentModules(3.6, g as any);

      // Head should have received healing
      expect(p.headHp).toBeGreaterThan(30);
    });
  });

  /* -------------------------------------------------------------------------
   * 7. SNAKELAB SCREEN & CLASS SELECT SCREEN UI AUDIT
   * ------------------------------------------------------------------------- */
  describe('7. SnakeLabScreen & ClassSelectScreen Conformance', () => {
    let screen: SnakeLabScreen;
    let uiRoot: UiRoot;

    beforeEach(() => {
      const player = new SnakePlayer('emerald', 1280, 720, 3);
      player.xp = 500;
      g.player = player;

      const container = document.createElement('div');
      uiRoot = UiRoot.init(container as any, g);
      screen = new SnakeLabScreen(uiRoot);
      uiRoot.registerScreen(screen);
    });

    it('presents Head Arsenal and Cranial Augment tabs with purchase cost escalation', () => {
      screen.show();
      screen.refresh();

      // Verify that offensive weapons (Attack Spitter, Bio-Arc, etc.) and defenses are present in the Head lab
      const text = screen.element.textContent || '';
      expect(text).toContain('Attack Spitter');
      expect(text).toContain('Carapace Shield');
      expect(text).toContain('Venom Fangs');

      // Click install Attack Spitter
      const buttons = screen.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const turretBtn = Array.from(buttons).find(b => b.textContent.includes('Attack Spitter')) as HTMLButtonElement;
      expect(turretBtn).toBeDefined();

      turretBtn.click();
      expect(g.player.getHeadModuleLevel('turret')).toBe(1);
      expect(g.player.headPurchaseCount).toBe(1);

      // Subsequent upgrade buttons reflect increased cost
      screen.refresh();
      const updatedButtons = screen.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const teslaBtn = Array.from(updatedButtons).find(b => b.textContent.includes('Bio-Arc Coil')) as HTMLButtonElement;
      expect(teslaBtn.textContent).toContain('45 Ouro'); // Base 30 + 15
    });

    it('provides unaffordability feedback (disabled state, not-allowed cursor, error sound) when player lacks Ouro', () => {
      // Set player with 15 Ouro (insufficient for 30 Ouro base cost)
      g.player.xp = 15;
      (g.player as any).ouro = 15;
      screen.show();
      screen.refresh();

      const buttons = screen.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const turretBtn = Array.from(buttons).find(b => b.textContent.includes('Attack Spitter')) as HTMLButtonElement;
      expect(turretBtn).toBeDefined();
      expect(turretBtn.disabled).toBe(false);
      expect(turretBtn.getAttribute('aria-disabled')).toBe('true');
      expect(turretBtn.style.cursor).toBe('not-allowed');

      const initialErrorSounds = soundSpy.errorCount;
      const initialPurchases = g.player.headPurchaseCount;

      // Click while unaffordable
      turretBtn.click();
      expect(soundSpy.errorCount).toBe(initialErrorSounds + 1);
      expect(g.player.headPurchaseCount).toBe(initialPurchases);
      expect(g.player.getHeadModuleLevel('turret')).toBe(0);

      // Grant sufficient Ouro (100 Ouro)
      (g.player as any).ouro = 100;
      g.player.xp = 100;
      screen.refresh();

      const refreshedButtons = screen.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const refreshedTurretBtn = Array.from(refreshedButtons).find(b => b.textContent.includes('Attack Spitter')) as HTMLButtonElement;
      expect(refreshedTurretBtn).toBeDefined();
      expect(refreshedTurretBtn.disabled).toBe(false);
      expect(refreshedTurretBtn.getAttribute('aria-disabled')).toBe('false');
      expect(refreshedTurretBtn.style.cursor).toBe('pointer');

      // Click to purchase
      refreshedTurretBtn.click();
      expect(soundSpy.levelUpCount).toBeGreaterThan(0);
      expect(g.player.getHeadModuleLevel('turret')).toBe(1);
      expect(g.player.headPurchaseCount).toBe(initialPurchases + 1);
      expect((g.player as any).ouro).toBe(70); // 100 - 30 = 70 Ouro remaining
    });

    it('verifies wallet synchronization: spending in Cranial Lab decreases both Lab Ouro chip and in-game HUD counter', () => {
      (g.player as any).ouro = 100;
      g.player.xp = 100;
      screen.show();
      screen.refresh();

      const hud = uiRoot.hudView;
      hud.refresh(g);

      expect(screen.element.querySelector('.lab-stat-chip-ouro')?.textContent).toContain('🪙 100 Ouro');
      expect(hud.element.querySelector('.hud-ouro-val, .hud-xp-val')?.textContent).toBe('100');

      const buttons = screen.element.querySelectorAll('.lab-docked-card-container button.cyber-btn');
      const turretBtn = Array.from(buttons).find(b => b.textContent.includes('Attack Spitter')) as HTMLButtonElement;
      expect(turretBtn).toBeDefined();

      turretBtn.click();

      expect(g.player.ouro).toBe(70);

      expect(screen.element.querySelector('.lab-stat-chip-ouro')?.textContent).toContain('🪙 70 Ouro');
      expect(hud.element.querySelector('.hud-ouro-val, .hud-xp-val')?.textContent).toBe('70');
    });

    it('ClassSelectScreen provides Helmet Vault selector to choose loadout before run start', () => {
      const helm: HelmetDef = {
        Id: 'sel-helm-1',
        Name: 'Emerald Diadem',
        Icon: '👑',
        Rarity: 'uncommon',
        Stats: { maxHp: 20, speed: 0.05 },
        id: 'sel-helm-1',
        name: 'Emerald Diadem',
        icon: '👑',
        rarity: 'uncommon',
        stats: { maxHp: 20, speed: 0.05 }
      };
      MetaProgression.instance.addHelmet(helm);

      const classScreen = new ClassSelectScreen(uiRoot);
      uiRoot.registerScreen(classScreen);
      classScreen.show();

      expect(classScreen.element.textContent).toContain('HELMET');
    });

    it('SnakeLabScreen contains zero body socket tabs and exclusively upgrades the Head', () => {
      screen.show();
      screen.refresh();

      const text = screen.element.textContent || '';
      expect(text).toContain('CRANIAL MUTATION LAB');
      expect(text).not.toContain('L1 Left Wing');
      expect(text).not.toContain('C1 Center Spine');
      expect(text).not.toContain('R1 Right Wing');
    });

    it('head spikes and magnet modules apply armor, thorns, and magnet radius bonuses', () => {
      const p = new SnakePlayer('emerald', 1000, 1000, 3);
      const baseArmor = p.EffectiveArmor;
      const baseThorns = p.Stats.Thorns;
      const baseMag = p.Stats.MagnetRadius;

      p.InstallHeadModule('spikes');
      expect(p.EffectiveArmor).toBeGreaterThan(baseArmor);
      expect(p.Stats.Thorns).toBeGreaterThan(baseThorns);

      p.InstallHeadModule('magnet');
      expect(p.Stats.MagnetRadius).toBeGreaterThan(baseMag);
    });

    it('hpRegen on equipped helmet ticks health recovery in UpdatePassives', () => {
      const meta = MetaProgression.instance;
      const regHelm: HelmetDef = {
        Id: 'regen-helm-1',
        Name: 'Crown of Life',
        Icon: '🌿',
        Rarity: 'rare',
        Stats: { maxHp: 50, hpRegen: 4 },
        id: 'regen-helm-1',
        name: 'Crown of Life',
        icon: '🌿',
        rarity: 'rare',
        stats: { maxHp: 50, hpRegen: 4 }
      };
      meta.addHelmet(regHelm);
      meta.equipHelmet('regen-helm-1');

      const p = new SnakePlayer('emerald', 1000, 1000, 3);
      expect(p.Stats.HpRegen).toBe(4);

      // Damage the player
      p.Hp = 50;
      p.UpdatePassives(3.1, {} as any);
      // 4 HP/s * 3s = 12 HP healed -> 50 + 12 = 62
      expect(p.Hp).toBe(62);
    });

    it('SaveIO export and import preserves helmets and equipped helmet ID', () => {
      const helm: HelmetDef = {
        Id: 'save-export-helm',
        Name: 'Astral Diadem',
        Icon: '🌌',
        Rarity: 'mythic',
        Stats: { maxHp: 80, critChance: 0.20 },
        id: 'save-export-helm',
        name: 'Astral Diadem',
        icon: '🌌',
        rarity: 'mythic',
        stats: { maxHp: 80, critChance: 0.20 }
      };
      const metaSave = SaveIO.loadMeta();
      metaSave.helmets = [helm];
      metaSave.equippedHelmetId = 'save-export-helm';
      SaveIO.saveMeta(metaSave);

      const exportedJson = SaveIO.exportSaveJson();
      expect(exportedJson).toContain('Astral Diadem');
      expect(exportedJson).toContain('save-export-helm');

      const importResult = SaveIO.importSaveJson(exportedJson);
      expect(importResult.success).toBe(true);
      expect(importResult.data?.helmets?.length).toBeGreaterThan(0);
      expect(importResult.data?.equippedHelmetId).toBe('save-export-helm');
    });



    it('SnakeLabScreen supports tab switching between Cranial Lab and Helmet Vault', () => {
      const mockMeta = MetaProgression.Instance;
      mockMeta.Helmets = [
        {
          Id: 'test-lab-helm',
          Name: 'Centipede Crest',
          Icon: '🪖',
          Rarity: 'epic',
          Stats: { maxHp: 40, armor: 0.10 },
          id: 'test-lab-helm',
          name: 'Centipede Crest',
          icon: '🪖',
          rarity: 'epic',
          stats: { maxHp: 40, armor: 0.10 }
        }
      ];
      mockMeta.EquippedHelmetId = null;

      const screen = new SnakeLabScreen(uiRoot);
      screen.show();

      // Tab buttons exist
      const tabLab = screen.element.querySelector('.btn-tab-lab') as HTMLButtonElement;
      const tabHelmets = screen.element.querySelector('.btn-tab-helmets') as HTMLButtonElement;
      expect(tabLab).not.toBeNull();
      expect(tabHelmets).not.toBeNull();

      // Default tab is Cranial Lab
      expect(screen.activeTab).toBe('lab');
      expect(screen.element.textContent).toContain('OFFENSIVE WEAPONS');

      // Click Helmet Vault tab
      tabHelmets.click();
      expect(screen.activeTab).toBe('helmets');
      expect(screen.element.textContent).toContain('COLLECTED BOSS HELMETS');
      expect(screen.element.textContent).toContain('Centipede Crest');

      // Equip helmet from the Lab
      const equipBtn = screen.element.querySelector('.btn-equip-helmet') as HTMLButtonElement;
      expect(equipBtn).not.toBeNull();
      equipBtn.click();

      expect(mockMeta.EquippedHelmetId).toBe('test-lab-helm');
      expect(g.player?.EquippedHelmet?.Name || (g.player?.EquippedHelmet as any)?.name).toBe('Centipede Crest');

      // Unequip helmet from active banner
      const unequipBtn = screen.element.querySelector('.btn-unequip-helmet') as HTMLButtonElement;
      expect(unequipBtn).not.toBeNull();
      unequipBtn.click();

      expect(mockMeta.EquippedHelmetId).toBeNull();
      expect(g.player?.EquippedHelmet).toBeNull();

      // Switch back to Cranial Lab tab
      tabLab.click();
      expect(screen.activeTab).toBe('lab');
      expect(screen.element.textContent).toContain('OFFENSIVE WEAPONS');
    });

    it('GameEngine.restartRun starts a fresh game state', () => {
      g.startRun();
      expect(g.runInProgress).toBe(true);
      g.restartRun();
      expect(g.runInProgress).toBe(true);
      expect(g.currentFloor).toBe(1);
    });
  });
});

