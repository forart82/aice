/**
 * ============================================================================
 * Hardware-Accelerated Particle FX & Screen Shake Subsystem (FxManager.ts)
 * Protocol 3.0 Commercial Engine Edition — Rule 12 Pure WebGL Mandate
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 6, Rule 10, Rule 12)
 *
 * ARCHITECTURAL SUMMARY:
 * ---------------------
 * `FxManager` orchestrates high-performance visual effects, dynamic particle pools,
 * screen-shake damping, full-screen color flashes, and floating combat text overlays.
 *
 * KEY CAPABILITIES:
 * 1. Zero-Allocation Particle Pooling: Fixed-size circular ring buffers of `FxParticle`
 *    and `FxFloatingText` instances pre-allocated during engine initialization.
 * 2. Pure WebGL Batch Dispatch: Particles, text geometry, beams, and shockwaves
 *    render directly through `GLBatch` with additive/normal blending switches.
 * 3. Physical Camera Shake: Decaying harmonic oscillation updating `offsetX` and `offsetY`
 *    consumed by `WebGLGameRenderer` in the world-to-clip camera projection.
 */

import { RenderQuality } from './RenderQuality';
import { ColorX } from './ColorX';
import { MathX } from '../core/MathX';
import { Rng } from '../core/Rng';
import { IFx } from '../core/Contracts';
import { GLBatch, GLBlendMode } from './webgl/GLBatch';

/**
 * High-performance pooled particle descriptor with kinematic dynamics and SDF rendering metadata.
 */
export class FxParticle {
  public active: boolean = false;
  public seq: number = 0;
  public x: number = 0;
  public y: number = 0;
  public vx: number = 0;
  public vy: number = 0;
  public size: number = 2;
  public colorCss: string = '#ffffff';
  public alpha: number = 1;
  public decay: number = 0.02;
  public shape: 'circle' | 'square' | 'ring' | 'spark' | 'shard' | 'plasma' = 'circle';
  public glow: boolean = false;
  public friction: number = 0.96;
  public expansionSpeed: number = 0;
  public turbulence: number = 0;
  public growthRate: number = 0;
  public angle: number = 0;
  public vRot: number = 0;
  public streakMult: number = 8;

  public spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    size: number,
    color: string,
    decay: number = 0.02,
    shape: 'circle' | 'square' | 'ring' | 'spark' | 'shard' | 'plasma' = 'circle',
    glow: boolean = false,
    friction: number = 0.96,
    expansionSpeed: number = 0,
    turbulence: number = 0
  ): void {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.size = size;
    this.colorCss = color;
    this.alpha = 1;
    this.decay = decay > 0 ? decay : 0.02;
    this.shape = shape;
    this.glow = glow;
    this.friction = friction;
    this.expansionSpeed = shape === 'ring' && expansionSpeed <= 0 ? 450 : expansionSpeed;
    this.turbulence = turbulence;
    this.growthRate = 0;
    this.angle = 0;
    this.vRot = 0;
    this.streakMult = 8;
    this.active = true;
  }

  public update(step: number): void {
    if (!this.active) return;
    this.x += this.vx * step;
    this.y += this.vy * step;

    // Organic turbulence for lingering embers
    if (this.turbulence > 0) {
      this.vx += (Rng.Cosmetic.rand() * 2 - 1) * this.turbulence * step;
      this.vy += (Rng.Cosmetic.rand() * 2 - 1) * this.turbulence * step;
    }

    if (this.friction !== 1) {
      const f = Math.pow(this.friction, step);
      this.vx *= f;
      this.vy *= f;
    }
    this.alpha -= this.decay * step;

    // Dynamic scale growth (expanding smoke plumes / shockwaves)
    if (this.growthRate !== 0) {
      this.size += this.growthRate * step;
    }

    // Angular rotation for tumbling shards
    if (this.vRot !== 0) {
      this.angle += this.vRot * step;
    }

    // Shockwave / fireball dynamic expansion physics
    if (this.shape === 'ring' || (this.shape === 'circle' && this.expansionSpeed > 0)) {
      const dt = step / 60;
      this.size += this.expansionSpeed * dt;
      if (this.friction !== 1) {
        this.expansionSpeed *= Math.pow(this.friction, step);
      }
    }

    if (this.alpha <= 0) {
      this.alpha = 0;
      this.active = false;
    }
  }

  public draw(batchOrCtx?: GLBatch | any): void {
    if (batchOrCtx && batchOrCtx instanceof GLBatch) {
      batchOrCtx.drawParticle(this);
    }
  }
}

