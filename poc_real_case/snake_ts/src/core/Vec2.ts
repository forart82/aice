/**
 * Ouroboros Ascension — 2D Vector Mathematics (Vec2.ts)
 *
 * Implements high-precision float64 2D vector operations matching C# Core.Vec2.
 * Provides complete vector algebra: Euclidean norms, angular representations,
 * linear interpolation (LERP), dot/cross products, projections, and singularity-safe normalization.
 *
 * Mathematical Foundation & Physical Invariants:
 * - Coordinate Space: Cartesian 2D plane with origin $(0, 0)$ at top-left.
 * - Angle Convention: Standard trigonometric radians in $(-\pi, \pi]$ where $0$ points along $+X$ (East),
 *   $\frac{\pi}{2}$ points along $+Y$ (South, screen space), and $-\frac{\pi}{2}$ points along $-Y$ (North).
 * - Singularity Protection: Normalization and division operations enforce an $\epsilon = 10^{-6}$ epsilon floor
 *   to eliminate IEEE 754 division-by-zero, NaN poisoning, and degenerate denormal penalties.
 * - Headless Independence: 100% pure float64 arithmetic with zero DOM or WebGL dependencies (Rule 6 compliant).
 */

import { MathX } from './MathX.js';

export class Vec2 {
  /** X coordinate component in floating-point simulation units. */
  public x: number;
  /** Y coordinate component in floating-point simulation units. */
  public y: number;

  /** X coordinate alias matching C# property naming convention. */
  public get X(): number { return this.x; }
  public set X(v: number) { this.x = v; }

  /** Y coordinate alias matching C# property naming convention. */
  public get Y(): number { return this.y; }
  public set Y(v: number) { this.y = v; }

  /** Immutable zero vector singleton $(0, 0)$. */
  public static readonly Zero = new Vec2(0, 0);
  public static readonly zero = Vec2.Zero;

  /**
   * Constructs a new 2D vector.
   *
   * @param x Initial X coordinate (default: 0).
   * @param y Initial Y coordinate (default: 0).
   */
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  /**
   * Sets new coordinate values for this vector in-place.
   *
   * @param x New X component.
   * @param y New Y component.
   * @returns This vector instance for method chaining.
   */
  public set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  /**
   * Copies coordinates from another vector into this instance.
   *
   * @param v Source vector to copy from.
   * @returns This vector instance for method chaining.
   */
  public copy(v: Vec2): this {
    this.x = v.x;
    this.y = v.y;
    return this;
  }

  /**
   * Computes the Euclidean magnitude (L2 norm) of the vector:
   *
   * Formula:
   *   $$|\vec{v}| = \sqrt{x^2 + y^2}$$
   *
   * ASCII:
   *   |v| = sqrt(x^2 + y^2)
   */
  public get length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  public get Length(): number {
    return this.length;
  }
  public getLength(): number {
    return this.length;
  }

  /**
   * Computes the squared Euclidean magnitude of the vector:
   *
   * Formula:
   *   $$|\vec{v}|^2 = x^2 + y^2$$
   *
   * ASCII:
   *   |v|^2 = x^2 + y^2
   *
   * Performance Optimization: Avoids expensive square root computation for distance tests.
   */
  public get lengthSquared(): number {
    return this.x * this.x + this.y * this.y;
  }
  public get LengthSquared(): number {
    return this.lengthSquared;
  }
  public get lengthSq(): number {
    return this.lengthSquared;
  }
  public getLengthSq(): number {
    return this.lengthSquared;
  }

  /**
   * Magnitude with a $10^{-6}$ epsilon floor, allowing safe division without guarding:
   *
   * Formula:
   *   $$L_{\text{safe}} = \max\left(10^{-6}, \sqrt{x^2 + y^2}\right)$$
   *
   * ASCII:
   *   safeLength = max(1e-6, hypot(x, y))
   */
  public get safeLength(): number {
    return MathX.safeLen(this.x, this.y);
  }
  public get SafeLength(): number {
    return this.safeLength;
  }

  /**
   * Computes the polar orientation angle in radians:
   *
   * Formula:
   *   $$\theta = \operatorname{atan2}(y, x) \in (-\pi, \pi]$$
   *
   * ASCII:
   *   theta = atan2(y, x)
   */
  public get angle(): number {
    return Math.atan2(this.y, this.x);
  }
  public get Angle(): number {
    return this.angle;
  }
  public getAngle(): number {
    return this.angle;
  }

