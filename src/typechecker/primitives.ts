/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canonical Standard Library (CSL) primitive types and signature registry.
 * Conforms to Section 2 of docs/AICE_SPEC.md.
 */

import {
  isStringLiteralType,
  makeArrayType,
  makeFunctionType,
  makeNamedType,
  makeOptionType,
  makeRecordType,
  makeResultType,
  TYPE_BOOL,
  TYPE_FLOAT,
  TYPE_INT,
  TYPE_NEVER,
  TYPE_NUM,
  TYPE_STR,
  TYPE_UNKNOWN,
  TYPE_VOID,
  type Type,
} from "./types.js";

/**
 * Returns the member property type (e.g. str.len -> int, list.len -> int).
 */
export function getPropertyType(receiver: Type, prop: string): Type | null {
  if (
    receiver.kind === "str" ||
    (receiver.kind === "named" && isStringLiteralType(receiver.name))
  ) {
    if (prop === "len" || prop === "length") return TYPE_INT;
  }

  if (receiver.kind === "array") {
    if (prop === "len" || prop === "length") return TYPE_INT;
    const m = getMethodType(receiver, prop);
    if (m) return m;
  }

  if (receiver.kind === "tuple") {
    if (prop === "len" || prop === "length") return TYPE_INT;
  }

  if (receiver.kind === "record") {
    const getter = receiver.fields.get(`get_${prop}`);
    if (getter && getter.kind === "function") {
      return getter.returnType;
    }
    const direct = receiver.fields.get(prop);
    if (direct) {
      const setter = receiver.fields.get(`set_${prop}`);
      if (setter && direct === setter && setter.kind === "function") {
        return setter.params[0]?.type ?? TYPE_UNKNOWN;
      }
      return direct;
    }
    return null;
  }

  if (receiver.kind === "named") {
    if (
      receiver.name === "Buffer" ||
      receiver.name === "Uint8Array" ||
      receiver.name.endsWith("Array")
    ) {
      if (
        prop === "len" ||
        prop === "length" ||
        prop === "byteLength" ||
        prop === "byteOffset" ||
        prop === "BYTES_PER_ELEMENT"
      ) {
        return TYPE_INT;
      }
    }
  }

  if (receiver.kind === "named" || receiver.kind === "unknown" || receiver.kind === "function") {
    return TYPE_UNKNOWN;
  }

  return null;
}

/**
 * Returns the canonical method type for a receiver and method name.
 */
