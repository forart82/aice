/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: Recursive Descent S-Expression Parser & AST Builder
 * Builds pure homoiconic Universal AST nodes with exact source spans and CST trivia linking.
 */

import type {
  AilComponentDeclNode,
  AilDocumentNode,
  AilEntityNode,
  AilExprNode,
  AilFileNode,
  AilFunctionDeclNode,
  AilImportDeclNode,
  AilLayoutNode,
  AilManifestNode,
  AilModuleNode,
  AilPrimitiveTypeNode,
  AilRecordField,
  AilRecordTypeNode,
  AilSignatureNode,
  AilStyleDeclNode,
  AilTypeDeclNode,
  AilTypeExprNode,
  AilWorkspaceNode,
  PrimitiveKind,
} from "./ast.ts";
import { tokenizeAil } from "./lexer.ts";
import { createSpan, type SourceSpan } from "./span.ts";
import type { Token, TokenType } from "./tokens.ts";
import { CstTriviaTable } from "./trivia.ts";

export interface Diagnostic {
  code: string;
  message: string;
  span?: SourceSpan;
  severity: "error" | "warning";
}

export interface ParseResult {
  document: AilDocumentNode | null;
  triviaTable: CstTriviaTable;
  diagnostics: Diagnostic[];
}

export function parseAil(source: string, file?: string): ParseResult {
  const { tokens, trivia } = tokenizeAil(source, { file, retainTrivia: true });
  const triviaTable = new CstTriviaTable();
  const diagnostics: Diagnostic[] = [];

  let index = 0;
  let nodeCounter = 0;

  function nextNodeId(prefix = "node"): string {
    return `${prefix}_${nodeCounter++}`;
  }

  function peek(ahead = 0): Token {
    return index + ahead < tokens.length ? tokens[index + ahead] : tokens[tokens.length - 1];
  }

  function next(): Token {
    const tok = peek();
    if (index < tokens.length - 1) {
      index++;
    }
    return tok;
  }

  function _match(type: TokenType): boolean {
    if (peek().type === type) {
      next();
      return true;
    }
    return false;
  }

  function expect(type: TokenType, context = ""): Token {
    const tok = peek();
    if (tok.type !== type) {
      diagnostics.push({
        code: "AIL_E1001_UNEXPECTED_TOKEN",
        message: `Expected ${type} but received ${tok.type} ('${tok.value}')${context ? ` in ${context}` : ""}`,
        span: tok.span,
        severity: "error",
      });
      return tok;
    }
    return next();
  }

  // --- Parser Rules ---

  function parseDocument(): AilDocumentNode | null {
    if (peek().type === "AT_WORKSPACE") {
      return parseWorkspace();
    }
    if (peek().type === "AT_MODULE") {
      return parseModule();
    }
    diagnostics.push({
      code: "AIL_E1002_INVALID_ROOT",
      message: `AIL document must begin with (@workspace ...) or (@module ...), received ${peek().type}`,
      span: peek().span,
      severity: "error",
    });
    return null;
  }

  function parseWorkspace(): AilWorkspaceNode {
    const startTok = expect("AT_WORKSPACE");
    const name = expect("STRING", "workspace name").value;
    let manifest: AilManifestNode | undefined;

    if (peek().type === "LPAREN" && peek(1).value === "*") {
      manifest = parseManifest();
    }

    const files: AilFileNode[] = [];
    while (peek().type === "AT_FILE") {
      files.push(parseFile());
    }

    const endTok = expect("RPAREN", "closing workspace");
    const span = createSpan(startTok.span.start, endTok.span.end, file);

    return {
      kind: "Workspace",
      nodeId: nextNodeId("ws"),
      name,
      manifest,
      files,
      span,
    };
  }

  function parseFile(): AilFileNode {
    const startTok = expect("AT_FILE");
    const filePath = expect("STRING", "file path").value;
    const moduleNode = parseModule();
    const endTok = expect("RPAREN", "closing file declaration");

    return {
      kind: "File",
      nodeId: nextNodeId("file"),
      path: filePath,
      module: moduleNode,
      span: createSpan(startTok.span.start, endTok.span.end, file),
    };
  }

  function parseModule(): AilModuleNode {
    const startTok = expect("AT_MODULE");
    const name = expect("SYMBOL", "module name").value;
    let manifest: AilManifestNode | undefined;

    if (peek().type === "LPAREN" && peek(1).value === "*") {
      manifest = parseManifest();
    }

    const entities: AilEntityNode[] = [];
    while (peek().type !== "RPAREN" && peek().type !== "EOF") {
      const entity = parseEntity();
      if (entity) {
        entities.push(entity);
      } else {
        // Prevent infinite loop on unexpected tokens
        next();
      }
    }

    const endTok = expect("RPAREN", "closing module");
    return {
      kind: "Module",
      nodeId: nextNodeId("mod"),
      name,
      manifest,
      entities,
      span: createSpan(startTok.span.start, endTok.span.end, file),
    };
  }

  function parseManifest(): AilManifestNode {
    const startTok = expect("LPAREN");
    next(); // skip '*'
    const entries: Record<string, string | number | boolean> = {};

    while (!(peek().value === "*" && peek(1).type === "RPAREN") && peek().type !== "EOF") {
      const keyTok = next();
      if (keyTok.value === "*" && peek().type === "RPAREN") break;
      const key = keyTok.value;
      const valTok = next();
      if (valTok.type === "STRING") entries[key] = valTok.value;
      else if (valTok.type === "NUMBER") entries[key] = Number(valTok.value);
      else if (valTok.type === "BOOLEAN") entries[key] = valTok.value === "true";
      else entries[key] = valTok.value;
    }

    if (peek().value === "*") next(); // skip '*'
    const endTok = expect("RPAREN", "closing manifest (* ... *)");
    return {
      kind: "Manifest",
      nodeId: nextNodeId("manifest"),
      entries,
      span: createSpan(startTok.span.start, endTok.span.end, file),
    };
  }

  function parseEntity(): AilEntityNode | null {
    const tok = peek();

    // Dependencies import: (deps ((module symbol...)))
    if (tok.type === "LPAREN" && peek(1).value === "deps") {
      return parseImportDecl();
    }

    // Type declaration: (: Name TypeExpr)
    if (tok.type === "TYPE_DECL") {
      return parseTypeDecl();
    }

    // Function declaration: (! Name Signatures Body)
    if (tok.type === "FN_DECL") {
      return parseFunctionDecl();
    }

    // Component declaration: (# Name PropContract LayoutNode)
    if (tok.type === "COMPONENT_DECL") {
      return parseComponentDecl();
    }

    // Style declaration: (& Name RuleList)
    if (tok.type === "STYLE_DECL") {
      return parseStyleDecl();
    }

    return null;
  }

  function parseImportDecl(): AilImportDeclNode {
    const startTok = expect("LPAREN");
    next(); // skip 'deps'
    expect("LPAREN", "opening import list");

    const imports: Array<{ modulePath: string; symbols: string[] }> = [];

    while (peek().type === "LPAREN") {
      next(); // skip '('
      const modulePath = expect("STRING", "import module path").value;
      const symbols: string[] = [];
      while (peek().type !== "RPAREN" && peek().type !== "EOF") {
        symbols.push(next().value);
      }
      expect("RPAREN", "closing import module entry");
      imports.push({ modulePath, symbols });
    }

    expect("RPAREN", "closing import list");
    const endTok = expect("RPAREN", "closing deps block");

    return {
      kind: "ImportDecl",
      nodeId: nextNodeId("import"),
      imports,
      span: createSpan(startTok.span.start, endTok.span.end, file),
    };
  }

  function parseTypeDecl(): AilTypeDeclNode {
    const startTok = expect("TYPE_DECL");
    const name = expect("SYMBOL", "type identifier").value;
    const typeExpr = parseTypeExpr();
    const endTok = expect("RPAREN", "closing type declaration");

    return {
      kind: "TypeDecl",
      nodeId: nextNodeId("type"),
      name,
      typeExpr,
      span: createSpan(startTok.span.start, endTok.span.end, file),
    };
  }

  function parseTypeExpr(): AilTypeExprNode {
    const tok = peek();

    // Primitive: !s, !i, !f, !u, !b, !void, !nil, !unknown
    const primitives: Record<string, PrimitiveKind> = {
      "!u": "!u",
      "!i": "!i",
      "!f": "!f",
      "!s": "!s",
      "!b": "!b",
      "!void": "!void",
      "!unknown": "!unknown",
      "!nil": "!nil",
    };

    if (primitives[tok.value]) {
      next();
      return {
        kind: "PrimitiveType",
        nodeId: nextNodeId("prim"),
        name: primitives[tok.value],
        span: tok.span,
      };
    }

    // Array type: [Type]
    if (tok.type === "LBRACKET") {
      const startTok = next();
      const elemType = parseTypeExpr();
      const endTok = expect("RBRACKET", "closing array type");
      return {
        kind: "ArrayType",
        nodeId: nextNodeId("arrType"),
        elementType: elemType,
        span: createSpan(startTok.span.start, endTok.span.end, file),
      };
    }

    // Record type: (% field1 Type1 field2 Type2)
    if (tok.type === "RECORD_LIT") {
      const startTok = next();
      const fields: AilRecordField[] = [];
      while (peek().type !== "RPAREN" && peek().type !== "EOF") {
        const fieldName = next().value;
        const fieldType = parseTypeExpr();
        fields.push({ name: fieldName, type: fieldType });
      }
      const endTok = expect("RPAREN", "closing record type");
      return {
        kind: "RecordType",
        nodeId: nextNodeId("recType"),
        fields,
        span: createSpan(startTok.span.start, endTok.span.end, file),
      };
    }

    // Union type: (| TypeA TypeB)
    if (tok.type === "UNION") {
      const startTok = next();
      const types: AilTypeExprNode[] = [];
      while (peek().type !== "RPAREN" && peek().type !== "EOF") {
        types.push(parseTypeExpr());
      }
      const endTok = expect("RPAREN", "closing union type");
      return {
        kind: "UnionType",
        nodeId: nextNodeId("unionType"),
        types,
        span: createSpan(startTok.span.start, endTok.span.end, file),
      };
    }

    // Refinement type: (?: param BaseType predicate)
    if (tok.type === "REFINEMENT") {
      const startTok = next();
      const param = expect("SYMBOL", "refinement parameter").value;
      const baseType = parseTypeExpr() as AilPrimitiveTypeNode;
      const predicate = parseExpr();
      const endTok = expect("RPAREN", "closing refinement type");
      return {
        kind: "RefinementType",
        nodeId: nextNodeId("refineType"),
        param,
        baseType,
        predicate,
        span: createSpan(startTok.span.start, endTok.span.end, file),
      };
    }

    // Typestate: (~ State1 -> State2)
    if (tok.type === "TYPESTATE") {
      const startTok = next();
      const states: string[] = [];
      while (peek().type !== "RPAREN" && peek().type !== "EOF") {
        const s = next().value;
        if (s !== "->") states.push(s);
      }
      const endTok = expect("RPAREN", "closing typestate");
      return {
        kind: "Typestate",
        nodeId: nextNodeId("typestate"),
        states,
        span: createSpan(startTok.span.start, endTok.span.end, file),
      };
    }

    // Effect: (!^ ReturnType [Effect1 Effect2])
    if (tok.type === "EFFECT_DECL") {
      const startTok = next();
      const retType = parseTypeExpr();
      expect("LBRACKET", "opening effect list");
      const effects: string[] = [];
      while (peek().type !== "RBRACKET" && peek().type !== "EOF") {
        effects.push(next().value);
      }
      expect("RBRACKET", "closing effect list");
      const endTok = expect("RPAREN", "closing effect declaration");
      return {
        kind: "EffectType",
        nodeId: nextNodeId("effectType"),
        returnType: retType,
        effects,
        span: createSpan(startTok.span.start, endTok.span.end, file),
      };
    }

    // Named type identifier: e.g. User, Result[T, E]
    const nameTok = next();
    let typeArgs: AilTypeExprNode[] | undefined;
    if (peek().type === "LBRACKET") {
      next(); // skip '['
      typeArgs = [];
      while (peek().type !== "RBRACKET" && peek().type !== "EOF") {
        if (peek().value === ",") {
          next();
          continue;
        }
        typeArgs.push(parseTypeExpr());
      }
      expect("RBRACKET", "closing type arguments");
    }

    return {
      kind: "NamedType",
      nodeId: nextNodeId("namedType"),
      name: nameTok.value,
      typeArguments: typeArgs,
      span: nameTok.span,
    };
  }

  function parseFunctionDecl(): AilFunctionDeclNode {
    const startTok = expect("FN_DECL");
    const name = expect("SYMBOL", "function identifier").value;
    const signatures = parseSignature();
    const body = parseExpr();
    const endTok = expect("RPAREN", "closing function declaration");

    return {
      kind: "FunctionDecl",
      nodeId: nextNodeId("fn"),
      name,
      signatures,
      body,
      span: createSpan(startTok.span.start, endTok.span.end, file),
    };
  }

  function parseSignature(): AilSignatureNode {
    const startTok = expect("LPAREN");
    expect("SYMBOL", "arrow (->)"); // skip '->'
    expect("LPAREN", "opening parameter list");

    const params: Array<{ name: string; type: AilTypeExprNode }> = [];
    while (peek().type !== "RPAREN" && peek().type !== "EOF") {
      const pName = expect("SYMBOL", "parameter name").value;
      const pType = parseTypeExpr();
      params.push({ name: pName, type: pType });
    }
    expect("RPAREN", "closing parameter list");
    const retType = parseTypeExpr();
    const endTok = expect("RPAREN", "closing signature");

    return {
      kind: "Signature",
      nodeId: nextNodeId("sig"),
      params,
      returnType: retType,
      span: createSpan(startTok.span.start, endTok.span.end, file),
    };
  }

  function parseComponentDecl(): AilComponentDeclNode {
    const startTok = expect("COMPONENT_DECL");
    const name = expect("SYMBOL", "component identifier").value;
    let propContract: AilRecordTypeNode | undefined;

    if (peek().type === "RECORD_LIT") {
      propContract = parseTypeExpr() as AilRecordTypeNode;
    }

    const layout = parseLayoutNode();
    const endTok = expect("RPAREN", "closing component declaration");

    return {
      kind: "ComponentDecl",
      nodeId: nextNodeId("component"),
      name,
      propContract,
      layout,
      span: createSpan(startTok.span.start, endTok.span.end, file),
    };
  }

  function parseLayoutNode(): AilLayoutNode {
    const tok = peek();

    // Tag node: (< tag (. attrs .) children... >)
    if (tok.type === "LAYOUT_OPEN") {
      const startTok = next();
      const tagName = expect("SYMBOL", "layout tag name").value;
      const attributes: Record<string, AilExprNode> = {};

      if (peek().type === "ATTRS_OPEN") {
        next(); // skip '(.'
        while (peek().type !== "ATTRS_CLOSE" && peek().type !== "EOF") {
          const attrName = next().value;
          const attrVal = parseExpr();
          attributes[attrName] = attrVal;
        }
        expect("ATTRS_CLOSE", "closing attributes block");
      }

      const children: AilLayoutNode[] = [];
      while (peek().type !== "LAYOUT_CLOSE" && peek().type !== "EOF") {
        children.push(parseLayoutNode());
      }
      const endTok = expect("LAYOUT_CLOSE", "closing layout tag");

      return {
        kind: "TagNode",
        nodeId: nextNodeId("tag"),
        tag: tagName,
        attributes,
        children,
        span: createSpan(startTok.span.start, endTok.span.end, file),
      };
    }

    // Text node: !str "..." or (!val expr)
    if (tok.value === "!str") {
      const startTok = next();
      const textVal = expect("STRING", "string text content").value;
      return {
        kind: "TextNode",
        nodeId: nextNodeId("text"),
        text: textVal,
        span: createSpan(startTok.span.start, peek().span.end, file),
      };
    }

    if (tok.type === "VAL_TEXT") {
      const startTok = next();
      const exprVal = parseExpr();
      const endTok = expect("RPAREN", "closing !val text node");
      return {
        kind: "TextNode",
        nodeId: nextNodeId("valText"),
        expr: exprVal,
        span: createSpan(startTok.span.start, endTok.span.end, file),
      };
    }

    // Fallback: parse as expression-wrapped layout
    const fallbackExpr = parseExpr();
    return {
      kind: "TextNode",
      nodeId: nextNodeId("exprNode"),
      expr: fallbackExpr,
      span: fallbackExpr.span,
    };
  }

  function parseStyleDecl(): AilStyleDeclNode {
    const startTok = expect("STYLE_DECL");
    const name = expect("SYMBOL", "style block name").value;
    const rules: Array<{ prop: string; value: string }> = [];

    if (peek().type === "ATTRS_OPEN") {
      next(); // skip '(.'
      while (peek().type !== "ATTRS_CLOSE" && peek().type !== "EOF") {
        const prop = next().value;
        const val = next().value;
        rules.push({ prop, value: val });
      }
      expect("ATTRS_CLOSE", "closing style rule list");
    } else {
      expect("LPAREN", "opening style rule list");
      while (peek().type !== "RPAREN" && peek().type !== "EOF") {
        const prop = next().value;
        const val = next().value;
        rules.push({ prop, value: val });
      }
      expect("RPAREN", "closing style rule list");
    }

    const endTok = expect("RPAREN", "closing style declaration");

    return {
      kind: "StyleDecl",
      nodeId: nextNodeId("style"),
      name,
      rules,
      span: createSpan(startTok.span.start, endTok.span.end, file),
    };
  }

  function parseExpr(): AilExprNode {
    const tok = peek();

    // Comparison '<' in expression context: (< arg1 arg2 ...)
    if (tok.type === "LAYOUT_OPEN") {
      let isLayoutTag = false;
      let offsetAhead = 1;
      while (index + offsetAhead < tokens.length) {
        const ahead = peek(offsetAhead);
        if (ahead.type === "LAYOUT_CLOSE") {
          isLayoutTag = true;
          break;
        }
        if (ahead.type === "RPAREN") {
          isLayoutTag = false;
          break;
        }
        if (ahead.type === "EOF") break;
        offsetAhead++;
      }

      if (!isLayoutTag) {
        const startTok = next();
        const args: AilExprNode[] = [];
        while (peek().type !== "RPAREN" && peek().type !== "EOF") {
          args.push(parseExpr());
        }
        const endTok = expect("RPAREN", "closing '<' comparison expression");
        return {
          kind: "ApplyExpr",
          nodeId: nextNodeId("apply"),
          operator: "<",
          args,
          span: createSpan(startTok.span.start, endTok.span.end, file),
        };
      }
    }

    // Assignment: (:= var expr)
    if (tok.type === "ASSIGN") {
      const startTok = next();
      const target = next().value;
      const expr = parseExpr();
      const endTok = expect("RPAREN", "closing assignment expression");
      return {
        kind: "AssignExpr",
        nodeId: nextNodeId("assign"),
        target,
        expr,
        span: createSpan(startTok.span.start, endTok.span.end, file),
      };
    }

    // Block: (do expr1 expr2 ...)
    if (tok.type === "DO_BLOCK") {
      const startTok = next();
      const expressions: AilExprNode[] = [];
      while (peek().type !== "RPAREN" && peek().type !== "EOF") {
        expressions.push(parseExpr());
      }
      const endTok = expect("RPAREN", "closing do block");
      return {
        kind: "BlockExpr",
        nodeId: nextNodeId("block"),
        expressions,
        span: createSpan(startTok.span.start, endTok.span.end, file),
      };
    }

    // Try unpack: (? expr)
    if (tok.type === "TRY_UNPACK") {
      const startTok = next();
      const innerExpr = parseExpr();
      const endTok = expect("RPAREN", "closing try unpack expression");
      return {
        kind: "TryUnpackExpr",
        nodeId: nextNodeId("unpack"),
        expr: innerExpr,
        span: createSpan(startTok.span.start, endTok.span.end, file),
      };
    }

    // Conditional: (?if cond then else)
    if (tok.type === "IF_EXPR") {
      const startTok = next();
      const condition = parseExpr();
      const thenExpr = parseExpr();
      let elseExpr: AilExprNode | undefined;
      if (peek().type !== "RPAREN") {
        elseExpr = parseExpr();
      }
      const endTok = expect("RPAREN", "closing if expression");
      return {
        kind: "IfExpr",
        nodeId: nextNodeId("if"),
        condition,
        thenExpr,
        elseExpr,
        span: createSpan(startTok.span.start, endTok.span.end, file),
      };
    }

    // Pattern match: (== target (case pattern expr) ...)
    if (tok.type === "MATCH") {
      const startTok = next();
      const target = parseExpr();
      const cases: Array<{ pattern: AilExprNode; expr: AilExprNode }> = [];
      while (peek().type === "LPAREN" && peek(1).value === "case") {
        next(); // skip '('
        next(); // skip 'case'
        const pat = parseExpr();
        const res = parseExpr();
        expect("RPAREN", "closing match case");
        cases.push({ pattern: pat, expr: res });
      }
      const endTok = expect("RPAREN", "closing match expression");
      return {
        kind: "MatchExpr",
        nodeId: nextNodeId("match"),
        target,
        cases,
        span: createSpan(startTok.span.start, endTok.span.end, file),
      };
    }

    // Record literal: (% key1 val1 key2 val2)
    if (tok.type === "RECORD_LIT") {
      const startTok = next();
      const entries: Record<string, AilExprNode> = {};
      while (peek().type !== "RPAREN" && peek().type !== "EOF") {
        const k = next().value;
        const v = parseExpr();
        entries[k] = v;
      }
      const endTok = expect("RPAREN", "closing record literal");
      return {
        kind: "Literal",
        nodeId: nextNodeId("recLit"),
        valueType: "record",
        value: entries,
        span: createSpan(startTok.span.start, endTok.span.end, file),
      };
    }

    // Array literal: [item1 item2 ...]
    if (tok.type === "LBRACKET") {
      const startTok = next();
      const items: AilExprNode[] = [];
      while (peek().type !== "RBRACKET" && peek().type !== "EOF") {
        items.push(parseExpr());
      }
      const endTok = expect("RBRACKET", "closing array literal");
      return {
        kind: "Literal",
        nodeId: nextNodeId("arrLit"),
        valueType: "array",
        value: items,
        span: createSpan(startTok.span.start, endTok.span.end, file),
      };
    }

    // Function/Operator apply: (op arg1 arg2 ...)
    if (tok.type === "LPAREN") {
      const startTok = next();
      const op = next().value;
      const args: AilExprNode[] = [];
      while (peek().type !== "RPAREN" && peek().type !== "EOF") {
        args.push(parseExpr());
      }
      const endTok = expect("RPAREN", "closing function application");
      return {
        kind: "ApplyExpr",
        nodeId: nextNodeId("apply"),
        operator: op,
        args,
        span: createSpan(startTok.span.start, endTok.span.end, file),
      };
    }

    // Literals: String, Number, Boolean
    if (tok.type === "STRING") {
      const t = next();
      return {
        kind: "Literal",
        nodeId: nextNodeId("strLit"),
        valueType: "string",
        value: t.value,
        span: t.span,
      };
    }

    if (tok.type === "NUMBER") {
      const t = next();
      return {
        kind: "Literal",
        nodeId: nextNodeId("numLit"),
        valueType: "number",
        value: Number(t.value),
        span: t.span,
      };
    }

    if (tok.type === "BOOLEAN") {
      const t = next();
      return {
        kind: "Literal",
        nodeId: nextNodeId("boolLit"),
        valueType: "boolean",
        value: t.value === "true",
        span: t.span,
      };
    }

    // Simple Symbol
    const symTok = next();
    return {
      kind: "Symbol",
      nodeId: nextNodeId("sym"),
      name: symTok.value,
      span: symTok.span,
    };
  }

  // --- Execute Parsing ---
  const doc = parseDocument();

  // Populate trivia table
  for (const item of trivia) {
    triviaTable.addLeadingTrivia("root", item);
  }

  return {
    document: doc,
    triviaTable,
    diagnostics,
  };
}