  /**
   * Computes the normalized unit vector $\hat{v}$ pointing in the identical direction:
   *
   * Formula:
   *   $$\hat{v} = \begin{cases} \left(\frac{x}{d}, \frac{y}{d}\right) & \text{if } d > 10^{-6} \text{ and finite} \\ (0, 0) & \text{otherwise} \end{cases}$$
   *   where $d = \sqrt{x^2 + y^2}$.
   *
   * Invariant: Never produces NaN, $\pm\infty$, or subnormal float poisoning.
   */
  public get normalized(): Vec2 {
    if (!this.isFinite) return new Vec2(0, 0);
    const d = Math.hypot(this.x, this.y);
    if (!Number.isFinite(d) || d <= 1e-6) return new Vec2(0, 0);
    return new Vec2(this.x / d, this.y / d);
  }
  public get Normalized(): Vec2 {
    return this.normalized;
  }

  /**
   * Normalizes this vector returning a new normalized unit vector.
   *
   * @returns Normalized unit vector $\hat{v}$.
   */
  public normalize(): Vec2 {
    return this.normalized;
  }

  /**
   * Rescales this vector to an exact target magnitude while preserving orientation:
   *
   * Formula:
   *   $$\vec{v}' = \text{len} \cdot \hat{v} = \left(\frac{x}{d} \cdot \text{len}, \frac{y}{d} \cdot \text{len}\right)$$
   *
   * @param len Target length in simulation units.
   * @returns New scaled vector, or $(0, 0)$ if original vector is degenerate or length is non-finite.
   */
  public withLength(len: number): Vec2 {
    if (!this.isFinite || !Number.isFinite(len)) return new Vec2(0, 0);
    const d = Math.hypot(this.x, this.y);
    if (!Number.isFinite(d) || d <= 1e-6) return new Vec2(0, 0);
    return new Vec2((this.x / d) * len, (this.y / d) * len);
  }
  public WithLength(len: number): Vec2 {
    return this.withLength(len);
  }