export class FxFloatingText {
  public active: boolean = false;
  public seq: number = 0;
  public x: number = 0;
  public y: number = 0;
  public vy: number = -1.2;
  public text: string = '';
  public colorCss: string = '#ffffff';
  public alpha: number = 1;
  public decay: number = 0.02;
  public fontSize: number = 14;
  public bold: boolean = true;
  public scale: number = 1;

  public spawn(
    x: number,
    y: number,
    text: string,
    color: string = '#ffffff',
    fontSize: number = 14,
    bold: boolean = true,
    decay: number = 0.02
  ): void {
    this.x = x;
    this.y = y;
    this.vy = -1.2;
    this.text = text || '';
    this.colorCss = color;
    this.fontSize = fontSize;
    this.bold = bold;
    this.alpha = 1;
    this.decay = decay > 0 ? decay : 0.02;
    this.scale = 1.3;
    this.active = true;
  }

  public update(step: number): void {
    if (!this.active) return;
    this.y += this.vy * step;
    this.alpha -= this.decay * step;
    if (this.scale > 1) {
      this.scale = Math.max(1, this.scale - 0.05 * step);
    }
    if (this.alpha <= 0) {
      this.alpha = 0;
      this.active = false;
    }
  }

  public draw(_ctx?: any): void {
    // Suppressed: Rendered exclusively via WebGLGameRenderer.drawFx
  }
}

export class FxBeam {
  public active: boolean = false;
  public seq: number = 0;
  public x1: number = 0;
  public y1: number = 0;
  public x2: number = 0;
  public y2: number = 0;
  public px: number = 0;
  public py: number = 0;
  public colorCss: string = '#38bdf8';
  public width: number = 3;
  public life: number = 0;
  public maxLife: number = 1;
  public jitterTimer: number = 0;
  public segments: number = 6;
  public amp: number = 8;
  public readonly offsets: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

  public spawn(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string = '#38bdf8',
    width: number = 3,
    life: number = 0.25
  ): void {
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
    this.colorCss = color;
    this.width = width > 0 ? width : 1;
    this.maxLife = life > 0 ? life : 0.01;
    this.life = this.maxLife;
    this.jitterTimer = 0;

    const dx = x2 - x1;
    const dy = y2 - y1;
    let len = Math.hypot(dx, dy);
    if (!(len > 0)) len = 1;
    this.px = -dy / len;
    this.py = dx / len;
    this.segments = Math.max(3, Math.min(7, Math.round(len / 26) + 3));
    this.amp = Math.max(3, Math.min(16, len * 0.12));
    this.jitter();
    this.active = true;
  }

  public jitter(): void {
    for (let i = 0; i < this.offsets.length; i++) {
      this.offsets[i] = (Rng.Cosmetic.rand() * 2 - 1) * this.amp;
    }
  }

  public update(dts: number): void {
    if (!this.active) return;
    this.life -= dts;
    this.jitterTimer += dts;
    if (this.jitterTimer >= 0.05) {
      this.jitterTimer = 0;
      this.jitter();
    }
    if (this.life <= 0) {
      this.life = 0;
      this.active = false;
    }
  }

  public draw(_ctx?: any, _glowAllowed?: boolean): void {
    // Suppressed: Rendered exclusively via WebGLGameRenderer.drawFx
  }
}

export class FxManager implements IFx {
  private static readonly MaxParticles = 700;
  private static readonly MaxTexts = 120;
  private static readonly MaxBeams = 32;

  public readonly particles: FxParticle[];
  public readonly texts: FxFloatingText[];
  public readonly beams: FxBeam[];
  public seq: number = 0;

  public quality: 'high' | 'medium' | 'low' = 'high';
  public countMul: number = 1;
  public particleBudget: number = FxManager.MaxParticles;
  public glowAllowed: boolean = true;

