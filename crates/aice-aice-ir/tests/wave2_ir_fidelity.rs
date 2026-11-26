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
fn f17_php_top_level_config_return_and_script_statements() {
    let bundles = r#"<?php

return [
    Symfony\Bundle\FrameworkBundle\FrameworkBundle::class => ['all' => true],
    Doctrine\Bundle\DoctrineBundle\DoctrineBundle::class => ['all' => true],
    Symfony\Bundle\WebProfilerBundle\WebProfilerBundle::class => ['dev' => true, 'test' => true],
];
"#;
    let (aice, native) = roundtrip(LanguageId::Php, "config/bundles.php", bundles);
    assert!(aice.contains("FrameworkBundle::class"), "bundles.php erased:\n{aice}");
    assert!(aice.contains("WebProfilerBundle::class"), "bundles.php truncated:\n{aice}");
    assert!(native.contains("return [") && native.contains("FrameworkBundle::class"), "{native}");

    let script = r#"<?php declare(strict_types=1);

require_once __DIR__ . '/src/InvoiceCalculator.php';

$requiredFiles = ['composer.json', 'verify.php'];
foreach ($requiredFiles as $file) {
    if (!file_exists($file)) {
        exit(1);
    }
}
$calc = new \App\InvoiceCalculator();
echo "Verification OK\n";
exit(0);
"#;
    let (s_aice, s_native) = roundtrip(LanguageId::Php, "verify.php", script);
    assert!(s_aice.contains("require_once"), "verify.php dropped require_once:\n{s_aice}");
    assert!(s_aice.contains("foreach ($requiredFiles as $file)"), "verify.php dropped foreach:\n{s_aice}");
    assert!(s_aice.contains("Verification OK"), "verify.php dropped echo:\n{s_aice}");
    assert!(s_aice.contains("exit(0);"), "verify.php dropped exit:\n{s_aice}");
    assert!(s_native.contains("require_once") && s_native.contains("foreach") && s_native.contains("echo"), "{s_native}");
}

#[test]
fn f17_python_top_level_script_loops_ifs_asserts_prints() {
    let py = r#"import os
import sys
from src.ledger import BudgetLedger

REQUIRED_FILES = [
    "config/budgets.yaml",
    "verify.py",
]

for filepath in REQUIRED_FILES:
    assert os.path.exists(filepath), f"Missing file: {filepath}"
    assert os.path.getsize(filepath) > 0, f"Empty file: {filepath}"

ledger = BudgetLedger()
ledger.add_expense("TX-1", 120.0)

assert ledger.expense_count() == 1

if __name__ == "__main__":
    print("Built in 10ms - Verification OK")
    sys.exit(0)
"#;
    let (aice, native) = roundtrip(LanguageId::Python, "verify.py", py);
    assert!(aice.contains("for filepath in REQUIRED_FILES:"), "verify.py dropped top-level for:\n{aice}");
    assert!(aice.contains("assert os.path.exists(filepath)"), "verify.py dropped assert:\n{aice}");
    assert!(aice.contains("ledger.add_expense(\"TX-1\", 120.0)"), "verify.py dropped call expr:\n{aice}");
    assert!(aice.contains("assert ledger.expense_count() == 1"), "verify.py dropped top-level assert:\n{aice}");
    assert!(aice.contains("if __name__ == \"__main__\":"), "verify.py dropped if __name__:\n{aice}");
    assert!(aice.contains("print(\"Built in 10ms - Verification OK\")"), "verify.py dropped print:\n{aice}");
    assert!(native.contains("for filepath in REQUIRED_FILES:") && native.contains("assert ledger.expense_count() == 1"), "{native}");
}

