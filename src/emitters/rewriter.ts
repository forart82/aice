/**
 * Declarative Term Rewriting & Canonical API Lowering Engine for AICE 2.0.
 * Conforms to Pillar 2 of docs/RESEARCH_SYNTHESIS.md and Section 2 of docs/AICE_SPEC.md.
 */

import type { TargetLanguage } from "./context.js";

export interface LoweredOperation {
  isLowered: boolean;
  code: string;
}

/**
 * Attempts to rewrite a member access into target language syntax.
 * e.g. str.len -> TS: str.length | Python: len(str)
 */
export function lowerPropertyAccess(
  objectCode: string,
  property: string,
  target: TargetLanguage,
): LoweredOperation {
  if (property === "len" || property === "length") {
    if (target === "python" || target === "go") {
      return { isLowered: true, code: `len(${objectCode})` };
    }
    if (target === "rust") {
      return { isLowered: true, code: `${objectCode}.len()` };
    }
    if (target === "cpp") {
      return { isLowered: true, code: `${objectCode}.size()` };
    }
    return { isLowered: true, code: `${objectCode}.length` };
  }

  return { isLowered: false, code: `${objectCode}.${property}` };
}

/**
 * Attempts to rewrite a canonical method call into target language idioms.
 */
export function lowerMethodCall(
  objectCode: string,
  method: string,
  argCodes: string[],
  target: TargetLanguage,
): LoweredOperation {
  if (target === "python") {
    switch (method) {
      case "slice": {
        const start = argCodes[0] ?? "0";
        const end = argCodes[1] ? `:${argCodes[1]}` : ":";
        return { isLowered: true, code: `${objectCode}[${start}${end}]` };
      }
      case "at":
      case "get": {
        const idx = argCodes[0] ?? "0";
        return { isLowered: true, code: `${objectCode}[${idx}]` };
      }
      case "concat":
        return { isLowered: true, code: `${objectCode} + ${argCodes[0] ?? "''"}` };
      case "toInt":
        return { isLowered: true, code: `int(${objectCode})` };
      case "floor":
        if (objectCode === "math" || objectCode === "Math") {
          return { isLowered: false, code: "" };
        }
        return { isLowered: true, code: `int(${objectCode})` };
      case "round":
        if (objectCode === "math" || objectCode === "Math") {
          return { isLowered: false, code: "" };
        }
        return { isLowered: true, code: `round(${objectCode})` };
      case "ceil":
        if (objectCode === "math" || objectCode === "Math") {
          return { isLowered: false, code: "" };
        }
        return {
          isLowered: true,
          code: `int(${objectCode}) + (1 if ${objectCode} % 1 > 0 else 0)`,
        };
      case "isEmpty":
        return { isLowered: true, code: `len(${objectCode}) == 0` };
      case "append":
        return { isLowered: false, code: "" };
      case "first":
        return { isLowered: true, code: `${objectCode}[0]` };
      case "last":
        return { isLowered: true, code: `${objectCode}[-1]` };
      case "startsWith":
        return { isLowered: true, code: `${objectCode}.startswith(${argCodes[0] ?? "''"})` };
      case "endsWith":
        return { isLowered: true, code: `${objectCode}.endswith(${argCodes[0] ?? "''"})` };
      case "includes":
      case "contains":
        return { isLowered: true, code: `${argCodes[0] ?? "''"} in ${objectCode}` };
      case "trim":
        return { isLowered: true, code: `${objectCode}.strip()` };
      case "split":
        return { isLowered: true, code: `${objectCode}.split(${argCodes[0] ?? "''"})` };
      case "toString":
        return { isLowered: true, code: `str(${objectCode})` };
      default:
        return { isLowered: false, code: "" };
    }
  }

  if (target === "rust") {
    switch (method) {
      case "slice": {
        const start = argCodes[0] ?? "0";
        const end = argCodes[1] ? `..${argCodes[1]}` : "..";
        return { isLowered: true, code: `${objectCode}[${start}${end}].to_vec()` };
      }
      case "at":
      case "get": {
        const idx = argCodes[0] ?? "0";
        return { isLowered: true, code: `${objectCode}.get(${idx})` };
      }
      case "concat":
        return { isLowered: true, code: `format!("{}{}", ${objectCode}, ${argCodes[0] ?? '""'})` };
      case "toInt":
        return { isLowered: true, code: `${objectCode}.parse::<i64>().unwrap_or(0)` };
      case "floor":
        return { isLowered: true, code: `${objectCode}.floor() as i64` };
      case "round":
        return { isLowered: true, code: `${objectCode}.round() as i64` };
      case "ceil":
        return { isLowered: true, code: `${objectCode}.ceil() as i64` };
      case "isEmpty":
        return { isLowered: true, code: `${objectCode}.is_empty()` };
      case "isOk":
        return { isLowered: true, code: `${objectCode}.is_ok()` };
      case "isErr":
        return { isLowered: true, code: `${objectCode}.is_err()` };
      case "append":
        return {
          isLowered: true,
          code: `{ let mut v = ${objectCode}.clone(); v.push(${argCodes[0] ?? ""}); v }`,
        };
      case "first":
        return { isLowered: true, code: `${objectCode}.first().cloned()` };
      case "last":
        return { isLowered: true, code: `${objectCode}.last().cloned()` };
      case "startsWith":
        return { isLowered: true, code: `${objectCode}.starts_with(${argCodes[0] ?? '""'})` };
      case "endsWith":
        return { isLowered: true, code: `${objectCode}.ends_with(${argCodes[0] ?? '""'})` };
      case "includes":
      case "contains":
        return { isLowered: true, code: `${objectCode}.contains(${argCodes[0] ?? '""'})` };
      case "trim":
        return { isLowered: true, code: `${objectCode}.trim().to_string()` };
      case "split":
        return {
          isLowered: true,
          code: `${objectCode}.split(${argCodes[0] ?? '""'}).map(|s| s.to_string()).collect::<Vec<String>>()`,
        };
      case "toString":
        return { isLowered: true, code: `${objectCode}.to_string()` };
      default:
        return { isLowered: false, code: "" };
    }
  }

  if (target === "go") {
    switch (method) {
      case "slice": {
        const start = argCodes[0] ?? "0";
        const end = argCodes[1] ?? "";
        return { isLowered: true, code: `${objectCode}[${start}:${end}]` };
      }
      case "at":
      case "get": {
        const idx = argCodes[0] ?? "0";
        return { isLowered: true, code: `${objectCode}[${idx}]` };
      }
      case "concat":
        return { isLowered: true, code: `${objectCode} + ${argCodes[0] ?? '""'}` };
      case "toInt":
        return { isLowered: true, code: `strconv.ParseInt(${objectCode}, 10, 64)` };
      case "floor":
        if (objectCode === "math" || objectCode === "Math") {
          return { isLowered: false, code: "" };
        }
        return { isLowered: true, code: `int64(math.Floor(${objectCode}))` };
      case "round":
        if (objectCode === "math" || objectCode === "Math") {
          return { isLowered: false, code: "" };
        }
        return { isLowered: true, code: `int64(math.Round(${objectCode}))` };
      case "ceil":
        if (objectCode === "math" || objectCode === "Math") {
          return { isLowered: false, code: "" };
        }
        return { isLowered: true, code: `int64(math.Ceil(${objectCode}))` };
      case "isEmpty":
        return { isLowered: true, code: `len(${objectCode}) == 0` };
      case "append":
        return { isLowered: true, code: `append(${objectCode}, ${argCodes[0] ?? ""})` };
      case "first":
        return { isLowered: true, code: `${objectCode}[0]` };
      case "last":
        return { isLowered: true, code: `${objectCode}[len(${objectCode})-1]` };
      case "startsWith":
        return {
          isLowered: true,
          code: `strings.HasPrefix(${objectCode}, ${argCodes[0] ?? '""'})`,
        };
      case "endsWith":
        return {
          isLowered: true,
          code: `strings.HasSuffix(${objectCode}, ${argCodes[0] ?? '""'})`,
        };
      case "includes":
      case "contains":
        return { isLowered: true, code: `strings.Contains(${objectCode}, ${argCodes[0] ?? '""'})` };
      case "trim":
        return { isLowered: true, code: `strings.TrimSpace(${objectCode})` };
      case "split":
        return { isLowered: true, code: `strings.Split(${objectCode}, ${argCodes[0] ?? '""'})` };
      case "toString":
        return { isLowered: true, code: `fmt.Sprintf("%v", ${objectCode})` };
      default:
        return { isLowered: false, code: "" };
    }
  }

  if (target === "cpp") {
    switch (method) {
      case "at":
      case "get": {
        const idx = argCodes[0] ?? "0";
        return { isLowered: true, code: `${objectCode}[${idx}]` };
      }
      case "floor":
        if (objectCode === "std" || objectCode === "Math") {
          return { isLowered: false, code: "" };
        }
        return { isLowered: true, code: `std::floor(${objectCode})` };
      case "round":
        if (objectCode === "std" || objectCode === "Math") {
          return { isLowered: false, code: "" };
        }
        return { isLowered: true, code: `std::round(${objectCode})` };
      case "ceil":
        if (objectCode === "std" || objectCode === "Math") {
          return { isLowered: false, code: "" };
        }
        return { isLowered: true, code: `std::ceil(${objectCode})` };
      case "min":
        return { isLowered: true, code: `std::min(${objectCode}, ${argCodes[0] ?? "0"})` };
      case "max":
        return { isLowered: true, code: `std::max(${objectCode}, ${argCodes[0] ?? "0"})` };
      case "clamp":
        return {
          isLowered: true,
          code: `std::clamp(${objectCode}, ${argCodes[0] ?? "0"}, ${argCodes[1] ?? "0"})`,
        };
      case "isEmpty":
        return { isLowered: true, code: `${objectCode}.empty()` };
      case "first":
        return { isLowered: true, code: `${objectCode}.front()` };
      case "last":
        return { isLowered: true, code: `${objectCode}.back()` };
      case "push":
      case "append":
        return { isLowered: true, code: `${objectCode}.push_back(${argCodes[0] ?? ""})` };
      case "pop":
        return { isLowered: true, code: `${objectCode}.pop_back()` };
      case "toInt":
        return { isLowered: true, code: `static_cast<int>(${objectCode})` };
      case "toFloat":
        return { isLowered: true, code: `static_cast<float>(${objectCode})` };
      default:
        return { isLowered: false, code: "" };
    }
  }

  // TypeScript / JavaScript Lowering
  switch (method) {
    case "slice":
      return {
        isLowered: true,
        code: `${objectCode}.slice(${argCodes.join(", ")})`,
      };
    case "at":
      return {
        isLowered: true,
        code: `${objectCode}.at(${argCodes[0] ?? "0"})`,
      };
    case "concat":
      return {
        isLowered: true,
        code: `${objectCode} + ${argCodes[0] ?? "''"}`,
      };
    case "toInt":
      return {
        isLowered: true,
        code: `Number.parseInt(${objectCode}, 10)`,
      };
    case "floor":
      if (objectCode === "Math") {
        return { isLowered: false, code: "" };
      }
      return {
        isLowered: true,
        code: `Math.floor(${objectCode})`,
      };
    case "round":
      if (objectCode === "Math") {
        return { isLowered: false, code: "" };
      }
      return {
        isLowered: true,
        code: `Math.round(${objectCode})`,
      };
    case "ceil":
      if (objectCode === "Math") {
        return { isLowered: false, code: "" };
      }
      return {
        isLowered: true,
        code: `Math.ceil(${objectCode})`,
      };
    case "isEmpty":
      return {
        isLowered: true,
        code: `${objectCode}.length === 0`,
      };
    case "append":
      return {
        isLowered: true,
        code: `[...${objectCode}, ${argCodes[0] ?? ""}]`,
      };
    case "first":
      return {
        isLowered: true,
        code: `(${objectCode}[0] ?? null)`,
      };
    case "last":
      return {
        isLowered: true,
        code: `(${objectCode}.at(-1) ?? null)`,
      };
    case "contains":
      return {
        isLowered: true,
        code: `${objectCode}.includes(${argCodes.join(", ")})`,
      };
    case "startsWith":
      return {
        isLowered: true,
        code: `${objectCode}.startsWith(${argCodes[0] ?? "''"})`,
      };
    case "endsWith":
      return {
        isLowered: true,
        code: `${objectCode}.endsWith(${argCodes[0] ?? "''"})`,
      };
    case "trim":
      return {
        isLowered: true,
        code: `${objectCode}.trim()`,
      };
    case "split":
      return {
        isLowered: true,
        code: `${objectCode}.split(${argCodes[0] ?? "''"})`,
      };
    case "toString":
      return {
        isLowered: true,
        code: `${objectCode}.toString()`,
      };
    default:
      return { isLowered: false, code: "" };
  }
}

