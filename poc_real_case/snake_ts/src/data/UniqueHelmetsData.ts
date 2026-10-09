/**
 * Ouroboros Ascension — 8 Unique Helmets & 9th Omni-Helmet Data (UniqueHelmetsData.ts)
 *
 * Defines the 8 Unique Helmets obtainable via Galaxy Jump Sacrifice,
 * the sacrifice value calculation engine, and the 9th Omni-Helmet synthesis factory
 * ("The Celestial Crown of the Eternal Ouroboros").
 *
 * Meets AGENTS.md Rule 10 In-Code Documentation Standards and Rule 6 Headless Independence.
 */

import { HelmetDef, HelmetRarity, HelmetStats } from './Types.js';

/**
 * Authoritative Gold-Brown Aesthetic Palette for Unique Helmets and the 9th Omni-Helmet.
 */
export const UNIQUE_HELMET_COLOR = '#d4af37';
export const UNIQUE_HELMET_GLOW_COLOR = '#b8860b';
export const UNIQUE_HELMET_BORDER_COLOR = '#8c6239';

/**
 * Definition of a Unique Helmet with extended lore, distinctive special capacities,
 * gold-brown aesthetic metadata, and unique identity flags.
 */
export interface UniqueHelmetDef extends HelmetDef {
  Id: string;
  Name: string;
  Icon: string;
  Image: string;
  Rarity: HelmetRarity;
  Lore: string;
  SpecialCapacity: string;
  Stats: HelmetStats;
  IsUnique: boolean;
  IsOmni?: boolean;
  Color?: string;
  GlowColor?: string;
  BorderColor?: string;

  // Canonical and Alias IDs for full Oracle alignment
  CanonicalId?: string;
  AliasId?: string;
  PrimordialAspect?: string;

  // Casing parity aliases
  id?: string;
  name?: string;
  icon?: string;
  image?: string;
  rarity?: HelmetRarity;
  lore?: string;
  specialCapacity?: string;
  stats?: HelmetStats;
  isUnique?: boolean;
  isOmni?: boolean;
  description?: string;
  color?: string;
  glowColor?: string;
  borderColor?: string;
  canonicalId?: string;
  aliasId?: string;
  primordialAspect?: string;
}

/**
 * Sacrifice point contribution per helmet rarity.
 * Higher rarity helmets yield exponentially higher sacrifice value toward the Galaxy Jump ritual.
 */
export const SACRIFICE_RARITY_VALUES: Record<HelmetRarity, number> = {
  common: 25,
  uncommon: 60,
  rare: 120,
  epic: 250,
  legendary: 400,
  mythic: 600,
};

/**
 * Computes the aggregate sacrifice score for a collection of standard helmets.
 *
 * Formula:
 *  $$\text{score} = \sum_{h \in \text{helmets}} \text{SACRIFICE\_RARITY\_VALUES}[h.\text{rarity}]$$
 *
 * @param helmets List of helmets selected for sacrifice
 * @returns Total accumulated sacrifice points (>= 0)
 */
export function calculateSacrificeScore(helmets: HelmetDef[]): number {
  if (!helmets || helmets.length === 0) return 0;
  let total = 0;
  for (const h of helmets) {
    if (!h) continue;
    const rarity = ((h.Rarity || h.rarity || 'common') as string).toLowerCase() as HelmetRarity;
    total += SACRIFICE_RARITY_VALUES[rarity] ?? SACRIFICE_RARITY_VALUES.common;
  }
  return total;
}

/**
 * Intrinsic rarity multiplier weights defined in ORACLE.md Section 10.4.1.
 */
export const SACRIFICE_DETAILED_RARITY_MULTIPLIERS: Record<HelmetRarity, number> = {
  common: 1.0,
  uncommon: 1.5,
  rare: 2.5,
  epic: 4.0,
  legendary: 5.5,
  mythic: 7.0,
};

/**
 * Computes the detailed sacrifice score S according to ORACLE.md Section 10.4.1:
 *  $$S = \sum_{h \in \text{Sacrificed}} (50 \times \text{AffixCount}(h) + 10 \times \text{Floor}(h) + \text{PowerRating}(h)) \times M_{\text{rarity}}(h)$$
 *
 * @param helmets Collection of standard helmets surrendered for the Galaxy Jump ritual
 * @returns Total accumulated sacrifice points S
 */