  /**
   * Computes the Euclidean distance to another vector $\vec{o}$:
   *
   * Formula:
   *   $$d = \|\vec{o} - \vec{v}\| = \sqrt{(o_x - x)^2 + (o_y - y)^2}$$
   *
   * @param o Target vector.
   * @returns Euclidean distance, or 0 if inputs are non-finite.
   */
  public distanceTo(o: Vec2): number {
    if (!o || !this.isFinite || !o.isFinite) return 0;
    const dx = o.x - this.x;
    const dy = o.y - this.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  public DistanceTo(o: Vec2): number {
    return this.distanceTo(o);
  }

  /**
   * Zero-allocation Euclidean distance from this vector to raw coordinates $(ox, oy)$:
   *
   * Formula:
   *   $$d = \sqrt{(ox - x)^2 + (oy - y)^2}$$
   *
   * @param ox Target X coordinate.
   * @param oy Target Y coordinate.
   * @returns Euclidean distance.
   */
  public distanceToCoords(ox: number, oy: number): number {
    if (!this.isFinite || !Number.isFinite(ox) || !Number.isFinite(oy)) return 0;
    const dx = ox - this.x;
    const dy = oy - this.y;
    return Math.hypot(dx, dy);
  }
  public DistanceToCoords(ox: number, oy: number): number {
    return this.distanceToCoords(ox, oy);
  }

  /**
   * Computes the squared Euclidean distance to another vector $\vec{o}$:
   *
   * Formula:
   *   $$d^2 = \|\vec{o} - \vec{v}\|^2 = (o_x - x)^2 + (o_y - y)^2$$
   *
   * @param o Target vector.
   * @returns Squared Euclidean distance.
   */
  public distanceSquaredTo(o: Vec2): number {
    if (!o || !this.isFinite || !o.isFinite) return 0;
    const dx = o.x - this.x;
    const dy = o.y - this.y;
    return dx * dx + dy * dy;
  }
  public DistanceSquaredTo(o: Vec2): number {
    return this.distanceSquaredTo(o);
  }

  /**
   * Zero-allocation squared Euclidean distance from this vector to raw coordinates $(ox, oy)$:
   *
   * Formula:
   *   $$d^2 = (ox - x)^2 + (oy - y)^2$$
   *
   * @param ox Target X coordinate.
   * @param oy Target Y coordinate.
   * @returns Squared Euclidean distance without allocation.
   */
  public distanceSquaredToCoords(ox: number, oy: number): number {
    if (!this.isFinite || !Number.isFinite(ox) || !Number.isFinite(oy)) return 0;
    const dx = ox - this.x;
    const dy = oy - this.y;
    return dx * dx + dy * dy;
  }
  public DistanceSquaredToCoords(ox: number, oy: number): number {
    return this.distanceSquaredToCoords(ox, oy);
  }

  /**
   * Computes the 2D dot product (scalar product) between this vector and $\vec{o}$:
   *
   * Formula:
   *   $$\vec{v} \cdot \vec{o} = x \cdot o_x + y \cdot o_y = |\vec{v}| |\vec{o}| \cos\theta$$
   *
   * Physical Invariants:
   * - Positive: Acute angle ($|\theta| < \frac{\pi}{2}$).
   * - Zero: Orthogonal / perpendicular ($|\theta| = \frac{\pi}{2}$).
   * - Negative: Obtuse angle ($|\theta| > \frac{\pi}{2}$).
   *
   * @param o Other target vector.
   * @returns Scalar dot product.
   */
  public dot(o: Vec2): number {
    if (!o || !this.isFinite || !o.isFinite) return 0;
    return this.x * o.x + this.y * o.y;
  }
  public Dot(o: Vec2): number {
    return this.dot(o);
  }

  /**
   * Computes the 2D cross product (perp-dot product / signed 2D determinant):
   *
   * Formula:
   *   $$\vec{v} \times \vec{o} = x \cdot o_y - y \cdot o_x = |\vec{v}| |\vec{o}| \sin\theta$$
   *
   * Physical Invariants:
   * - Positive: $\vec{o}$ is counter-clockwise (left) from $\vec{v}$.
   * - Negative: $\vec{o}$ is clockwise (right) from $\vec{v}$.
   * - Zero: Vectors are collinear / parallel.
   *
   * @param o Other target vector.
   * @returns Signed perpendicular scalar product.
   */
  public cross(o: Vec2): number {
    if (!o || !this.isFinite || !o.isFinite) return 0;
    return this.x * o.y - this.y * o.x;
  }
  public Cross(o: Vec2): number {
    return this.cross(o);
  }

  /**
   * Computes the signed angle from this vector pointing toward vector $\vec{o}$:
   *
   * Formula:
   *   $$\theta = \operatorname{atan2}(o_y - y, o_x - x) \in (-\pi, \pi]$$
   *
   * @param o Target vector.
   * @returns Angle in radians pointing from this position to $\vec{o}$.
   */
  public angleTo(o: Vec2): number {
    if (!o || !this.isFinite || !o.isFinite) return 0;
    return Math.atan2(o.y - this.y, o.x - this.x);
  }
  public AngleTo(o: Vec2): number {
    return this.angleTo(o);
  }

  /**
   * Vector addition: $\vec{v}' = \vec{v} + \vec{o} = (x + o_x, y + o_y)$.
   *
   * @param o Vector to add.
   * @returns New Vec2 instance.
   */
  public add(o: Vec2): Vec2 {
    const ox = o && Number.isFinite(o.x) ? o.x : 0;
    const oy = o && Number.isFinite(o.y) ? o.y : 0;
    return new Vec2(this.x + ox, this.y + oy);
  }
  public Add(o: Vec2): Vec2 {
    return this.add(o);
  }

  /**
   * Vector subtraction: $\vec{v}' = \vec{v} - \vec{o} = (x - o_x, y - o_y)$.
   *
   * @param o Vector to subtract.
   * @returns New Vec2 instance.
   */
  public sub(o: Vec2): Vec2 {
    const ox = o && Number.isFinite(o.x) ? o.x : 0;
    const oy = o && Number.isFinite(o.y) ? o.y : 0;
    return new Vec2(this.x - ox, this.y - oy);
  }
  public Sub(o: Vec2): Vec2 {
    return this.sub(o);
  }

  /**
   * Scalar multiplication: $\vec{v}' = s \cdot \vec{v} = (s \cdot x, s \cdot y)$.
   *
   * @param s Scalar multiplier.
   * @returns New scaled Vec2 instance, or $(0, 0)$ on non-finite input.
   */
  public mul(s: number): Vec2 {
    if (!Number.isFinite(s) || !this.isFinite) return new Vec2(0, 0);
    return new Vec2(this.x * s, this.y * s);
  }
  public Mul(s: number): Vec2 {
    return this.mul(s);
  }

  /**
   * Scalar division: $\vec{v}' = \frac{1}{s} \cdot \vec{v} = \left(\frac{x}{s}, \frac{y}{s}\right)$.
   *
   * @param s Scalar divisor.
   * @returns New divided Vec2 instance, or $(0, 0)$ if divisor is zero or non-finite.
   */
  public div(s: number): Vec2 {
    if (s === 0 || !Number.isFinite(s) || !this.isFinite) return new Vec2(0, 0);
    return new Vec2(this.x / s, this.y / s);
  }
  public Div(s: number): Vec2 {
    return this.div(s);
  }

  /**
   * Vector negation: $\vec{v}' = -\vec{v} = (-x, -y)$.
   *
   * @returns Inverted Vec2 instance.
   */
  public neg(): Vec2 {
    return new Vec2(-this.x, -this.y);
  }
  public Neg(): Vec2 {
    return this.neg();
  }

  /**
   * Linear interpolation (LERP) between this vector and target vector $\vec{o}$:
   *
   * Formula:
   *   $$\vec{v}(t) = (1 - t)\vec{v} + t\vec{o} = \vec{v} + t(\vec{o} - \vec{v})$$
   *
   * @param o Target vector at $t = 1$.
   * @param t Interpolation factor $[0, 1]$.
   * @returns Interpolated Vec2 instance.
   */
  public lerp(o: Vec2, t: number): Vec2 {
    if (!o || !this.isFinite) return this.clone();
    const safeT = Number.isFinite(t) ? t : 0;
    const ox = Number.isFinite(o.x) ? o.x : this.x;
    const oy = Number.isFinite(o.y) ? o.y : this.y;
    return new Vec2(this.x + (ox - this.x) * safeT, this.y + (oy - this.y) * safeT);
  }
  public Lerp(o: Vec2, t: number): Vec2 {
    return this.lerp(o, t);
  }

  /**
   * Creates a deep copy of this vector.
   *
   * @returns New independent Vec2 instance with matching $(x, y)$.
   */
  public clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }
  public Clone(): Vec2 {
    return this.clone();
  }