#[test]
fn f17_kotlin_gradle_kts_dsl_blocks() {
    let kts_single = r#"plugins { kotlin("jvm") version "1.9.22"; application }
application { mainClass.set("MainKt") }
"#;
    let (aice1, nat1) = roundtrip(LanguageId::Kotlin, "build.gradle.kts", kts_single);
    assert!(aice1.contains("plugins { kotlin(\"jvm\") version \"1.9.22\"; application }"), "kts plugins erased:\n{aice1}");
    assert!(aice1.contains("application { mainClass.set(\"MainKt\") }"), "kts application erased:\n{aice1}");
    assert!(nat1.contains("plugins {") && nat1.contains("mainClass.set(\"MainKt\")"), "{nat1}");

    let kts_multi = r#"plugins {
    kotlin("jvm") version "1.9.22"
    application
}

application {
    mainClass.set("MainKt")
}

dependencies {
    implementation("org.jetbrains.kotlin:kotlin-stdlib")
    testImplementation(kotlin("test"))
}
"#;
    let (aice2, nat2) = roundtrip(LanguageId::Kotlin, "build.gradle.kts", kts_multi);
    assert!(aice2.contains("plugins {") && aice2.contains("dependencies {") && aice2.contains("kotlin-stdlib"), "multiline kts erased:\n{aice2}");
    assert!(nat2.contains("plugins {") && nat2.contains("dependencies {"), "{nat2}");
}

#[test]
fn f18_csharp_readonly_field_init_and_lambda_params() {
    let cs = r#"using System.Collections.Generic;
using System.Linq;

namespace Scheduler {

public class BookingEngine
{
    private readonly List<Booking> _bookings = new();
    private int _nextId = 1;

    public bool HasConflict(string roomId, int startMinute, int endMinute) =>
        _bookings.Any(b => b.RoomId == roomId && startMinute < b.EndMinute && endMinute > b.StartMinute);

    public int GetRoomBookingsCount(string roomId) =>
        _bookings.Count(b => b.RoomId == roomId);

    public int Combine(int x, int y = 10)
    {
        var add = (a, b) => a + b;
        var mul = (int p, int q) => p * q;
        return add(x, y) + mul(x, _nextId);
    }
}

}
"#;
    let (aice, native) = roundtrip(LanguageId::CSharp, "BookingEngine.cs", cs);
    assert!(!aice.contains("readonly mut"), "contradictory readonly mut still emitted:\n{aice}");
    assert!(aice.contains("priv readonly _bookings:List[Booking] = new()"), "missing C# readonly field init:\n{aice}");
    assert!(aice.contains("priv mut _nextId:int = 1"), "missing C# mutable field init:\n{aice}");
    assert!(aice.contains("fn(b) = b.RoomId == roomId"), "C# single lambda param b dropped:\n{aice}");
    assert!(!aice.contains("fn() = b.RoomId"), "C# lambda still emits unbound fn():\n{aice}");
    assert!(aice.contains("fn(a, b) = a + b"), "C# multi lambda params dropped:\n{aice}");
    assert!(aice.contains("fn(p: int, q: int) = p * q"), "C# typed lambda params dropped:\n{aice}");
    assert!(aice.contains("y:int = 10"), "C# param default dropped:\n{aice}");

    assert!(native.contains("(b) => b.RoomId == roomId"), "native C# lost lambda param b:\n{native}");
    assert!(native.contains("(a, b) => a + b"), "native C# lost multi lambda params:\n{native}");
    assert!(native.contains("new()"), "native C# lost new() init:\n{native}");
    assert!(native.contains("int y = 10"), "native C# lost default param:\n{native}");
}

