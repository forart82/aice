/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: Declarative Term Rewriting & Intent Lowering Engine (Pillars 1 & 5)
 * Compiles canonical high-level intent primitives into idiomatic target idioms.
 */

import type { AilExprNode } from "../core/ast.ts";
import type { EmitContext } from "./context.ts";

export interface TermRewriteRule {
  id: string;
  domain: "string" | "collection" | "math" | "logic" | "control";
  matches: (op: string, args: AilExprNode[]) => boolean;
  lowerTs: (args: string[], rawArgs: AilExprNode[], ctx: EmitContext) => string;
  lowerPy: (args: string[], rawArgs: AilExprNode[], ctx: EmitContext) => string;
}

export const REWRITE_RULES: TermRewriteRule[] = [
  // --- String Canonical Operations (Pillar 1) ---
  {
    id: "RULE_STR_SLICE",
    domain: "string",
    matches: (op, args) => op === "str:slice" && args.length === 3,
    lowerTs: (args) => `${args[0]}.slice(${args[1]}, ${args[2]})`,
    lowerPy: (args) => `${args[0]}[${args[1]}:${args[2]}]`,
  },
  {
    id: "RULE_STR_AT",
    domain: "string",
    matches: (op, args) => op === "str:at" && args.length === 2,
    lowerTs: (args) => `${args[0]}.at(${args[1]})`,
    lowerPy: (args) => `${args[0]}[${args[1]}]`,
  },
  {
    id: "RULE_STR_LEN",
    domain: "string",
    matches: (op, args) => op === "str:len" && args.length === 1,
    lowerTs: (args) => `${args[0]}.length`,
    lowerPy: (args) => `len(${args[0]})`,
  },
  {
    id: "RULE_STR_CONCAT",
    domain: "string",
    matches: (op, args) => op === "str:concat" && args.length === 2,
    lowerTs: (args) => `${args[0]} + ${args[1]}`,
    lowerPy: (args) => `${args[0]} + ${args[1]}`,
  },
  {
    id: "RULE_STR_PARSE_INT",
    domain: "string",
    matches: (op, args) => op === "str:parse-int" && args.length === 1,
    lowerTs: (args) =>
      `(() => { const _v = parseInt(${args[0]}, 10); return Number.isNaN(_v) ? { ok: false, error: "Invalid integer" } : { ok: true, value: _v }; })()`,
    lowerPy: (args) =>
      `({"ok": True, "value": int(${args[0]})} if ${args[0]}.lstrip("-").isdigit() else {"ok": False, "error": "Invalid integer"})`,
  },

  // --- Collection Primitives (Pillar 3: Pure Immutability) ---
  {
    id: "RULE_ARR_LEN",
    domain: "collection",
    matches: (op, args) => op === "arr:len" && args.length === 1,
    lowerTs: (args) => `${args[0]}.length`,
    lowerPy: (args) => `len(${args[0]})`,
  },
  {
    id: "RULE_ARR_GET",
    domain: "collection",
    matches: (op, args) => op === "arr:get" && args.length === 2,
    lowerTs: (args) =>
      `(${args[0]}.at(${args[1]}) !== undefined ? { ok: true, value: ${args[0]}.at(${args[1]}) } : { ok: false })`,
    lowerPy: (args) =>
      `({"ok": True, "value": ${args[0]}[${args[1]}]} if 0 <= ${args[1]} < len(${args[0]}) else {"ok": False})`,
  },
  {
    id: "RULE_ARR_SLICE",
    domain: "collection",
    matches: (op, args) => op === "arr:slice" && args.length === 3,
    lowerTs: (args) => `${args[0]}.slice(${args[1]}, ${args[2]})`,
    lowerPy: (args) => `${args[0]}[${args[1]}:${args[2]}]`,
  },
  {
    id: "RULE_ARR_APPEND",
    domain: "collection",
    matches: (op, args) => op === "arr:append" && args.length === 2,
    lowerTs: (args) => `[...${args[0]}, ${args[1]}]`,
    lowerPy: (args) => `[*${args[0]}, ${args[1]}]`,
  },

  // --- Strict Arithmetic & Modulo ---
  {
    id: "RULE_MATH_ADD",
    domain: "math",
    matches: (op, args) => op === "+" && args.length >= 2,
    lowerTs: (args) => args.join(" + "),
    lowerPy: (args) => args.join(" + "),
  },
  {
    id: "RULE_MATH_SUB",
    domain: "math",
    matches: (op, args) => op === "-" && args.length >= 2,
    lowerTs: (args) => args.join(" - "),
    lowerPy: (args) => args.join(" - "),
  },
  {
    id: "RULE_MATH_MUL",
    domain: "math",
    matches: (op, args) => op === "*" && args.length >= 2,
    lowerTs: (args) => args.join(" * "),
    lowerPy: (args) => args.join(" * "),
  },
  {
    id: "RULE_MATH_DIV",
    domain: "math",
    matches: (op, args) => op === "/" && args.length >= 2,
    lowerTs: (args) => args.join(" / "),
    lowerPy: (args) => args.join(" / "),
  },
  {
    id: "RULE_MATH_MOD",
    domain: "math",
    matches: (op, args) => op === "%" && args.length === 2,
    lowerTs: (args) => `${args[0]} % ${args[1]}`,
    lowerPy: (args) => `${args[0]} % ${args[1]}`,
  },

  // --- Strict Equality & Comparison ---
  {
    id: "RULE_LOGIC_EQ",
    domain: "logic",
    matches: (op, args) => op === "==" && args.length === 2,
    lowerTs: (args) => `${args[0]} === ${args[1]}`,
    lowerPy: (args) => `${args[0]} == ${args[1]}`,
  },
  {
    id: "RULE_LOGIC_NEQ",
    domain: "logic",
    matches: (op, args) => op === "!=" && args.length === 2,
    lowerTs: (args) => `${args[0]} !== ${args[1]}`,
    lowerPy: (args) => `${args[0]} != ${args[1]}`,
  },
  {
    id: "RULE_LOGIC_LT",
    domain: "logic",
    matches: (op, args) => op === "<" && args.length === 2,
    lowerTs: (args) => `${args[0]} < ${args[1]}`,
    lowerPy: (args) => `${args[0]} < ${args[1]}`,
  },
  {
    id: "RULE_LOGIC_GT",
    domain: "logic",
    matches: (op, args) => op === ">" && args.length === 2,
    lowerTs: (args) => `${args[0]} > ${args[1]}`,
    lowerPy: (args) => `${args[0]} > ${args[1]}`,
  },
  {
    id: "RULE_LOGIC_LTE",
    domain: "logic",
    matches: (op, args) => op === "<=" && args.length === 2,
    lowerTs: (args) => `${args[0]} <= ${args[1]}`,
    lowerPy: (args) => `${args[0]} <= ${args[1]}`,
  },
  {
    id: "RULE_LOGIC_GTE",
    domain: "logic",
    matches: (op, args) => op === ">=" && args.length === 2,
    lowerTs: (args) => `${args[0]} >= ${args[1]}`,
    lowerPy: (args) => `${args[0]} >= ${args[1]}`,
  },
  {
    id: "RULE_LOGIC_AND",
    domain: "logic",
    matches: (op, args) => op === "and" && args.length >= 2,
    lowerTs: (args) => args.join(" && "),
    lowerPy: (args) => args.join(" and "),
  },
  {
    id: "RULE_LOGIC_OR",
    domain: "logic",
    matches: (op, args) => op === "or" && args.length >= 2,
    lowerTs: (args) => args.join(" || "),
    lowerPy: (args) => args.join(" or "),
  },
  {
    id: "RULE_LOGIC_NOT",
    domain: "logic",
    matches: (op, args) => op === "not" && args.length === 1,
    lowerTs: (args) => `!${args[0]}`,
    lowerPy: (args) => `not ${args[0]}`,
  },
];

export class TermRewriter {
  private rules: TermRewriteRule[] = REWRITE_RULES;

  public registerRule(rule: TermRewriteRule): void {
    this.rules.unshift(rule);
  }

  public lowerApply(
    operator: string,
    emittedArgs: string[],
    rawArgs: AilExprNode[],
    ctx: EmitContext,
  ): string {
    for (const rule of this.rules) {
      if (rule.matches(operator, rawArgs)) {
        if (ctx.target === "python") {
          return rule.lowerPy(emittedArgs, rawArgs, ctx);
        }
        return rule.lowerTs(emittedArgs, rawArgs, ctx);
      }
    }

    // Default function call emission
    return `${operator}(${emittedArgs.join(", ")})`;
  }
}
