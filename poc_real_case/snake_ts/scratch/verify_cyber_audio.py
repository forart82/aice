#!/usr/bin/env python3
"""
Acoustic Verification Script for Cyber-Emerald Broadcast Audio Assets
Validates 44.1kHz 16-bit PCM WAV assets against strict broadcast audio tolerances:
- Sample rate: 44,100 Hz
- Channels: Mono (1)
- Bit depth: 16-bit PCM
- Peak amplitude: Between -3.05 dBFS and -0.95 dBFS (target -1.5 dBFS)
- Zero clipping (no samples >= 32767 or <= -32768)
- Zero DC offset (mean amplitude < 0.005, target < 0.0001)
- Duration bounds conforming to short, crystal-clear cybernetic aesthetic
"""

import os
import sys
import wave
import numpy as np

PRIMARY_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../public/assets/audio"))
DIST_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../dist/assets/audio"))

TARGET_SPECS = {
    "sfx_eat.wav": {"target_sec": 0.038, "min_sec": 0.035, "max_sec": 0.042},
    "sfx_eat_pop.wav": {"target_sec": 0.038, "min_sec": 0.035, "max_sec": 0.042},
    "sfx_gem_chime.wav": {"target_sec": 0.038, "min_sec": 0.035, "max_sec": 0.042},
    "sfx_bite.wav": {"target_sec": 0.038, "min_sec": 0.035, "max_sec": 0.042},
    "sfx_star_ding.wav": {"target_sec": 0.038, "min_sec": 0.035, "max_sec": 0.042},
    "sfx_level_up.wav": {"target_sec": 0.450, "min_sec": 0.430, "max_sec": 0.470},
    "sfx_victory.wav": {"target_sec": 0.650, "min_sec": 0.620, "max_sec": 0.680},
    "sfx_game_over.wav": {"target_sec": 0.500, "min_sec": 0.470, "max_sec": 0.530},
    "sfx_laser_pew.wav": {"target_sec": 0.060, "min_sec": 0.055, "max_sec": 0.065},
    "sfx_laser_heavy.wav": {"target_sec": 0.095, "min_sec": 0.090, "max_sec": 0.105},
    "sfx_hit.wav": {"target_sec": 0.030, "min_sec": 0.026, "max_sec": 0.035},
    "sfx_dash.wav": {"target_sec": 0.140, "min_sec": 0.130, "max_sec": 0.150},
    "sfx_shield_on.wav": {"target_sec": 0.130, "min_sec": 0.120, "max_sec": 0.140},
    "sfx_shield_break.wav": {"target_sec": 0.140, "min_sec": 0.130, "max_sec": 0.150},
    "sfx_warp_jump.wav": {"target_sec": 0.800, "min_sec": 0.770, "max_sec": 0.830},
    "sfx_boss_alert.wav": {"target_sec": 0.580, "min_sec": 0.550, "max_sec": 0.610},
    "sfx_boss_roar.wav": {"target_sec": 0.580, "min_sec": 0.550, "max_sec": 0.610},
    "sfx_ui_click.wav": {"target_sec": 0.010, "min_sec": 0.008, "max_sec": 0.013},
    "sfx_ui_tab.wav": {"target_sec": 0.010, "min_sec": 0.008, "max_sec": 0.013},
}

def read_wav_file(filepath: str):
    """Reads a WAV file returning (sample_rate, channels, sampwidth, data_np)."""
    with wave.open(filepath, "rb") as wf:
        sr = wf.getframerate()
        channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        nframes = wf.getnframes()
        frames = wf.readframes(nframes)
        if sampwidth == 2:
            data = np.frombuffer(frames, dtype=np.int16)
        elif sampwidth == 4:
            data = np.frombuffer(frames, dtype=np.int32)
        else:
            data = np.frombuffer(frames, dtype=np.uint8)
        return sr, channels, sampwidth, data

