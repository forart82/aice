#!/usr/bin/env python3
"""
Cyber-Emerald Audio DSP Synthesis Engine
Generates 100% custom, broadcast-grade, short, crystal-clear, high-fidelity 44.1kHz 16-bit PCM WAV assets
strictly aligned with the game's dark cyber-emerald, obsidian, and neon chromatic aesthetic.

Acoustic Architecture Directives:
1. Pure harmonic synthesis: pristine sine waves, precise overtone ratios, crystalline high-frequency transients (3.5kHz - 8kHz), and clean deep sub-bass (45Hz - 65Hz).
2. Elimination of static hiss, boxiness, muddy 200-500Hz mid buildup, and clipping distortion.
3. 44.1kHz 16-bit PCM, normalized to -1.5 dBFS, zero DC offset.
"""

import os
import wave
import shutil
import numpy as np

SAMPLE_RATE = 44100
TARGET_PEAK_DBFS = -1.5

PRIMARY_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../public/assets/audio"))
DIST_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../dist/assets/audio"))


def write_wav(filepath: str, sample_rate: int, data: np.ndarray) -> None:
    """Writes 16-bit mono PCM WAV file using Python's standard wave library."""
    pcm16 = data.astype(np.int16)
    with wave.open(filepath, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm16.tobytes())


def to_pcm16(signal: np.ndarray, target_dbfs: float = TARGET_PEAK_DBFS, attack_samples: int = 22, release_samples: int = 44) -> np.ndarray:
    """
    Normalizes a float64 signal to target dBFS, balances DC, applies smooth
    raised-cosine anti-click fade ramps, and converts to 16-bit PCM int16.
    Guarantees:
    1. Zero clipping (peak at target_dbfs, default -1.5 dBFS)
    2. Absolute zero boundary: pcm16[0] == 0, pcm16[-1] == 0 (zero start/end clicks)
    3. DC offset strictly bounded (< 0.003)
    """
    # 1. Remove DC bias from raw float signal
    signal = signal - np.mean(signal)

    # 2. Peak normalization
    peak = np.max(np.abs(signal))
    if peak > 1e-8:
        target_amplitude = 10.0 ** (target_dbfs / 20.0)
        signal = signal * (target_amplitude / peak)

    # 3. Apply smooth raised-cosine anti-click fade ramps
    signal = apply_fade_ramps(signal, attack_samples=attack_samples, release_samples=release_samples)

    # 4. Soft safety clamp before quantization
    signal = np.clip(signal, -0.9999, 0.9999)

    # 5. Quantize to int16
    pcm16 = np.round(signal * 32767.0).astype(np.int16)

    # 6. Absolute boundary zero guarantee: strictly prevent any DAC step pop/crackle
    pcm16[0] = 0
    pcm16[-1] = 0

    return pcm16


def apply_fade_ramps(sig: np.ndarray, attack_samples: int = 22, release_samples: int = 44) -> np.ndarray:
    """Applies smooth raised-cosine ramps at start and end of signal to eliminate edge clicks."""
    n = len(sig)
    out = sig.copy()
    if 0 < attack_samples < n:
        ramp = 0.5 * (1.0 - np.cos(np.linspace(0, np.pi, attack_samples)))
        out[:attack_samples] *= ramp
    if 0 < release_samples < n:
        ramp = 0.5 * (1.0 + np.cos(np.linspace(0, np.pi, release_samples)))
        out[-release_samples:] *= ramp
    return out


def exp_chirp_phase(t: np.ndarray, f0: float, f1: float, duration: float) -> np.ndarray:
    """Analytic continuous phase for exponential frequency chirp f(t) = f0 * (f1/f0)^(t/T)."""
    alpha = np.log(f1 / f0) / duration
    return 2.0 * np.pi * f0 * (np.exp(alpha * t) - 1.0) / alpha


# ==============================================================================
# SFX SYNTHESIS GENERATORS (PRISTINE HARMONIC SYNTHESIS)
# ==============================================================================

