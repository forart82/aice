# 🐍 OUROBOROS ASCENSION (TypeScript / Canvas2D / WebAudio)

[![Quality Gate](https://img.shields.io/badge/Quality%20Gate-100%25%20PASS-brightgreen)](file:///home/forart/dev/snake_ts/verify)
[![Language](https://img.shields.io/badge/TypeScript-5.8%2B%20%2F%20ES2022-blue)](https://www.typescriptlang.org)
[![Bundler](https://img.shields.io/badge/Vite-6-purple)](https://vitejs.dev)
[![Test Runner](https://img.shields.io/badge/Vitest-3-brightgreen)](https://vitest.dev)
[![License](https://img.shields.io/badge/License-MIT-green)](file:///home/forart/dev/snake_ts/docs/ASSETS.md)

**A high-octane roguelike RPG combo snake game.** Five playable serpent archetypes, 36 stacking evolutionary perks, cranial mutation assembly and boss helmet vault in the Snake Lab, multi-phase colossal bosses, a combo overdrive economy, 100% procedurally synthesized Web Audio, and responsive multi-screen/multi-device capability.

---

## 🎮 Features

- **🐍 5 Playable Serpent Archetypes:** Emerald Viper, Shadow Stalker, Hydra Behemoth, Storm Wyrm, and Solar Drake.
- **🧬 Cranial Mutation Lab & Boss Helmet Vault:** Interactive living vivarium workbench to assemble tactical weapon and defense modules onto the Serpent Head and equip persistent Boss Helmets.
- **🃏 36 Stacking Evolutionary Perks & 26 Relics:** Draft dynamic synergies (Venom Spit, Orbital Fangs, Frostbite Aura, Phoenix Rebirth, Supernova).
- **⚡ Hyper Frenzy Combo Economy:** Build massive score and damage multipliers by eating fruit and killing hostiles without biting your own tail.
- **👹 Multi-Phase Boss Guardians:** Centipede Behemoth, Infernal Colossus, and Astral Leviathan across ascending floors.
- **🏛️ Sanctuary Meta-Progression:** Collect essence shards (💎) to unlock permanent stat blessings, relics, and new snake classes.
- **🎯 4 Game Modes:** Rogue Ascension (5 floors + final boss), Endless Frenzy, Boss Rush, and Daily Challenge (global deterministic seed).
- **🖥️ Universal Multi-Screen & Responsive Engine:** Dynamically adapts across all display aspect ratios (16:9, 21:9 ultrawide, 32:9, 4:3, 9:16 mobile portrait) with zero UI overlapping and instant multi-window/companion device pairing via `BroadcastChannel` and WebRTC.

---

## 🛠️ Technology Stack & Architecture

- **Language:** Modern TypeScript (Strict `-noImplicitAny`, Strict null checks, ES2022+)
- **Build Tool & Bundler:** Vite 6 with instant Hot Module Replacement (HMR)
- **Testing Framework:** Vitest 3 running 116 automated conformance, parity, and balance test suites
- **Simulation Layer (`src/core`, `src/sim`, `src/data`):** Pure deterministic TypeScript simulation running with `number` (float64) precision on a fixed 120 Hz time accumulator (`dt = 1/120s`). **Zero browser DOM dependencies in domain logic.**
- **Presentation Layer (`src/render`, `src/ui`, `src/audio`, `src/input`, `src/platform`):** High-DPI Canvas 2D (`OffscreenCanvas`) rendering pipeline, glowing neon particle FX, procedural Web Audio synthesizer, normalized multi-input (Keyboard, Gamepad, Touch Virtual Stick), and multi-screen synchronization.

---

## 🕹️ Controls

| Action | Desktop (Keyboard & Mouse) | Mobile / Tablet (Touch) | Gamepad (Xbox / PlayStation) |
| :--- | :--- | :--- | :--- |
| **Steer** | `WASD` / Arrow Keys | Dynamic Virtual Joystick | Left Analog Stick / D-Pad |
| **Dash** | `Space` / `Shift` / Right Click | `DASH` Pad (Lower Right) | `Button A` / `✕` (Cross) |
| **Class Skill** | `E` / `Q` / `F` | `SKILL` Pad (Lower Right) | `Button X` / `□` (Square) |
| **Snake Lab** | `L` | `🧬 LAB` Button | `Button Y` / `△` (Triangle) |
| **Pause / Menu** | `P` / `Esc` | `⏸` Button (Top Right) | `Start` / `Options` |

---

## 🚀 Running the Automated Quality Gate & Tests

Run the complete automated quality gate (Strict Typecheck + 116 Vitest Suites + Production Build):

```bash
./verify
```

### Additional Test Suite Commands
```bash
npm run test:selftest    # Run the 81-conformance test matrix
npm run test:parity      # Run the 15 Golden Replay parity traces
npm run test:playtest    # Run the 20-seed balance sweeps per class
npm run typecheck        # Run strict tsc --noEmit check
```

---

## 💻 Running the Game Locally

```bash
# Install dependencies
npm install

# Launch local dev server with HMR
npm run dev

# Open http://localhost:3000 in your browser
```

---

## 📁 Repository Structure

```
/home/forart/dev/snake_ts/
├── ORACLE.md                 # Single Source of Truth (SSOT) for mechanics and balance
├── AGENTS.md                 # Protocol 3.0 & strict TDD rules
├── GEMINI.md                 # Agent guidelines and quick reference
├── README.md                 # Project overview & instructions
├── verify                    # Executable quality gate script
├── package.json              # Project dependencies & scripts
├── tsconfig.json             # Strict TypeScript configuration
├── vite.config.ts            # Vite & Vitest configuration
├── index.html                # Responsive web app entry point
├── docs/
│   ├── ASSETS.md             # Commercial asset provenance & license manifest
│   ├── DEVICE_SPECS.md       # Responsive viewport scaling & safe-areas guide
│   ├── MULTI_SCREEN_AND_DEVICE.md # Multi-screen BroadcastChannel & companion pairing
│   ├── PUBLISHING.md         # Multi-platform publishing blueprint (Web, Tauri, Capacitor)
│   ├── SAVE_SCHEMA.md        # Save schema & migration rules (v1 -> v2)
│   └── tdd/                  # Dedicated Feature TDD Specifications
└── src/
    ├── core/                 # Decoupled Math, PRNG, Vector2, Service Contracts
    ├── data/                 # Game tables, 36 Cards, 26 Relics, Sanctuary Upgrades
    ├── sim/                  # 120 Hz Deterministic Simulation Loop & Combat
    ├── render/               # Canvas 2D Glowing Neon Rendering Pipeline & FX
    ├── ui/                   # Universal ResponsiveLayout Engine & Modal Screens
    ├── audio/                # Procedural Web Audio Synthesizer & Music Sequencer
    ├── input/                # Normalized Multi-Input, Gamepad API & Virtual Joystick
    ├── platform/             # SaveIO (LocalStorage/IndexedDB), MultiScreen, CompanionSync
    └── tests/                # 116 Automated Conformance, Parity & Balance Test Suites
```
