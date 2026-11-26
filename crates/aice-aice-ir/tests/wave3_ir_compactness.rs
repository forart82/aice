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
    let reparsed = parse_aice(&aice).unwrap_or_else(|e| {
        panic!("parse_aice failed for {vname}: {e}\n--- AICE ---\n{aice}")
    });
    let native = tr.to_native(&reparsed, lang).unwrap_or_else(|e| {
        panic!("to_native failed for {vname}: {e}\n--- AICE ---\n{aice}")
    });
    let verdict = fw.verify(&native, Path::new(vname), lang);
    assert_eq!(
        verdict,
        FirewallVerdict::Valid,
        "firewall rejected {vname}:\n--- NATIVE ---\n{native}\n--- AICE ---\n{aice}"
    );
    (aice, native)
}

/// Deterministic lexical token-count proxy (words + runs of punctuation) used alongside byte
/// length inside `aice-aice-ir` unit tests (which intentionally stay free of tokenizer crates).
fn approx_tokens(s: &str) -> usize {
    let mut count = 0usize;
    let mut in_word = false;
    for ch in s.chars() {
        if ch.is_alphanumeric() || ch == '_' {
            if !in_word {
                count += 1;
                in_word = true;
            }
        } else {
            in_word = false;
            if !ch.is_whitespace() {
                count += 1;
            }
        }
    }
    count
}

#[test]
fn f33_kotlin_primary_ctor_dedup_and_compactness() {
    let src = r#"package com.focusflow.data

data class FocusSession(
    val id: String,
    val title: String,
    val durationMinutes: Int,
    val completed: Boolean = false
)

data class Habit(
    val id: String,
    val name: String,
    val targetPerWeek: Int,
    var streakDays: Int = 0
)
"#;
    let (aice, native) = roundtrip(LanguageId::Kotlin, "Models.kt", src);
    assert!(aice.starts_with("module com.focusflow.data"), "missing module header:\n{aice}");
    for field in ["durationMinutes", "completed", "targetPerWeek", "streakDays"] {
        assert_eq!(
            aice.matches(field).count(),
            1,
            "primary-ctor field `{field}` duplicated in class body:\n{aice}"
        );
    }
    assert!(!aice.contains("readonly "), "val primary-ctor param should omit noisy readonly:\n{aice}");
    assert!(!aice.contains("\n  pass"), "bodyless data class should omit pass:\n{aice}");
    assert!(
        aice.len() <= src.len(),
        "Kotlin IR should not inflate bytes ({} > {}):\n{aice}",
        aice.len(),
        src.len()
    );
    assert!(native.contains("val durationMinutes: Int"), "lost val param:\n{native}");
    assert!(native.contains("var streakDays: Int = 0"), "lost var param/default:\n{native}");
}

#[test]
fn f33_sql_prisma_graphql_cypher_config_unquoted_compact_ir() {
    let sql = r#"CREATE TABLE accounts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    account_code VARCHAR(64) NOT NULL UNIQUE,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    balance_cents BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_accounts_currency ON accounts (currency, account_code);

INSERT INTO accounts (account_code, currency, balance_cents)
VALUES ('ACC-001', 'USD', 150000);

SELECT id, account_code, balance_cents
FROM accounts
WHERE currency = 'USD'
ORDER BY id DESC;
"#;
    let (sql_ir, sql_nat) = roundtrip(LanguageId::AnsiSql, "ledger.sql", sql);
    assert!(sql_ir.starts_with("module sql"), "missing module header:\n{sql_ir}");
    assert!(!sql_ir.contains("col \"id\""), "SQL column still double-quoted:\n{sql_ir}");
    assert!(!sql_ir.contains("\"VARCHAR(64)\""), "SQL type still double-quoted:\n{sql_ir}");
    assert!(sql_ir.len() <= sql.len(), "SQL IR inflated ({} > {}):\n{sql_ir}", sql_ir.len(), sql.len());
    assert!(sql_nat.contains("PRIMARY KEY") && sql_nat.contains("NOT NULL") && sql_nat.contains("CURRENT_TIMESTAMP"), "{sql_nat}");

    let prisma = r#"datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Account {
  id           String   @id @default(cuid())
  email        String   @unique
  currency     String   @default("USD")
  balanceCents Int      @default(0)
  createdAt    DateTime @default(now())
}

