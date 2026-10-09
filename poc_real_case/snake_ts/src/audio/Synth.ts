/**
 * Ouroboros Ascension — Procedural Web Audio API Synthesizer (Synth.ts)
 *
 * Implements sample-accurate oscillator voices, PolyBLEP anti-aliased waveforms,
 * ADSR envelopes, RBJ Biquad filters, white/pink noise generation, waveshaping distortion,
 * dynamic compression, and headless offline DSP rendering.
 *
 * Zero external audio files required. Completely headless-safe.
 */

// ============================================================================
// Types and Enums
// ============================================================================

export type WaveShape = 'sine' | 'square' | 'sawtooth' | 'triangle';
export type BiquadFilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peaking' | 'allpass';
export type CurveType = 'set' | 'linear' | 'exponential';

export interface ADSRConfig {
  attack: number;     // seconds to peak
  decay?: number;     // seconds from peak to sustain level
  sustain?: number;   // sustain level (0.0 to 1.0)
  release?: number;   // seconds from note end to 0
  peak?: number;      // peak amplitude (default 1.0)
}

export interface VoiceSpec {
  isNoise?: boolean;
  type?: WaveShape;
  freq?: number;
  when: number;       // relative start time in seconds
  dur: number;        // duration in seconds
  peak: number;       // peak amplitude (0.0 - 1.0)
  attack?: number;    // attack duration in seconds
  decay?: number;
  sustain?: number;
  release?: number;

  // Filter options
  filter?: BiquadFilterType;
  cutoff?: number;
  cutoffMid?: number; // for sweeps
  cutoffEnd?: number;
  q?: number;

  // Pitch sweep options (tones only)
  freqEnd?: number;
  freqTime?: number;
  freqPeak?: number;
  detune?: number;    // detune in CENTS (100 cents = 1 semitone)

  // Noise options
  rate?: number;      // playback rate
  offset?: number;    // start offset into noise buffer (0 - 1 s)
  distortion?: number;// waveshaper drive amount (0.0 - 1.0)
}

// ============================================================================
// DSP Utility Math Functions
// ============================================================================

export const EPSILON = 0.0001;
export const DEFAULT_SAMPLE_RATE = 48000;
export const COEFF_INTERVAL = 8;

/** Validates that a number is finite and not NaN. */
export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Clamps a value into [0.0, 1.0]. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Converts semitone intervals to frequency multiplier: 2^(n / 12). */
export function semi(n: number): number {
  return Math.pow(2.0, n / 12.0);
}

/** Converts cents to frequency multiplier: 2^(c / 1200). */
export function cents(c: number): number {
  return Math.pow(2.0, c / 1200.0);
}

/** Converts linear amplitude to decibels. */
export function gainToDb(gain: number): number {
  return gain <= EPSILON ? -80.0 : 20.0 * Math.log10(gain);
}

/** Converts decibels to linear amplitude. */
export function dbToGain(db: number): number {
  return db <= -80.0 ? 0.0 : Math.pow(10.0, db / 20.0);
}

// ============================================================================
// PolyBLEP Anti-Aliased Oscillator (Software / Headless DSP)
// ============================================================================

/**
 * PolyBLEP (Polynomial Band-Limited Step) Residual Function.
 *
 * Mathematical Derivation:
 * Naive digital oscillators with sharp discontinuities (such as sawtooth and square waves)
 * produce infinite harmonic frequencies that fold over the Nyquist frequency ($f_s / 2$),
 * resulting in harsh, audible aliasing distortion.
 *
 * PolyBLEP corrects step discontinuities by approximating the continuous sinc integral
 * using a 2nd-order polynomial (spline) across the boundary interval $[-dt, +dt]$:
 *
 * Let $dt = \frac{f_0}{f_s}$ be the normalized phase increment per sample ($dt \le 0.5$).
 * A step discontinuity occurs at normalized phase $t = 0$ (mod 1).
 *
 * Case 1: Immediately after the discontinuity ($0 \le t < dt$):
 *   Let $u = \frac{t}{dt} \in [0, 1)$.
 *   Correction: $P(u) = 2u - u^2 - 1$
 *
 * Case 2: Immediately before the discontinuity ($1 - dt < t \le 1$):
 *   Let $u = \frac{t - 1}{dt} \in (-1, 0]$.
 *   Correction: $P(u) = u^2 + 2u + 1$
 *
 * Elsewhere ($dt \le t \le 1 - dt$):
 *   Correction: $0$
 *
 * Subtracting $P(u)$ from naive sawtooth or adding/subtracting it at transitions in square
 * waves cancels out high-frequency spectral foldover, yielding pristine anti-aliased tones.
 *
 * @param t Normalized instantaneous phase $\in [0, 1)$
 * @param dt Phase step increment $\frac{f_0}{f_s}$
 * @returns Anti-aliasing correction factor added/subtracted to the naive sample
 */
function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const u = t / dt;
    return u + u - u * u - 1.0;
  }
  if (t > 1.0 - dt) {
    const u = (t - 1.0) / dt;
    return u * u + u + u + 1.0;
  }
  return 0.0;
}

/**
 * Headless-safe Software Oscillator Voice.
 * Generates sample-accurate anti-aliased waveforms (Sine, Triangle, Sawtooth, Square)
 * using 64-bit phase accumulation and PolyBLEP bandlimiting.
 */
export class OscillatorVoice {
  private phase = 0.0;

  public reset(): void {
    this.phase = 0.0;
  }

  public next(wave: WaveShape, freq: number, sampleRate: number): number {
    const f = isNum(freq) && freq > 0 ? freq : 1.0;
    const sr = sampleRate > 0 ? sampleRate : DEFAULT_SAMPLE_RATE;
    let dt = f / sr;
    if (dt > 0.5) dt = 0.5;

    const p = this.phase;
    this.phase += dt;
    if (this.phase >= 1.0) {
      this.phase -= Math.floor(this.phase);
    }

    switch (wave) {
      case 'sine':
        return Math.sin(p * 2.0 * Math.PI);

      case 'sawtooth':
        return (2.0 * p - 1.0) - polyBlep(p, dt);

      case 'square': {
        let v = p < 0.5 ? 1.0 : -1.0;
        v += polyBlep(p, dt);
        let q = p + 0.5;
        if (q >= 1.0) q -= 1.0;
        v -= polyBlep(q, dt);
        return v;
      }

      case 'triangle': {
        const t4 = p * 4.0;
        if (p < 0.25) return t4;
        if (p < 0.75) return 2.0 - t4;
        return t4 - 4.0;
      }

      default:
        return Math.sin(p * 2.0 * Math.PI);
    }
  }
}

// ============================================================================
// RBJ Biquad Filter (Lowpass, Highpass, Bandpass, Notch, Peaking)
// ============================================================================

/**
 * Robert Bristow-Johnson (RBJ) Audio EQ Cookbook Biquad Filter.
 *
 * Implements standard 2nd-order IIR biquad filtering in Direct Form I:
 *
 * Continuous transfer function in the s-plane:
 *   $H(s) = \frac{b_0 s^2 + b_1 s + b_2}{a_0 s^2 + a_1 s + a_2}$
 *
 * Transformed to discrete z-plane via Bilinear Transform ($s = \frac{2}{T} \frac{1 - z^{-1}}{1 + z^{-1}}$):
 *   $H(z) = \frac{b_0 + b_1 z^{-1} + b_2 z^{-2}}{a_0 + a_1 z^{-1} + a_2 z^{-2}}$
 *
 * Direct Form I Difference Equation:
 *   $y[n] = \frac{b_0}{a_0} x[n] + \frac{b_1}{a_0} x[n-1] + \frac{b_2}{a_0} x[n-2]
 *         - \frac{a_1}{a_0} y[n-1] - \frac{a_2}{a_0} y[n-2]$
 *
 * Angular Frequency & Bandwidth:
 *   $\omega_0 = \frac{2\pi f_0}{f_s}$ (clamped strictly below Nyquist $0.4995 f_s$)
 *   $\alpha = \frac{\sin(\omega_0)}{2Q}$ (or $\frac{\sin(\omega_0)}{2 \cdot 10^{Q/20}}$)
 */
export class BiquadFilter {
  private b0 = 1.0;
  private b1 = 0.0;
  private b2 = 0.0;
  private a1 = 0.0;
  private a2 = 0.0;
  private x1 = 0.0;
  private x2 = 0.0;
  private y1 = 0.0;
  private y2 = 0.0;

  /** Resets filter delay registers $x[n-1], x[n-2], y[n-1], y[n-2]$ to zero. */
  public reset(): void {
    this.x1 = 0.0;
    this.x2 = 0.0;
    this.y1 = 0.0;
    this.y2 = 0.0;
  }

