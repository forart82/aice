import { describe, expect, it } from "vitest";
import type {
  AilComponentDeclNode,
  AilFunctionDeclNode,
  AilModuleNode,
  AilTypeDeclNode,
  AilWorkspaceNode,
} from "../../src/core/ast.ts";
import { parseAil } from "../../src/core/parser.ts";

describe("AIL Parser & AST Builder", () => {
  it("parses valid AIL module with types and functions", () => {
    const src = `
      (@module math/core
        (* target "typescript" *)
        (deps (
          ("./constants.ts" PI E)
        ))
        (: User (% id !s age !i active !b))
        (! add (-> (a !i b !i) !i)
          (+ a b)
        )
      )
    `;

    const { document, diagnostics } = parseAil(src);
    expect(diagnostics).toHaveLength(0);
    expect(document).not.toBeNull();
    expect(document?.kind).toBe("Module");

    const mod = document as AilModuleNode;
    expect(mod.name).toBe("math/core");
    expect(mod.manifest?.entries.target).toBe("typescript");
    expect(mod.entities).toHaveLength(3);

    const typeDecl = mod.entities[1] as AilTypeDeclNode;
    expect(typeDecl.kind).toBe("TypeDecl");
    expect(typeDecl.name).toBe("User");
    expect(typeDecl.typeExpr.kind).toBe("RecordType");

    const fnDecl = mod.entities[2] as AilFunctionDeclNode;
    expect(fnDecl.kind).toBe("FunctionDecl");
    expect(fnDecl.name).toBe("add");
    expect(fnDecl.signatures.params).toHaveLength(2);
    expect(fnDecl.body.kind).toBe("ApplyExpr");
  });

  it("parses UI component with layout tree and attributes", () => {
    const src = `
      (@module ui/button
        (# SubmitButton (% props (% label !s))
          (< button (. class "btn-primary" on:click handleClick .)
            (!str "Click: ")
            (!val props.label)
          >)
        )
      )
    `;

    const { document, diagnostics } = parseAil(src);
    expect(diagnostics).toHaveLength(0);

    const mod = document as AilModuleNode;
    const comp = mod.entities[0] as AilComponentDeclNode;
    expect(comp.kind).toBe("ComponentDecl");
    expect(comp.name).toBe("SubmitButton");
    expect(comp.layout.kind).toBe("TagNode");
  });

  it("parses fallible try unpack expression (? ...)", () => {
    const src = `
      (@module api/fetcher
        (! fetchAccount (-> (id !s) Result[Account, Error])
          (do
            (:= raw (? (httpGet id)))
            raw
          )
        )
      )
    `;

    const { document, diagnostics } = parseAil(src);
    expect(diagnostics).toHaveLength(0);

    const mod = document as AilModuleNode;
    const fn = mod.entities[0] as AilFunctionDeclNode;
    expect(fn.body.kind).toBe("BlockExpr");
  });

  it("parses whole @workspace container with multi-file declarations", () => {
    const src = `
      (@workspace "fullstack-app"
        (* bundler "vite" *)
        (@file "src/main.ts.ail"
          (@module main
            (! run (-> () !void) (console.log "running"))
          )
        )
      )
    `;

    const { document, diagnostics } = parseAil(src);
    expect(diagnostics).toHaveLength(0);
    expect(document?.kind).toBe("Workspace");

    const ws = document as AilWorkspaceNode;
    expect(ws.name).toBe("fullstack-app");
    expect(ws.files).toHaveLength(1);
    expect(ws.files[0].path).toBe("src/main.ts.ail");
    expect(ws.files[0].module.name).toBe("main");
  });

  it("produces structured diagnostic when syntax is invalid", () => {
    const src = `invalid root tokens without module`;
    const { document, diagnostics } = parseAil(src);

    expect(document).toBeNull();
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].code).toBe("AIL_E1002_INVALID_ROOT");
  });
});