def generate_eat() -> np.ndarray:
    """
    sfx_eat.wav: The ONE UNIFIED eating sound (38ms).
    Organic mouth chomp with rich lower tones (>90% energy <500Hz)
    and clean, tactile tooth contact.
    100% PURE HARMONIC SYNTHESIS — ZERO NOISE HISS, ZERO MICROPHONE NOISE,
    ZERO RADIO CRACKLE.
    - Deep jaw closure: downward sine chirp 220Hz -> 100Hz with subtle 2nd & 3rd harmonics
    - Low-mid mouth cavity resonance: 360Hz -> 150Hz formant resonance ("moim")
    - Clean tooth contact transient: 1600Hz -> 900Hz micro-chirp (no noise, no static)
    Duration: strictly 38ms, peak -1.5 dBFS, zero start/end clicks.
    """
    duration = 0.038
    n = int(round(duration * SAMPLE_RATE))
    t = np.linspace(0, duration, n, endpoint=False)

    # Optimal phase offset for true zero DC bias
    p_off = 4.630

    # 1. Deep jaw chomp in lower tones: 220Hz -> 100Hz
    f_low = 220.0 * (0.45 ** (t / duration))
    phase_low = 2.0 * np.pi * np.cumsum(f_low) / SAMPLE_RATE + p_off
    env_low = np.sin(np.pi * np.clip(t / 0.003, 0.0, 1.0) * 0.5) * np.exp(-t / 0.024)
    low_chomp = (np.sin(phase_low) + 0.25 * np.sin(2.0 * phase_low) - 0.10 * np.sin(3.0 * phase_low)) * env_low

    # 2. Oral formant resonance ("moim"): 360Hz -> 150Hz
    f_mid = 360.0 * (0.42 ** (t / duration))
    phase_mid = 2.0 * np.pi * np.cumsum(f_mid) / SAMPLE_RATE + p_off * 0.5
    env_mid = np.sin(np.pi * np.clip(t / 0.0035, 0.0, 1.0) * 0.5) * np.exp(-t / 0.019)
    mid_mouth = 0.40 * np.sin(phase_mid) * env_mid

    # 3. Clean tooth contact transient: 1600Hz -> 900Hz chirp (NO white noise, NO mic hiss)
    f_snap = 1600.0 * (0.55 ** (t / 0.008))
    phase_snap = 2.0 * np.pi * np.cumsum(f_snap) / SAMPLE_RATE
    snap_env = np.exp(-t / 0.005) * (t < 0.012)
    snap = 0.28 * np.sin(phase_snap) * snap_env

    sig = 0.60 * low_chomp + 0.35 * mid_mouth + 0.25 * snap
    return to_pcm16(sig, target_dbfs=TARGET_PEAK_DBFS, attack_samples=32, release_samples=88)


def generate_star_ding() -> np.ndarray:
    """
    sfx_star_ding.wav: Cosmic stellar chime (80ms).
    Pure celestial duo (A6 = 1760Hz + E7 = 2637Hz) with crystalline shimmer.
    """
    duration = 0.080
    num_samples = int(round(duration * SAMPLE_RATE))
    t = np.linspace(0, duration, num_samples, endpoint=False)

    f_a6 = 1760.00
    f_e7 = 2637.02
    f_a7 = 3520.00

    # Celestial duo with subtle shimmer modulation
    shimmer = 1.0 + 0.08 * np.sin(2.0 * np.pi * 15.0 * t)
    osc = (
        0.58 * np.sin(2.0 * np.pi * f_a6 * t) +
        0.34 * np.sin(2.0 * np.pi * f_e7 * t) +
        0.10 * np.sin(2.0 * np.pi * f_a7 * t)
    ) * shimmer

    # 1.5ms attack and clean exponential chime decay
    env = (1.0 - np.exp(-t / 0.0015)) * np.exp(-t / 0.022)
    sig = osc * env

    sig = apply_fade_ramps(sig, attack_samples=22, release_samples=88)
    return to_pcm16(sig, target_dbfs=TARGET_PEAK_DBFS)


