# 🚀 Publishing & Multi-Platform Deployment Blueprint

> **Rule Reference:** `AGENTS.md#rule-7`, `AGENTS.md#rule-14`
> **Reality check:** this document was ported from a browser-first TypeScript
> project. The target stores changed substantially, and the honest constraints
> are stated rather than aspirations copied across.

---

## 0. What changed by moving to C++ / SFML

The original blueprint assumed an HTML5 bundle wrapped by Capacitor and Tauri.
None of that applies. SFML 3 is a native C++ library:

| Original target | Status under SFML 3 |
| :--- | :--- |
| Web portals (Itch HTML5, Poki, CrazyGames) | ❌ **Not supported.** No official web/WASM backend. |
| Mobile (Capacitor/PWA) | ⚠️ **Android is experimental**, iOS more so. Not a near-term target. |
| Desktop (Steam, Itch) | ✅ **The real target.** Native binary, no wrapper needed. |

This is a genuine narrowing of reach compared with a web game, and it should be a
conscious trade rather than a surprise found at release. What is bought in return
is native performance for a horde game whose whole pitch is thousands of enemies
at 60 FPS — which is exactly what a browser target would have made hardest.

---

## 1. Desktop — the primary target

- **Build:** `./bt` → `build/dogmax` plus a timestamped `dogmax-<UTC>` snapshot.
- **Runtime layout:** the binary resolves its config directory relative to
  `argv[0]`, so `configs/` and `assets/` ship beside the executable.
- **Linux:** primary development platform. Ship as a tarball and/or Flatpak.
- **Windows / macOS:** SFML supports both; **neither has been built or tested**.
  Cross-platform CI is a prerequisite for claiming support, not an afterthought.

### Steam integration
Steamworks is proprietary and **must not be linked into the core**. Isolate it
behind an interface so the game builds and runs with it absent — that also keeps
the Itch/DRM-free build identical to the Steam one apart from one adapter.

---

## 2. Licensing gate — blocking

Nothing ships until [`docs/ASSETS.md`](ASSETS.md) is fully populated and verified.
**~380 binary assets currently have unrecorded provenance**, including 120 fonts,
which are historically the most common cause of a store takedown.

Dependency licences are clear: SFML is Zlib/png, doctest is MIT. Both permit
commercial distribution and static linking.

---

## 3. Pre-Publishing Checklist

- [ ] `docs/ASSETS.md` 100% verified — zero uncredited, zero copyleft
- [ ] Unreferenced assets deleted rather than licence-audited
- [ ] Font licences individually confirmed for commercial + embedding
- [ ] Safe-area / aspect-ratio sweep per [`DEVICE_SPECS.md`](DEVICE_SPECS.md)
- [ ] Save migration tests green per [`SAVE_SCHEMA.md`](SAVE_SCHEMA.md) (once saves exist)
- [ ] `./verify` clean — build, full doctest suite, release build
- [ ] Perf harness holds 60 FPS at the target enemy count
- [ ] No telemetry without explicit opt-in consent (GDPR/COPPA/CCPA)
- [ ] Windows and macOS builds actually produced and run, or support not claimed
- [ ] Steamworks isolated behind an interface; DRM-free build verified
