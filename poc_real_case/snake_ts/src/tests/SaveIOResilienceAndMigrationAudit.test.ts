import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SaveIO, STORAGE_KEY_V2, STORAGE_KEY_V1, createDefaultMetaSave } from '../platform/SaveIO.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { CompanionSync, DesktopHudSyncMessage } from '../platform/CompanionSync.js';

describe('SaveIO, MetaProgression & CompanionSync Resilience & Defect Audit', () => {
  beforeEach(() => {
    SaveIO.clearMemory();
    SaveIO.readOverride = null;
    SaveIO.writeOverride = null;
    SaveIO.deleteOverride = null;
    SaveIO.memoryBackendEnabled = true;
  });

  afterEach(() => {
    SaveIO.readOverride = null;
    SaveIO.writeOverride = null;
    SaveIO.deleteOverride = null;
    SaveIO.memoryBackendEnabled = false;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Defect 1: Serialization & Deserialization Integrity of Ouro & Prestige
  // =========================================================================
  describe('1. Ouro & PrestigeMultiplier Serialization Integrity', () => {
    it('1.1 preserves ouro and prestigeMultiplier across save and load cycles in SaveIO', () => {
      const save = createDefaultMetaSave();
      save.ouro = 4500;
      save.prestigeMultiplier = 3.25;
      save.has9thHelmet = true;
      save.uniqueHelmets = ['celestial_ouroboros', 'crown_of_decay'];

      const saved = SaveIO.saveMeta(save);
      expect(saved).toBe(true);

      const loaded = SaveIO.loadMeta();
      expect(loaded.ouro).toBe(4500);
      expect(loaded.prestigeMultiplier).toBe(3.25);
      expect(loaded.has9thHelmet).toBe(true);
      expect(loaded.uniqueHelmets).toEqual(['celestial_ouroboros', 'crown_of_decay']);
    });

    it('1.2 normalizes missing, negative, or NaN ouro and prestigeMultiplier safely', () => {
      const malformed = {
        version: 2,
        shards: 100,
        ouro: NaN as any,
        prestigeMultiplier: -5.0,
      };

      const normalized = SaveIO.validateAndNormalizeV2(malformed);
      expect(normalized.ouro).toBe(0);
      expect(normalized.prestigeMultiplier).toBe(1.0); // minimum multiplier is 1.0
    });
  });

  // =========================================================================
  // Defect 2: Schema Migration (v1 -> v2) Resiliency & NaN Immunity
  // =========================================================================
  describe('2. Schema Migration v1 -> v2 Hardening', () => {
    it('2.1 migrates legacy saves containing NaN, Infinity, and malformed strings without producing NaN', () => {
      const malformedV1 = {
        version: 1 as const,
        shards: NaN as any,
        highScore: Infinity as any,
        highestFloor: NaN as any,
        highestCombo: -10,
        totalRuns: 'not_a_number' as any,
        unlockedClasses: ['emerald', '', '   ', 'stalker', null as any],
        upgrades: {
          vitality: NaN as any,
          ferocity: { level: Infinity as any },
          agility: { level: 4 }
        },
        ouro: 1250 as any,
        prestigeMultiplier: 2.1 as any
      };

      const migrated = SaveIO.migrateV1toV2(malformedV1);
      expect(migrated.version).toBe(2);
      expect(Number.isFinite(migrated.shards)).toBe(true);
      expect(migrated.shards).toBe(0);
      expect(migrated.records.highScore).toBe(0);
      expect(migrated.records.highestFloor).toBe(1);
      expect(migrated.records.highestCombo).toBe(0);
      expect(migrated.records.totalRuns).toBe(0);
      expect(migrated.upgrades.vitality.level).toBe(0);
      expect(migrated.upgrades.ferocity.level).toBe(0);
      expect(migrated.upgrades.agility.level).toBe(4);
      expect(migrated.unlockedClasses.emerald).toBe(true);
      expect(migrated.unlockedClasses.stalker).toBe(true);
      expect(migrated.unlockedClasses['']).toBeUndefined();
      expect(migrated.ouro).toBe(1250);
      expect(migrated.prestigeMultiplier).toBe(2.1);
    });
  });

  // =========================================================================
  // Defect 3: CRC32 Tamper Detection on New Fields & Rolling Backup Recovery
  // =========================================================================
  describe('3. CRC32 Checksum Integrity & Corruption Recovery', () => {
    it('3.1 detects tampering with ouro or uniqueHelmets in saved JSON', () => {
      const save = createDefaultMetaSave();
      save.ouro = 100;
      save.uniqueHelmets = ['helm_a'];
      SaveIO.saveMeta(save);

      const raw = SaveIO.readKey(STORAGE_KEY_V2);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);

      // Tamper ouro without recalculating checksum
      parsed.ouro = 999999;
      SaveIO.writeKey(STORAGE_KEY_V2, JSON.stringify(parsed));

      // Checksum tampering is detected; falls back safely to clean starter state (0)
      const loaded = SaveIO.loadMeta();
      expect(SaveIO.lastError).toContain('checksum mismatch');
      expect(loaded.ouro).toBe(0);
      expect(loaded.unlockedClasses.emerald).toBe(true);
    });

    it('3.2 automatically recovers from backup store if primary V2 store is corrupted', () => {
      // 1. Save valid initial state
      const goodSave = createDefaultMetaSave();
      goodSave.shards = 750;
      goodSave.ouro = 300;
      SaveIO.saveMeta(goodSave);

      // Verify backup exists
      const backupRaw = SaveIO.readKey('ouroboros_meta_backup');
      expect(backupRaw).not.toBeNull();

      // Corrupt primary store with invalid JSON
      SaveIO.writeKey(STORAGE_KEY_V2, '<<< CORRUPTED TRUNCATED BYTES');

      // Load should recover from backup
      const loaded = SaveIO.loadMeta();
      expect(loaded.shards).toBe(750);
      expect(loaded.ouro).toBe(300);
    });
  });

  // =========================================================================
  // Defect 4: Storage Quota Exceeded (QuotaExceededError) Handling
  // =========================================================================
  describe('4. Storage Quota Exceeded & Private Browsing Fallback', () => {
    it('4.1 prunes legacy V1 store and falls back to in-memory store on QuotaExceededError without throwing', () => {
      // Mock localStorage throwing QuotaExceededError
      const mockStorage: Record<string, string> = {
        [STORAGE_KEY_V1]: '{"shards": 50}'
      };

      SaveIO.memoryBackendEnabled = false;

      let setItemCalls = 0;
      const fakeLocalStorage = {
        getItem: (k: string) => mockStorage[k] ?? null,
        setItem: (k: string, v: string) => {
          setItemCalls++;
          if (mockStorage[STORAGE_KEY_V1] && setItemCalls === 1) {
            // First attempt: throw QuotaExceededError
            const err = new Error('The quota has been exceeded.') as any;
            err.name = 'QuotaExceededError';
            err.code = 22;
            throw err;
          }
          mockStorage[k] = v;
        },
        removeItem: (k: string) => {
          delete mockStorage[k];
        }
      };

      vi.stubGlobal('localStorage', fakeLocalStorage);

      // Write should prune STORAGE_KEY_V1 and retry, successfully writing
      const ok = SaveIO.writeKey(STORAGE_KEY_V2, '{"version": 2}');
      expect(ok).toBe(true);
      expect(mockStorage[STORAGE_KEY_V1]).toBeUndefined(); // Pruned
      expect(mockStorage[STORAGE_KEY_V2]).toBe('{"version": 2}');
    });

    it('4.2 seamlessly retains state in memory store if localStorage persistently fails quota', () => {
      const persistentQuotaError = new Error('Quota permanently exceeded') as any;
      persistentQuotaError.name = 'QuotaExceededError';
      persistentQuotaError.code = 22;

      const failingLocalStorage = {
        getItem: () => null,
        setItem: () => { throw persistentQuotaError; },
        removeItem: () => {}
      };

      vi.stubGlobal('localStorage', failingLocalStorage);
      SaveIO.memoryBackendEnabled = false;

      // Writing when disk is totally full should fallback to in-memory store without crashing
      const writeResult = SaveIO.writeKey('test_key', 'test_value');
      expect(writeResult).toBe(true);
      expect(SaveIO.readKey('test_key')).toBe('test_value');
    });
  });

  // =========================================================================
  // Defect 5: MetaProgression Corrupted Storage Backend & Truncated JSON
  // =========================================================================
  describe('5. MetaProgression Isolated Backend Corrupted JSON Resilience', () => {
    it('5.1 falls back cleanly to starter state when custom saveBackend returns corrupted JSON', () => {
      const corruptedBackend = {
        read: () => '{ truncated corrupt json ::::',
        write: vi.fn(),
        delete: vi.fn(),
      };

      const meta = MetaProgression.createIsolated({
        saveBackend: corruptedBackend
      });

      // Should not throw and should have valid starter state
      expect(meta.shards).toBe(0);
      expect(meta.isUnlocked('emerald')).toBe(true);
      expect(meta.records.highestFloor).toBe(1);
    });

    it('5.2 normalizes invalid/corrupted data structures from custom saveBackend', () => {
      const invalidDataBackend = {
        read: () => JSON.stringify({
          version: 2,
          shards: -500,
          ouro: NaN,
          unlockedClasses: ['emerald', null, ''],
        }),
        write: vi.fn(),
        delete: vi.fn(),
      };

      const meta = MetaProgression.createIsolated({
        saveBackend: invalidDataBackend
      });

      expect(meta.shards).toBe(0);
      expect(meta.ouro).toBe(0);
      expect(meta.isUnlocked('emerald')).toBe(true);
    });
  });

  // =========================================================================
  // Defect 6: CompanionSync Serialization & Corrupted Message Wire Safety
  // =========================================================================
  describe('6. CompanionSync Wire Message Safety', () => {
    it('6.1 safely ignores corrupted or non-object wire messages without unhandled exceptions', () => {
      const companion = new CompanionSync();
      const listener = vi.fn();
      companion.onHudSync(listener);

      // Access private wire message handler
      const wireHandler = (companion as any).onWireMessage.bind(companion);

      expect(() => wireHandler(null as any)).not.toThrow();
      expect(() => wireHandler(undefined as any)).not.toThrow();
      expect(() => wireHandler('not an object' as any)).not.toThrow();
      expect(() => wireHandler({ type: 'UNKNOWN_MESSAGE_TYPE' })).not.toThrow();
      expect(listener).not.toHaveBeenCalled();
    });

    it('6.2 includes ouro and equippedHelmetId in desktop HUD sync messages', () => {
      const companion = new CompanionSync();
      let dispatchedMessage: any = null;
      vi.spyOn(companion, 'send').mockImplementation((msg) => {
        dispatchedMessage = msg;
      });

      companion.sendHudSync({
        hp: 100,
        maxHp: 100,
        shield: 50,
        combo: 5,
        floor: 3,
        shards: 250,
        ouro: 75,
        equippedHelmetId: 'primordial_centipede',
        isFrenzy: false,
        isBoss: false,
      } as any);

      expect(dispatchedMessage).not.toBeNull();
      expect(dispatchedMessage.type).toBe('HUD_SYNC');
      expect(dispatchedMessage.ouro).toBe(75);
      expect(dispatchedMessage.equippedHelmetId).toBe('primordial_centipede');
    });
  });
});