#[test]
fn f18_php_and_kotlin_default_param_values() {
    let php = r#"<?php declare(strict_types=1);

namespace App;

class InvoiceCalculator
{
    private array $rates;
    private float $taxRate;

    public function __construct(
        array $rates = ['USD' => 1.0, 'EUR' => 0.92],
        float $taxRate = 0.20
    ) {
        $this->rates = $rates;
        $this->taxRate = $taxRate;
    }

    public function buildInvoice(string $invoiceId, array $lines, string $currency = 'USD', bool $isVip = false): array
    {
        return ['id' => $invoiceId, 'currency' => $currency, 'isVip' => $isVip];
    }

    public function applyVipDiscount(float $subtotal, float $discountRate = 0.10): float
    {
        return round($subtotal * (1.0 - $discountRate), 2);
    }
}
"#;
    let (php_aice, php_nat) = roundtrip(LanguageId::Php, "InvoiceCalculator.php", php);
    assert!(php_aice.contains("taxRate:float = 0.20"), "PHP ctor default lost:\n{php_aice}");
    assert!(php_aice.contains("USD: 1.0") && php_aice.contains("EUR: 0.92"), "PHP array default lost:\n{php_aice}");
    assert!(php_aice.contains("currency:str = \"USD\"") && php_aice.contains("isVip:bool = false"), "PHP method defaults lost:\n{php_aice}");
    assert!(php_aice.contains("discountRate:float = 0.10"), "PHP float default lost:\n{php_aice}");
    assert!(php_nat.contains("$currency = \"USD\"") && php_nat.contains("$isVip = false"), "PHP native lost defaults:\n{php_nat}");
    assert!(php_nat.contains("$discountRate = 0.10"), "PHP native lost discountRate default:\n{php_nat}");

    let kt = r#"class Habit(val id: String, val title: String, var currentStreak: Int = 0, var totalMinutes: Int = 0)

fun greet(name: String = "world", retries: Int = 3): String {
    return "$name:$retries"
}
"#;
    let (kt_aice, kt_nat) = roundtrip(LanguageId::Kotlin, "Models.kt", kt);
    assert!(kt_aice.contains("mut currentStreak:int = 0"), "Kotlin ctor default currentStreak lost:\n{kt_aice}");
    assert!(kt_aice.contains("mut totalMinutes:int = 0"), "Kotlin ctor default totalMinutes lost:\n{kt_aice}");
    assert!(kt_aice.contains("name:str = \"world\"") && kt_aice.contains("retries:int = 3"), "Kotlin fn defaults lost:\n{kt_aice}");
    assert!(kt_nat.contains("var currentStreak: Int = 0") && kt_nat.contains("var totalMinutes: Int = 0"), "Kotlin native ctor defaults lost:\n{kt_nat}");
    assert!(kt_nat.contains("name: String = \"world\"") && kt_nat.contains("retries: Int = 3"), "Kotlin native fn defaults lost:\n{kt_nat}");
}

