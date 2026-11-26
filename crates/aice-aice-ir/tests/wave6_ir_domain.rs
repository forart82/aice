use std::path::Path;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn roundtrip_no_fw(lang: LanguageId, vname: &str, src: &str) -> (String, String) {
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let tree = reg.adapter(lang).unwrap().parse_cst(src).unwrap();
    let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, src, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled for {lang:?} ({vname})");
    };
    assert!(m.raw_fallback.is_empty(), "unexpected raw_fallback for {vname}");
    let aice = print_aice(&m);
    assert!(aice.starts_with("module "), "missing module header for {vname}:\n{aice}");
    let reparsed = parse_aice(&aice).unwrap_or_else(|e| {
        panic!("parse_aice failed for {vname}: {e}\n--- AICE ---\n{aice}")
    });
    let native = tr.to_native(&reparsed, lang).unwrap_or_else(|e| {
        panic!("to_native failed for {vname}: {e}\n--- AICE ---\n{aice}")
    });
    (aice, native)
}

fn roundtrip(lang: LanguageId, vname: &str, src: &str) -> (String, String) {
    let (aice, native) = roundtrip_no_fw(lang, vname, src);
    let verdict = DefaultSyntaxFirewall.verify(&native, Path::new(vname), lang);
    assert_eq!(
        verdict,
        FirewallVerdict::Valid,
        "firewall rejected {vname}:\n--- NATIVE ---\n{native}\n--- AICE ---\n{aice}"
    );
    (aice, native)
}

#[test]
fn f71_css_layer_container_at_rules_preserved() {
    let at_rules = "\
@layer base { .a { color: red; } }
@supports (display: grid) { .b { display: grid; } }
@keyframes spin { from { opacity: 0; } to { opacity: 1; } }
@container (min-width: 400px) { .c { padding: 8px; } }
";
    let (aice, native) = roundtrip(LanguageId::Css, "at_rules.css", at_rules);
    for needle in ["@layer base", ".a", "c:red", "@supports (display: grid)", "@keyframes spin", "@container (min-width: 400px)", ".c", "p:8px"] {
        assert!(aice.contains(needle), "missing `{needle}` in AICE:\n{aice}");
    }
    for needle in ["@layer base", "color: red;", "@supports (display: grid)", "@keyframes spin", "@container (min-width: 400px)", "padding: 8px;"] {
        assert!(native.contains(needle), "missing `{needle}` in native CSS:\n{native}");
    }

    let edge_css = "\
@layer base, components;

:root {
  --accent: #38bdf8;
  --pad: 12px;
}

@layer components {
  .card {
    padding: calc(var(--pad) * 2);
    border: 1px solid var(--accent);
  }
  .card:has(.alert) {
    border-color: #ef4444;
  }
}

@media (max-width: 640px) {
  .card {
    padding: var(--pad);
  }
}
";
    let (aice2, native2) = roundtrip(LanguageId::Css, "edge_css.css", edge_css);
    for needle in ["@layer components", ".card", "calc(var(--pad) * 2)", ".card:has(.alert)", "border-color:#ef4444"] {
        assert!(aice2.contains(needle), "missing `{needle}` in edge_css AICE:\n{aice2}");
    }
    for needle in ["@layer components", "padding: calc(var(--pad) * 2);", ".card:has(.alert)", "border-color: #ef4444;"] {
        assert!(native2.contains(needle), "missing `{needle}` in edge_css native:\n{native2}");
    }

    // Nested at-rules (@media inside @layer) + declaration-bearing @font-face
    let nested_css = "\
@font-face {
  font-family: Inter;
  font-display: swap;
}
@layer utilities {
  @media (min-width: 300px) {
    .box {
      margin: 4px;
    }
  }
}
";
    let (aice3, native3) = roundtrip(LanguageId::Css, "nested.css", nested_css);
    assert!(aice3.contains("@font-face") && aice3.contains("@layer utilities") && aice3.contains("@media (min-width: 300px)"), "{aice3}");
    assert!(native3.contains("@font-face") && native3.contains("font-family: Inter;") && native3.contains("@layer utilities") && native3.contains("@media (min-width: 300px)"), "{native3}");
}

