import { Rng } from '../core/Rng';
import { HelmetDef, HelmetRarity, HelmetStats } from './Types';

export type { HelmetDef, HelmetRarity, HelmetStats };

export const HELMET_RARITY_COLORS: Record<HelmetRarity, string> = {
  common: '#94a3b8',     // Slate silver
  uncommon: '#10b981',   // Emerald green
  rare: '#38bdf8',       // Cyan blue
  epic: '#a855f7',       // Astral purple
  legendary: '#ff7700',  // Blazing orange
  mythic: '#ffd166',     // Celestial gold
};

export const HELMET_RARITY_BADGES: Record<HelmetRarity, string> = {
  common: 'COMMON',
  uncommon: 'UNCOMMON',
  rare: 'RARE',
  epic: 'EPIC',
  legendary: 'LEGENDARY',
  mythic: 'MYTHIC',
};

const HELMET_PREFIXES: Record<string, string[]> = {
  centipede: ['Chitinous', 'Myriapod', 'Carapace', 'Swarmling', 'Centipede', 'Segmented'],
  gorgon: ['Storm', 'Volt', 'Tempest', 'Galvanic', 'Fulgar', 'Gorgon'],
  colossus: ['Infernal', 'Magmatic', 'Titan', 'Obsidian', 'Furnace', 'Smoldering'],
  frostwyrm: ['Glacial', 'Permafrost', 'Blizzard', 'Rime', 'Cryo', 'Frostwyrm'],
  chronowyrm: ['Temporal', 'Chrono', 'Paradox', 'Aeon', 'Continuum', 'Chronowyrm'],
  hivemind: ['Virulent', 'Bio-Venom', 'Brood', 'Spore', 'Chitin', 'Hivemind'],
  superconductor_boss: ['Dynamo', 'Electromagnetic', 'Superconductor', 'Arc', 'Tesla'],
  leviathan: ['Astral', 'Abyssal', 'Cosmic', 'Void', 'Leviathan', 'Singularity'],
  quantum_hydra: ['Quantum', 'Multiverse', 'Hydra', 'Probabilistic', 'Entangled', 'Split'],
  mirror_wyrm: ['Mirrored', 'Doppelgänger', 'Shadow', 'Reflective', 'Phantom', 'Echo'],
  void_devourer: ['Void', 'Devouring', 'Abyssal', 'Graviton', 'Blackhole', 'Singularity'],
  orbital_dreadnought: ['Orbital', 'Dreadnought', 'Magnetic', 'Ballistic', 'Fortress', 'Aegis'],
  iron_juggernaut: ['Juggernaut', 'Adamantine', 'Ironclad', 'Bulwark', 'Unstoppable', 'Armored'],
  solar_archon: ['Solar', 'Dyson', 'Archon', 'Helios', 'Corona', 'Sunflare'],
  crystal_monolith: ['Prismatic', 'Crystal', 'Monolith', 'Quartz', 'Refracting', 'Arachnid'],
  tempest_siren: ['Tempest', 'Siren', 'Vortex', 'Hurricane', 'Cyclone', 'Squall'],
  nanite_titan: ['Nanite', 'Titan', 'Swarm', 'Replicating', 'Cellular', 'Microhive'],
  phase_specter: ['Phase', 'Specter', 'Plasma', 'Ethereal', 'Apparition', 'Shift'],
  volcanic_chimera: ['Volcanic', 'Chimera', 'Magma', 'Obsidian', 'Pyre', 'Caldera'],
  eternal_ouroboros: ['Eternal', 'Ouroboros', 'Infinite', 'Celestial', 'Alpha-Omega', 'Sovereign'],
  generic: ['Primordial', 'Apex', 'Cybernetic', 'Ouroboros', 'Gilded', 'Draconic', 'Shadow']
};

const HELMET_NOUNS: Record<HelmetRarity, string[]> = {
  common: ['Cap', 'Visor', 'Coif', 'Mask', 'Plating'],
  uncommon: ['Helm', 'Guard', 'Carapace', 'Bascinet', 'Cowl'],
  rare: ['Warhelm', 'Crest', 'Greathelm', 'Visage', 'Crown'],
  epic: ['Apex Crown', 'Dragon Helm', 'Astral Crown', 'Solar Diadem', 'Void Veil'],
  legendary: ['Titan Crown', 'Leviathan Crest', 'Singularity Crown', 'Supernova Visage'],
  mythic: ['Ouroboros Diadem', 'Crown of Eternity', 'Eye of the Cosmos', 'Primordial Halo']
};

