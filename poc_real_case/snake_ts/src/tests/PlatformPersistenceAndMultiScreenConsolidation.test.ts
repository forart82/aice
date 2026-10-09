import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupMockDom } from './MockDom';
import {
  SaveIO,
  computeCrc32,
  createDefaultMetaSave,
  createDefaultRecords,
  STORAGE_KEY_V1,
  STORAGE_KEY_V2
} from '../platform/SaveIO.js';
import {
  MultiScreenManager,
  MultiScreenSync,
  type MultiScreenPacket,
  type GameStateSyncPayload,
  type MinimapSyncPayload,
  type InputEventPayload,
  MULTISCREEN_CHANNEL_NAME
} from '../platform/MultiScreen.js';
import { CompanionSync } from '../platform/CompanionSync.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { GameData } from '../data/GameData.js';
import { UiRoot } from '../ui/UiRoot.js';
import { MultiScreenModal } from '../ui/screens/MultiScreenModal.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound } from '../core/Contracts.js';

describe('Platform Persistence & MultiScreen Consolidation Test Suite', () => {
  let teardownDom: () => void;

  beforeEach(() => {
    teardownDom = setupMockDom();
    Services.sound = new NullSound();
    Services.fx = new NullFx();
    Services.headless = true;

    SaveIO.memoryBackendEnabled = true;
    SaveIO.clearMemory();
    SaveIO.install();
    MetaProgression.instance = new MetaProgression();
  });

  afterEach(() => {
    teardownDom();
    SaveIO.readOverride = null;
    SaveIO.writeOverride = null;
    SaveIO.deleteOverride = null;
  });

  describe('1. Centralized SaveIO Persistence & Schema v2 Validation', () => {
    it('generates consistent default meta state', () => {
      const def = createDefaultMetaSave();
      expect(def.version).toBe(2);
      expect(def.shards).toBe(0);
      expect(def.unlockedClasses['emerald']).toBe(true);
      expect(def.records.highestFloor).toBe(1);
      expect(def.unlockedTiers?.['turret']).toBe(1);
      expect(def.helmets).toEqual([]);
      expect(def.equippedHelmetId).toBeNull();
    });

    it('computes deterministic CRC32 checksums', () => {
      const cs1 = computeCrc32('OuroborosAscension2026');
      const cs2 = computeCrc32('OuroborosAscension2026');
      const cs3 = computeCrc32('DifferentPayload');

      expect(cs1).toBe(cs2);
      expect(cs1).not.toBe(cs3);
      expect(cs1.length).toBe(8);
    });

    it('persists and retrieves full save payload with CRC32 integrity checksum', () => {
      const save = createDefaultMetaSave();
      save.shards = 4250;
      save.unlockedClasses['solar'] = true;
      save.unlockedClasses['hydra'] = true;
      save.upgrades['vitality'] = { level: 5 };
      save.records.highScore = 75000;
      save.records.highestFloor = 6;
      save.records.victories = 3;
      save.helmets = [
        {
          Id: 'helm_leviathan_1',
          id: 'helm_leviathan_1',
          Name: 'Leviathan Crown',
          name: 'Leviathan Crown',
          Rarity: 'legendary',
          rarity: 'legendary',
          Floor: 8,
          floor: 8,
          BossType: 'leviathan',
          bossType: 'leviathan',
          Stats: { maxHp: 50 },
          stats: { maxHp: 50 },
          Description: 'Crown of the abyss',
          description: 'Crown of the abyss',
          Icon: '👑',
          icon: '👑'
        }
      ];
      save.equippedHelmetId = 'helm_leviathan_1';

      const ok = SaveIO.saveMeta(save);
      expect(ok).toBe(true);

      const loaded = SaveIO.loadMeta();
      expect(loaded.shards).toBe(4250);
      expect(loaded.unlockedClasses['solar']).toBe(true);
      expect(loaded.unlockedClasses['hydra']).toBe(true);
      expect(loaded.upgrades['vitality']?.level).toBe(5);
      expect(loaded.records.highScore).toBe(75000);
      expect(loaded.records.highestFloor).toBe(6);
      expect(loaded.records.victories).toBe(3);
      expect(loaded.helmets?.length).toBe(1);
      expect(loaded.equippedHelmetId).toBe('helm_leviathan_1');
      expect(loaded.checksum).toBeDefined();
    });

    it('automatically migrates Schema v1 saves to structured Schema v2', () => {
      const legacySave = {
        shards: 1200,
        highScore: 88000,
        highestFloor: 5,
        highestCombo: 24,
        totalRuns: 19,
        totalKills: 450,
        totalFoods: 320,
        unlockedClasses: ['emerald', 'storm', 'stalker'],
        upgrades: {
          vitality: 4,
          agility: { level: 3 }
        }
      };

      SaveIO.writeKey(STORAGE_KEY_V1, JSON.stringify(legacySave));

      const loaded = SaveIO.loadMeta();
      expect(loaded.version).toBe(2);
      expect(loaded.shards).toBe(1200);
      expect(loaded.records.highScore).toBe(88000);
      expect(loaded.records.highestFloor).toBe(5);
      expect(loaded.records.highestCombo).toBe(24);
      expect(loaded.records.totalRuns).toBe(19);
      expect(loaded.unlockedClasses['storm']).toBe(true);
      expect(loaded.unlockedClasses['stalker']).toBe(true);
      expect(loaded.upgrades['vitality']?.level).toBe(4);
      expect(loaded.upgrades['agility']?.level).toBe(3);
    });

    it('resiliently handles corrupted JSON strings without throwing', () => {
      SaveIO.writeKey(STORAGE_KEY_V2, '<<< CORRUPTED NON-JSON BYTES >>>');
      const fallback = SaveIO.loadMeta();

      expect(fallback).toBeDefined();
      expect(fallback.version).toBe(2);
      expect(fallback.shards).toBe(0);
      expect(fallback.unlockedClasses['emerald']).toBe(true);
      expect(SaveIO.lastError).not.toBeNull();
    });

    it('exports signed JSON envelopes and detects tampering on import', () => {
      const save = createDefaultMetaSave();
      save.shards = 3000;
      save.records.highScore = 50000;
      SaveIO.saveMeta(save);

      const jsonEnvelope = SaveIO.exportSaveJson();
      expect(jsonEnvelope).toContain('OUROBOROS_SAVE');

      // Normal import
      SaveIO.clearMemory();
      const res = SaveIO.importSaveJson(jsonEnvelope);
      expect(res.success).toBe(true);
      expect(res.data?.shards).toBe(3000);

      // Tampered envelope checksum
      const tampered = JSON.parse(jsonEnvelope);
      tampered.data.shards = 999999; // Modified data without updating envelope checksum
      const tamperedRes = SaveIO.importSaveJson(JSON.stringify(tampered));
      expect(tamperedRes.success).toBe(false);
      expect(tamperedRes.error).toContain('Checksum mismatch');
    });

    it('supports Base64 save payload export and import round-trips', () => {
      const save = createDefaultMetaSave();
      save.shards = 7777;
      save.unlockedClasses['solar'] = true;
      SaveIO.saveMeta(save);

      const b64 = SaveIO.exportSaveBase64();
      expect(typeof b64).toBe('string');
      expect(b64.length).toBeGreaterThan(30);

      SaveIO.clearMemory();
      const imp = SaveIO.importSaveBase64(b64);
      expect(imp.success).toBe(true);
      expect(imp.data?.shards).toBe(7777);
      expect(imp.data?.unlockedClasses['solar']).toBe(true);
    });
  });

  describe('2. MetaProgression Integration with SaveIO', () => {
    it('loads and saves meta state directly via SaveIO', () => {
      const meta = MetaProgression.instance;
      meta.addShards(1500);
      expect(meta.shards).toBe(1500);

      meta.unlockClass('stalker');
      expect(meta.isUnlocked('stalker')).toBe(true);

      meta.buyUpgrade('vitality');
      expect(meta.level('vitality')).toBe(1);

      // Verify in SaveIO directly
      const saved = SaveIO.loadMeta();
      expect(saved.shards).toBe(1500 - (GameData.Classes.get('stalker')?.cost ?? 150) - 40);
      expect(saved.unlockedClasses['stalker']).toBe(true);
      expect(saved.upgrades['vitality']?.level).toBe(1);
    });

    it('persists and restores Daily Special Capacity state', () => {
      const meta = MetaProgression.instance;
      const cap = meta.unlockDailySpecialCapacity({
        id: 'daily_solar_flare',
        name: 'Solar Flare Overdrive',
        desc: 'All weapons gain +50% fire rate and solar blast aura',
        icon: '☀️',
        stateValues: { fireRateBonus: 0.5 }
      });

      expect(meta.isDailyCapacityActive()).toBe(true);
      expect(cap.id).toBe('daily_solar_flare');

      // Create new MetaProgression instance and verify reload
      const meta2 = new MetaProgression();
      expect(meta2.isDailyCapacityActive()).toBe(true);
      expect(meta2.dailyCapacityState?.id).toBe('daily_solar_flare');
      expect(meta2.dailyCapacityState?.stateValues?.fireRateBonus).toBe(0.5);
    });

    it('persists Helmet inventory and equipped helmet via SaveIO', () => {
      const meta = MetaProgression.instance;
      meta.addHelmet({
        Id: 'helm_gorgon_eye',
        id: 'helm_gorgon_eye',
        Name: 'Gorgon Visage',
        name: 'Gorgon Visage',
        Rarity: 'epic',
        rarity: 'epic',
        Floor: 4,
        floor: 4,
        BossType: 'gorgon',
        bossType: 'gorgon',
        Stats: { stunDuration: 1.5 },
        stats: { stunDuration: 1.5 },
        Description: 'Petrifying gaze',
        description: 'Petrifying gaze',
        Icon: '👁️',
        icon: '👁️'
      });

      meta.equipHelmet('helm_gorgon_eye');
      expect(meta.equippedHelmetId).toBe('helm_gorgon_eye');

      const reloaded = new MetaProgression();
      expect(reloaded.helmets.length).toBe(1);
      expect(reloaded.equippedHelmetId).toBe('helm_gorgon_eye');
      expect(reloaded.getEquippedHelmet()?.name).toBe('Gorgon Visage');
    });

    it('records and persists run summary via CommitRun', () => {
      const meta = MetaProgression.instance;
      meta.commitRun({
        score: 45000,
        floor: 5,
        combo: 22,
        kills: 120,
        foods: 95,
        bosses: 4,
        timeSec: 360,
        victory: true
      });

      expect(meta.records.highScore).toBe(45000);
      expect(meta.records.highestFloor).toBe(5);
      expect(meta.records.highestCombo).toBe(22);
      expect(meta.records.victories).toBe(1);
      expect(meta.records.totalRuns).toBe(1);

      const saved = SaveIO.loadMeta();
      expect(saved.records.highScore).toBe(45000);
      expect(saved.records.victories).toBe(1);
    });
  });

  describe('3. Unified MultiScreen Architecture & MultiScreenManager', () => {
    let primary: MultiScreenManager;
    let secondary: MultiScreenManager;

    beforeEach(() => {
      MultiScreenManager.testBus = [];
      primary = new MultiScreenManager('primary');
      secondary = new MultiScreenManager('hud');

      MultiScreenManager.testBus.push((msg) => {
        primary['handleMessage'](msg as any);
        secondary['handleMessage'](msg as any);
      });
    });

    afterEach(() => {
      primary.destroy();
      secondary.destroy();
      MultiScreenManager.testBus = [];
    });

    it('maintains unified packet structure across windows', () => {
      let receivedGameState: GameStateSyncPayload | null = null;

      secondary.on<GameStateSyncPayload>('GAME_STATE_SYNC', (payload) => {
        receivedGameState = payload;
      });

      const gameState: GameStateSyncPayload = {
        floor: 4,
        score: 28000,
        combo: 16,
        maxCombo: 25,
        hp: 90,
        maxHp: 100,
        shield: 30,
        shards: 120,
        level: 8,
        isFrenzy: true,
        isBoss: true,
        bossHp: 500,
        bossMaxHp: 1000,
        bossName: 'Centipede Behemoth',
        isPaused: false
      };

      primary.syncGameState(gameState);

      expect(receivedGameState).not.toBeNull();
      expect(receivedGameState!.score).toBe(28000);
      expect(receivedGameState!.bossName).toBe('Centipede Behemoth');
      expect(receivedGameState!.isFrenzy).toBe(true);
    });

    it('transmits minimap entity telemetry across displays', () => {
      let receivedMinimap: MinimapSyncPayload | null = null;

      secondary.on<MinimapSyncPayload>('MINIMAP_SYNC', (payload) => {
        receivedMinimap = payload;
      });

      const minimapData: MinimapSyncPayload = {
        arenaWidth: 2000,
        arenaHeight: 2000,
        entities: [
          { id: 'player_head', type: 'player', x: 1000, y: 1000, angle: 0 },
          { id: 'boss_1', type: 'boss', x: 1200, y: 1100, radius: 40 }
        ]
      };

      primary.syncMinimap(minimapData);

      expect(receivedMinimap).not.toBeNull();
      expect(receivedMinimap!.arenaWidth).toBe(2000);
      expect(receivedMinimap!.entities.length).toBe(2);
    });

    it('backward compatibility: MultiScreenSync proxy behaves identically', () => {
      MultiScreenSync.testBus = [];
      const syncA = new MultiScreenSync('primary', 'host_win');
      const syncB = new MultiScreenSync('companion', 'ctrl_win');

      MultiScreenSync.testBus.push((packet) => {
        syncA.handleIncoming(packet);
        syncB.handleIncoming(packet);
      });

      let receivedInput: InputEventPayload | null = null;
      syncA.on<InputEventPayload>('INPUT_EVENT', (packet) => {
        receivedInput = packet.payload;
      });

      syncB.send('INPUT_EVENT', {
        action: 'dash',
        dirX: 1,
        dirY: 0
      });

      expect(receivedInput).not.toBeNull();
      expect(receivedInput!.action).toBe('dash');

      syncA.close();
      syncB.close();
    });
  });

  describe('4. CompanionSync Wireless WebRTC & QR Pairing Integration', () => {
    let companionHost: CompanionSync;

    beforeEach(() => {
      companionHost = new CompanionSync({ role: 'host' });
    });

    afterEach(() => {
      companionHost.cleanup();
    });

    it('generates 6-character room codes and mobile pairing URLs', () => {
      expect(companionHost.roomCode).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
      const url = companionHost.getPairingUrl('https://ouroboros.game');
      expect(url).toBe(`https://ouroboros.game/companion?room=${encodeURIComponent(companionHost.roomCode)}`);
    });

    it('supports subscribing to controller input, HUD sync, and card selection events', () => {
      let inputFired = false;
      let hudFired = false;
      let cardFired = false;

      companionHost.onControllerInput((input) => {
        if (input.dash && input.dirX === 1.0) inputFired = true;
      });

      companionHost.onHudSync((hud) => {
        if (hud.score === 15000) hudFired = true;
      });

      companionHost.onCardSelected((card) => {
        if (card.cardId === 'card_tesla') cardFired = true;
      });

      companionHost['onWireMessage']({
        type: 'CONTROLLER_INPUT',
        seq: 1,
        dirX: 1.0,
        dirY: 0.0,
        magnitude: 1.0,
        dash: true,
        skill: false,
        pause: false,
        confirm: false
      });

      companionHost['onWireMessage']({
        type: 'HUD_SYNC',
        hp: 100,
        maxHp: 100,
        shield: 20,
        combo: 5,
        floor: 2,
        shards: 50,
        isFrenzy: false,
        isBoss: false,
        score: 15000
      } as any);

      companionHost['onWireMessage']({
        type: 'CARD_SELECTED',
        cardId: 'card_tesla',
        cardIndex: 0
      });

      expect(inputFired).toBe(true);
      expect(hudFired).toBe(true);
      expect(cardFired).toBe(true);
    });
  });

  describe('5. MultiScreenModal UI & System Consumption', () => {
    let mockEngine: any;
    let uiRoot: UiRoot;
    let modal: MultiScreenModal;

    beforeEach(() => {
      mockEngine = {
        companionInputs: [] as any[],
        onCompanionInput(input: any) {
          this.companionInputs.push(input);
        }
      };

      const container = document.createElement('div');
      uiRoot = UiRoot.init(container as any, mockEngine);
      modal = new MultiScreenModal(uiRoot);
      uiRoot.registerScreen(modal);
    });

    it('renders room code, copy link, and popout window controls', () => {
      uiRoot.showScreen('modal-multiscreen');

      const urlInput = modal.element.querySelector('.companion-url-input') as HTMLInputElement;
      const copyBtn = modal.element.querySelector('.btn-copy-url') as HTMLButtonElement;
      const popoutBtn = modal.element.querySelector('.btn-popout-window') as HTMLButtonElement;

      expect(urlInput).not.toBeNull();
      expect(urlInput.value).toContain('companion');
      expect(copyBtn).not.toBeNull();
      expect(popoutBtn).not.toBeNull();
    });

    it('forwards companion input events to engine', () => {
      uiRoot.showScreen('modal-multiscreen');

      // Simulate input event received via companion sync
      modal.handleCompanionInput({
        dirX: 0.5,
        dirY: 0.866,
        dash: true
      });

      expect(mockEngine.companionInputs.length).toBe(1);
      expect(mockEngine.companionInputs[0].dash).toBe(true);
    });
  });
});
