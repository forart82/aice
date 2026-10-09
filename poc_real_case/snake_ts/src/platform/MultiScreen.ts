/**
 * Ouroboros Ascension — Multi-Screen & Window Management Integration (MultiScreen.ts)
 *
 * Implements cross-window communication using the BroadcastChannel API and
 * multi-monitor detection via the Window Management API (window.getScreenDetails).
 *
 * Enables multi-display configurations:
 *  - Primary Screen: Main Arena Viewport & Real-time Canvas Rendering
 *  - Secondary Screen: Dedicated Pop-Out HUD, Sanctuary Skill Tree, Minimap, or Inventory Deck
 *  - Wireless Companion: Low-latency mobile touchscreen controller & live telemetry
 *
 * Standardized on unified packet schema across local BroadcastChannel and WebRTC CompanionSync.
 * Headless-safe. Meets AGENTS.md Rule 10 In-Code Documentation Standards.
 */

// ============================================================================
// Types & Messages
// ============================================================================

export type ScreenRole =
  | 'primary'
  | 'secondary'
  | 'companion'
  | 'hud'
  | 'minimap'
  | 'sanctuary'
  | 'inventory'
  | 'spectator'
  | 'controller'
  | 'display';

export type WindowRole = ScreenRole;

export type MultiScreenMessageType =
  | 'SYNC_STATE'
  | 'GAME_STATE_SYNC'
  | 'INPUT_EVENT'
  | 'CONTROLLER_INPUT'
  | 'DRAFT_SELECT'
  | 'CARD_SELECTED'
  | 'MINIMAP_SYNC'
  | 'VIEWPORT_INFO'
  | 'WINDOW_JOINED'
  | 'WINDOW_ACK'
  | 'WINDOW_LEFT'
  | 'PAUSE_TOGGLE'
  | 'HEARTBEAT'
  | 'PING'
  | 'PONG'
  | 'TEST'
  | (string & {});
/**
 * Standardized Cross-Window / Multi-Screen Wire Packet Envelope.
 *
 * Wire Serialization Format:
 * Serialized as JSON over local BroadcastChannel (`ouroboros_multiscreen_v1`)
 * or WebRTC binary DataChannel strings.
 *
 * Packet Envelope Schema:
 * - `channel`: Global message bus identifier ('OUROBOROS_MULTISCREEN').
 * - `id`: Unique monotonically generated packet ID for deduplication.
 * - `senderId`: Originating window instance ID (`win_<hash>_<timestamp>`).
 * - `sourceWindowId`: Explicit alias for senderId for multi-window bridging.
 * - `role`: Operational role of the broadcasting window ('primary', 'secondary', 'hud', etc.).
 * - `timestamp`: POSIX epoch timestamp in milliseconds when packet was emitted.
 * - `type`: Action event identifier ('SYNC_STATE', 'INPUT_EVENT', 'DRAFT_SELECT', etc.).
 * - `payload`: Type-safe payload containing state, inputs, or telemetry.
 */
export interface MultiScreenPacket<T = any> {
  channel?: 'OUROBOROS_MULTISCREEN' | string;
  id?: string;
  senderId: string;
  sourceWindowId?: string;
  role: ScreenRole;
  sourceRole?: ScreenRole;
  timestamp: number;
  type: MultiScreenMessageType;
  payload: T;
}

export type MultiScreenMessage<T = any> = MultiScreenPacket<T>;

export interface StateSyncPayload {
  state?: string;
  score: number;
  floor: number;
  level: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield?: number;
  combo: number;
  comboMult?: number;
  maxCombo?: number;
  shards: number;
  kills?: number;
  isFrenzy?: boolean;
  isBoss?: boolean;
  bossHp?: number;
  bossMaxHp?: number;
  bossName?: string;
  isPaused?: boolean;
}

export type GameStateSyncPayload = StateSyncPayload;

export interface InputEventPayload {
  action: 'steer' | 'dash' | 'skill' | 'pause' | 'lab' | 'confirm';
  dirX?: number;
  dirY?: number;
  magnitude?: number;
}