export function getMethodType(receiver: Type, method: string): Type | null {
  // String Canonical Methods
  if (
    receiver.kind === "str" ||
    (receiver.kind === "named" && isStringLiteralType(receiver.name))
  ) {
    switch (method) {
      case "slice":
        return makeFunctionType(
          [
            { name: "start", type: TYPE_INT },
            { name: "end", type: TYPE_INT, optional: true },
          ],
          TYPE_STR,
        );
      case "at":
        return makeFunctionType([{ name: "index", type: TYPE_INT }], makeOptionType(TYPE_STR));
      case "concat":
        return makeFunctionType([{ name: "other", type: TYPE_STR }], TYPE_STR);
      case "toInt":
        return makeFunctionType([], makeResultType(TYPE_INT, TYPE_STR));
      case "trim":
        return makeFunctionType([], TYPE_STR);
      case "split":
        return makeFunctionType([{ name: "delim", type: TYPE_STR }], makeArrayType(TYPE_STR));
      case "startsWith":
        return makeFunctionType([{ name: "prefix", type: TYPE_STR }], TYPE_BOOL);
      case "endsWith":
        return makeFunctionType([{ name: "suffix", type: TYPE_STR }], TYPE_BOOL);
      case "includes":
      case "contains":
        return makeFunctionType([{ name: "substr", type: TYPE_STR }], TYPE_BOOL);
      case "isEmpty":
        return makeFunctionType([], TYPE_BOOL);
      case "toLowerCase":
      case "toUpperCase":
        return makeFunctionType([], TYPE_STR);
      case "replace":
        return makeFunctionType(
          [
            { name: "target", type: TYPE_STR },
            { name: "replacement", type: TYPE_STR },
          ],
          TYPE_STR,
        );
      case "padStart":
      case "padEnd":
        return makeFunctionType(
          [
            { name: "targetLength", type: TYPE_INT },
            { name: "padString", type: TYPE_STR, optional: true },
          ],
          TYPE_STR,
        );
      case "charCodeAt":
        return makeFunctionType([{ name: "index", type: TYPE_INT }], TYPE_INT);
      case "charAt":
        return makeFunctionType([{ name: "index", type: TYPE_INT }], TYPE_STR);
      case "indexOf":
      case "lastIndexOf":
        return makeFunctionType(
          [
            { name: "searchString", type: TYPE_STR },
            { name: "position", type: TYPE_INT, optional: true },
          ],
          TYPE_INT,
        );
      case "match":
        return makeFunctionType([{ name: "matcher", type: TYPE_UNKNOWN }], TYPE_UNKNOWN);
      case "search":
        return makeFunctionType([{ name: "matcher", type: TYPE_UNKNOWN }], TYPE_INT);
      case "repeat":
        return makeFunctionType([{ name: "count", type: TYPE_INT }], TYPE_STR);
      case "substring":
        return makeFunctionType(
          [
            { name: "start", type: TYPE_INT },
            { name: "end", type: TYPE_INT, optional: true },
          ],
          TYPE_STR,
        );
      case "replaceAll":
        return makeFunctionType(
          [
            { name: "searchValue", type: TYPE_STR },
            { name: "replaceValue", type: TYPE_STR },
          ],
          TYPE_STR,
        );
      case "toLocaleString":
      case "toString":
        return makeFunctionType([], TYPE_STR);
      default:
        return null;
    }
  }

  // Array / List Canonical Methods
  if (receiver.kind === "array") {
    const elemType = receiver.elementType;
    switch (method) {
      case "get":
        return makeFunctionType([{ name: "index", type: TYPE_INT }], makeOptionType(elemType));
      case "at":
        return makeFunctionType([{ name: "index", type: TYPE_INT }], makeOptionType(elemType));
      case "slice":
        return makeFunctionType(
          [
            { name: "start", type: TYPE_INT },
            { name: "end", type: TYPE_INT, optional: true },
          ],
          receiver,
        );
      case "append":
        return makeFunctionType([{ name: "item", type: elemType }], receiver);
      case "push":
        return makeFunctionType([{ name: "item", type: elemType, rest: true }], TYPE_INT);
      case "pop":
        return makeFunctionType([], makeOptionType(elemType));
      case "shift":
        return makeFunctionType([], makeOptionType(elemType));
      case "unshift":
        return makeFunctionType([{ name: "item", type: elemType, rest: true }], TYPE_INT);
      case "clear":
        return makeFunctionType([], TYPE_VOID);
      case "indexOf":
        return makeFunctionType([{ name: "item", type: elemType }], TYPE_INT);
      case "includes":
      case "contains":
        return makeFunctionType([{ name: "item", type: elemType }], TYPE_BOOL);
      case "filter":
        return makeFunctionType(
          [
            {
              name: "predicate",
              type: makeFunctionType(
                [
                  { name: "item", type: elemType },
                  { name: "index", type: TYPE_INT, optional: true },
                  { name: "array", type: receiver, optional: true },
                ],
                TYPE_BOOL,
              ),
            },
          ],
          receiver,
        );
      case "map":
        return makeFunctionType(
          [
            {
              name: "transform",
              type: makeFunctionType(
                [
                  { name: "item", type: elemType },
                  { name: "index", type: TYPE_INT, optional: true },
                  { name: "array", type: receiver, optional: true },
                ],
                TYPE_UNKNOWN,
              ),
            },
          ],
          makeArrayType(TYPE_UNKNOWN),
        );
      case "forEach":
        return makeFunctionType(
          [
            {
              name: "callback",
              type: makeFunctionType(
                [
                  { name: "item", type: elemType },
                  { name: "index", type: TYPE_INT, optional: true },
                  { name: "array", type: receiver, optional: true },
                ],
                TYPE_VOID,
              ),
            },
          ],
          TYPE_VOID,
        );
      case "some":
        return makeFunctionType(
          [
            {
              name: "predicate",
              type: makeFunctionType(
                [
                  { name: "item", type: elemType },
                  { name: "index", type: TYPE_INT, optional: true },
                  { name: "array", type: receiver, optional: true },
                ],
                TYPE_BOOL,
              ),
            },
          ],
          TYPE_BOOL,
        );
      case "every":
        return makeFunctionType(
          [
            {
              name: "predicate",
              type: makeFunctionType(
                [
                  { name: "item", type: elemType },
                  { name: "index", type: TYPE_INT, optional: true },
                  { name: "array", type: receiver, optional: true },
                ],
                TYPE_BOOL,
              ),
            },
          ],
          TYPE_BOOL,
        );
      case "find":
        return makeFunctionType(
          [
            {
              name: "predicate",
              type: makeFunctionType(
                [
                  { name: "item", type: elemType },
                  { name: "index", type: TYPE_INT, optional: true },
                  { name: "array", type: receiver, optional: true },
                ],
                TYPE_BOOL,
              ),
            },
          ],
          makeOptionType(elemType),
        );
      case "findLast":
        return makeFunctionType(
          [
            {
              name: "predicate",
              type: makeFunctionType(
                [
                  { name: "item", type: elemType },
                  { name: "index", type: TYPE_INT, optional: true },
                  { name: "array", type: receiver, optional: true },
                ],
                TYPE_BOOL,
              ),
            },
          ],
          makeOptionType(elemType),
        );
      case "findIndex":
      case "findLastIndex":
        return makeFunctionType(
          [
            {
              name: "predicate",
              type: makeFunctionType(
                [
                  { name: "item", type: elemType },
                  { name: "index", type: TYPE_INT, optional: true },
                  { name: "array", type: receiver, optional: true },
                ],
                TYPE_BOOL,
              ),
            },
          ],
          TYPE_INT,
        );
      case "reduce":
        return makeFunctionType(
          [
            {
              name: "callback",
              type: makeFunctionType(
                [
                  { name: "acc", type: TYPE_UNKNOWN },
                  { name: "item", type: elemType },
                  { name: "index", type: TYPE_INT, optional: true },
                  { name: "array", type: receiver, optional: true },
                ],
                TYPE_UNKNOWN,
              ),
            },
            { name: "initialValue", type: TYPE_UNKNOWN, optional: true },
          ],
          TYPE_UNKNOWN,
        );
      case "reduceRight":
        return makeFunctionType(
          [
            {
              name: "callback",
              type: makeFunctionType(
                [
                  { name: "acc", type: TYPE_UNKNOWN },
                  { name: "item", type: elemType },
                  { name: "index", type: TYPE_INT, optional: true },
                  { name: "array", type: receiver, optional: true },
                ],
                TYPE_UNKNOWN,
              ),
            },
            { name: "initialValue", type: TYPE_UNKNOWN, optional: true },
          ],
          TYPE_UNKNOWN,
        );
      case "flat":
        return makeFunctionType(
          [{ name: "depth", type: TYPE_INT, optional: true }],
          makeArrayType(TYPE_UNKNOWN),
        );
      case "flatMap":
        return makeFunctionType(
          [
            {
              name: "callback",
              type: makeFunctionType(
                [
                  { name: "item", type: elemType },
                  { name: "index", type: TYPE_INT, optional: true },
                  { name: "array", type: receiver, optional: true },
                ],
                TYPE_UNKNOWN,
              ),
            },
          ],
          makeArrayType(TYPE_UNKNOWN),
        );
      case "entries":
        return makeFunctionType([], TYPE_UNKNOWN);
      case "keys":
        return makeFunctionType([], makeArrayType(TYPE_INT));
      case "values":
        return makeFunctionType([], receiver);
      case "fill":
        return makeFunctionType(
          [
            { name: "value", type: elemType },
            { name: "start", type: TYPE_INT, optional: true },
            { name: "end", type: TYPE_INT, optional: true },
          ],
          receiver,
        );
      case "copyWithin":
        return makeFunctionType(
          [
            { name: "target", type: TYPE_INT },
            { name: "start", type: TYPE_INT },
            { name: "end", type: TYPE_INT, optional: true },
          ],
          receiver,
        );
      case "toLocaleString":
      case "toString":
        return makeFunctionType([], TYPE_STR);
      case "splice":
        return makeFunctionType(
          [
            { name: "start", type: TYPE_INT },
            { name: "deleteCount", type: TYPE_INT, optional: true },
            { name: "item1", type: elemType, optional: true },
            { name: "item2", type: elemType, optional: true },
            { name: "item3", type: elemType, optional: true },
            { name: "item4", type: elemType, optional: true },
          ],
          receiver,
        );
      case "concat":
        return makeFunctionType([{ name: "other", type: receiver }], receiver);
      case "reverse":
        return makeFunctionType([], receiver);
      case "sort":
        return makeFunctionType(
          [{ name: "compareFn", type: TYPE_UNKNOWN, optional: true }],
          receiver,
        );
      case "isEmpty":
        return makeFunctionType([], TYPE_BOOL);
      case "first":
        return makeFunctionType([], makeOptionType(elemType));
      case "last":
        return makeFunctionType([], makeOptionType(elemType));
      case "join":
        return makeFunctionType([{ name: "sep", type: TYPE_STR }], TYPE_STR);
      default:
        return null;
    }
  }

  // Primitive Types Canonical Methods (int, float, num, bool)
  if (
    receiver.kind === "int" ||
    receiver.kind === "float" ||
    receiver.kind === "num" ||
    receiver.kind === "bool"
  ) {
    if (method === "toString") {
      return makeFunctionType([], TYPE_STR);
    }
  }

  if (receiver.kind === "int" || receiver.kind === "float" || receiver.kind === "num") {
    if (method === "toLocaleString") {
      return makeFunctionType(
        [
          { name: "locales", type: TYPE_UNKNOWN, optional: true },
          { name: "options", type: TYPE_UNKNOWN, optional: true },
        ],
        TYPE_STR,
      );
    }
    if (method === "toFixed") {
      return makeFunctionType([{ name: "digits", type: TYPE_INT, optional: true }], TYPE_STR);
    }
    if (method === "toPrecision") {
      return makeFunctionType([{ name: "precision", type: TYPE_INT, optional: true }], TYPE_STR);
    }
    if (method === "toExponential") {
      return makeFunctionType(
        [{ name: "fractionDigits", type: TYPE_INT, optional: true }],
        TYPE_STR,
      );
    }
    if (method === "toInt" || method === "round" || method === "floor" || method === "ceil") {
      return makeFunctionType([], TYPE_INT);
    }
    if (method === "toFloat") {
      return makeFunctionType([], TYPE_FLOAT);
    }
  }

  // Record methods
  if (receiver.kind === "record") {
    const field = receiver.fields.get(method);
    if (field && field.kind === "function") {
      return field;
    }
  }

  // Date instance methods
  if (receiver.kind === "named" && receiver.name === "Date") {
    switch (method) {
      case "getTime":
      case "getFullYear":
      case "getMonth":
      case "getDate":
      case "getDay":
      case "getHours":
      case "getMinutes":
      case "getSeconds":
      case "getMilliseconds":
        return makeFunctionType([], TYPE_INT);
      case "toISOString":
      case "toString":
      case "toDateString":
      case "toTimeString":
      case "toLocaleDateString":
      case "toLocaleTimeString":
      case "toLocaleString":
      case "toJSON":
        return makeFunctionType([], TYPE_STR);
    }
  }

  // Buffer instance methods
  if (receiver.kind === "named" && receiver.name === "Buffer") {
    switch (method) {
      case "toString":
        return makeFunctionType([{ name: "encoding", type: TYPE_STR, optional: true }], TYPE_STR);
      case "slice":
      case "subarray":
        return makeFunctionType(
          [
            { name: "start", type: TYPE_INT, optional: true },
            { name: "end", type: TYPE_INT, optional: true },
          ],
          receiver,
        );
    }
  }

  return null;
}

