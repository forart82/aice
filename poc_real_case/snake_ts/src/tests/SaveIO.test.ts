import { describe, it, expect, beforeEach } from 'vitest';
import { GameData } from '../data/GameData';
import { MetaProgression, Records } from '../data/MetaProgression';
import { SaveIO } from '../platform/SaveIO';

describe('SaveIO & MetaProgression Persistence', () => {
  beforeEach(() => {
    SaveIO.clearMemory();
    SaveIO.install();
    MetaProgression.instance.reset();
  });

  it('initializes with default meta progression values', () => {
    const meta = MetaProgression.instance;
    expect(meta.shards).toBe(0);
    expect(meta.isUnlocked('emerald')).toBe(true);
    expect(meta.isUnlocked('stalker')).toBe(false);
    expect(meta.level('vitality')).toBe(0);
    expect(meta.records.highestFloor).toBe(1);
  });

  it('buys upgrades and saves state to storage backend', () => {
    const meta = MetaProgression.instance;
    meta.addShards(500);
    expect(meta.shards).toBe(500);

    const cost = meta.getUpgradeCost('vitality');
    expect(cost).toBe(40);

    const bought = meta.buyUpgrade('vitality');
    expect(bought).toBe(true);
    expect(meta.level('vitality')).toBe(1);
    expect(meta.shards).toBe(460);

    // Verify raw JSON in SaveIO memory
    const raw = SaveIO.readKey(GameData.MetaStorageKey);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(2);
    expect(parsed.shards).toBe(460);
    expect(parsed.upgrades.vitality.level).toBe(1);
  });

  it('unlocks classes correctly', () => {
    const meta = MetaProgression.instance;
    meta.addShards(1000);
    const stalkerCost = GameData.Classes.get('stalker')?.cost ?? 150;
    expect(meta.isUnlocked('stalker')).toBe(false);


    const unlocked = meta.unlockClass('stalker');
    expect(unlocked).toBe(true);
    expect(meta.isUnlocked('stalker')).toBe(true);
    expect(meta.shards).toBe(1000 - stalkerCost);
  });

  it('migrates legacy v1 save schema to v2 schema cleanly', () => {
    const legacySave = {
      shards: 350,
      unlockedClasses: { emerald: true, hydra: true },
      upgrades: {
        vitality: { level: 3 },
        agility: { level: 2 }
      },
      highScore: 12500,
      highestFloor: 4,
      highestCombo: 18,
      totalRuns: 12,
      totalKills: 250,
      totalFoods: 180
    };

    SaveIO.clearMemory();
    SaveIO.writeKey(GameData.LegacyStorageKey, JSON.stringify(legacySave));

    const meta = new MetaProgression();
    expect(meta.shards).toBe(350);
    expect(meta.isUnlocked('hydra')).toBe(true);
    expect(meta.level('vitality')).toBe(3);
    expect(meta.level('agility')).toBe(2);
    expect(meta.records.highScore).toBe(12500);
    expect(meta.records.highestFloor).toBe(4);
    expect(meta.records.highestCombo).toBe(18);
    expect(meta.records.totalRuns).toBe(12);
  });

  it('handles corrupted JSON gracefully without crashing', () => {
    SaveIO.clearMemory();
    SaveIO.writeKey(GameData.MetaStorageKey, '{ corrupted json ::::');

    expect(() => {
      const meta = new MetaProgression();
      expect(meta.shards).toBe(0);
      expect(meta.isUnlocked('emerald')).toBe(true);
    }).not.toThrow();
  });
});
