import { describe, it, expect, beforeEach } from 'vitest';
import {
  SaveIO,
  computeCrc32,
  createDefaultMetaSave,
  STORAGE_KEY_V1,
  STORAGE_KEY_V2
} from '../platform/SaveIO.js';
import { MultiScreenManager } from '../platform/MultiScreen.js';
import { CompanionSync } from '../platform/CompanionSync.js';

describe('SaveIO Persistence Layer', () => {
  beforeEach(() => {
    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();
  });

  it('computes CRC32 checksums accurately', () => {
    const sum1 = computeCrc32('123456789');
    expect(sum1).toBe('cbf43926');

    const sum2 = computeCrc32('Ouroboros Ascension');
    expect(sum2.length).toBe(8);
  });

  it('performs save and load round-trips with CRC32 integrity verification', () => {
    const save = createDefaultMetaSave();
    save.shards = 1500;
    save.records.highScore = 98000;
    save.unlockedClasses['solar'] = true;
    save.upgrades['vitality_surge'] = { level: 4 };

    const success = SaveIO.saveMeta(save);
    expect(success).toBe(true);

    const loaded = SaveIO.loadMeta();
    expect(loaded.shards).toBe(1500);
    expect(loaded.records.highScore).toBe(98000);
    expect(loaded.unlockedClasses['solar']).toBe(true);
    expect(loaded.upgrades['vitality_surge']?.level).toBe(4);
    expect(loaded.checksum).toBeDefined();
  });

  it('automatically migrates Schema v1 saves to Schema v2', () => {
    const legacyV1 = {
      shards: 850,
      highScore: 45000,
      highestFloor: 4,
      highestCombo: 18,
      totalRuns: 12,
      totalKills: 350,
      totalFoods: 500,
      unlockedClasses: ['emerald', 'stalker', 'hydra'],
      upgrades: {
        vitality_surge: 2,
        swift_slither: 3
      }
    };

    SaveIO.writeKey(STORAGE_KEY_V1, JSON.stringify(legacyV1));

    const loaded = SaveIO.loadMeta();
    expect(loaded.version).toBe(2);
    expect(loaded.shards).toBe(850);
    expect(loaded.records.highScore).toBe(45000);
    expect(loaded.records.highestFloor).toBe(4);
    expect(loaded.unlockedClasses['stalker']).toBe(true);
    expect(loaded.unlockedClasses['hydra']).toBe(true);
    expect(loaded.upgrades['vitality_surge']?.level).toBe(2);
    expect(loaded.upgrades['swift_slither']?.level).toBe(3);
  });

  it('handles corrupted JSON payloads gracefully without throwing', () => {
    SaveIO.writeKey(STORAGE_KEY_V2, '{ invalid: json corrupt... ');
    const fallback = SaveIO.loadMeta();
    expect(fallback).toBeDefined();
    expect(fallback.version).toBe(2);
    expect(fallback.shards).toBe(0);
    expect(fallback.unlockedClasses['emerald']).toBe(true);
  });

  it('exports and imports signed JSON and Base64 saves', () => {
    const save = createDefaultMetaSave();
    save.shards = 2400;
    save.records.victories = 5;
    SaveIO.saveMeta(save);

    // Export JSON
    const exportedJson = SaveIO.exportSaveJson();
    expect(exportedJson).toContain('OUROBOROS_SAVE');

    // Export Base64
    const exportedB64 = SaveIO.exportSaveBase64();
    expect(typeof exportedB64).toBe('string');
    expect(exportedB64.length).toBeGreaterThan(20);

    // Reset store
    SaveIO.clearMemory();

    // Import from Base64
    const result = SaveIO.importSaveBase64(exportedB64);
    expect(result.success).toBe(true);
    expect(result.data?.shards).toBe(2400);
    expect(result.data?.records.victories).toBe(5);

    // Verify persisted
    const loaded = SaveIO.loadMeta();
    expect(loaded.shards).toBe(2400);
  });
});

describe('MultiScreen Manager', () => {
  it('instantiates cleanly with unique window IDs and role assignment', () => {
    const manager = new MultiScreenManager('primary');
    expect(manager.windowId).toContain('win_');
    expect(manager.role).toBe('primary');

    const companion = new MultiScreenManager('hud');
    expect(companion.role).toBe('hud');
    expect(companion.windowId).not.toBe(manager.windowId);

    manager.destroy();
    companion.destroy();
  });

  it('probes available screens safely in headless mode', async () => {
    const manager = new MultiScreenManager('primary');
    const screens = await manager.getAvailableScreens();
    expect(Array.isArray(screens)).toBe(true);
    expect(screens.length).toBeGreaterThanOrEqual(1);
    expect(screens[0]!.isPrimary).toBe(true);
    manager.destroy();
  });
});

describe('CompanionSync Wireless Gamepad & Second-Screen Helper', () => {
  let sync: CompanionSync;

  beforeEach(() => {
    sync = new CompanionSync({ role: 'host' });
  });

  it('generates 6-character room pairing codes and mobile scan URLs', () => {
    expect(sync.roomCode).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    const pairingUrl = sync.getPairingUrl('https://ouroboros.game');
    expect(pairingUrl).toContain('https://ouroboros.game/companion?room=');
    expect(pairingUrl).toContain(encodeURIComponent(sync.roomCode));
  });

  it('handles message transmission and event subscriptions', () => {
    let receivedInput = false;
    sync.onControllerInput((input) => {
      if (input.dirX === 1.0 && input.dash) {
        receivedInput = true;
      }
    });

    sync.sendControllerInput({
      dirX: 1.0,
      dirY: 0.0,
      magnitude: 1.0,
      dash: true,
      skill: false,
      pause: false,
      confirm: false
    });

    sync.sendHudSync({
      hp: 100,
      maxHp: 100,
      shield: 50,
      combo: 12,
      floor: 3,
      shards: 450,
      isFrenzy: true,
      isBoss: false
    });

    sync.selectCard('card_venom_spit', 0);
    sync.cleanup();
  });
});