// Helpers for variadic and constructor types
function makeVariadicFn(returnType: Type): Type {
  return makeFunctionType(
    [
      { name: "a", type: TYPE_UNKNOWN, optional: true },
      { name: "b", type: TYPE_UNKNOWN, optional: true },
      { name: "c", type: TYPE_UNKNOWN, optional: true },
      { name: "d", type: TYPE_UNKNOWN, optional: true },
      { name: "e", type: TYPE_UNKNOWN, optional: true },
      { name: "f", type: TYPE_UNKNOWN, optional: true },
      { name: "g", type: TYPE_UNKNOWN, optional: true },
      { name: "h", type: TYPE_UNKNOWN, optional: true },
    ],
    returnType,
  );
}

function makeTypedArrayConstructor(name: string): Type {
  return makeFunctionType(
    [
      { name: "arg1", type: TYPE_UNKNOWN, optional: true },
      { name: "arg2", type: TYPE_UNKNOWN, optional: true },
      { name: "arg3", type: TYPE_UNKNOWN, optional: true },
    ],
    makeNamedType(name),
  );
}

const TEXT_ENCODER_INSTANCE = makeRecordType(
  new Map([
    [
      "encode",
      makeFunctionType(
        [{ name: "input", type: TYPE_STR, optional: true }],
        makeNamedType("Uint8Array"),
      ),
    ],
    [
      "encodeInto",
      makeFunctionType(
        [
          { name: "source", type: TYPE_STR },
          { name: "destination", type: TYPE_UNKNOWN },
        ],
        TYPE_UNKNOWN,
      ),
    ],
  ]),
  "TextEncoder",
);

