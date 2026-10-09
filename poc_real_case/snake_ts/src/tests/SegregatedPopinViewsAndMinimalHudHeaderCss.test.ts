import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Segregated Popin Views & Minimal HUD Header CSS Conformance Suite', () => {
  const indexHtmlPath = path.resolve(__dirname, '../../index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

  // =========================================================================
  // 1. Popin Tab Views: Active Tab Glows for Mutations, Helmets & Statistics
  // =========================================================================
  it('1. verifies active tab glow for 🧬 Mutations, 🪖 Helmets, and 📊 Statistics', () => {
    // Check Mutations active tab glow rule
    expect(indexHtml).toMatch(
      /\.btn-tab-lab\.btn-primary|\.btn-tab-mutations\.btn-primary/
    );
    expect(indexHtml).toMatch(
      /(?:\.btn-tab-lab|\.btn-tab-mutations)[\s\S]*?(?:rgba\(0,\s*240,\s*181|#00f0b5)/
    );

    // Check Helmets active tab glow rule
    expect(indexHtml).toMatch(
      /\.btn-tab-helmets\.btn-primary|\.btn-tab-helmets\.active/
    );
    expect(indexHtml).toMatch(
      /\.btn-tab-helmets[\s\S]*?(?:rgba\(192,\s*132,\s*252|rgba\(157,\s*78,\s*221|#c084fc|#9d4edd)/
    );

    // Check Statistics active tab glow rule
    expect(indexHtml).toMatch(
      /\.btn-tab-stats\.btn-primary|\.btn-tab-statistics\.btn-primary|\.btn-tab-telemetry\.btn-primary/
    );
    expect(indexHtml).toMatch(
      /(?:\.btn-tab-stats|\.btn-tab-statistics|\.btn-tab-telemetry)[\s\S]*?(?:rgba\(56,\s*189,\s*248|rgba\(58,\s*134,\s*255|#38bdf8|#3a86ff)/
    );
  });

  // =========================================================================
  // 2. Smooth View Transitions Between the Popin Views
  // =========================================================================
  it('2. verifies smooth view transition animations and keyframes between the 3 views', () => {
    // Keyframe definition for smooth view fading & sliding
    expect(indexHtml).toMatch(/@keyframes\s+viewFadeIn/);
    expect(indexHtml).toMatch(/viewFadeIn[\s\S]*?opacity:\s*0[\s\S]*?transform:/);

    // View transition classes attached to sections / panels
    expect(indexHtml).toMatch(
      /\.lab-section[\s\S]*?animation:\s*viewFadeIn|\.stats-content-area[\s\S]*?animation:\s*viewFadeIn|\.lab-section-telemetry[\s\S]*?animation:/
    );
  });

  // =========================================================================
  // 3. High-Contrast, Clean Layout for Each View
  // =========================================================================
  it('3. verifies high-contrast, clean layout for each segregated popin view', () => {
    // Glassmorphic high-contrast obsidian panel styling
    expect(indexHtml).toMatch(/\.lab-panel[\s\S]*?background:\s*rgba\(8,\s*14,\s*28/);
    expect(indexHtml).toMatch(/\.lab-panel[\s\S]*?border:\s*1px solid rgba\(0,\s*240,\s*181/);

    // High contrast segregated section headers and divider lines
    expect(indexHtml).toMatch(/\.lab-section|\.lab-docked-card|\.stat-card/);
    expect(indexHtml).toMatch(/\.stat-card[\s\S]*?background:/);
    expect(indexHtml).toMatch(/\.stat-card[\s\S]*?border:/);
  });

  // =========================================================================
  // 4. Streamlined HUD Header: Only [L] (Lab) and [P] (Pause) in Top-Right Actions
  // =========================================================================
  it('4. verifies top-right actions row contains only [L] (Lab) and [P] (Pause) by hiding non-essential HUD buttons', () => {
    // Check that auxiliary buttons (.btn-codex, .btn-stats, .hud-fps-wrap) are hidden via CSS in .hud-top-actions
    expect(indexHtml).toMatch(
      /\.hud-top-actions\s+\.btn-codex[\s\S]*?display:\s*none\s*!important/
    );
    expect(indexHtml).toMatch(
      /\.hud-top-actions\s+\.btn-stats[\s\S]*?display:\s*none\s*!important/
    );

    // Check that .btn-lab and .btn-pause remain visible and styled
    expect(indexHtml).toMatch(
      /\.hud-top-actions\s+\.btn-lab[\s\S]*?display:\s*(?:inline-flex|flex)/
    );
    expect(indexHtml).toMatch(
      /\.hud-top-actions\s+\.btn-pause[\s\S]*?display:\s*(?:inline-flex|flex)/
    );
  });

  // =========================================================================
  // 5. Balanced Spacing and Responsive Mobile/Desktop HUD Layout
  // =========================================================================
  it('5. verifies balanced spacing, minimum 44px touch targets, and responsive layout across mobile and desktop', () => {
    // Minimum 44px touch target requirement
    expect(indexHtml).toMatch(/\.hud-icon-btn[\s\S]*?min-width:\s*44px/);
    expect(indexHtml).toMatch(/\.hud-icon-btn[\s\S]*?min-height:\s*44px/);

    // Responsive tier-phone / mobile top actions row
    expect(indexHtml).toMatch(/\.hud-layer\.tier-phone\s+\.hud-top-actions/);
    expect(indexHtml).toMatch(/\.hud-top-actions[\s\S]*?gap:/);
  });
});