#[test]
fn f18_tsql_proc_params_and_mysql_key_constraints() {
    let tsql = r#"CREATE PROCEDURE dbo.ProcessLedgerBatch
  @BatchId INT,
  @Delta MONEY
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.Accounts SET Balance = Balance + @Delta WHERE BatchId = @BatchId;
END;
GO

CREATE OR ALTER PROC dbo.usp_UpsertOrder
  @CustomerId INT,
  @Amount DECIMAL(10, 2) = 0.00,
  @Note NVARCHAR(100) = 'N/A, ok',
  @OrderId INT OUTPUT
AS
BEGIN
  SELECT TOP (10) @OrderId = Id FROM dbo.Orders WHERE CustomerId = @CustomerId;
END;
GO
"#;
    let (tsql_aice, tsql_nat) = roundtrip(LanguageId::TSql, "tsql_proc.sql", tsql);
    assert!(
        tsql_aice.contains("proc \"tsql\" \"dbo.ProcessLedgerBatch\"(@BatchId INT, @Delta MONEY):"),
        "T-SQL proc params lost:\n{tsql_aice}"
    );
    assert!(
        tsql_aice.contains("proc \"tsql\" \"dbo.usp_UpsertOrder\"(@CustomerId INT, \"@Amount DECIMAL(10, 2) = 0.00\", \"@Note NVARCHAR(100) = 'N/A, ok'\", @OrderId INT OUTPUT):"),
        "T-SQL CREATE OR ALTER PROC params lost:\n{tsql_aice}"
    );
    assert!(!tsql_aice.contains("(\"10\")"), "T-SQL captured TOP(10):\n{tsql_aice}");
    assert!(tsql_nat.contains("CREATE PROCEDURE dbo.ProcessLedgerBatch") && tsql_nat.contains("@OrderId INT OUTPUT"), "{tsql_nat}");

    let mysql = r#"CREATE TABLE `runs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `run_id` INT NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `key` VARCHAR(50) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_RUN` (`run_id`),
  INDEX idx_title (`title`)
) ENGINE=InnoDB;
"#;
    let (my_aice, my_nat) = roundtrip(LanguageId::MySql, "schema.sql", mysql);
    assert!(!my_aice.contains("col \"KEY\"") && !my_aice.contains("\n  KEY:"), "MySQL KEY misparsed as column:\n{my_aice}");
    assert!(!my_aice.contains("col \"INDEX\"") && !my_aice.contains("\n  INDEX:"), "MySQL INDEX misparsed as column:\n{my_aice}");
    assert!(my_aice.contains("con| KEY `IDX_RUN` (`run_id`)"), "missing KEY constraint:\n{my_aice}");
    assert!(my_aice.contains("con| INDEX idx_title (`title`)"), "missing INDEX constraint:\n{my_aice}");
    assert!(my_aice.contains("col \"`key`\": VARCHAR(50)"), "real column `key` misclassified:\n{my_aice}");
    assert!(my_nat.contains("KEY `IDX_RUN` (`run_id`)") && my_nat.contains("INDEX idx_title (`title`)"), "{my_nat}");

    // Also verify FULLTEXT KEY/INDEX, SPATIAL KEY/INDEX, and unquoted column `key VARCHAR(50)` IR classification
    let mysql_ext = r#"CREATE TABLE `articles` (
  `id` INT NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `geom` GEOMETRY NOT NULL,
  key VARCHAR(50) NOT NULL,
  FULLTEXT KEY ft_title (`title`),
  FULLTEXT INDEX ft_title2 (`title`),
  SPATIAL KEY sp_geom (`geom`),
  SPATIAL INDEX sp_geom2 (`geom`)
) ENGINE=InnoDB;
"#;
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let tree = reg.adapter(LanguageId::MySql).unwrap().parse_cst(mysql_ext).unwrap();
    let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, mysql_ext, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled for mysql_ext");
    };
    let ext_aice = print_aice(&m);
    let ext_reparsed = parse_aice(&ext_aice).expect("parse mysql_ext AICE");
    let ext_nat = tr.to_native(&ext_reparsed, LanguageId::MySql).expect("compile mysql_ext");
    assert!(!ext_aice.contains("col \"FULLTEXT\"") && !ext_aice.contains("\n  FULLTEXT ") && !ext_aice.contains("col \"SPATIAL\"") && !ext_aice.contains("\n  SPATIAL "), "FULLTEXT/SPATIAL misparsed as col:\n{ext_aice}");
    assert!(ext_aice.contains("key VARCHAR(50)"), "unquoted key column misclassified:\n{ext_aice}");
    assert!(ext_aice.contains("con| FULLTEXT KEY ft_title (`title`)"), "missing FULLTEXT KEY:\n{ext_aice}");
    assert!(ext_aice.contains("con| FULLTEXT INDEX ft_title2 (`title`)"), "missing FULLTEXT INDEX:\n{ext_aice}");
    assert!(ext_aice.contains("con| SPATIAL KEY sp_geom (`geom`)"), "missing SPATIAL KEY:\n{ext_aice}");
    assert!(ext_aice.contains("con| SPATIAL INDEX sp_geom2 (`geom`)"), "missing SPATIAL INDEX:\n{ext_aice}");
    assert!(ext_nat.contains("FULLTEXT KEY ft_title (`title`)") && ext_nat.contains("SPATIAL INDEX sp_geom2 (`geom`)"), "{ext_nat}");
}

