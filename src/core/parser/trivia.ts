/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * High-level parser entrypoints (`parse` and `parseWithTrivia`) and lossless
 * CST comment/trivia attachment helpers.
 */

import type { ClassDecl, Module, TypeDecl } from "../ast.js";
import { filterIndentation, scanRawTokens } from "../lexer.js";
import type { Span } from "../span.js";
import { CstTriviaTable, type TriviaItem } from "../trivia.js";
import { Parser } from "./parser-class.js";

/**
 * High-level parser entrypoint.
 */
export function parse(source: string, file = "<anonymous>"): Module {
  return Parser.fromSource(source, file).parse();
}

interface ProcessedComment {
  raw: string;
  item: TriviaItem;
  span: Span;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  isBlock: boolean;
}

interface TargetDecl {
  nodeId: string;
  span: Span;
  isMember?: boolean;
}

function convertCommentToTriviaItem(raw: string, isBlock: boolean, span: Span): TriviaItem {
  if (isBlock) {
    const isDoc = raw.startsWith("/**");
    return {
      kind: isDoc ? "DOCSTRING" : "BLOCK_COMMENT",
      content: raw,
      span,
    };
  }

  // Single-line comment (# or //)
  let content: string;
  if (raw.startsWith("//")) {
    content = raw;
  } else if (raw.startsWith("# ")) {
    content = "// " + raw.slice(2);
  } else if (raw === "#") {
    content = "//";
  } else if (raw.startsWith("#")) {
    content = "// " + raw.slice(1).trimStart();
  } else {
    content = "// " + raw;
  }

  const isLicense =
    content.includes("SPDX-License-Identifier") ||
    content.toLowerCase().includes("@license") ||
    content.toLowerCase().includes("copyright");

  return {
    kind: isLicense ? "LICENSE_HEADER" : "LINE_COMMENT",
    content,
    span,
  };
}

