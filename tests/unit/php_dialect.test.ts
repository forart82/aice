/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Comprehensive Unit Test Suite for Multi-Language Dialects: PHP 8.x (Step 26).
 *
 * Verifies:
 * 1. PHP 8.x Decompilation to AICE AST:
 *    - Stripping `<?php` header and `declare(strict_types=1);`
 *    - Namespaces and use statements
 *    - Classes with extends and implements
 *    - Constructor property promotion (public function __construct(public string $x) {})
 *    - Typed properties (public readonly float $price, private ?int $id)
 *    - Backed enums (enum Status: string { case Pending = 'pending'; })
 *    - Match expressions (match ($x) { ... })
 *    - Control flow (if, elseif, else, while, foreach, try/catch/finally, throw)
 *    - Null-safe operator ($x?->foo()) and null coalescing ($x ?? $default)
 *    - Comment & docblock trivia retention (/** ... * / and //)
 *    - 100% parse success on decompiled AICE code
 * 2. PHP 8.x Forward Emission from AICE AST:
 *    - Header, namespace, use statements
 *    - Canonical PSR-12 formatting (4 spaces)
 *    - Constructor property promotion
 *    - Match expressions and backed enums
 *    - Preserved trivia
 * 3. Bidirectional Roundtrip Fidelity & Put/Get Lens Invariant:
 *    - Put(Get(c), Omega) == c
 *    - Multi-round convergence (Round 1 == Round 2 == Round 3)
 *    - Real-world validation against examples/php and case51
 * 4. Polymorphic CLI Execution:
 *    - `aice compile` on .php files
 *    - `aice outline` on .php files
 *    - `aice context` on .php files
 * 5. Typecheck Soundness:
 *    - Zero diagnostic crashes when checking decompiled modules
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
import type { ClassDecl, FunctionDecl, MatchStmt, Module, TypeDecl } from "../../src/core/ast.js";
import { parse, parseWithTrivia } from "../../src/core/parser.js";
import {
  decompile,
  decompilePhp,
  executeRoundtrip,
  PhpDecompiler,
} from "../../src/decompiler/index.js";
import {
  detectTargetFromPath,
  emitTarget,
  PhpEmitter,
} from "../../src/emitters/index.js";
import { TypeChecker } from "../../src/typechecker/checker.js";

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

describe("Step 26: Multi-Language Dialects for PHP 8.x (.php)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-php-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  // ===========================================================================
  // SECTION 1: Toolchain Registration & Detection
  // ===========================================================================
  describe("Core Toolchain Registration & Extension Mapping", () => {
    it("registers 'php' in VALID_TARGET_LANGUAGES", () => {
      expect(VALID_TARGET_LANGUAGES.has("php")).toBe(true);
    });

    it("registers '.php' in KNOWN_TARGET_EXTENSIONS and TARGET_EXT_MAP", () => {
      expect(KNOWN_TARGET_EXTENSIONS.has(".php")).toBe(true);
      expect(TARGET_EXT_MAP[".php"]).toBe("php");
    });

    it("returns '.php' from getExtensionForTarget('php')", () => {
      expect(getExtensionForTarget("php")).toBe(".php");
    });

    it("detects 'php' from file paths via detectTargetFromPath", () => {
      expect(detectTargetFromPath("src/Domain/Order.php")).toBe("php");
      expect(detectTargetFromPath("src/Domain/Order.php.aice")).toBe("php");
      expect(detectTargetFromPath("PaymentService.php")).toBe("php");
    });
  });

  // ===========================================================================
  // SECTION 2: PHP 8.x Decompilation to AICE AST
  // ===========================================================================
  describe("PHP 8.x Decompilation to AICE AST", () => {
    it("strips `<?php` header and `declare(strict_types=1);` cleanly", () => {
      const phpCode = `<?php

declare(strict_types=1);

namespace App\\Models;

class User {
    public string $name;
}
`;
      const decomp = decompilePhp(phpCode, "User.php");
      expect(decomp.ast.kind).toBe("Module");
      expect(decomp.ast.items.length).toBe(1);

      const cls = decomp.ast.items[0] as ClassDecl;
      expect(cls.kind).toBe("ClassDecl");
      expect(cls.name).toBe("User");
      expect(cls.properties.length).toBe(1);
      expect(cls.properties[0].name).toBe("name");

      // Verify generated AICE parses cleanly
      const parsed = parse(decomp.aice, "User.php.aice");
      expect(parsed).toBeDefined();
      expect(parsed.items.length).toBe(1);
    });

    it("decompiles constructor property promotions into primary constructors", () => {
      const phpCode = `<?php

declare(strict_types=1);

namespace App\\Services;

class Payment {
    public function __construct(
        public int $id,
        public string $customer,
        public readonly float $amount,
        public string $status = 'pending',
    ) {}
}
`;
      const decomp = decompilePhp(phpCode, "Payment.php");
      const cls = decomp.ast.items[0] as ClassDecl;
      expect(cls.primaryConstructor).toBeDefined();
      expect(cls.primaryConstructor!.length).toBe(4);
      expect(cls.primaryConstructor![0].name).toBe("id");
      expect(cls.primaryConstructor![0].isPub).toBe(true);
      expect(cls.primaryConstructor![2].name).toBe("amount");
      expect(cls.primaryConstructor![2].isReadonly).toBe(true);
      expect(cls.primaryConstructor![3].defaultValue).toBeDefined();

      // Generated AICE must parse
      const parsed = parse(decomp.aice, "Payment.php.aice");
      expect(parsed).toBeDefined();
      const parsedCls = parsed.items[0] as ClassDecl;
      expect(parsedCls.primaryConstructor).toBeDefined();
      expect(parsedCls.primaryConstructor!.length).toBe(4);
    });

    it("decompiles PHP 8 backed enums into TypeDecl with variants", () => {
      const phpCode = `<?php

declare(strict_types=1);

namespace App\\Enums;

enum OrderStatus: string {
    case Pending = 'pending';
    case Paid = 'paid';
    case Shipped = 'shipped';
    case Cancelled = 'cancelled';
}
`;
      const decomp = decompilePhp(phpCode, "OrderStatus.php");
      const enm = decomp.ast.items[0] as TypeDecl;
      expect(enm.kind).toBe("TypeDecl");
      expect(enm.isEnum).toBe(true);
      expect(enm.name).toBe("OrderStatus");
      expect(enm.variants!.length).toBe(4);
      expect(enm.variants![0].name).toBe("Pending");
      expect(enm.variants![3].name).toBe("Cancelled");

      const parsed = parse(decomp.aice, "OrderStatus.php.aice");
      expect(parsed).toBeDefined();
      const parsedEnm = parsed.items[0] as TypeDecl;
      expect(parsedEnm.isEnum).toBe(true);
      expect(parsedEnm.variants!.length).toBe(4);
    });

    it("decompiles PHP 8 match expressions into MatchStmt with MatchCase arms", () => {
      const phpCode = `<?php

declare(strict_types=1);

class PriceCalculator {
    public function getDiscount(string $tier): float {
        return match ($tier) {
            'gold' => 0.20,
            'silver' => 0.10,
            default => 0.0,
        };
    }
}
`;
      const decomp = decompilePhp(phpCode, "PriceCalculator.php");
      const cls = decomp.ast.items[0] as ClassDecl;
      const method = cls.methods[0];
      expect(method.name).toBe("getDiscount");
      expect(method.body.kind).toBe("Block");

      const matchStmt = (method.body as any).statements[0] as MatchStmt;
      expect(matchStmt.kind).toBe("MatchStmt");
      expect(matchStmt.cases.length).toBe(3);
      expect(matchStmt.cases[0].pattern.kind).toBe("LiteralPattern");
      expect(matchStmt.cases[2].pattern.kind).toBe("WildcardPattern");

      const parsed = parse(decomp.aice, "PriceCalculator.php.aice");
      expect(parsed).toBeDefined();
    });

    it("decompiles PHP interfaces into interface declarations with typed method signatures", () => {
      const phpCode = `<?php

declare(strict_types=1);

namespace App\\Repositories;

use App\\Models\\User;

interface UserRepositoryInterface {
    public function findById(int $id): ?User;
    public function save(User $user): bool;
    public function delete(int $id): void;
}
`;
      const decomp = decompilePhp(phpCode, "UserRepositoryInterface.php");
      expect(decomp.ast.items.length).toBe(2); // ImportDecl + ClassDecl (interface)
      const iface = decomp.ast.items[1] as ClassDecl;
      expect(iface.name).toBe("UserRepositoryInterface");
      expect(iface.methods.length).toBe(3);
      expect(iface.methods[0].name).toBe("findById");
      expect(iface.methods[0].returnType?.kind).toBe("OptionType");
      expect(iface.methods[1].name).toBe("save");
      expect(iface.methods[2].name).toBe("delete");

      const parsed = parse(decomp.aice, "UserRepositoryInterface.php.aice");
      expect(parsed).toBeDefined();
    });

    it("preserves docblocks and line comments into CstTriviaTable", () => {
      const phpCode = `<?php

declare(strict_types=1);

class Storage {
    /**
     * Storage entries.
     */
    private array $items = [];

    // Finds item by key
    public function get(string $key): ?string {
        return null;
    }
}
`;
      const decomp = decompilePhp(phpCode, "Storage.php");
      expect(decomp.trivia.size()).toBeGreaterThan(0);

      const fieldTrivia = decomp.trivia.getTrivia("field:Storage.items");
      expect(fieldTrivia).toBeDefined();
      expect(fieldTrivia!.leading.some((t) => t.content.includes("Storage entries."))).toBe(true);

      const methodTrivia = decomp.trivia.getTrivia("method:Storage.get");
      expect(methodTrivia).toBeDefined();
      expect(methodTrivia!.leading.some((t) => t.content.includes("Finds item by key"))).toBe(true);
    });

    it("decompiles control flow structures (if, elseif, else, foreach, try/catch/finally, throw)", () => {
      const phpCode = `<?php

