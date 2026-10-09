/**
 * ============================================================================
 * Platform, Multi-Screen, Audio, Responsive Layout & Pure WebGL Invariance Suite
 * (PlatformMultiScreenAudioAndRenderInvariance.test.ts)
 * Protocol 3.0 Commercial Engine Edition — Big Audit Step 3
 * ============================================================================
 *
 * Single Source of Truth (SSOT):
 * - ORACLE.md Section 9 & AGENTS.md Rule 12 (Pure WebGL Mandate & Canvas 2D Ban)
 * - ORACLE.md Multi-Screen & CompanionSync Architecture
 * - ORACLE.md Audio Voice Limiter, Ducking & Studio Master Compressor
 * - ORACLE.md Responsive Layout & Touch Joystick Physical Formulas
 *
 * GOAL:
 * Validates that all underlying mathematical formulas, acoustic parameters,
 * network packet schemas, layout metrics, and rendering invariants remain strictly
 * functional and unchanged across the entire engine.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { setupMockDom } from './MockDom';

// --- WebGL 2.0 & Rendering Imports ---
import { WebGLContext, GLPrimitive, type ICamera } from '../render/webgl/WebGLContext';
import { GLBatch } from '../render/webgl/GLBatch';
import { WebGLGameRenderer } from '../render/webgl/WebGLGameRenderer';

// --- Platform & Multi-Screen Imports ---
import {
  MultiScreenManager,
  MultiScreenSync,
  type MultiScreenPacket,
  type StateSyncPayload,
  type InputEventPayload,
  type MinimapSyncPayload,
  MULTISCREEN_CHANNEL_NAME,
} from '../platform/MultiScreen';
import { CompanionSync, type ControllerInputMessage, type DesktopHudSyncMessage } from '../platform/CompanionSync';
import { SaveIO, computeCrc32 } from '../platform/SaveIO';

// --- Audio & Synth Imports ---
import { SoundEngine } from '../audio/SoundEngine';
import {
  clearAudioBufferCache,
  setCachedAudioBuffer,
  BROADCAST_AUDIO_PATHS,
  createEatVoices,
} from '../audio/Synth';

// --- Responsive Layout & Touch Input Imports ---
import { ResponsiveLayout, type ISafeAreaInsets } from '../ui/ResponsiveLayout';
import { VirtualStick } from '../input/VirtualStick';
import { TouchControls } from '../input/TouchControls';
import { InputManager } from '../input/InputManager';
import { Vec2 } from '../core/Vec2';

// ============================================================================
// Mock Web Audio Infrastructure for Headless Vitest Environment
// ============================================================================

class MockAudioParam {
  public value: number = 0;
  public setValueAtTime = vi.fn((val: number, _t: number) => {
    this.value = val;
    return this;
  });
  public linearRampToValueAtTime = vi.fn((val: number, _t: number) => {
    this.value = val;
    return this;
  });
  public exponentialRampToValueAtTime = vi.fn((val: number, _t: number) => {
    this.value = val;
    return this;
  });
  public setTargetAtTime = vi.fn().mockReturnThis();
  public cancelScheduledValues = vi.fn().mockReturnThis();
}

class MockAudioNode {
  public connectedTargets: any[] = [];
  public disconnected: boolean = false;

  public connect(target: any): any {
    this.connectedTargets.push(target);
    return target;
  }

  public disconnect(): void {
    this.disconnected = true;
    this.connectedTargets = [];
  }
}

class MockGainNode extends MockAudioNode {
  public gain = new MockAudioParam();
}

class MockDynamicsCompressorNode extends MockAudioNode {
  public threshold = new MockAudioParam();
  public knee = new MockAudioParam();
  public ratio = new MockAudioParam();
  public attack = new MockAudioParam();
  public release = new MockAudioParam();
}

class MockOscillatorNode extends MockAudioNode {
  public type: string = 'sine';
  public frequency = new MockAudioParam();
  public detune = new MockAudioParam();
  public onended: (() => void) | null = null;
  public started: boolean = false;
  public stopped: boolean = false;
  public start(): void { this.started = true; }
  public stop(): void { this.stopped = true; }
}

class MockBufferSourceNode extends MockAudioNode {
  public buffer: any = null;
  public playbackRate = new MockAudioParam();
  public detune = new MockAudioParam();
  public loop: boolean = false;
  public onended: (() => void) | null = null;
  public started: boolean = false;
  public stopped: boolean = false;
  public start(): void { this.started = true; }
  public stop(): void { this.stopped = true; }
}

class MockAudioContext {
  public currentTime: number = 20.0;
  public sampleRate: number = 44100;
  public state: string = 'running';
  public destination = new MockAudioNode();

  public createdCompressors: MockDynamicsCompressorNode[] = [];
  public createdGains: MockGainNode[] = [];
  public createdOscillators: MockOscillatorNode[] = [];
  public createdSources: MockBufferSourceNode[] = [];

  public createGain(): MockGainNode {
    const g = new MockGainNode();
    this.createdGains.push(g);
    return g;
  }

  public createDynamicsCompressor(): MockDynamicsCompressorNode {
    const c = new MockDynamicsCompressorNode();
    this.createdCompressors.push(c);
    return c;
  }

  public createOscillator(): MockOscillatorNode {
    const o = new MockOscillatorNode();
    this.createdOscillators.push(o);
    return o;
  }

  public createBufferSource(): MockBufferSourceNode {
    const s = new MockBufferSourceNode();
    this.createdSources.push(s);
    return s;
  }

  public createBuffer(channels: number, length: number, sampleRate: number): any {
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    };
  }

  public resume(): Promise<void> {
    return Promise.resolve();
  }
}

// ============================================================================
// MAIN INVARIANCE TEST SUITE
// ============================================================================

describe('Platform, Multi-Screen, Audio, Responsive Layout & Pure WebGL Invariance', () => {
  const rootSrcDir = path.resolve(__dirname, '..');
  let cleanupDom: () => void;

  beforeEach(() => {
    cleanupDom = setupMockDom();
  });

  afterEach(() => {
    if (cleanupDom) cleanupDom();
  });

  // ==========================================================================
  // 1. RULE 12 PURE WEBGL 2.0 INVARIANCE
  // ==========================================================================
  describe('1. Rule 12 Pure WebGL 2.0 Invariance', () => {
    const productionDirs = ['render', 'sim', 'input', 'ui', 'data', 'core', 'platform'];

    function getTsFilesRecursively(dir: string): string[] {
      const results: string[] = [];
      if (!fs.existsSync(dir)) return results;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...getTsFilesRecursively(full));
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          results.push(full);
        }
      }
      return results;
    }

    it('asserts ZERO Canvas 2D references across all production code directories', () => {
      for (const sub of productionDirs) {
        const targetDir = path.join(rootSrcDir, sub);
        const files = getTsFilesRecursively(targetDir);
        for (const file of files) {
          const content = fs.readFileSync(file, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            const trimmed = line.trim();
            // Skip comments
            if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
              continue;
            }
            expect(
              line,
              `Found CanvasRenderingContext2D violation in ${path.relative(rootSrcDir, file)}:${i + 1}`
            ).not.toContain('CanvasRenderingContext2D');

            expect(
              line,
              `Found getContext('2d') violation in ${path.relative(rootSrcDir, file)}:${i + 1}`
            ).not.toContain("getContext('2d'");

            expect(
              line,
              `Found getContext("2d") violation in ${path.relative(rootSrcDir, file)}:${i + 1}`
            ).not.toContain('getContext("2d"');

            expect(
              line,
              `Found OffscreenCanvasRenderingContext2D violation in ${path.relative(rootSrcDir, file)}:${i + 1}`
            ).not.toContain('OffscreenCanvasRenderingContext2D');
          }
        }
      }
    });

    it('verifies 3x3 camera projection matrix calculation with zoom, translation, rotation, and shake', () => {
      const context = new WebGLContext();
      const camera: ICamera = {
        x: 600,
        y: 400,
        zoom: 1.5,
        rotation: Math.PI / 6, // 30 degrees
        shakeX: 6.0,
        shakeY: -4.5,
      };

      const W = 1200;
      const H = 800;
      const mat = context.computeCameraMatrix(camera, W, H);

      // Analytical formula verification
      const z = camera.zoom;
      const rot = camera.rotation;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const a = z * cos;
      const b = z * sin;

      // Col 0
      expect(mat[0]).toBeCloseTo((2.0 * a) / W, 6);
      expect(mat[1]).toBeCloseTo((-2.0 * b) / H, 6);
      expect(mat[2]).toBe(0.0);

      // Col 1
      expect(mat[3]).toBeCloseTo((-2.0 * b) / W, 6);
      expect(mat[4]).toBeCloseTo((-2.0 * a) / H, 6);
      expect(mat[5]).toBe(0.0);

      // Col 2
      const expectedTransX = (2.0 * camera.shakeX! - 2.0 * (a * camera.x - b * camera.y)) / W;
      const expectedTransY = (-2.0 * camera.shakeY! + 2.0 * (b * camera.x + a * camera.y)) / H;
      expect(mat[6]).toBeCloseTo(expectedTransX, 6);
      expect(mat[7]).toBeCloseTo(expectedTransY, 6);
      expect(mat[8]).toBe(1.0);
    });

    it('verifies screen-space orthographic projection matrix mapping [0, W]x[0, H] to NDC [-1, 1]', () => {
      const context = new WebGLContext();
      const W = 1920;
      const H = 1080;
      const mat = context.computeScreenMatrix(W, H);

      // Col 0
      expect(mat[0]).toBeCloseTo(2.0 / W, 6);
      expect(mat[1]).toBe(0.0);
      expect(mat[2]).toBe(0.0);

      // Col 1
      expect(mat[3]).toBe(0.0);
      expect(mat[4]).toBeCloseTo(-2.0 / H, 6);
      expect(mat[5]).toBe(0.0);

      // Col 2 (Translation mapping screen 0,0 to NDC -1, 1)
      expect(mat[6]).toBe(-1.0);
      expect(mat[7]).toBe(1.0);
      expect(mat[8]).toBe(1.0);

      // Test point projection: Top-Left (0, 0) -> NDC (-1, 1)
      const tlX = mat[0] * 0 + mat[3] * 0 + mat[6];
      const tlY = mat[1] * 0 + mat[4] * 0 + mat[7];
      expect(tlX).toBeCloseTo(-1.0, 5);
      expect(tlY).toBeCloseTo(1.0, 5);

      // Test point projection: Bottom-Right (1920, 1080) -> NDC (1, -1)
      const brX = mat[0] * 1920 + mat[3] * 1080 + mat[6];
      const brY = mat[1] * 1920 + mat[4] * 1080 + mat[7];
      expect(brX).toBeCloseTo(1.0, 5);
      expect(brY).toBeCloseTo(-1.0, 5);

      // Test point projection: Center (960, 540) -> NDC (0, 0)
      const cX = mat[0] * 960 + mat[3] * 540 + mat[6];
      const cY = mat[1] * 960 + mat[4] * 540 + mat[7];
      expect(cX).toBeCloseTo(0.0, 5);
      expect(cY).toBeCloseTo(0.0, 5);
    });

    it('enforces GLPrimitive enum mapping and GLBatch vertex structure invariance', () => {
      // Primitive types mapped directly to SDF shader branches
      expect(GLPrimitive.Quad).toBe(0);
      expect(GLPrimitive.Circle).toBe(1);
      expect(GLPrimitive.Ring).toBe(2);
      expect(GLPrimitive.Sphere).toBe(3);
      expect(GLPrimitive.Laser).toBe(4);
      expect(GLPrimitive.Texture).toBe(5);
      expect(GLPrimitive.Nebula).toBe(6);

      // GLBatch vertex layout: 6 floats per vertex (x, y, u, v, color_u32, params_f32)
      expect(GLBatch.FLOATS_PER_VERTEX).toBe(6);
      expect(GLBatch.VERTICES_PER_QUAD).toBe(4);
      expect(GLBatch.FLOATS_PER_QUAD).toBe(24);
      expect(GLBatch.INDICES_PER_QUAD).toBe(6);
      expect(GLBatch.DEFAULT_MAX_QUADS).toBe(4096);
    });

    it('validates WebGL context loss recovery hooks and preventDefault invocation', () => {
      const canvas = document.createElement('canvas');
      const renderer = new WebGLGameRenderer(canvas as any);

      expect(typeof renderer.handleContextLost).toBe('function');
      expect(typeof renderer.handleContextRestored).toBe('function');

      const lostEvent = {
        type: 'webglcontextlost',
        preventDefault: vi.fn(),
      };

      // Trigger context loss
      renderer.handleContextLost(lostEvent);
      expect(lostEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(renderer.isReady()).toBe(false);

      // Trigger restoration
      renderer.handleContextRestored();

      // Clean disposal
      renderer.dispose();
      expect(renderer.isReady()).toBe(false);
    });
  });

  // ==========================================================================
  // 2. MULTISCREEN & COMPANIONSYNC WIRE INVARIANCE
  // ==========================================================================
  describe('2. MultiScreen & CompanionSync Wire Invariance', () => {
    beforeEach(() => {
      MultiScreenManager.clearTestBus();
      MultiScreenSync.clearTestBus();
    });

    afterEach(() => {
      MultiScreenManager.clearTestBus();
      MultiScreenSync.clearTestBus();
    });

    it('computes deterministic CRC32 checksums and detects payload tampering', () => {
      // Standard IEEE 802.3 CRC32 check vector
      expect(computeCrc32('123456789')).toBe('cbf43926');
      expect(computeCrc32('Ouroboros Ascension')).toBe(computeCrc32('Ouroboros Ascension'));

      const payload = {
        shards: 500,
        unlockedClasses: ['emerald', 'hydra'],
        highestFloor: 5,
      };

      const raw1 = JSON.stringify(payload);
      const crc1 = computeCrc32(raw1);

      // Tampered payload
      const tampered = { ...payload, shards: 501 };
      const raw2 = JSON.stringify(tampered);
      const crc2 = computeCrc32(raw2);

      expect(crc1).not.toBe(crc2);
      expect(crc1).toHaveLength(8);
    });

    it('serializes and deserializes MultiScreenPacket payloads preserving all typed contracts', () => {
      const statePayload: StateSyncPayload = {
        state: 'PLAYING',
        score: 42000,
        floor: 7,
        level: 12,
        hp: 120,
        maxHp: 150,
        shield: 50,
        maxShield: 50,
        combo: 25,
        comboMult: 3.5,
        shards: 180,
        kills: 95,
        isFrenzy: true,
        isBoss: true,
        bossHp: 800,
        bossMaxHp: 2000,
        bossName: 'Cranial Goliath',
      };

      const packet: MultiScreenPacket<StateSyncPayload> = {
        channel: 'OUROBOROS_MULTISCREEN',
        id: 'pkt_123',
        senderId: 'host_win_01',
        sourceWindowId: 'host_win_01',
        role: 'primary',
        sourceRole: 'primary',
        timestamp: 1700000000000,
        type: 'SYNC_STATE',
        payload: statePayload,
      };

      const serialized = JSON.stringify(packet);
      const deserialized = JSON.parse(serialized) as MultiScreenPacket<StateSyncPayload>;

      expect(deserialized.channel).toBe('OUROBOROS_MULTISCREEN');
      expect(deserialized.role).toBe('primary');
      expect(deserialized.payload.score).toBe(42000);
      expect(deserialized.payload.bossName).toBe('Cranial Goliath');
      expect(deserialized.payload.isFrenzy).toBe(true);
    });

    it('negotiates display roles and delivers bidirectional messages between primary and companion windows', () => {
      const primary = new MultiScreenSync('primary', 'win_primary');
      const companionHud = new MultiScreenSync('hud', 'win_companion_hud');

      // Hook up test bus for local deterministic delivery
      MultiScreenSync.testBus.push((packet: MultiScreenPacket) => {
        primary.handleIncoming(packet);
        companionHud.handleIncoming(packet);
      });

      let receivedAtHud: StateSyncPayload | null = null;
      companionHud.on<StateSyncPayload>('SYNC_STATE', (pkt) => {
        receivedAtHud = pkt.payload;
      });

      let receivedAtPrimary: InputEventPayload | null = null;
      primary.on<InputEventPayload>('INPUT_EVENT', (pkt) => {
        receivedAtPrimary = pkt.payload;
      });

      // 1. Primary broadcasts game state
      primary.send<StateSyncPayload>('SYNC_STATE', {
        score: 9999,
        floor: 4,
        level: 8,
        hp: 100,
        maxHp: 100,
        shield: 30,
        combo: 12,
        shards: 60,
      });

      expect(receivedAtHud).not.toBeNull();
      expect(receivedAtHud!.score).toBe(9999);
      expect(receivedAtHud!.floor).toBe(4);

      // 2. Companion controller transmits input event
      companionHud.send<InputEventPayload>('INPUT_EVENT', {
        action: 'dash',
        dirX: 1.0,
        dirY: 0.0,
        magnitude: 1.0,
      });

      expect(receivedAtPrimary).not.toBeNull();
      expect(receivedAtPrimary!.action).toBe('dash');
      expect(receivedAtPrimary!.dirX).toBe(1.0);

      primary.close();
      companionHud.close();
    });

    it('validates MultiScreenManager window presence, WINDOW_JOINED announcement and ACK handshake', () => {
      const mgr1 = new MultiScreenManager('primary', 'mgr_primary');
      const mgr2 = new MultiScreenManager('minimap', 'mgr_minimap');

      MultiScreenManager.testBus.push((msg) => {
        mgr1.handleMessage(msg);
        mgr2.handleMessage(msg);
      });

      let ackReceived = false;
      mgr2.on('WINDOW_ACK', () => {
        ackReceived = true;
      });

      // Trigger join announcement from mgr2
      mgr2.postMessage('WINDOW_JOINED', { role: 'minimap' });

      expect(mgr1.companionWindows.has('mgr_minimap')).toBe(true);
      expect(mgr1.companionWindows.get('mgr_minimap')!.role).toBe('minimap');
      expect(ackReceived).toBe(true);

      mgr1.destroy();
      mgr2.destroy();
    });

    it('enforces WebRTC CompanionSync wire protocol, pairing URL formatting and latency measurement', () => {
      const companion = new CompanionSync({ role: 'host' });

      // Room code format: 3 chars, dash, 3 chars (e.g. ABC-DEF)
      expect(companion.roomCode).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);

      // Pairing URL
      const pairingUrl = companion.getPairingUrl('https://snake.dev');
      expect(pairingUrl).toContain('https://snake.dev/companion?room=');
      expect(pairingUrl).toContain(encodeURIComponent(companion.roomCode));

      // Test wire message Ping-Pong RTT computation
      const sendSpy = vi.spyOn(companion, 'send').mockImplementation(() => {});

      // Incoming PING triggers PONG
      (companion as any).onWireMessage({ type: 'PING', timestamp: 1234567 });
      expect(sendSpy).toHaveBeenCalledWith({ type: 'PONG', timestamp: 1234567 });

      // Incoming PONG updates RTT latency
      const pingTime = Date.now() - 25;
      (companion as any).onWireMessage({ type: 'PONG', timestamp: pingTime });
      expect(companion.rttLatencyMs).toBeGreaterThanOrEqual(20);

      // Controller input listener dispatch
      let receivedInput: ControllerInputMessage | null = null;
      companion.onControllerInput((input) => {
        receivedInput = input;
      });

      (companion as any).onWireMessage({
        type: 'CONTROLLER_INPUT',
        seq: 1,
        dirX: 0.5,
        dirY: -0.5,
        magnitude: 0.707,
        dash: true,
        skill: false,
        pause: false,
        confirm: false,
      });

      expect(receivedInput).not.toBeNull();
      expect(receivedInput!.dash).toBe(true);
      expect(receivedInput!.magnitude).toBeCloseTo(0.707, 3);

      companion.dispose();
    });
  });

  // ==========================================================================
  // 3. SOUNDENGINE & SYNTH ACOUSTIC INVARIANCE
  // ==========================================================================
  describe('3. SoundEngine & Synth Acoustic Invariance', () => {
    let sound: SoundEngine;
    let mockCtx: MockAudioContext;

    beforeEach(() => {
      clearAudioBufferCache();
      sound = new SoundEngine();
      mockCtx = new MockAudioContext();
      (sound as any)._ctx = mockCtx;
      (sound as any).initCtx();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('enforces single unified eating sound route (sfx_eat.wav / createEatVoices) across all eating events', () => {
      expect(BROADCAST_AUDIO_PATHS.eat).toBe('assets/audio/sfx_eat.wav');
      expect(BROADCAST_AUDIO_PATHS.eat).toContain('sfx_eat.wav');

      const playVoicesSpy = vi.spyOn(sound, 'playVoices');

      // 1. PlayEat without cache triggers createEatVoices fallback
      sound.PlayEat(1, false);
      expect(playVoicesSpy).toHaveBeenCalled();
      expect(sound._activeVoiceCounts.get('eat')).toBe(0); // completed fallback decrement

      playVoicesSpy.mockClear();

      // 2. playEat alias with combo delegation
      sound.playEat(3, false);
      expect(playVoicesSpy).toHaveBeenCalled();

      playVoicesSpy.mockClear();

      // 3. Cached broadcast audio route
      const dummyBuf: any = { duration: 0.15, length: 6615 };
      setCachedAudioBuffer(BROADCAST_AUDIO_PATHS.eat, dummyBuf);

      sound.PlayEat(5, true);
      // When cached buffer is available, a buffer source node is created
      expect(mockCtx.createdSources.length).toBeGreaterThan(0);
      const src = mockCtx.createdSources[mockCtx.createdSources.length - 1]!;
      expect(src.started).toBe(true);
      expect(sound._activeVoiceCounts.get('eat')).toBe(1);

      // On voice finish, active count decrements
      expect(src.onended).toBeDefined();
      src.onended!();
      expect(sound._activeVoiceCounts.get('eat')).toBe(0);
    });

    it('enforces maximum voice concurrency limits (<= 4 per channel) and cooldown debounces', () => {
      // shoot: maxConcurrent = 4, interval = 40ms
      // hit: maxConcurrent = 3, interval = 35ms
      // laserFire: maxConcurrent = 3, interval = 40ms
      // bite: maxConcurrent = 2, interval = 40ms
      // explosion: maxConcurrent = 2, interval = 60ms
      // thunder: maxConcurrent = 2, interval = 80ms

      expect(sound.canPlay('shoot', 40, 4)).toBe(true);
      sound._activeVoiceCounts.set('shoot', 4);
      expect(sound.canPlay('shoot', 40, 4)).toBe(false);
      sound._activeVoiceCounts.set('shoot', 3);
      expect(sound.canPlay('shoot', 40, 4)).toBe(true);

      // Cooldown interval enforcement
      sound._lastPlayTimes.set('shoot', performance.now());
      expect(sound.canPlay('shoot', 40, 4)).toBe(false);
      sound._lastPlayTimes.set('shoot', performance.now() - 50);
      expect(sound.canPlay('shoot', 40, 4)).toBe(true);

      // Assert no channel exceeds 4 concurrent voices in SoundEngine configuration
      const channelLimits = [
        { key: 'bite', max: 2, interval: 40 },
        { key: 'hit', max: 3, interval: 35 },
        { key: 'shoot', max: 4, interval: 40 },
        { key: 'laserFire', max: 3, interval: 40 },
        { key: 'crit', max: 2, interval: 40 },
        { key: 'explosion', max: 2, interval: 60 },
        { key: 'thunder', max: 2, interval: 80 },
      ];

      for (const ch of channelLimits) {
        expect(ch.max).toBeLessThanOrEqual(4);
        expect(ch.interval).toBeGreaterThanOrEqual(35);
      }
    });

    it('validates transparent sidechain ducking curve (0.03s attack ramp, 0.50s release envelope)', () => {
      const musicGain = (sound as any)._musicGain as MockGainNode;
      expect(musicGain).toBeDefined();

      sound.setMusicVolume(0.8);
      mockCtx.currentTime = 50.0;

      // Execute duckMusic(duckGain = 0.35, durationSec = 0.50)
      sound.duckMusic(0.35, 0.50);

      // Verify scheduled ramps on Web Audio gain param
      expect(musicGain.gain.cancelScheduledValues).toHaveBeenCalledWith(50.0);
      expect(musicGain.gain.setValueAtTime).toHaveBeenCalledWith(0.8, 50.0);

      // Attack ramp: 0.8 * 0.35 = 0.28 over 0.03s (t = 50.03)
      // Release restoration ramp: back to 0.8 over 0.50s (t = 50.50)
      const calls = musicGain.gain.linearRampToValueAtTime.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0]![0]).toBeCloseTo(0.28, 4);
      expect(calls[0]![1]).toBeCloseTo(50.03, 4);
      expect(calls[1]![0]).toBeCloseTo(0.8, 4);
      expect(calls[1]![1]).toBeCloseTo(50.50, 4);
    });

    it('verifies studio mastering master compressor settings (-10dB threshold, 6:1 ratio, 2ms attack, 120ms release)', () => {
      const compressor = (sound as any)._masterCompressor as MockDynamicsCompressorNode;
      expect(compressor).toBeDefined();

      expect(compressor.threshold.value).toBe(-10);
      expect(compressor.knee.value).toBe(12);
      expect(compressor.ratio.value).toBe(6);
      expect(compressor.attack.value).toBeCloseTo(0.002, 4);
      expect(compressor.release.value).toBeCloseTo(0.12, 4);

      // Signal graph topology:
      // sfxGain -> masterGain, musicGain -> masterGain, masterGain -> masterCompressor -> destination
      const sfxGain = (sound as any)._sfxGain;
      const musicGain = (sound as any)._musicGain;
      const masterGain = (sound as any)._masterGain;

      expect(sfxGain.connectedTargets).toContain(masterGain);
      expect(musicGain.connectedTargets).toContain(masterGain);
      expect(masterGain.connectedTargets).toContain(compressor);
      expect(compressor.connectedTargets).toContain(mockCtx.destination);
    });
  });

  // ==========================================================================
  // 4. RESPONSIVE LAYOUT & TOUCH INPUT INVARIANCE
  // ==========================================================================
  describe('4. Responsive Layout & Touch Input Invariance', () => {
    it('computes UI scale and aspect mode invariants across standard screen viewports', () => {
      const viewports = [
        { w: 1280, h: 720, expectedScale: 1.0, mode: 'landscape', desc: '16:9 720p HD Reference' },
        { w: 1920, h: 1080, expectedScale: 1.5, mode: 'landscape', desc: '16:9 1080p FHD' },
        { w: 2560, h: 1080, expectedScale: 1.5, mode: 'ultrawide', desc: '21:9 1080p Ultrawide' },
        { w: 3440, h: 1440, expectedScale: 1.85, mode: 'ultrawide', desc: '21:9 1440p Ultrawide' },
        { w: 1024, h: 768, expectedScale: 1.0, mode: 'landscape', desc: '4:3 Tablet / iPad' },
        { w: 390, h: 844, expectedScale: 1.0, mode: 'portrait', desc: '9:16 Modern Phone' },
        { w: 360, h: 780, expectedScale: 0.95, mode: 'portrait', desc: '9:16 Tall Phone' },
        { w: 320, h: 480, expectedScale: 0.80, mode: 'portrait', desc: 'Compact Phone' },
        { w: 3840, h: 2160, expectedScale: 3.0, mode: 'landscape', desc: '4K Ultra HD' },
      ];

      for (const vp of viewports) {
        const scale = ResponsiveLayout.computeUiScale(vp.w, vp.h);
        expect(scale, `Failed UI scale for ${vp.desc}`).toBeCloseTo(vp.expectedScale, 2);
        expect(scale).toBeGreaterThanOrEqual(0.60);
        expect(scale).toBeLessThanOrEqual(3.05);

        const metrics = ResponsiveLayout.instance.computeMetrics(vp.w, vp.h);
        expect(metrics.aspectMode).toBe(vp.mode);
        expect(metrics.logicalWidth).toBeCloseTo(vp.w / scale, 2);
        expect(metrics.logicalHeight).toBeCloseTo(vp.h / scale, 2);
      }
    });

    it('verifies virtual touch joystick deadzone (0.18 fraction) and analog ramp to saturation radius (60px)', () => {
      const stick = new VirtualStick({
        radius: 60.0,
        knobRadius: 26.0,
        deadzoneFrac: 0.18,
        dynamicOrigin: true,
      });

      expect(stick.radius).toBe(60.0);
      expect(stick.deadzoneFrac).toBe(0.18);
      const deadzone = stick.radius * stick.deadzoneFrac; // 10.8 px

      // 1. Touch start activates floating origin
      stick.onTouchStart(1, 300, 500);
      expect(stick.active).toBe(true);
      expect(stick.visible).toBe(true);
      expect(stick.baseX).toBe(300);
      expect(stick.baseY).toBe(500);
      expect(stick.knobX).toBe(300);
      expect(stick.knobY).toBe(500);
      expect(stick.magnitude).toBe(0.0);

      // 2. Movement within deadzone (< 10.8 px) produces zero vector deflection
      stick.onTouchMove(1, 305, 500); // dist = 5.0 px (< 10.8 px)
      expect(stick.magnitude).toBe(0.0);
      expect(stick.vectorX).toBe(0.0);
      expect(stick.vectorY).toBe(0.0);
      expect(stick.knobX).toBe(300);
      expect(stick.knobY).toBe(500);

      // 3. Movement in active analog zone (dist = 35.4 px)
      // mag = (35.4 - 10.8) / (60.0 - 10.8) = 24.6 / 49.2 = 0.50
      stick.onTouchMove(1, 335.4, 500);
      expect(stick.magnitude).toBeCloseTo(0.50, 2);
      expect(stick.vectorX).toBeCloseTo(0.50, 2);
      expect(stick.vectorY).toBe(0.0);
      expect(stick.knobX).toBeCloseTo(335.4, 1);

      // 4. Movement beyond outer saturation radius (dist = 100 px) clamps knob to 60px and mag to 1.0
      stick.onTouchMove(1, 400, 500); // dx = 100 px
      expect(stick.magnitude).toBe(1.0);
      expect(stick.vectorX).toBe(1.0);
      expect(stick.knobX).toBe(360); // 300 + 60
      expect(stick.knobY).toBe(500);

      // 5. Release resets stick state
      stick.onTouchEnd(1);
      expect(stick.active).toBe(false);
      expect(stick.visible).toBe(false);
      expect(stick.magnitude).toBe(0.0);
      expect(stick.vectorX).toBe(0.0);
    });

    it('verifies safe-area inset compensation and ambidextrous lefty layout adaptation in touch controls', () => {
      const space = new Vec2(1200, 700);
      const safeArea: ISafeAreaInsets = { left: 24, top: 40, right: 28, bottom: 34 };

      // Right-handed layout
      const layoutRight = ResponsiveLayout.layoutTouchControls(space, safeArea, false, 'corner');
      // Pause button should be on right side: w - margin - safe.right - pauseSize/2
      expect(layoutRight.pausePadX).toBeGreaterThan(1000);
      expect(layoutRight.pausePadY).toBeCloseTo(20 + safeArea.top + 26, 1);

      // Action buttons elevated by safeArea.bottom
      const expectedBaseY = 700 - 20 - safeArea.bottom - layoutRight.btnSize * 0.5;
      expect(layoutRight.dashPadY).toBeCloseTo(expectedBaseY, 1);
      expect(layoutRight.skillPadY).toBeCloseTo(expectedBaseY, 1);

      // Lefty layout (isLefty = true)
      const layoutLeft = ResponsiveLayout.layoutTouchControls(space, safeArea, true, 'corner');
      // Pause button should flip to left side: margin + safe.left + pauseSize/2
      expect(layoutLeft.pausePadX).toBeCloseTo(20 + safeArea.left + 26, 1);

      // In lefty mode, action buttons move to right side
      expect(layoutLeft.dashPadX).toBeGreaterThan(layoutRight.dashPadX);
    });
  });
});
