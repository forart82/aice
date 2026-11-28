use std::collections::BTreeMap;

use aice_governance::JsonValue;

fn obj(entries: Vec<(&str, JsonValue)>) -> JsonValue {
    let mut map = BTreeMap::new();
    for (k, v) in entries {
        map.insert(k.to_string(), v);
    }
    JsonValue::Object(map)
}

fn jstr(s: &str) -> JsonValue {
    JsonValue::String(s.to_string())
}

fn prop_type(ty: &str) -> JsonValue {
    obj(vec![("type", jstr(ty))])
}

fn prop_desc(ty: &str, desc: &str) -> JsonValue {
    obj(vec![("type", jstr(ty)), ("description", jstr(desc))])
}

fn prop_array(item_ty: &str) -> JsonValue {
    obj(vec![("type", jstr("array")), ("items", prop_type(item_ty))])
}

fn read_input_schema() -> JsonValue {
    let read_props = obj(vec![
        ("path", prop_desc("string", "File/dir, f:sym, f:L1-L50, or space-separated list")),
        ("paths", prop_array("string")),
        ("targets", prop_array("string")),
        ("filePath", prop_type("string")),
        ("fileOrDir", prop_type("string")),
        ("symbol", prop_desc("string", "Symbol, L1-L30, /pat/, outline")),
        ("selector", prop_type("string")),
        ("search", prop_type("string")),
        ("filesOnly", prop_type("boolean")),
        ("contextLines", prop_type("number")),
        ("outline", prop_type("boolean")),
        ("full", prop_type("boolean")),
        ("depth", prop_type("number")),
        ("maxTokens", prop_type("number")),
        ("includeDeps", prop_type("boolean")),
        ("includeCallers", prop_type("boolean")),
        ("compact", prop_type("boolean")),
        ("types", prop_type("boolean")),
        ("stats", prop_type("boolean")),
        ("json", prop_type("boolean")),
    ]);
    obj(vec![
        ("type", jstr("object")),
        ("properties", read_props),
        ("required", JsonValue::Array(Vec::new())),
    ])
}

fn splice_input_schema() -> JsonValue {
    let splice_props = obj(vec![
        ("filePath", prop_desc("string", "File or file:selector")),
        ("path", prop_type("string")),
        ("fileOrDir", prop_type("string")),
        ("symbolSelector", prop_desc("string", "Symbol, L1-L25, imports, eof, :overwrite")),
        ("symbol", prop_type("string")),
        ("selector", prop_type("string")),
        ("range", prop_type("string")),
        ("code", prop_desc("string", "Code, multi-line hunk, or === file:sym === stream")),
        ("content", prop_type("string")),
        ("newAiceCode", prop_type("string")),
        ("body", prop_type("string")),
        ("delete", prop_type("boolean")),
        ("create", prop_type("boolean")),
        ("force", prop_type("boolean")),
        ("overwrite", prop_type("boolean")),
        ("insertAfter", prop_type("string")),
        ("insertBefore", prop_type("string")),
        ("preserveDocs", prop_type("boolean")),
        ("dryRun", prop_type("boolean")),
        ("edits", prop_array("object")),
        ("batch", prop_array("object")),
        ("files", prop_array("object")),
    ]);
    obj(vec![
        ("type", jstr("object")),
        ("properties", splice_props),
        ("required", JsonValue::Array(Vec::new())),
    ])
}

const AICE_READ_DESCRIPTION: &str = "Read files, dirs, symbols, :L, search, or file list. Batch 2-4 targets (<8KB/~200L) in path/paths; for 5+ targets, fan out parallel aice_read calls in the SAME turn (never 1-by-1 across turns or one >10KB blob).";
const AICE_SPLICE_DESCRIPTION: &str = "Create, overwrite, or splice files/symbols/:L/hunks. Batch multi-file atomic edits in one === file:sym === code stream (auto SyntaxFirewall + rollback).";

const MCP_INSTRUCTIONS_MD: &str = "\
# AICE MCP Server Instructions

AICE exposes strictly 2 stdio tools: `aice_read` (read/outline/search/find) and `aice_splice` (atomic create/edit/delete).

## Zero-Turn Inline Batching (`aice_read`)
- Keep EACH `aice_read` call to `2-4` targets (`<= 200` lines / `< 8 KB`) so host tool-output caps (`~10 KB`) never spill to `output.txt`.
- For `5+` files/slices, issue `2-4` **parallel** `aice_read` calls in the **SAME turn** (`~2 ms` each on persistent `aice mcp`, 100% inline, zero paging turns). Never loop 1-by-1 across turns or cram 5+ slices into one `> 10 KB` call.
- Prefer `file:Symbol`, `outline: true`, or `search` over `200+` line `:L` dumps.
- Inputs: `path` (single or space-separated targets like `\"a.rs:foo b.rs:bar\"`), `paths`/`targets` (array), `symbol`, `search`, `outline`, `filesOnly`, `depth`, `maxTokens`.

## Atomic Multi-File Edits (`aice_splice`)
- Use `aice_splice` with `=== file:sym ===`, `=== file:L1-L20 ===`, `=== file ===`, or multi-line `<<< === >>>` hunks in `code` for multi-file atomic edits (auto SyntaxFirewall + rollback).

## Gate
- Active only when project `aice.config.json` has `\"enabled\": true`; use `aice disable` / `aice enable` if blocked.
";

pub fn build_tools_list_result() -> JsonValue {
    let read_tool = obj(vec![
        ("name", jstr("aice_read")),
        ("description", jstr(AICE_READ_DESCRIPTION)),
        ("inputSchema", read_input_schema()),
    ]);
    let splice_tool = obj(vec![
        ("name", jstr("aice_splice")),
        ("description", jstr(AICE_SPLICE_DESCRIPTION)),
        ("inputSchema", splice_input_schema()),
    ]);
    obj(vec![("tools", JsonValue::Array(vec![read_tool, splice_tool]))])
}

fn schema_doc(name: &str, description: &str, schema: JsonValue) -> JsonValue {
    obj(vec![
        ("name", jstr(name)),
        ("description", jstr(description)),
        ("inputSchema", schema.clone()),
        ("parameters", schema),
        ("version", jstr(env!("CARGO_PKG_VERSION"))),
    ])
}

pub fn render_mcp_schema_files() -> Vec<(&'static str, String)> {
    let read_doc = schema_doc("aice_read", AICE_READ_DESCRIPTION, read_input_schema());
    let splice_doc = schema_doc("aice_splice", AICE_SPLICE_DESCRIPTION, splice_input_schema());
    let tools_doc = obj(vec![
        ("server", jstr("aice")),
        ("version", jstr(env!("CARGO_PKG_VERSION"))),
        ("tools", JsonValue::Array(vec![read_doc.clone(), splice_doc.clone()])),
    ]);
    vec![
        ("aice_read.json", format!("{}\n", read_doc.to_pretty_string())),
        ("aice_splice.json", format!("{}\n", splice_doc.to_pretty_string())),
        ("tools.json", format!("{}\n", tools_doc.to_pretty_string())),
        ("instructions.md", MCP_INSTRUCTIONS_MD.to_string()),
    ]
}