enum AccountRole {
  ADMIN
  AUDITOR
  MEMBER
}
"#;
    let (pr_ir, pr_nat) = roundtrip(LanguageId::Prisma, "schema.prisma", prisma);
    assert!(pr_ir.starts_with("module prisma"), "missing module header:\n{pr_ir}");
    assert!(!pr_ir.contains("field \"email\""), "Prisma field still double-quoted:\n{pr_ir}");
    assert!(!pr_ir.contains("\"ADMIN\""), "Prisma enum value still double-quoted:\n{pr_ir}");
    assert!(pr_ir.len() <= prisma.len(), "Prisma IR inflated ({} > {}):\n{pr_ir}", pr_ir.len(), prisma.len());
    assert!(pr_nat.contains("model Account") && pr_nat.contains("enum AccountRole"), "{pr_nat}");

    let gql = r#"enum Role {
  ADMIN
  MEMBER
}

type Account {
  id: ID!
  email: String!
  balanceCents: Int!
  role: Role!
}

type Query {
  account(id: ID!, includeArchived: Boolean): Account
}
"#;
    let (gql_ir, gql_nat) = roundtrip(LanguageId::GraphQl, "api.graphql", gql);
    assert!(gql_ir.starts_with("module graphql"), "missing module header:\n{gql_ir}");
    assert!(!gql_ir.contains("\",\""), "phantom comma arg in GraphQL:\n{gql_ir}");
    assert!(!gql_ir.contains("\"ADMIN\""), "GraphQL enum value still double-quoted:\n{gql_ir}");
    assert!(gql_nat.contains("account(id: ID!, includeArchived: Boolean): Account"), "{gql_nat}");

    let cypher = r#"MATCH (a:Account {currency: 'USD'})-[:SENT]->(t:Transfer)
WHERE t.amount > 1000
RETURN a.code, sum(t.amount) AS total
"#;
    let (cyp_ir, cyp_nat) = roundtrip(LanguageId::Cypher, "graph.cypher", cypher);
    assert!(cyp_ir.starts_with("module cypher"), "missing module header:\n{cyp_ir}");
    assert!(cyp_ir.contains("clause \"MATCH\":"), "expected golden MATCH clause:\n{cyp_ir}");
    assert!(cyp_nat.contains("MATCH") && cyp_nat.contains("RETURN"), "{cyp_nat}");

    let toml = r#"[package]
name = "ledger-pipeline"
version = "1.2.0"
edition = "2024"
license = "Apache-2.0"

[pipeline]
batch_sizes = [10, 25, 50, 100]
retries = 3
enabled = true
endpoint = "https://ledger.internal/v2"

[logging]
level = "info"
format = "json"
output = "stdout"
"#;
    let (toml_ir, toml_nat) = roundtrip(LanguageId::Toml, "pipeline.toml", toml);
    assert!(toml_ir.starts_with("module toml"), "missing module header:\n{toml_ir}");
    assert!(!toml_ir.contains("\"edition\":"), "TOML key still double-quoted:\n{toml_ir}");
    assert!(
        approx_tokens(&toml_ir) <= approx_tokens(toml),
        "TOML IR token proxy inflated ({}t > {}t):\n{toml_ir}",
        approx_tokens(&toml_ir), approx_tokens(toml)
    );
    assert!(toml_nat.contains("edition = \"2024\""), "{toml_nat}");

    let yaml = r#"services:
  ledger-worker:
    image: registry.internal/ledger-worker:2.4.1
    replicas: 4
    region: us-east-1
    env:
      LOG_LEVEL: info
      QUEUE_NAME: settlements
      RETRY_LIMIT: 5
    ports:
      - 8080
      - 9090
      - 9464
  audit-exporter:
    image: registry.internal/audit-exporter:1.9.0
    replicas: 2
    region: us-east-1
    env:
      LOG_LEVEL: warn
      BUCKET: audit-snapshots
      FORMAT: parquet
    ports:
      - 8081
      - 9091
