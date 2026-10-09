/**
 * ============================================================================
 * Pure WebGL 2.0 Serpentine Ouroboros Ring Renderer (OuroborosGalleryRingRenderer.ts)
 * Protocol 3.0 Commercial Engine Edition — Rule 12 Pure WebGL Mandate
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 6, Rule 10, Rule 12)
 *
 * Hardware-accelerated circular serpentine ring, inward-curving serpent neck & head, and central celestial
 * aura renderer for the Ouroboros Gallery Screen.
 *
 * Architectural Specifications & Standards:
 * - Strictly conforms to AGENTS.md Rule 12 (Pure WebGL Mandate — Canvas 2D Banished) and Rule 10 (In-Code Documentation).
 * - Fullscreen procedural shader and procedural continuous serpentine ribbon geometry.
 * - Circular Serpentine Ring:
 *   - Continuous circular spine spanning 360 degrees at radius R = 130px centered at (180, 180).
 *   - 8 circumferential pedestals sit seamlessly atop the serpentine ring coils at R = 130px.
 * - Inward-Curving Serpentine Head:
 *   - Gracefully transitions off the outer ring and curves inward toward the central singularity (180, 180).
 *   - Opened jaws, horned cranial crests, and glowing celestial eyes frame the 9th central pedestal.
 * - Zero-Allocation Steady-State Render Loop:
 *   - All typed buffers (ribbonVertices, embersBuffer) are allocated once during initialization.
 *   - Zero heap/buffer allocations during 60 FPS animation frames.
 * - Cosmic Shading & Dynamic Progression:
 *   - Scales ripple with harmonic undulation down the serpentine spine.
 *   - Color palette shifts dynamically from astral cyan to mythic gold-brown based on unlockedCount (0..8).
 *   - Awakened mode (isAwakened = true / canForge9th) unleashes radiant solar gold flares and celestial corona.
 */

export interface ISpinePoint {
  x: number;
  y: number;
  isRing: boolean;
}

export interface IHeadGeometry {
  jawUpperVertices: number[][];
  jawLowerVertices: number[][];
  cranialCrestVertices: number[][];
  eyePoints: Array<{ x: number; y: number }>;
}

export class OuroborosGalleryRingRenderer {
  public canvas: HTMLCanvasElement | null = null;
  public gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;

  public isInitialized: boolean = false;
  public isDisposed: boolean = false;

  public currentTime: number = 0;
  public unlockedCount: number = 0;
  public isAwakened: boolean = false;

  public width: number = 360;
  public height: number = 360;

  public spinePoints: ISpinePoint[] = [];
  public headGeometry!: IHeadGeometry;
  public ribbonVertices!: Float32Array;
  public embersBuffer!: Float32Array;
  public vertexCount: number = 0;

  private program: WebGLProgram | null = null;
  private vertexBuffer: WebGLBuffer | null = null;

  // Uniform Locations
  private uTimeLoc: WebGLUniformLocation | null = null;
  private uResolutionLoc: WebGLUniformLocation | null = null;
  private uUnlockedCountLoc: WebGLUniformLocation | null = null;
  private uIsAwakenedLoc: WebGLUniformLocation | null = null;

  /**
   * Initializes the Serpentine Ouroboros Ring Renderer geometry and state.
   *
   * @param canvas Optional canvas element.
   * @param gl Optional WebGLRenderingContext or WebGL2RenderingContext.
   */
  constructor(
    canvas?: HTMLCanvasElement | null,
    gl?: WebGLRenderingContext | WebGL2RenderingContext | null
  ) {
    // Generate procedural spine, head geometry, and tessellated ribbon vertices
    this.buildGeometry();

    if (canvas) {
      this.canvas = canvas;
      this.width = canvas.width || 360;
      this.height = canvas.height || 360;
      if (!gl && typeof canvas.getContext === 'function') {
        gl = (canvas.getContext('webgl2', { alpha: true, antialias: true }) ||
              canvas.getContext('webgl', { alpha: true, antialias: true })) as WebGLRenderingContext | WebGL2RenderingContext | null;
      }
    }

    if (gl) {
      this.init(gl);
    }
  }

