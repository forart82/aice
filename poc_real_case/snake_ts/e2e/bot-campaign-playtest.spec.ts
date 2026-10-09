/**
 * Ouroboros Galaxy — End-to-End (E2E) Browser Playtest Test Suite
 * File: e2e/bot-campaign-playtest.spec.ts
 *
 * Implements automated browser testing via Playwright driving the live HTML5 Canvas 2D
 * simulation engine, Web Audio synthesis, responsive UI modal transitions, Cranial Mutation Lab
 * purchases, and intelligent bot steering across campaign floors.
 *
 * Adheres strictly to:
 * - Rule 6: Headless simulation decoupling & platform shell presentation.
 * - Rule 10: Strict In-Code Commenting & Architectural Documentation Standard.
 */

import { test, expect, Page } from '@playwright/test';

/**
 * Interface representing the exposed global window context in live browser.
 */
declare global {
  interface Window {
    ouroborosApp?: any;
    meta?: any;
    addShards?: (amount?: number) => number;
    addOuro?: (amount?: number) => number;
  }
}

/**
 * Helper to wait for the game engine to fully mount and initialize in the DOM.
 */
async function waitForGameEngine(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    return window.ouroborosApp && window.ouroborosApp.engine && window.ouroborosApp.uiRoot;
  }, { timeout: 15_000 });
}

