use std::path::Path;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn roundtrip(lang: LanguageId, vpath: &str, src: &str) -> (String, String) {
    let reg = EngineRegistry::default();
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;
    let tree = reg.adapter(lang).unwrap().parse_cst(src).unwrap_or_else(|e| panic!("CST {lang:?}: {e:?}"));
    let TranspileOutcome::Transpiled(m) = transpiler.to_aice(&tree, src, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled for {lang:?}");
    };
    let aice = print_aice(&m);
    let reparsed = parse_aice(&aice).unwrap_or_else(|e| panic!("parse_aice {lang:?}: {e}\n--- AICE ---\n{aice}"));
    let native = transpiler.to_native(&reparsed, lang).unwrap();
    assert_eq!(
        fw.verify(&native, Path::new(vpath), lang),
        FirewallVerdict::Valid,
        "Firewall rejected {lang:?}:\n--- NATIVE ---\n{native}\n--- AICE ---\n{aice}"
    );
    (aice, native)
}

#[test]
fn c1_ts_tsx_js_regressions() {
    let tsx = "export function UserCard({ title, count, active = false }: CardProps) {\n  return <button onClick={() => setLikes(likes + 1)}>{active ? \"Active\" : \"Idle\"} ({likes})</button>;\n}\n";
    let (aice_tsx, nat_tsx) = roundtrip(LanguageId::Tsx, "card.tsx", tsx);
    assert!(aice_tsx.contains("Active") && aice_tsx.contains("likes"), "TSX lost children:\n{aice_tsx}");
    assert!(nat_tsx.contains("Active") && nat_tsx.contains("likes"), "TSX native lost children:\n{nat_tsx}");

    let ts = "export type Result<T, E = Error> = T | E;\nexport async function fetchPair<T>({ id, retry = 3 }: { id: string; retry?: number }, fnMap: (x: string) => Promise<T>): Promise<Result<T, Error>> {\n  return fnMap(id);\n}\nexport const add = (a: number = 1, b: number = 2) => a + b;\nexport class Greeter {\n  greet() {\n    return \"private key\";\n  }\n}\n";
    let (aice_ts, nat_ts) = roundtrip(LanguageId::TypeScript, "mod.ts", ts);
    assert!(aice_ts.contains("a: num = 1"), "TS arrow lost READ-02 num/default:\n{aice_ts}");
    assert!(!aice_ts.contains("priv fn greet"), "TS body string triggered priv:\n{aice_ts}");
    assert!(nat_ts.contains("fetchPair<T>") && nat_ts.contains("Result<T, Error>"), "TS lost generics:\n{nat_ts}");
    assert!(nat_ts.contains("a: number = 1"), "TS arrow native lost type/default:\n{nat_ts}");

    let js = "export class TokenScanner {\n  #pos = 0;\n  rest(input) {\n    return input.slice(this.#pos);\n  }\n}\n";
    let (_, nat_js) = roundtrip(LanguageId::JavaScript, "scan.js", js);
    assert!(nat_js.contains("this.#pos"), "JS lost #pos:\n{nat_js}");

    let tsx_min = "export const El = () => <div data-id=\"1\" disabled/>;\n";
    let (aice_min, nat_min) = roundtrip(LanguageId::Tsx, "el.tsx", tsx_min);
    assert!(!aice_min.contains("<div"), "TSX leaked raw <div into AICE:\n{aice_min}");
    assert!(nat_min.contains("<div") && nat_min.contains("data-id=\"1\""), "TSX lost <div/>:\n{nat_min}");

    let tsx_tern = "export function List({ items }: { items: string[] }) {\n  return <div>{items.length > 0 ? <span>{items.length}</span> : null}</div>;\n}\n";
    let (aice_tern, nat_tern) = roundtrip(LanguageId::Tsx, "list.tsx", tsx_tern);
    assert!(!aice_tern.contains("<span>"), "TSX ternary leaked raw JSX:\n{aice_tern}");
    assert!(nat_tern.contains("<span>") && nat_tern.contains("items.length"), "TSX ternary lost JSX:\n{nat_tern}");

    let ts_try_closure = "export function f(x: number): number {\n  const g = (a: number) => {\n    try {\n      return a;\n    } catch (e) {\n      return 0;\n    }\n  };\n  return g(x);\n}\n";
    let (_, nat_try_cl) = roundtrip(LanguageId::TypeScript, "try_cl.ts", ts_try_closure);
    assert!(nat_try_cl.contains("try {") && nat_try_cl.contains("catch (e)"), "TS closure try/catch lost:\n{nat_try_cl}");
}

