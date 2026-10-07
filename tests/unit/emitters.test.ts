import { describe, expect, it } from "vitest";
import {
  compileAil,
  emitCss,
  emitHtml,
  emitPython,
  emitTypeScript,
  parseAil,
} from "../../src/index.ts";

function parse(src: string) {
  const { document, triviaTable } = parseAil(src);
  if (!document) throw new Error("Failed to parse AIL source");
  return { document, triviaTable };
}

describe("AIL Multi-Target Forward Emitters & Lowering (Step 5)", () => {
  describe("TypeScript & TSX Emitter", () => {
    it("emits interfaces and types", () => {
      const src = `
        (@module app/models
          (: User (% id !s age !i active !b))
          (: Status (| !s !nil))
        )
      `;
      const { document } = parse(src);
      const code = emitTypeScript(document);

      expect(code).toContain("export interface User {");
      expect(code).toContain("id: string;");
      expect(code).toContain("age: number;");
      expect(code).toContain("active: boolean;");
      expect(code).toContain("export type Status = string | null;");
    });

    it("lowers canonical string and collection primitives (Pillar 1 & 3)", () => {
      const src = `
        (@module app/utils
          (! transform (-> (text !s items [!i]) !s)
            (do
              (:= sub (str:slice text 0 5))
              (:= char (str:at text 1))
              (:= totalLen (+ (str:len text) (arr:len items)))
              (:= slicedArr (arr:slice items 0 2))
              (:= nextArr (arr:append items 99))
              sub
            )
          )
        )
      `;
      const { document } = parse(src);
      const code = emitTypeScript(document);

      expect(code).toContain("text.slice(0, 5)");
      expect(code).toContain("text.at(1)");
      expect(code).toContain("text.length + items.length");
      expect(code).toContain("items.slice(0, 2)");
      expect(code).toContain("[...items, 99]");
      expect(code).toContain("return sub;");
    });

    it("lowers fallible Result unpacking (? expr) to defensive guards", () => {
      const src = `
        (@module app/service
          (: Account (% id !s balance !f))
          (! fetchAccount (-> (id !s) Result[Account, !s])
            (% ok true value (% id id balance 0.0))
          )
          (! loadUser (-> (id !s) Result[Account, !s])
            (do
              (:= acc (? (fetchAccount id)))
              acc
            )
          )
        )
      `;
      const { document } = parse(src);
      const code = emitTypeScript(document);

      expect(code).toContain("export type Result<T, E> =");
      expect(code).toContain("const __res_0 = fetchAccount(id);");
      expect(code).toContain("if (!__res_0.ok) return __res_0;");
      expect(code).toContain("const acc = __res_0.value;");
      expect(code).toContain("return acc;");
    });

    it("emits React 19 TSX components and layout trees", () => {
      const src = `
        (@module ui/card
          (# Card (% title !s)
            (< div (. class "card shadow-sm" .)
              (< h2 !str "Header" >)
              (< p (. id "title-p" .) (!val title) >)
            >)
          )
        )
      `;
      const { document } = parse(src);
      const code = emitTypeScript(document);

      expect(code).toContain("export interface CardProps {");
      expect(code).toContain("title: string;");
      expect(code).toContain("export function Card({ title }: CardProps) {");
      expect(code).toContain('className="card shadow-sm"');
      expect(code).toContain("<h2>Header</h2>");
      expect(code).toContain('<p id="title-p">{title}</p>');
    });
  });

  describe("HTML5 Emitter", () => {
    it("emits clean HTML5 document with void element support", () => {
      const src = `
        (@module site/index
          (# Page
            (< html (. lang "en" .)
              (< head
                (< meta (. charset "UTF-8" .) >)
                (< title !str "AIL Showcase" >)
              >)
              (< body
                (< h1 !str "Welcome to AIL" >)
                (< img (. src "/logo.svg" alt "Logo" .) >)
              >)
            >)
          )
        )
      `;
      const { document } = parse(src);
      const html = emitHtml(document);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('<meta charset="UTF-8">');
      expect(html).not.toContain("</meta>");
      expect(html).toContain("<title>AIL Showcase</title>");
      expect(html).toContain("<h1>Welcome to AIL</h1>");
      expect(html).toContain('<img src="/logo.svg" alt="Logo">');
      expect(html).not.toContain("</img>");
      expect(html).toContain("</html>");
    });
  });

  describe("CSS Emitter", () => {
    it("emits formatted CSS rules from style declarations", () => {
      const src = `
        (@module styles/theme
          (& btn
            (.
              display "inline-flex"
              padding "8px 16px"
              background "#0070f3"
              color "#ffffff"
              border-radius "4px"
            .)
          )
        )
      `;
      const { document } = parse(src);
      const css = emitCss(document);

      expect(css).toContain(".btn {");
      expect(css).toContain("display: inline-flex;");
      expect(css).toContain("padding: 8px 16px;");
      expect(css).toContain("background: #0070f3;");
      expect(css).toContain("color: #ffffff;");
      expect(css).toContain("border-radius: 4px;");
      expect(css).toContain("}");
    });
  });

  describe("Python 3.12+ Emitter", () => {
    it("emits dataclasses, typed functions, and lowered primitives", () => {
      const src = `
        (@module server/calc
          (: Point (% x !f y !f))
          (! distance (-> (s !s items [!i]) !s)
            (do
              (:= sub (str:slice s 0 3))
              (:= l (str:len s))
              (:= arrLen (arr:len items))
              (:= newArr (arr:append items 10))
              sub
            )
          )
        )
      `;
      const { document } = parse(src);
      const py = emitPython(document);

      expect(py).toContain("from dataclasses import dataclass");
      expect(py).toContain("@dataclass\nclass Point:");
      expect(py).toContain("x: float");
      expect(py).toContain("y: float");
      expect(py).toContain("def distance(s: str, items: list[int]) -> str:");
      expect(py).toContain("sub = s[0:3]");
      expect(py).toContain("l = len(s)");
      expect(py).toContain("arrLen = len(items)");
      expect(py).toContain("newArr = [*items, 10]");
      expect(py).toContain("return sub");
    });
  });

  describe("compileAil Dispatcher", () => {
    it("automatically dispatches to correct emitter based on filename", () => {
      const srcTs = '(@module test (! hello (-> () !s) "world"))';
      const resTs = compileAil(srcTs, "src/hello.ts.ail");
      expect(resTs.targetLanguage).toBe("typescript");
      expect(resTs.code).toContain('export function hello(): string {\n  return "world";\n}');

      const srcPy = '(@module test (! hello (-> () !s) "world"))';
      const resPy = compileAil(srcPy, "server/hello.py.ail");
      expect(resPy.targetLanguage).toBe("python");
      expect(resPy.code).toContain('def hello() -> str:\n    return "world"');

      const srcCss = '(@module test (& card (. padding "12px" .)))';
      const resCss = compileAil(srcCss, "styles/card.css.ail");
      expect(resCss.targetLanguage).toBe("css");
      expect(resCss.code).toContain(".card {\n  padding: 12px;\n}");
    });
  });
});
