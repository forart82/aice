/**
 * Ouroboros Ascension — The Master Codex & Knowledge Base (CodexData.ts)
 *
 * Single Source of Truth (SSOT) data registry for the in-game Galactic Field Guide (HelpScreen).
 * Encapsulates all core mechanics, player archetypes, socket modules, alchemical fusions,
 * 20 apex boss encounters, daily cosmic transcendences, and mathematical simulation models.
 */

export type CodexCategory = 'rules' | 'classes' | 'combat' | 'bosses' | 'modes' | 'formulas';

export interface ICodexEntry {
  id: string;
  category: CodexCategory;
  title: string;
  subtitle: string;
  icon: string;
  tags: string[];
  keywords: string[];
  summary: string;
  contentHtml: string;
  formulaHtml?: string;
  deepDive?: {
    overview: string;
    formula?: string;
    tacticalAdvice?: string;
    statsTable?: Record<string, string | number>;
  };
}

export class CodexData {
  public static readonly Categories: { key: CodexCategory; label: string; icon: string }[] = [
    { key: 'rules', label: 'Core Rules & Basics', icon: '🎯' },
    { key: 'classes', label: 'Serpent Classes', icon: '🐍' },
    { key: 'combat', label: 'Combat & Fusions', icon: '⚔️' },
    { key: 'bosses', label: '20 Bosses & Bestiary', icon: '👹' },
    { key: 'modes', label: 'Modes & Daily Milestones', icon: '🌌' },
    { key: 'formulas', label: 'Mathematical Codex', icon: '📐' },
  ];