#[test]
fn c2_rust_go_kotlin_regressions() {
    let rs = "#[derive(Debug)]\npub enum Frame {\n  Ping,\n  Data { seq: u64 },\n}\npub struct Empty;\nimpl Empty {\n  pub fn ping(&self) -> i64 { 1 }\n}\nstruct PrivEmpty;\nimpl PrivEmpty {\n  fn pong(&mut self) -> i64 { 2 }\n}\npub struct Bag { pub items: Vec<i64> }\nimpl Bag {\n  pub fn push_it(&mut self, v: &mut i64) { *v += 1; }\n  pub fn total(&self) -> i64 {\n    let mut s = 0;\n    for x in &self.items {\n      if *x > 0 { s += *x; } else { s += 1; }\n    }\n    return s;\n  }\n}\npub trait Codec {\n  fn encode(&self) -> Vec<u8>;\n}\npub fn double_val(v: i64) -> i64 {\n  return v * 2;\n}\npub fn describe(f: Frame, xs: Vec<i64>) -> i64 {\n  let mut acc = 0;\n  for x in xs {\n    if x > 0 { acc += x; } else { acc += 1; }\n  }\n  while acc > 10 { acc -= 2; }\n  match f {\n    Frame::Ping => 1,\n    Frame::Data { seq, .. } if *seq > 0 => *seq as i64,\n    _ => acc,\n  }\n}\n";
    let (aice_rs, nat_rs) = roundtrip(LanguageId::Rust, "lib.rs", rs);
    assert!(aice_rs.contains("Data { seq:u64 }") && nat_rs.contains("Data { seq: u64 }"), "Rust lost enum payload:\n{aice_rs}\n{nat_rs}");
    assert!(nat_rs.contains("fn encode(&self)"), "Rust lost &self:\n{nat_rs}");
    assert!(aice_rs.contains("double_val(v:i64) -> i64 = v * 2") && nat_rs.contains("v * 2"), "Rust lost return_expression:\n{aice_rs}\n{nat_rs}");
    assert!(nat_rs.contains("&self.items") && nat_rs.contains("*x > 0") && nat_rs.contains("if *seq > 0"), "Rust lost ref/deref:\n{nat_rs}");
    assert!(nat_rs.contains("*seq as i64") && !nat_rs.contains("*(seq as i64)"), "Rust precedence corrupted *seq as i64:\n{nat_rs}");
    assert!(nat_rs.contains("pub struct Empty") && nat_rs.contains("impl Empty") && nat_rs.contains("struct PrivEmpty;"), "Rust dropped Empty struct:\n{nat_rs}");

    let rs_immut = "pub fn deref_ref(x: &i64) -> i64 {\n  let p = &*x;\n  *p\n}\n";
    let (aice_immut, nat_immut) = roundtrip(LanguageId::Rust, "immut.rs", rs_immut);
    assert!(aice_immut.contains("p :=") && !aice_immut.contains("p ::="), "Rust immutable let marked mut:\n{aice_immut}");
    assert!(nat_immut.contains("let p =") && !nat_immut.contains("let mut p"), "Rust emitted let mut for immutable let:\n{nat_immut}");

    let go = "package pool\ntype Empty struct{}\nfunc (e *Empty) Ping() int { return 1 }\ntype Runner interface {\n  Run(id string) error\n}\nfunc SumTo(n int) int {\n  acc := 0\n  for i := 0; i < n; i++ {\n    acc += i\n  }\n  return acc\n}\nfunc Classify(items []int, flag bool) int {\n  acc := 0\n  if flag {\n    for _, x := range items {\n      acc += x\n    }\n  } else if len(items) == 0 {\n    return 0\n  } else {\n    return 1\n  }\n  return acc\n}\nfunc (p *Pool) Next(ctx context.Context) (int, bool) {\n  select {\n  case v := <-p.jobs:\n    return v, true\n  case <-ctx.Done():\n    return 0, false\n  }\n}\n";
    let (_, nat_go) = roundtrip(LanguageId::Go, "pool.go", go);
    assert!(nat_go.contains("type Runner interface") && nat_go.contains("Run("), "Go lost interface:\n{nat_go}");
    assert!(nat_go.contains("select {") && nat_go.contains("case v := <-p.jobs:"), "Go lost select:\n{nat_go}");
    assert!(nat_go.contains("for _, x := range items"), "Go lost range loop:\n{nat_go}");
    assert!(nat_go.contains("i := 0") && nat_go.contains("i < n") && nat_go.contains("i++"), "Go 3-part for dropped init/update:\n{nat_go}");
    assert!(nat_go.contains("type Empty struct {}") && nat_go.contains("Ping()"), "Go dropped Empty struct:\n{nat_go}");

    let go_cont = "package p\nfunc sumOdd(n int) int {\n  acc := 0\n  for i := 0; i < n; i++ {\n    if i%2 == 0 {\n      continue\n    }\n    acc += i\n  }\n  return acc\n}\n";
    let (_, nat_go_cont) = roundtrip(LanguageId::Go, "sum_odd.go", go_cont);
    assert!(nat_go_cont.matches("i++").count() >= 2, "Go for_clause continue skipped i++:\n{nat_go_cont}");

    let kt = "fun describeStatus(code: Int): String {\n  return when (code) {\n    200 -> \"ok\"\n    404 -> \"missing\"\n    else -> \"error\"\n  }\n}\nfun classify(n: Int): String {\n  return when {\n    n < 0 -> \"neg\"\n    n == 0 -> \"zero\"\n    else -> \"pos\"\n  }\n}\nfun route(code: Int, x: Any): String {\n  when (code) {\n    200, 201 -> println(\"ok\")\n    else -> println(\"bad\")\n  }\n  when (x) {\n    is Int -> println(\"int\")\n    !is String -> println(\"notstr\")\n    else -> println(\"str\")\n  }\n  return when (code) {\n    in 200..299 -> \"2xx\"\n    !in 1..10 -> \"out\"\n    404 -> {\n      val msg = \"missing\"\n      msg\n    }\n    else -> \"other\"\n  }\n}\n";
    let (aice_kt, nat_kt) = roundtrip(LanguageId::Kotlin, "status.kt", kt);
    assert!(nat_kt.contains("when (code)"), "Kotlin lost when:\n{nat_kt}");
    assert!(
        nat_kt.contains("200 -> \"ok\"") && nat_kt.contains("404 -> \"missing\"") && nat_kt.contains("else -> \"error\"")
            && !nat_kt.contains("pass") && !nat_kt.contains("Unit"),
        "Kotlin collapsed when arms:\n{nat_kt}"
    );
    assert!(
        nat_kt.contains("when {") && nat_kt.contains("n < 0 -> \"neg\"") && nat_kt.contains("n == 0 -> \"zero\"") && nat_kt.contains("else -> \"pos\""),
        "Kotlin lost subjectless when:\n{nat_kt}"
    );
    assert!(!aice_kt.contains("val msg ="), "Kotlin leaked raw val in when block:\n{aice_kt}");
    assert!(nat_kt.contains("200, 201 ->") && nat_kt.contains("in 200..299 ->") && nat_kt.contains("!in 1..10 ->"), "Kotlin lost comma/range when arms:\n{nat_kt}");
    assert!(nat_kt.contains("is Int ->") && nat_kt.contains("!is String ->") && nat_kt.contains("val msg = \"missing\""), "Kotlin lost type/block when arms:\n{nat_kt}");
}

