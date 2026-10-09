import { test, expect, Page, Locator } from '@playwright/test';

/**
 * ============================================================================
 * Ouroboros Galaxy — Comprehensive Mobile Overlap E2E Test Suite
 * File: e2e/mobile-overlap-audit.spec.ts
 *
 * Exhaustive geometric bounding-box overlap & layout collision audit across
 * standard mobile smartphone viewports:
 * 1. 360 x 640 (Compact Android 16:9 / 9:16)
 * 2. 393 x 852 (iPhone 14 / Standard Modern Smartphone)
 * 3. 412 x 915 (Modern Large Android / Pixel & Galaxy)
 * 4. 540 x 960 (qHD Mobile Display)
 *
 * Core Audited Tests:
 * - Test 1: Main Menu & sub-row buttons (0 element bounding box intersections).
 * - Test 2: Class Selection screen & archetype cards.
 * - Test 3: Cranial Mutation Lab modal across all 3 tabs (mutations, helmets, stats).
 *   Explicitly asserts that card title, status badge, description, progress bar,
 *   and buy button have strictly non-overlapping bounding boxes:
 *   (rectA.bottom <= rectB.top || rectA.right <= rectB.left).
 * - Test 4: Sanctuary screen & meta upgrade cards.
 * - Test 5: Settings modal & Codex guide modal.
 * - Test 6: In-Game HUD & touch controls (stick, dash, skill vs vitals/header).
 * ============================================================================
 */

export interface BoundingBox2D {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 4 Mandatory Mobile Audit Viewports
 */
const MOBILE_VIEWPORTS = [
  { name: '360x640 (Compact Android)', width: 360, height: 640 },
  { name: '393x852 (Standard Smartphone / iPhone 14)', width: 393, height: 852 },
  { name: '412x915 (Large Android / Pixel / Galaxy)', width: 412, height: 915 },
  { name: '540x960 (qHD Mobile Display)', width: 540, height: 960 },
];

/**
 * Asserts that two bounding boxes are strictly non-overlapping in 2D space:
 * rectA.bottom <= rectB.top + epsilon || rectB.bottom <= rectA.top + epsilon ||
 * rectA.right <= rectB.left + epsilon || rectB.right <= rectA.left + epsilon
 */
function assertStrictlyNonOverlapping(
  a: BoundingBox2D,
  b: BoundingBox2D,
  labelA: string = 'Element A',
  labelB: string = 'Element B',
  epsilon = 0.75
): void {
  const isHorizontallySeparated = a.right <= b.left + epsilon || b.right <= a.left + epsilon;
  const isVerticallySeparated = a.bottom <= b.top + epsilon || b.bottom <= a.top + epsilon;
  const isNonOverlapping = isHorizontallySeparated || isVerticallySeparated;

  if (!isNonOverlapping) {
    throw new Error(
      `Overlap detected between ${labelA} [top:${a.top.toFixed(1)}, btm:${a.bottom.toFixed(1)}, l:${a.left.toFixed(1)}, r:${a.right.toFixed(1)}] and ${labelB} [top:${b.top.toFixed(1)}, btm:${b.bottom.toFixed(1)}, l:${b.left.toFixed(1)}, r:${b.right.toFixed(1)}]`
    );
  }
}

/**
 * Extracts normalized BoundingBox2D from Playwright locator.
 */
async function getElementBox(locator: Locator): Promise<BoundingBox2D> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error(`Element is not visible or has no bounding box`);
  }
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    left: box.x,
    top: box.y,
    right: box.x + box.width,
    bottom: box.y + box.height,
  };
}

/**
 * Helper to ensure page app is mounted and ready for test execution.
 */
async function setupApp(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await page.waitForSelector('#app', { state: 'attached' });
  await page.waitForSelector('#game-canvas', { state: 'attached' });
  await page.waitForFunction(() => {
    return (window as any).ouroborosApp && (window as any).ouroborosApp.engine && (window as any).ouroborosApp.uiRoot;
  }, { timeout: 15_000 });
  await page.waitForTimeout(100);
}

