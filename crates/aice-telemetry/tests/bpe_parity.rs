use std::time::Instant;

use aice_telemetry::{count_cl100k, count_o200k};

struct ParityVector {
    id: &'static str,
    text: &'static str,
    cl100k_expected: usize,
    o200k_expected: usize,
}

const GOLDEN_VECTORS: [ParityVector; 10] = [
    ParityVector {
        id: "empty",
        text: "",
        cl100k_expected: 0,
        o200k_expected: 0,
    },
    ParityVector {
        id: "ascii_ts",
        text: "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
        cl100k_expected: 20,
        o200k_expected: 20,
    },
    ParityVector {
        id: "ascii_rust",
        text: "pub fn parse_selector(raw: &str) -> Result<Selector, ParseError> {\n    Ok(Selector::Symbol(raw.trim().to_string()))\n}\n",
        cl100k_expected: 31,
        o200k_expected: 31,
    },
    ParityVector {
        id: "cjk_unicode",
        text: "// 日本語コメント: 東京タワー🗼 — café résumé naïve 🚀\nconst msg = \"你好世界\";\n",
        cl100k_expected: 38,
        o200k_expected: 27,
    },
    ParityVector {
        id: "symbols_ops",
        text: "a >>= 2; b <<= 3; c ^= 0xff; x?.y ?? z::w::<Vec<_>>(); /* !@#$%^&*()_+{}|:\"<>? */",
        cl100k_expected: 44,
        o200k_expected: 44,
    },
    ParityVector {
        id: "sql_pg",
        text: "WITH active_accounts AS (\n  SELECT id, owner_name, balance\n  FROM accounts\n  WHERE balance > 0\n)\nSELECT id, owner_name FROM active_accounts ORDER BY balance DESC;\n",
        cl100k_expected: 39,
        o200k_expected: 39,
    },
    ParityVector {
        id: "json_cfg",
        text: "{\n  \"enabled\": true,\n  \"idiomsEnabled\": false,\n  \"allowedReadRoots\": [\"/home/forart/dev/aice\", \"../shared\"]\n}\n",
        cl100k_expected: 36,
        o200k_expected: 35,
    },
    ParityVector {
        id: "aice_ir",
        text: "module math\npub type CalcResult:\n  value: f64\n  label: str\npub class Calculator(offset: f64 = 0):\n  fn add(a: f64, b: f64) -> CalcResult = { value: a + b + this.offset, label: \"sum\" }\n",
        cl100k_expected: 63,
        o200k_expected: 63,
    },
    ParityVector {
        id: "markdown_fence",
        text: "# Architecture\n\n- Pipeline: `Raw -> Governed -> Executed -> MeteredOutput`\n\n```rust\nlet x = 42;\n```\n",
        cl100k_expected: 30,
        o200k_expected: 30,
    },
    ParityVector {
        id: "heredoc_stream",
        text: "=== src/app.ts:App.reset ===\n<<<\n  this.count = 0;\n===\n  this.count = 42;\n>>>\n",
        cl100k_expected: 28,
        o200k_expected: 28,
    },
];

#[test]
fn bpe_openai_matches_js_tiktoken_golden_vectors() {
    for vec in GOLDEN_VECTORS {
        assert_eq!(
            count_cl100k(vec.text),
            vec.cl100k_expected,
            "cl100k_base mismatch on vector '{}'",
            vec.id
        );
        assert_eq!(
            count_o200k(vec.text),
            vec.o200k_expected,
            "o200k_base mismatch on vector '{}'",
            vec.id
        );
    }

    // Warm throughput check on ~1KB input
    let sample = GOLDEN_VECTORS[5].text.repeat(7);
    let t0 = Instant::now();
    let _ = count_cl100k(&sample);
    let _ = count_o200k(&sample);
    let elapsed = t0.elapsed();
    assert!(
        elapsed.as_millis() < 25,
        "Warm 1KB BPE count unexpectedly slow: {:?}",
        elapsed
    );
}