export function calculateDetailedSacrificeScore(helmets: HelmetDef[]): number {
  if (!helmets || helmets.length === 0) return 0;
  let totalScore = 0;

  for (const h of helmets) {
    if (!h) continue;
    const rarity = ((h.Rarity || h.rarity || 'common') as string).toLowerCase() as HelmetRarity;
    const mult = SACRIFICE_DETAILED_RARITY_MULTIPLIERS[rarity] ?? 1.0;

    const stats = h.Stats || h.stats || {};
    const affixCount = Math.max(1, Object.values(stats).filter(v => typeof v === 'number' && v !== 0).length);
    const floor = Math.max(1, h.Floor ?? h.floor ?? 1);

    let power = 0;
    for (const val of Object.values(stats)) {
      if (typeof val === 'number') power += Math.abs(val);
    }
    const powerRating = Math.round(power) || 10;

    const itemValue = 50 * affixCount + 10 * floor + powerRating;
    totalScore += itemValue * mult;
  }

  return Math.round(totalScore);
}

/**
 * Computes the Galaxy Jump prestige multiplier according to ORACLE.md Section 10.4:
 *  $$P_{\text{mult}} = 1 + 0.5 \times N_{\text{helmets}} + 0.1 \times \text{Floor}$$
 *
 * @param helmetsCount Number of unlocked unique helmets held in the Ouroboros Gallery (N_helmets)
 * @param floor Current expedition floor depth reached
 * @returns Calibrated prestige score multiplier (>= 1.0)
 */
export function calculatePrestigeMultiplier(helmetsCount: number, floor: number): number {
  const n = Math.max(0, helmetsCount || 0);
  const f = Math.max(1, floor || 1);
  return Number((1 + 0.5 * n + 0.1 * f).toFixed(2));
}

/**
 * Combines stats across a collection of unique helmets, safely summing each numeric affix
 * while rounding floating point values to prevent IEEE 754 precision drifts.
 *
 * @param helmets List of unique helmets to combine
 * @returns Consolidated HelmetStats containing summed values
 */
export function combineHelmetStats(helmets: UniqueHelmetDef[]): HelmetStats {
  const combined: HelmetStats = {};
  if (!helmets || helmets.length === 0) return combined;

  const floatKeys: (keyof HelmetStats)[] = [
    'armor',
    'speed',
    'critChance',
    'critMult',
    'hpRegen',
    'dashCooldown',
    'xpMultiplier',
    'shardMultiplier',
    'thorns',
    'stunDuration',
  ];

  const intKeys: (keyof HelmetStats)[] = [
    'maxHp',
    'bitePower',
    'shield',
    'magnetRadius',
  ];

  for (const helm of helmets) {
    const s = helm.Stats || helm.stats;
    if (!s) continue;

    for (const k of floatKeys) {
      const val = s[k];
      if (typeof val === 'number' && Number.isFinite(val)) {
        combined[k] = Number(((combined[k] ?? 0) + val).toFixed(3));
      }
    }

    for (const k of intKeys) {
      const val = s[k];
      if (typeof val === 'number' && Number.isFinite(val)) {
        combined[k] = Math.round((combined[k] ?? 0) + val);
      }
    }
  }

  return combined;
}

/**
 * The 8 Unique Helmets pool obtainable exclusively through the Galaxy Jump transcendence ritual.
 * Features distinctive gold-brown aesthetic metadata (#d4af37 / #b8860b / #8c6239) and
 * potent active/passive combat capacities.
 */
