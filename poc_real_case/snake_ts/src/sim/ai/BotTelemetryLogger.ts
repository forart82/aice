/**
 * Ouroboros Ascension — Autonomous Bot Telemetry & Balance Logger (BotTelemetryLogger.ts)
 *
 * Implements structured milestone tracking, combat damage accounting, boss encounter records,
 * economic balance metrics (currency velocity, reinvestment ratios, survivability index,
 * effective DPS, and progression scaling), and real-time behavioral anomaly audits
 * (self-trap, hazard suicide, hoarding, wasted abilities, potion negligence) for autonomous playtesting.
 */

import type { AnomalyEvent, AnomalySummary } from './BehavioralAnomalyDetector.js';

export interface FloorMilestone {
  floor: number;
  clearTime: number;
  serpentLength: number;
  peakLength: number;
  ouroCollected: number;
  ouroSpentInLab: number;
  damageDealt: number;
  damageTaken: number;
  bossDefeatDurations: Record<string, number>;
  upgradesUnlocked: string[];
  upgradesPurchased: string[];
}

export interface BossEncounter {
  floor: number;
  bossId: string;
  bossName: string;
  durationSec: number;
  outcome: 'victory' | 'defeat' | 'in_progress';
  damageDealtToBoss: number;
  damageTakenFromBoss: number;
}

export interface UpgradeEvent {
  type: 'module' | 'augment' | 'card' | 'sanctuary';
  id: string;
  name?: string;
  level: number;
  cost: number;
  floor: number;
  timestamp: number;
}

export interface BalanceMetrics {
  totalRunTimeSec: number;
  totalFloorsCleared: number;
  totalOuroCollected: number;
  totalOuroSpent: number;
  currencyVelocity: number;
  reinvestmentRatio: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  survivabilityIndex: number;
  effectiveDps: number;
  clearRatePerMinute: number;
  difficultyProgressionIndex: number;
}

export interface TelemetryReport {
  milestones: FloorMilestone[];
  bossEncounters: BossEncounter[];
  upgradeLedger: UpgradeEvent[];
  balanceMetrics: BalanceMetrics;
  anomalies: AnomalyEvent[];
  anomalySummary: AnomalySummary;
  generatedAt: string;
}

export class BotTelemetryLogger {
  public static readonly BossNames: Record<string, string> = {
    centipede: 'Centipede Behemoth',
    gorgon: 'Storm Gorgon',
    colossus: 'Infernal Colossus',
    frostwyrm: 'Glacial Behemoth',
    chronowyrm: 'Chrono Wyrm',
    hivemind: 'Bio-Venom Hivemind',
    superconductor_boss: 'Apex Superconductor',
    leviathan: 'Astral Leviathan',
    quantum_hydra: 'Quantum Hydra',
    mirror_wyrm: 'Shadow Doppelgänger',
    void_devourer: 'Void Devourer',
    orbital_dreadnought: 'Magnetic Dreadnought',
    iron_juggernaut: 'Aegis Juggernaut',
    solar_archon: 'Dyson Archon',
    crystal_monolith: 'Prismatic Arachnid',
    tempest_siren: 'Tempest Siren',
    nanite_titan: 'Nanite Hive Titan',
    phase_specter: 'Plasma Phase Specter',
    volcanic_chimera: 'Volcanic Chimera',
    eternal_ouroboros: 'The Eternal Ouroboros'
  };

  private readonly _milestones: FloorMilestone[] = [];
  private readonly _bossEncounters: BossEncounter[] = [];
  private readonly _upgradeLedger: UpgradeEvent[] = [];
  private readonly _anomalies: AnomalyEvent[] = [];

  private _runningDamageDealt = 0;
  private _runningDamageTaken = 0;
  private _runningOuroCollected = 0;
  private _runningOuroSpent = 0;

  /**
   * Records a completed floor milestone.
   */
  public recordMilestone(milestone: FloorMilestone): void {
    this._milestones.push({ ...milestone });
    this._runningDamageDealt += milestone.damageDealt;
    this._runningDamageTaken += milestone.damageTaken;
    this._runningOuroCollected += milestone.ouroCollected;
    this._runningOuroSpent += milestone.ouroSpentInLab;
  }
  public RecordMilestone(milestone: FloorMilestone): void {
    this.recordMilestone(milestone);
  }

  /**
   * Records a boss encounter event.
   */
  public recordBossEncounter(encounter: BossEncounter): void {
    this._bossEncounters.push({ ...encounter });
  }
  public RecordBossEncounter(encounter: BossEncounter): void {
    this.recordBossEncounter(encounter);
  }

  /**
   * Records an upgrade transaction in the auditable ledger.
   */
  public recordUpgrade(upgrade: UpgradeEvent): void {
    this._upgradeLedger.push({ ...upgrade });
  }
  public RecordUpgrade(upgrade: UpgradeEvent): void {
    this.recordUpgrade(upgrade);
  }

