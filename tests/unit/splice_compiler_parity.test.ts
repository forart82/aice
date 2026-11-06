import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../../src/core/parser.js";
import { emitTarget } from "../../src/emitters/index.js";
import { spliceSource } from "../../src/tools/splice.js";

describe("Polyglot Native Splice & Compiler Parity Regression Suite", () => {
  it("parses relative import paths with /.../i or /.../g segments without regex literal lexer collision", () => {
    const ast1 = parse("module test\nuse ./src/index.{foo, bar}\n", "test.ail");
    expect(ast1.items).toHaveLength(1);
    expect(ast1.items[0]?.kind).toBe("ImportDecl");

    const ast2 = parse(
      "module test\nuse ./utils/math.{clamp}\nuse ../api/gateway.{send}\n",
      "test.ail",
    );
    expect(ast2.items).toHaveLength(2);
    expect(ast2.items[0]?.kind).toBe("ImportDecl");
    expect(ast2.items[1]?.kind).toBe("ImportDecl");
  });

  it("lowers ternary assignment (x = cond ? 0 : 1) into IfStmt so falsy true-branch values evaluate accurately", () => {
    const ast = parse(
      `module test\npub fn pick(flag: bool) -> int:\n  x := 99\n  x = flag ? 0 : 1\n  ret x\n`,
      "test.ail",
    );
    const tsCode = emitTarget(ast, "typescript", { watermark: false });
    expect(tsCode).toContain("if (flag)");
    expect(tsCode).toContain("x = 0;");
    expect(tsCode).toContain("x = 1;");
  });

  it("handles Rust lifetimes ('static), raw strings (r#\"...\"#), C++ digit separators (1'000), and #ifdef braces in spliceSource", () => {
    const rustSrc = `pub struct Pool {
    pub count: i32,
}

impl Pool {
    pub fn reset(&mut self) -> i32 {
        let label: &'static str = "default";
        let raw = r#"{ unclosed brace in raw string"#;
        let prev = self.count;
        self.count = 0;
        prev
    }

    pub fn keep_me(&self) -> i32 {
        self.count
    }
}
`;
    const rustRes = spliceSource(
      rustSrc,
      "Pool.reset",
      `pub fn reset() -> i32:\n  prev := this.count\n  this.count = 0\n  ret prev`,
      false,
      "pool.rs",
    );
    expect(rustRes.success).toBe(true);
    expect(rustRes.newAilSource).toContain("pub fn keep_me(&self) -> i32");
    expect(rustRes.newAilSource.trimEnd().endsWith("}")).toBe(true);

    const cppSrc = `class Engine {
public:
    double scale(double x) {
        int cap = 1'000'000;
#ifdef FAST_PATH
        if (x > 0.0) {
#else
        if (x >= 0.0) {
#endif
            return x * 2.0;
        }
        return 0.0;
    }

    double keepMe() {
        return 1.0;
    }
};
`;
    const cppRes = spliceSource(
      cppSrc,
      "Engine.scale",
      `pub fn scale(x: float) -> float:\n  ret x * 3.0`,
      false,
      "engine.cpp",
    );
    expect(cppRes.success).toBe(true);
    expect(cppRes.newAilSource).toContain("double keepMe()");
    expect(cppRes.newAilSource.trimEnd().endsWith("};")).toBe(true);
  });

  it("produces syntax-valid native code verified by real C++ (g++), Rust (rustc), Python (py_compile), and PHP (php -l) compilers", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-compiler-verify-"));
    try {
      // 1. C++ out-of-line splice verified with g++ -std=c++20 -fsyntax-only
      const cppFixture = `#include <cmath>
class PidController {
public:
    double kp;
    double saturateOutput(double value, double minLimit, double maxLimit);
};

double PidController::saturateOutput(double value, double minLimit, double maxLimit) {
    return value;
}
`;
      const cppSplice = spliceSource(
        cppFixture,
        "PidController::saturateOutput",
        `pub fn saturateOutput(value: float, minLimit: float, maxLimit: float) -> float:\n  if value < minLimit:\n    ret minLimit\n  ret value > maxLimit ? maxLimit : value`,
        false,
        "controller.cpp",
      );
      expect(cppSplice.success).toBe(true);
      const cppFile = path.join(tmpDir, "controller.cpp");
      fs.writeFileSync(cppFile, cppSplice.newAilSource, "utf-8");
      execFileSync("g++", ["-std=c++20", "-fsyntax-only", cppFile]);

      // 2. Rust impl method splice verified with rustc --crate-type lib
      const rustFixture = `pub struct RateLimiter {
    pub tokens: i32,
}

impl RateLimiter {
    pub fn try_acquire(&mut self, requested: i32) -> bool {
        false
    }

    pub fn remaining(&self) -> i32 {
        self.tokens
    }
}
`;
      const rustSplice = spliceSource(
        rustFixture,
        "RateLimiter.try_acquire",
        `pub fn try_acquire(requested: i32) -> bool:\n  if requested <= 0 or this.tokens < requested:\n    ret false\n  this.tokens = this.tokens - requested\n  ret true`,
        false,
        "limiter.rs",
      );
      expect(rustSplice.success).toBe(true);
      const rustFile = path.join(tmpDir, "limiter.rs");
      const rustRlib = path.join(tmpDir, "liblimiter.rlib");
      fs.writeFileSync(rustFile, rustSplice.newAilSource, "utf-8");
      const rustcBin = fs.existsSync("/home/forart/.cargo/bin/rustc")
        ? "/home/forart/.cargo/bin/rustc"
        : "rustc";
      execFileSync(rustcBin, ["--crate-type", "lib", rustFile, "-o", rustRlib]);

      // 3. PHP method splice verified with php -l
      const phpFixture = `<?php
namespace App\\Billing;

class PaymentGateway
{
    private int $attempts = 0;
    private float $capturedTotal = 0.0;

    public function resetGateway(): int
    {
        return 0;
    }
}
`;
      const phpSplice = spliceSource(
        phpFixture,
        "PaymentGateway.resetGateway",
        `pub fn resetGateway() -> int:\n  prev := this.attempts\n  this.attempts = 0\n  this.capturedTotal = 0.0\n  ret prev`,
        false,
        "PaymentGateway.php",
      );
      expect(phpSplice.success).toBe(true);
      const phpFile = path.join(tmpDir, "PaymentGateway.php");
      fs.writeFileSync(phpFile, phpSplice.newAilSource, "utf-8");
      const phpBin = fs.existsSync("/home/forart/.local/bin/php")
        ? "/home/forart/.local/bin/php"
        : "php";
      execFileSync(phpBin, ["-l", phpFile]);

      // 4. Python method splice verified with python3 -m py_compile
      const pyFixture = `class FeatureAggregator:
    def __init__(self, window_size: int) -> None:
        self.window_size = window_size
        self.total_seen = 0

    @staticmethod
    def clamp_unit(val: float) -> float:
        return val
`;
      const pySplice = spliceSource(
        pyFixture,
        "FeatureAggregator.clamp_unit",
        `pub static fn clamp_unit(val: float) -> float:\n  ret max(0.0, min(1.0, val))`,
        false,
        "pipeline.py",
      );
      expect(pySplice.success).toBe(true);
      const pyFile = path.join(tmpDir, "pipeline.py");
      fs.writeFileSync(pyFile, pySplice.newAilSource, "utf-8");
      execFileSync("python3", ["-m", "py_compile", pyFile]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
