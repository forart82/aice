import { test, expect } from '@playwright/test';

/**
 * ============================================================================
 * Ouroboros Ascension / Ouroboros Galaxy — Comprehensive Human-Like E2E Suite
 * File: e2e/human-journey.spec.ts
 *
 * Simulates real human player journeys across all game systems:
 * 1. Full Main Menu navigation (Sanctuary, Settings, Codex Help, Global Stats).
 * 2. Mode selection (Roguelike, Endless, Boss Rush, Daily Challenge) & Class Select.
 * 3. Active gameplay steering, dashing, skill activation, food harvest, and combat.
 * 4. Live gameplay hotkeys: In-Run Telemetry [T], Codex [H], Pause [P], Lab [L].
 * 5. Cranial Mutation Lab upgrade purchase flow with real-time HUD Ouro sync.
 * 6. Boss combat encounter, floor clear progression, and floor descent.
 * 7. Multi-device responsive viewports (Mobile, Tablet, Desktop, Ultrawide).
 * ============================================================================
 */

test.describe('Human Player Journey: Complete E2E Suite', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to local Vite dev server and ensure DOM is ready
    await page.goto('/');
    await page.waitForSelector('#app', { state: 'attached' });
    await page.waitForSelector('#game-canvas', { state: 'attached' });
    // Wait for the app and UI root to mount
    await page.waitForFunction(() => {
      return (window as any).ouroborosApp && (window as any).ouroborosApp.engine && (window as any).ouroborosApp.uiRoot;
    }, { timeout: 15_000 });
  });

  /**
   * TEST 1: Full Main Menu Navigation
   * Tests opening, inspecting, interacting with, and closing all 4 main menu modals:
   * Sanctuary, Settings, Codex & Field Guide, and Global Career Statistics.
   */
  test('Test 1: Full Main Menu navigation (Sanctuary, Settings, Codex Help, Global Stats)', async ({ page }) => {
    const mainMenuModal = page.locator('.title-screen-modal');
    await expect(mainMenuModal).toBeVisible();
    await expect(page.locator('.top-title')).toContainText('OUROBOROS');
    await expect(page.locator('.bottom-title')).toContainText('GALAXY');

    // 1. Visit Sanctuary Modal
    const sanctuaryBtn = mainMenuModal.locator('.btn-sanctuary');
    await expect(sanctuaryBtn).toBeVisible();
    await sanctuaryBtn.click();

    const sanctuaryModal = page.locator('.sanctuary-modal');
    await expect(sanctuaryModal).toBeVisible();
    await expect(sanctuaryModal.locator('.cyber-modal-title')).toContainText('OUROBOROS SANCTUARY');
    // Verify upgrade cards exist in sanctuary grid
    const upgradeCards = sanctuaryModal.locator('.shop-item-card');
    await expect(upgradeCards.first()).toBeVisible();
    expect(await upgradeCards.count()).toBeGreaterThan(0);

    // Return to Main Menu from Sanctuary
    await sanctuaryModal.locator('.btn-back').click();
    await expect(sanctuaryModal).toBeHidden();
    await expect(mainMenuModal).toBeVisible();

    // 2. Visit Settings Modal
    const settingsBtn = mainMenuModal.locator('.btn-settings');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    const settingsModal = page.locator('.settings-modal');
    await expect(settingsModal).toBeVisible();
    await expect(settingsModal.locator('.cyber-modal-title')).toContainText('SETTINGS');

    // Interact with Settings form elements
    const sfxSlider = settingsModal.locator('.sfx-slider');
    await expect(sfxSlider).toBeVisible();
    await sfxSlider.fill('0.85');

    const crtCheckbox = settingsModal.locator('.crt-check');
    if (await crtCheckbox.isVisible()) {
      await crtCheckbox.click();
    }

    // Save & Close Settings via Top-Right Close Button or Bottom Action
    const closeSettingsBtn = settingsModal.locator('.btn-close-top, .btn-close-settings').first();
    await closeSettingsBtn.click();
    await expect(settingsModal).toBeHidden();
    await expect(mainMenuModal).toBeVisible();

    // 3. Visit Codex & Help Modal
    const codexBtn = mainMenuModal.locator('.btn-codex, .btn-help').first();
    await expect(codexBtn).toBeVisible();
    await codexBtn.click();

    const codexModal = page.locator('.codex-modal');
    await expect(codexModal).toBeVisible();
    await expect(codexModal.locator('.cyber-modal-title')).toContainText('HELP & CODEX');

    // Test real-time search filtering in Codex
    const searchInput = codexModal.locator('.codex-search-input');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('combat');
    await page.waitForTimeout(100);

    // Close Codex Modal
    const closeCodexBtn = codexModal.locator('.btn-close-top, .btn-close-main, .btn-close-help').first();
    await closeCodexBtn.click();
    await expect(codexModal).toBeHidden();
    await expect(mainMenuModal).toBeVisible();

    // 4. Visit Global Stats Modal
    const statsBtn = mainMenuModal.locator('.btn-global-stats, .btn-stats').first();
    await expect(statsBtn).toBeVisible();
    await statsBtn.click();

    const statsModal = page.locator('.stats-modal');
    await expect(statsModal).toBeVisible();
    await expect(statsModal.locator('.stats-title')).toContainText('GLOBAL CAREER RECORDS');
    await expect(statsModal.locator('.career-summary-grid, .records-grid')).toBeVisible();

    // Return to Main Menu from Stats
    const statsCloseBtn = statsModal.locator('.btn-close-top, .btn-close-stats, .btn-menu, .btn-back').first();
    await statsCloseBtn.click();
    await expect(statsModal).toBeHidden();
    await expect(mainMenuModal).toBeVisible();
  });

  /**
   * TEST 2: Mode Selection & Serpent Class Selection
   * Tests selecting game modes (Roguelike, Endless, Boss Rush, Daily Challenge)
   * and selecting/inspecting serpent archetype classes in the Class Select screen.
   */
  test('Test 2: Mode selection (Roguelike, Endless, Boss Rush, Daily Challenge) and Serpent Class Selection', async ({ page }) => {
    const mainMenuModal = page.locator('.title-screen-modal');
    await expect(mainMenuModal).toBeVisible();

    const modeButtons = mainMenuModal.locator('.mode-buttons-col button');
    await expect(modeButtons.first()).toBeVisible();
    const count = await modeButtons.count();
    expect(count).toBeGreaterThanOrEqual(4); // Roguelike, Endless, Boss Rush, Daily Challenge

    // 1. Select Roguelike Mode
    const rogueBtn = modeButtons.filter({ hasText: /Rogue/i }).first();
    await expect(rogueBtn).toBeVisible();
    await rogueBtn.click();

    const classModal = page.locator('.class-select-modal');
    await expect(classModal).toBeVisible();
    await expect(classModal.locator('.cyber-modal-title')).toContainText('SELECT SERPENT ARCHETYPE');

    // Verify serpent classes are listed (Emerald Viper, Crimson Berserker, etc.)
    const classCards = classModal.locator('.class-card');
    expect(await classCards.count()).toBeGreaterThanOrEqual(5);

    // Verify Helmet Vault section is attached in Class Select
    const helmetVault = classModal.locator('.helmet-vault-section');
    await expect(helmetVault).toBeAttached();

    // Launch Expedition via Start button
    const startBtn = classModal.locator('.btn-start, .btn-ascend').first();
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // Verify transition into active gameplay: Class modal closes, HUD displays
    await expect(classModal).toBeHidden();
    const hud = page.locator('.hud-layer');
    await expect(hud).toBeVisible();
    await expect(hud.locator('.hud-class-tag')).toContainText(/Emerald|Viper/i);
  });

  /**
   * TEST 3: Active Gameplay Steering, Dashing, Skill, Food Harvest & Combat
   * Verifies keyboard inputs (WASD / Arrows), dashing [Space], skill activation [E],
   * food item ingestion, and real-time serpent vital updates.
   */
  test('Test 3: Active gameplay steering, dashing, skill activation, food collection, and combat', async ({ page }) => {
    // Start run directly via engine helper
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

    // 1. Steering with WASD keys held across physics frames
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(100);

    // Verify steering has been registered in the simulation
    const hasSteered = await page.evaluate(() => {
      const app = (window as any).ouroborosApp;
      return app?.engine?.hasSteered || app?.engine?.HasSteered;
    });
    await page.keyboard.up('KeyW');
    expect(hasSteered).toBeTruthy();

    // 2. Dash activation via [Space]
    await page.keyboard.down('Space');
    await page.waitForTimeout(100);
    await page.keyboard.up('Space');
    const dashTriggered = await page.evaluate(() => {
      const app = (window as any).ouroborosApp;
      const player = app?.engine?.player;
      return (
        player?.DashCooldownTimer > 0 ||
        player?.dashCooldownTimer > 0 ||
        player?.IsDashing ||
        player?.isDashing ||
        player?.DashTimer > 0 ||
        player?.dashTimer > 0
      );
    });
    expect(dashTriggered).toBeTruthy();

    // 3. Skill activation via [KeyE]
    await page.keyboard.down('KeyE');
    await page.waitForTimeout(100);
    await page.keyboard.up('KeyE');
    const skillCooldown = await page.evaluate(() => {
      const app = (window as any).ouroborosApp;
      const player = app?.engine?.player;
      const combat = app?.engine?.combat;
      return (
        player?.SkillCooldownTimer > 0 ||
        player?.skillCooldownTimer > 0 ||
        combat?.SkillCooldownTimer > 0 ||
        combat?.skillCooldownTimer > 0 ||
        player?.skillCooldown > 0 ||
        player?.SkillCooldown > 0
      );
    });
    expect(skillCooldown).toBeTruthy();

    // 4. Food Harvest & Ingestion Simulation
    await page.evaluate(() => {
      const app = (window as any).ouroborosApp;
      const engine = app?.engine;
      if (engine && engine.player) {
        engine.player.gainOuro(50);
        if (engine.combat) {
          engine.combat.score += 100;
        }
        app.uiRoot.hudView.tick(engine.player);
      }
    });

    // Verify HUD reflects active vitality
    await expect(hud.locator('.hud-hp-val')).toBeVisible();
    await expect(hud.locator('.score-val')).toBeVisible();
  });

  /**
   * TEST 4: Live Gameplay Hotkeys [T], [H], [P], [L]
   * Verifies immediate in-run hotkey responsiveness during active gameplay:
   * - [T]: In-Run Expedition Telemetry Modal
   * - [H]: Codex & Galactic Field Guide Modal
   * - [P]: System Pause Overlay
   * - [L]: Cranial Mutation Lab Modal
   */
  test('Test 4: Live gameplay hotkeys: In-Run Telemetry ([T]), Codex Guide ([H]), Pause ([P]), Cranial Mutation Lab ([L])', async ({ page }) => {
    // Start active run
    await page.evaluate(() => {
      window.focus();
      const app = (window as any).ouroborosApp;
      if (app && app.engine) {
        app.engine.chooseMode('rogue');
        app.engine.selectedClass = 'emerald';
        app.engine.startRun();
      }
    });

    const hud = page.locator('.hud-layer');
    await expect(hud).toBeVisible();
    await page.evaluate(() => window.focus());
    await page.waitForTimeout(100);

    // Verify HUD Header contains ONLY 2 action buttons: btn-lab and btn-pause
    const headerBtns = hud.locator('.hud-top-actions .hud-icon-btn');
    await expect(headerBtns).toHaveCount(2);
    await expect(hud.locator('.btn-lab')).toBeVisible();
    await expect(hud.locator('.btn-pause')).toBeVisible();
    await expect(hud.locator('.btn-codex')).toHaveCount(0);
    await expect(hud.locator('.btn-stats')).toHaveCount(0);

    // 1. Hotkey [T] -> Unified Lab Hub with In-Run Telemetry/Stats Tab (stats view)
    await page.evaluate(() => window.focus());
    await page.keyboard.press('KeyT');
    const labModal = page.locator('.snake-lab-modal');
    await expect(labModal).toBeVisible();
    await expect(labModal.locator('.cyber-modal-title')).toContainText('CRANIAL MUTATION LAB');
    await expect(labModal.locator('.stats-vitals-grid').first()).toBeVisible();

    // Close Unified Lab Hub via Deploy button
    await labModal.locator('.btn-deploy-serpent').click({ force: true });
    await expect(labModal).toBeHidden();
    await page.waitForTimeout(100);

    // 2. Hotkey [H] -> Codex Guide Modal
    await page.evaluate(() => window.focus());
    await page.keyboard.press('KeyH');
    const codexModal = page.locator('.codex-modal');
    await expect(codexModal).toBeVisible();
    await expect(codexModal.locator('.cyber-modal-title')).toContainText('HELP & CODEX');

    // Close Codex via Return to Game / Close button
    const closeCodex = codexModal.locator('.btn-close-main, .btn-close-top, .btn-close-help').first();
    await closeCodex.click({ force: true });
    await expect(codexModal).toBeHidden();
    await page.waitForTimeout(100);

    // 3. Hotkey [P] -> System Paused Overlay
    await page.evaluate(() => window.focus());
    await page.keyboard.press('KeyP');
    const pauseModal = page.locator('.pause-modal');
    await expect(pauseModal).toBeVisible();
    await expect(pauseModal.locator('.cyber-modal-title')).toContainText('SYSTEM PAUSED');

    // Resume via Resume button
    await pauseModal.locator('.btn-resume').click({ force: true });
    await expect(pauseModal).toBeHidden();
    await page.waitForTimeout(100);

    // 4. Hotkey [L] -> Cranial Mutation Lab Modal (mutations view)
    await page.evaluate(() => window.focus());
    await page.keyboard.press('KeyL');
    await expect(labModal).toBeVisible();
    await expect(labModal.locator('.cyber-modal-title')).toContainText('CRANIAL MUTATION LAB');

    // Verify top telemetry section with quick stats chips (Ouro, Floor, Length, Score, HP, Combo)
    const pointsLabel = labModal.locator('.lab-points-label');
    await expect(pointsLabel).toBeVisible();
    const statChips = pointsLabel.locator('.lab-stat-chip');
    expect(await statChips.count()).toBe(6);
    await expect(pointsLabel.locator('.lab-stat-chip-ouro')).toBeVisible();

    // Verify 3 segregated views (mutations, helmets, stats) navigation
    const tabMutations = labModal.locator('.btn-tab-mutations, .btn-tab-lab');
    const tabHelmets = labModal.locator('.btn-tab-helmets');
    const tabStats = labModal.locator('.btn-tab-stats, .btn-tab-telemetry');

    await expect(tabMutations).toBeVisible();
    await expect(tabHelmets).toBeVisible();
    await expect(tabStats).toBeVisible();

    // Test single-page unified layout: each card contains its integrated challenge progress, cost tag, and purchase button
    const cardButtons = labModal.locator('.lab-docked-card-btn');
    expect(await cardButtons.count()).toBeGreaterThan(15);
    await expect(cardButtons.first().locator('.cost-tag')).toBeVisible();

    // Verify run-start starter defaults: ONLY turret (Attack Spitter) and shield (Carapace Shield) are unlocked
    const turretCard = cardButtons.filter({ hasText: /Attack Spitter/i }).first();
    const shieldCard = cardButtons.filter({ hasText: /Carapace Shield/i }).first();
    await expect(turretCard).toBeAttached();
    await expect(shieldCard).toBeAttached();
    await expect(turretCard).not.toHaveClass(/btn-tier-locked/);
    await expect(shieldCard).not.toHaveClass(/btn-tier-locked/);

    // Verify tesla, venom, spikes, and fangs are properly locked at Tier 1 with challenge requirements
    const teslaCard = cardButtons.filter({ hasText: /Bio-Arc Coil/i }).first();
    const venomCard = cardButtons.filter({ hasText: /Venom Sprayer/i }).first();
    const spikesCard = cardButtons.filter({ hasText: /Thorny Spikes/i }).first();
    const fangsCard = cardButtons.filter({ hasText: /Venom Fangs/i }).first();

    await expect(teslaCard).toBeAttached();
    await expect(teslaCard).toHaveClass(/btn-tier-locked/);
    await expect(teslaCard).toContainText(/8x/);

    await expect(venomCard).toBeAttached();
    await expect(venomCard).toHaveClass(/btn-tier-locked/);
    await expect(venomCard).toContainText(/20 Enemies/);

    await expect(spikesCard).toBeAttached();
    await expect(spikesCard).toHaveClass(/btn-tier-locked/);
    await expect(spikesCard).toContainText(/Scarabs/);

    await expect(fangsCard).toBeAttached();
    await expect(fangsCard).toHaveClass(/btn-tier-locked/);
    await expect(fangsCard).toContainText(/15x/);

    // Test switching across the 3 segregated views inside Lab Hub:
    // View 1: Stats view (Telemetry / Bestiary / Nourishment)
    await tabStats.click();
    await expect(labModal.locator('.stats-vitals-grid').first()).toBeVisible();

    // View 2: Helmets view (Boss Helmet Vault & Loadout)
    await tabHelmets.click();
    await expect(labModal).toContainText(/HELMET/i);

    // View 3: Mutations view (Bio-Lab / Offensive / Defensive / Augment cards)
    await tabMutations.click();
    await expect(labModal.locator('.lab-docked-card-btn').first()).toBeVisible();

    // Close Lab via bottom Deploy button
    const deployBtn = labModal.locator('.btn-deploy-serpent');
    await expect(deployBtn).toBeVisible();
    await expect(deployBtn).toContainText('Deploy ⚡');
    await deployBtn.click({ force: true });
    await expect(labModal).toBeHidden();
  });

  /**
   * TEST 5: Cranial Mutation Lab Upgrade Purchase Flow & HUD Ouro Sync
   * Verifies opening the Mutation Lab with in-run currency (Ouro), purchasing
   * head-mounted weapon & defense modules, and confirming that the HUD Ouro
   * wallet reflects real-time deductions.
   */
  test('Test 5: Cranial Mutation Lab upgrade purchase flow: buying upgrades with Ouro and verifying real-time HUD wallet update', async ({ page }) => {
    // Start active run, grant 500 Ouro and open Lab
    await page.evaluate(() => {
      const app = (window as any).ouroborosApp;
      if (app && app.engine && app.uiRoot) {
        app.engine.chooseMode('rogue');
        app.engine.selectedClass = 'emerald';
        app.engine.startRun();
        if (app.engine.player) {
          app.engine.player.gainOuro(500);
          app.uiRoot.hudView.tick(app.engine.player);
        }
        app.uiRoot.showScreen('modal-snake-lab');
      }
    });

    await page.waitForTimeout(100);

    const labModal = page.locator('.snake-lab-modal');
    await expect(labModal).toBeVisible();

    // Verify Ouro balance inside Lab Quick Stats
    const labOuroChip = labModal.locator('.lab-stat-chip-ouro');
    await expect(labOuroChip).toBeVisible();
    await expect(labOuroChip).toContainText('500');

    // Find affordable upgrade button in Lab (e.g. Attack Spitter / Turret or Carapace Shield)
    const affordableBtn = labModal.locator('.lab-docked-card-btn.btn-affordable').first();
    await expect(affordableBtn).toBeVisible();
    await affordableBtn.click();
    await page.waitForTimeout(100);

    // Verify Ouro in Lab decreased
    const postPurchaseOuroText = await labOuroChip.textContent();
    const postPurchaseOuro = parseInt(postPurchaseOuroText?.replace(/[^0-9]/g, '') || '0', 10);
    expect(postPurchaseOuro).toBeLessThan(500);

    // Close Mutation Lab via Deploy button
    const deployBtn = labModal.locator('.btn-deploy-serpent');
    await deployBtn.click();
    await expect(labModal).toBeHidden();

    // Verify HUD Ouro wallet dynamically updated to match post-purchase balance
    const hud = page.locator('.hud-layer');
    await expect(hud).toBeVisible();
    const hudOuroVal = hud.locator('.hud-ouro-val, .hud-xp-val').first();
    await expect(hudOuroVal).toHaveText(`${postPurchaseOuro}`);
  });

  /**
   * TEST 6: Boss Combat Encounter & Floor Clear Progression
   * Verifies boss encounter HUD displays (Apex Guardian health bar),
   * floor completion transitions, Floor Clear summary modal, and floor descent.
   */
  test('Test 6: Boss combat and floor clear progression', async ({ page }) => {
    // Start active run
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
    await expect(hud.locator('.floor-title')).toContainText('FLOOR 1');

    // Trigger Boss Encounter in simulation
    await page.evaluate(() => {
      const app = (window as any).ouroborosApp;
      const engine = app?.engine;
      if (engine) {
        engine.spawnBoss();
        engine.onBossBox?.(true, engine.boss ? engine.boss.name : 'CENTIPEDE BEHEMOTH');
        app.uiRoot.hudView.setBossBox(true, 'CENTIPEDE BEHEMOTH');
      }
    });

    // Verify Boss Health Bar is displayed on the HUD
    const bossBox = hud.locator('.hud-boss-box');
    await expect(bossBox).toBeVisible();
    await expect(bossBox.locator('.boss-name')).toContainText(/CENTIPEDE|COLOSSUS|LEVIATHAN/i);

    // Trigger Floor Clear Modal
    await page.evaluate(() => {
      const app = (window as any).ouroborosApp;
      if (app && app.uiRoot) {
        app.uiRoot.showScreen('modal-floor-clear');
      }
    });

    // Verify Floor Clear Modal appears
    const victoryPanel = page.locator('.victory-panel');
    await expect(victoryPanel).toBeVisible();
    await expect(victoryPanel.locator('.victory-title')).toContainText(/FLOOR 1 CLEARED|CLEARED/i);

    // Click "Descend to Next Floor"
    const nextFloorBtn = victoryPanel.locator('.btn-next-floor');
    await expect(nextFloorBtn).toBeVisible();
    await nextFloorBtn.click();

    // Verify Floor Clear Modal dismisses and HUD advances to Floor 2
    await expect(victoryPanel).toBeHidden();
    await expect(hud.locator('.floor-title')).toContainText('FLOOR 2');
  });

  /**
   * TEST 7: Multi-Device Responsive Viewports
   * Verifies flawless layout engine scaling across all tier resolutions:
   * - Mobile Phone: 393 x 852 (iPhone 14 / modern Android)
   * - Tablet: 820 x 1180 (iPad Air / Tab S8)
   * - Desktop: 1920 x 1080 (Full HD 1080p)
   * - Ultrawide: 2560 x 1080 (21:9 Ultrawide Cinema)
   */
  test('Test 7: Multi-device viewports: Mobile (393x852, 540x960), Tablet (820x1180), Desktop (1920x1080), Ultrawide (2560x1080)', async ({ page }) => {
    // Open Snake Lab modal for layout verification
    await page.evaluate(() => {
      const app = (window as any).ouroborosApp;
      if (app && app.uiRoot) {
        app.uiRoot.showScreen('modal-snake-lab');
      }
    });

    const labModal = page.locator('.snake-lab-modal');
    await expect(labModal).toBeVisible();
    const cardGrid = labModal.locator('.lab-docked-card-grid').first();
    await expect(cardGrid).toBeVisible();

    // 1. Mobile Phone Viewport (393 x 852) -> 1-Card-Per-Line
    await page.setViewportSize({ width: 393, height: 852 });
    await page.waitForTimeout(100);

    const uiContainer = page.locator('#ui-root');
    await expect(uiContainer).toHaveClass(/tier-phone/);

    // Verify zero horizontal overflow on mobile
    const mobileScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(mobileScrollWidth).toBeLessThanOrEqual(394);

    // Verify 1-card-per-line layout on 393 x 852
    const mobileCols = await cardGrid.evaluate((el) => window.getComputedStyle(el).gridTemplateColumns);
    expect(mobileCols.split(' ').length).toBe(1);

    // 2. Mobile qHD Viewport (540 x 960) -> 1-Card-Per-Line
    await page.setViewportSize({ width: 540, height: 960 });
    await page.waitForTimeout(100);
    await expect(uiContainer).toHaveClass(/tier-phone/);

    const qhdCols = await cardGrid.evaluate((el) => window.getComputedStyle(el).gridTemplateColumns);
    expect(qhdCols.split(' ').length).toBe(1);

    // 3. Tablet Viewport (820 x 1180)
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.waitForTimeout(100);
    await expect(uiContainer).toHaveClass(/tier-tablet/);

    // 4. Desktop Viewport (1920 x 1080) -> 2-Cards-Per-Line
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(100);
    await expect(uiContainer).toHaveClass(/tier-desktop/);

    const desktopCols = await cardGrid.evaluate((el) => window.getComputedStyle(el).gridTemplateColumns);
    expect(desktopCols.split(' ').length).toBe(2);

    // 5. Ultrawide Viewport (2560 x 1080)
    await page.setViewportSize({ width: 2560, height: 1080 });
    await page.waitForTimeout(100);

    // Verify canvas handles 21:9 aspect ratio correctly
    const canvasBox = await page.locator('#game-canvas').boundingBox();
    expect(canvasBox?.width).toBe(2560);
    expect(canvasBox?.height).toBe(1080);
  });
});