  // Pre-allocated shape-bucketed particle index buffers (zero GC allocations during rendering)
  private readonly _circleIndices: Int32Array = new Int32Array(FxManager.MaxParticles);
  private _circleCount: number = 0;
  private readonly _squareIndices: Int32Array = new Int32Array(FxManager.MaxParticles);
  private _squareCount: number = 0;
  private readonly _ringIndices: Int32Array = new Int32Array(FxManager.MaxParticles);
  private _ringCount: number = 0;
  private readonly _sparkIndices: Int32Array = new Int32Array(FxManager.MaxParticles);
  private _sparkCount: number = 0;

  // Screen shake
  public shakeIntensity: number = 0;
  public shakeFrames: number = 0;
  public shakeDecay: number = 0.9;
  public shakeScale: number = 1;
  public offsetX: number = 0;
  public offsetY: number = 0;

  // Arena flash
  public flashColorCss: string = '#ffffff';
  public flashAlpha: number = 0;
  public flashLife: number = 0;
  public flashMaxLife: number = 1;

  private _particleCursor: number = 0;
  private _textCursor: number = 0;

  constructor() {
    this.particles = new Array(FxManager.MaxParticles);
    for (let i = 0; i < this.particles.length; i++) this.particles[i] = new FxParticle();

    this.texts = new Array(FxManager.MaxTexts);
    for (let i = 0; i < this.texts.length; i++) this.texts[i] = new FxFloatingText();

    this.beams = new Array(FxManager.MaxBeams);
    for (let i = 0; i < this.beams.length; i++) this.beams[i] = new FxBeam();

    this.setQuality('high');
  }

  public setQuality(level: 'high' | 'medium' | 'low' | string): void {
    let mul = 1;
    if (level === 'low') {
      mul = 0.25;
      this.quality = 'low';
    } else if (level === 'medium') {
      mul = 0.55;
      this.quality = 'medium';
    } else {
      mul = 1;
      this.quality = 'high';
    }
    RenderQuality.set(this.quality);
    this.countMul = mul;
    this.glowAllowed = this.quality !== 'low';
    this.particleBudget = Math.max(1, Math.min(this.particles.length, Math.round(this.particles.length * mul)));
  }

  public setShakeScale(scale: number): void {
    this.shakeScale = Number.isFinite(scale) ? MathX.clamp01(scale) : 1;
  }

  public getParticle(): FxParticle {
    const budget = this.particleBudget;
    const pool = this.particles;
    let cursor = this._particleCursor;

    for (let probe = 0; probe < budget; probe++) {
      if (cursor >= budget) cursor = 0;
      const p = pool[cursor++]!;
      if (!p.active) {
        this._particleCursor = cursor;
        p.seq = ++this.seq;
        return p;
      }
    }
    if (cursor >= budget) cursor = 0;
    const victim = pool[cursor++]!;
    this._particleCursor = cursor;
    victim.seq = ++this.seq;
    return victim;
  }

  public getText(): FxFloatingText {
    const pool = this.texts;
    const n = pool.length;
    let cursor = this._textCursor;

    for (let probe = 0; probe < n; probe++) {
      if (cursor >= n) cursor = 0;
      const t = pool[cursor++]!;
      if (!t.active) {
        this._textCursor = cursor;
        t.seq = ++this.seq;
        return t;
      }
    }
    if (cursor >= n) cursor = 0;
    const victim = pool[cursor++]!;
    this._textCursor = cursor;
    victim.seq = ++this.seq;
    return victim;
  }

  public getBeam(): FxBeam {
    for (let i = 0; i < this.beams.length; i++) {
      if (!this.beams[i]!.active) {
        this.beams[i]!.seq = ++this.seq;
        return this.beams[i]!;
      }
    }
    let oldest = this.beams[0]!;
    for (let i = 1; i < this.beams.length; i++) {
      if (this.beams[i]!.seq < oldest.seq) oldest = this.beams[i]!;
    }
    oldest.seq = ++this.seq;
    return oldest;
  }

  // ---------------------------------------------------------------- Spawners

