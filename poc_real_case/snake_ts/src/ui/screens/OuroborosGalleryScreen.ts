/**
 * Ouroboros Ascension — Ouroboros Helmet Gallery Screen & WebGL Circular Ring (OuroborosGalleryScreen.ts)
 *
 * Implements the circular Ouroboros shrine showcasing the 8 Unique Boss Helmets positioned
 * along its circumference and the 9th Central Pedestal housing the forge for the Celestial Crown.
 * Features:
 * - Galaxy Jump Confirmation Modal detailing sacrifice count, score, and transcendence probability.
 * - Fullscreen cinematic hyperspace warp orchestration overlay with procedural sound triggers.
 * - Gold-Brown Unique Helmet outcome celebration screen & void collapse outcome modal.
 * - Distinctive Gold-Brown theme for unlocked unique helmet pedestals.
 *
 * Meets AGENTS.md Rule 10 In-Code Documentation Standards and Rule 12 WebGL Mandate.
 */

import { IScreen, UiRoot } from '../UiRoot.js';
import { MetaProgression } from '../../data/MetaProgression.js';
import { Services } from '../../core/Services.js';
import { UNIQUE_HELMETS, CELESTIAL_OUROBOROS_HELMET, UniqueHelmetDef, calculateSacrificeScore } from '../../data/UniqueHelmetsData.js';
import { GalaxyJumpWarpOverlay } from '../../render/webgl/GalaxyJumpWarpOverlay.js';
import { OuroborosGalleryRingRenderer } from '../../render/webgl/OuroborosGalleryRingRenderer.js';

export const OUROBOROS_RING_ANGLES: readonly number[] = [
  0,
  Math.PI / 4,
  Math.PI / 2,
  (3 * Math.PI) / 4,
  Math.PI,
  (5 * Math.PI) / 4,
  (3 * Math.PI) / 2,
  (7 * Math.PI) / 4,
];

export class OuroborosGalleryScreen implements IScreen {
  public readonly id: string = 'modal-ouroboros-gallery';
  public readonly element: HTMLElement;
  public readonly root: UiRoot;
  public ringRenderer!: OuroborosGalleryRingRenderer;

  private _animFrameId: number | null = null;
  private _animationStartTime: number = 0;

  public warpDurationMs: number = 1000;
  private _warpTimer: any = null;
  private _activeWarp: GalaxyJumpWarpOverlay | null = null;
  private _lastJumpResult: { success: boolean; awardedHelmet: UniqueHelmetDef | null; sacrificeScore: number; probability?: number } | null = null;

  public get isAnimating(): boolean {
    return this._animFrameId !== null;
  }

  public get animFrameId(): number | null {
    return this._animFrameId;
  }

  public get activeWarp(): GalaxyJumpWarpOverlay | null {
    return this._activeWarp;
  }

  constructor(root: UiRoot) {
    this.root = root;
    this.element = document.createElement('div');
    this.element.className = 'modal-overlay gallery-modal';
    this.element.style.transition = 'opacity 0.3s ease';
    this.build();
  }

