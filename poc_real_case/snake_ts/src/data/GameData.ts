/**
 * Ouroboros Ascension — Authoritative Static Game Data (GameData.ts)
 *
 * Generated balance constants, data tables, card definitions, classes, enemies, bosses,
 * and meta-upgrades matching C# Data.Generated.GameData bit-for-bit.
 */

import { MathX } from '../core/MathX.js';
import {
  SnakeClassDef,
  CardDef,
  EnemyTypeDef,
  BossArchetypeDef,
  FoodTypeDef,
  ComboTierDef,
  GameModeDef,
  MetaUpgradeDef,
  SocketModuleDef,
  AlchemicalFusionDef,
  OrderedTable,
} from './Types.js';

export class GameData {
  public static readonly Classes: OrderedTable<SnakeClassDef> = GameData.buildClasses();
  public static readonly classes = GameData.Classes;

  private static buildClasses(): OrderedTable<SnakeClassDef> {
    const t = new OrderedTable<SnakeClassDef>();
    t.Add('emerald', {
      Id: 'emerald', id: 'emerald',
      Name: 'Emerald Viper', name: 'Emerald Viper',
      Icon: '🐍', icon: '🐍',
      Color: '#00f0b5', color: '#00f0b5',
      Accent: '#10b981', accent: '#10b981',
      Cost: 0, cost: 0,
      Passive: 'Photosynthesis — regenerate 1 HP every 6s and pull nourishment from 30% further away.',
      passive: 'Photosynthesis — regenerate 1 HP every 6s and pull nourishment from 30% further away.',
      Desc: 'The primordial balanced serpent. Absorbs nourishment from afar and steadily regenerates vital energy.',
      desc: 'The primordial balanced serpent. Absorbs nourishment from afar and steadily regenerates vital energy.',
      Skill: { Name: 'Verdant Bloom', name: 'Verdant Bloom', Icon: '🌿', icon: '🌿', Cooldown: 22, cooldown: 22, Desc: 'Heal 20% of max HP and bloom five ripe fruit around you.', desc: 'Heal 20% of max HP and bloom five ripe fruit around you.' },
      skill: { Name: 'Verdant Bloom', name: 'Verdant Bloom', Icon: '🌿', icon: '🌿', Cooldown: 22, cooldown: 22, Desc: 'Heal 20% of max HP and bloom five ripe fruit around you.', desc: 'Heal 20% of max HP and bloom five ripe fruit around you.' },
      BaseStats: { MaxHp: 110, maxHp: 110, Speed: 1, speed: 1, DashCooldown: 3.2, dashCooldown: 3.2, BitePower: 26, bitePower: 26, MagnetRadius: 78, magnetRadius: 78, CritChance: 0.08, critChance: 0.08, CritMult: 1.5, critMult: 1.5, Armor: 0, armor: 0 },
      baseStats: { MaxHp: 110, maxHp: 110, Speed: 1, speed: 1, DashCooldown: 3.2, dashCooldown: 3.2, BitePower: 26, bitePower: 26, MagnetRadius: 78, magnetRadius: 78, CritChance: 0.08, critChance: 0.08, CritMult: 1.5, critMult: 1.5, Armor: 0, armor: 0 },
    });
    t.Add('stalker', {
      Id: 'stalker', id: 'stalker',
      Name: 'Shadow Stalker', name: 'Shadow Stalker',
      Icon: '🥷', icon: '🥷',
      Color: '#a855f7', color: '#a855f7',
      Accent: '#c77dff', accent: '#c77dff',
      Cost: 150, cost: 150,
      Passive: 'Phantom Shift — +25% critical chance and 0.7s of invulnerability after every dash.',
      passive: 'Phantom Shift — +25% critical chance and 0.7s of invulnerability after every dash.',
      Desc: 'An agile, lethal predator. Slices through shadow and lands devastating critical strikes on its prey.',
      desc: 'An agile, lethal predator. Slices through shadow and lands devastating critical strikes on its prey.',
      Skill: { Name: 'Umbral Blink', name: 'Umbral Blink', Icon: '🌑', icon: '🌑', Cooldown: 13, cooldown: 13, Desc: 'Blink 200px forward and leave a detonating shadow clone behind.', desc: 'Blink 200px forward and leave a detonating shadow clone behind.' },
      skill: { Name: 'Umbral Blink', name: 'Umbral Blink', Icon: '🌑', icon: '🌑', Cooldown: 13, cooldown: 13, Desc: 'Blink 200px forward and leave a detonating shadow clone behind.', desc: 'Blink 200px forward and leave a detonating shadow clone behind.' },
      BaseStats: { MaxHp: 85, maxHp: 85, Speed: 1.15, speed: 1.15, DashCooldown: 2.4, dashCooldown: 2.4, BitePower: 34, bitePower: 34, MagnetRadius: 58, magnetRadius: 58, CritChance: 0.25, critChance: 0.25, CritMult: 2, critMult: 2, Armor: 0, armor: 0 },
      baseStats: { MaxHp: 85, maxHp: 85, Speed: 1.15, speed: 1.15, DashCooldown: 2.4, dashCooldown: 2.4, BitePower: 34, bitePower: 34, MagnetRadius: 58, magnetRadius: 58, CritChance: 0.25, critChance: 0.25, CritMult: 2, critMult: 2, Armor: 0, armor: 0 },
    });
    t.Add('hydra', {
      Id: 'hydra', id: 'hydra',
      Name: 'Hydra Behemoth', name: 'Hydra Behemoth',
      Icon: '🐲', icon: '🐲',
      Color: '#ef4444', color: '#ef4444',
      Accent: '#ff4d6d', accent: '#ff4d6d',
      Cost: 300, cost: 300,
      Passive: 'Titan Shell — huge health pool, 25% damage reduction, and two extra biting heads.',
      passive: 'Titan Shell — huge health pool, 25% damage reduction, and two extra biting heads.',
      Desc: 'An unyielding colossal dragon. Tanks heavy collisions and crushes entire swarms with brute force.',
      desc: 'An unyielding colossal dragon. Tanks heavy collisions and crushes entire swarms with brute force.',
      Skill: { Name: 'Titan Roar', name: 'Titan Roar', Icon: '🗯️', icon: '🗯️', Cooldown: 19, cooldown: 19, Desc: 'Shockwave that stuns and maims everything within 230px, then +25% armour for 5s.', desc: 'Shockwave that stuns and maims everything within 230px, then +25% armour for 5s.' },
      skill: { Name: 'Titan Roar', name: 'Titan Roar', Icon: '🗯️', icon: '🗯️', Cooldown: 19, cooldown: 19, Desc: 'Shockwave that stuns and maims everything within 230px, then +25% armour for 5s.', desc: 'Shockwave that stuns and maims everything within 230px, then +25% armour for 5s.' },
      BaseStats: { MaxHp: 170, maxHp: 170, Speed: 0.9, speed: 0.9, DashCooldown: 4, dashCooldown: 4, BitePower: 42, bitePower: 42, MagnetRadius: 62, magnetRadius: 62, CritChance: 0.05, critChance: 0.05, CritMult: 1.5, critMult: 1.5, Armor: 0.25, armor: 0.25 },
      baseStats: { MaxHp: 170, maxHp: 170, Speed: 0.9, speed: 0.9, DashCooldown: 4, dashCooldown: 4, BitePower: 42, bitePower: 42, MagnetRadius: 62, magnetRadius: 62, CritChance: 0.05, critChance: 0.05, CritMult: 1.5, critMult: 1.5, Armor: 0.25, armor: 0.25 },
    });
    t.Add('storm', {
      Id: 'storm', id: 'storm',
      Name: 'Storm Wyrm', name: 'Storm Wyrm',
      Icon: '⚡', icon: '⚡',
      Color: '#38bdf8', color: '#38bdf8',
      Accent: '#7dd3fc', accent: '#7dd3fc',
      Cost: 500, cost: 500,
      Passive: 'Static Coil — every 5th combo step arcs lightning through the three nearest hostiles.',
      passive: 'Static Coil — every 5th combo step arcs lightning through the three nearest hostiles.',
      Desc: 'Electrified serpent charged with atmospheric storms. Moves at lightning speed and shocks all in its wake.',
      desc: 'Electrified serpent charged with atmospheric storms. Moves at lightning speed and shocks all in its wake.',
      Skill: { Name: 'Chain Storm', name: 'Chain Storm', Icon: '🌩️', icon: '🌩️', Cooldown: 15, cooldown: 15, Desc: 'Unleash a bolt that chains through up to eight targets, damage growing per jump.', desc: 'Unleash a bolt that chains through up to eight targets, damage growing per jump.' },
      skill: { Name: 'Chain Storm', name: 'Chain Storm', Icon: '🌩️', icon: '🌩️', Cooldown: 15, cooldown: 15, Desc: 'Unleash a bolt that chains through up to eight targets, damage growing per jump.', desc: 'Unleash a bolt that chains through up to eight targets, damage growing per jump.' },
      BaseStats: { MaxHp: 95, maxHp: 95, Speed: 1.22, speed: 1.22, DashCooldown: 2.8, dashCooldown: 2.8, BitePower: 28, bitePower: 28, MagnetRadius: 68, magnetRadius: 68, CritChance: 0.12, critChance: 0.12, CritMult: 1.75, critMult: 1.75, Armor: 0.05, armor: 0.05 },
      baseStats: { MaxHp: 95, maxHp: 95, Speed: 1.22, speed: 1.22, DashCooldown: 2.8, dashCooldown: 2.8, BitePower: 28, bitePower: 28, MagnetRadius: 68, magnetRadius: 68, CritChance: 0.12, critChance: 0.12, CritMult: 1.75, critMult: 1.75, Armor: 0.05, armor: 0.05 },
    });
    t.Add('solar', {
      Id: 'solar', id: 'solar',
      Name: 'Solar Drake', name: 'Solar Drake',
      Icon: '🔥', icon: '🔥',
      Color: '#f59e0b', color: '#f59e0b',
      Accent: '#ffb703', accent: '#ffb703',
      Cost: 800, cost: 800,
      Passive: 'Magma Trail — leaves burning ground, and cooks any food it touches into golden fruit.',
      passive: 'Magma Trail — leaves burning ground, and cooks any food it touches into golden fruit.',
      Desc: 'Ancient flame incarnate. Turns the battlefield into an inferno and harvests scorched food for immense power.',
      desc: 'Ancient flame incarnate. Turns the battlefield into an inferno and harvests scorched food for immense power.',
      Skill: { Name: 'Supernova', name: 'Supernova', Icon: '☀️', icon: '☀️', Cooldown: 21, cooldown: 21, Desc: 'Detonate a solar nova that ignites all nearby foes and gilds every fruit it touches.', desc: 'Detonate a solar nova that ignites all nearby foes and gilds every fruit it touches.' },
      skill: { Name: 'Supernova', name: 'Supernova', Icon: '☀️', icon: '☀️', Cooldown: 21, cooldown: 21, Desc: 'Detonate a solar nova that ignites all nearby foes and gilds every fruit it touches.', desc: 'Detonate a solar nova that ignites all nearby foes and gilds every fruit it touches.' },
      BaseStats: { MaxHp: 120, maxHp: 120, Speed: 1.05, speed: 1.05, DashCooldown: 3, dashCooldown: 3, BitePower: 32, bitePower: 32, MagnetRadius: 72, magnetRadius: 72, CritChance: 0.1, critChance: 0.1, CritMult: 1.6, critMult: 1.6, Armor: 0.1, armor: 0.1 },
      baseStats: { MaxHp: 120, maxHp: 120, Speed: 1.05, speed: 1.05, DashCooldown: 3, dashCooldown: 3, BitePower: 32, bitePower: 32, MagnetRadius: 72, magnetRadius: 72, CritChance: 0.1, critChance: 0.1, CritMult: 1.6, critMult: 1.6, Armor: 0.1, armor: 0.1 },
    });
    return t;
  }