const TEXT_DECODER_INSTANCE = makeRecordType(
  new Map([
    [
      "decode",
      makeFunctionType(
        [
          { name: "input", type: TYPE_UNKNOWN, optional: true },
          { name: "options", type: TYPE_UNKNOWN, optional: true },
        ],
        TYPE_STR,
      ),
    ],
  ]),
  "TextDecoder",
);

const BUFFER_SYMBOL = makeRecordType(
  new Map([
    [
      "from",
      makeFunctionType(
        [
          { name: "data", type: TYPE_UNKNOWN, optional: true },
          { name: "encodingOrOffset", type: TYPE_UNKNOWN, optional: true },
          { name: "length", type: TYPE_INT, optional: true },
        ],
        makeNamedType("Buffer"),
      ),
    ],
    [
      "alloc",
      makeFunctionType(
        [
          { name: "size", type: TYPE_INT, optional: true },
          { name: "fill", type: TYPE_UNKNOWN, optional: true },
          { name: "encoding", type: TYPE_STR, optional: true },
        ],
        makeNamedType("Buffer"),
      ),
    ],
    [
      "isBuffer",
      makeFunctionType([{ name: "obj", type: TYPE_UNKNOWN, optional: true }], TYPE_BOOL),
    ],
    [
      "byteLength",
      makeFunctionType(
        [
          { name: "string", type: TYPE_UNKNOWN, optional: true },
          { name: "encoding", type: TYPE_STR, optional: true },
        ],
        TYPE_INT,
      ),
    ],
  ]),
  "Buffer",
);

const DATE_SYMBOL = makeRecordType(
  new Map([
    ["now", makeFunctionType([], TYPE_INT)],
    ["parse", makeFunctionType([{ name: "s", type: TYPE_STR, optional: true }], TYPE_INT)],
    [
      "UTC",
      makeFunctionType(
        [
          { name: "year", type: TYPE_INT },
          { name: "month", type: TYPE_INT, optional: true },
          { name: "date", type: TYPE_INT, optional: true },
        ],
        TYPE_INT,
      ),
    ],
  ]),
  "Date",
);

const JSON_SYMBOL = makeRecordType(
  new Map([
    ["parse", makeFunctionType([{ name: "text", type: TYPE_STR, optional: true }], TYPE_UNKNOWN)],
    [
      "stringify",
      makeFunctionType(
        [
          { name: "value", type: TYPE_UNKNOWN, optional: true },
          { name: "replacer", type: TYPE_UNKNOWN, optional: true },
          { name: "space", type: TYPE_UNKNOWN, optional: true },
        ],
        TYPE_STR,
      ),
    ],
  ]),
  "JSON",
);

