/**
 * ============================================================================
 * SUPPRESSED LEGACY CANVAS2D RENDERER (Rule 12: Absolute Canvas2D Ban)
 * ============================================================================
 * Canvas 2D rendering is permanently banished from Ouroboros Ascension.
 * All serpentine meshes, continuous body ribbons, scales, cranial arcs,
 * eye glints, and equipped boss helmets render strictly through pure WebGL 2.0
 * in WebGLGameRenderer.ts (drawPlayer, drawHelmet) and GLBatch.ts.
 * All Canvas 2D methods in this file are suppressed stubs.
 * ============================================================================
 */

export interface ISnakeSegment {
  x: number;
  y: number;
  r: number;
  angle: number;
  hp?: number;
  maxHp?: number;
  hitFlash?: number;
  damageFlash?: number;
}

export interface IAfterimage {
  x: number;
  y: number;
  angle: number;
  life: number;
  max: number;
}

export interface ISnakeRenderData {
  x: number;
  y: number;
  angle: number;
  headRadius: number;
  classId: string;
  color: string;
  accent: string;
  headHp?: number;
  headMaxHp?: number;
  segments: ISnakeSegment[];
  afterimages?: IAfterimage[];
  invulnerableTimer?: number;
  hurtFlash?: number;
  mouthOpen?: number;
  eyeBlinking?: boolean;
  bodyPulse?: number;
  shield?: number;
  maxShield?: number;
  relics?: Record<string, number>;
  orbitals?: Array<{ x: number; y: number; a: number }>;
  helmet?: {
    rarity?: string;
    icon?: string;
    name?: string;
    bossType?: string;
    archetype?: string;
    [key: string]: any;
  };
}

export class SnakeRenderer {
  /**
   * Resolves the helmet visual archetype from bossType, explicit archetype, or item name.
   */
  public static resolveHelmetArchetype(helmet?: { rarity?: string; name?: string; bossType?: string; archetype?: string; [key: string]: any } | null): 'centipede' | 'colossus' | 'leviathan' | 'chrono' | 'gorgon' | 'void' {
    if (!helmet) return 'centipede';

    const rawType = ((helmet.archetype || helmet.bossType || (helmet as any).BossType) || '').toLowerCase();
    const rawName = ((helmet.name || (helmet as any).Name) || '').toLowerCase();

    if (rawType.includes('centipede') || rawType.includes('swarmling') || rawType.includes('hivemind')) return 'centipede';
    if (rawType.includes('colossus') || rawType.includes('brute')) return 'colossus';
    if (rawType.includes('leviathan') || rawType.includes('frostwyrm') || rawType.includes('cryo')) return 'leviathan';
    if (rawType.includes('chrono') || rawType.includes('superconductor')) return 'chrono';
    if (rawType.includes('gorgon') || rawType.includes('drone')) return 'gorgon';
    if (rawType.includes('void') || rawType.includes('phantom') || rawType.includes('shadow')) return 'void';

    if (/centipede|chitin|myriapod|swarmling|carapace|hive/i.test(rawName)) return 'centipede';
    if (/colossus|infernal|magmatic|titan|obsidian|furnace|smoldering|bulwark|greathelm|bascinet|iron|steel/i.test(rawName)) return 'colossus';
    if (/leviathan|abyssal|aquatic|glacial|frost|azure|ocean|deep|tide/i.test(rawName)) return 'leviathan';
    if (/chrono|temporal|time|dilation|tiara|clockwork|paradox|tachyon|diadem/i.test(rawName)) return 'chrono';
    if (/gorgon|ophidian|cobra|fang|jade|serpent|venom|volt/i.test(rawName)) return 'gorgon';
    if (/void|singularity|cowl|cosmic|astral|shadow|dark|eclipse|abyss/i.test(rawName)) return 'void';

    const rarity = ((helmet.rarity || (helmet as any).Rarity) || 'common').toLowerCase();
    if (rarity === 'mythic') return 'void';
    if (rarity === 'epic') return 'chrono';
    if (rarity === 'rare') return 'leviathan';
    if (rarity === 'uncommon') return 'colossus';
    return 'centipede';
  }

  /**
   * Suppressed legacy Canvas2D draw method.
   * Inert stub adhering to AGENTS.md Rule 12.
   */
  public static draw(_ctx: any, _snake: ISnakeRenderData): void {
    // Suppressed: Rendered exclusively via WebGLGameRenderer
  }

  /**
   * Suppressed legacy Canvas2D helmet draw method.
   * Inert stub adhering to AGENTS.md Rule 12.
   */
  public static drawHelmet(_ctx: any, _headR: number, _helmet: any, _pulse: number = 0): void {
    // Suppressed: Rendered exclusively via WebGLGameRenderer
  }
}