  /**
   * Computes normalized biquad coefficients for the specified filter type and cutoff frequency.
   *
   * Coefficients by Filter Type:
   * - Lowpass:  $b_0 = \frac{1 - \cos(\omega_0)}{2}, \quad b_1 = 1 - \cos(\omega_0), \quad b_2 = \frac{1 - \cos(\omega_0)}{2}$
   * - Highpass: $b_0 = \frac{1 + \cos(\omega_0)}{2}, \quad b_1 = -(1 + \cos(\omega_0)), \quad b_2 = \frac{1 + \cos(\omega_0)}{2}$
   * - Bandpass: $b_0 = \alpha, \quad b_1 = 0, \quad b_2 = -\alpha$
   * - Notch:    $b_0 = 1, \quad b_1 = -2\cos(\omega_0), \quad b_2 = 1$
   * - Peaking:  $b_0 = 1 + \alpha Q, \quad b_1 = -2\cos(\omega_0), \quad b_2 = 1 - \alpha Q$
   *
   * Common denominator poles:
   *   $a_0 = 1 + \alpha, \quad a_1 = -2\cos(\omega_0), \quad a_2 = 1 - \alpha$
   *
   * @param type Biquad filter topology ('lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peaking' | 'allpass')
   * @param f0 Cutoff / center frequency in Hertz ($0 < f_0 < 0.5 f_s$)
   * @param q Quality resonance factor ($Q > 0$, higher $Q$ creates narrower peak/notch)
   * @param sampleRate Sampling rate in Hz (e.g. 48000)
   */
  public set(type: BiquadFilterType, f0: number, q: number, sampleRate: number): void {
    const sr = sampleRate > 0 ? sampleRate : DEFAULT_SAMPLE_RATE;
    let freq = isNum(f0) && f0 > 0 ? f0 : 1.0;
    const nyquist = sr * 0.5;
    if (freq > nyquist * 0.999) freq = nyquist * 0.999;

    const w0 = (2.0 * Math.PI * freq) / sr;
    const cosW = Math.cos(w0);
    const sinW = Math.sin(w0);
    const Q = isNum(q) && q > 0 ? q : 1.0;

    // Web Audio standard alpha calculation
    let alpha: number;
    if (type === 'bandpass') {
      alpha = sinW / (2.0 * Math.max(1e-4, Q));
    } else {
      alpha = sinW / (2.0 * Math.pow(10.0, Q / 20.0));
    }

    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

    switch (type) {
      case 'highpass':
        b0 = (1.0 + cosW) * 0.5;
        b1 = -(1.0 + cosW);
        b2 = b0;
        a0 = 1.0 + alpha;
        a1 = -2.0 * cosW;
        a2 = 1.0 - alpha;
        break;

      case 'bandpass':
        b0 = alpha;
        b1 = 0.0;
        b2 = -alpha;
        a0 = 1.0 + alpha;
        a1 = -2.0 * cosW;
        a2 = 1.0 - alpha;
        break;

      case 'notch':
        b0 = 1.0;
        b1 = -2.0 * cosW;
        b2 = 1.0;
        a0 = 1.0 + alpha;
        a1 = -2.0 * cosW;
        a2 = 1.0 - alpha;
        break;

      case 'peaking':
        b0 = 1.0 + alpha * Q;
        b1 = -2.0 * cosW;
        b2 = 1.0 - alpha * Q;
        a0 = 1.0 + alpha / Q;
        a1 = -2.0 * cosW;
        a2 = 1.0 - alpha / Q;
        break;

      case 'lowpass':
      default:
        b0 = (1.0 - cosW) * 0.5;
        b1 = 1.0 - cosW;
        b2 = b0;
        a0 = 1.0 + alpha;
        a1 = -2.0 * cosW;
        a2 = 1.0 - alpha;
        break;
    }

    if (a0 === 0 || !isNum(a0)) {
      this.b0 = 1.0;
      this.b1 = 0.0;
      this.b2 = 0.0;
      this.a1 = 0.0;
      this.a2 = 0.0;
      return;
    }

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;

    if (!isNum(this.b0) || !isNum(this.b1) || !isNum(this.b2) || !isNum(this.a1) || !isNum(this.a2)) {
      this.b0 = 1.0;
      this.b1 = 0.0;
      this.b2 = 0.0;
      this.a1 = 0.0;
      this.a2 = 0.0;
    }
  }

  public process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    if (!isNum(y)) {
      this.reset();
      return 0.0;
    }
    return y;
  }
}

// ============================================================================
// One-Pole Filter (Exponential Smoother & Bus Transitions)
// ============================================================================

/**
 * First-Order Continuous Exponential Smoother (One-Pole Lowpass Filter).
 *
 * Mathematical Derivation:
 * Continuous differential equation for a leaky integrator:
 *   $\tau \frac{dy(t)}{dt} + y(t) = x(t)$
 *
 * Approximated over discrete time step $\Delta t$:
 *   $y[n] = y[n-1] + (x[n] - y[n-1]) \cdot \left(1 - e^{-\frac{\Delta t}{\tau}}\right)$
 *
 * Where:
 *   $\tau$ is `timeConstant` in seconds (time to reach $1 - e^{-1} \approx 63.2\%$ of target)
 *   $k = 1 - e^{-\frac{\Delta t}{\tau}}$ is the smoothing coefficient $\in [0, 1]$
 *
 * Prevents zipper noise and DC clicks during real-time volume, panning, and cutoff changes.
 */
export class OnePoleFilter {
  /** Current smoothed instantaneous scalar value. */
  public value = 0.0;
  /** Asymptotic convergence target scalar value. */
  public target = 0.0;
  /** Exponential response time constant $\tau$ in seconds (default: 0.03s = 30ms). */
  public timeConstant = 0.03;

  /**
   * Sets a new asymptotic target value and optional smoothing time constant.
   * @param target Desired target value
   * @param tc Response time constant in seconds
   */
  public setTarget(target: number, tc?: number): void {
    this.target = isNum(target) ? target : 0.0;
    this.timeConstant = isNum(tc) && tc > 0 ? tc : 0.03;
  }

  /**
   * Immediately snaps current value and target to $v$, bypassing exponential smoothing.
   * @param v Instantaneous value to set
   */
  public snap(v: number): void {
    this.value = v;
    this.target = v;
  }

  /**
   * Advances the smoother by $\Delta t$ seconds toward target using exact exponential integration.
   * @param dt Elapsed time step in seconds ($\Delta t > 0$)
   */
  public advance(dt: number): void {
    if (!(dt > 0) || !isNum(dt)) return;
    const k = 1.0 - Math.exp(-dt / this.timeConstant);
    this.value += (this.target - this.value) * k;
    if (!isNum(this.value)) this.value = this.target;
  }
}

// ============================================================================
// Parameter Automation Curve (ParamCurve & ParamRunner)
// ============================================================================

/** Breakpoint node specifying target value, transition kind, and relative timestamp. */
export interface ParamEvent {
  kind: CurveType;
  value: number;
  time: number;
}

/**
 * Sample-accurate piecewise automation curve generator.
 * Emulates Web Audio API `AudioParam` timeline automations (setValueAtTime,
 * linearRampToValueAtTime, exponentialRampToValueAtTime) headlessly in software.
 */
export class ParamCurve {
  /** Ordered collection of timed automation events. */
  public events: ParamEvent[] = [];

  /** Clears all automation events from the timeline. */
  public clear(): void {
    this.events.length = 0;
  }

  /**
   * Schedules an instantaneous step transition to `v` at time `t`.
   * @param v Target scalar value
   * @param t Timestamp in seconds from voice start
   */
  public setValueAtTime(v: number, t: number): void {
    if (isNum(v)) {
      this.events.push({ kind: 'set', value: v, time: Math.max(0, t) });
    }
  }

  /**
   * Schedules a continuous linear ramp toward `v` ending at time `t`.
   * Linear formula: $v(\tau) = v_0 + (v_1 - v_0) \cdot \frac{\tau - t_0}{t_1 - t_0}$
   * @param v Target scalar value
   * @param t Target timestamp in seconds
   */
  public linearRampToValueAtTime(v: number, t: number): void {
    if (isNum(v)) {
      this.events.push({ kind: 'linear', value: v, time: Math.max(0, t) });
    }
  }

  /**
   * Schedules a continuous exponential ramp toward `v` ending at time `t`.
   * Exponential formula: $v(\tau) = v_0 \cdot \left(\frac{v_1}{v_0}\right)^{\frac{\tau - t_0}{t_1 - t_0}}$
   * Note: values are strictly clamped above EPSILON to prevent $\log(0)$ and $-\infty$ singularities.
   * @param v Target non-zero positive scalar value
   * @param t Target timestamp in seconds
   */
  public exponentialRampToValueAtTime(v: number, t: number): void {
    const target = isNum(v) && v > EPSILON ? v : EPSILON;
    this.events.push({ kind: 'exponential', value: target, time: Math.max(0, t) });
  }