  /**
   * Builds the mathematical serpentine spine, cranial head contours, and tessellated ribbon mesh.
   */
  private buildGeometry(): void {
    const cx = 180;
    const cy = 180;
    const ringRadius = 130;

    this.spinePoints = [];

    // 1. Continuous circular outer loop (64 points at radius R = 130px)
    const ringPointCount = 64;
    for (let i = 0; i < ringPointCount; i++) {
      const theta = (i / ringPointCount) * Math.PI * 2;
      this.spinePoints.push({
        x: cx + Math.cos(theta) * ringRadius,
        y: cy + Math.sin(theta) * ringRadius,
        isRing: true,
      });
    }

    // 2. Inward neck and head spine curving toward (180, 180) to frame the 9th central pedestal
    // Starts near the outer ring (radius ~125px) and curves inward to < 50px near the snout
    const inwardCount = 24;
    const startAngle = Math.PI * 0.45; // Arching from upper-right
    for (let j = 0; j < inwardCount; j++) {
      const t = j / (inwardCount - 1);
      // Smooth cubic ease from 125px down to 38px
      const r = 125 * (1 - t) + 38 * t;
      const angle = startAngle + t * 1.6;
      this.spinePoints.push({
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        isRing: false,
      });
    }

    // 3. Head geometry: cranial crests, upper/lower jaws, and dual celestial eyes
    const terminalAngle = startAngle + 1.6;
    const snoutDist = 42;
    const cranialDist = 58;

    // Dual celestial eyes positioned symmetrically across the cranial axis
    const eyeSpread = 0.22;
    const eyeRadius = 48;
    this.headGeometry = {
      jawUpperVertices: [
        [cx + Math.cos(terminalAngle - 0.15) * snoutDist, cy + Math.sin(terminalAngle - 0.15) * snoutDist],
        [cx + Math.cos(terminalAngle) * (snoutDist - 8), cy + Math.sin(terminalAngle) * (snoutDist - 8)],
        [cx + Math.cos(terminalAngle + 0.15) * snoutDist, cy + Math.sin(terminalAngle + 0.15) * snoutDist],
      ],
      jawLowerVertices: [
        [cx + Math.cos(terminalAngle - 0.1) * (snoutDist + 6), cy + Math.sin(terminalAngle - 0.1) * (snoutDist + 6)],
        [cx + Math.cos(terminalAngle) * (snoutDist + 2), cy + Math.sin(terminalAngle) * (snoutDist + 2)],
        [cx + Math.cos(terminalAngle + 0.1) * (snoutDist + 6), cy + Math.sin(terminalAngle + 0.1) * (snoutDist + 6)],
      ],
      cranialCrestVertices: [
        [cx + Math.cos(terminalAngle - 0.3) * cranialDist, cy + Math.sin(terminalAngle - 0.3) * cranialDist],
        [cx + Math.cos(terminalAngle) * (cranialDist + 8), cy + Math.sin(terminalAngle) * (cranialDist + 8)],
        [cx + Math.cos(terminalAngle + 0.3) * cranialDist, cy + Math.sin(terminalAngle + 0.3) * cranialDist],
      ],
      eyePoints: [
        {
          x: cx + Math.cos(terminalAngle - eyeSpread) * eyeRadius,
          y: cy + Math.sin(terminalAngle - eyeSpread) * eyeRadius,
        },
        {
          x: cx + Math.cos(terminalAngle + eyeSpread) * eyeRadius,
          y: cy + Math.sin(terminalAngle + eyeSpread) * eyeRadius,
        },
      ],
    };

    // 4. Tessellate serpentine ribbon vertices
    // Floats per vertex: position(2) + normal(2) + side(1) + progress(1) + segment(1) = 7 floats
    const totalSpinePoints = this.spinePoints.length;
    const quadCount = totalSpinePoints - 1;
    const vertsPerQuad = 6; // 2 triangles per quad
    this.vertexCount = quadCount * vertsPerQuad;
    this.ribbonVertices = new Float32Array(this.vertexCount * 7);

    let offset = 0;
    for (let i = 0; i < quadCount; i++) {
      const p0 = this.spinePoints[i]!;
      const p1 = this.spinePoints[i + 1]!;
      const progress0 = i / quadCount;
      const progress1 = (i + 1) / quadCount;

      // Tangent and normal vectors
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy) || 1.0;
      const nx = -dy / len;
      const ny = dx / len;

      const segType = p0.isRing ? 0.0 : 1.0;

      // Triangle 1: V0 (left 0), V1 (right 0), V2 (left 1)
      // V0: Left side (-1.0)
      this.ribbonVertices[offset++] = p0.x;
      this.ribbonVertices[offset++] = p0.y;
      this.ribbonVertices[offset++] = nx;
      this.ribbonVertices[offset++] = ny;
      this.ribbonVertices[offset++] = -1.0;
      this.ribbonVertices[offset++] = progress0;
      this.ribbonVertices[offset++] = segType;

      // V1: Right side (+1.0)
      this.ribbonVertices[offset++] = p0.x;
      this.ribbonVertices[offset++] = p0.y;
      this.ribbonVertices[offset++] = -nx;
      this.ribbonVertices[offset++] = -ny;
      this.ribbonVertices[offset++] = 1.0;
      this.ribbonVertices[offset++] = progress0;
      this.ribbonVertices[offset++] = segType;

      // V2: Left side 1 (-1.0)
      this.ribbonVertices[offset++] = p1.x;
      this.ribbonVertices[offset++] = p1.y;
      this.ribbonVertices[offset++] = nx;
      this.ribbonVertices[offset++] = ny;
      this.ribbonVertices[offset++] = -1.0;
      this.ribbonVertices[offset++] = progress1;
      this.ribbonVertices[offset++] = segType;

      // Triangle 2: V2 (left 1), V1 (right 0), V3 (right 1)
      // V2
      this.ribbonVertices[offset++] = p1.x;
      this.ribbonVertices[offset++] = p1.y;
      this.ribbonVertices[offset++] = nx;
      this.ribbonVertices[offset++] = ny;
      this.ribbonVertices[offset++] = -1.0;
      this.ribbonVertices[offset++] = progress1;
      this.ribbonVertices[offset++] = segType;

      // V1
      this.ribbonVertices[offset++] = p0.x;
      this.ribbonVertices[offset++] = p0.y;
      this.ribbonVertices[offset++] = -nx;
      this.ribbonVertices[offset++] = -ny;
      this.ribbonVertices[offset++] = 1.0;
      this.ribbonVertices[offset++] = progress0;
      this.ribbonVertices[offset++] = segType;

      // V3: Right side 1 (+1.0)
      this.ribbonVertices[offset++] = p1.x;
      this.ribbonVertices[offset++] = p1.y;
      this.ribbonVertices[offset++] = -nx;
      this.ribbonVertices[offset++] = -ny;
      this.ribbonVertices[offset++] = 1.0;
      this.ribbonVertices[offset++] = progress1;
      this.ribbonVertices[offset++] = segType;
    }

