/**
 * ============================================================================
 * Pure WebGL 2.0 Circular Ring Renderer (OuroborosRingRenderer.ts)
 * Protocol 3.0 Commercial Engine Edition — Rule 12 Pure WebGL Mandate
 * ============================================================================
 *
 * Single Source of Truth (SSOT): ORACLE.md & AGENTS.md (Rule 6, Rule 10, Rule 12)
 *
 * ARCHITECTURAL SUMMARY:
 * ---------------------
 * Hardware-accelerated circular serpentine ring and cosmic singularity renderer.
 * Strictly adheres to AGENTS.md Rule 12 (Canvas 2D Banished) and Rule 10 (Documentation Standards).
 *
 * RENDERING PIPELINE:
 * - Direct WebGL 2.0 context acquisition (fallback to WebGL 1.0 where applicable).
 * - Fullscreen procedural quad with analytical distance-field (SDF) evaluation.
 * - Dynamic harmonic serpent scales, glowing spinal pulse, and chromatic celestial nebula.
 * - Inward-arching energy conduits feeding into the central singularity accretion disk.
 */

export class OuroborosRingRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private uTimeLoc: WebGLUniformLocation | null = null;
  private uResolutionLoc: WebGLUniformLocation | null = null;
  private uUnlockedLoc: WebGLUniformLocation | null = null;
  private animFrameId: number | null = null;
  private startTime: number = Date.now();
  private isDisposed: boolean = false;

  /**
   * Constructs the ring renderer and initializes GPU shaders.
   *
   * @param canvas Target HTMLCanvasElement for WebGL context acquisition.
   */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.initWebGL();
  }

  private initWebGL(): void {
    try {
      const gl = (this.canvas.getContext('webgl2', { alpha: true, antialias: true }) ||
                  this.canvas.getContext('webgl', { alpha: true, antialias: true }) ||
                  this.canvas.getContext('experimental-webgl', { alpha: true, antialias: true })) as WebGLRenderingContext | null;

      if (!gl) {
        return;
      }
      this.gl = gl;

      const vsSource = `
        attribute vec2 aPosition;
        varying vec2 vUv;
        void main() {
          vUv = aPosition * 0.5 + 0.5;
          gl_Position = vec4(aPosition, 0.0, 1.0);
        }
      `;

      const fsSource = `
        precision mediump float;
        varying vec2 vUv;
        uniform float uTime;
        uniform vec2 uResolution;
        uniform float uUnlocked;

        void main() {
          vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) / min(uResolution.x, uResolution.y);
          float d = length(p);
          float angle = atan(p.y, p.x);

          // Canonical circular ring radius R = 0.36
          float ringR = 0.36;
          float ringDist = abs(d - ringR);

          // Harmonic scales undulation along serpentine circumference
          float wave = sin(angle * 24.0 - uTime * 1.5) * 0.006;
          float ringGlow = 0.015 / (ringDist + wave + 0.012);

          // Inward-arching energy stream spiraling to center
          float spiralAngle = angle + d * 6.0 - uTime * 0.8;
          float spiralWave = max(0.0, sin(spiralAngle * 2.0)) * smoothstep(ringR, 0.05, d);
          float innerCore = 0.008 / (d + 0.015) * (0.6 + 0.4 * sin(uTime * 3.0));

          // Color palette interpolating from cyan to astral gold based on unlocked count
          float unlockT = clamp(uUnlocked / 8.0, 0.0, 1.0);
          vec3 cyanCol = vec3(0.0, 0.94, 0.71);
          vec3 goldCol = vec3(1.0, 0.82, 0.4);
          vec3 purpleCol = vec3(0.62, 0.33, 0.97);

          vec3 ringColor = mix(cyanCol, goldCol, unlockT);
          vec3 composite = ringColor * ringGlow + purpleCol * spiralWave * 0.8 + goldCol * innerCore;

          float alpha = clamp(ringGlow * 0.8 + spiralWave * 0.5 + innerCore * 0.7, 0.0, 0.92);
          gl_FragColor = vec4(composite, alpha);
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
      this.uUnlockedLoc = gl.getUniformLocation(program, 'uUnlocked');

      // Fullscreen quad [-1, -1] to [1, 1]
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
      // Graceful headless fallback
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

  public resize(width: number, height: number): void {
    if (!this.canvas || width <= 0 || height <= 0) return;
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.gl) {
      this.gl.viewport(0, 0, width, height);
    }
  }

  public render(unlockedCount: number = 0): void {
    if (this.isDisposed || !this.gl || !this.program) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    const elapsed = (Date.now() - this.startTime) * 0.001;
    if (this.uTimeLoc) gl.uniform1f(this.uTimeLoc, elapsed);
    if (this.uResolutionLoc) gl.uniform2f(this.uResolutionLoc, this.canvas.width, this.canvas.height);
    if (this.uUnlockedLoc) gl.uniform1f(this.uUnlockedLoc, unlockedCount);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  public startAnimationLoop(getUnlockedCount: () => number): void {
    const loop = () => {
      if (this.isDisposed) return;
      this.render(getUnlockedCount());
      if (typeof requestAnimationFrame !== 'undefined') {
        this.animFrameId = requestAnimationFrame(loop);
      }
    };
    loop();
  }

  public stopAnimationLoop(): void {
    if (this.animFrameId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  public destroy(): void {
    this.isDisposed = true;
    this.stopAnimationLoop();
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