  /**
   * Interpolates instantaneous curve value at arbitrary timestamp $t$.
   * @param t Query timestamp in seconds
   * @returns Interpolated scalar value
   */
  public at(t: number): number {
    if (this.events.length === 0) return 0.0;
    const first = this.events[0]!;
    if (t <= first.time) return first.value;

    for (let i = 0; i < this.events.length - 1; i++) {
      const a = this.events[i]!;
      const b = this.events[i + 1]!;
      if (t >= b.time) continue;
      const span = b.time - a.time;
      if (span <= 0) return b.value;
      const u = (t - a.time) / span;

      if (b.kind === 'linear') {
        return a.value + (b.value - a.value) * u;
      }
      if (b.kind === 'exponential' && a.value > 0) {
        return a.value * Math.pow(b.value / a.value, u);
      }
      return a.value;
    }
    return this.events[this.events.length - 1]!.value;
  }
}

/**
 * Sample-by-Sample Parameter Interpolation Runner.
 *
 * Implements high-performance discrete recurrence step evaluation for parameter curves:
 *
 * Linear Recurrence:
 *   $\text{addStep} = \frac{v_1 - v_0}{N_{\text{steps}}}$
 *   $v[n+1] = v[n] + \text{addStep}$
 *
 * Exponential Recurrence:
 *   $\text{mulStep} = \left(\frac{v_1}{v_0}\right)^{\frac{1}{N_{\text{steps}}}}$
 *   $v[n+1] = v[n] \cdot \text{mulStep}$
 *
 * Used for audio envelopes, filter cutoff sweeps, and pitch modulations without per-sample branching.
 */
export class ParamRunner {
  private ownCurve = new ParamCurve();
  private curve: ParamCurve | null = null;
  private sampleRate = DEFAULT_SAMPLE_RATE;
  private eventIndex = 0;
  private currentSample = 0;
  private segmentEndSample = 0;
  private currentValue = 0.0;
  private addStep = 0.0;
  private mulStep = 1.0;
  private isExp = false;

  /** Current instantaneous scalar value. */
  public get value(): number {
    return this.currentValue;
  }

  /**
   * Initializes runner with a timeline curve and target audio sample rate.
   * @param curve Automation timeline curve
   * @param sampleRate Output sampling rate in Hz
   */
  public reset(curve: ParamCurve, sampleRate: number): void {
    this.curve = curve;
    this.sampleRate = sampleRate > 0 ? sampleRate : DEFAULT_SAMPLE_RATE;
    this.eventIndex = 0;
    this.currentSample = 0;
    this.currentValue = curve && curve.events.length > 0 ? curve.events[0]!.value : 0.0;
    this.setupSegment(0);
  }

  /**
   * Generates a 2-stage Attack-Decay amplitude envelope:
   * - Attack: Linear ramp from 0 to peak over `attack` seconds.
   * - Decay: Exponential decay from peak to zero over `dur` seconds.
   *
   * @param peak Peak amplitude level ($\text{peak} \in (0, 1]$)
   * @param attack Attack duration in seconds ($a \ge 1\text{ms}$)
   * @param dur Total envelope duration in seconds
   * @param sampleRate Sampling rate in Hz
   */
  public resetEnv(peak: number, attack: number, dur: number, sampleRate: number): void {
    const pk = isNum(peak) && peak > EPSILON ? peak : EPSILON;
    const a = isNum(attack) ? Math.max(0.001, attack) : 0.004;
    const d = isNum(dur) ? Math.max(a + 0.01, dur) : 0.1;

    this.ownCurve.clear();
    this.ownCurve.setValueAtTime(EPSILON, 0.0);
    this.ownCurve.linearRampToValueAtTime(pk, a);
    this.ownCurve.exponentialRampToValueAtTime(EPSILON, d);
    this.reset(this.ownCurve, sampleRate);
  }

  /**
   * Generates a full 4-stage Attack-Decay-Sustain-Release (ADSR) amplitude envelope:
   * - Attack: Linear ramp from 0 to peak over `config.attack` seconds.
   * - Decay: Exponential ramp from peak to sustain level over `config.decay` seconds.
   * - Sustain: Constant level held until `dur` seconds elapse.
   * - Release: Exponential ramp from sustain level to zero over `config.release` seconds.
   *
   * @param config ADSR parameters ({ attack, decay, sustain, release, peak })
   * @param dur Note active hold duration in seconds
   * @param sampleRate Sampling rate in Hz
   */
  public resetADSR(config: ADSRConfig, dur: number, sampleRate: number): void {
    const pk = isNum(config.peak) && config.peak! > EPSILON ? config.peak! : 1.0;
    const a = Math.max(0.001, config.attack);
    const dec = Math.max(0.001, config.decay ?? 0.05);
    const susLevel = Math.max(EPSILON, (config.sustain ?? 0.7) * pk);
    const rel = Math.max(0.001, config.release ?? 0.08);
    const noteDur = Math.max(a + dec, dur);

    this.ownCurve.clear();
    this.ownCurve.setValueAtTime(EPSILON, 0.0);
    this.ownCurve.linearRampToValueAtTime(pk, a);
    this.ownCurve.exponentialRampToValueAtTime(susLevel, a + dec);
    this.ownCurve.setValueAtTime(susLevel, noteDur);
    this.ownCurve.exponentialRampToValueAtTime(EPSILON, noteDur + rel);
    this.reset(this.ownCurve, sampleRate);
  }

  private setupSegment(depth: number): void {
    if (!this.curve || this.eventIndex + 1 >= this.curve.events.length || depth > 8) {
      this.addStep = 0.0;
      this.mulStep = 1.0;
      this.isExp = false;
      this.segmentEndSample = Number.MAX_SAFE_INTEGER;
      return;
    }

    const b = this.curve.events[this.eventIndex + 1]!;
    const s1 = Math.round(b.time * this.sampleRate);
    if (s1 <= this.currentSample) {
      this.currentValue = b.value;
      this.eventIndex++;
      this.setupSegment(depth + 1);
      return;
    }

    const steps = s1 - this.currentSample;
    this.segmentEndSample = s1;

    if (b.kind === 'linear') {
      this.isExp = false;
      this.mulStep = 1.0;
      this.addStep = (b.value - this.currentValue) / steps;
    } else if (b.kind === 'exponential' && this.currentValue > 0 && b.value > 0) {
      this.isExp = true;
      this.addStep = 0.0;
      this.mulStep = Math.pow(b.value / this.currentValue, 1.0 / steps);
    } else {
      this.isExp = false;
      this.mulStep = 1.0;
      this.addStep = 0.0;
    }

    if (!isNum(this.addStep)) this.addStep = 0.0;
    if (!isNum(this.mulStep)) this.mulStep = 1.0;
  }

  public next(): number {
    const v = this.currentValue;
    this.currentSample++;
    if (this.currentSample >= this.segmentEndSample) {
      if (this.curve && this.eventIndex + 1 < this.curve.events.length) {
        this.currentValue = this.curve.events[this.eventIndex + 1]!.value;
        this.eventIndex++;
        this.setupSegment(0);
      }
    } else {
      this.currentValue = this.isExp ? this.currentValue * this.mulStep : this.currentValue + this.addStep;
    }
    return v;
  }
}

// ============================================================================
// Cached Noise Buffer (White & Pink Noise)
// ============================================================================

export class NoiseBuffer {
  public readonly data: Float32Array;
  public readonly rate: number;

  constructor(sampleRate: number = DEFAULT_SAMPLE_RATE) {
    this.rate = Math.max(1, sampleRate);
    this.data = new Float32Array(this.rate);
    for (let i = 0; i < this.rate; i++) {
      this.data[i] = Math.random() * 2.0 - 1.0;
    }
  }

  /** Fractional looping read with linear interpolation. */
  public read(pos: number): number {
    const n = this.data.length;
    let p = pos % n;
    if (p < 0) p += n;
    const i0 = Math.floor(p);
    const i1 = i0 + 1 >= n ? 0 : i0 + 1;
    const f = p - i0;
    const d0 = this.data[i0] ?? 0;
    const d1 = this.data[i1] ?? 0;
    return d0 + (d1 - d0) * f;
  }
}

// ============================================================================
// Distortion / Waveshaper Functions
// ============================================================================

export function makeDistortionCurve(amount: number = 20, samples: number = 4096): Float32Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(samples * 4);
  const curve = new Float32Array(buffer);
  const deg = Math.PI / 180;
  const k = typeof amount === 'number' ? amount : 20;

  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

export function softClip(sample: number, drive: number = 1.0): number {
  const x = sample * drive;
  return Math.tanh(x);
}

// ============================================================================
// Offline Voice DSP Renderer (Headless Safe)
// ============================================================================

function buildFreqCurve(v: VoiceSpec): ParamCurve {
  const c = new ParamCurve();
  const freq = v.freq ?? 440;
  c.setValueAtTime(freq, 0);
  if (isNum(v.freqEnd) && v.freqEnd !== 0) {
    c.exponentialRampToValueAtTime(v.freqEnd, isNum(v.freqTime) && v.freqTime !== 0 ? v.freqTime : v.dur);
  }
  if (isNum(v.freqPeak) && v.freqPeak !== 0) {
    c.linearRampToValueAtTime(v.freqPeak, v.dur * 0.5);
    c.linearRampToValueAtTime(freq, v.dur);
  }
  return c;
}