#[test]
fn c3_c_cpp_csharp_java_regressions() {
    let c_src = "int validate_header(const PacketHeader* hdr) {\n  if (!hdr) { return -1; }\n  return 0;\n}\n";
    let (aice_c, nat_c) = roundtrip(LanguageId::C, "hdr.c", c_src);
    assert!(!aice_c.contains("(* "), "C leaked * into param name:\n{aice_c}");
    assert!(nat_c.contains("PacketHeader* hdr"), "C lost pointer param:\n{nat_c}");

    let cpp_src = "#include <vector>\nenum class Mode { Fast, Safe };\nnamespace math {\ntemplate <typename T>\nclass Box {\npublic:\n  template <typename U>\n  U cast(T v) { return v; }\n  int sum(const std::vector<int>& items) {\n    int acc = 0;\n    try {\n      for (const auto& x : items) { acc += x; }\n    } catch (int e) {\n      return -e;\n    } catch (...) {\n      return -2;\n    }\n    return acc;\n  }\n};\n}\n";
    let (_, nat_cpp) = roundtrip(LanguageId::Cpp, "box.cpp", cpp_src);
    assert!(nat_cpp.contains("enum class Mode { Fast, Safe };"), "C++ enum class missing ';':\n{nat_cpp}");
    assert!(nat_cpp.contains("template <typename T>"), "C++ lost class template:\n{nat_cpp}");
    assert!(nat_cpp.contains("template <typename U>"), "C++ lost method template:\n{nat_cpp}");
    assert!(nat_cpp.contains("catch (int e)"), "C++ lost catch (int e):\n{nat_cpp}");
    assert!(nat_cpp.contains("catch (...)"), "C++ rewrote catch (...):\n{nat_cpp}");
    assert!(nat_cpp.contains("auto& x : items"), "C++ renamed loop var x:\n{nat_cpp}");

    let cs_expr = "class A {\n  int F(int x) => x + 1;\n  int P => 42;\n}\n";
    let (_, nat_cs_expr) = roundtrip(LanguageId::CSharp, "expr.cs", cs_expr);
    assert!(nat_cs_expr.contains("return x + 1;") && nat_cs_expr.contains("42"), "C# expression-bodied member broken:\n{nat_cs_expr}");

    let cs_src = "namespace App.Ledger {\npublic enum Status { Active, Pending }\npublic interface IRepo { int Count(); }\npublic record Entry(string Id, decimal Amount);\npublic class Svc {\n  public async Task<int> ComputeAsync(int raw, int[] xs) {\n    int acc = 0;\n    foreach (var x in xs) {\n      if (x > 0) { acc += x; } else { acc += 2; }\n    }\n    return acc;\n  }\n}\n}\n";
    let (_, nat_cs) = roundtrip(LanguageId::CSharp, "ledger.cs", cs_src);
    assert!(nat_cs.contains("namespace App.Ledger {"), "C# namespace broken:\n{nat_cs}");
    assert!(nat_cs.contains("enum Status"), "C# dropped enum:\n{nat_cs}");
    assert!(nat_cs.contains("interface IRepo"), "C# flattened interface:\n{nat_cs}");
    assert!(nat_cs.contains("record Entry("), "C# corrupted record:\n{nat_cs}");
    assert!(nat_cs.contains("async "), "C# dropped async:\n{nat_cs}");
    assert!(nat_cs.contains("int acc = 0;") && nat_cs.contains("} else {") && nat_cs.contains("foreach (var x in xs)"), "C# lost loop/else/local:\n{nat_cs}");

    let java_src = "package p;\npublic enum Status { ACTIVE, PENDING }\npublic interface Repo { int count(); }\npublic class Svc {\n  public int sum(int[] xs) {\n    int acc = 0;\n    for (int x : xs) {\n      if (x > 0) { acc += x; } else { acc += 2; }\n    }\n    return acc;\n  }\n}\n";
    let (_, nat_java) = roundtrip(LanguageId::Java, "Svc.java", java_src);
    assert!(nat_java.contains("enum Status") && nat_java.contains("interface Repo"), "Java dropped enum/interface:\n{nat_java}");
    assert!(nat_java.contains("} else {") && nat_java.contains("for (var x : xs)"), "Java lost else or loop var:\n{nat_java}");
}

