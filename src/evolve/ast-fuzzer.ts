/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Seeded PRNG AST Fuzzer & Hallucination Generator.
 * Conforms to Pillar 1 & 2 of Autonomous Evolution & Self-Repair Engine.
 */

import type { TargetLanguage } from "../emitters/context.js";

/**
 * Fast 32-bit seeded pseudo-random number generator (mulberry32).
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FUZZ_TARGET_LANGUAGES: TargetLanguage[] = [
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "kotlin",
  "php",
  "cpp",
  "csharp",
];

export interface FuzzAiceProgram {
  name: string;
  aiceSource: string;
  target: TargetLanguage;
  entryCallExpr?: string;
}

export interface HallucinatedAiceProgram {
  name: string;
  brokenAiceSource: string;
  faultKind: string;
}

/**
 * Synthesizes Level-2 ultra-complex, recursively-combinator AICE programs
 * with nested arithmetic/boolean expressions, loops, try/catch, match/case, classes,
 * repetitive blocks for idiom mining, and exposing deterministic entry `pub fn computeMain(x: int, y: int) -> int`.
 */
export function generateRecursiveAiceProgram(
  seed: number,
  maxDepth = 3,
): FuzzAiceProgram & { entryCallExpr: string } {
  const prng = mulberry32(seed);
  const targetIndex = Math.abs(seed) % FUZZ_TARGET_LANGUAGES.length;
  const target = FUZZ_TARGET_LANGUAGES[targetIndex];
  const name = `fuzz_recursive_${seed}`;

  function genExpr(depth: number, vars: string[]): string {
    if (depth <= 0 || prng() > 0.65) {
      const choice = Math.floor(prng() * (vars.length + 3));
      if (choice < vars.length) return vars[choice];
      return String(1 + Math.floor(prng() * 9));
    }
    const op = ["+", "-", "*"][Math.floor(prng() * 3)];
    const left = genExpr(depth - 1, vars);
    const right = genExpr(depth - 1, vars);
    return `(${left} ${op} ${right})`;
  }

  const expr1 = genExpr(maxDepth, ["x", "y", "total"]);

  const aiceSource = `class Acc:
  val: int

  fn constructor(init: int):
    this.val = init

  fn add(n: int) -> int:
    this.val = this.val + n
    return this.val

pub fn stepA(v: int) -> int:
  if v < 0:
    return 0
  return v * 2

pub fn stepB(v: int) -> int:
  if v < 0:
    return 0
  return v * 2

pub fn computeMain(x: int, y: int) -> int:
  let acc = Acc(x)
  let mut total: int = y
  for item in [1, 2, 3]:
    total = total + item
  let c1 = ${expr1}
  total = total + c1
  match total:
    case 1 =>
      total = total + 10
    case _ =>
      total = total + 20
  try:
    if total < 0:
      throw "neg"
  catch err:
    total = 0
  let res = acc.add(stepA(total))
  return res + stepB(x)
`;

  return { name, aiceSource, target, entryCallExpr: "computeMain(x, y)" };
}

/**
 * Generates diverse, valid AICE programs containing varied combinations of
 * records, enums, classes, functions, loops, and repetitive statement blocks (for idiom mining).
 */
