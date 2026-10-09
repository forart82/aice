/**
 * Ouroboros Ascension — Platform Persistence, Multi-Screen & Companion Sync Module
 *
 * Re-exports:
 * - SaveIO: resilient LocalStorage / IndexedDB persistence, Schema v1->v2 migrations, and CRC32 checksums.
 * - MultiScreen: cross-window BroadcastChannel IPC, multi-monitor window management, and heartbeat tracking.
 * - CompanionSync: low-latency WebRTC DataChannel mobile controller & second-screen HUD telemetry sync.
 * - Env: platform environment and touch hardware capability detection.
 */

export * from './SaveIO.js';
export * from './MultiScreen.js';
export * from './CompanionSync.js';
export * from './Env.js';