#[test]
fn c4_dart_ruby_php_toml_twig_graphql_regressions() {
    let dart_src = "int add(int a, [int b = 1]) { return a + b; }\nint add2(int a, int b = 1) { return a + b; }\nvoid greet({required String name, int count = 0}) { print(name); }\nint demo(int x) {\n  var g = (int b) => b + 1;\n  return g(x);\n}\nvoid bind({required void Function(int) onTap, List<int> xs = const []}) { onTap(0); }\nclass Config {\n  final String host;\n  final int port;\n  const Config({required this.host, this.port = 8080});\n}\nclass Foo {\n  final int x;\n  Foo(this.x);\n  int getX() { return x; }\n}\n";
    let (_, nat_dart) = roundtrip(LanguageId::Dart, "foo.dart", dart_src);
    assert!(nat_dart.contains("int add(") && nat_dart.contains("int add2(") && nat_dart.contains("Foo(this.x)") && nat_dart.contains("getX()"), "Dart lost members:\n{nat_dart}");
    assert!(nat_dart.contains("int b = 1") && nat_dart.contains("this.host") && nat_dart.contains("this.port = 8080") && nat_dart.contains("count = 0"), "Dart lost default/named params:\n{nat_dart}");
    assert!(nat_dart.contains("=> b + 1") && nat_dart.contains("xs = []"), "Dart lost arrow lambda or empty list default:\n{nat_dart}");

    let rb_src = "def send_alert(user, msg)\n  unless user.nil?\n    puts \"Alert for #{user}: #{msg}\"\n  end\nend\ndef classify(n)\n  case\n  when n < 0\n    \"neg\"\n  when n == 0\n    \"zero\"\n  else\n    \"pos\"\n  end\nend\nclass Job\n  def total\n    @amount + @tax\n  end\n  def run(items, n)\n    @n = n\n    @amount = 10\n    @tax = 2\n    items.each { |x| puts x }\n    for x in items\n      puts x\n    end\n    begin\n      while @n > 0\n        @n -= 1\n      end\n    rescue ArgumentError, TypeError => e\n      return -1\n    ensure\n      puts \"done\"\n    end\n    case n\n    when 0\n      return @amount + @tax\n    else\n      return @n\n    end\n  end\nend\n";
    let (aice_rb, nat_rb) = roundtrip(LanguageId::Ruby, "alert.rb", rb_src);
    assert!(!aice_rb.contains("in in items"), "Ruby doubled 'in':\n{aice_rb}");
    assert!(nat_rb.contains("!(user == nil)"), "Ruby unless precedence inverted:\n{nat_rb}");
    assert!(nat_rb.contains("if n < 0") && nat_rb.contains("elsif n == 0") && !nat_rb.contains("case true"), "Ruby subjectless case broken:\n{nat_rb}");
    assert!(nat_rb.contains("items.each { |x| puts(x) }"), "Ruby call block dropped:\n{nat_rb}");
    assert!(nat_rb.contains("rescue ArgumentError, TypeError => e"), "Ruby rescue exception classes dropped:\n{nat_rb}");
    assert!(nat_rb.contains("while @n > 0") && nat_rb.contains("@n -= 1") && nat_rb.contains("@amount + @tax"), "Ruby lost @ivar:\n{nat_rb}");
    assert!(nat_rb.contains("begin") && nat_rb.contains("rescue") && nat_rb.contains("ensure"), "Ruby lost begin/rescue/ensure:\n{nat_rb}");
    assert!(nat_rb.contains("case n") && nat_rb.contains("when 0"), "Ruby lost case/when:\n{nat_rb}");

    let php_src = "<?php\ndeclare(strict_types=1);\nnamespace App\\Billing;\nclass OrderService {\n  public function total(array $items): int {\n    $acc = 0;\n    foreach ($items as $x) { $acc += $x; }\n    return count($items) + $acc;\n  }\n}\n";
    let (_, nat_php) = roundtrip(LanguageId::Php, "order.php", php_src);
    assert!(nat_php.contains("namespace App\\Billing;"), "PHP lost namespace:\n{nat_php}");
    assert!(nat_php.contains("count($items)") && !nat_php.contains("$count("), "PHP mangled count():\n{nat_php}");
    assert!(nat_php.contains("as $x)"), "PHP renamed foreach var:\n{nat_php}");

    let toml_src = "[package]\nname = \"demo\"\n\n[dependencies]\nserde = { version = \"1.0\", features = [\"derive\"] }\n";
    let (_, nat_toml) = roundtrip(LanguageId::Toml, "Cargo.toml", toml_src);
    assert!(nat_toml.contains("version = \"1.0\"") && nat_toml.contains("\"derive\""), "TOML lost inline table:\n{nat_toml}");

    let twig_src = "{# multi\nline comment #}\n{% if ok %}Hello{% else %}Bye{% endif %}";
    let (_, nat_twig) = roundtrip(LanguageId::Twig, "msg.twig", twig_src);
    assert!(nat_twig.contains("Hello") && nat_twig.contains("Bye") && nat_twig.contains("multi") && nat_twig.contains("line comment"), "Twig dropped text/comment:\n{nat_twig}");

    let gql_src = "scalar DateTime\nenum Status { OPEN CLOSED }\ninterface Node { id: ID! }\ninterface Entity { createdAt: DateTime! }\ntype User implements Node & Entity { id: ID! createdAt: DateTime! name: String! }\ninput CreateTicketInput { title: String! }\n";
    let (aice_gql, nat_gql) = roundtrip(LanguageId::GraphQl, "schema.graphql", gql_src);
    assert!(nat_gql.contains("scalar DateTime") && !nat_gql.contains("scalar DateTime {"), "GQL scalar invalid:\n{nat_gql}");
    assert!(nat_gql.contains("enum Status") && nat_gql.contains("OPEN") && nat_gql.contains("CLOSED"), "GQL enum lost:\n{nat_gql}");
    assert!(nat_gql.contains("input CreateTicketInput"), "GQL input invalid:\n{nat_gql}");
    assert!(aice_gql.contains("implements: Node, Entity") && nat_gql.contains("type User implements Node & Entity"), "GQL implements lost:\n{aice_gql}\n{nat_gql}");

    let pg_trig = "CREATE TRIGGER tr_audit AFTER UPDATE ON ledger FOR EACH ROW EXECUTE FUNCTION audit_balance_change();\n";
    let (aice_pg, _) = roundtrip(LanguageId::PostgreSql, "trig.sql", pg_trig);
    assert!(!aice_pg.contains("proc \"postgresql\" fn"), "PG trigger misclassified as fn:\n{aice_pg}");

    let tsql_proc = "CREATE PROCEDURE dbo.usp_SyncLedger AS BEGIN SELECT TOP (10) id FROM ledger; END\n";
    let (aice_tsql, _) = roundtrip(LanguageId::TSql, "proc.sql", tsql_proc);
    assert!(!aice_tsql.contains("(\"10\")"), "TSQL extracted TOP(10) as param:\n{aice_tsql}");

    let mysql_proc = "DELIMITER //\nCREATE PROCEDURE p(IN p_total DECIMAL(10,2), OUT p_ok INT)\nBEGIN\n  SET p_ok = 1;\nEND //\nDELIMITER ;\n";
    let (aice_mysql, _) = roundtrip(LanguageId::MySql, "proc.sql", mysql_proc);
    assert!(aice_mysql.contains("DECIMAL(10,2)"), "MySQL truncated DECIMAL(10,2):\n{aice_mysql}");

    let mysql_no_delim = "CREATE PROCEDURE add_item(IN p_id INT, IN p_amt DECIMAL(10,2))\nBEGIN\n  INSERT INTO items(id, amt) VALUES (p_id, p_amt);\nEND;\n";
    let (aice_nd, nat_nd) = roundtrip(LanguageId::MySql, "proc2.sql", mysql_no_delim);
    assert!(!aice_nd.contains("ddl: \"END\""), "MySQL split BEGIN..END without DELIMITER:\n{aice_nd}");
    assert!(nat_nd.contains("CREATE PROCEDURE add_item"), "MySQL lost proc:\n{nat_nd}");

    let mysql_trig = "CREATE TRIGGER audit_ins AFTER INSERT ON items\nFOR EACH ROW\nBEGIN\n  INSERT INTO audit_log(item_id) VALUES (NEW.id);\nEND;\n";
    let (_, nat_trig) = roundtrip(LanguageId::MySql, "trig.sql", mysql_trig);
    assert!(nat_trig.contains("DELIMITER //") && nat_trig.contains("CREATE TRIGGER audit_ins"), "MySQL trigger missing DELIMITER //:\n{nat_trig}");
}