  /** Port of RELIC_DEFAULTS. Every relic starts at 0 on every player. */
  public static readonly RelicKeys: readonly string[] = [
    'venomSpit', 'frostbite', 'orbitalFangs', 'vampiric', 'explosiveAppetite', 'chainReaction', 'quantumPhase',
    'singularity', 'overdrive', 'dragonsBreath', 'thunder', 'phoenix', 'phoenixCharges', 'devourer',
    'comboSurge', 'thorns', 'homing', 'moltenWake', 'cryoNova', 'echoStrike', 'soulHarvest', 'adrenal',
    'gluttonGrowth', 'eternalCoil', 'timeDilation', 'apexPredator'
  ];
  public static readonly relicKeys = GameData.RelicKeys;

  public static newRelics(): Record<string, number> {
    const d: Record<string, number> = {};
    for (let i = 0; i < GameData.RelicKeys.length; i++) {
      const k = GameData.RelicKeys[i];
      if (k) d[k] = 0;
    }
    return d;
  }
  public static NewRelics(): Record<string, number> {
    return GameData.newRelics();
  }

  /** Port of CARD_POOL. Order matters: the draft filters and then rarity-sorts this list. */
  public static readonly CardPool: readonly CardDef[] = GameData.buildCards();
  public static readonly cardPool = GameData.CardPool;