function buildCutoffCurve(v: VoiceSpec): ParamCurve {
  const c = new ParamCurve();
  const c0 = isNum(v.cutoff) && v.cutoff !== 0 ? v.cutoff : v.isNoise ? 1000.0 : 1200.0;
  c.setValueAtTime(c0, 0);
  if (v.isNoise && isNum(v.cutoffMid) && v.cutoffMid !== 0) {
    c.linearRampToValueAtTime(v.cutoffMid, v.dur * 0.4);
  }
  if (isNum(v.cutoffEnd) && v.cutoffEnd !== 0) {
    c.exponentialRampToValueAtTime(v.cutoffEnd, v.dur);
  }
  return c;
}

export function renderVoice(
  dst: Float32Array,
  startSample: number,
  sampleRate: number,
  v: VoiceSpec,
  noise: NoiseBuffer
): void {
  if (!dst || !v || sampleRate <= 0) return;
  const n = Math.max(1, Math.round(v.dur * sampleRate));

  const env = new ParamRunner();
  env.resetEnv(v.peak, v.attack ?? 0.004, v.dur, sampleRate);

  let bq: BiquadFilter | null = null;
  let cut: ParamRunner | null = null;
  let ftype: BiquadFilterType = 'lowpass';

  if (v.isNoise || v.filter) {
    ftype = v.filter ?? 'lowpass';
    bq = new BiquadFilter();
    cut = new ParamRunner();
    cut.reset(buildCutoffCurve(v), sampleRate);
  }

  if (v.isNoise) {
    const rate = isNum(v.rate) && v.rate > 0 ? v.rate : 1.0;
    let pos = (v.offset ?? 0) * noise.rate;
    for (let i = 0; i < n; i++) {
      const di = startSample + i;
      if (di >= dst.length) break;
      let s = noise.read(pos);
      pos += rate;
      if (bq && cut) {
        const fc = cut.next();
        if (i % COEFF_INTERVAL === 0) bq.set(ftype, fc, v.q ?? 1.0, sampleRate);
        s = bq.process(s);
      }
      if (v.distortion && v.distortion > 0) {
        s = softClip(s, 1.0 + v.distortion * 4.0);
      }
      const gain = env.next();
      if (di >= 0 && di < dst.length) {
        dst[di] = (dst[di] ?? 0) + s * gain;
      }
    }
    return;
  }

  const freq = new ParamRunner();
  freq.reset(buildFreqCurve(v), sampleRate);
  const det = v.detune ? cents(v.detune) : 1.0;
  const osc = new OscillatorVoice();
  const wave = v.type ?? 'sine';

  for (let i = 0; i < n; i++) {
    const di = startSample + i;
    if (di >= dst.length) break;
    let s = osc.next(wave, freq.next() * det, sampleRate);
    if (bq && cut) {
      const fc = cut.next();
      if (i % COEFF_INTERVAL === 0) bq.set(ftype, fc, v.q ?? 1.0, sampleRate);
      s = bq.process(s);
    }
    if (v.distortion && v.distortion > 0) {
      s = softClip(s, 1.0 + v.distortion * 4.0);
    }
    const gain = env.next();
    if (di >= 0 && di < dst.length) {
      dst[di] = (dst[di] ?? 0) + s * gain;
    }
  }
}

/** Bakes multiple voice specifications into a single Float32Array PCM buffer. */
export function bakeSoundToBuffer(
  voices: readonly VoiceSpec[],
  sampleRate: number = DEFAULT_SAMPLE_RATE,
  noise?: NoiseBuffer
): Float32Array {
  const noiseBuf = noise ?? new NoiseBuffer(sampleRate);
  let maxEnd = 0;
  for (const v of voices) {
    const end = v.when + v.dur;
    if (end > maxEnd) maxEnd = end;
  }
  const totalSamples = Math.max(2, Math.ceil(maxEnd * sampleRate) + 2);
  const buffer = new Float32Array(totalSamples);

  for (const v of voices) {
    renderVoice(buffer, Math.round(v.when * sampleRate), sampleRate, v, noiseBuf);
  }
  return buffer;
}

// ============================================================================
// Web Audio API Context Management (Browser & Headless Fallbacks)
// ============================================================================

export interface IAudioContext {
  currentTime: number;
  sampleRate: number;
  state: 'suspended' | 'running' | 'closed';
  destination: AudioNode;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  createBiquadFilter(): BiquadFilterNode;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
  createWaveShaper(): WaveShaperNode;
  createDynamicsCompressor(): DynamicsCompressorNode;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

let activeAudioContext: AudioContext | null = null;

/** Returns true if Web Audio API is supported in the current environment. */
export function isWebAudioSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    (typeof window.AudioContext !== 'undefined' || typeof (window as unknown as { webkitAudioContext: unknown }).webkitAudioContext !== 'undefined')
  );
}

/**
 * Creates or retrieves the singleton Web Audio context safely.
 * Returns null if running in headless/Node.js without throwing errors.
 */
export function getAudioContext(): AudioContext | null {
  if (!isWebAudioSupported()) return null;
  if (!activeAudioContext || activeAudioContext.state === 'closed') {
    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      activeAudioContext = new AudioCtxClass();
    } catch {
      activeAudioContext = null;
    }
  }
  return activeAudioContext;
}

/** Unlocks Web Audio playback on initial user gesture (Click, Keydown, Touch). */
export function unlockAudioContext(): Promise<void> {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    return ctx.resume().catch(() => {});
  }
  return Promise.resolve();
}

// ============================================================================
// Interactive Audio Playback & Graph Lifecycle Management
// ============================================================================

export interface AudioPlaybackHandle {
  stop(): void;
}

const CONTEXT_NOISE_CACHE = new WeakMap<AudioContext, AudioBuffer>();

/**
 * Retrieves or lazily creates a reusable white noise AudioBuffer cached per AudioContext.
 * Prevents allocating new AudioBuffers and generating thousands of random floats per second
 * during rapid procedural audio triggers (transient crunches, bites, explosions).
 */
export function getContextNoiseBuffer(ctx: AudioContext, minDuration: number = 1.0): AudioBuffer {
  const minSamples = Math.max(2, Math.ceil(minDuration * ctx.sampleRate));
  let buf = CONTEXT_NOISE_CACHE.get(ctx);
  if (!buf || buf.length < minSamples) {
    const allocSamples = Math.max(minSamples, ctx.sampleRate * 2);
    buf = ctx.createBuffer(1, allocSamples, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < allocSamples; i++) {
      data[i] = Math.random() * 2.0 - 1.0;
    }
    CONTEXT_NOISE_CACHE.set(ctx, buf);
  }
  return buf;
}

/**
 * Safely compiles and plays VoiceSpec recipes in the active Web Audio context.
 *
 * Web Audio Signal Graph Topology:
 *
 * 1. Tonal Oscillator Path:
 *    [OscillatorNode (sine/saw/square/tri)]
 *                  │
 *                  ▼
 *        [GainNode (Envelope)] ──► [Optional BiquadFilterNode] ──► [Destination Node]
 *
 * 2. Noise Generator Path:
 *    [AudioBufferSourceNode (Loop)]
 *                  │
 *                  ▼
 *        [GainNode (Envelope)] ──► [Optional BiquadFilterNode] ──► [Destination Node]
 *
 * ADSR & Parameter Timing:
 * - Attack stage: Linear ramp from EPSILON to `peak` over `attack` seconds (default 4ms).
 * - Release stage: Exponential decay from `peak` to EPSILON over `dur` seconds.
 * - Frequency sweeps: Exponential ramp from `freq` to `freqEnd` over `freqTime` or `dur`.
 * - Filter sweeps: Exponential ramp from `cutoff` to `cutoffEnd` over `dur`.
 *
 * Zero-Leak Lifecycle Guarantee:
 * All allocated AudioNodes are registered in `nodesToDisconnect`. When all active sources
 * trigger `onended` (or when `stop()` is invoked), every node is explicitly disconnected.
 *
 * @param voices Array of voice specifications to instantiate and schedule
 * @param ctx Target Web Audio AudioContext (null safe)
 * @param dest Output destination AudioNode (defaults to ctx.destination if null)
 * @param gainMultiplier Global linear master/channel gain multiplier (default: 1.0)
 * @param onEnded Optional completion callback executed after all voice layers finish
 * @returns AudioPlaybackHandle to programmatically halt in-flight voices early
 */
