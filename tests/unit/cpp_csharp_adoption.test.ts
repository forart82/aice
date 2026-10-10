/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Comprehensive Test Suite for Step 24: C++20 and C# Engine Adoption.
 * Tests C++20 and C# decompilation, emission, AST roundtrip, tokenomics,
 * and parallel adoption on real-world patterns from Cases 38–47.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../../src/core/parser.js";
import { CppDecompiler } from "../../src/decompiler/cpp-decompiler.js";
import { CSharpDecompiler } from "../../src/decompiler/csharp-decompiler.js";
import { decompile } from "../../src/decompiler/index.js";
import { executeRoundtrip } from "../../src/decompiler/roundtrip.js";
import { detectTargetFromPath, emitTarget } from "../../src/emitters/index.js";
import { calculateFileTokenomics, detectLanguageName } from "../../src/tokenomics/index.js";
import {
  findIngestableFiles,
  ingestProjectSideBySide,
} from "../../src/transpiler/parallel-ingest.js";

describe("Step 24: C++20 and C# Engine Adoption", () => {
  describe("C++20 Decompiler (CppDecompiler)", () => {
    it("decompiles C++20 enum class declarations", () => {
      const cppCode = `
#pragma once

namespace dof::entities {

enum class DiceFace { D4, D6, D8, D12, D20, D100 };

}
`;
      const decompiler = new CppDecompiler(cppCode, "DiceFace.hpp");
      const { ast } = decompiler.decompile();

      expect(ast.items).toHaveLength(1);
      const item = ast.items[0];
      expect(item.kind).toBe("TypeDecl");
      if (item.kind === "TypeDecl") {
        expect(item.name).toBe("DiceFace");
        expect(item.isEnum).toBe(true);
        expect(item.variants?.map((v) => v.name)).toEqual(["D4", "D6", "D8", "D12", "D20", "D100"]);
      }
    });

    it("decompiles C++20 struct with primitive fields and operators (Case 38 EntityId.hpp)", () => {
      const cppCode = `
#pragma once
#include <cstdint>

namespace dof::core {

struct EntityId {
    std::uint64_t value{0};
    bool operator==(EntityId other) const { return value == other.value; }
};

}
`;
      const decompiler = new CppDecompiler(cppCode, "core/EntityId.hpp");
      const { ast } = decompiler.decompile();

      expect(ast.path).toContain("dof::core");
      const structItem = ast.items.find((i) => i.kind === "TypeDecl" && i.name === "EntityId");
      expect(structItem).toBeDefined();
      if (structItem && structItem.kind === "TypeDecl") {
        expect(structItem.fields).toHaveLength(1);
        expect(structItem.fields?.[0].name).toBe("value");
        expect(structItem.fields?.[0].typeAnnotation.kind).toBe("PrimitiveType");
      }
    });

    it("decompiles C++ class with fields, constructor, and methods (Case 46 Point.h)", () => {
      const cppCode = `
#pragma once
#include <SFML/Graphics.hpp>
#include <iostream>

class Point {
private:
  int m_counter;
  int m_score;

public:
  Point(int score);
  void animation();
  int getCounter() const;
};
`;
      const decompiler = new CppDecompiler(cppCode, "header/Point.h");
      const { ast } = decompiler.decompile();

      const classItem = ast.items.find((i) => i.kind === "ClassDecl" && i.name === "Point");
      expect(classItem).toBeDefined();
      if (classItem && classItem.kind === "ClassDecl") {
        expect(classItem.properties.map((p) => p.name)).toContain("m_counter");
        expect(classItem.properties.map((p) => p.name)).toContain("m_score");
        expect(classItem.methods.map((m) => m.name)).toContain("constructor");
        expect(classItem.methods.map((m) => m.name)).toContain("animation");
        expect(classItem.methods.map((m) => m.name)).toContain("getCounter");
      }
    });

    it("decompiles C++ free functions and math expressions (Case 42 MathHelper.cpp)", () => {
      const cppCode = `
#include <cmath>

namespace dof::helpers {

float clampValue(float value, float lo, float hi) {
    if (value < lo) return lo;
    if (value > hi) return hi;
    return value;
}

int clampInt(int value, int lo, int hi) {
    if (value < lo) return lo;
    return value;
}

}
`;
      const decompiler = new CppDecompiler(cppCode, "helpers/MathHelper.cpp");
      const { ast } = decompiler.decompile();

      const fns = ast.items.filter((i) => i.kind === "FunctionDecl");
      expect(fns.length).toBeGreaterThanOrEqual(2);
      expect(fns.map((f) => (f as any).name)).toContain("clampValue");
      expect(fns.map((f) => (f as any).name)).toContain("clampInt");
    });

    it("preserves comments as CST trivia in C++ decompiler", () => {
      const cppCode = `
// Math helper functions for collision bounds
float clampValue(float value, float lo, float hi) {
    return value;
}
`;
      const result = decompile(cppCode, "cpp", { filePath: "test.cpp" });
      expect(result.ail).toContain("Math helper functions for collision bounds");
      expect(result.ail).toContain("fn clampValue");
    });
  });

  describe("C# Decompiler (CSharpDecompiler)", () => {
    it("decompiles C# enum declarations", () => {
      const csCode = `
using System;

namespace Ouroboros.AudioSys;

public enum Wave { Sine, Square, Sawtooth, Triangle }
`;
      const decompiler = new CSharpDecompiler(csCode, "Wave.cs");
      const { ast } = decompiler.decompile();

      const enumItem = ast.items.find((i) => i.kind === "TypeDecl" && i.name === "Wave");
      expect(enumItem).toBeDefined();
      if (enumItem && enumItem.kind === "TypeDecl") {
        expect(enumItem.isEnum).toBe(true);
        expect(enumItem.variants?.map((v) => v.name)).toEqual([
          "Sine",
          "Square",
          "Sawtooth",
          "Triangle",
        ]);
      }
    });

    it("decompiles C# class with properties, constructor and methods (Case 43 FoodItem.cs)", () => {
      const csCode = `
using System;
using Ouroboros.Core;

namespace Ouroboros.Sim;

public sealed partial class FoodItem
{
    public double X;
    public double Y;
    public string Type;
    public bool Dead;

    public FoodItem(double x, double y, string type)
    {
        X = x;
        Y = y;
        Type = type;
        Dead = false;
    }

    public bool Cook()
    {
        if (Type != "apple") return false;
        Type = "golden";
        return true;
    }
}
`;
      const decompiler = new CSharpDecompiler(csCode, "Sim/FoodItem.cs");
      const { ast } = decompiler.decompile();

      const classItem = ast.items.find((i) => i.kind === "ClassDecl" && i.name === "FoodItem");
      expect(classItem).toBeDefined();
      if (classItem && classItem.kind === "ClassDecl") {
        expect(classItem.properties.map((p) => p.name)).toContain("X");
        expect(classItem.properties.map((p) => p.name)).toContain("Y");
        expect(classItem.properties.map((p) => p.name)).toContain("Type");
        expect(classItem.properties.map((p) => p.name)).toContain("Dead");
        expect(classItem.methods.map((m) => m.name)).toContain("constructor");
        expect(classItem.methods.map((m) => m.name)).toContain("Cook");
      }
    });

    it("decompiles C# expression-bodied methods (Case 45 Synth.cs)", () => {
      const csCode = `
using System;

namespace Ouroboros.AudioSys;

public static class Synth
{
    public const double Eps = 0.0001;
    public static bool Num(double v) => !double.IsNaN(v);
}
`;
      const decompiler = new CSharpDecompiler(csCode, "Audio/Synth.cs");
      const { ast } = decompiler.decompile();

      const classItem = ast.items.find((i) => i.kind === "ClassDecl" && i.name === "Synth");
      expect(classItem).toBeDefined();
      if (classItem && classItem.kind === "ClassDecl") {
        expect(classItem.properties.map((p) => p.name)).toContain("Eps");
        expect(classItem.methods.map((m) => m.name)).toContain("Num");
      }
    });

    it("preserves XML doc comments as CST trivia in C# decompiler", () => {
      const csCode = `
/// <summary>Calculates whether food can be cooked.</summary>
public class Chef
{
    public bool Cook()
    {
        return true;
    }
}
`;
      const result = decompile(csCode, "csharp", { filePath: "Chef.cs" });
      expect(result.ail).toContain("Calculates whether food can be cooked");
      expect(result.ail).toContain("class Chef");
    });
  });

  describe("C# Emitter & Target Generation", () => {
    it("emits clean modern C# code from AIL Module AST", () => {
      const ailSource = `
module Game.Entities

enum WeaponTier:
  Common
  Rare
  Legendary

pub class Player:
  prop Name: str
  prop Score: int
  fn constructor(name:str, score:int):
    this.Name = name
    this.Score = score
  fn addScore(delta:int) -> int:
    this.Score = this.Score + delta
    ret this.Score
`;
      const mod = parse(ailSource, "Game/Entities/Player.cs.ail");
      const emitted = emitTarget(mod, "csharp");

      expect(emitted).toContain("namespace Game.Entities;");
      expect(emitted).toContain("public enum WeaponTier");
      expect(emitted).toContain("Common,");
      expect(emitted).toContain("public class Player");
      expect(emitted).toContain("public string Name { get; set; }");
      expect(emitted).toContain("public int Score { get; set; }");
      expect(emitted).toContain("public int addScore(int delta)");
    });
  });

  describe("C++ Emitter & Target Generation", () => {
    it("emits modern C++20 code from AIL Module AST with break and continue support", () => {
      const ailSource = `
module Core.Physics

pub fn processLoop(limit:int) -> int:
  let mut sum = 0
  let mut i = 0
  while i < limit:
    if i == 5:
      break
    sum = sum + i
    i = i + 1
  ret sum
`;
      const mod = parse(ailSource, "Core/Physics/Loop.cpp.ail");
      const emitted = emitTarget(mod, "cpp");

      expect(emitted).toContain("#pragma once");
      expect(emitted).toContain("namespace Core::Physics {");
      expect(emitted).toContain("break;");
      expect(emitted).toContain("int processLoop(int limit)");
    });
  });

  describe("Roundtrip & Lens Verification", () => {
    it("executes roundtrip for C++ source without exceptions", () => {
      const cppSource = `
#pragma once

enum class ItemRarity {
    Common,
    Uncommon,
    Rare
};
`;
      const res = executeRoundtrip(cppSource, "cpp", "ItemRarity.hpp");
      expect(res.target).toBe("cpp");
      expect(res.ail).toContain("enum ItemRarity:");
      expect(res.reconstructed).toContain("enum class ItemRarity");
    });

    it("executes roundtrip for C# source without exceptions", () => {
      const csSource = `
using System;

namespace Game;

public enum GameMode
{
    Normal,
    Hard
}
`;
      const res = executeRoundtrip(csSource, "csharp", "GameMode.cs");
      expect(res.target).toBe("csharp");
      expect(res.ail).toContain("enum GameMode:");
      expect(res.reconstructed).toContain("public enum GameMode");
    });
  });

  describe("Tokenomics Engine for C++20 and C#", () => {
    it("detects language names correctly for all C++ and C# extensions", () => {
      expect(detectLanguageName("src/engine.cpp")).toBe("C++20");
      expect(detectLanguageName("src/engine.hpp")).toBe("C++20");
      expect(detectLanguageName("src/engine.h")).toBe("C++20");
      expect(detectLanguageName("src/engine.cc")).toBe("C++20");
      expect(detectLanguageName("src/engine.cxx")).toBe("C++20");
      expect(detectLanguageName("godot/src/Sim/FoodItem.cs")).toBe("C#");
    });

    it("detects target language from file path correctly", () => {
      expect(detectTargetFromPath("World.cpp")).toBe("cpp");
      expect(detectTargetFromPath("World.hpp")).toBe("cpp");
      expect(detectTargetFromPath("Point.h")).toBe("cpp");
      expect(detectTargetFromPath("Snake.cc")).toBe("cpp");
      expect(detectTargetFromPath("Math.cxx")).toBe("cpp");
      expect(detectTargetFromPath("FoodItem.cs")).toBe("csharp");
    });

    it("calculates accurate tokenomics for C++ and C# files with positive savings", () => {
      const cppOriginal = `
#pragma once
#include <string>
#include <vector>

namespace game::core {

class Character {
public:
    Character(std::string name, int health);
    const std::string& getName() const;
    int getHealth() const;
    void setHealth(int health);
};

}
`;
      const cppDecomp = decompile(cppOriginal, "cpp", { filePath: "Character.hpp" });
      const cppTokenomics = calculateFileTokenomics(cppDecomp.ail, cppOriginal, "Character.hpp");

      expect(cppTokenomics.targetLang).toBe("C++20");
      expect(cppTokenomics.targetCl100k).toBeGreaterThan(0);
      expect(cppTokenomics.ailCl100k).toBeGreaterThan(0);
      expect(cppTokenomics.cl100kSavingsPct).toBeGreaterThan(0);

      const csOriginal = `
using System;
using System.Collections.Generic;

namespace Game.Core;

public class Character
{
    public string Name { get; set; }
    public int Health { get; set; }

    public Character(string name, int health)
    {
        Name = name;
        Health = health;
    }
}
`;
      const csDecomp = decompile(csOriginal, "csharp", { filePath: "Character.cs" });
      const csTokenomics = calculateFileTokenomics(csDecomp.ail, csOriginal, "Character.cs");

      expect(csTokenomics.targetLang).toBe("C#");
      expect(csTokenomics.targetCl100k).toBeGreaterThan(0);
      expect(csTokenomics.ailCl100k).toBeGreaterThan(0);
      expect(csTokenomics.cl100kSavingsPct).toBeGreaterThan(0);
    });
  });

  describe("Parallel Adoption (findIngestableFiles & ingestProjectSideBySide)", () => {
    it("discovers C++ and C# files in directory tree while ignoring .uid metadata", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-adopt-test-"));
      try {
        fs.writeFileSync(path.join(tempDir, "Entity.hpp"), "// hpp file\n");
        fs.writeFileSync(path.join(tempDir, "Entity.cpp"), "// cpp file\n");
        fs.writeFileSync(path.join(tempDir, "Game.cs"), "// cs file\n");
        fs.writeFileSync(path.join(tempDir, "Game.cs.uid"), "uid:12345\n"); // Godot metadata

        const files = findIngestableFiles(tempDir);
        const basenames = files.map((f) => path.basename(f));

        expect(basenames).toContain("Entity.hpp");
        expect(basenames).toContain("Entity.cpp");
        expect(basenames).toContain("Game.cs");
        expect(basenames).not.toContain("Game.cs.uid");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("adopts C++ and C# codebases side-by-side with .ail sibling generation", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-adopt-run-"));
      try {
        fs.writeFileSync(
          path.join(tempDir, "QualityTier.hpp"),
          `#pragma once\nenum class QualityTier { Common, Rare, Legendary };\n`,
        );
        fs.writeFileSync(
          path.join(tempDir, "Sound.cs"),
          `namespace Audio;\npublic enum SoundKind { Sfx, Music }\n`,
        );

        const summary = await ingestProjectSideBySide({
          dir: tempDir,
          concurrency: 2,
          dryRun: false,
        });

        expect(summary.totalIngested).toBe(2);
        expect(summary.totalFailed).toBe(0);
        expect(fs.existsSync(path.join(tempDir, "QualityTier.hpp.ail"))).toBe(true);
        expect(fs.existsSync(path.join(tempDir, "Sound.cs.ail"))).toBe(true);

        const hppAil = fs.readFileSync(path.join(tempDir, "QualityTier.hpp.ail"), "utf-8");
        expect(hppAil).toContain("enum QualityTier:");

        const csAil = fs.readFileSync(path.join(tempDir, "Sound.cs.ail"), "utf-8");
        expect(csAil).toContain("enum SoundKind:");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
