/**
 * CSS3 Stylesheet Emitter for AIL 2.0.
 * Conforms to Pillar 1 & 2 of docs/RESEARCH_SYNTHESIS.md.
 */

import type { Module, StyleDecl } from "../core/ast.js";
import { EmitterContext, type EmitterOptions } from "./context.js";

const HTML_TAGS = new Set([
  "html",
  "body",
  "div",
  "span",
  "p",
  "a",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "tr",
  "td",
  "th",
  "header",
  "footer",
  "nav",
  "main",
  "section",
  "article",
  "aside",
  "form",
  "button",
  "input",
  "textarea",
]);

export const CSS_PROPERTY_ALIASES: Readonly<Record<string, string>> = {
  // Background
  bg: "background-color",
  bgc: "background-color",
  bkg: "background",
  bgi: "background-image",
  bgr: "background-repeat",
  bgp: "background-position",
  bgs: "background-size",
  bga: "background-attachment",

  // Color & Typography
  c: "color",
  f: "font-family",
  ff: "font-family",
  fz: "font-size",
  fw: "font-weight",
  fs: "font-style",
  lh: "line-height",
  ls: "letter-spacing",
  ta: "text-align",
  td: "text-decoration",
  tt: "text-transform",
  ti: "text-indent",
  to: "text-overflow",
  tr: "text-rendering",
  ws: "white-space",
  wb: "word-break",
  ww: "word-wrap",

  // Dimensions & Sizing
  w: "width",
  h: "height",
  "min-w": "min-width",
  "max-w": "max-width",
  "min-h": "min-height",
  "max-h": "max-height",
  bsz: "box-sizing",

  // Spacing (Padding & Margin)
  p: "padding",
  pt: "padding-top",
  pr: "padding-right",
  pb: "padding-bottom",
  pl: "padding-left",
  m: "margin",
  mt: "margin-top",
  mr: "margin-right",
  mb: "margin-bottom",
  ml: "margin-left",

  // Borders & Outlines
  b: "border",
  bc: "border-color",
  bw: "border-width",
  bs: "border-style",
  bt: "border-top",
  br: "border-right",
  bb: "border-bottom",
  bl: "border-left",
  rad: "border-radius",
  out: "outline",
  bcp: "border-collapse",
  bcpl: "border-collapse",
  bsp: "border-spacing",

  // Shadows
  sh: "box-shadow",
  tsh: "text-shadow",

  // Layout & Positioning
  disp: "display",
  pos: "position",
  t: "top",
  r: "right",
  bot: "bottom",
  l: "left",
  z: "z-index",

  // Flexbox & Grid
  fl: "flex",
  fld: "flex-direction",
  flw: "flex-wrap",
  flf: "flex-flow",
  flg: "flex-grow",
  fls: "flex-shrink",
  fb: "flex-basis",
  jc: "justify-content",
  ai: "align-items",
  ac: "align-content",
  as: "align-self",
  js: "justify-self",
  gap: "gap",
  gtc: "grid-template-columns",
  gtr: "grid-template-rows",
  gta: "grid-template-areas",
  ga: "grid-area",
  gc: "grid-column",
  gr: "grid-row",

  // Layout Macros (Step 23)
  "fl-row": "display: flex; flex-direction: row",
  "fl-col": "display: flex; flex-direction: column",
  "fl-center": "display: flex; align-items: center; justify-content: center",

  // Overflow & Effects
  ov: "overflow",
  "ov-x": "overflow-x",
  "ov-y": "overflow-y",
  op: "opacity",
  vis: "visibility",
  bdf: "backdrop-filter",

  // Interactivity
  cur: "cursor",
  pe: "pointer-events",
  us: "user-select",

  // Transitions & Animations
  trans: "transition",
  anim: "animation",

  // Miscellaneous
  lst: "list-style",
  va: "vertical-align",
  sb: "scroll-behavior",
  sbc: "scrollbar-color",
  sbw: "scrollbar-width",
};