export function playVoiceSpecs(
  voices: readonly VoiceSpec[],
  ctx: AudioContext | null,
  dest: AudioNode | null,
  gainMultiplier: number = 1.0,
  onEnded?: () => void
): AudioPlaybackHandle | void {
  if (!ctx || ctx.state === 'closed' || !voices || voices.length === 0) {
    if (onEnded) {
      try { onEnded(); } catch {}
    }
    return;
  }

  const destination = dest || ctx.destination;
  const t0 = ctx.currentTime;
  const nodesToDisconnect: AudioNode[] = [];
  const activeSources: (OscillatorNode | AudioBufferSourceNode)[] = [];
  let stopped = false;
  let remainingActive = 0;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    for (const node of nodesToDisconnect) {
      try {
        node.disconnect();
      } catch {}
    }
    nodesToDisconnect.length = 0;
    activeSources.length = 0;
    if (onEnded) {
      try {
        onEnded();
      } catch {}
    }
  };

  const onSourceEnded = () => {
    remainingActive--;
    if (remainingActive <= 0) {
      cleanup();
    }
  };

  try {
    for (const v of voices) {
      const when = t0 + Math.max(0, v.when ?? 0);
      const dur = Math.max(0.001, v.dur ?? 0.05);
      const peak = clamp01((v.peak ?? 1.0) * gainMultiplier);
      const attack = Math.max(0.0005, v.attack ?? 0.004);

      const gainNode = ctx.createGain();
      nodesToDisconnect.push(gainNode);
      gainNode.gain.setValueAtTime(EPSILON, when);
      gainNode.gain.linearRampToValueAtTime(peak, when + attack);
      gainNode.gain.exponentialRampToValueAtTime(EPSILON, when + dur);

      let lastNode: AudioNode = gainNode;

      if (v.filter) {
        const filterNode = ctx.createBiquadFilter();
        nodesToDisconnect.push(filterNode);
        filterNode.type = v.filter;
        const c0 = v.cutoff ?? 1200;
        filterNode.frequency.setValueAtTime(c0, when);
        if (v.cutoffEnd) {
          filterNode.frequency.exponentialRampToValueAtTime(v.cutoffEnd, when + dur);
        }
        if (v.q) filterNode.Q.setValueAtTime(v.q, when);
        gainNode.connect(filterNode);
        lastNode = filterNode;
      }

      lastNode.connect(destination);

      if (v.isNoise) {
        const noiseBuffer = getContextNoiseBuffer(ctx, dur);
        const src = ctx.createBufferSource();
        nodesToDisconnect.push(src);
        activeSources.push(src);
        src.buffer = noiseBuffer;
        src.loop = true;
        src.connect(gainNode);
        remainingActive++;
        src.onended = onSourceEnded;
        const offset = (v.offset ?? (Math.random() * 0.5)) * (noiseBuffer.duration || 1.0);
        src.start(when, offset % (noiseBuffer.duration || 1.0));
        src.stop(when + dur);
      } else {
        const osc = ctx.createOscillator();
        nodesToDisconnect.push(osc);
        activeSources.push(osc);
        osc.type = (v.type as OscillatorType) || 'sine';
        const f0 = v.freq ?? 440;
        osc.frequency.setValueAtTime(f0, when);
        if (v.freqEnd) {
          osc.frequency.exponentialRampToValueAtTime(v.freqEnd, when + (v.freqTime ?? dur));
        }
        if (v.detune) {
          osc.detune.setValueAtTime(v.detune, when);
        }
        osc.connect(gainNode);
        remainingActive++;
        osc.onended = onSourceEnded;
        osc.start(when);
        osc.stop(when + dur);
      }
    }

    return {
      stop: () => {
        for (const src of activeSources) {
          try {
            src.stop();
          } catch {}
        }
        cleanup();
      },
    };
  } catch {
    cleanup();
    return;
  }
}

// ============================================================================
// Broadcast Audio Asset Buffer Cache & Hybrid Dispatcher
// ============================================================================

export const BROADCAST_AUDIO_PATHS = {
  eat: 'assets/audio/sfx_eat.wav',
  eatPop: 'assets/audio/sfx_eat_pop.wav',
  eatPop01: 'assets/audio/sfx_eat_pop_01.wav',
  eatPop02: 'assets/audio/sfx_eat_pop_02.wav',
  eatPop03: 'assets/audio/sfx_eat_pop_03.wav',
  eatPop04: 'assets/audio/sfx_eat_pop_04.wav',
  starDing: 'assets/audio/sfx_star_ding.wav',
  gemChime: 'assets/audio/sfx_gem_chime.wav',
  laserPew: 'assets/audio/sfx_laser_pew.wav',
  laserHeavy: 'assets/audio/sfx_laser_heavy.wav',
  hit: 'assets/audio/sfx_hit.wav',
  bite: 'assets/audio/sfx_bite.wav',
  crit: 'assets/audio/sfx_crit.wav',
  explosion: 'assets/audio/sfx_explosion.wav',
  dash: 'assets/audio/sfx_dash.wav',
  shieldOn: 'assets/audio/sfx_shield_on.wav',
  shieldBreak: 'assets/audio/sfx_shield_break.wav',
  bossRoar: 'assets/audio/sfx_boss_roar.wav',
  bossAlert: 'assets/audio/sfx_boss_alert.wav',
  levelUp: 'assets/audio/sfx_level_up.wav',
  victory: 'assets/audio/sfx_victory.wav',
  gameOver: 'assets/audio/sfx_game_over.wav',
  uiClick: 'assets/audio/sfx_ui_click.wav',
  uiTab: 'assets/audio/sfx_ui_tab.wav',
  warpJump: 'assets/audio/sfx_warp_jump.wav',
  musicExploration: 'assets/audio/music_exploration.wav',
  musicCombat: 'assets/audio/music_combat.wav',
  musicBoss: 'assets/audio/music_boss.wav',
} as const;

export const EAT_POP_VARIATION_PATHS = [
  BROADCAST_AUDIO_PATHS.eatPop01,
  BROADCAST_AUDIO_PATHS.eatPop02,
  BROADCAST_AUDIO_PATHS.eatPop03,
  BROADCAST_AUDIO_PATHS.eatPop04,
] as const;

export const BROADCAST_MUSIC_PATHS = {
  exploration: 'assets/audio/music_exploration.wav',
  combat: 'assets/audio/music_combat.wav',
  boss: 'assets/audio/music_boss.wav',
} as const;

export type BroadcastMusicTrack = keyof typeof BROADCAST_MUSIC_PATHS;

const AUDIO_BUFFER_CACHE = new Map<string, AudioBuffer>();

export function getCachedAudioBuffer(url: string): AudioBuffer | null {
  return AUDIO_BUFFER_CACHE.get(url) ?? null;
}

export function setCachedAudioBuffer(url: string, buffer: AudioBuffer): void {
  AUDIO_BUFFER_CACHE.set(url, buffer);
}

export function clearAudioBufferCache(): void {
  AUDIO_BUFFER_CACHE.clear();
}

export async function loadAudioBuffer(path: string, ctx?: AudioContext | null): Promise<AudioBuffer | null> {
  const cached = getCachedAudioBuffer(path);
  if (cached) return cached;
  const audioCtx = ctx || getAudioContext();
  if (!audioCtx || typeof fetch === 'undefined') return null;

  try {
    const response = await fetch(path);
    if (!response || !response.ok) return null;
    const arrayBuf = await response.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(arrayBuf);
    setCachedAudioBuffer(path, decoded);
    return decoded;
  } catch {
    return null;
  }
}

export function playAudioBuffer(
  buffer: AudioBuffer,
  ctx: AudioContext | null,
  dest?: AudioNode | null,
  gainMultiplier: number = 1.0,
  onEnded?: () => void,
  playbackRateMultiplier: number = 1.0
): AudioPlaybackHandle | void {
  if (!ctx || ctx.state === 'closed' || !buffer) return;
  try {
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buffer;
    if (playbackRateMultiplier !== 1.0 && src.playbackRate) {
      src.playbackRate.value = playbackRateMultiplier;
    }
    gain.gain.value = clamp01(gainMultiplier);
    src.connect(gain);
    gain.connect(dest || ctx.destination);

    let ended = false;
    const cleanup = () => {
      if (ended) return;
      ended = true;
      try {
        src.disconnect();
        gain.disconnect();
      } catch {}
      if (onEnded) onEnded();
    };

    src.onended = cleanup;
    src.start(0);

    return {
      stop: () => {
        try {
          src.stop();
        } catch {}
        cleanup();
      },
    };
  } catch {
    return;
  }
}

// ============================================================================
// Hyperspace Warp & Unique Helmet Reveal Interactive Synthesizers
// ============================================================================

/**
 * Procedural Hyperspace Warp Jump Acoustic Synthesizer.
 *
 * Web Audio Signal Topology:
 * Layer 1 (Rising Pitch Sweep):
 *   [OscillatorNode (sawtooth, 80Hz -> 880Hz)] ──► [GainNode (ramp 0.01 -> 0.4 -> 0.001)] ──► [Destination]
 *
 * Layer 2 (Atmospheric Noise Rush):
 *   [AudioBufferSourceNode (White Noise)] ──► [BiquadFilterNode (Bandpass 200Hz -> 3500Hz, Q=3.5)]
 *                                          ──► [GainNode (ramp 0.01 -> 0.35 -> 0.001)] ──► [Destination]
 *
 * Layer 3 (Hyperspace Emergence Sub-Boom):
 *   [OscillatorNode (sine, 40Hz, at t0 + 2.1s)] ──► [GainNode (0.7 -> 0.001 exp decay)] ──► [Destination]
 *
 * Timing:
 * - Build-up: $t \in [0, 1.8\text{s}]$
 * - Peak acceleration: $t = 1.8\text{s}$
 * - Sub-bass boom: $t = 2.1\text{s}$
 * - Full resolution: $t = 3.1\text{s}$
 *
 * @param ctx Target Web Audio context (null-safe)
 * @param dest Output audio destination (defaults to ctx.destination)
 * @returns AudioPlaybackHandle to cancel playback early
 */
