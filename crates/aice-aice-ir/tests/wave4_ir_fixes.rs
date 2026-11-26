use std::path::Path;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn to_aice_str(lang: LanguageId, src: &str) -> String {
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let tree = reg.adapter(lang).unwrap().parse_cst(src).unwrap();
    let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, src, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled for {lang:?}");
    };
    print_aice(&m)
}

fn roundtrip(lang: LanguageId, vname: &str, src: &str) -> (String, String) {
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;
    let tree = reg.adapter(lang).unwrap().parse_cst(src).unwrap();
    let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, src, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled for {lang:?}");
    };
    let aice = print_aice(&m);
    let reparsed = parse_aice(&aice).unwrap_or_else(|e| {
        panic!("parse_aice failed for {vname}: {e}\n--- AICE ---\n{aice}")
    });
    let native = tr.to_native(&reparsed, lang).unwrap_or_else(|e| {
        panic!("to_native failed for {vname}: {e}\n--- AICE ---\n{aice}")
    });
    let verdict = fw.verify(&native, Path::new(vname), lang);
    assert_eq!(
        verdict,
        FirewallVerdict::Valid,
        "firewall rejected {vname}:\n--- NATIVE ---\n{native}\n--- AICE ---\n{aice}"
    );
    (aice, native)
}

#[test]
fn f51_python_ternary_order_and_roundtrip() {
    let py_is_not = r#"def clamp_min(a: int, b: int, raw_min, c: int) -> int:
    return max(a, b) if raw_min is not None else c
"#;
    let aice_is_not = to_aice_str(LanguageId::Python, py_is_not);
    assert!(
        aice_is_not.contains("raw_min is not None ? max(a, b) : c"),
        "Python ternary swapped cond/then:\n{aice_is_not}"
    );
    assert!(
        !aice_is_not.contains("max(a, b) ? raw_min is not None : c"),
        "Python ternary emitted swapped cond/then:\n{aice_is_not}"
    );

    let py_rt = r#"def choose(a: int, b: int, raw_min, c: int, x: int, ready: bool):
    low = max(a, b) if raw_min != None else c
    sign = 1 if x > 0 else -1 if x < 0 else 0
    tag = "ok" if ready else "wait"
    return [low, sign, tag]
"#;
    let (aice, native) = roundtrip(LanguageId::Python, "ternary.py", py_rt);
    assert!(
        aice.contains("raw_min != nil ? max(a, b) : c"),
        "AICE wrong ternary order:\n{aice}"
    );
    assert!(
        aice.contains("x > 0 ? 1 : x < 0 ? -1 : 0"),
        "AICE wrong nested ternary order:\n{aice}"
    );
    assert!(
        aice.contains("ready ? \"ok\" : \"wait\""),
        "AICE wrong simple ternary order:\n{aice}"
    );
    assert!(
        native.contains("max(a, b) if raw_min != None else c"),
        "Native Python swapped ternary:\n{native}"
    );
    assert!(
        native.contains("1 if x > 0 else -1 if x < 0 else 0"),
        "Native Python swapped nested ternary:\n{native}"
    );
    assert!(
        native.contains("\"ok\" if ready else \"wait\""),
        "Native Python swapped simple ternary:\n{native}"
    );

    // Ensure JS/TS ternary remains in standard (cond, then, else) order.
    let ts_tern = "export function pick(flag: boolean, a: number, b: number): number {\n  return flag ? a : b;\n}\n";
    let (aice_ts, nat_ts) = roundtrip(LanguageId::TypeScript, "tern.ts", ts_tern);
    assert!(aice_ts.contains("flag ? a : b"), "{aice_ts}");
    assert!(nat_ts.contains("flag ? a : b"), "{nat_ts}");
}