const CSS_COLOR_PALETTES = new Set([
  "slate",
  "emerald",
  "rose",
  "amber",
  "indigo",
  "purple",
  "blue",
  "gray",
  "red",
  "green",
]);

export function expandCssTokenValue(val: string): string {
  return val.replace(/\$([a-zA-Z0-9_.-]+)/g, (_match, tokenName: string) => {
    const normalized = tokenName.replace(/\./g, "-");
    const firstPart = normalized.split("-")[0];

    if (CSS_COLOR_PALETTES.has(firstPart)) {
      return `var(--color-${normalized})`;
    }
    if (normalized === "sans" || normalized === "mono") {
      return `var(--font-${normalized})`;
    }
    if (normalized === "fast" || normalized === "normal" || normalized === "smooth") {
      return `var(--transition-${normalized})`;
    }
    if (normalized.startsWith("color-")) {
      return `var(--${normalized})`;
    }
    return `var(--${normalized})`;
  });
}

export const CSS_LAYOUT_MACROS: Readonly<Record<string, ReadonlyArray<[string, string]>>> = {
  "fl-row": [
    ["display", "flex"],
    ["flex-direction", "row"],
  ],
  "fl-col": [
    ["display", "flex"],
    ["flex-direction", "column"],
  ],
  "fl-center": [
    ["display", "flex"],
    ["align-items", "center"],
    ["justify-content", "center"],
  ],
};

export function toCssProperty(prop: string): string {
  const kebab = prop
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
  return CSS_PROPERTY_ALIASES[kebab] ?? kebab;
}

export class CssEmitter {
  private ctx: EmitterContext;

  constructor(options: EmitterOptions = {}) {
    this.ctx = new EmitterContext("css", options);
  }

  emit(mod: Module): string {
    let hasImports = false;
    for (const item of mod.items) {
      if (item.kind === "ImportDecl") {
        this.ctx.writeLine(`@import "${item.source}";`);
        hasImports = true;
      }
    }

    if (hasImports) {
      this.ctx.writeLine();
    }

    let first = true;
    for (const item of mod.items) {
      if (item.kind === "StyleDecl") {
        if (!first) {
          this.ctx.writeLine();
        }
        first = false;
        this.emitStyleDecl(item);
      }
    }

    return this.ctx.getOutput();
  }

  private emitStyleDecl(decl: StyleDecl): void {
    const nodeId = `style:${decl.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    const selector = this.toCssSelector(decl.name);
    this.ctx.writeLine(`${selector} {`);
    this.ctx.indent();

    for (const prop of decl.properties) {
      const normalizedProp = prop.property
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/_/g, "-")
        .toLowerCase();

      const macro = CSS_LAYOUT_MACROS[normalizedProp];
      if (macro) {
        for (const [mProp, mVal] of macro) {
          this.ctx.writeLine(`${mProp}: ${mVal};`);
        }
        continue;
      }

      const cssProp = toCssProperty(prop.property);
      const cssVal = expandCssTokenValue(prop.value);
      this.ctx.writeLine(`${cssProp}: ${cssVal};`);
    }

    if (decl.children && decl.children.length > 0) {
      for (const child of decl.children) {
        this.emitStyleDecl(child);
      }
    }

    this.ctx.dedent();
    this.ctx.writeLine("}");
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private toCssSelector(name: string): string {
    const trimmed = name.trim();
    const lower = trimmed.toLowerCase();
    if (HTML_TAGS.has(lower) && trimmed === lower) {
      return lower;
    }
    if (
      trimmed.startsWith(".") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith(":") ||
      trimmed.startsWith("@") ||
      trimmed.startsWith("&") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("[") ||
      /[:,\s>+~[(]/.test(trimmed)
    ) {
      return trimmed;
    }
    // Convert PascalCase / camelCase / snake_case to kebab-case
    const kebab = trimmed
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/_/g, "-")
      .toLowerCase();
    return `.${kebab}`;
  }
}