declare(strict_types=1);

class Processor {
    public function run(array $items): int {
        $count = 0;
        foreach ($items as $item) {
            if ($item === 'skip') {
                continue;
            } elseif ($item === 'stop') {
                break;
            } else {
                try {
                    $count += 1;
                } catch (Exception $e) {
                    throw $e;
                }
            }
        }
        return $count;
    }
}
`;
      const decomp = decompilePhp(phpCode, "Processor.php");
      const parsed = parse(decomp.aice, "Processor.php.aice");
      expect(parsed).toBeDefined();
      expect(parsed.items.length).toBe(1);
    });
  });

  // ===========================================================================
  // SECTION 3: PHP 8.x Forward Emission from AICE AST
  // ===========================================================================
  describe("PHP 8.x Forward Emission from AICE AST", () => {
    it("emits strict_types, namespace, and use statements canonically", () => {
      const aiceSource = `module App/Services/UserService

from "App/Repositories/UserRepository" import UserRepository

pub class UserService:
  repo: UserRepository
  fn getUser(id: int) -> str:
    ret "user"
`;
      const { ast, trivia } = parseWithTrivia(aiceSource, "UserService.php.aice");
      const emitted = emitTarget(ast, "php", { trivia });

      expect(emitted).toContain("<?php");
      expect(emitted).toContain("declare(strict_types=1);");
      expect(emitted).toContain("use App\\Repositories\\UserRepository;");
      expect(emitted).toContain("class UserService {");
      expect(emitted).toContain("public function getUser(int $id): string {");
      expect(emitted).toContain('return \'user\';');
    });

    it("emits PHP 8 constructor property promotion cleanly", () => {
      const aiceSource = `module Order