  /**
   * Records a behavioral anomaly event.
   */
  public recordAnomaly(anomaly: AnomalyEvent): void {
    this._anomalies.push({ ...anomaly, position: { ...anomaly.position } });
  }
  public RecordAnomaly(anomaly: AnomalyEvent): void {
    this.recordAnomaly(anomaly);
  }

  /**
   * Directly accumulates damage dealt.
   */
  public recordDamageDealt(amount: number): void {
    if (amount > 0) this._runningDamageDealt += amount;
  }
  public RecordDamageDealt(amount: number): void {
    this.recordDamageDealt(amount);
  }

  /**
   * Directly accumulates damage taken.
   */
  public recordDamageTaken(amount: number): void {
    if (amount > 0) this._runningDamageTaken += amount;
  }
  public RecordDamageTaken(amount: number): void {
    this.recordDamageTaken(amount);
  }

  /**
   * Directly accumulates Ouro currency collected.
   */
  public recordOuroCollected(amount: number): void {
    if (amount > 0) this._runningOuroCollected += amount;
  }
  public RecordOuroCollected(amount: number): void {
    this.recordOuroCollected(amount);
  }

  /**
   * Directly accumulates Ouro currency spent.
   */
  public recordOuroSpent(amount: number): void {
    if (amount > 0) this._runningOuroSpent += amount;
  }
  public RecordOuroSpent(amount: number): void {
    this.recordOuroSpent(amount);
  }

  public getMilestones(): readonly FloorMilestone[] {
    return this._milestones;
  }
  public GetMilestones(): readonly FloorMilestone[] {
    return this.getMilestones();
  }

  public getBossEncounters(): readonly BossEncounter[] {
    return this._bossEncounters;
  }
  public GetBossEncounters(): readonly BossEncounter[] {
    return this.getBossEncounters();
  }

  public getUpgradeLedger(): readonly UpgradeEvent[] {
    return this._upgradeLedger;
  }
  public GetUpgradeLedger(): readonly UpgradeEvent[] {
    return this.getUpgradeLedger();
  }

  public getAnomalies(): readonly AnomalyEvent[] {
    return this._anomalies;
  }
  public GetAnomalies(): readonly AnomalyEvent[] {
    return this.getAnomalies();
  }

  /**
   * Computes holistic balance metrics:
   * - Currency Velocity: Ouro Collected / Total Run Time (Ouro / sec)
   * - Reinvestment Ratio: Ouro Spent in Lab / Total Ouro Collected
   * - Survivability Index: Total Damage Dealt / Max(1, Total Damage Taken)
   * - Effective DPS: Total Damage Dealt / Total Run Time (Dmg / sec)
   * - Clear Rate: (Floors Cleared / Total Run Time) * 60 (Floors / min)
   */
  public computeBalanceMetrics(): BalanceMetrics {
    const floorCount = this._milestones.length;
    let totalTime = 0;
    let totalOuroCollected = 0;
    let totalOuroSpent = 0;
    let totalDmgDealt = 0;
    let totalDmgTaken = 0;

    if (floorCount > 0) {
      const lastMilestone = this._milestones[floorCount - 1]!;
      totalTime = Math.max(0.1, lastMilestone.clearTime);

      for (let i = 0; i < floorCount; i++) {
        const m = this._milestones[i]!;
        totalOuroCollected += m.ouroCollected;
        totalOuroSpent += m.ouroSpentInLab;
        totalDmgDealt += m.damageDealt;
        totalDmgTaken += m.damageTaken;
      }
    } else {
      totalOuroCollected = this._runningOuroCollected;
      totalOuroSpent = this._runningOuroSpent;
      totalDmgDealt = this._runningDamageDealt;
      totalDmgTaken = this._runningDamageTaken;
      totalTime = 1.0;
    }

    const currVel = totalOuroCollected / totalTime;
    const reinvestRatio = totalOuroSpent / Math.max(1, totalOuroCollected);
    const survIdx = totalDmgDealt / Math.max(1, totalDmgTaken);
    const effDps = totalDmgDealt / totalTime;
    const clearRate = (floorCount / totalTime) * 60;
    const diffProg = floorCount > 0 ? (totalDmgTaken / floorCount) : 0;

    return {
      totalRunTimeSec: Math.round(totalTime * 100) / 100,
      totalFloorsCleared: floorCount,
      totalOuroCollected,
      totalOuroSpent,
      currencyVelocity: Math.round(currVel * 100) / 100,
      reinvestmentRatio: Math.round(reinvestRatio * 1000) / 1000,
      totalDamageDealt: totalDmgDealt,
      totalDamageTaken: totalDmgTaken,
      survivabilityIndex: Math.round(survIdx * 100) / 100,
      effectiveDps: Math.round(effDps * 100) / 100,
      clearRatePerMinute: Math.round(clearRate * 100) / 100,
      difficultyProgressionIndex: Math.round(diffProg * 100) / 100,
    };
  }
  public ComputeBalanceMetrics(): BalanceMetrics {
    return this.computeBalanceMetrics();
  }

