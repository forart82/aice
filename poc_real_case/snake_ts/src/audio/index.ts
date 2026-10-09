/**
 * Ouroboros Ascension — Procedural Web Audio Engine & Synthesizer Module
 *
 * Re-exports:
 * - Synth: sample-accurate oscillator voices, PolyBLEP bandlimiting, RBJ biquad filters, and procedural voice recipes.
 * - SoundEngine: hybrid audio dispatcher, master dynamics compressor, sidechain ducking, and voice concurrency limiter.
 * - MusicPlayer: hybrid soundtrack streamer, lookahead step sequencer, dynamic mood lowpass filter, and crossfader.
 */

export * from './Synth.js';
export * from './SoundEngine.js';
export * from './MusicPlayer.js';