  public static readonly Entries: ICodexEntry[] = [
    // =========================================================================
    // 1. CORE RULES & CONTROLS (4 ENTRIES)
    // =========================================================================
    {
      id: 'rules_controls',
      category: 'rules',
      title: 'Controls & Kinematic Navigation',
      subtitle: 'Keyboard, Gamepad API & Dynamic Touch Joystick',
      icon: '🎮',
      tags: ['Controls', 'Kinematics', 'Core'],
      keywords: ['controls', 'wasd', 'keyboard', 'gamepad', 'touch', 'joystick', 'swipe', 'hotkeys', 'steer', 'heading', 'dash', 'input', 'navigation'],
      summary: 'Smooth heading steering along angle θ, speed-boost dash bursts (+75%), active skills, and universal shortcuts across all devices.',
      contentHtml: `
        <div class="codex-body-section">
          <div class="codex-golden-summary">
            🎯 <strong>Gamer TL;DR:</strong> Steer your cybernetic serpent through fluid 360° angles, execute tactical speed-boost dashes, and trigger devastating class skills across any input device!
          </div>

          <div class="codex-stats-matrix">
            <span class="codex-stat-pill">📊 Forward Speed: 100% (v<sub>base</sub>)</span>
            <span class="codex-stat-pill">💨 Dash Boost: +75% (1.75x)</span>
            <span class="codex-stat-pill">⏱️ Dash Duration: 0.35s</span>
            <span class="codex-stat-pill">🛡️ Hurt i-Frames: 0.6s</span>
          </div>

          <div class="codex-tips-block">
            <strong>💡 Pro Gamer Rules & Tips:</strong>
            <ul class="codex-bullet-list">
              <li>⚡ <strong>360° Smooth Steering:</strong> The serpent slithers continuously forward along heading angle &theta; with instantaneous angular rotation (&omega;).</li>
              <li>💨 <strong>Tactical Dash Burst:</strong> Activate Dash for a massive <code>+75%</code> velocity surge (1.75x) lasting <code>0.35s</code> to dodge boss projectiles or ram vulnerable mobs.</li>
              <li>🎮 <strong>Universal Hotkeys:</strong> Steer with <span class="codex-kbd">W</span><span class="codex-kbd">A</span><span class="codex-kbd">S</span><span class="codex-kbd">D</span>/Arrows, Left Stick, or Touch Joystick; Dash with <span class="codex-kbd">SPACE</span>/<span class="codex-kbd">RT</span>; Skill with <span class="codex-kbd">E</span>/<span class="codex-kbd">Shift</span>/<span class="codex-kbd">LT</span>; Lab with <span class="codex-kbd">L</span>; Pause with <span class="codex-kbd">P</span>/<span class="codex-kbd">ESC</span>; Codex with <span class="codex-kbd">H</span>/<span class="codex-kbd">F1</span>.</li>
              <li>🛡️ <strong>Damage i-Frames:</strong> Taking damage triggers <code>0.6s</code> of flashing invulnerability frames to safely reposition.</li>
            </ul>
          </div>

          <div class="codex-table-wrap">
            <table class="codex-table">
              <thead><tr><th>Action</th><th>Keyboard</th><th>Gamepad</th><th>Touch / Mobile</th></tr></thead>
              <tbody>
                <tr><td><strong>Steer Heading</strong></td><td><span class="codex-kbd">W</span><span class="codex-kbd">A</span><span class="codex-kbd">S</span><span class="codex-kbd">D</span> / <span class="codex-kbd">Arrows</span></td><td>Left Stick / D-Pad</td><td>Virtual Stick / Follow Finger</td></tr>
                <tr><td><strong>Dash Boost</strong></td><td><span class="codex-kbd">SPACE</span></td><td><span class="codex-kbd">A</span> / <span class="codex-kbd">RT</span> / <span class="codex-kbd">RB</span></td><td>Touch DASH Button</td></tr>
                <tr><td><strong>Active Skill</strong></td><td><span class="codex-kbd">E</span> / <span class="codex-kbd">Shift</span></td><td><span class="codex-kbd">X</span> / <span class="codex-kbd">LT</span> / <span class="codex-kbd">LB</span></td><td>Touch SKILL Button</td></tr>
                <tr><td><strong>Mutation Lab</strong></td><td><span class="codex-kbd">L</span></td><td><span class="codex-kbd">Y</span> / <span class="codex-kbd">Select</span></td><td>Top HUD 🧬 Button</td></tr>
                <tr><td><strong>Pause / Menu</strong></td><td><span class="codex-kbd">P</span> / <span class="codex-kbd">ESC</span></td><td><span class="codex-kbd">Start</span></td><td>Top HUD ⏸ Button</td></tr>
                <tr><td><strong>Codex Guide</strong></td><td><span class="codex-kbd">H</span> / <span class="codex-kbd">F1</span></td><td>—</td><td>Top HUD 📖 Button</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      `,
      formulaHtml: `
        <details class="codex-formula-drawer">
          <summary class="formula-drawer-summary">🔬 <strong>Formulas & Deep Dive</strong> (Click to Expand)</summary>
          <div class="formula-block">
            <div class="formula-title">📐 Kinematic Velocity & Heading Rate</div>
            <div class="formula-math">v = v_{base} \\times (1 + \\text{SpeedBonus}) \\times (\\text{isDashing} ? 1.75 : 1.0)</div>
            <div class="formula-math">\\omega = \\omega_{base} \\times (1 + \\text{TurnBonus})\\text{ rad/s}</div>
            <div class="formula-note">Fixed physics simulation clock runs at 120 Hz (&Delta;t = 1/120 s &asymp; 0.008333 s) with up to 6 sub-steps per frame to prevent physics drift.</div>
          </div>
        </details>
      `,
    },
    {
      id: 'rules_food_economy',
      category: 'rules',
      title: 'Food Economy & Ambient Drops',
      subtitle: '9 Unique Drops, Spawn Weights & Utility Synthesis',
      icon: '🍏',
      tags: ['Economy', 'Drops', 'Growth', 'Nourishment'],
      keywords: ['food', 'apple', 'golden', 'potion', 'shield', 'bomb', 'chrono', 'shard', 'essence', 'soul', 'prism', 'drops', 'economy', 'growth', 'ouro'],
      summary: 'Ingesting ambient drops increases serpent length (+1 segment), builds Ouro, heals modular health pools, and charges shields.',
      contentHtml: `
        <div class="codex-body-section">
          <div class="codex-golden-summary">
            🎯 <strong>Gamer TL;DR:</strong> Devour 9 unique ambient nutrient drops to grow longer (+1 segment with full HP), gain Ouro, restore missing health, and synthesize ultimate Astral Prisms!
          </div>

          <div class="codex-tips-block">
            <strong>💡 Pro Gamer Rules & Tips:</strong>
            <ul class="codex-bullet-list">
              <li>🍏 <strong>Core Nourishment:</strong> Ingesting food adds <code>+1 body segment</code> initialized with full health, awards Ouro, and boosts your score.</li>
              <li>🌟 <strong>High-Value Spawns:</strong> Golden Apples award <code>3x Ouro</code> and massive score, while Bomb Fruits detonate <code>90 kinetic damage</code> in a <code>110px</code> blast zone.</li>
              <li>❤️ <strong>Emergency Mending:</strong> Potions restore <code>36 HP</code> top-to-bottom, while Shield Orbs grant a <code>+45</code> damage buffer.</li>
              <li>🔮 <strong>Singularity Synthesis:</strong> Encircling food within an Ouroboros Constriction loop compresses all items into an <strong>Astral Prism</strong> (+300% Ouro & instant Overdrive Frenzy).</li>
            </ul>
          </div>

          <div class="codex-badge-grid">
            <div class="codex-pill-item"><span class="pill-icon">🍏</span><strong>Apple (60%)</strong>: +1 Ouro, +100 Score, +1 Segment.</div>
            <div class="codex-pill-item"><span class="pill-icon">🌟</span><strong>Golden Apple (15%)</strong>: +4 Ouro, +300 Score, high combo value.</div>
            <div class="codex-pill-item"><span class="pill-icon">❤️</span><strong>Health Potion (10%)</strong>: +2 Ouro, restores 36 HP (Head to Tail).</div>
            <div class="codex-pill-item"><span class="pill-icon">💠</span><strong>Shield Orb (6%)</strong>: +2 Ouro, grants +45 temporary Shield buffer.</div>
            <div class="codex-pill-item"><span class="pill-icon">💣</span><strong>Bomb Fruit (4%)</strong>: +3 Ouro, detonates 110px AoE dealing 90 kinetic damage.</div>
            <div class="codex-pill-item"><span class="pill-icon">⏱️</span><strong>Chrono Shard (2.5%)</strong>: +3 Ouro, slows enemy time by 45% for 4.0s.</div>
            <div class="codex-pill-item"><span class="pill-icon">⭐</span><strong>Cosmic Star (2.5%)</strong>: +4 Ouro, grants +5 permanent Sanctuary Stars.</div>
            <div class="codex-pill-item"><span class="pill-icon">👻</span><strong>Soul Remnant</strong>: Dropped on Soul Harvest procs (+5 Ouro, heals 4 HP).</div>
            <div class="codex-pill-item"><span class="pill-icon">🔮</span><strong>Astral Prism</strong>: Formed via Constriction loop (+15 Ouro, instant Frenzy).</div>
          </div>
        </div>
      `,
      formulaHtml: `
        <details class="codex-formula-drawer">
          <summary class="formula-drawer-summary">🔬 <strong>Formulas & Deep Dive</strong> (Click to Expand)</summary>
          <div class="formula-block">
            <div class="formula-title">📐 Food Spawning & Length Scaling</div>
            <div class="formula-math">N_{next} = \\min(N + 1, N_{\\max}),\\quad d_{\\text{segment}} = 14\\text{ px}</div>
            <div class="formula-note">Spawn Distribution: Apple 60.0%, Golden 15.0%, Potion 10.0%, Shield 6.0%, Bomb 4.0%, Chrono 2.5%, Essence 2.5%.</div>
          </div>
        </details>
      `,
    },
    {
      id: 'rules_health_severing',
      category: 'rules',
      title: 'Modular Health & Segment Severing',
      subtitle: 'Head Command Priority, Top-to-Bottom Healing & Tail Severing Cascade',
      icon: '💔',
      tags: ['Health', 'Modular', 'Severing', 'Survival'],
      keywords: ['health', 'hp', 'segment', 'sever', 'head', 'heal', 'modular', 'death', 'damage', 'vitality', 'cascade', 'top-down'],
      summary: 'Total HP is the sum of Head and body segments. Dropping any segment to 0 HP instantly severs all trailing wagons!',
      contentHtml: `
        <div class="codex-body-section">
          <div class="codex-golden-summary">
            🎯 <strong>Gamer TL;DR:</strong> Your health is distributed across the Head and every individual segment—if a segment drops to 0 HP, that segment is destroyed and all trailing segments are severed!
          </div>

          <div class="codex-stats-matrix">
            <span class="codex-stat-pill">🛡️ Head Max HP: 2 × BaseSegmentHp</span>
            <span class="codex-stat-pill">🩹 Segment HP: max(15, ⌊ClassHp/4⌉ + Vit×5)</span>
            <span class="codex-stat-pill">💥 Head Hit Dmg: 100% incoming</span>
            <span class="codex-stat-pill">🛡️ Body Mob Dmg: 70% incoming</span>
            <span class="codex-stat-pill">👹 Body Boss Dmg: 55% incoming</span>
            <span class="codex-stat-pill">⏱️ Bite Cooldown: 0.28s rate-limit</span>
          </div>

          <div class="codex-tips-block">
            <strong>💡 Pro Gamer Rules & Tips:</strong>
            <ul class="codex-bullet-list">
              <li>🛡️ <strong>Head Command Center:</strong> The Head possesses <code>2x the Max HP</code> of a body segment (<code>HeadMaxHp = 2 × BaseSegmentHp</code>).</li>
              <li>💔 <strong>Severing Cascade:</strong> When any segment k drops to 0 HP, that segment is destroyed and all trailing segments (k &hellip; N-1) are permanently severed and lost!</li>
              <li>🩹 <strong>Top-to-Bottom Healing:</strong> Healing restores health sequentially from anterior (Head) to posterior (Tail).</li>
              <li>⚠️ <strong>Defeat State:</strong> If Head HP drops to 0 or all segments are lost, you are defeated (unless saved by Phoenix Rebirth).</li>
            </ul>
          </div>
        </div>
      `,
      formulaHtml: `
        <details class="codex-formula-drawer">
          <summary class="formula-drawer-summary">🔬 <strong>Formulas & Deep Dive</strong> (Click to Expand)</summary>
          <div class="formula-block">
            <div class="formula-title">📐 Modular Health & Armor Mitigation</div>
            <div class="formula-math">HP_{total} = HeadHp + \\sum_{i=0}^{N-1} segment[i].Hp</div>
            <div class="formula-math">MaxHp_{seg} = \\max(15, \\lfloor ClassHp / 4 \\rceil + Vitality \\times 5)</div>
            <div class="formula-math">Damage_{taken} = RawDamage \\times (1 - \\text{Armor}),\\quad \\text{Armor}_{\\max} = 0.75</div>
            <div class="formula-note">Severing Rule: if segment[k].Hp &le; 0 &rArr; sever(k &hellip; N-1). Healing routes Head &rarr; seg[0] &rarr; &hellip; &rarr; seg[N-1].</div>
          </div>
        </details>
      `,
    },
    {
      id: 'rules_combo_overdrive',
      category: 'rules',
      title: 'Combo Overdrive & Frenzy System',
      subtitle: 'Stepped Multipliers from 2x to 8x and 8.0s Frenzy Surge',
      icon: '🔥',
      tags: ['Combo', 'Overdrive', 'Frenzy', 'Scoring'],
      keywords: ['combo', 'multiplier', 'frenzy', 'overdrive', 'score', 'tiers', 'decay', 'capacitor', 'streak', 'self-bite'],
      summary: 'Chaining food and enemy kills accelerates score/damage multipliers up to 8x and ignites Overdrive Frenzy.',
      contentHtml: `
        <div class="codex-body-section">
          <div class="codex-golden-summary">
            🎯 <strong>Gamer TL;DR:</strong> Chain food and kills to skyrocket your score/damage multipliers from 2x up to 8x and ignite Overdrive Frenzy!
          </div>

          <div class="codex-stats-matrix">
            <span class="codex-stat-pill">Combo 3x &rArr; 2x Mult</span>
            <span class="codex-stat-pill">Combo 8x &rArr; 3x Mult</span>
            <span class="codex-stat-pill">Combo 14x &rArr; 4x Mult</span>
            <span class="codex-stat-pill">Combo 22x &rArr; 5x Mult</span>
            <span class="codex-stat-pill">Combo 30x &rArr; 6x Mult</span>
            <span class="codex-stat-pill">Combo 40x &rArr; 8x Mult</span>
          </div>

          <div class="codex-tips-block">
            <strong>💡 Pro Gamer Rules & Tips:</strong>
            <ul class="codex-bullet-list">
              <li>🔥 <strong>Stepped Multiplier Tiers:</strong> Reach combo counts of 3, 8, 14, 22, 30, and 40 to trigger <code>2x, 3x, 4x, 5x, 6x, and 8x</code> multipliers.</li>
              <li>⏱️ <strong>Decay Window:</strong> Combo timer decays dynamically (&tau; = 4.0s &rarr; 1.9s at peak tiers). Keep feeding to prevent combo resets!</li>
              <li>⚡ <strong>Overdrive Frenzy:</strong> Hitting 10x combo (or 8x with Overdrive Capacitor) grants <code>+20% move speed, 2x damage, and double Ouro</code> for <code>8.0s</code>.</li>
              <li>🚫 <strong>Self-Bite Penalty:</strong> Crossing your own body (k &ge; 3) inflicts self-damage, sparks <code>SELF-BITE!</code>, and instantly breaks your active combo streak!</li>
            </ul>
          </div>
        </div>
      `,
      formulaHtml: `
        <details class="codex-formula-drawer">
          <summary class="formula-drawer-summary">🔬 <strong>Formulas & Deep Dive</strong> (Click to Expand)</summary>
          <div class="formula-block">
            <div class="formula-title">📐 Combo Scaling & Frenzy Formulation</div>
            <div class="formula-math">\\tau_{decay} = \\max(1.9, 4.0 - 0.05 \\times C)\\text{ s}</div>
            <div class="formula-math">ScoreGain = BaseScore \\times M_{combo} \\times (1 + \\text{FrenzyBonus})</div>
            <div class="formula-math">FinalDamage = (Base + Power) \\times M_{combo} \\times M_{crit}</div>
            <div class="formula-note">Overdrive Frenzy triggers at Combo &ge; 10 (or Combo &ge; 8 with Overdrive Capacitor) and lasts 8.0s.</div>
          </div>
        </details>
      `,
    },

    // =========================================================================
    // 2. SERPENT CLASSES & VIVARIUM (2 ENTRIES)
    // =========================================================================
    {
      id: 'classes_roster',
      category: 'classes',
      title: 'Playable Serpent Archetypes',
      subtitle: '5 Distinct Classes with Specialized Base Stats, Passives & Active Skills',
      icon: '🐍',
      tags: ['Classes', 'Archetypes', 'Skills', 'Passives'],
      keywords: ['classes', 'emerald', 'viper', 'stalker', 'shadow', 'hydra', 'storm', 'wyrm', 'solar', 'drake', 'skills', 'basilisk', 'chimera', 'roster'],
      summary: 'Choose between Emerald Viper (Sustain), Shadow Stalker (Crit), Hydra Behemoth (Tank), Storm Wyrm (Speed), and Solar Drake (Burn).',
      contentHtml: `
        <div class="codex-body-section">
          <div class="codex-golden-summary">
            🎯 <strong>Gamer TL;DR:</strong> Select from 5 unique bio-engineered serpent classes with specialized stats, innate passives, and devastating active skills!
          </div>

          <div class="codex-tips-block">
            <strong>💡 Pro Gamer Rules & Tips:</strong>
              <li>🐍 <strong>Emerald Viper:</strong> HP 110, Spd 1.00x, Bite 26, Magnet 78px. Passive <em>Photosynthesis</em> (+1 HP/6s, +30% magnet). Active <em>Verdant Bloom</em> (Heal 20% max HP + 5 fruits, 22s CD).</li>
              <li>🌑 <strong>Shadow Stalker:</strong> HP 85, Spd 1.15x, Bite 34, Crit 25% (2.0x). Passive <em>Phantom Shift</em> (+25% crit, stealth i-frames on dash). Active <em>Umbral Blink</em> (200px teleport + 130 AoE decoy bomb, 13s CD).</li>
              <li>🐲 <strong>Hydra Behemoth:</strong> HP 170, Spd 0.90x, Bite 42, Armor 25%. Passive <em>Titan Shell</em> (2 extra biting heads, 25% armor). Active <em>Titan Roar</em> (230px stun shockwave + 25% armor, 19s CD).</li>
              <li>⚡ <strong>Storm Wyrm:</strong> HP 95, Spd 1.22x, Bite 28, Armor 5%. Passive <em>Static Coil</em> (every 5th combo arcs lightning to 3 targets). Active <em>Chain Storm</em> (chain bolt hitting 8 targets with growing damage, 15s CD).</li>
              <li>☀️ <strong>Solar Drake:</strong> HP 120, Spd 1.05x, Bite 32, Armor 10%. Passive <em>Magma Trail</em> (burning wake, gilds touched food). Active <em>Supernova</em> (260px solar explosion, transmutes all food to Golden Apples, 21s CD).</li>
            </ul>
          </div>

          <div class="codex-class-grid">
            <div class="codex-class-card">
              <div class="class-title"><span class="class-icon">🐍</span><strong>Emerald Viper</strong></div>
              <div class="class-stat-row"><span>HP: 110</span><span>Speed: 1.00x</span><span>Bite: 26</span><span>Dash CD: 3.2s</span></div>
            </div>
            <div class="codex-class-card">
              <div class="class-title"><span class="class-icon">🌑</span><strong>Shadow Stalker</strong></div>
              <div class="class-stat-row"><span>HP: 85</span><span>Speed: 1.15x</span><span>Bite: 34</span><span>Crit: 25% (2.0x)</span></div>
            </div>
            <div class="codex-class-card">
              <div class="class-title"><span class="class-icon">🐲</span><strong>Hydra Behemoth</strong></div>
              <div class="class-stat-row"><span>HP: 170</span><span>Speed: 0.90x</span><span>Bite: 42</span><span>Armor: 25%</span></div>
            </div>
            <div class="codex-class-card">
              <div class="class-title"><span class="class-icon">⚡</span><strong>Storm Wyrm</strong></div>
              <div class="class-stat-row"><span>HP: 95</span><span>Speed: 1.22x</span><span>Bite: 28</span><span>Armor: 5%</span></div>
            </div>
            <div class="codex-class-card">
              <div class="class-title"><span class="class-icon">☀️</span><strong>Solar Drake</strong></div>
              <div class="class-stat-row"><span>HP: 120</span><span>Speed: 1.05x</span><span>Bite: 32</span><span>Armor: 10%</span></div>
            </div>
          </div>
        </div>
      `,
      formulaHtml: `
        <details class="codex-formula-drawer">
          <summary class="formula-drawer-summary">🔬 <strong>Formulas & Deep Dive</strong> (Click to Expand)</summary>
          <div class="formula-block">
            <div class="formula-title">📐 Class Health & Skill Scaling</div>
            <div class="formula-math">BaseSegmentHp = \\max(15, \\lfloor ClassHp / 4 \\rceil + Vitality \\times 5)</div>
            <div class="formula-math">CD_{eff} = BaseCD \\times (1 - \\text{SkillHaste})</div>
          </div>
        </details>
      `,
    },
    {
      id: 'classes_cranial_lab',
      category: 'classes',
      title: 'Cranial Mutation Vivarium & Augments',
      subtitle: 'Head-Centric Socket Modules & Geometric Challenge-Gated Progression',
      icon: '🧬',
      tags: ['Lab', 'Mutation', 'Progression', 'Vivarium', 'Geometry'],
      keywords: ['lab', 'mutation', 'head', 'augments', 'modules', 'weapons', 'defense', 'scaling', 'costs', 'vivarium', 'cranial', 'geometry', 'length', 'arena'],
      summary: 'Socket unlimited offensive spitters, laser nodes, and carapace shields directly onto the Serpent Head with geometrically calibrated tier unlocks.',
      contentHtml: `
        <div class="codex-body-section">
          <div class="codex-golden-summary">
            🎯 <strong>Gamer TL;DR:</strong> Socket unlimited offensive Spitters, Tesla Coils, Beam Lasers, and Carapace Shields directly onto the Serpent Head, calibrated to the physical arena-to-length ratio!
          </div>

          <div class="codex-stats-matrix">
            <span class="codex-stat-pill">🏹 Starter Weapon: Attack Spitter T1</span>
            <span class="codex-stat-pill">🛡️ Starter Defense: Carapace Shield T1</span>
            <span class="codex-stat-pill">📐 Segment Spacing: 15px (L = N × 15px)</span>
            <span class="codex-stat-pill">⭐ Module Cost: 30×lvl + p×15 Ouro</span>
            <span class="codex-stat-pill">🧬 Augment Cost: 40×lvl + p×20 Ouro</span>
          </div>

          <div class="codex-tips-block">
            <strong>💡 Pro Gamer Rules & Tips:</strong>
            <ul class="codex-bullet-list">
              <li>🧬 <strong>Head Command Center:</strong> All weapons and defensive auras fire directly from the Head (x<sub>head</sub>, y<sub>head</sub>, &theta;<sub>head</sub>), eliminating body segment micromanagement.</li>
              <li>🔄 <strong>Strict Roguelite In-Run Reset:</strong> All Cranial Lab upgrades, installed head augments, in-run Ouro, and challenge unlocks reset on every new expedition. Every run begins with clean starter defaults (Attack Spitter and Carapace Shield at Tier 1); all other modules and augments require completing in-run challenge feats. Lifetime records never auto-unlock tiers.</li>
              <li>🔓 <strong>Single-Condition Tier Unlocks:</strong> Every tier enforces strictly ONE single in-run condition across calibrated length milestones, food thresholds, kill counts, combo streaks, and boss encounters.</li>
              <li>📐 <strong>Dynamic Gameboard-to-Length Scaling (Strict 10ner-Step Rounding):</strong>
                <ul>
                  <li><strong>Formula:</strong> <code>R = clamp((arenaW × arenaH) / 1,536,000, 0.12, 1.0)</code>, <code>Length = RoundToTen(Base × R)</code>.</li>
                  <li><strong>Tier 1 (Floors 1–5):</strong> Scaled 250 Base Desktop Length (scaled to 80 on mobile; 30–50 foods, 25–30 kills, Floor 1–5 bosses).</li>
                  <li><strong>Tier 2 (Floors 6–12):</strong> Base Desktop Length 600 to 800 (scaled to 200–270 on mobile; 100–150 foods, 90–110 kills, 18x–25x combos, Floor 7–10 & 8 bosses).</li>
                  <li><strong>Tier 3 (Floors 13–20+):</strong> Base Desktop Length 1200 to 1800 (scaled to 410–610 on mobile; 200–300 foods, 200–220 kills, 35x–40x combos, 15–18 bosses / F15 / F20).</li>
                </ul>
              </li>
              <li>♾️ <strong>Unlimited Stacking:</strong> No slot limits! Stack all unlocked weapons, defense organs, and cranial augments up to your unlocked meta tier.</li>
              <li>📈 <strong>Escalating Ouro Cost:</strong> Each installed module increases the price of subsequent upgrades by <code>+15 Ouro</code> (modules) or <code>+20 Ouro</code> (augments).</li>
            </ul>
          </div>
        </div>
      `,
      formulaHtml: `
        <details class="codex-formula-drawer">
          <summary class="formula-drawer-summary">🔬 <strong>Formulas & Deep Dive</strong> (Click to Expand)</summary>
          <div class="formula-block">
            <div class="formula-title">📐 Dynamic Gameboard-to-Length Ratio & 10ner-Step Rounding</div>
            <div class="formula-math">R = \\text{clamp}\\left(\\frac{\\text{ArenaW} \\times \\text{ArenaH}}{1600 \\times 960},\\; 0.12,\\; 1.0\\right)</div>
            <div class="formula-math">\\text{Length}_{\\text{req}} = \\text{RoundToTen}(\\text{BaseDesktopLength} \\times R) = \\max(10,\\; \\lfloor \\text{Base} \\times R / 10 \\rceil \\times 10)</div>
            <div class="formula-math">\\text{Tier 1 Base: } 250,\\quad \\text{Tier 2 Base: } [600, 800],\\quad \\text{Tier 3 Base: } [1200, 1800]</div>
            <div class="formula-note">Enforces clean multiples of 10 (e.g., 80, 100, 120, 200, 240, 600, 1800; never odd values like 93 or 1834). Desktop reference is 1600x960 (Area = 1,536,000).</div>
          </div>
          <div class="formula-block">
            <div class="formula-title">📐 Scaled Cranial Purchase Cost Formula</div>
            <div class="formula-math">Cost_{module}(lvl, p) = 30 \\times lvl + p \\times 15\\text{ Ouro}</div>
            <div class="formula-math">Cost_{augment}(lvl, p) = 40 \\times lvl + p \\times 20\\text{ Ouro}</div>
            <div class="formula-note">p = total number of previous purchases made on the Head in the current run.</div>
          </div>
        </details>
      `,
    },

    // =========================================================================
    // 3. COMBAT, WEAPONS & FUSIONS (5 ENTRIES)
    // =========================================================================
    {
      id: 'combat_centripetal_whip',
      category: 'combat',
      title: 'Centripetal Kinetic Tail-Whip (v = ω · r)',
      subtitle: 'High-Speed Angular Turns Transform Trailing Wagons into Bludgeons',
      icon: '💫',
      tags: ['Combat', 'Kinematics', 'Tail-Whip', 'Physics'],
      keywords: ['tail-whip', 'centripetal', 'kinematics', 'angular', 'knockback', 'deflect', 'physics', 'bludgeon', 'whip'],
      summary: 'Sharp turns accelerate trailing segments to extreme tangential velocity, knocking enemies back 180px and deflecting projectiles.',
      contentHtml: `
        <div class="codex-body-section">
          <div class="codex-golden-summary">
            🎯 <strong>Gamer TL;DR:</strong> Whip your trailing wagons through sharp turns to bludgeon enemies with massive kinetic force, 180px knockback, and projectile deflection!
          </div>

          <div class="codex-stats-matrix">
            <span class="codex-stat-pill">📏 Segment Distance: 14px</span>
            <span class="codex-stat-pill">💥 Knockback: 180px</span>
            <span class="codex-stat-pill">📐 Scaling: Quadratic &prop; (v<sub>i</sub>/v<sub>head</sub>)&sup2;</span>
            <span class="codex-stat-pill">🛡️ Deflect Shots: Active on Segments i &ge; 2</span>
          </div>

          <div class="codex-tips-block">
            <strong>💡 Pro Gamer Rules & Tips:</strong>
            <ul class="codex-bullet-list">
              <li>💫 <strong>Physics Acceleration:</strong> Rapid angular steering turns trailing segments into whip points whose tangential velocity scales with distance from the head (i &middot; d).</li>
              <li>💥 <strong>Devastating Bludgeon:</strong> Collisions from segment index i &ge; 2 deal up to <code>4x base damage</code> based on the square of segment speed.</li>
              <li>🛡️ <strong>Defensive Deflection:</strong> Fast-moving tail segments deflect light enemy projectiles and send aggressive mob swarms flying <code>180px</code> back.</li>
              <li>🐍 <strong>Length Synergy:</strong> The longer your serpent (N &ge; 15), the greater the tail radius and the more catastrophic the whip impact!</li>
            </ul>
          </div>
        </div>
      `,
      formulaHtml: `
        <details class="codex-formula-drawer">
          <summary class="formula-drawer-summary">🔬 <strong>Formulas & Deep Dive</strong> (Click to Expand)</summary>
          <div class="formula-block">
            <div class="formula-title">📐 Centripetal Tail-Whip Formulation</div>
            <div class="formula-math">v_i = \\|\\vec{v}_{head}\\| + \\omega \\cdot (i \\cdot d_{segment}),\\quad d_{segment} = 14\\text{ px}</div>
            <div class="formula-math">Damage_{whip} = D_{base} \\times \\left(1.0 + 0.85 \\cdot \\left(\\frac{v_i}{v_{head}}\\right)^2\\right)</div>
            <div class="formula-note">Tail segments during fast turns inflict up to 4x base damage with 180px knockback and deflect enemy bullets.</div>
          </div>
        </details>
      `,
    },
    {
      id: 'combat_constriction',
      category: 'combat',
      title: 'Closed-Loop Ouroboros Constriction',
      subtitle: 'Topological Point-in-Polygon Stasis & Astral Prism Fusion',
      icon: '🌀',
      tags: ['Combat', 'Constriction', 'Topology', 'Prism'],
      keywords: ['constriction', 'loop', 'polygon', 'crush', 'prism', 'singularity', 'stasis', 'ouroboros', 'winding'],
      summary: 'Encircle enemies within a closed body loop to inflict -80% temporal stasis, crushing DPS, and fuse food into an Astral Prism.',
      contentHtml: `
        <div class="codex-body-section">
          <div class="codex-golden-summary">
            🎯 <strong>Gamer TL;DR:</strong> Encircle hostiles within a closed body loop to trap them in -80% temporal stasis, crush them with escalating DPS, and fuse loot into Astral Prisms!
          </div>

          <div class="codex-stats-matrix">
            <span class="codex-stat-pill">🧲 Snap Radius: 28px</span>
            <span class="codex-stat-pill">🐍 Min Loop Wagons: k &ge; 3</span>
            <span class="codex-stat-pill">⏱️ Stasis Penalty: -80% Move Speed</span>
            <span class="codex-stat-pill">🔮 Prism Fusion: +300% Ouro & Instant Frenzy</span>
          </div>

          <div class="codex-tips-block">
            <strong>💡 Pro Gamer Rules & Tips:</strong>
            <ul class="codex-bullet-list">
              <li>🌀 <strong>Topological Snapping:</strong> When your Head crosses within <code>28px</code> of trailing segment k &ge; 3, a closed topological polygon is sealed.</li>
              <li>⏳ <strong>Temporal Stasis:</strong> Enclosed hostiles suffer an immediate <code>-80%</code> movement speed penalty and are locked in place.</li>
              <li>💥 <strong>Area-Crushing DPS:</strong> Trapped enemies suffer continuous crushing damage that intensifies as the loop tightens!</li>
              <li>🔮 <strong>Singularity Fusion:</strong> Trapped food and shards compress into an <strong>Astral Prism</strong> (+300% Ouro bonus and instant Overdrive Frenzy charge).</li>
            </ul>
          </div>
        </div>
      `,
      formulaHtml: `
        <details class="codex-formula-drawer">
          <summary class="formula-drawer-summary">🔬 <strong>Formulas & Deep Dive</strong> (Click to Expand)</summary>
          <div class="formula-block">
            <div class="formula-title">📐 Closed-Loop Constriction Crushing DPS</div>
            <div class="formula-math">W(\\mathcal{P}, \\text{enemy}) \\ne 0 \\implies \\text{Stasis} = \\text{true}</div>
            <div class="formula-math">DPS_{crush} = 45 \\times Lvl \\times \\left(\\frac{Area_0}{A(t) + 100}\\right)^{0.65}</div>
            <div class="formula-note">Continuous crushing damage inside closed polygon + transforms food into Astral Prism (+300% Ouro).</div>
          </div>
        </details>
      `,
    },
    {
      id: 'combat_autotomy',
      category: 'combat',
      title: 'Tactical Autotomy (Tail Jettison)',
      subtitle: 'Voluntary Emergency Chassis Sacrifice for Burst Survival',
      icon: '⚡',
      tags: ['Survival', 'Tactics', 'Autotomy', 'Escape'],
      keywords: ['autotomy', 'jettison', 'sacrifice', 'shockwave', 'escape', 'agility', 'iframes', 'detonation'],
      summary: 'Voluntarily sacrifice trailing wagons to detonate an 80-damage ablative shockwave and gain 1.2s invulnerability + 45% agility.',
      contentHtml: `
        <div class="codex-body-section">
          <div class="codex-golden-summary">
            🎯 <strong>Gamer TL;DR:</strong> Voluntarily sacrifice trailing wagons to blast an 80-damage ablative shockwave, gain +1.2s i-frames, and boost agility by +45%!
          </div>

          <div class="codex-stats-matrix">
            <span class="codex-stat-pill">✂️ Jettison Range: k = ⌊N/2⌋ &hellip; N-1</span>
            <span class="codex-stat-pill">💣 Blast Damage: 80 Kinetic Dmg</span>
            <span class="codex-stat-pill">💥 Blast Radius: 140px AoE</span>
            <span class="codex-stat-pill">🛡️ Invulnerability: +1.2s i-Frames</span>
            <span class="codex-stat-pill">💨 Agility Surge: +45% for 4.0s</span>
          </div>

          <div class="codex-tips-block">
            <strong>💡 Pro Gamer Rules & Tips:</strong>
            <ul class="codex-bullet-list">
              <li>⚡ <strong>Emergency Escape:</strong> When trapped by bullet hell rings or surrounded by swarms, trigger Autotomy to blow your rear chassis.</li>
              <li>💣 <strong>Ablative Shockwave:</strong> Jettisoned segments explode instantly for <code>80 kinetic damage</code> across a <code>140px</code> blast zone.</li>
              <li>🛡️ <strong>Invulnerability Surge:</strong> Grants <code>+1.2s</code> of absolute invulnerability frames to slither through hazard zones unharmed.</li>
              <li>💨 <strong>Turn Agility:</strong> Grants <code>+45%</code> turning agility (&omega;<sub>turn</sub>) for <code>4.0s</code> to reposition and re-accumulate food.</li>
            </ul>
          </div>
        </div>
      `,
      formulaHtml: `
        <details class="codex-formula-drawer">
          <summary class="formula-drawer-summary">🔬 <strong>Formulas & Deep Dive</strong> (Click to Expand)</summary>
          <div class="formula-block">
            <div class="formula-title">📐 Autotomy Sacrifice & Agility Math</div>
            <div class="formula-math">k = \\max(1, \\lfloor N / 2 \\rfloor),\\quad \\text{sever}(k \\dots N-1)</div>
            <div class="formula-math">\\text{Detonate: } 80\\text{ dmg in } r=140\\text{px},\\quad \\omega \\leftarrow \\omega \\times 1.45\\text{ for } 4.0\\text{s}</div>
          </div>
        </details>
      `,
    },
    {
      id: 'combat_arsenal_and_fusions',
      category: 'combat',
      title: 'Arsenal Weapons, Defensive Bio-Organs & 28 Fusions',
      subtitle: '8 Kinetic Weapons, 8 Elemental Weapons, 12 Defenses & 28 Alchemical Fusions',
      icon: '🧪',
      tags: ['Arsenal', 'Weapons', 'Defenses', 'Fusions', 'Synergy'],
      keywords: ['arsenal', 'weapons', 'kinetic', 'elemental', 'defense', 'fusions', 'alchemical', 'synergy', 'tesla', 'cryo', 'magma', 'tachyon', 'spitter', 'plasma', 'singularity', 'nano', 'shield'],
      summary: 'Dual-socketing complementary weapon and defense modules in the Cranial Lab synthesizes 28 hybrid Alchemical Fusions.',
      contentHtml: `
        <div class="codex-body-section">
          <div class="codex-golden-summary">
            🎯 <strong>Gamer TL;DR:</strong> Arm your serpent with 16 Weapons (8 kinetic + 8 elemental) and 12 Defenses, then pair complementary modules to synthesize 28 Alchemical Fusions!
          </div>

          <div class="codex-tips-block">
            <strong>💡 Pro Gamer Rules & Tips:</strong>
            <ul class="codex-bullet-list">
              <li>⚔️ <strong>8 Kinetic Weapons:</strong> Attack Spitter (14 dmg, 0.65s), Railgun Flak Cannon (24 dmg, 1.2s, 6 pellets), Scattershot Blunderbuss (16x5 dmg, 0.9s), Seeker Needler (12 dmg homing, 0.45s), Cluster Mortar (32 AoE), Sonic Prow Cannon (20 dmg stun, 1.5s), Rotary Minigun (8 dmg, 10 shots/s), Caltrop Dropper (18 dmg + bleed).</li>
              <li>⚡ <strong>8 Elemental Weapons:</strong> Bio-Arc Coil (Tesla, 18 dmg), Magma Vent (Fire, 15 DPS), Cryo Mortar (Ice, 18 dmg + slow), Venom Sprayer (Poison, 12 DPS), Tachyon Laser (Beam, 22 dmg), Plasma Arc Cannon (Plasma, 36 AoE), Singularity Vortex Gun (Black Hole, 48 AoE), Solar Flare Mortar (Solar, 30 dmg).</li>
              <li>🛡️ <strong>12 Defensive Bio-Organs:</strong> Carapace Shield (25 shield), Thorny Spine Armor (+20 thorns, +4% armor), Regen Gland (+1 HP/3.5s), Bio-Magnet (+60px pull), Chrono Ward (Slows bullets, +i-frames), Nanite Swarm (Repair drones), Reactive Blast Plating (35 dmg counter-blast), Magnetic Aegis (Converts bullets to shards), Cryo Frost Carapace (-40% enemy speed, +15 max HP), Volcanic Heat Sink (25 DPS heat aura), Phase Cloak Emitter (15% dodge, 0.8s cloak), EMP Discharge Coil (Bullet-clearing EMP, 1.2s stun).</li>
              <li>🧪 <strong>28 Alchemical Fusions:</strong> Dual-socketing complementary modules activates hybrid superpowers (e.g. <em>Superconductor Surge</em>, <em>Obsidian Armor</em>, <em>Miasma Combustion</em>, <em>Prismatic Aegis</em>, <em>Temporal Singularity</em>, <em>Railgun Flak Battery</em>, <em>Glacial Rot</em>, <em>Thermobaric Mortar</em>, <em>Event Horizon Web</em>, <em>Biosteel Quill Burst</em>, <em>Tachyon Overcharge</em>, <em>Sublimation Shock</em>, <em>Corrosive Needle Carapace</em>, <em>Photon Mirror Barricade</em>, <em>Nanite Plague Vector</em>, <em>Kinetic Bastion Discharge</em>, <em>Entropic Miasma</em>, <em>Cryo-Barrier Reflection</em>, <em>Volcanic Bulwark</em>, <em>Auto-Fabricator Turrets</em>, <em>Tachyon Stutter Beam</em>, <em>Absolute Zero Stasis</em>, <em>Electrified Hull</em>, <em>Pyro-Nanite Swarm</em>, <em>Thermal Ray Needle</em>, <em>Tesla Nanite Cloud</em>, <em>Cryo-Tachyon Lance</em>, <em>Chrono Dart Accelerator</em>).</li>
            </ul>
          </div>

          <div class="codex-badge-grid">
            <div class="codex-pill-item">⚡❄️ <strong>Superconductor Surge</strong> (Tesla + Cryo): Shatters ice into piercing shards with +50% arc jump dmg.</div>
            <div class="codex-pill-item">🌋🛡️ <strong>Obsidian Armor</strong> (Magma + Spikes): Collision triggers 45 AoE eruption and +15% armor.</div>
            <div class="codex-pill-item">🧪🔥 <strong>Miasma Combustion</strong> (Venom + Magma): Poisoned foes touching magma explode (60 AoE dmg).</div>
            <div class="codex-pill-item">🛡️🔴 <strong>Prismatic Aegis</strong> (Tachyon + Shield): Shield break triggers 8-way Tachyon laser burst.</div>
            <div class="codex-pill-item">⏳⚡ <strong>Temporal Singularity</strong> (Chrono + Nanite): Nanites run at 3x speed in Chrono bubbles.</div>
            <div class="codex-pill-item">🔫⚡ <strong>Railgun Flak Battery</strong> (Turret + Tesla): Darts become electrified piercing slugs.</div>
          </div>
        </div>
      `,
      formulaHtml: `
        <details class="codex-formula-drawer">
          <summary class="formula-drawer-summary">🔬 <strong>Formulas & Deep Dive</strong> (Click to Expand)</summary>
          <div class="formula-block">
            <div class="formula-title">📐 Combat Damage Pipeline & Mitigation</div>
            <div class="formula-math">Damage_{final} = (Base + Power) \\times M_{combo} \\times M_{crit} \\times M_{fusion}</div>
            <div class="formula-math">Damage_{taken} = RawDamage \\times (1 - \\text{Armor}),\\quad \\text{Armor}_{\\max} = 0.75</div>
            <div class="formula-note">16 Weapons (8 Kinetic + 8 Elemental) + 12 Defenses yield 28 unique Alchemical Fusions.</div>
          </div>
        </details>
      `,
    },
    {
      id: 'combat_card_drafts',
      category: 'combat',
      title: 'Evolutionary Draft Cards & Relic Pool',
      subtitle: '36 Genetic Mutations Across Common, Rare, Epic, and Legendary Tiers',
      icon: '🃏',
      tags: ['Cards', 'Draft', 'Mutations', 'Relics'],
      keywords: ['cards', 'draft', 'relics', 'mutations', 'swift_scales', 'iron_belly', 'venom_spit', 'orbital_fangs', 'phoenix_rebirth', 'god_of_thunder', 'rarity', 'stacks'],
      summary: 'Draft from 36 evolutionary cards upon leveling up to build unstoppable synergies and unlock game-changing relics.',
      contentHtml: `
        <div class="codex-body-section">
          <div class="codex-golden-summary">
            🎯 <strong>Gamer TL;DR:</strong> Level up your serpent to draft from 36 powerful evolutionary cards across 4 rarity tiers and unlock game-changing relics!
          </div>

          <div class="codex-tips-block">
            <strong>💡 Pro Gamer Rules & Tips:</strong>
            <ul class="codex-bullet-list">
              <li>⚪ <strong>Common Tier (10 Cards):</strong> Swift Scales (+12% speed), Iron Belly (+25 max HP), Magnetic Coil (+40% magnet), Razor Fangs (+15 bite, +5% crit), Sprint Gland (-18% dash CD), Hardened Carapace (+8% armor), Keen Eye (+30% crit dmg), Gourmand (+20% Ouro), Serpent's Focus (+25% combo window), Shard Lust (+30% shards).</li>
              <li>🔵 <strong>Rare Tier (10 Cards):</strong> Venom Spit (45 dmg darts), Frostbite Aura (-45% enemy speed), Shield Matrix (+45 shield), Vampiric Feast (+3 HP/feast), Explosive Appetite (45 dmg AoE on eating), Combo Surge (+50% combo window), Barbed Scales (40% thorns reflect), Adrenal Surge (+35% speed & +20% bite below 40% HP), Seeker Venom (Homing darts), Glutton Growth (+10 max HP/8 meals).</li>
              <li>🟣 <strong>Epic Tier (9 Cards):</strong> Orbital Fangs (+2 blades, 55 dmg), Chain Reaction (60 dmg AoE on kills), Quantum Phase (Immune to self-collision, dash pierces), Singularity Core (Vacuums all food every 7s), Overdrive Capacitor (Frenzy at 8x, +4s duration), Molten Wake (Magma trail), Cryo Nova (Freeze on damage), Echo Strike (55% phantom bite), Soul Harvest (Soul drops, +60% kill Ouro).</li>
              <li>🟡 <strong>Legendary Tier (7 Cards):</strong> Dragon's Breath (22 dmg flame cone), God of Thunder (80 dmg lightning strikes), Phoenix Rebirth (Cheat death + full heal + clearing nova), Infinite Devourer (+10 HP & +5% dmg every 5 combo), Eternal Coil (Body deals 30 DPS), Time Dilation (Time slows to 55% below 30% HP), Apex Predator (+100% bite, -25% max HP).</li>
            </ul>
          </div>

          <div class="codex-badge-grid">
            <div class="codex-pill-item border-common"><strong class="text-common">10 Common Cards</strong> (Up to 5 Stacks)</div>
            <div class="codex-pill-item border-uncommon"><strong class="text-uncommon">10 Rare Cards</strong> (Up to 3 Stacks)</div>
            <div class="codex-pill-item border-epic"><strong class="text-epic">9 Epic Cards</strong> (Up to 2 Stacks)</div>
            <div class="codex-pill-item border-mythic"><strong class="text-mythic">7 Legendary Cards</strong> (Game-Changers)</div>
          </div>
        </div>
      `,
      formulaHtml: `
        <details class="codex-formula-drawer">
          <summary class="formula-drawer-summary">🔬 <strong>Formulas & Deep Dive</strong> (Click to Expand)</summary>
          <div class="formula-block">
            <div class="formula-title">📐 Level-Up Ouro Threshold</div>
            <div class="formula-math">Ouro_{req}(level) = \\lfloor 75 \\times (level - 1)^{1.34} + 80 \\times (level - 1) \\rfloor</div>
            <div class="formula-note">Calibrated cumulative Ouro threshold required to trigger evolutionary Card Draft events.</div>
          </div>
        </details>
      `,
    },

    // =========================================================================
    // 4. 20 APEX BOSSES & BESTIARY (2 ENTRIES)
    // =========================================================================
    {
      id: 'bosses_catalog',
      category: 'bosses',
      title: 'The 20 Apex Boss Guardians',
      subtitle: 'Complete 20-Boss Gauntlet Across All Floors with Multi-Boss Escalation',
      icon: '👹',
      tags: ['Bosses', 'Catalog', 'Encounters', 'Guardians'],
      keywords: ['bosses', 'centipede', 'gorgon', 'colossus', 'frostwyrm', 'chronowyrm', 'hivemind', 'superconductor', 'leviathan', 'quantum_hydra', 'mirror_wyrm', 'void_devourer', 'ouroboros', 'helmets', 'behemoth'],
      summary: 'Face 20 unique apex bosses with deterministic floor indexing (Floor - 1) % 20, multi-boss horde escalation on Floors 21+, and procedural helmet drops.',
      contentHtml: `
        <div class="codex-body-section">
          <div class="codex-golden-summary">
            🎯 <strong>Gamer TL;DR:</strong> Face 20 unique apex serpentine boss guardians across all 20 floors with multi-boss horde escalation on Floors 21+!
          </div>

          <div class="codex-tips-block">
            <strong>💡 Pro Gamer Rules & Tips:</strong>
            <ul class="codex-bullet-list">
              <li>👹 <strong>Campaign Sequence (Floors 1–20):</strong> Exactly 1 Apex Boss spawns per floor indexed as <code>(floor - 1) % 20</code>. Floor 1 is Centipede Behemoth, Floor 20 is The Eternal Ouroboros.</li>
              <li>⚔️ <strong>Endless Multi-Boss Escalation (Floors 21+):</strong> Floors 21–30 spawn 2 bosses simultaneously, Floors 31–40 spawn 3, Floors 41–50 spawn 4, Floors 51–60 spawn 5, and Floors 61+ spawn 6 bosses at once!</li>
              <li>📈 <strong>Cycle Roman Escalation:</strong> Surviving beyond Floor 20 initiates Cycle II with <code>+35% HP scaling per cycle</code> and Roman numeral titles (e.g. <em>Centipede Behemoth II</em>).</li>
              <li>🛡️ <strong>Body Armor Reduction:</strong> Contact damage to boss body segments deals <code>55% incoming damage</code> compared to 100% on the head.</li>
            </ul>
          </div>

          <div class="codex-table-wrap">
            <table class="codex-table">
              <thead><tr><th>Fl</th><th>Boss Name</th><th>Special Hazard / Attack Mechanic</th></tr></thead>
              <tbody>
                <tr><td>1</td><td><strong>Centipede Behemoth</strong></td><td>Segmented charge, spread bullet volleys, and enrage acceleration.</td></tr>
                <tr><td>2</td><td><strong>Storm Gorgon</strong></td><td>Electrified coil body, 360° spark nova, and targeted ground laser strikes.</td></tr>
                <tr><td>3</td><td><strong>Infernal Colossus</strong></td><td>Molten magma carapace, 22-bullet ring barrage, and multi-meteor bombardment.</td></tr>
                <tr><td>4</td><td><strong>Glacial Behemoth</strong></td><td>Diamond ice spines, chilling frost nova volleys, and blizzard hazard zones.</td></tr>
                <tr><td>5</td><td><strong>Chrono Wyrm</strong></td><td>Temporal flux dial rings, double-spiral temporal orbs, and arena time dilation pulses.</td></tr>
                <tr><td>6</td><td><strong>Bio-Venom Hivemind</strong></td><td>Segmented spore pods, virulent poison clouds, and Swarmling mite summons.</td></tr>
                <tr><td>7</td><td><strong>Apex Superconductor</strong></td><td>Hyper-charged galvanic dynamo coils, 12-arm lightning spiral, and arcing laser grids.</td></tr>
                <tr><td>8</td><td><strong>Astral Leviathan</strong></td><td>Celestial void discs, counter-rotating 4-arm void spirals, and orbital starlight beacons.</td></tr>
                <tr><td>9</td><td><strong>Quantum Hydra</strong></td><td>Multiverse serpent splitting into probabilistic reality coils with quantum phase shift.</td></tr>
                <tr><td>10</td><td><strong>Shadow Doppelgänger</strong></td><td>Mirror entity copying player trajectory with lethal inverse reflections and shadow daggers.</td></tr>
                <tr><td>11</td><td><strong>Void Devourer</strong></td><td>Abyssal gravity maw consuming arena matter and light with gravitational singularity pulls.</td></tr>
                <tr><td>12</td><td><strong>Magnetic Dreadnought</strong></td><td>Colossal floating fortress bristling with magnetized railgun turrets and EMP storms.</td></tr>
                <tr><td>13</td><td><strong>Aegis Juggernaut</strong></td><td>Impervious adamantine colossus shattering arenas under kinetic momentum and shockwaves.</td></tr>
                <tr><td>14</td><td><strong>Dyson Archon</strong></td><td>Stellar fusion incarnate casting sweeping solar laser corridors and solar flares.</td></tr>
                <tr><td>15</td><td><strong>Prismatic Arachnid</strong></td><td>Resonating quartz arachnid refracting beams through rotating crystal prism matrices.</td></tr>
                <tr><td>16</td><td><strong>Tempest Siren</strong></td><td>Vortex mistress commanding hurricane eddies, torrential lightning, and squall barriers.</td></tr>
                <tr><td>17</td><td><strong>Nanite Hive Titan</strong></td><td>Self-replicating swarm entity regenerating broken segments in combat with nanite swarms.</td></tr>
                <tr><td>18</td><td><strong>Plasma Phase Specter</strong></td><td>Ethereal high-energy apparition phasing through solid geometry with plasma discharges.</td></tr>
                <tr><td>19</td><td><strong>Volcanic Chimera</strong></td><td>Tri-headed subterranean beast erupting magma fountains, lava pools, and obsidian boulders.</td></tr>
                <tr><td>20</td><td><strong>The Eternal Ouroboros</strong></td><td>Apex cosmic tail-eating loop & timeline shatter; full bullet hell climax.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      `,
      formulaHtml: `
        <details class="codex-formula-drawer">
          <summary class="formula-drawer-summary">🔬 <strong>Formulas & Deep Dive</strong> (Click to Expand)</summary>
          <div class="formula-block">
            <div class="formula-title">📐 Boss Cycle Scaling & Multi-Boss Horde</div>
            <div class="formula-math">C = \\lfloor (\\text{floor} - 1) / 20 \\rfloor,\\quad HP_{scale} = (1.0 + C \\times 0.35)</div>
            <div class="formula-math">\\text{BossCount}(\\text{floor}) = \\min(6, \\max(1, \\lfloor (\\text{floor} - 11) / 10 \\rfloor + 1))\\quad [\\text{Floors } 21+]</div>
            <div class="formula-note">Body contact damage receives 55% incoming damage mitigation vs 100% on the head.</div>
          </div>
        </details>
      `,
    },
    {
      id: 'bosses_bestiary_helmets',
      category: 'bosses',
      title: 'Hostile Bestiary & Boss Helmet Vault',
      subtitle: '6 Hostile Mob Archetypes & 5-Tier Procedural Boss Helmet Vault',
      icon: '👑',
      tags: ['Bestiary', 'Mobs', 'Helmets', 'Loot', 'Affixes'],
      keywords: ['bestiary', 'mobs', 'scarab', 'swarmling', 'spitter', 'phantom', 'drone', 'brute', 'helmets', 'affixes', 'rarity', 'loot', 'vault'],
      summary: '6 hostile mob archetypes patrol the galaxy, dropping 5-tier procedural boss helmets with powerful affixes upon defeat.',
      contentHtml: `
        <div class="codex-body-section">
          <div class="codex-golden-summary">
            🎯 <strong>Gamer TL;DR:</strong> 6 hostile mob archetypes patrol the galaxy, dropping 5-tier procedural boss helmets with game-changing stat affixes!
          </div>

          <div class="codex-tips-block">
            <strong>💡 Pro Gamer Rules & Tips:</strong>
            <ul class="codex-bullet-list">
              <li>🪲 <strong>6 Hostile Mob Archetypes:</strong> Scarab (linear runner), Swarmling (sinusoidal swarm), Spitter (kiting artillery), Phantom (phase waver), Arc Drone (charging drone), and Brute (juggernaut ram).</li>
              <li>👑 <strong>Boss Helmet Vault:</strong> Slaying floor bosses drops equipped Cranial Helmets that scale from Common to Mythic with up to 5 procedural affixes.</li>
              <li>✨ <strong>Rarity Tiers:</strong> Common (1.00x, 1 affix), Uncommon (1.20x, 2 affixes), Rare (1.50x, 3 affixes), Epic (1.90x, 4 affixes), Mythic (2.50x, 5 affixes).</li>
              <li>⭐ <strong>Helmet Affixes:</strong> Roll powerful stats including Bite Power, Armor %, Crit Chance, Dash Cooldown, Magnet Radius, and elemental damage bonuses.</li>
            </ul>
          </div>

          <div class="codex-badge-grid">
            <div class="codex-pill-item border-common">⚪ <strong>Common</strong> (1.00x Power, 1 Affix)</div>
            <div class="codex-pill-item border-uncommon">🟢 <strong>Uncommon</strong> (1.20x Power, 2 Affixes)</div>
            <div class="codex-pill-item border-rare">🔵 <strong>Rare</strong> (1.50x Power, 3 Affixes)</div>
            <div class="codex-pill-item border-epic">🟣 <strong>Epic</strong> (1.90x Power, 4 Affixes)</div>
            <div class="codex-pill-item border-mythic">🟠 <strong>Mythic</strong> (2.50x Power, 5 Affixes)</div>
          </div>
        </div>
      `,
      formulaHtml: `
        <details class="codex-formula-drawer">
          <summary class="formula-drawer-summary">🔬 <strong>Formulas & Deep Dive</strong> (Click to Expand)</summary>
          <div class="formula-block">
            <div class="formula-title">📐 Boss Helmet Affix Power Scaling</div>
            <div class="formula-math">Stat_{value} = BaseAffix \\times RarityMultiplier \\times (1.0 + 0.05 \\times Floor)</div>
            <div class="formula-note">Floor 1: Common 60%, Uncommon 35%, Rare 5% • Floor 2: Uncommon 50%, Rare 35%, Epic 15% • Floor 3+: Rare 45%, Epic 40%, Mythic 15%.</div>
          </div>
        </details>
      `,
    },

    // =========================================================================
    // 5. GAME MODES & DAILY MILESTONES (2 ENTRIES)
    // =========================================================================
    {
      id: 'modes_overview',
      category: 'modes',
      title: 'Game Modes: Rogue, Boss Rush, Daily & Endless',
      subtitle: '4 Tailored Game Modes for Casual, Competitive, and Survival Play',
      icon: '🌌',
      tags: ['Modes', 'Rogue', 'BossRush', 'Endless', 'Daily'],
      keywords: ['modes', 'rogue', 'boss_rush', 'daily', 'endless', 'galaxy', 'challenges', 'sanctuary', 'essence'],
      summary: 'Choose from Rogue Galaxy (10F standard), Boss Rush (20F boss gauntlet), Daily Transcendence (20F seeded), and Endless Void.',
      contentHtml: `
        <div class="codex-body-section">
          <div class="codex-golden-summary">
            🎯 <strong>Gamer TL;DR:</strong> Test your skills across 4 distinct game modes from the standard 10-floor Rogue Galaxy to the grueling 20-floor Boss Rush and seeded Daily Challenge!
          </div>

          <div class="codex-tips-block">
            <strong>💡 Pro Gamer Rules & Tips:</strong>
            <ul class="codex-bullet-list">
              <li>🌌 <strong>Rogue Galaxy (Standard 10F):</strong> The classic expedition. Battle through 10 floors with draft cards, boss encounters, and full essence rewards.</li>
              <li>👹 <strong>Boss Rush (20F Gauntlet):</strong> Pure boss-fighting gauntlet. Face all 20 apex boss guardians back-to-back with instant draft rewards between floors.</li>
              <li>📅 <strong>Daily Transcendence (20F Seeded):</strong> Global 24-hour seeded challenge with 12 rotating Cosmic Capacities and 4 escalating milestone rewards!</li>
              <li>♾️ <strong>Endless Void:</strong> Survive infinitely with scaling enemy density and escalating Roman boss cycles until defeat.</li>
            </ul>
          </div>
        </div>
      `,
      formulaHtml: `
        <details class="codex-formula-drawer">
          <summary class="formula-drawer-summary">🔬 <strong>Formulas & Deep Dive</strong> (Click to Expand)</summary>
          <div class="formula-block">
            <div class="formula-title">📐 Mode Floor Scaling</div>
            <div class="formula-math">EnemyCount(floor) = \\min(45, 6 + \\lfloor floor \\times 2.8 \\rfloor)</div>
            <div class="formula-note">Essence Shards earned in all modes persist permanently into Sanctuary Meta-Progression.</div>
          </div>
        </details>
      `,
    },
    {
      id: 'modes_daily_milestones',
      category: 'modes',
      title: 'Daily Challenge & 4-Tier Milestones',
      subtitle: '12 Cosmic Capacities & Escalating Rewards at Floors 5, 10, 15, and 20',
      icon: '🏆',
      tags: ['Daily', 'Milestones', 'Cosmic', 'Rewards'],
      keywords: ['daily', 'milestones', 'cosmic', 'capacities', 'tier', 'awakening', 'ascension', 'transcendence', 'singularity', 'shards'],
      summary: 'Compete in daily seeded runs with unique cosmic capacity modifiers and claim huge essence shard payouts across 4 milestone steps.',
      contentHtml: `
        <div class="codex-body-section">
          <div class="codex-golden-summary">
            🎯 <strong>Gamer TL;DR:</strong> Conquer 20 floors of seeded daily modifiers to claim massive Essence Shard payouts across 4 milestone tiers (Levels 5, 10, 15, 20)!
          </div>

          <div class="codex-tips-block">
            <strong>💡 Pro Gamer Rules & Tips:</strong>
            <ul class="codex-bullet-list">
              <li>🌟 <strong>Tier 1: Awakening (Level 5):</strong> +0% Baseline Shards + Unlocks Tier 1 Daily Badge.</li>
              <li>⚡ <strong>Tier 2: Ascension (Level 10):</strong> +50% Bonus Shards + Unlocks Tier 2 Daily Badge.</li>
              <li>🔥 <strong>Tier 3: Transcendence (Level 15):</strong> +100% Double Shards + Unlocks Tier 3 Daily Badge.</li>
              <li>👑 <strong>Tier 4: Apex Singularity (Level 20):</strong> +150% Maximum Shards + Unlocks Apex Daily Trophy.</li>
              <li>🌌 <strong>12 Cosmic Capacities:</strong> Daily seeded abilities roll rotating buffs and hazards (e.g. <em>Supernova Trail</em>, <em>Astral Singularity</em>, <em>Chrono Paradox Clone</em>, <em>Frostfire Aurora</em>).</li>
            </ul>
          </div>

          <div class="codex-badge-grid">
            <div class="codex-pill-item">🌟 <strong>Lv 5 Awakening</strong> (+0% Shards)</div>
            <div class="codex-pill-item">⚡ <strong>Lv 10 Ascension</strong> (+50% Shards)</div>
            <div class="codex-pill-item">🔥 <strong>Lv 15 Transcendence</strong> (+100% Shards)</div>
            <div class="codex-pill-item">👑 <strong>Lv 20 Apex Singularity</strong> (+150% Shards)</div>
          </div>
        </div>
      `,
      formulaHtml: `
        <details class="codex-formula-drawer">
          <summary class="formula-drawer-summary">🔬 <strong>Formulas & Deep Dive</strong> (Click to Expand)</summary>
          <div class="formula-block">
            <div class="formula-title">📐 Daily Milestone Reward Multiplier</div>
            <div class="formula-math">RewardMultiplier = 1.0 + 0.50 \\times \\min(3, \\lfloor \\max(0, \\text{Level} - 5) / 5 \\rfloor)</div>
            <div class="formula-note">Level 5 = 1.0x, Level 10 = 1.5x, Level 15 = 2.0x, Level 20 = 2.5x.</div>
          </div>
        </details>
      `,
    },

    // =========================================================================
    // 6. MATHEMATICAL CODEX & SIMULATION (1 ENTRY)
    // =========================================================================
    {
      id: 'formulas_master_equations',
      category: 'formulas',
      title: 'Mathematical Simulation & Damage Engine',
      subtitle: 'Deterministic 120Hz Fixed Step, Ouro Curves & Armor Hard Caps',
      icon: '📐',
      tags: ['Math', 'Formulas', 'Simulation', 'Engine'],
      keywords: ['math', 'formulas', 'equations', '120hz', 'ouro', 'armor', 'damage', 'mitigation', 'step', 'accumulator', 'fixed'],
      summary: 'Complete mathematical specification of 120Hz simulation, damage pipelines, Ouro thresholds, and physics constants.',
      contentHtml: `
        <div class="codex-body-section">
          <div class="codex-golden-summary">
            🎯 <strong>Gamer TL;DR:</strong> Complete mathematical blueprint of 120Hz deterministic physics, damage mitigation caps, and Ouro formulas directly from The Oracle SSOT!
          </div>

          <div class="codex-tips-block">
            <strong>💡 Pro Gamer Rules & Tips:</strong>
            <ul class="codex-bullet-list">
              <li>⏱️ <strong>120 Hz Fixed-Step Clock:</strong> Time step &Delta;t = 1/120s (&asymp; 0.008333s) with max 6 sub-steps per frame to prevent simulation drift.</li>
              <li>🛡️ <strong>75% Armor Hard Cap:</strong> Armor mitigates raw incoming damage up to a strict maximum cap of 75% (0.75).</li>
              <li>📈 <strong>Ouro Level-Up Curve:</strong> Exponential level-up threshold formula: <code>Ouro = ⌊100 × level^1.45⌋</code>.</li>
              <li>💥 <strong>Full Outgoing Damage Equation:</strong> <code>(Base + Power) × Combo × Crit × Fusion</code>.</li>
            </ul>
          </div>
        </div>
      `,
      formulaHtml: `
        <details class="codex-formula-drawer" open>
          <summary class="formula-drawer-summary">🔬 <strong>Formulas & Deep Dive</strong> (Click to Expand)</summary>
          <div class="formula-block">
            <div class="formula-title">📐 Closed-Loop Ouroboros Constriction</div>
            <div class="formula-math">DPS_{crush} = 45 \\times Lvl \\times \\left(\\frac{Area_0}{A(t) + 100}\\right)^{0.65}</div>
            <div class="formula-note">Constriction inflicts -80% temporal stasis and area crushing DPS.</div>
          </div>
          <div class="formula-block">
            <div class="formula-title">📐 Centripetal Tail-Whip Kinematics</div>
            <div class="formula-math">Damage_{whip} = D_{base} \\times \\left(1.0 + 0.85 \\cdot \\left(\\frac{v_i}{v_{head}}\\right)^2\\right)</div>
          </div>
          <div class="formula-block">
            <div class="formula-title">📐 Simulation Step Accumulator (120 Hz)</div>
            <div class="formula-math">\\Delta t_{fixed} = \\frac{1}{120}\\text{ s} \\approx 0.008333\\text{ s},\\quad \\text{MaxSubSteps} = 6</div>
          </div>
          <div class="formula-block">
            <div class="formula-title">📐 Calibrated Level-Up Ouro Threshold</div>
            <div class="formula-math">Ouro_{req}(level) = \\lfloor 75 \\times (level - 1)^{1.34} + 80 \\times (level - 1) \\rfloor</div>
          </div>
          <div class="formula-block">
            <div class="formula-title">📐 Armor Damage Mitigation (75% Cap)</div>
            <div class="formula-math">Damage_{taken} = RawDamage \\times (1.0 - \\min(0.75, \\text{Armor}))</div>
          </div>
          <div class="formula-block">
            <div class="formula-title">📐 Dynamic Gameboard-to-Length Scaling & 10ner Rounding</div>
            <div class="formula-math">R = \\text{clamp}\\left(\\frac{\\text{ArenaW} \\times \\text{ArenaH}}{1600 \\times 960},\\; 0.12,\\; 1.0\\right)</div>
            <div class="formula-math">\\text{Length}_{\\text{req}} = \\text{RoundToTen}(\\text{BaseDesktopLength} \\times R) = \\max(10,\\; \\lfloor \\text{Base} \\times R / 10 \\rceil \\times 10)</div>
            <div class="formula-math">\\text{T1 Base: } 250,\\quad \\text{T2 Base: } [600, 800],\\quad \\text{T3 Base: } [1200, 1800]</div>
            <div class="formula-note">Calibrated against 1600x960 reference desktop. Strictly rounds to nearest 10ner step (e.g. 80, 100, 120, 200, 240, 600, 1800).</div>
          </div>
          <div class="formula-block">
            <div class="formula-title">📐 Outgoing Damage Pipeline</div>
            <div class="formula-math">Damage_{outgoing} = (BaseDamage + ModulePower) \\times M_{combo} \\times M_{crit} \\times M_{fusion}</div>
          </div>
        </details>
      `,
    },
  ];
}
