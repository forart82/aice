/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertSafeTextWriteTarget,
  BINARY_EXTENSIONS,
  checkSafeTextWriteTarget,
  DEFAULT_BINARY_PROBE_BYTES,
  findProjectRoot,
  isBinaryExtension,
  isLikelyBinaryBuffer,
  isLikelyBinaryDiskFile,
  isUniversalTextDiskFile,
  LOCKFILE_SKIP_NAMES,
  resolvePathTargets,
} from "../../src/config/index.js";
import { createBatch, createFile } from "../../src/tools/create.js";
import { isSupportedReadDiskFile } from "../../src/tools/outline.js";
import { aiceRead, parseReadTarget } from "../../src/tools/read.js";
import { splice, spliceBatch } from "../../src/tools/splice.js";

describe("Phase 1: Universal File SSOT & Binary Guard", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-file-ssot-"));
    fs.writeFileSync(
      path.join(tmpDir, "aice.config.json"),
      JSON.stringify({ enabled: true, idiomsEnabled: false }, null, 2),
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("1. Extension Classification SSOT", () => {
    it("recognizes known binary extensions and explicitly excludes text/SVG/XML/data formats", () => {
      for (const bin of [
        ".png",
        "assets/logo.PNG",
        "photo.jpg",
        "module.wasm",
        "app.apk",
        "bundle.aab",
        "classes.dex",
        "bun.lockb",
        "doc.pdf",
        "data.sqlite",
        "archive.zip",
        "native.exe",
        "libcore.so",
        "font.woff2",
        "clip.mp4",
      ]) {
        expect(isBinaryExtension(bin), `expected binary: ${bin}`).toBe(true);
      }

      for (const txt of [
        "icon.svg",
        ".svg",
        "manifest.xml",
        "notes.txt",
        "Cargo.toml",
        "settings.ini",
        "report.csv",
        "server.log",
        "main.tf",
        "guide.rst",
        "page.mdx",
        "payload.customblob",
        "App.vue",
        "App.svelte",
        "main.zig",
        "index.ts",
        "Makefile",
        ".gitignore",
        ".customdot",
        "bun.lock",
      ]) {
        expect(isBinaryExtension(txt), `expected text: ${txt}`).toBe(false);
      }

      expect(BINARY_EXTENSIONS.has(".svg")).toBe(false);
      expect(BINARY_EXTENSIONS.has(".xml")).toBe(false);
      expect(BINARY_EXTENSIONS.has(".apk")).toBe(true);
      expect(BINARY_EXTENSIONS.has(".lockb")).toBe(true);
      expect(LOCKFILE_SKIP_NAMES.has("package-lock.json")).toBe(true);
      expect(LOCKFILE_SKIP_NAMES.has("bun.lock")).toBe(true);
    });
  });

  describe("2. Buffer & Disk Binary Guard (NUL, control bytes, strict UTF-8 & multi-byte boundary safety)", () => {
    it("rejects NUL bytes, invalid UTF-8, and binary control-byte streams", () => {
      expect(isLikelyBinaryBuffer(Buffer.from([0x00, 0x61, 0x62]))).toBe(true);
      expect(isLikelyBinaryBuffer(Buffer.from("hello\0world", "utf-8"))).toBe(true);
      // PNG magic bytes even without NUL
      expect(
        isLikelyBinaryBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      ).toBe(true);
      // Invalid UTF-8 sequences (overlong, invalid lead, orphan continuation, UTF-16 BOM, surrogate)
      expect(isLikelyBinaryBuffer(Buffer.from([0xff, 0xfe, 0x61, 0x62]))).toBe(true);
      expect(isLikelyBinaryBuffer(Buffer.from([0xc0, 0xaf]))).toBe(true);
      expect(isLikelyBinaryBuffer(Buffer.from([0xc3, 0x28]))).toBe(true);
      expect(isLikelyBinaryBuffer(Buffer.from([0x80, 0x81, 0x82]))).toBe(true);
      expect(isLikelyBinaryBuffer(Buffer.from([0x61, 0xed, 0xa0, 0x80]))).toBe(true);
      // High-density C0 control-byte stream
      expect(
        isLikelyBinaryBuffer(Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])),
      ).toBe(true);
    });

    it("accepts valid UTF-8 text including emojis, CJK, box-drawing, ANSI logs, and partial probe boundaries", () => {
      expect(isLikelyBinaryBuffer(Buffer.alloc(0))).toBe(false);
      expect(isLikelyBinaryBuffer(Buffer.from("plain ascii text\r\n\tindented\n", "utf-8"))).toBe(
        false,
      );
      // UTF-8 BOM + rich Unicode
      const bomAndUnicode = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("🚀 Rocket │ 你好世界 │ 日本語 │ 한국어 │ ∑∫√∞ │ éàüñç\n", "utf-8"),
      ]);
      expect(isLikelyBinaryBuffer(bomAndUnicode)).toBe(false);
      // ANSI color log file (ESC = 0x1B)
      expect(
        isLikelyBinaryBuffer(Buffer.from("\x1b[32mINFO\x1b[0m server booted on :3000\n", "utf-8")),
      ).toBe(false);

      // Partial probe chunks slicing mid-codepoint for 2-byte, 3-byte, and 4-byte UTF-8 characters
      const multiByteText = Buffer.from("prefix-é-中-│-🚀-suffix", "utf-8");
      for (let cut = 7; cut < multiByteText.length; cut++) {
        expect(
          isLikelyBinaryBuffer(multiByteText.subarray(0, cut)),
          `false binary positive at UTF-8 slice boundary ${cut}`,
        ).toBe(false);
      }

      // Large disk file where the 8192-byte probe boundary splits a 4-byte emoji right down the middle
      const pad = "a".repeat(DEFAULT_BINARY_PROBE_BYTES - 2);
      const largeEmojiFile = path.join(tmpDir, "emoji-boundary.customblob");
      fs.writeFileSync(largeEmojiFile, `${pad}🚀🎉你好│end\n`, "utf-8");
      expect(isLikelyBinaryDiskFile(largeEmojiFile)).toBe(false);
      expect(isUniversalTextDiskFile(largeEmojiFile)).toBe(true);
    });

    it("classifies disguised binary files as binary and respects dotfile/lockfile options", () => {
      const disguisedBin = path.join(tmpDir, "disguised.customblob");
      fs.writeFileSync(disguisedBin, Buffer.from([0x48, 0x69, 0x00, 0x7f, 0x01]));
      expect(isLikelyBinaryDiskFile(disguisedBin)).toBe(true);
      expect(isUniversalTextDiskFile(disguisedBin)).toBe(false);

      const extensionlessBin = path.join(tmpDir, "my-elf-bin");
      fs.writeFileSync(extensionlessBin, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x00]));
      expect(isLikelyBinaryDiskFile(extensionlessBin)).toBe(true);
      expect(isUniversalTextDiskFile(extensionlessBin)).toBe(false);

      const customDot = path.join(tmpDir, ".customdot");
      fs.writeFileSync(customDot, "CUSTOM_KEY=value\n", "utf-8");
      expect(isUniversalTextDiskFile(customDot)).toBe(false);
      expect(isUniversalTextDiskFile(customDot, { allowDotfiles: true })).toBe(true);
      expect(isSupportedReadDiskFile(customDot, { allowDotfiles: true })).toBe(true);

      const lockFile = path.join(tmpDir, "package-lock.json");
      fs.writeFileSync(lockFile, '{"lockfileVersion": 3}\n', "utf-8");
      expect(isUniversalTextDiskFile(lockFile)).toBe(false);
      expect(isUniversalTextDiskFile(lockFile, { skipLockfiles: false })).toBe(true);
    });
  });

  describe("3. Path Resolution for Non-Existent Unknown Extensions & Dotfiles", () => {
    it("resolves non-existent unknown-extension and dotfile targets as files while preserving genuine directories", () => {
      const subDir = path.join(tmpDir, "nested");
      fs.mkdirSync(subDir, { recursive: true });

      const newBlob = path.join(subDir, "new.customblob");
      const newDot = path.join(subDir, ".customdot");
      expect(findProjectRoot(newBlob)).toBe(path.resolve(tmpDir));
      expect(findProjectRoot(newDot)).toBe(path.resolve(tmpDir));

      const resBlob = resolvePathTargets(newBlob, { projectRoot: tmpDir });
      expect(resBlob.isSingleFile).toBe(true);
      expect(resBlob.isDirectory).toBe(false);
      expect(resBlob.files).toEqual([newBlob]);

      const resDot = resolvePathTargets(newDot, { projectRoot: tmpDir });
      expect(resDot.isSingleFile).toBe(true);
      expect(resDot.isDirectory).toBe(false);
      expect(resDot.files).toEqual([newDot]);

      // Genuine directory targets remain directories
      for (const dirTarget of [
        path.join(tmpDir, "src"),
        path.join(tmpDir, "src", "tools"),
        path.join(tmpDir, ".github"),
        `${path.join(tmpDir, "newdir")}/`,
      ]) {
        const dirRes = resolvePathTargets(dirTarget, { projectRoot: tmpDir });
        expect(dirRes.isDirectory, `expected directory: ${dirTarget}`).toBe(true);
        expect(dirRes.isSingleFile, `expected non-file: ${dirTarget}`).toBe(false);
      }

      // Target parser recognizes unknown extensions and inline selectors cleanly
      expect(parseReadTarget("foo.customblob:L1-L5", tmpDir)).toMatchObject({
        targetPath: "foo.customblob",
        inlineSelector: "L1-L5",
      });
      expect(parseReadTarget("icon.svg:/path/", tmpDir)).toMatchObject({
        targetPath: "icon.svg",
        inlineSelector: "/path/",
      });
    });
  });

  describe("4. End-to-End find, search, read, createFile, and splice across Universal Text Formats", () => {
    const universalFixtures: Array<{ rel: string; initial: string; marker: string }> = [
      {
        rel: "assets/icon.svg",
        initial: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" id="UNI_SVG"/></svg>\n',
        marker: "UNI_SVG",
      },
      {
        rel: "config/app.xml",
        initial: "<root><entry>UNI_XML_MARKER</entry></root>\n",
        marker: "UNI_XML_MARKER",
      },
      {
        rel: "config/settings.toml",
        initial: '[service]\nname = "UNI_TOML_MARKER"\n',
        marker: "UNI_TOML_MARKER",
      },
      {
        rel: "config/runtime.ini",
        initial: "[core]\nflag = UNI_INI_MARKER\n",
        marker: "UNI_INI_MARKER",
      },
      {
        rel: "data/metrics.csv",
        initial: "id,label\n1,UNI_CSV_MARKER\n",
        marker: "UNI_CSV_MARKER",
      },
      {
        rel: "logs/app.log",
        initial: "2026-11-19 INFO UNI_LOG_MARKER\n",
        marker: "UNI_LOG_MARKER",
      },
      {
        rel: "infra/main.tf",
        initial: 'resource "null_resource" "UNI_TF_MARKER" {}\n',
        marker: "UNI_TF_MARKER",
      },
      {
        rel: "docs/guide.rst",
        initial: "Guide\n=====\n\nUNI_RST_MARKER\n",
        marker: "UNI_RST_MARKER",
      },
      {
        rel: "docs/page.mdx",
        initial: '# MDX Page\n\n<Badge label="UNI_MDX_MARKER" />\n',
        marker: "UNI_MDX_MARKER",
      },
      {
        rel: "NOTES",
        initial: "Extensionless text note UNI_EXTENSIONLESS_MARKER\n",
        marker: "UNI_EXTENSIONLESS_MARKER",
      },
      {
        rel: ".gitignore",
        initial: "dist/\n# UNI_GITIGNORE_MARKER\n",
        marker: "UNI_GITIGNORE_MARKER",
      },
      {
        rel: ".customdot",
        initial: "DOT_KEY=UNI_CUSTOMDOT_MARKER\n",
        marker: "UNI_CUSTOMDOT_MARKER",
      },
      {
        rel: "blobs/sample.customblob",
        initial: "header: v1\nbody: UNI_CUSTOMBLOB_MARKER 🚀\n",
        marker: "UNI_CUSTOMBLOB_MARKER",
      },
    ];

    it("supports createFile, find, search, read (file & dir), and splice on every universal text format", async () => {
      // 1. Create every fixture via createFile (zero allowlist errors!)
      for (const fx of universalFixtures) {
        const res = await createFile(path.join(tmpDir, fx.rel), {
          code: fx.initial,
          projectRoot: tmpDir,
        });
        expect(res.success).toBe(true);
        expect(fs.readFileSync(path.join(tmpDir, fx.rel), "utf-8")).toContain(fx.marker);
      }

      // Plant binary files that MUST be skipped by find/search/dir-read
      const pngPath = path.join(tmpDir, "assets", "logo.png");
      fs.writeFileSync(
        pngPath,
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      );
      const nulBlobPath = path.join(tmpDir, "blobs", "binary.customblob");
      fs.writeFileSync(nulBlobPath, Buffer.from([0x55, 0x4e, 0x49, 0x5f, 0x00, 0x01, 0xff]));

      // 2. aice find (standard & --full for custom dotfiles)
      const findRes = await aiceRead(".", { projectRoot: tmpDir, filesOnly: true, surface: "cli" });
      for (const fx of universalFixtures) {
        if (!path.basename(fx.rel).startsWith(".")) {
          expect(findRes.output, `find missing ${fx.rel}`).toContain(path.basename(fx.rel));
        }
      }
      expect(findRes.output).not.toContain("logo.png");
      expect(findRes.output).not.toContain("binary.customblob");

      const findFullRes = await aiceRead(".", {
        projectRoot: tmpDir,
        filesOnly: true,
        full: true,
        surface: "cli",
      });
      expect(findFullRes.output).toContain(".customdot");
      expect(findFullRes.output).toContain(".gitignore");
      expect(findFullRes.output).not.toContain("logo.png");
      expect(findFullRes.output).not.toContain("binary.customblob");

      // 3. aice search across directory discovers ALL universal text files (and .customdot with --full)
      const searchRes = await aiceRead(".", {
        projectRoot: tmpDir,
        search: "UNI_",
        surface: "cli",
      });
      for (const fx of universalFixtures) {
        if (fx.rel !== ".customdot") {
          expect(searchRes.output, `search missing ${fx.rel}`).toContain(fx.marker);
        }
      }
      expect(searchRes.output).not.toContain("logo.png");
      expect(searchRes.output).not.toContain("binary.customblob");

      const searchFullRes = await aiceRead(".", {
        projectRoot: tmpDir,
        search: "UNI_CUSTOMDOT_MARKER",
        full: true,
        surface: "cli",
      });
      expect(searchFullRes.output).toContain(".customdot");
      expect(searchFullRes.output).toContain("UNI_CUSTOMDOT_MARKER");

      // 4. aice read directory outline includes .svg, .customblob, .csv, .tf, etc. without silent skips
      const dirReadRes = await aiceRead(".", { projectRoot: tmpDir, surface: "cli" });
      expect(dirReadRes.output).toContain("assets/icon.svg");
      expect(dirReadRes.output).toContain("blobs/sample.customblob");
      expect(dirReadRes.output).toContain("data/metrics.csv");
      expect(dirReadRes.output).toContain("infra/main.tf");
      expect(dirReadRes.output).not.toContain("logo.png");
      expect(dirReadRes.output).not.toContain("binary.customblob");

      // 5. Direct file read with line range & regex selector on unknown extension, SVG, and dotfile
      const blobRange = await aiceRead("blobs/sample.customblob:L1-L2", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(blobRange.output).toContain("UNI_CUSTOMBLOB_MARKER");

      const svgSearch = await aiceRead("assets/icon.svg:/path/", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(svgSearch.output).toContain("UNI_SVG");

      const dotRead = await aiceRead(".customdot", { projectRoot: tmpDir, surface: "cli" });
      expect(dotRead.output).toContain("UNI_CUSTOMDOT_MARKER");

      // Explicit binary read safely emits skip notice instead of binary garbage
      const pngRead = await aiceRead("assets/logo.png", { projectRoot: tmpDir, surface: "cli" });
      expect(pngRead.output).toContain("[binary file skipped:");

      // 6. Surgical splice (:Lstart-Lend), overwrite (:overwrite), and new-file creation via splice
      await splice(path.join(tmpDir, "blobs/sample.customblob"), {
        symbol: "L2-L2",
        code: "body: UNI_CUSTOMBLOB_UPDATED 🚀",
        projectRoot: tmpDir,
      });
      expect(fs.readFileSync(path.join(tmpDir, "blobs/sample.customblob"), "utf-8")).toContain(
        "UNI_CUSTOMBLOB_UPDATED 🚀",
      );

      await splice(path.join(tmpDir, "blobs/sample.customblob"), {
        symbol: ":overwrite",
        code: "overwritten: true\n",
        projectRoot: tmpDir,
      });
      expect(fs.readFileSync(path.join(tmpDir, "blobs/sample.customblob"), "utf-8")).toBe(
        "overwritten: true\n",
      );

      // Multi-file splice stream creating brand-new unknown ext + dotfile + SVG in one turn
      const streamRes = await spliceBatch(
        [
          "=== fresh.customblob ===",
          "hello from fresh customblob",
          "=== .freshdot ===",
          "FRESH_DOT=1",
          "=== icons/fresh.svg ===",
          '<svg><circle r="5"/></svg>',
        ].join("\n"),
        { projectRoot: tmpDir },
      );
      expect(streamRes.success).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, "fresh.customblob"), "utf-8")).toContain(
        "hello from fresh customblob",
      );
      expect(fs.readFileSync(path.join(tmpDir, ".freshdot"), "utf-8")).toContain("FRESH_DOT=1");
      expect(fs.readFileSync(path.join(tmpDir, "icons/fresh.svg"), "utf-8")).toContain("<circle");

      // Multi-file createBatch stream with unknown extension & dotfile
      const createBatchRes = await createBatch(
        ["=== batch.customblob ===", "batch content", "=== .batchdot ===", "BATCH=1"].join("\n"),
        { projectRoot: tmpDir },
      );
      expect(createBatchRes.success).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, "batch.customblob"), "utf-8")).toContain(
        "batch content",
      );
      expect(fs.readFileSync(path.join(tmpDir, ".batchdot"), "utf-8")).toContain("BATCH=1");
    });
  });

  describe("5. Binary Write & Splice Guard", () => {
    it("refuses to create, overwrite, or splice binary extensions, existing binary files, or NUL-byte payloads", async () => {
      const pngPath = path.join(tmpDir, "image.png");
      const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
      fs.writeFileSync(pngPath, pngBytes);

      const binBlobPath = path.join(tmpDir, "opaque.customblob");
      const binBlobBytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0x02, 0xff]);
      fs.writeFileSync(binBlobPath, binBlobBytes);

      // Direct guard checks
      expect(checkSafeTextWriteTarget(pngPath).safe).toBe(false);
      expect(checkSafeTextWriteTarget(binBlobPath).safe).toBe(false);
      expect(checkSafeTextWriteTarget(path.join(tmpDir, "ok.txt"), "abc\0def").safe).toBe(false);
      expect(
        checkSafeTextWriteTarget(path.join(tmpDir, "ok.customblob"), "valid utf-8 🚀").safe,
      ).toBe(true);
      expect(() => assertSafeTextWriteTarget(path.join(tmpDir, "mod.wasm"), "abc")).toThrow(
        /Refusing to write or splice binary file/i,
      );

      // createFile refuses .png, existing binary .customblob, and NUL-byte payload
      await expect(
        createFile(pngPath, { code: "corrupt", overwrite: true, projectRoot: tmpDir }),
      ).rejects.toThrow(/Refusing to write or splice binary file/i);
      await expect(
        createFile(binBlobPath, { code: "corrupt", overwrite: true, projectRoot: tmpDir }),
      ).rejects.toThrow(/Refusing to write or splice binary file/i);
      await expect(
        createFile(path.join(tmpDir, "bad.txt"), { code: "has\0nul", projectRoot: tmpDir }),
      ).rejects.toThrow(/Refusing to write binary content/i);

      // splice refuses line-range & overwrite edits on .png and existing binary .customblob
      await expect(
        splice(pngPath, { symbol: "L1-L1", code: "corrupt", projectRoot: tmpDir }),
      ).rejects.toThrow(/Refusing to write or splice binary file/i);
      await expect(
        splice(pngPath, { symbol: ":overwrite", code: "corrupt", projectRoot: tmpDir }),
      ).rejects.toThrow(/Refusing to write or splice binary file/i);
      await expect(
        splice(binBlobPath, { symbol: "L1-L1", code: "corrupt", projectRoot: tmpDir }),
      ).rejects.toThrow(/Refusing to write or splice binary file/i);
      await expect(
        splice(binBlobPath, { symbol: ":overwrite", code: "corrupt", projectRoot: tmpDir }),
      ).rejects.toThrow(/Refusing to write or splice binary file/i);

      // spliceBatch refuses and rolls back cleanly without corrupting binary files
      const safeTextPath = path.join(tmpDir, "safe.txt");
      fs.writeFileSync(safeTextPath, "original\n", "utf-8");
      await expect(
        spliceBatch(
          [
            `=== ${safeTextPath}:L1-L1 ===`,
            "modified",
            `=== ${binBlobPath}:overwrite ===`,
            "corrupt",
          ].join("\n"),
          { projectRoot: tmpDir },
        ),
      ).rejects.toThrow(/Refusing to write or splice binary file/i);

      // Verify ZERO corruption on disk
      expect(Buffer.compare(fs.readFileSync(pngPath), pngBytes)).toBe(0);
      expect(Buffer.compare(fs.readFileSync(binBlobPath), binBlobBytes)).toBe(0);
      expect(fs.readFileSync(safeTextPath, "utf-8")).toBe("original\n");
    });
  });
});