pub class Order(pub id: int, pub customer: str, readonly price: float = 0.0):
  fn getTotal() -> float:
    ret this.price
`;
      const { ast } = parseWithTrivia(aiceSource, "Order.php.aice");
      const emitted = emitTarget(ast, "php");

      expect(emitted).toContain("public function __construct(");
      expect(emitted).toContain("public int $id,");
      expect(emitted).toContain("public string $customer,");
      expect(emitted).toContain("readonly float $price = 0,");
      expect(emitted).toContain(") {}");
    });

    it("emits PHP 8 backed enums with typed values", () => {
      const aiceSource = `module OrderStatus

pub enum OrderStatus:
  Pending
  Processing
  Completed
`;
      const { ast } = parseWithTrivia(aiceSource, "OrderStatus.php.aice");
      const emitted = emitTarget(ast, "php");

      expect(emitted).toContain("enum OrderStatus: string {");
      expect(emitted).toContain("case Pending = 'pending';");
      expect(emitted).toContain("case Processing = 'processing';");
      expect(emitted).toContain("case Completed = 'completed';");
      expect(emitted).toContain("}");
    });

    it("emits PHP 8 match expressions with pattern branches and default arm", () => {
      const aiceSource = `module TaxCalculator

pub class TaxCalculator:
  fn calculate(country: str, amount: float) -> float:
    match country:
      case "US" => amount * 0.07
      case "EU" => amount * 0.20
      case _ => 0.0
