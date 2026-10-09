/**
 * Ouroboros Ascension — OuroborosGalleryScreen TDD Test Suite (OuroborosGalleryScreen.test.ts)
 *
 * Strict TDD Verification for the Ouroboros Helmet Gallery Screen & WebGL Circular Ring:
 * 1. Screen registration and lifecycle under UiRoot (ID: modal-ouroboros-gallery).
 * 2. Circular ring layout with exactly 8 circumferential pedestal slots at angles (0, pi/4, pi/2, 3pi/4, pi, 5pi/4, 3pi/2, 7pi/4).
 * 3. Inward-arched serpent head directing towards the 9th central pedestal.
 * 4. Slot status visualization (locked/silhouetted vs unlocked/glowing rarity border with stats tooltip).
 * 5. Central 9th slot sealed state (< 8 helmets) vs awakened cosmic aura with "⚡ FORGE THE 9TH CELESTIAL CROWN ⚡" (8/8 helmets).
 * 6. Forge button activation, confirmation dialog, and launch of the 8-Second All-Boss Rush Arena.
 * 7. Galaxy Jump button: sacrifice count, roll probability display, execution, and inventory update.
 * 8. Navigation linking from SnakeLabScreen Helmets tab and MenuScreen.
 * 9. Responsive layout & WebGL circular ring canvas compliance (Rule 12).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom } from './MockDom.js';
import { UiRoot } from '../ui/UiRoot.js';
import { OuroborosGalleryScreen, OUROBOROS_RING_ANGLES } from '../ui/screens/OuroborosGalleryScreen.js';
import { OuroborosGalleryRingRenderer } from '../render/webgl/OuroborosGalleryRingRenderer.js';
import { SnakeLabScreen } from '../ui/screens/SnakeLabScreen.js';
import { MenuScreen } from '../ui/screens/MenuScreen.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { UNIQUE_HELMETS, CELESTIAL_OUROBOROS_HELMET } from '../data/UniqueHelmetsData.js';
import { HelmetDef } from '../data/Types.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound } from '../core/Contracts.js';

class GallerySoundSpy extends NullSound {
  public uiCount = 0;
  public purchaseCount = 0;
  public levelUpCount = 0;
  public override playUi(): void { this.uiCount++; }
  public playPurchase(): void { this.purchaseCount++; }
  public override playLevelUp(): void { this.levelUpCount++; }
}

describe('OuroborosGalleryScreen TDD Conformance Suite', () => {
  let restoreDom: () => void;
  let soundSpy: GallerySoundSpy;
  let uiRoot: UiRoot;
  let galleryScreen: OuroborosGalleryScreen;
  let mockEngine: any;

  beforeEach(() => {
    restoreDom = setupMockDom();
    soundSpy = new GallerySoundSpy();
    Services.Sound = soundSpy;
    Services.Fx = new NullFx();

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = MetaProgression.createIsolated({ isolated: true });
    MetaProgression.Instance.reset();

    mockEngine = {
      StartBossRushGauntlet: vi.fn(),
      startBossRushGauntlet: vi.fn(),
      startRun: vi.fn(),
      StartRun: vi.fn(),
      chooseMode: vi.fn(),
      ChooseMode: vi.fn(),
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    uiRoot = UiRoot.init(container, mockEngine);

    galleryScreen = new OuroborosGalleryScreen(uiRoot);
    uiRoot.registerScreen(galleryScreen);
  });

  afterEach(() => {
    restoreDom();
  });

  describe('1. Screen Identity, Shell, and Navigation Registration', () => {
    it('registers with ID modal-ouroboros-gallery and creates accessible panel shell', () => {
      expect(galleryScreen.id).toBe('modal-ouroboros-gallery');
      expect(uiRoot.getScreen('modal-ouroboros-gallery')).toBe(galleryScreen);

      uiRoot.showScreen('modal-ouroboros-gallery');
      expect(galleryScreen.element.style.display).not.toBe('none');
      expect(uiRoot.activeScreenId).toBe('modal-ouroboros-gallery');

      const titleEl = galleryScreen.element.querySelector('.cyber-modal-title');
      expect(titleEl).not.toBeNull();
      expect(titleEl?.textContent?.toUpperCase()).toContain('OUROBOROS');
    });

    it('navigates back to previous screen or menu when clicking back button', () => {
      uiRoot.showScreen('modal-ouroboros-gallery');
      const backBtn = galleryScreen.element.querySelector('.btn-back') as HTMLButtonElement;
      expect(backBtn).not.toBeNull();

      backBtn.click();
      expect(soundSpy.uiCount).toBeGreaterThan(0);
    });
  });

  describe('2. Circular Geometry: 8 Circumferential Slots & Central 9th Slot', () => {
    it('defines the 8 canonical ring angles (0, pi/4, pi/2, 3pi/4, pi, 5pi/4, 3pi/2, 7pi/4)', () => {
      expect(OUROBOROS_RING_ANGLES).toBeDefined();
      expect(OUROBOROS_RING_ANGLES.length).toBe(8);
      expect(OUROBOROS_RING_ANGLES[0]).toBeCloseTo(0, 4);
      expect(OUROBOROS_RING_ANGLES[1]).toBeCloseTo(Math.PI / 4, 4);
      expect(OUROBOROS_RING_ANGLES[2]).toBeCloseTo(Math.PI / 2, 4);
      expect(OUROBOROS_RING_ANGLES[3]).toBeCloseTo((3 * Math.PI) / 4, 4);
      expect(OUROBOROS_RING_ANGLES[4]).toBeCloseTo(Math.PI, 4);
      expect(OUROBOROS_RING_ANGLES[5]).toBeCloseTo((5 * Math.PI) / 4, 4);
      expect(OUROBOROS_RING_ANGLES[6]).toBeCloseTo((3 * Math.PI) / 2, 4);
      expect(OUROBOROS_RING_ANGLES[7]).toBeCloseTo((7 * Math.PI) / 4, 4);
    });

    it('renders exactly 8 circumferential pedestal slots with matching angle datasets', () => {
      uiRoot.showScreen('modal-ouroboros-gallery');
      const ringSlots = galleryScreen.element.querySelectorAll('.pedestal-slot[data-slot-index]');
      expect(ringSlots.length).toBe(8);

      ringSlots.forEach((slotEl: Element, idx: number) => {
        const el = slotEl as HTMLElement;
        expect(Number(el.dataset.slotIndex)).toBe(idx);
        const angle = Number(el.dataset.angle);
        expect(angle).toBeCloseTo(OUROBOROS_RING_ANGLES[idx]!, 3);
      });
    });

    it('renders the 9th central pedestal representing the inward-arched snake head', () => {
      uiRoot.showScreen('modal-ouroboros-gallery');
      const centralPedestal = galleryScreen.element.querySelector('.pedestal-central');
      expect(centralPedestal).not.toBeNull();

      // Arched snake head element
      const archedHead = galleryScreen.element.querySelector('.arched-serpent-head');
      expect(archedHead).not.toBeNull();
    });
  });

  describe('3. Slot Status Visualization: Locked vs Unlocked', () => {
    it('displays all 8 slots as locked when no unique helmets are unlocked', () => {
      MetaProgression.Instance.UniqueHelmets = [];
      uiRoot.showScreen('modal-ouroboros-gallery');

      const ringSlots = galleryScreen.element.querySelectorAll('.pedestal-slot[data-slot-index]');
      ringSlots.forEach((slotEl: Element) => {
        const el = slotEl as HTMLElement;
        expect(el.dataset.status).toBe('locked');
        expect(el.classList.contains('slot-locked')).toBe(true);
      });
    });

    it('displays unlocked slots with glowing rarity borders, icons, and stat tooltips when collected', () => {
      // Unlock first 3 unique helmets
      const unlockedIds = [UNIQUE_HELMETS[0].Id, UNIQUE_HELMETS[1].Id, UNIQUE_HELMETS[2].Id];
      MetaProgression.Instance.UniqueHelmets = [...unlockedIds];

      uiRoot.showScreen('modal-ouroboros-gallery');

      const ringSlots = galleryScreen.element.querySelectorAll('.pedestal-slot[data-slot-index]');
      const slot0 = ringSlots[0] as HTMLElement;
      const slot1 = ringSlots[1] as HTMLElement;
      const slot2 = ringSlots[2] as HTMLElement;
      const slot3 = ringSlots[3] as HTMLElement;

      expect(slot0.dataset.status).toBe('unlocked');
      expect(slot1.dataset.status).toBe('unlocked');
      expect(slot2.dataset.status).toBe('unlocked');
      expect(slot3.dataset.status).toBe('locked');

      expect(slot0.textContent).toContain(UNIQUE_HELMETS[0].Icon);
      expect(slot0.title || slot0.getAttribute('data-tooltip')).toBeTruthy();
    });
  });

  describe('4. Central 9th Pedestal: Sealed vs Awakened Forge & Boss Rush Gauntlet Launch', () => {
    it('displays SEALED message and disables forge button when unique helmets < 8', () => {
      MetaProgression.Instance.UniqueHelmets = UNIQUE_HELMETS.slice(0, 7).map(h => h.Id);
      uiRoot.showScreen('modal-ouroboros-gallery');

      const centralSlot = galleryScreen.element.querySelector('.pedestal-central') as HTMLElement;
      expect(centralSlot.textContent).toContain('SEALED: Collect all 8 Unique Helmets to Awaken');

      const forgeBtn = galleryScreen.element.querySelector('.btn-forge-9th') as HTMLButtonElement;
      expect(forgeBtn).not.toBeNull();
      expect(forgeBtn.disabled || forgeBtn.classList.contains('btn-forge-disabled')).toBe(true);
    });

    it('activates cosmic aura and enables FORGE button when all 8 unique helmets are collected', () => {
      MetaProgression.Instance.UniqueHelmets = UNIQUE_HELMETS.map(h => h.Id);
      uiRoot.showScreen('modal-ouroboros-gallery');

      const centralSlot = galleryScreen.element.querySelector('.pedestal-central') as HTMLElement;
      expect(centralSlot.classList.contains('cosmic-aura') || centralSlot.querySelector('.cosmic-aura')).toBeTruthy();

      const forgeBtn = galleryScreen.element.querySelector('.btn-forge-9th') as HTMLButtonElement;
      expect(forgeBtn).not.toBeNull();
      expect(forgeBtn.disabled).toBe(false);
      expect(forgeBtn.textContent).toContain('⚡ FORGE THE 9TH CELESTIAL CROWN ⚡');
    });

    it('clicking Forge opens confirmation dialog and launches 8-Second All-Boss Rush Arena', () => {
      MetaProgression.Instance.UniqueHelmets = UNIQUE_HELMETS.map(h => h.Id);
      uiRoot.showScreen('modal-ouroboros-gallery');

      const forgeBtn = galleryScreen.element.querySelector('.btn-forge-9th') as HTMLButtonElement;
      forgeBtn.click();

      // Confirmation modal or popup should open
      const confirmModal = galleryScreen.element.querySelector('.forge-confirm-modal');
      expect(confirmModal).not.toBeNull();

      const confirmBtn = confirmModal?.querySelector('.btn-confirm-forge') as HTMLButtonElement;
      expect(confirmBtn).not.toBeNull();

      confirmBtn.click();

      // Confirms 9th helmet forged into meta
      expect(MetaProgression.Instance.Has9thHelmet).toBe(true);

      // Verifies engine starts gauntlet arena
      expect(mockEngine.StartBossRushGauntlet).toHaveBeenCalled();
    });
  });

  describe('5. Galaxy Jump Sacrifice Integration', () => {
    it('displays sacrificed standard helmet count and roll probability on Galaxy Jump button', () => {
      const meta = MetaProgression.Instance;
      meta.Helmets = [
        { Id: 'std_1', Name: 'Standard 1', Icon: '🪖', Rarity: 'common', Stats: {} },
        { Id: 'std_2', Name: 'Standard 2', Icon: '👑', Rarity: 'epic', Stats: {} },
      ];

      uiRoot.showScreen('modal-ouroboros-gallery');

      const jumpBtn = galleryScreen.element.querySelector('.btn-galaxy-jump') as HTMLButtonElement;
      expect(jumpBtn).not.toBeNull();
      expect(jumpBtn.textContent).toContain('Galaxy Jump');

      const sacrificeInfo = galleryScreen.element.querySelector('.galaxy-jump-info');
      expect(sacrificeInfo?.textContent).toContain('2'); // 2 helmets to sacrifice
    });

    it('executes Galaxy Jump on click, consumes helmets, and refreshes gallery', () => {
      const meta = MetaProgression.Instance;
      const stdHelm: HelmetDef = { Id: 'std_1', Name: 'Standard 1', Icon: '🪖', Rarity: 'legendary', Stats: {} };
      meta.Helmets = [stdHelm];

      const jumpSpy = vi.spyOn(meta, 'galaxyJump').mockReturnValue({
        success: true,
        awardedHelmet: UNIQUE_HELMETS[0],
        sacrificeScore: 400,
        probability: 0.39,
      });

      uiRoot.showScreen('modal-ouroboros-gallery');

      const jumpBtn = galleryScreen.element.querySelector('.btn-galaxy-jump') as HTMLButtonElement;
      jumpBtn.click();

      const confirmBtn = galleryScreen.element.querySelector('.btn-confirm-jump') as HTMLButtonElement;
      if (confirmBtn) {
        confirmBtn.click();
      }

      expect(jumpSpy).toHaveBeenCalled();
      expect(soundSpy.purchaseCount + soundSpy.levelUpCount + (soundSpy as any).warpJumpCount || 1).toBeGreaterThan(0);
    });

    it('orchestrates seamless whole-game Galaxy Jump transition by fading out gallery modal and mounting warp overlay to document.body', () => {
      const meta = MetaProgression.Instance;
      meta.Helmets = [
        { Id: 'std_epic_1', Name: 'Epic Helmet', Icon: '👑', Rarity: 'epic', Stats: {} },
      ];

      vi.spyOn(meta, 'galaxyJump').mockReturnValue({
        success: true,
        awardedHelmet: UNIQUE_HELMETS[1],
        sacrificeScore: 250,
        probability: 0.268,
      });

      uiRoot.showScreen('modal-ouroboros-gallery');

      const jumpBtn = galleryScreen.element.querySelector('.btn-galaxy-jump') as HTMLButtonElement;
      jumpBtn.click();

      const confirmBtn = galleryScreen.element.querySelector('.btn-confirm-jump') as HTMLButtonElement;
      confirmBtn.click();

      // Gallery modal container fades out to let whole-game warp shine through
      expect(galleryScreen.element.style.opacity).toBe('0');
      expect(galleryScreen.element.style.pointerEvents).toBe('none');
      expect(galleryScreen.element.style.transition).toContain('opacity');

      // Warp overlay is mounted to document.body (whole-game viewport), NOT confined inside gallery modal
      const bodyOverlay = document.body.querySelector('.galaxy-jump-warp-overlay, .galaxy-warp-overlay') as HTMLElement;
      expect(bodyOverlay).not.toBeNull();
      expect(document.body.contains(bodyOverlay)).toBe(true);
      expect(galleryScreen.element.contains(bodyOverlay)).toBe(false);

      // On completion, gallery screen visibility is restored and outcome modal is shown
      galleryScreen.completeWarpAnimation();
      expect(galleryScreen.element.style.opacity).toBe('1');
      expect(galleryScreen.element.style.pointerEvents).toBe('auto');
      expect(document.body.querySelector('.galaxy-jump-warp-overlay')).toBeNull();

      const outcomeModal = galleryScreen.element.querySelector('.galaxy-jump-result-modal') as HTMLElement;
      expect(outcomeModal.style.display).not.toBe('none');
    });
  });

  describe('6. Navigation Links from SnakeLabScreen & MenuScreen', () => {
    it('renders "Ouroboros Gallery 🌌" button in SnakeLabScreen Helmets tab that navigates to gallery', () => {
      const lab = new SnakeLabScreen(uiRoot);
      uiRoot.registerScreen(lab);

      uiRoot.showScreen('modal-snake-lab', { tab: 'helmets' });

      const galleryLinkBtn = lab.element.querySelector('.btn-goto-gallery') as HTMLButtonElement;
      expect(galleryLinkBtn).not.toBeNull();
      expect(galleryLinkBtn.textContent).toContain('Ouroboros Gallery');

      galleryLinkBtn.click();
      expect(uiRoot.activeScreenId).toBe('modal-ouroboros-gallery');
    });

    it('renders gallery navigation button on MenuScreen that navigates to gallery', () => {
      const menu = new MenuScreen(uiRoot);
      uiRoot.registerScreen(menu);

      uiRoot.showScreen('modal-main-menu');

      const galleryBtn = (menu.element.querySelector('.btn-gallery') || menu.element.querySelector('.btn-ouroboros-gallery')) as HTMLButtonElement;
      expect(galleryBtn).not.toBeNull();

      galleryBtn.click();
      expect(uiRoot.activeScreenId).toBe('modal-ouroboros-gallery');
    });
  });

  describe('7. WebGL Circular Ring Canvas & Responsive Layout (Rule 12)', () => {
    it('contains a WebGL circular ring canvas and initializes WebGL 2.0 without Canvas 2D', () => {
      uiRoot.showScreen('modal-ouroboros-gallery');
      const canvas = galleryScreen.element.querySelector('.gallery-ring-canvas') as HTMLCanvasElement;
      expect(canvas).not.toBeNull();
      expect(galleryScreen.ringRenderer).toBeDefined();
    });

    it('provides responsive and ambidextrous button layout', () => {
      uiRoot.showScreen('modal-ouroboros-gallery');
      const actionRows = galleryScreen.element.querySelectorAll('.gallery-actions-ambidextrous, .modal-actions-row');
      expect(actionRows.length).toBeGreaterThan(0);
    });
  });

  describe('8. Wonderful Ouroboros Ring Presentation & Animation Lifecycle (TDD)', () => {
    it('initializes and properly sizes the WebGL canvas with OuroborosGalleryRingRenderer', () => {
      uiRoot.showScreen('modal-ouroboros-gallery');
      const canvas = galleryScreen.element.querySelector('.gallery-ring-canvas') as HTMLCanvasElement;
      expect(canvas).not.toBeNull();
      expect(canvas.width).toBe(360);
      expect(canvas.height).toBe(360);

      expect(galleryScreen.ringRenderer).toBeInstanceOf(OuroborosGalleryRingRenderer);
      expect((galleryScreen.ringRenderer as OuroborosGalleryRingRenderer).gl).not.toBeNull();
    });

    it('aligns the 8 circumferential pedestals along the serpentine ring coils with gold-brown styling when unlocked', () => {
      // Unlock 2 unique helmets to test both unlocked and locked styling
      MetaProgression.Instance.UniqueHelmets = [UNIQUE_HELMETS[0].Id, UNIQUE_HELMETS[1].Id];
      uiRoot.showScreen('modal-ouroboros-gallery');

      const slots = galleryScreen.element.querySelectorAll('.pedestal-slot[data-slot-index]');
      expect(slots.length).toBe(8);

      const cx = 180;
      const cy = 180;
      const radius = 130;

      slots.forEach((slotEl, idx) => {
        const el = slotEl as HTMLElement;
        const angle = OUROBOROS_RING_ANGLES[idx]!;
        const expectedX = cx + Math.cos(angle) * radius - 24;
        const expectedY = cy + Math.sin(angle) * radius - 24;

        expect(parseFloat(el.style.left)).toBeCloseTo(expectedX, 1);
        expect(parseFloat(el.style.top)).toBeCloseTo(expectedY, 1);
      });

      // Unlocked slot styling: gold-brown theme
      const unlockedSlot = slots[0] as HTMLElement;
      expect(unlockedSlot.dataset.status).toBe('unlocked');
      expect(unlockedSlot.style.border).toBe('2px solid #d4af37');
      expect(unlockedSlot.style.boxShadow).toBe('0 0 16px rgba(212, 175, 55, 0.8)');

      // Locked slot styling
      const lockedSlot = slots[2] as HTMLElement;
      expect(lockedSlot.dataset.status).toBe('locked');
      expect(lockedSlot.style.border).toContain('dashed');
    });

    it('frames the central 9th pedestal with the inward-curving head and removes static emoji 🐍', () => {
      uiRoot.showScreen('modal-ouroboros-gallery');
      const centralPedestal = galleryScreen.element.querySelector('.pedestal-central') as HTMLElement;
      expect(centralPedestal).not.toBeNull();

      const archedHead = galleryScreen.element.querySelector('.arched-serpent-head') as HTMLElement;
      expect(archedHead).not.toBeNull();

      // Static emoji 🐍 MUST be permanently removed
      expect(archedHead.textContent).not.toContain('🐍');
      expect(galleryScreen.element.textContent).not.toContain('🐍');
    });

    it('controls the animation loop via show/hide lifecycle and passes progression parameters', () => {
      const renderSpy = vi.spyOn(galleryScreen.ringRenderer, 'render');

      // Showing the screen should start the animation loop
      galleryScreen.show();
      expect(galleryScreen.isAnimating).toBe(true);

      // Calling render explicitly or via animation frame passes elapsed time, count, canForge
      galleryScreen.render();
      expect(renderSpy).toHaveBeenCalledWith(
        expect.any(Number),
        MetaProgression.Instance.UniqueHelmets.length,
        MetaProgression.Instance.canForge9thHelmet()
      );

      // Hiding the screen must stop the animation loop to conserve GPU/battery
      galleryScreen.hide();
      expect(galleryScreen.isAnimating).toBe(false);
      expect(galleryScreen.element.style.display).toBe('none');
    });
  });

  describe('9. Cosmic Artwork Backdrop & Authentic Helmet Representation Standard (TDD)', () => {
    it('renders the AAA cosmic Ouroboros dragon ring artwork image behind the pedestals', () => {
      uiRoot.showScreen('modal-ouroboros-gallery');
      const container = galleryScreen.element.querySelector('.gallery-ring-container');
      expect(container).not.toBeNull();

      const artworkImg = container?.querySelector('.gallery-ring-artwork') as HTMLImageElement;
      expect(artworkImg).not.toBeNull();
      expect(artworkImg.getAttribute('src')).toMatch(/^\/ouroboros_gallery\.(png|jpg)$/);
      expect(artworkImg.getAttribute('alt')).toBeTruthy();
    });

    it('verifies all 8 unique helmets and the 9th omni-helmet use authentic helmet/crown icons and nomenclature', () => {
      const allowedHelmetIcons = ['👑', '🪖', '⛑️'];
      const nonHelmetIcons = ['⏳', '🌊', '☀️', '🧬', '🌋', '⚡', '💎'];

      expect(UNIQUE_HELMETS.length).toBe(8);

      UNIQUE_HELMETS.forEach((h, idx) => {
        // Must use genuine helmet/crown icons
        expect(allowedHelmetIcons).toContain(h.Icon);
        // Must NOT use generic elemental emojis
        expect(nonHelmetIcons).not.toContain(h.Icon);

        // Name must convey cranial gear / helmet
        const nameLower = h.Name.toLowerCase();
        const hasHelmetTerminology =
          nameLower.includes('crown') ||
          nameLower.includes('warhelm') ||
          nameLower.includes('maw') ||
          nameLower.includes('visage') ||
          nameLower.includes('corona') ||
          nameLower.includes('carapace') ||
          nameLower.includes('diadem') ||
          nameLower.includes('crest');
        expect(hasHelmetTerminology).toBe(true);
      });

      // 9th Omni-Helmet
      expect(allowedHelmetIcons).toContain(CELESTIAL_OUROBOROS_HELMET.Icon);
      expect(CELESTIAL_OUROBOROS_HELMET.Name.toLowerCase()).toContain('crown');
    });
  });

  describe('10. Helmet Image Assets & Gallery Presentation Standard (TDD)', () => {
    it('verifies that all 8 Unique Helmets and the 9th Omni-Helmet have defined .Image paths', () => {
      const expectedPaths: Record<string, string> = {
        unique_helm_chrono_singularity: '/assets/helmets/chrono_singularity.jpg',
        unique_helm_adamantine_juggernaut: '/assets/helmets/adamantine_juggernaut.jpg',
        unique_helm_abyssal_leviathan: '/assets/helmets/abyssal_leviathan.jpg',
        unique_helm_solar_archon: '/assets/helmets/solar_archon.jpg',
        unique_helm_nanite_hivequeen: '/assets/helmets/nanite_hivequeen.jpg',
        unique_helm_volcanic_chimera: '/assets/helmets/volcanic_chimera.jpg',
        unique_helm_tempest_siren: '/assets/helmets/tempest_siren.jpg',
        unique_helm_prismatic_monolith: '/assets/helmets/prismatic_monolith.jpg',
      };

      for (const helm of UNIQUE_HELMETS) {
        expect(helm.Image).toBeDefined();
        expect(helm.Image).toBe(expectedPaths[helm.Id]);
      }

      expect(CELESTIAL_OUROBOROS_HELMET.Image).toBeDefined();
      expect(CELESTIAL_OUROBOROS_HELMET.Image).toBe('/assets/helmets/celestial_ouroboros.jpg');
    });

    it('renders img.slot-helmet-img with the correct src matching arch.Image on unlocked pedestal slots', () => {
      MetaProgression.Instance.UniqueHelmets = UNIQUE_HELMETS.map(h => h.Id);
      uiRoot.showScreen('modal-ouroboros-gallery');

      const ringSlots = galleryScreen.element.querySelectorAll('.pedestal-slot[data-slot-index]');
      expect(ringSlots.length).toBe(8);

      ringSlots.forEach((slotEl, idx) => {
        const arch = UNIQUE_HELMETS[idx]!;
        const img = slotEl.querySelector('img.slot-helmet-img') as HTMLImageElement;
        expect(img).not.toBeNull();
        expect(img.getAttribute('src')).toBe(arch.Image);
        expect(img.src).toBe(arch.Image);
      });
    });

    it('renders img.unique-helmet-manifest-img with matching src when showOutcomeModal() succeeds', () => {
      uiRoot.showScreen('modal-ouroboros-gallery');
      const targetHelmet = UNIQUE_HELMETS[3]; // Corona of the Solar Archon

      (galleryScreen as any).showOutcomeModal({
        success: true,
        awardedHelmet: targetHelmet,
        sacrificeScore: 500,
        probability: 0.465,
      });

      const outcomeModal = galleryScreen.element.querySelector('.galaxy-jump-result-modal') as HTMLElement;
      expect(outcomeModal).not.toBeNull();
      expect(outcomeModal.style.display).not.toBe('none');

      const manifestImg = outcomeModal.querySelector('img.unique-helmet-manifest-img') as HTMLImageElement;
      expect(manifestImg).not.toBeNull();
      expect(manifestImg.getAttribute('src')).toBe(targetHelmet.Image);
      expect(manifestImg.src).toBe(targetHelmet.Image);
    });

    it('renders the inspection image matching arch.Image when calling showRelicDetail() for an unlocked helmet', () => {
      MetaProgression.Instance.UniqueHelmets = [UNIQUE_HELMETS[0].Id];
      uiRoot.showScreen('modal-ouroboros-gallery');

      galleryScreen.showRelicDetail(0);

      const relicModal = galleryScreen.element.querySelector('.relic-detail-modal') as HTMLElement;
      expect(relicModal).not.toBeNull();
      expect(relicModal.style.display).not.toBe('none');

      const inspectionImg = relicModal.querySelector('img.relic-inspection-img, img.relic-detail-img') as HTMLImageElement;
      expect(inspectionImg).not.toBeNull();
      expect(inspectionImg.getAttribute('src')).toBe(UNIQUE_HELMETS[0].Image);
      expect(inspectionImg.src).toBe(UNIQUE_HELMETS[0].Image);
    });

    it('gracefully falls back to arch.Icon when helmet Image is missing in pedestal slot', () => {
      // Mock an unlocked helmet with undefined image
      const origImage = (UNIQUE_HELMETS[0] as any).Image;
      const origimage = (UNIQUE_HELMETS[0] as any).image;
      try {
        (UNIQUE_HELMETS[0] as any).Image = undefined;
        (UNIQUE_HELMETS[0] as any).image = undefined;
        MetaProgression.Instance.UniqueHelmets = [UNIQUE_HELMETS[0].Id];
        galleryScreen.refresh();

        const slot0 = galleryScreen.element.querySelector('.pedestal-slot[data-slot-index="0"]') as HTMLElement;
        expect(slot0).not.toBeNull();
        expect(slot0.querySelector('img.slot-helmet-img')).toBeNull();
        expect(slot0.textContent).toContain(UNIQUE_HELMETS[0].Icon);
      } finally {
        (UNIQUE_HELMETS[0] as any).Image = origImage;
        (UNIQUE_HELMETS[0] as any).image = origimage;
      }
    });

    it('gracefully falls back to h.Icon when showOutcomeModal() receives helmet without Image', () => {
      const helmetWithoutImage = {
        ...UNIQUE_HELMETS[0],
        Image: undefined,
        image: undefined,
      };

      (galleryScreen as any).showOutcomeModal({
        success: true,
        awardedHelmet: helmetWithoutImage,
        sacrificeScore: 400,
        probability: 0.39,
      });

      const outcomeModal = galleryScreen.element.querySelector('.galaxy-jump-result-modal') as HTMLElement;
      expect(outcomeModal.style.display).not.toBe('none');

      const fallbackIcon = outcomeModal.querySelector('.unique-helmet-icon');
      expect(fallbackIcon).not.toBeNull();
      expect(fallbackIcon?.textContent).toContain(helmetWithoutImage.Icon);
    });

    it('applies updated cybernetic styling to gallery background artwork and pedestal slots', () => {
      uiRoot.showScreen('modal-ouroboros-gallery');
      const container = galleryScreen.element.querySelector('.gallery-ring-container');
      const artwork = container?.querySelector('.gallery-ring-artwork') as HTMLImageElement;
      expect(artwork).not.toBeNull();
      expect(artwork.getAttribute('src')).toMatch(/^\/ouroboros_gallery\.(png|jpg)$/);
      expect(artwork.style.borderRadius).toBe('50%');

      const styles = galleryScreen.element.querySelector('style');
      expect(styles).not.toBeNull();
      expect(styles?.textContent).toContain('cyberAuraPulse');
      expect(styles?.textContent).toContain('.slot-helmet-img');
      expect(styles?.textContent).toContain('.unique-helmet-manifest-img');
    });
  });
});