const HELMET_SUFFIXES = [
  'of Ferocity',
  'of the Vanguard',
  'of Swiftness',
  'of Vitality',
  'of the Colossus',
  'of Retribution',
  'of Fortune',
  'of the Astral Void',
  'of Aegis',
  'of Transcendence'
];

const HELMET_ICONS: Record<HelmetRarity, string[]> = {
  common: ['🪖', '🛡️', '🥋'],
  uncommon: ['🐍', '🛡️', '⚔️'],
  rare: ['🐲', '🔮', '⚡'],
  epic: ['👑', '🔱', '🔥'],
  legendary: ['💠', '💫', '⚡'],
  mythic: ['☀️', '💎', '🌌']
};

export type StatKey =
  | 'maxHp'
  | 'armor'
  | 'speed'
  | 'bitePower'
  | 'critChance'
  | 'critMult'
  | 'hpRegen'
  | 'shield'
  | 'magnetRadius'
  | 'dashCooldown'
  | 'xpMultiplier'
  | 'shardMultiplier'
  | 'thorns';

const STAT_POOLS: StatKey[] = [
  'maxHp',
  'armor',
  'speed',
  'bitePower',
  'critChance',
  'critMult',
  'hpRegen',
  'shield',
  'magnetRadius',
  'dashCooldown',
  'xpMultiplier',
  'shardMultiplier',
  'thorns'
];

export function chooseHelmetRarity(floor: number): HelmetRarity {
  const roll = Rng.Shared.rand();
  if (floor <= 1) {
    if (roll < 0.60) return 'common';
    if (roll < 0.95) return 'uncommon';
    return 'rare';
  } else if (floor === 2) {
    if (roll < 0.50) return 'uncommon';
    if (roll < 0.85) return 'rare';
    return 'epic';
  } else {
    // Floor 3+
    if (roll < 0.45) return 'rare';
    if (roll < 0.85) return 'epic';
    return 'mythic';
  }
}