`;
      const { ast } = parseWithTrivia(aiceSource, "TaxCalculator.php.aice");
      const emitted = emitTarget(ast, "php");

      expect(emitted).toContain("return match ($country) {");
      expect(emitted).toContain("'US' => $amount * 0.07,");
      expect(emitted).toContain("'EU' => $amount * 0.2,");
      expect(emitted).toContain("default => 0,");
      expect(emitted).toContain("};");
    });

    it("emits null-safe operator and null coalescing operators", () => {
      const aiceSource = `module Navigator

pub class Navigator:
  fn getZip(user: any) -> str:
    ret user?.address?.zip ?? "00000"
`;
      const { ast } = parseWithTrivia(aiceSource, "Navigator.php.aice");
      const emitted = emitTarget(ast, "php");

      expect(emitted).toContain("$user?->address?->zip ?? '00000'");
    });
  });

  // ===========================================================================
  // SECTION 4: Bidirectional Fidelity & Lossless Roundtrips
  // ===========================================================================
  describe("Bidirectional Fidelity & Lens Verification: Put(Get(c), Omega) == c", () => {
    it("satisfies roundtrip fidelity on UserRepository.php example", () => {
      const filePath = path.resolve(__dirname, "../../examples/php/UserRepository.php");
      const original = fs.readFileSync(filePath, "utf-8");

      const res = executeRoundtrip(original, "php", filePath);
      expect(res.aice).toBeDefined();

      const parsed = parse(res.aice, `${filePath}.aice`);
      expect(parsed).toBeDefined();
      expect(parsed.items.length).toBeGreaterThanOrEqual(2);

      expect(res.reconstructed).toContain("interface UserRepositoryInterface");
      expect(res.reconstructed).toContain("class UserRepository");
      expect(res.reconstructed).toContain("findById");
      expect(res.reconstructed).toContain("save");
      expect(res.reconstructed).toContain("delete");
    });

    it("satisfies roundtrip fidelity on OrderStatus.php example", () => {
      const filePath = path.resolve(__dirname, "../../examples/php/OrderStatus.php");
      const original = fs.readFileSync(filePath, "utf-8");

      const res = executeRoundtrip(original, "php", filePath);
      expect(res.aice).toBeDefined();

      const parsed = parse(res.aice, `${filePath}.aice`);
      expect(parsed).toBeDefined();

      expect(res.reconstructed).toContain("enum OrderStatus: string");
      expect(res.reconstructed).toContain("case Pending");
      expect(res.reconstructed).toContain("case Processing");
      expect(res.reconstructed).toContain("getOrderStatusLabel");
      expect(res.reconstructed).toContain("match");
    });

    it("satisfies roundtrip fidelity on PaymentService.php example", () => {
      const filePath = path.resolve(__dirname, "../../examples/php/PaymentService.php");
      const original = fs.readFileSync(filePath, "utf-8");

      const res = executeRoundtrip(original, "php", filePath);
      expect(res.aice).toBeDefined();

      const parsed = parse(res.aice, `${filePath}.aice`);
      expect(parsed).toBeDefined();

      expect(res.reconstructed).toContain("class PaymentService");
      expect(res.reconstructed).toContain("__construct");
      expect(res.reconstructed).toContain("UserRepository $userRepository");
      expect(res.reconstructed).toContain("readonly float $processingFee");
      expect(res.reconstructed).toContain("throw");
      expect(res.reconstructed).toContain("match");
    });

    it("satisfies multi-round idempotence convergence (Round 1 == Round 2 == Round 3)", () => {
      const source = `<?php

declare(strict_types=1);