  public addText(
    x: number,
    y: number,
    text: string,
    color: string = '#ffffff',
    size: number = 14,
    bold: boolean = true
  ): void {
    const px = x + (Rng.Cosmetic.rand() * 20 - 10);
    let py = y;

    for (let pass = 0; pass < 4; pass++) {
      let clash = false;
      for (let i = 0; i < this.texts.length; i++) {
        const o = this.texts[i]!;
        if (!o.active) continue;
        if (Math.abs(o.x - px) < 26 && Math.abs(o.y - py) < 14) {
          clash = true;
          break;
        }
      }
      if (!clash) break;
      py -= 15;
    }
    const t = this.getText();
    t.spawn(px, py, text, color, size, bold);
  }

  public shake(intensity: number = 8, durationFrames: number = 12): void {
    this.shakeIntensity = intensity;
    this.shakeFrames = durationFrames;
  }

  public burst(
    x: number,
    y: number,
    color: string = '#00f0b5',
    count: number = 16,
    speed: number = 4,
    size: number = 3,
    shape: 'circle' | 'square' | 'ring' | 'spark' = 'circle'
  ): void {
    const n = Math.max(1, Math.round(count * this.countMul));
    for (let i = 0; i < n; i++) {
      const angle = (MathX.Tau * i) / n + (Rng.Cosmetic.rand() * 0.4 - 0.2);
      const spd = (Rng.Cosmetic.rand() * 0.7 + 0.3) * speed;
      const p = this.getParticle();
      p.spawn(
        x,
        y,
        Math.cos(angle) * spd,
        Math.sin(angle) * spd,
        Rng.Cosmetic.rand() * size + 1.5,
        color,
        Rng.Cosmetic.rand() * 0.02 + 0.015,
        shape,
        true,
        0.94
      );
    }
  }

  public ringShockwave(
    x: number,
    y: number,
    color: string = '#ffb703',
    startSize: number = 6,
    decay: number = 0.035,
    expansionSpeed: number = 450
  ): void {
    const p = this.getParticle();
    p.spawn(x, y, 0, 0, startSize, color, decay, 'ring', true, 0.94, expansionSpeed);
  }