export function playWarpJump(ctx: AudioContext | null, dest?: AudioNode | null): AudioPlaybackHandle | void {
  if (!ctx || ctx.state === 'closed') return;
  const destination = dest || ctx.destination;
  const t0 = ctx.currentTime;
  const nodesToDisconnect: AudioNode[] = [];
  const activeSources: (OscillatorNode | AudioBufferSourceNode)[] = [];
  let stopped = false;
  let remainingActive = 0;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    for (const node of nodesToDisconnect) {
      try { node.disconnect(); } catch {}
    }
    nodesToDisconnect.length = 0;
    activeSources.length = 0;
  };

  const onSourceEnded = () => {
    remainingActive--;
    if (remainingActive <= 0) cleanup();
  };

  try {
    // 1. Pitch sweep oscillator: 80Hz -> 880Hz over 2.2s
    const sweepOsc = ctx.createOscillator();
    const sweepGain = ctx.createGain();
    nodesToDisconnect.push(sweepOsc, sweepGain);
    activeSources.push(sweepOsc);
    sweepOsc.type = 'sawtooth';
    sweepOsc.frequency.setValueAtTime(80, t0);
    sweepOsc.frequency.exponentialRampToValueAtTime(880, t0 + 2.2);

    sweepGain.gain.setValueAtTime(0.01, t0);
    sweepGain.gain.linearRampToValueAtTime(0.4, t0 + 1.8);
    sweepGain.gain.exponentialRampToValueAtTime(0.001, t0 + 2.2);

    sweepOsc.connect(sweepGain);
    sweepGain.connect(destination);
    remainingActive++;
    sweepOsc.onended = onSourceEnded;
    sweepOsc.start(t0);
    sweepOsc.stop(t0 + 2.2);

    // 2. Bandpass noise rush: 200Hz -> 3500Hz
    const noiseLen = Math.max(2, Math.ceil(2.2 * ctx.sampleRate));
    const noiseBuffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const nData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) nData[i] = Math.random() * 2 - 1;

    const noiseSrc = ctx.createBufferSource();
    const noiseFilter = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();
    nodesToDisconnect.push(noiseSrc, noiseFilter, noiseGain);
    activeSources.push(noiseSrc);

    noiseSrc.buffer = noiseBuffer;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(200, t0);
    noiseFilter.frequency.exponentialRampToValueAtTime(3500, t0 + 2.2);
    noiseFilter.Q.setValueAtTime(3.5, t0);

    noiseGain.gain.setValueAtTime(0.01, t0);
    noiseGain.gain.linearRampToValueAtTime(0.35, t0 + 1.8);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t0 + 2.2);

    noiseSrc.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destination);
    remainingActive++;
    noiseSrc.onended = onSourceEnded;
    noiseSrc.start(t0);
    noiseSrc.stop(t0 + 2.2);

    // 3. Sub-bass boom: 40Hz at t0 + 2.1s for 1.0s
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    nodesToDisconnect.push(subOsc, subGain);
    activeSources.push(subOsc);

    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(40, t0 + 2.1);
    subGain.gain.setValueAtTime(0.7, t0 + 2.1);
    subGain.gain.exponentialRampToValueAtTime(0.001, t0 + 3.1);

    subOsc.connect(subGain);
    subGain.connect(destination);
    remainingActive++;
    subOsc.onended = onSourceEnded;
    subOsc.start(t0 + 2.1);
    subOsc.stop(t0 + 3.1);

    return {
      stop: () => {
        for (const s of activeSources) { try { s.stop(); } catch {} }
        cleanup();
      }
    };
  } catch {
    cleanup();
    return;
  }
}

/**
 * Procedural Unique Helmet Reveal Fanfare Synthesizer.
 *
 * Web Audio Signal Topology:
 * 5 Parallel Harmonic Layers (Staggered Pentatonic Arpeggio):
 *   [OscillatorNode (sine, f_i)] ──► [GainNode (ramp 0.3 -> 0.001 exp decay)] ──► [Destination]
 *
 * Pitches:
 *   C4 (261.63 Hz) at $t = t_0 + 0.00\text{s}$
 *   E4 (329.63 Hz) at $t = t_0 + 0.05\text{s}$
 *   G4 (392.00 Hz) at $t = t_0 + 0.10\text{s}$
 *   B4 (493.88 Hz) at $t = t_0 + 0.15\text{s}$
 *   D5 (587.33 Hz) at $t = t_0 + 0.20\text{s}$
 * Note Duration: 0.45s per voice with smooth exponential release.
 *
 * @param ctx Target Web Audio context (null-safe)
 * @param dest Output audio destination (defaults to ctx.destination)
 * @returns AudioPlaybackHandle to halt in-flight voices early
 */
export function playUniqueHelmetReveal(ctx: AudioContext | null, dest?: AudioNode | null): AudioPlaybackHandle | void {
  if (!ctx || ctx.state === 'closed') return;
  const destination = dest || ctx.destination;
  const t0 = ctx.currentTime;
  const nodesToDisconnect: AudioNode[] = [];
  const activeSources: OscillatorNode[] = [];
  let stopped = false;
  let remainingActive = 0;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    for (const node of nodesToDisconnect) {
      try { node.disconnect(); } catch {}
    }
    nodesToDisconnect.length = 0;
    activeSources.length = 0;
  };

  const onSourceEnded = () => {
    remainingActive--;
    if (remainingActive <= 0) cleanup();
  };

  try {
    const pitches = [261.63, 329.63, 392.00, 493.88, 587.33];
    const delays = [0.0, 0.05, 0.10, 0.15, 0.20];
    const noteDur = 0.45;

    for (let i = 0; i < pitches.length; i++) {
      const pitch = pitches[i]!;
      const startTime = t0 + delays[i]!;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      nodesToDisconnect.push(osc, gain);
      activeSources.push(osc);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(pitch, startTime);
      gain.gain.setValueAtTime(0.3, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + noteDur);

      osc.connect(gain);
      gain.connect(destination);
      remainingActive++;
      osc.onended = onSourceEnded;
      osc.start(startTime);
      osc.stop(startTime + noteDur);
    }

    return {
      stop: () => {
        for (const s of activeSources) { try { s.stop(); } catch {} }
        cleanup();
      }
    };
  } catch {
    cleanup();
    return;
  }
}

// ============================================================================
// Procedural Voice Specifications (Crystal-Clear Cyber-Emerald Audio Engine)
// ============================================================================

/** 1. Unified 38ms mouth chomp with rich lower tones identical across all food pickups (not a ding). */
export function createEatVoices(_combo: number = 1, _isGolden: boolean = false): VoiceSpec[] {
  return [
    // Layer 1: Deep jaw chomp downward chirp in lower tones (240Hz -> 110Hz mouth closure with lowpass filter)
    {
      when: 0,
      dur: 0.038,
      freq: 240.0,
      freqEnd: 110.0,
      type: 'triangle',
      peak: 0.65,
      attack: 0.0015,
      decay: 0.0365,
      filter: 'lowpass',
      cutoff: 450.0,
    },
    // Layer 2: Low-mid mouth cavity resonance (380Hz -> 180Hz juicy body)
    {
      when: 0.002,
      dur: 0.032,
      freq: 380.0,
      freqEnd: 180.0,
      type: 'sine',
      peak: 0.45,
      attack: 0.002,
      decay: 0.030,
    },
    // Layer 3: Tactile tooth bite crunch snap (2200Hz bandpass noise transient)
    {
      isNoise: true,
      when: 0,
      dur: 0.012,
      peak: 0.38,
      attack: 0.0005,
      decay: 0.0115,
      filter: 'bandpass',
      cutoff: 2200.0,
      q: 2.0,
    },
  ];
}

/** 2. Crystalline celestial ping (1760Hz + 2637Hz, 80ms). */
export function createStarVoices(): VoiceSpec[] {
  return [
    {
      when: 0,
      dur: 0.080,
      freq: 1760.00,
      type: 'sine',
      peak: 0.45,
      attack: 0.002,
      decay: 0.078,
    },
    {
      when: 0,
      dur: 0.080,
      freq: 2637.02,
      type: 'sine',
      peak: 0.35,
      attack: 0.002,
      decay: 0.078,
    },
    {
      isNoise: true,
      when: 0,
      dur: 0.030,
      peak: 0.15,
      attack: 0.001,
      decay: 0.029,
      filter: 'bandpass',
      cutoff: 4200,
      q: 4.0,
    },
  ];
}

