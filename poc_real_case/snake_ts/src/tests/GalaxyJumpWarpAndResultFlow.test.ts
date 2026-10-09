/**
 * Ouroboros Ascension — Galaxy Jump Confirmation, Warp Orchestration, and Result Flow TDD Suite
 * (GalaxyJumpWarpAndResultFlow.test.ts)
 *
 * Verifies under strict TDD:
 * 1. Clicking Galaxy Jump with 0 helmets shows informative alert/toast and does NOT open confirm modal.
 * 2. Clicking Galaxy Jump with standard helmets opens Confirmation Modal (.galaxy-jump-confirm-modal)
 *    displaying count, calculated sacrifice score, and transcendence chance (P = 1 - exp(-S/800)).
 * 3. Canceling/aborting jump closes confirm modal without consuming helmets.
 * 4. Confirming jump triggers sound, activates full-screen warp overlay (.galaxy-warp-overlay),
 *    and executes meta.galaxyJump().
 * 5. On SUCCESS: displays Outcome Modal (.galaxy-jump-result-modal) featuring Gold-Brown cosmic card,
 *    unlocked helmet icon, name, "UNIQUE MYTHIC" tag, capacity, lore, and claim button (.btn-claim-helmet).
 * 6. On FAILURE: displays outcome modal with collapsed rift void message, probability, and dismiss button (.btn-dismiss-result).
 * 7. Claiming dismisses outcome modal and refreshes ring pedestals with distinctive Gold-Brown styling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMockDom } from './MockDom.js';
import { UiRoot } from '../ui/UiRoot.js';
import { OuroborosGalleryScreen } from '../ui/screens/OuroborosGalleryScreen.js';
import { MetaProgression } from '../data/MetaProgression.js';
import { UNIQUE_HELMETS, CELESTIAL_OUROBOROS_HELMET } from '../data/UniqueHelmetsData.js';
import { HelmetDef } from '../data/Types.js';
import { Services } from '../core/Services.js';
import { NullFx, NullSound } from '../core/Contracts.js';

class WarpSoundSpy extends NullSound {
  public uiCount = 0;
  public warpJumpCount = 0;
  public revealCount = 0;
  public voidCollapseCount = 0;
  public levelUpCount = 0;

  public override playUi(): void { this.uiCount++; }
  public override playLevelUp(): void { this.levelUpCount++; }
  public playWarpJump(): void { this.warpJumpCount++; }
  public playUniqueHelmetReveal(): void { this.revealCount++; }
  public playVoidCollapse(): void { this.voidCollapseCount++; }
}

describe('Galaxy Jump Confirmation Modal, Warp Orchestration & Gold-Brown Outcome Screen', () => {
  let restoreDom: () => void;
  let soundSpy: WarpSoundSpy;
  let uiRoot: UiRoot;
  let galleryScreen: OuroborosGalleryScreen;

  beforeEach(() => {
    restoreDom = setupMockDom();
    soundSpy = new WarpSoundSpy();
    Services.Sound = soundSpy;
    Services.Fx = new NullFx();

    MetaProgression.readBackend = () => null;
    MetaProgression.writeBackend = () => {};
    MetaProgression.deleteBackend = () => {};
    MetaProgression.instance = MetaProgression.createIsolated({ isolated: true });
    MetaProgression.Instance.reset();

    const container = document.createElement('div');
    document.body.appendChild(container);
    uiRoot = UiRoot.init(container);

    galleryScreen = new OuroborosGalleryScreen(uiRoot);
    uiRoot.registerScreen(galleryScreen);
    uiRoot.showScreen('modal-ouroboros-gallery');
  });

  afterEach(() => {
    restoreDom();
  });

  it('1. Clicking Galaxy Jump button with 0 helmets shows informative message and does not open confirmation', () => {
    const meta = MetaProgression.Instance;
    meta.Helmets = [];
    galleryScreen.refresh();

    const jumpBtn = galleryScreen.element.querySelector('.btn-galaxy-jump') as HTMLButtonElement;
    expect(jumpBtn).not.toBeNull();

    jumpBtn.click();

    const confirmModal = galleryScreen.element.querySelector('.galaxy-jump-confirm-modal') as HTMLElement;
    expect(confirmModal === null || confirmModal.style.display === 'none' || !confirmModal.classList.contains('active')).toBe(true);

    const alertEl = galleryScreen.element.querySelector('.galaxy-jump-alert, .galaxy-jump-toast, .galaxy-jump-info');
    expect(alertEl).not.toBeNull();
    expect(alertEl?.textContent).toContain('No standard helmets available to sacrifice');
  });

  it('2. Clicking Galaxy Jump button with helmets opens confirmation modal with accurate helmet count, gauge, and chance wheel', () => {
    const meta = MetaProgression.Instance;
    meta.Helmets = [
      { Id: 'helm_epic_1', Name: 'Epic Helm', Icon: '👑', Rarity: 'epic', Stats: {} },
      { Id: 'helm_legendary_1', Name: 'Legendary Helm', Icon: '🔱', Rarity: 'legendary', Stats: {} },
    ];
    galleryScreen.refresh();

    const jumpBtn = galleryScreen.element.querySelector('.btn-galaxy-jump') as HTMLButtonElement;
    jumpBtn.click();

    const confirmModal = galleryScreen.element.querySelector('.galaxy-jump-confirm-modal') as HTMLElement;
    expect(confirmModal).not.toBeNull();
    expect(confirmModal.style.display).not.toBe('none');

    // Header & Subtitle
    expect(confirmModal.textContent).toContain('INITIATE GALAXY JUMP RITUAL');
    expect(confirmModal.textContent).toContain('Sacrifice standard boss helmets to bend spacetime into a new galaxy');

    // Energy Reactor Gauge
    const reactorGauge = confirmModal.querySelector('.energy-reactor-gauge');
    expect(reactorGauge).not.toBeNull();

    // Holographic Probability Wheel
    const probWheel = confirmModal.querySelector('.holographic-probability-wheel');
    expect(probWheel).not.toBeNull();

    // Sacrificed Helmets Tray with individual helmet chips
    const tray = confirmModal.querySelector('.sacrificed-helmets-tray');
    expect(tray).not.toBeNull();
    const chips = tray?.querySelectorAll('.sacrificed-helmet-chip');
    expect(chips?.length).toBe(2);

    // Score: epic (250) + legendary (400) = 650
    // Probability: 1 - exp(-650 / 800) = 1 - exp(-0.8125) = ~55.6%
    const countEl = confirmModal.querySelector('.sacrifice-count');
    expect(countEl?.textContent).toContain('2');

    const scoreEl = confirmModal.querySelector('.sacrifice-score');
    expect(scoreEl?.textContent).toContain('650');

    const chanceEl = confirmModal.querySelector('.transcendence-chance');
    expect(chanceEl?.textContent).toMatch(/55\.[56]%/);

    const warningEl = confirmModal.querySelector('.sacrifice-warning');
    expect(warningEl?.textContent).toContain('permanently consumed');
  });

  it('3. Canceling jump closes confirmation modal without calling galaxyJump', () => {
    const meta = MetaProgression.Instance;
    meta.Helmets = [
      { Id: 'helm_common_1', Name: 'Scrap Helm', Icon: '🪖', Rarity: 'common', Stats: {} },
    ];
    const jumpSpy = vi.spyOn(meta, 'galaxyJump');
    galleryScreen.refresh();

    const jumpBtn = galleryScreen.element.querySelector('.btn-galaxy-jump') as HTMLButtonElement;
    jumpBtn.click();

    const confirmModal = galleryScreen.element.querySelector('.galaxy-jump-confirm-modal') as HTMLElement;
    const cancelBtn = confirmModal.querySelector('.btn-cancel-jump') as HTMLButtonElement;
    expect(cancelBtn).not.toBeNull();

    cancelBtn.click();

    expect(confirmModal.style.display).toBe('none');
    expect(jumpSpy).not.toHaveBeenCalled();
    expect(meta.Helmets.length).toBe(1);
  });

  it('4. Confirming jump triggers whole-game warp animation, fades out gallery modal, plays warp sound, and calls galaxyJump()', () => {
    const meta = MetaProgression.Instance;
    meta.Helmets = [
      { Id: 'helm_mythic_1', Name: 'Titan Helm', Icon: '🌌', Rarity: 'mythic', Stats: {} },
    ];
    galleryScreen.refresh();

    const jumpSpy = vi.spyOn(meta, 'galaxyJump').mockReturnValue({
      success: true,
      awardedHelmet: UNIQUE_HELMETS[0],
      sacrificeScore: 600,
      probability: 0.527,
    });

    const jumpBtn = galleryScreen.element.querySelector('.btn-galaxy-jump') as HTMLButtonElement;
    jumpBtn.click();

    const confirmModal = galleryScreen.element.querySelector('.galaxy-jump-confirm-modal') as HTMLElement;
    const confirmBtn = confirmModal.querySelector('.btn-confirm-jump') as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();

    confirmBtn.click();

    // 1. Confirm modal closed immediately
    expect(confirmModal.style.display).toBe('none');

    // 2. Gallery modal container fades out to let whole game warp shine through
    expect(galleryScreen.element.style.opacity).toBe('0');
    expect(galleryScreen.element.style.pointerEvents).toBe('none');
    expect(galleryScreen.element.style.transition).toContain('opacity');

    // 3. Fullscreen whole-game warp overlay mounted on document.body (not framed in gallery modal)
    const warpOverlay = document.body.querySelector('.galaxy-jump-warp-overlay, .galaxy-warp-overlay') as HTMLElement;
    expect(warpOverlay).not.toBeNull();
    expect(warpOverlay.style.display).not.toBe('none');
    expect(document.body.contains(warpOverlay)).toBe(true);
    expect(galleryScreen.element.contains(warpOverlay)).toBe(false);

    // 4. Warp sound played
    expect(soundSpy.warpJumpCount).toBeGreaterThan(0);

    // 5. galaxyJump executed
    expect(jumpSpy).toHaveBeenCalled();

    // 6. When warp completes, gallery modal visibility is restored and overlay is removed
    galleryScreen.completeWarpAnimation();
    expect(galleryScreen.element.style.opacity).toBe('1');
    expect(galleryScreen.element.style.pointerEvents).toBe('auto');
    expect(document.body.querySelector('.galaxy-jump-warp-overlay')).toBeNull();
  });

  it('5. On success, displays outcome modal with gold-brown card, correct helmet details, and claim button', () => {
    const meta = MetaProgression.Instance;
    meta.Helmets = [
      { Id: 'helm_1', Name: 'H1', Icon: '🪖', Rarity: 'common', Stats: {} },
    ];
    galleryScreen.refresh();

    const targetHelmet = UNIQUE_HELMETS[2]; // Visage of the Abyssal Leviathan
    vi.spyOn(meta, 'galaxyJump').mockReturnValue({
      success: true,
      awardedHelmet: targetHelmet,
      sacrificeScore: 400,
      probability: 0.393,
    });

    const jumpBtn = galleryScreen.element.querySelector('.btn-galaxy-jump') as HTMLButtonElement;
    jumpBtn.click();

    const confirmBtn = galleryScreen.element.querySelector('.btn-confirm-jump') as HTMLButtonElement;
    confirmBtn.click();

    // Fast-forward or complete warp animation
    if ((galleryScreen as any).completeWarpAnimation) {
      (galleryScreen as any).completeWarpAnimation();
    }

    const outcomeModal = galleryScreen.element.querySelector('.galaxy-jump-result-modal') as HTMLElement;
    expect(outcomeModal).not.toBeNull();
    expect(outcomeModal.style.display).not.toBe('none');

    // Gold-Brown card container
    const card = outcomeModal.querySelector('.unique-helmet-card') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.style.background).toContain('#2b1d0c');
    expect(card.style.border).toContain('#d4af37');

    // Helmet details & Awakened Rarity Badge
    expect(card.textContent).toContain(targetHelmet.Name);
    expect(card.textContent).toContain(targetHelmet.Icon);
    expect(card.textContent).toContain('✦ UNIQUE MYTHIC ARTIFACT AWAKENED ✦');
    expect(card.textContent).toContain(targetHelmet.SpecialCapacity);
    expect(card.textContent).toContain(targetHelmet.Lore);

    // Special Capacity showcase chip
    const capacityChip = outcomeModal.querySelector('.capacity-showcase-chip, .unique-helmet-capacity');
    expect(capacityChip).not.toBeNull();

    // Audio & Grand Claim button
    expect(soundSpy.revealCount + soundSpy.levelUpCount).toBeGreaterThan(0);
    const claimBtn = outcomeModal.querySelector('.btn-claim-helmet') as HTMLButtonElement;
    expect(claimBtn).not.toBeNull();
    expect(claimBtn.textContent).toContain('CLAIM & EMBED INTO OUROBOROS RING');
  });

  it('6. On failure, displays collapsed rift outcome modal, void sound, and dismiss button', () => {
    const meta = MetaProgression.Instance;
    meta.Helmets = [
      { Id: 'helm_1', Name: 'H1', Icon: '🪖', Rarity: 'common', Stats: {} },
    ];
    galleryScreen.refresh();

    vi.spyOn(meta, 'galaxyJump').mockReturnValue({
      success: false,
      awardedHelmet: null,
      sacrificeScore: 25,
      probability: 0.0308,
    });

    const jumpBtn = galleryScreen.element.querySelector('.btn-galaxy-jump') as HTMLButtonElement;
    jumpBtn.click();

    const confirmBtn = galleryScreen.element.querySelector('.btn-confirm-jump') as HTMLButtonElement;
    confirmBtn.click();

    if ((galleryScreen as any).completeWarpAnimation) {
      (galleryScreen as any).completeWarpAnimation();
    }

    const outcomeModal = galleryScreen.element.querySelector('.galaxy-jump-result-modal') as HTMLElement;
    expect(outcomeModal).not.toBeNull();
    expect(outcomeModal.style.display).not.toBe('none');

    expect(outcomeModal.textContent).toContain('THE COSMIC RIFT COLLAPSED');
    expect(outcomeModal.textContent).toContain('The void absorbed your sacrifice... but your resonance with the cosmos deepens.');
    expect(outcomeModal.textContent).toContain('Defeat more floor bosses to harvest standard helmets');

    // Void resonance guide meter
    expect(outcomeModal.querySelector('.void-resonance-guide')).not.toBeNull();

    const dismissBtn = outcomeModal.querySelector('.btn-dismiss-result') as HTMLButtonElement;
    expect(dismissBtn).not.toBeNull();
    expect(dismissBtn.textContent).toContain('Return to Shrine');

    dismissBtn.click();
    expect(outcomeModal.style.display).toBe('none');
  });

  it('7. Claiming dismisses modal and refreshes ring pedestals with gold-brown theme', () => {
    const meta = MetaProgression.Instance;
    meta.Helmets = [
      { Id: 'helm_1', Name: 'H1', Icon: '🪖', Rarity: 'common', Stats: {} },
    ];
    galleryScreen.refresh();

    const targetHelmet = UNIQUE_HELMETS[0]; // Crown of the Chrono-Singularity
    vi.spyOn(meta, 'galaxyJump').mockImplementation(() => {
      meta.Helmets = [];
      meta.UniqueHelmets.push(targetHelmet.Id);
      return {
        success: true,
        awardedHelmet: targetHelmet,
        sacrificeScore: 400,
        probability: 0.39,
      };
    });

    const jumpBtn = galleryScreen.element.querySelector('.btn-galaxy-jump') as HTMLButtonElement;
    jumpBtn.click();

    const confirmBtn = galleryScreen.element.querySelector('.btn-confirm-jump') as HTMLButtonElement;
    confirmBtn.click();

    if ((galleryScreen as any).completeWarpAnimation) {
      (galleryScreen as any).completeWarpAnimation();
    }

    const outcomeModal = galleryScreen.element.querySelector('.galaxy-jump-result-modal') as HTMLElement;
    const claimBtn = outcomeModal.querySelector('.btn-claim-helmet') as HTMLButtonElement;
    claimBtn.click();

    // Outcome modal dismissed
    expect(outcomeModal.style.display).toBe('none');

    // Pedestal for slot 0 is unlocked with gold-brown styling
    const slot0 = galleryScreen.element.querySelector('.pedestal-slot[data-slot-index="0"]') as HTMLElement;
    expect(slot0.dataset.status).toBe('unlocked');
    expect(slot0.style.border).toContain('#d4af37');
    expect(slot0.style.background).toContain('rgba(43, 29, 12');
  });

  it('8. Verifies that all 8 Unique Helmets and the 9th Omni-Helmet have defined .Image paths', () => {
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

  it('9. Unlocked pedestal slots in OuroborosGalleryScreen render img.slot-helmet-img with the correct src matching arch.Image', () => {
    const meta = MetaProgression.Instance;
    meta.UniqueHelmets = [UNIQUE_HELMETS[0].Id, UNIQUE_HELMETS[1].Id];
    galleryScreen.refresh();

    const slot0 = galleryScreen.element.querySelector('.pedestal-slot[data-slot-index="0"]') as HTMLElement;
    const img0 = slot0.querySelector('img.slot-helmet-img') as HTMLImageElement;
    expect(img0).not.toBeNull();
    expect(img0.getAttribute('src')).toBe(UNIQUE_HELMETS[0].Image);
    expect(img0.src).toBe(UNIQUE_HELMETS[0].Image);

    const slot1 = galleryScreen.element.querySelector('.pedestal-slot[data-slot-index="1"]') as HTMLElement;
    const img1 = slot1.querySelector('img.slot-helmet-img') as HTMLImageElement;
    expect(img1).not.toBeNull();
    expect(img1.getAttribute('src')).toBe(UNIQUE_HELMETS[1].Image);

    const slot2 = galleryScreen.element.querySelector('.pedestal-slot[data-slot-index="2"]') as HTMLElement;
    const img2 = slot2.querySelector('img.slot-helmet-img');
    expect(img2).toBeNull();
  });

  it('10. showOutcomeModal() renders img.unique-helmet-manifest-img on transcendence success', () => {
    const targetHelmet = UNIQUE_HELMETS[1]; // Warhelm of the Adamantine Juggernaut
    (galleryScreen as any).showOutcomeModal({
      success: true,
      awardedHelmet: targetHelmet,
      sacrificeScore: 600,
      probability: 0.527,
    });

    const outcomeModal = galleryScreen.element.querySelector('.galaxy-jump-result-modal') as HTMLElement;
    expect(outcomeModal.style.display).not.toBe('none');

    const manifestImg = outcomeModal.querySelector('img.unique-helmet-manifest-img') as HTMLImageElement;
    expect(manifestImg).not.toBeNull();
    expect(manifestImg.getAttribute('src')).toBe(targetHelmet.Image);
    expect(manifestImg.src).toBe(targetHelmet.Image);
  });

  it('11. showRelicDetail() renders the inspection image matching arch.Image for an unlocked helmet', () => {
    const meta = MetaProgression.Instance;
    meta.UniqueHelmets = [UNIQUE_HELMETS[2].Id];
    galleryScreen.refresh();

    galleryScreen.showRelicDetail(2);

    const modal = galleryScreen.element.querySelector('.relic-detail-modal') as HTMLElement;
    expect(modal.style.display).not.toBe('none');

    const inspectionImg = modal.querySelector('img.relic-inspection-img, img.relic-detail-img') as HTMLImageElement;
    expect(inspectionImg).not.toBeNull();
    expect(inspectionImg.getAttribute('src')).toBe(UNIQUE_HELMETS[2].Image);
    expect(inspectionImg.src).toBe(UNIQUE_HELMETS[2].Image);
  });
});
