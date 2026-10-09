# 📦 Multi-Platform Publishing & Distribution Blueprint

> **Rule Reference:** [`AGENTS.md#rule-7`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  
> **Target Directory:** `/home/forart/dev/snake_ts`  

---

## 🚀 1. Target Platforms & Export Pipelines

| Target Platform | Technology Wrapper | Output Artifact | Target Stores |
| :--- | :--- | :--- | :--- |
| **Web Browser (PWA)** | Native HTML5 Canvas + WebAudio | Static files in `dist/` | Itch.io, Web Hosting, PWA Install |
| **Desktop (PC / Mac / Linux)** | **Tauri 2.0** (Rust Shell) | `.deb`, `.rpm`, `.AppImage`, `.msi`, `.dmg` | Steam, Itch.io, GOG, Epic Store |
| **Mobile (Android)** | **Capacitor 8** / Gradle Native Shell | [`ouroboros-ascension.apk`](file:///home/forart/dev/snake_ts/ouroboros-ascension.apk) | Google Play Store, F-Droid, Sideloading |

---

## 🛠️ 2. Build & Packaging Commands

```bash
# 1. Compile Optimized Web Bundle
npm run build

# 2. Build Ready-to-Install Android APK (Capacitor + Gradle)
npm run build:apk
# Generated file: /home/forart/dev/snake_ts/ouroboros-ascension.apk (4.4 MB)

# 3. Open Native Android Studio Project
npx cap open android
```