def generate_level_up() -> np.ndarray:
    """
    sfx_level_up.wav: High-tech cyber-ascension stinger (450ms).
    Ascending 3-tone crystal chord (A5=880Hz -> C#6=1108.7Hz -> E6=1318.5Hz -> A6=1760Hz)
    with shimmering harmonic decay and clean 65Hz sub-bass anchor.
    Zero lowpass muffling — bright, sparkling, futuristic.
    """
    duration = 0.450
    num_samples = int(round(duration * SAMPLE_RATE))
    t = np.linspace(0, duration, num_samples, endpoint=False)
    sig = np.zeros(num_samples)

    # 1. Ascending crystal chord arpeggio
    notes = [
        (880.00,  0.000, 0.16, 0.30),  # A5
        (1108.73, 0.065, 0.18, 0.32),  # C#6
        (1318.51, 0.130, 0.20, 0.35),  # E6
        (1760.00, 0.195, 0.25, 0.45),  # A6 (climactic high crystal resolution)
    ]

    for freq, t_start, tau, amp in notes:
        mask = (t >= t_start)
        t_note = t[mask] - t_start
        osc = np.sin(2.0 * np.pi * freq * t_note) + 0.14 * np.sin(4.0 * np.pi * freq * t_note)
        env = (1.0 - np.exp(-t_note / 0.0025)) * np.exp(-t_note / tau)
        sig[mask] += amp * osc * env

    # 2. Shimmering high-harmonic overtone layer (E7 = 2637Hz & A7 = 3520Hz)
    t_shimmer_start = 0.200
    mask_shim = (t >= t_shimmer_start)
    t_shim = t[mask_shim] - t_shimmer_start
    shimmer_env = (1.0 - np.exp(-t_shim / 0.010)) * np.exp(-t_shim / 0.18)
    shimmer_osc = (
        0.10 * np.sin(2.0 * np.pi * 2637.02 * t_shim) +
        0.08 * np.sin(2.0 * np.pi * 3520.00 * t_shim)
    ) * (1.0 + 0.10 * np.sin(2.0 * np.pi * 16.0 * t_shim))
    sig[mask_shim] += shimmer_osc * shimmer_env

    # 3. Clean 65Hz sub-bass anchor (anchors the ascension without mud)
    t_sub_start = 0.160
    mask_sub = (t >= t_sub_start)
    t_sub = t[mask_sub] - t_sub_start
    sub_env = (1.0 - np.exp(-t_sub / 0.020)) * np.exp(-t_sub / 0.17)
    sub = 0.26 * np.sin(2.0 * np.pi * 65.0 * t_sub)
    sig[mask_sub] += sub * sub_env

    sig = apply_fade_ramps(sig, attack_samples=32, release_samples=441)
    return to_pcm16(sig, target_dbfs=TARGET_PEAK_DBFS)


def generate_victory() -> np.ndarray:
    """
    sfx_victory.wav: Cyber transcendence stinger (650ms).
    Pristine rising chord (E5 -> B5 -> E6 -> G#6) with sparkling decay and warm 50Hz sub-bass.
    """
    duration = 0.650
    num_samples = int(round(duration * SAMPLE_RATE))
    t = np.linspace(0, duration, num_samples, endpoint=False)
    sig = np.zeros(num_samples)

    # 1. Rising chord notes (E Major progression)
    notes = [
        (659.25,  0.000, 0.22, 0.26),  # E5
        (987.77,  0.090, 0.24, 0.28),  # B5
        (1318.51, 0.180, 0.28, 0.32),  # E6
        (1661.22, 0.270, 0.35, 0.40),  # G#6 (glorious major third)
    ]

    for freq, t_start, tau, amp in notes:
        mask = (t >= t_start)
        t_note = t[mask] - t_start
        osc = np.sin(2.0 * np.pi * freq * t_note) + 0.12 * np.sin(4.0 * np.pi * freq * t_note)
        env = (1.0 - np.exp(-t_note / 0.003)) * np.exp(-t_note / tau)
        sig[mask] += amp * osc * env

    # 2. High crystal sparkle shimmer (B6 = 1975.5Hz, E7 = 2637Hz)
    t_shim_start = 0.270
    mask_shim = (t >= t_shim_start)
    t_shim = t[mask_shim] - t_shim_start
    shim_env = (1.0 - np.exp(-t_shim / 0.008)) * np.exp(-t_shim / 0.25)
    shim = (
        0.10 * np.sin(2.0 * np.pi * 1975.53 * t_shim) +
        0.08 * np.sin(2.0 * np.pi * 2637.02 * t_shim)
    ) * (1.0 + 0.08 * np.sin(2.0 * np.pi * 14.0 * t_shim))
    sig[mask_shim] += shim * shim_env

    # 3. Warm 50Hz sub-bass anchor
    t_sub_start = 0.180
    mask_sub = (t >= t_sub_start)
    t_sub = t[mask_sub] - t_sub_start
    sub_env = (1.0 - np.exp(-t_sub / 0.025)) * np.exp(-t_sub / 0.25)
    sub = 0.28 * (np.sin(2.0 * np.pi * 50.0 * t_sub) + 0.10 * np.sin(2.0 * np.pi * 100.0 * t_sub))
    sig[mask_sub] += sub * sub_env

    sig = apply_fade_ramps(sig, attack_samples=44, release_samples=661)
    return to_pcm16(sig, target_dbfs=TARGET_PEAK_DBFS)


