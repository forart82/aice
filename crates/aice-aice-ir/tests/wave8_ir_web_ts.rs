use std::path::Path;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn roundtrip(lang: LanguageId, vname: &str, src: &str) -> (String, String) {
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;
    let tree = reg.adapter(lang).unwrap().parse_cst(src).unwrap();
    let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, src, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled for {lang:?}");
    };
    let aice = print_aice(&m);
    let reparsed = parse_aice(&aice).unwrap_or_else(|e| panic!("parse_aice failed for {vname}: {e}\n--- AICE ---\n{aice}"));
    let native = tr.to_native(&reparsed, lang).unwrap_or_else(|e| panic!("to_native failed for {vname}: {e}"));
    let verdict = fw.verify(&native, Path::new(vname), lang);
    assert_eq!(verdict, FirewallVerdict::Valid, "firewall rejected {vname}:\n--- NATIVE ---\n{native}\n--- AICE ---\n{aice}");
    (aice, native)
}

#[test]
fn v8_tsw_04_js_ts_default_imports_preserved() {
    let mjs = r#"import path from "node:path";
export const p = path.join("a", "b");
"#;
    let (js_aice, js_nat) = roundtrip(LanguageId::JavaScript, "repro_v4.mjs", mjs);
    assert!(js_aice.contains(r#"from "node:path" import default as path"#), "IR:\n{js_aice}");
    assert!(js_nat.contains(r#"import path from "node:path";"#), "native:\n{js_nat}");
    assert!(!js_nat.contains(r#"import { path }"#), "regressed to named import:\n{js_nat}");

    let tsx = r#"import React, { useState, useMemo as memo, type FC } from "react";
import DefaultOnly from "./default_only";
import DefaultAndNs, * as Ns from "./combo";
import type Config from "./config";
import type * as Types from "./types";
import * as fs from "node:fs";
import "./side.css";

export const svc = new DefaultOnly();
export type AppCfg = Config;
export function Demo(props: { label: string }) {
  const [n] = useState(0);
  const tag = memo(() => props.label, [props.label]);
  return <section>{tag}:{n}:{React.version}:{Ns.ok}:{DefaultAndNs.id}:{fs.sep}</section>;
}
"#;
    let (tsx_aice, tsx_nat) = roundtrip(LanguageId::Tsx, "imports.tsx", tsx);
    assert!(tsx_aice.contains(r#"from "react" import default as React, useState, useMemo as memo, type FC"#), "{tsx_aice}");
    assert!(tsx_aice.contains(r#"from "./default_only" import default as DefaultOnly"#), "{tsx_aice}");
    assert!(tsx_aice.contains(r#"from "./combo" import default as DefaultAndNs, * as Ns"#), "{tsx_aice}");
    assert!(tsx_aice.contains(r#"from "./config" import type default as Config"#), "{tsx_aice}");
    assert!(tsx_aice.contains(r#"from "./types" import type * as Types"#), "{tsx_aice}");

    assert!(tsx_nat.contains(r#"import React, { useState, useMemo as memo, type FC } from "react";"#), "{tsx_nat}");
    assert!(tsx_nat.contains(r#"import DefaultOnly from "./default_only";"#), "{tsx_nat}");
    assert!(tsx_nat.contains(r#"import DefaultAndNs, * as Ns from "./combo";"#), "{tsx_nat}");
    assert!(tsx_nat.contains(r#"import type Config from "./config";"#), "{tsx_nat}");
    assert!(tsx_nat.contains(r#"import type * as Types from "./types";"#), "{tsx_nat}");
    assert!(tsx_nat.contains(r#"import * as fs from "node:fs";"#), "{tsx_nat}");
    assert!(tsx_nat.contains(r#"import "./side.css";"#), "{tsx_nat}");
    assert!(tsx_nat.contains("new DefaultOnly()"), "lost new on default-imported class:\n{tsx_nat}");
}

#[test]
fn v8_tsw_05_jsx_spread_attributes_preserved() {
    let repro = r#"export function List(props: { id: string; className?: string }) {
  const { id, ...rest } = props;
  return <ul id={id} {...rest}><li /></ul>;
}
"#;
    let (aice, nat) = roundtrip(LanguageId::Tsx, "repro_v5.tsx", repro);
    assert!(aice.contains("ul(id: id, ...rest):"), "IR dropped spread:\n{aice}");
    assert!(nat.contains("<ul id={id} {...rest}>"), "native dropped spread:\n{nat}");

    let complex = r#"export function Panel(props: { id: string; items: { id: string }[]; extra: Record<string, unknown> }) {
  const { id, items, extra, ...rest } = props;
  if (items.length === 0) {
    return <div {...rest} data-empty="yes"><span {...extra} /></div>;
  }
  return (
    <section {...rest} id={id} {...extra}>
      {/* comment */}
      <input {...getInputProps(id)} disabled />
      <ul>
        {items.map((it) => (
          <li key={it.id} {...rest}>{it.id}</li>
        ))}
      </ul>
    </section>
  );
}
"#;
    let (c_aice, c_nat) = roundtrip(LanguageId::Tsx, "spread_complex.tsx", complex);
    assert!(c_aice.contains("section(...rest, id: id, ...extra):"), "IR:\n{c_aice}");
    assert!(c_aice.contains("input(...getInputProps(id), disabled)"), "IR:\n{c_aice}");
    assert!(c_nat.contains("<section {...rest} id={id} {...extra}>"), "native:\n{c_nat}");
    assert!(c_nat.contains("<input {...getInputProps(id)} disabled />"), "native:\n{c_nat}");
    assert!(c_nat.contains("<div {...rest} data-empty=\"yes\">"), "inline jsx spread lost:\n{c_nat}");
    assert!(c_nat.contains("<span {...extra} />"), "inline self-closing jsx spread lost:\n{c_nat}");
    assert!(c_nat.contains("<li key={it.id} {...rest}>"), "map jsx spread lost:\n{c_nat}");
}

#[test]
fn v8_tsw_06_ts_unknown_not_weakened_to_any() {
    let ts = r#"export type M = Record<string, unknown>;
export type Loose = Record<string, any>;
export interface Box {
  payload: unknown;
  items: unknown[];
  maybe: unknown | null;
  raw: any;
}
export function id(x: unknown): unknown {
  return x;
}
export async function load(): Promise<unknown> {
  return null;
}
"#;
    let (aice, nat) = roundtrip(LanguageId::TypeScript, "repro_v7.ts", ts);
    assert!(aice.contains("Record[str, unknown]"), "IR:\n{aice}");
    assert!(aice.contains("fn id(x:unknown) -> unknown"), "IR:\n{aice}");
    assert!(nat.contains("export type M = Record<string, unknown>;"), "native:\n{nat}");
    assert!(nat.contains("export type Loose = Record<string, any>;"), "native:\n{nat}");
    assert!(nat.contains("payload: unknown;"), "native:\n{nat}");
    assert!(nat.contains("items: unknown[];"), "native:\n{nat}");
    assert!(nat.contains("maybe: unknown | null;"), "native:\n{nat}");
    assert!(nat.contains("raw: any;"), "native:\n{nat}");
    assert!(nat.contains("export function id(x: unknown): unknown"), "native:\n{nat}");
    assert!(nat.contains("export async function load(): Promise<unknown>"), "native:\n{nat}");

    let tsx = r#"export function Viewer(props: { data: unknown }) {
  return <pre>{String(props.data)}</pre>;
}
"#;
    let (_, tsx_nat) = roundtrip(LanguageId::Tsx, "unknown_tsx.tsx", tsx);
    assert!(tsx_nat.contains("data: unknown"), "TSX weakened unknown:\n{tsx_nat}");
}

#[test]
fn v8_tsw_06_html_mixed_inline_text_and_elements() {
    let repro = "<p>Mixed <b>Bold &amp; Bright</b> &amp; tail text</p>\n";
    let (aice, nat) = roundtrip(LanguageId::Html, "repro_v6.html", repro);
    assert!(aice.contains("Mixed"), "IR dropped leading text:\n{aice}");
    assert!(aice.contains("Bold &amp; Bright"), "IR dropped bold text:\n{aice}");
    assert!(aice.contains("&amp; tail text"), "IR dropped tail text:\n{aice}");
    assert_eq!(nat.trim(), "<p>Mixed <b>Bold &amp; Bright</b> &amp; tail text</p>", "native:\n{nat}");

    let full = r#"<!DOCTYPE html>
<html lang="en">
<head><title>A &amp; B &lt; C &gt; D</title></head>
<body>
  <h1>Hello &amp; Welcome &mdash; &copy; 2026</h1>
  <p title="Rock &amp; Roll">Price: 5 &lt; 10 &amp;&amp; 20 &gt; 15 &#169; &#x2764;</p>
  <p>Mixed <b>Bold &amp; Bright</b> &amp; tail text</p>
  <p>Hello <b>world</b>!</p>
  <p>See <a href="/x"><b>this</b> link</a> and <em>more</em>.</p>
  <p><b>Lead</b> tail</p>
  <p>Head <i>end</i></p>
</body>
</html>
"#;
    let (full_aice, full_nat) = roundtrip(LanguageId::Html, "mixed_full.html", full);
    assert!(!full_nat.contains("<#text"), "invalid #text tag emitted:\n{full_nat}");
    assert!(full_nat.contains("<p>Mixed <b>Bold &amp; Bright</b> &amp; tail text</p>"), "native:\n{full_nat}\nIR:\n{full_aice}");
    assert!(full_nat.contains("<p>Hello <b>world</b>!</p>"), "punctuation spacing wrong:\n{full_nat}");
    assert!(full_nat.contains("<p>See <a href=\"/x\"><b>this</b> link</a> and <em>more</em>.</p>"), "nested inline wrong:\n{full_nat}");
    assert!(full_nat.contains("<p><b>Lead</b> tail</p>"), "lead elem wrong:\n{full_nat}");
    assert!(full_nat.contains("<p>Head <i>end</i></p>"), "tail elem wrong:\n{full_nat}");

    // Pure block HTML with indentation must NOT produce spurious #text nodes
    let block = "<!doctype html>\n<html lang=\"en\">\n  <body>\n    <main id=\"app\">\n      <h1>Golden</h1>\n    </main>\n  </body>\n</html>\n";
    let (blk_aice, blk_nat) = roundtrip(LanguageId::Html, "block.html", block);
    assert!(!blk_aice.contains("#text"), "spurious #text in block html:\n{blk_aice}");
    assert!(blk_nat.contains("<h1>Golden</h1>"), "native:\n{blk_nat}");

    // Mixed HTML with inline comment inside child preserves comment and text without <#text>
    let with_comment = "<p>Intro <!-- note --> <b>Bold</b> tail</p>\n";
    let (_, cmt_nat) = roundtrip(LanguageId::Html, "mixed_comment.html", with_comment);
    assert!(!cmt_nat.contains("<#text"), "invalid #text tag emitted:\n{cmt_nat}");
    assert!(cmt_nat.contains("Intro") && cmt_nat.contains("<b>Bold</b>") && cmt_nat.contains("tail"), "native:\n{cmt_nat}");
}