  /**
   * Multi-stage visceral explosion VFX:
   * 1. Core Flash: White-hot incandescent expanding fireball that dissipates in ~0.12s.
   * 2. Kinetic Shockwave: Fast-expanding refractive ring with bright outer rim and glowing falloff.
   * 3. Directional Plasma Sparks (shape: 'spark'): High-velocity streaks with velocity-stretched laser lines.
   * 4. Lingering Embers: Floating incandescent particles with air drag and subtle turbulence.
   */
  public explosion(
    x: number,
    y: number,
    color: string = '#ff0054',
    radius: number = 40,
    intensity: number = 1.0
  ): void {
    const qualityMul = this.countMul;

    // 1. Core Flash (White-hot incandescent expanding fireball that dissipates in 0.12s)
    const coreFlash = this.getParticle();
    coreFlash.spawn(
      x,
      y,
      0,
      0,
      Math.max(14, radius * 0.75),
      '#ffffff',
      0.14,
      'circle',
      true,
      0.95,
      280
    );

    // Saturated chromatic corona fireball
    const corona = this.getParticle();
    corona.spawn(
      x,
      y,
      0,
      0,
      Math.max(20, radius * 1.15),
      color,
      0.11,
      'circle',
      true,
      0.95,
      350
    );

    // 2. Kinetic Shockwave: Fast-expanding refractive ring with bright outer rim
    const shockSpeed = Math.max(650, radius * 18);
    this.ringShockwave(x, y, color, Math.max(5, radius * 0.2), 0.035, shockSpeed);
    if (radius > 30) {
      this.ringShockwave(x, y, '#ffffff', Math.max(3, radius * 0.1), 0.045, shockSpeed * 0.7);
    }

    // 3. Directional Laser Sparks (shape: 'spark'): High-velocity streaks with velocity-stretched laser lines
    const sparkCount = Math.max(16, Math.round(24 * intensity * qualityMul));
    for (let i = 0; i < sparkCount; i++) {
      const angle = (MathX.Tau * i) / sparkCount + (Rng.Cosmetic.rand() * 0.6 - 0.3);
      const spd = (Rng.Cosmetic.rand() * 10 + 8) * Math.max(0.75, radius / 30);
      const p = this.getParticle();
      const sparkCol = Rng.Cosmetic.rand() < 0.35 ? '#ffffff' : color;
      p.spawn(
        x,
        y,
        Math.cos(angle) * spd,
        Math.sin(angle) * spd,
        Rng.Cosmetic.rand() * 2.5 + 2.0,
        sparkCol,
        Rng.Cosmetic.rand() * 0.025 + 0.035,
        'spark',
        true,
        0.95
      );
      p.streakMult = 8;
    }

    // 4. Tumbling Geometric Debris Shards (shape: 'shard'): Carapace splinters with angular velocity
    const shardCount = Math.max(6, Math.round(10 * intensity * qualityMul));
    for (let i = 0; i < shardCount; i++) {
      const angle = Rng.Cosmetic.rand() * MathX.Tau;
      const spd = (Rng.Cosmetic.rand() * 6 + 4) * Math.max(0.7, radius / 35);
      const p = this.getParticle();
      p.spawn(
        x,
        y,
        Math.cos(angle) * spd,
        Math.sin(angle) * spd,
        Rng.Cosmetic.rand() * 3 + 3,
        color,
        Rng.Cosmetic.rand() * 0.02 + 0.025,
        'shard',
        true,
        0.91
      );
      p.vRot = (Rng.Cosmetic.rand() - 0.5) * 0.35;
    }

    // 5. Lingering Embers: Floating incandescent particles with air drag and subtle turbulence
    const emberCount = Math.max(8, Math.round(14 * intensity * qualityMul));
    for (let i = 0; i < emberCount; i++) {
      const angle = Rng.Cosmetic.rand() * MathX.Tau;
      const spd = (Rng.Cosmetic.rand() * 3.5 + 1.2) * Math.max(0.6, radius / 40);
      const p = this.getParticle();
      const emberRoll = Rng.Cosmetic.rand();
      const emberCol = emberRoll < 0.35 ? '#ffd166' : emberRoll < 0.65 ? '#ff9e00' : color;
      p.spawn(
        x,
        y,
        Math.cos(angle) * spd,
        Math.sin(angle) * spd,
        Rng.Cosmetic.rand() * 2.5 + 1.5,
        emberCol,
        Rng.Cosmetic.rand() * 0.012 + 0.012,
        'circle',
        true,
        0.89,
        0,
        0.18
      );
    }

    // 6. Volumetric Billowing Plasma Clouds (Expanding soft clouds with thermal cooling)
    const plasmaCount = Math.max(6, Math.round(10 * intensity * qualityMul));
    for (let i = 0; i < plasmaCount; i++) {
      const angle = Rng.Cosmetic.rand() * MathX.Tau;
      const spd = (Rng.Cosmetic.rand() * 2.5 + 0.8) * Math.max(0.6, radius / 35);
      const p = this.getParticle();
      p.spawn(
        x + (Rng.Cosmetic.rand() - 0.5) * radius * 0.5,
        y + (Rng.Cosmetic.rand() - 0.5) * radius * 0.5,
        Math.cos(angle) * spd,
        Math.sin(angle) * spd,
        Rng.Cosmetic.rand() * 5 + 6,
        color,
        Rng.Cosmetic.rand() * 0.02 + 0.018,
        'plasma',
        true,
        0.92,
        0,
        0.15
      );
      p.growthRate = 0.85;
    }

    // 7. Micro Impact Screen Flash & Punchy Screen Shake
    this.flash(color, Math.min(0.35, 0.15 * intensity), 0.08);
    this.shake(Math.min(18, Math.max(6, radius * 0.3 * intensity)), 12);
  }

  public trailEmbers(x: number, y: number, color: string = '#00f0b5', size: number = 3): void {
    if (this.countMul < 1 && Rng.Cosmetic.rand() >= this.countMul) return;
    const p = this.getParticle();
    p.spawn(
      x,
      y,
      (Rng.Cosmetic.rand() - 0.5) * 0.8,
      (Rng.Cosmetic.rand() - 0.5) * 0.8,
      size,
      color,
      0.04,
      'circle',
      true,
      0.98
    );
  }

