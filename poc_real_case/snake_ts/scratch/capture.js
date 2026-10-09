import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function captureMode(mode) {
  const outDir = path.join(__dirname, 'screenshots', mode);
  fs.mkdirSync(outDir, { recursive: true });

  const artifactDir = `/home/forart/.gemini/antigravity-cli/brain/dddd09ca-3622-449c-b9a4-9e74c45b19f9/screenshots/${mode}`;
  fs.mkdirSync(artifactDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl', '--ignore-gpu-blocklist']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1
  });

  const page = await context.newPage();
  page.on('console', msg => console.log(`[PAGE LOG ${mode}]`, msg.text()));
  page.on('pageerror', err => console.error(`[PAGE ERROR ${mode}]`, err.message));

  const renderParam = mode === 'webgl' ? '&gl=true' : '&canvas2d=true';

  const screens = [
    { name: '01_title', url: `http://localhost:3001/?screen=title${renderParam}` },
    { name: '02_class', url: `http://localhost:3001/?screen=class${renderParam}` },
    { name: '03_combat', url: `http://localhost:3001/?screen=combat${renderParam}`, isCombat: true },
    { name: '04_sanctuary', url: `http://localhost:3001/?screen=sanctuary${renderParam}` },
    { name: '05_lab', url: `http://localhost:3001/?screen=lab${renderParam}` }
  ];

  for (const s of screens) {
    console.log(`\nCapturing [${mode}] ${s.name} from ${s.url}...`);
    await page.goto(s.url);
    await page.waitForTimeout(1000);

    if (s.isCombat) {
      // Enhance combat scene: ensure active snake body segments, food variety, and spawned enemies
      await page.evaluate(() => {
        const engine = window.ouroborosApp?.engine;
        if (engine && engine.player) {
          // Add 8 segments to player so continuous ribbon is fully visible
          engine.player.addGrowth(8);
          // Spawn enemies of distinct archetypes
          engine.spawnEnemy('spitter');
          engine.spawnEnemy('drone');
          engine.spawnEnemy('swarmling');
        }
      });
      // Let simulation run for 800ms so entities steer and animate
      await page.waitForTimeout(800);
    }

    const filePath = path.join(outDir, `${s.name}.png`);
    await page.screenshot({ path: filePath, timeout: 10000 });
    fs.copyFileSync(filePath, path.join(artifactDir, `${s.name}.png`));
    console.log(`Saved: ${filePath} & copied to artifact dir`);

    // For combat, also capture a boss encounter
    if (s.isCombat) {
      await page.evaluate(() => {
        const engine = window.ouroborosApp?.engine;
        if (engine) {
          engine.spawnBoss('ouroboros_prime');
        }
      });
      await page.waitForTimeout(800);
      const bossPath = path.join(outDir, '03_combat_boss.png');
      await page.screenshot({ path: bossPath, timeout: 10000 });
      fs.copyFileSync(bossPath, path.join(artifactDir, '03_combat_boss.png'));
      console.log(`Saved: ${bossPath} & copied to artifact dir`);
    }
  }

  await browser.close();
  console.log(`Finished capturing all ${mode} screens successfully!`);
}

async function main() {
  const targetMode = process.argv[2];
  if (targetMode === 'all') {
    console.log('--- CAPTURING CANVAS2D ---');
    await captureMode('canvas2d');
    console.log('\n--- CAPTURING WEBGL ---');
    await captureMode('webgl');
  } else {
    await captureMode(targetMode || 'canvas2d');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