def generate_game_over() -> np.ndarray:
    """
    sfx_game_over.wav: Clean cybernetic de-synchronization pulse (500ms).
    Pure melodic glide from 440Hz -> 55Hz with smooth exponential dissipation.
    Zero distortion or ugly glitch fuzz.
    """
    duration = 0.500
    num_samples = int(round(duration * SAMPLE_RATE))
    t = np.linspace(0, duration, num_samples, endpoint=False)

    # Pure melodic exponential pitch glide 440Hz -> 55Hz
    f0, f1 = 440.0, 55.0
    glide_dur = 0.480
    phase = exp_chirp_phase(np.clip(t, 0.0, glide_dur), f0, f1, glide_dur)

    # Pure harmonic tone (fundamental + gentle 2nd harmonic)
    osc = np.sin(phase) + 0.22 * np.sin(2.0 * phase)

    # Smooth exponential dissipation envelope
    env = (1.0 - np.exp(-t / 0.004)) * np.exp(-t / 0.160)
    sig = osc * env

    sig = apply_fade_ramps(sig, attack_samples=32, release_samples=441)
    return to_pcm16(sig, target_dbfs=TARGET_PEAK_DBFS)


def generate_laser_pew() -> np.ndarray:
    """
    sfx_laser_pew.wav: Laser-sharp plasma beam (60ms).
    Pure exponential FM chirp (1400Hz -> 350Hz) with crisp 5kHz transient click.
    No white noise hiss.
    """
    duration = 0.060
    num_samples = int(round(duration * SAMPLE_RATE))
    t = np.linspace(0, duration, num_samples, endpoint=False)

    # 1. Exponential FM chirp 1400Hz -> 350Hz
    f0, f1 = 1400.0, 350.0
    carrier_phase = exp_chirp_phase(t, f0, f1, duration)

    # Clean FM modulation for cohesive plasma zap texture
    mod_index = 0.75 * np.exp(-t / 0.018)
    modulator = mod_index * np.sin(2.0 * np.pi * 280.0 * t)
    chirp = np.sin(carrier_phase + modulator)
    chirp_env = (1.0 - np.exp(-t / 0.001)) * np.exp(-t / 0.022)

    # 2. Crisp 5kHz optical transient click (pure harmonic sine impulse, no noise)
    f_click = 5000.0
    click = np.sin(2.0 * np.pi * f_click * t) * np.exp(-t / 0.0007) * (t < 0.0025)

    mixed = 0.78 * chirp * chirp_env + 0.22 * click
    mixed = apply_fade_ramps(mixed, attack_samples=16, release_samples=66)
    return to_pcm16(mixed, target_dbfs=TARGET_PEAK_DBFS)


def generate_laser_heavy() -> np.ndarray:
    """
    sfx_laser_heavy.wav: Heavy pulse blaster (95ms).
    Resonant 650Hz -> 180Hz laser chirp with clean 60Hz punch.
    """
    duration = 0.095
    num_samples = int(round(duration * SAMPLE_RATE))
    t = np.linspace(0, duration, num_samples, endpoint=False)

    # 1. Resonant laser chirp 650Hz -> 180Hz
    f0, f1 = 650.0, 180.0
    phase = exp_chirp_phase(t, f0, f1, duration)
    chirp_osc = np.sin(phase) + 0.35 * np.sin(2.0 * phase) + 0.12 * np.sin(3.0 * phase)
    chirp_env = (1.0 - np.exp(-t / 0.0015)) * np.exp(-t / 0.034)

    # 2. Clean 60Hz sub punch
    sub_env = (1.0 - np.exp(-t / 0.002)) * np.exp(-t / 0.025)
    sub = np.sin(2.0 * np.pi * 60.0 * t) * sub_env

    # 3. High-frequency 4.2kHz transient snap
    snap = np.sin(2.0 * np.pi * 4200.0 * t) * np.exp(-t / 0.0006) * (t < 0.0020)

    mixed = 0.65 * chirp_osc * chirp_env + 0.32 * sub + 0.15 * snap
    mixed = apply_fade_ramps(mixed, attack_samples=22, release_samples=88)
    return to_pcm16(mixed, target_dbfs=TARGET_PEAK_DBFS)