const MATH_SYMBOL = makeRecordType(
  new Map<string, Type>([
    ["floor", makeFunctionType([{ name: "n", type: TYPE_UNKNOWN, optional: true }], TYPE_INT)],
    ["ceil", makeFunctionType([{ name: "n", type: TYPE_UNKNOWN, optional: true }], TYPE_INT)],
    ["round", makeFunctionType([{ name: "n", type: TYPE_UNKNOWN, optional: true }], TYPE_INT)],
    ["abs", makeFunctionType([{ name: "n", type: TYPE_UNKNOWN, optional: true }], TYPE_NUM)],
    [
      "min",
      makeFunctionType(
        [
          { name: "a", type: TYPE_UNKNOWN, optional: true },
          { name: "b", type: TYPE_UNKNOWN, optional: true },
          { name: "c", type: TYPE_UNKNOWN, optional: true },
          { name: "d", type: TYPE_UNKNOWN, optional: true },
          { name: "e", type: TYPE_UNKNOWN, optional: true },
          { name: "f", type: TYPE_UNKNOWN, optional: true },
        ],
        TYPE_NUM,
      ),
    ],
    [
      "max",
      makeFunctionType(
        [
          { name: "a", type: TYPE_UNKNOWN, optional: true },
          { name: "b", type: TYPE_UNKNOWN, optional: true },
          { name: "c", type: TYPE_UNKNOWN, optional: true },
          { name: "d", type: TYPE_UNKNOWN, optional: true },
          { name: "e", type: TYPE_UNKNOWN, optional: true },
          { name: "f", type: TYPE_UNKNOWN, optional: true },
        ],
        TYPE_NUM,
      ),
    ],
    [
      "clamp",
      makeFunctionType(
        [
          { name: "val", type: TYPE_UNKNOWN },
          { name: "min", type: TYPE_UNKNOWN },
          { name: "max", type: TYPE_UNKNOWN },
        ],
        TYPE_NUM,
      ),
    ],
    ["sqrt", makeFunctionType([{ name: "n", type: TYPE_UNKNOWN, optional: true }], TYPE_FLOAT)],
    [
      "pow",
      makeFunctionType(
        [
          { name: "base", type: TYPE_UNKNOWN, optional: true },
          { name: "exp", type: TYPE_UNKNOWN, optional: true },
        ],
        TYPE_FLOAT,
      ),
    ],
    ["sin", makeFunctionType([{ name: "rad", type: TYPE_UNKNOWN, optional: true }], TYPE_FLOAT)],
    ["cos", makeFunctionType([{ name: "rad", type: TYPE_UNKNOWN, optional: true }], TYPE_FLOAT)],
    ["tan", makeFunctionType([{ name: "rad", type: TYPE_UNKNOWN, optional: true }], TYPE_FLOAT)],
    [
      "atan2",
      makeFunctionType(
        [
          { name: "y", type: TYPE_UNKNOWN, optional: true },
          { name: "x", type: TYPE_UNKNOWN, optional: true },
        ],
        TYPE_FLOAT,
      ),
    ],
    ["asin", makeFunctionType([{ name: "n", type: TYPE_UNKNOWN, optional: true }], TYPE_FLOAT)],
    ["acos", makeFunctionType([{ name: "n", type: TYPE_UNKNOWN, optional: true }], TYPE_FLOAT)],
    ["atan", makeFunctionType([{ name: "n", type: TYPE_UNKNOWN, optional: true }], TYPE_FLOAT)],
    ["sinh", makeFunctionType([{ name: "rad", type: TYPE_NUM }], TYPE_FLOAT)],
    ["cosh", makeFunctionType([{ name: "rad", type: TYPE_NUM }], TYPE_FLOAT)],
    ["tanh", makeFunctionType([{ name: "rad", type: TYPE_NUM }], TYPE_FLOAT)],
    ["asinh", makeFunctionType([{ name: "n", type: TYPE_NUM }], TYPE_FLOAT)],
    ["acosh", makeFunctionType([{ name: "n", type: TYPE_NUM }], TYPE_FLOAT)],
    ["atanh", makeFunctionType([{ name: "n", type: TYPE_NUM }], TYPE_FLOAT)],
    [
      "hypot",
      makeFunctionType(
        [
          { name: "a", type: TYPE_UNKNOWN, optional: true },
          { name: "b", type: TYPE_UNKNOWN, optional: true },
          { name: "c", type: TYPE_UNKNOWN, optional: true },
          { name: "d", type: TYPE_UNKNOWN, optional: true },
        ],
        TYPE_FLOAT,
      ),
    ],
    ["random", makeFunctionType([], TYPE_FLOAT)],
    ["sign", makeFunctionType([{ name: "n", type: TYPE_NUM }], TYPE_NUM)],
    ["trunc", makeFunctionType([{ name: "n", type: TYPE_NUM }], TYPE_INT)],
    [
      "imul",
      makeFunctionType(
        [
          { name: "a", type: TYPE_INT },
          { name: "b", type: TYPE_INT },
        ],
        TYPE_INT,
      ),
    ],
    ["clz32", makeFunctionType([{ name: "n", type: TYPE_INT }], TYPE_INT)],
    ["fround", makeFunctionType([{ name: "n", type: TYPE_NUM }], TYPE_FLOAT)],
    ["cbrt", makeFunctionType([{ name: "n", type: TYPE_NUM }], TYPE_FLOAT)],
    ["exp", makeFunctionType([{ name: "n", type: TYPE_UNKNOWN, optional: true }], TYPE_FLOAT)],
    ["expm1", makeFunctionType([{ name: "n", type: TYPE_NUM }], TYPE_FLOAT)],
    ["log", makeFunctionType([{ name: "n", type: TYPE_UNKNOWN, optional: true }], TYPE_FLOAT)],
    ["log1p", makeFunctionType([{ name: "n", type: TYPE_NUM }], TYPE_FLOAT)],
    ["log2", makeFunctionType([{ name: "n", type: TYPE_UNKNOWN, optional: true }], TYPE_FLOAT)],
    ["log10", makeFunctionType([{ name: "n", type: TYPE_UNKNOWN, optional: true }], TYPE_FLOAT)],
    ["PI", TYPE_FLOAT],
    ["E", TYPE_FLOAT],
    ["LN2", TYPE_FLOAT],
    ["LN10", TYPE_FLOAT],
    ["LOG2E", TYPE_FLOAT],
    ["LOG10E", TYPE_FLOAT],
    ["SQRT1_2", TYPE_FLOAT],
    ["SQRT2", TYPE_FLOAT],
  ]),
  "Math",
);