  public beam(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string = '#38bdf8',
    width: number = 3,
    life: number = 0.25
  ): FxBeam {
    const b = this.getBeam();
    b.spawn(x1, y1, x2, y2, color, width, life);
    return b;
  }

  public flash(color: string = '#ffffff', alpha: number = 0.3, life: number = 0.18): void {
    this.flashColorCss = color;
    this.flashAlpha = MathX.clamp01(alpha);
    this.flashMaxLife = life > 0 ? life : 0.01;
    this.flashLife = this.flashMaxLife;
  }

  /**
   * Suppressed legacy Canvas2D lightningArc method.
   * Inert stub adhering to AGENTS.md Rule 12 & ORACLE.md Section 9.
   * All electric arcs and beams render strictly through WebGLGameRenderer.drawFx and FxBeam.
   */
  public lightningArc(
    _ctx?: any,
    _x1: number = 0,
    _y1: number = 0,
    _x2: number = 0,
    _y2: number = 0,
    _color: string = '#00f0b5',
    _segments: number = 5
  ): void {
    // Suppressed: Rendered exclusively via WebGLGameRenderer.drawFx and FxBeam
  }

  // ---------------------------------------------------------------- Update

  public update(dt: number): void {
    const s = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
    const step = Math.min(3, s * 60);
    const dts = step / 60;

    this.updateShake(step);

    for (let i = 0; i < this.particles.length; i++) {
      if (this.particles[i]!.active) this.particles[i]!.update(step);
    }
    for (let i = 0; i < this.texts.length; i++) {
      if (this.texts[i]!.active) this.texts[i]!.update(step);
    }
    for (let i = 0; i < this.beams.length; i++) {
      if (this.beams[i]!.active) this.beams[i]!.update(dts);
    }

    if (this.flashLife > 0) {
      this.flashLife -= dts;
      if (this.flashLife <= 0) this.flashLife = 0;
    }
  }

  public updateShake(step: number): void {
    if (this.shakeFrames <= 0 || this.shakeIntensity <= 0) {
      this.shakeFrames = 0;
      this.shakeIntensity = 0;
      this.offsetX = 0;
      this.offsetY = 0;
      return;
    }

    const amp = this.shakeIntensity * this.shakeScale;
    if (amp > 0) {
      this.offsetX = (Rng.Cosmetic.rand() * 2 - 1) * amp;
      this.offsetY = (Rng.Cosmetic.rand() * 2 - 1) * amp;
    } else {
      this.offsetX = 0;
      this.offsetY = 0;
    }

    this.shakeFrames -= step;
    this.shakeIntensity *= Math.pow(this.shakeDecay, step);
    if (this.shakeFrames <= 0 || this.shakeIntensity < 0.02) {
      this.shakeFrames = 0;
      this.shakeIntensity = 0;
      this.offsetX = 0;
      this.offsetY = 0;
    }
  }

  // ---------------------------------------------------------------- Draw
  /**
   * Hardware-accelerated rendering of active particles, electric jitter beams,
   * and screen flash overlay via WebGL 2.0 GLBatch.
   * Centralizes FX drawing pipeline directly in FxManager (AGENTS.md Rule 6 & Rule 10).
   */
  public render(batch: GLBatch, w: number = 1280, h: number = 720): void {
    if (!batch || typeof batch.setBlendMode !== 'function') return;

    // 1. Particle FX (Unified Additive Batch)
    batch.setBlendMode(GLBlendMode.ADDITIVE);
    const count = Math.min(this.particleBudget, this.particles.length);
    for (let i = 0; i < count; i++) {
      const p = this.particles[i]!;
      if (!p.active || p.alpha <= 0) continue;
      batch.drawParticle(p);
    }

    // 2. Multi-Segment Electric Jitter Beams
    const beams = this.beams;
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i]!;
      if (!b.active || b.life <= 0) continue;
      const a = MathX.clamp01(b.life / b.maxLife);
      const offsets = b.offsets || [0];
      const nSegs = offsets.length;

