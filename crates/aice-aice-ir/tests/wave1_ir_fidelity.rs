use std::path::Path;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::{print_aice, print_aice_with_opts};
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
fn f01_tsx_component_body_hooks_handlers_early_returns_and_visibility() {
    let tsx = r#"
import React, { useEffect, useMemo, useState } from "react";

function ChipGroup({ items, label }: { items: string[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <div className="chips">
      <span>{label}</span>
    </div>
  );
}

export function DataTable<T extends { id: string }>({
  rows,
  onSelect,
}: {
  rows: T[];
  onSelect?: (row: T) => void;
}) {
  const [selectedId, setSelectedId] = useState(null);
  const sorted = useMemo(() => [...rows].sort((a, b) => a.id.localeCompare(b.id)), [rows]);
  useEffect(() => {
    setSelectedId(null);
  }, [rows]);
  function handlePick(row: T) {
    setSelectedId(row.id);
    onSelect?.(row);
  }
  if (sorted.length === 0) {
    return <div>Empty</div>;
  }
  return (
    <div className="data-table" data-count={sorted.length}>
      <button onClick={() => handlePick(sorted[0])}>{selectedId}</button>
    </div>
  );
}

export function StatusCard(props: { title: string }) {
  return <section className="status-card"><h2>{props.title}</h2></section>;
}
"#;
    let (aice, native) = roundtrip(LanguageId::Tsx, "table.tsx", tsx);

    // Non-exported component must NOT be `pub component ChipGroup`
    assert!(aice.contains("\ncomponent ChipGroup("), "ChipGroup lost default vis:\n{aice}");
    assert!(!aice.contains("pub component ChipGroup"), "ChipGroup hardcoded pub:\n{aice}");
    assert!(aice.contains("if items.length == 0:"), "ChipGroup lost early return:\n{aice}");

    // Exported generic component preserves type param, hooks, handlers, early return, JSX
    assert!(aice.contains("pub component DataTable[T:"), "DataTable lost generic <T>:\n{aice}");
    assert!(aice.contains("useState(nil)"), "DataTable lost useState:\n{aice}");
    assert!(aice.contains("useMemo("), "DataTable lost useMemo:\n{aice}");
    assert!(aice.contains("useEffect("), "DataTable lost useEffect:\n{aice}");
    assert!(aice.contains("handlePick :="), "DataTable lost local handler:\n{aice}");
    assert!(aice.contains("onSelect?.(row)"), "DataTable lost optional call:\n{aice}");
    assert!(aice.contains("if sorted.length == 0:"), "DataTable lost early return:\n{aice}");
    assert!(aice.contains("div(className: \"data-table\""), "DataTable lost JSX:\n{aice}");

    // Simple component retains StatusCard golden header without ret: wrapper
    assert!(aice.contains("pub component StatusCard("), "StatusCard header regressed:\n{aice}");

    // Native output preserves logic + visibility + generic
    assert!(native.contains("function ChipGroup(") && !native.contains("export function ChipGroup("), "{native}");
    assert!(native.contains("export function DataTable<T extends"), "{native}");
    assert!(native.contains("useState(null)") && native.contains("useMemo(") && native.contains("useEffect("), "{native}");
}

#[test]
fn f02_ts_tsx_js_spread_shorthand_optional_index_call_decorators_rest_ctor_readonly() {
    let ts = r#"
export interface Entry<K, V> {
  readonly key: K;
  rows: readonly V[];
  meta?: string;
}

export function cloneLootItem(item: any): any {
  return {
    ...item,
    stats: item.stats.map((st: any) => ({ ...st })),
  };
}

export function dismantleByRarity(kept: any[], dismantledIds: string[], powderGained: number) {
  return {
    inventory: kept,
    dismantledCount: dismantledIds.length,
    powderGained,
    dismantledIds,
  };
}

export function pickFile(e: any, onSelect?: (f: any) => void) {
  const first = e.target.files?.[0];
  const label = e.target?.name.trim();
  onSelect?.(first);
  return { first, label };
}

export function wrapCall(target: any) {
  return function (this: any, ...args: any[]): any {
    return target.apply(this, args);
  };
}

@sealed
export class GenericPipeline<TIn, TOut> {
  constructor(private readonly name: string, protected count: number, public flag?: boolean) {}

  @logCall
  public pipe(fn: any, ...extra: any[]): any {
    return fn(this.name, ...extra);
  }
}
"#;
    let (aice, native) = roundtrip(LanguageId::TypeScript, "loot_pipe.ts", ts);

    // Interface readonly: `readonly key:K` preserved, `rows: readonly V[]` NOT falsely prefixed `readonly rows`
    assert!(aice.contains("readonly key:K"), "missing interface readonly key:\n{aice}");
    assert!(!aice.contains("readonly rows"), "false positive readonly on rows:\n{aice}");

    // Object spread & ES6 shorthand properties
    assert!(aice.contains("...item"), "dropped ...item spread:\n{aice}");
    assert!(aice.contains("...st"), "dropped ...st spread:\n{aice}");
    assert!(aice.contains("powderGained") && aice.contains("dismantledIds"), "dropped shorthand props:\n{aice}");

    // Optional subscript & optional call & non-corrupted chained member
    assert!(aice.contains("e.target.files?.[0]"), "corrupted optional subscript:\n{aice}");
    assert!(!aice.contains("[?.]"), "still emitting [?.]:\n{aice}");
    assert!(aice.contains("onSelect?.(first)"), "dropped optional call:\n{aice}");
    assert!(aice.contains("e.target?.name.trim()"), "corrupted chained .trim() after ?.:\n{aice}");

    // Rest prefix on closure & method params
    assert!(aice.contains("...args: [any]"), "dropped ... on closure rest param:\n{aice}");
    assert!(aice.contains("...extra:[any]"), "dropped ... on method rest param:\n{aice}");

    // Decorators on class & method
    assert!(aice.contains("@sealed"), "dropped @sealed class decorator:\n{aice}");
    assert!(aice.contains("@logCall"), "dropped @logCall method decorator:\n{aice}");

    // Constructor parameter-property modifiers
    assert!(aice.contains("priv readonly name:str"), "dropped priv readonly ctor param:\n{aice}");
    assert!(aice.contains("prot count:num"), "dropped prot ctor param:\n{aice}");
    assert!(aice.contains("pub flag?:bool"), "dropped pub optional ctor param:\n{aice}");

    // Native compiled TS preserves all semantics
    assert!(native.contains("...item") && native.contains("powderGained") && native.contains("dismantledIds"), "{native}");
    assert!(native.contains("e.target.files?.[0]") && native.contains("onSelect?.(first)"), "{native}");
    assert!(native.contains("@sealed") && native.contains("@logCall"), "{native}");
    assert!(native.contains("private readonly name: string"), "{native}");
    assert!(native.contains("...args"), "{native}");
}

#[test]
fn f03_rust_struct_shorthand_and_base_update() {
    let rs = r#"
pub struct Session {
    pub id: String,
    pub label: String,
    pub rows: u16,
    pub cols: u16,
}

impl Session {
    pub fn new(id: String, label: String, rows: u16, cols: u16, base: Session) -> Self {
        Self {
            id: id.into(),
            label,
            rows,
            cols,
            ..base
        }
    }
}

pub enum IpcMessage {
    SessionsList { sessions: Vec<String> },
}

pub fn list_msg(sessions: Vec<String>) -> IpcMessage {
    IpcMessage::SessionsList { sessions }
}
"#;
    let (aice, native) = roundtrip(LanguageId::Rust, "session.rs", rs);

    assert!(aice.contains("label") && aice.contains("rows") && aice.contains("cols"), "dropped Rust shorthand fields:\n{aice}");
    assert!(aice.contains("..base"), "dropped Rust ..base update:\n{aice}");
    assert!(aice.contains("IpcMessage::SessionsList({ sessions })"), "dropped Rust enum-variant shorthand:\n{aice}");
    assert!(native.contains("label") && native.contains("..base") && !native.contains("...base"), "Rust native invalid spread:\n{native}");
    assert!(native.contains("IpcMessage::SessionsList { sessions }"), "Rust native lost enum shorthand:\n{native}");
}

#[test]
fn f04_js_default_valued_params_assignment_pattern() {
    let js = r#"
export function checkToolsLocked(tool, $jq = getDefaultJq()) {
  $jq('.tools').attr('data-active', 'false');
  return tool;
}

export function initGlobals(targetWindow = globalThis) {
  return targetWindow;
}

export function configure({ retries } = {}, ...rest) {
  return rest.length;
}

export const add = (a, b = 10) => a + b;
"#;
    let (aice, native) = roundtrip(LanguageId::JavaScript, "tools.js", js);

    assert!(aice.contains("checkToolsLocked(tool, $jq = getDefaultJq())"), "dropped JS default param $jq:\n{aice}");
    assert!(aice.contains("initGlobals(targetWindow = globalThis)"), "dropped JS default param targetWindow:\n{aice}");
    assert!(aice.contains("configure(arg0 = {}, ...rest)"), "dropped JS destructured default/rest:\n{aice}");
    assert!(aice.contains("fn(a, b = 10) = a + b"), "dropped JS arrow default param:\n{aice}");
    assert!(native.contains("function checkToolsLocked(tool, $jq = getDefaultJq())"), "{native}");
    assert!(native.contains("function initGlobals(targetWindow = globalThis)"), "{native}");
}

#[test]
fn f05_rust_field_attrs_and_php_extends_implements_attributes() {
    let rs = r#"
pub struct Session {
    pub id: String,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

impl Session {
    pub fn id(&self) -> String {
        self.id.clone()
    }
}

pub struct PlainConfig {
    #[serde(default)]
    #[allow(dead_code)]
    pub root_dir: Option<String>,
}
"#;
    let (rs_aice, rs_native) = roundtrip(LanguageId::Rust, "attrs.rs", rs);
    assert!(rs_aice.contains("#[serde(default)]"), "dropped #[serde(default)] in AICE:\n{rs_aice}");
    assert!(rs_aice.contains("#[allow(dead_code)]"), "dropped #[allow(dead_code)] in AICE:\n{rs_aice}");
    assert!(rs_native.contains("#[serde(default)]") && rs_native.contains("#[allow(dead_code)]"), "dropped Rust attrs in native:\n{rs_native}");

    // Attributes are semantic code and must remain even when preserve_docs is false
    let reg = EngineRegistry::default();
    let tree = reg.adapter(LanguageId::Rust).unwrap().parse_cst(rs).unwrap();
    let no_docs = TranspileOpts { compact: true, include_types: true, preserve_docs: false };
    let TranspileOutcome::Transpiled(m) = DefaultAiceTranspiler.to_aice(&tree, rs, &no_docs).unwrap() else { panic!() };
    let aice_no_docs = print_aice_with_opts(&m, &no_docs);
    assert!(aice_no_docs.contains("#[serde(default)]"), "attr dropped when preserve_docs=false:\n{aice_no_docs}");

    let php = r#"<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;

#[Route('/api')]
class WhiteboardController extends AbstractController implements JsonSerializable, Countable
{
    #[Inject]
    private string $service;

    #[Route('/', name: 'home')]
    #[Route('/whiteboard', name: 'whiteboard')]
    public function index(): Response
    {
        return $this->render('whiteboard/index.html.twig');
    }
}

#[Deprecated]
function legacyHelper(string $x): string
{
    return $x;
}
"#;
    let (php_aice, php_native) = roundtrip(LanguageId::Php, "WhiteboardController.php", php);
    assert!(php_aice.contains("extends AbstractController"), "dropped PHP extends:\n{php_aice}");
    assert!(php_aice.contains("implements JsonSerializable, Countable"), "dropped PHP implements:\n{php_aice}");
    assert!(php_aice.contains("#[Route('/api')]"), "dropped PHP class attribute:\n{php_aice}");
    assert!(php_aice.contains("#[Inject]"), "dropped PHP prop attribute:\n{php_aice}");
    assert!(php_aice.contains("#[Route('/', name: 'home')]"), "dropped PHP first method attribute:\n{php_aice}");
    assert!(php_aice.contains("#[Route('/whiteboard', name: 'whiteboard')]"), "dropped PHP second method attribute:\n{php_aice}");
    assert!(php_aice.contains("#[Deprecated]"), "dropped PHP fn attribute:\n{php_aice}");

    assert!(php_native.contains("class WhiteboardController extends AbstractController implements JsonSerializable, Countable"), "{php_native}");
    assert!(php_native.contains("#[Route('/api')]") && php_native.contains("#[Route('/whiteboard', name: 'whiteboard')]"), "{php_native}");
    assert!(php_native.contains("#[Deprecated]"), "{php_native}");
}