#[test]
fn f24_js_ts_and_polyglot_new_operator_preserved() {
    let js = r#"export function createMockJQuery(classes) {
  const elements = new Map();
  const seen = new Set(classes);
  const ts = new Date();
  const custom = new ns.CustomMap(1, 2);
  const hit = new Map().get("k");
  if (!seen.size) {
    throw new RangeError("empty");
  }
  return { elements, seen, ts, custom, hit };
}
"#;
    let (js_aice, js_nat) = roundtrip(LanguageId::JavaScript, "frontend.test.mjs", js);
    assert!(js_aice.contains("elements := new Map()"), "JS dropped new Map():\n{js_aice}");
    assert!(js_aice.contains("seen := new Set(classes)"), "JS dropped new Set():\n{js_aice}");
    assert!(js_aice.contains("ts := new Date()"), "JS dropped new Date():\n{js_aice}");
    assert!(js_aice.contains("custom := new ns.CustomMap(1, 2)"), "JS dropped new ns.CustomMap:\n{js_aice}");
    assert!(js_aice.contains("hit := new Map().get(\"k\")"), "JS corrupted chained new Map().get():\n{js_aice}");
    assert!(js_aice.contains("throw new RangeError(\"empty\")"), "JS dropped new RangeError:\n{js_aice}");

    assert!(js_nat.contains("const elements = new Map();"), "JS native lost new Map():\n{js_nat}");
    assert!(js_nat.contains("const seen = new Set(classes);"), "JS native lost new Set():\n{js_nat}");
    assert!(js_nat.contains("const custom = new ns.CustomMap(1, 2);"), "JS native lost new ns.CustomMap:\n{js_nat}");
    assert!(js_nat.contains("new Map().get(\"k\")"), "JS native lost chained new Map().get:\n{js_nat}");
    assert!(js_nat.contains("throw new RangeError(\"empty\");"), "JS native lost throw new:\n{js_nat}");

    let ts = r#"export function makeStore(): Map<string, number> {
  const store = new Map<string, number>();
  return store;
}
"#;
    let (ts_aice, ts_nat) = roundtrip(LanguageId::TypeScript, "store.ts", ts);
    assert!(ts_aice.contains("new Map()"), "TS dropped new Map():\n{ts_aice}");
    assert!(ts_nat.contains("new Map()"), "TS native lost new Map():\n{ts_nat}");

    // Polyglot constructor preservation: Java, C#, PHP + Rust `fn new` / `Vec::new` guard
    let java = r#"public class Box {
    public Object make(String msg) {
        if (msg == null) {
            throw new IllegalArgumentException("missing");
        }
        return new HashMap<>();
    }
}
"#;
    let (j_aice, j_nat) = roundtrip(LanguageId::Java, "Box.java", java);
    assert!(j_aice.contains("new IllegalArgumentException(\"missing\")") && j_aice.contains("new HashMap<>()"), "Java lost new:\n{j_aice}");
    assert!(j_nat.contains("new IllegalArgumentException(\"missing\")") && j_nat.contains("new HashMap<>()"), "Java native lost new:\n{j_nat}");

    let rs = r#"pub struct Item { pub id: i64 }
impl Item {
    pub fn new(id: i64) -> Self {
        let new = id + 1;
        let v = Vec::new();
        Item { id: new }
    }
}
"#;
    let (rs_aice, rs_nat) = roundtrip(LanguageId::Rust, "item.rs", rs);
    assert!(rs_aice.contains("pub fn new(") && rs_aice.contains("Vec::new()"), "Rust new ident broken:\n{rs_aice}");
    assert!(rs_nat.contains("pub fn new(") && rs_nat.contains("Vec::new()"), "Rust native new broken:\n{rs_nat}");
}