const CONSOLE_SYMBOL = makeRecordType(
  new Map([
    ["log", makeVariadicFn(TYPE_VOID)],
    ["error", makeVariadicFn(TYPE_VOID)],
    ["warn", makeVariadicFn(TYPE_VOID)],
    ["info", makeVariadicFn(TYPE_VOID)],
    ["debug", makeVariadicFn(TYPE_VOID)],
    ["trace", makeVariadicFn(TYPE_VOID)],
    ["table", makeVariadicFn(TYPE_VOID)],
    ["dir", makeVariadicFn(TYPE_VOID)],
    ["assert", makeVariadicFn(TYPE_VOID)],
    ["clear", makeVariadicFn(TYPE_VOID)],
    ["time", makeFunctionType([{ name: "label", type: TYPE_STR, optional: true }], TYPE_VOID)],
    ["timeEnd", makeFunctionType([{ name: "label", type: TYPE_STR, optional: true }], TYPE_VOID)],
  ]),
  "console",
);

const PROMISE_SYMBOL = makeRecordType(
  new Map([
    [
      "resolve",
      makeFunctionType(
        [{ name: "val", type: TYPE_UNKNOWN, optional: true }],
        makeNamedType("Promise", [TYPE_UNKNOWN]),
      ),
    ],
    [
      "reject",
      makeFunctionType(
        [{ name: "reason", type: TYPE_UNKNOWN, optional: true }],
        makeNamedType("Promise", [TYPE_NEVER]),
      ),
    ],
    [
      "all",
      makeFunctionType(
        [{ name: "values", type: TYPE_UNKNOWN, optional: true }],
        makeNamedType("Promise", [makeArrayType(TYPE_UNKNOWN)]),
      ),
    ],
    [
      "allSettled",
      makeFunctionType(
        [{ name: "values", type: TYPE_UNKNOWN, optional: true }],
        makeNamedType("Promise", [makeArrayType(TYPE_UNKNOWN)]),
      ),
    ],
    [
      "race",
      makeFunctionType(
        [{ name: "values", type: TYPE_UNKNOWN, optional: true }],
        makeNamedType("Promise", [TYPE_UNKNOWN]),
      ),
    ],
    [
      "any",
      makeFunctionType(
        [{ name: "values", type: TYPE_UNKNOWN, optional: true }],
        makeNamedType("Promise", [TYPE_UNKNOWN]),
      ),
    ],
  ]),
  "Promise",
);

const ARRAY_SYMBOL = makeRecordType(
  new Map([
    [
      "from",
      makeFunctionType(
        [
          { name: "items", type: TYPE_UNKNOWN, optional: true },
          { name: "mapFn", type: TYPE_UNKNOWN, optional: true },
        ],
        makeArrayType(TYPE_UNKNOWN),
      ),
    ],
    ["isArray", makeFunctionType([{ name: "val", type: TYPE_UNKNOWN, optional: true }], TYPE_BOOL)],
    [
      "of",
      makeFunctionType(
        [
          { name: "a", type: TYPE_UNKNOWN, optional: true },
          { name: "b", type: TYPE_UNKNOWN, optional: true },
          { name: "c", type: TYPE_UNKNOWN, optional: true },
          { name: "d", type: TYPE_UNKNOWN, optional: true },
        ],
        makeArrayType(TYPE_UNKNOWN),
      ),
    ],
  ]),
  "Array",
);

const OBJECT_SYMBOL = makeRecordType(
  new Map([
    [
      "keys",
      makeFunctionType(
        [{ name: "obj", type: TYPE_UNKNOWN, optional: true }],
        makeArrayType(TYPE_STR),
      ),
    ],
    [
      "values",
      makeFunctionType(
        [{ name: "obj", type: TYPE_UNKNOWN, optional: true }],
        makeArrayType(TYPE_UNKNOWN),
      ),
    ],
    [
      "entries",
      makeFunctionType(
        [{ name: "obj", type: TYPE_UNKNOWN, optional: true }],
        makeArrayType(TYPE_UNKNOWN),
      ),
    ],
    [
      "assign",
      makeFunctionType(
        [
          { name: "target", type: TYPE_UNKNOWN, optional: true },
          { name: "source1", type: TYPE_UNKNOWN, optional: true },
          { name: "source2", type: TYPE_UNKNOWN, optional: true },
          { name: "source3", type: TYPE_UNKNOWN, optional: true },
        ],
        TYPE_UNKNOWN,
      ),
    ],
    [
      "freeze",
      makeFunctionType([{ name: "obj", type: TYPE_UNKNOWN, optional: true }], TYPE_UNKNOWN),
    ],
  ]),
  "Object",
);

