/**
 * Ouroboros Ascension — Mathematical Utility Functions (MathX.ts)
 *
 * Implements float64 mathematical operations matching C# Core.MathX bit-for-bit.
 * Provides angular arithmetic (shortest signed delta, angle wrapping), bounded clamping,
 * singularity-safe lengths, 32-bit integer multiplication, frame-rate independent exponential decay,
 * cubic Hermite smoothstep easings, and 2D geometric queries.
 *
 * Physical & Simulation Invariants:
 * - Angular Domain: Standard radian range $(-\pi, \pi]$ where $0$ points East (+X), $\frac{\pi}{2}$ points South (+Y).
 * - Timestep Independence: Exponential damping factors use normalized $60\,\text{Hz}$ references: $k^{\Delta t \cdot 60}$.
 * - Zero-NaN Guarantee: All functions sanitize non-finite inputs, returning safe fallbacks to prevent simulation blowup.
 */

export class MathX {
  /** Tau constant $\tau = 2\pi \approx 6.283185307179586$. Full circular revolution in radians. */
  public static readonly Tau = Math.PI * 2.0;
  /** Pi constant $\pi \approx 3.141592653589793$. Half circular revolution in radians. */
  public static readonly Pi = Math.PI;

  public static readonly tau = Math.PI * 2.0;
  public static readonly pi = Math.PI;

  /**
   * Computes the shortest signed angular delta from angle $a$ to angle $b$ in radians:
   *
   * Formula:
   *   $$\Delta\theta = ((b - a) \pmod{2\pi})$$
   *   $$\Delta\theta \leftarrow \begin{cases} \Delta\theta - 2\pi & \text{if } \Delta\theta > \pi \\ \Delta\theta + 2\pi & \text{if } \Delta\theta < -\pi \\ \Delta\theta & \text{otherwise} \end{cases}$$
   *
   * ASCII:
   *   d = (b - a) % (2 * PI)
   *   if (d > PI) d -= 2 * PI
   *   if (d < -PI) d += 2 * PI
   *
   * @param a Starting angle in radians.
   * @param b Target angle in radians.
   * @returns Shortest signed angle difference in $(-\pi, \pi]$ (positive = clockwise in screen space).
   */
  public static angleDelta(a: number, b: number): number {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    let d = (b - a) % MathX.Tau;
    if (d > Math.PI) d -= MathX.Tau;
    if (d < -Math.PI) d += MathX.Tau;
    return d;
  }
  public static AngleDelta(a: number, b: number): number {
    return MathX.angleDelta(a, b);
  }

  /**
   * Wraps an arbitrary angle in radians into the principal canonical interval $(-\pi, \pi]$:
   *
   * Formula:
   *   $$\theta_{\text{wrapped}} = (a \pmod{2\pi}) \in (-\pi, \pi]$$
   *
   * @param a Angle in radians.
   * @returns Wrapped angle in $(-\pi, \pi]$.
   */
  public static wrapAngle(a: number): number {
    if (!Number.isFinite(a)) return 0;
    let d = a % MathX.Tau;
    if (d > Math.PI) d -= MathX.Tau;
    if (d < -Math.PI) d += MathX.Tau;
    return d;
  }
  public static WrapAngle(a: number): number {
    return MathX.wrapAngle(a);
  }

  /**
   * Clamps scalar value $v$ within the closed interval $[\text{lo}, \text{hi}]$:
   *
   * Formula:
   *   $$\operatorname{clamp}(v, \text{lo}, \text{hi}) = \min(\max(v, \text{lo}), \text{hi})$$
   *
   * Invariant: Returns `lo` if $v$ is NaN to avoid poison propagation.
   *
   * @param v Input value.
   * @param lo Minimum lower bound.
   * @param hi Maximum upper bound.
   * @returns Clamped value in $[\text{lo}, \text{hi}]$.
   */
  public static clamp(v: number, lo: number, hi: number): number {
    if (Number.isNaN(v)) return lo;
    return v < lo ? lo : v > hi ? hi : v;
  }
  public static Clamp(v: number, lo: number, hi: number): number {
    return MathX.clamp(v, lo, hi);
  }