#[test]
fn c5_iter5_blocking_and_polish_regressions() {
    // Item 1b: Go switch + 3-part for + continue
    let go_sw = "package p\nfunc f(mode int) int {\n  acc := 0\n  switch mode {\n  case 1:\n    for i := 0; i < 3; i++ {\n      if i == 1 {\n        continue\n      }\n      acc += i\n    }\n  }\n  return acc\n}\n";
    let (_, nat_go_sw) = roundtrip(LanguageId::Go, "sw.go", go_sw);
    assert!(nat_go_sw.matches("i++").count() >= 2, "Go switch+for+continue lost i++:\n{nat_go_sw}");

    // Item 3 & 8: Kotlin until range, collection in/!in, and if_expression inside when
    let kt_adv = "fun routeAdv(code: Int, ok: Boolean, validSet: Set<Int>): String {\n  when (code) {\n    !in 1 until 10 -> println(\"a\")\n    in validSet -> println(\"b\")\n    else -> println(\"c\")\n  }\n  return when (code) {\n    200, 201 -> if (ok) \"ok\" else \"wait\"\n    else -> \"err\"\n  }\n}\n";
    let (aice_kt_adv, nat_kt_adv) = roundtrip(LanguageId::Kotlin, "adv.kt", kt_adv);
    assert!(aice_kt_adv.contains("!in 1..10"), "Kotlin !in until lost exclusive bound:\n{aice_kt_adv}");
    assert!(aice_kt_adv.contains("code in validSet"), "Kotlin collection in lost:\n{aice_kt_adv}");
    assert!(aice_kt_adv.contains("ok ? \"ok\" : \"wait\""), "Kotlin if_expression leaked raw:\n{aice_kt_adv}");
    assert!(nat_kt_adv.contains("if (ok) \"ok\" else \"wait\""), "Kotlin conditional lost:\n{nat_kt_adv}");
    assert!(nat_kt_adv.contains("code in validSet"), "Kotlin in validSet lost:\n{nat_kt_adv}");

    // Cross-compile Kotlin collection `in` + `is List<String>` to Python/Ruby/Rust/CSharp
    let reparsed_kt = parse_aice(&aice_kt_adv).unwrap();
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;
    for (lang, path) in [
        (LanguageId::Python, "adv.py"),
        (LanguageId::Ruby, "adv.rb"),
        (LanguageId::Rust, "adv.rs"),
        (LanguageId::CSharp, "Adv.cs"),
        (LanguageId::TypeScript, "adv.ts"),
    ] {
        let nat = transpiler.to_native(&reparsed_kt, lang).unwrap();
        assert_eq!(fw.verify(&nat, Path::new(path), lang), FirewallVerdict::Valid, "Cross-compile {lang:?}:\n{nat}");
    }

    // Item 4: Ruby 1..5 vs 6...10, multi-cond subjectless when, rescue Foo::Bar => e, indented do..end
    let rb_adv = "def rng(x, n, items)\n  case x\n  when 1..5\n    \"low\"\n  when 6...10\n    \"mid\"\n  else\n    \"high\"\n  end\n  case\n  when n < 0, n > 100\n    \"out\"\n  else\n    \"ok\"\n  end\n  items.each do |it|\n    puts it\n    y = it + 1\n  end\n  begin\n    raise \"boom\"\n  rescue Foo::Bar => e\n    return -1\n  end\nend\n";
    let (aice_rb_adv, nat_rb_adv) = roundtrip(LanguageId::Ruby, "adv.rb", rb_adv);
    assert!(aice_rb_adv.contains("in 1..=5") && aice_rb_adv.contains("in 6..10"), "Ruby ranges mis-mapped:\n{aice_rb_adv}");
    assert!(nat_rb_adv.contains("when 1..5") && nat_rb_adv.contains("when 6...10"), "Ruby range inclusivity inverted:\n{nat_rb_adv}");
    assert!(nat_rb_adv.contains("n < 0 || n > 100"), "Ruby subjectless comma cond dropped:\n{nat_rb_adv}");
    assert!(nat_rb_adv.contains("rescue Foo::Bar => e"), "Ruby rescue Foo::Bar emitted dot:\n{nat_rb_adv}");
    assert!(nat_rb_adv.contains("  items.each do |it|\n    puts(it)\n    y = it + 1\n  end"), "Ruby do..end misindented:\n{nat_rb_adv}");

    // Item 7: Dart typed list_literal const <int>[] & <int>[1, 2]
    let dart_adv = "class Calc {\n  void bind({List<int> ys = const <int>[]}) {\n    var xs = <int>[1, 2];\n  }\n}\n";
    let (aice_dart_adv, nat_dart_adv) = roundtrip(LanguageId::Dart, "calc.dart", dart_adv);
    assert!(!aice_dart_adv.contains("<int>"), "Dart typed list leaked <int>:\n{aice_dart_adv}");
    assert!(nat_dart_adv.contains("ys = []") && nat_dart_adv.contains("xs = [1, 2]"), "Dart list values lost:\n{nat_dart_adv}");

    // Minor polish: C# void & constructor => expressions
    let cs_void = "class Logger {\n  int _x;\n  public Logger(int x) => _x = x;\n  public void Log(string s) => Console.WriteLine(s);\n}\n";
    let (_, nat_cs_void) = roundtrip(LanguageId::CSharp, "log.cs", cs_void);
    assert!(!nat_cs_void.contains("return _x = x") && !nat_cs_void.contains("return Console.WriteLine"), "C# void/ctor emitted return:\n{nat_cs_void}");
}