  /**
   * Computes aggregated anomaly summary statistics.
   */
  public getAnomalySummary(): AnomalySummary {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {
      LOW: 0,
      MEDIUM: 0,
      CRITICAL: 0,
    };

    for (const an of this._anomalies) {
      byType[an.type] = (byType[an.type] ?? 0) + 1;
      bySeverity[an.severity] = (bySeverity[an.severity] ?? 0) + 1;
    }

    return {
      totalCount: this._anomalies.length,
      byType,
      bySeverity,
      lastIncident: this._anomalies.length > 0 ? this._anomalies[this._anomalies.length - 1] : undefined,
    };
  }
  public GetAnomalySummary(): AnomalySummary {
    return this.getAnomalySummary();
  }

  /**
   * Generates a comprehensive summary report in the requested format ('markdown', 'text', or 'json').
   */
  public generateSummaryReport(format: 'markdown' | 'text' | 'json' = 'markdown'): string {
    switch (format) {
      case 'json':
        return this.exportJson();
      case 'text':
        return this.exportSummaryText();
      case 'markdown':
      default:
        return this.exportSummaryMarkdown();
    }
  }
  public GenerateSummaryReport(format?: 'markdown' | 'text' | 'json'): string {
    return this.generateSummaryReport(format);
  }

  /**
   * Generates a complete JSON telemetry report object.
   */
  public exportJson(): string {
    const report: TelemetryReport = {
      milestones: [...this._milestones],
      bossEncounters: [...this._bossEncounters],
      upgradeLedger: [...this._upgradeLedger],
      balanceMetrics: this.computeBalanceMetrics(),
      anomalies: [...this._anomalies],
      anomalySummary: this.getAnomalySummary(),
      generatedAt: new Date().toISOString(),
    };
    return JSON.stringify(report, null, 2);
  }
  public ExportJson(): string {
    return this.exportJson();
  }

  /**
   * Generates a human-readable Markdown telemetry summary.
   */
  public exportSummaryMarkdown(): string {
    const metrics = this.computeBalanceMetrics();
    const anomalySummary = this.getAnomalySummary();

    let md = `# Autonomous Bot Telemetry & Balance Report\n\n`;
    md += `**Generated:** ${new Date().toISOString()}\n\n`;

    md += `## 1. Executive Balance Summary\n\n`;
    md += `| Metric | Value |\n`;
    md += `| :--- | :--- |\n`;
    md += `| **Floors Cleared** | ${metrics.totalFloorsCleared} |\n`;
    md += `| **Total Run Duration** | ${metrics.totalRunTimeSec}s |\n`;
    md += `| **Total Ouro Earned** | 🪙 ${metrics.totalOuroCollected} |\n`;
    md += `| **Total Ouro Reinvested** | 🪙 ${metrics.totalOuroSpent} (${(metrics.reinvestmentRatio * 100).toFixed(1)}%) |\n`;
    md += `| **Currency Velocity** | ${metrics.currencyVelocity} Ouro/s |\n`;
    md += `| **Total Damage Dealt** | ⚔️ ${metrics.totalDamageDealt} |\n`;
    md += `| **Total Damage Taken** | 💔 ${metrics.totalDamageTaken} |\n`;
    md += `| **Survivability Index** | 🛡️ ${metrics.survivabilityIndex}x |\n`;
    md += `| **Effective DPS** | 💥 ${metrics.effectiveDps} Dmg/s |\n`;
    md += `| **Clear Rate** | ⚡ ${metrics.clearRatePerMinute} Floors/min |\n\n`;

    if (this._milestones.length > 0) {
      md += `## 2. Floor Milestones Ledger\n\n`;
      md += `| Floor | Clear Time | Length | Ouro (Earned / Spent) | Dmg (Dealt / Taken) | Upgrades |\n`;
      md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
      for (const m of this._milestones) {
        md += `| F${m.floor} | ${m.clearTime.toFixed(1)}s | ${m.serpentLength} (peak ${m.peakLength}) | 🪙 ${m.ouroCollected} / ${m.ouroSpentInLab} | ⚔️ ${m.damageDealt} / ${m.damageTaken} | ${m.upgradesPurchased.join(', ') || 'None'} |\n`;
      }
      md += `\n`;
    }

    const encounters = [...this._bossEncounters];
    if (encounters.length === 0) {
      for (const m of this._milestones) {
        if (m.bossDefeatDurations) {
          for (const [bId, dur] of Object.entries(m.bossDefeatDurations)) {
            encounters.push({
              floor: m.floor,
              bossId: bId,
              bossName: BotTelemetryLogger.BossNames[bId.toLowerCase()] || bId,
              durationSec: dur,
              outcome: 'victory',
              damageDealtToBoss: 0,
              damageTakenFromBoss: 0,
            });
          }
        }
      }
    }

    if (encounters.length > 0) {
      md += `## 3. Apex Boss Encounters\n\n`;
      md += `| Floor | Boss | Outcome | Duration | Boss Dmg Dealt | Dmg Taken |\n`;
      md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
      for (const b of encounters) {
        const outIcon = b.outcome === 'victory' ? '🏆' : '💀';
        md += `| F${b.floor} | ${b.bossName} | ${outIcon} ${b.outcome.toUpperCase()} | ${b.durationSec.toFixed(1)}s | ⚔️ ${b.damageDealtToBoss} | 💔 ${b.damageTakenFromBoss} |\n`;
      }
      md += `\n`;
    }

    md += `## Behavioral Anomaly Summary\n\n`;
    md += `| Metric | Count |\n`;
    md += `| :--- | :--- |\n`;
    md += `| **Total Anomalies Detected** | ${anomalySummary.totalCount} |\n`;
    md += `| **Critical Severities** | 🚨 ${anomalySummary.bySeverity['CRITICAL'] ?? 0} |\n`;
    md += `| **Medium Severities** | ⚠️ ${anomalySummary.bySeverity['MEDIUM'] ?? 0} |\n`;
    md += `| **Low Severities** | ℹ️ ${anomalySummary.bySeverity['LOW'] ?? 0} |\n\n`;

    if (this._anomalies.length > 0) {
      md += `### Anomaly Incidents Log\n\n`;
      md += `| Time | Type | Severity | Position | Details & Corrective Action |\n`;
      md += `| :--- | :--- | :--- | :--- | :--- |\n`;
      for (const an of this._anomalies) {
        const icon = an.severity === 'CRITICAL' ? '🚨' : (an.severity === 'MEDIUM' ? '⚠️' : 'ℹ️');
        md += `| ${an.timestamp.toFixed(1)}s | \`${an.type}\` | ${icon} ${an.severity} | (${an.position.x.toFixed(0)}, ${an.position.y.toFixed(0)}) | ${an.details || ''} ➔ *${an.correctiveAction}* |\n`;
      }
      md += `\n`;
    }

    return md;
  }
  public ExportSummaryMarkdown(): string {
    return this.exportSummaryMarkdown();
  }

