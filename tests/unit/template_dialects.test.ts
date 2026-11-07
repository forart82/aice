/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit & Roundtrip Test Suite for Multi-Language Dialects for Templates (.twig, .html) (Step 25).
 * Verifies:
 * 1. Twig Template Dialect:
 *    - Decompilation of interpolations, control tags (if, for), block & inheritance tags (block, extends, include), comments.
 *    - Lowering to canonical AICE AST (ComponentDecl with LayoutNode hierarchy and expression bindings).
 *    - Emission of clean, canonical .twig from AICE AST.
 *    - Lossless bidirectional roundtrip fidelity.
 * 2. HTML5 Template Dialect:
 *    - Decompilation and emission of standalone documents (with <!DOCTYPE html>) and embedded layout fragments.
 *    - Void elements, boolean attributes, nested layout trees, and comment retention.
 * 3. Core Toolchain Registration:
 *    - TargetLanguage ("twig"), detectTargetFromPath, emitTarget, decompile, KNOWN_TARGET_EXTENSIONS, TARGET_EXT_MAP.
 * 4. Polymorphic CLI Integration:
 *    - `aice compile`, `aice outline`, and `aice context` on .twig and .html template files.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getExtensionForTarget,
  KNOWN_TARGET_EXTENSIONS,
  TARGET_EXT_MAP,
  VALID_TARGET_LANGUAGES,
} from "../../src/config/index.js";
import type { ComponentDecl, LayoutNode } from "../../src/core/ast.js";
import { parse, parseWithTrivia } from "../../src/core/parser.js";
import {
  decompile,
  decompileFile,
  decompileTwig,
  HtmlDecompiler,
  TwigDecompiler,
} from "../../src/decompiler/index.js";
import {
  detectTargetFromPath,
  emitTarget,
  HtmlEmitter,
  TwigEmitter,
} from "../../src/emitters/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "../../bin/aice.ts");