  /**
   * Clamps scalar value $v$ strictly into unit interval $[0, 1]$:
   *
   * Formula:
   *   $$\operatorname{clamp}_{0,1}(v) = \min(\max(v, 0), 1)$$
   *
   * @param v Input scalar.
   * @returns Clamped scalar in $[0, 1]$.
   */
  public static clamp01(v: number): number {
    return MathX.clamp(v, 0, 1);
  }
  public static Clamp01(v: number): number {
    return MathX.clamp(v, 0, 1);
  }

  /**
   * Computes Euclidean magnitude $\sqrt{\Delta x^2 + \Delta y^2}$ with a $10^{-6}$ epsilon floor:
   *
   * Formula:
   *   $$L_{\text{safe}} = \max\left(10^{-6}, \sqrt{\Delta x^2 + \Delta y^2}\right)$$
   *
   * Safeguard: Allows callers to divide by length without explicit zero guards.
   *
   * @param dx Delta X.
   * @param dy Delta Y.
   * @returns Positive magnitude $\ge 10^{-6}$.
   */
  public static safeLen(dx: number, dy: number): number {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 1e-6;
    const d = Math.sqrt(dx * dx + dy * dy);
    return Number.isFinite(d) && d > 1e-6 ? d : 1e-6;
  }
  public static SafeLen(dx: number, dy: number): number {
    return MathX.safeLen(dx, dy);
  }

  /**
   * Overflow-safe Euclidean magnitude $\sqrt{a^2 + b^2}$ via `Math.hypot`.
   *
   * @param a First component.
   * @param b Second component.
   * @returns Safe hypotenuse.
   */
  public static hypot(a: number, b: number): number {
    return Math.hypot(a, b);
  }
  public static Hypot(a: number, b: number): number {
    return MathX.hypot(a, b);
  }

  /**
   * 32-bit signed integer multiplication with C-like wraparound via `Math.imul`.
   *
   * @param a 32-bit integer A.
   * @param b 32-bit integer B.
   * @returns 32-bit integer product.
   */
  public static imul(a: number, b: number): number {
    return Math.imul(a, b);
  }
  public static Imul(a: number, b: number): number {
    return MathX.imul(a, b);
  }

