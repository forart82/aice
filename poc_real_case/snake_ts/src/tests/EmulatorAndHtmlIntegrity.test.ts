import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Emulator and HTML Integrity Conformance Tests', () => {
  const indexHtmlPath = path.resolve(__dirname, '../../index.html');
  const emulatorHtmlPath = path.resolve(__dirname, '../../emulator.html');

  it('1. verifies that index.html and emulator.html include the inline SVG favicon to eliminate 404 console errors', () => {
    expect(fs.existsSync(indexHtmlPath)).toBe(true);
    expect(fs.existsSync(emulatorHtmlPath)).toBe(true);

    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');
    const emulatorHtml = fs.readFileSync(emulatorHtmlPath, 'utf-8');

    const expectedFavicon = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🐍</text></svg>">`;

    expect(indexHtml).toContain(expectedFavicon);
    expect(emulatorHtml).toContain(expectedFavicon);
  });

  it('2. verifies index.html and emulator.html do not use external Google Font links that fail when offline or behind VPN', () => {
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');
    const emulatorHtml = fs.readFileSync(emulatorHtmlPath, 'utf-8');

    expect(indexHtml).not.toContain('fonts.googleapis.com');
    expect(emulatorHtml).not.toContain('fonts.googleapis.com');
  });

  it('3. verifies flex-shrink and non-shrinking rules for .codex-card, .codex-card.expanded, and .codex-hub-card in index.html', () => {
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

    // .codex-card
    const cardSection = indexHtml.slice(
      indexHtml.indexOf('.codex-card {'),
      indexHtml.indexOf('.codex-card:hover')
    );
    expect(cardSection).toContain('flex: 0 0 auto !important;');
    expect(cardSection).toContain('flex-shrink: 0 !important;');
    expect(cardSection).toContain('width: 100%;');
    expect(cardSection).toContain('height: auto !important;');
    expect(cardSection).toContain('min-height: 60px;');
    expect(cardSection).toContain('background: rgba(10, 22, 42, 0.8);');
    expect(cardSection).toContain('border: 1px solid rgba(0, 240, 181, 0.25);');
    expect(cardSection).toContain('border-radius: 12px;');
    expect(cardSection).toContain('margin-bottom: 10px;');
    expect(cardSection).toContain('overflow: hidden;');
    expect(cardSection).toContain('touch-action: pan-y !important;');
    expect(cardSection).toContain('box-sizing: border-box !important;');

    // .codex-card.expanded
    const expandedSection = indexHtml.slice(
      indexHtml.indexOf('.codex-card.expanded'),
      indexHtml.indexOf('.codex-card-header {')
    );
    expect(expandedSection).toContain('flex: 0 0 auto !important;');
    expect(expandedSection).toContain('flex-shrink: 0 !important;');
    expect(expandedSection).toContain('border-color: #00f0b5;');
    expect(expandedSection).toContain('box-shadow: 0 0 24px rgba(0, 240, 181, 0.3), 0 8px 32px rgba(0, 0, 0, 0.6);');
    expect(expandedSection).toContain('background: rgba(10, 22, 42, 0.95);');
    expect(expandedSection).toContain('height: auto !important;');
    expect(expandedSection).toContain('max-height: none !important;');
    expect(expandedSection).toContain('width: 100%;');
    expect(expandedSection).toContain('margin-top: 6px;');
    expect(expandedSection).toContain('margin-bottom: 16px;');

    // .codex-hub-card
    const hubCardSection = indexHtml.slice(
      indexHtml.indexOf('.codex-hub-card {'),
      indexHtml.indexOf('.codex-hub-card:hover')
    );
    expect(hubCardSection).toContain('flex: 0 0 auto !important;');
    expect(hubCardSection).toContain('flex-shrink: 0 !important;');
    expect(hubCardSection).toContain('min-height: 76px;');
    expect(hubCardSection).toContain('height: auto !important;');
  });

  it('4. verifies .codex-scroll-container has display: flex !important, flex-direction: column !important, and proper flex bounds', () => {
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

    const scrollSection = indexHtml.slice(
      indexHtml.indexOf('.codex-scroll-container {'),
      indexHtml.indexOf('.codex-scroll-container::-webkit-scrollbar')
    );
    expect(scrollSection).toContain('display: flex !important;');
    expect(scrollSection).toContain('flex-direction: column !important;');
    expect(scrollSection).toContain('flex: 1 1 auto !important;');
    expect(scrollSection).toContain('min-height: 0 !important;');
    expect(scrollSection).toContain('overflow-y: auto !important;');
    expect(scrollSection).toContain('-webkit-overflow-scrolling: touch;');
    expect(scrollSection).toContain('padding: 14px 16px 80px 16px !important;');
    expect(scrollSection).toContain('box-sizing: border-box !important;');
  });

  it('5. verifies .codex-card-body maintains auto-expansion and zero clipping constraints', () => {
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

    const bodySection = indexHtml.slice(
      indexHtml.indexOf('.codex-card-body {'),
      indexHtml.indexOf('.codex-card-summary')
    );
    expect(bodySection).toContain('height: auto !important;');
    expect(bodySection).toContain('max-height: none !important;');
    expect(bodySection).toContain('overflow: visible !important;');
    expect(bodySection).toContain('width: 100% !important;');
    expect(bodySection).toContain('padding: 16px !important;');
    expect(bodySection).toContain('box-sizing: border-box !important;');
  });

  it('6. verifies index.html does not reference nonexistent /favicon.png or /icon.png to prevent 404 console errors', () => {
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');
    expect(indexHtml).not.toContain('href="/favicon.png"');
    expect(indexHtml).not.toContain('href="/icon.png"');
  });

  it('7. verifies vite.config.ts configures dynamic server and host binding to prevent WebSocket connection refused errors', () => {
    const viteConfigPath = path.resolve(__dirname, '../../vite.config.ts');
    expect(fs.existsSync(viteConfigPath)).toBe(true);
    const viteConfig = fs.readFileSync(viteConfigPath, 'utf-8');
    expect(viteConfig).toMatch(/host:\s*true/);
    expect(viteConfig).toMatch(/strictPort:\s*false/);
  });

  it('8. verifies font-family across index.html and emulator.html contains robust system fallbacks', () => {
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');
    const emulatorHtml = fs.readFileSync(emulatorHtmlPath, 'utf-8');

    const expectedFallback = `'Chakra Petch', 'Orbitron', 'Rajdhani', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

    expect(indexHtml).toContain(`font-family: ${expectedFallback}`);
    expect(emulatorHtml).toContain(`font-family: ${expectedFallback}`);
  });
});