function runCli(args: string[], cwd?: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("bun", [cliPath, ...args], {
    cwd: cwd ?? process.cwd(),
    encoding: "utf-8",
    env: { ...process.env },
  });
  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("Step 25: Multi-Language Dialects for Templates (.twig, .html)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-template-dialects-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "card.twig"),
      `{# User Profile Card Template #}
{% extends "base.twig" %}

{% block content %}
<div class="user-card" id="user-{{ user.id }}">
  <div class="card-header">
    <h2 class="user-name">{{ user.name }}</h2>
    <span class="user-role">{{ user.role }}</span>
  </div>
  <div class="card-body">
    {% if user.bio %}
      <p class="user-bio">{{ user.bio }}</p>
    {% else %}
      <p class="user-bio empty">No bio provided</p>
    {% endif %}
    <ul class="skills-list">
      {% for skill in user.skills %}
        <li class="skill-item">{{ skill.name }}</li>
      {% endfor %}
    </ul>
  </div>
</div>
{% endblock %}
`,
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "profile.html"),
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Developer Profile</title>
</head>
<body>
  <div class="profile-container" id="profile-root">
    <header class="profile-header">
      <h1 class="profile-title">Alex Johnson</h1>
      <p class="profile-subtitle">Staff Compiler Engineer</p>
    </header>
    <main class="profile-content">
      <section class="bio-section">
        <h2>About Me</h2>
        <p>Passionate about homoiconic languages, tokenomics, and bidirectional transpilation.</p>
      </section>
      <section class="stats-section">
        <ul class="stats-list">
          <li class="stat-item">Commits: 1420</li>
          <li class="stat-item">Repositories: 38</li>
          <li class="stat-item">Followers: 950</li>
        </ul>
      </section>
    </main>
    <footer class="profile-footer">
      <p>&copy; 2026 AICE Ecosystem</p>
    </footer>
  </div>
</body>
</html>
`,
      "utf-8",
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("1. Twig Template Dialect Decompiler", () => {
    it("parses interpolation expressions into canonical AICE expression bindings", () => {
      const twig = `<div class="user-greeting">
  <h1>{{ user.name }}</h1>
  <p>{{ count + 1 }}</p>
  <span>{{ title | upper }}</span>
</div>`;

      const decompiler = new TwigDecompiler(twig, "greeting.twig");
      const { ast, aice } = decompiler.decompile();

      expect(ast.items).toHaveLength(1);
      const comp = ast.items[0] as ComponentDecl;
      expect(comp.kind).toBe("ComponentDecl");
      expect(comp.name).toBe("Greeting");
      expect(comp.layout).toHaveLength(1);

      const div = comp.layout[0];
      expect(div.tag).toBe("div");
      expect(div.attributes).toHaveLength(1);
      expect(div.attributes[0].name).toBe("class");
      expect(div.children).toHaveLength(3);

      // <h1>{{ user.name }}</h1> -> childExpr MemberAccessExpr
      const h1 = div.children[0];
      expect(h1.tag).toBe("h1");
      expect(h1.childExpr).toBeDefined();
      expect(h1.childExpr?.kind).toBe("MemberAccessExpr");
      if (h1.childExpr?.kind === "MemberAccessExpr") {
        expect(h1.childExpr.property).toBe("name");
      }

      // <p>{{ count + 1 }}</p> -> childExpr BinaryExpr
      const p = div.children[1];
      expect(p.tag).toBe("p");
      expect(p.childExpr).toBeDefined();
      expect(p.childExpr?.kind).toBe("BinaryExpr");
      if (p.childExpr?.kind === "BinaryExpr") {
        expect(p.childExpr.operator).toBe("+");
      }

      // <span>{{ title | upper }}</span> -> childExpr BinaryExpr with pipe
      const span = div.children[2];
      expect(span.tag).toBe("span");
      expect(span.childExpr).toBeDefined();
      expect(span.childExpr?.kind).toBe("BinaryExpr");
      if (span.childExpr?.kind === "BinaryExpr") {
        expect(span.childExpr.operator).toBe("|");
      }

      // Generated AICE code verifies clean serialization
      expect(aice).toContain("component Greeting():");
      expect(aice).toContain('div(class: "user-greeting"):');
      expect(aice).toContain('h1: "{user.name}"');
      expect(aice).toContain('p: "{count + 1}"');
    });

    it("parses control tags ({% if %}, {% elseif %}, {% else %}, {% endif %})", () => {
      const twig = `{% if user.is_authenticated %}
  <p class="welcome">Welcome back, {{ user.name }}!</p>
{% elseif user.is_guest %}
  <p class="guest">Welcome, Guest!</p>
{% else %}
  <p class="login-prompt">Please sign in.</p>
{% endif %}`;

      const { ast, aice } = decompileTwig(twig, "auth_status.twig");
      expect(ast.items).toHaveLength(1);
      const comp = ast.items[0] as ComponentDecl;
      expect(comp.layout).toHaveLength(1);

      const ifNode = comp.layout[0];
      expect(ifNode.tag).toBe("if");
      expect(ifNode.attributes).toHaveLength(1);
      expect(ifNode.attributes[0].name).toBe("condition");
      expect(ifNode.children).toHaveLength(3); // then, elseif, else

      expect(ifNode.children[0].tag).toBe("p");
      expect(ifNode.children[1].tag).toBe("elseif");
      expect(ifNode.children[2].tag).toBe("else");

      expect(aice).toContain("if(condition: user.is_authenticated):");
      expect(aice).toContain("elseif(condition: user.is_guest):");
      expect(aice).toContain("else:");
    });

    it("parses loop tags ({% for item in items %}, {% for key, item in items %})", () => {
      const twig = `<ul class="user-list">
  {% for user in users %}
    <li class="user-item">{{ user.name }}</li>
  {% endfor %}
</ul>`;

      const { ast, aice } = decompileTwig(twig, "users.twig");
      const comp = ast.items[0] as ComponentDecl;
      expect(comp.layout).toHaveLength(1);

      const ul = comp.layout[0];
      expect(ul.tag).toBe("ul");
      expect(ul.children).toHaveLength(1);

      const forNode = ul.children[0];
      expect(forNode.tag).toBe("for");
      expect(forNode.attributes.some((a) => a.name === "item")).toBe(true);
      expect(forNode.attributes.some((a) => a.name === "in")).toBe(true);
      expect(forNode.children).toHaveLength(1);
      expect(forNode.children[0].tag).toBe("li");

      expect(aice).toContain("for(item: user, in: users):");
      expect(aice).toContain('li(class: "user-item"): "{user.name}"');
    });

    it("parses block and template inheritance tags ({% extends %}, {% block %}, {% include %})", () => {
      const twig = `{# Page Layout #}
{% extends "layouts/base.twig" %}
{% include "partials/nav.twig" %}

{% block title %}Dashboard{% endblock %}

{% block content %}
<main class="dashboard-main">
  <h1>Welcome</h1>
</main>
{% endblock %}`;

      const decompiler = new TwigDecompiler(twig, "dashboard.twig");
      const { ast, trivia, aice } = decompiler.decompile();

      const comp = ast.items[0] as ComponentDecl;
      expect(comp.name).toBe("Dashboard");
      expect(comp.layout).toHaveLength(4);

      // extends
      expect(comp.layout[0].tag).toBe("extends");
      expect(comp.layout[0].attributes[0].value.kind).toBe("LiteralExpr");
      if (comp.layout[0].attributes[0].value.kind === "LiteralExpr") {
        expect(comp.layout[0].attributes[0].value.value).toBe("layouts/base.twig");
      }

      // include
      expect(comp.layout[1].tag).toBe("include");
      if (comp.layout[1].attributes[0].value.kind === "LiteralExpr") {
        expect(comp.layout[1].attributes[0].value.value).toBe("partials/nav.twig");
      }

      // block title
      expect(comp.layout[2].tag).toBe("block");
      expect(comp.layout[2].textLiteral).toBe("Dashboard");

      // block content
      expect(comp.layout[3].tag).toBe("block");
      expect(comp.layout[3].children).toHaveLength(1);
      expect(comp.layout[3].children[0].tag).toBe("main");

      // Trivia comments preserved
      const rootTrivia = trivia.getTrivia("twig_root");
      expect(rootTrivia).toBeDefined();
      expect(rootTrivia?.leading[0].content).toContain("Page Layout");

      expect(aice).toContain('extends(template: "layouts/base.twig")');
      expect(aice).toContain('include(template: "partials/nav.twig")');
      expect(aice).toContain('block(name: "title"): "Dashboard"');
      expect(aice).toContain('block(name: "content"):');
    });

    it("parses nested HTML elements and text nodes with attributes", () => {
      const twig = `<section class="hero" id="hero-sec" data-active>
  <div class="container">
    <h1 class="headline">Fast, Clean, Token-Dense</h1>
    <p>AICE multi-language compiler pipeline.</p>
    <img src="/logo.png" alt="AICE Logo" />
  </div>
</section>`;

      const { ast } = decompileTwig(twig, "hero.twig");
      const comp = ast.items[0] as ComponentDecl;
      const section = comp.layout[0];

      expect(section.tag).toBe("section");
      expect(section.attributes).toHaveLength(3); // class, id, data-active
      const container = section.children[0];
      expect(container.tag).toBe("div");
      expect(container.children).toHaveLength(3); // h1, p, img
      expect(container.children[2].tag).toBe("img");
    });
  });

  describe("2. Twig Emitter & Bidirectional Roundtrip Fidelity", () => {
    it("emits clean, canonical .twig from canonical AICE AST", () => {
      const aiceSource = `component UserCard():
  extends(template: "base.twig")
  block(name: "content"):
    div(class: "card", id: "user-101"):
      h2: "{user.name}"
      if(condition: user.is_active):
        span(class: "badge active"): "Active"
        else:
          span(class: "badge inactive"): "Offline"
      ul(class: "skills"):
        for(item: skill, in: user.skills):
          li: "{skill}"`;

      const mod = parse(aiceSource, "user_card.twig.aice");
      const emitter = new TwigEmitter();
      const emitted = emitter.emit(mod);

      expect(emitted).toContain('{% extends "base.twig" %}');
      expect(emitted).toContain("{% block content %}");
      expect(emitted).toContain('<div class="card" id="user-101">');
      expect(emitted).toContain("<h2>{{ user.name }}</h2>");
      expect(emitted).toContain("{% if user.is_active %}");
      expect(emitted).toContain('<span class="badge active">Active</span>');
      expect(emitted).toContain("{% else %}");
      expect(emitted).toContain('<span class="badge inactive">Offline</span>');
      expect(emitted).toContain("{% endif %}");
      expect(emitted).toContain("{% for skill in user.skills %}");
      expect(emitted).toContain("<li>{{ skill }}</li>");
      expect(emitted).toContain("{% endfor %}");
      expect(emitted).toContain("{% endblock %}");
    });

    it("guarantees 100% bidirectional roundtrip convergence on card.twig", () => {
      const cardPath = path.join(tmpDir, "card.twig");
      const originalTwig = fs.readFileSync(cardPath, "utf-8");

      // Round 1: Twig -> Decompile -> AICE
      const decompileRes1 = decompile(originalTwig, "twig", { filePath: "card.twig" });
      expect(decompileRes1.aice).toContain("component Card():");
      expect(decompileRes1.aice).toContain('extends(template: "base.twig")');
      expect(decompileRes1.aice).toContain('block(name: "content"):');
      expect(decompileRes1.aice).toContain("for(item: skill, in: user.skills):");

      // Parse generated AICE back to Module AST
      const astFromAice = parse(decompileRes1.aice, "card.twig.aice");

      // Forward emit back to Twig
      const reEmittedTwig = emitTarget(astFromAice, "twig");
      expect(reEmittedTwig).toContain('{% extends "base.twig" %}');
      expect(reEmittedTwig).toContain("{% block content %}");
      expect(reEmittedTwig).toContain('<div class="user-card" id="user-{{ user.id }}">');
      expect(reEmittedTwig).toContain('<h2 class="user-name">{{ user.name }}</h2>');
      expect(reEmittedTwig).toContain("{% if user.bio %}");
      expect(reEmittedTwig).toContain('<p class="user-bio">{{ user.bio }}</p>');
      expect(reEmittedTwig).toContain("{% else %}");
      expect(reEmittedTwig).toContain('<p class="user-bio empty">No bio provided</p>');
      expect(reEmittedTwig).toContain("{% endif %}");
      expect(reEmittedTwig).toContain("{% for skill in user.skills %}");
      expect(reEmittedTwig).toContain('<li class="skill-item">{{ skill.name }}</li>');
      expect(reEmittedTwig).toContain("{% endfor %}");

      // Round 2: Re-emitted Twig -> Decompile -> AICE (verifying zero drift)
      const decompileRes2 = decompile(reEmittedTwig, "twig", { filePath: "card.twig" });
      expect(decompileRes2.aice).toBe(decompileRes1.aice);
    });

    it("preserves Twig comments via CstTriviaTable across roundtrips", () => {
      const twigWithComment = `{# Primary Application Navigation #}
{% include "nav.twig" %}`;

      const decomp = decompile(twigWithComment, "twig", { filePath: "nav_wrap.twig" });
      expect(decomp.trivia.getTrivia("twig_root")?.leading[0].content).toContain(
        "Primary Application Navigation",
      );

      const emitter = new TwigEmitter({ trivia: decomp.trivia });
      const reEmitted = emitter.emit(decomp.ast);
      expect(reEmitted).toContain("{# Primary Application Navigation #}");
      expect(reEmitted).toContain('{% include "nav.twig" %}');
    });
  });

  describe("3. HTML5 Template Dialect (Standalone Documents & Embedded Layouts)", () => {
    it("decompiles and emits standalone HTML5 documents with <!DOCTYPE html>", () => {
      const profilePath = path.join(tmpDir, "profile.html");
      const originalHtml = fs.readFileSync(profilePath, "utf-8");

      const decomp = decompile(originalHtml, "html", { filePath: "profile.html" });
      expect(decomp.aice).toContain("component Profile():");
      expect(decomp.aice).toContain("html(lang: \"en\"):");
      expect(decomp.aice).toContain("title: \"Developer Profile\"");
      expect(decomp.aice).toContain('h1(class: "profile-title"): "Alex Johnson"');

      const ast = parse(decomp.aice, "profile.html.aice");
      const reEmitted = emitTarget(ast, "html");

      expect(reEmitted).toContain("<!DOCTYPE html>");
      expect(reEmitted).toContain('<html lang="en">');
      expect(reEmitted).toContain("<title>Developer Profile</title>");
      expect(reEmitted).toContain('<h1 class="profile-title">Alex Johnson</h1>');
      expect(reEmitted).toContain('<p class="profile-subtitle">Staff Compiler Engineer</p>');
      expect(reEmitted).toContain('<li class="stat-item">Commits: 1420</li>');
    });

    it("decompiles and emits embedded HTML layout fragments without <!DOCTYPE html>", () => {
      const fragment = `<div class="card-component" id="card-01">
  <div class="card-title"><h3>Embedded Component</h3></div>
  <p>Seamlessly integrated inside broader templates or web pages.</p>
</div>`;

      const decomp = decompile(fragment, "html", { filePath: "card_fragment.html" });
      expect(decomp.aice).toContain("component CardFragment():");
      expect(decomp.aice).toContain('div(class: "card-component", id: "card-01"):');

      const ast = parse(decomp.aice, "card_fragment.html.aice");
      const reEmitted = emitTarget(ast, "html");

      expect(reEmitted).not.toContain("<!DOCTYPE html>");
      expect(reEmitted).toContain('<div class="card-component" id="card-01">');
      expect(reEmitted).toContain("<h3>Embedded Component</h3>");
      expect(reEmitted).toContain("<p>Seamlessly integrated inside broader templates or web pages.</p>");
    });

    it("handles void elements (img, input, br, hr, meta) and boolean attributes in HTML5", () => {
      const html = `<form class="login-form">
  <input name="username" type="text" required disabled />
  <hr />
  <img alt="Login icon" src="/img/icon.png" />
</form>`;

      const decomp = decompile(html, "html", { filePath: "login.html" });
      const ast = parse(decomp.aice, "login.html.aice");
      const reEmitted = emitTarget(ast, "html");

      expect(reEmitted).toContain("<input");
      expect(reEmitted).toContain("required");
      expect(reEmitted).toContain("disabled");
      expect(reEmitted).toContain("<hr>");
      expect(reEmitted).toContain("<img");
    });
  });

  describe("4. Core Toolchain Registration & Path Resolution", () => {
    it("registers 'twig' in VALID_TARGET_LANGUAGES and extension mappings", () => {
      expect(VALID_TARGET_LANGUAGES.has("twig")).toBe(true);
      expect(KNOWN_TARGET_EXTENSIONS.has(".twig")).toBe(true);
      expect(TARGET_EXT_MAP[".twig"]).toBe("twig");
      expect(getExtensionForTarget("twig")).toBe(".twig");
    });

    it("detects target language from file paths (.twig -> 'twig', .twig.aice -> 'twig')", () => {
      expect(detectTargetFromPath("card.twig")).toBe("twig");
      expect(detectTargetFromPath("views/page.twig")).toBe("twig");
      expect(detectTargetFromPath("views/page.twig.aice")).toBe("twig");
      expect(detectTargetFromPath("views/profile.html")).toBe("html");
      expect(detectTargetFromPath("views/profile.html.aice")).toBe("html");
    });

    it("dispatches emitTarget with target 'twig'", () => {
      const src = `component Sample():
  extends(template: "layout.twig")
  block(name: "main"):
    h1: "Hello World"`;
      const mod = parse(src, "sample.twig.aice");
      const out = emitTarget(mod, "twig");
      expect(out).toContain('{% extends "layout.twig" %}');
      expect(out).toContain("{% block main %}");
      expect(out).toContain("<h1>Hello World</h1>");
    });

    it("dispatches decompile with target 'twig'", () => {
      const twig = `{% block body %}<h2>Decompiled Twig</h2>{% endblock %}`;
      const res = decompile(twig, "twig", { filePath: "body.twig" });
      expect(res.aice).toContain("component Body():");
      expect(res.aice).toContain('block(name: "body"):');
      expect(res.aice).toContain('h2: "Decompiled Twig"');
    });

    it("supports decompileFile asynchronously on template files", async () => {
      const cardPath = path.join(tmpDir, "card.twig");
      const res = await decompileFile(cardPath);
      expect(res.ast.items).toHaveLength(1);
      expect((res.ast.items[0] as ComponentDecl).name).toBe("Card");
      expect(res.aice).toContain("component Card():");
    });
  });

  describe("5. Polymorphic CLI Integration on Templates", () => {
    it("runs 'aice outline' on card.twig and outputs component declaration with token reduction", () => {
      const cardPath = path.join(tmpDir, "card.twig");
      const res = runCli(["outline", cardPath, "--stats"]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("component Card(): ...");
      expect(res.stdout).toContain("Token savings:");
      expect(res.stdout).toContain("%");
    });

    it("runs 'aice outline' on profile.html and outputs component declaration", () => {
      const profilePath = path.join(tmpDir, "profile.html");
      const res = runCli(["outline", profilePath, "--stats"]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("component Profile(): ...");
      expect(res.stdout).toContain("Token savings:");
    });

    it("runs 'aice outline --json' on card.twig and yields structured symbol outline", () => {
      const cardPath = path.join(tmpDir, "card.twig");
      const res = runCli(["outline", cardPath, "--json"]);

      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(parsed.file).toBe(cardPath);
      expect(parsed.symbols).toBeDefined();
      expect(parsed.symbols.length).toBeGreaterThanOrEqual(1);
      expect(parsed.symbols[0].name).toBe("Card");
      expect(parsed.symbols[0].kind).toBe("component");
    });

    it("runs 'aice context' on card.twig and profile.html and packages into 1-turn context pack", () => {
      const cardPath = path.join(tmpDir, "card.twig");
      const res = runCli(["context", cardPath, "--no-callers"]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("# AICE Context Pack:");
      expect(res.stdout).toContain("card.twig");
      expect(res.stdout).toContain('{% extends "base.twig" %}');

      const outlineRes = runCli(["context", cardPath, "--outline-target", "--no-callers"]);
      expect(outlineRes.status).toBe(0);
      expect(outlineRes.stdout).toContain("component Card():");

      const profilePath = path.join(tmpDir, "profile.html");
      const profileRes = runCli(["context", profilePath, "--no-callers"]);

      expect(profileRes.status).toBe(0);
      expect(profileRes.stdout).toContain("# AICE Context Pack:");
      expect(profileRes.stdout).toContain("profile.html");
      expect(profileRes.stdout).toContain("Alex Johnson");

      const profileOutlineRes = runCli(["context", profilePath, "--outline-target", "--no-callers"]);
      expect(profileOutlineRes.status).toBe(0);
      expect(profileOutlineRes.stdout).toContain("component Profile():");
    }, 20000);

    it("runs 'aice compile' on a .twig.aice file and compiles to .twig", () => {
      const aiceFile = path.join(tmpDir, "alert_card.twig.aice");
      fs.writeFileSync(
        aiceFile,
        `component AlertCard():
  extends(template: "base.twig")
  block(name: "alert"):
    div(class: "alert-box"):
      h3: "Critical Notice"
      p: "{message}"
`,
        "utf-8",
      );

      const res = runCli(["compile", aiceFile], tmpDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Compiled");
      expect(res.stdout).toContain("[twig]");

      const generatedTwig = path.join(tmpDir, "alert_card.twig");
      expect(fs.existsSync(generatedTwig)).toBe(true);

      const content = fs.readFileSync(generatedTwig, "utf-8");
      expect(content).toContain('{% extends "base.twig" %}');
      expect(content).toContain("{% block alert %}");
      expect(content).toContain('<div class="alert-box">');
      expect(content).toContain("<h3>Critical Notice</h3>");
      expect(content).toContain("<p>{{ message }}</p>");
      expect(content).toContain("{% endblock %}");
    });

    it("runs 'aice compile' on a .html.aice file and compiles to .html", () => {
      const aiceFile = path.join(tmpDir, "navbar.html.aice");
      fs.writeFileSync(
        aiceFile,
        `component Navbar():
  nav(class: "main-nav"):
    a(class: "nav-brand", href: "/"): "AICE"
    ul(class: "nav-links"):
      li: "Docs"
      li: "Tutorials"
`,
        "utf-8",
      );

      const res = runCli(["compile", aiceFile], tmpDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Compiled");
      expect(res.stdout).toContain("[html]");

      const generatedHtml = path.join(tmpDir, "navbar.html");
      expect(fs.existsSync(generatedHtml)).toBe(true);

      const content = fs.readFileSync(generatedHtml, "utf-8");
      expect(content).toContain('<nav class="main-nav">');
      expect(content).toContain('<a class="nav-brand" href="/">AICE</a>');
      expect(content).toContain('<ul class="nav-links">');
      expect(content).toContain("<li>Docs</li>");
      expect(content).toContain("<li>Tutorials</li>");
    });
  });
});
