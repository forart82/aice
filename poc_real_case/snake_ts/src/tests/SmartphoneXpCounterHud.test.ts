import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupMockDom, MockElement } from "./MockDom";
import { UiRoot } from "../ui/UiRoot";
import { HudView } from "../ui/HudView";
import { ResponsiveLayout } from "../ui/ResponsiveLayout";
import { SnakePlayer } from "../sim/SnakePlayer";
import { Services } from "../core/Services";
import { NullFx, NullSound } from "../core/Contracts";
import { InputManager } from "../input/InputManager";
import * as fsLib from "fs";
import * as pathLib from "path";

describe("Smartphone XP Counter HUD & Telemetry TDD Suite", () => {
  let restoreDom: () => void;
  let container: MockElement;
  let engine: any;
  let uiRoot: UiRoot;
  let hud: HudView;

  beforeEach(() => {
    restoreDom = setupMockDom();
    Services.Sound = new NullSound();
    Services.Fx = new NullFx();
    Services.Input = InputManager.instance;

    container = document.createElement("div") as any;
    engine = {
      player: new SnakePlayer("emerald", 1280, 720, 3),
      combat: {
        score: 0,
        comboCount: 0,
        comboMultiplier: 1,
        comboTimer: 0,
        comboMaxTime: 4.0,
        frenzyActive: false,
        shardsEarned: 0,
      },
      currentFloor: 1,
      floorFoodProgress: 0,
      foodTarget: 15,
      fps: 60,
      state: 1,
    };

    uiRoot = UiRoot.init(container as any, engine);
    hud = uiRoot.hudView;
  });

  afterEach(() => {
    restoreDom();
  });

  it("1. Ouro counter DOM elements (wrap, badge, val) exist in HudView", () => {
    const ouroWrap = hud.element.querySelector(".hud-ouro-counter-wrap, .hud-xp-counter-wrap");
    const ouroBadge = hud.element.querySelector(".hud-ouro-badge, .hud-xp-badge");
    const ouroVal = hud.element.querySelector(".hud-ouro-val, .hud-xp-val");

    expect(ouroWrap).toBeDefined();
    expect(ouroBadge).toBeDefined();
    expect(ouroVal).toBeDefined();
  });

  it("2. Formats continuous accumulating in-run Ouro telemetry without resets", () => {
    engine.player.xp = 45;
    engine.player.ouro = 45;
    hud.refresh(engine);

    const ouroVal = hud.element.querySelector(".hud-ouro-val, .hud-xp-val")!;
    expect(ouroVal.textContent).toBe("45");
  });

  it("3. Handles 0 Ouro and edge-case float values safely with rounded integers", () => {
    engine.player.xp = 0;
    engine.player.ouro = 0;
    hud.refresh(engine);

    const ouroVal = hud.element.querySelector(".hud-ouro-val, .hud-xp-val")!;
    expect(ouroVal.textContent).toBe("0");

    engine.player.ouro = 74.8;
    hud.refresh(engine);

    expect(ouroVal.textContent).toBe("74");
  });

  it("4. Triggers level-up pulse and highlight on Ouro counter wrap when pendingLevelUps > 0", () => {
    engine.player.level = 2;
    engine.player.pendingLevelUps = 1;
    hud.refresh(engine);

    const ouroWrap = hud.element.querySelector(".hud-ouro-counter-wrap, .hud-xp-counter-wrap")!;
    expect(ouroWrap.classList.contains("level-up-ready")).toBe(true);

    // Clear pending level-ups
    engine.player.pendingLevelUps = 0;
    hud.refresh(engine);

    expect(ouroWrap.classList.contains("level-up-ready")).toBe(false);
  });

  it("5. Smartphone Viewport Visibility: index.html does NOT hide .hud-ouro-counter-wrap on tier-phone", () => {
    const htmlPath = pathLib.resolve(__dirname, "../../index.html");
    const htmlContent = fsLib.readFileSync(htmlPath, "utf8");

    // Must NOT contain rule setting .hud-layer.tier-phone .hud-ouro-counter-wrap to display: none
    const phoneXpHiddenRegex = /\.hud-layer\.tier-phone\s+.*\.hud-(?:ouro|xp)-counter-wrap\s*\{[^}]*display\s*:\s*none/i;
    expect(phoneXpHiddenRegex.test(htmlContent)).toBe(false);

    // Must include styling for .hud-ouro-counter-wrap in phone tier
    expect(htmlContent).toContain(".hud-ouro-counter-wrap");
  });

  it("6. Displays spendable Ouro wallet balance and decreases when Ouro is spent despite higher lifetime totalXpCollected", () => {
    engine.player.totalXpCollected = 500;
    engine.player.ouro = 200;
    engine.player.xp = 200;
    hud.refresh(engine);

    const ouroVal = hud.element.querySelector(".hud-ouro-val, .hud-xp-val")!;
    expect(ouroVal.textContent).toBe("200");

    // Spend 50 Ouro in lab
    engine.player.ouro = 150;
    engine.player.xp = 150;
    hud.tick(engine.player);

    expect(ouroVal.textContent).toBe("150");
  });
});