#[test]
fn f72_twig_macro_params_and_attr_interpolations() {
    let edge_twig = "\
{% extends 'base.html.twig' %}

{% block title %}Ledger — {{ account.name|upper }}{% endblock %}

{% macro badge(level, label) %}
  <span class=\"badge badge-{{ level }}\">{{ label|e }}</span>
{% endmacro %}

{% block body %}
  {# Render active rows #}
  {% set total = 0 %}
  <section id=\"ledger\">
    {% for row in rows %}
      {% if row.amount > 0 %}
        <div class=\"pos\">{{ row.id }}: {{ row.amount }}</div>
      {% else %}
        <div class=\"neg\">{{ row.id }}: {{ row.amount }}</div>
      {% endif %}
    {% endfor %}
  </section>
{% endblock %}
";
    let (aice, native) = roundtrip(LanguageId::Twig, "edge_twig.html.twig", edge_twig);
    assert!(aice.contains("@macro badge(level, label):"), "macro params dropped:\n{aice}");
    assert!(aice.contains("span(class=\"badge badge-{{ level }}\")"), "attr interpolation corrupted:\n{aice}");
    assert!(!aice.contains("badge-\"):"), "attribute split hazard remained:\n{aice}");
    assert!(native.contains("{% macro badge(level, label) %}"), "native macro params dropped:\n{native}");
    assert!(native.contains("<span class=\"badge badge-{{ level }}\">{{ label|e }}</span>"), "native span corrupted:\n{native}");

    // Multiple attr interpolations, comparison '>' inside {{ }}, and default macro param
    let multi_twig = "\
{% macro link_pill(kind, text='ok') %}
  <a href=\"/u/{{ user.id }}?tab={{ tab }}\" class=\"pill {{ count > 0 ? 'on' : 'off' }}\">{{ text }}</a>
{% endmacro %}
";
    let (aice2, native2) = roundtrip(LanguageId::Twig, "multi_attr.html.twig", multi_twig);
    assert!(aice2.contains("@macro link_pill(kind, text='ok'):"), "{aice2}");
    assert!(aice2.contains("/u/{{ user.id }}?tab={{ tab }}"), "{aice2}");
    assert!(aice2.contains("pill {{ count > 0 ? 'on' : 'off' }}"), "{aice2}");
    assert!(native2.contains("{% macro link_pill(kind, text='ok') %}"), "{native2}");
    assert!(native2.contains("href=\"/u/{{ user.id }}?tab={{ tab }}\""), "{native2}");
    assert!(native2.contains("class=\"pill {{ count > 0 ? 'on' : 'off' }}\""), "{native2}");
}

#[test]
fn f70_pg_partial_index_where_and_cypher_constraint() {
    let edge_pg = "\
CREATE TABLE ledger_events (
  id BIGSERIAL PRIMARY KEY,
  tenant TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ledger_events_tenant ON ledger_events (tenant) WHERE tenant <> '';
CREATE INDEX idx_ledger_events_created ON ledger_events (created_at);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_payload ON ledger_events USING btree (tenant) WHERE (tenant <> '');

CREATE OR REPLACE FUNCTION emit_event(p_tenant TEXT, p_payload JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO ledger_events (tenant, payload)
  VALUES (p_tenant, p_payload)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
";
    let (aice_pg, nat_pg) = roundtrip(LanguageId::PostgreSql, "edge_pg.sql", edge_pg);
    assert!(aice_pg.contains("WHERE tenant <> ''"), "PG partial index WHERE dropped in AICE:\n{aice_pg}");
    assert!(aice_pg.contains("index idx_ledger_events_created on ledger_events: created_at"), "plain index lost compact form:\n{aice_pg}");
    assert!(aice_pg.contains("CONCURRENTLY") && aice_pg.contains("WHERE (tenant <> '')"), "extended partial index lost clauses:\n{aice_pg}");
    assert!(nat_pg.contains("CREATE INDEX idx_ledger_events_tenant ON ledger_events (tenant) WHERE tenant <> '';"), "native PG dropped WHERE:\n{nat_pg}");
    assert!(nat_pg.contains("CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_payload ON ledger_events USING btree (tenant) WHERE (tenant <> '');"), "native PG dropped extended clauses:\n{nat_pg}");

    // ANSI SQL (tree-sitter path) partial index preservation
    let ansi_partial = "CREATE UNIQUE INDEX idx_active_email ON users (email) WHERE deleted_at IS NULL;\n";
    let (aice_ansi, nat_ansi) = roundtrip(LanguageId::AnsiSql, "partial.sql", ansi_partial);
    assert!(aice_ansi.contains("WHERE deleted_at IS NULL"), "ANSI partial index dropped WHERE:\n{aice_ansi}");
    assert!(nat_ansi.contains("WHERE deleted_at IS NULL"), "native ANSI dropped WHERE:\n{nat_ansi}");

    // Neo4j 5 Cypher CREATE CONSTRAINT ... FOR (...) REQUIRE ... IS UNIQUE
    let edge_cypher = "\
CREATE CONSTRAINT account_id IF NOT EXISTS FOR (a:Account) REQUIRE a.id IS UNIQUE;

MATCH (src:Account)-[tx:TRANSFERRED]->(dst:Account)
WHERE tx.amount > 100 AND src.active = true
WITH src, dst, sum(tx.amount) AS moved
RETURN src.id, dst.id, moved
ORDER BY moved DESC
LIMIT 10;
";
    let (aice_cyp, nat_cyp) = roundtrip_no_fw(LanguageId::Cypher, "edge_graph.cypher", edge_cypher);
    assert_eq!(aice_cyp.matches("cypher:\n").count(), 2, "Cypher constraint should NOT split into 2 blocks:\n{aice_cyp}");
    assert!(
        aice_cyp.contains("CREATE CONSTRAINT account_id IF NOT EXISTS FOR (a:Account) REQUIRE a.id IS UNIQUE"),
        "Cypher constraint incomplete in AICE:\n{aice_cyp}"
    );
    assert!(
        nat_cyp.contains("CREATE CONSTRAINT account_id IF NOT EXISTS FOR (a:Account) REQUIRE a.id IS UNIQUE;"),
        "Cypher constraint corrupted in native output:\n{nat_cyp}"
    );
    assert!(nat_cyp.contains("MATCH (src:Account)-[tx:TRANSFERRED]->(dst:Account)"), "{nat_cyp}");
    assert!(nat_cyp.contains("RETURN src.id, dst.id, moved ORDER BY moved DESC LIMIT 10;"), "{nat_cyp}");

    // Multi-line Neo4j 5 constraint followed by MATCH query
    let multiline_cyp = "\
CREATE CONSTRAINT user_email IF NOT EXISTS
FOR (u:User)
REQUIRE u.email IS UNIQUE;

MATCH (u:User)
RETURN u.email;
";
    let (aice_ml, nat_ml) = roundtrip_no_fw(LanguageId::Cypher, "ml.cypher", multiline_cyp);
    assert_eq!(aice_ml.matches("cypher:\n").count(), 2, "multi-line Cypher constraint split:\n{aice_ml}");
    assert!(aice_ml.contains("CREATE CONSTRAINT user_email IF NOT EXISTS") && aice_ml.contains("REQUIRE u.email IS UNIQUE"), "{aice_ml}");
    assert!(nat_ml.contains("CREATE CONSTRAINT user_email IF NOT EXISTS") && nat_ml.contains("REQUIRE u.email IS UNIQUE;"), "{nat_ml}");
    assert!(nat_ml.contains("MATCH (u:User)") && nat_ml.contains("RETURN u.email;"), "{nat_ml}");
}

#[test]
fn f69_yaml_anchors_preserved_and_roundtripped() {
    let adv_pipeline = "\
defaults: &base_defaults
  retries: 3
  timeout_ms: 5000
  env:
    MODE: strict

services:
  api:
    <<: *base_defaults
    port: 8080
    script: |
      echo \"starting api\"
      exec ./server
  worker:
    <<: *base_defaults
    port: 9090
    description: >
      Folded multi-line description
      for background worker.
";
    let (aice, native) = roundtrip(LanguageId::Yaml, "adv_pipeline.yaml", adv_pipeline);
    assert!(aice.contains("defaults: &base_defaults"), "YAML mapping anchor dropped in AICE:\n{aice}");
    assert!(aice.contains("*base_defaults"), "YAML alias dropped in AICE:\n{aice}");
    assert!(native.contains("defaults: &base_defaults"), "YAML mapping anchor dropped in native:\n{native}");
    assert!(native.contains("<<: *base_defaults"), "YAML merge alias dropped in native:\n{native}");

    // Scalar, sequence, sequence-item map anchors + literal string starting with '&'
    let all_anchors = "\
host: &main_host localhost
ports: &std_ports
  - 80
  - 443
items:
  - &first_item
    name: alpha
  - *first_item
mirror: *main_host
amp_literal: \"&not_an_anchor\"
";
    let (aice2, native2) = roundtrip(LanguageId::Yaml, "anchors.yaml", all_anchors);
    for needle in ["host=&main_host localhost", "ports: &std_ports", "- &first_item", "mirror=*main_host", "amp_literal=\"&not_an_anchor\""] {
        assert!(aice2.contains(needle), "missing `{needle}` in anchors AICE:\n{aice2}");
    }
    for needle in ["host: &main_host localhost", "ports: &std_ports", "- &first_item", "mirror: *main_host", "&not_an_anchor"] {
        assert!(native2.contains(needle), "missing `{needle}` in anchors native:\n{native2}");
    }

    // JSON & TOML literal '&' strings must remain plain strings (not parsed as anchors)
    let (_, nat_json) = roundtrip(LanguageId::Json, "amp.json", "{\n  \"amp\": \"&literal\"\n}\n");
    assert!(nat_json.contains("\"&literal\""), "{nat_json}");
    let (_, nat_toml) = roundtrip(LanguageId::Toml, "amp.toml", "amp = \"&literal\"\n");
    assert!(nat_toml.contains("\"&literal\""), "{nat_toml}");
}
