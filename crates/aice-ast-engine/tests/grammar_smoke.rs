use aice_ast_engine::{ALL_GRAMMAR_SLOTS, GrammarSlot, parse_slot};

fn snippet_for_slot(slot: GrammarSlot) -> &'static str {
    match slot {
        GrammarSlot::Json => r#"{"enabled": true, "count": 42, "tags": ["a", "b"]}"#,
        GrammarSlot::Yaml => "enabled: true\ncount: 42\ntags:\n  - a\n  - b\n",
        GrammarSlot::Toml => "[package]\nname = \"aice\"\nversion = \"0.9.53\"\n",
        GrammarSlot::Markdown => "# Title\n\nHello *world*.\n",
        GrammarSlot::MarkdownInline => "Hello *world* and `code`",
        GrammarSlot::Html => "<!doctype html><html><body><p>Hello</p></body></html>\n",
        GrammarSlot::Css => "body { color: #fff; margin: 0; }\n",
        GrammarSlot::Xml => "<?xml version=\"1.0\"?><root><item id=\"1\">ok</item></root>\n",
        GrammarSlot::Dtd => "<!ELEMENT note (to,from)>\n<!ELEMENT to (#PCDATA)>\n",
        GrammarSlot::Bash => "#!/usr/bin/env bash\necho \"hello\"\n",
        GrammarSlot::Rust => "pub fn add(a: i32, b: i32) -> i32 { a + b }\n",
        GrammarSlot::TypeScript => "export function add(a: number, b: number): number { return a + b; }\n",
        GrammarSlot::Tsx => "export const Btn = () => <button>Click</button>;\n",
        GrammarSlot::JavaScript => "export function add(a, b) { return a + b; }\n",
        GrammarSlot::Python => "def add(a: int, b: int) -> int:\n    return a + b\n",
        GrammarSlot::Go => "package main\nfunc add(a int, b int) int { return a + b }\n",
        GrammarSlot::C => "int add(int a, int b) { return a + b; }\n",
        GrammarSlot::Cpp => "namespace app { int add(int a, int b) { return a + b; } }\n",
        GrammarSlot::CSharp => "public class MathOps { public int Add(int a, int b) => a + b; }\n",
        GrammarSlot::Java => "public class MathOps { public int add(int a, int b) { return a + b; } }\n",
        GrammarSlot::Kotlin => "fun add(a: Int, b: Int): Int = a + b\n",
        GrammarSlot::Dart => "sealed class Shape {}\nint add(int a, int b) => a + b;\n",
        GrammarSlot::Php => "<?php\nfunction add(int $a, int $b): int { return $a + $b; }\n",
        GrammarSlot::PhpOnly => "function add(int $a, int $b): int { return $a + $b; }\n",
        GrammarSlot::Ruby => "def add(a, b)\n  a + b\nend\n",
        GrammarSlot::Sql => "SELECT id, name FROM users WHERE active = true;\n",
        GrammarSlot::Prisma => "model User {\n  id Int @id\n  email String @unique\n}\n",
        GrammarSlot::GraphQl => "type User { id: ID! name: String! }\n",
        GrammarSlot::Cypher => "MATCH (n:User {id: 1}) RETURN n.name;\n",
    }
}

#[test]
fn all_29_tree_sitter_language_fns_load_and_parse_without_errors() {
    assert_eq!(ALL_GRAMMAR_SLOTS.len(), 29);
    for slot in ALL_GRAMMAR_SLOTS {
        let src = snippet_for_slot(slot);
        let tree = parse_slot(slot, src)
            .unwrap_or_else(|e| panic!("Grammar '{}' failed set_language/parse: {e}", slot.name()));
        assert!(
            !tree.root_node().has_error(),
            "Grammar '{}' produced syntax error on smoke snippet:\n{}\nsexp: {}",
            slot.name(),
            src,
            tree.root_node().to_sexp()
        );
    }
}
