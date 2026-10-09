/**
 * Ouroboros Ascension — Developer Audit Checklist Registry (DevChecklistData.ts)
 *
 * Single Source of Truth (SSOT) data model, diagnostic definitions, and persistence layer
 * for in-game technical auditing across all 7 core game systems.
 */

import { SaveIO } from '../platform/SaveIO.js';

export type ChecklistStatus = 'TODO' | 'IN_PROGRESS' | 'AUDITED' | 'RESOLVED';
export type ChecklistCategory =
  | 'weapons'
  | 'defenses'
  | 'cranial_bio'
  | 'lab_ux'
  | 'pause_stop'
  | 'ascension_tradeoff'
  | 'bosses_views';

export interface IChecklistSubtask {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  codeReference?: string;
  technicalNote?: string;
}

export interface IChecklistDiagnostic {
  queryKey: string;
  label: string;
  expectedBehavior: string;
  failureSignature?: string;
}

export interface IChecklistAction {
  id: string;
  label: string;
  icon: string;
  tooltip: string;
}

export interface IChecklistItem {
  id: ChecklistCategory;
  category: ChecklistCategory;
  title: string;
  subtitle: string;
  icon: string;
  badge: string;
  status: ChecklistStatus;
  summary: string;
  technicalAnalysis: string;
  subtasks: IChecklistSubtask[];
  diagnostics: IChecklistDiagnostic[];
  actions?: IChecklistAction[];
}

export interface IDevChecklistState {
  version: number;
  lastUpdated: number;
  itemStatuses: Record<string, ChecklistStatus>;
  subtaskStates: Record<string, boolean>;
  developerNotes: Record<string, string>;
}

export class DevChecklistData {
  public static readonly StorageKey = 'ouroboros_dev_checklist_v1';

  public static readonly Categories: { key: ChecklistCategory | 'all'; label: string; icon: string }[] = [
    { key: 'all', label: 'All Audits', icon: '📋' },
    { key: 'weapons', label: '16 Weapons', icon: '⚔️' },
    { key: 'defenses', label: '12 Defenses', icon: '🛡️' },
    { key: 'cranial_bio', label: 'Cranial Bio', icon: '🐲' },
    { key: 'lab_ux', label: 'Lab UX Analysis', icon: '🧬' },
    { key: 'pause_stop', label: 'Pause / State Machine', icon: '⏸️' },
    { key: 'ascension_tradeoff', label: 'Ascension & Draft', icon: '🌌' },
    { key: 'bosses_views', label: '20 Bosses & Cameras', icon: '👹' },
  ];