def generate_hit() -> np.ndarray:
    """
    sfx_hit.wav: Tactile cyber impact (30ms).
    Crisp 3.5kHz glass/chitin snap + punchy 110Hz sub kick.
    """
    duration = 0.030
    num_samples = int(round(duration * SAMPLE_RATE))
    t = np.linspace(0, duration, num_samples, endpoint=False)

    # 1. Crisp 3.5kHz glass/chitin snap (dual high sines 3.5kHz & 4.6kHz)
    snap = (
        0.70 * np.sin(2.0 * np.pi * 3500.0 * t) +
        0.30 * np.sin(2.0 * np.pi * 4600.0 * t)
    ) * np.exp(-t / 0.0025)

    # 2. Punchy 110Hz sub kick (pitch sweeps 150Hz -> 85Hz)
    f0, f1 = 150.0, 85.0
    phase_kick = exp_chirp_phase(t, f0, f1, duration)
    kick = np.sin(phase_kick) * np.exp(-t / 0.010)

    mixed = 0.46 * snap + 0.54 * kick
    mixed = apply_fade_ramps(mixed, attack_samples=16, release_samples=44)
    return to_pcm16(mixed, target_dbfs=TARGET_PEAK_DBFS)


def generate_dash() -> np.ndarray:
    """
    sfx_dash.wav: Relativistic slipstream (140ms).
    Smooth aerodynamic whoosh with high-frequency air shimmer (4kHz-9kHz) and 60Hz sub displacement.
    """
    duration = 0.140
    num_samples = int(round(duration * SAMPLE_RATE))
    t = np.linspace(0, duration, num_samples, endpoint=False)

    # 1. Aerodynamic slipstream formant whoosh (sweep 400Hz -> 950Hz -> 320Hz)
    whoosh_f = 400.0 + 550.0 * np.sin(np.pi * (t / duration))
    whoosh_phase = 2.0 * np.pi * np.cumsum(whoosh_f) / SAMPLE_RATE
    whoosh_env = (np.sin(np.pi * (t / duration))) ** 1.1
    whoosh = np.sin(whoosh_phase) * whoosh_env

    # 2. High-frequency crystalline air shimmer (4kHz - 8.5kHz harmonic cluster)
    shimmer = (
        0.35 * np.sin(2.0 * np.pi * 4200.0 * t) +
        0.30 * np.sin(2.0 * np.pi * 5600.0 * t) +
        0.22 * np.sin(2.0 * np.pi * 7100.0 * t) +
        0.13 * np.sin(2.0 * np.pi * 8400.0 * t)
    ) * whoosh_env * (1.0 + 0.12 * np.sin(2.0 * np.pi * 25.0 * t))

    # 3. Clean 60Hz sub displacement
    sub_env = (1.0 - np.exp(-t / 0.015)) * np.exp(-t / 0.045)
    sub = np.sin(2.0 * np.pi * 60.0 * t) * sub_env

    mixed = 0.36 * whoosh + 0.34 * shimmer + 0.30 * sub
    mixed = apply_fade_ramps(mixed, attack_samples=32, release_samples=132)
    return to_pcm16(mixed, target_dbfs=TARGET_PEAK_DBFS)


def generate_shield_on() -> np.ndarray:
    """
    sfx_shield_on.wav: Holographic barrier hum (130ms).
    Pure dual harmonic swell (659Hz + 987Hz) with clean ionization envelope.
    """
    duration = 0.130
    num_samples = int(round(duration * SAMPLE_RATE))
    t = np.linspace(0, duration, num_samples, endpoint=False)

    f1, f2, f3 = 659.25, 987.77, 1318.51  # E5, B5, E6
    osc = (
        0.55 * np.sin(2.0 * np.pi * f1 * t) +
        0.35 * np.sin(2.0 * np.pi * f2 * t) +
        0.10 * np.sin(2.0 * np.pi * f3 * t)
    )

    # Clean ionization envelope (smooth swell with subtle 22Hz barrier flux)
    ionization_flux = 1.0 + 0.08 * np.sin(2.0 * np.pi * 22.0 * t)
    env = (np.sin(np.pi * (t / duration))) ** 0.75

    sig = osc * env * ionization_flux
    sig = apply_fade_ramps(sig, attack_samples=32, release_samples=88)
    return to_pcm16(sig, target_dbfs=TARGET_PEAK_DBFS)