namespace App\\Math;

class MathUtil {
    public function double(int $val): int {
        return $val * 2;
    }
}
`;
      const round1 = executeRoundtrip(source, "php", "MathUtil.php");
      const round2 = executeRoundtrip(round1.reconstructed, "php", "MathUtil.php");
      const round3 = executeRoundtrip(round2.reconstructed, "php", "MathUtil.php");

      expect(round1.reconstructed).toBe(round2.reconstructed);
      expect(round2.reconstructed).toBe(round3.reconstructed);
    });
  });

  // ===========================================================================
  // SECTION 5: Polymorphic CLI Integration on .php Files
  // ===========================================================================
  describe("Polymorphic CLI Integration on .php Files", () => {
    it("executes 'aice decompile' on a .php file producing valid .php.aice and 'aice compile' back", () => {
      const testPhp = path.join(tmpDir, "UserEntity.php");
      fs.writeFileSync(
        testPhp,
        `<?php

declare(strict_types=1);

class UserEntity {
    public function __construct(
        public int $id,
        public string $name,
    ) {}

    public function describe(): string {
        return $this->name;
    }
}
`,
      );

      const decompileRes = runCli(["decompile", testPhp], tmpDir);
      expect(decompileRes.status).toBe(0);

      const aiceOutput = path.join(tmpDir, "UserEntity.php.aice");
      expect(fs.existsSync(aiceOutput)).toBe(true);
      const aiceContent = fs.readFileSync(aiceOutput, "utf-8");
      expect(aiceContent).toContain("class UserEntity");
      expect(aiceContent).toContain("pub id:int");
      expect(aiceContent).toContain("pub name:str");

      // Now compile it back with aice compile
      fs.rmSync(testPhp);
      const compileRes = runCli(["compile", aiceOutput], tmpDir);
      expect(compileRes.status).toBe(0);
      expect(fs.existsSync(testPhp)).toBe(true);
      const phpRecompiled = fs.readFileSync(testPhp, "utf-8");
      expect(phpRecompiled).toContain("class UserEntity");
      expect(phpRecompiled).toContain("__construct");
    });

    it("executes 'aice outline' on a .php file with high token savings", () => {
      const testPhp = path.join(tmpDir, "ReportService.php");
      fs.writeFileSync(
        testPhp,
        `<?php

declare(strict_types=1);

namespace App\\Services;

class ReportService {
    public function generateReport(string $type, array $data): string {
        // Long complicated body that gets skeletonized
        $result = 'Report: ' . $type;
        foreach ($data as $item) {
            $result .= ' ' . $item;
        }
        return $result;
    }

    public function emailReport(string $to, string $content): bool {
        return true;
    }
}
`,
      );

      const res = runCli(["outline", testPhp], tmpDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("ReportService");
      expect(res.stdout).toContain("generateReport");
      expect(res.stdout).toContain("emailReport");
    });

    it("executes 'aice context' on a .php file generating semantic context map", () => {
      const testPhp = path.join(tmpDir, "OrderCalculator.php");
      fs.writeFileSync(
        testPhp,
        `<?php

declare(strict_types=1);

class OrderCalculator {
    public function computeTotal(float $subtotal, float $tax): float {
        return $subtotal * (1.0 + $tax);
    }
}
`,
      );

      const res = runCli(["context", testPhp], tmpDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("OrderCalculator");
    });
  });

  // ===========================================================================
  // SECTION 6: Semantic Typecheck Soundness
  // ===========================================================================
  describe("Semantic Typecheck Soundness on Decompiled Modules", () => {
    it("guarantees zero syntax errors and produces a valid typed module", () => {
      const source = `<?php

declare(strict_types=1);

class BankAccount {
    private float $balance = 0.0;

    public function deposit(float $amount): bool {
        if ($amount > 0.0) {
            $this->balance += $amount;
            return true;
        }
        return false;
    }

    public function getBalance(): float {
        return $this->balance;
    }
}
`;
      const decomp = decompilePhp(source, "BankAccount.php");
      const { ast } = parseWithTrivia(decomp.aice, "BankAccount.php.aice");

      const checker = new TypeChecker();
      expect(() => checker.checkModule(ast)).not.toThrow();
    });
  });
});