export const UNIQUE_HELMETS: readonly UniqueHelmetDef[] = [
  {
    Id: 'unique_helm_chrono_singularity',
    CanonicalId: 'unique_chronos_eye',
    AliasId: 'unique_helm_chrono_singularity',
    PrimordialAspect: 'Spacetime Causality',
    Name: 'Crown of the Chrono-Singularity',
    Icon: '👑',
    Image: '/assets/helmets/chrono_singularity.jpg',
    Rarity: 'mythic',
    Lore: 'Forged in the event horizon of a collapsing temporal rift, bending spacetime to the serpent\'s will.',
    SpecialCapacity: 'Temporal Paradox: Warps spacetime, drastically decreasing dash cooldown while accelerating kinematic propulsion.',
    Stats: {
      speed: 0.30,
      dashCooldown: 0.35,
      critChance: 0.10,
    },
    IsUnique: true,
    Color: UNIQUE_HELMET_COLOR,
    GlowColor: UNIQUE_HELMET_GLOW_COLOR,
    BorderColor: UNIQUE_HELMET_BORDER_COLOR,

    id: 'unique_helm_chrono_singularity',
    canonicalId: 'unique_chronos_eye',
    aliasId: 'unique_helm_chrono_singularity',
    primordialAspect: 'Spacetime Causality',
    name: 'Crown of the Chrono-Singularity',
    icon: '👑',
    image: '/assets/helmets/chrono_singularity.jpg',
    rarity: 'mythic',
    lore: 'Forged in the event horizon of a collapsing temporal rift, bending spacetime to the serpent\'s will.',
    specialCapacity: 'Temporal Paradox: Warps spacetime, drastically decreasing dash cooldown while accelerating kinematic propulsion.',
    stats: {
      speed: 0.30,
      dashCooldown: 0.35,
      critChance: 0.10,
    },
    isUnique: true,
    color: UNIQUE_HELMET_COLOR,
    glowColor: UNIQUE_HELMET_GLOW_COLOR,
    borderColor: UNIQUE_HELMET_BORDER_COLOR,
    description: 'Forged in the event horizon of a collapsing temporal rift, bending spacetime to the serpent\'s will.',
  },
  {
    Id: 'unique_helm_adamantine_juggernaut',
    CanonicalId: 'unique_colossus_crown',
    AliasId: 'unique_helm_adamantine_juggernaut',
    PrimordialAspect: 'Titanic Earth & Magma',
    Name: 'Warhelm of the Adamantine Juggernaut',
    Icon: '🪖',
    Image: '/assets/helmets/adamantine_juggernaut.jpg',
    Rarity: 'mythic',
    Lore: 'Cast from hyper-dense degenerate neutron matter that shrugs off planetary impacts.',
    SpecialCapacity: 'Kinetic Bulwark: Converts kinetic momentum into impenetrable energy barriers.',
    Stats: {
      maxHp: 80,
      armor: 0.20,
      shield: 60,
    },
    IsUnique: true,
    Color: UNIQUE_HELMET_COLOR,
    GlowColor: UNIQUE_HELMET_GLOW_COLOR,
    BorderColor: UNIQUE_HELMET_BORDER_COLOR,

    id: 'unique_helm_adamantine_juggernaut',
    canonicalId: 'unique_colossus_crown',
    aliasId: 'unique_helm_adamantine_juggernaut',
    primordialAspect: 'Titanic Earth & Magma',
    name: 'Warhelm of the Adamantine Juggernaut',
    icon: '🪖',
    image: '/assets/helmets/adamantine_juggernaut.jpg',
    rarity: 'mythic',
    lore: 'Cast from hyper-dense degenerate neutron matter that shrugs off planetary impacts.',
    specialCapacity: 'Kinetic Bulwark: Converts kinetic momentum into impenetrable energy barriers.',
    stats: {
      maxHp: 80,
      armor: 0.20,
      shield: 60,
    },
    isUnique: true,
    color: UNIQUE_HELMET_COLOR,
    glowColor: UNIQUE_HELMET_GLOW_COLOR,
    borderColor: UNIQUE_HELMET_BORDER_COLOR,
    description: 'Cast from hyper-dense degenerate neutron matter that shrugs off planetary impacts.',
  },
  {
    Id: 'unique_helm_abyssal_leviathan',
    CanonicalId: 'unique_behemoth_maw',
    AliasId: 'unique_helm_abyssal_leviathan',
    PrimordialAspect: 'Chitinous Gluttony & Megalithic Growth',
    Name: 'Maw of the Behemoth / Abyssal Titan',
    Icon: '🪖',
    Image: '/assets/helmets/abyssal_leviathan.jpg',
    Rarity: 'mythic',
    Lore: 'The fossilized dread-mask of the ancient astral terror that swallowed the outer rim.',
    SpecialCapacity: 'Titan Gorging: Eating food temporarily doubles head size and bite radius (2x HeadRadius) for 3.0 seconds.',
    Stats: {
      bitePower: 25,
      magnetRadius: 60,
      maxHp: 40,
    },
    IsUnique: true,
    Color: UNIQUE_HELMET_COLOR,
    GlowColor: UNIQUE_HELMET_GLOW_COLOR,
    BorderColor: UNIQUE_HELMET_BORDER_COLOR,

    id: 'unique_helm_abyssal_leviathan',
    canonicalId: 'unique_behemoth_maw',
    aliasId: 'unique_helm_abyssal_leviathan',
    primordialAspect: 'Chitinous Gluttony & Megalithic Growth',
    name: 'Maw of the Behemoth / Abyssal Titan',
    icon: '🪖',
    image: '/assets/helmets/abyssal_leviathan.jpg',
    rarity: 'mythic',
    lore: 'The fossilized dread-mask of the ancient astral terror that swallowed the outer rim.',
    specialCapacity: 'Titan Gorging: Eating food temporarily doubles head size and bite radius (2x HeadRadius) for 3.0 seconds.',
    stats: {
      bitePower: 25,
      magnetRadius: 60,
      maxHp: 40,
    },
    isUnique: true,
    color: UNIQUE_HELMET_COLOR,
    glowColor: UNIQUE_HELMET_GLOW_COLOR,
    borderColor: UNIQUE_HELMET_BORDER_COLOR,
    description: 'The fossilized dread-mask of the ancient astral terror that swallowed the outer rim.',
  },
  {
    Id: 'unique_helm_solar_archon',
    CanonicalId: 'unique_solar_crest',
    AliasId: 'unique_helm_solar_archon',
    PrimordialAspect: 'Stellar Fusion & Radiance',
    Name: 'Corona of the Solar Archon',
    Icon: '👑',
    Image: '/assets/helmets/solar_archon.jpg',
    Rarity: 'mythic',
    Lore: 'Harnesses thermonuclear fusion cascades from dying stars to unleash incandescent annihilation.',
    SpecialCapacity: 'Solar Cataclysm: Critical strikes detonate searing solar flares across the arena.',
    Stats: {
      critChance: 0.20,
      critMult: 0.80,
      bitePower: 15,
    },
    IsUnique: true,
    Color: UNIQUE_HELMET_COLOR,
    GlowColor: UNIQUE_HELMET_GLOW_COLOR,
    BorderColor: UNIQUE_HELMET_BORDER_COLOR,

    id: 'unique_helm_solar_archon',
    canonicalId: 'unique_solar_crest',
    aliasId: 'unique_helm_solar_archon',
    primordialAspect: 'Stellar Fusion & Radiance',
    name: 'Corona of the Solar Archon',
    icon: '👑',
    image: '/assets/helmets/solar_archon.jpg',
    rarity: 'mythic',
    lore: 'Harnesses thermonuclear fusion cascades from dying stars to unleash incandescent annihilation.',
    specialCapacity: 'Solar Cataclysm: Critical strikes detonate searing solar flares across the arena.',
    stats: {
      critChance: 0.20,
      critMult: 0.80,
      bitePower: 15,
    },
    isUnique: true,
    color: UNIQUE_HELMET_COLOR,
    glowColor: UNIQUE_HELMET_GLOW_COLOR,
    borderColor: UNIQUE_HELMET_BORDER_COLOR,
    description: 'Harnesses thermonuclear fusion cascades from dying stars to unleash incandescent annihilation.',
  },
  {
    Id: 'unique_helm_nanite_hivequeen',
    CanonicalId: 'unique_nanite_hivequeen',
    AliasId: 'unique_helm_nanite_hivequeen',
    PrimordialAspect: 'Bio-Nanite Swarm & Bountiful Mitosis',
    Name: 'Carapace of the Nanite Hivequeen',
    Icon: '⛑️',
    Image: '/assets/helmets/nanite_hivequeen.jpg',
    Rarity: 'mythic',
    Lore: 'Trillions of microscopic constructors constantly reconstruct damaged tissue and replicate chitin.',
    SpecialCapacity: 'Harvest Feast: Defeated enemies burst into 2-3 juicy apples. Cellular Mitosis: Rapidly reconstructs damaged serpent segments during combat.',
    Stats: {
      hpRegen: 3.5,
      thorns: 0.40,
      maxHp: 50,
    },
    IsUnique: true,
    Color: UNIQUE_HELMET_COLOR,
    GlowColor: UNIQUE_HELMET_GLOW_COLOR,
    BorderColor: UNIQUE_HELMET_BORDER_COLOR,

    id: 'unique_helm_nanite_hivequeen',
    canonicalId: 'unique_nanite_hivequeen',
    aliasId: 'unique_helm_nanite_hivequeen',
    primordialAspect: 'Bio-Nanite Swarm & Bountiful Mitosis',
    name: 'Carapace of the Nanite Hivequeen',
    icon: '⛑️',
    image: '/assets/helmets/nanite_hivequeen.jpg',
    rarity: 'mythic',
    lore: 'Trillions of microscopic constructors constantly reconstruct damaged tissue and replicate chitin.',
    specialCapacity: 'Harvest Feast: Defeated enemies burst into 2-3 juicy apples. Cellular Mitosis: Rapidly reconstructs damaged serpent segments during combat.',
    stats: {
      hpRegen: 3.5,
      thorns: 0.40,
      maxHp: 50,
    },
    isUnique: true,
    color: UNIQUE_HELMET_COLOR,
    glowColor: UNIQUE_HELMET_GLOW_COLOR,
    borderColor: UNIQUE_HELMET_BORDER_COLOR,
    description: 'Trillions of microscopic constructors constantly reconstruct damaged tissue and replicate chitin.',
  },
  {
    Id: 'unique_helm_volcanic_chimera',
    CanonicalId: 'unique_leviathan_wings',
    AliasId: 'unique_helm_volcanic_chimera',
    PrimordialAspect: 'Smoldering Caldera & Volcanic Chimera',
    Name: 'Diadem of the Volcanic Chimera',
    Icon: '👑',
    Image: '/assets/helmets/volcanic_chimera.jpg',
    Rarity: 'mythic',
    Lore: 'Smoldering caldera obsidian infused with liquid magma from deep tectonic rifts.',
    SpecialCapacity: 'Pyretic Retaliation: Melee attackers are scorched by molten obsidian spikes.',
    Stats: {
      bitePower: 20,
      thorns: 0.50,
      armor: 0.15,
    },
    IsUnique: true,
    Color: UNIQUE_HELMET_COLOR,
    GlowColor: UNIQUE_HELMET_GLOW_COLOR,
    BorderColor: UNIQUE_HELMET_BORDER_COLOR,

    id: 'unique_helm_volcanic_chimera',
    canonicalId: 'unique_leviathan_wings',
    aliasId: 'unique_helm_volcanic_chimera',
    primordialAspect: 'Smoldering Caldera & Volcanic Chimera',
    name: 'Diadem of the Volcanic Chimera',
    icon: '👑',
    image: '/assets/helmets/volcanic_chimera.jpg',
    rarity: 'mythic',
    lore: 'Smoldering caldera obsidian infused with liquid magma from deep tectonic rifts.',
    specialCapacity: 'Pyretic Retaliation: Melee attackers are scorched by molten obsidian spikes.',
    stats: {
      bitePower: 20,
      thorns: 0.50,
      armor: 0.15,
    },
    isUnique: true,
    color: UNIQUE_HELMET_COLOR,
    glowColor: UNIQUE_HELMET_GLOW_COLOR,
    borderColor: UNIQUE_HELMET_BORDER_COLOR,
    description: 'Smoldering caldera obsidian infused with liquid magma from deep tectonic rifts.',
  },
  {
    Id: 'unique_helm_tempest_siren',
    CanonicalId: 'unique_gorgon_gaze',
    AliasId: 'unique_helm_tempest_siren',
    PrimordialAspect: 'Galvanic Venom & Ion Tempests',
    Name: 'Gale-Crest of the Tempest Siren',
    Icon: '🪖',
    Image: '/assets/helmets/tempest_siren.jpg',
    Rarity: 'mythic',
    Lore: 'Attuned to the ion storms of the upper gas giants, sparking with high-voltage arc discharges.',
    SpecialCapacity: 'Electro-Vortex: Lightning arcs jump between nearby targets when collecting essence.',
    Stats: {
      speed: 0.25,
      xpMultiplier: 0.35,
      dashCooldown: 0.25,
    },
    IsUnique: true,
    Color: UNIQUE_HELMET_COLOR,
    GlowColor: UNIQUE_HELMET_GLOW_COLOR,
    BorderColor: UNIQUE_HELMET_BORDER_COLOR,

    id: 'unique_helm_tempest_siren',
    canonicalId: 'unique_gorgon_gaze',
    aliasId: 'unique_helm_tempest_siren',
    primordialAspect: 'Galvanic Venom & Ion Tempests',
    name: 'Gale-Crest of the Tempest Siren',
    icon: '🪖',
    image: '/assets/helmets/tempest_siren.jpg',
    rarity: 'mythic',
    lore: 'Attuned to the ion storms of the upper gas giants, sparking with high-voltage arc discharges.',
    specialCapacity: 'Electro-Vortex: Lightning arcs jump between nearby targets when collecting essence.',
    stats: {
      speed: 0.25,
      xpMultiplier: 0.35,
      dashCooldown: 0.25,
    },
    isUnique: true,
    color: UNIQUE_HELMET_COLOR,
    glowColor: UNIQUE_HELMET_GLOW_COLOR,
    borderColor: UNIQUE_HELMET_BORDER_COLOR,
    description: 'Attuned to the ion storms of the upper gas giants, sparking with high-voltage arc discharges.',
  },
  {
    Id: 'unique_helm_prismatic_monolith',
    CanonicalId: 'unique_void_horns',
    AliasId: 'unique_helm_prismatic_monolith',
    PrimordialAspect: 'Gravitational Collapse & Essence Refraction',
    Name: 'Visage of the Prismatic Monolith',
    Icon: '🪖',
    Image: '/assets/helmets/prismatic_monolith.jpg',
    Rarity: 'mythic',
    Lore: 'Extracted from the zero-point nexus, refracting light and reality into pure essence shards.',
    SpecialCapacity: 'Essence Refraction: Transmutes harvested enemy essence into abundant crystal shards.',
    Stats: {
      shardMultiplier: 0.50,
      shield: 40,
      hpRegen: 2.0,
    },
    IsUnique: true,
    Color: UNIQUE_HELMET_COLOR,
    GlowColor: UNIQUE_HELMET_GLOW_COLOR,
    BorderColor: UNIQUE_HELMET_BORDER_COLOR,

    id: 'unique_helm_prismatic_monolith',
    canonicalId: 'unique_void_horns',
    aliasId: 'unique_helm_prismatic_monolith',
    primordialAspect: 'Gravitational Collapse & Essence Refraction',
    name: 'Visage of the Prismatic Monolith',
    icon: '🪖',
    image: '/assets/helmets/prismatic_monolith.jpg',
    rarity: 'mythic',
    lore: 'Extracted from the zero-point nexus, refracting light and reality into pure essence shards.',
    specialCapacity: 'Essence Refraction: Transmutes harvested enemy essence into abundant crystal shards.',
    stats: {
      shardMultiplier: 0.50,
      shield: 40,
      hpRegen: 2.0,
    },
    isUnique: true,
    color: UNIQUE_HELMET_COLOR,
    glowColor: UNIQUE_HELMET_GLOW_COLOR,
    borderColor: UNIQUE_HELMET_BORDER_COLOR,
    description: 'Extracted from the zero-point nexus, refracting light and reality into pure essence shards.',
  },
];

