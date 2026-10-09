import { describe, it, expect, beforeEach } from 'vitest';
import { SaveIO, STORAGE_KEY_V2 } from '../platform/SaveIO';

describe('SaveIO CRC32 Tamper Detection & Malformed Payload Hardening', () => {
  beforeEach(() => {
    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();
  });

  it('detects tampered payload fields in STORAGE_KEY_V2 via CRC32 mismatch and falls back safely', () => {
    // 1. Save pristine data
    const validSave = SaveIO.resetMeta();
    validSave.shards = 150;
    SaveIO.saveMeta(validSave);

    // 2. Read raw saved JSON
    const rawJson = SaveIO.readKey(STORAGE_KEY_V2);
    expect(rawJson).not.toBeNull();
    const parsed = JSON.parse(rawJson!);

    // 3. Tamper with shards while leaving existing checksum untouched
    parsed.shards = 999999;
    SaveIO.writeKey(STORAGE_KEY_V2, JSON.stringify(parsed));

    // 4. Load meta -> should detect corruption and return clean starter state
    const loaded = SaveIO.loadMeta();
    expect(SaveIO.lastError).toContain('Save integrity checksum mismatch');
    expect(loaded.shards).toBe(0); // Clean default fallback
    expect(loaded.unlockedClasses.emerald).toBe(true);
  });

  it('sanitizes and clamps NaN, Infinity, negative values, and malformed types during V2 normalization', () => {
    const maliciousPayload = {
      version: 2,
      shards: -9999,
      records: {
        highScore: NaN,
        highestFloor: -50,
        highestCombo: Infinity,
        totalRuns: 'invalid_string' as any,
      },
      unlockedClasses: ['emerald', '', '   ', null] as any,
      upgrades: {
        vitality: { level: -5 },
        agility: NaN as any,
      }
    };

    const normalized = SaveIO.validateAndNormalizeV2(maliciousPayload);
    expect(normalized.shards).toBe(0);
    expect(normalized.records.highScore).toBe(0);
    expect(normalized.records.highestFloor).toBe(1);
    expect(normalized.records.highestCombo).toBe(0);
    expect(normalized.records.totalRuns).toBe(0);
    expect(normalized.unlockedClasses.emerald).toBe(true);
    expect(normalized.upgrades.vitality.level).toBe(0);
  });

  it('rejects tampered export JSON envelopes and malformed Base64 strings cleanly', () => {
    const validExport = SaveIO.exportSaveJson();
    const envelope = JSON.parse(validExport);

    // Tamper envelope data
    envelope.data.shards = 777777;
    const tamperedExport = JSON.stringify(envelope);

    const importRes = SaveIO.importSaveJson(tamperedExport);
    expect(importRes.success).toBe(false);
    expect(importRes.error).toContain('Checksum mismatch');

    // Malformed Base64 import
    const b64Res = SaveIO.importSaveBase64('!!!NOT_VALID_BASE64_BYTES!!!');
    expect(b64Res.success).toBe(false);
  });
});
