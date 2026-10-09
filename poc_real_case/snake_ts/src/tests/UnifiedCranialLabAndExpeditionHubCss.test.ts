import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Unified Cranial Mutation Lab & Expedition Hub CSS Conformance Suite', () => {
  const indexHtmlPath = path.resolve(__dirname, '../../index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

  it('1. verifies tab group styling with glowing active state in index.html', () => {
    // Check tab container rules
    expect(indexHtml).toMatch(/\.lab-tab-group|\.stats-tab-bar|\.stats-tab-group/);

    // Active tab glowing state
    expect(indexHtml).toContain('rgba(0, 240, 181, 0.45)');
    expect(indexHtml).toMatch(/\.lab-tab-group\s+\.cyber-btn\.btn-primary|\.stats-tab-bar\s+\.cyber-btn\.btn-primary|\.stats-tab-group\s+\.cyber-btn\.btn-primary/);

    // Inactive tab state and hover
    expect(indexHtml).toMatch(/\.lab-tab-group\s+\.cyber-btn\.btn-secondary|\.stats-tab-bar\s+\.cyber-btn\.btn-secondary|\.stats-tab-group\s+\.cyber-btn\.btn-secondary/);
  });

  it('2. verifies challenge cards grid: 2-column on desktop/tablet, 1-column on mobile in index.html', () => {
    // Challenge tracker list 2-column desktop grid
    expect(indexHtml).toMatch(/\.challenge-tracker-list[\s\S]*?grid-template-columns:\s*repeat\(2,\s*(?:minmax\(0,\s*1fr\)|1fr)\)/);

    // Challenge tracker list 1-column mobile breakpoint
    const mobileMediaSection = indexHtml.slice(indexHtml.indexOf('@media (max-width: 768px)'));
    expect(mobileMediaSection).toMatch(/\.challenge-tracker-list[\s\S]*?grid-template-columns:\s*1fr/);

    // Challenge row card styling
    expect(indexHtml).toContain('.challenge-row-card');
    expect(indexHtml).toContain('.challenge-row-card.unlocked');
    expect(indexHtml).toContain('.challenge-row-card.locked');
  });

  it('3. verifies challenge progress bars with cyber-cyan/amber glowing gradients and percentage chips', () => {
    // Challenge progress bar container
    expect(indexHtml).toContain('.challenge-progress-bar');
    expect(indexHtml).toMatch(/\.challenge-progress-bar[\s\S]*?border-radius/);

    // Amber-to-cyan glowing gradient for in-progress / default
    expect(indexHtml).toMatch(/linear-gradient\(90deg,\s*#f59e0b,\s*#ffd166,\s*#00f0b5\)/);

    // Cyan glowing gradient for unlocked state
    expect(indexHtml).toMatch(/linear-gradient\(90deg,\s*#00a880,\s*#00f0b5\)/);

    // Percentage status chips
    expect(indexHtml).toContain('.challenge-status');
    expect(indexHtml).toContain('.challenge-status.in-progress');
    expect(indexHtml).toContain('.challenge-status.completed');
  });

  it('4. verifies telemetry breakdown cards (bestiary tiles, food item pills, module chips) in index.html', () => {
    // Compact bestiary tiles
    expect(indexHtml).toContain('.bestiary-grid');
    expect(indexHtml).toContain('.bestiary-pill');

    // Food item pill badges
    expect(indexHtml).toContain('.food-breakdown-grid');
    expect(indexHtml).toContain('.food-pill');

    // Boss defeats list & installed module chips
    expect(indexHtml).toContain('.boss-defeats-list');
    expect(indexHtml).toContain('.installed-modules-list');
    expect(indexHtml).toContain('.module-chip');
  });

  it('5. verifies responsive scrolling with zero horizontal overflow constraints for mobile viewports (393px, 540px)', () => {
    // Viewport and panel overflow constraints
    expect(indexHtml).toMatch(/\.stats-panel[\s\S]*?max-width/);
    expect(indexHtml).toMatch(/\.stats-scroll-container[\s\S]*?overflow-y:\s*auto/);
    expect(indexHtml).toMatch(/\.lab-scroll-container[\s\S]*?overflow-y:\s*auto/);

    // Mobile media queries handling responsive grid columns
    const mobileMediaSection = indexHtml.slice(indexHtml.indexOf('@media (max-width: 768px)'));
    expect(mobileMediaSection).toContain('.food-breakdown-grid');
    expect(mobileMediaSection).toContain('.bestiary-grid');
  });
});