#[test]
fn f52_php_braced_and_multi_namespace_preservation() {
    let multi_php = r#"<?php

namespace Symfony\Bundle\FrameworkBundle\Test {
    class WebTestCase {
        public function createClient(): void {
            $this->boot();
        }
    }
}

namespace App\Tests {
    use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

    interface AssertionContract {
        public function assertOk(bool $cond): void;
    }

    trait FixtureHelper {
        public function defaultEmail(): string {
            return "ops@example.com";
        }
    }

    const TEST_SUITE = 'integration';

    function bootstrap_env(string $env): string {
        return $env;
    }

    class OrderControllerTest extends WebTestCase implements AssertionContract {
        public function assertOk(bool $cond): void {
            if (!$cond) {
                throw new \RuntimeException("failed");
            }
        }
    }
}
"#;
    let (aice, native) = roundtrip(LanguageId::Php, "OrderControllerTest.php", multi_php);
    assert!(
        aice.starts_with("module Symfony/Bundle/FrameworkBundle/Test\n"),
        "Expected first namespace as module header:\n{aice}"
    );
    for expected in [
        "class WebTestCase",
        "fn createClient()",
        "App\\\\Tests",
        "AssertionContract",
        "FixtureHelper",
        "fn defaultEmail()",
        "TEST_SUITE",
        "fn bootstrap_env(",
        "class OrderControllerTest extends WebTestCase implements AssertionContract",
        "fn assertOk(",
    ] {
        assert!(
            aice.contains(expected),
            "Multi-namespace PHP dropped `{expected}` from AICE:\n{aice}"
        );
    }
    for expected in [
        "namespace Symfony\\Bundle\\FrameworkBundle\\Test;",
        "class WebTestCase",
        "namespace App\\Tests;",
        "use Symfony\\Bundle\\FrameworkBundle\\Test\\WebTestCase;",
        "interface AssertionContract",
        "trait FixtureHelper",
        "const TEST_SUITE = 'integration';",
        "function bootstrap_env(",
        "class OrderControllerTest extends WebTestCase implements AssertionContract",
    ] {
        assert!(
            native.contains(expected),
            "Multi-namespace PHP dropped `{expected}` from native output:\n{native}"
        );
    }

    // Single braced namespace should emit clean module header with no redundant directive.
    let single_php = r#"<?php
namespace App\Domain {
    class Invoice {
        public function total(): int {
            return 42;
        }
    }
}
"#;
    let (s_aice, s_native) = roundtrip(LanguageId::Php, "Invoice.php", single_php);
    assert!(s_aice.starts_with("module App/Domain\n"), "{s_aice}");
    assert!(!s_aice.contains("directive"), "Unexpected directive for single namespace:\n{s_aice}");
    assert!(s_aice.contains("class Invoice") && s_aice.contains("fn total()"), "{s_aice}");
    assert!(s_native.contains("namespace App\\Domain;") && s_native.contains("class Invoice"), "{s_native}");

    // Global anonymous braced namespace `namespace { ... }`.
    let global_php = r#"<?php
namespace {
    function global_helper(): int {
        return 7;
    }
}
"#;
    let (g_aice, g_native) = roundtrip(LanguageId::Php, "global.php", global_php);
    assert!(g_aice.contains("fn global_helper()"), "{g_aice}");
    assert!(g_native.contains("function global_helper()"), "{g_native}");
}

#[test]
fn f53_js_ts_object_literal_shorthand_methods_and_accessors() {
    let js = r#"export function createEl(base, tag) {
  return {
    ...base,
    tag,
    _size: 0,
    attr(k, v) {
      this[k] = v;
      return this;
    },
    css(prop, val) {
      this.style[prop] = val;
      return this;
    },
    async fetch(url) {
      return await load(url);
    },
    get size() {
      return this._size;
    },
    set size(v) {
      this._size = v;
    },
    "on-click"(ev) {
      return ev.target;
    },
  };
}