  public static readonly Items: IChecklistItem[] = [
    // =========================================================================
    // 1. WEAPONS: 8 Kinetic + 8 Elemental Weapons Audit & Test
    // =========================================================================
    {
      id: 'weapons',
      category: 'weapons',
      title: 'Weapons Arsenal: 8 Kinetic + 8 Elemental Audit',
      subtitle: 'Projectile pipelines, fire-rates, collision hitboxes & 28 alchemical fusions',
      icon: '⚔️',
      badge: '16 WEAPONS',
      status: 'IN_PROGRESS',
      summary:
        'Comprehensive audit of all 8 kinetic and 8 elemental socket weapons. Ensures deterministic 120Hz firing intervals, proper spatial collision queries, projectile pooling, audio synthesis cues, and cross-module fusions.',
      technicalAnalysis: `
- Kinetic (8): Turret (14 dmg), Flak (24 dmg shrapnel), Scattershot (16x5 dmg), Needler (12 dmg homing), Mortar (32 AoE), Sonic (20 dmg stun), Gatling (8 dmg rapid), Caltrop (18 dmg bleed).
- Elemental (8): Tesla (18 dmg chain), Magma (15 DPS pool), Cryo (18 dmg + 40% chill), Venom (12 DPS poison), Tachyon (22 dmg beam), Plasma (36 AoE), Singularity (48 AoE vortex), Solar (30 AoE flare).
- 28 Alchemical Cross-Fusions: Verified via GameData.AlchemicalFusions.
      `,
      subtasks: [
        {
          id: 'wep_8_kinetic_audit',
          title: 'Verify all 8 Kinetic Weapons in Simulation',
          description: 'Ensure Turret, Flak, Scattershot, Needler, Mortar, Sonic, Gatling, and Caltrop fire correctly.',
          completed: true,
          codeReference: 'src/data/GameData.ts:616-626, src/sim/CombatSystem.ts',
        },
        {
          id: 'wep_8_elemental_audit',
          title: 'Verify all 8 Elemental Weapons in Simulation',
          description: 'Ensure Tesla, Magma, Cryo, Venom, Tachyon, Plasma, Singularity, and Solar fire with proper elemental status effects.',
          completed: true,
          codeReference: 'src/data/GameData.ts:627-636, src/sim/CombatSystem.ts',
        },
        {
          id: 'wep_fusions_integrity',
          title: '28 Alchemical Fusions Trigger Matrix',
          description: 'Validate that equipping any two valid synergy modules triggers the combined alchemical fusion effect.',
          completed: true,
          codeReference: 'src/data/GameData.ts:733-763, src/tests/ActiveMechanicsAndFusions.test.ts',
        },
        {
          id: 'wep_projectile_pooling',
          title: 'Projectile Memory & Spatial Hash Performance',
          description: 'Verify that projectile allocations do not create GC pressure and unregister promptly on collision or bounds exit.',
          completed: true,
          codeReference: 'src/sim/Projectile.ts, src/sim/SpatialHashGrid.ts',
        },
        {
          id: 'wep_audio_dsp_triggers',
          title: 'Procedural Audio Synthesis for All 16 Weapons',
          description: 'Check that every weapon has distinct synth parameters (laser chirp, mortar thud, flak burst, tesla zap).',
          completed: true,
          codeReference: 'src/audio/SoundEngine.ts, src/audio/Synth.ts',
        },
      ],
      diagnostics: [
        {
          queryKey: 'weapons_dps_balance',
          label: 'DPS Scaling vs Floor Curve',
          expectedBehavior: 'Base weapons deal 12-48 DPS at Floor 1, scaling with augments up to ~350 DPS by Floor 10.',
          failureSignature: 'Overpowered one-shots or sub-10 DPS stalling boss fights.',
        },
        {
          queryKey: 'weapons_aiming_accuracy',
          label: 'Auto-Targeting & Heading Vectors',
          expectedBehavior: 'Prow/head weapons align with serpent forward heading; turrets acquire nearest target within 260px.',
          failureSignature: 'Projectiles firing backward or failing target acquisition when no enemies in range.',
        },
      ],
      actions: [
        { id: 'spawn_all_weapons', label: 'Equip Full Arsenal', icon: '⚡', tooltip: 'Grants player all 16 weapons across body' },
      ],
    },

    // =========================================================================
    // 2. DEFENSES: 12 Defensive Bio-Organs & Shield Mechanics
    // =========================================================================
    {
      id: 'defenses',
      category: 'defenses',
      title: 'Defensive Systems: 12 Bio-Organs & Shield Mechanics',
      subtitle: 'Shield absorption, recharge timers, armor mitigation & invulnerability frames',
      icon: '🛡️',
      badge: '12 DEFENSES',
      status: 'IN_PROGRESS',
      summary:
        'Audit of all 12 defensive bio-modules. Verifies health routing (head vs segment severing), armor damage reduction formula, Carapace Shield 6.0s recharge cadence, and Nanite swarm bullet interception.',
      technicalAnalysis: `
- 12 Modules: Carapace Shield (25 buffer), Thorny Spikes (+20 thorns, +4% armor), Regen Gland (+1 HP/3.5s), Bio-Magnet (+60px pull), Chrono Ward (45% slow aura), Nanite Swarm (bullet intercept + HP repair), Reactive Plating (35 AoE burst), Magnetic Aegis (absorb to shard), Cryo Carapace (40% frost chill), Volcanic Heatsink (25 DPS vent), Phase Cloak (15% dodge), EMP Discharge (periodic clear + 1.2s stun).
- Damage Formula: DamageTaken = IncomingDamage * (1 - clamp(Armor, 0, 0.75))
      `,
      subtasks: [
        {
          id: 'def_12_modules_audit',
          title: 'Verify all 12 Defensive Systems in Simulation',
          description: 'Audit each module from Carapace Shield to EMP Discharge Coil.',
          completed: true,
          codeReference: 'src/data/GameData.ts:637-650, src/sim/SnakePlayer.ts',
        },
        {
          id: 'def_shield_recharge_timer',
          title: 'Shield Recharge Delay & Interruption',
          description: 'Ensure shield does not recharge while taking continuous damage and resets timer on full break.',
          completed: true,
          codeReference: 'src/sim/SnakePlayer.ts, src/sim/CombatSystem.ts',
        },
        {
          id: 'def_head_vs_segment_health',
          title: 'Head HP vs Segment Severing Isolation',
          description: 'Confirm segments can be destroyed without player death, but head death triggers GameOver.',
          completed: true,
          codeReference: 'src/sim/SnakePlayer.ts, src/tests/SegmentHealthAndXp.test.ts',
        },
        {
          id: 'def_iframes_and_dodge',
          title: 'Invulnerability Frames & Dodge Proc Mechanics',
          description: 'Verify 0.35s i-frame buffer on damage preventing multi-tick instant death.',
          completed: true,
          codeReference: 'src/sim/SnakePlayer.ts',
        },
      ],
      diagnostics: [
        {
          queryKey: 'defenses_nanite_intercept',
          label: 'Nanite Drone Projectile Collision',
          expectedBehavior: 'Nanite drones intercept enemy bullets within 50px radius, destroying projectile and adding +2 HP.',
          failureSignature: 'Hostile projectiles passing directly through active nanite drones without triggering intercept.',
        },
      ],
    },

    // =========================================================================
    // 3. CRANIAL BIO: Augmentations, Socket Capacity & Escalating Costs
    // =========================================================================
    {
      id: 'cranial_bio',
      category: 'cranial_bio',
      title: 'Cranial Augments, Socket Capacity & Escalating Costs',
      subtitle: '5 Cranial augments, dynamic gameboard scaling, strict 10ner rounding & Ouro purchase curves',
      icon: '🐲',
      badge: '5 AUGMENTS',
      status: 'RESOLVED',
      summary:
        'Validation of head bio-augments (Venom Fangs, Dragon Maw, Ramming Horns, Laser Optics, Solar Crown), socket capacity across segments, dynamic gameboard-to-length scaling (R = clamp((arenaW * arenaH) / 1,536,000, 0.12, 1.0)), strict 10ner-step rounding (RoundToTen), and escalating Ouro purchase cost curves.',
      technicalAnalysis: `
- 5 Cranial Augments: Venom Fangs (+12 bite DPS, +5% crit), Dragon Maw (+40% bite hitbox, +15 power), Ramming Horns (+50 collision dmg, stun), Laser Optics (twin tachyon beams), Solar Crown (golden apple conversion aura).
- Dynamic Gameboard-to-Length Scaling & Strict 10ner Rounding:
  - Scaling Ratio Formula: R = clamp((arenaW * arenaH) / 1,536,000, 0.12, 1.0) against 1600x960 reference desktop.
  - Strict 10ner Rounding: RoundToTen(baseLength * R) = Math.max(10, Math.round(baseLength * R / 10) * 10). Always yields clean multiples of 10 (80, 100, 120, 200, 240, 600, 1800; never 93 or 1834).
  - Base Desktop Lengths: Tier 1 (Scaled 250: Magma, Tachyon, Plasma, Laser, Visor, Cryo, Nanite: 250); Tier 2 (600–800: Shield 600, Maw 600, Scattershot 650, Plasma 800, Nanite 800); Tier 3 (1200–1800: Scattershot 1200, Shield 1200, Magma 1350, Plasma 1500, Tachyon 1500, Chrono 1500, Maw 1500, Laser/Visor 1800).
- Paced Realistic Metrics:
  - Food: T1 30–50 foods, T2 100–150 foods, T3 200–300 foods.
  - Kills: T1 25–30 kills, T2 90–110 kills, T3 200–220 kills.
  - Combos: T1 10x–15x, T2 18x–25x, T3 35x–40x.
  - Bosses: T1 Floor 1–5 bosses (Maw: F1, Flak: F2, Needler: F3, Chrono: F5), T2 Floor 7–10 & 8 bosses, T3 15–18 bosses & apex defeats (Flak: 15, Horns: 16, Spikes: 18, Nanite: 18, Turret: F15, Cryo: F20).
  - Strict Single-Condition Rule: Every tier enforces strictly ONE single challenge condition.
- Cost Curves: HeadAugmentCost = 40 + PurchaseCount * 20; ModuleCost = 30 + PurchaseCount * 15.
      `,
      subtasks: [
        {
          id: 'cranial_5_augments_audit',
          title: 'Verify 5 Cranial Augment Logic & Stat Changes',
          description: 'Ensure Fangs, Maw, Horns, Laser, and Crown apply correct passive bonuses to player stats.',
          completed: true,
          codeReference: 'src/ui/screens/SnakeLabScreen.ts:289-294, src/sim/SnakePlayer.ts',
        },
        {
          id: 'cranial_cost_escalation',
          title: 'Escalating Ouro Cost Progression Formula',
          description: 'Verify that each purchase increments cost by +20 Ouro without unbounded overflow.',
          completed: true,
          codeReference: 'src/ui/screens/SnakeLabScreen.ts:464',
        },
        {
          id: 'cranial_tier_challenge_locks',
          title: 'Dynamic Gameboard Ratio Scaling & Strict 10ner Rounding Challenge Validation',
          description: 'Ensure locked tiers enforce calibrated single-condition requirements with dynamic gameboard ratio scaling (R = clamp((W*H)/1536000, 0.12, 1.0)) and strict 10ner rounding (RoundToTen).',
          completed: true,
          codeReference: 'src/data/MetaProgression.ts, src/ui/screens/SnakeLabScreen.ts:463-488',
        },
      ],
      diagnostics: [
        {
          queryKey: 'cranial_ouro_deduction',
          label: 'Ouro State Synchronization',
          expectedBehavior: 'Purchasing an augment immediately deducts Ouro from player and updates Lab HUD chips.',
          failureSignature: 'Ouro desync between SnakePlayer and MetaProgression.',
        },
      ],
    },

    // =========================================================================
    // 4. LAB UX: Friction Points, Mobile Drawer Layout & Deploy Safety
    // =========================================================================
    {
      id: 'lab_ux',
      category: 'lab_ux',
      title: 'Lab UX Analysis & Mobile Ergonomics',
      subtitle: 'Friction points, unlock feedback, drawer scrolling & unpause safety',
      icon: '🧬',
      badge: 'UX AUDIT',
      status: 'IN_PROGRESS',
      summary:
        'In-depth usability review of the Mutation Lab & Helmet Vault. Resolves player confusion between in-run socketing and Sanctuary meta-upgrades, eliminates clipping on mobile portrait/landscape, and ensures safe deployment.',
      technicalAnalysis: `
1. In-Run Ouro vs Permanent Sanctuary Essence: Amber chips for temporary in-run Ouro vs Cyan for meta essence.
2. Mobile Drawer Scrolling: Flex layout with momentum touch scrolling and safe-area insets.
3. Deploy Button State: Closes modal and cleanly returns to active gameplay or pauses safely.
      `,
      subtasks: [
        {
          id: 'lab_mobile_drawer_scroll',
          title: 'Mobile Viewport & Drawer Scrolling Test',
          description: 'Verify 393px phone width and 393px landscape height scroll without clipping content.',
          completed: true,
          codeReference: 'src/ui/screens/SnakeLabScreen.ts:42, emulator.html',
        },
        {
          id: 'lab_tab_switch_clarity',
          title: 'Bio-Lab vs Helmet Vault Tab Switching',
          description: 'Ensure instant tab swapping with dynamic helmet counter badge updating.',
          completed: true,
          codeReference: 'src/ui/screens/SnakeLabScreen.ts:149-159',
        },
        {
          id: 'lab_deploy_resume_safety',
          title: 'Deploy Button State Machine Safety',
          description: 'Confirm Deploy properly completes LevelUp or resumes game without state corruption.',
          completed: true,
          codeReference: 'src/ui/screens/SnakeLabScreen.ts:80-104',
        },
      ],
      diagnostics: [
        {
          queryKey: 'lab_touch_target_size',
          label: 'Touch Targets Minimum 44x44px',
          expectedBehavior: 'All buttons, close crosses, and augment cards meet touch guidelines.',
          failureSignature: 'Buttons smaller than 36px causing missed taps on mobile simulators.',
        },
      ],
    },

    // =========================================================================
    // 5. PAUSE / STOP: Game State Machine & Resume Safety
    // =========================================================================
    {
      id: 'pause_stop',
      category: 'pause_stop',
      title: 'Game Pause/Stop State Machine & Safety',
      subtitle: 'Modal overlay pause safety, accumulator clearing & audio suspension',
      icon: '⏸️',
      badge: 'STATE MACHINE',
      status: 'IN_PROGRESS',
      summary:
        'Verification of the game pause/stop state machine. Guarantees zero simulation ticks during pause, prevents fixed-step accumulator explosions on resume, isolates keydown events, and manages audio suspension.',
      technicalAnalysis: `
- State Transitions: Menu -> Playing <-> Paused -> LevelUp -> FloorClear -> GameOver
- Accumulator Reset: Accumulator = 0 enforced on unpause to prevent catch-up bursts.
- Audio Suspension: SoundEngine pauses all dynamic synthesis on modal screens.
- Input Isolation: Movement and combat inputs are masked while modals are active.
      `,
      subtasks: [
        {
          id: 'pause_accumulator_safety',
          title: 'Accumulator Reset on Resume',
          description: 'Verify engine resets accumulator to 0 on resume to prevent catch-up tick burst.',
          completed: true,
          codeReference: 'src/sim/GameEngine.ts:496, 504, 514',
        },
        {
          id: 'pause_modal_stack_integrity',
          title: 'UiRoot Navigation Stack & Modal Push/Pop',
          description: 'Ensure opening sub-modals (e.g. Settings from Pause) restores previous screen on close.',
          completed: true,
          codeReference: 'src/ui/UiRoot.ts:78-104',
        },
        {
          id: 'pause_input_masking',
          title: 'Input Masking During Modal Overlays',
          description: 'Verify snake does not move, turn, or dash while any modal overlay is active.',
          completed: true,
          codeReference: 'src/ui/UiRoot.ts:122-124, src/input/InputManager.ts',
        },
      ],
      diagnostics: [
        {
          queryKey: 'pause_state_consistency',
          label: 'Engine.State === GameState.Paused',
          expectedBehavior: 'State transitions to Paused and returns to Playing cleanly on unpause.',
          failureSignature: 'State staying in Paused while simulation ticks, or Playing while pause screen is visible.',
        },
      ],
    },

    // =========================================================================
    // 6. ASCENSION TRADEOFF: Floor Transitions, Draft Rewards & Risk
    // =========================================================================
    {
      id: 'ascension_tradeoff',
      category: 'ascension_tradeoff',
      title: 'Ascension Floor Transitions & Draft Risk-Reward',
      subtitle: 'Floor scaling math, 3-card draft filtering, drop vacuuming & daily escalation',
      icon: '🌌',
      badge: 'ASCENSION',
      status: 'IN_PROGRESS',
      summary:
        'Audit of floor ascension mechanics. Evaluates food requirement curve, procedural 3-card draft generation, floor heal vs scaling danger tradeoffs, automatic drop vacuuming, and daily challenge power escalation.',
      technicalAnalysis: `
- Food Target: FoodTarget = 22 + (Floor - 1) * 9 (0 for BossRush).
- Floor Advance: Heals player by 50% max HP, refills Carapace Shield, auto-vacuums uncollected boss helmets.
- Daily Escalation: 4-Tier transcendence scaling (Levels 5, 10, 15, 20 with up to +150% power).
      `,
      subtasks: [
        {
          id: 'asc_floor_advance_trigger',
          title: 'Floor Advance & Food Progress Counting',
          description: 'Confirm advancing floor resets food progress, increments floor number, and scales target.',
          completed: true,
          codeReference: 'src/sim/GameEngine.ts:948-997',
        },
        {
          id: 'asc_draft_card_filtering',
          title: 'Draft Card Pool & Max Stack Filtering',
          description: 'Verify cards at max stacks (e.g. Swift Scales x5) are excluded from subsequent draft offerings.',
          completed: true,
          codeReference: 'src/data/GameData.ts:133-551, src/ui/screens/DraftScreen.ts',
        },
        {
          id: 'asc_helmet_drop_vacuum',
          title: 'Uncollected Boss Drop Auto-Vacuum',
          description: 'Verify uncollected boss helmets are vacuumed and banked into helmet vault before floor advance.',
          completed: true,
          codeReference: 'src/sim/GameEngine.ts:949-955',
        },
      ],
      diagnostics: [
        {
          queryKey: 'asc_daily_escalation',
          label: 'Daily Challenge Power Escalation',
          expectedBehavior: 'Daily transcendence power increases by +25% per floor cleared.',
          failureSignature: 'Daily capacity values staying at Tier 1 baseline without scaling.',
        },
      ],
    },

    // =========================================================================
    // 7. BOSSES VIEWS: 20 Apex Boss Encounters & Visuals
    // =========================================================================
    {
      id: 'bosses_views',
      category: 'bosses_views',
      title: '20 Boss Encounters, Multi-Boss Escalation & Visuals',
      subtitle: 'Bestiary archetypes, multi-phase telegraphs, multi-boss hordes & procedural helmets',
      icon: '👹',
      badge: '20 BOSSES',
      status: 'IN_PROGRESS',
      summary:
        'Audit of all 20 apex boss encounters and Floors 21+ multi-boss escalation. Validates multi-phase state machines, circular perimeter horde spawning (2 to 6 bosses), telegraph attack warning rendering (cone/circle/line), dual-layer lag-draining HP bars, boss camera framing, and procedural helmet drop generation.',
      technicalAnalysis: `
- 20 Apex Bosses: Centipede, Gorgon, Colossus, Frostwyrm, Chronowyrm, Hivemind, Superconductor, Leviathan, Quantum Hydra, Mirror Wyrm, Void Devourer, Orbital Dreadnought, Iron Juggernaut, Solar Archon, Crystal Monolith, Tempest Siren, Nanite Titan, Phase Specter, Volcanic Chimera, The Eternal Ouroboros.
- Multi-Boss Escalation (Floors 21+): 2 to 6 simultaneous Apex Bosses spawned on circular perimeters, scaling boss HP by +35% per cycle index C = floor((Floor - 1)/20), requiring all bosses to be defeated before floor clearance.
- Telegraph Attack Warnings: Cone, Circle, Line progressive fill before detonation.
- Dual-Layer HP Bar: Green/Cyan current HP with Red lag drain.
- Procedural Helmets: Boss kills generate wearable boss helmets with unique perk multipliers.
      `,
      subtasks: [
        {
          id: 'boss_20_archetypes_integrity',
          title: 'Verify all 20 Boss Definitions in GameData',
          description: 'Ensure all 20 bosses have unique colors, base HP, radii, and titles.',
          completed: true,
          codeReference: 'src/data/GameData.ts:577-598',
        },
        {
          id: 'boss_multi_horde_escalation',
          title: 'Multi-Boss Horde Escalation on Floors 21+',
          description: 'Verify 2 to 6 bosses spawn on circular perimeters on Floors 21+ and gate floor transition until all are slain.',
          completed: true,
          codeReference: 'src/sim/GameEngine.ts:890-940',
        },
        {
          id: 'boss_telegraph_rendering',
          title: 'Attack Telegraph Warning Zones (Cone/Circle/Line)',
          description: 'Check that telegraph zones render with progressive fill animation before attack detonates.',
          completed: true,
          codeReference: 'src/render/BossRenderer.ts:11-20, src/sim/Boss.ts',
        },
        {
          id: 'boss_hud_hp_bar_drain',
          title: 'Boss HUD HP Bar & Lag Drain Animation',
          description: 'Verify dual-layer boss HP bar displays with smooth red lag drain on damage.',
          completed: true,
          codeReference: 'src/ui/HudView.ts',
        },
        {
          id: 'boss_helmet_drop_proc',
          title: 'Boss Death & Procedural Helmet Generation',
          description: 'Confirm boss death spawns a procedural helmet drop matching the boss archetype.',
          completed: true,
          codeReference: 'src/data/Helmets.ts, src/sim/GameEngine.ts:928-944',
        },
      ],
      diagnostics: [
        {
          queryKey: 'boss_ik_segment_spacing',
          label: 'Segmented Boss Kinematic Alignment',
          expectedBehavior: 'Centipede and Wyrm segments follow boss head smoothly without snapping.',
          failureSignature: 'Segments bunching up or detaching into infinity on sharp turns.',
        },
      ],
    },
  ];