export function generateFuzzAiceProgram(seed: number): FuzzAiceProgram {
  if (Math.abs(seed) % 2 === 1) {
    return generateRecursiveAiceProgram(seed, 3);
  }

  const prng = mulberry32(seed);
  const targetIndex = Math.abs(seed) % FUZZ_TARGET_LANGUAGES.length;
  const target = FUZZ_TARGET_LANGUAGES[targetIndex];

  const archetype = Math.abs(Math.floor(prng() * 12));
  const baseVal = 10 + Math.floor(prng() * 90);
  const factor = 2 + Math.floor(prng() * 5);

  let name = `fuzz_${seed}`;
  let aiceSource = "";

  switch (archetype) {
    case 0: {
      name = `fuzz_math_stats_${seed}`;
      aiceSource = `type Range = { minVal: int, maxVal: int }

pub fn clampA(val: int, minVal: int, maxVal: int) -> int:
  if val < minVal:
    return minVal
  elif val > maxVal:
    return maxVal
  return val

pub fn clampB(val: int, minVal: int, maxVal: int) -> int:
  if val < minVal:
    return minVal
  elif val > maxVal:
    return maxVal
  return val

pub fn clampC(val: int, minVal: int, maxVal: int) -> int:
  if val < minVal:
    return minVal
  elif val > maxVal:
    return maxVal
  return val

pub fn calcSum(count: int) -> int:
  let mut total = ${baseVal}
  let mut i = 0
  while i < count:
    total = total + i
    i = i + 1
  return total

pub fn computeMain(x: int, y: int) -> int:
  let c = clampA(x, 0, 100)
  let s = calcSum(y % 10)
  return c + s
`;
      break;
    }

    case 1: {
      name = `fuzz_ecommerce_${seed}`;
      aiceSource = `enum Tier:
  Bronze
  Silver
  Gold

type Customer = {
  id: int,
  balance: int,
  active: bool,
}

class OrderManager {
  fee: int

  fn constructor(fee: int) {
    this.fee = fee
  }

  fn calcDiscountA(amount: int, active: bool) -> int {
    if amount < 0:
      return 0
    if not active:
      return 0
    return amount * ${factor}
  }

  fn calcDiscountB(amount: int, active: bool) -> int {
    if amount < 0:
      return 0
    if not active:
      return 0
    return amount * ${factor * 2}
  }

  fn calcDiscountC(amount: int, active: bool) -> int {
    if amount < 0:
      return 0
    if not active:
      return 0
    return amount * ${factor * 3}
  }
}

pub fn computeMain(x: int, y: int) -> int {
  let mgr = OrderManager(x)
  let d = mgr.calcDiscountA(y, true)
  return d + mgr.fee
}
`;
      break;
    }

    case 2: {
      name = `fuzz_geometry_${seed}`;
      aiceSource = `type Point = { x: int, y: int }
type Rect = { x: int, y: int, w: int, h: int }

pub fn containsA(px: int, py: int, rx: int, ry: int) -> bool:
  if px < rx:
    return false
  if py < ry:
    return false
  return true

pub fn containsB(px: int, py: int, rx: int, ry: int) -> bool:
  if px < rx:
    return false
  if py < ry:
    return false
  return true

pub fn containsC(px: int, py: int, rx: int, ry: int) -> bool:
  if px < rx:
    return false
  if py < ry:
    return false
  return true

pub fn calcArea(w: int, h: int) -> int:
  return w * h

pub fn computeMain(x: int, y: int) -> int:
  let inside = containsA(x, y, 0, 0)
  let area = calcArea(x, y)
  if inside:
    return area
  return 0
`;
      break;
    }

    case 3: {
      name = `fuzz_task_pipeline_${seed}`;
      aiceSource = `enum Status:
  Ready
  Running
  Success
  Failed

type Task = {
  id: int,
  priority: int,
  retries: int,
}

pub fn validateTaskA(task: Task) -> bool:
  if task.retries > 3:
    return false
  if task.priority < 0:
    return false
  return true

pub fn validateTaskB(task: Task) -> bool:
  if task.retries > 3:
    return false
  if task.priority < 0:
    return false
  return true

pub fn validateTaskC(task: Task) -> bool:
  if task.retries > 3:
    return false
  if task.priority < 0:
    return false
  return true

pub fn boostPriority(task: Task, bonus: int) -> int:
  return task.priority + bonus + ${baseVal}

pub fn checkTask(priority: int, bonus: int) -> int:
  return priority + bonus + ${baseVal}

pub fn computeMain(x: int, y: int) -> int:
  return checkTask(x, y)
`;
      break;
    }

    case 4: {
      name = `fuzz_game_entity_${seed}`;
      aiceSource = `class Entity {
  id: int
  health: int

  fn constructor(id: int, health: int) {
    this.id = id
    this.health = health
  }

  fn healA(amount: int) -> int {
    if amount <= 0:
      return 0
    if this.health >= 100:
      return 100
    return this.health + amount
  }

  fn healB(amount: int) -> int {
    if amount <= 0:
      return 0
    if this.health >= 100:
      return 100
    return this.health + amount
  }

  fn healC(amount: int) -> int {
    if amount <= 0:
      return 0
    if this.health >= 100:
      return 100
    return this.health + amount
  }
}

pub fn computeMain(x: int, y: int) -> int {
  let e = Entity(1, x)
  return e.healA(y)
}
`;
      break;
    }

    case 5: {
      name = `fuzz_event_log_${seed}`;
      aiceSource = `enum LogLevel:
  Debug
  Info
  Warn
  Error

type LogEvent = {
  level: int,
  code: int,
  count: int,
}

pub fn handleEventA(code: int, count: int) -> int:
  if code < 0:
    return 0
  if count <= 0:
    return 0
  return code * count

pub fn handleEventB(code: int, count: int) -> int:
  if code < 0:
    return 0
  if count <= 0:
    return 0
  return code * count

pub fn handleEventC(code: int, count: int) -> int:
  if code < 0:
    return 0
  if count <= 0:
    return 0
  return code * count

pub fn computeMain(x: int, y: int) -> int:
  return handleEventA(x, y)
`;
      break;
    }
    case 6: {
      name = `fuzz_match_status_${seed}`;
      aiceSource = `pub fn evalStatus(c: int) -> int:
  match c:
    case 1 =>
      return ${baseVal}
    case 2 =>
      return ${baseVal + 10}
    case _ =>
      return 0

pub fn computeMain(x: int, y: int) -> int:
  let r = evalStatus(x % 3)
  return r + y
`;
      break;
    }

    case 7: {
      name = `fuzz_array_iter_${seed}`;
      aiceSource = `pub fn sumList(items: [int]) -> int:
  let mut total = ${baseVal}
  for item in items:
    total = total + item
  return total

pub fn computeMain(x: int, y: int) -> int:
  let arr = [x, y, x + y]
  return sumList(arr)
`;
      break;
    }

    case 8: {
      name = `fuzz_string_csl_${seed}`;
      aiceSource = `pub fn procStr(s: str) -> bool:
  let c = s.trim()
  if c.startsWith("prefix_${baseVal}"):
    return true
  if c.endsWith("suffix_${factor}"):
    return true
  return false

pub fn computeMain(x: int, y: int) -> int:
  let s = "prefix_${baseVal}"
  let ok = procStr(s)
  if ok:
    return x + y
  return x - y
`;
      break;
    }

    case 9: {
      name = `fuzz_opt_result_${seed}`;
      aiceSource = `pub fn parseScore(v: int?) -> Result[int, str]:
  if v != nil:
    return Ok(v)
  return Err("no score")

pub fn checkScore(v: int) -> int:
  if v > 0:
    return v * 2
  return 0

pub fn computeMain(x: int, y: int) -> int:
  return checkScore(x) + y
`;
      break;
    }

    case 10: {
      name = `fuzz_multi_param_idiom_${seed}`;
      aiceSource = `pub fn checkBoundsA(x: int, y: int) -> bool:
  if x < ${baseVal}:
    return false
  if y > ${baseVal * factor}:
    return false
  return true

pub fn checkBoundsB(x: int, y: int) -> bool:
  if x < ${baseVal + 10}:
    return false
  if y > ${baseVal * factor + 50}:
    return false
  return true

pub fn checkBoundsC(x: int, y: int) -> bool:
  if x < ${baseVal + 20}:
    return false
  if y > ${baseVal * factor + 100}:
    return false
  return true

pub fn computeMain(x: int, y: int) -> int:
  let b = checkBoundsA(x, y)
  if b:
    return x * 2 + y
  return x + y
`;
      break;
    }

    case 11: {
      name = `fuzz_while_nested_if_${seed}`;
      aiceSource = `pub fn countAccum(lim: int) -> int:
  let mut s = ${baseVal}
  let mut i = 0
  while i < lim:
    if i % 3 == 0:
      s += 3
    elif i % 2 == 0:
      s += 2
    else:
      s += 1
    i += 1
  return s

pub fn computeMain(x: int, y: int) -> int:
  return countAccum(x % 10) + y
`;
      break;
    }
  }

  return { name, aiceSource, target, entryCallExpr: "computeMain(x, y)" };
}