/**
 * Lowers algebraic constructors (Ok, Err, Some).
 */
export function lowerConstructor(
  name: string,
  argCodes: string[],
  target: TargetLanguage,
): LoweredOperation {
  if (name === "Ok") {
    const val = argCodes[0] ?? "()";
    if (target === "rust") {
      return { isLowered: true, code: `Ok(${val})` };
    }
    if (target === "go") {
      return { isLowered: true, code: `${val}, nil` };
    }
    if (target === "python") {
      return { isLowered: true, code: `{"ok": True, "value": ${val}}` };
    }
    return { isLowered: true, code: `{ ok: true, value: ${val} }` };
  }

  if (name === "Err") {
    const err = argCodes[0] ?? "()";
    if (target === "rust") {
      return { isLowered: true, code: `Err(${err})` };
    }
    if (target === "go") {
      return { isLowered: true, code: `fmt.Errorf("%v", ${err})` };
    }
    if (target === "python") {
      return { isLowered: true, code: `{"ok": False, "error": ${err}}` };
    }
    return { isLowered: true, code: `{ ok: false, error: ${err} }` };
  }

  if (name === "Some") {
    if (target === "rust") {
      return { isLowered: true, code: `Some(${argCodes[0] ?? "()"})` };
    }
    if (target === "go") {
      return { isLowered: true, code: `&${argCodes[0] ?? ""}` };
    }
    return { isLowered: true, code: argCodes[0] ?? "null" };
  }

  if (name === "None") {
    if (target === "rust") {
      return { isLowered: true, code: "None" };
    }
    if (target === "go") {
      return { isLowered: true, code: "nil" };
    }
    if (target === "python") {
      return { isLowered: true, code: "None" };
    }
    return { isLowered: true, code: "null" };
  }

  return { isLowered: false, code: "" };
}
