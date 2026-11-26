use std::path::Path;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::{print_aice, print_aice_with_opts};
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn roundtrip_no_fw(lang: LanguageId, vname: &str, src: &str, opts: &TranspileOpts) -> (String, String) {
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let tree = reg.adapter(lang).unwrap().parse_cst(src).unwrap();
    let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, src, opts).unwrap() else {
        panic!("expected Transpiled for {lang:?} ({vname})");
    };
    assert!(m.raw_fallback.is_empty(), "unexpected raw_fallback for {vname}");
    let aice = print_aice_with_opts(&m, opts);
    assert!(aice.starts_with("module "), "missing module header for {vname}:\n{aice}");
    let reparsed = parse_aice(&aice).unwrap_or_else(|e| {
        panic!("parse_aice failed for {vname}: {e}\n--- AICE ---\n{aice}")
    });
    let native = tr.to_native(&reparsed, lang).unwrap_or_else(|e| {
        panic!("to_native failed for {vname}: {e}\n--- AICE ---\n{aice}")
    });
    (aice, native)
}

fn roundtrip_with_opts(lang: LanguageId, vname: &str, src: &str, opts: &TranspileOpts) -> (String, String) {
    let (aice, native) = roundtrip_no_fw(lang, vname, src, opts);
    let verdict = DefaultSyntaxFirewall.verify(&native, Path::new(vname), lang);
    assert_eq!(
        verdict,
        FirewallVerdict::Valid,
        "firewall rejected {vname}:\n--- NATIVE ---\n{native}\n--- AICE ---\n{aice}"
    );
    (aice, native)
}

fn roundtrip(lang: LanguageId, vname: &str, src: &str) -> (String, String) {
    roundtrip_with_opts(lang, vname, src, &TranspileOpts::default())
}

fn compile_aice(lang: LanguageId, vname: &str, aice: &str) -> String {
    let reparsed = parse_aice(aice).unwrap_or_else(|e| {
        panic!("parse_aice failed for spliced {vname}: {e}\n--- AICE ---\n{aice}")
    });
    let native = DefaultAiceTranspiler.to_native(&reparsed, lang).unwrap_or_else(|e| {
        panic!("to_native failed for spliced {vname}: {e}\n--- AICE ---\n{aice}")
    });
    let verdict = DefaultSyntaxFirewall.verify(&native, Path::new(vname), lang);
    assert_eq!(
        verdict,
        FirewallVerdict::Valid,
        "firewall rejected spliced {vname}:\n--- NATIVE ---\n{native}\n--- AICE ---\n{aice}"
    );
    native
}

#[test]
fn v7_sweep_03_html_entities_roundtrip_and_splice() {
    let html_repro = "<h1>Hello &amp; Welcome</h1>\n";
    let (aice, native) = roundtrip(LanguageId::Html, "repro.html", html_repro);
    assert!(aice.contains("h1 = Hello &amp; Welcome"), "HTML entity text lost in AICE:\n{aice}");
    assert!(native.contains("<h1>Hello &amp; Welcome</h1>"), "HTML entity text lost in native:\n{native}");

    let html_rich = "\
<!DOCTYPE html>
<html lang=\"en\">
  <head>
    <title>Docs &amp; Guides &mdash; v2</title>
  </head>
  <body>
    <h1>Hello &amp; Welcome</h1>
    <p>&lt;a&gt; &#39;x&#x20AC; &nbsp; end</p>
    <p>a&amp;b</p>
    <span>&amp;</span>
    <p>Quote &quot;hi&quot; &amp; \"bye\"</p>
    <p>a <!-- c --> &amp; b</p>
  </body>
</html>
";
    let (aice2, native2) = roundtrip(LanguageId::Html, "rich.html", html_rich);
    for needle in [
        "Docs &amp; Guides &mdash; v2",
        "Hello &amp; Welcome",
        "&lt;a&gt; &#39;x&#x20AC; &nbsp; end",
        "a&amp;b",
        "span = &amp;",
        "a &amp; b",
    ] {
        assert!(aice2.contains(needle), "missing `{needle}` in HTML AICE:\n{aice2}");
    }
    for needle in [
        "<title>Docs &amp; Guides &mdash; v2</title>",
        "<h1>Hello &amp; Welcome</h1>",
        "<p>&lt;a&gt; &#39;x&#x20AC; &nbsp; end</p>",
        "<p>a&amp;b</p>",
        "<span>&amp;</span>",
        "<p>Quote &quot;hi&quot; &amp; \"bye\"</p>",
        "<p>a &amp; b</p>",
    ] {
        assert!(native2.contains(needle), "missing `{needle}` in HTML native:\n{native2}");
    }

    // Splice edit in AICE preserves edited entity text cleanly
    let spliced_aice = aice.replace("Hello &amp; Welcome", "Hi &lt;User&gt; &amp; Team");
    let spliced_native = compile_aice(LanguageId::Html, "spliced.html", &spliced_aice);
    assert!(
        spliced_native.contains("<h1>Hi &lt;User&gt; &amp; Team</h1>"),
        "HTML splice lost entity text:\n{spliced_native}"
    );
}

