# Feature TDD Specification: WebGL Shader & Context Architect (WebGLContext & GLBatch)

> **Feature Identifier:** `docs/tdd/webgl_shader_context_and_batch_renderer.tdd.md`  
> **Status:** Red -> Green (Upgrading Shaders to Gaussian Glow, 2D Focal Gradient, and Texture Sampling)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Upgraded hardware-accelerated 2D WebGL GLSL shader architecture matching Native Canvas2D (`Ctx2D`) visual fidelity with True Gaussian glows, exact 2D focal-point radial gradients, and texture sampling support.
- **Target Systems:** `src/render/webgl/WebGLContext.ts`, `src/render/webgl/GLBatch.ts`, `src/tests/WebGLRenderer.test.ts`
- **Mechanics & Technical Reference:**
  1. **WebGL Context Initialization & Uniform Cache:**
     - Uniform locations cached: `u_matrix`, `u_resolution`, `u_time`, `u_texture`, `u_highlightColor`, `u_baseColor`, `u_shadowColor`.
  2. **Unified SDF Shader Program Upgrades:**
     - *Vertex Shader:* Decodes `a_params` into `v_type` / `v_primitive` (0..5) and `v_glow`.
     - *True Gaussian Glow Curve:* Replaces first-order exponential decay with physical Gaussian curve:
       $$G(d) = \exp\left(-\frac{d^2}{2\sigma^2}\right) \times v\_glow$$
       with expanded quad padding so outer halos smoothly decay to 0 and never clip at quad edges.
     - *Exact 2D Focal-Point Radial Gradient:* Replaces 3D Blinn-Phong lighting with 2D focal-point gradient equation matching `Ctx2D.createSphereGradient`:
       $$\vec{f} = (-0.34, -0.38), \quad d = \|\vec{uv} - \vec{f}\|$$
       Interpolates between `u_highlightColor` / `ColorX.shade(color, 0.55)`, `u_baseColor` / `color`, and `u_shadowColor` / `ColorX.shade(color, -0.62)` with stop $0.42$.
     - *Texture Sampling Support:* Primitive type 5 (`GLPrimitive.Texture`) samples from `texture2D(u_texture, v_uv) * v_color`.
  3. **GLBatch Dynamic Buffers:** Interleaved 24 floats / 96 bytes per quad with `drawTexture` and padded glow primitive routines.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/WebGLRenderer.test.ts`
- **Assertions:**
  1. **Shader Source Conformance:** Verifies fragment shader contains true Gaussian glow curve `exp(-(d * d) / (2.0 * sigma * sigma))`, 2D focal gradient `vec2 focal = vec2(-0.34, -0.38)`, `length(v_uv - focal)`, `u_highlightColor`, `u_baseColor`, `u_shadowColor`, `u_texture`, and `texture2D(u_texture, v_uv) * v_color`.
  2. **Texture Primitive Batching:** `GLPrimitive.Texture = 5` correctly batches and decodes params `(type: 5, glow)`.
  3. **Uniform Color Overrides & Texture Binding:** WebGLContext exposes `setTexture` and `setSphereColors` helper routines.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/render/webgl/WebGLContext.ts`: Gaussian glow, 2D focal radial gradient, texture sampling in GLSL shaders, extended uniform cache and setters.
  - `src/render/webgl/GLBatch.ts`: `GLPrimitive.Texture` support, `drawTexture` method, expanded quad padding for non-clipping glow halos.
  - `src/tests/WebGLRenderer.test.ts`: Expanded test assertions verifying all new shader math, uniforms, and texture primitive batching.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/WebGLRenderer.test.ts
./verify
```