/** 3. Short 450ms ascending cyber chime (880Hz -> 1108Hz -> 1318Hz -> 1760Hz) with 65Hz sub-bass anchor. */
export function createLevelUpVoices(): VoiceSpec[] {
  return [
    {
      when: 0,
      dur: 0.450,
      freq: 65.0,
      type: 'sine',
      peak: 0.5,
      attack: 0.005,
      decay: 0.445,
    },
    {
      when: 0.000,
      dur: 0.220,
      freq: 880.00,
      type: 'sine',
      peak: 0.4,
      attack: 0.002,
      decay: 0.218,
    },
    {
      when: 0.075,
      dur: 0.220,
      freq: 1108.73,
      type: 'sine',
      peak: 0.4,
      attack: 0.002,
      decay: 0.218,
    },
    {
      when: 0.150,
      dur: 0.220,
      freq: 1318.51,
      type: 'sine',
      peak: 0.42,
      attack: 0.002,
      decay: 0.218,
    },
    {
      when: 0.225,
      dur: 0.225,
      freq: 1760.00,
      type: 'sine',
      peak: 0.45,
      attack: 0.002,
      decay: 0.223,
    },
  ];
}

/** 4. Short 650ms rising cyber-triumph cadence (E5 -> B5 -> E6 -> G#6) with 50Hz sub-bass. */
export function createVictoryVoices(): VoiceSpec[] {
  return [
    {
      when: 0,
      dur: 0.650,
      freq: 50.0,
      type: 'sine',
      peak: 0.55,
      attack: 0.005,
      decay: 0.645,
    },
    {
      when: 0.000,
      dur: 0.250,
      freq: 659.25,
      type: 'sine',
      peak: 0.4,
      attack: 0.002,
      decay: 0.248,
    },
    {
      when: 0.120,
      dur: 0.250,
      freq: 987.77,
      type: 'sine',
      peak: 0.42,
      attack: 0.002,
      decay: 0.248,
    },
    {
      when: 0.240,
      dur: 0.250,
      freq: 1318.51,
      type: 'sine',
      peak: 0.45,
      attack: 0.002,
      decay: 0.248,
    },
    {
      when: 0.360,
      dur: 0.290,
      freq: 1661.22,
      type: 'sine',
      peak: 0.48,
      attack: 0.002,
      decay: 0.288,
    },
  ];
}

/** 5. Short 500ms clean deactivation pulse (440Hz -> 55Hz pure sine glide). */
export function createGameOverVoices(): VoiceSpec[] {
  return [
    {
      when: 0,
      dur: 0.500,
      freq: 440.0,
      freqEnd: 55.0,
      type: 'sine',
      peak: 0.55,
      attack: 0.002,
      decay: 0.498,
      isNoise: false,
    },
    {
      when: 0,
      dur: 0.500,
      freq: 55.0,
      type: 'sine',
      peak: 0.45,
      attack: 0.010,
      decay: 0.490,
      isNoise: false,
    },
  ];
}

/** 6. Tight 60ms FM laser chirp (1400Hz -> 350Hz) with 4.5kHz transient and zero white noise. */
export function createShootVoices(freq?: number): VoiceSpec[] {
  const f0 = freq ?? 1400;
  const f1 = freq ? freq * 0.25 : 350;
  return [
    {
      when: 0,
      dur: 0.060,
      freq: f0,
      freqEnd: f1,
      type: 'sine',
      peak: 0.5,
      attack: 0.001,
      decay: 0.059,
      isNoise: false,
    },
    {
      when: 0,
      dur: 0.015,
      freq: 4500,
      type: 'triangle',
      peak: 0.35,
      attack: 0.0005,
      decay: 0.0145,
      isNoise: false,
    },
  ];
}

/** 7. Crisp 95ms heavy blaster chirp (650Hz -> 180Hz) with 60Hz punch. */
export function createLaserFireVoices(freq?: number): VoiceSpec[] {
  const f0 = freq ?? 650;
  const f1 = freq ? freq * (180 / 650) : 180;
  return [
    {
      when: 0,
      dur: 0.095,
      freq: f0,
      freqEnd: f1,
      type: 'sawtooth',
      peak: 0.5,
      attack: 0.002,
      decay: 0.093,
      isNoise: false,
    },
    {
      when: 0,
      dur: 0.095,
      freq: 60.0,
      type: 'sine',
      peak: 0.45,
      attack: 0.002,
      decay: 0.093,
      isNoise: false,
    },
  ];
}

/** 8. Punchy 30ms tactile cyber-impact (3.2kHz transient snap + 110Hz sub kick). */
export function createHitVoices(intensity: number = 1.0): VoiceSpec[] {
  const p = clamp01(intensity);
  return [
    {
      when: 0,
      dur: 0.015,
      freq: 3200,
      type: 'triangle',
      peak: 0.4 * p,
      attack: 0.0005,
      decay: 0.0145,
      isNoise: false,
    },
    {
      when: 0,
      dur: 0.030,
      freq: 110.0,
      type: 'sine',
      peak: 0.55 * p,
      attack: 0.001,
      decay: 0.029,
      isNoise: false,
    },
  ];
}

/** 9. Quick 32ms chitin snap + 120Hz thud without distortion. */
export function createBiteVoices(damage: number = 10, isCrit: boolean = false): VoiceSpec[] {
  const peakMult = isCrit ? 1.4 : 1.0;
  return [
    {
      when: 0,
      dur: 0.015,
      freq: 2400,
      type: 'triangle',
      peak: 0.35 * peakMult,
      attack: 0.0005,
      decay: 0.0145,
      distortion: 0,
      isNoise: false,
    },
    {
      when: 0,
      dur: 0.032,
      freq: 120.0,
      type: 'sine',
      peak: 0.45 * peakMult,
      attack: 0.001,
      decay: 0.031,
      distortion: 0,
      isNoise: false,
    },
  ];
}

/** 10. Clean 250ms cyber-plasma detonation (bright 2.6kHz transient flash + deep 55Hz sub-bass boom). */
export function createExplosionVoices(intensity: number = 1.0): VoiceSpec[] {
  const p = clamp01(intensity);
  return [
    {
      when: 0,
      dur: 0.040,
      freq: 2600,
      type: 'triangle',
      peak: 0.45 * p,
      attack: 0.001,
      decay: 0.039,
      isNoise: false,
    },
    {
      when: 0,
      dur: 0.250,
      freq: 55.0,
      freqEnd: 40.0,
      type: 'sine',
      peak: 0.65 * p,
      attack: 0.003,
      decay: 0.247,
      isNoise: false,
    },
  ];
}

/** 11. Smooth 140ms aerodynamic slipstream whoosh with 60Hz sub-bass displacement. */
export function createDashVoices(): VoiceSpec[] {
  return [
    {
      when: 0,
      dur: 0.140,
      freq: 60.0,
      type: 'sine',
      peak: 0.5,
      attack: 0.005,
      decay: 0.135,
      isNoise: false,
    },
    {
      isNoise: true,
      when: 0,
      dur: 0.140,
      peak: 0.35,
      attack: 0.010,
      decay: 0.130,
      filter: 'bandpass',
      cutoff: 800,
      cutoffEnd: 2400,
      q: 2.5,
    },
  ];
}

/** 12. 130ms dual harmonic swell (659Hz + 987Hz). */
export function createShieldVoices(): VoiceSpec[] {
  return [
    {
      when: 0,
      dur: 0.130,
      freq: 659.25,
      type: 'sine',
      peak: 0.45,
      attack: 0.020,
      decay: 0.110,
      isNoise: false,
    },
    {
      when: 0,
      dur: 0.130,
      freq: 987.77,
      type: 'sine',
      peak: 0.40,
      attack: 0.020,
      decay: 0.110,
      isNoise: false,
    },
  ];
}

/** 13. 140ms crystalline shatter (2800Hz -> 1200Hz). */
export function createShieldBreakVoices(): VoiceSpec[] {
  return [
    {
      when: 0,
      dur: 0.140,
      freq: 2800,
      freqEnd: 1200,
      type: 'triangle',
      peak: 0.5,
      attack: 0.001,
      decay: 0.139,
      isNoise: false,
    },
    {
      when: 0,
      dur: 0.025,
      freq: 3800,
      type: 'sine',
      peak: 0.35,
      attack: 0.0005,
      decay: 0.0245,
      isNoise: false,
    },
  ];
}

/** 14. 580ms ominous sub-bass pulse (45Hz + 880Hz harmonic). */
export function createBossAlertVoices(_tier: number = 1): VoiceSpec[] {
  return [
    {
      when: 0,
      dur: 0.580,
      freq: 45.0,
      type: 'sine',
      peak: 0.65,
      attack: 0.010,
      decay: 0.570,
      isNoise: false,
    },
    {
      when: 0,
      dur: 0.350,
      freq: 880.0,
      type: 'triangle',
      peak: 0.35,
      attack: 0.005,
      decay: 0.345,
      isNoise: false,
    },
  ];
}