/**
 * Factory function constructing the 9th Omni-Helmet ("The Celestial Crown of the Eternal Ouroboros")
 * synthesized by combining all stats and capacities across the 8 Unique Helmets.
 * Possesses both Titan Gorging and Harvest Feast active gameplay capacities alongside gold-brown theme.
 *
 * @param helmets Optional override pool (defaults to UNIQUE_HELMETS)
 * @returns Fully constructed UniqueHelmetDef with combined stats and omni flags
 */
export function forgeOmniHelmet(helmets: readonly UniqueHelmetDef[] = UNIQUE_HELMETS): UniqueHelmetDef {
  const combinedStats = combineHelmetStats(helmets as UniqueHelmetDef[]);
  const id = 'unique_helm_celestial_ouroboros';
  const canonicalId = 'unique_eternal_ouroboros_crown';
  const aliasId = 'unique_helm_celestial_ouroboros';
  const name = 'The Celestial Crown of the Eternal Ouroboros';
  const icon = '👑';
  const image = '/assets/helmets/celestial_ouroboros.jpg';
  const rarity: HelmetRarity = 'mythic';
  const lore = 'The ultimate synthesis of cosmic serpent sovereignty. When the 8 cosmic pillars unite, the alpha and omega fuse into eternity.';
  const specialCapacity = 'Omni-Ascension: Combines all unique capacities: Titan Gorging: Eating food temporarily doubles head size and bite radius (2x HeadRadius) for 3.0 seconds. Harvest Feast: Defeated enemies burst into 2-3 juicy apples. Temporal Paradox, Kinetic Bulwark, Solar Cataclysm, Cellular Mitosis, Pyretic Retaliation, Electro-Vortex, and Essence Refraction.';

  return {
    Id: id,
    CanonicalId: canonicalId,
    AliasId: aliasId,
    PrimordialAspect: 'Transcendent Godhead Artifact',
    Name: name,
    Icon: icon,
    Image: image,
    Rarity: rarity,
    Lore: lore,
    SpecialCapacity: specialCapacity,
    Stats: combinedStats,
    IsUnique: true,
    IsOmni: true,
    Color: UNIQUE_HELMET_COLOR,
    GlowColor: UNIQUE_HELMET_GLOW_COLOR,
    BorderColor: UNIQUE_HELMET_BORDER_COLOR,

    id,
    canonicalId,
    aliasId,
    primordialAspect: 'Transcendent Godhead Artifact',
    name,
    icon,
    image,
    rarity,
    lore,
    specialCapacity,
    stats: combinedStats,
    isUnique: true,
    isOmni: true,
    color: UNIQUE_HELMET_COLOR,
    glowColor: UNIQUE_HELMET_GLOW_COLOR,
    borderColor: UNIQUE_HELMET_BORDER_COLOR,
    description: lore,
  };
}