export function generateBossHelmet(
  floor: number = 1,
  bossType: string = 'centipede',
  forcedRarity?: HelmetRarity
): HelmetDef {
  const rarity = forcedRarity || chooseHelmetRarity(floor);

  const prefixPool = HELMET_PREFIXES[bossType] || HELMET_PREFIXES.generic!;
  const prefix = prefixPool[Math.floor(Rng.Shared.rand() * prefixPool.length)]!;
  const nouns = HELMET_NOUNS[rarity] || HELMET_NOUNS.common;
  const noun = nouns[Math.floor(Rng.Shared.rand() * nouns.length)]!;
  const suffix = HELMET_SUFFIXES[Math.floor(Rng.Shared.rand() * HELMET_SUFFIXES.length)]!;

  let name = `${prefix} ${noun}`;
  if (rarity === 'rare' || rarity === 'epic' || rarity === 'mythic') {
    if (Rng.Shared.chance(0.65)) {
      name = `${prefix} ${noun} ${suffix}`;
    }
  }

  const icons = HELMET_ICONS[rarity] || HELMET_ICONS.common;
  const icon = icons[Math.floor(Rng.Shared.rand() * icons.length)]!;

  // Determine affix count by rarity
  const affixCountMap: Record<HelmetRarity, number> = {
    common: 1,
    uncommon: 2,
    rare: 3,
    epic: 4,
    legendary: 4,
    mythic: 5
  };
  const count = affixCountMap[rarity] || 1;

  // Multiplier by rarity
  const rarityMultMap: Record<HelmetRarity, number> = {
    common: 1.0,
    uncommon: 1.2,
    rare: 1.5,
    epic: 1.9,
    legendary: 2.2,
    mythic: 2.5
  };
  const mult = rarityMultMap[rarity] || 1.0;

  // Pick non-repeating stats
  const availableStats = [...STAT_POOLS];
  const chosenStats: StatKey[] = [];
  for (let i = 0; i < count && availableStats.length > 0; i++) {
    const idx = Math.floor(Rng.Shared.rand() * availableStats.length);
    chosenStats.push(availableStats[idx]!);
    availableStats.splice(idx, 1);
  }

  const stats: HelmetStats = {};

  for (const key of chosenStats) {
    switch (key) {
      case 'maxHp': {
        const val = Math.round((10 + Rng.Shared.range(5, 18)) * mult);
        stats.maxHp = val;
        break;
      }
      case 'armor': {
        const val = Number(((0.02 + Rng.Shared.range(0.01, 0.04)) * mult).toFixed(3));
        stats.armor = Math.min(0.25, val);
        break;
      }
      case 'speed': {
        const val = Number(((0.03 + Rng.Shared.range(0.01, 0.04)) * mult).toFixed(3));
        stats.speed = Math.min(0.35, val);
        break;
      }
      case 'bitePower': {
        const val = Math.round((4 + Rng.Shared.range(2, 6)) * mult);
        stats.bitePower = val;
        break;
      }
      case 'critChance': {
        const val = Number(((0.03 + Rng.Shared.range(0.01, 0.03)) * mult).toFixed(3));
        stats.critChance = Math.min(0.30, val);
        break;
      }
      case 'critMult': {
        const val = Number(((0.15 + Rng.Shared.range(0.05, 0.15)) * mult).toFixed(2));
        stats.critMult = val;
        break;
      }
      case 'hpRegen': {
        const val = Number(((0.5 + Rng.Shared.range(0.2, 0.6)) * mult).toFixed(1));
        stats.hpRegen = val;
        break;
      }
      case 'shield': {
        const val = Math.round((15 + Rng.Shared.range(5, 15)) * mult);
        stats.shield = val;
        break;
      }
      case 'magnetRadius': {
        const val = Math.round((15 + Rng.Shared.range(5, 15)) * mult);
        stats.magnetRadius = val;
        break;
      }
      case 'dashCooldown': {
        const val = Number(((0.10 + Rng.Shared.range(0.05, 0.12)) * mult).toFixed(2));
        stats.dashCooldown = Math.min(0.60, val);
        break;
      }
      case 'xpMultiplier': {
        const val = Number(((0.05 + Rng.Shared.range(0.02, 0.06)) * mult).toFixed(2));
        stats.xpMultiplier = val;
        break;
      }
      case 'shardMultiplier': {
        const val = Number(((0.05 + Rng.Shared.range(0.02, 0.06)) * mult).toFixed(2));
        stats.shardMultiplier = val;
        break;
      }
      case 'thorns': {
        const val = Number(((0.06 + Rng.Shared.range(0.02, 0.08)) * mult).toFixed(2));
        stats.thorns = val;
        break;
      }
    }
  }

  const id = `helm_${Date.now()}_${Math.floor(Rng.Shared.rand() * 100000)}`;

  return {
    Id: id,
    Name: name,
    Icon: icon,
    Rarity: rarity,
    Stats: stats,
    Description: `Forged from the remnants of ${bossType.toUpperCase()} on Floor ${floor}.`,
    Floor: floor,
    BossType: bossType,

    id,
    name,
    icon,
    rarity,
    stats,
    description: `Forged from the remnants of ${bossType.toUpperCase()} on Floor ${floor}.`,
    floor,
    bossType
  };
}

export function formatHelmetStatDescription(stats: HelmetStats): string {
  const parts: string[] = [];
  if (stats.maxHp) parts.push(`+${stats.maxHp} Max HP`);
  if (stats.armor) parts.push(`+${Math.round(stats.armor * 100)}% Armor`);
  if (stats.speed) parts.push(`+${Math.round(stats.speed * 100)}% Speed`);
  if (stats.bitePower) parts.push(`+${stats.bitePower} Bite Power`);
  if (stats.critChance) parts.push(`+${Math.round(stats.critChance * 100)}% Crit`);
  if (stats.critMult) parts.push(`+${Math.round(stats.critMult * 100)}% Crit Dmg`);
  if (stats.hpRegen) parts.push(`+${stats.hpRegen} HP/s`);
  if (stats.shield) parts.push(`+${stats.shield} Shield`);
  if (stats.magnetRadius) parts.push(`+${stats.magnetRadius}px Magnet`);
  if (stats.dashCooldown) parts.push(`-${stats.dashCooldown}s Dash CD`);
  if (stats.xpMultiplier) parts.push(`+${Math.round(stats.xpMultiplier * 100)}% Ouro`);
  if (stats.shardMultiplier) parts.push(`+${Math.round(stats.shardMultiplier * 100)}% Shards`);
  if (stats.thorns) parts.push(`+${Math.round(stats.thorns * 100)}% Thorns`);
  return parts.join(' • ');
}