/** 15a. 10ms pure tactile glass click (3200Hz). */
export function createUiClickVoices(): VoiceSpec[] {
  return [
    {
      when: 0,
      dur: 0.010,
      freq: 3200,
      type: 'sine',
      peak: 0.25,
      attack: 0.0005,
      decay: 0.0095,
      isNoise: false,
    },
  ];
}

/** 15b. 10ms pure tactile glass hover blip (4000Hz). */
export function createUiHoverVoices(): VoiceSpec[] {
  return [
    {
      when: 0,
      dur: 0.010,
      freq: 4000,
      type: 'sine',
      peak: 0.08,
      attack: 0.0005,
      decay: 0.0095,
      isNoise: false,
    },
  ];
}

/** 16. Clean 90ms cyber-snap (2400Hz + 120Hz sub). */
export function createCritVoices(): VoiceSpec[] {
  return [
    {
      when: 0,
      dur: 0.040,
      freq: 2400,
      type: 'triangle',
      peak: 0.5,
      attack: 0.0005,
      decay: 0.0395,
      isNoise: false,
    },
    {
      when: 0,
      dur: 0.090,
      freq: 120.0,
      type: 'sine',
      peak: 0.55,
      attack: 0.001,
      decay: 0.089,
      isNoise: false,
    },
  ];
}

export function createThunderVoices(intensity: number = 1.0): VoiceSpec[] {
  const p = clamp01(intensity);
  return [
    {
      isNoise: true,
      when: 0.000,
      dur: 0.020,
      peak: 0.5 * p,
      attack: 0.001,
      decay: 0.019,
      filter: 'lowpass',
      cutoff: 1200,
    },
    {
      isNoise: true,
      when: 0.015,
      dur: 0.020,
      peak: 0.45 * p,
      attack: 0.001,
      decay: 0.019,
      filter: 'lowpass',
      cutoff: 1000,
    },
    {
      isNoise: true,
      when: 0.030,
      dur: 0.025,
      peak: 0.4 * p,
      attack: 0.001,
      decay: 0.024,
      filter: 'lowpass',
      cutoff: 800,
    },
    {
      when: 0.020,
      dur: 0.400,
      freq: 85,
      freqEnd: 40,
      type: 'sine',
      peak: 0.6 * p,
      attack: 0.010,
      decay: 0.390,
      isNoise: false,
    },
  ];
}

export function createFlameVoices(): VoiceSpec[] {
  return [
    {
      isNoise: true,
      when: 0,
      dur: 0.180,
      peak: 0.35,
      attack: 0.020,
      decay: 0.160,
      filter: 'lowpass',
      cutoff: 650,
    },
  ];
}

export function createSkillVoices(): VoiceSpec[] {
  return [
    {
      when: 0,
      dur: 0.200,
      freq: 440,
      type: 'sawtooth',
      peak: 0.4,
      attack: 0.01,
      decay: 0.19,
      filter: 'bandpass',
      cutoff: 300,
      cutoffEnd: 2400,
      q: 3.0,
      isNoise: false,
    },
    {
      when: 0,
      dur: 0.200,
      freq: 220,
      type: 'sine',
      peak: 0.5,
      attack: 0.01,
      decay: 0.19,
      isNoise: false,
    },
  ];
}

export function createFrenzyVoices(): VoiceSpec[] {
  return [
    {
      when: 0,
      dur: 0.250,
      freq: 220,
      freqEnd: 880,
      type: 'sawtooth',
      peak: 0.45,
      attack: 0.01,
      decay: 0.24,
      isNoise: false,
    },
    {
      when: 0,
      dur: 0.120,
      freq: 90,
      freqEnd: 45,
      type: 'sine',
      peak: 0.6,
      attack: 0.005,
      decay: 0.115,
      isNoise: false,
    },
  ];
}

export function createHurtVoices(_damage: number = 10): VoiceSpec[] {
  return [
    {
      when: 0,
      dur: 0.120,
      freq: 130,
      type: 'sine',
      peak: 0.5,
      attack: 0.005,
      decay: 0.115,
      filter: 'lowpass',
      cutoff: 380,
      isNoise: false,
    },
  ];
}

export function createErrorVoices(): VoiceSpec[] {
  return [
    {
      when: 0.000,
      dur: 0.080,
      freq: 140,
      type: 'square',
      peak: 0.35,
      attack: 0.002,
      decay: 0.078,
      isNoise: false,
    },
    {
      when: 0.090,
      dur: 0.080,
      freq: 120,
      type: 'square',
      peak: 0.35,
      attack: 0.002,
      decay: 0.078,
      isNoise: false,
    },
  ];
}

export function createCardPickVoices(rarity: string = 'common'): VoiceSpec[] {
  if (rarity === 'legendary') {
    return [
      { when: 0.00, dur: 0.20, freq: 587.33, type: 'sine', peak: 0.3, attack: 0.002, decay: 0.198 },
      { when: 0.06, dur: 0.20, freq: 739.99, type: 'sine', peak: 0.35, attack: 0.002, decay: 0.198 },
      { when: 0.12, dur: 0.25, freq: 880.00, type: 'sine', peak: 0.4, attack: 0.002, decay: 0.248 },
      { when: 0.18, dur: 0.35, freq: 1174.66, type: 'sine', peak: 0.45, attack: 0.002, decay: 0.348 },
    ];
  }
  if (rarity === 'rare' || rarity === 'epic') {
    return [
      { when: 0.00, dur: 0.18, freq: 587.33, type: 'sine', peak: 0.3, attack: 0.002, decay: 0.178 },
      { when: 0.06, dur: 0.20, freq: 880.00, type: 'sine', peak: 0.38, attack: 0.002, decay: 0.198 },
      { when: 0.12, dur: 0.25, freq: 1174.66, type: 'sine', peak: 0.42, attack: 0.002, decay: 0.248 },
    ];
  }
  return [
    { when: 0.00, dur: 0.15, freq: 587.33, type: 'sine', peak: 0.3, attack: 0.002, decay: 0.148 },
    { when: 0.06, dur: 0.18, freq: 880.00, type: 'sine', peak: 0.35, attack: 0.002, decay: 0.178 },
  ];
}

export function createComboTickVoices(combo: number = 1): VoiceSpec[] {
  const f = Math.min(2400, 880 + combo * 40);
  return [
    {
      when: 0,
      dur: 0.040,
      freq: f,
      type: 'sine',
      peak: 0.25,
      attack: 0.001,
      decay: 0.039,
      isNoise: false,
    },
  ];
}

export function createReviveVoices(): VoiceSpec[] {
  return [
    {
      when: 0.00,
      dur: 0.30,
      freq: 440,
      freqEnd: 880,
      type: 'sine',
      peak: 0.4,
      attack: 0.01,
      decay: 0.29,
      isNoise: false,
    },
    {
      when: 0.05,
      dur: 0.35,
      freq: 660,
      freqEnd: 1320,
      type: 'sine',
      peak: 0.35,
      attack: 0.01,
      decay: 0.34,
      isNoise: false,
    },
  ];
}

export function createVoidCollapseVoices(): VoiceSpec[] {
  return [
    {
      when: 0,
      dur: 0.35,
      freq: 180,
      freqEnd: 40,
      type: 'sine',
      peak: 0.6,
      attack: 0.01,
      decay: 0.34,
      isNoise: false,
    },
    {
      isNoise: true,
      when: 0,
      dur: 0.30,
      peak: 0.3,
      attack: 0.02,
      decay: 0.28,
      filter: 'lowpass',
      cutoff: 500,
      cutoffEnd: 100,
    },
  ];
}

export function createWarpJumpVoices(): VoiceSpec[] {
  return [
    {
      when: 0,
      dur: 2.2,
      freq: 80,
      freqEnd: 880,
      type: 'sawtooth',
      peak: 0.4,
      attack: 0.05,
      decay: 2.15,
      isNoise: false,
    },
    {
      isNoise: true,
      when: 0,
      dur: 2.2,
      peak: 0.35,
      attack: 0.1,
      decay: 2.1,
      filter: 'bandpass',
      cutoff: 200,
      cutoffEnd: 3500,
      q: 3.5,
    },
    {
      when: 2.1,
      dur: 1.0,
      freq: 40,
      freqEnd: 40,
      type: 'sine',
      peak: 0.7,
      attack: 0.01,
      decay: 0.99,
      isNoise: false,
    },
  ];
}

export function createUniqueHelmetRevealVoices(): VoiceSpec[] {
  const pitches = [261.63, 329.63, 392.00, 493.88, 587.33];
  const delays = [0.0, 0.05, 0.10, 0.15, 0.20];
  return pitches.map((pitch, idx) => ({
    when: delays[idx]!,
    dur: 0.45,
    freq: pitch,
    type: 'sine' as WaveShape,
    peak: 0.35,
    attack: 0.01,
    decay: 0.44,
  }));
}
