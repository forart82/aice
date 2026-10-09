import { describe, it, expect } from 'vitest';
import { ResponsiveLayout } from '../ui/ResponsiveLayout';
import { Vec2 } from '../core/Vec2';

describe('ResponsiveLayout & Viewport Scaling', () => {
  const viewports = [
    { size: { x: 320, y: 480 }, minScale: 0.75, maxScale: 0.90, name: 'compact phone portrait (320x480)' },
    { size: { x: 360, y: 780 }, minScale: 0.85, maxScale: 1.05, name: 'modern tall phone portrait (360x780)' },
    { size: { x: 390, y: 844 }, minScale: 0.95, maxScale: 1.05, name: 'modern phone portrait (390x844)' },
    { size: { x: 844, y: 390 }, minScale: 0.60, maxScale: 0.75, name: 'modern phone landscape (844x390)' },
    { size: { x: 1024, y: 768 }, minScale: 0.75, maxScale: 1.15, name: 'tablet 4:3 (1024x768)' },
    { size: { x: 1280, y: 720 }, minScale: 0.98, maxScale: 1.02, name: 'reference 16:9 HD (1280x720)' },
    { size: { x: 1920, y: 1080 }, minScale: 1.40, maxScale: 1.60, name: 'desktop 1080p FHD (1920x1080)' },
    { size: { x: 2560, y: 1080 }, minScale: 1.40, maxScale: 1.60, name: 'desktop 21:9 ultrawide (2560x1080)' },
    { size: { x: 3840, y: 2160 }, minScale: 2.50, maxScale: 3.05, name: 'desktop 4K Ultra HD (3840x2160)' }
  ];

  it('computes UI scale correctly across all device aspect ratios', () => {
    for (const v of viewports) {
      const scale = ResponsiveLayout.computeUiScale(v.size);
      expect(scale).toBeGreaterThanOrEqual(v.minScale);
      expect(scale).toBeLessThanOrEqual(v.maxScale);
    }
  });

  it('computes logical canvas UiSpace without distortion', () => {
    const testVp = { x: 844, y: 390 };
    const s = ResponsiveLayout.computeUiScale(testVp);
    const logical = new Vec2(testVp.x / s, testVp.y / s);
    expect(logical.x).toBeGreaterThanOrEqual(1000);
    expect(logical.y).toBeGreaterThanOrEqual(500);
  });

  it('detects portrait and narrow HUD reflow states accurately', () => {
    expect(ResponsiveLayout.isPortraitHud(360, 780)).toBe(true);
    expect(ResponsiveLayout.isPortraitHud(844, 390)).toBe(true);
    expect(ResponsiveLayout.isPortraitHud(1280, 720)).toBe(false);
    expect(ResponsiveLayout.isPortraitHud(1920, 1080)).toBe(false);
  });

  it('lays out touch controls across the logical canvas bounds', () => {
    const space = new Vec2(1200, 600);
    const layout = ResponsiveLayout.layoutTouchControls(space);
    expect(layout.area.width).toBe(1200);
    expect(layout.area.height).toBe(600);
    expect(layout.dashPadX).toBeLessThan(300);
    expect(layout.skillPadX).toBeLessThan(layout.dashPadX);
  });
});
