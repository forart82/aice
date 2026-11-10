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

  it("validates AIPL structural syntax and flags missing colons", () => {
    const validRes = validateNativeSyntax(sampleAipl, "aipl", "game.aipl");
    expect(validRes.valid).toBe(true);

    const invalidAipl = `pub struct BrokenStruct\n  hp: i32\n\npub fn bad_func(x: i32)\n  x + 1\n`;
    const invalidRes = validateNativeSyntax(invalidAipl, "aipl", "broken.aipl");
    expect(invalidRes.valid).toBe(false);
    expect(invalidRes.diagnostics.length).toBeGreaterThanOrEqual(1);
  });
});
