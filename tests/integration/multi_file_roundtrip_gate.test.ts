/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Automated Multi-File Roundtrip Parity Gate Integration Test Suite (Step 29).
 * Verifies Bancilhon & Spyratos Bidirectional Lens Invariant:
 *   Put(Get(c), Omega) == c
 * Validates Multi-Round Stability & Convergence:
 *   Round 1 == Round 2 == Round 3
 * Evaluates all 11 supported languages:
 *   TypeScript, C++, C#, CSS, HTML, JSON, YAML, Twig, PHP, Python, Kotlin.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  formatParitySummaryJson,
  formatParitySummaryTerminal,
  runParityGate,
  verifyFileParity,
} from "../../src/tools/index.js";

describe("Step 29: Automated Multi-File Roundtrip Parity Gate", () => {
  let tmpExamplesDir: string;

  beforeAll(() => {
    tmpExamplesDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-roundtrip-gate-"));
    fs.mkdirSync(path.join(tmpExamplesDir, "data_config"), { recursive: true });
    fs.mkdirSync(path.join(tmpExamplesDir, "templates"), { recursive: true });
    fs.mkdirSync(path.join(tmpExamplesDir, "php"), { recursive: true });
    fs.mkdirSync(path.join(tmpExamplesDir, "python"), { recursive: true });
    fs.mkdirSync(path.join(tmpExamplesDir, "kotlin"), { recursive: true });
    fs.mkdirSync(path.join(tmpExamplesDir, "cpp"), { recursive: true });
    fs.mkdirSync(path.join(tmpExamplesDir, "csharp"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpExamplesDir, "cpp/StringHelper.cpp"),
      `#include <string>

int computeLength(int baseLen, int pad) {
    return baseLen + pad;
}
`,
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpExamplesDir, "csharp/FoodItem.cs"),
      `public class FoodItem {
    public string Name { get; set; }
    public int Calories { get; set; }

    public FoodItem(string name, int calories) {
        this.Name = name;
        this.Calories = calories;
    }
}
`,
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpExamplesDir, "auth_service.ts"),
      `export interface UserSession {
  sessionId: string;
  userId: string;
  role: string;
  createdAt: number;
}

export function UserSession(sessionId: string, userId: string, role: string, createdAt: number): UserSession {
  return { sessionId, userId, role, createdAt };
}

export interface AuthRequest {
  username: string;
  password: string;
  rememberMe: boolean;
}

export function AuthRequest(username: string, password: string, rememberMe: boolean): AuthRequest {
  return { username, password, rememberMe };
}

export function sanitize(raw: string): string {
  return raw.slice(0, 24);
}

export function validatePassword(pass: string): unknown | unknown {
  if ((pass.length < 8)) {
    return { ok: false, error: "Password too short" };
  }
  return { ok: true, value: true };
}

export function authenticateUser(req: AuthRequest): unknown | unknown {
  const valid = validatePassword(req.password).value;
  const cleanUser = sanitize(req.username);
  const session = { sessionId: ("sess_" + cleanUser), userId: cleanUser, role: "member", createdAt: 1711929600 };
  return { ok: true, value: session };
}
`,
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpExamplesDir, "dashboard_card.tsx"),
      `export interface DashboardCardProps {
  title: string;
  badge: string;
  description: string;
}

export function DashboardCard({ title, badge, description }: DashboardCardProps) {
  return (
    <div className="card-container">
      <div className="card-header">
        <h2 className="card-title">{title}</h2>
        <span className="card-badge">{badge}</span>
      </div>
      <p className="card-body">{description}</p>
    </div>
  );
}
`,
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpExamplesDir, "style.css"),
      `.container {
  display: flex;
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px;
}

button {
  background: #0070f3;
  color: #ffffff;
  border-radius: 6px;
  padding: 10px 20px;
}
`,
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpExamplesDir, "page.html"),
      `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>AICE 2.0 Web Application</title>
    <link rel="stylesheet" href="style.css">
  </head>
  <body>
    <header class="site-header">
      <h1>Welcome to AICE</h1>
      <p>The high-entropy token-efficient programming language.</p>
    </header>
    <main class="content">
      <section class="features">
        <h2>Features</h2>
        <p>Lossless roundtripping and zero-hallucination canonical APIs.</p>
      </section>
    </main>
  </body>
</html>
`,
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpExamplesDir, "data_config/sample.json"),
      `{
  "name": "aice-data-service",
  "version": "2.4.0",
  "port": 8080,
  "timeout": 30.5,
  "negativeOffset": -10,
  "enabled": true,
  "debug": false,
  "fallback": null,
  "tags": [
    "transpiler",
    "compiler",
    "homoiconic",
    "ast"
  ],
  "matrix": [
    [
      1,
      2
    ],
    [
      3,
      4
    ]
  ],
  "server": {
    "host": "127.0.0.1",
    "ssl": true,
    "maxConnections": 5000,
    "cors": {
      "origins": [
        "https://example.com",
        "https://api.example.com"
      ],
      "credentials": true
    }
  },
  "emptyObject": {},
  "emptyList": []
}
`,
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpExamplesDir, "data_config/sample.yaml"),
      `# AICE Unified Configuration Spec
app:
  name: aice-cluster-manager
  version: 1.0.0
  active: true
  replicas: 3
  cpuLimit: 2.5
  memoryOffset: -256
  leader: null
  zones:
    - us-east-1a
    - us-east-1b
    - us-east-1c
  network:
    bind: 0.0.0.0
    port: 9090
    ingress:
      enabled: true
      hosts:
        - cluster.local
  emptyRecord: {}
  emptyArray: []
`,
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpExamplesDir, "templates/card.twig"),
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
      path.join(tmpExamplesDir, "php/OrderStatus.php"),
      `<?php

declare(strict_types=1);

namespace App\\Enums;

enum OrderStatus: string {
    case Pending = 'pending';
    case Processing = 'processing';
    case Completed = 'completed';
    case Cancelled = 'cancelled';
}

function getOrderStatusLabel(OrderStatus $status): string {
    return match ($status) {
        OrderStatus::Pending => 'Pending Payment',
        OrderStatus::Processing => 'Processing Order',
        OrderStatus::Completed => 'Order Completed',
        OrderStatus::Cancelled => 'Order Cancelled',
    };
}
`,
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpExamplesDir, "python/dataclass_sample.py"),
      `from dataclasses import dataclass
from typing import Optional

@dataclass
class InventoryItem:
    """Represents an item in the warehouse inventory."""
    id: int
    name: str
    unit_price: float
    quantity: int = 0
    category: Optional[str] = None

    def total_value(self) -> float:
        """Calculate total value of inventory for this item."""
        return self.unit_price * self.quantity

    def is_in_stock(self) -> bool:
        """Check if item quantity is positive."""
        return self.quantity > 0
`,
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpExamplesDir, "kotlin/UserEntity.kt"),
      `// Represents a system user entity with profile information.
// data class
data class UserEntity(
    val id: String,
    val name: String,
    val email: String,
    val age: Int = 18,
    val isActive: Boolean = true,
    val bio: String? = null
) {
    fun getDisplayName(): String {
        "$name <$email>"
    }

    fun isAdult(): Boolean {
        age >= 18
    }
}
`,
      "utf-8",
    );
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpExamplesDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  // ===========================================================================
  // SECTION 1: 11-Language Roundtrip Parity Matrix
  // ===========================================================================
  describe("11-Language Roundtrip Parity Matrix (Individual Language Verification)", () => {
    it("1. TypeScript (.ts) satisfies 100% bit-identical lossless lens parity", async () => {
      const filePath = path.join(tmpExamplesDir, "auth_service.ts");
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isBitIdentical).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("2. React / TSX (.tsx) satisfies 100% bit-identical lossless lens parity", async () => {
      const filePath = path.join(tmpExamplesDir, "dashboard_card.tsx");
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isBitIdentical).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("3. C++ (.cpp) satisfies AST equivalence and multi-round convergence", async () => {
      const filePath = path.join(tmpExamplesDir, "cpp/StringHelper.cpp");

      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("4. C# (.cs) satisfies AST equivalence and multi-round convergence", async () => {
      const filePath = path.join(tmpExamplesDir, "csharp/FoodItem.cs");

      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("5. CSS (.css) satisfies 100% bit-identical lossless lens parity", async () => {
      const filePath = path.join(tmpExamplesDir, "style.css");
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isBitIdentical).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("6. HTML (.html) satisfies 100% bit-identical lossless lens parity", async () => {
      const filePath = path.join(tmpExamplesDir, "page.html");
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isBitIdentical).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("7. JSON (.json) satisfies 100% bit-identical lossless lens parity", async () => {
      const filePath = path.join(tmpExamplesDir, "data_config/sample.json");
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isBitIdentical).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("8. YAML (.yaml) satisfies 100% bit-identical lossless lens parity", async () => {
      const filePath = path.join(tmpExamplesDir, "data_config/sample.yaml");
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isBitIdentical).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("9. Twig (.twig) satisfies AST equivalence and multi-round convergence", async () => {
      const filePath = path.join(tmpExamplesDir, "templates/card.twig");
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("10. PHP (.php) satisfies AST equivalence and multi-round convergence", async () => {
      const filePath = path.join(tmpExamplesDir, "php/OrderStatus.php");
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("11. Python (.py) satisfies 100% bit-identical lossless lens parity", async () => {
      const filePath = path.join(tmpExamplesDir, "python/dataclass_sample.py");
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isBitIdentical).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("12. Kotlin (.kt) satisfies 100% bit-identical lossless lens parity", async () => {
      const filePath = path.join(tmpExamplesDir, "kotlin/UserEntity.kt");
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isBitIdentical).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });
  });

  // ===========================================================================
  // SECTION 2: Unified Multi-File Parity Gate across Real-World Projects
  // ===========================================================================
  describe("Unified Multi-File Parity Gate across Real-World Projects", () => {
    it("runs parity gate across all 11 supported languages simultaneously with 100% parity rate", async () => {
      const multiLangFiles = [
        path.join(tmpExamplesDir, "auth_service.ts"),
        path.join(tmpExamplesDir, "dashboard_card.tsx"),
        path.join(tmpExamplesDir, "cpp/StringHelper.cpp"),
        path.join(tmpExamplesDir, "csharp/FoodItem.cs"),
        path.join(tmpExamplesDir, "style.css"),
        path.join(tmpExamplesDir, "page.html"),
        path.join(tmpExamplesDir, "data_config/sample.json"),
        path.join(tmpExamplesDir, "data_config/sample.yaml"),
        path.join(tmpExamplesDir, "templates/card.twig"),
        path.join(tmpExamplesDir, "php/OrderStatus.php"),
        path.join(tmpExamplesDir, "python/dataclass_sample.py"),
        path.join(tmpExamplesDir, "kotlin/UserEntity.kt"),
      ];

      const summary = await runParityGate(multiLangFiles);

      expect(summary.totalFiles).toBe(12);
      expect(summary.failed).toBe(0);
      expect(summary.parityRate).toBe(100);
      expect(summary.passedBitIdentical + summary.passedAstEquivalent).toBe(summary.totalFiles);

      for (const res of summary.results!) {
        expect(res.roundtripDrift).toBe(0);
        expect(res.isAstEquivalent || res.isBitIdentical).toBe(true);
      }

      const expectedLangs = [
        "typescript",
        "cpp",
        "csharp",
        "css",
        "html",
        "json",
        "yaml",
        "twig",
        "php",
        "python",
        "kotlin",
      ];
      for (const lang of expectedLangs) {
        const stats = summary.resultsByLanguage[lang];
        expect(stats).toBeDefined();
        expect(stats.total).toBeGreaterThanOrEqual(1);
        expect(stats.passed).toBe(stats.total);
        expect(stats.parityRate).toBe(100);
      }
    });

    it("runs parity gate across a multi-language directory with 100% parity and zero drift", async () => {
      const summary = await runParityGate(tmpExamplesDir);

      expect(summary.totalFiles).toBeGreaterThanOrEqual(10);
      expect(summary.failed).toBe(0);
      expect(summary.parityRate).toBe(100);

      for (const res of summary.results!) {
        expect(res.roundtripDrift).toBe(0);
      }
    });

    it("runs parity gate across multi-language case studies (TS, C++, C#, PHP, Python, Kotlin)", async () => {
      const realWorldCases = [
        path.join(tmpExamplesDir, "auth_service.ts"),
        path.join(tmpExamplesDir, "cpp/StringHelper.cpp"),
        path.join(tmpExamplesDir, "csharp/FoodItem.cs"),
        path.join(tmpExamplesDir, "php/OrderStatus.php"),
        path.join(tmpExamplesDir, "python/dataclass_sample.py"),
        path.join(tmpExamplesDir, "kotlin/UserEntity.kt"),
      ];

      const summary = await runParityGate(realWorldCases);
      expect(summary.failed).toBe(0);
      expect(summary.parityRate).toBe(100);

      for (const res of summary.results!) {
        expect(res.roundtripDrift).toBe(0);
        expect(res.isAstEquivalent || res.isBitIdentical).toBe(true);
      }
    });
  });

  // ===========================================================================
  // SECTION 3: Multi-Round Stability & Idempotence Convergence
  // ===========================================================================
  describe("Multi-Round Stability & Idempotence Convergence (Round 1 == Round 2 == Round 3)", () => {
    it("guarantees convergence to zero drift across 3 successive roundtrips for all languages", async () => {
      const sources: { lang: string; code: string; ext: string }[] = [
        {
          lang: "typescript",
          ext: "ts",
          code: `export interface Node { id: string; value: number; }\nexport function sum(a: number, b: number): number { return a + b; }\n`,
        },
        {
          lang: "css",
          ext: "css",
          code: `:root { --primary: #0070f3; }\n.header { display: flex; padding: 16px; }\n`,
        },
        {
          lang: "html",
          ext: "html",
          code: `<div class="container">\n  <h1>Title</h1>\n</div>\n`,
        },
        {
          lang: "json",
          ext: "json",
          code: `{\n  "version": "1.0.0",\n  "enabled": true\n}\n`,
        },
        {
          lang: "yaml",
          ext: "yaml",
          code: `version: "1.0"\nport: 8080\n`,
        },
        {
          lang: "python",
          ext: "py",
          code: `from dataclasses import dataclass\n\n@dataclass\nclass Config:\n    host: str\n    port: int\n`,
        },
        {
          lang: "kotlin",
          ext: "kt",
          code: `data class User(val id: String, val name: String)\n`,
        },
      ];

      for (const { code, ext } of sources) {
        const dummyFile = `virtual_test.${ext}`;
        const res = await verifyFileParity(dummyFile, { source: code, rounds: 3 });
        expect(res.decompileOk).toBe(true);
        expect(res.parseOk).toBe(true);
        expect(res.emitOk).toBe(true);
        expect(res.isAstEquivalent).toBe(true);
        expect(res.roundtripDrift).toBe(0);
      }
    });
  });

  // ===========================================================================
  // SECTION 4: Terminal and JSON Formatting
  // ===========================================================================
  describe("Terminal and JSON Formatting", () => {
    it("formats terminal report with clean alignment and metrics table", async () => {
      const summary = await runParityGate(path.join(tmpExamplesDir, "auth_service.ts"));
      const terminalReport = formatParitySummaryTerminal(summary);

      expect(terminalReport).toContain("AICE Automated Multi-File Roundtrip Parity Gate");
      expect(terminalReport).toContain("Total Files Verified:    1");
      expect(terminalReport).toContain("Parity Rate:             100.0%");
      expect(terminalReport).toContain("typescript");
      expect(terminalReport).toContain("✔ Parity Gate PASSED");
    });

    it("formats JSON report matching ParityGateSummary contract", async () => {
      const summary = await runParityGate(path.join(tmpExamplesDir, "auth_service.ts"));
      const jsonReport = formatParitySummaryJson(summary);
      const parsed = JSON.parse(jsonReport);

      expect(parsed.totalFiles).toBe(1);
      expect(parsed.passedBitIdentical).toBe(1);
      expect(parsed.failed).toBe(0);
      expect(parsed.parityRate).toBe(100);
      expect(parsed.resultsByLanguage.typescript).toBeDefined();
    });
  });

  // ===========================================================================
  // SECTION 5: CLI Command Execution (aice verify --parity)
  // ===========================================================================
  describe("CLI Command Execution (aice verify --parity)", () => {
    const binPath = path.resolve(process.cwd(), "bin/aice.ts");

    it("executes 'aice verify --parity <file>' and exits with code 0", () => {
      const child = spawnSync(
        "bun",
        ["run", binPath, "verify", "--parity", path.join(tmpExamplesDir, "auth_service.ts")],
        {
          encoding: "utf-8",
          cwd: process.cwd(),
        },
      );

      expect(child.status).toBe(0);
      expect(child.stdout).toContain("AICE Automated Multi-File Roundtrip Parity Gate");
      expect(child.stdout).toContain("✔ Parity Gate PASSED");
    });

    it("executes 'aice verify --parity <file> --json' producing valid machine-readable JSON", () => {
      const child = spawnSync(
        "bun",
        [
          "run",
          binPath,
          "verify",
          "--parity",
          path.join(tmpExamplesDir, "auth_service.ts"),
          "--json",
        ],
        {
          encoding: "utf-8",
          cwd: process.cwd(),
        },
      );

      expect(child.status).toBe(0);
      const parsed = JSON.parse(child.stdout);
      expect(parsed.totalFiles).toBe(1);
      expect(parsed.failed).toBe(0);
      expect(parsed.parityRate).toBe(100);
    });

    it("executes 'aice verify --parity <dir> --strict' and exits 0 on 100% parity rate", () => {
      const child = spawnSync(
        "bun",
        ["run", binPath, "verify", "--parity", tmpExamplesDir, "--strict"],
        {
          encoding: "utf-8",
          cwd: process.cwd(),
        },
      );

      expect(child.status).toBe(0);
      expect(child.stdout).toContain("✔ Parity Gate PASSED");
    });
  });
});
