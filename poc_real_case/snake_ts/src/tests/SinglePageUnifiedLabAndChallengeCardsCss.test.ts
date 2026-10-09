import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Single-Page Unified Lab, Challenge Cards & Telemetry CSS Conformance Suite', () => {
  const indexHtmlPath = path.resolve(__dirname, '../../index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

  it('1. verifies .lab-docked-card container styling with sleek cybernetic border, status header, and stat summary', () => {
    // Check .lab-docked-card container rule
    expect(indexHtml).toContain('.lab-docked-card');
    expect(indexHtml).toMatch(/\.lab-docked-card\s*\{[\s\S]*?border:/);
    expect(indexHtml).toMatch(/\.lab-docked-card\s*\{[\s\S]*?background:/);

    // Status header & stat summary inside docked card
    expect(indexHtml).toMatch(/\.lab-docked-card\s+\.card-status-header|\.card-status-header/);
    expect(indexHtml).toMatch(/\.lab-docked-card\s+\.card-stat-summary|\.card-stat-summary/);
  });

  it('2. verifies in-card .challenge-progress-bar-wrap with dual-glowing gradient, percentage badge, and target label', () => {
    // In-card challenge progress bar wrap
    expect(indexHtml).toContain('.challenge-progress-bar-wrap');
    expect(indexHtml).toMatch(/\.challenge-progress-bar-wrap[\s\S]*?border-radius/);

    // Dual-glowing gradient (#f59e0b -> #ffd166 -> #00f0b5)
    expect(indexHtml).toMatch(/linear-gradient\(90deg,\s*#f59e0b,\s*#ffd166,\s*#00f0b5\)/);

    // Percentage badge right inside the upgrade card
    expect(indexHtml).toContain('.challenge-pct-badge');

    // Target label right inside the upgrade card
    expect(indexHtml).toContain('.challenge-target-label');
  });

  it('3. verifies .btn-buy-module action button embedded inside the card when unlocked', () => {
    // Embedded action button
    expect(indexHtml).toContain('.btn-buy-module');
    expect(indexHtml).toMatch(/\.btn-buy-module\s*\{[\s\S]*?background:/);
    expect(indexHtml).toMatch(/\.btn-buy-module:hover|\.btn-buy-module\.btn-affordable/);
  });

  it('4. verifies card state classes: .card-locked (amber/obsidian), .card-unlocked (cyan glow), .card-max (radiant gold)', () => {
    // Locked card state: amber/obsidian styling
    expect(indexHtml).toContain('.card-locked');
    expect(indexHtml).toMatch(/\.card-locked[\s\S]*?(?:#f59e0b|#fbbf24|rgba\(245,\s*158,\s*11|rgba\(251,\s*191,\s*36)/);

    // Unlocked card state: cyber-cyan glowing accent
    expect(indexHtml).toContain('.card-unlocked');
    expect(indexHtml).toMatch(/\.card-unlocked[\s\S]*?(?:var\(--cyan\)|#00f0b5|rgba\(0,\s*240,\s*181)/);

    // Max level card state: radiant golden accent
    expect(indexHtml).toContain('.card-max');
    expect(indexHtml).toMatch(/\.card-max[\s\S]*?(?:var\(--gold|var\(--gold-soft|#ffd166|#ffb703|rgba\(255,\s*209,\s*102)/);
  });

  it('5. verifies top telemetry section with compact vitals grid and collapsible food/bestiary pills', () => {
    // Compact vitals grid
    expect(indexHtml).toMatch(/\.stats-vitals-grid|\.lab-telemetry-vitals|\.vitals-grid/);

    // Food and bestiary pills
    expect(indexHtml).toContain('.food-breakdown-grid');
    expect(indexHtml).toContain('.bestiary-grid');
    expect(indexHtml).toContain('.food-pill');
    expect(indexHtml).toContain('.bestiary-pill');

    // Telemetry collapsible styling
    expect(indexHtml).toMatch(/\.telemetry-collapsible|\.collapsible-pill-section|\.food-breakdown-grid/);
  });

  it('6. verifies full mobile and desktop responsive layout with zero horizontal overflow constraints', () => {
    // Zero horizontal overflow
    expect(indexHtml).toMatch(/\.lab-docked-card-container[\s\S]*?overflow-x:\s*hidden/);
    expect(indexHtml).toMatch(/\.lab-docked-card[\s\S]*?box-sizing:\s*border-box/);

    // Responsive media queries
    const mobileSection = indexHtml.slice(indexHtml.indexOf('@media (max-width: 768px)'));
    expect(mobileSection).toMatch(/\.lab-docked-card|\.cards-deck-grid|\.challenge-tracker-list/);
  });
});