function isModuleHeaderComment(
  comment: ProcessedComment,
  allCommentsBeforeFirstDecl: ProcessedComment[],
  firstDecl?: TargetDecl,
): boolean {
  const text = comment.raw.trim();
  // 1. Explicit keyword match
  if (
    /^(#|\/\/|\/\*+)\s*(module|file|@file|@module|@license|spdx|copyright)\b/i.test(text) ||
    comment.item.kind === "LICENSE_HEADER"
  ) {
    return true;
  }

  // 2. If there are no declarations, all comments are module comments
  if (!firstDecl) {
    return true;
  }

  // 3. Find index of this comment in allCommentsBeforeFirstDecl
  const idx = allCommentsBeforeFirstDecl.indexOf(comment);
  if (idx === -1) return false;

  // Check if there is a blank line between this comment and a subsequent comment before firstDecl
  let hasBlankLineAfterThisBlock = false;
  for (let i = idx; i < allCommentsBeforeFirstDecl.length - 1; i++) {
    if (allCommentsBeforeFirstDecl[i + 1].startLine - allCommentsBeforeFirstDecl[i].endLine > 1) {
      hasBlankLineAfterThisBlock = true;
      break;
    }
  }

  if (hasBlankLineAfterThisBlock) {
    return true;
  }

  // If this comment is in the last comment block before firstDecl,
  // check if there is a blank line between the last comment and firstDecl
  const lastComment = allCommentsBeforeFirstDecl[allCommentsBeforeFirstDecl.length - 1];
  const hasBlankLineBeforeFirstDecl = firstDecl.span.start.line - lastComment.endLine > 1;

  if (hasBlankLineBeforeFirstDecl) {
    return true;
  }

  return false;
}

/**
 * High-level parser entrypoint with lossless CST trivia retention.
 */
export function parseWithTrivia(
  source: string,
  file = "<anonymous>",
): { ast: Module; trivia: CstTriviaTable } {
  const { rawTokens, comments } = scanRawTokens(source, file);
  const tokens = filterIndentation(rawTokens, file);
  const parser = new Parser(tokens, file, source);
  const ast = parser.parse();

  const trivia = new CstTriviaTable();
  if (comments.length === 0) {
    return { ast, trivia };
  }

  const processedComments: ProcessedComment[] = comments.map((c) => {
    const raw = source.slice(c.span.start.offset, c.span.end.offset);
    return {
      raw,
      item: convertCommentToTriviaItem(raw, c.isBlock, c.span),
      span: c.span,
      startOffset: c.span.start.offset,
      endOffset: c.span.end.offset,
      startLine: c.span.start.line,
      endLine: c.span.end.line,
      isBlock: c.isBlock,
    };
  });

  const topDecls: TargetDecl[] = [];
  const classMembers = new Map<string, TargetDecl[]>();
  const typeFields = new Map<string, TargetDecl[]>();

  for (const item of ast.items) {
    switch (item.kind) {
      case "ImportDecl":
        topDecls.push({ nodeId: `import:${item.source}`, span: item.span });
        break;
      case "TypeDecl": {
        topDecls.push({ nodeId: `type:${item.name}`, span: item.span });
        if (item.fields) {
          const fields: TargetDecl[] = [];
          for (const f of item.fields) {
            fields.push({
              nodeId: `field:${item.name}.${f.name}`,
              span: f.span,
              isMember: true,
            });
          }
          fields.sort((a, b) => a.span.start.offset - b.span.start.offset);
          typeFields.set(item.name, fields);
        }
        break;
      }
      case "FunctionDecl":
        if (item.name !== "__top_level__") {
          topDecls.push({ nodeId: `fn:${item.name}`, span: item.span });
        }
        break;
      case "ClassDecl": {
        topDecls.push({ nodeId: `class:${item.name}`, span: item.span });
        const members: TargetDecl[] = [];
        for (const p of item.properties) {
          members.push({
            nodeId: `field:${item.name}.${p.name}`,
            span: p.span,
            isMember: true,
          });
        }
        for (const m of item.methods) {
          members.push({
            nodeId: `method:${item.name}.${m.name}`,
            span: m.span,
            isMember: true,
          });
        }
        members.sort((a, b) => a.span.start.offset - b.span.start.offset);
        classMembers.set(item.name, members);
        break;
      }
      case "ConstDecl":
        topDecls.push({ nodeId: `const:${item.name}`, span: item.span });
        break;
      case "VarDecl":
        topDecls.push({ nodeId: `var:${item.name}`, span: item.span });
        break;
      case "ComponentDecl":
        topDecls.push({ nodeId: `component:${item.name}`, span: item.span });
        break;
    }
  }

  topDecls.sort((a, b) => a.span.start.offset - b.span.start.offset);

  const allDecls: TargetDecl[] = [...topDecls];
  for (const members of classMembers.values()) {
    allDecls.push(...members);
  }
  for (const fields of typeFields.values()) {
    allDecls.push(...fields);
  }

  for (const c of processedComments) {
    // 1. Check if trailing comment on any declaration
    let trailingTarget: TargetDecl | undefined;
    for (const d of allDecls) {
      if (c.startLine === d.span.end.line && c.startOffset >= d.span.end.offset) {
        if (!trailingTarget || d.span.end.offset > trailingTarget.span.end.offset) {
          trailingTarget = d;
        }
      }
    }

    if (trailingTarget) {
      trivia.addTrailingTrivia(trailingTarget.nodeId, c.item);
      continue;
    }

    // 2. Check if inside a ClassDecl
    let insideClass: (ClassDecl & { span: Span }) | undefined;
    for (const item of ast.items) {
      if (
        item.kind === "ClassDecl" &&
        c.startOffset > item.span.start.offset &&
        c.endOffset <= item.span.end.offset
      ) {
        insideClass = item;
        break;
      }
    }

    if (insideClass) {
      const members = classMembers.get(insideClass.name) ?? [];
      const nextMember = members.find((m) => m.span.start.offset > c.startOffset);
      if (nextMember) {
        trivia.addLeadingTrivia(nextMember.nodeId, c.item);
      } else {
        trivia.addTrailingTrivia(`class:${insideClass.name}`, c.item);
      }
      continue;
    }

    // 3. Check if inside a TypeDecl
    let insideType: (TypeDecl & { span: Span }) | undefined;
    for (const item of ast.items) {
      if (
        item.kind === "TypeDecl" &&
        item.fields &&
        item.fields.length > 0 &&
        c.startOffset > item.span.start.offset &&
        c.endOffset <= item.span.end.offset
      ) {
        insideType = item;
        break;
      }
    }

    if (insideType) {
      const fields = typeFields.get(insideType.name) ?? [];
      const nextField = fields.find((f) => f.span.start.offset > c.startOffset);
      if (nextField) {
        trivia.addLeadingTrivia(nextField.nodeId, c.item);
      } else {
        trivia.addTrailingTrivia(`type:${insideType.name}`, c.item);
      }
      continue;
    }

    // 4. Module-level (topDecls)
    const nextTopDecl = topDecls.find((d) => d.span.start.offset > c.startOffset);
    if (!nextTopDecl) {
      trivia.addLeadingTrivia("module", c.item);
      continue;
    }

    if (nextTopDecl === topDecls[0]) {
      const commentsBeforeFirst = processedComments.filter(
        (pc) => pc.startOffset < topDecls[0].span.start.offset,
      );
      if (isModuleHeaderComment(c, commentsBeforeFirst, topDecls[0])) {
        trivia.addLeadingTrivia("module", c.item);
      } else {
        trivia.addLeadingTrivia(topDecls[0].nodeId, c.item);
      }
      continue;
    }

    trivia.addLeadingTrivia(nextTopDecl.nodeId, c.item);
  }

  return { ast, trivia };
}