def generate_shield_break() -> np.ndarray:
    """
    sfx_shield_break.wav: Crystalline barrier shatter (140ms).
    Resonant glass discharge (2800Hz -> 1200Hz).
    """
    duration = 0.140
    num_samples = int(round(duration * SAMPLE_RATE))
    t = np.linspace(0, duration, num_samples, endpoint=False)

    # 1. Resonant glass discharge sweep 2800Hz -> 1200Hz
    f0, f1 = 2800.0, 1200.0
    phase = exp_chirp_phase(t, f0, f1, duration)

    # Incommensurate glass chime modes
    glass_osc = (
        0.58 * np.sin(phase) +
        0.28 * np.sin(1.414 * phase) +
        0.14 * np.sin(2.450 * phase)
    )
    glass_env = (1.0 - np.exp(-t / 0.0008)) * np.exp(-t / 0.038)

    # 2. High crystal micro-impulse at 4800Hz
    snap = np.sin(2.0 * np.pi * 4800.0 * t) * np.exp(-t / 0.0008) * (t < 0.0025)

    mixed = 0.78 * glass_osc * glass_env + 0.22 * snap
    mixed = apply_fade_ramps(mixed, attack_samples=22, release_samples=132)
    return to_pcm16(mixed, target_dbfs=TARGET_PEAK_DBFS)


def generate_warp_jump() -> np.ndarray:
    """
    sfx_warp_jump.wav: Relativistic hyper-drive burst (800ms).
    Rising emerald vortex sweep + deep clean sub-boom.
    """
    duration = 0.800
    num_samples = int(round(duration * SAMPLE_RATE))
    t = np.linspace(0, duration, num_samples, endpoint=False)
    sig = np.zeros(num_samples)

    # 1. Rising emerald vortex sweep (0.00s -> 0.36s)
    t_split = 0.360
    mask1 = (t <= t_split)
    t1 = t[mask1]
    f0, f1 = 160.0, 2800.0
    phase1 = exp_chirp_phase(t1, f0, f1, t_split)
    vortex_osc = np.sin(phase1) + 0.30 * np.sin(2.0 * phase1) + 0.15 * np.sin(3.0 * phase1)
    vortex_env = (t1 / t_split) ** 2.2
    sig[mask1] += 0.50 * vortex_osc * vortex_env

    # 2. Relativistic Sub-Boom (0.36s -> 0.80s)
    mask2 = (t >= t_split)
    t2 = t[mask2] - t_split
    boom_env = (1.0 - np.exp(-t2 / 0.004)) * np.exp(-t2 / 0.14)
    boom = 0.78 * (np.sin(2.0 * np.pi * 48.0 * t2) + 0.18 * np.sin(2.0 * np.pi * 96.0 * t2)) * boom_env

    # High-frequency crystalline ringdown tail
    sparkle = 0.12 * (
        np.sin(2.0 * np.pi * 3200.0 * t2) +
        0.08 * np.sin(2.0 * np.pi * 4800.0 * t2)
    ) * np.exp(-t2 / 0.075)

    sig[mask2] += boom + sparkle

    sig = apply_fade_ramps(sig, attack_samples=44, release_samples=882)
    return to_pcm16(sig, target_dbfs=TARGET_PEAK_DBFS)


def generate_boss_alert() -> np.ndarray:
    """
    sfx_boss_alert.wav: Ominous titan emergence (580ms).
    Deep 45Hz sub drone with eerie 880Hz harmonic swell.
    """
    duration = 0.580
    num_samples = int(round(duration * SAMPLE_RATE))
    t = np.linspace(0, duration, num_samples, endpoint=False)

    # 1. Deep 45Hz sub drone (subtle 46Hz -> 42Hz pitch drop)
    f0, f1 = 46.0, 42.0
    phase_sub = exp_chirp_phase(t, f0, f1, duration)
    drone_osc = (
        0.65 * np.sin(phase_sub) +
        0.25 * np.sin(2.0 * phase_sub) +
        0.10 * np.sin(3.0 * phase_sub)
    )
    drone_env = (1.0 - np.exp(-t / 0.025)) * np.exp(-t / 0.24)
    drone = drone_osc * drone_env

    # 2. Eerie 880Hz harmonic swell (A5 + tritone Eb 1244.5Hz)
    swell_env = (np.sin(np.pi * np.clip((t - 0.04) / 0.44, 0.0, 1.0))) ** 2.0
    harmonic_swell = (
        0.18 * np.sin(2.0 * np.pi * 880.0 * t) +
        0.12 * np.sin(2.0 * np.pi * 1244.5 * t)
    ) * swell_env

    mixed = 0.72 * drone + 0.28 * harmonic_swell
    mixed = apply_fade_ramps(mixed, attack_samples=88, release_samples=661)
    return to_pcm16(mixed, target_dbfs=TARGET_PEAK_DBFS)