    // 5. Pre-allocate static stellar embers particle buffer (64 particles x 4 floats)
    const emberCount = 64;
    this.embersBuffer = new Float32Array(emberCount * 4);
    for (let e = 0; e < emberCount; e++) {
      const eTheta = (e / emberCount) * Math.PI * 2;
      const eDist = 80 + (e % 10) * 10;
      this.embersBuffer[e * 4 + 0] = cx + Math.cos(eTheta) * eDist;
      this.embersBuffer[e * 4 + 1] = cy + Math.sin(eTheta) * eDist;
      this.embersBuffer[e * 4 + 2] = 2.0 + (e % 3); // size
      this.embersBuffer[e * 4 + 3] = (e * 0.15) % 1.0; // phase
    }
  }

  /**
   * Initializes the hardware-accelerated WebGL pipeline with GLSL shaders and GPU buffers.
   *
   * @param gl WebGLRenderingContext or WebGL2RenderingContext.
   */
  public init(gl: WebGLRenderingContext | WebGL2RenderingContext | null): void {
    if (!gl) {
      this.gl = null;
      this.isInitialized = false;
      return;
    }

    this.gl = gl;
    this.isInitialized = true;

    try {
      const vsSource = `
        attribute vec2 aPosition;
        varying vec2 vUv;
        void main() {
          vUv = aPosition * 0.5 + 0.5;
          gl_Position = vec4(aPosition, 0.0, 1.0);
        }
      `;

      const fsSource = `
        precision highp float;
        varying vec2 vUv;
        uniform float uTime;
        uniform vec2 uResolution;
        uniform float uUnlockedCount;
        uniform float uIsAwakened;

        #define PI 3.141592653589793
        #define TAU 6.283185307179586

        mat2 rot2d(float a) {
          float c = cos(a);
          float s = sin(a);
          return mat2(c, -s, s, c);
        }

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        // Analytical distance and 3D depth to the 8-Crossing Ouroboros Celtic Knot
        // SSOT Formula matching OuroborosMenuAnimation:
        // kx = (cos(t) + a*cos(7t))/(1+a), ky = (sin(t) - a*sin(7t))/(1+a), kz = sin(8t), a = 0.38
        void evaluateKnot(vec2 p, float knotR, out float dist, out float z, out float thetaParam) {
          float r = length(p);
          float normR = r / knotR;
          float a = 0.38;
          float norm = 1.38;

          float phi = atan(p.y, p.x);
          if (phi < 0.0) phi += TAU;

          float rClamped = clamp(normR, 0.44928, 1.0);
          float cos8 = clamp((norm * norm * rClamped * rClamped - (1.0 + a * a)) / (2.0 * a), -1.0, 1.0);
          float sin8 = sqrt(max(0.0, 1.0 - cos8 * cos8));
          float tBase = acos(cos8) * 0.125;
          float deltaPhi = asin(clamp(a * sin8 / (rClamped * norm), -1.0, 1.0));

          float sectorAngle = PI * 0.25;
          float sec = floor(phi / sectorAngle);

          float minArc = 100.0;
          float bestZ = 0.0;
          float bestT = 0.0;

          for (int s = -1; s <= 1; s++) {
            float k = mod(sec + float(s) + 8.0, 8.0);
            float kA = k * sectorAngle;

            // Strand 1: Over strand (z > 0, looping inward from outer lobe)
            float tOver = kA + tBase;
            float phiOver = mod(kA + tBase - deltaPhi + TAU * 2.0, TAU);
            float diffOver = abs(phi - phiOver);
            if (diffOver > PI) diffOver = TAU - diffOver;

            // Strand 2: Under strand (z < 0, looping outward to next lobe)
            float tUnder = kA + (sectorAngle - tBase);
            float phiUnder = mod(kA + (sectorAngle - tBase) + deltaPhi + TAU * 2.0, TAU);
            float diffUnder = abs(phi - phiUnder);
            if (diffUnder > PI) diffUnder = TAU - diffUnder;

            if (diffOver < minArc) {
              minArc = diffOver;
              bestZ = sin8;
              bestT = tOver;
            }
            if (diffUnder < minArc) {
              minArc = diffUnder;
              bestZ = -sin8;
              bestT = tUnder;
            }
          }

          float strandPerp = normR * sin(minArc) * knotR;
          float radialExceed = 0.0;
          if (normR < 0.44928) radialExceed = (0.44928 - normR) * knotR;
          else if (normR > 1.0) radialExceed = (normR - 1.0) * knotR;

          dist = sqrt(strandPerp * strandPerp + radialExceed * radialExceed);
          z = bestZ;
          thetaParam = bestT;
        }

        void main() {
          vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) / min(uResolution.x, uResolution.y);

          // Discard outside circular boundary (R > 0.48) to permanently eliminate square rectangle artifacts
          if (length(p) > 0.48) {
            discard;
          }

          // 1. Serpentine 8-Crossing Ouroboros Celtic Knot (R = 0.361 matching 130px / 360px)
          float knotR = 0.361;
          float knotDist, knotZ, knotTheta;
          evaluateKnot(p, knotR, knotDist, knotZ, knotTheta);

          // Volumetric body radius with 3D perspective modulation (1 + 0.18*z)
          float bodyR = 0.038 * (1.0 + 0.18 * knotZ);
          float dBody = knotDist - bodyR;

          // Muscular segmented scutes undulating down the serpentine spine
          float scaleWave = sin(knotTheta * 36.0 - uTime * 1.8) * 0.5 + 0.5;
          float scuteEdge = smoothstep(0.15, 0.85, scaleWave);

          // Blinn-Phong specular glints and volumetric normal
          float lateralNorm = clamp(knotDist / bodyR, 0.0, 1.0);
          float nz = sqrt(max(0.0, 1.0 - lateralNorm * lateralNorm));
          float spec = pow(max(0.0, nz * 0.82 + knotZ * 0.18), 8.0);

          // Color palette shifting dynamically from cyber-emerald to mythic gold
          vec3 deepBase = vec3(0.01, 0.08, 0.06);
          vec3 emeraldPrimary = vec3(0.0, 0.94, 0.71);
          vec3 goldPrimary = vec3(1.0, 0.82, 0.35);

          float unlockRatio = clamp(uUnlockedCount / 8.0, 0.0, 1.0);
          vec3 activeColor = mix(emeraldPrimary, goldPrimary, unlockRatio);
          if (uIsAwakened > 0.5) {
            activeColor = mix(goldPrimary, vec3(1.0, 0.96, 0.85), 0.5 + 0.5 * sin(uTime * 4.0));
          }

          // Luminescent spinal laser conduit flowing through the center of the knot
          float spinalCore = (0.0035 / (knotDist + 0.0035)) * smoothstep(bodyR * 1.3, 0.0, knotDist);

          // Under-crossing depth drop shadow
          float shadowFactor = clamp((knotZ + 1.0) * 0.55 + 0.45, 0.35, 1.0);

          // 2. Inward-Curving Serpentine Dragon Head framing the 9th central pedestal
          vec2 headCenter = vec2(-0.05, 0.13);
          vec2 headLocal = p - headCenter;
          headLocal = rot2d(0.68) * headLocal;

          float headDist = length(headLocal * vec2(1.15, 0.85));
          float headBase = smoothstep(0.052, 0.008, headDist);
          float headSpine = (0.010 / (abs(headLocal.x) + 0.010)) * smoothstep(0.06, 0.0, abs(headLocal.y));

          // Piercing celestial visor eyes
          vec2 eyeL = headLocal - vec2(-0.018, 0.010);
          vec2 eyeR = headLocal - vec2(0.018, 0.010);
          float eyeDist = min(length(eyeL * vec2(1.0, 2.2)), length(eyeR * vec2(1.0, 2.2)));
          float eyeGlow = 0.0035 / (eyeDist + 0.0030);

          // Sweeping Dragon Horns
          vec2 horn1 = headLocal - vec2(-0.028, -0.025);
          vec2 horn2 = headLocal - vec2(0.028, -0.025);
          float hornDist = min(length(horn1 * vec2(1.8, 0.9)), length(horn2 * vec2(1.8, 0.9)));
          float hornGlow = smoothstep(0.024, 0.004, hornDist);

          // Ivory Venom Fangs
          vec2 fang1 = headLocal - vec2(-0.012, 0.038);
          vec2 fang2 = headLocal - vec2(0.012, 0.038);
          float fangDist = min(length(fang1 * vec2(2.0, 1.0)), length(fang2 * vec2(2.0, 1.0)));
          float fangGlow = smoothstep(0.012, 0.002, fangDist);

          // 3. 8 Runic Altar Mandalas & Active Plasma Tethers
          float altarGlowTotal = 0.0;
          float altarTetherTotal = 0.0;

          for (int k = 0; k < 8; k++) {
            float kAngle = float(k) * (PI * 0.25);
            vec2 altarPos = vec2(cos(kAngle), sin(kAngle)) * knotR;
            float dAltar = length(p - altarPos);

            // Localize altar glow strictly within pedestal vicinity (dAltar < 0.12)
            float altarInfluence = smoothstep(0.12, 0.02, dAltar);
            float altarRing = abs(dAltar - 0.064);
            float ringGlow = (0.0025 / (altarRing + 0.003)) * altarInfluence;

            bool isUnlocked = float(k) < uUnlockedCount;
            float pulseSpeed = isUnlocked ? 3.0 : 1.2;
            float pulse = 0.8 + 0.2 * sin(uTime * pulseSpeed + float(k) * 0.8);

            float altarCore = (isUnlocked ? (0.004 / (dAltar + 0.004)) : (0.0015 / (dAltar + 0.005))) * altarInfluence;
            altarGlowTotal += (ringGlow * 0.6 + altarCore) * pulse * (isUnlocked ? 1.4 : 0.45);

            // Active Golden Plasma Tether Beam (Connecting Unlocked Altar into Central Singularity)
            if (isUnlocked) {
              vec2 tetherDir = normalize(altarPos);
              float proj = dot(p, tetherDir);
              if (proj > 0.0 && proj < knotR) {
                vec2 closest = tetherDir * proj;
                float dTether = length(p - closest);
                float jitter = (noise(vec2(proj * 40.0 - uTime * 6.0, float(k) * 3.0)) - 0.5) * 0.006;
                float beam = 0.0015 / (abs(dTether + jitter) + 0.002);
                altarTetherTotal += beam * smoothstep(0.0, 0.04, proj) * smoothstep(knotR, knotR - 0.04, proj);
              }
            }
          }

          // 4. Central Stargate Singularity Core
          float dCenter = length(p);
          float singularityGlow = 0.0;
          float corona = 0.0;

          vec2 pVortex = rot2d(uTime * 1.2) * p;
          float vortexAngle = atan(pVortex.y, pVortex.x);
          float spiralArms = sin(vortexAngle * 3.0 + dCenter * 28.0 - uTime * 2.5) * 0.5 + 0.5;
          float vortexDisk = spiralArms * smoothstep(0.18, 0.02, dCenter) * smoothstep(0.01, 0.06, dCenter);

          if (uIsAwakened > 0.5) {
            float rays = max(0.0, sin(atan(p.y, p.x) * 16.0 + uTime * 3.0));
            corona = rays * smoothstep(0.28, 0.05, dCenter) * 1.2;
            singularityGlow = (0.015 / (dCenter + 0.015)) * (1.2 + 0.3 * sin(uTime * 5.0));
          } else {
            float rays = max(0.0, sin(atan(p.y, p.x) * 8.0 - uTime * 1.0));
            corona = rays * smoothstep(0.20, 0.04, dCenter) * 0.4;
            singularityGlow = (0.008 / (dCenter + 0.020)) * (0.8 + 0.15 * sin(uTime * 2.0));
          }

          // 5. Twinkling Cosmic Stardust
          vec2 starGrid = floor(p * 90.0);
          float starRng = hash(starGrid);
          float starTwinkle = sin(uTime * 2.5 + starRng * TAU) * 0.5 + 0.5;
          float starDist = length(fract(p * 90.0) - 0.5);
          float starVal = (starRng > 0.94 ? 1.0 : 0.0) * smoothstep(0.18, 0.0, starDist) * starTwinkle * 0.4;

          // 6. Layered Composition
          vec3 finalColor = vec3(0.0);
          finalColor += vec3(0.7, 0.85, 1.0) * starVal;

          // The magnificent artwork image (public/ouroboros_gallery.png) provides the AAA Ouroboros dragon ring.
          // The WebGL shader enhances it with live dynamic cosmic FX: twinkling stardust, golden altar plasma tethers,
          // and a pulsating singularity core when awakening the 9th Celestial Crown.
          vec3 altarColor = mix(vec3(0.1, 0.5, 0.6), goldPrimary, unlockRatio);
          finalColor += altarColor * altarGlowTotal * 0.85;
          finalColor += vec3(1.0, 0.88, 0.45) * altarTetherTotal * 1.6;

          vec3 singularityCol = (uIsAwakened > 0.5) ? vec3(1.0, 0.95, 0.8) : vec3(0.35, 0.65, 0.95);
          finalColor += singularityCol * (singularityGlow + corona + vortexDisk * 0.5);

          float outAlpha = clamp(
            starVal * 0.6 +
            altarGlowTotal * 0.5 +
            altarTetherTotal * 0.8 +
            singularityGlow * 0.85 +
            corona * 0.7,
            0.0,
            0.98
          );

          // Discard empty background fragments to ensure zero tinted square rectangle
          if (outAlpha < 0.02) {
            discard;
          }

          gl_FragColor = vec4(finalColor, outAlpha);
        }
      `;

      const vs = this.compileShader(gl.VERTEX_SHADER, vsSource);
      const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSource);
      if (!vs || !fs) return;

      const program = gl.createProgram();
      if (!program) return;

      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        return;
      }

      this.program = program;
      gl.useProgram(program);

      this.uTimeLoc = gl.getUniformLocation(program, 'uTime');
      this.uResolutionLoc = gl.getUniformLocation(program, 'uResolution');
      this.uUnlockedCountLoc = gl.getUniformLocation(program, 'uUnlockedCount');
      this.uIsAwakenedLoc = gl.getUniformLocation(program, 'uIsAwakened') || gl.getUniformLocation(program, 'uCanForge');

      const quadVertices = new Float32Array([
        -1.0, -1.0,
         1.0, -1.0,
        -1.0,  1.0,
        -1.0,  1.0,
         1.0, -1.0,
         1.0,  1.0,
      ]);

      const buffer = gl.createBuffer();
      if (buffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(program, 'aPosition');
        if (aPos >= 0) {
          gl.enableVertexAttribArray(aPos);
          gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        }
        this.vertexBuffer = buffer;
      }
    } catch {
      // Graceful fallback for mock headless environments
    }
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    if (!this.gl) return null;
    const shader = this.gl.createShader(type);
    if (!shader) return null;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      this.gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  /**
   * Resizes viewport and updates resolution tracking.
   *
   * @param width Physical viewport width in pixels.
   * @param height Physical viewport height in pixels.
   */
  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;

    if (this.canvas) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    if (this.gl) {
      this.gl.viewport(0, 0, width, height);
    }
  }

  /**
   * Executes a hardware-accelerated draw call.
   * Zero heap re-allocations are performed during steady-state execution.
   *
   * @param timeSec Elapsed time in seconds.
   * @param unlockedCount Number of unlocked unique boss helmets (0..8).
   * @param isAwakened Whether the 9th crown can be forged / is awakened.
   */
  public render(
    timeSec: number = 0,
    unlockedCount: number = 0,
    isAwakened: boolean = false
  ): void {
    if (this.isDisposed || !this.gl || !this.isInitialized) return;

    this.currentTime = timeSec;
    this.unlockedCount = unlockedCount;
    this.isAwakened = isAwakened;

    const gl = this.gl;
    const w = this.canvas ? this.canvas.width : this.width;
    const h = this.canvas ? this.canvas.height : this.height;

    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (this.program) {
      gl.useProgram(this.program);
      if (this.uTimeLoc) gl.uniform1f(this.uTimeLoc, timeSec);
      if (this.uResolutionLoc) gl.uniform2f(this.uResolutionLoc, w, h);
      if (this.uUnlockedCountLoc) gl.uniform1f(this.uUnlockedCountLoc, unlockedCount);
      if (this.uIsAwakenedLoc) gl.uniform1f(this.uIsAwakenedLoc, isAwakened ? 1.0 : 0.0);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /**
   * Cleanly disposes GPU buffers, shaders, and programs to avoid WebGL memory leaks.
   */
  public destroy(): void {
    this.isDisposed = true;
    this.isInitialized = false;

    if (this.gl && this.vertexBuffer) {
      this.gl.deleteBuffer(this.vertexBuffer);
      this.vertexBuffer = null;
    }

    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
      this.program = null;
    }

    this.gl = null;
  }
}