export interface DraftSelectPayload {
  action: 'select' | 'reroll' | 'skip';
  cardIndex?: number;
  cardId?: string;
}

export interface ViewportInfoPayload {
  screenWidth: number;
  screenHeight: number;
  availWidth: number;
  availHeight: number;
  isExtended: boolean;
  safeArea: { top: number; bottom: number; left: number; right: number };
}

export interface MinimapEntity {
  id: string;
  type: 'player' | 'segment' | 'food' | 'golden_food' | 'enemy' | 'boss' | 'hazard' | 'portal';
  x: number;
  y: number;
  radius?: number;
  angle?: number;
}

export interface MinimapSyncPayload {
  arenaWidth: number;
  arenaHeight: number;
  entities: MinimapEntity[];
}

export interface ScreenDetailInfo {
  availWidth: number;
  availHeight: number;
  left: number;
  top: number;
  isPrimary: boolean;
  label?: string;
}

export const MULTISCREEN_CHANNEL_NAME = 'ouroboros_multiscreen_v1';
export const HEARTBEAT_INTERVAL_MS = 1000;

// ============================================================================
// MultiScreenManager Class
// ============================================================================

export class MultiScreenManager {
  public windowId: string;
  public role: ScreenRole = 'primary';
  public isLeader = true;
  public companionWindows: Map<string, { role: ScreenRole; lastSeen: number; windowRef?: Window | null }> = new Map();

  private channel: BroadcastChannel | null = null;
  private heartbeatTimer: number | null = null;
  private listeners: Map<string, Set<(payload: any, msg: MultiScreenMessage) => void>> = new Map();

  /** Test message bus for unit test environments without native BroadcastChannel. */
  public static testBus: ((packet: MultiScreenMessage) => void)[] = [];

  public static clearTestBus(): void {
    MultiScreenManager.testBus = [];
  }

  constructor(role: ScreenRole = 'primary', windowId?: string) {
    this.role = role;
    this.windowId = windowId || this.generateId();
    this.initChannel();
    this.startHeartbeat();
  }

  private generateId(): string {
    return 'win_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
  }

  // ==========================================================================
  // Channel Initialization & Heartbeat
  // ============================================================================

  private initChannel(): void {
    if (typeof BroadcastChannel === 'undefined') return;

    try {
      this.channel = new BroadcastChannel(MULTISCREEN_CHANNEL_NAME);
      this.channel.onmessage = (event: MessageEvent<MultiScreenMessage>) => {
        this.handleMessage(event.data);
      };

      // Broadcast join announcement
      this.postMessage('WINDOW_JOINED', { role: this.role });
    } catch {
      this.channel = null;
    }
  }

  private startHeartbeat(): void {
    if (typeof window === 'undefined' || typeof setInterval === 'undefined') return;

    this.heartbeatTimer = setInterval(() => {
      this.postMessage('HEARTBEAT', { role: this.role });
      this.sweepStaleWindows();
    }, HEARTBEAT_INTERVAL_MS) as unknown as number;
  }

  private sweepStaleWindows(): void {
    const now = Date.now();
    for (const [id, info] of this.companionWindows.entries()) {
      if (now - info.lastSeen > 3500) {
        this.companionWindows.delete(id);
        this.emitLocal('WINDOW_LEFT', { windowId: id, role: info.role });
      }
    }
  }

  // ==========================================================================
  // Message Passing
  // ============================================================================

  public postMessage<T>(type: string, payload: T): MultiScreenMessage<T> {
    const msg: MultiScreenMessage<T> = {
      channel: 'OUROBOROS_MULTISCREEN',
      id: this.generateId(),
      senderId: this.windowId,
      sourceWindowId: this.windowId,
      role: this.role,
      sourceRole: this.role,
      timestamp: Date.now(),
      type,
      payload
    };

    if (this.channel) {
      try {
        this.channel.postMessage(msg);
      } catch {
        // ignore
      }
    }

    // Deliver to test bus if active
    for (const handler of MultiScreenManager.testBus) {
      try {
        handler(msg);
      } catch {
        // ignore
      }
    }

    return msg;
  }