#[test]
fn v7_sweep_03_xml_entities_roundtrip_and_splice() {
    let xml_repro = "<title>Alpha &amp; Beta</title>\n";
    let (aice, native) = roundtrip(LanguageId::Xml, "repro.xml", xml_repro);
    assert!(aice.contains("xml title: Alpha &amp; Beta"), "XML entity text lost in AICE:\n{aice}");
    assert!(native.contains("<title>Alpha &amp; Beta</title>"), "XML entity text lost in native:\n{native}");

    let xml_rich = "\
<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<catalog>
  <title>Alpha &amp; Beta</title>
  <refs>&#65; &lt; &#x42; &apos; &gt;</refs>
  <tight>a&amp;b</tight>
  <only>&amp;</only>
  <quoted>She said &quot;hi&quot; &amp; \"bye\"</quoted>
  <mixed><![CDATA[x & y]]> &amp; z</mixed>
  <empty>   </empty>
</catalog>
";
    let (aice2, native2) = roundtrip(LanguageId::Xml, "rich.xml", xml_rich);
    for needle in [
        "title: Alpha &amp; Beta",
        "refs: &#65; &lt; &#x42; &apos; &gt;",
        "tight: a&amp;b",
        "only: &amp;",
        "mixed: <![CDATA[x & y]]> &amp; z",
    ] {
        assert!(aice2.contains(needle), "missing `{needle}` in XML AICE:\n{aice2}");
    }
    for needle in [
        "<title>Alpha &amp; Beta</title>",
        "<refs>&#65; &lt; &#x42; &apos; &gt;</refs>",
        "<tight>a&amp;b</tight>",
        "<only>&amp;</only>",
        "<quoted>She said &quot;hi&quot; &amp; \"bye\"</quoted>",
        "<mixed><![CDATA[x & y]]> &amp; z</mixed>",
        "<empty />",
    ] {
        assert!(native2.contains(needle), "missing `{needle}` in XML native:\n{native2}");
    }

    // Splice edit in AICE preserves edited XML entities cleanly
    let spliced_aice = aice.replace("Alpha &amp; Beta", "Gamma &lt; Delta &#x26; Omega");
    let spliced_native = compile_aice(LanguageId::Xml, "spliced.xml", &spliced_aice);
    assert!(
        spliced_native.contains("<title>Gamma &lt; Delta &#x26; Omega</title>"),
        "XML splice lost entity text:\n{spliced_native}"
    );
}