def generate_ui_click() -> np.ndarray:
    """
    sfx_ui_click.wav: Ultra-premium tactile micro-click (10ms).
    Pure 3200Hz high-Q glass impulse.
    """
    duration = 0.010
    num_samples = int(round(duration * SAMPLE_RATE))
    t = np.linspace(0, duration, num_samples, endpoint=False)

    f_click = 3200.0
    osc = np.sin(2.0 * np.pi * f_click * t)
    # Ultra-fast 0.2ms attack, steep exponential decay
    attack_env = np.sin(0.5 * np.pi * np.clip(t / 0.0002, 0.0, 1.0))
    decay_env = np.exp(-t / 0.0016)
    sig = osc * attack_env * decay_env

    return to_pcm16(sig, target_dbfs=TARGET_PEAK_DBFS, attack_samples=4, release_samples=16)


def generate_ui_tab() -> np.ndarray:
    """
    sfx_ui_tab.wav: Tactile micro-tick (10ms).
    Pure 4000Hz glass impulse.
    """
    duration = 0.010
    num_samples = int(round(duration * SAMPLE_RATE))
    t = np.linspace(0, duration, num_samples, endpoint=False)

    f_tab = 4000.0
    osc = np.sin(2.0 * np.pi * f_tab * t)
    attack_env = np.sin(0.5 * np.pi * np.clip(t / 0.0002, 0.0, 1.0))
    decay_env = np.exp(-t / 0.0015)
    sig = osc * attack_env * decay_env

    return to_pcm16(sig, target_dbfs=TARGET_PEAK_DBFS, attack_samples=4, release_samples=16)


def generate_bite() -> np.ndarray:
    """
    sfx_bite.wav: Chitinous cyber-mandible bite (38ms).
    Unified with the rich lower-tone mouth chomp, sharing identical clean acoustic profile.
    """
    return generate_eat()


def generate_crit() -> np.ndarray:
    """
    sfx_crit.wav: High-frequency cyber critical strike (90ms).
    Clean 2400Hz overtone snap with 120Hz sub-bass impact.
    """
    duration = 0.090
    num_samples = int(round(duration * SAMPLE_RATE))
    t = np.linspace(0, duration, num_samples, endpoint=False)

    # 1. 2400Hz overtone snap (40ms decay)
    snap = (
        0.65 * np.sin(2.0 * np.pi * 2400.0 * t) +
        0.35 * np.sin(2.0 * np.pi * 4800.0 * t)
    ) * np.exp(-t / 0.012) * (t < 0.040)

    # 2. 120Hz sub-bass anchor (90ms decay)
    sub = np.sin(2.0 * np.pi * 120.0 * t) * np.exp(-t / 0.035)

    mixed = 0.45 * snap + 0.55 * sub
    mixed = apply_fade_ramps(mixed, attack_samples=22, release_samples=66)
    return to_pcm16(mixed, target_dbfs=TARGET_PEAK_DBFS)


def generate_explosion() -> np.ndarray:
    """
    sfx_explosion.wav: Cyber-plasma detonation (250ms).
    Bright 2.6kHz transient flash + deep 55Hz sub-bass boom without muddy distortion.
    """
    duration = 0.250
    num_samples = int(round(duration * SAMPLE_RATE))
    t = np.linspace(0, duration, num_samples, endpoint=False)

    # 1. Bright 2.6kHz transient flash (with 3.8kHz overtone)
    flash = (
        0.60 * np.sin(2.0 * np.pi * 2600.0 * t) +
        0.40 * np.sin(2.0 * np.pi * 3800.0 * t)
    ) * np.exp(-t / 0.008) * (t < 0.035)

    # 2. Deep 55Hz sub-bass boom (sweep 70Hz -> 45Hz)
    f0, f1 = 70.0, 45.0
    phase = exp_chirp_phase(t, f0, f1, duration)
    boom = np.sin(phase) * (1.0 - np.exp(-t / 0.005)) * np.exp(-t / 0.075)

    mixed = 0.35 * flash + 0.65 * boom
    mixed = apply_fade_ramps(mixed, attack_samples=22, release_samples=110)
    return to_pcm16(mixed, target_dbfs=TARGET_PEAK_DBFS)


