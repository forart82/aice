import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Mobile Zero Overlap CSS Audit & Styling Conformance Suite', () => {
  const indexHtmlPath = path.resolve(__dirname, '../../index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

  // =========================================================================
  // 1. Card Blocks Architecture (.lab-docked-card, .card-status-header, etc.)
  // =========================================================================
  it('1. verifies .lab-docked-card, .card-challenge-wrap, and .card-buy-row enforce column flex, 100% width, border-box, and overflow hidden', () => {
    // Check .lab-docked-card rules
    expect(indexHtml).toMatch(/\.lab-docked-card[\s\S]*?flex-direction:\s*column/);
    expect(indexHtml).toMatch(/\.lab-docked-card[\s\S]*?width:\s*100%/);
    expect(indexHtml).toMatch(/\.lab-docked-card[\s\S]*?box-sizing:\s*border-box/);
    expect(indexHtml).toMatch(/\.lab-docked-card[\s\S]*?overflow:\s*hidden/);

    // Check .card-challenge-wrap
    expect(indexHtml).toContain('.card-challenge-wrap');
    expect(indexHtml).toMatch(/\.card-challenge-wrap[\s\S]*?flex-direction:\s*column/);
    expect(indexHtml).toMatch(/\.card-challenge-wrap[\s\S]*?width:\s*100%/);
    expect(indexHtml).toMatch(/\.card-challenge-wrap[\s\S]*?box-sizing:\s*border-box/);

    // Check .card-buy-row
    expect(indexHtml).toContain('.card-buy-row');
    expect(indexHtml).toMatch(/\.card-buy-row[\s\S]*?flex-direction:\s*column/);
    expect(indexHtml).toMatch(/\.card-buy-row[\s\S]*?width:\s*100%/);
    expect(indexHtml).toMatch(/\.card-buy-row[\s\S]*?box-sizing:\s*border-box/);
  });

  it('2. verifies .card-status-header and .card-stat-summary avoid cramped text collision and enforce wrapping', () => {
    // .card-status-header must support flex-wrap and 100% width
    expect(indexHtml).toMatch(/\.card-status-header[\s\S]*?flex-wrap:\s*wrap/);
    expect(indexHtml).toMatch(/\.card-status-header[\s\S]*?width:\s*100%/);

    // .card-stat-summary must wrap words
    expect(indexHtml).toMatch(/\.card-stat-summary[\s\S]*?word-break:\s*break-word/);
    expect(indexHtml).toMatch(/\.card-stat-summary[\s\S]*?overflow-wrap:\s*break-word/);
  });

  // =========================================================================
  // 2. Global Mobile Rules: Modal Panels (95vw, 10px padding, overflow-x hidden)
  // =========================================================================
  it('3. verifies modal panels on mobile (@media max-width: 680px and .tier-phone) have 95vw width, 10px padding, and zero horizontal overflow', () => {
    // Media query (max-width: 680px)
    const media680Section = indexHtml.slice(indexHtml.indexOf('@media (max-width: 680px)'));
    expect(media680Section).toMatch(/\.modal-panel|\.lab-panel|\.stats-panel|\.sanctuary-panel|\.settings-panel|\.codex-panel/);
    expect(media680Section).toMatch(/width:\s*95vw/);
    expect(media680Section).toMatch(/max-width:\s*95vw/);
    expect(media680Section).toMatch(/padding:\s*10px/);
    expect(media680Section).toMatch(/overflow-x:\s*hidden/);

    // Tier phone rules
    const tierPhoneSection = indexHtml.slice(indexHtml.indexOf('.tier-phone .modal-panel'));
    expect(tierPhoneSection).toMatch(/width:\s*95vw/);
    expect(tierPhoneSection).toMatch(/max-width:\s*95vw/);
    expect(tierPhoneSection).toMatch(/padding:\s*10px/);
    expect(tierPhoneSection).toMatch(/overflow-x:\s*hidden/);
  });

  // =========================================================================
  // 3. Global Mobile Rules: Grid Containers (1fr !important, 100% width)
  // =========================================================================
  it('4. verifies grid containers on mobile force 1fr 1-column layout and 100% width', () => {
    const media680Section = indexHtml.slice(indexHtml.indexOf('@media (max-width: 680px)'));
    expect(media680Section).toMatch(/grid-template-columns:\s*1fr\s*!important/);
    expect(media680Section).toMatch(/width:\s*100%/);

    // Verify grid container selectors exist in mobile rules
    expect(media680Section).toContain('.lab-card-grid');
    expect(media680Section).toContain('.sanctuary-grid');
    expect(media680Section).toContain('.cards-deck-grid');
  });

  // =========================================================================
  // 4. Global Mobile Rules: Text Elements (word-break & overflow-wrap)
  // =========================================================================
  it('5. verifies text elements enforce word-break: break-word and overflow-wrap: break-word on mobile', () => {
    const media680Section = indexHtml.slice(indexHtml.indexOf('@media (max-width: 680px)'));
    expect(media680Section).toMatch(/word-break:\s*break-word/);
    expect(media680Section).toMatch(/overflow-wrap:\s*break-word/);
  });

  // =========================================================================
  // 5. Global Mobile Rules: Buttons (min-height: 40px, touch-action: manipulation)
  // =========================================================================
  it('6. verifies buttons on mobile enforce min-height: 40px, touch-action: manipulation, and box-sizing: border-box', () => {
    const media680Section = indexHtml.slice(indexHtml.indexOf('@media (max-width: 680px)'));
    expect(media680Section).toMatch(/min-height:\s*40px/);
    expect(media680Section).toMatch(/touch-action:\s*manipulation/);
    expect(media680Section).toMatch(/box-sizing:\s*border-box/);
  });
});