  /**
   * Linear interpolation (LERP) between $a$ and $b$:
   *
   * Formula:
   *   $$\operatorname{lerp}(a, b, t) = a + t(b - a) = (1 - t)a + tb$$
   *
   * @param a Start value at $t = 0$.
   * @param b Target value at $t = 1$.
   * @param t Interpolation parameter.
   * @returns Interpolated value.
   */
  public static lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }
  public static Lerp(a: number, b: number, t: number): number {
    return MathX.lerp(a, b, t);
  }

  /**
   * Frame-rate-independent exponential drag / decay factor referenced to $60\,\text{Hz}$:
   *
   * Formula:
   *   $$F_{\text{decay}} = k^{\Delta t \cdot 60} = e^{\ln(k) \cdot 60 \Delta t}$$
   *
   * Physics Derivation:
   *   Given continuous damping $\frac{dv}{dt} = -\gamma v$, velocity decays as $v(t) = v_0 e^{-\gamma t}$.
   *   In discrete 60 Hz steps, $v_{n+1} = k v_n$. For arbitrary $\Delta t$, $v(\Delta t) = v_0 k^{\Delta t / (1/60)} = v_0 k^{60 \Delta t}$.
   *
   * @param k Retention factor per 1/60s tick (e.g. 0.95 for 5% decay per frame).
   * @param dt Elapsed timestep delta in seconds.
   * @returns Scaling multiplier to apply to the decaying quantity.
   */
  public static decay(k: number, dt: number): number {
    return Math.pow(k, dt * 60.0);
  }
  public static Decay(k: number, dt: number): number {
    return MathX.decay(k, dt);
  }

  /**
   * Signed unit signum function: $+1$ if $v > 0$, $-1$ if $v < 0$, $0$ if $v = 0$.
   *
   * @param v Input scalar.
   * @returns Signum value.
   */
  public static sign(v: number): number {
    return v > 0 ? 1 : v < 0 ? -1 : 0;
  }
  public static Sign(v: number): number {
    return MathX.sign(v);
  }

  /**
   * JavaScript-exact half-up rounding matching `Math.round(v)` for non-negative values.
   *
   * @param v Input scalar.
   * @returns Rounded integer.
   */
  public static roundJs(v: number): number {
    return Math.floor(v + 0.5);
  }
  public static RoundJs(v: number): number {
    return MathX.roundJs(v);
  }

  /**
   * Checks whether scalar $v$ is a finite IEEE 754 number (not NaN or $\pm\infty$).
   *
   * @param v Value to check.
   * @returns True if finite.
   */
  public static isFinite(v: number): boolean {
    return Number.isFinite(v);
  }
  public static IsFinite(v: number): boolean {
    return MathX.isFinite(v);
  }

  /**
   * Cubic Hermite smoothstep interpolation on unit range $[0, 1]$:
   *
   * Formula:
   *   $$S(t) = 3\bar{t}^2 - 2\bar{t}^3 \quad \text{where } \bar{t} = \operatorname{clamp}(t, 0, 1)$$
   *
   * Properties:
   * - Smooth first derivative: $S'(0) = 0$ and $S'(1) = 0$.
   * - Zero velocity at endpoints, producing natural ease-in / ease-out motion.
   *
   * @param t Input interpolation factor.
   * @returns Eased value in $[0, 1]$.
   */
  public static smoothstep(t: number): number {
    const clamped = MathX.clamp(t, 0, 1);
    return clamped * clamped * (3.0 - 2.0 * clamped);
  }
  public static SmoothStep(t: number): number {
    return MathX.smoothstep(t);
  }

  /**
   * Formats a numeric score with standard US digit grouping commas:
   * e.g., $1254300 \to \text{"1,254,300"}$.
   *
   * @param score Raw floating-point score.
   * @returns Formatted string representation.
   */
  public static formatScore(score: number): string {
    return Math.floor(score).toLocaleString('en-US');
  }
  public static FormatScore(score: number): string {
    return MathX.formatScore(score);
  }

  /**
   * Computes the minimum Euclidean distance from a 2D point $P(px, py)$ to a finite line segment $S(A, B)$:
   *
   * Formula:
   *   Segment Vector: $\vec{V} = B - A = (x_2 - x_1, y_2 - y_1)$
   *   Squared Length: $L^2 = |\vec{V}|^2 = \Delta x^2 + \Delta y^2$
   *   Projection Parameter:
   *   $$t = \operatorname{clamp}\left(\frac{(P - A) \cdot \vec{V}}{L^2}, 0, 1\right)$$
   *   Closest Point on Segment: $C = A + t \cdot \vec{V}$
   *   Distance:
   *   $$d = \|P - C\| = \sqrt{(px - C_x)^2 + (py - C_y)^2}$$
   *
   * Edge Cases Handled:
   * - Degenerate Segment ($L^2 \le 10^{-12}$): Returns distance from $P$ to endpoint $A$.
   * - Non-finite Coordinates: Returns $0.0$ to prevent NaN infection.
   *
   * @param px Query point X.
   * @param py Query point Y.
   * @param x1 Segment start X.
   * @param y1 Segment start Y.
   * @param x2 Segment end X.
   * @param y2 Segment end Y.
   * @returns Minimum Euclidean distance from point to segment.
   */
  public static pointToSegmentDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
      return 0;
    }
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (!Number.isFinite(l2) || l2 <= 1e-12) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  public static PointToSegmentDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    return MathX.pointToSegmentDist(px, py, x1, y1, x2, y2);
  }

  /**
   * Computes the squared Euclidean distance between two 2D points $(x_1, y_1)$ and $(x_2, y_2)$:
   *
   * Formula:
   *   $$d^2 = (x_2 - x_1)^2 + (y_2 - y_1)^2$$
   *
   * ASCII:
   *   distSq = dx * dx + dy * dy
   *
   * Performance: Avoids expensive square root calculation for circle collision broadphase.
   *
   * @param x1 First point X.
   * @param y1 First point Y.
   * @param x2 Second point X.
   * @param y2 Second point Y.
   * @returns Squared Euclidean distance, or 0 if non-finite.
   */
  public static distSq(x1: number, y1: number, x2: number, y2: number): number {
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
      return 0;
    }
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
  }
  public static DistSq(x1: number, y1: number, x2: number, y2: number): number {
    return MathX.distSq(x1, y1, x2, y2);
  }

  /**
   * Computes the Euclidean distance between two 2D points $(x_1, y_1)$ and $(x_2, y_2)$:
   *
   * Formula:
   *   $$d = \sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}$$
   *
   * ASCII:
   *   dist = hypot(x2 - x1, y2 - y1)
   *
   * Invariant: Overflow-safe via JS `Math.hypot`.
   *
   * @param x1 First point X.
   * @param y1 First point Y.
   * @param x2 Second point X.
   * @param y2 Second point Y.
   * @returns Euclidean distance, or 0 if non-finite.
   */
  public static dist(x1: number, y1: number, x2: number, y2: number): number {
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
      return 0;
    }
    return Math.hypot(x2 - x1, y2 - y1);
  }
  public static Dist(x1: number, y1: number, x2: number, y2: number): number {
    return MathX.dist(x1, y1, x2, y2);
  }

  /**
   * Tests whether two 2D circles overlap in the Cartesian plane:
   *
   * Formula:
   *   $$(x_2 - x_1)^2 + (y_2 - y_1)^2 \le (r_1 + r_2)^2$$
   *
   * ASCII:
   *   dx*dx + dy*dy <= (r1 + r2)^2
   *
   * Invariants:
   * - Returns false if radii are negative or any coordinate is NaN/infinite.
   * - Tangent boundary touching is treated as overlapping ($\le$).
   *
   * @param x1 Circle 1 center X.
   * @param y1 Circle 1 center Y.
   * @param r1 Circle 1 radius.
   * @param x2 Circle 2 center X.
   * @param y2 Circle 2 center Y.
   * @param r2 Circle 2 radius.
   * @returns True if circles overlap or touch.
   */
  public static circleOverlap(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number): boolean {
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(r1) ||
        !Number.isFinite(x2) || !Number.isFinite(y2) || !Number.isFinite(r2) ||
        r1 < 0 || r2 < 0) {
      return false;
    }
    const dx = x2 - x1;
    const dy = y2 - y1;
    const rSum = r1 + r2;
    return dx * dx + dy * dy <= rSum * rSum;
  }
  public static CircleOverlap(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number): boolean {
    return MathX.circleOverlap(x1, y1, r1, x2, y2, r2);
  }

  /**
   * Linearly advances/decays a delta-time countdown timer monotonically down to zero:
   *
   * Formula:
   *   $$t' = \max(0, t - \Delta t)$$
   *
   * ASCII:
   *   decayTimer = max(0, timer - dt)
   *
   * Invariants:
   * - Monotonic decrease: Never undershoots below zero.
   * - Safe against negative $\Delta t$ or non-finite timer values.
   *
   * @param timer Current remaining timer duration in seconds.
   * @param dt Elapsed timestep delta in seconds.
   * @returns Updated non-negative timer value.
   */
  public static decayTimer(timer: number, dt: number): number {
    if (!Number.isFinite(timer) || timer <= 0) return 0;
    if (!Number.isFinite(dt) || dt <= 0) return timer;
    return timer > dt ? timer - dt : 0;
  }
  public static DecayTimer(timer: number, dt: number): number {
    return MathX.decayTimer(timer, dt);
  }

  /**
   * Clamps 2D coordinates within rectangular arena boundaries padded by an inward safety margin:
   *
   * Formula:
   *   $$x' = \operatorname{clamp}(x, \text{margin}, \text{width} - \text{margin})$$
   *   $$y' = \operatorname{clamp}(y, \text{margin}, \text{height} - \text{margin})$$
   *
   * @param x Entity X coordinate.
   * @param y Entity Y coordinate.
   * @param margin Inward safety buffer padding (typically entity radius).
   * @param width Arena boundary width.
   * @param height Arena boundary height.
   * @returns Bounded coordinates $\{x, y\}$.
   */
  public static clampToBounds(
    x: number,
    y: number,
    margin: number,
    width: number,
    height: number
  ): { x: number; y: number } {
    const safeMargin = Number.isFinite(margin) ? Math.max(0, margin) : 0;
    const minX = safeMargin;
    const maxX = Number.isFinite(width) ? Math.max(minX, width - safeMargin) : minX;
    const minY = safeMargin;
    const maxY = Number.isFinite(height) ? Math.max(minY, height - safeMargin) : minY;

    return {
      x: MathX.clamp(x, minX, maxX),
      y: MathX.clamp(y, minY, maxY),
    };
  }
  public static ClampToBounds(
    x: number,
    y: number,
    margin: number,
    width: number,
    height: number
  ): { x: number; y: number } {
    return MathX.clampToBounds(x, y, margin, width, height);
  }
}