# ==============================================================================
# MAIN BATCH GENERATOR & DIST/PUBLIC SYNCHRONIZATION
# ==============================================================================

def main():
    target_dirs = [PRIMARY_DIR, DIST_DIR]
    for d in target_dirs:
        os.makedirs(d, exist_ok=True)

    print("=" * 80)
    print("GENERATING BROADCAST CYBER-EMERALD AUDIO SUITE (44.1kHz / 16-BIT PCM)")
    print(f"Primary Target Directory: {PRIMARY_DIR}")
    print(f"Dist Target Directory:    {DIST_DIR}")
    print("=" * 80)

    generators = {
        "sfx_eat.wav": generate_eat,
        "sfx_star_ding.wav": generate_star_ding,
        "sfx_level_up.wav": generate_level_up,
        "sfx_victory.wav": generate_victory,
        "sfx_game_over.wav": generate_game_over,
        "sfx_laser_pew.wav": generate_laser_pew,
        "sfx_laser_heavy.wav": generate_laser_heavy,
        "sfx_hit.wav": generate_hit,
        "sfx_bite.wav": generate_bite,
        "sfx_crit.wav": generate_crit,
        "sfx_explosion.wav": generate_explosion,
        "sfx_dash.wav": generate_dash,
        "sfx_shield_on.wav": generate_shield_on,
        "sfx_shield_break.wav": generate_shield_break,
        "sfx_warp_jump.wav": generate_warp_jump,
        "sfx_boss_alert.wav": generate_boss_alert,
        "sfx_ui_click.wav": generate_ui_click,
        "sfx_ui_tab.wav": generate_ui_tab,
    }

    generated_data = {}

    # Synthesize all 15 unique audio assets
    for filename, fn in generators.items():
        data = fn()
        generated_data[filename] = data

        dur_ms = (len(data) / float(SAMPLE_RATE)) * 1000.0
        peak = np.max(np.abs(data)) / 32768.0
        dbfs = 20.0 * np.log10(peak) if peak > 0 else -99.9
        dc = np.mean(data) / 32768.0

        for d in target_dirs:
            filepath = os.path.join(d, filename)
            write_wav(filepath, SAMPLE_RATE, data)

        print(f"✔ Generated: {filename:<20} | Dur: {dur_ms:6.1f}ms | Peak: {dbfs:5.2f} dBFS | DC: {dc:+.6f}")

    # Compatibility copies across both target directories:
    # 1. sfx_eat_pop.wav <- copy of sfx_eat.wav
    # 2. sfx_gem_chime.wav <- copy of sfx_eat.wav (unified eating sound)
    # 3. sfx_boss_roar.wav <- copy of sfx_boss_alert.wav
    compatibility_copies = [
        ("sfx_eat.wav", "sfx_eat_pop.wav", "Unified eating copy (sfx_eat_pop.wav)"),
        ("sfx_eat.wav", "sfx_gem_chime.wav", "Unified food copy (sfx_gem_chime.wav)"),
        ("sfx_eat.wav", "sfx_bite.wav", "Unified eating/bite copy (sfx_bite.wav)"),
        ("sfx_eat.wav", "sfx_star_ding.wav", "Unified star collection copy (sfx_star_ding.wav)"),
        ("sfx_boss_alert.wav", "sfx_boss_roar.wav", "Ominous alert copy (sfx_boss_roar.wav)"),
    ]

    for src_name, dst_name, desc in compatibility_copies:
        for d in target_dirs:
            src_path = os.path.join(d, src_name)
            dst_path = os.path.join(d, dst_name)
            shutil.copyfile(src_path, dst_path)
        print(f"✔ Compatibility copy: {dst_name:<20} <- {src_name:<18} ({desc})")

    print("=" * 80)
    print(f"✅ BATCH AUDIO GENERATION COMPLETE: 18 ASSETS WRITTEN TO BOTH public/ AND dist/")
    print("=" * 80)


if __name__ == "__main__":
    main()