      if (nSegs > 1) {
        const dx = b.x2 - b.x1;
        const dy = b.y2 - b.y1;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;

        for (let s = 0; s < nSegs - 1; s++) {
          const t1 = s / (nSegs - 1);
          const t2 = (s + 1) / (nSegs - 1);
          const o1 = offsets[s] || 0;
          const o2 = offsets[s + 1] || 0;
          const px1 = b.x1 + dx * t1 + nx * o1;
          const py1 = b.y1 + dy * t1 + ny * o1;
          const px2 = b.x1 + dx * t2 + nx * o2;
          const py2 = b.y1 + dy * t2 + ny * o2;
          batch.drawLaserLine(px1, py1, px2, py2, b.colorCss, b.width, '#ffffff', a);
        }
      } else {
        batch.drawLaserLine(b.x1, b.y1, b.x2, b.y2, b.colorCss, b.width, '#ffffff', a);
      }
    }

    // 3. Screen Flash Overlay
    if (this.flashLife > 0 && this.flashAlpha > 0) {
      const ft = this.flashMaxLife > 0 ? this.flashLife / this.flashMaxLife : 0;
      batch.setBlendMode(GLBlendMode.ADDITIVE);
      batch.drawSdfRect(w * 0.5, h * 0.5, w, h, 0, this.flashColorCss, this.flashAlpha * ft);
    }
  }

  /**
   * Dual-mode draw method supporting pure WebGL GLBatch while remaining an inert stub on legacy Canvas2D.
   */
  public draw(batchOrCtx?: GLBatch | any, _glowAllowed?: boolean, w: number = 1280, h: number = 720): void {
    if (batchOrCtx && batchOrCtx instanceof GLBatch) {
      this.render(batchOrCtx, w, h);
    }
  }

  public drawOverlay(batchOrCtx?: GLBatch | any, w: number = 1280, h: number = 720): void {
    if (batchOrCtx && batchOrCtx instanceof GLBatch) {
      this.render(batchOrCtx, w, h);
    }
  }

  private get maxLifeSafe(): number {
    return this.flashMaxLife > 0 ? this.flashMaxLife : 1;
  }

  public clear(): void {
    for (let i = 0; i < this.particles.length; i++) this.particles[i]!.active = false;
    for (let i = 0; i < this.texts.length; i++) this.texts[i]!.active = false;
    for (let i = 0; i < this.beams.length; i++) this.beams[i]!.active = false;
    this.shakeIntensity = 0;
    this.shakeFrames = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.flashLife = 0;
    this.flashAlpha = 0;
  }

  public get OffsetX(): number { return this.offsetX; }
  public get OffsetY(): number { return this.offsetY; }

  public AddText(x: number, y: number, text: string, color: string, size = 16, bold = false): void {
    this.addText(x, y, text, color, size, bold);
  }

  public Shake(intensity: number, durationFrames: number): void {
    this.shake(intensity, durationFrames);
  }

  public Burst(x: number, y: number, color: string, count: number, speed: number, size: number, shape = 'circle'): void {
    this.burst(x, y, color, count, speed, size, shape as any);
  }

  public Explosion(
    x: number,
    y: number,
    color: string = '#ff0054',
    radius: number = 40,
    intensity: number = 1.0
  ): void {
    this.explosion(x, y, color, radius, intensity);
  }

  public RingShockwave(x: number, y: number, color: string, startSize: number, decay = 0.035, expansionSpeed = 450): void {
    this.ringShockwave(x, y, color, startSize, decay, expansionSpeed);
  }

  public TrailEmbers(x: number, y: number, color: string, size: number): void {
    this.trailEmbers(x, y, color, size);
  }

  public Beam(x1: number, y1: number, x2: number, y2: number, color: string, width: number, life: number): void {
    this.beam(x1, y1, x2, y2, color, width, life);
  }

  public Flash(color: string, alpha: number, life: number): void {
    this.flash(color, alpha, life);
  }

  public Clear(): void {
    this.clear();
  }

  public Update(dt: number): void {
    this.update(dt);
  }
}