"#;
    let (yaml_ir, yaml_nat) = roundtrip(LanguageId::Yaml, "deploy.yaml", yaml);
    assert!(yaml_ir.starts_with("module yaml"), "missing module header:\n{yaml_ir}");
    assert!(!yaml_ir.contains("\"replicas\":"), "YAML key still double-quoted:\n{yaml_ir}");
    assert!(yaml_ir.contains("ports: [8080,9090,9464]"), "expected inline YAML seq:\n{yaml_ir}");
    assert!(
        yaml_ir.len() <= yaml.len(),
        "YAML IR inflated ({}B > {}B):\n{yaml_ir}",
        yaml_ir.len(), yaml.len()
    );
    assert!(yaml_nat.contains("ledger-worker") && yaml_nat.contains("9464"), "{yaml_nat}");
}

#[test]
fn f36_f47_css_html_twig_svg_markdown_compact_valid_ir() {
    let css = r#":root {
  --bg: #0f172a;
  --fg: #e2e8f0;
  --accent: #38bdf8;
}

body {
  margin: 0;
  padding: 24px;
  font-family: system-ui, sans-serif;
  background-color: var(--bg);
  color: var(--fg);
}

.status-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px;
  border-radius: 12px;
}
"#;
    let (css_ir, css_nat) = roundtrip(LanguageId::Css, "styles.css", css);
    assert!(css_ir.starts_with("module css"), "R3/R4 violation - missing module css:\n{css_ir}");
    assert!(css_ir.contains("style body:"), "clean CSS tag selector should be unquoted:\n{css_ir}");
    assert!(css_ir.contains("style \".status-card\":"), "dotted selector should stay valid:\n{css_ir}");
    assert!(
        css_ir.len() <= css.len() && approx_tokens(&css_ir) <= approx_tokens(css),
        "CSS IR should beat raw ({}B/{}t vs {}B/{}t):\n{css_ir}",
        css_ir.len(), approx_tokens(&css_ir), css.len(), approx_tokens(css)
    );
    assert!(css_nat.contains("flex-direction: column") && css_nat.contains("justify-content: space-between"), "{css_nat}");

    let html = r#"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Ledger Overview</title>
    <link rel="stylesheet" href="/assets/app.css" />
  </head>
  <body>
    <main class="container" data-active="true">
      <h1 class="heading">Quarterly Ledger</h1>
      <p class="subtitle">Verified balances across all regions</p>
    </main>
  </body>
</html>
"#;
    let (html_ir, html_nat) = roundtrip(LanguageId::Html, "index.html", html);
    assert!(html_ir.starts_with("module html"), "R3/R4 violation - missing module html:\n{html_ir}");
    assert!(!html_ir.contains("class: \"container\""), "HTML attr still verbose quoted:\n{html_ir}");
    assert!(
        html_ir.len() <= html.len() && approx_tokens(&html_ir) <= approx_tokens(html),
        "HTML IR should beat raw ({}B/{}t vs {}B/{}t):\n{html_ir}",
        html_ir.len(), approx_tokens(&html_ir), html.len(), approx_tokens(html)
    );
    assert!(html_nat.contains("Quarterly Ledger") && html_nat.contains("data-active=\"true\""), "{html_nat}");

    let twig = r#"{% extends 'base.html.twig' %}

{% block title %}Invoice Summary{% endblock %}