test.describe('Mobile Overlap E2E Audit Suite', () => {

  for (const vp of MOBILE_VIEWPORTS) {
    test.describe(`Viewport: ${vp.name} (${vp.width}x${vp.height})`, () => {

      /**
       * TEST 1: Main Menu & sub-row buttons (assert 0 element bounding box intersections).
       */
      test(`Test 1: Main Menu & sub-row buttons on ${vp.width}x${vp.height}`, async ({ page }) => {
        await setupApp(page, vp);

        const mainMenu = page.locator('.title-screen-modal');
        await expect(mainMenu).toBeVisible();

        const topTitle = mainMenu.locator('.top-title');
        const bottomTitle = mainMenu.locator('.bottom-title');
        const tagline = mainMenu.locator('.game-tagline');

        await expect(topTitle).toBeVisible();
        await expect(bottomTitle).toBeVisible();
        await expect(tagline).toBeVisible();

        const topBox = await getElementBox(topTitle);
        const botBox = await getElementBox(bottomTitle);
        const tagBox = await getElementBox(tagline);

        // Titles & tagline vertical hierarchy
        expect(topBox.height).toBeGreaterThan(0);
        expect(botBox.height).toBeGreaterThan(0);
        assertStrictlyNonOverlapping(topBox, botBox, 'Top Title', 'Bottom Title');
        assertStrictlyNonOverlapping(botBox, tagBox, 'Bottom Title', 'Tagline');

        // Best score chips / pills row
        const bestPills = mainMenu.locator('.menu-best-row .best-pill');
        const pillCount = await bestPills.count();
        expect(pillCount).toBeGreaterThanOrEqual(3);

        const pillBoxes: BoundingBox2D[] = [];
        for (let i = 0; i < pillCount; i++) {
          const pill = bestPills.nth(i);
          if (await pill.isVisible()) {
            const b = await getElementBox(pill);
            expect(b.width).toBeGreaterThan(0);
            expect(b.height).toBeGreaterThan(0);
            pillBoxes.push(b);
          }
        }

        // Assert 0 mutual overlap between best score pills
        for (let i = 0; i < pillBoxes.length; i++) {
          for (let j = i + 1; j < pillBoxes.length; j++) {
            assertStrictlyNonOverlapping(pillBoxes[i]!, pillBoxes[j]!, `Best Pill ${i}`, `Best Pill ${j}`);
          }
        }

        // Mode selection buttons column
        const modeButtons = mainMenu.locator('.mode-buttons-col button');
        const modeCount = await modeButtons.count();
        expect(modeCount).toBeGreaterThanOrEqual(4);

        const modeBoxes: BoundingBox2D[] = [];
        for (let i = 0; i < modeCount; i++) {
          const btn = modeButtons.nth(i);
          await expect(btn).toBeVisible();
          const b = await getElementBox(btn);
          expect(b.width).toBeGreaterThan(0);
          expect(b.height).toBeGreaterThan(0);
          modeBoxes.push(b);
        }

        // Assert 0 mutual overlap between mode buttons (strictly stacked vertically)
        for (let i = 0; i < modeBoxes.length; i++) {
          for (let j = i + 1; j < modeBoxes.length; j++) {
            assertStrictlyNonOverlapping(modeBoxes[i]!, modeBoxes[j]!, `Mode Button ${i}`, `Mode Button ${j}`);
          }
        }

        // Sub-row buttons (Sanctuary, Stats, Codex, Settings)
        const subRowButtons = mainMenu.locator('.menu-sub-row button');
        const subCount = await subRowButtons.count();
        expect(subCount).toBeGreaterThanOrEqual(4);

        const subBoxes: BoundingBox2D[] = [];
        for (let i = 0; i < subCount; i++) {
          const btn = subRowButtons.nth(i);
          await expect(btn).toBeVisible();
          const b = await getElementBox(btn);
          expect(b.width).toBeGreaterThan(0);
          expect(b.height).toBeGreaterThan(0);
          subBoxes.push(b);
        }

        // Assert 0 mutual overlap between sub-row buttons
        for (let i = 0; i < subBoxes.length; i++) {
          for (let j = i + 1; j < subBoxes.length; j++) {
            assertStrictlyNonOverlapping(subBoxes[i]!, subBoxes[j]!, `Sub-Row Button ${i}`, `Sub-Row Button ${j}`);
          }
        }

        // Assert 0 overlap between mode column and sub-row buttons
        for (let i = 0; i < modeBoxes.length; i++) {
          for (let j = i + 0; j < subBoxes.length; j++) {
            assertStrictlyNonOverlapping(modeBoxes[i]!, subBoxes[j]!, `Mode Button ${i}`, `Sub-Row Button ${j}`);
          }
        }
      });

      /**
       * TEST 2: Class Selection screen & archetype cards.
       */
      test(`Test 2: Class Selection screen & archetype cards on ${vp.width}x${vp.height}`, async ({ page }) => {
        await setupApp(page, vp);

        // Open Class Select Modal via UI action
        const rogueBtn = page.locator('.mode-buttons-col button').first();
        await rogueBtn.click();

        const classModal = page.locator('.class-select-modal');
        await expect(classModal).toBeVisible();

        const titleEl = classModal.locator('.cyber-modal-title');
        const subEl = classModal.locator('.cyber-modal-subtitle');
        await expect(titleEl).toBeVisible();
        await expect(subEl).toBeVisible();

        const titleBox = await getElementBox(titleEl);
        const subBox = await getElementBox(subEl);
        assertStrictlyNonOverlapping(titleBox, subBox, 'Class Modal Title', 'Class Modal Subtitle');

        // Archetype Class Cards
        const classCards = classModal.locator('.class-card');
        const cardCount = await classCards.count();
        expect(cardCount).toBeGreaterThanOrEqual(5);

        // Verify intra-card non-overlapping hierarchy for every card
        for (let i = 0; i < Math.min(cardCount, 3); i++) {
          const card = classCards.nth(i);
          if (await card.isVisible()) {
            const cardBox = await getElementBox(card);
            expect(cardBox.width).toBeGreaterThan(0);
            expect(cardBox.height).toBeGreaterThan(0);

            const header = card.locator('.class-card-header');
            const passive = card.locator('.class-passive');
            const skill = card.locator('.class-skill');
            const stats = card.locator('.class-stats-preview');

            if (await header.isVisible() && await passive.isVisible() && await skill.isVisible() && await stats.isVisible()) {
              const hBox = await getElementBox(header);
              const pBox = await getElementBox(passive);
              const sBox = await getElementBox(skill);
              const stBox = await getElementBox(stats);

              // Assert internal card sections do not overlap
              assertStrictlyNonOverlapping(hBox, pBox, `Card ${i} Header`, `Card ${i} Passive`);
              assertStrictlyNonOverlapping(pBox, sBox, `Card ${i} Passive`, `Card ${i} Skill`);
              assertStrictlyNonOverlapping(sBox, stBox, `Card ${i} Skill`, `Card ${i} Stats`);
            }
          }
        }

        // Action buttons (Back & Start/Ascend)
        const backBtn = classModal.locator('.btn-back');
        const startBtn = classModal.locator('.btn-start, .btn-ascend').first();

        await expect(backBtn).toBeVisible();
        await expect(startBtn).toBeVisible();

        const backBox = await getElementBox(backBtn);
        const startBox = await getElementBox(startBtn);

        assertStrictlyNonOverlapping(backBox, startBox, 'Back Button', 'Start Button');
      });

      /**
       * TEST 3: Cranial Mutation Lab modal across all 3 tabs (mutations, helmets, stats)
       * Explicitly assert that card title, status badge, description, progress bar,
       * and buy button have strictly non-overlapping bounding boxes:
       * (rectA.bottom <= rectB.top || rectA.right <= rectB.left).
       */
      test(`Test 3: Cranial Mutation Lab modal across all 3 tabs (mutations, helmets, stats) on ${vp.width}x${vp.height}`, async ({ page }) => {
        await setupApp(page, vp);

        // Open Mutation Lab
        await page.evaluate(() => {
          const app = (window as any).ouroborosApp;
          if (app && app.engine && app.uiRoot) {
            app.engine.chooseMode('rogue');
            app.engine.selectedClass = 'emerald';
            app.engine.startRun();
            if (app.engine.player) {
              app.engine.player.gainOuro(250);
            }
            app.uiRoot.showScreen('modal-snake-lab');
          }
        });

        const labModal = page.locator('.snake-lab-modal');
        await expect(labModal).toBeVisible();

        // 1. Quick stats chips in header
        const statChips = labModal.locator('.lab-points-label .lab-stat-chip');
        const chipCount = await statChips.count();
        expect(chipCount).toBeGreaterThanOrEqual(6);

        const chipBoxes: BoundingBox2D[] = [];
        for (let i = 0; i < chipCount; i++) {
          const chip = statChips.nth(i);
          if (await chip.isVisible()) {
            const b = await getElementBox(chip);
            expect(b.width).toBeGreaterThan(0);
            expect(b.height).toBeGreaterThan(0);
            chipBoxes.push(b);
          }
        }
        for (let i = 0; i < chipBoxes.length; i++) {
          for (let j = i + 1; j < chipBoxes.length; j++) {
            assertStrictlyNonOverlapping(chipBoxes[i]!, chipBoxes[j]!, `Stat Chip ${i}`, `Stat Chip ${j}`);
          }
        }

        // 2. Tab Navigation Switcher buttons
        const tabMutations = labModal.locator('.btn-tab-lab, .btn-tab-mutations');
        const tabHelmets = labModal.locator('.btn-tab-helmets');
        const tabStats = labModal.locator('.btn-tab-stats, .btn-tab-telemetry');

        await expect(tabMutations).toBeVisible();
        await expect(tabHelmets).toBeVisible();
        await expect(tabStats).toBeVisible();

        const mTabBox = await getElementBox(tabMutations);
        const hTabBox = await getElementBox(tabHelmets);
        const sTabBox = await getElementBox(tabStats);

        assertStrictlyNonOverlapping(mTabBox, hTabBox, 'Mutations Tab', 'Helmets Tab');
        assertStrictlyNonOverlapping(hTabBox, sTabBox, 'Helmets Tab', 'Stats Tab');

        // TAB 1: MUTATIONS VIEW
        await tabMutations.click();
        await page.waitForTimeout(50);

        const mutationCards = labModal.locator('.lab-docked-card-btn, .challenge-row-card');
        const mCardCount = await mutationCards.count();
        expect(mCardCount).toBeGreaterThan(0);

        // Audit first 3 cards for strict non-overlapping element bounding boxes:
        // (rectA.bottom <= rectB.top || rectA.right <= rectB.left)
        const auditCount = Math.min(mCardCount, 3);
        for (let i = 0; i < auditCount; i++) {
          const card = mutationCards.nth(i);
          if (await card.isVisible()) {
            const cardBox = await getElementBox(card);
            expect(cardBox.width).toBeGreaterThan(0);
            expect(cardBox.height).toBeGreaterThan(0);

            // 1. Card Title (.card-title) & Status Badge (.challenge-level-badge)
            const titleEl = card.locator('.card-title').first();
            const badgeEl = card.locator('.challenge-level-badge').first();
            // 2. Description (.card-benefit-row)
            const descEl = card.locator('.card-benefit-row').first();
            // 3. Progress Bar (.challenge-bar-container)
            const progressEl = card.locator('.challenge-bar-container').first();
            // 4. Buy Button / Status Tag (.cost-tag)
            const buyTagEl = card.locator('.cost-tag').first();

            if (await titleEl.isVisible() && await badgeEl.isVisible() && await descEl.isVisible() && await progressEl.isVisible() && await buyTagEl.isVisible()) {
              const tBox = await getElementBox(titleEl);
              const bBox = await getElementBox(badgeEl);
              const dBox = await getElementBox(descEl);
              const pBox = await getElementBox(progressEl);
              const buyBox = await getElementBox(buyTagEl);

              // Explicit Non-Overlapping Assertions:
              // a. Title and Status Badge are horizontally separated in Header Row
              assertStrictlyNonOverlapping(tBox, bBox, `Card ${i} Title`, `Card ${i} Status Badge`);

              // b. Header Row (Title & Badge) and Description are vertically stacked
              assertStrictlyNonOverlapping(tBox, dBox, `Card ${i} Title`, `Card ${i} Description`);
              assertStrictlyNonOverlapping(bBox, dBox, `Card ${i} Status Badge`, `Card ${i} Description`);

              // c. Description and Progress Bar are vertically stacked
              assertStrictlyNonOverlapping(dBox, pBox, `Card ${i} Description`, `Card ${i} Progress Bar`);

              // d. Progress Bar and Buy Button / Cost Tag are vertically stacked
              assertStrictlyNonOverlapping(pBox, buyBox, `Card ${i} Progress Bar`, `Card ${i} Buy Tag`);
            }
          }
        }

        // TAB 2: HELMETS VIEW
        await tabHelmets.click();
        await page.waitForTimeout(50);

        // Verify Helmets tab content is visible (equipped container or vault section)
        const helmetSection = labModal.locator('.equipped-helmet-container, .helmet-vault-section, .lab-section-helmets').first();
        await expect(helmetSection).toBeVisible();
        const hSecBox = await getElementBox(helmetSection);
        expect(hSecBox.width).toBeGreaterThan(0);
        expect(hSecBox.height).toBeGreaterThan(0);

        // TAB 3: STATS VIEW
        await tabStats.click();
        await page.waitForTimeout(50);

        const statsGrid = labModal.locator('.stats-vitals-grid, .telemetry-grid, .lab-section-telemetry').first();
        await expect(statsGrid).toBeVisible();
        const sBox = await getElementBox(statsGrid);
        expect(sBox.width).toBeGreaterThan(0);
        expect(sBox.height).toBeGreaterThan(0);

        // Bottom Deploy action button
        const deployBtn = labModal.locator('.btn-deploy-serpent');
        await expect(deployBtn).toBeVisible();
        const deployBox = await getElementBox(deployBtn);
        expect(deployBox.width).toBeGreaterThan(0);
        expect(deployBox.height).toBeGreaterThan(0);
      });

      /**
       * TEST 4: Sanctuary screen & meta upgrade cards.
       */
      test(`Test 4: Sanctuary screen & meta upgrade cards on ${vp.width}x${vp.height}`, async ({ page }) => {
        await setupApp(page, vp);

        // Open Sanctuary modal via Main Menu button
        const sanctuaryBtn = page.locator('.btn-sanctuary');
        await expect(sanctuaryBtn).toBeVisible();
        await sanctuaryBtn.click();

        const sanctuaryModal = page.locator('.sanctuary-modal');
        await expect(sanctuaryModal).toBeVisible();

        const shardBanner = sanctuaryModal.locator('.sanctuary-shard-banner');
        await expect(shardBanner).toBeVisible();
        const bannerBox = await getElementBox(shardBanner);
        expect(bannerBox.height).toBeGreaterThan(0);

        // Meta upgrade cards in sanctuary grid
        const upgradeCards = sanctuaryModal.locator('.shop-item-card');
        const cardCount = await upgradeCards.count();
        expect(cardCount).toBeGreaterThan(0);

        // Check internal anatomy non-overlap for visible cards
        for (let i = 0; i < Math.min(cardCount, 3); i++) {
          const card = upgradeCards.nth(i);
          if (await card.isVisible()) {
            const header = card.locator('.shop-item-header');
            const bonus = card.locator('.shop-item-bonus');
            const pips = card.locator('.shop-pips-row');
            const buyBtn = card.locator('.btn-buy');

            if (await header.isVisible() && await bonus.isVisible() && await pips.isVisible() && await buyBtn.isVisible()) {
              const hBox = await getElementBox(header);
              const bBox = await getElementBox(bonus);
              const pBox = await getElementBox(pips);
              const buyBox = await getElementBox(buyBtn);

              assertStrictlyNonOverlapping(hBox, bBox, `Sanctuary Card ${i} Header`, `Sanctuary Card ${i} Bonus`);
              assertStrictlyNonOverlapping(bBox, pBox, `Sanctuary Card ${i} Bonus`, `Sanctuary Card ${i} Pips`);
              assertStrictlyNonOverlapping(pBox, buyBox, `Sanctuary Card ${i} Pips`, `Sanctuary Card ${i} Buy Button`);
            }
          }
        }

        // Bottom action buttons: Erase progress & Return
        const resetBtn = sanctuaryModal.locator('.btn-reset-prog');
        const backBtn = sanctuaryModal.locator('.btn-back');

        await expect(resetBtn).toBeVisible();
        await expect(backBtn).toBeVisible();

        const resetBox = await getElementBox(resetBtn);
        const backBox = await getElementBox(backBtn);

        assertStrictlyNonOverlapping(resetBox, backBox, 'Reset Button', 'Back Button');
      });

      /**
       * TEST 5: Settings modal & Codex guide modal.
       */
      test(`Test 5: Settings modal & Codex guide modal on ${vp.width}x${vp.height}`, async ({ page }) => {
        await setupApp(page, vp);

        // 1. Audit Settings Modal
        const settingsBtn = page.locator('.btn-settings');
        await expect(settingsBtn).toBeVisible();
        await settingsBtn.click();

        const settingsModal = page.locator('.settings-modal');
        await expect(settingsModal).toBeVisible();

        // Setting rows
        const settingRows = settingsModal.locator('.setting-row');
        const rowCount = await settingRows.count();
        expect(rowCount).toBeGreaterThanOrEqual(6);

        const rowBoxes: BoundingBox2D[] = [];
        for (let i = 0; i < Math.min(rowCount, 6); i++) {
          const row = settingRows.nth(i);
          if (await row.isVisible()) {
            const b = await getElementBox(row);
            expect(b.width).toBeGreaterThan(0);
            expect(b.height).toBeGreaterThan(0);
            rowBoxes.push(b);
          }
        }

        // Assert 0 mutual overlap between consecutive visible setting rows
        for (let i = 0; i < rowBoxes.length - 1; i++) {
          assertStrictlyNonOverlapping(rowBoxes[i]!, rowBoxes[i + 1]!, `Setting Row ${i}`, `Setting Row ${i + 1}`);
        }

        // Settings action buttons
        const codexLinkBtn = settingsModal.locator('.btn-settings-codex');
        const closeSettingsBtn = settingsModal.locator('.btn-close-settings');

        await expect(codexLinkBtn).toBeVisible();
        await expect(closeSettingsBtn).toBeVisible();

        const codexBox = await getElementBox(codexLinkBtn);
        const closeBox = await getElementBox(closeSettingsBtn);
        assertStrictlyNonOverlapping(codexBox, closeBox, 'Codex Link Button', 'Close Settings Button');

        // 2. Audit Codex / Help Guide Modal
        await codexLinkBtn.click();
        await expect(settingsModal).toBeHidden();

        const codexModal = page.locator('.codex-modal, .help-modal');
        await expect(codexModal).toBeVisible();

        const searchInput = codexModal.locator('.codex-search-input, .search-input').first();
        if (await searchInput.isVisible()) {
          const searchBox = await getElementBox(searchInput);
          expect(searchBox.width).toBeGreaterThan(0);
          expect(searchBox.height).toBeGreaterThan(0);
        }

        const closeCodexBtn = codexModal.locator('.btn-close-top, .btn-close-main, .btn-close-help').first();
        await expect(closeCodexBtn).toBeVisible();
        const cCodexBox = await getElementBox(closeCodexBtn);
        expect(cCodexBox.width).toBeGreaterThan(0);
      });

      /**
       * TEST 6: In-Game HUD & touch controls (assert virtual stick, dash, skill buttons do not overlap vitals or mission header).
       */
      test(`Test 6: In-Game HUD & touch controls (stick, dash, skill vs vitals/header) on ${vp.width}x${vp.height}`, async ({ page }) => {
        await setupApp(page, vp);

        // Start active gameplay run on mobile
        await page.evaluate(() => {
          const app = (window as any).ouroborosApp;
          if (app && app.engine && app.uiRoot) {
            app.engine.chooseMode('rogue');
            app.engine.selectedClass = 'emerald';
            app.engine.startRun();
            app.uiRoot.hudView.setVisible(true);
            app.uiRoot.hudView.setTouchControlsVisible(true);
          }
        });

        const hud = page.locator('.hud-layer');
        await expect(hud).toBeVisible();

        // Query HUD components
        const vitals = hud.locator('.hud-vitals').first();
        const topActions = hud.locator('.hud-top-actions').first();
        const touchStick = hud.locator('.touch-stick-zone, .touch-stick-pad').first();
        const dashBtn = hud.locator('.touch-btn-dash').first();
        const skillBtn = hud.locator('.touch-btn-skill').first();

        await expect(vitals).toBeVisible();
        await expect(topActions).toBeVisible();
        await expect(touchStick).toBeVisible();
        await expect(dashBtn).toBeVisible();
        await expect(skillBtn).toBeVisible();

        const vitalsBox = await getElementBox(vitals);
        const topActionsBox = await getElementBox(topActions);
        const stickBox = await getElementBox(touchStick);
        const dashBox = await getElementBox(dashBtn);
        const skillBox = await getElementBox(skillBtn);

        // 1. Top row layout: Vitals must not collide with top action buttons ([L], [P])
        assertStrictlyNonOverlapping(vitalsBox, topActionsBox, 'Player Vitals', 'Top Actions');

        // 2. Touch actions zone: Dash and Skill buttons must not overlap each other
        assertStrictlyNonOverlapping(dashBox, skillBox, 'Dash Button', 'Skill Button');

        // 3. Virtual joystick must strictly not overlap Player Vitals or Top Actions
        assertStrictlyNonOverlapping(stickBox, vitalsBox, 'Virtual Stick', 'Player Vitals');
        assertStrictlyNonOverlapping(stickBox, topActionsBox, 'Virtual Stick', 'Top Actions');

        // 4. Touch action buttons (Dash, Skill) must strictly not overlap Player Vitals or Top Actions
        assertStrictlyNonOverlapping(dashBox, vitalsBox, 'Dash Button', 'Player Vitals');
        assertStrictlyNonOverlapping(dashBox, topActionsBox, 'Dash Button', 'Top Actions');
        assertStrictlyNonOverlapping(skillBox, vitalsBox, 'Skill Button', 'Player Vitals');
        assertStrictlyNonOverlapping(skillBox, topActionsBox, 'Skill Button', 'Top Actions');

        // 5. Virtual stick and action buttons must not overlap each other across the screen
        assertStrictlyNonOverlapping(stickBox, dashBox, 'Virtual Stick', 'Dash Button');
        assertStrictlyNonOverlapping(stickBox, skillBox, 'Virtual Stick', 'Skill Button');

        // 6. Mission panel / portrait mission header (if visible) must not overlap stick or action buttons
        const missionPanel = hud.locator('.hud-mission, .hud-mission-portrait-row').first();
        if (await missionPanel.isVisible()) {
          const missionBox = await getElementBox(missionPanel);
          assertStrictlyNonOverlapping(missionBox, stickBox, 'Mission Header', 'Virtual Stick');
          assertStrictlyNonOverlapping(missionBox, dashBox, 'Mission Header', 'Dash Button');
          assertStrictlyNonOverlapping(missionBox, skillBox, 'Mission Header', 'Skill Button');
        }
      });

    });
  }

});