  public handleMessage(msg: MultiScreenMessage): void {
    if (!msg || typeof msg !== 'object') return;
    const sourceId = msg.sourceWindowId || msg.senderId;
    if (sourceId === this.windowId) return;

    const sourceRole = msg.sourceRole || msg.role || 'secondary';

    // Update companion presence
    this.companionWindows.set(sourceId, {
      role: sourceRole,
      lastSeen: Date.now()
    });

    if (msg.type === 'WINDOW_JOINED') {
      this.postMessage('WINDOW_ACK', { role: this.role });
    }

    this.emitLocal(msg.type, msg.payload, msg);
  }

  public on<T = unknown>(type: string, callback: (payload: T, msg: MultiScreenMessage<T>) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    const set = this.listeners.get(type)!;
    const cb = callback as (payload: any, msg: MultiScreenMessage) => void;
    set.add(cb);

    return () => {
      set.delete(cb);
    };
  }

  private emitLocal(type: string, payload: unknown, rawMsg?: MultiScreenMessage): void {
    const set = this.listeners.get(type);
    if (set) {
      const dummyMsg: MultiScreenMessage = rawMsg ?? {
        channel: 'OUROBOROS_MULTISCREEN',
        id: this.generateId(),
        senderId: this.windowId,
        sourceWindowId: this.windowId,
        role: this.role,
        sourceRole: this.role,
        timestamp: Date.now(),
        type,
        payload
      };
      for (const cb of set) {
        try {
          cb(payload, dummyMsg);
        } catch (e) {
          console.error('MultiScreenManager listener error:', e);
        }
      }
    }
  }

  // ==========================================================================
  // Domain State Sync Helpers
  // ============================================================================

  public syncGameState(state: GameStateSyncPayload): void {
    this.postMessage('GAME_STATE_SYNC', state);
    this.postMessage('SYNC_STATE', state);
  }

  public syncMinimap(minimap: MinimapSyncPayload): void {
    this.postMessage('MINIMAP_SYNC', minimap);
  }

  public triggerPauseToggle(): void {
    this.postMessage('PAUSE_TOGGLE', {});
  }

  public sendControllerInput(input: InputEventPayload): void {
    this.postMessage('INPUT_EVENT', input);
    this.postMessage('CONTROLLER_INPUT', input);
  }

  public sendDraftSelect(draft: DraftSelectPayload): void {
    this.postMessage('DRAFT_SELECT', draft);
  }

  // ==========================================================================
  // Window Management API (Multi-Monitor Detection)
  // ============================================================================

  public async getAvailableScreens(): Promise<ScreenDetailInfo[]> {
    if (typeof window === 'undefined' || typeof window.screen === 'undefined') {
      return [
        {
          availWidth: 1920,
          availHeight: 1080,
          left: 0,
          top: 0,
          isPrimary: true,
          label: 'Primary Display'
        }
      ];
    }

    const win = window as unknown as {
      getScreenDetails?: () => Promise<{ screens: Array<{ availWidth: number; availHeight: number; left: number; top: number; isPrimary: boolean; label?: string }> }>;
    };

    if (typeof win.getScreenDetails === 'function') {
      try {
        const details = await win.getScreenDetails();
        return details.screens.map(s => ({
          availWidth: s.availWidth,
          availHeight: s.availHeight,
          left: s.left,
          top: s.top,
          isPrimary: s.isPrimary,
          label: s.label
        }));
      } catch {
        // Fallback
      }
    }

    return [
      {
        availWidth: window.screen.availWidth,
        availHeight: window.screen.availHeight,
        left: 0,
        top: 0,
        isPrimary: true,
        label: 'Primary Display'
      }
    ];
  }

