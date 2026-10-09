import {
  CosmicCapacityDef,
  OrderedTable,
  RolledCosmicCapacity,
  RolledCapacityState,
  CapacityParamDef,
} from './Types';
import { Rng } from '../core/Rng';
import { MathX } from '../core/MathX';

/**
 * Authoritative Static Catalog and Generator for the 12 Cosmic Special Capacities.
 * Exclusively active during Daily Challenge runs and unlocked for 24h at Level 5.
 */
export class CosmicCapacities {
  public static readonly Catalog: OrderedTable<CosmicCapacityDef> = CosmicCapacities.buildCatalog();
  public static readonly catalog = CosmicCapacities.Catalog;

  private static buildCatalog(): OrderedTable<CosmicCapacityDef> {
    const t = new OrderedTable<CosmicCapacityDef>();

    // 1. Supernova Trail
    t.Add('supernova_trail', {
      Id: 'supernova_trail', id: 'supernova_trail',
      Name: 'Supernova Trail', name: 'Supernova Trail',
      Icon: '🌠', icon: '🌠',
      Color: '#ff5400', color: '#ff5400',
      Accent: '#ffd166', accent: '#ffd166',
      Description: 'Searing cosmic starfire trail behind the snake body that burns pursuing enemies and detonates on dash.',
      desc: 'Searing cosmic starfire trail behind the snake body that burns pursuing enemies and detonates on dash.',
      FloorScalingRate: 0.25, floorScalingRate: 0.25,
      StateA: {
        Key: 'burn_dps', key: 'burn_dps',
        Name: 'Burn DPS', name: 'Burn DPS',
        Description: 'Damage per second dealt to hostiles standing in starfire.',
        Unit: 'DPS', unit: 'DPS',
        Tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: 'DPS' },
        Tier2: { Min: 26, Max: 40, min: 26, max: 40, unit: 'DPS' },
        Tier3: { Min: 41, Max: 60, min: 41, max: 60, unit: 'DPS' },
        tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: 'DPS' },
        tier2: { Min: 26, Max: 40, min: 26, max: 40, unit: 'DPS' },
        tier3: { Min: 41, Max: 60, min: 41, max: 60, unit: 'DPS' },
      },
      stateA: {
        Key: 'burn_dps', key: 'burn_dps',
        Name: 'Burn DPS', name: 'Burn DPS',
        Description: 'Damage per second dealt to hostiles standing in starfire.',
        Unit: 'DPS', unit: 'DPS',
        Tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: 'DPS' },
        Tier2: { Min: 26, Max: 40, min: 26, max: 40, unit: 'DPS' },
        Tier3: { Min: 41, Max: 60, min: 41, max: 60, unit: 'DPS' },
        tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: 'DPS' },
        tier2: { Min: 26, Max: 40, min: 26, max: 40, unit: 'DPS' },
        tier3: { Min: 41, Max: 60, min: 41, max: 60, unit: 'DPS' },
      },
      StateB: {
        Key: 'trail_duration', key: 'trail_duration',
        Name: 'Trail Duration', name: 'Trail Duration',
        Description: 'Persistence duration of starfire trail in seconds.',
        Unit: 's', unit: 's',
        Tier1: { Min: 1.5, Max: 2.5, min: 1.5, max: 2.5, unit: 's' },
        Tier2: { Min: 2.6, Max: 4.0, min: 2.6, max: 4.0, unit: 's' },
        Tier3: { Min: 4.1, Max: 6.0, min: 4.1, max: 6.0, unit: 's' },
        tier1: { Min: 1.5, Max: 2.5, min: 1.5, max: 2.5, unit: 's' },
        tier2: { Min: 2.6, Max: 4.0, min: 2.6, max: 4.0, unit: 's' },
        tier3: { Min: 4.1, Max: 6.0, min: 4.1, max: 6.0, unit: 's' },
      },
      stateB: {
        Key: 'trail_duration', key: 'trail_duration',
        Name: 'Trail Duration', name: 'Trail Duration',
        Description: 'Persistence duration of starfire trail in seconds.',
        Unit: 's', unit: 's',
        Tier1: { Min: 1.5, Max: 2.5, min: 1.5, max: 2.5, unit: 's' },
        Tier2: { Min: 2.6, Max: 4.0, min: 2.6, max: 4.0, unit: 's' },
        Tier3: { Min: 4.1, Max: 6.0, min: 4.1, max: 6.0, unit: 's' },
        tier1: { Min: 1.5, Max: 2.5, min: 1.5, max: 2.5, unit: 's' },
        tier2: { Min: 2.6, Max: 4.0, min: 2.6, max: 4.0, unit: 's' },
        tier3: { Min: 4.1, Max: 6.0, min: 4.1, max: 6.0, unit: 's' },
      },
      StateC: {
        Key: 'dash_explosion_radius', key: 'dash_explosion_radius',
        Name: 'Dash Explosion Radius', name: 'Dash Explosion Radius',
        Description: 'Radius of starfire shockwave detonated on dash.',
        Unit: 'px', unit: 'px',
        Tier1: { Min: 40, Max: 60, min: 40, max: 60, unit: 'px' },
        Tier2: { Min: 61, Max: 90, min: 61, max: 90, unit: 'px' },
        Tier3: { Min: 91, Max: 130, min: 91, max: 130, unit: 'px' },
        tier1: { Min: 40, Max: 60, min: 40, max: 60, unit: 'px' },
        tier2: { Min: 61, Max: 90, min: 61, max: 90, unit: 'px' },
        tier3: { Min: 91, Max: 130, min: 91, max: 130, unit: 'px' },
      },
      stateC: {
        Key: 'dash_explosion_radius', key: 'dash_explosion_radius',
        Name: 'Dash Explosion Radius', name: 'Dash Explosion Radius',
        Description: 'Radius of starfire shockwave detonated on dash.',
        Unit: 'px', unit: 'px',
        Tier1: { Min: 40, Max: 60, min: 40, max: 60, unit: 'px' },
        Tier2: { Min: 61, Max: 90, min: 61, max: 90, unit: 'px' },
        Tier3: { Min: 91, Max: 130, min: 91, max: 130, unit: 'px' },
        tier1: { Min: 40, Max: 60, min: 40, max: 60, unit: 'px' },
        tier2: { Min: 61, Max: 90, min: 61, max: 90, unit: 'px' },
        tier3: { Min: 91, Max: 130, min: 91, max: 130, unit: 'px' },
      },
    });

    // 2. Astral Singularity
    t.Add('astral_singularity', {
      Id: 'astral_singularity', id: 'astral_singularity',
      Name: 'Astral Singularity', name: 'Astral Singularity',
      Icon: '🌌', icon: '🌌',
      Color: '#7928ca', color: '#7928ca',
      Accent: '#00dfd8', accent: '#00dfd8',
      Description: 'Periodic mini-black holes sucking enemies and projectiles before violently imploding.',
      desc: 'Periodic mini-black holes sucking enemies and projectiles before violently imploding.',
      FloorScalingRate: 0.25, floorScalingRate: 0.25,
      StateA: {
        Key: 'pull_force', key: 'pull_force',
        Name: 'Pull Force', name: 'Pull Force',
        Description: 'Gravitational centripetal suction strength.',
        Unit: 'force', unit: 'force',
        Tier1: { Min: 80, Max: 120, min: 80, max: 120, unit: 'force' },
        Tier2: { Min: 121, Max: 170, min: 121, max: 170, unit: 'force' },
        Tier3: { Min: 171, Max: 240, min: 171, max: 240, unit: 'force' },
        tier1: { Min: 80, Max: 120, min: 80, max: 120, unit: 'force' },
        tier2: { Min: 121, Max: 170, min: 121, max: 170, unit: 'force' },
        tier3: { Min: 171, Max: 240, min: 171, max: 240, unit: 'force' },
      },
      stateA: {
        Key: 'pull_force', key: 'pull_force',
        Name: 'Pull Force', name: 'Pull Force',
        Description: 'Gravitational centripetal suction strength.',
        Unit: 'force', unit: 'force',
        Tier1: { Min: 80, Max: 120, min: 80, max: 120, unit: 'force' },
        Tier2: { Min: 121, Max: 170, min: 121, max: 170, unit: 'force' },
        Tier3: { Min: 171, Max: 240, min: 171, max: 240, unit: 'force' },
        tier1: { Min: 80, Max: 120, min: 80, max: 120, unit: 'force' },
        tier2: { Min: 121, Max: 170, min: 121, max: 170, unit: 'force' },
        tier3: { Min: 171, Max: 240, min: 171, max: 240, unit: 'force' },
      },
      StateB: {
        Key: 'implosion_damage', key: 'implosion_damage',
        Name: 'Implosion Damage', name: 'Implosion Damage',
        Description: 'Burst kinetic damage upon singularity collapse.',
        Unit: 'dmg', unit: 'dmg',
        Tier1: { Min: 30, Max: 50, min: 30, max: 50, unit: 'dmg' },
        Tier2: { Min: 51, Max: 80, min: 51, max: 80, unit: 'dmg' },
        Tier3: { Min: 81, Max: 120, min: 81, max: 120, unit: 'dmg' },
        tier1: { Min: 30, Max: 50, min: 30, max: 50, unit: 'dmg' },
        tier2: { Min: 51, Max: 80, min: 51, max: 80, unit: 'dmg' },
        tier3: { Min: 81, Max: 120, min: 81, max: 120, unit: 'dmg' },
      },
      stateB: {
        Key: 'implosion_damage', key: 'implosion_damage',
        Name: 'Implosion Damage', name: 'Implosion Damage',
        Description: 'Burst kinetic damage upon singularity collapse.',
        Unit: 'dmg', unit: 'dmg',
        Tier1: { Min: 30, Max: 50, min: 30, max: 50, unit: 'dmg' },
        Tier2: { Min: 51, Max: 80, min: 51, max: 80, unit: 'dmg' },
        Tier3: { Min: 81, Max: 120, min: 81, max: 120, unit: 'dmg' },
        tier1: { Min: 30, Max: 50, min: 30, max: 50, unit: 'dmg' },
        tier2: { Min: 51, Max: 80, min: 51, max: 80, unit: 'dmg' },
        tier3: { Min: 81, Max: 120, min: 81, max: 120, unit: 'dmg' },
      },
      StateC: {
        Key: 'pulse_interval', key: 'pulse_interval',
        Name: 'Pulse Interval', name: 'Pulse Interval',
        Description: 'Time in seconds between singularity formations (lower is better).',
        Unit: 's', unit: 's',
        HigherIsBetter: false, higherIsBetter: false,
        Tier1: { Min: 6.0, Max: 8.0, min: 6.0, max: 8.0, unit: 's' },
        Tier2: { Min: 4.0, Max: 5.9, min: 4.0, max: 5.9, unit: 's' },
        Tier3: { Min: 2.5, Max: 3.9, min: 2.5, max: 3.9, unit: 's' },
        tier1: { Min: 6.0, Max: 8.0, min: 6.0, max: 8.0, unit: 's' },
        tier2: { Min: 4.0, Max: 5.9, min: 4.0, max: 5.9, unit: 's' },
        tier3: { Min: 2.5, Max: 3.9, min: 2.5, max: 3.9, unit: 's' },
      },
      stateC: {
        Key: 'pulse_interval', key: 'pulse_interval',
        Name: 'Pulse Interval', name: 'Pulse Interval',
        Description: 'Time in seconds between singularity formations (lower is better).',
        Unit: 's', unit: 's',
        HigherIsBetter: false, higherIsBetter: false,
        Tier1: { Min: 6.0, Max: 8.0, min: 6.0, max: 8.0, unit: 's' },
        Tier2: { Min: 4.0, Max: 5.9, min: 4.0, max: 5.9, unit: 's' },
        Tier3: { Min: 2.5, Max: 3.9, min: 2.5, max: 3.9, unit: 's' },
        tier1: { Min: 6.0, Max: 8.0, min: 6.0, max: 8.0, unit: 's' },
        tier2: { Min: 4.0, Max: 5.9, min: 4.0, max: 5.9, unit: 's' },
        tier3: { Min: 2.5, Max: 3.9, min: 2.5, max: 3.9, unit: 's' },
      },
    });

    // 3. Chrono Paradox Clone
    t.Add('chrono_paradox_clone', {
      Id: 'chrono_paradox_clone', id: 'chrono_paradox_clone',
      Name: 'Chrono Paradox Clone', name: 'Chrono Paradox Clone',
      Icon: '⏳', icon: '⏳',
      Color: '#00f0b5', color: '#00f0b5',
      Accent: '#38bdf8', accent: '#38bdf8',
      Description: 'Temporal shadow clone echoing player tail-whips & bites with spatial distortion.',
      desc: 'Temporal shadow clone echoing player tail-whips & bites with spatial distortion.',
      FloorScalingRate: 0.25, floorScalingRate: 0.25,
      StateA: {
        Key: 'clone_damage_ratio', key: 'clone_damage_ratio',
        Name: 'Clone Damage Ratio', name: 'Clone Damage Ratio',
        Description: 'Percentage of player damage replicated by temporal clone.',
        Unit: '%', unit: '%',
        Tier1: { Min: 30, Max: 45, min: 30, max: 45, unit: '%' },
        Tier2: { Min: 46, Max: 65, min: 46, max: 65, unit: '%' },
        Tier3: { Min: 66, Max: 90, min: 66, max: 90, unit: '%' },
        tier1: { Min: 30, Max: 45, min: 30, max: 45, unit: '%' },
        tier2: { Min: 46, Max: 65, min: 46, max: 65, unit: '%' },
        tier3: { Min: 66, Max: 90, min: 66, max: 90, unit: '%' },
      },
      stateA: {
        Key: 'clone_damage_ratio', key: 'clone_damage_ratio',
        Name: 'Clone Damage Ratio', name: 'Clone Damage Ratio',
        Description: 'Percentage of player damage replicated by temporal clone.',
        Unit: '%', unit: '%',
        Tier1: { Min: 30, Max: 45, min: 30, max: 45, unit: '%' },
        Tier2: { Min: 46, Max: 65, min: 46, max: 65, unit: '%' },
        Tier3: { Min: 66, Max: 90, min: 66, max: 90, unit: '%' },
        tier1: { Min: 30, Max: 45, min: 30, max: 45, unit: '%' },
        tier2: { Min: 46, Max: 65, min: 46, max: 65, unit: '%' },
        tier3: { Min: 66, Max: 90, min: 66, max: 90, unit: '%' },
      },
      StateB: {
        Key: 'clone_lifetime', key: 'clone_lifetime',
        Name: 'Clone Lifetime', name: 'Clone Lifetime',
        Description: 'Duration the temporal clone remains active before paradoxical fade.',
        Unit: 's', unit: 's',
        Tier1: { Min: 3.0, Max: 5.0, min: 3.0, max: 5.0, unit: 's' },
        Tier2: { Min: 5.1, Max: 8.0, min: 5.1, max: 8.0, unit: 's' },
        Tier3: { Min: 8.1, Max: 12.0, min: 8.1, max: 12.0, unit: 's' },
        tier1: { Min: 3.0, Max: 5.0, min: 3.0, max: 5.0, unit: 's' },
        tier2: { Min: 5.1, Max: 8.0, min: 5.1, max: 8.0, unit: 's' },
        tier3: { Min: 8.1, Max: 12.0, min: 8.1, max: 12.0, unit: 's' },
      },
      stateB: {
        Key: 'clone_lifetime', key: 'clone_lifetime',
        Name: 'Clone Lifetime', name: 'Clone Lifetime',
        Description: 'Duration the temporal clone remains active before paradoxical fade.',
        Unit: 's', unit: 's',
        Tier1: { Min: 3.0, Max: 5.0, min: 3.0, max: 5.0, unit: 's' },
        Tier2: { Min: 5.1, Max: 8.0, min: 5.1, max: 8.0, unit: 's' },
        Tier3: { Min: 8.1, Max: 12.0, min: 8.1, max: 12.0, unit: 's' },
        tier1: { Min: 3.0, Max: 5.0, min: 3.0, max: 5.0, unit: 's' },
        tier2: { Min: 5.1, Max: 8.0, min: 5.1, max: 8.0, unit: 's' },
        tier3: { Min: 8.1, Max: 12.0, min: 8.1, max: 12.0, unit: 's' },
      },
      StateC: {
        Key: 'spawn_interval_on_dash', key: 'spawn_interval_on_dash',
        Name: 'Spawn Interval on Dash', name: 'Spawn Interval on Dash',
        Description: 'Internal cooldown between clone manifestations on dash.',
        Unit: 's', unit: 's',
        HigherIsBetter: false, higherIsBetter: false,
        Tier1: { Min: 8.0, Max: 10.0, min: 8.0, max: 10.0, unit: 's' },
        Tier2: { Min: 5.0, Max: 7.9, min: 5.0, max: 7.9, unit: 's' },
        Tier3: { Min: 3.0, Max: 4.9, min: 3.0, max: 4.9, unit: 's' },
        tier1: { Min: 8.0, Max: 10.0, min: 8.0, max: 10.0, unit: 's' },
        tier2: { Min: 5.0, Max: 7.9, min: 5.0, max: 7.9, unit: 's' },
        tier3: { Min: 3.0, Max: 4.9, min: 3.0, max: 4.9, unit: 's' },
      },
      stateC: {
        Key: 'spawn_interval_on_dash', key: 'spawn_interval_on_dash',
        Name: 'Spawn Interval on Dash', name: 'Spawn Interval on Dash',
        Description: 'Internal cooldown between clone manifestations on dash.',
        Unit: 's', unit: 's',
        HigherIsBetter: false, higherIsBetter: false,
        Tier1: { Min: 8.0, Max: 10.0, min: 8.0, max: 10.0, unit: 's' },
        Tier2: { Min: 5.0, Max: 7.9, min: 5.0, max: 7.9, unit: 's' },
        Tier3: { Min: 3.0, Max: 4.9, min: 3.0, max: 4.9, unit: 's' },
        tier1: { Min: 8.0, Max: 10.0, min: 8.0, max: 10.0, unit: 's' },
        tier2: { Min: 5.0, Max: 7.9, min: 5.0, max: 7.9, unit: 's' },
        tier3: { Min: 3.0, Max: 4.9, min: 3.0, max: 4.9, unit: 's' },
      },
    });

    // 4. Prismatic Laser Orbit
    t.Add('prismatic_laser_orbit', {
      Id: 'prismatic_laser_orbit', id: 'prismatic_laser_orbit',
      Name: 'Prismatic Laser Orbit', name: 'Prismatic Laser Orbit',
      Icon: '💎', icon: '💎',
      Color: '#ff007f', color: '#ff007f',
      Accent: '#00f0ff', accent: '#00f0ff',
      Description: 'Orbiting tachyon beam prisms revolving around the serpent cranium slicing approaching threats.',
      desc: 'Orbiting tachyon beam prisms revolving around the serpent cranium slicing approaching threats.',
      FloorScalingRate: 0.25, floorScalingRate: 0.25,
      StateA: {
        Key: 'laser_dps', key: 'laser_dps',
        Name: 'Laser DPS', name: 'Laser DPS',
        Description: 'Continuous beam cutting damage per second.',
        Unit: 'DPS', unit: 'DPS',
        Tier1: { Min: 20, Max: 35, min: 20, max: 35, unit: 'DPS' },
        Tier2: { Min: 36, Max: 55, min: 36, max: 55, unit: 'DPS' },
        Tier3: { Min: 56, Max: 85, min: 56, max: 85, unit: 'DPS' },
        tier1: { Min: 20, Max: 35, min: 20, max: 35, unit: 'DPS' },
        tier2: { Min: 36, Max: 55, min: 36, max: 55, unit: 'DPS' },
        tier3: { Min: 56, Max: 85, min: 56, max: 85, unit: 'DPS' },
      },
      stateA: {
        Key: 'laser_dps', key: 'laser_dps',
        Name: 'Laser DPS', name: 'Laser DPS',
        Description: 'Continuous beam cutting damage per second.',
        Unit: 'DPS', unit: 'DPS',
        Tier1: { Min: 20, Max: 35, min: 20, max: 35, unit: 'DPS' },
        Tier2: { Min: 36, Max: 55, min: 36, max: 55, unit: 'DPS' },
        Tier3: { Min: 56, Max: 85, min: 56, max: 85, unit: 'DPS' },
        tier1: { Min: 20, Max: 35, min: 20, max: 35, unit: 'DPS' },
        tier2: { Min: 36, Max: 55, min: 36, max: 55, unit: 'DPS' },
        tier3: { Min: 56, Max: 85, min: 56, max: 85, unit: 'DPS' },
      },
      StateB: {
        Key: 'orbit_radius', key: 'orbit_radius',
        Name: 'Orbit Radius', name: 'Orbit Radius',
        Description: 'Radial orbital distance from serpent head.',
        Unit: 'px', unit: 'px',
        Tier1: { Min: 60, Max: 90, min: 60, max: 90, unit: 'px' },
        Tier2: { Min: 91, Max: 130, min: 91, max: 130, unit: 'px' },
        Tier3: { Min: 131, Max: 180, min: 131, max: 180, unit: 'px' },
        tier1: { Min: 60, Max: 90, min: 60, max: 90, unit: 'px' },
        tier2: { Min: 91, Max: 130, min: 91, max: 130, unit: 'px' },
        tier3: { Min: 131, Max: 180, min: 131, max: 180, unit: 'px' },
      },
      stateB: {
        Key: 'orbit_radius', key: 'orbit_radius',
        Name: 'Orbit Radius', name: 'Orbit Radius',
        Description: 'Radial orbital distance from serpent head.',
        Unit: 'px', unit: 'px',
        Tier1: { Min: 60, Max: 90, min: 60, max: 90, unit: 'px' },
        Tier2: { Min: 91, Max: 130, min: 91, max: 130, unit: 'px' },
        Tier3: { Min: 131, Max: 180, min: 131, max: 180, unit: 'px' },
        tier1: { Min: 60, Max: 90, min: 60, max: 90, unit: 'px' },
        tier2: { Min: 91, Max: 130, min: 91, max: 130, unit: 'px' },
        tier3: { Min: 131, Max: 180, min: 131, max: 180, unit: 'px' },
      },
      StateC: {
        Key: 'prism_count', key: 'prism_count',
        Name: 'Number of Prisms', name: 'Number of Prisms',
        Description: 'Quantity of orbiting focus crystals.',
        Unit: 'prisms', unit: 'prisms',
        IsInteger: true, isInteger: true,
        Tier1: { Min: 2, Max: 2, min: 2, max: 2, isInteger: true, unit: 'prisms' },
        Tier2: { Min: 3, Max: 3, min: 3, max: 3, isInteger: true, unit: 'prisms' },
        Tier3: { Min: 4, Max: 4, min: 4, max: 4, isInteger: true, unit: 'prisms' },
        tier1: { Min: 2, Max: 2, min: 2, max: 2, isInteger: true, unit: 'prisms' },
        tier2: { Min: 3, Max: 3, min: 3, max: 3, isInteger: true, unit: 'prisms' },
        tier3: { Min: 4, Max: 4, min: 4, max: 4, isInteger: true, unit: 'prisms' },
      },
      stateC: {
        Key: 'prism_count', key: 'prism_count',
        Name: 'Number of Prisms', name: 'Number of Prisms',
        Description: 'Quantity of orbiting focus crystals.',
        Unit: 'prisms', unit: 'prisms',
        IsInteger: true, isInteger: true,
        Tier1: { Min: 2, Max: 2, min: 2, max: 2, isInteger: true, unit: 'prisms' },
        Tier2: { Min: 3, Max: 3, min: 3, max: 3, isInteger: true, unit: 'prisms' },
        Tier3: { Min: 4, Max: 4, min: 4, max: 4, isInteger: true, unit: 'prisms' },
        tier1: { Min: 2, Max: 2, min: 2, max: 2, isInteger: true, unit: 'prisms' },
        tier2: { Min: 3, Max: 3, min: 3, max: 3, isInteger: true, unit: 'prisms' },
        tier3: { Min: 4, Max: 4, min: 4, max: 4, isInteger: true, unit: 'prisms' },
      },
    });

    // 5. Bio-Venom Miasma Nova
    t.Add('bio_venom_miasma_nova', {
      Id: 'bio_venom_miasma_nova', id: 'bio_venom_miasma_nova',
      Name: 'Bio-Venom Miasma Nova', name: 'Bio-Venom Miasma Nova',
      Icon: '🧪', icon: '🧪',
      Color: '#10b981', color: '#10b981',
      Accent: '#a3e635', accent: '#a3e635',
      Description: 'Expanding toxic bio-pulse on eating food that blankets the area in lethal corrosive vapor.',
      desc: 'Expanding toxic bio-pulse on eating food that blankets the area in lethal corrosive vapor.',
      FloorScalingRate: 0.25, floorScalingRate: 0.25,
      StateA: {
        Key: 'nova_radius', key: 'nova_radius',
        Name: 'Nova Radius', name: 'Nova Radius',
        Description: 'Shockwave blast radius emitted on food consumption.',
        Unit: 'px', unit: 'px',
        Tier1: { Min: 70, Max: 100, min: 70, max: 100, unit: 'px' },
        Tier2: { Min: 101, Max: 150, min: 101, max: 150, unit: 'px' },
        Tier3: { Min: 151, Max: 220, min: 151, max: 220, unit: 'px' },
        tier1: { Min: 70, Max: 100, min: 70, max: 100, unit: 'px' },
        tier2: { Min: 101, Max: 150, min: 101, max: 150, unit: 'px' },
        tier3: { Min: 151, Max: 220, min: 151, max: 220, unit: 'px' },
      },
      stateA: {
        Key: 'nova_radius', key: 'nova_radius',
        Name: 'Nova Radius', name: 'Nova Radius',
        Description: 'Shockwave blast radius emitted on food consumption.',
        Unit: 'px', unit: 'px',
        Tier1: { Min: 70, Max: 100, min: 70, max: 100, unit: 'px' },
        Tier2: { Min: 101, Max: 150, min: 101, max: 150, unit: 'px' },
        Tier3: { Min: 151, Max: 220, min: 151, max: 220, unit: 'px' },
        tier1: { Min: 70, Max: 100, min: 70, max: 100, unit: 'px' },
        tier2: { Min: 101, Max: 150, min: 101, max: 150, unit: 'px' },
        tier3: { Min: 151, Max: 220, min: 151, max: 220, unit: 'px' },
      },
      StateB: {
        Key: 'poison_ticks', key: 'poison_ticks',
        Name: 'Poison Ticks', name: 'Poison Ticks',
        Description: 'Total damage delivered across poison cloud lifetime.',
        Unit: 'dmg', unit: 'dmg',
        Tier1: { Min: 20, Max: 35, min: 20, max: 35, unit: 'dmg' },
        Tier2: { Min: 36, Max: 55, min: 36, max: 55, unit: 'dmg' },
        Tier3: { Min: 56, Max: 80, min: 56, max: 80, unit: 'dmg' },
        tier1: { Min: 20, Max: 35, min: 20, max: 35, unit: 'dmg' },
        tier2: { Min: 36, Max: 55, min: 36, max: 55, unit: 'dmg' },
        tier3: { Min: 56, Max: 80, min: 56, max: 80, unit: 'dmg' },
      },
      stateB: {
        Key: 'poison_ticks', key: 'poison_ticks',
        Name: 'Poison Ticks', name: 'Poison Ticks',
        Description: 'Total damage delivered across poison cloud lifetime.',
        Unit: 'dmg', unit: 'dmg',
        Tier1: { Min: 20, Max: 35, min: 20, max: 35, unit: 'dmg' },
        Tier2: { Min: 36, Max: 55, min: 36, max: 55, unit: 'dmg' },
        Tier3: { Min: 56, Max: 80, min: 56, max: 80, unit: 'dmg' },
        tier1: { Min: 20, Max: 35, min: 20, max: 35, unit: 'dmg' },
        tier2: { Min: 36, Max: 55, min: 36, max: 55, unit: 'dmg' },
        tier3: { Min: 56, Max: 80, min: 56, max: 80, unit: 'dmg' },
      },
      StateC: {
        Key: 'food_proc_chance', key: 'food_proc_chance',
        Name: 'Trigger Chance per Food', name: 'Trigger Chance per Food',
        Description: 'Probability of nova trigger upon eating any food.',
        Unit: '%', unit: '%',
        Tier1: { Min: 25, Max: 40, min: 25, max: 40, unit: '%' },
        Tier2: { Min: 41, Max: 65, min: 41, max: 65, unit: '%' },
        Tier3: { Min: 66, Max: 100, min: 66, max: 100, unit: '%' },
        tier1: { Min: 25, Max: 40, min: 25, max: 40, unit: '%' },
        tier2: { Min: 41, Max: 65, min: 41, max: 65, unit: '%' },
        tier3: { Min: 66, Max: 100, min: 66, max: 100, unit: '%' },
      },
      stateC: {
        Key: 'food_proc_chance', key: 'food_proc_chance',
        Name: 'Trigger Chance per Food', name: 'Trigger Chance per Food',
        Description: 'Probability of nova trigger upon eating any food.',
        Unit: '%', unit: '%',
        Tier1: { Min: 25, Max: 40, min: 25, max: 40, unit: '%' },
        Tier2: { Min: 41, Max: 65, min: 41, max: 65, unit: '%' },
        Tier3: { Min: 66, Max: 100, min: 66, max: 100, unit: '%' },
        tier1: { Min: 25, Max: 40, min: 25, max: 40, unit: '%' },
        tier2: { Min: 41, Max: 65, min: 41, max: 65, unit: '%' },
        tier3: { Min: 66, Max: 100, min: 66, max: 100, unit: '%' },
      },
    });

    // 6. Quantum Void Dash
    t.Add('quantum_void_dash', {
      Id: 'quantum_void_dash', id: 'quantum_void_dash',
      Name: 'Quantum Void Dash', name: 'Quantum Void Dash',
      Icon: '⚡', icon: '⚡',
      Color: '#8b5cf6', color: '#8b5cf6',
      Accent: '#c084fc', accent: '#c084fc',
      Description: 'Teleport dash through space bypassing all obstacle damage and disintegrating crossed foes.',
      desc: 'Teleport dash through space bypassing all obstacle damage and disintegrating crossed foes.',
      FloorScalingRate: 0.25, floorScalingRate: 0.25,
      StateA: {
        Key: 'void_damage', key: 'void_damage',
        Name: 'Void Damage', name: 'Void Damage',
        Description: 'True void disintegration damage dealt to crossed foes.',
        Unit: 'dmg', unit: 'dmg',
        Tier1: { Min: 40, Max: 65, min: 40, max: 65, unit: 'dmg' },
        Tier2: { Min: 66, Max: 100, min: 66, max: 100, unit: 'dmg' },
        Tier3: { Min: 101, Max: 160, min: 101, max: 160, unit: 'dmg' },
        tier1: { Min: 40, Max: 65, min: 40, max: 65, unit: 'dmg' },
        tier2: { Min: 66, Max: 100, min: 66, max: 100, unit: 'dmg' },
        tier3: { Min: 101, Max: 160, min: 101, max: 160, unit: 'dmg' },
      },
      stateA: {
        Key: 'void_damage', key: 'void_damage',
        Name: 'Void Damage', name: 'Void Damage',
        Description: 'True void disintegration damage dealt to crossed foes.',
        Unit: 'dmg', unit: 'dmg',
        Tier1: { Min: 40, Max: 65, min: 40, max: 65, unit: 'dmg' },
        Tier2: { Min: 66, Max: 100, min: 66, max: 100, unit: 'dmg' },
        Tier3: { Min: 101, Max: 160, min: 101, max: 160, unit: 'dmg' },
        tier1: { Min: 40, Max: 65, min: 40, max: 65, unit: 'dmg' },
        tier2: { Min: 66, Max: 100, min: 66, max: 100, unit: 'dmg' },
        tier3: { Min: 101, Max: 160, min: 101, max: 160, unit: 'dmg' },
      },
      StateB: {
        Key: 'invuln_extension', key: 'invuln_extension',
        Name: 'Invulnerability Extension', name: 'Invulnerability Extension',
        Description: 'Bonus post-dash invulnerability duration.',
        Unit: 's', unit: 's',
        Tier1: { Min: 0.3, Max: 0.5, min: 0.3, max: 0.5, unit: 's' },
        Tier2: { Min: 0.6, Max: 0.9, min: 0.6, max: 0.9, unit: 's' },
        Tier3: { Min: 1.0, Max: 1.5, min: 1.0, max: 1.5, unit: 's' },
        tier1: { Min: 0.3, Max: 0.5, min: 0.3, max: 0.5, unit: 's' },
        tier2: { Min: 0.6, Max: 0.9, min: 0.6, max: 0.9, unit: 's' },
        tier3: { Min: 1.0, Max: 1.5, min: 1.0, max: 1.5, unit: 's' },
      },
      stateB: {
        Key: 'invuln_extension', key: 'invuln_extension',
        Name: 'Invulnerability Extension', name: 'Invulnerability Extension',
        Description: 'Bonus post-dash invulnerability duration.',
        Unit: 's', unit: 's',
        Tier1: { Min: 0.3, Max: 0.5, min: 0.3, max: 0.5, unit: 's' },
        Tier2: { Min: 0.6, Max: 0.9, min: 0.6, max: 0.9, unit: 's' },
        Tier3: { Min: 1.0, Max: 1.5, min: 1.0, max: 1.5, unit: 's' },
        tier1: { Min: 0.3, Max: 0.5, min: 0.3, max: 0.5, unit: 's' },
        tier2: { Min: 0.6, Max: 0.9, min: 0.6, max: 0.9, unit: 's' },
        tier3: { Min: 1.0, Max: 1.5, min: 1.0, max: 1.5, unit: 's' },
      },
      StateC: {
        Key: 'cooldown_refund_on_kill', key: 'cooldown_refund_on_kill',
        Name: 'Cooldown Refund on Kill', name: 'Cooldown Refund on Kill',
        Description: 'Percentage dash cooldown instantly refunded per kill.',
        Unit: '%', unit: '%',
        Tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: '%' },
        Tier2: { Min: 26, Max: 45, min: 26, max: 45, unit: '%' },
        Tier3: { Min: 46, Max: 75, min: 46, max: 75, unit: '%' },
        tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: '%' },
        tier2: { Min: 26, Max: 45, min: 26, max: 45, unit: '%' },
        tier3: { Min: 46, Max: 75, min: 46, max: 75, unit: '%' },
      },
      stateC: {
        Key: 'cooldown_refund_on_kill', key: 'cooldown_refund_on_kill',
        Name: 'Cooldown Refund on Kill', name: 'Cooldown Refund on Kill',
        Description: 'Percentage dash cooldown instantly refunded per kill.',
        Unit: '%', unit: '%',
        Tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: '%' },
        Tier2: { Min: 26, Max: 45, min: 26, max: 45, unit: '%' },
        Tier3: { Min: 46, Max: 75, min: 46, max: 75, unit: '%' },
        tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: '%' },
        tier2: { Min: 26, Max: 45, min: 26, max: 45, unit: '%' },
        tier3: { Min: 46, Max: 75, min: 46, max: 75, unit: '%' },
      },
    });

    // 7. Nanite Overlord Swarm
    t.Add('nanite_overlord_swarm', {
      Id: 'nanite_overlord_swarm', id: 'nanite_overlord_swarm',
      Name: 'Nanite Overlord Swarm', name: 'Nanite Overlord Swarm',
      Icon: '🦾', icon: '🦾',
      Color: '#06b6d4', color: '#06b6d4',
      Accent: '#67e8f9', accent: '#67e8f9',
      Description: 'Swarming micro-drones seeking out hostiles and repairing serpent segments on impact.',
      desc: 'Swarming micro-drones seeking out hostiles and repairing serpent segments on impact.',
      FloorScalingRate: 0.25, floorScalingRate: 0.25,
      StateA: {
        Key: 'drone_count', key: 'drone_count',
        Name: 'Drone Count', name: 'Drone Count',
        Description: 'Number of autonomous micro-drones active simultaneously.',
        Unit: 'drones', unit: 'drones',
        IsInteger: true, isInteger: true,
        Tier1: { Min: 3, Max: 5, min: 3, max: 5, isInteger: true, unit: 'drones' },
        Tier2: { Min: 6, Max: 9, min: 6, max: 9, isInteger: true, unit: 'drones' },
        Tier3: { Min: 10, Max: 15, min: 10, max: 15, isInteger: true, unit: 'drones' },
        tier1: { Min: 3, Max: 5, min: 3, max: 5, isInteger: true, unit: 'drones' },
        tier2: { Min: 6, Max: 9, min: 6, max: 9, isInteger: true, unit: 'drones' },
        tier3: { Min: 10, Max: 15, min: 10, max: 15, isInteger: true, unit: 'drones' },
      },
      stateA: {
        Key: 'drone_count', key: 'drone_count',
        Name: 'Drone Count', name: 'Drone Count',
        Description: 'Number of autonomous micro-drones active simultaneously.',
        Unit: 'drones', unit: 'drones',
        IsInteger: true, isInteger: true,
        Tier1: { Min: 3, Max: 5, min: 3, max: 5, isInteger: true, unit: 'drones' },
        Tier2: { Min: 6, Max: 9, min: 6, max: 9, isInteger: true, unit: 'drones' },
        Tier3: { Min: 10, Max: 15, min: 10, max: 15, isInteger: true, unit: 'drones' },
        tier1: { Min: 3, Max: 5, min: 3, max: 5, isInteger: true, unit: 'drones' },
        tier2: { Min: 6, Max: 9, min: 6, max: 9, isInteger: true, unit: 'drones' },
        tier3: { Min: 10, Max: 15, min: 10, max: 15, isInteger: true, unit: 'drones' },
      },
      StateB: {
        Key: 'drone_impact_dmg', key: 'drone_impact_dmg',
        Name: 'Drone Impact Dmg', name: 'Drone Impact Dmg',
        Description: 'Kinetic strike damage delivered upon drone divebomb.',
        Unit: 'dmg', unit: 'dmg',
        Tier1: { Min: 12, Max: 20, min: 12, max: 20, unit: 'dmg' },
        Tier2: { Min: 21, Max: 32, min: 21, max: 32, unit: 'dmg' },
        Tier3: { Min: 33, Max: 50, min: 33, max: 50, unit: 'dmg' },
        tier1: { Min: 12, Max: 20, min: 12, max: 20, unit: 'dmg' },
        tier2: { Min: 21, Max: 32, min: 21, max: 32, unit: 'dmg' },
        tier3: { Min: 33, Max: 50, min: 33, max: 50, unit: 'dmg' },
      },
      stateB: {
        Key: 'drone_impact_dmg', key: 'drone_impact_dmg',
        Name: 'Drone Impact Dmg', name: 'Drone Impact Dmg',
        Description: 'Kinetic strike damage delivered upon drone divebomb.',
        Unit: 'dmg', unit: 'dmg',
        Tier1: { Min: 12, Max: 20, min: 12, max: 20, unit: 'dmg' },
        Tier2: { Min: 21, Max: 32, min: 21, max: 32, unit: 'dmg' },
        Tier3: { Min: 33, Max: 50, min: 33, max: 50, unit: 'dmg' },
        tier1: { Min: 12, Max: 20, min: 12, max: 20, unit: 'dmg' },
        tier2: { Min: 21, Max: 32, min: 21, max: 32, unit: 'dmg' },
        tier3: { Min: 33, Max: 50, min: 33, max: 50, unit: 'dmg' },
      },
      StateC: {
        Key: 'heal_per_hit', key: 'heal_per_hit',
        Name: 'Heal per Hit', name: 'Heal per Hit',
        Description: 'Vital HP recovered by the serpent per successful drone impact.',
        Unit: 'HP', unit: 'HP',
        IsInteger: true, isInteger: true,
        Tier1: { Min: 1, Max: 2, min: 1, max: 2, isInteger: true, unit: 'HP' },
        Tier2: { Min: 3, Max: 4, min: 3, max: 4, isInteger: true, unit: 'HP' },
        Tier3: { Min: 5, Max: 7, min: 5, max: 7, isInteger: true, unit: 'HP' },
        tier1: { Min: 1, Max: 2, min: 1, max: 2, isInteger: true, unit: 'HP' },
        tier2: { Min: 3, Max: 4, min: 3, max: 4, isInteger: true, unit: 'HP' },
        tier3: { Min: 5, Max: 7, min: 5, max: 7, isInteger: true, unit: 'HP' },
      },
      stateC: {
        Key: 'heal_per_hit', key: 'heal_per_hit',
        Name: 'Heal per Hit', name: 'Heal per Hit',
        Description: 'Vital HP recovered by the serpent per successful drone impact.',
        Unit: 'HP', unit: 'HP',
        IsInteger: true, isInteger: true,
        Tier1: { Min: 1, Max: 2, min: 1, max: 2, isInteger: true, unit: 'HP' },
        Tier2: { Min: 3, Max: 4, min: 3, max: 4, isInteger: true, unit: 'HP' },
        Tier3: { Min: 5, Max: 7, min: 5, max: 7, isInteger: true, unit: 'HP' },
        tier1: { Min: 1, Max: 2, min: 1, max: 2, isInteger: true, unit: 'HP' },
        tier2: { Min: 3, Max: 4, min: 3, max: 4, isInteger: true, unit: 'HP' },
        tier3: { Min: 5, Max: 7, min: 5, max: 7, isInteger: true, unit: 'HP' },
      },
    });

    // 8. Magnetic Abyss Vortex
    t.Add('magnetic_abyss_vortex', {
      Id: 'magnetic_abyss_vortex', id: 'magnetic_abyss_vortex',
      Name: 'Magnetic Abyss Vortex', name: 'Magnetic Abyss Vortex',
      Icon: '🧲', icon: '🧲',
      Color: '#f59e0b', color: '#f59e0b',
      Accent: '#fbbf24', accent: '#fbbf24',
      Description: 'Gargantuan magnetic field pulling all distant food & shards while crushing trapped hostiles.',
      desc: 'Gargantuan magnetic field pulling all distant food & shards while crushing trapped hostiles.',
      FloorScalingRate: 0.25, floorScalingRate: 0.25,
      StateA: {
        Key: 'magnet_range_mult', key: 'magnet_range_mult',
        Name: 'Magnet Range Multiplier', name: 'Magnet Range Multiplier',
        Description: 'Additive percentage boost to global magnet pickup radius.',
        Unit: '%', unit: '%',
        Tier1: { Min: 80, Max: 140, min: 80, max: 140, unit: '%' },
        Tier2: { Min: 141, Max: 220, min: 141, max: 220, unit: '%' },
        Tier3: { Min: 221, Max: 350, min: 221, max: 350, unit: '%' },
        tier1: { Min: 80, Max: 140, min: 80, max: 140, unit: '%' },
        tier2: { Min: 141, Max: 220, min: 141, max: 220, unit: '%' },
        tier3: { Min: 221, Max: 350, min: 221, max: 350, unit: '%' },
      },
      stateA: {
        Key: 'magnet_range_mult', key: 'magnet_range_mult',
        Name: 'Magnet Range Multiplier', name: 'Magnet Range Multiplier',
        Description: 'Additive percentage boost to global magnet pickup radius.',
        Unit: '%', unit: '%',
        Tier1: { Min: 80, Max: 140, min: 80, max: 140, unit: '%' },
        Tier2: { Min: 141, Max: 220, min: 141, max: 220, unit: '%' },
        Tier3: { Min: 221, Max: 350, min: 221, max: 350, unit: '%' },
        tier1: { Min: 80, Max: 140, min: 80, max: 140, unit: '%' },
        tier2: { Min: 141, Max: 220, min: 141, max: 220, unit: '%' },
        tier3: { Min: 221, Max: 350, min: 221, max: 350, unit: '%' },
      },
      StateB: {
        Key: 'bonus_shard_yield', key: 'bonus_shard_yield',
        Name: 'Bonus Shard Yield', name: 'Bonus Shard Yield',
        Description: 'Bonus meta-progression Sanctuary Shard extraction rate.',
        Unit: '%', unit: '%',
        Tier1: { Min: 20, Max: 35, min: 20, max: 35, unit: '%' },
        Tier2: { Min: 36, Max: 60, min: 36, max: 60, unit: '%' },
        Tier3: { Min: 61, Max: 100, min: 61, max: 100, unit: '%' },
        tier1: { Min: 20, Max: 35, min: 20, max: 35, unit: '%' },
        tier2: { Min: 36, Max: 60, min: 36, max: 60, unit: '%' },
        tier3: { Min: 61, Max: 100, min: 61, max: 100, unit: '%' },
      },
      stateB: {
        Key: 'bonus_shard_yield', key: 'bonus_shard_yield',
        Name: 'Bonus Shard Yield', name: 'Bonus Shard Yield',
        Description: 'Bonus meta-progression Sanctuary Shard extraction rate.',
        Unit: '%', unit: '%',
        Tier1: { Min: 20, Max: 35, min: 20, max: 35, unit: '%' },
        Tier2: { Min: 36, Max: 60, min: 36, max: 60, unit: '%' },
        Tier3: { Min: 61, Max: 100, min: 61, max: 100, unit: '%' },
        tier1: { Min: 20, Max: 35, min: 20, max: 35, unit: '%' },
        tier2: { Min: 36, Max: 60, min: 36, max: 60, unit: '%' },
        tier3: { Min: 61, Max: 100, min: 61, max: 100, unit: '%' },
      },
      StateC: {
        Key: 'kinetic_impact_dmg', key: 'kinetic_impact_dmg',
        Name: 'Kinetic Impact Dmg', name: 'Kinetic Impact Dmg',
        Description: 'Crushing kinetic damage inflicted on hostiles dragged into vortex.',
        Unit: 'dmg', unit: 'dmg',
        Tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: 'dmg' },
        Tier2: { Min: 26, Max: 40, min: 26, max: 40, unit: 'dmg' },
        Tier3: { Min: 41, Max: 65, min: 41, max: 65, unit: 'dmg' },
        tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: 'dmg' },
        tier2: { Min: 26, Max: 40, min: 26, max: 40, unit: 'dmg' },
        tier3: { Min: 41, Max: 65, min: 41, max: 65, unit: 'dmg' },
      },
      stateC: {
        Key: 'kinetic_impact_dmg', key: 'kinetic_impact_dmg',
        Name: 'Kinetic Impact Dmg', name: 'Kinetic Impact Dmg',
        Description: 'Crushing kinetic damage inflicted on hostiles dragged into vortex.',
        Unit: 'dmg', unit: 'dmg',
        Tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: 'dmg' },
        Tier2: { Min: 26, Max: 40, min: 26, max: 40, unit: 'dmg' },
        Tier3: { Min: 41, Max: 65, min: 41, max: 65, unit: 'dmg' },
        tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: 'dmg' },
        tier2: { Min: 26, Max: 40, min: 26, max: 40, unit: 'dmg' },
        tier3: { Min: 41, Max: 65, min: 41, max: 65, unit: 'dmg' },
      },
    });

    // 9. Solar Flare Eruption
    t.Add('solar_flare_eruption', {
      Id: 'solar_flare_eruption', id: 'solar_flare_eruption',
      Name: 'Solar Flare Eruption', name: 'Solar Flare Eruption',
      Icon: '☀️', icon: '☀️',
      Color: '#ea580c', color: '#ea580c',
      Accent: '#fde047', accent: '#fde047',
      Description: 'Radial solar plasma burst when taking damage, blinding aggressors and recharging shields.',
      desc: 'Radial solar plasma burst when taking damage, blinding aggressors and recharging shields.',
      FloorScalingRate: 0.25, floorScalingRate: 0.25,
      StateA: {
        Key: 'solar_burst_dmg', key: 'solar_burst_dmg',
        Name: 'Solar Burst Dmg', name: 'Solar Burst Dmg',
        Description: 'Retaliatory solar blast damage dealt to all nearby hostiles.',
        Unit: 'dmg', unit: 'dmg',
        Tier1: { Min: 50, Max: 80, min: 50, max: 80, unit: 'dmg' },
        Tier2: { Min: 81, Max: 130, min: 81, max: 130, unit: 'dmg' },
        Tier3: { Min: 131, Max: 200, min: 131, max: 200, unit: 'dmg' },
        tier1: { Min: 50, Max: 80, min: 50, max: 80, unit: 'dmg' },
        tier2: { Min: 81, Max: 130, min: 81, max: 130, unit: 'dmg' },
        tier3: { Min: 131, Max: 200, min: 131, max: 200, unit: 'dmg' },
      },
      stateA: {
        Key: 'solar_burst_dmg', key: 'solar_burst_dmg',
        Name: 'Solar Burst Dmg', name: 'Solar Burst Dmg',
        Description: 'Retaliatory solar blast damage dealt to all nearby hostiles.',
        Unit: 'dmg', unit: 'dmg',
        Tier1: { Min: 50, Max: 80, min: 50, max: 80, unit: 'dmg' },
        Tier2: { Min: 81, Max: 130, min: 81, max: 130, unit: 'dmg' },
        Tier3: { Min: 131, Max: 200, min: 131, max: 200, unit: 'dmg' },
        tier1: { Min: 50, Max: 80, min: 50, max: 80, unit: 'dmg' },
        tier2: { Min: 81, Max: 130, min: 81, max: 130, unit: 'dmg' },
        tier3: { Min: 131, Max: 200, min: 131, max: 200, unit: 'dmg' },
      },
      StateB: {
        Key: 'blind_duration', key: 'blind_duration',
        Name: 'Blind/Stun Duration', name: 'Blind/Stun Duration',
        Description: 'Stun and accuracy impairment duration inflicted on hostiles.',
        Unit: 's', unit: 's',
        Tier1: { Min: 1.0, Max: 1.8, min: 1.0, max: 1.8, unit: 's' },
        Tier2: { Min: 1.9, Max: 2.8, min: 1.9, max: 2.8, unit: 's' },
        Tier3: { Min: 2.9, Max: 4.0, min: 2.9, max: 4.0, unit: 's' },
        tier1: { Min: 1.0, Max: 1.8, min: 1.0, max: 1.8, unit: 's' },
        tier2: { Min: 1.9, Max: 2.8, min: 1.9, max: 2.8, unit: 's' },
        tier3: { Min: 2.9, Max: 4.0, min: 2.9, max: 4.0, unit: 's' },
      },
      stateB: {
        Key: 'blind_duration', key: 'blind_duration',
        Name: 'Blind/Stun Duration', name: 'Blind/Stun Duration',
        Description: 'Stun and accuracy impairment duration inflicted on hostiles.',
        Unit: 's', unit: 's',
        Tier1: { Min: 1.0, Max: 1.8, min: 1.0, max: 1.8, unit: 's' },
        Tier2: { Min: 1.9, Max: 2.8, min: 1.9, max: 2.8, unit: 's' },
        Tier3: { Min: 2.9, Max: 4.0, min: 2.9, max: 4.0, unit: 's' },
        tier1: { Min: 1.0, Max: 1.8, min: 1.0, max: 1.8, unit: 's' },
        tier2: { Min: 1.9, Max: 2.8, min: 1.9, max: 2.8, unit: 's' },
        tier3: { Min: 2.9, Max: 4.0, min: 2.9, max: 4.0, unit: 's' },
      },
      StateC: {
        Key: 'shield_kickback', key: 'shield_kickback',
        Name: 'Shield Recharge Kickback', name: 'Shield Recharge Kickback',
        Description: 'Instant shield pool restoration percentage on trigger.',
        Unit: '%', unit: '%',
        Tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: '%' },
        Tier2: { Min: 26, Max: 40, min: 26, max: 40, unit: '%' },
        Tier3: { Min: 41, Max: 60, min: 41, max: 60, unit: '%' },
        tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: '%' },
        tier2: { Min: 26, Max: 40, min: 26, max: 40, unit: '%' },
        tier3: { Min: 41, Max: 60, min: 41, max: 60, unit: '%' },
      },
      stateC: {
        Key: 'shield_kickback', key: 'shield_kickback',
        Name: 'Shield Recharge Kickback', name: 'Shield Recharge Kickback',
        Description: 'Instant shield pool restoration percentage on trigger.',
        Unit: '%', unit: '%',
        Tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: '%' },
        Tier2: { Min: 26, Max: 40, min: 26, max: 40, unit: '%' },
        Tier3: { Min: 41, Max: 60, min: 41, max: 60, unit: '%' },
        tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: '%' },
        tier2: { Min: 26, Max: 40, min: 26, max: 40, unit: '%' },
        tier3: { Min: 41, Max: 60, min: 41, max: 60, unit: '%' },
      },
    });

    // 10. Frostfire Aurora
    t.Add('frostfire_aurora', {
      Id: 'frostfire_aurora', id: 'frostfire_aurora',
      Name: 'Frostfire Aurora', name: 'Frostfire Aurora',
      Icon: '❄️', icon: '❄️',
      Color: '#38bdf8', color: '#38bdf8',
      Accent: '#f43f5e', accent: '#f43f5e',
      Description: 'Permanent polar thermal aura slowing enemies and amplifying all elemental damage.',
      desc: 'Permanent polar thermal aura slowing enemies and amplifying all elemental damage.',
      FloorScalingRate: 0.25, floorScalingRate: 0.25,
      StateA: {
        Key: 'slow_percentage', key: 'slow_percentage',
        Name: 'Slow Percentage', name: 'Slow Percentage',
        Description: 'Movement speed penalty applied to enemies within the aurora.',
        Unit: '%', unit: '%',
        Tier1: { Min: 25, Max: 35, min: 25, max: 35, unit: '%' },
        Tier2: { Min: 36, Max: 50, min: 36, max: 50, unit: '%' },
        Tier3: { Min: 51, Max: 70, min: 51, max: 70, unit: '%' },
        tier1: { Min: 25, Max: 35, min: 25, max: 35, unit: '%' },
        tier2: { Min: 36, Max: 50, min: 36, max: 50, unit: '%' },
        tier3: { Min: 51, Max: 70, min: 51, max: 70, unit: '%' },
      },
      stateA: {
        Key: 'slow_percentage', key: 'slow_percentage',
        Name: 'Slow Percentage', name: 'Slow Percentage',
        Description: 'Movement speed penalty applied to enemies within the aurora.',
        Unit: '%', unit: '%',
        Tier1: { Min: 25, Max: 35, min: 25, max: 35, unit: '%' },
        Tier2: { Min: 36, Max: 50, min: 36, max: 50, unit: '%' },
        Tier3: { Min: 51, Max: 70, min: 51, max: 70, unit: '%' },
        tier1: { Min: 25, Max: 35, min: 25, max: 35, unit: '%' },
        tier2: { Min: 36, Max: 50, min: 36, max: 50, unit: '%' },
        tier3: { Min: 51, Max: 70, min: 51, max: 70, unit: '%' },
      },
      StateB: {
        Key: 'elemental_vulnerability', key: 'elemental_vulnerability',
        Name: 'Elemental Vulnerability', name: 'Elemental Vulnerability',
        Description: 'Bonus damage multiplier for fire, frost, and shock attacks.',
        Unit: '%', unit: '%',
        Tier1: { Min: 20, Max: 35, min: 20, max: 35, unit: '%' },
        Tier2: { Min: 36, Max: 55, min: 36, max: 55, unit: '%' },
        Tier3: { Min: 56, Max: 85, min: 56, max: 85, unit: '%' },
        tier1: { Min: 20, Max: 35, min: 20, max: 35, unit: '%' },
        tier2: { Min: 36, Max: 55, min: 36, max: 55, unit: '%' },
        tier3: { Min: 56, Max: 85, min: 56, max: 85, unit: '%' },
      },
      stateB: {
        Key: 'elemental_vulnerability', key: 'elemental_vulnerability',
        Name: 'Elemental Vulnerability', name: 'Elemental Vulnerability',
        Description: 'Bonus damage multiplier for fire, frost, and shock attacks.',
        Unit: '%', unit: '%',
        Tier1: { Min: 20, Max: 35, min: 20, max: 35, unit: '%' },
        Tier2: { Min: 36, Max: 55, min: 36, max: 55, unit: '%' },
        Tier3: { Min: 56, Max: 85, min: 56, max: 85, unit: '%' },
        tier1: { Min: 20, Max: 35, min: 20, max: 35, unit: '%' },
        tier2: { Min: 36, Max: 55, min: 36, max: 55, unit: '%' },
        tier3: { Min: 56, Max: 85, min: 56, max: 85, unit: '%' },
      },
      StateC: {
        Key: 'aura_radius', key: 'aura_radius',
        Name: 'Aura Radius', name: 'Aura Radius',
        Description: 'Radial coverage area of polar aurora field.',
        Unit: 'px', unit: 'px',
        Tier1: { Min: 80, Max: 120, min: 80, max: 120, unit: 'px' },
        Tier2: { Min: 121, Max: 170, min: 121, max: 170, unit: 'px' },
        Tier3: { Min: 171, Max: 240, min: 171, max: 240, unit: 'px' },
        tier1: { Min: 80, Max: 120, min: 80, max: 120, unit: 'px' },
        tier2: { Min: 121, Max: 170, min: 121, max: 170, unit: 'px' },
        tier3: { Min: 171, Max: 240, min: 171, max: 240, unit: 'px' },
      },
      stateC: {
        Key: 'aura_radius', key: 'aura_radius',
        Name: 'Aura Radius', name: 'Aura Radius',
        Description: 'Radial coverage area of polar aurora field.',
        Unit: 'px', unit: 'px',
        Tier1: { Min: 80, Max: 120, min: 80, max: 120, unit: 'px' },
        Tier2: { Min: 121, Max: 170, min: 121, max: 170, unit: 'px' },
        Tier3: { Min: 171, Max: 240, min: 171, max: 240, unit: 'px' },
        tier1: { Min: 80, Max: 120, min: 80, max: 120, unit: 'px' },
        tier2: { Min: 121, Max: 170, min: 121, max: 170, unit: 'px' },
        tier3: { Min: 171, Max: 240, min: 171, max: 240, unit: 'px' },
      },
    });

    // 11. Kinetic Shockwave Pulser
    t.Add('kinetic_shockwave_pulser', {
      Id: 'kinetic_shockwave_pulser', id: 'kinetic_shockwave_pulser',
      Name: 'Kinetic Shockwave Pulser', name: 'Kinetic Shockwave Pulser',
      Icon: '💥', icon: '💥',
      Color: '#ec4899', color: '#ec4899',
      Accent: '#f472b6', accent: '#f472b6',
      Description: 'Massive sonic shockwaves emitting from the snake tail on every sharp turn.',
      desc: 'Massive sonic shockwaves emitting from the snake tail on every sharp turn.',
      FloorScalingRate: 0.25, floorScalingRate: 0.25,
      StateA: {
        Key: 'shockwave_damage', key: 'shockwave_damage',
        Name: 'Shockwave Damage', name: 'Shockwave Damage',
        Description: 'Kinetic sonic blast damage delivered upon wavefront contact.',
        Unit: 'dmg', unit: 'dmg',
        Tier1: { Min: 25, Max: 40, min: 25, max: 40, unit: 'dmg' },
        Tier2: { Min: 41, Max: 65, min: 41, max: 65, unit: 'dmg' },
        Tier3: { Min: 66, Max: 100, min: 66, max: 100, unit: 'dmg' },
        tier1: { Min: 25, Max: 40, min: 25, max: 40, unit: 'dmg' },
        tier2: { Min: 41, Max: 65, min: 41, max: 65, unit: 'dmg' },
        tier3: { Min: 66, Max: 100, min: 66, max: 100, unit: 'dmg' },
      },
      stateA: {
        Key: 'shockwave_damage', key: 'shockwave_damage',
        Name: 'Shockwave Damage', name: 'Shockwave Damage',
        Description: 'Kinetic sonic blast damage delivered upon wavefront contact.',
        Unit: 'dmg', unit: 'dmg',
        Tier1: { Min: 25, Max: 40, min: 25, max: 40, unit: 'dmg' },
        Tier2: { Min: 41, Max: 65, min: 41, max: 65, unit: 'dmg' },
        Tier3: { Min: 66, Max: 100, min: 66, max: 100, unit: 'dmg' },
        tier1: { Min: 25, Max: 40, min: 25, max: 40, unit: 'dmg' },
        tier2: { Min: 41, Max: 65, min: 41, max: 65, unit: 'dmg' },
        tier3: { Min: 66, Max: 100, min: 66, max: 100, unit: 'dmg' },
      },
      StateB: {
        Key: 'knockback_force', key: 'knockback_force',
        Name: 'Knockback Force', name: 'Knockback Force',
        Description: 'Physical displacement impulse applied to hostiles.',
        Unit: 'force', unit: 'force',
        Tier1: { Min: 120, Max: 180, min: 120, max: 180, unit: 'force' },
        Tier2: { Min: 181, Max: 260, min: 181, max: 260, unit: 'force' },
        Tier3: { Min: 261, Max: 380, min: 261, max: 380, unit: 'force' },
        tier1: { Min: 120, Max: 180, min: 120, max: 180, unit: 'force' },
        tier2: { Min: 181, Max: 260, min: 181, max: 260, unit: 'force' },
        tier3: { Min: 261, Max: 380, min: 261, max: 380, unit: 'force' },
      },
      stateB: {
        Key: 'knockback_force', key: 'knockback_force',
        Name: 'Knockback Force', name: 'Knockback Force',
        Description: 'Physical displacement impulse applied to hostiles.',
        Unit: 'force', unit: 'force',
        Tier1: { Min: 120, Max: 180, min: 120, max: 180, unit: 'force' },
        Tier2: { Min: 181, Max: 260, min: 181, max: 260, unit: 'force' },
        Tier3: { Min: 261, Max: 380, min: 261, max: 380, unit: 'force' },
        tier1: { Min: 120, Max: 180, min: 120, max: 180, unit: 'force' },
        tier2: { Min: 181, Max: 260, min: 181, max: 260, unit: 'force' },
        tier3: { Min: 261, Max: 380, min: 261, max: 380, unit: 'force' },
      },
      StateC: {
        Key: 'turn_angle_threshold', key: 'turn_angle_threshold',
        Name: 'Turn Angle Threshold', name: 'Turn Angle Threshold',
        Description: 'Minimum angular deflection required to trigger shockwave (lower is better).',
        Unit: 'deg', unit: 'deg',
        HigherIsBetter: false, higherIsBetter: false,
        Tier1: { Min: 30, Max: 45, min: 30, max: 45, unit: 'deg' },
        Tier2: { Min: 20, Max: 29, min: 20, max: 29, unit: 'deg' },
        Tier3: { Min: 10, Max: 19, min: 10, max: 19, unit: 'deg' },
        tier1: { Min: 30, Max: 45, min: 30, max: 45, unit: 'deg' },
        tier2: { Min: 20, Max: 29, min: 20, max: 29, unit: 'deg' },
        tier3: { Min: 10, Max: 19, min: 10, max: 19, unit: 'deg' },
      },
      stateC: {
        Key: 'turn_angle_threshold', key: 'turn_angle_threshold',
        Name: 'Turn Angle Threshold', name: 'Turn Angle Threshold',
        Description: 'Minimum angular deflection required to trigger shockwave (lower is better).',
        Unit: 'deg', unit: 'deg',
        HigherIsBetter: false, higherIsBetter: false,
        Tier1: { Min: 30, Max: 45, min: 30, max: 45, unit: 'deg' },
        Tier2: { Min: 20, Max: 29, min: 20, max: 29, unit: 'deg' },
        Tier3: { Min: 10, Max: 19, min: 10, max: 19, unit: 'deg' },
        tier1: { Min: 30, Max: 45, min: 30, max: 45, unit: 'deg' },
        tier2: { Min: 20, Max: 29, min: 20, max: 29, unit: 'deg' },
        tier3: { Min: 10, Max: 19, min: 10, max: 19, unit: 'deg' },
      },
    });

    // 12. Leviathan Crystalline Carapace
    t.Add('leviathan_crystalline_carapace', {
      Id: 'leviathan_crystalline_carapace', id: 'leviathan_crystalline_carapace',
      Name: 'Leviathan Crystal Carapace', name: 'Leviathan Crystal Carapace',
      Icon: '🛡️', icon: '🛡️',
      Color: '#6366f1', color: '#6366f1',
      Accent: '#a5b4fc', accent: '#a5b4fc',
      Description: 'Reactive crystal armor reflecting projectiles and granting stacking damage resistance.',
      desc: 'Reactive crystal armor reflecting projectiles and granting stacking damage resistance.',
      FloorScalingRate: 0.25, floorScalingRate: 0.25,
      StateA: {
        Key: 'damage_reduction', key: 'damage_reduction',
        Name: 'Damage Reduction', name: 'Damage Reduction',
        Description: 'Flat percentage reduction on all incoming damage.',
        Unit: '%', unit: '%',
        Tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: '%' },
        Tier2: { Min: 26, Max: 38, min: 26, max: 38, unit: '%' },
        Tier3: { Min: 39, Max: 55, min: 39, max: 55, unit: '%' },
        tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: '%' },
        tier2: { Min: 26, Max: 38, min: 26, max: 38, unit: '%' },
        tier3: { Min: 39, Max: 55, min: 39, max: 55, unit: '%' },
      },
      stateA: {
        Key: 'damage_reduction', key: 'damage_reduction',
        Name: 'Damage Reduction', name: 'Damage Reduction',
        Description: 'Flat percentage reduction on all incoming damage.',
        Unit: '%', unit: '%',
        Tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: '%' },
        Tier2: { Min: 26, Max: 38, min: 26, max: 38, unit: '%' },
        Tier3: { Min: 39, Max: 55, min: 39, max: 55, unit: '%' },
        tier1: { Min: 15, Max: 25, min: 15, max: 25, unit: '%' },
        tier2: { Min: 26, Max: 38, min: 26, max: 38, unit: '%' },
        tier3: { Min: 39, Max: 55, min: 39, max: 55, unit: '%' },
      },
      StateB: {
        Key: 'projectile_deflection', key: 'projectile_deflection',
        Name: 'Projectile Deflection Velocity', name: 'Projectile Deflection Velocity',
        Description: 'Velocity multiplier for reflected enemy projectiles.',
        Unit: 'x', unit: 'x',
        Tier1: { Min: 1.5, Max: 2.0, min: 1.5, max: 2.0, unit: 'x' },
        Tier2: { Min: 2.1, Max: 3.0, min: 2.1, max: 3.0, unit: 'x' },
        Tier3: { Min: 3.1, Max: 4.5, min: 3.1, max: 4.5, unit: 'x' },
        tier1: { Min: 1.5, Max: 2.0, min: 1.5, max: 2.0, unit: 'x' },
        tier2: { Min: 2.1, Max: 3.0, min: 2.1, max: 3.0, unit: 'x' },
        tier3: { Min: 3.1, Max: 4.5, min: 3.1, max: 4.5, unit: 'x' },
      },
      stateB: {
        Key: 'projectile_deflection', key: 'projectile_deflection',
        Name: 'Projectile Deflection Velocity', name: 'Projectile Deflection Velocity',
        Description: 'Velocity multiplier for reflected enemy projectiles.',
        Unit: 'x', unit: 'x',
        Tier1: { Min: 1.5, Max: 2.0, min: 1.5, max: 2.0, unit: 'x' },
        Tier2: { Min: 2.1, Max: 3.0, min: 2.1, max: 3.0, unit: 'x' },
        Tier3: { Min: 3.1, Max: 4.5, min: 3.1, max: 4.5, unit: 'x' },
        tier1: { Min: 1.5, Max: 2.0, min: 1.5, max: 2.0, unit: 'x' },
        tier2: { Min: 2.1, Max: 3.0, min: 2.1, max: 3.0, unit: 'x' },
        tier3: { Min: 3.1, Max: 4.5, min: 3.1, max: 4.5, unit: 'x' },
      },
      StateC: {
        Key: 'max_crystal_stacks', key: 'max_crystal_stacks',
        Name: 'Max Crystal Stacks', name: 'Max Crystal Stacks',
        Description: 'Maximum crystal layers before prismatic discharge.',
        Unit: 'stacks', unit: 'stacks',
        IsInteger: true, isInteger: true,
        Tier1: { Min: 5, Max: 5, min: 5, max: 5, isInteger: true, unit: 'stacks' },
        Tier2: { Min: 8, Max: 8, min: 8, max: 8, isInteger: true, unit: 'stacks' },
        Tier3: { Min: 12, Max: 12, min: 12, max: 12, isInteger: true, unit: 'stacks' },
        tier1: { Min: 5, Max: 5, min: 5, max: 5, isInteger: true, unit: 'stacks' },
        tier2: { Min: 8, Max: 8, min: 8, max: 8, isInteger: true, unit: 'stacks' },
        tier3: { Min: 12, Max: 12, min: 12, max: 12, isInteger: true, unit: 'stacks' },
      },
      stateC: {
        Key: 'max_crystal_stacks', key: 'max_crystal_stacks',
        Name: 'Max Crystal Stacks', name: 'Max Crystal Stacks',
        Description: 'Maximum crystal layers before prismatic discharge.',
        Unit: 'stacks', unit: 'stacks',
        IsInteger: true, isInteger: true,
        Tier1: { Min: 5, Max: 5, min: 5, max: 5, isInteger: true, unit: 'stacks' },
        Tier2: { Min: 8, Max: 8, min: 8, max: 8, isInteger: true, unit: 'stacks' },
        Tier3: { Min: 12, Max: 12, min: 12, max: 12, isInteger: true, unit: 'stacks' },
        tier1: { Min: 5, Max: 5, min: 5, max: 5, isInteger: true, unit: 'stacks' },
        tier2: { Min: 8, Max: 8, min: 8, max: 8, isInteger: true, unit: 'stacks' },
        tier3: { Min: 12, Max: 12, min: 12, max: 12, isInteger: true, unit: 'stacks' },
      },
    });

    return t;
  }

  /**
   * Deterministically resolves the Special Capacity for a given daily key or seed.
   */
  public static getDailyCapacity(keyOrSeed: string | number): CosmicCapacityDef {
    const seed = typeof keyOrSeed === 'number'
      ? (keyOrSeed >>> 0)
      : Rng.hash(`ouroboros-daily-${keyOrSeed}`);
    const idx = Math.abs(seed) % CosmicCapacities.Catalog.count;
    const key = CosmicCapacities.Catalog.keys[idx]!;
    return CosmicCapacities.Catalog.get(key)!;
  }

  /**
   * Rolls a single parameter state from its 3 tier brackets using a deterministic PRNG instance:
   *
   * Tier Selection Probability (ORACLE.md §11.1):
   *   $$\text{Tier} = \begin{cases} 1 & \text{if } U < 0.50 \quad (50\% \text{ weight}) \\ 2 & \text{if } 0.50 \le U < 0.85 \quad (35\% \text{ weight}) \\ 3 & \text{otherwise} \quad (15\% \text{ weight}) \end{cases}$$
   *
   * Escalation Scaling Formulation:
   * - Power / Magnitude Affixes ($\text{HigherIsBetter} \neq \text{false}$):
   *   $$V_{\text{scaled}} = V_{\text{raw}} \cdot (1.0 + (\text{Floor} - 1) \cdot 0.25)$$
   * - Cooldown / Interval Affixes ($\text{HigherIsBetter} = \text{false}$):
   *   $$V_{\text{scaled}} = V_{\text{raw}} \cdot \max(0.30, 1.0 - (\text{Floor} - 1) \cdot 0.10)$$
   *
   * @param param Capacity parameter definition with tier brackets.
   * @param rng Deterministic PRNG stream.
   * @param floor Current expedition floor depth.
   * @returns Rolled state with raw and scaled numeric values.
   */
  private static rollParamState(
    param: CapacityParamDef,
    rng: Rng,
    floor: number
  ): RolledCapacityState {
    const tierRoll = rng.rand();
    const tier: 1 | 2 | 3 = tierRoll < 0.50 ? 1 : tierRoll < 0.85 ? 2 : 3;
    const bracket = tier === 1 ? param.Tier1 : tier === 2 ? param.Tier2 : param.Tier3;

    let rawVal: number;
    if (bracket.IsInteger) {
      rawVal = rng.int(bracket.Min, bracket.Max);
    } else {
      rawVal = MathX.roundJs(rng.range(bracket.Min, bracket.Max) * 10) / 10;
    }

    // Floor escalation (+25% power per floor above floor 1)
    const floorMult = 1.0 + (Math.max(1, floor) - 1) * 0.25;
    let scaledVal: number;
    if (param.HigherIsBetter === false) {
      // For intervals / cooldowns where lower is better
      scaledVal = MathX.roundJs(rawVal * Math.max(0.30, 1.0 - (Math.max(1, floor) - 1) * 0.10) * 10) / 10;
    } else {
      scaledVal = bracket.IsInteger ? Math.round(rawVal * floorMult) : MathX.roundJs(rawVal * floorMult * 10) / 10;
    }

    return {
      Key: param.Key, key: param.Key,
      Name: param.Name, name: param.Name,
      Tier: tier, tier: tier,
      RawValue: rawVal, rawValue: rawVal,
      ScaledValue: scaledVal, scaledValue: scaledVal,
      Unit: param.Unit, unit: param.Unit,
      Description: param.Description, description: param.Description,
    };
  }

  /**
   * Rolls a complete Cosmic Capacity with its 3 parameters and floor scaling for a given seed and floor:
   *
   * Composite Power Rating Formulation:
   *   $$\text{PowerRating} = \left\lfloor (T_A + T_B + T_C) \cdot 100 \cdot (1.0 + (\text{Floor} - 1) \cdot 0.25) + 0.5 \right\rfloor$$
   *
   * Composite Tier Classification:
   *   $$\bar{T} = \frac{T_A + T_B + T_C}{3}$$
   *   $$\text{OverallTier} = \begin{cases} 1 & \text{if } \bar{T} < 1.66 \\ 2 & \text{if } 1.66 \le \bar{T} < 2.34 \\ 3 & \text{otherwise} \end{cases}$$
   *
   * @param keyOrSeed Daily string date key (e.g. '2026-09-06') or numeric seed.
   * @param floor Current expedition floor level.
   * @returns Rolled Cosmic Capacity with all parameter states and ratings.
   */
  public static rollDailyCapacity(
    keyOrSeed: string | number,
    floor: number = 1
  ): RolledCosmicCapacity {
    const seed = typeof keyOrSeed === 'number'
      ? (keyOrSeed >>> 0)
      : Rng.hash(`ouroboros-daily-${keyOrSeed}`);
    const def = CosmicCapacities.getDailyCapacity(seed);
    const rng = new Rng(seed);

    const sA = CosmicCapacities.rollParamState(def.StateA, rng, floor);
    const sB = CosmicCapacities.rollParamState(def.StateB, rng, floor);
    const sC = CosmicCapacities.rollParamState(def.StateC, rng, floor);

    const avgTier = (sA.Tier + sB.Tier + sC.Tier) / 3;
    const overallTier: 1 | 2 | 3 = avgTier < 1.66 ? 1 : avgTier < 2.34 ? 2 : 3;
    const powerRating = Math.round((sA.Tier * 100 + sB.Tier * 100 + sC.Tier * 100) * (1.0 + (floor - 1) * 0.25));

    return {
      Def: def, def: def,
      Seed: seed, seed: seed,
      Floor: floor, floor: floor,
      OverallTier: overallTier, overallTier: overallTier,
      StateA: sA, stateA: sA,
      StateB: sB, stateB: sB,
      StateC: sC, stateC: sC,
      PowerRating: powerRating, powerRating: powerRating,
    };
  }

  /**
   * Calculates floor escalation scaling (+25% power per floor).
   * Formula: P(floor) = BasePower * (1.0 + 0.25 * (floor - 1))
   */
  public static getScaledCapacityPower(basePower: number, floor: number): number {
    const f = Math.max(1, Math.floor(floor));
    const mult = 1.0 + 0.25 * (f - 1);
    return MathX.roundJs(basePower * mult);
  }

  /**
   * Computes UTC 23:59:59.999 expiration timestamp for a given date input.
   */
  public static getDailyExpirationTimestamp(dateInput?: Date | string | number): number {
    const d = dateInput instanceof Date
      ? new Date(dateInput.getTime())
      : dateInput !== undefined
        ? new Date(dateInput)
        : new Date();

    return Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      23, 59, 59, 999
    );
  }

  /**
   * Validates if a daily capacity timestamp has expired.
   */
  public static isDailyCapacityExpired(expirationTimestamp: number, currentTimestamp?: number): boolean {
    const now = currentTimestamp !== undefined ? currentTimestamp : Date.now();
    return now > expirationTimestamp;
  }
}
