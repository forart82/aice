/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dialect-specific native splicing for CSS, JSON, YAML, HTML, Twig, and structured document formats.
 */

import postcss from "postcss";
import YAML from "yaml";
import { type ProjectIdiomDefinition, stripJsonComments } from "../../config/index.js";
import { astToValue } from "../../core/data-converter.js";
import { parse } from "../../core/parser.js";
import { emitTarget, type TargetLanguage } from "../../emitters/index.js";
import { expandModuleIdioms } from "../../idioms/index.js";
import { estimateTokens } from "../../tokenomics/index.js";
import { extractInlineIdiomsFromSource } from "../create.js";
import { preprocessBareCssLossless, preprocessHybridAndIdiomsLossless } from "../preprocessor.js";
import { validateNativeSyntax } from "../syntax-validator.js";
import { generateUnifiedDiff, indentCode } from "./ast-helpers.js";
import {
  applyHunksToScope,
  containsHunkMarkers,
  extractHunkBlocks,
  stripNumberedGutterPrefixes,
} from "./hunks.js";
import { isCreateOrOverwriteSymbol } from "./stream-parser.js";
import type { SpliceOptions, SpliceResult } from "./types.js";

export function spliceDialectNativeSource(
  nativeSource: string,
  options: SpliceOptions,
  filePath: string,
  targetLang: TargetLanguage,
  idioms?: Record<string, ProjectIdiomDefinition>,
): SpliceResult | undefined {
  if (options.edits && options.edits.length > 0) {
    if (targetLang === "json" || targetLang === "yaml") {
      let currentSource = nativeSource;
      const editedSymbols: string[] = [];
      for (const edit of options.edits) {
        const editCode =
          edit.code ??
          edit.aice ??
          edit.template ??
          edit.snippet ??
          edit.content ??
          edit.replacement;
        const singleRes = spliceDialectNativeSource(
          currentSource,
          {
            ...options,
            edits: undefined,
            symbol: edit.symbol,
            code: editCode,
            body: edit.body,
            delete: edit.delete,
            insertAfter: edit.insertAfter ?? edit.insert_after,
            insertBefore: edit.insertBefore ?? edit.insert_before,
          },
          filePath,
          targetLang,
          idioms,
        );
        if (singleRes) {
          currentSource = singleRes.modifiedCode;
          editedSymbols.push(edit.symbol);
        }
      }
      return {
        success: true,
        filePath,
        symbol: editedSymbols.join(", "),
        diff: options.diff ? generateUnifiedDiff(filePath, nativeSource, currentSource) : undefined,
        modifiedCode: currentSource,
        newAiceSource: currentSource,
        tokensSaved: estimateTokens(currentSource) - estimateTokens(JSON.stringify(options.edits)),
      };
    }

    // For CSS, HTML, and Twig: resolve each edit's exact byte span against `nativeSource`
    // and apply in reverse offset order (bottom-to-top).
    const resolvedDialectEdits: Array<{
      symbol: string;
      startOffset: number;
      endOffset: number;
      replacement: string;
    }> = [];

    for (const edit of options.edits) {
      const editCode =
        edit.code ?? edit.aice ?? edit.template ?? edit.snippet ?? edit.content ?? edit.replacement;
      const singleRes = spliceDialectNativeSource(
        nativeSource,
        {
          ...options,
          edits: undefined,
          diff: false,
          symbol: edit.symbol,
          code: editCode,
          body: edit.body,
          delete: edit.delete,
          insertAfter: edit.insertAfter ?? edit.insert_after,
          insertBefore: edit.insertBefore ?? edit.insert_before,
        },
        filePath,
        targetLang,
        idioms,
      );
      if (singleRes) {
        let prefixLen = 0;
        const minLen = Math.min(nativeSource.length, singleRes.modifiedCode.length);
        while (
          prefixLen < minLen &&
          nativeSource.charCodeAt(prefixLen) === singleRes.modifiedCode.charCodeAt(prefixLen)
        ) {
          prefixLen++;
        }
        let origSuffixIdx = nativeSource.length;
        let modSuffixIdx = singleRes.modifiedCode.length;
        while (
          origSuffixIdx > prefixLen &&
          modSuffixIdx > prefixLen &&
          nativeSource.charCodeAt(origSuffixIdx - 1) ===
            singleRes.modifiedCode.charCodeAt(modSuffixIdx - 1)
        ) {
          origSuffixIdx--;
          modSuffixIdx--;
        }
        resolvedDialectEdits.push({
          symbol: edit.symbol,
          startOffset: prefixLen,
          endOffset: origSuffixIdx,
          replacement: singleRes.modifiedCode.slice(prefixLen, modSuffixIdx),
        });
      }
    }

    const indexedDialectEdits = resolvedDialectEdits.map((edit, idx) => ({ edit, idx }));
    const sortedDialect = indexedDialectEdits
      .sort(
        (a, b) =>
          b.edit.startOffset - a.edit.startOffset ||
          b.edit.endOffset - a.edit.endOffset ||
          b.idx - a.idx,
      )
      .map((entry) => entry.edit);
    const hasDialectOverlap = sortedDialect.some(
      (e, idx) =>
        idx < sortedDialect.length - 1 && e.startOffset < sortedDialect[idx + 1].endOffset,
    );

    let modifiedCode = nativeSource;
    if (hasDialectOverlap) {
      for (const edit of options.edits) {
        const editCode =
          edit.code ??
          edit.aice ??
          edit.template ??
          edit.snippet ??
          edit.content ??
          edit.replacement;
        const stepRes = spliceDialectNativeSource(
          modifiedCode,
          {
            ...options,
            edits: undefined,
            diff: false,
            symbol: edit.symbol,
            code: editCode,
            body: edit.body,
            delete: edit.delete,
            insertAfter: edit.insertAfter ?? edit.insert_after,
            insertBefore: edit.insertBefore ?? edit.insert_before,
          },
          filePath,
          targetLang,
          idioms,
        );
        if (stepRes) {
          modifiedCode = stepRes.modifiedCode;
        }
      }
    } else {
      for (const item of sortedDialect) {
        modifiedCode = `${modifiedCode.slice(0, item.startOffset)}${item.replacement}${modifiedCode.slice(item.endOffset)}`;
      }
    }
    const editedSymbols = options.edits.map((e) => e.symbol);
    return {
      success: true,
      filePath,
      symbol: editedSymbols.join(", "),
      diff: options.diff ? generateUnifiedDiff(filePath, nativeSource, modifiedCode) : undefined,
      modifiedCode,
      newAiceSource: modifiedCode,
      tokensSaved: estimateTokens(modifiedCode) - estimateTokens(JSON.stringify(options.edits)),
    };
  }

  const anchorSymbol = options.insertAfter ?? options.insertBefore ?? options.symbol;
  const rawSnippet = stripNumberedGutterPrefixes(options.code ?? options.body ?? "");

  if (containsHunkMarkers(rawSnippet)) {
    const hunks = extractHunkBlocks(rawSnippet);
    if (hunks.length > 0) {
      const hunkIdiomsOn =
        options.idioms !== false &&
        (options.idioms === true || Boolean(idioms && Object.keys(idioms).length > 0));
      let scopeStart = 0;
      let scopeEnd = nativeSource.length;
      if (
        targetLang === "css" &&
        anchorSymbol &&
        anchorSymbol !== ":hunk" &&
        anchorSymbol !== "hunk" &&
        !isCreateOrOverwriteSymbol(anchorSymbol)
      ) {
        try {
          const cssRoot = postcss.parse(nativeSource, { from: filePath });
          const cleanAnchor = anchorSymbol.trim().replace(/^[.#]/, "");
          let matchedRule: postcss.Rule | undefined;
          cssRoot.walkRules((rule) => {
            if (matchedRule) return;
            const sel = rule.selector.trim();
            const cleanSel = sel.replace(/^[.#]/, "");
            if (
              sel === anchorSymbol.trim() ||
              cleanSel === cleanAnchor ||
              cleanSel.replace(/[-_]/g, "").toLowerCase() ===
                cleanAnchor.replace(/[-_]/g, "").toLowerCase()
            ) {
              matchedRule = rule;
            }
          });
          if (matchedRule?.source?.start && matchedRule.source.end) {
            scopeStart = matchedRule.source.start.offset;
            const rawEnd = matchedRule.source.end.offset;
            scopeEnd =
              !nativeSource.slice(scopeStart, rawEnd).trimEnd().endsWith("}") &&
              nativeSource[rawEnd] === "}"
                ? rawEnd + 1
                : rawEnd;
          }
        } catch {
          // fall back to full-file hunk scope
        }
      }
      const scopeSlice = nativeSource.slice(scopeStart, scopeEnd);
      const scopeStartLine = nativeSource.slice(0, scopeStart).split("\n").length;
      const updatedSlice = applyHunksToScope(
        scopeSlice,
        hunks,
        anchorSymbol || ":hunk",
        filePath,
        targetLang,
        idioms,
        hunkIdiomsOn,
        false,
        scopeStartLine,
        { nativeSource, scopeStartOffset: scopeStart, scopeEndOffset: scopeEnd },
      );
      const modifiedCode = `${nativeSource.slice(0, scopeStart)}${updatedSlice}${nativeSource.slice(scopeEnd)}`;
      const checkRes = validateNativeSyntax(modifiedCode, targetLang, filePath, idioms);
      if (
        !checkRes.valid &&
        validateNativeSyntax(nativeSource, targetLang, filePath).valid &&
        !options.force
      ) {
        throw new Error(
          `Pre-write syntax validation failed for ${filePath} (${targetLang}): ${checkRes.diagnostics.slice(0, 3).join("; ")}`,
        );
      }
      return {
        success: true,
        filePath,
        symbol: anchorSymbol || ":hunk",
        originalSnippet: hunks.map((h) => h.search).join("\n\n"),
        newSnippet: rawSnippet,
        diff: options.diff ? generateUnifiedDiff(filePath, nativeSource, modifiedCode) : undefined,
        modifiedCode,
        newAiceSource: modifiedCode,
        tokensSaved: estimateTokens(modifiedCode) - estimateTokens(rawSnippet),
      };
    }
  }

  if (targetLang === "css") {
    const root = postcss.parse(nativeSource, { from: filePath });
    const emitCssSnippet = (selectorFallback: string): string => {
      const { cleanedCode, inlineIdioms } = extractInlineIdiomsFromSource(rawSnippet);
      const mergedIdioms: Record<string, ProjectIdiomDefinition> = {
        ...(idioms ?? {}),
        ...inlineIdioms,
      };
      const trimmed = cleanedCode.trim();
      if (!trimmed) return "";
      if (!trimmed.startsWith("style ") && trimmed.includes("{") && trimmed.endsWith("}")) {
        return preprocessBareCssLossless(trimmed, mergedIdioms).trim();
      }
      const aiceText = trimmed.startsWith("style ")
        ? trimmed
        : `style ${selectorFallback}:\n${indentCode(trimmed, "  ")}`;
      const mod = parse(aiceText, filePath);
      const expanded =
        Object.keys(mergedIdioms).length > 0 ? expandModuleIdioms(mod, mergedIdioms) : mod;
      return emitTarget(expanded, "css", { watermark: false }).trim();
    };

    if (
      (options.append && !anchorSymbol) ||
      (anchorSymbol && /^(?:eof|end|append)$/i.test(anchorSymbol.trim()))
    ) {
      const emitted = emitCssSnippet(".rule");
      const sep = nativeSource.endsWith("\n") ? "\n" : "\n\n";
      const modifiedCode = `${nativeSource}${sep}${emitted}\n`;
      return {
        success: true,
        filePath,
        symbol: anchorSymbol ?? "eof",
        newSnippet: emitted,
        modifiedCode,
        newAiceSource: modifiedCode,
        tokensSaved: estimateTokens(modifiedCode) - estimateTokens(rawSnippet || emitted),
      };
    }

    if (!anchorSymbol) {
      throw new Error("Must specify target symbol with --symbol when splicing CSS file");
    }

    const cleanAnchor = anchorSymbol.trim().replace(/^[.#]/, "");
    let matchedRule: postcss.Rule | undefined;
    root.walkRules((rule) => {
      if (matchedRule) return;
      const sel = rule.selector.trim();
      const cleanSel = sel.replace(/^[.#]/, "");
      if (
        sel === anchorSymbol.trim() ||
        cleanSel === cleanAnchor ||
        cleanSel.replace(/[-_]/g, "").toLowerCase() ===
          cleanAnchor.replace(/[-_]/g, "").toLowerCase()
      ) {
        matchedRule = rule;
      }
    });

    if (!matchedRule || !matchedRule.source?.start || !matchedRule.source?.end) {
      if (!options.delete && !options.insertBefore && !options.insertAfter) {
        const emitted = emitCssSnippet(anchorSymbol.trim());
        const sep = nativeSource.endsWith("\n") ? "\n" : "\n\n";
        const modifiedCode = `${nativeSource}${sep}${emitted}\n`;
        return {
          success: true,
          filePath,
          symbol: anchorSymbol,
          newSnippet: emitted,
          modifiedCode,
          newAiceSource: modifiedCode,
          tokensSaved: estimateTokens(modifiedCode) - estimateTokens(rawSnippet || emitted),
        };
      }
      throw new Error(`CSS selector '${anchorSymbol}' not found in ${filePath}`);
    }

    const startOffset = matchedRule.source.start.offset;
    const rawEnd = matchedRule.source.end.offset;
    const endOffset =
      !nativeSource.slice(startOffset, rawEnd).trimEnd().endsWith("}") &&
      nativeSource[rawEnd] === "}"
        ? rawEnd + 1
        : rawEnd;
    const originalSnippet = nativeSource.slice(startOffset, endOffset);
    let newSnippet = "";
    let modifiedCode = nativeSource;

    if (options.delete) {
      let delEnd = endOffset;
      while (
        delEnd < nativeSource.length &&
        (nativeSource[delEnd] === "\r" || nativeSource[delEnd] === "\n")
      ) {
        delEnd++;
      }
      modifiedCode = `${nativeSource.slice(0, startOffset)}${nativeSource.slice(delEnd)}`;
    } else if (options.insertBefore || options.insertAfter) {
      newSnippet = emitCssSnippet(matchedRule.selector.trim());
      if (options.insertBefore) {
        modifiedCode = `${nativeSource.slice(0, startOffset)}${newSnippet}\n\n${nativeSource.slice(startOffset)}`;
      } else {
        modifiedCode = `${nativeSource.slice(0, endOffset)}\n\n${newSnippet}${nativeSource.slice(endOffset)}`;
      }
    } else {
      newSnippet = emitCssSnippet(matchedRule.selector.trim());
      modifiedCode = `${nativeSource.slice(0, startOffset)}${newSnippet}${nativeSource.slice(endOffset)}`;
    }

    return {
      success: true,
      filePath,
      symbol: anchorSymbol,
      originalSnippet,
      newSnippet,
      diff: options.diff ? generateUnifiedDiff(filePath, nativeSource, modifiedCode) : undefined,
      modifiedCode,
      newAiceSource: modifiedCode,
      tokensSaved: estimateTokens(modifiedCode) - estimateTokens(rawSnippet || newSnippet),
    };
  }

  if (targetLang === "json" || targetLang === "yaml") {
    const parseSnippetMeta = (): { declName?: string; value: any } => {
      const trimmed = rawSnippet
        .trim()
        .replace(
          /^(?:pub\s+)?(?:const|val|mut|let)?\s*(?:config\.)([A-Za-z_][A-Za-z0-9_]*)\s*(?::=|=)\s*/,
          "pub const $1 = ",
        );
      if (!trimmed) return { value: {} };
      const hasExplicitDecl = /^(?:pub\s+)?(?:const|val|mut)\s+/.test(trimmed);
      const candidates = [trimmed, hasExplicitDecl ? trimmed : `pub const __v = ${trimmed}`];
      for (const cand of candidates) {
        try {
          const mod = parse(cand, filePath);
          const expanded =
            idioms && Object.keys(idioms).length > 0 ? expandModuleIdioms(mod, idioms) : mod;
          const first = expanded.items[0];
          if (first && (first.kind === "ConstDecl" || first.kind === "VarDecl")) {
            return {
              declName: first.name !== "__v" ? first.name : undefined,
              value: astToValue(first.value),
            };
          }
          if (first && first.kind === "FunctionDecl" && "statements" in first.body) {
            const st = first.body.statements[0];
            if (st && st.kind === "LetBinding")
              return {
                declName: st.name !== "__v" ? st.name : undefined,
                value: astToValue(st.init),
              };
            if (st && st.kind === "AssignStmt") return { value: astToValue(st.value) };
            if (st && st.kind === "ExprStmt") return { value: astToValue(st.expr) };
          }
        } catch {
          // continue
        }
      }
      if (targetLang === "json") {
        return { value: JSON.parse(stripJsonComments(trimmed)) };
      }
      return { value: YAML.parse(trimmed) };
    };

    if (!anchorSymbol && !options.append) {
      throw new Error(
        `Must specify target key with --symbol when splicing ${targetLang.toUpperCase()} file`,
      );
    }

    if (targetLang === "yaml") {
      const doc = YAML.parseDocument(nativeSource);
      if (!doc.contents) {
        doc.contents = doc.createNode({}) as any;
      }

      if (
        (options.append && !anchorSymbol) ||
        (anchorSymbol && /^(?:eof|end|append)$/i.test(anchorSymbol.trim()))
      ) {
        const { declName, value: newVal } = parseSnippetMeta();
        if (declName && declName !== "config") {
          doc.setIn([declName], doc.createNode(newVal));
        } else if (typeof newVal === "object" && newVal !== null && !Array.isArray(newVal)) {
          for (const [k, v] of Object.entries(newVal)) {
            doc.setIn([k], doc.createNode(v));
          }
        } else {
          doc.setIn(["config"], doc.createNode(newVal));
        }
        const newSnippet = YAML.stringify(newVal).trimEnd();
        const modifiedCode = doc.toString();
        return {
          success: true,
          filePath,
          newSnippet,
          diff: options.diff
            ? generateUnifiedDiff(filePath, nativeSource, modifiedCode)
            : undefined,
          modifiedCode,
          newAiceSource: modifiedCode,
          tokensSaved: estimateTokens(modifiedCode) - estimateTokens(rawSnippet || newSnippet),
        };
      }

      const keyParts = (anchorSymbol ?? "config").split(".").filter(Boolean);
      if (keyParts.length > 1 && keyParts[0] === "config" && !doc.hasIn(["config"])) {
        keyParts.shift();
      }

      const isRootConfig =
        keyParts.length === 1 && keyParts[0] === "config" && !doc.hasIn(["config"]);
      if (options.delete && !isRootConfig && !doc.hasIn(keyParts)) {
        throw new Error(`Key '${anchorSymbol}' not found in ${filePath}`);
      }

      const origNode = isRootConfig ? doc.contents : doc.getIn(keyParts, true);
      const origVal =
        origNode && typeof (origNode as { toJSON?: () => unknown }).toJSON === "function"
          ? (origNode as { toJSON: () => unknown }).toJSON()
          : origNode;
      const originalSnippet = origVal !== undefined ? YAML.stringify(origVal).trimEnd() : "";

      let newSnippet = "";
      if (options.delete) {
        const normKeys = keyParts.map((k) => (/^\d+$/.test(k) ? Number(k) : k));
        doc.deleteIn(normKeys);
      } else {
        const parsedMeta = parseSnippetMeta();
        const declName = parsedMeta.declName;
        const leaf = keyParts[keyParts.length - 1];
        let newVal = parsedMeta.value;
        if (
          typeof newVal === "object" &&
          newVal !== null &&
          !Array.isArray(newVal) &&
          Object.keys(newVal).length === 1 &&
          Object.keys(newVal)[0] === leaf &&
          (!origVal ||
            typeof origVal !== "object" ||
            !(leaf in (origVal as Record<string, unknown>)))
        ) {
          newVal = (newVal as Record<string, unknown>)[leaf];
        }
        if (
          (options.insertAfter || options.insertBefore) &&
          declName &&
          declName !== "config" &&
          declName !== leaf
        ) {
          const siblingKeys = [...keyParts.slice(0, -1), declName];
          doc.setIn(siblingKeys, doc.createNode(newVal));
        } else if (
          (options.insertAfter || options.insertBefore || options.append) &&
          Array.isArray(origVal)
        ) {
          const itemsToAdd = Array.isArray(newVal) ? newVal : [newVal];
          const nextArr = options.insertBefore
            ? [...itemsToAdd, ...origVal]
            : [...origVal, ...itemsToAdd];
          doc.setIn(keyParts, doc.createNode(nextArr));
        } else {
          const newNode = doc.createNode(newVal);
          if (YAML.isMap(origNode) && YAML.isMap(newNode)) {
            if (origNode.anchor) {
              newNode.anchor = origNode.anchor;
            }
            const mergePair = origNode.items.find(
              (p) => YAML.isScalar(p.key) && p.key.value === "<<",
            );
            if (mergePair && typeof newVal === "object" && newVal !== null && !("<<" in newVal)) {
              (newNode.items as unknown[]).unshift(mergePair);
            }
          }
          if (isRootConfig && typeof newVal === "object" && newVal !== null) {
            doc.contents = newNode as any;
          } else {
            doc.setIn(keyParts, newNode);
          }
        }
        newSnippet = YAML.stringify(newVal).trimEnd();
      }

      const modifiedCode = doc.toString();
      return {
        success: true,
        filePath,
        symbol: anchorSymbol,
        originalSnippet,
        newSnippet,
        diff: options.diff ? generateUnifiedDiff(filePath, nativeSource, modifiedCode) : undefined,
        modifiedCode,
        newAiceSource: modifiedCode,
        tokensSaved: estimateTokens(modifiedCode) - estimateTokens(rawSnippet || newSnippet),
      };
    }

    // JSON handling
    let docObj: Record<string, any> = {};
    const trimmedJson = nativeSource.trim();
    if (trimmedJson) {
      try {
        docObj = JSON.parse(nativeSource);
      } catch {
        docObj = JSON.parse(stripJsonComments(nativeSource));
      }
    }

    if (
      (options.append && !anchorSymbol) ||
      (anchorSymbol && /^(?:eof|end|append)$/i.test(anchorSymbol.trim()))
    ) {
      const { declName, value: newVal } = parseSnippetMeta();
      if (declName && declName !== "config") {
        docObj[declName] = newVal;
      } else if (typeof newVal === "object" && newVal !== null && !Array.isArray(newVal)) {
        Object.assign(docObj, newVal);
      } else {
        docObj.config = newVal;
      }
      const newSnippet = JSON.stringify(newVal, null, 2);
      const modifiedCode = `${JSON.stringify(docObj, null, 2)}\n`;
      return {
        success: true,
        filePath,
        newSnippet,
        diff: options.diff ? generateUnifiedDiff(filePath, nativeSource, modifiedCode) : undefined,
        modifiedCode,
        newAiceSource: modifiedCode,
        tokensSaved: estimateTokens(modifiedCode) - estimateTokens(rawSnippet || newSnippet),
      };
    }

    const keyParts = (anchorSymbol ?? "config").split(".").filter(Boolean);
    if (keyParts.length > 1 && keyParts[0] === "config" && !Object.hasOwn(docObj, "config")) {
      keyParts.shift();
    }

    let parent: any = docObj;
    for (let i = 0; i < keyParts.length - 1; i++) {
      const k = keyParts[i];
      if (parent[k] === undefined || typeof parent[k] !== "object" || parent[k] === null) {
        if (options.delete) {
          throw new Error(`Key '${anchorSymbol}' not found in ${filePath}`);
        }
        parent[k] = {};
      }
      parent = parent[k];
    }

    const leafKey = keyParts[keyParts.length - 1];
    if (
      options.delete &&
      !(leafKey in parent) &&
      !(keyParts.length === 1 && leafKey === "config")
    ) {
      throw new Error(`Key '${anchorSymbol}' not found in ${filePath}`);
    }

    const origVal = leafKey === "config" && !(leafKey in parent) ? docObj : parent[leafKey];
    const originalSnippet = origVal !== undefined ? JSON.stringify(origVal, null, 2) : "";

    let newSnippet = "";
    if (options.delete) {
      if (Array.isArray(parent) && /^\d+$/.test(leafKey)) {
        parent.splice(Number(leafKey), 1);
      } else {
        delete parent[leafKey];
      }
    } else {
      const parsedMeta = parseSnippetMeta();
      const declName = parsedMeta.declName;
      let newVal = parsedMeta.value;
      if (
        typeof newVal === "object" &&
        newVal !== null &&
        !Array.isArray(newVal) &&
        Object.keys(newVal).length === 1 &&
        Object.keys(newVal)[0] === leafKey &&
        (!origVal ||
          typeof origVal !== "object" ||
          !(leafKey in (origVal as Record<string, unknown>)))
      ) {
        newVal = (newVal as Record<string, unknown>)[leafKey];
      }
      if (
        (options.insertAfter || options.insertBefore) &&
        declName &&
        declName !== "config" &&
        declName !== leafKey &&
        !Array.isArray(parent)
      ) {
        parent[declName] = newVal;
      } else if (
        (options.insertAfter || options.insertBefore || options.append) &&
        Array.isArray(origVal)
      ) {
        const itemsToAdd = Array.isArray(newVal) ? newVal : [newVal];
        parent[leafKey] = options.insertBefore
          ? [...itemsToAdd, ...origVal]
          : [...origVal, ...itemsToAdd];
      } else if (
        leafKey === "config" &&
        !(leafKey in parent) &&
        typeof newVal === "object" &&
        newVal !== null
      ) {
        docObj = newVal;
      } else {
        parent[leafKey] = newVal;
      }
      newSnippet = JSON.stringify(newVal, null, 2);
    }

    const modifiedCode = `${JSON.stringify(docObj, null, 2)}\n`;

    return {
      success: true,
      filePath,
      symbol: anchorSymbol,
      originalSnippet,
      newSnippet,
      diff: options.diff ? generateUnifiedDiff(filePath, nativeSource, modifiedCode) : undefined,
      modifiedCode,
      newAiceSource: modifiedCode,
      tokensSaved: estimateTokens(modifiedCode) - estimateTokens(rawSnippet || newSnippet),
    };
  }

  if (targetLang === "html" || targetLang === "twig") {
    const HTML_VOID_ELEMENTS = new Set([
      "area",
      "base",
      "br",
      "col",
      "embed",
      "hr",
      "img",
      "input",
      "link",
      "meta",
      "param",
      "source",
      "track",
      "wbr",
    ]);

    const emitTemplateFragment = (): string => {
      const { cleanedCode, inlineIdioms } = extractInlineIdiomsFromSource(rawSnippet);
      const mergedIdioms: Record<string, ProjectIdiomDefinition> = {
        ...(idioms ?? {}),
        ...inlineIdioms,
      };
      const trimmed = cleanedCode
        .trim()
        .replace(/^([ \t]*)block\s+["']([^"']+)["']\s*:/gm, '$1block(name: "$2"):');
      if (!trimmed) return "";
      if (trimmed.startsWith("<") || trimmed.startsWith("{%")) {
        return preprocessHybridAndIdiomsLossless(trimmed, targetLang, mergedIdioms).trim();
      }
      const hasTopLevelComponent = /^(?:(?:#[^\n]*|module\s+[^\n]+)\n+|\s)*component\s+/m.test(
        trimmed,
      );
      const aiceText = hasTopLevelComponent
        ? trimmed
        : `component __Frag():\n${indentCode(trimmed, "  ")}`;
      const mod = parse(aiceText, filePath);
      const expanded =
        Object.keys(mergedIdioms).length > 0 ? expandModuleIdioms(mod, mergedIdioms) : mod;
      let emitted = emitTarget(expanded, targetLang, { watermark: false }).trim();
      if (targetLang === "html") {
        emitted = emitted.replace(/^<!DOCTYPE html>\s*/i, "").trim();
      }
      return emitted;
    };

    if (
      (options.append && !anchorSymbol) ||
      (anchorSymbol && /^(?:eof|end|append)$/i.test(anchorSymbol.trim()))
    ) {
      const emitted = emitTemplateFragment();
      const modifiedCode = `${nativeSource.trimEnd()}\n${emitted}\n`;
      return {
        success: true,
        filePath,
        newSnippet: emitted,
        modifiedCode,
        newAiceSource: modifiedCode,
        tokensSaved: estimateTokens(modifiedCode) - estimateTokens(rawSnippet || emitted),
      };
    }

    if (!anchorSymbol) {
      throw new Error(
        `Must specify target selector with --symbol when splicing ${targetLang.toUpperCase()} file`,
      );
    }

    let sel = anchorSymbol.trim();
    const isTopLevelCompSnippet = /^(?:(?:#[^\n]*|module\s+[^\n]+)\n+|\s)*component\s+/m.test(
      rawSnippet.trim(),
    );
    let spanStart = -1;
    let spanEnd = -1;

    if (
      !sel.startsWith("#") &&
      !sel.startsWith(".") &&
      !sel.startsWith("block:") &&
      /^[A-Z]/.test(sel)
    ) {
      if (
        isTopLevelCompSnippet &&
        !options.insertBefore &&
        !options.insertAfter &&
        !options.delete
      ) {
        const doctypeMatch = nativeSource.match(/^<!DOCTYPE html>\s*/i);
        spanStart = doctypeMatch ? doctypeMatch[0].length : 0;
        spanEnd = nativeSource.length;
      } else {
        const blkMatch = rawSnippet.match(/\bblock(?:\s*\(\s*name\s*[:=]\s*|\s+)["']([^"']+)["']/);
        const idMatch = rawSnippet.match(/\bid\s*[:=]\s*["']([^"']+)["']/);
        if (blkMatch) {
          sel = blkMatch[1];
        } else if (idMatch) {
          sel = `#${idMatch[1]}`;
        }
      }
    }
    const strippedSel = sel
      .replace(/^[A-Z][A-Za-z0-9_]*\./, "")
      .replace(/^block(?::|\s+)/i, "")
      .trim();
    const cleanSel = strippedSel.replace(/^(?:#|\.)/, "");
    const escSel = cleanSel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // 1. Check Twig {% block <name> %}...{% endblock %} with balanced nesting support
    if (spanStart < 0 && targetLang === "twig") {
      const openBlockRe = new RegExp(`\\{%[-~]?\\s*block\\s+${escSel}\\b([^%]*)%\\}`);
      const openMatch = openBlockRe.exec(nativeSource);
      if (openMatch && openMatch.index !== undefined) {
        spanStart = openMatch.index;
        const afterName = (openMatch[1] ?? "").replace(/[-~]$/, "").trim();
        if (afterName.length > 0) {
          // Inline shorthand block: {% block name expr %}
          spanEnd = openMatch.index + openMatch[0].length;
        } else {
          const tokenRe = /\{%[-~]?\s*(block|endblock)\b([^%]*)%\}/g;
          tokenRe.lastIndex = openMatch.index + openMatch[0].length;
          let depth = 1;
          let tokMatch: RegExpExecArray | null = tokenRe.exec(nativeSource);
          while (depth > 0 && tokMatch !== null) {
            const kw = tokMatch[1];
            const rest = (tokMatch[2] ?? "").replace(/[-~]$/, "").trim();
            if (kw === "block") {
              // Only increment depth if not a single-tag inline block {% block foo bar %}
              if (/^[a-zA-Z0-9_-]+$/.test(rest)) {
                depth++;
              }
            } else if (kw === "endblock") {
              depth--;
              if (depth === 0) {
                spanEnd = tokMatch.index + tokMatch[0].length;
                break;
              }
            }
            tokMatch = tokenRe.exec(nativeSource);
          }
        }
      }
    }

    // 2. Check HTML/Twig element by compound selector (`section#id`, `div.cls`, `section.cls#id`, `#id`, `.cls`) or bare id/class/tag
    if (spanStart < 0) {
      const compoundMatch =
        /^(?:([a-zA-Z][a-zA-Z0-9-]*))?((?:(?:#[A-Za-z0-9_-]+)|(?:\.[A-Za-z0-9_-]+))+)$/.exec(
          strippedSel,
        );
      const reqTag = compoundMatch?.[1]?.toLowerCase();
      let reqId: string | undefined;
      const reqClasses: string[] = [];
      if (compoundMatch?.[2]) {
        const modTokens = compoundMatch[2].match(/[#.][A-Za-z0-9_-]+/g) ?? [];
        for (const tok of modTokens) {
          if (tok.startsWith("#")) {
            reqId = tok.slice(1);
          } else if (tok.startsWith(".")) {
            reqClasses.push(tok.slice(1));
          }
        }
      }

      const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const openTagRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?)\s*(\/?)>/g;
      let match: RegExpExecArray | null = openTagRe.exec(nativeSource);
      while (match !== null) {
        const tag = match[1];
        const attrs = match[2] ?? "";
        const selfCloseSlash = match[3] ?? "";

        let isElementMatch = false;
        if (compoundMatch) {
          const tagOk = !reqTag || tag.toLowerCase() === reqTag;
          const idOk = !reqId || new RegExp(`\\bid=["']${escRe(reqId)}["']`).test(attrs);
          const classesOk = reqClasses.every((cls) =>
            new RegExp(`\\bclass=["'][^"']*\\b${escRe(cls)}\\b[^"']*["']`).test(attrs),
          );
          isElementMatch = tagOk && idOk && classesOk;
        } else {
          const isIdMatch = new RegExp(`\\bid=["']${escSel}["']`).test(attrs);
          const isClassMatch = new RegExp(`\\bclass=["'][^"']*\\b${escSel}\\b[^"']*["']`).test(
            attrs,
          );
          const isTagMatch = tag.toLowerCase() === cleanSel.toLowerCase();
          isElementMatch = isTagMatch || isIdMatch || isClassMatch;
        }

        if (isElementMatch) {
          spanStart = match.index;
          const lowerTag = tag.toLowerCase();
          if (selfCloseSlash === "/" || HTML_VOID_ELEMENTS.has(lowerTag)) {
            spanEnd = match.index + match[0].length;
          } else {
            const escTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const tagRe = new RegExp(`<(\\/?)${escTag}\\b((?:[^>"']|"[^"]*"|'[^']*')*)>`, "gi");
            tagRe.lastIndex = match.index + match[0].length;
            let depth = 1;
            let tMatch: RegExpExecArray | null = tagRe.exec(nativeSource);
            while (depth > 0 && tMatch !== null) {
              const isClosing = tMatch[1] === "/";
              const innerTail = (tMatch[2] ?? "").trimEnd();
              if (isClosing) {
                depth--;
                if (depth === 0) {
                  spanEnd = tMatch.index + tMatch[0].length;
                  break;
                }
              } else if (!innerTail.endsWith("/") && !HTML_VOID_ELEMENTS.has(lowerTag)) {
                depth++;
              }
              tMatch = tagRe.exec(nativeSource);
            }
          }
          break;
        }
        match = openTagRe.exec(nativeSource);
      }
    }

    if (spanStart < 0 || spanEnd < spanStart) {
      throw new Error(`Template element or block '${anchorSymbol}' not found in ${filePath}`);
    }

    const originalSnippet = nativeSource.slice(spanStart, spanEnd);
    let newSnippet = "";
    let modifiedCode = nativeSource;

    if (options.delete) {
      modifiedCode = `${nativeSource.slice(0, spanStart)}${nativeSource.slice(spanEnd)}`;
    } else if (options.insertBefore || options.insertAfter) {
      newSnippet = emitTemplateFragment();
      if (options.insertBefore) {
        modifiedCode = `${nativeSource.slice(0, spanStart)}${newSnippet}\n${nativeSource.slice(spanStart)}`;
      } else {
        modifiedCode = `${nativeSource.slice(0, spanEnd)}\n${newSnippet}${nativeSource.slice(spanEnd)}`;
      }
    } else {
      newSnippet = emitTemplateFragment();
      modifiedCode = `${nativeSource.slice(0, spanStart)}${newSnippet}${nativeSource.slice(spanEnd)}`;
    }

    return {
      success: true,
      filePath,
      symbol: anchorSymbol,
      originalSnippet,
      newSnippet,
      diff: options.diff ? generateUnifiedDiff(filePath, nativeSource, modifiedCode) : undefined,
      modifiedCode,
      newAiceSource: modifiedCode,
      tokensSaved: estimateTokens(modifiedCode) - estimateTokens(rawSnippet || newSnippet),
    };
  }

  return undefined;
}