  private build(): void {
    this.element.innerHTML = `
      <style>
        .gallery-ring-container {
          position: relative;
          width: 360px;
          height: 360px;
          margin: 10px auto;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .gallery-ring-artwork {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: contain;
          border-radius: 50%;
          pointer-events: none;
          z-index: 1;
          filter: drop-shadow(0 0 25px rgba(0, 240, 181, 0.45));
          background: transparent;
        }
        .pedestal-slot {
          position: absolute;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          user-select: none;
          overflow: hidden;
          transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease, border-color 0.2s ease;
        }
        .pedestal-slot.slot-unlocked:hover {
          transform: scale(1.15);
          box-shadow: 0 0 24px rgba(0, 240, 181, 0.9), inset 0 0 10px rgba(0, 240, 181, 0.4) !important;
          border-color: #00f0b5 !important;
        }
        .slot-helmet-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 50%;
          pointer-events: none;
          transition: transform 0.2s ease;
        }
        .pedestal-slot.slot-unlocked:hover .slot-helmet-img {
          transform: scale(1.08);
        }
        .unique-helmet-manifest-img, .relic-inspection-img, .relic-detail-img {
          width: 110px;
          height: 110px;
          object-fit: cover;
          border-radius: 50%;
          border: 2px solid #00f0b5;
          box-shadow: 0 0 25px rgba(0, 240, 181, 0.7);
          margin: 12px auto;
          display: block;
          animation: cyberAuraPulse 3s infinite alternate ease-in-out;
        }
        @keyframes cyberAuraPulse {
          0% {
            box-shadow: 0 0 20px rgba(0, 240, 181, 0.55), inset 0 0 12px rgba(0, 240, 181, 0.25);
            border-color: #00f0b5;
          }
          100% {
            box-shadow: 0 0 35px rgba(0, 240, 181, 0.9), inset 0 0 20px rgba(0, 240, 181, 0.45);
            border-color: #5eead4;
          }
        }
        @media (max-width: 480px) {
          .gallery-panel {
            padding: 12px 6px !important;
            width: 98vw !important;
          }
          .cyber-modal-title {
            font-size: 16px !important;
            letter-spacing: 1px !important;
          }
          .cyber-modal-subtitle {
            font-size: 10.5px !important;
          }
          .gallery-ring-container {
            margin: 4px auto !important;
          }
          .unique-helmet-manifest-img, .relic-inspection-img, .relic-detail-img {
            width: 92px !important;
            height: 92px !important;
            margin: 8px auto !important;
          }
        }
        @media (max-width: 360px) {
          .gallery-panel {
            padding: 8px 4px !important;
          }
          .gallery-ring-container {
            transform: scale(0.92);
            transform-origin: center center;
            margin: 0 auto !important;
          }
        }
      </style>
      <div class="modal-panel gallery-panel glass-panel" style="max-width: 920px; width: 95vw; max-height: min(92vh, 92dvh); display: flex; flex-direction: column; overflow-y: auto;">
        <div class="modal-header">
          <h2 class="cyber-modal-title">OUROBOROS GALLERY & CELESTIAL SHRINE</h2>
          <p class="cyber-modal-subtitle">The 8 Cosmic Pillars & The 9th Singularity Crown</p>
        </div>

        <div class="gallery-ring-container" style="position: relative; width: 360px; height: 360px; margin: 10px auto; display: flex; align-items: center; justify-content: center; border-radius: 50%;">
          <img class="gallery-ring-artwork" src="/ouroboros_gallery.png" alt="Celestial 8-Part Ouroboros Shrine" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; border-radius: 50%; pointer-events: none; z-index: 1; filter: drop-shadow(0 0 25px rgba(0, 240, 181, 0.45)); background: transparent;" />
          <canvas class="gallery-ring-canvas" width="360" height="360" style="position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%; pointer-events: none; z-index: 2; background: transparent;"></canvas>
          
          <div class="circumferential-slots-layer" style="position: absolute; inset: 0; z-index: 3;"></div>

          <div class="arched-serpent-head" style="position: absolute; pointer-events: none; z-index: 5; inset: 0;"></div>

          <div class="pedestal-central" style="position: absolute; z-index: 10; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; width: 140px; height: 140px; border-radius: 50%; padding: 8px;">
            <div class="central-status-text" style="font-size: 10px; color: #94a3b8; margin-bottom: 4px;"></div>
            <button class="cyber-btn btn-primary btn-forge-9th" style="margin-top: 6px; font-size: 10.5px; padding: 6px 8px;"></button>
          </div>
        </div>

        <div class="galaxy-jump-section" style="margin: 12px auto; text-align: center; max-width: 480px; width: 100%;">
          <div class="galaxy-jump-alert" style="display: none; font-size: 12px; margin-bottom: 6px; color: #f87171; font-weight: 500;"></div>
          <div class="galaxy-jump-info" style="font-size: 12px; margin-bottom: 6px; color: #94a3b8;"></div>
          <button class="cyber-btn btn-secondary btn-galaxy-jump" style="width: 100%; padding: 10px 16px;">🌌 Galaxy Jump Ritual</button>
        </div>

        <!-- 9th Crown Boss Rush Confirmation Modal -->
        <div class="forge-confirm-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 999; align-items: center; justify-content: center;">
          <div class="modal-panel glass-panel" style="max-width: 440px; padding: 20px; text-align: center;">
            <h3 style="color: #ffd166;">⚡ AWAKEN THE 9TH CROWN ⚡</h3>
            <p style="font-size: 13px; color: #e2e8f0; margin: 12px 0;">
              Forging the 9th Helmet will open the 8-Second Wave All-Boss Rush Arena!
              If you die, ALL 8 UNIQUE HELMETS ARE WIPED!
            </p>
            <div style="display: flex; gap: 10px; justify-content: center;">
              <button class="cyber-btn btn-primary btn-confirm-forge">ENTER THE GAUNTLET</button>
              <button class="cyber-btn btn-ghost btn-cancel-forge">ABORT</button>
            </div>
          </div>
        </div>

        <!-- Galaxy Jump Confirmation Modal -->
        <div class="galaxy-jump-confirm-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 999; align-items: center; justify-content: center; backdrop-filter: blur(8px);">
          <div class="modal-panel glass-panel" style="max-width: 520px; width: 92vw; padding: 24px; text-align: center; border: 1px solid rgba(212, 175, 55, 0.5); box-shadow: 0 0 30px rgba(212, 175, 55, 0.35); background: linear-gradient(135deg, rgba(20, 14, 6, 0.95), rgba(35, 24, 10, 0.92));">
            <h3 class="cyber-modal-title" style="color: #ffd166; font-size: 19px; margin: 0 0 6px 0; letter-spacing: 1.5px;">🌌 INITIATE GALAXY JUMP RITUAL 🌌</h3>
            <p class="cyber-modal-subtitle" style="font-size: 12.5px; color: #cbd5e1; margin: 0 0 16px 0;">Sacrifice standard boss helmets to bend spacetime into a new galaxy</p>

            <div class="reactor-and-probability-grid" style="display: flex; gap: 12px; margin-bottom: 14px; align-items: stretch;">
              <!-- Energy Reactor Gauge -->
              <div class="energy-reactor-gauge glass-panel" style="flex: 1; padding: 12px; border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 8px; text-align: left; background: rgba(20, 14, 6, 0.6);">
                <div style="font-size: 10px; color: #94a3b8; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px;">⚛️ Resonance Reactor</div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                  <span style="color: #cbd5e1; font-size: 12px;">Standard Helmets:</span>
                  <span class="sacrifice-count" style="color: #ffd166; font-weight: bold; font-size: 13px;">0</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                  <span style="color: #cbd5e1; font-size: 12px;">Sacrifice Score:</span>
                  <span class="sacrifice-score" style="color: #38bdf8; font-weight: bold; font-size: 13px;">0</span>
                </div>
                <div class="gauge-bar-track" style="height: 6px; background: rgba(148, 163, 184, 0.2); border-radius: 3px; overflow: hidden;">
                  <div class="gauge-bar-fill" style="height: 100%; width: 50%; background: linear-gradient(90deg, #d4af37, #38bdf8); transition: width 0.3s ease;"></div>
                </div>
              </div>

              <!-- Holographic Probability Wheel -->
              <div class="holographic-probability-wheel glass-panel" style="flex: 1; padding: 12px; border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(20, 14, 6, 0.6);">
                <div style="font-size: 10px; color: #94a3b8; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px;">🌀 Transcendence Prob</div>
                <div class="transcendence-chance" style="font-size: 24px; font-weight: bold; color: #4ade80; text-shadow: 0 0 10px rgba(74, 222, 128, 0.5);">0.0%</div>
                <div style="font-size: 10px; color: #a7f3d0; margin-top: 2px;">Chance of Unique Helmet</div>
              </div>
            </div>

            <!-- Sacrificed Helmets Tray -->
            <div class="sacrificed-helmets-tray" style="background: rgba(15, 23, 42, 0.5); border: 1px dashed rgba(212, 175, 55, 0.3); border-radius: 8px; padding: 10px; margin-bottom: 14px; min-height: 48px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center;">
            </div>

            <div class="sacrifice-warning" style="color: #f87171; font-size: 12px; margin-bottom: 18px; line-height: 1.4;">
              ⚠️ All standard boss helmets will be permanently consumed in this cosmic jump.
            </div>

            <div style="display: flex; gap: 12px; justify-content: center;">
              <button class="cyber-btn btn-primary btn-confirm-jump" style="flex: 1; padding: 10px 14px;">🌌 INITIATE JUMP</button>
              <button class="cyber-btn btn-ghost btn-cancel-jump" style="padding: 10px 18px;">ABORT</button>
            </div>
          </div>
        </div>

        <!-- Outcome Modal (Success or Failure) -->
        <div class="galaxy-jump-result-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.88); z-index: 1001; align-items: center; justify-content: center; padding: 16px; backdrop-filter: blur(5px);">
          <div class="galaxy-result-container" style="max-width: 500px; width: 100%;"></div>
        </div>

        <!-- Relic Detail Inspection Modal -->
        <div class="relic-detail-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 1002; align-items: center; justify-content: center; padding: 16px; backdrop-filter: blur(8px);">
          <div class="relic-detail-container" style="max-width: 460px; width: 92vw;"></div>
        </div>

        <div class="modal-actions-row gallery-actions-ambidextrous" style="display: flex; justify-content: center; gap: 10px; margin-top: auto; padding-top: 10px; border-top: 1px solid rgba(148, 163, 184, 0.15);">
          <button class="cyber-btn btn-ghost btn-back" style="min-width: 160px;">Return</button>
        </div>
      </div>
    `;

    // Initialize hardware-accelerated WebGL 2.0 Ouroboros Gallery Ring Renderer
    const canvas = this.element.querySelector('.gallery-ring-canvas') as HTMLCanvasElement;
    if (canvas) {
      canvas.width = 360;
      canvas.height = 360;
    }
    const gl = canvas
      ? ((canvas.getContext('webgl2', { alpha: true, antialias: true }) ||
          canvas.getContext('webgl', { alpha: true, antialias: true })) as WebGL2RenderingContext | null)
      : null;
    this.ringRenderer = new OuroborosGalleryRingRenderer(canvas, gl);

    const backBtn = this.element.querySelector('.btn-back') as HTMLButtonElement;
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        Services.Sound.playUi();
        this.hide();
        this.root.showScreen('modal-main-menu');
      });
    }

    // 9th Crown Gauntlet
    const forgeBtn = this.element.querySelector('.btn-forge-9th') as HTMLButtonElement;
    const confirmModal = this.element.querySelector('.forge-confirm-modal') as HTMLElement;
    const confirmBtn = confirmModal?.querySelector('.btn-confirm-forge') as HTMLButtonElement;
    const cancelBtn = confirmModal?.querySelector('.btn-cancel-forge') as HTMLButtonElement;

    if (forgeBtn && confirmModal) {
      forgeBtn.addEventListener('click', () => {
        if (forgeBtn.disabled) return;
        Services.Sound.playUi();
        confirmModal.style.display = 'flex';
      });
    }

    if (cancelBtn && confirmModal) {
      cancelBtn.addEventListener('click', () => {
        Services.Sound.playUi();
        confirmModal.style.display = 'none';
      });
    }

    if (confirmBtn && confirmModal) {
      confirmBtn.addEventListener('click', () => {
        confirmModal.style.display = 'none';
        const meta = MetaProgression.instance;
        meta.forge9thHelmet();
        Services.Sound.playLevelUp();
        if (this.root.engine) {
          if (typeof this.root.engine.StartBossRushGauntlet === 'function') {
            this.root.engine.StartBossRushGauntlet();
          } else if (typeof this.root.engine.startBossRushGauntlet === 'function') {
            this.root.engine.startBossRushGauntlet();
          }
        }
        this.refresh();
      });
    }

    // Galaxy Jump Initiation & Modals
    const jumpBtn = this.element.querySelector('.btn-galaxy-jump') as HTMLButtonElement;
    const jumpConfirmModal = this.element.querySelector('.galaxy-jump-confirm-modal') as HTMLElement;
    const cancelJumpBtn = jumpConfirmModal?.querySelector('.btn-cancel-jump') as HTMLButtonElement;
    const confirmJumpBtn = jumpConfirmModal?.querySelector('.btn-confirm-jump') as HTMLButtonElement;

    if (jumpBtn) {
      jumpBtn.addEventListener('click', () => {
        const meta = MetaProgression.instance;
        const standardCount = meta.Helmets.length;

        if (standardCount === 0) {
          // Inline alert when no helmets available
          let alertEl = this.element.querySelector('.galaxy-jump-alert') as HTMLElement;
          if (!alertEl) {
            alertEl = this.element.querySelector('.galaxy-jump-info') as HTMLElement;
          }
          if (alertEl) {
            alertEl.textContent = 'No standard helmets available to sacrifice! Defeat floor bosses in your runs to gather helmets.';
            alertEl.style.display = 'block';
          }
          if (jumpConfirmModal) jumpConfirmModal.style.display = 'none';
          if (typeof Services.Sound.playError === 'function') {
            Services.Sound.playError();
          } else {
            Services.Sound.playUi();
          }
          return;
        }

        // Open Confirmation Modal with calculated values
        const score = calculateSacrificeScore(meta.Helmets);
        const prob = score > 0 ? 1 - Math.exp(-score / 800) : 0;

        const countEl = jumpConfirmModal?.querySelector('.sacrifice-count');
        const scoreEl = jumpConfirmModal?.querySelector('.sacrifice-score');
        const chanceEl = jumpConfirmModal?.querySelector('.transcendence-chance');
        const fillEl = jumpConfirmModal?.querySelector('.gauge-bar-fill') as HTMLElement;
        const tray = jumpConfirmModal?.querySelector('.sacrificed-helmets-tray') as HTMLElement;

        if (countEl) countEl.textContent = String(standardCount);
        if (scoreEl) scoreEl.textContent = String(score);
        if (chanceEl) chanceEl.textContent = `${(prob * 100).toFixed(1)}%`;
        if (fillEl) fillEl.style.width = `${Math.min(100, Math.round(prob * 100))}%`;

        if (tray) {
          tray.innerHTML = meta.Helmets.map(h => `
            <div class="sacrificed-helmet-chip" style="background: rgba(43, 29, 12, 0.85); border: 1px solid #d4af37; border-radius: 4px; padding: 4px 8px; display: flex; align-items: center; gap: 4px; font-size: 11px; color: #ffd166;">
              <span>${h.Icon || h.icon || '🪖'}</span>
              <span style="max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${h.Name || h.name || 'Helmet'}</span>
            </div>
          `).join('');
        }

        if (jumpConfirmModal) jumpConfirmModal.style.display = 'flex';
        Services.Sound.playUi();
      });
    }

    if (cancelJumpBtn && jumpConfirmModal) {
      cancelJumpBtn.addEventListener('click', () => {
        Services.Sound.playUi();
        jumpConfirmModal.style.display = 'none';
      });
    }

    if (confirmJumpBtn && jumpConfirmModal) {
      confirmJumpBtn.addEventListener('click', () => {
        // 1. Close confirmation modal immediately
        jumpConfirmModal.style.display = 'none';

        // 2. Fade out / minimize the gallery modal container to allow the whole game screen to warp into hyperspace!
        // This ensures the player does NOT see a "video in a frame" but rather the whole game jumping into the new galaxy.
        this.element.style.opacity = '0';
        this.element.style.pointerEvents = 'none';
        this.element.style.transition = 'opacity 0.3s ease';

        // 3. Play synchronized hyperspace warp audio
        if (typeof (Services.Sound as any).playWarpJump === 'function') {
          (Services.Sound as any).playWarpJump();
        } else {
          Services.Sound.playUi();
        }

        // 4. Execute jump during warp
        const meta = MetaProgression.instance;
        this._lastJumpResult = meta.galaxyJump();

        // 5. Clean up any existing active warp overlay
        if (this._activeWarp) {
          this._activeWarp.destroy();
          this._activeWarp = null;
        }

        // 6. Launch GalaxyJumpWarpOverlay mounted directly to document.body (whole-game viewport)
        const durationSec = this.warpDurationMs > 0 ? this.warpDurationMs / 1000 : 0;
        const mountContainer = (typeof document !== 'undefined' && document.body) ? document.body : this.element;

        this._activeWarp = GalaxyJumpWarpOverlay.play(
          mountContainer,
          () => {
            this.completeWarpAnimation();
          },
          this._lastJumpResult,
          durationSec
        );

        // 7. Schedule Warp Completion fallback timer
        if (this.warpDurationMs > 0) {
          if (this._warpTimer) clearTimeout(this._warpTimer);
          this._warpTimer = setTimeout(() => {
            this.completeWarpAnimation();
          }, this.warpDurationMs);
        } else {
          this.completeWarpAnimation();
        }
      });
    }
  }

  /**
   * Completes the cosmic warp animation and opens the outcome celebration/void modal.
   * Restores gallery modal container visibility, refreshes ring state, and reveals outcome modal.
   */
  public completeWarpAnimation(): void {
    if (this._activeWarp) {
      this._activeWarp.destroy();
      this._activeWarp = null;
    }
    if (this._warpTimer) {
      clearTimeout(this._warpTimer);
      this._warpTimer = null;
    }

    // Restore gallery modal container visibility and pointer interaction
    this.element.style.opacity = '1';
    this.element.style.pointerEvents = 'auto';

    // Refresh Ouroboros ring with updated state
    this.refresh();

    // Display the holographic outcome modal
    this.showOutcomeModal(this._lastJumpResult);
  }

  /**
   * Renders the Outcome celebration modal or void collapsed modal.
   */
  private showOutcomeModal(result: { success: boolean; awardedHelmet: UniqueHelmetDef | null; sacrificeScore: number; probability?: number } | null): void {
    const resultModal = this.element.querySelector('.galaxy-jump-result-modal') as HTMLElement;
    const container = this.element.querySelector('.galaxy-result-container') as HTMLElement;
    if (!resultModal || !container) return;

    container.innerHTML = '';

    if (result && result.success && result.awardedHelmet) {
      // SUCCESS: Play short level-up stinger audio
      Services.Sound.playLevelUp();

      const h = result.awardedHelmet;

      // Special capacity title highlighting
      let capacityHtml = h.SpecialCapacity || '';
      if (capacityHtml.includes(':')) {
        const colonIdx = capacityHtml.indexOf(':');
        const title = capacityHtml.substring(0, colonIdx);
        const desc = capacityHtml.substring(colonIdx + 1);
        capacityHtml = `<strong style="color: #ffd166; font-size: 13.5px;">${title}:</strong> <span style="color: #fef08a;">${desc}</span>`;
      }

      const statsBadges = Object.entries(h.Stats || {})
        .map(([k, v]) => `<span style="background: rgba(43,29,12,0.9); border: 1px solid #d4af37; border-radius: 4px; padding: 3px 8px; font-size: 11px; color: #ffd166;">${k}: ${typeof v === 'number' && v < 1 && v > 0 ? (v * 100).toFixed(0) + '%' : v}</span>`)
        .join(' ');

      container.innerHTML = `
        <div class="unique-helmet-card" style="background: linear-gradient(135deg, #2b1d0c, #4a3419); border: 2px solid #d4af37; box-shadow: 0 0 25px rgba(212, 175, 55, 0.6); color: #ffd166; padding: 24px; border-radius: 12px; text-align: center;">
          <div style="font-size: 12px; letter-spacing: 2px; color: #ffd166; text-transform: uppercase; margin-bottom: 4px;">✨ COSMIC TRANSCENDENCE SUCCEEDED! ✨</div>
          <div style="font-size: 11px; letter-spacing: 1.5px; color: #ffd166; margin-bottom: 8px; font-weight: bold;">✦ UNIQUE MYTHIC ARTIFACT AWAKENED ✦</div>
          ${h.Image || h.image ? `
            <img class="unique-helmet-manifest-img" src="${h.Image || h.image}" alt="${h.Name}" style="width: 110px; height: 110px; object-fit: cover; border-radius: 50%; border: 2px solid #00f0b5; box-shadow: 0 0 25px rgba(0, 240, 181, 0.7); margin: 12px auto; display: block;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='block';" />
            <div class="unique-helmet-icon-fallback" style="display: none; font-size: 64px; margin: 12px auto; filter: drop-shadow(0 0 16px rgba(212, 175, 55, 0.9));">${h.Icon}</div>
          ` : `
            <div class="unique-helmet-icon" style="font-size: 64px; margin: 12px auto; filter: drop-shadow(0 0 16px rgba(212, 175, 55, 0.9));">${h.Icon}</div>
          `}
          <h3 class="unique-helmet-name" style="color: #ffd166; font-size: 20px; margin: 0 0 6px 0; font-weight: bold;">${h.Name}</h3>
          <div class="unique-helmet-rarity" style="color: #d4af37; font-weight: bold; letter-spacing: 2px; font-size: 11px; margin-bottom: 12px;">UNIQUE MYTHIC</div>
          <div class="unique-helmet-capacity capacity-showcase-chip" style="background: rgba(0,0,0,0.45); border-left: 3px solid #d4af37; border-radius: 4px; padding: 10px 14px; margin: 12px 0; text-align: left; font-size: 12.5px; line-height: 1.4;">${capacityHtml}</div>
          <div class="unique-helmet-lore" style="font-style: italic; font-size: 12px; color: #fef08a; opacity: 0.85; margin: 10px 0; line-height: 1.4;">"${h.Lore}"</div>
          <div class="unique-helmet-stats" style="display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin: 12px 0;">${statsBadges}</div>
          <button class="cyber-btn btn-primary btn-claim-helmet" style="margin-top: 14px; width: 100%; padding: 12px 18px; font-size: 13px; font-weight: bold; background: linear-gradient(135deg, #d4af37, #b8860b); color: #020306; border: none; cursor: pointer;">CLAIM & EMBED INTO OUROBOROS RING</button>
        </div>
      `;

      const claimBtn = container.querySelector('.btn-claim-helmet') as HTMLButtonElement;
      if (claimBtn) {
        claimBtn.addEventListener('click', () => {
          Services.Sound.playUi();
          resultModal.style.display = 'none';
          this.refresh();
        });
      }
    } else {
      // FAILURE: Subdued void sound
      if (typeof (Services.Sound as any).playVoidCollapse === 'function') {
        (Services.Sound as any).playVoidCollapse();
      } else {
        Services.Sound.playGameOver();
      }

      const probPercent = result && result.probability ? (result.probability * 100).toFixed(1) : '0.0';

      container.innerHTML = `
        <div class="modal-panel glass-panel" style="max-width: 480px; width: 100%; padding: 24px; text-align: center; border: 1px solid rgba(239, 68, 68, 0.4); box-shadow: 0 0 20px rgba(239, 68, 68, 0.2);">
          <div style="font-size: 48px; margin-bottom: 12px;">🕳️</div>
          <h3 style="color: #f87171; font-size: 18px; margin: 0 0 10px 0; letter-spacing: 1.5px; font-weight: bold;">THE COSMIC RIFT COLLAPSED</h3>
          <div style="color: #fca5a5; font-size: 13px; margin-bottom: 8px; font-weight: 600;">THE VOID CONSUMED THE SACRIFICE</div>
          <p style="font-size: 13px; color: #cbd5e1; margin: 0 0 12px 0; line-height: 1.4;">The void absorbed your sacrifice... but your resonance with the cosmos deepens. (Success chance was ${probPercent}%).</p>
          <div class="void-resonance-guide" style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 6px; padding: 10px; margin: 12px 0; font-size: 12px; color: #94a3b8; line-height: 1.4;">
            💡 Defeat more floor bosses to harvest standard helmets and increase your sacrifice resonance for the next jump.
          </div>
          <button class="cyber-btn btn-ghost btn-dismiss-result" style="width: 100%; padding: 10px 16px; cursor: pointer;">Return to Shrine</button>
        </div>
      `;

      const dismissBtn = container.querySelector('.btn-dismiss-result') as HTMLButtonElement;
      if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
          Services.Sound.playUi();
          resultModal.style.display = 'none';
          this.refresh();
        });
      }
    }

    resultModal.style.display = 'flex';
  }

  /**
   * Opens an interactive holographic relic inspection modal when clicking a pedestal.
   */
  public showRelicDetail(index: number): void {
    const meta = MetaProgression.instance;
    const arch = UNIQUE_HELMETS[index]!;
    const isUnlocked = meta.UniqueHelmets.includes(arch.Id);

    const modal = this.element.querySelector('.relic-detail-modal') as HTMLElement;
    const container = this.element.querySelector('.relic-detail-container') as HTMLElement;
    if (!modal || !container) return;

    if (isUnlocked) {
      let capacityHtml = arch.SpecialCapacity || '';
      if (capacityHtml.includes(':')) {
        const colonIdx = capacityHtml.indexOf(':');
        const title = capacityHtml.substring(0, colonIdx);
        const desc = capacityHtml.substring(colonIdx + 1);
        capacityHtml = `<strong style="color: #ffd166; font-size: 13.5px;">${title}:</strong> <span style="color: #fef08a;">${desc}</span>`;
      }

      const statsBadges = Object.entries(arch.Stats || {})
        .map(([k, v]) => `<span style="background: rgba(43,29,12,0.9); border: 1px solid #d4af37; border-radius: 4px; padding: 3px 8px; font-size: 11px; color: #ffd166;">${k}: ${typeof v === 'number' && v < 1 && v > 0 ? (v * 100).toFixed(0) + '%' : v}</span>`)
        .join(' ');

      container.innerHTML = `
        <div class="modal-panel glass-panel" style="background: linear-gradient(135deg, rgba(43,29,12,0.98), rgba(20,14,6,0.98)); border: 2px solid #d4af37; box-shadow: 0 0 25px rgba(212, 175, 55, 0.5); padding: 22px; border-radius: 12px; text-align: center;">
          <div style="font-size: 11px; letter-spacing: 1.5px; color: #ffd166; margin-bottom: 6px; font-weight: bold;">✦ UNIQUE MYTHIC ARTIFACT ✦</div>
          ${arch.Image || arch.image ? `
            <img class="relic-inspection-img relic-detail-img" src="${arch.Image || arch.image}" alt="${arch.Name}" style="width: 110px; height: 110px; object-fit: cover; border-radius: 50%; border: 2px solid #00f0b5; box-shadow: 0 0 25px rgba(0, 240, 181, 0.7); margin: 12px auto; display: block;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='block';" />
            <div class="relic-detail-fallback-icon" style="display: none; font-size: 56px; margin: 8px auto; filter: drop-shadow(0 0 16px rgba(212, 175, 55, 0.8));">${arch.Icon}</div>
          ` : `
            <div class="relic-detail-icon" style="font-size: 56px; margin: 8px auto; filter: drop-shadow(0 0 16px rgba(212, 175, 55, 0.8));">${arch.Icon}</div>
          `}
          <h3 style="color: #ffd166; font-size: 19px; margin: 0 0 4px 0; font-weight: bold;">${arch.Name}</h3>
          <div style="color: #d4af37; font-weight: bold; letter-spacing: 1.5px; font-size: 10.5px; margin-bottom: 12px;">SOCKET ${index + 1} OF 8</div>
          <div style="background: rgba(0,0,0,0.5); border-left: 3px solid #d4af37; border-radius: 4px; padding: 10px 14px; margin: 12px 0; text-align: left; font-size: 12.5px; line-height: 1.4;">${capacityHtml}</div>
          <div style="font-style: italic; font-size: 12px; color: #fef08a; opacity: 0.85; margin: 10px 0; line-height: 1.4;">"${arch.Lore}"</div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin: 12px 0;">${statsBadges}</div>
          <button class="cyber-btn btn-ghost btn-close-relic-detail" style="margin-top: 12px; width: 100%; padding: 10px 16px; cursor: pointer;">Close Inspection</button>
        </div>
      `;
    } else {
      const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
      container.innerHTML = `
        <div class="modal-panel glass-panel" style="background: linear-gradient(135deg, rgba(15,23,42,0.98), rgba(8,12,22,0.98)); border: 1px dashed rgba(148, 163, 184, 0.4); box-shadow: 0 0 20px rgba(0,0,0,0.7); padding: 22px; border-radius: 12px; text-align: center;">
          <div style="font-size: 42px; margin-bottom: 10px; color: #64748b;">✧</div>
          <h3 style="color: #cbd5e1; font-size: 17px; margin: 0 0 6px 0; font-weight: bold;">DORMANT ARTIFACT SOCKET ${romanNumerals[index]}</h3>
          <div style="color: #94a3b8; font-size: 12px; margin-bottom: 12px;">Sealed in an Alternate Galaxy</div>
          <p style="font-size: 12.5px; color: #94a3b8; line-height: 1.5; margin: 0 0 16px 0;">
            This mythic crown is dormant. Perform a <strong>Galaxy Jump</strong> by sacrificing standard boss helmets to bend spacetime and awaken this celestial relic.
          </p>
          <button class="cyber-btn btn-ghost btn-close-relic-detail" style="width: 100%; padding: 10px 16px; cursor: pointer;">Return to Shrine</button>
        </div>
      `;
    }

    const closeBtn = container.querySelector('.btn-close-relic-detail') as HTMLButtonElement;
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        Services.Sound.playUi();
        modal.style.display = 'none';
      });
    }

    modal.style.display = 'flex';
  }

  /**
   * Drives the hardware-accelerated WebGL render pass.
   * Passes elapsed animation time, count of collected unique helmets, and 9th crown readiness.
   * Conforms strictly to AGENTS.md Rule 10 (In-Code Documentation) and Rule 12 (Pure WebGL).
   */
  public render(): void {
    if (!this.ringRenderer) return;
    const meta = MetaProgression.instance;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsed = this._animationStartTime > 0 ? (now - this._animationStartTime) * 0.001 : 0;
    this.ringRenderer.render(elapsed, meta.UniqueHelmets.length, meta.canForge9thHelmet());
  }

  /**
   * Starts the 60 FPS requestAnimationFrame animation loop while the modal is visible.
   */
  public startAnimationLoop(): void {
    if (this._animFrameId !== null) return;
    this._animationStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const tick = () => {
      if (this.element.style.display === 'none') {
        this.stopAnimationLoop();
        return;
      }
      this.render();
      if (typeof requestAnimationFrame !== 'undefined') {
        this._animFrameId = requestAnimationFrame(tick);
      }
    };

    this.render();
    if (typeof requestAnimationFrame !== 'undefined') {
      this._animFrameId = requestAnimationFrame(tick);
    }
  }

  /**
   * Pauses the animation loop to conserve GPU/battery resources when modal is hidden or dismissed.
   */
  public stopAnimationLoop(): void {
    if (this._animFrameId !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(this._animFrameId);
      }
      this._animFrameId = null;
    }
  }

  public show(): void {
    this.element.style.display = 'flex';
    this.element.style.opacity = '1';
    this.element.style.pointerEvents = 'auto';
    this.refresh();
    this.startAnimationLoop();
  }

  public hide(): void {
    this.element.style.display = 'none';
    this.stopAnimationLoop();
    if (this._activeWarp) {
      this._activeWarp.destroy();
      this._activeWarp = null;
    }
    if (this._warpTimer) {
      clearTimeout(this._warpTimer);
      this._warpTimer = null;
    }
  }

  public refresh(): void {
    const meta = MetaProgression.instance;
    const slotsLayer = this.element.querySelector('.circumferential-slots-layer')!;
    slotsLayer.innerHTML = '';

    const radius = 130;
    const cx = 180;
    const cy = 180;

    const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

    for (let i = 0; i < 8; i++) {
      const angle = OUROBOROS_RING_ANGLES[i]!;
      const arch = UNIQUE_HELMETS[i]!;
      const isUnlocked = meta.UniqueHelmets.includes(arch.Id);

      const slot = document.createElement('div');
      slot.className = `pedestal-slot ${isUnlocked ? 'slot-unlocked' : 'slot-locked'}`;
      slot.dataset.slotIndex = String(i);
      slot.dataset.angle = String(angle);
      slot.dataset.status = isUnlocked ? 'unlocked' : 'locked';

      const x = cx + Math.cos(angle) * radius - 24;
      const y = cy + Math.sin(angle) * radius - 24;
      slot.style.position = 'absolute';
      slot.style.left = `${x}px`;
      slot.style.top = `${y}px`;
      slot.style.width = '48px';
      slot.style.height = '48px';
      slot.style.borderRadius = '50%';
      slot.style.display = 'flex';
      slot.style.alignItems = 'center';
      slot.style.justifyContent = 'center';
      slot.style.cursor = 'pointer';
      slot.style.userSelect = 'none';
      slot.style.transition = 'transform 0.15s ease, box-shadow 0.15s ease';

      if (isUnlocked) {
        slot.title = `${arch.Name}: ${arch.SpecialCapacity}`;
        slot.setAttribute('data-tooltip', `${arch.Name}: ${arch.SpecialCapacity}`);
        // Gold-Brown theme for unlocked pedestals
        slot.style.border = '2px solid #d4af37';
        slot.style.boxShadow = '0 0 16px rgba(212, 175, 55, 0.8)';
        slot.style.background = 'radial-gradient(circle, rgba(74, 52, 25, 0.9) 0%, rgba(43, 29, 12, 0.95) 100%)';
        slot.style.color = '#ffd166';
        slot.style.fontSize = '22px';
        slot.style.overflow = 'hidden';

        const imageSrc = arch.Image || arch.image;
        if (imageSrc) {
          slot.innerHTML = `
            <img class="slot-helmet-img" src="${imageSrc}" alt="${arch.Name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%; pointer-events: none;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
            <span class="slot-helmet-icon-fallback" style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; font-size: 22px;">${arch.Icon}</span>
          `;
        } else {
          slot.textContent = arch.Icon;
        }
      } else {
        slot.title = `Locked: ${arch.Name}`;
        slot.setAttribute('data-tooltip', `Locked: ${arch.Name}`);
        slot.style.border = '1px dashed #64748b';
        slot.style.opacity = '0.75';
        slot.style.background = 'radial-gradient(circle, rgba(15, 23, 42, 0.85) 0%, rgba(8, 12, 22, 0.95) 100%)';
        slot.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.6), inset 0 0 8px rgba(100, 116, 139, 0.25)';
        slot.style.color = '#94a3b8';
        slot.innerHTML = `
          <div class="locked-rune-socket" style="display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; line-height: 1;">
            <span style="font-size: 13px; color: #64748b; text-shadow: 0 0 6px rgba(100, 116, 139, 0.5);">✧</span>
            <span style="font-size: 8.5px; color: #475569; letter-spacing: 0.5px; font-weight: 700; margin-top: 1px;">${romanNumerals[i]}</span>
          </div>
        `;
      }

      slot.addEventListener('click', () => {
        Services.Sound.playUi();
        this.showRelicDetail(i);
      });

      slotsLayer.appendChild(slot);
    }

    // Update Central Pedestal
    const centralSlot = this.element.querySelector('.pedestal-central') as HTMLElement;
    const statusText = centralSlot.querySelector('.central-status-text') as HTMLElement;
    const forgeBtn = centralSlot.querySelector('.btn-forge-9th') as HTMLButtonElement;

    const count = meta.UniqueHelmets.length;
    if (count < 8) {
      centralSlot.classList.remove('cosmic-aura');
      centralSlot.style.background = 'radial-gradient(circle, rgba(15, 23, 42, 0.85) 0%, rgba(8, 12, 22, 0.9) 70%, transparent 100%)';
      centralSlot.style.border = '1px solid rgba(148, 163, 184, 0.3)';
      centralSlot.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.8), inset 0 0 12px rgba(56, 189, 248, 0.12)';
      statusText.innerHTML = `
        <div style="font-size: 11px; font-weight: 700; color: #ffd166; letter-spacing: 1px; margin-bottom: 2px;">✦ ${count} / 8 ATTUNED ✦</div>
        <div style="font-size: 9.5px; color: #94a3b8; line-height: 1.2;">SEALED: Collect all 8 Unique Helmets to Awaken</div>
      `;
      forgeBtn.disabled = true;
      forgeBtn.classList.add('btn-forge-disabled');
      forgeBtn.textContent = 'Forge Sealed (Requires 8/8)';
      forgeBtn.style.background = 'rgba(30, 41, 59, 0.5)';
      forgeBtn.style.color = '#64748b';
      forgeBtn.style.border = '1px solid rgba(100, 116, 139, 0.3)';
    } else {
      centralSlot.classList.add('cosmic-aura');
      centralSlot.style.background = 'radial-gradient(circle, rgba(74, 52, 25, 0.95) 0%, rgba(35, 24, 10, 0.95) 70%, transparent 100%)';
      centralSlot.style.border = '2px solid #d4af37';
      centralSlot.style.boxShadow = '0 0 30px rgba(212, 175, 55, 0.9), inset 0 0 20px rgba(255, 209, 102, 0.4)';
      statusText.innerHTML = `
        <div style="font-size: 11.5px; font-weight: 800; color: #ffd166; letter-spacing: 1.5px; margin-bottom: 2px;">✦ 8 / 8 CELESTIAL SINGULARITY ✦</div>
        <div style="font-size: 9.5px; color: #a7f3d0; line-height: 1.2;">AWAKENED COSMIC FORGE</div>
      `;
      forgeBtn.disabled = false;
      forgeBtn.classList.remove('btn-forge-disabled');
      forgeBtn.textContent = '⚡ FORGE THE 9TH CELESTIAL CROWN ⚡';
      forgeBtn.style.background = 'linear-gradient(135deg, #ffd166, #d4af37)';
      forgeBtn.style.color = '#020306';
      forgeBtn.style.border = '1px solid #ffffff';
      forgeBtn.style.fontWeight = '800';
    }

    // Update Galaxy Jump info
    const sacrificeInfo = this.element.querySelector('.galaxy-jump-info') as HTMLElement;
    const standardCount = meta.Helmets.length;
    if (sacrificeInfo) {
      sacrificeInfo.textContent = `Sacrifice Ready: ${standardCount} standard helmets available`;
      sacrificeInfo.style.display = 'block';
    }

    const alertEl = this.element.querySelector('.galaxy-jump-alert') as HTMLElement;
    if (alertEl) {
      alertEl.style.display = 'none';
    }
  }

  /**
   * Completely tears down animations, active warp overlays, and WebGL ring renderer.
   */
  public destroy(): void {
    this.hide();
    this.stopAnimationLoop();
    if (this.ringRenderer) {
      try {
        this.ringRenderer.destroy();
      } catch {}
    }
    if (this.element && this.element.parentElement) {
      try {
        this.element.parentElement.removeChild(this.element);
      } catch {}
    }
  }

  public dispose(): void {
    this.destroy();
  }
}
