import { describe, expect, it } from "vitest";
import { generateOutline } from "../../src/tools/outline.js";
import { extractSymbolFromAiceSource } from "../../src/tools/context.js";
import { spliceSource } from "../../src/tools/splice.js";
import { validateNativeSyntax } from "../../src/tools/syntax-validator.js";
describe("AIPL (.aipl) Dialect Support (33 extensions)", () => {
  const sampleAipl = `module GameState

pub struct Hero:
  hp: i32
  max_hp: i32
  speed: f32

pub enum ItemType:
  Weapon
  Potion
  Armor

pub fn heal(hero: Hero, amount: i32): i32:
  hero.hp = hero.hp + amount
  hero.hp

fn secret_roll(d: i32): i32:
  d * 2
`;

  it("extracts AIPL outline symbols accurately with line spans", () => {
    const outline = generateOutline(sampleAipl, "game.aipl");
    expect(outline.symbols.length).toBeGreaterThanOrEqual(4);

    const mod = outline.symbols.find((s) => s.kind === "module");
    expect(mod).toBeDefined();
    expect(mod?.name).toBe("GameState");

    const hero = outline.symbols.find((s) => s.name === "Hero");
    expect(hero).toBeDefined();
    expect(hero?.kind).toBe("class");
    expect(hero?.children?.length).toBe(3);

    const healFn = outline.symbols.find((s) => s.name === "heal");
    expect(healFn).toBeDefined();
    expect(healFn?.kind).toBe("function");
  });
  it("extracts AIPL context symbols accurately", () => {
    const extracted = extractSymbolFromAiceSource(sampleAipl, "Hero", "game.aipl");
    expect(extracted).toContain("pub struct Hero:");
    expect(extracted).toContain("hp: i32");
  });
  it("splices AIPL functions cleanly without ceremony", () => {
    const res = spliceSource(
      sampleAipl,
      "heal",
      `pub fn heal(hero: Hero, amount: i32): i32:\n  hero.hp = Math.min(hero.hp + amount, hero.max_hp)\n  hero.hp`,
      false,
      "game.aipl",
    );
    expect(res.success).toBe(true);
    expect(res.modifiedCode).toContain("hero.max_hp");
    expect(res.modifiedCode).toContain("pub struct Hero:");
  });

  it("appends new members to AIPL structs", () => {
    const res = spliceSource(
      sampleAipl,
      "Hero",
      `mana: i32`,
      false,
      "game.aipl",
      undefined,
      { append: true },
    );
    expect(res.success).toBe(true);
    expect(res.modifiedCode).toContain("mana: i32");
  });

  it("validates AIPL structural syntax and flags missing colons and indentation errors", () => {
    const validRes = validateNativeSyntax(sampleAipl, "aipl", "game.aipl");
    expect(validRes.valid).toBe(true);

    const invalidColons = `pub struct BrokenStruct\n  hp: i32\n\npub fn bad_func(x: i32)\n  x + 1\n`;
    const invalidColonsRes = validateNativeSyntax(invalidColons, "aipl", "broken.aipl");
    expect(invalidColonsRes.valid).toBe(false);
    expect(invalidColonsRes.diagnostics.some((d) => d.includes("signature must end with ':'"))).toBe(true);

    const mixedTabs = `pub fn test_tab():\n \tlet x = 1\n  x\n`;
    const mixedTabsRes = validateNativeSyntax(mixedTabs, "aipl", "tab.aipl");
    expect(mixedTabsRes.valid).toBe(false);
    expect(mixedTabsRes.diagnostics.some((d) => d.includes("mixed tabs and spaces"))).toBe(true);

    const badIndent = `let x = 1\n  let y = 2\n`;
    const badIndentRes = validateNativeSyntax(badIndent, "aipl", "indent.aipl");
    expect(badIndentRes.valid).toBe(false);
    expect(badIndentRes.diagnostics.some((d) => d.includes("unexpected indent increase without preceding colon"))).toBe(true);

    const misalignedDedent = `pub fn test_dedent():\n    let x = 1\n  let y = 2\n`;
    const misalignedRes = validateNativeSyntax(misalignedDedent, "aipl", "dedent.aipl");
    expect(misalignedRes.valid).toBe(false);
    expect(misalignedRes.diagnostics.some((d) => d.includes("unindent does not match any outer indentation level"))).toBe(true);
  });

  it("does not emit nested helper functions as top-level outline symbols", () => {
    const codeWithNested = `module NestTest\n\npub fn outer_func():\n  let x = 1\n  fn inner_helper():\n    let y = 2\n  x\n\npub fn second_func():\n  42\n`;
    const outline = generateOutline(codeWithNested, "nested.aipl");
    const funcNames = outline.symbols.filter((s) => s.kind === "function").map((s) => s.name);
    expect(funcNames).toEqual(["outer_func", "second_func"]);
    expect(funcNames).not.toContain("inner_helper");
  });
});