/**
 * Built-in global symbols and constructors (Ok, Err, Some, log, etc.).
 */
export const GLOBAL_SYMBOLS: Readonly<Record<string, Type>> = {
  print: makeFunctionType([{ name: "val", type: TYPE_UNKNOWN }], TYPE_VOID),
  log: makeFunctionType([{ name: "val", type: TYPE_UNKNOWN }], TYPE_VOID),
  int: makeFunctionType([{ name: "val", type: TYPE_UNKNOWN }], TYPE_INT),
  float: makeFunctionType([{ name: "val", type: TYPE_UNKNOWN }], TYPE_FLOAT),
  str: makeFunctionType([{ name: "val", type: TYPE_UNKNOWN }], TYPE_STR),
  bool: makeFunctionType([{ name: "val", type: TYPE_UNKNOWN }], TYPE_BOOL),
  len: makeFunctionType([{ name: "val", type: TYPE_UNKNOWN }], TYPE_INT),
  abs: makeFunctionType([{ name: "n", type: TYPE_UNKNOWN }], TYPE_NUM),
  min: makeFunctionType(
    [
      { name: "a", type: TYPE_UNKNOWN },
      { name: "b", type: TYPE_UNKNOWN, optional: true },
      { name: "c", type: TYPE_UNKNOWN, optional: true },
      { name: "d", type: TYPE_UNKNOWN, optional: true },
      { name: "e", type: TYPE_UNKNOWN, optional: true },
      { name: "f", type: TYPE_UNKNOWN, optional: true },
    ],
    TYPE_NUM,
  ),
  max: makeFunctionType(
    [
      { name: "a", type: TYPE_UNKNOWN },
      { name: "b", type: TYPE_UNKNOWN, optional: true },
      { name: "c", type: TYPE_UNKNOWN, optional: true },
      { name: "d", type: TYPE_UNKNOWN, optional: true },
      { name: "e", type: TYPE_UNKNOWN, optional: true },
      { name: "f", type: TYPE_UNKNOWN, optional: true },
    ],
    TYPE_NUM,
  ),
  clamp: makeFunctionType(
    [
      { name: "val", type: TYPE_UNKNOWN },
      { name: "min", type: TYPE_UNKNOWN },
      { name: "max", type: TYPE_UNKNOWN },
    ],
    TYPE_NUM,
  ),
  sqrt: makeFunctionType([{ name: "n", type: TYPE_UNKNOWN }], TYPE_FLOAT),
  pow: makeFunctionType(
    [
      { name: "base", type: TYPE_UNKNOWN },
      { name: "exp", type: TYPE_UNKNOWN },
    ],
    TYPE_FLOAT,
  ),
  floor: makeFunctionType([{ name: "n", type: TYPE_UNKNOWN }], TYPE_INT),
  ceil: makeFunctionType([{ name: "n", type: TYPE_UNKNOWN }], TYPE_INT),
  round: makeFunctionType([{ name: "n", type: TYPE_UNKNOWN }], TYPE_INT),
  sin: makeFunctionType([{ name: "rad", type: TYPE_UNKNOWN }], TYPE_FLOAT),
  cos: makeFunctionType([{ name: "rad", type: TYPE_UNKNOWN }], TYPE_FLOAT),
  tan: makeFunctionType([{ name: "rad", type: TYPE_UNKNOWN }], TYPE_FLOAT),
  atan2: makeFunctionType(
    [
      { name: "y", type: TYPE_UNKNOWN },
      { name: "x", type: TYPE_UNKNOWN },
    ],
    TYPE_FLOAT,
  ),
  asin: makeFunctionType([{ name: "n", type: TYPE_UNKNOWN }], TYPE_FLOAT),
  acos: makeFunctionType([{ name: "n", type: TYPE_UNKNOWN }], TYPE_FLOAT),
  hypot: makeFunctionType(
    [
      { name: "a", type: TYPE_UNKNOWN },
      { name: "b", type: TYPE_UNKNOWN },
      { name: "c", type: TYPE_UNKNOWN, optional: true },
      { name: "d", type: TYPE_UNKNOWN, optional: true },
    ],
    TYPE_FLOAT,
  ),
  sign: makeFunctionType([{ name: "n", type: TYPE_UNKNOWN }], TYPE_NUM),
  exp: makeFunctionType([{ name: "n", type: TYPE_UNKNOWN }], TYPE_FLOAT),
  Ok: makeFunctionType(
    [{ name: "value", type: TYPE_UNKNOWN }],
    makeResultType(TYPE_UNKNOWN, TYPE_NEVER),
  ),
  Err: makeFunctionType(
    [{ name: "error", type: TYPE_UNKNOWN }],
    makeResultType(TYPE_NEVER, TYPE_UNKNOWN),
  ),
  Some: makeFunctionType([{ name: "value", type: TYPE_UNKNOWN }], makeOptionType(TYPE_UNKNOWN)),

  // Web & Node Intrinsics
  navigator: TYPE_UNKNOWN,
  TextEncoder: makeFunctionType(
    [{ name: "label", type: TYPE_STR, optional: true }],
    TEXT_ENCODER_INSTANCE,
  ),
  TextDecoder: makeFunctionType(
    [
      { name: "label", type: TYPE_STR, optional: true },
      { name: "options", type: TYPE_UNKNOWN, optional: true },
    ],
    TEXT_DECODER_INSTANCE,
  ),
  Uint8Array: makeTypedArrayConstructor("Uint8Array"),
  Uint16Array: makeTypedArrayConstructor("Uint16Array"),
  Uint32Array: makeTypedArrayConstructor("Uint32Array"),
  Int8Array: makeTypedArrayConstructor("Int8Array"),
  Int16Array: makeTypedArrayConstructor("Int16Array"),
  Int32Array: makeTypedArrayConstructor("Int32Array"),
  Float32Array: makeTypedArrayConstructor("Float32Array"),
  Float64Array: makeTypedArrayConstructor("Float64Array"),
  Buffer: BUFFER_SYMBOL,
  Date: DATE_SYMBOL,
  JSON: JSON_SYMBOL,
  Math: MATH_SYMBOL,
  console: CONSOLE_SYMBOL,
  Promise: PROMISE_SYMBOL,
  Array: ARRAY_SYMBOL,
  Object: OBJECT_SYMBOL,
  parseInt: makeFunctionType(
    [
      { name: "s", type: TYPE_UNKNOWN },
      { name: "radix", type: TYPE_INT, optional: true },
    ],
    TYPE_INT,
  ),
  parseFloat: makeFunctionType([{ name: "s", type: TYPE_UNKNOWN }], TYPE_FLOAT),
  isNaN: makeFunctionType([{ name: "n", type: TYPE_UNKNOWN }], TYPE_BOOL),
  isFinite: makeFunctionType([{ name: "n", type: TYPE_UNKNOWN }], TYPE_BOOL),
  setTimeout: makeFunctionType(
    [
      { name: "handler", type: TYPE_UNKNOWN },
      { name: "timeout", type: TYPE_INT, optional: true },
      { name: "arg1", type: TYPE_UNKNOWN, optional: true },
    ],
    TYPE_UNKNOWN,
  ),
  clearTimeout: makeFunctionType([{ name: "id", type: TYPE_UNKNOWN, optional: true }], TYPE_VOID),
  setInterval: makeFunctionType(
    [
      { name: "handler", type: TYPE_UNKNOWN },
      { name: "timeout", type: TYPE_INT, optional: true },
      { name: "arg1", type: TYPE_UNKNOWN, optional: true },
    ],
    TYPE_UNKNOWN,
  ),
  clearInterval: makeFunctionType([{ name: "id", type: TYPE_UNKNOWN, optional: true }], TYPE_VOID),
  localStorage: makeRecordType(
    new Map([
      ["getItem", makeFunctionType([{ name: "key", type: TYPE_STR }], TYPE_UNKNOWN)],
      [
        "setItem",
        makeFunctionType(
          [
            { name: "key", type: TYPE_STR },
            { name: "val", type: TYPE_STR },
          ],
          TYPE_VOID,
        ),
      ],
      ["removeItem", makeFunctionType([{ name: "key", type: TYPE_STR }], TYPE_VOID)],
      ["clear", makeFunctionType([], TYPE_VOID)],
    ]),
    "Storage",
  ),
  fetch: makeFunctionType(
    [
      { name: "url", type: TYPE_STR },
      { name: "init", type: TYPE_UNKNOWN, optional: true },
    ],
    makeNamedType("Promise", [TYPE_UNKNOWN]),
  ),
  btoa: makeFunctionType([{ name: "data", type: TYPE_STR }], TYPE_STR),
  atob: makeFunctionType([{ name: "data", type: TYPE_STR }], TYPE_STR),
  performance: makeRecordType(new Map([["now", makeFunctionType([], TYPE_FLOAT)]]), "performance"),
  crypto: makeRecordType(
    new Map([
      ["getRandomValues", makeFunctionType([{ name: "array", type: TYPE_UNKNOWN }], TYPE_UNKNOWN)],
      ["randomUUID", makeFunctionType([], TYPE_STR)],
    ]),
    "crypto",
  ),
  Map: makeFunctionType(
    [{ name: "entries", type: TYPE_UNKNOWN, optional: true }],
    makeNamedType("Map"),
  ),
  Set: makeFunctionType(
    [{ name: "values", type: TYPE_UNKNOWN, optional: true }],
    makeNamedType("Set"),
  ),
  Error: makeFunctionType(
    [{ name: "message", type: TYPE_STR, optional: true }],
    makeNamedType("Error"),
  ),
  RegExp: makeFunctionType(
    [
      { name: "pattern", type: TYPE_STR },
      { name: "flags", type: TYPE_STR, optional: true },
    ],
    makeNamedType("RegExp"),
  ),
  process: TYPE_UNKNOWN,
};