{% block body %}
  {# Primary summary card #}
  <section class="card" data-status="paid">
    <h2 class="card-title">{{ invoice.number }}</h2>
    <p class="card-amount">{{ invoice.total }} {{ invoice.currency }}</p>
    <a class="btn-primary" href="/invoices/{{ invoice.id }}">View Details</a>
  </section>
{% endblock %}
"#;
    let (twig_ir, twig_nat) = roundtrip(LanguageId::Twig, "invoice.html.twig", twig);
    assert!(twig_ir.starts_with("module twig"), "R3/R4 violation - missing module twig:\n{twig_ir}");
    assert!(twig_ir.contains("Primary summary card"), "Twig comment trivia lost:\n{twig_ir}");
    assert!(!twig_ir.contains("\"#text\""), "Twig inline block should avoid #text wrapper:\n{twig_ir}");
    assert!(
        twig_ir.len() <= twig.len() && approx_tokens(&twig_ir) <= approx_tokens(twig),
        "Twig IR should beat raw ({}B/{}t vs {}B/{}t):\n{twig_ir}",
        twig_ir.len(), approx_tokens(&twig_ir), twig.len(), approx_tokens(twig)
    );
    assert!(twig_nat.contains("{% extends") && twig_nat.contains("Primary summary card"), "{twig_nat}");

    let svg = r##"<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">
  <rect x="8" y="8" width="304" height="164" rx="12" fill="#0f172a" />
  <circle cx="64" cy="90" r="28" fill="#38bdf8" />
  <text x="112" y="96" fill="#f8fafc">Flow Architecture</text>
</svg>
"##;
    let (svg_ir, svg_nat) = roundtrip(LanguageId::Xml, "diagram.svg", svg);
    assert!(svg_ir.starts_with("module xml"), "R3/R4 violation - missing module xml:\n{svg_ir}");
    assert!(svg_ir.contains("xml svg("), "root xml element header expected:\n{svg_ir}");
    assert!(!svg_ir.contains("xml rect("), "nested xml elements should omit repeated xml prefix:\n{svg_ir}");
    assert!(
        svg_ir.len() <= svg.len() && approx_tokens(&svg_ir) <= approx_tokens(svg),
        "SVG/XML IR should beat raw ({}B/{}t vs {}B/{}t):\n{svg_ir}",
        svg_ir.len(), approx_tokens(&svg_ir), svg.len(), approx_tokens(svg)
    );
    assert!(svg_nat.contains("<rect") && svg_nat.contains("Flow Architecture"), "{svg_nat}");

    let md = r#"# Service Architecture

This service reconciles multi-currency settlement batches with deterministic audit trails.

## Components

- **Ingestor**: validates incoming ledger events
- **Reconciler**: computes net settlement deltas
- **Publisher**: emits signed audit snapshots

## Metrics

| Metric | Target | Notes |
| --- | --- | --- |
| Latency P99 | < 45ms | Hot path only |
| Availability | 99.99% | Multi-region active |

## Verification

- [x] Deterministic ledger hashing
- [x] Zero-downtime schema rollouts

| Check | Command | Cadence |
| --- | --- | --- |
| Unit | `cargo test` | Every commit |
| Audit | `cargo clippy` | Every PR |

```rust
pub fn reconcile(cents: i64) -> i64 {
    cents.max(0)
}
```
"#;
    let (md_ir, md_nat) = roundtrip(LanguageId::Markdown, "ARCHITECTURE.md", md);
    assert!(md_ir.starts_with("module markdown"), "R3/R4 violation - missing module markdown:\n{md_ir}");
    assert!(md_ir.contains("doc 1 \"Service Architecture\":"), "expected structured doc header:\n{md_ir}");
    assert!(
        md_ir.len() <= md.len() && approx_tokens(&md_ir) <= approx_tokens(md),
        "Markdown IR should beat raw ({}B/{}t vs {}B/{}t):\n{md_ir}",
        md_ir.len(), approx_tokens(&md_ir), md.len(), approx_tokens(md)
    );
    assert!(md_nat.contains("# Service Architecture") && md_nat.contains("| Metric | Target | Notes |"), "{md_nat}");
}

#[test]
fn f50_rust_if_else_ternary_no_stray_else() {
    let src = r#"pub fn classify(x: bool, a: i32, b: i32) -> i32 {
    let label = if x { a } else { b };
    let tier = if a > 10 { 1 } else if b > 5 { 2 } else { 3 };
    let fallback = if x { label + 1 } else /* note */ { tier - 1 };
    label + tier + fallback
}
"#;
    let (aice, native) = roundtrip(LanguageId::Rust, "classify.rs", src);
    assert!(aice.starts_with("module rust"), "missing module rust:\n{aice}");
    assert!(!aice.contains(": else"), "stray `else` emitted in Rust ternary:\n{aice}");
    assert!(aice.contains("? {"), "expected ternary `? {{` lowering:\n{aice}");
    assert!(aice.contains(": {"), "expected ternary `: {{` lowering:\n{aice}");
    assert!(native.contains("if x") && native.contains("else"), "lost if/else in round-trip:\n{native}");
}