  /**
   * Constructs a vector from polar coordinates:
   *
   * Formula:
   *   $$\vec{v} = (\text{len} \cdot \cos\theta, \text{len} \cdot \sin\theta)$$
   *
   * @param a Heading angle in radians $\theta$.
   * @param len Target length (default: 1.0).
   * @returns New Cartesian Vec2.
   */
  public static fromAngle(a: number, len = 1): Vec2 {
    return new Vec2(Math.cos(a) * len, Math.sin(a) * len);
  }
  public static FromAngle(a: number, len = 1): Vec2 {
    return Vec2.fromAngle(a, len);
  }

  /**
   * Tests strict equality with another Vec2 instance.
   *
   * @param o Object to compare.
   * @returns True if object is a Vec2 with identical $(x, y)$ coordinates.
   */
  public equals(o: unknown): boolean {
    if (!(o instanceof Vec2)) return false;
    return this.x === o.x && this.y === o.y;
  }
  public Equals(o: unknown): boolean {
    return this.equals(o);
  }

  /**
   * Formats coordinates as a human-readable 3-decimal string `(x.xxx, y.xxx)`.
   */
  public toString(): string {
    return `(${this.x.toFixed(3)}, ${this.y.toFixed(3)})`;
  }

  /**
   * Invariant Check: Returns true if both X and Y components are finite numbers (not NaN or $\pm\infty$).
   */
  public get isFinite(): boolean {
    return Number.isFinite(this.x) && Number.isFinite(this.y);
  }
  public get IsFinite(): boolean {
    return this.isFinite;
  }
}
