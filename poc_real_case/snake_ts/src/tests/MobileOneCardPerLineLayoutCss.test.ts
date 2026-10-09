import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Mobile 1-Card-Per-Line Responsive Layout CSS Conformance Suite', () => {
  const indexHtmlPath = path.resolve(__dirname, '../../index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

  it('1. verifies desktop/tablet (> 680px) 2-column grid for .lab-card-grid, .challenge-tracker-list, and .helmet-grid', () => {
    // Check that .lab-card-grid, .challenge-tracker-list, and .helmet-grid are declared with 2-column repeat(2, minmax(0, 1fr))
    const desktopGridRegex = /(?:\.lab-card-grid|\.challenge-tracker-list|\.helmet-grid)[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/;
    expect(indexHtml).toMatch(desktopGridRegex);

    // Verify .lab-card-grid and .helmet-grid classes are present in the CSS
    expect(indexHtml).toContain('.lab-card-grid');
    expect(indexHtml).toContain('.challenge-tracker-list');
    expect(indexHtml).toContain('.helmet-grid');
  });

  it('2. verifies mobile media query (max-width: 680px) forces 1-card-per-line 1fr layout', () => {
    // Check for @media (max-width: 680px) block containing 1-column grid rule
    const media680Regex = /@media\s*\([^)]*max-width:\s*680px[^)]*\)[\s\S]*?(?:\.lab-card-grid|\.challenge-tracker-list|\.helmet-grid)[\s\S]*?grid-template-columns:\s*1fr\s*!important/;
    expect(indexHtml).toMatch(media680Regex);
  });

  it('3. verifies .tier-phone selectors force 1-card-per-line 1fr layout for .lab-card-grid and .challenge-tracker-list', () => {
    // Check for .tier-phone selectors for lab card grid and challenge tracker
    const tierPhoneRegex = /(?:\.tier-phone\s+\.lab-card-grid|\.tier-phone\s+\.challenge-tracker-list|\.tier-phone\s+\.helmet-grid)[\s\S]*?grid-template-columns:\s*1fr\s*!important/;
    expect(indexHtml).toMatch(tierPhoneRegex);
  });

  it('4. verifies mobile 1-column cards have 100% width, generous spacing, high contrast, and zero horizontal overflow', () => {
    // Check that cards have 100% width and box-sizing
    expect(indexHtml).toMatch(/\.lab-docked-card[\s\S]*?width:\s*100%\s*!important/);
    expect(indexHtml).toMatch(/\.challenge-row-card[\s\S]*?width:\s*100%\s*!important/);

    // Check containers prevent horizontal overflow
    expect(indexHtml).toMatch(/\.lab-scroll-container[\s\S]*?overflow-x:\s*hidden/);

    // Check progress bar and status elements have proper sizing and contrast
    expect(indexHtml).toContain('.challenge-progress-bar-wrap');
    expect(indexHtml).toContain('.challenge-pct-badge');
    expect(indexHtml).toContain('.btn-buy-module');
  });
});