  public async openCompanionWindow(
    role: ScreenRole,
    customUrl?: string,
    targetScreenIndex: number = 1
  ): Promise<Window | null> {
    if (typeof window === 'undefined') return null;

    const screens = await this.getAvailableScreens();
    let left = 100;
    let top = 100;
    let width = 900;
    let height = 600;

    if (screens.length > targetScreenIndex && screens[targetScreenIndex]) {
      const targetScreen = screens[targetScreenIndex]!;
      left = targetScreen.left + 50;
      top = targetScreen.top + 50;
      width = Math.min(1280, targetScreen.availWidth - 100);
      height = Math.min(800, targetScreen.availHeight - 100);
    }

    const url = customUrl || `${window.location.origin}${window.location.pathname}?role=${role}`;
    const windowFeatures = `left=${left},top=${top},width=${width},height=${height},menubar=no,toolbar=no,location=no,status=no,resizable=yes`;

    try {
      const companionWin = window.open(url, `ouroboros_${role}`, windowFeatures);
      if (companionWin) {
        this.companionWindows.set(`spawned_${role}`, {
          role,
          lastSeen: Date.now(),
          windowRef: companionWin
        });
      }
      return companionWin;
    } catch {
      return null;
    }
  }

  public destroy(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.channel) {
      this.postMessage('WINDOW_LEFT', { role: this.role });
      try {
        this.channel.onmessage = null;
      } catch {}
      this.channel.close();
      this.channel = null;
    }
    this.listeners.clear();
    this.companionWindows.clear();
  }

  /**
   * Universal disposable alias conforming to platform lifecycle standard.
   */
  public dispose(): void {
    this.destroy();
  }
}

// ============================================================================
// MultiScreenSync Adapter / Backward Compatibility Wrapper
// ============================================================================

export class MultiScreenSync {
  public static readonly ChannelName = MULTISCREEN_CHANNEL_NAME;

  public senderId: string;
  public role: ScreenRole;
  private channel: BroadcastChannel | null = null;
  private listeners: Map<string, Set<(packet: MultiScreenPacket) => void>> = new Map();

  /** Test message bus for unit tests / headless environments. */
  public static testBus: ((packet: MultiScreenPacket) => void)[] = [];

  public static clearTestBus(): void {
    MultiScreenSync.testBus = [];
  }

  constructor(role: ScreenRole = 'primary', senderId?: string) {
    this.role = role;
    this.senderId = senderId || `screen_${Math.random().toString(36).substring(2, 9)}`;
    this.initChannel();
  }

  private initChannel(): void {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(MultiScreenSync.ChannelName);
        this.channel.onmessage = (event: MessageEvent<MultiScreenPacket>) => {
          this.handleIncoming(event.data);
        };
      } catch {
        this.channel = null;
      }
    }
  }

  public on<T = any>(type: MultiScreenMessageType, handler: (packet: MultiScreenPacket<T>) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    const set = this.listeners.get(type)!;
    set.add(handler as any);
    return () => set.delete(handler as any);
  }

  public send<T = any>(type: MultiScreenMessageType, payload: T): MultiScreenPacket<T> {
    const packet: MultiScreenPacket<T> = {
      type,
      senderId: this.senderId,
      sourceWindowId: this.senderId,
      role: this.role,
      sourceRole: this.role,
      timestamp: Date.now(),
      payload
    };

    if (this.channel) {
      try {
        this.channel.postMessage(packet);
      } catch {
        // channel error fallback
      }
    }

    for (const testHandler of MultiScreenSync.testBus) {
      try {
        testHandler(packet);
      } catch {
        // ignore
      }
    }

    return packet;
  }

  public handleIncoming(data: any): void {
    if (!data || typeof data !== 'object' || !data.type) return;
    const sourceId = data.sourceWindowId || data.senderId;
    if (sourceId === this.senderId) return;

    const set = this.listeners.get(data.type);
    if (set) {
      for (const handler of set) {
        try {
          handler(data);
        } catch (e) {
          console.error('MultiScreenSync listener error:', e);
        }
      }
    }
  }

  public close(): void {
    if (this.channel) {
      try {
        this.channel.onmessage = null;
      } catch {}
      this.channel.close();
      this.channel = null;
    }
    this.listeners.clear();
  }

  /**
   * Universal disposable alias conforming to platform lifecycle standard.
   */
  public dispose(): void {
    this.close();
  }
}
