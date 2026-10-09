# 🖥️ Multi-Screen & Multi-Device Companion Architecture

> **Rule Reference:** [`ORACLE.md#7-responsive-layout--multi-screen-engine`](file:///home/forart/dev/snake_ts/ORACLE.md)  
> **Target Directory:** `/home/forart/dev/snake_ts`  

---

## 🌐 1. Architecture Overview

Ouroboros Ascension supports multi-screen setups out of the box through two synchronization channels:
1. **Local Multi-Monitor (Same Machine):** Using the browser `BroadcastChannel` API and the `Window Management API`.
2. **Wireless Companion Device (Cross-Device):** Using WebRTC DataChannels with a lightweight WebSocket signaling bridge.

```
┌────────────────────────┐      BroadcastChannel       ┌────────────────────────┐
│  PRIMARY GAME MONITOR  │ ◄─────────────────────────► │ SECONDARY HUD/MINIMAP  │
│  (Arena, Snake, Boss)  │                             │ (Stats, Radar, Cards)  │
└────────────────────────┘                             └────────────────────────┘
            ▲
            │ WebRTC / WebSocket P2P
            ▼
┌────────────────────────┐
│ MOBILE TOUCH CONTROLLER│
│ (Virtual Stick, Skills)│
└────────────────────────┘
```

---

## 📡 2. Multi-Screen Synchronization Protocol

### Supported Message Types (`MultiScreenPacket`)
- `STATE_SYNC`: Broadcasts snake coordinates, health, shield, score, combo multiplier, and floor number.
- `DRAFT_OPEN`: Synchronizes level-up perk card selection to secondary screen.
- `SANCTUARY_SYNC`: Transmits persistent essence shards and unlocks.
- `INPUT_EVENT`: Relays touch virtual stick vectors and button taps from companion devices with $< 10\text{ ms}$ latency.

---

## 🔌 3. Screen Role Configuration

- **`MAIN` (Default):** Full arena viewport with responsive HUD.
- **`RADAR_MINIMAP`:** Expanded spatial radar view showing incoming enemy waves and food clusters.
- **`CONTROLLER`:** Fullscreen touch controls (Virtual Joystick on left, Dash & Skill buttons on right) optimized for mobile smartphones.