  private static buildCards(): CardDef[] {
    interface RawCard {
      Id: string;
      Title: string;
      Rarity: string;
      Icon: string;
      MaxStacks: number;
      Desc: string;
      Stats: string;
      Apply: (p: any) => void;
    }
    const raw: RawCard[] = [
      {
        Id: 'swift_scales', Title: 'Swift Scales', Rarity: 'common',
        Icon: '💨', MaxStacks: 5,
        Desc: 'Sleeker scales cut through the air. Slithering speed increased.',
        Stats: '+12% Movement Speed',
        Apply: p => {
          const st = p.Stats || p.stats;
          if (st) st.Speed = (st.Speed || st.speed || 1) * 1.12;
        }
      },
      {
        Id: 'iron_belly', Title: 'Iron Belly', Rarity: 'common',
        Icon: '❤️', MaxStacks: 5,
        Desc: 'A denser gut wall. Expands your total vitality and mends you instantly.',
        Stats: '+25 Max HP, heal 25',
        Apply: p => {
          const st = p.Stats || p.stats;
          if (st) st.MaxHp = (st.MaxHp || st.maxHp || 100) + 25;
          if (typeof p.heal === 'function') p.heal(25);
          else if (typeof p.Heal === 'function') p.Heal(25);
        }
      },
      {
        Id: 'magnetic_coil', Title: 'Magnetic Coil', Rarity: 'common',
        Icon: '🧲', MaxStacks: 4,
        Desc: 'Your coils hum with charge, dragging nourishment toward your jaws.',
        Stats: '+40% Magnet Range',
        Apply: p => {
          const st = p.Stats || p.stats;
          if (st) st.MagnetRadius = (st.MagnetRadius || st.magnetRadius || 78) * 1.4;
        }
      },
      {
        Id: 'razor_fangs', Title: 'Razor Fangs', Rarity: 'common',
        Icon: '🦷', MaxStacks: 5,
        Desc: 'Serrated, self-sharpening teeth that find the weak seam in any shell.',
        Stats: '+15 Bite Power, +5% Crit',
        Apply: p => {
          const st = p.Stats || p.stats;
          if (st) {
            st.BitePower = (st.BitePower || st.bitePower || 25) + 15;
            st.CritChance = (st.CritChance || st.critChance || 0) + 0.05;
          }
        }
      },
      {
        Id: 'sprint_gland', Title: 'Sprint Gland', Rarity: 'common',
        Icon: '⚡', MaxStacks: 4,
        Desc: 'A swollen adrenal sac primes your muscles for another burst sooner.',
        Stats: '-18% Dash Cooldown',
        Apply: p => {
          const st = p.Stats || p.stats;
          if (st) st.DashCooldown = Math.max(0.5, (st.DashCooldown || st.dashCooldown || 2.4) * 0.82);
        }
      },
      {
        Id: 'hardened_carapace', Title: 'Hardened Carapace', Rarity: 'common',
        Icon: '🛡️', MaxStacks: 5,
        Desc: 'Overlapping plates of keratin blunt everything that lands on you.',
        Stats: '+8% Damage Reduction',
        Apply: p => {
          const st = p.Stats || p.stats;
          if (st) st.Armor = Math.min(0.75, (st.Armor || st.armor || 0) + 0.08);
        }
      },
      {
        Id: 'keen_eye', Title: 'Keen Eye', Rarity: 'common',
        Icon: '👁️', MaxStacks: 4,
        Desc: 'You read the pulse of your prey and strike exactly where it matters.',
        Stats: '+30% Critical Damage',
        Apply: p => {
          const st = p.Stats || p.stats;
          if (st) st.CritMult = (st.CritMult || st.critMult || 1.5) + 0.3;
        }
      },
      {
        Id: 'gourmand', Title: 'Gourmand', Rarity: 'common',
        Icon: '🍽️', MaxStacks: 4,
        Desc: 'Every morsel is digested down to the last spark of essence.',
        Stats: '+20% Ouro Gained',
        Apply: p => {
          const st = p.Stats || p.stats;
          if (st) st.XpGain = (st.XpGain || st.xpGain || 1.0) + 0.2;
        }
      },
      {
        Id: 'serpents_focus', Title: "Serpent's Focus", Rarity: 'common',
        Icon: '🎯', MaxStacks: 3,
        Desc: 'A steadier trance holds your killing rhythm together for longer.',
        Stats: '+25% Combo Window',
        Apply: p => {
          const st = p.Stats || p.stats;
          if (st) st.ComboWindow = (st.ComboWindow ?? st.comboWindow ?? 1.0) + 0.25;
        }
      },
      {
        Id: 'shard_lust', Title: 'Shard Lust', Rarity: 'common',
        Icon: '⭐', MaxStacks: 3,
        Desc: 'You taste the crystal in the ruin of your enemies and take more of it.',
        Stats: '+30% Shard Drops',
        Apply: p => {
          const st = p.Stats || p.stats;
          if (st) st.ShardGain = (st.ShardGain || st.shardGain || 1.0) + 0.3;
        }
      },
      {
        Id: 'venom_spit', Title: 'Venom Spit', Rarity: 'rare',
        Icon: '🧪', MaxStacks: 3,
        Desc: 'Hollow fangs launch corrosive darts at whatever hunts you.',
        Stats: 'Auto-fires venom darts (45 dmg)',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['venomSpit'] = (rel['venomSpit'] ?? 0) + 1;
        }
      },
      {
        Id: 'frostbite_aura', Title: 'Frostbite Aura', Rarity: 'rare',
        Icon: '❄️', MaxStacks: 2,
        Desc: 'A creeping chill radiates from your body, seizing anything that closes in.',
        Stats: 'Chills enemies within 120px (-45% speed)',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['frostbite'] = (rel['frostbite'] ?? 0) + 1;
        }
      },
      {
        Id: 'shield_matrix', Title: 'Shield Matrix', Rarity: 'rare',
        Icon: '💠', MaxStacks: 3,
        Desc: 'A lattice of hard light that reknits itself when you stop taking hits.',
        Stats: '+45 Energy Shield, recharges after 8s',
        Apply: p => {
          const st = p.Stats || p.stats;
          if (st) st.MaxShield = (st.MaxShield || st.maxShield || 0) + 45;
          const maxS = st ? (st.MaxShield || st.maxShield || 45) : 45;
          if ('shield' in p) p.shield = maxS;
          if ('Shield' in p) p.Shield = maxS;
        }
      },
      {
        Id: 'vampiric_feast', Title: 'Vampiric Feast', Rarity: 'rare',
        Icon: '🩸', MaxStacks: 3,
        Desc: 'Every kill and every meal bleeds its vitality straight into yours.',
        Stats: '+3 HP per feast, +15% Bite Power',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['vampiric'] = (rel['vampiric'] ?? 0) + 3;
          const st = p.Stats || p.stats;
          if (st) st.BitePower = (st.BitePower || st.bitePower || 25) * 1.15;
        }
      },
      {
        Id: 'explosive_appetite', Title: 'Explosive Appetite', Rarity: 'rare',
        Icon: '💥', MaxStacks: 2,
        Desc: 'You swallow with such violence that the air itself detonates.',
        Stats: 'Eating erupts for 45 dmg in 90px',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['explosiveAppetite'] = (rel['explosiveAppetite'] ?? 0) + 1;
        }
      },
      {
        Id: 'combo_surge', Title: 'Combo Surge', Rarity: 'rare',
        Icon: '🔥', MaxStacks: 2,
        Desc: 'The killing rhythm sustains itself, and pays out richer for holding it.',
        Stats: '+50% Combo Window, +15% Ouro Gained',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['comboSurge'] = (rel['comboSurge'] ?? 0) + 1;
          const st = p.Stats || p.stats;
          if (st) {
            st.ComboWindow = (st.ComboWindow ?? st.comboWindow ?? 1.0) + 0.5;
            st.XpGain = (st.XpGain || st.xpGain || 1.0) + 0.15;
          }
        }
      },
      {
        Id: 'barbed_scales', Title: 'Barbed Scales', Rarity: 'rare',
        Icon: '🌵', MaxStacks: 3,
        Desc: 'Anything that grinds against your hide opens itself up doing it.',
        Stats: 'Reflect 40% of contact damage',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['thorns'] = (rel['thorns'] ?? 0) + 1;
          const st = p.Stats || p.stats;
          if (st) st.Thorns = (st.Thorns || st.thorns || 0) + 0.4;
        }
      },
      {
        Id: 'adrenal_surge', Title: 'Adrenal Surge', Rarity: 'rare',
        Icon: '🫀', MaxStacks: 2,
        Desc: 'Cornered and bleeding is when you move fastest.',
        Stats: '+35% Speed & +20% Bite below 40% HP',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['adrenal'] = (rel['adrenal'] ?? 0) + 1;
        }
      },
      {
        Id: 'seeker_venom', Title: 'Seeker Venom', Rarity: 'rare',
        Icon: '🎯', MaxStacks: 2,
        Desc: 'Your venom darts hunt on their own, correcting mid-flight.',
        Stats: 'Venom darts home in (+2.5 rad/s per stack)',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['homing'] = (rel['homing'] ?? 0) + 1;
        }
      },
      {
        Id: 'glutton_growth', Title: 'Glutton Growth', Rarity: 'rare',
        Icon: '🍖', MaxStacks: 2,
        Desc: 'You do not merely eat. You accumulate.',
        Stats: 'Every 8 meals: +10 Max HP (healed)',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['gluttonGrowth'] = (rel['gluttonGrowth'] ?? 0) + 1;
        }
      },
      {
        Id: 'orbital_fangs', Title: 'Orbital Fangs', Rarity: 'epic',
        Icon: '🌀', MaxStacks: 3,
        Desc: 'Torn-loose fangs circle you on a plasma tether, shredding all they touch.',
        Stats: '+2 orbiting blades (55 dmg, block bullets)',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['orbitalFangs'] = (rel['orbitalFangs'] ?? 0) + 2;
        }
      },
      {
        Id: 'chain_reaction', Title: 'Chain Reaction', Rarity: 'epic',
        Icon: '🎆', MaxStacks: 2,
        Desc: 'The dead go up like ordnance, and take their neighbours with them.',
        Stats: 'Kills detonate for 60 dmg in 95px',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['chainReaction'] = (rel['chainReaction'] ?? 0) + 1;
        }
      },
      {
        Id: 'quantum_phase', Title: 'Quantum Phase', Rarity: 'epic',
        Icon: '🌌', MaxStacks: 1,
        Desc: 'Your body decoheres — your own coils can no longer hurt you, and a dash tears through flesh.',
        Stats: 'No tail collision. Dash pierces enemies.',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['quantumPhase'] = 1;
        }
      },
      {
        Id: 'singularity_core', Title: 'Singularity Core', Rarity: 'epic',
        Icon: '🪐', MaxStacks: 2,
        Desc: 'A collapsed star in your gut drags the whole arena to your jaws.',
        Stats: 'Every 7s: vacuum all food & orbs',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['singularity'] = (rel['singularity'] ?? 0) + 1;
        }
      },
      {
        Id: 'overdrive_capacitor', Title: 'Overdrive Capacitor', Rarity: 'epic',
        Icon: '⚡', MaxStacks: 2,
        Desc: 'Frenzy ignites sooner and burns longer.',
        Stats: 'Frenzy at 8x combo, +4s duration',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['overdrive'] = (rel['overdrive'] ?? 0) + 1;
        }
      },
      {
        Id: 'molten_wake', Title: 'Molten Wake', Rarity: 'epic',
        Icon: '🌋', MaxStacks: 2,
        Desc: 'The ground behind you cannot cool fast enough to be walked on.',
        Stats: 'Leaves burning magma in your wake',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['moltenWake'] = (rel['moltenWake'] ?? 0) + 1;
        }
      },
      {
        Id: 'cryo_nova', Title: 'Cryo Nova', Rarity: 'epic',
        Icon: '🧊', MaxStacks: 2,
        Desc: 'Wound you and the temperature answers for it.',
        Stats: 'Taking damage freezes foes within 160px',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['cryoNova'] = (rel['cryoNova'] ?? 0) + 1;
        }
      },
      {
        Id: 'echo_strike', Title: 'Echo Strike', Rarity: 'epic',
        Icon: '🔊', MaxStacks: 2,
        Desc: 'Each bite ripples a second time a heartbeat later.',
        Stats: 'Bites strike again for 55%',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['echoStrike'] = (rel['echoStrike'] ?? 0) + 1;
        }
      },
      {
        Id: 'soul_harvest', Title: 'Soul Harvest', Rarity: 'epic',
        Icon: '👻', MaxStacks: 2,
        Desc: 'What leaves a dying thing does not get to leave.',
        Stats: 'Kills drop soul orbs, +60% kill Ouro',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['soulHarvest'] = (rel['soulHarvest'] ?? 0) + 1;
        }
      },
      {
        Id: 'dragons_breath', Title: "Dragon's Breath", Rarity: 'legendary',
        Icon: '🐲', MaxStacks: 2,
        Desc: 'Your throat becomes a furnace and everything ahead of you is fuel.',
        Stats: 'Continuous flame cone (22 dmg/tick, burns)',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['dragonsBreath'] = (rel['dragonsBreath'] ?? 0) + 1;
        }
      },
      {
        Id: 'god_of_thunder', Title: 'God of Thunder', Rarity: 'legendary',
        Icon: '🌩️', MaxStacks: 2,
        Desc: 'Hold the rhythm and the sky answers on your behalf.',
        Stats: 'At 2x+ combo: 80 dmg strikes, faster with combo',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['thunder'] = (rel['thunder'] ?? 0) + 1;
        }
      },
      {
        Id: 'phoenix_rebirth', Title: 'Phoenix Rebirth', Rarity: 'legendary',
        Icon: '✨', MaxStacks: 2,
        Desc: 'Death arrives, finds the shape of you already burning, and leaves.',
        Stats: 'Cheat death once: full heal + clearing nova',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) {
            rel['phoenix'] = (rel['phoenix'] ?? 0) + 1;
            rel['phoenixCharges'] = (rel['phoenixCharges'] ?? 0) + 1;
          }
        }
      },
      {
        Id: 'infinite_devourer', Title: 'Infinite Devourer', Rarity: 'legendary',
        Icon: '👑', MaxStacks: 1,
        Desc: 'You are not filling up. You are only getting larger.',
        Stats: 'Every 5 combo: +10 Max HP, +5% damage — forever',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['devourer'] = 1;
        }
      },
      {
        Id: 'eternal_coil', Title: 'Eternal Coil', Rarity: 'legendary',
        Icon: '♾️', MaxStacks: 1,
        Desc: 'The whole length of you is a weapon. The tail bites too.',
        Stats: 'Your entire body deals 30 dmg/s on contact',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['eternalCoil'] = 1;
        }
      },
      {
        Id: 'time_dilation', Title: 'Time Dilation', Rarity: 'legendary',
        Icon: '⏳', MaxStacks: 1,
        Desc: 'At the edge of death the world thickens and slows around you.',
        Stats: 'Below 30% HP: everything else moves at 55%',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['timeDilation'] = 1;
        }
      },
      {
        Id: 'apex_predator', Title: 'Apex Predator', Rarity: 'legendary',
        Icon: '☠️', MaxStacks: 1,
        Desc: 'All offence, no hedge. Fragile in exactly one way and lethal in every other.',
        Stats: '+100% Bite Power, -25% Max HP',
        Apply: p => {
          const rel = p.relics || p.Relics;
          if (rel) rel['apexPredator'] = 1;
          const st = p.Stats || p.stats;
          if (st) {
            st.BitePower = (st.BitePower || st.bitePower || 25) * 2;
            st.MaxHp = Math.max(30, MathX.roundJs((st.MaxHp || st.maxHp || 100) * 0.75));
          }
          const maxHp = st ? (st.MaxHp || st.maxHp || 75) : 75;
          if ('hp' in p) p.hp = Math.min(p.hp, maxHp);
          if ('Hp' in p) p.Hp = Math.min(p.Hp, maxHp);
        }
      },
    ];

    // Populate camelCase aliases on all card objects
    return raw.map(c => ({
      ...c,
      id: c.Id,
      title: c.Title,
      rarity: c.Rarity,
      icon: c.Icon,
      maxStacks: c.MaxStacks,
      desc: c.Desc,
      stats: c.Stats,
      apply: c.Apply,
    }));
  }

  public static readonly RarityOrder: Readonly<Record<string, number>> = {
    common: 0,
    rare: 1,
    epic: 2,
    legendary: 3,
  };
  public static readonly rarityOrder = GameData.RarityOrder;

  public static readonly BossDefeatOuro = 35;
  public static readonly bossDefeatOuro = GameData.BossDefeatOuro;

  /** Port of ENEMY_TYPES. Insertion order drives the spawn table. */
  public static readonly Enemies: OrderedTable<EnemyTypeDef> = GameData.buildEnemies();
  public static readonly enemies = GameData.Enemies;

  private static buildEnemies(): OrderedTable<EnemyTypeDef> {
    const t = new OrderedTable<EnemyTypeDef>();
    t.Add('scarab', { Key: 'scarab', key: 'scarab', Hp: 46, hp: 46, HpPerFloor: 16, hpPerFloor: 16, Speed: 96, speed: 96, Radius: 13, radius: 13, Color: '#ef4444', color: '#ef4444', Dmg: 16, dmg: 16, DmgPerFloor: 3, dmgPerFloor: 3, Xp: 2, xp: 2, Score: 220, score: 220, MinFloor: 1, minFloor: 1 });
    t.Add('swarmling', { Key: 'swarmling', key: 'swarmling', Hp: 20, hp: 20, HpPerFloor: 7, hpPerFloor: 7, Speed: 155, speed: 155, Radius: 9, radius: 9, Color: '#fb7185', color: '#fb7185', Dmg: 10, dmg: 10, DmgPerFloor: 2, dmgPerFloor: 2, Xp: 1, xp: 1, Score: 110, score: 110, MinFloor: 1, minFloor: 1 });
    t.Add('spitter', { Key: 'spitter', key: 'spitter', Hp: 38, hp: 38, HpPerFloor: 15, hpPerFloor: 15, Speed: 74, speed: 74, Radius: 13, radius: 13, Color: '#a855f7', color: '#a855f7', Dmg: 14, dmg: 14, DmgPerFloor: 3, dmgPerFloor: 3, Xp: 3, xp: 3, Score: 260, score: 260, MinFloor: 2, minFloor: 2 });
    t.Add('phantom', { Key: 'phantom', key: 'phantom', Hp: 30, hp: 30, HpPerFloor: 11, hpPerFloor: 11, Speed: 118, speed: 118, Radius: 12, radius: 12, Color: '#f43f5e', color: '#f43f5e', Dmg: 20, dmg: 20, DmgPerFloor: 4, dmgPerFloor: 4, Xp: 3, xp: 3, Score: 280, score: 280, MinFloor: 2, minFloor: 2 });
    t.Add('drone', { Key: 'drone', key: 'drone', Hp: 62, hp: 62, HpPerFloor: 21, hpPerFloor: 21, Speed: 56, speed: 56, Radius: 14, radius: 14, Color: '#38bdf8', color: '#38bdf8', Dmg: 18, dmg: 18, DmgPerFloor: 4, dmgPerFloor: 4, Xp: 4, xp: 4, Score: 320, score: 320, MinFloor: 3, minFloor: 3 });
    t.Add('brute', { Key: 'brute', key: 'brute', Hp: 130, hp: 130, HpPerFloor: 45, hpPerFloor: 45, Speed: 62, speed: 62, Radius: 19, radius: 19, Color: '#f97316', color: '#f97316', Dmg: 28, dmg: 28, DmgPerFloor: 6, dmgPerFloor: 6, Xp: 6, xp: 6, Score: 500, score: 500, MinFloor: 4, minFloor: 4 });
    return t;
  }

  /** Port of BOSS_ARCHETYPES. Bosses cycle by (floor - 1) % Bosses.length. */
  public static readonly Bosses: readonly BossArchetypeDef[] = [
    { Type: 'centipede', type: 'centipede', Name: 'Centipede Behemoth', name: 'Centipede Behemoth', Color: '#ff3366', color: '#ff3366', Accent: '#ff4d6d', accent: '#ff4d6d', BaseHp: 450, baseHp: 450, HpPerFloor: 180, hpPerFloor: 180, Radius: 30, radius: 30, Title: 'The rival coil that outgrew its arena', title: 'The rival coil that outgrew its arena' },
    { Type: 'gorgon', type: 'gorgon', Name: 'Storm Gorgon', name: 'Storm Gorgon', Color: '#00f0b5', color: '#00f0b5', Accent: '#38bdf8', accent: '#38bdf8', BaseHp: 650, baseHp: 650, HpPerFloor: 220, hpPerFloor: 220, Radius: 32, radius: 32, Title: 'Volt sovereign of atmospheric tempests', title: 'Volt sovereign of atmospheric tempests' },
    { Type: 'colossus', type: 'colossus', Name: 'Infernal Colossus', name: 'Infernal Colossus', Color: '#ff9e00', color: '#ff9e00', Accent: '#ffb703', accent: '#ffb703', BaseHp: 900, baseHp: 900, HpPerFloor: 280, hpPerFloor: 280, Radius: 34, radius: 34, Title: 'A furnace that learned to walk', title: 'A furnace that learned to walk' },
    { Type: 'frostwyrm', type: 'frostwyrm', Name: 'Glacial Behemoth', name: 'Glacial Behemoth', Color: '#38bdf8', color: '#38bdf8', Accent: '#93c5fd', accent: '#93c5fd', BaseHp: 1200, baseHp: 1200, HpPerFloor: 340, hpPerFloor: 340, Radius: 35, radius: 35, Title: 'An ancient permafrost core encased in ice spikes', title: 'An ancient permafrost core encased in ice spikes' },
    { Type: 'chronowyrm', type: 'chronowyrm', Name: 'Chrono Wyrm', name: 'Chrono Wyrm', Color: '#a855f7', color: '#a855f7', Accent: '#e0aaff', accent: '#e0aaff', BaseHp: 1500, baseHp: 1500, HpPerFloor: 400, hpPerFloor: 400, Radius: 33, radius: 33, Title: 'Master of temporal dilation and paradox clones', title: 'Master of temporal dilation and paradox clones' },
    { Type: 'hivemind', type: 'hivemind', Name: 'Bio-Venom Hivemind', name: 'Bio-Venom Hivemind', Color: '#84cc16', color: '#84cc16', Accent: '#a3e635', accent: '#a3e635', BaseHp: 1900, baseHp: 1900, HpPerFloor: 460, hpPerFloor: 460, Radius: 36, radius: 36, Title: 'Swarming arachnid broodmother spraying toxic geysers', title: 'Swarming arachnid broodmother spraying toxic geysers' },
    { Type: 'superconductor_boss', type: 'superconductor_boss', Name: 'Apex Superconductor', name: 'Apex Superconductor', Color: '#06d6a0', color: '#06d6a0', Accent: '#118ab2', accent: '#118ab2', BaseHp: 2400, baseHp: 2400, HpPerFloor: 520, hpPerFloor: 520, Radius: 34, radius: 34, Title: 'Hyper-charged galvanic dynamo generating lightning cages', title: 'Hyper-charged galvanic dynamo generating lightning cages' },
    { Type: 'leviathan', type: 'leviathan', Name: 'Astral Leviathan', name: 'Astral Leviathan', Color: '#9d4edd', color: '#9d4edd', Accent: '#c77dff', accent: '#c77dff', BaseHp: 3000, baseHp: 3000, HpPerFloor: 580, hpPerFloor: 580, Radius: 35, radius: 35, Title: 'It writes spirals in the dark and calls them law', title: 'It writes spirals in the dark and calls them law' },
    { Type: 'quantum_hydra', type: 'quantum_hydra', Name: 'Quantum Hydra', name: 'Quantum Hydra', Color: '#c084fc', color: '#c084fc', Accent: '#e879f9', accent: '#e879f9', BaseHp: 3700, baseHp: 3700, HpPerFloor: 650, hpPerFloor: 650, Radius: 36, radius: 36, Title: 'Multiverse serpent splitting into probabilistic reality coils', title: 'Multiverse serpent splitting into probabilistic reality coils' },
    { Type: 'mirror_wyrm', type: 'mirror_wyrm', Name: 'Shadow Doppelgänger', name: 'Shadow Doppelgänger', Color: '#f43f5e', color: '#f43f5e', Accent: '#fb7185', accent: '#fb7185', BaseHp: 4500, baseHp: 4500, HpPerFloor: 720, hpPerFloor: 720, Radius: 33, radius: 33, Title: 'Mirror entity copying player trajectory with lethal inverse reflections', title: 'Mirror entity copying player trajectory with lethal inverse reflections' },
    { Type: 'void_devourer', type: 'void_devourer', Name: 'Void Devourer', name: 'Void Devourer', Color: '#7928ca', color: '#7928ca', Accent: '#b5179e', accent: '#b5179e', BaseHp: 5400, baseHp: 5400, HpPerFloor: 800, hpPerFloor: 800, Radius: 37, radius: 37, Title: 'Abyssal gravity maw consuming arena matter and light', title: 'Abyssal gravity maw consuming arena matter and light' },
    { Type: 'orbital_dreadnought', type: 'orbital_dreadnought', Name: 'Magnetic Dreadnought', name: 'Magnetic Dreadnought', Color: '#06b6d4', color: '#06b6d4', Accent: '#22d3ee', accent: '#22d3ee', BaseHp: 6400, baseHp: 6400, HpPerFloor: 880, hpPerFloor: 880, Radius: 36, radius: 36, Title: 'Colossal floating fortress bristling with magnetized railgun turrets', title: 'Colossal floating fortress bristling with magnetized railgun turrets' },
    { Type: 'iron_juggernaut', type: 'iron_juggernaut', Name: 'Aegis Juggernaut', name: 'Aegis Juggernaut', Color: '#64748b', color: '#64748b', Accent: '#94a3b8', accent: '#94a3b8', BaseHp: 7500, baseHp: 7500, HpPerFloor: 960, hpPerFloor: 960, Radius: 38, radius: 38, Title: 'Impervious adamantine colossus shattering arenas under kinetic momentum', title: 'Impervious adamantine colossus shattering arenas under kinetic momentum' },
    { Type: 'solar_archon', type: 'solar_archon', Name: 'Dyson Archon', name: 'Dyson Archon', Color: '#ea580c', color: '#ea580c', Accent: '#f97316', accent: '#f97316', BaseHp: 8700, baseHp: 8700, HpPerFloor: 1050, hpPerFloor: 1050, Radius: 35, radius: 35, Title: 'Stellar fusion incarnate casting sweeping solar laser corridors', title: 'Stellar fusion incarnate casting sweeping solar laser corridors' },
    { Type: 'crystal_monolith', type: 'crystal_monolith', Name: 'Prismatic Arachnid', name: 'Prismatic Arachnid', Color: '#ec4899', color: '#ec4899', Accent: '#f472b6', accent: '#f472b6', BaseHp: 10000, baseHp: 10000, HpPerFloor: 1150, hpPerFloor: 1150, Radius: 34, radius: 34, Title: 'Resonating quartz arachnid refracting beams through crystal matrices', title: 'Resonating quartz arachnid refracting beams through crystal matrices' },
    { Type: 'tempest_siren', type: 'tempest_siren', Name: 'Tempest Siren', name: 'Tempest Siren', Color: '#38bdf8', color: '#38bdf8', Accent: '#67e8f9', accent: '#67e8f9', BaseHp: 11500, baseHp: 11500, HpPerFloor: 1250, hpPerFloor: 1250, Radius: 34, radius: 34, Title: 'Vortex mistress commanding hurricane eddies and torrential lightning', title: 'Vortex mistress commanding hurricane eddies and torrential lightning' },
    { Type: 'nanite_titan', type: 'nanite_titan', Name: 'Nanite Hive Titan', name: 'Nanite Hive Titan', Color: '#10b981', color: '#10b981', Accent: '#34d399', accent: '#34d399', BaseHp: 13200, baseHp: 13200, HpPerFloor: 1350, hpPerFloor: 1350, Radius: 36, radius: 36, Title: 'Self-replicating swarm entity regenerating broken segments in combat', title: 'Self-replicating swarm entity regenerating broken segments in combat' },
    { Type: 'phase_specter', type: 'phase_specter', Name: 'Plasma Phase Specter', name: 'Plasma Phase Specter', Color: '#8b5cf6', color: '#8b5cf6', Accent: '#a78bfa', accent: '#a78bfa', BaseHp: 15000, baseHp: 15000, HpPerFloor: 1450, hpPerFloor: 1450, Radius: 33, radius: 33, Title: 'Ethereal high-energy apparition phasing through solid geometry', title: 'Ethereal high-energy apparition phasing through solid geometry' },
    { Type: 'volcanic_chimera', type: 'volcanic_chimera', Name: 'Volcanic Chimera', name: 'Volcanic Chimera', Color: '#dc2626', color: '#dc2626', Accent: '#f87171', accent: '#f87171', BaseHp: 17000, baseHp: 17000, HpPerFloor: 1550, hpPerFloor: 1550, Radius: 37, radius: 37, Title: 'Tri-headed subterranean beast erupting magma fountains and obsidian boulders', title: 'Tri-headed subterranean beast erupting magma fountains and obsidian boulders' },
    { Type: 'eternal_ouroboros', type: 'eternal_ouroboros', Name: 'The Eternal Ouroboros', name: 'The Eternal Ouroboros', Color: '#ffd166', color: '#ffd166', Accent: '#ffe49e', accent: '#ffe49e', BaseHp: 20000, baseHp: 20000, HpPerFloor: 1700, hpPerFloor: 1700, Radius: 40, radius: 40, Title: 'The celestial cycle of rebirth and destruction holding eternity together', title: 'The celestial cycle of rebirth and destruction holding eternity together' },
  ];
  public static readonly bosses = GameData.Bosses;

  public static BossForFloor(floor: number): BossArchetypeDef {
    const idx = Math.max(0, floor - 1) % GameData.Bosses.length;
    return GameData.Bosses[idx]!;
  }
  public static bossForFloor(floor: number): BossArchetypeDef {
    return GameData.BossForFloor(floor);
  }

  /** Tactical Socket Module catalog for Mutation Vivarium and Snake Lab. */
  public static readonly SocketModules: OrderedTable<SocketModuleDef> = GameData.buildSocketModules();
  public static readonly socketModules = GameData.SocketModules;

  private static buildSocketModules(): OrderedTable<SocketModuleDef> {
    const t = new OrderedTable<SocketModuleDef>();
    
    // --- 16 WEAPONS (8 Kinetic + 8 Elemental) ---
    // Kinetic Weapons
    t.Add('turret', { Key: 'turret', key: 'turret', Name: 'Attack Spitter', name: 'Attack Spitter', Icon: '🏹', icon: '🏹', Category: 'offense', category: 'offense', Desc: 'Fires kinetic dart missiles (14 dmg, 0.65s)', desc: 'Fires kinetic dart missiles (14 dmg, 0.65s)', UnlockCost: 0, unlockCost: 0 });
    t.Add('flak', { Key: 'flak', key: 'flak', Name: 'Railgun Flak Cannon', name: 'Railgun Flak Cannon', Icon: '💥', icon: '💥', Category: 'offense', category: 'offense', Desc: 'Fires high-velocity shrapnel shells that burst into 6 piercing pellets (24 dmg, 1.2s)', desc: 'Fires high-velocity shrapnel shells that burst into 6 piercing pellets (24 dmg, 1.2s)', UnlockCost: 200, unlockCost: 200, UnlockFloor: 2, unlockFloor: 2 });
    t.Add('scattershot', { Key: 'scattershot', key: 'scattershot', Name: 'Scattershot Blunderbuss', name: 'Scattershot Blunderbuss', Icon: '🔫', icon: '🔫', Category: 'offense', category: 'offense', Desc: 'Discharges a wide 5-pellet kinetic spread (16 dmg per pellet, 0.9s)', desc: 'Discharges a wide 5-pellet kinetic spread (16 dmg per pellet, 0.9s)', UnlockCost: 180, unlockCost: 180, UnlockFloor: 2, unlockFloor: 2 });
    t.Add('needler', { Key: 'needler', key: 'needler', Name: 'Seeker Needler', name: 'Seeker Needler', Icon: '🎯', icon: '🎯', Category: 'offense', category: 'offense', Desc: 'Fires homing micro-quills tracking nearest hostiles (12 dmg, 0.45s)', desc: 'Fires homing micro-quills tracking nearest hostiles (12 dmg, 0.45s)', UnlockCost: 220, unlockCost: 220, UnlockFloor: 3, unlockFloor: 3 });
    t.Add('mortar', { Key: 'mortar', key: 'mortar', Name: 'Cluster Mortar', name: 'Cluster Mortar', Icon: '💣', icon: '💣', Category: 'offense', category: 'offense', Desc: 'Lobs heavy explosive cluster bombs that fracture into 4 submunitions (32 AoE dmg)', desc: 'Lobs heavy explosive cluster bombs that fracture into 4 submunitions (32 AoE dmg)', UnlockCost: 260, unlockCost: 260, UnlockFloor: 3, unlockFloor: 3 });
    t.Add('sonic', { Key: 'sonic', key: 'sonic', Name: 'Sonic Prow Cannon', name: 'Sonic Prow Cannon', Icon: '🔊', icon: '🔊', Category: 'offense', category: 'offense', Desc: 'Emits a 90-degree concussive sonic wave that stuns and repels enemies (20 dmg, 1.5s)', desc: 'Emits a 90-degree concussive sonic wave that stuns and repels enemies (20 dmg, 1.5s)', UnlockCost: 280, unlockCost: 280, UnlockFloor: 3, unlockFloor: 3 });
    t.Add('gatling', { Key: 'gatling', key: 'gatling', Name: 'Rotary Minigun', name: 'Rotary Minigun', Icon: '⚙️', icon: '⚙️', Category: 'offense', category: 'offense', Desc: 'Rapid-fire kinetic rotary barrel accelerating up to 10 shots/sec (8 dmg)', desc: 'Rapid-fire kinetic rotary barrel accelerating up to 10 shots/sec (8 dmg)', UnlockCost: 300, unlockCost: 300, UnlockFloor: 4, unlockFloor: 4 });
    t.Add('caltrop', { Key: 'caltrop', key: 'caltrop', Name: 'Caltrop Dropper', name: 'Caltrop Dropper', Icon: '⛓️', icon: '⛓️', Category: 'offense', category: 'offense', Desc: 'Lays fields of jagged caltrops behind the serpent that puncture pursuing mobs (18 dmg + bleed)', desc: 'Lays fields of jagged caltrops behind the serpent that puncture pursuing mobs (18 dmg + bleed)', UnlockCost: 150, unlockCost: 150, UnlockFloor: 2, unlockFloor: 2 });

    // Elemental Weapons
    t.Add('tesla', { Key: 'tesla', key: 'tesla', Name: 'Bio-Arc Coil', name: 'Bio-Arc Coil', Icon: '⚡', icon: '⚡', Category: 'offense', category: 'offense', Desc: 'Arcs lightning to multiple targets (18 dmg, 1.3s)', desc: 'Arcs lightning to multiple targets (18 dmg, 1.3s)', UnlockCost: 0, unlockCost: 0 });
    t.Add('magma', { Key: 'magma', key: 'magma', Name: 'Magma Vent', name: 'Magma Vent', Icon: '🔥', icon: '🔥', Category: 'offense', category: 'offense', Desc: 'Drops magma pools (15 DPS, 2.5s)', desc: 'Drops magma pools (15 DPS, 2.5s)', UnlockCost: 0, unlockCost: 0 });
    t.Add('cryo', { Key: 'cryo', key: 'cryo', Name: 'Cryo Mortar', name: 'Cryo Mortar', Icon: '❄️', icon: '❄️', Category: 'offense', category: 'offense', Desc: 'Lobbed cryo shells that burst in chilling frost (18 dmg + slow)', desc: 'Lobbed cryo shells that burst in chilling frost (18 dmg + slow)', UnlockCost: 320, unlockCost: 320, UnlockFloor: 2, unlockFloor: 2 });
    t.Add('venom', { Key: 'venom', key: 'venom', Name: 'Venom Sprayer', name: 'Venom Sprayer', Icon: '☣️', icon: '☣️', Category: 'offense', category: 'offense', Desc: 'Sprays virulent poison cloud (12 DPS)', desc: 'Sprays virulent poison cloud (12 DPS)', UnlockCost: 0, unlockCost: 0 });
    t.Add('tachyon', { Key: 'tachyon', key: 'tachyon', Name: 'Tachyon Laser', name: 'Tachyon Laser', Icon: '🔬', icon: '🔬', Category: 'offense', category: 'offense', Desc: 'Piercing coherent energy laser (22 dmg line)', desc: 'Piercing coherent energy laser (22 dmg line)', UnlockCost: 250, unlockCost: 250, UnlockFloor: 3, unlockFloor: 3 });
    t.Add('plasma', { Key: 'plasma', key: 'plasma', Name: 'Plasma Arc Cannon', name: 'Plasma Arc Cannon', Icon: '💥', icon: '💥', Category: 'offense', category: 'offense', Desc: 'Heavy long-range explosive plasma cannon (36 AoE dmg)', desc: 'Heavy long-range explosive plasma cannon (36 AoE dmg)', UnlockCost: 380, unlockCost: 380, UnlockFloor: 4, unlockFloor: 4 });
    t.Add('singularity', { Key: 'singularity', key: 'singularity', Name: 'Singularity Vortex Gun', name: 'Singularity Vortex Gun', Icon: '🌀', icon: '🌀', Category: 'offense', category: 'offense', Desc: 'Fires a micro-black hole that pulls in enemies and implodes (48 AoE dmg)', desc: 'Fires a micro-black hole that pulls in enemies and implodes (48 AoE dmg)', UnlockCost: 420, unlockCost: 420, UnlockFloor: 5, unlockFloor: 5 });
    t.Add('solar', { Key: 'solar', key: 'solar', Name: 'Solar Flare Mortar', name: 'Solar Flare Mortar', Icon: '☀️', icon: '☀️', Category: 'offense', category: 'offense', Desc: 'Unleashes blinding solar radiation that cooks food and scorches surrounding foes (30 dmg)', desc: 'Unleashes blinding solar radiation that cooks food and scorches surrounding foes (30 dmg)', UnlockCost: 350, unlockCost: 350, UnlockFloor: 4, unlockFloor: 4 });

    // --- 12 DEFENSIVE SYSTEMS ---
    t.Add('shield', { Key: 'shield', key: 'shield', Name: 'Carapace Shield', name: 'Carapace Shield', Icon: '🛡️', icon: '🛡️', Category: 'defense', category: 'defense', Desc: 'Absorbs 25 damage; recharges after 6s', desc: 'Absorbs 25 damage; recharges after 6s', UnlockCost: 0, unlockCost: 0 });
    t.Add('spikes', { Key: 'spikes', key: 'spikes', Name: 'Thorny Spine Armor', name: 'Thorny Spine Armor', Icon: '🦔', icon: '🦔', Category: 'defense', category: 'defense', Desc: '+20 contact thorns, +4% armor', desc: '+20 contact thorns, +4% armor', UnlockCost: 0, unlockCost: 0 });
    t.Add('regen', { Key: 'regen', key: 'regen', Name: 'Regen Gland', name: 'Regen Gland', Icon: '🧪', icon: '🧪', Category: 'defense', category: 'defense', Desc: 'Heals +1 HP every 3.5s', desc: 'Heals +1 HP every 3.5s', UnlockCost: 0, unlockCost: 0 });
    t.Add('magnet', { Key: 'magnet', key: 'magnet', Name: 'Bio-Magnet', name: 'Bio-Magnet', Icon: '🧲', icon: '🧲', Category: 'defense', category: 'defense', Desc: 'Extends food/shard pull radius by +60px', desc: 'Extends food/shard pull radius by +60px', UnlockCost: 0, unlockCost: 0 });
    t.Add('chrono', { Key: 'chrono', key: 'chrono', Name: 'Chrono Ward', name: 'Chrono Ward', Icon: '⏳', icon: '⏳', Category: 'defense', category: 'defense', Desc: 'Time dilation aura slowing hostile projectiles and +i-frames on hurt', desc: 'Time dilation aura slowing hostile projectiles and +i-frames on hurt', UnlockCost: 400, unlockCost: 400, UnlockFloor: 4, unlockFloor: 4 });
    t.Add('nanite', { Key: 'nanite', key: 'nanite', Name: 'Nanite Swarm', name: 'Nanite Swarm', Icon: '🧬', icon: '🧬', Category: 'defense', category: 'defense', Desc: 'Orbiting repair micro-drones that intercept projectiles and mend HP', desc: 'Orbiting repair micro-drones that intercept projectiles and mend HP', UnlockCost: 450, unlockCost: 450, UnlockFloor: 5, unlockFloor: 5 });
    t.Add('reactive', { Key: 'reactive', key: 'reactive', Name: 'Reactive Blast Plating', name: 'Reactive Blast Plating', Icon: '💥', icon: '💥', Category: 'defense', category: 'defense', Desc: 'When taking damage, triggers an immediate 35 dmg kinetic burst knocking back attackers', desc: 'When taking damage, triggers an immediate 35 dmg kinetic burst knocking back attackers', UnlockCost: 240, unlockCost: 240, UnlockFloor: 2, unlockFloor: 2 });
    t.Add('magnetic_aegis', { Key: 'magnetic_aegis', key: 'magnetic_aegis', Name: 'Magnetic Aegis', name: 'Magnetic Aegis', Icon: '🧲🛡️', icon: '🧲🛡️', Category: 'defense', category: 'defense', Desc: 'Converts absorbed kinetic projectile damage directly into nutrient shards', desc: 'Converts absorbed kinetic projectile damage directly into nutrient shards', UnlockCost: 310, unlockCost: 310, UnlockFloor: 3, unlockFloor: 3 });
    t.Add('cryo_carapace', { Key: 'cryo_carapace', key: 'cryo_carapace', Name: 'Cryo Frost Carapace', name: 'Cryo Frost Carapace', Icon: '❄️🛡️', icon: '❄️🛡️', Category: 'defense', category: 'defense', Desc: 'Chills all nearby attackers by 40% and grants +15 segment max HP', desc: 'Chills all nearby attackers by 40% and grants +15 segment max HP', UnlockCost: 280, unlockCost: 280, UnlockFloor: 3, unlockFloor: 3 });
    t.Add('heatsink', { Key: 'heatsink', key: 'heatsink', Name: 'Volcanic Heat Sink', name: 'Volcanic Heat Sink', Icon: '🌋', icon: '🌋', Category: 'defense', category: 'defense', Desc: 'Stores thermal energy to vent a 25 DPS burning field around the body when surrounded', desc: 'Stores thermal energy to vent a 25 DPS burning field around the body when surrounded', UnlockCost: 290, unlockCost: 290, UnlockFloor: 3, unlockFloor: 3 });
    t.Add('cloak', { Key: 'cloak', key: 'cloak', Name: 'Phase Cloak Emitter', name: 'Phase Cloak Emitter', Icon: '👤', icon: '👤', Category: 'defense', category: 'defense', Desc: 'Provides passive 15% dodge chance and 0.8s phasing cloak upon taking critical damage', desc: 'Provides passive 15% dodge chance and 0.8s phasing cloak upon taking critical damage', UnlockCost: 360, unlockCost: 360, UnlockFloor: 4, unlockFloor: 4 });
    t.Add('emp_coil', { Key: 'emp_coil', key: 'emp_coil', Name: 'EMP Discharge Coil', name: 'EMP Discharge Coil', Icon: '⚡🛡️', icon: '⚡🛡️', Category: 'defense', category: 'defense', Desc: 'Periodically releases an EMP shockwave neutralizing enemy bullets and stunning mobs for 1.2s', desc: 'Periodically releases an EMP shockwave neutralizing enemy bullets and stunning mobs for 1.2s', UnlockCost: 390, unlockCost: 390, UnlockFloor: 4, unlockFloor: 4 });

    return t;
  }

  /** Port of FOOD_TYPES. */
  public static readonly Foods: OrderedTable<FoodTypeDef> = GameData.buildFoods();
  public static readonly foods = GameData.Foods;

  private static buildFoods(): OrderedTable<FoodTypeDef> {
    const t = new OrderedTable<FoodTypeDef>();
    t.Add('apple', { Key: 'apple', key: 'apple', Color: '#10b981', color: '#10b981', Glyph: '🍏', glyph: '🍏', Xp: 1, xp: 1, Score: 100, score: 100, Radius: 9, radius: 9, Heal: 0, heal: 0 });
    t.Add('golden', { Key: 'golden', key: 'golden', Color: '#ffb703', color: '#ffb703', Glyph: '🌟', glyph: '🌟', Xp: 4, xp: 4, Score: 300, score: 300, Radius: 11, radius: 11, Heal: 0, heal: 0 });
    t.Add('potion', { Key: 'potion', key: 'potion', Color: '#ff3366', color: '#ff3366', Glyph: '❤️', glyph: '❤️', Xp: 2, xp: 2, Score: 100, score: 100, Radius: 10, radius: 10, Heal: 36, heal: 36 });
    t.Add('shield', { Key: 'shield', key: 'shield', Color: '#3a86ff', color: '#3a86ff', Glyph: '💠', glyph: '💠', Xp: 2, xp: 2, Score: 150, score: 150, Radius: 10, radius: 10, Heal: 0, heal: 0 });
    t.Add('bomb', { Key: 'bomb', key: 'bomb', Color: '#ff5400', color: '#ff5400', Glyph: '💣', glyph: '💣', Xp: 3, xp: 3, Score: 200, score: 200, Radius: 10, radius: 10, Heal: 0, heal: 0 });
    t.Add('chrono', { Key: 'chrono', key: 'chrono', Color: '#00f0b5', color: '#00f0b5', Glyph: '⏱️', glyph: '⏱️', Xp: 3, xp: 3, Score: 150, score: 150, Radius: 10, radius: 10, Heal: 0, heal: 0 });
    t.Add('shard', { Key: 'shard', key: 'shard', Name: 'Cosmic Star', name: 'Cosmic Star', Color: '#ffd166', color: '#ffd166', Glyph: '⭐', glyph: '⭐', Xp: 4, xp: 4, Score: 250, score: 250, Radius: 9, radius: 9, Heal: 0, heal: 0 });
    t.Add('soul', { Key: 'soul', key: 'soul', Color: '#c77dff', color: '#c77dff', Glyph: '👻', glyph: '👻', Xp: 5, xp: 5, Score: 120, score: 120, Radius: 8, radius: 8, Heal: 0, heal: 0 });
    t.Add('prism', { Key: 'prism', key: 'prism', Color: '#ffffff', color: '#ffffff', Glyph: '🔮', glyph: '🔮', Xp: 15, xp: 15, Score: 500, score: 500, Radius: 13, radius: 13, Heal: 25, heal: 25 });
    return t;
  }

  /** Port of COMBO_TIERS — descending by `At`; the first match wins. */
  public static readonly ComboTiers: readonly ComboTierDef[] = [
    { At: 40, at: 40, Mult: 8, mult: 8 },
    { At: 30, at: 30, Mult: 6, mult: 6 },
    { At: 22, at: 22, Mult: 5, mult: 5 },
    { At: 14, at: 14, Mult: 4, mult: 4 },
    { At: 8, at: 8, Mult: 3, mult: 3 },
    { At: 3, at: 3, Mult: 2, mult: 2 },
  ];
  public static readonly comboTiers = GameData.ComboTiers;

  /** Port of GAME_MODES. */
  public static readonly Modes: OrderedTable<GameModeDef> = GameData.buildModes();
  public static readonly modes = GameData.Modes;

  private static buildModes(): OrderedTable<GameModeDef> {
    const t = new OrderedTable<GameModeDef>();
    t.Add('rogue', { Key: 'rogue', key: 'rogue', Label: 'Rogue Galaxy', label: 'Rogue Galaxy', Floors: 10, floors: 10, BossRush: false, bossRush: false, Seeded: false, seeded: false });
    t.Add('endless', { Key: 'endless', key: 'endless', Label: 'Endless Frenzy', label: 'Endless Frenzy', Floors: Number.POSITIVE_INFINITY, floors: Number.POSITIVE_INFINITY, BossRush: false, bossRush: false, Seeded: false, seeded: false });
    t.Add('bossrush', { Key: 'bossrush', key: 'bossrush', Label: 'Boss Rush', label: 'Boss Rush', Floors: 20, floors: 20, BossRush: true, bossRush: true, Seeded: false, seeded: false });
    t.Add('daily', { Key: 'daily', key: 'daily', Label: 'Daily Challenge', label: 'Daily Challenge', Floors: 20, floors: 20, BossRush: false, bossRush: false, Seeded: true, seeded: true });
    return t;
  }

  /** Port of MetaProgression.upgrades — the Sanctuary shop table. */
  public static readonly MetaUpgrades: OrderedTable<MetaUpgradeDef> = GameData.buildMetaUpgrades();
  public static readonly metaUpgrades = GameData.MetaUpgrades;

  private static buildMetaUpgrades(): OrderedTable<MetaUpgradeDef> {
    const t = new OrderedTable<MetaUpgradeDef>();
    // Core Blessings
    t.Add('vitality', { Key: 'vitality', key: 'vitality', Name: 'Vitality Essence', name: 'Vitality Essence', Icon: '❤️', icon: '❤️', MaxLevel: 6, maxLevel: 6, BaseCost: 40, baseCost: 40, CostMult: 1.6, costMult: 1.6, Bonus: '+10 starting Max HP', bonus: '+10 starting Max HP', Effect: 10, effect: 10 });
    t.Add('agility', { Key: 'agility', key: 'agility', Name: 'Agility Rune', name: 'Agility Rune', Icon: '💨', icon: '💨', MaxLevel: 5, maxLevel: 5, BaseCost: 55, baseCost: 55, CostMult: 1.7, costMult: 1.7, Bonus: '+4% starting Speed', bonus: '+4% starting Speed', Effect: 0.04, effect: 0.04 });
    t.Add('ferocity', { Key: 'ferocity', key: 'ferocity', Name: 'Feral Instinct', name: 'Feral Instinct', Icon: '🦷', icon: '🦷', MaxLevel: 5, maxLevel: 5, BaseCost: 60, baseCost: 60, CostMult: 1.7, costMult: 1.7, Bonus: '+6% starting Bite Power', bonus: '+6% starting Bite Power', Effect: 0.06, effect: 0.06 });
    t.Add('resilience', { Key: 'resilience', key: 'resilience', Name: 'Stonehide', name: 'Stonehide', Icon: '🛡️', icon: '🛡️', MaxLevel: 5, maxLevel: 5, BaseCost: 70, baseCost: 70, CostMult: 1.75, costMult: 1.75, Bonus: '+3% Damage Reduction', bonus: '+3% Damage Reduction', Effect: 0.03, effect: 0.03 });
    t.Add('magnet', { Key: 'magnet', key: 'magnet', Name: 'Magnetic Attunement', name: 'Magnetic Attunement', Icon: '🧲', icon: '🧲', MaxLevel: 5, maxLevel: 5, BaseCost: 35, baseCost: 35, CostMult: 1.5, costMult: 1.5, Bonus: '+15% Magnet Range', bonus: '+15% Magnet Range', Effect: 0.15, effect: 0.15 });
    t.Add('swiftness', { Key: 'swiftness', key: 'swiftness', Name: 'Quickened Sinew', name: 'Quickened Sinew', Icon: '⚡', icon: '⚡', MaxLevel: 4, maxLevel: 4, BaseCost: 75, baseCost: 75, CostMult: 1.8, costMult: 1.8, Bonus: '-0.15s Dash Cooldown', bonus: '-0.15s Dash Cooldown', Effect: 0.15, effect: 0.15 });
    t.Add('rerolls', { Key: 'rerolls', key: 'rerolls', Name: "Fate's Fortune", name: "Fate's Fortune", Icon: '🎲', icon: '🎲', MaxLevel: 3, maxLevel: 3, BaseCost: 90, baseCost: 90, CostMult: 2, costMult: 2, Bonus: '+1 draft re-roll per run', bonus: '+1 draft re-roll per run', Effect: 1, effect: 1 });
    t.Add('fortune', { Key: 'fortune', key: 'fortune', Name: 'Gilded Fate', name: 'Gilded Fate', Icon: '🍀', icon: '🍀', MaxLevel: 3, maxLevel: 3, BaseCost: 120, baseCost: 120, CostMult: 2.1, costMult: 2.1, Bonus: 'Better draft rarity odds', bonus: 'Better draft rarity odds', Effect: 1, effect: 1 });
    t.Add('greed', { Key: 'greed', key: 'greed', Name: 'Star Harvest', name: 'Star Harvest', Icon: '⭐', icon: '⭐', MaxLevel: 5, maxLevel: 5, BaseCost: 45, baseCost: 45, CostMult: 1.6, costMult: 1.6, Bonus: '+15% Stars earned', bonus: '+15% Stars earned', Effect: 0.15, effect: 0.15 });

    // Socket Weapon Blueprints
    t.Add('unlock_tachyon', { Key: 'unlock_tachyon', key: 'unlock_tachyon', Name: 'Tachyon Laser Blueprint', name: 'Tachyon Laser Blueprint', Icon: '🔬', icon: '🔬', MaxLevel: 1, maxLevel: 1, BaseCost: 250, baseCost: 250, CostMult: 1, costMult: 1, Bonus: 'Unlocks Tachyon Laser offensive weapon in Lab', bonus: 'Unlocks Tachyon Laser offensive weapon in Lab', Effect: 1, effect: 1 });
    t.Add('unlock_cryo', { Key: 'unlock_cryo', key: 'unlock_cryo', Name: 'Cryo Mortar Blueprint', name: 'Cryo Mortar Blueprint', Icon: '❄️', icon: '❄️', MaxLevel: 1, maxLevel: 1, BaseCost: 320, baseCost: 320, CostMult: 1, costMult: 1, Bonus: 'Unlocks Cryo Mortar offensive weapon in Lab', bonus: 'Unlocks Cryo Mortar offensive weapon in Lab', Effect: 1, effect: 1 });
    t.Add('unlock_plasma', { Key: 'unlock_plasma', key: 'unlock_plasma', Name: 'Plasma Arc Cannon Blueprint', name: 'Plasma Arc Cannon Blueprint', Icon: '💥', icon: '💥', MaxLevel: 1, maxLevel: 1, BaseCost: 380, baseCost: 380, CostMult: 1, costMult: 1, Bonus: 'Unlocks Plasma Arc Cannon offensive weapon in Lab', bonus: 'Unlocks Plasma Arc Cannon offensive weapon in Lab', Effect: 1, effect: 1 });
    t.Add('unlock_chrono', { Key: 'unlock_chrono', key: 'unlock_chrono', Name: 'Chrono Ward Blueprint', name: 'Chrono Ward Blueprint', Icon: '⏳', icon: '⏳', MaxLevel: 1, maxLevel: 1, BaseCost: 400, baseCost: 400, CostMult: 1, costMult: 1, Bonus: 'Unlocks Chrono Ward defensive bio-organ in Lab', bonus: 'Unlocks Chrono Ward defensive bio-organ in Lab', Effect: 1, effect: 1 });
    t.Add('unlock_nanite', { Key: 'unlock_nanite', key: 'unlock_nanite', Name: 'Nanite Swarm Blueprint', name: 'Nanite Swarm Blueprint', Icon: '🧬', icon: '🧬', MaxLevel: 1, maxLevel: 1, BaseCost: 450, baseCost: 450, CostMult: 1, costMult: 1, Bonus: 'Unlocks Nanite Swarm defensive bio-organ in Lab', bonus: 'Unlocks Nanite Swarm defensive bio-organ in Lab', Effect: 1, effect: 1 });

    return t;
  }

  public static readonly MetaStorageKey = 'ouroboros_meta_v2';
  public static readonly metaStorageKey = GameData.MetaStorageKey;

  public static readonly LegacyStorageKey = 'ouroboros_meta_v1';
  public static readonly legacyStorageKey = GameData.LegacyStorageKey;

  /** Port of BITE_INTERVAL (js/combat.js): minimum seconds between two bites on the SAME target. */
  public static readonly BiteInterval = 0.28;
  public static readonly biteInterval = GameData.BiteInterval;

  /** The Master 28-Synergy Alchemical Cross-Module Fusions Table. */
  public static readonly AlchemicalFusions: readonly AlchemicalFusionDef[] = [
    { Id: 'superconductor', id: 'superconductor', Name: 'Superconductor Surge', name: 'Superconductor Surge', Icon: '⚡❄️', icon: '⚡❄️', ModuleA: 'tesla', moduleA: 'tesla', ModuleB: 'cryo', moduleB: 'cryo', Desc: 'Shocking chilled enemies shatters ice into piercing shards with +50% arc jump damage.', desc: 'Shocking chilled enemies shatters ice into piercing shards with +50% arc jump damage.' },
    { Id: 'obsidian', id: 'obsidian', Name: 'Obsidian Armor', name: 'Obsidian Armor', Icon: '🌋🛡️', icon: '🌋🛡️', ModuleA: 'magma', moduleA: 'magma', ModuleB: 'spikes', moduleB: 'spikes', Desc: 'Enemy collision triggers volcanic eruption (45 AoE dmg) and hardens segment with +15% armor.', desc: 'Enemy collision triggers volcanic eruption (45 AoE dmg) and hardens segment with +15% armor.' },
    { Id: 'miasma', id: 'miasma', Name: 'Miasma Combustion', name: 'Miasma Combustion', Icon: '🧪🔥', icon: '🧪🔥', ModuleA: 'venom', moduleA: 'venom', ModuleB: 'magma', moduleB: 'magma', Desc: 'Poisoned enemies touching magma erupt into cascading chemical fireballs (60 dmg AoE).', desc: 'Poisoned enemies touching magma erupt into cascading chemical fireballs (60 dmg AoE).' },
    { Id: 'prismatic', id: 'prismatic', Name: 'Prismatic Aegis', name: 'Prismatic Aegis', Icon: '🛡️🔴', icon: '🛡️🔴', ModuleA: 'tachyon', moduleA: 'tachyon', ModuleB: 'shield', moduleB: 'shield', Desc: 'Carapace Shield break triggers an 8-way radial Tachyon laser burst (25 dmg each).', desc: 'Carapace Shield break triggers an 8-way radial Tachyon laser burst (25 dmg each).' },
    { Id: 'temporal_singularity', id: 'temporal_singularity', Name: 'Temporal Singularity', name: 'Temporal Singularity', Icon: '⏳⚡', icon: '⏳⚡', ModuleA: 'chrono', moduleA: 'chrono', ModuleB: 'nanite', moduleB: 'nanite', Desc: 'Nanite repair runs at 3x speed in Chrono bubbles; micro-drones convert enemy bullets into healing.', desc: 'Nanite repair runs at 3x speed in Chrono bubbles; micro-drones convert enemy bullets into healing.' },
    { Id: 'railgun_flak', id: 'railgun_flak', Name: 'Railgun Flak Battery', name: 'Railgun Flak Battery', Icon: '🔫⚡', icon: '🔫⚡', ModuleA: 'turret', moduleA: 'turret', ModuleB: 'tesla', moduleB: 'tesla', Desc: 'Turret darts become electrified piercing slugs that leave conductive lightning tethers.', desc: 'Turret darts become electrified piercing slugs that leave conductive lightning tethers.' },
    { Id: 'glacial_rot', id: 'glacial_rot', Name: 'Glacial Rot', name: 'Glacial Rot', Icon: '❄️🧪', icon: '❄️🧪', ModuleA: 'cryo', moduleA: 'cryo', ModuleB: 'venom', moduleB: 'venom', Desc: 'Frozen enemies suffer +100% poison DoT ticks; death leaves an icy toxic sludge puddle.', desc: 'Frozen enemies suffer +100% poison DoT ticks; death leaves an icy toxic sludge puddle.' },
    { Id: 'thermobaric_mortar', id: 'thermobaric_mortar', Name: 'Thermobaric Mortar', name: 'Thermobaric Mortar', Icon: '🌋🔫', icon: '🌋🔫', ModuleA: 'magma', moduleA: 'magma', ModuleB: 'turret', moduleB: 'turret', Desc: 'Turret launches explosive incendiary shells (40 dmg, 80px AoE) that ignite the arena.', desc: 'Turret launches explosive incendiary shells (40 dmg, 80px AoE) that ignite the arena.' },
    { Id: 'event_horizon', id: 'event_horizon', Name: 'Event Horizon Web', name: 'Event Horizon Web', Icon: '⏳⚡', icon: '⏳⚡', ModuleA: 'chrono', moduleA: 'chrono', ModuleB: 'tesla', moduleB: 'tesla', Desc: 'Bio-Arc lightning traps enemies in localized stasis fields for 1.8s, slowing them by 75%.', desc: 'Bio-Arc lightning traps enemies in localized stasis fields for 1.8s, slowing them by 75%.' },
    { Id: 'biosteel_quill', id: 'biosteel_quill', Name: 'Biosteel Quill Burst', name: 'Biosteel Quill Burst', Icon: '🛡️🔫', icon: '🛡️🔫', ModuleA: 'spikes', moduleA: 'spikes', ModuleB: 'turret', moduleB: 'turret', Desc: 'Body collision fires a 12-way kinetic quill barrage (22 dmg) with +30% knockback.', desc: 'Body collision fires a 12-way kinetic quill barrage (22 dmg) with +30% knockback.' },
    { Id: 'tachyon_overcharge', id: 'tachyon_overcharge', Name: 'Tachyon Overcharge', name: 'Tachyon Overcharge', Icon: '🔴⚡', icon: '🔴⚡', ModuleA: 'tachyon', moduleA: 'tachyon', ModuleB: 'tesla', moduleB: 'tesla', Desc: 'Tachyon Laser beam splits into 3 branching lightning lasers upon striking the first target.', desc: 'Tachyon Laser beam splits into 3 branching lightning lasers upon striking the first target.' },
    { Id: 'sublimation_shock', id: 'sublimation_shock', Name: 'Sublimation Shock', name: 'Sublimation Shock', Icon: '❄️🌋', icon: '❄️🌋', ModuleA: 'cryo', moduleA: 'cryo', ModuleB: 'magma', moduleB: 'magma', Desc: 'Applying Magma to Frozen foes triggers thermal shock (85 true damage, bypassing armor).', desc: 'Applying Magma to Frozen foes triggers thermal shock (85 true damage, bypassing armor).' },
    { Id: 'corrosive_needle', id: 'corrosive_needle', Name: 'Corrosive Needle Carapace', name: 'Corrosive Needle Carapace', Icon: '🧪🛡️', icon: '🧪🛡️', ModuleA: 'venom', moduleA: 'venom', ModuleB: 'spikes', moduleB: 'spikes', Desc: 'Contact thorns inject neurotoxin stacks, reducing enemy armor by 10% per hit.', desc: 'Contact thorns inject neurotoxin stacks, reducing enemy armor by 10% per hit.' },
    { Id: 'photon_mirror', id: 'photon_mirror', Name: 'Photon Mirror Barricade', name: 'Photon Mirror Barricade', Icon: '🔴🛡️', icon: '🔴🛡️', ModuleA: 'tachyon', moduleA: 'tachyon', ModuleB: 'spikes', moduleB: 'spikes', Desc: 'Physical collision creates a hard-light barrier that reflects hostile projectiles at 200% dmg.', desc: 'Physical collision creates a hard-light barrier that reflects hostile projectiles at 200% dmg.' },
    { Id: 'nanite_plague', id: 'nanite_plague', Name: 'Nanite Plague Vector', name: 'Nanite Plague Vector', Icon: '🦾🧪', icon: '🦾🧪', ModuleA: 'nanite', moduleA: 'nanite', ModuleB: 'venom', moduleB: 'venom', Desc: 'Nanite drones infect enemies; host death spawns 2 autonomous micro-nanites for 8s.', desc: 'Nanite drones infect enemies; host death spawns 2 autonomous micro-nanites for 8s.' },
    { Id: 'kinetic_bastion', id: 'kinetic_bastion', Name: 'Kinetic Bastion Discharge', name: 'Kinetic Bastion Discharge', Icon: '🛡️💥', icon: '🛡️💥', ModuleA: 'shield', moduleA: 'shield', ModuleB: 'spikes', moduleB: 'spikes', Desc: 'Absorbing damage charges a capacitor; on full shield regen, releases a 70 dmg shockwave.', desc: 'Absorbing damage charges a capacitor; on full shield regen, releases a 70 dmg shockwave.' },
    { Id: 'entropic_miasma', id: 'entropic_miasma', Name: 'Entropic Miasma', name: 'Entropic Miasma', Icon: '⏳🧪', icon: '⏳🧪', ModuleA: 'chrono', moduleA: 'chrono', ModuleB: 'venom', moduleB: 'venom', Desc: 'Time dilation doubles the tick rate of all active poison debuffs.', desc: 'Time dilation doubles the tick rate of all active poison debuffs.' },
    { Id: 'cryo_barrier', id: 'cryo_barrier', Name: 'Cryo-Barrier Reflection', name: 'Cryo-Barrier Reflection', Icon: '❄️🛡️', icon: '❄️🛡️', ModuleA: 'cryo', moduleA: 'cryo', ModuleB: 'shield', moduleB: 'shield', Desc: 'Shield projects a frost ward chilling nearby projectiles by 50% and freezing on hit.', desc: 'Shield projects a frost ward chilling nearby projectiles by 50% and freezing on hit.' },
    { Id: 'volcanic_bulwark', id: 'volcanic_bulwark', Name: 'Volcanic Bulwark', name: 'Volcanic Bulwark', Icon: '🌋🛡️', icon: '🌋🛡️', ModuleA: 'magma', moduleA: 'magma', ModuleB: 'shield', moduleB: 'shield', Desc: 'While shield is active, radiates a permanent 12 DPS heat aura; shield break sprays magma.', desc: 'While shield is active, radiates a permanent 12 DPS heat aura; shield break sprays magma.' },
    { Id: 'auto_fabricator', id: 'auto_fabricator', Name: 'Auto-Fabricator Turrets', name: 'Auto-Fabricator Turrets', Icon: '🦾🔫', icon: '🦾🔫', ModuleA: 'nanite', moduleA: 'nanite', ModuleB: 'turret', moduleB: 'turret', Desc: 'Nanite drones build stationary micro-turrets on the arena floor (lasting 12s, 8 dmg).', desc: 'Nanite drones build stationary micro-turrets on the arena floor (lasting 12s, 8 dmg).' },
    { Id: 'tachyon_stutter', id: 'tachyon_stutter', Name: 'Tachyon Stutter Beam', name: 'Tachyon Stutter Beam', Icon: '🔴⏳', icon: '🔴⏳', ModuleA: 'tachyon', moduleA: 'tachyon', ModuleB: 'chrono', moduleB: 'chrono', Desc: 'Tachyon Laser freezes enemies inside beam line for 1.0s while ticking 28 dmg every 0.2s.', desc: 'Tachyon Laser freezes enemies inside beam line for 1.0s while ticking 28 dmg every 0.2s.' },
    { Id: 'absolute_zero', id: 'absolute_zero', Name: 'Absolute Zero Stasis', name: 'Absolute Zero Stasis', Icon: '❄️⏳', icon: '❄️⏳', ModuleA: 'cryo', moduleA: 'cryo', ModuleB: 'chrono', moduleB: 'chrono', Desc: 'Freezes non-boss enemies in solid ice blocks for 3.5s (+50% damage taken).', desc: 'Freezes non-boss enemies in solid ice blocks for 3.5s (+50% damage taken).' },
    { Id: 'electrified_hull', id: 'electrified_hull', Name: 'Electrified Hull', name: 'Electrified Hull', Icon: '⚡🛡️', icon: '⚡🛡️', ModuleA: 'tesla', moduleA: 'tesla', ModuleB: 'shield', moduleB: 'shield', Desc: 'When shield takes damage, discharges a 24 dmg chain lightning bolt to 4 nearby hostiles.', desc: 'When shield takes damage, discharges a 24 dmg chain lightning bolt to 4 nearby hostiles.' },
    { Id: 'pyro_nanite', id: 'pyro_nanite', Name: 'Pyro-Nanite Swarm', name: 'Pyro-Nanite Swarm', Icon: '🌋🦾', icon: '🌋🦾', ModuleA: 'magma', moduleA: 'magma', ModuleB: 'nanite', moduleB: 'nanite', Desc: 'Nanite drones ignite into flaming suicide firebugs divebombing elites for 55 fire AoE dmg.', desc: 'Nanite drones ignite into flaming suicide firebugs divebombing elites for 55 fire AoE dmg.' },
    { Id: 'thermal_ray', id: 'thermal_ray', Name: 'Thermal Ray Needle', name: 'Thermal Ray Needle', Icon: '🔴🌋', icon: '🔴🌋', ModuleA: 'tachyon', moduleA: 'tachyon', ModuleB: 'magma', moduleB: 'magma', Desc: 'Tachyon Laser leaves molten magma lines along its path that burn for 22 DPS for 4 seconds.', desc: 'Tachyon Laser leaves molten magma lines along its path that burn for 22 DPS for 4 seconds.' },
    { Id: 'tesla_nanite', id: 'tesla_nanite', Name: 'Tesla Nanite Cloud', name: 'Tesla Nanite Cloud', Icon: '🦾⚡', icon: '🦾⚡', ModuleA: 'nanite', moduleA: 'nanite', ModuleB: 'tesla', moduleB: 'tesla', Desc: 'Nanite repair drones emit an electrical field shocking enemies within 80px for 14 dmg.', desc: 'Nanite repair drones emit an electrical field shocking enemies within 80px for 14 dmg.' },
    { Id: 'cryo_tachyon', id: 'cryo_tachyon', Name: 'Cryo-Tachyon Lance', name: 'Cryo-Tachyon Lance', Icon: '❄️🔴', icon: '❄️🔴', ModuleA: 'cryo', moduleA: 'cryo', ModuleB: 'tachyon', moduleB: 'tachyon', Desc: 'Tachyon beam transforms into a sub-zero lance (38 dmg) that leaves a chilling frost path.', desc: 'Tachyon beam transforms into a sub-zero lance (38 dmg) that leaves a chilling frost path.' },
    { Id: 'chrono_accelerator', id: 'chrono_accelerator', Name: 'Chrono Dart Accelerator', name: 'Chrono Dart Accelerator', Icon: '⏳🔫', icon: '⏳🔫', ModuleA: 'chrono', moduleA: 'chrono', ModuleB: 'turret', moduleB: 'turret', Desc: 'Turret darts fired through Chrono Ward accelerate to 300% velocity and deal +40% damage.', desc: 'Turret darts fired through Chrono Ward accelerate to 300% velocity and deal +40% damage.' }
  ];
  public static readonly alchemicalFusions = GameData.AlchemicalFusions;
}
