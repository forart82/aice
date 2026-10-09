import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MultiScreenSync, type MultiScreenPacket, type StateSyncPayload, type InputEventPayload } from '../multiscreen/MultiScreenSync';

describe('MultiScreen & BroadcastChannel Synchronization', () => {
  let primary: MultiScreenSync;
  let companion: MultiScreenSync;

  beforeEach(() => {
    MultiScreenSync.testBus = [];
    primary = new MultiScreenSync('primary', 'host_window');
    companion = new MultiScreenSync('companion', 'controller_window');

    // Connect test bus
    MultiScreenSync.testBus.push((packet: MultiScreenPacket) => {
      primary.handleIncoming(packet);
      companion.handleIncoming(packet);
    });
  });

  afterEach(() => {
    primary.close();
    companion.close();
    MultiScreenSync.testBus = [];
  });

  it('broadcasts SYNC_STATE packets from primary to companion screen', () => {
    let receivedState: StateSyncPayload | null = null;

    companion.on<StateSyncPayload>('SYNC_STATE', (packet) => {
      receivedState = packet.payload;
    });

    const statePayload: StateSyncPayload = {
      state: 'PLAYING',
      score: 14500,
      floor: 3,
      level: 7,
      hp: 85,
      maxHp: 120,
      shield: 25,
      maxShield: 40,
      combo: 14,
      comboMult: 2.0,
      shards: 45,
      kills: 62
    };

    primary.send('SYNC_STATE', statePayload);

    expect(receivedState).not.toBeNull();
    expect(receivedState!.score).toBe(14500);
    expect(receivedState!.floor).toBe(3);
    expect(receivedState!.combo).toBe(14);
  });

  it('transmits INPUT_EVENT packets from companion controller to primary host', () => {
    let receivedInput: InputEventPayload | null = null;

    primary.on<InputEventPayload>('INPUT_EVENT', (packet) => {
      receivedInput = packet.payload;
    });

    companion.send<InputEventPayload>('INPUT_EVENT', {
      action: 'steer',
      dirX: 0.7071,
      dirY: 0.7071
    });

    expect(receivedInput).not.toBeNull();
    expect(receivedInput!.action).toBe('steer');
    expect(receivedInput!.dirX).toBeCloseTo(0.7071);
  });

  it('ignores self-originated packets', () => {
    let primaryHeardSelf = false;

    primary.on('SYNC_STATE', () => {
      primaryHeardSelf = true;
    });

    primary.send('SYNC_STATE', { state: 'PLAYING' });
    expect(primaryHeardSelf).toBe(false);
  });
});