#[test]
fn v7_sweep_10_graphql_unions_directives_input_defaults_roundtrip_and_splice() {
    let gql_repro = "\
union SearchResult = User | Post
input In { role: Role = USER }
type User implements Node @auth(role: ADMIN) { id: ID! }
";
    let (aice, native) = roundtrip(LanguageId::GraphQl, "repro.graphql", gql_repro);
    for needle in [
        "gql \"union\" \"SearchResult\": User, Post",
        "role:Role = USER",
        "implements: Node",
        "directive: \"@auth(role: ADMIN)\"",
    ] {
        assert!(aice.contains(needle), "missing `{needle}` in GraphQL repro AICE:\n{aice}");
    }
    for needle in [
        "union SearchResult = User | Post",
        "role: Role = USER",
        "type User implements Node @auth(role: ADMIN) {",
        "id: ID!",
    ] {
        assert!(native.contains(needle), "missing `{needle}` in GraphQL repro native:\n{native}");
    }

    let gql_full = "\
scalar DateTime @specifiedBy(url: \"https://example.com\")
union SearchResult @tag(name: \"search\") = User | Post | Comment
enum Role @deprecated(reason: \"old\") {
  ADMIN @deprecated(reason: \"use SUPER\")
  USER
}
input CreateUserInput @oneOf {
  name: String! = \"anon\" @constraint(maxLength: 50)
  role: Role = USER
  tags: [String!] = [\"a\", \"b\"]
  homepage: String = \"https://example.com\"
}
type User implements Node & Timestamped @auth(role: ADMIN) @key(fields: \"id\") {
  id: ID!
  legacyName: String @deprecated(reason: \"use name\")
  posts(limit: Int = 10 @range(max: 100)): [Post!]! @auth(role: USER)
}
interface Node @entity {
  id: ID!
}
directive @auth(role: Role = USER) on OBJECT | FIELD_DEFINITION
extend type User @extra {
  bio: String
}
";
    let (aice2, native2) = roundtrip(LanguageId::GraphQl, "full.graphql", gql_full);
    for needle in [
        "scalar DateTime @specifiedBy(url: \"https://example.com\")",
        "union SearchResult @tag(name: \"search\") = User | Post | Comment",
        "enum Role @deprecated(reason: \"old\") {",
        "ADMIN @deprecated(reason: \"use SUPER\")",
        "input CreateUserInput @oneOf {",
        "name: String! = \"anon\" @constraint(maxLength: 50)",
        "role: Role = USER",
        "tags: [String!] = [\"a\", \"b\"]",
        "homepage: String = \"https://example.com\"",
        "type User implements Node & Timestamped @auth(role: ADMIN) @key(fields: \"id\") {",
        "legacyName: String @deprecated(reason: \"use name\")",
        "posts(limit: Int = 10 @range(max: 100)): [Post!]! @auth(role: USER)",
        "interface Node @entity {",
        "directive @auth(role: Role = USER) on OBJECT | FIELD_DEFINITION",
        "extend type User @extra {",
    ] {
        assert!(native2.contains(needle), "missing `{needle}` in GraphQL full native:\n{native2}\n--- AICE ---\n{aice2}");
    }

    // Non-compact roundtrip also valid
    let (_, native_nc) = roundtrip_with_opts(
        LanguageId::GraphQl,
        "full_nc.graphql",
        gql_full,
        &TranspileOpts { compact: false, include_types: true, preserve_docs: true },
    );
    assert!(native_nc.contains("union SearchResult @tag(name: \"search\") = User | Post | Comment"), "{native_nc}");

    // Splice edit in AICE: add union member, change input default, add field directive
    let spliced_aice = aice
        .replace("gql \"union\" \"SearchResult\": User, Post", "gql \"union\" \"SearchResult\": User, Post, Comment")
        .replace("role:Role = USER", "role:Role = ADMIN")
        .replace("id:ID!", "id:ID! | \"@deprecated(reason: \\\"use uuid\\\")\"");
    let spliced_native = compile_aice(LanguageId::GraphQl, "spliced.graphql", &spliced_aice);
    assert!(spliced_native.contains("union SearchResult = User | Post | Comment"), "{spliced_native}");
    assert!(spliced_native.contains("role: Role = ADMIN"), "{spliced_native}");
    assert!(spliced_native.contains("id: ID! @deprecated(reason: \"use uuid\")"), "{spliced_native}");
}

#[test]
fn v7_sweep_11_tsw_02_css_statement_at_rules_roundtrip_and_splice() {
    let css_repro = "\
@layer reset, base, components;
@layer base { body { margin: 0; } }
";
    let (aice, native) = roundtrip(LanguageId::Css, "repro.css", css_repro);
    assert!(aice.contains("@layer reset, base, components;"), "missing @layer stmt in AICE:\n{aice}");
    assert!(native.contains("@layer reset, base, components;"), "missing @layer stmt in native:\n{native}");
    assert!(native.contains("@layer base {"), "missing @layer block in native:\n{native}");

    let stmt_at_css = "\
@charset \"UTF-8\";
@namespace svg url(\"http://www.w3.org/2000/svg\");
@layer reset, tokens, base, components, utilities;
@import url(\"./tokens.css\");
@import \"./base.css\";
@layer base {
  body { margin: 0; }
}
";
    let (aice2, native2) = roundtrip(LanguageId::Css, "stmt_at.css", stmt_at_css);
    for needle in [
        "@charset \"UTF-8\";",
        "@namespace svg url(\"http://www.w3.org/2000/svg\");",
        "@layer reset, tokens, base, components, utilities;",
        "import \"url(\\\"./tokens.css\\\")\"",
        "import \"./base.css\"",
        "@layer base",
    ] {
        assert!(aice2.contains(needle), "missing `{needle}` in CSS AICE:\n{aice2}");
    }
    for needle in [
        "@charset \"UTF-8\";",
        "@namespace svg url(\"http://www.w3.org/2000/svg\");",
        "@layer reset, tokens, base, components, utilities;",
        "@import url(\"./tokens.css\");",
        "@import \"./base.css\";",
        "@layer base {",
        "margin: 0;",
    ] {
        assert!(native2.contains(needle), "missing `{needle}` in CSS native:\n{native2}");
    }

    // CSS @import with layer(...) modifier preserves intact through IR round-trip
    let (_, import_layer_nat) = roundtrip_no_fw(
        LanguageId::Css,
        "import_layer.css",
        "@import \"./theme.css\" layer(theme);\n",
        &TranspileOpts::default(),
    );
    assert!(import_layer_nat.contains("@import \"./theme.css\" layer(theme);"), "{import_layer_nat}");

    // Nested statement-form at-rule inside a CSS block
    let nested_stmt = "@layer parent {\n  @layer child;\n  .x { color: red; }\n}\n";
    let (nested_aice, nested_nat) = roundtrip(LanguageId::Css, "nested_stmt.css", nested_stmt);
    assert!(nested_aice.contains("@layer child"), "{nested_aice}");
    assert!(nested_nat.contains("@layer child;") && nested_nat.contains("color: red;"), "{nested_nat}");

    // CSS file containing ONLY statement-form at-rules
    let only_stmts = "@charset \"UTF-8\";\n@layer reset, base;\n";
    let (aice3, native3) = roundtrip(LanguageId::Css, "only_stmts.css", only_stmts);
    assert!(aice3.contains("@charset \"UTF-8\";") && aice3.contains("@layer reset, base;"), "{aice3}");
    assert!(native3.contains("@charset \"UTF-8\";") && native3.contains("@layer reset, base;"), "{native3}");

    // Splice edit in AICE: add `overrides` to @layer order
    let spliced_aice = aice2.replace(
        "@layer reset, tokens, base, components, utilities;",
        "@layer reset, tokens, base, components, utilities, overrides;",
    );
    let spliced_native = compile_aice(LanguageId::Css, "spliced.css", &spliced_aice);
    assert!(
        spliced_native.contains("@layer reset, tokens, base, components, utilities, overrides;"),
        "CSS splice lost @layer edit:\n{spliced_native}"
    );
}

#[test]
fn v7_sweep_14_sql_paren_aware_column_types_roundtrip_and_splice() {
    let mysql_repro = "CREATE TABLE orders (id INT PRIMARY KEY, status ENUM('new', 'paid', 'shipped') NOT NULL DEFAULT 'new') ENGINE=InnoDB;\n";
    let (aice, native) = roundtrip(LanguageId::MySql, "orders.sql", mysql_repro);
    assert!(
        aice.contains("status \"ENUM('new', 'paid', 'shipped')\" | NN DEFAULT 'new'"),
        "MySQL ENUM split or malformed in AICE:\n{aice}"
    );
    assert!(!aice.contains("\"ENUM('new',\""), "Naive split regression in AICE:\n{aice}");
    assert!(
        native.contains("status ENUM('new', 'paid', 'shipped') NOT NULL DEFAULT 'new'"),
        "MySQL ENUM lost in native:\n{native}"
    );
    assert!(native.contains("ENGINE=InnoDB"), "MySQL table option lost:\n{native}");

    let mysql_rich = "\
CREATE TABLE catalog_items (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  status ENUM('in progress', 'paid', 'it''s ok') NOT NULL DEFAULT 'in progress',
  price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  spaced_dec DECIMAL (12, 4) NOT NULL,
  `order state` ENUM('open', 'closed') NOT NULL
) ENGINE=InnoDB;
";
    let (aice2, native2) = roundtrip(LanguageId::MySql, "catalog.sql", mysql_rich);
    for needle in [
        "\"ENUM('in progress', 'paid', 'it''s ok')\"",
        "price DECIMAL(10, 2) NN DEFAULT 0.00",
        "spaced_dec DECIMAL (12, 4) NN",
        "\"`order state`\"",
        "\"ENUM('open', 'closed')\"",
    ] {
        assert!(aice2.contains(needle), "missing `{needle}` in MySQL rich AICE:\n{aice2}");
    }
    for needle in [
        "status ENUM('in progress', 'paid', 'it''s ok') NOT NULL DEFAULT 'in progress'",
        "price DECIMAL(10, 2) NOT NULL DEFAULT 0.00",
        "spaced_dec DECIMAL (12, 4) NOT NULL",
        "`order state` ENUM('open', 'closed') NOT NULL",
    ] {
        assert!(native2.contains(needle), "missing `{needle}` in MySQL rich native:\n{native2}");
    }

    // MySQL SET(...) & spaced ENUM (...) (tree-sitter-sequel lacks SET grammar, verify IR round-trip)
    let mysql_set = "\
CREATE TABLE flags_tbl (
  flags SET('featured', 'sale', 'new') DEFAULT 'new',
  spaced_enum ENUM ('alpha', 'beta') DEFAULT 'alpha'
) ENGINE=InnoDB;
";
    let (set_aice, set_nat) = roundtrip_no_fw(LanguageId::MySql, "flags.sql", mysql_set, &TranspileOpts::default());
    assert!(set_aice.contains("flags \"SET('featured', 'sale', 'new')\" | DEFAULT 'new'"), "{set_aice}");
    assert!(set_aice.contains("spaced_enum \"ENUM ('alpha', 'beta')\" | DEFAULT 'alpha'"), "{set_aice}");
    assert!(set_nat.contains("flags SET('featured', 'sale', 'new') DEFAULT 'new'"), "{set_nat}");
    assert!(set_nat.contains("spaced_enum ENUM ('alpha', 'beta') DEFAULT 'alpha'"), "{set_nat}");

    // PostgreSQL & T-SQL & ANSI SQL also preserve DECIMAL(10, 2) cleanly
    let pg_sql = "CREATE TABLE ledger (id SERIAL PRIMARY KEY, amount NUMERIC(14, 4) NOT NULL DEFAULT 0, ratio DECIMAL(5, 2));\n";
    let (pg_aice, pg_nat) = roundtrip(LanguageId::PostgreSql, "ledger_pg.sql", pg_sql);
    assert!(pg_aice.contains("amount NUMERIC(14, 4) NN DEFAULT 0"), "{pg_aice}");
    assert!(pg_nat.contains("amount NUMERIC(14, 4) NOT NULL DEFAULT 0") && pg_nat.contains("ratio DECIMAL(5, 2)"), "{pg_nat}");

    let tsql = "CREATE TABLE dbo.Entries ([Order Id] INT PRIMARY KEY, Amount DECIMAL(10, 2) NOT NULL);\n";
    let (tsql_aice, tsql_nat) = roundtrip(LanguageId::TSql, "entries_tsql.sql", tsql);
    assert!(tsql_aice.contains("Amount DECIMAL(10, 2) NN"), "{tsql_aice}");
    assert!(tsql_nat.contains("[Order Id] INT PRIMARY KEY") && tsql_nat.contains("Amount DECIMAL(10, 2) NOT NULL"), "{tsql_nat}");

    let ansi = "CREATE TABLE orders (id INT PRIMARY KEY, amount DECIMAL(10, 2) NOT NULL);\n";
    let (ansi_aice, ansi_nat) = roundtrip(LanguageId::AnsiSql, "orders_ansi.sql", ansi);
    assert!(ansi_aice.contains("DECIMAL(10, 2)"), "{ansi_aice}");
    assert!(ansi_nat.contains("amount DECIMAL(10, 2) NOT NULL"), "{ansi_nat}");

    // Non-compact roundtrip on MySQL ENUM
    let reg = EngineRegistry::default();
    let tree = reg.adapter(LanguageId::MySql).unwrap().parse_cst(mysql_repro).unwrap();
    let TranspileOutcome::Transpiled(m) = DefaultAiceTranspiler.to_aice(&tree, mysql_repro, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled");
    };
    let aice_def = print_aice(&m);
    assert!(aice_def.contains("ENUM('new', 'paid', 'shipped')"), "{aice_def}");

    // Splice edit in AICE: add 'cancelled' to ENUM
    let spliced_aice = aice.replace(
        "\"ENUM('new', 'paid', 'shipped')\"",
        "\"ENUM('new', 'paid', 'shipped', 'cancelled')\"",
    );
    let spliced_native = compile_aice(LanguageId::MySql, "spliced_orders.sql", &spliced_aice);
    assert!(
        spliced_native.contains("status ENUM('new', 'paid', 'shipped', 'cancelled') NOT NULL DEFAULT 'new'"),
        "SQL splice lost ENUM edit:\n{spliced_native}"
    );
}