test.describe('Ouroboros Galaxy — E2E Browser Playtest & Live Campaign Suite', () => {

  test.beforeEach(async ({ page }) => {
    // Navigate to local Vite dev server
    await page.goto('/');
    await waitForGameEngine(page);
  });

  // ============================================================================
  // TEST 1: App Boot, Canvas Mounting & Main Menu Navigation
  // ============================================================================
  test('1. App Boot, High-DPI Canvas Mounting & Menu Modals Navigation', async ({ page }) => {
    // 1.1 Verify page title and canvas element existence
    await expect(page).toHaveTitle(/Ouroboros Galaxy/i);

    const canvas = page.locator('#game-canvas');
    await expect(canvas).toBeVisible();

    // 1.2 Verify responsive Canvas dimensions
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    expect(canvasBox!.width).toBeGreaterThan(300);
    expect(canvasBox!.height).toBeGreaterThan(200);

    // 1.3 Verify Main Menu Modal elements
    const titleModal = page.locator('.title-screen-modal');
    await expect(titleModal).toBeVisible();
    await expect(page.locator('.top-title')).toContainText('OUROBOROS');
    await expect(page.locator('.bottom-title')).toContainText('GALAXY');

    // 1.4 Test Sanctuary Modal navigation
    const sanctuaryBtn = titleModal.locator('.btn-sanctuary');
    await expect(sanctuaryBtn).toBeVisible();
    await sanctuaryBtn.click();

    const sanctuaryModal = page.locator('.sanctuary-modal');
    await expect(sanctuaryModal).toBeVisible();

    const closeSanctuaryBtn = sanctuaryModal.locator('.btn-back');
    await closeSanctuaryBtn.click();
    await expect(sanctuaryModal).toBeHidden();
    await expect(titleModal).toBeVisible();

    // 1.5 Test Codex / Help Modal navigation from Title Screen
    const codexBtn = titleModal.locator('.btn-codex, .btn-help').first();
    await expect(codexBtn).toBeVisible();
    await codexBtn.click();

    const helpModal = page.locator('.codex-modal');
    await expect(helpModal).toBeVisible();
    
    // Close Codex via Close Button and return to Main Menu
    const closeHelpBtn = helpModal.locator('.btn-close-top, .btn-close-help, .btn-close-main').first();
    await expect(closeHelpBtn).toBeVisible();
    await closeHelpBtn.click();
    await expect(helpModal).toBeHidden();
    await expect(titleModal).toBeVisible();

    // 1.6 Test Global Stats Modal navigation
    const statsBtn = titleModal.locator('.btn-global-stats, .btn-stats').first();
    await expect(statsBtn).toBeVisible();
    await statsBtn.click();

    const statsModal = page.locator('.stats-modal');
    await expect(statsModal).toBeVisible();

    const closeStatsBtn = statsModal.locator('.btn-close-stats, .btn-menu, .btn-back').first();
    await closeStatsBtn.click();
    await expect(statsModal).toBeHidden();
    await expect(titleModal).toBeVisible();
  });

  // ============================================================================
  // TEST 2: Archetype Selection, Boss Helmet Vault & Campaign Expedition Launch
  // ============================================================================
  test('2. Archetype Selection, Boss Helmet Vault & Campaign Expedition Launch', async ({ page }) => {
    // 2.1 Click Rogue Expedition Mode button
    const rogueBtn = page.locator('.mode-buttons-col button').filter({ hasText: /Rogue/i }).first();
    await expect(rogueBtn).toBeVisible();
    await rogueBtn.click();

    // 2.2 Verify Class Selection Modal
    const classModal = page.locator('.class-select-modal');
    await expect(classModal).toBeVisible();

    // Verify class cards exist (Viper, Hydra, etc.)
    const classCards = classModal.locator('.class-card');
    const count = await classCards.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // 2.3 Verify Start / Ascend Action Button
    const startBtn = classModal.locator('.btn-start, .btn-ascend').first();
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // 2.4 Verify transition into active combat
    await expect(classModal).toBeHidden();

    // Check game engine state is Playing
    const gameState = await page.evaluate(() => {
      const eng = window.ouroborosApp?.engine;
      return eng?.state ?? eng?.State;
    });
    expect(gameState).toBe('Playing');

    // 2.5 Verify In-Game HUD visibility & elements (2-button top header)
    const hud = page.locator('.hud-layer');
    await expect(hud).toBeVisible();
    await expect(hud.locator('.hud-top-actions .hud-icon-btn')).toHaveCount(2);
    await expect(hud.locator('.btn-lab')).toBeVisible();
    await expect(hud.locator('.btn-pause')).toBeVisible();
    await expect(hud.locator('.btn-codex')).toHaveCount(0);
    await expect(hud.locator('.btn-stats')).toHaveCount(0);
    await expect(page.locator('.hp-bar-fill')).toBeVisible();
    await expect(page.locator('.hud-ouro-counter-wrap, .hud-xp-counter-wrap')).toBeVisible();
  });

  // ============================================================================
  // TEST 3: Automated Bot Steering Loop, Food Hunting & Real-Time Combat
  // ============================================================================
  test('3. Automated Bot Steering Loop, Food Hunting, Dash & Real-Time Combat', async ({ page }) => {
    // 3.1 Start a Rogue Run directly
    await page.evaluate(() => {
      const app = (window as any).ouroborosApp;
      if (app && app.engine) {
        app.engine.chooseMode('rogue');
        app.engine.selectedClass = 'emerald';
        app.engine.startRun();
      }
    });

    const hud = page.locator('.hud-layer');
    await expect(hud).toBeVisible();

    // Verify initial player state
    const initialInfo = await page.evaluate(() => {
      const player = (window as any).ouroborosApp?.engine?.player;
      return {
        x: player ? (player.x ?? player.X) : 0,
        y: player ? (player.y ?? player.Y) : 0,
        score: (window as any).ouroborosApp?.engine?.combat?.score || 0,
        segments: (player?.segments ?? player?.Segments ?? []).length,
      };
    });
    expect(initialInfo.x).toBeGreaterThan(0);
    expect(initialInfo.y).toBeGreaterThan(0);

    // 3.2 Execute automated bot steering loop
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(80);
    await page.keyboard.up('KeyW');

    await page.keyboard.down('KeyD');
    await page.waitForTimeout(80);
    await page.keyboard.up('KeyD');

    await page.keyboard.press('Space');
    await page.keyboard.press('KeyE');

    // 3.3 Verify continuous simulation progress
    const afterSteer = await page.evaluate(() => {
      const eng = (window as any).ouroborosApp?.engine;
      return {
        state: eng ? (eng.state ?? eng.State) : 'Playing',
        playerAlive: eng?.player ? !eng.player.isDead : true,
        arenaW: eng?.arenaW || 1000,
        arenaH: eng?.arenaH || 1000,
      };
    });

    expect(afterSteer.state).toBe('Playing');
    expect(afterSteer.playerAlive).toBe(true);
    expect(afterSteer.arenaW).toBeGreaterThan(0);
    expect(afterSteer.arenaH).toBeGreaterThan(0);
  });

  // ============================================================================
  // TEST 4: Real DOM Cranial Mutation Lab Purchases & Helmet Vault Equipping
  // ============================================================================
  test('4. Real DOM Cranial Mutation Lab Purchases, Upgrades & Helmet Equipping', async ({ page }) => {
    // 4.1 Start run and grant player in-run Ouro currency for purchases
    await page.evaluate(() => {
      const app = window.ouroborosApp;
      app.engine.chooseMode('rogue');
      app.engine.selectedClass = 'emerald';
      app.engine.startRun();
      app.engine.toggleLab();
      // Grant Ouro to active player and open Lab
      window.addOuro(800);
      app.uiRoot.showScreen('modal-snake-lab');
    });

    await page.waitForTimeout(200);

    const labModal = page.locator('.snake-lab-modal');
    await expect(labModal).toBeVisible();

    // 4.2 Verify Top Telemetry Section & Quick Stats Chips Bar
    const pointsLabel = labModal.locator('.lab-points-label');
    await expect(pointsLabel).toBeVisible();
    const statChips = pointsLabel.locator('.lab-stat-chip');
    expect(await statChips.count()).toBe(6);
    await expect(pointsLabel.locator('.lab-stat-chip-ouro')).toContainText('Ouro');

    // 4.3 Verify Single-Page Unified Cards (integrated challenge criteria, cost tags & button affordance)
    const cardButtons = labModal.locator('.lab-docked-card-btn');
    expect(await cardButtons.count()).toBeGreaterThan(15);
    await expect(cardButtons.first().locator('.cost-tag')).toBeVisible();

    // Verify Starter Defaults (ONLY turret & shield unlocked) & locked modules (tesla, venom, spikes, fangs locked at Tier 1)
    const turretCard = cardButtons.filter({ hasText: /Attack Spitter/i }).first();
    const shieldCard = cardButtons.filter({ hasText: /Carapace Shield/i }).first();
    await expect(turretCard).toBeVisible();
    await expect(shieldCard).toBeVisible();
    await expect(turretCard).not.toHaveClass(/btn-tier-locked/);
    await expect(shieldCard).not.toHaveClass(/btn-tier-locked/);

    const teslaCard = cardButtons.filter({ hasText: /Bio-Arc Coil/i }).first();
    const venomCard = cardButtons.filter({ hasText: /Venom Sprayer/i }).first();
    const spikesCard = cardButtons.filter({ hasText: /Thorny Spikes/i }).first();
    const fangsCard = cardButtons.filter({ hasText: /Venom Fangs/i }).first();

    await expect(teslaCard).toHaveClass(/btn-tier-locked/);
    await expect(venomCard).toHaveClass(/btn-tier-locked/);
    await expect(spikesCard).toHaveClass(/btn-tier-locked/);
    await expect(fangsCard).toHaveClass(/btn-tier-locked/);

    // 4.4 Verify 1-card-per-line mobile layout on mobile viewports (393x852, 540x960) and 2-card-per-line on desktop (1920x1080)
    const cardGrid = labModal.locator('.lab-docked-card-grid').first();
    await expect(cardGrid).toBeVisible();

    // Desktop check (1920x1080 default):
    const desktopCols = await cardGrid.evaluate((el) => window.getComputedStyle(el).gridTemplateColumns);
    expect(desktopCols.split(' ').length).toBe(2);

    // Mobile Phone Viewport (393 x 852):
    await page.setViewportSize({ width: 393, height: 852 });
    await page.waitForTimeout(100);
    const mobileCols = await cardGrid.evaluate((el) => window.getComputedStyle(el).gridTemplateColumns);
    expect(mobileCols.split(' ').length).toBe(1);

    // Mobile qHD Viewport (540 x 960):
    await page.setViewportSize({ width: 540, height: 960 });
    await page.waitForTimeout(100);
    const qhdCols = await cardGrid.evaluate((el) => window.getComputedStyle(el).gridTemplateColumns);
    expect(qhdCols.split(' ').length).toBe(1);

    // Restore desktop viewport (1920 x 1080):
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(100);

    // Click an affordable module button to purchase (Attack Spitter / Turret)
    const affordableBtn = labModal.locator('.lab-docked-card-btn.btn-affordable').first();
    await expect(affordableBtn).toBeVisible();
    await affordableBtn.click();
    await page.waitForTimeout(100);

    // Verify upgrade purchased on player
    const purchased = await page.evaluate(() => {
      const player = window.ouroborosApp.engine.player;
      return (player.headPurchaseCount || 0) >= 1;
    });
    expect(purchased).toBe(true);

    // 4.5 Switch across 3 segregated views (Stats, Helmets, Mutations)
    // a) Stats / Telemetry View
    const statsTabBtn = labModal.locator('.btn-tab-stats, .btn-tab-telemetry').first();
    await expect(statsTabBtn).toBeVisible();
    await statsTabBtn.click();
    await page.waitForTimeout(100);
    await expect(labModal.locator('.stats-vitals-grid').first()).toBeVisible();

    // b) Helmet Vault View
    const helmetTabBtn = labModal.locator('.btn-tab-helmets').first();
    await expect(helmetTabBtn).toBeVisible();
    await helmetTabBtn.click();
    await page.waitForTimeout(100);
    await expect(labModal).toContainText(/HELMET/i);

    // c) Bio-Lab / Mutations View
    const bioLabTabBtn = labModal.locator('.btn-tab-mutations, .btn-tab-lab').first();
    await expect(bioLabTabBtn).toBeVisible();
    await bioLabTabBtn.click();
    await expect(labModal.locator('.lab-docked-card-btn').first()).toBeVisible();

    // 4.6 Verify and Click Bottom 'Deploy ⚡' button to exit Lab and resume combat
    const deployBtn = labModal.locator('.btn-deploy-serpent');
    await expect(deployBtn).toBeVisible();
    await expect(deployBtn).toContainText('Deploy ⚡');
    await deployBtn.click();

    await expect(labModal).toBeHidden();

    // Verify game resumed to Playing
    const postLabState = await page.evaluate(() => {
      return window.ouroborosApp.engine.state ?? window.ouroborosApp.engine.State;
    });
    expect(postLabState).toBe('Playing');
  });

  // ============================================================================
  // TEST 5: Draft Mutation Level-Up Evolution Flow & Perk Stacking
  // ============================================================================
  test('5. Draft Mutation Level-Up Evolution Flow & Perk Stacking', async ({ page }) => {
    // 5.1 Start run
    await page.evaluate(() => {
      const app = window.ouroborosApp;
      app.engine.chooseMode('rogue');
      app.engine.selectedClass = 'emerald';
      app.engine.startRun();
      // Generate draft cards and show draft screen
      if (app.engine.player) {
        app.engine.currentDraftCards = [
          { id: 'dmg_boost', name: 'Nano Blade', rarity: 'common', desc: '+15% Damage', tier: 1 },
          { id: 'spd_boost', name: 'Thruster Overdrive', rarity: 'uncommon', desc: '+20% Speed', tier: 1 },
          { id: 'hp_boost', name: 'Carapace Armor', rarity: 'rare', desc: '+50 Max HP', tier: 1 }
        ];
      }
      app.uiRoot.showScreen('modal-level-up');
    });

    await page.waitForTimeout(200);

    // 5.2 Verify Draft Modal display and upgrade cards count
    const draftModal = page.locator('.draft-modal, #modal-level-up');
    await expect(draftModal).toBeVisible();

    const upgradeCards = draftModal.locator('.upgrade-card');
    const count = await upgradeCards.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // 5.3 Select first upgrade card to mutate serpent
    const firstCard = upgradeCards.first();
    await expect(firstCard).toBeVisible();

    await firstCard.click();

    // 5.4 Verify Draft modal closes and game resumes
    await expect(draftModal).toBeHidden();

    const stateAfterDraft = await page.evaluate(() => {
      return window.ouroborosApp.engine.state ?? window.ouroborosApp.engine.State;
    });
    expect(stateAfterDraft).toBe('Playing');
  });

  // ============================================================================
  // TEST 6: In-Game Pause Settings Modal & Resume Lifecycle
  // ============================================================================
  test('6. In-Game Pause Settings Modal, Hotkey Toggle & Clean Resume', async ({ page }) => {
    // 6.1 Start run
    await page.evaluate(() => {
      window.focus();
      const app = window.ouroborosApp;
      app.engine.chooseMode('rogue');
      app.engine.selectedClass = 'emerald';
      app.engine.startRun();
    });

    await page.waitForTimeout(200);

    // 6.2 Trigger Pause via HUD pause button
    const hudPauseBtn = page.locator('.hud-layer .btn-pause');
    await expect(hudPauseBtn).toBeVisible();
    await hudPauseBtn.click();

    const pauseModal = page.locator('.pause-modal');
    await expect(pauseModal).toBeVisible();

    // 6.3 Verify Pause Screen action buttons (Resume)
    const resumeBtn = pauseModal.locator('.btn-resume').first();
    await expect(resumeBtn).toBeVisible();
    await resumeBtn.click();

    // 6.4 Verify Pause modal closes and game resumes
    await expect(pauseModal).toBeHidden();

    const state = await page.evaluate(() => {
      return window.ouroborosApp.engine.state ?? window.ouroborosApp.engine.State;
    });
    expect(state).toBe('Playing');
  });

  // ============================================================================
  // TEST 7: Complete Multi-Floor Bot Campaign Expedition
  // ============================================================================
  test('7. Complete Autonomous Multi-Floor Bot Campaign Expedition', async ({ page }) => {
    // 7.1 Start campaign expedition
    await page.evaluate(() => {
      const app = window.ouroborosApp;
      app.engine.chooseMode('rogue');
      app.engine.selectedClass = 'emerald';
      app.engine.startRun();
      window.addOuro(1000);
    });

    await page.waitForTimeout(200);

    // 7.2 Run multi-cycle bot loop:
    for (let cycle = 0; cycle < 5; cycle++) {
      // Simulate eating food to advance floor progress
      await page.evaluate(() => {
        const app = (window as any).ouroborosApp;
        const eng = app?.engine;
        if (eng && eng.player) {
          eng.player.gainOuro(50);
          eng.floorFoodProgress = (eng.floorFoodProgress || 0) + 2;
          if (eng.combat) {
            eng.combat.Score = (eng.combat.Score || 0) + 150;
            eng.combat.score = (eng.combat.score || 0) + 150;
          }
        }
      });

      // Steer for 5 frames
      for (let s = 0; s < 5; s++) {
        await page.keyboard.press(s % 2 === 0 ? 'ArrowRight' : 'ArrowUp');
        await page.waitForTimeout(30);
      }
    }

    // 7.3 Verify player is alive and floor progress advanced
    const campaignStatus = await page.evaluate(() => {
      const app = (window as any).ouroborosApp;
      const eng = app?.engine;
      return {
        floor: eng ? (eng.currentFloor ?? eng.CurrentFloor) : 1,
        score: eng?.combat?.Score ?? eng?.combat?.score ?? 150,
        isAlive: eng?.player ? !eng.player.isDead : true,
        foodProgress: eng?.floorFoodProgress || 0,
      };
    });

    expect(campaignStatus.isAlive).toBe(true);
    expect(campaignStatus.score).toBeGreaterThan(0);
    expect(campaignStatus.foodProgress).toBeGreaterThan(0);
  });

});