/**
 * Generates broken/hallucinated AICE programs with specific fault kinds
 * to exercise the autonomous self-repair engine.
 */
export function generateHallucinatedAiceProgram(seed: number): HallucinatedAiceProgram {
  const faultIndex = Math.abs(seed) % 14;
  const val = 10 + (Math.abs(seed) % 50);

  switch (faultIndex) {
    case 0:
      return {
        name: `broken_let_reassign_${seed}`,
        faultKind: "immutable_reassignment_let",
        brokenAiceSource: `fn test_${seed}() -> int {\n  let x = ${val};\n  x = ${val + 10};\n  return x;\n}`,
      };

    case 1:
      return {
        name: `broken_walrus_reassign_${seed}`,
        faultKind: "immutable_reassignment_walrus",
        brokenAiceSource: `fn test_${seed}() -> int {\n  x := ${val};\n  x = ${val + 10};\n  return x;\n}`,
      };

    case 2:
      return {
        name: `broken_const_reassign_${seed}`,
        faultKind: "immutable_reassignment_const",
        brokenAiceSource: `fn test_${seed}() -> int {\n  const x = ${val};\n  x = ${val + 10};\n  return x;\n}`,
      };

    case 3:
      return {
        name: `broken_div_zero_${seed}`,
        faultKind: "division_by_zero",
        brokenAiceSource: `fn test_${seed}() -> int {\n  let x = ${val} / 0;\n  return x;\n}`,
      };

    case 4:
      return {
        name: `broken_if_int_${seed}`,
        faultKind: "non_boolean_condition_int",
        brokenAiceSource: `fn test_${seed}(count: int) -> int {\n  if count: {\n    return 1;\n  }\n  return 0;\n}`,
      };

    case 5:
      return {
        name: `broken_unhandled_result_${seed}`,
        faultKind: "unhandled_result",
        brokenAiceSource: `fn fetch_${seed}() -> Result[int, str] = Ok(${val});\nfn test_${seed}() -> Result[int, str] {\n  let val: int = fetch_${seed}();\n  return Ok(val);\n}`,
      };

    case 6:
      return {
        name: `broken_js_triple_eq_${seed}`,
        faultKind: "js_triple_eq",
        brokenAiceSource: `fn test_${seed}(a: int, b: int) -> bool {\n  let res = a === b;\n  return res;\n}`,
      };

    case 7:
      return {
        name: `broken_js_not_triple_eq_${seed}`,
        faultKind: "js_not_triple_eq",
        brokenAiceSource: `fn test_${seed}(a: int, b: int) -> bool {\n  let res = a !== b;\n  return res;\n}`,
      };

    case 8:
      return {
        name: `broken_js_null_${seed}`,
        faultKind: "js_null",
        brokenAiceSource: `fn test_${seed}() -> int {\n  let x = null;\n  return 0;\n}`,
      };

    case 9:
      return {
        name: `broken_compound_const_if_${seed}`,
        faultKind: "compound_const_and_non_bool_if",
        brokenAiceSource: `fn test_${seed}() -> int {\n  const x = ${val};\n  if x: {\n    x = x + 1;\n  }\n  return x;\n}`,
      };

    case 10:
      return {
        name: `broken_compound_walrus_eq_div_${seed}`,
        faultKind: "compound_walrus_and_triple_eq_and_div_zero",
        brokenAiceSource: `fn test_${seed}() -> int {\n  a := ${val};\n  if a === ${val}: {\n    a = ${val} / 0;\n  }\n  return a;\n}`,
      };

    case 11:
      return {
        name: `broken_compound_null_neq_${seed}`,
        faultKind: "compound_null_and_not_triple_eq",
        brokenAiceSource: `fn test_${seed}() -> int {\n  let x: int? = null;\n  if x !== nil: {\n    return 1;\n  }\n  return 0;\n}`,
      };

    case 12:
      return {
        name: `broken_compound_let_result_${seed}`,
        faultKind: "compound_let_and_unhandled_result",
        brokenAiceSource: `fn fetch_${seed}() -> Result[int, str] = Ok(${val});\nfn test_${seed}() -> Result[int, str] {\n  let x: int = fetch_${seed}();\n  x = x + 1;\n  return Ok(x);\n}`,
      };

    default:
      return {
        name: `broken_compound_triple_eq_div_${seed}`,
        faultKind: "compound_triple_eq_and_div_zero",
        brokenAiceSource: `fn test_${seed}(a: int) -> int {\n  let mut res = ${val} / 0;\n  if a === ${val}: {\n    return res;\n  }\n  return 0;\n}`,
      };
  }
}