export function methodsOnly() {
  return {
    attr(k, v) {
      return k;
    },
    css(p) {
      return p;
    },
  };
}
"#;
    let (aice_js, nat_js) = roundtrip(LanguageId::JavaScript, "dom_helper.js", js);
    for expected in [
        "...base",
        "attr: fn(k, v)",
        "this[k] = v",
        "css: fn(prop, val)",
        "this.style[prop] = val",
        "fetch: async fn(url)",
        "await load(url)",
        "\"get size\": fn()",
        "\"set size\": fn(v)",
        "\"on-click\": fn(ev)",
    ] {
        assert!(
            aice_js.contains(expected),
            "JS object literal method `{expected}` dropped in AICE:\n{aice_js}"
        );
    }
    for expected in [
        "...base",
        "attr: (k, v) =>",
        "css: (prop, val) =>",
        "fetch: async (url) =>",
        "get size()",
        "set size(v)",
        "\"on-click\": (ev) =>",
    ] {
        assert!(
            nat_js.contains(expected),
            "JS object literal method `{expected}` lost in native output:\n{nat_js}"
        );
    }

    let ts = r#"export function makeStore(initial: number) {
  return {
    _count: initial,
    add(delta: number = 1): number {
      this._count += delta;
      return this._count;
    },
    async sync(endpoint: string): Promise<number> {
      return await postCount(endpoint, this._count);
    },
    get count(): number {
      return this._count;
    },
    set count(next: number) {
      this._count = next;
    },
  };
}
"#;
    let (aice_ts, nat_ts) = roundtrip(LanguageId::TypeScript, "store.ts", ts);
    assert!(aice_ts.contains("add: fn(delta: num = 1) -> num"), "{aice_ts}");
    assert!(aice_ts.contains("sync: async fn(endpoint: str) -> Promise[num]"), "{aice_ts}");
    assert!(aice_ts.contains("\"get count\": fn() -> num"), "{aice_ts}");
    assert!(aice_ts.contains("\"set count\": fn(next: num)"), "{aice_ts}");
    assert!(nat_ts.contains("get count(): number"), "{nat_ts}");
    assert!(nat_ts.contains("set count(next: number)"), "{nat_ts}");
    assert!(nat_ts.contains("sync: async (endpoint: string): Promise<number> =>"), "{nat_ts}");
}

#[test]
fn f42_ts_string_literal_unions_no_double_escaping() {
    let ts = r#"export type SyncDirection = "push" | "pull";
export type OrderStatus = 'pending' | 'settled' | 'flagged' | 'refunded';
export type Action =
  | "create"
  | "update"
  | "delete";
export type Mode = "read" | "write" | null;
export type TaskState = "in-progress" | "done" | "";
export type EventName = "user.created" | "user.deleted";

export interface SyncJob {
  direction: "push" | "pull";
  weights: Record<"push" | "pull", number>;
  label: "only";
  readonly items: readonly string[];
  meta: { id: string; tag: string };
}

export function runSync(dir: "push" | "pull"): "ok" | "retry" {
  return dir === "push" ? "ok" : "retry";
}
"#;
    let (aice, native) = roundtrip(LanguageId::TypeScript, "sync_types.ts", ts);
    assert!(
        !aice.contains("\\\""),
        "TS string-literal union double-escaped quotes in AICE:\n{aice}"
    );
    for expected in [
        "pub type SyncDirection = \"push\" | \"pull\"",
        "pub type OrderStatus = 'pending' | 'settled' | 'flagged' | 'refunded'",
        "pub type Action = \"create\" | \"update\" | \"delete\"",
        "pub type Mode = \"read\" | \"write\" | null",
        "pub type TaskState = \"in-progress\" | \"done\" | \"\"",
        "pub type EventName = \"user.created\" | \"user.deleted\"",
        "direction:\"push\" | \"pull\"",
        "weights:Record[\"push\" | \"pull\", num]",
        "label:\"only\"",
        "fn runSync(dir:\"push\" | \"pull\") -> \"ok\" | \"retry\"",
    ] {
        assert!(
            aice.contains(expected),
            "Missing clean string-literal union `{expected}` in AICE:\n{aice}"
        );
    }

    // Re-printing after parse_aice must remain free of double escaping.
    let reparsed = parse_aice(&aice).unwrap();
    let reprinted = print_aice(&reparsed);
    assert!(!reprinted.contains("\\\""), "Reprint introduced double escaping:\n{reprinted}");

    // Compiled TS must preserve string-literal quotes AND keep raw TS types unquoted.
    for expected in [
        "export type SyncDirection = \"push\" | \"pull\";",
        "export type OrderStatus = \"pending\" | \"settled\" | \"flagged\" | \"refunded\";",
        "export type Action = \"create\" | \"update\" | \"delete\";",
        "export type Mode = \"read\" | \"write\" | null;",
        "export type TaskState = \"in-progress\" | \"done\" | \"\";",
        "export type EventName = \"user.created\" | \"user.deleted\";",
        "weights: Record<\"push\" | \"pull\", number>;",
        "readonly items: readonly string[];",
        "meta: { id: string; tag: string };",
        "export function runSync(dir: \"push\" | \"pull\"): \"ok\" | \"retry\"",
    ] {
        assert!(
            native.contains(expected),
            "Native TS missing `{expected}`:\n{native}"
        );
    }
}