  // =========================================================================
  // State Management & Persistence
  // =========================================================================

  public static loadState(): IDevChecklistState {
    const defaultState: IDevChecklistState = {
      version: 1,
      lastUpdated: Date.now(),
      itemStatuses: {
        weapons: 'AUDITED',
        defenses: 'AUDITED',
        cranial_bio: 'AUDITED',
        lab_ux: 'AUDITED',
        pause_stop: 'AUDITED',
        ascension_tradeoff: 'AUDITED',
        bosses_views: 'AUDITED',
      },
      subtaskStates: {
        wep_8_kinetic_audit: true,
        wep_8_elemental_audit: true,
        wep_fusions_integrity: true,
        wep_projectile_pooling: true,
        wep_audio_dsp_triggers: true,
        def_12_modules_audit: true,
        def_shield_recharge_timer: true,
        def_head_vs_segment_health: true,
        def_iframes_and_dodge: true,
        cranial_5_augments_audit: true,
        cranial_cost_escalation: true,
        cranial_tier_challenge_locks: true,
        lab_mobile_drawer_scroll: true,
        lab_tab_switch_clarity: true,
        lab_deploy_resume_safety: true,
        pause_accumulator_safety: true,
        pause_modal_stack_integrity: true,
        pause_input_masking: true,
        asc_floor_advance_trigger: true,
        asc_draft_card_filtering: true,
        asc_helmet_drop_vacuum: true,
        boss_20_archetypes_integrity: true,
        boss_telegraph_rendering: true,
        boss_hud_hp_bar_drain: true,
        boss_helmet_drop_proc: true,
      },
      developerNotes: {},
    };

    const raw = SaveIO.readKey(DevChecklistData.StorageKey);
    if (!raw) return defaultState;

    try {
      const parsed = JSON.parse(raw);
      return {
        ...defaultState,
        ...parsed,
        itemStatuses: { ...defaultState.itemStatuses, ...(parsed.itemStatuses || {}) },
        subtaskStates: { ...defaultState.subtaskStates, ...(parsed.subtaskStates || {}) },
        developerNotes: { ...defaultState.developerNotes, ...(parsed.developerNotes || {}) },
      };
    } catch {
      return defaultState;
    }
  }

  public static saveState(state: IDevChecklistState): void {
    try {
      state.lastUpdated = Date.now();
      SaveIO.writeKey(DevChecklistData.StorageKey, JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to persist dev checklist state:', e);
    }
  }

  public static resetState(): IDevChecklistState {
    SaveIO.deleteKey(DevChecklistData.StorageKey);
    return DevChecklistData.loadState();
  }

  public static toggleSubtask(subtaskId: string): IDevChecklistState {
    const state = DevChecklistData.loadState();
    const current = state.subtaskStates[subtaskId] ?? true;
    state.subtaskStates[subtaskId] = !current;
    DevChecklistData.saveState(state);
    return state;
  }

  public static setItemStatus(itemId: string, status: ChecklistStatus): IDevChecklistState {
    const state = DevChecklistData.loadState();
    state.itemStatuses[itemId] = status;
    DevChecklistData.saveState(state);
    return state;
  }
}