  /**
   * Generates a plain text ASCII telemetry summary.
   */
  public exportSummaryText(): string {
    const metrics = this.computeBalanceMetrics();
    const anomalySummary = this.getAnomalySummary();

    const lines = [
      `=== AUTONOMOUS BOT TELEMETRY REPORT ===`,
      `Floors Cleared: ${metrics.totalFloorsCleared}`,
      `Total Time: ${metrics.totalRunTimeSec}s`,
      `Ouro: ${metrics.totalOuroCollected} collected, ${metrics.totalOuroSpent} spent (${(metrics.reinvestmentRatio * 100).toFixed(1)}% reinvested)`,
      `Currency Velocity: ${metrics.currencyVelocity} Ouro/s`,
      `Combat: ${metrics.totalDamageDealt} dealt, ${metrics.totalDamageTaken} taken (Survivability: ${metrics.survivabilityIndex}x)`,
      `Effective DPS: ${metrics.effectiveDps} Dmg/s`,
      `Clear Rate: ${metrics.clearRatePerMinute} Floors/min`,
      `ANOMALIES: Total=${anomalySummary.totalCount} (CRITICAL=${anomalySummary.bySeverity['CRITICAL'] ?? 0}, MEDIUM=${anomalySummary.bySeverity['MEDIUM'] ?? 0}, LOW=${anomalySummary.bySeverity['LOW'] ?? 0})`,
    ];

    if (this._anomalies.length > 0) {
      for (const an of this._anomalies) {
        lines.push(`  - [${an.severity}] ${an.type} @ (${an.position.x.toFixed(0)}, ${an.position.y.toFixed(0)}): ${an.correctiveAction}`);
      }
    }

    return lines.join('\n');
  }
  public ExportSummaryText(): string {
    return this.exportSummaryText();
  }

  /**
   * Resets all logged milestones, boss encounters, ledger entries, and anomaly records.
   */
  public reset(): void {
    this._milestones.length = 0;
    this._bossEncounters.length = 0;
    this._upgradeLedger.length = 0;
    this._anomalies.length = 0;
    this._runningDamageDealt = 0;
    this._runningDamageTaken = 0;
    this._runningOuroCollected = 0;
    this._runningOuroSpent = 0;
  }
  public Reset(): void {
    this.reset();
  }
}