/**
 * Singleton / static reference to the synthesized 9th Omni-Helmet.
 */
export const CELESTIAL_OUROBOROS_HELMET: UniqueHelmetDef = forgeOmniHelmet();

/**
 * Helper to look up a Unique Helmet definition by its Id, CanonicalId, or AliasId.
 *
 * @param id Id, CanonicalId, or AliasId to look up
 * @returns Found UniqueHelmetDef or undefined
 */
export function getUniqueHelmet(id: string): UniqueHelmetDef | undefined {
  if (!id) return undefined;
  if (
    id === CELESTIAL_OUROBOROS_HELMET.Id ||
    id === CELESTIAL_OUROBOROS_HELMET.id ||
    id === CELESTIAL_OUROBOROS_HELMET.CanonicalId ||
    id === CELESTIAL_OUROBOROS_HELMET.canonicalId ||
    id === 'helm_ouroboros_ascension_9th'
  ) {
    return CELESTIAL_OUROBOROS_HELMET;
  }
  return UNIQUE_HELMETS.find(h =>
    h.Id === id ||
    h.id === id ||
    h.CanonicalId === id ||
    h.canonicalId === id ||
    h.AliasId === id ||
    h.aliasId === id
  );
}

/**
 * Checks whether an ID belongs to a Unique Helmet or the 9th Omni-Crown.
 */
export function isUniqueHelmetId(id: string): boolean {
  return getUniqueHelmet(id) !== undefined;
}

/**
 * Returns the canonical ID for any Unique Helmet ID or alias.
 */
export function getCanonicalHelmetId(id: string): string {
  const helm = getUniqueHelmet(id);
  return helm?.CanonicalId || helm?.Id || id;
}
