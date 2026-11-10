import { describe, expect, it } from "vitest";
import { HTML_VOID_TAGS, validateNativeSyntax } from "../../src/tools/syntax-validator.js";

describe("Hardened HTML & WebGL/Canvas Shell Pre-Write Validator", () => {
  const complexWebGLShell = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="style.css">
  <link rel="icon" href="data:,">
  <title>WebGL Canvas Shell</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    canvas { display: block; width: 100vw; height: 100vh; }
    /* Embedded comment with <style> and </style> decoy tokens */
  </style>
</head>
<body>
  <canvas id="glcanvas"></canvas>
  <input type="hidden" id="state" value="ready">
  <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="pixel">
  <br>
  <hr>
  <script>
    // Comment with <script> and </script> decoy tokens
    const shaderSource = \`
      precision mediump float;
      uniform vec2 u_resolution;
      void main() {
        gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
      }
    \`;
    const strDecoy = "<script>console.log('decoy');</script>";
    console.log("Canvas ready", shaderSource.length, strDecoy);
  </script>
</body>
</html>`;
  it("passes validation on valid WebGL/canvas HTML shells with void tags and inline decoys", () => {
    const res = validateNativeSyntax(complexWebGLShell, "html", "index.html");
    expect(res.valid).toBe(true);
    expect(res.diagnostics).toEqual([]);
  });

  it("catches genuinely unclosed <script> tags", () => {
    const brokenHtml = `<html><head><script>console.log("no close");</head><body></body></html>`;
    const res = validateNativeSyntax(brokenHtml, "html", "index.html");
    expect(res.valid).toBe(false);
    expect(res.diagnostics.some((d) => d.includes("Unbalanced <script> tags"))).toBe(true);
  });

  it("catches genuinely unclosed <style> tags", () => {
    const brokenHtml = `<html><head><style>body { color: red; }</head><body></body></html>`;
    const res = validateNativeSyntax(brokenHtml, "html", "index.html");
    expect(res.valid).toBe(false);
    expect(res.diagnostics.some((d) => d.includes("Unbalanced <style> tags"))).toBe(true);
  });

  it("exports HTML_VOID_TAGS including meta, link, input, img, br, hr", () => {
    expect(HTML_VOID_TAGS.has("meta")).toBe(true);
    expect(HTML_VOID_TAGS.has("link")).toBe(true);
    expect(HTML_VOID_TAGS.has("input")).toBe(true);
    expect(HTML_VOID_TAGS.has("img")).toBe(true);
    expect(HTML_VOID_TAGS.has("br")).toBe(true);
    expect(HTML_VOID_TAGS.has("hr")).toBe(true);
  });
});