def verify_directory(audio_dir: str) -> bool:
    print("=" * 80)
    print(f"CYBER-EMERALD AUDIO QUALITY AUDIT: {audio_dir}")
    print("=" * 80)

    all_passed = True
    results = []

    for filename, spec in TARGET_SPECS.items():
        filepath = os.path.join(audio_dir, filename)
        if not os.path.isfile(filepath):
            print(f"❌ [MISSING] {filename}: File not found on disk at {filepath}")
            all_passed = False
            continue

        try:
            sr, channels, sampwidth, data = read_wav_file(filepath)
        except Exception as e:
            print(f"❌ [ERROR] {filename}: Failed to parse WAV: {e}")
            all_passed = False
            continue

        # Check Sample Rate
        sr_pass = (sr == 44100)
        
        # Check Channels (must be 1D mono)
        channels_pass = (channels == 1)

        # Check Bit Depth (16-bit PCM = 2 bytes per sample)
        dtype_pass = (sampwidth == 2) and (data.dtype == np.int16)

        # Duration
        num_samples = len(data)
        duration_sec = num_samples / float(sr)
        duration_pass = (spec["min_sec"] <= duration_sec <= spec["max_sec"])

        # Amplitude analysis
        float_data = data.astype(np.float64) / 32768.0
        peak_abs = float(np.max(np.abs(float_data))) if len(float_data) > 0 else 0.0
        peak_dbfs = 20.0 * np.log10(peak_abs) if peak_abs > 1e-9 else -99.9
        
        # Peak normalization between -3.05 dBFS and -0.95 dBFS (target -1.5 dBFS)
        peak_pass = (-3.05 <= peak_dbfs <= -0.95)

        # Zero clipping check
        clipping_pass = (peak_abs <= (32767.0 / 32768.0)) and (peak_dbfs < 0.0)

        # DC Offset check (mean should be near 0)
        dc_offset = float(np.mean(float_data))
        dc_pass = (abs(dc_offset) < 0.005)

        # Zero DAC step boundary check (must start and end at 0 to eliminate 1920s radio clicks)
        boundary_pass = (data[0] == 0) and (data[-1] == 0)

        passed = all([sr_pass, channels_pass, dtype_pass, duration_pass, peak_pass, clipping_pass, dc_pass, boundary_pass])
        if not passed:
            all_passed = False

        status_mark = "✔" if passed else "❌"
        results.append({
            "name": filename,
            "status": status_mark,
            "passed": passed,
            "sr": sr,
            "duration": duration_sec,
            "target": spec["target_sec"],
            "peak_dbfs": peak_dbfs,
            "dc_offset": dc_offset,
        })

        print(f"{status_mark} {filename:<20} | Dur: {duration_sec*1000:6.1f}ms (Target: {spec['target_sec']*1000:5.0f}ms) | Peak: {peak_dbfs:5.2f} dBFS | DC: {dc_offset:+.6f} | SR: {sr}")
        if not passed:
            failed_reasons = []
            if not sr_pass: failed_reasons.append(f"SampleRate({sr}!=44100)")
            if not channels_pass: failed_reasons.append(f"Channels({channels}!=1)")
            if not dtype_pass: failed_reasons.append(f"Dtype(sampwidth={sampwidth}, dtype={data.dtype})")
            if not duration_pass: failed_reasons.append(f"Duration({duration_sec:.3f}s not in [{spec['min_sec']}, {spec['max_sec']}])")
            if not peak_pass: failed_reasons.append(f"Peak({peak_dbfs:.2f}dBFS not in [-3.05, -0.95])")
            if not clipping_pass: failed_reasons.append("ClippingDetected")
            if not dc_pass: failed_reasons.append(f"DCOffset({dc_offset:.6f})")
            if not boundary_pass: failed_reasons.append(f"BoundaryDiscontinuity(start={data[0]}, end={data[-1]})")
            print(f"   -> Failures: {', '.join(failed_reasons)}")

    print("-" * 80)
    if all_passed:
        print(f"🎉 ALL {len(TARGET_SPECS)} AUDIO ASSETS IN {os.path.basename(audio_dir)} PASSED WITH 100% CONFORMANCE!")
    else:
        print(f"⚠️ AUDIT FAILED for {audio_dir}: Some audio assets do not meet the cyber-emerald broadcast criteria.")
    return all_passed

def main():
    dirs_to_verify = [PRIMARY_DIR]
    if os.path.isdir(DIST_DIR):
        dirs_to_verify.append(DIST_DIR)

    all_ok = True
    for d in dirs_to_verify:
        if not verify_directory(d):
            all_ok = False

    print("=" * 80)
    if all_ok:
        print(f"✅ GLOBAL AUDIO AUDIT: 100% CONFORMANCE ACROSS ALL DIRECTORIES!")
        return 0
    else:
        print(f"❌ GLOBAL AUDIO AUDIT: FAILURES DETECTED")
        return 1

if __name__ == "__main__":
    sys.exit(main())
