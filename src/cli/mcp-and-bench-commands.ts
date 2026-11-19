/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { AICE_DISABLED_MESSAGE, isProjectAiceEnabled, loadProjectConfig } from "../config/index.js";
import type { OutlineOptions } from "../tools/index.js";
import {
  recordCliFailureTelemetry,
  resolveCliProjectRoot,
  resolveExplicitOrPolymorphicTarget,
} from "./telemetry-and-flags.js";

export function registerMcpAndBenchCommands(program: Command): void {
  // Command: mcp
  program
    .command("mcp")
    .description("Launch the AICE Model Context Protocol (MCP) server over stdio")
    .option("--generate-schemas [dir]", "Generate Antigravity MCP tool JSON schema files")
    .action(async (options: { generateSchemas?: string | boolean }) => {
      if (options.generateSchemas) {
        const { AICE_MCP_TOOLS, AICE_VERSION } = await import("../mcp/server.js");
        const os = await import("node:os");
        const homeDir = process.env.AICE_AGENT_HOME
          ? path.resolve(process.env.AICE_AGENT_HOME)
          : os.homedir();
        const targetDir =
          typeof options.generateSchemas === "string"
            ? path.resolve(options.generateSchemas)
            : path.join(homeDir, ".gemini", "antigravity-cli", "mcp", "aice");
        fs.mkdirSync(targetDir, { recursive: true });
        const activeSchemaFiles = new Set(AICE_MCP_TOOLS.map((t) => `${t.name}.json`));
        activeSchemaFiles.add("tools.json");
        for (const existing of fs.readdirSync(targetDir)) {
          if (
            existing.startsWith("aice_") &&
            existing.endsWith(".json") &&
            !activeSchemaFiles.has(existing)
          ) {
            fs.rmSync(path.join(targetDir, existing), { force: true });
          }
        }
        for (const tool of AICE_MCP_TOOLS) {
          fs.writeFileSync(
            path.join(targetDir, `${tool.name}.json`),
            JSON.stringify(
              { ...tool, parameters: tool.inputSchema, version: AICE_VERSION },
              null,
              2,
            ) + "\n",
            "utf-8",
          );
        }
        fs.writeFileSync(
          path.join(targetDir, "tools.json"),
          JSON.stringify(
            {
              server: "aice",
              version: AICE_VERSION,
              tools: AICE_MCP_TOOLS.map((tool) => ({ ...tool, parameters: tool.inputSchema })),
            },
            null,
            2,
          ) + "\n",
          "utf-8",
        );
        console.log(`✔ Generated ${AICE_MCP_TOOLS.length} MCP tool schema files in ${targetDir}`);
        return;
      }
      const { AiceMcpServer } = await import("../mcp/server.js");
      new AiceMcpServer(process.stdin, process.stdout);
    });
  // Command: tokens [path]
  // Aliases: tokenomics, efficiency, verify-tokenomics
  program
    .command("tokens", { hidden: true })
    .aliases(["tokenomics", "efficiency", "verify-tokenomics"])
    .description(
      "Audit token and character savings for a specific file or folder (with subfolders)",
    )
    .argument("[path]", "Path to file or directory to audit", ".")
    .option(
      "--min-savings <pct>",
      "Minimum required savings percentage across tokenizers",
      Number.parseFloat,
    )
    .option("--check-drift", "Enforce zero target drift against existing compiled files")
    .option("--projects", "Aggregate output by project (1 line per project)")
    .option("--markdown", "Force standard markdown table output even in interactive terminal")
    .option("--json", "Output machine-readable JSON telemetry for CI pipelines")
    .option("--benchmark", "Run toolchain token reduction empirical benchmark suite")
    .option("--tools <list>", "Filter specific tools to benchmark (e.g. outline,splice,dsl)")
    .option("--idioms", "Force-enable project idioms")
    .option("--no-idioms", "Temporarily disable project idioms")
    .action(
      async (
        targetPath: string,
        options: {
          minSavings?: number;
          checkDrift?: boolean;
          projects?: boolean;
          markdown?: boolean;
          json?: boolean;
          benchmark?: boolean;
          tools?: string;
          idioms?: boolean;
        },
      ) => {
        try {
          const fullTarget = path.resolve(process.cwd(), targetPath);
          if (!fs.existsSync(fullTarget)) {
            console.error(`❌ Error: File or directory not found: ${targetPath}`);
            process.exit(1);
          }

          if (options.benchmark) {
            try {
              const {
                formatRealWorldBenchmarkJson,
                formatRealWorldBenchmarkMarkdown,
                runRealWorldBenchmarkSuite,
              } = await import("../../benchmarks/index.js");
              const report = runRealWorldBenchmarkSuite();
              if (options.json) {
                console.log(formatRealWorldBenchmarkJson(report));
              } else {
                console.log(formatRealWorldBenchmarkMarkdown(report));
              }
              return;
            } catch (benchErr: unknown) {
              console.error(
                `❌ Benchmark error: ${benchErr instanceof Error ? benchErr.message : String(benchErr)}`,
              );
              process.exit(1);
            }
          }
          const isFile = fs.statSync(fullTarget).isFile();
          const projectRoot = resolveCliProjectRoot(fullTarget);
          const projectConfig = loadProjectConfig(projectRoot);
          if (!isProjectAiceEnabled(projectConfig)) {
            console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
            process.exit(1);
          }
          const isTTY = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
          const terminalWidth = process.stdout.columns || 80;

          const {
            auditTokenomics,
            formatProjectsMarkdownTable,
            formatProjectsTerminalTable,
            formatSingleFileSummary,
            formatTokenomicsMarkdownTable,
            formatTokenomicsTerminalTable,
          } = await import("../tokenomics/index.js");

          const report = auditTokenomics(targetPath, {
            minSavings: options.minSavings,
            checkDrift: options.checkDrift,
            idioms: options.idioms,
          });

          if (options.json) {
            console.log(JSON.stringify(report, null, 2));
          } else {
            if (isFile && report.files.length === 1 && !options.projects) {
              console.log(
                "\n" +
                  formatSingleFileSummary(report.files[0], {
                    width: terminalWidth,
                    useColor: isTTY,
                  }) +
                  "\n",
              );
            } else {
              if (options.markdown || !process.stdout.isTTY) {
                console.log(
                  `\n=== AICE Tokenomics & Zero-Drift Benchmark Audit: ${targetPath} ===\n`,
                );
                if (options.projects) {
                  console.log(formatProjectsMarkdownTable(report));
                } else {
                  console.log(formatTokenomicsMarkdownTable(report));
                }
                console.log();
              } else {
                console.log();
                if (options.projects) {
                  console.log(
                    formatProjectsTerminalTable(report, {
                      width: terminalWidth,
                      useColor: isTTY,
                      title: targetPath,
                    }),
                  );
                } else {
                  console.log(
                    formatTokenomicsTerminalTable(report, {
                      width: terminalWidth,
                      useColor: isTTY,
                      title: targetPath,
                    }),
                  );
                }
                console.log();
              }
            }

            if (report.driftDetected) {
              console.error("❌ Target drift detected! Compiled output differs from target file.");
            }

            if (options.minSavings !== undefined && !report.passedThreshold) {
              console.error(
                `❌ Tokenomics savings threshold violation! Required >= ${options.minSavings}%, but got:`,
              );
              console.error(`   cl100k: ${report.aggregate.cl100kSavingsPct.toFixed(1)}%`);
              console.error(`   o200k:  ${report.aggregate.o200kSavingsPct.toFixed(1)}%`);
              console.error(`   char:   ${report.aggregate.charSavingsPct.toFixed(1)}%`);
            }

            if (report.status === "SUCCESS") {
              console.log(
                "✔ Tokenomics verification passed: All savings and drift constraints satisfied.",
              );
            }
          }

          if (report.status === "FAILURE") {
            process.exit(1);
          }
        } catch (err) {
          console.error("❌ Tokenomics verification error:", err);
          process.exit(1);
        }
      },
    );

  // Command: benchmark
  // Aliases: bench
  program
    .command("benchmark")
    .aliases(["bench"])
    .description(
      "Run the 10 Real-World AICE Benchmarks Suite (evaluating Without AICE vs AICE Without Idioms vs AICE With Idioms)",
    )
    .option("--json", "Output structured JSON report")
    .option("--markdown", "Output formatted GitHub Flavored Markdown report")
    .action(async (options: { json?: boolean; markdown?: boolean }) => {
      try {
        const {
          runRealWorldBenchmarkSuite,
          formatRealWorldBenchmarkJson,
          formatRealWorldBenchmarkMarkdown,
        } = await import("../../benchmarks/index.js");
        const report = runRealWorldBenchmarkSuite();
        if (options.json) {
          console.log(formatRealWorldBenchmarkJson(report));
        } else {
          console.log(formatRealWorldBenchmarkMarkdown(report));
        }
      } catch (err: unknown) {
        console.error(`❌ Benchmark error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // Command: outline [target]
  program
    .command("outline", { hidden: true })
    .description(
      "Semantic skeletonization: generate token-dense AST skeleton outline across 33 extensions (85-90% token reduction)",
    )
    .argument(
      "[targets...]",
      "Path(s) to source file(s) or directories (e.g., 'aice outline src tests')",
    )
    .option("-d, --depth <number>", "Maximum symbol nesting depth", (val) =>
      Number.parseInt(val, 10),
    )
    .option("--compact", "Compact token-bounded directory mode (auto-enabled for 60+ files)")
    .option("--no-compact", "Disable compact directory mode even for 60+ files")
    .option("--no-types", "Exclude type annotations")
    .option("--idioms", "Force-enable project idioms")
    .option("--no-idioms", "Temporarily disable project idioms")
    .option("--json", "Output structured JSON symbol hierarchy")
    .option("--stats", "Display token reduction savings metrics")
    .addHelpText(
      "after",
      `
Examples:
  • Multi-directory skeleton map (replaces 'ls src tests'):
      aice outline src tests
  • Compact mode for large repositories (100+ files):
      aice outline src tests --compact
  • Outline test file with named test/describe titles & [Lstart-Lend]:
      aice outline tests/app.test.ts
  • Outline shell/PowerShell/batch script or Markdown headings:
      aice outline install.sh README.md
`,
    )
    .action(
      async (
        targetPaths: string[] | undefined,
        options: {
          depth?: number;
          compact?: boolean;
          types?: boolean;
          idioms?: boolean;
          json?: boolean;
          stats?: boolean;
        },
      ) => {
        const rawTargets = targetPaths && targetPaths.length > 0 ? targetPaths : [undefined];
        try {
          const { outlinePath } = await import("../tools/outline.js");
          if (rawTargets.length === 1) {
            const targetPath = rawTargets[0];
            const resolved = resolveExplicitOrPolymorphicTarget(targetPath);
            const outlineTarget = resolved.resolvedPath;

            if (!fs.existsSync(outlineTarget)) {
              console.error(`❌ Error: Path not found: ${targetPath ?? outlineTarget}`);
              process.exit(1);
            }

            if (!isProjectAiceEnabled(resolved.config)) {
              console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
              process.exit(1);
            }

            const outlineOpts: OutlineOptions = {
              depth: options.depth !== undefined ? Number(options.depth) : undefined,
              compact: options.compact,
              includeTypes: options.types !== false,
              idioms: options.idioms,
              json: !!options.json,
              stats: !!options.stats,
              projectRoot: resolved.projectRoot,
            };

            const result = await outlinePath(outlineTarget, outlineOpts);
            if (result instanceof Map) {
              if (options.json) {
                const arr = Array.from(result.values()).map(
                  (r) =>
                    r.json ?? {
                      file: r.file,
                      symbols: r.symbols,
                      ...(r.stats ? { stats: r.stats } : {}),
                    },
                );
                console.log(JSON.stringify(arr, null, 2));
              } else {
                for (const [relPath, res] of result.entries()) {
                  console.log(`// ${relPath}`);
                  console.log(res.text);
                  if (options.stats && res.stats) {
                    console.log(
                      `\n[Tokens: ${res.stats.originalTokens} -> ${res.stats.outlineTokens} (-${res.stats.savingsPct}%)]`,
                    );
                  }
                }
                if (options.stats) {
                  let totalOrig = 0;
                  let totalOutline = 0;
                  for (const res of result.values()) {
                    if (res.stats) {
                      totalOrig += res.stats.originalTokens;
                      totalOutline += res.stats.outlineTokens;
                    }
                  }
                  const savings = Math.max(0, totalOrig - totalOutline);
                  const savingsPct =
                    totalOrig > 0 ? ((savings / totalOrig) * 100).toFixed(1) : "0.0";
                  console.log(`\n📊 Aggregate Token Reduction Metrics (${result.size} files):`);
                  console.log(`  Original tokens: ${totalOrig.toLocaleString()}`);
                  console.log(`  Outline tokens:  ${totalOutline.toLocaleString()}`);
                  console.log(
                    `  Token savings:   ${savings.toLocaleString()} tokens (${savingsPct}%)`,
                  );
                }
              }
            } else {
              if (options.json) {
                console.log(
                  JSON.stringify(
                    result.json ?? {
                      file: result.file,
                      symbols: result.symbols,
                      ...(result.stats ? { stats: result.stats } : {}),
                    },
                    null,
                    2,
                  ),
                );
              } else {
                console.log(result.text);
                if (options.stats && result.stats) {
                  console.log(`\n📊 Token Reduction Metrics for ${result.file}:`);
                  console.log(`  Original tokens: ${result.stats.originalTokens.toLocaleString()}`);
                  console.log(`  Outline tokens:  ${result.stats.outlineTokens.toLocaleString()}`);
                  console.log(
                    `  Token savings:   ${result.stats.savingsTokens.toLocaleString()} tokens (${result.stats.savingsPct}%)`,
                  );
                  console.log(`  Original chars:  ${result.stats.originalChars.toLocaleString()}`);
                  console.log(
                    `  Outline chars:   ${result.stats.outlineChars.toLocaleString()} (${result.stats.charSavingsPct}%)`,
                  );
                }
              }
            }
            return;
          }

          // Multiple targets passed: `aice outline f1 f2 f3`
          const allJsonItems: unknown[] = [];
          let totalOrig = 0;
          let totalOutline = 0;
          let totalFilesCount = 0;

          const resolvedTargets: Array<{ raw: string | undefined; abs: string; root: string }> = [];
          const missingOutlineTargets: string[] = [];
          for (const targetPath of rawTargets) {
            const resolved = resolveExplicitOrPolymorphicTarget(targetPath);
            const outlineTarget = resolved.resolvedPath;
            if (!fs.existsSync(outlineTarget)) {
              missingOutlineTargets.push(targetPath ?? outlineTarget);
              continue;
            }
            if (!isProjectAiceEnabled(resolved.config)) {
              console.error(`❌ ${AICE_DISABLED_MESSAGE}`);
              process.exit(1);
            }
            resolvedTargets.push({
              raw: targetPath,
              abs: outlineTarget,
              root: resolved.projectRoot,
            });
          }
          if (resolvedTargets.length === 0) {
            console.error(`❌ Error: Path not found: ${missingOutlineTargets.join(", ")}`);
            process.exit(1);
          }

          const hasDirectoryTarget = resolvedTargets.some((t) => fs.statSync(t.abs).isDirectory());

          if (hasDirectoryTarget || options.compact) {
            const outlineOpts: OutlineOptions = {
              depth: options.depth !== undefined ? Number(options.depth) : undefined,
              compact: options.compact,
              includeTypes: options.types !== false,
              idioms: options.idioms,
              json: !!options.json,
              stats: !!options.stats,
              projectRoot: resolvedTargets[0].root,
            };
            const combinedResult = await outlinePath(
              resolvedTargets.map((t) => t.abs),
              outlineOpts,
            );
            if (combinedResult instanceof Map) {
              for (const [relPath, res] of combinedResult.entries()) {
                totalFilesCount++;
                if (res.stats) {
                  totalOrig += res.stats.originalTokens;
                  totalOutline += res.stats.outlineTokens;
                }
                if (options.json) {
                  allJsonItems.push(
                    res.json ?? {
                      file: res.file,
                      symbols: res.symbols,
                      ...(res.stats ? { stats: res.stats } : {}),
                    },
                  );
                } else {
                  console.log(`// ${relPath}`);
                  console.log(res.text);
                  if (options.stats && res.stats) {
                    console.log(
                      `\n[Tokens: ${res.stats.originalTokens} -> ${res.stats.outlineTokens} (-${res.stats.savingsPct}%)]`,
                    );
                  }
                }
              }
            }
          } else {
            for (const item of resolvedTargets) {
              const outlineOpts: OutlineOptions = {
                depth: options.depth !== undefined ? Number(options.depth) : undefined,
                compact: options.compact,
                includeTypes: options.types !== false,
                idioms: options.idioms,
                json: !!options.json,
                stats: !!options.stats,
                projectRoot: item.root,
              };
              const result = await outlinePath(item.abs, outlineOpts);
              if (result instanceof Map) {
                for (const [relPath, res] of result.entries()) {
                  totalFilesCount++;
                  if (res.stats) {
                    totalOrig += res.stats.originalTokens;
                    totalOutline += res.stats.outlineTokens;
                  }
                  if (options.json) {
                    allJsonItems.push(
                      res.json ?? {
                        file: res.file,
                        symbols: res.symbols,
                        ...(res.stats ? { stats: res.stats } : {}),
                      },
                    );
                  } else {
                    console.log(`// ${relPath}`);
                    console.log(res.text);
                    if (options.stats && res.stats) {
                      console.log(
                        `\n[Tokens: ${res.stats.originalTokens} -> ${res.stats.outlineTokens} (-${res.stats.savingsPct}%)]`,
                      );
                    }
                  }
                }
              } else {
                totalFilesCount++;
                if (result.stats) {
                  totalOrig += result.stats.originalTokens;
                  totalOutline += result.stats.outlineTokens;
                }
                if (options.json) {
                  allJsonItems.push(
                    result.json ?? {
                      file: result.file,
                      symbols: result.symbols,
                      ...(result.stats ? { stats: result.stats } : {}),
                    },
                  );
                } else {
                  console.log(`// ${item.raw ?? result.file}`);
                  console.log(result.text);
                  if (options.stats && result.stats) {
                    console.log(
                      `\n[Tokens: ${result.stats.originalTokens} -> ${result.stats.outlineTokens} (-${result.stats.savingsPct}%)]`,
                    );
                  }
                }
              }
            }
          }

          if (missingOutlineTargets.length > 0) {
            for (const missingPath of missingOutlineTargets) {
              if (options.json) {
                allJsonItems.push({ file: missingPath, error: "not found", symbols: [] });
              } else {
                console.log(`\n// not found: ${missingPath}`);
              }
            }
          }

          if (options.json) {
            console.log(JSON.stringify(allJsonItems, null, 2));
          } else if (options.stats) {
            const savings = Math.max(0, totalOrig - totalOutline);
            const savingsPct = totalOrig > 0 ? ((savings / totalOrig) * 100).toFixed(1) : "0.0";
            console.log(`\n📊 Aggregate Token Reduction Metrics (${totalFilesCount} files):`);
            console.log(`  Original tokens: ${totalOrig.toLocaleString()}`);
            console.log(`  Outline tokens:  ${totalOutline.toLocaleString()}`);
            console.log(`  Token savings:   ${savings.toLocaleString()} tokens (${savingsPct}%)`);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          recordCliFailureTelemetry(msg, "outline", rawTargets[0]);
          console.error(`❌ Error outlining ${rawTargets.join(", ")}: ${msg}`);
          process.exit(1);
        }
      },
    );
}
